import test from 'node:test';import assert from 'node:assert/strict';
import{GatewaySearchProvider,GatewayFetchProvider}from'../src/provider.js';
test('uses gateway credentials and returns only actual validated sources',async()=>{
 let request;
 const p=new GatewaySearchProvider({baseURL:'https://gateway.example',resolveKey:async()=>'test-key',fetcher:async(url,init)=>{request={url,init};return Response.json({sources:[{url:'https://numpy.org/',title:'NumPy',snippet:'Arrays'}],truncated:false});}});
 const result=await p.search({query:'NumPy',maxResults:5});assert.equal(result.sources[0].url,'https://numpy.org/');assert.match(result.sources[0].snippet,/原文未读取/);assert.match(result.sources[0].snippet,/Arrays/);assert.equal(result.content,undefined);assert.equal(result.sources[0].publishedAt,undefined);
 assert.equal(request.url,'https://gateway.example/v1/web/search');assert.equal(request.init.redirect,'error');assert.equal(request.init.headers.Authorization,'Bearer test-key');
});
test('original-page reading retains date provenance in the existing web_fetch shape',async()=>{
 const p=new GatewayFetchProvider({baseURL:'https://gateway.example',resolveKey:async()=>'test',fetcher:async()=>Response.json({url:'https://example.org/a',requested_url:'https://example.org/a',statusCode:200,title:'A',content:'Event happened in 2023.',content_source:'web_page',content_verified:true,facts_verified:false,dates:{published_at:'2024-01-01',modified_at:'2026-01-01',event_date:null,fetched_at:'2026-10-14T00:00:00Z'},date_provenance:{published_at:{status:'website_declared_not_fact_checked'}},body_date_mentions:[],cached:false,truncated:false})});
 const result=await p.fetch({url:'https://example.org/a'});assert.equal(result.body.kind,'text');assert.match(result.body.content,/2024-01-01/);assert.match(result.body.content,/2026-01-01/);assert.match(result.body.content,/不代表陈述真实/);assert.match(result.body.content,/Event happened in 2023/);
});
test('fetch failure never substitutes a search snippet as verified body',async()=>{
 const p=new GatewayFetchProvider({baseURL:'https://gateway.example',resolveKey:async()=>'test',fetcher:async()=>Response.json({url:'https://example.org/a',statusCode:404,content:'',content_source:'web_page',content_verified:false,facts_verified:false,dates:{event_date:null},truncated:false,error:{code:'FETCH_HTTP_STATUS'}})});
 const r=await p.fetch({url:'https://example.org/a'});assert.equal(r.statusCode,404);assert.match(r.body.content,/禁止声称验证成功/);assert.match(r.body.content,/"content_verified": false/);
});
test('a four-query tool batch respects the two-request gateway limit',async()=>{
 let active=0,peak=0;
 const p=new GatewaySearchProvider({baseURL:'https://gateway.example',resolveKey:async()=>'test',fetcher:async()=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;return Response.json({sources:[],truncated:false})}});
 const results=await Promise.all(['a','b','c','d'].map(query=>p.search({query})));assert.equal(peak,2);assert.equal(results.length,4);assert.equal(results[0].content,undefined);assert.deepEqual(results[0].sources,[]);
});
test('only meaningful failure status is added to normal search content',async()=>{
 const p=new GatewaySearchProvider({baseURL:'https://gateway.example',resolveKey:async()=>'test',fetcher:async()=>Response.json({sources:[{url:'https://example.org/',title:'Page'}],truncated:false,engineErrors:['engine: timeout']})});
 const r=await p.search({query:'Page'});assert.equal(r.content,'部分搜索源失败：engine: timeout');assert.doesNotMatch(r.content,/重要事实|web_fetch/);
});

test('Bilibili evidence is additional to a full ordinary source allowance and empty queries add no repeated notice',async()=>{
 const primary=Array.from({length:5},(_,i)=>({url:`https://example.org/${i}`,title:`Article ${i}`}));
 const supplementarySources=[1,2,3].map(i=>({url:`https://www.bilibili.com/video/BV000000000${i}/`,title:`Video ${i}`,snippet:'Creator description',snippet_source:'platform_search'}));
 const p=new GatewaySearchProvider({baseURL:'https://gateway.example',resolveKey:async()=>'test',fetcher:async()=>Response.json({sources:primary,supplementarySources,truncated:false})});
 const r=await p.search({query:'Aria 梗',maxResults:5});assert.equal(r.sources.length,5);assert.deepEqual(r.sources.map(x=>x.url),primary.map(x=>x.url));assert.match(r.content,/B站补充/);assert.match(r.content,/普通网页本次返回 5 条/);for(const s of supplementarySources)assert.ok(r.content.includes(s.url));assert.doesNotMatch(r.content,/未找到相关来源|未读取视频|没有观看|未核验/);
 const onlySupplement=new GatewaySearchProvider({baseURL:'https://gateway.example',resolveKey:async()=>'test',fetcher:async()=>Response.json({sources:[],supplementarySources,truncated:false})});
 const empty=await onlySupplement.search({query:'Aria 梗'});assert.deepEqual(empty.sources,[]);assert.match(empty.content,/普通网页本次返回 0 条/);assert.doesNotMatch(empty.content,/未找到相关来源/);
});

test('rejects malformed or oversized supplements rather than bypassing source validation',async()=>{
 for(const supplementarySources of [[{url:'https://evil.example/',title:'Video',snippet_source:'platform_search'}],Array.from({length:4},()=>({url:'https://www.bilibili.com/video/BV0000000001/',title:'Video',snippet_source:'platform_search'}))]){
  const p=new GatewaySearchProvider({baseURL:'https://gateway.example',resolveKey:async()=>'test',fetcher:async()=>Response.json({sources:[],supplementarySources,truncated:false})});
  await assert.rejects(p.search({query:'Aria 梗'}),{code:'WEB_PROVIDER_ERROR'});
 }
});
test('video fetch exposes page metadata and candidate links rather than claiming to read video contents',async()=>{
 const p=new GatewayFetchProvider({baseURL:'https://gateway.example',resolveKey:async()=>'test',fetcher:async()=>Response.json({url:'https://video.example/watch',statusCode:200,title:'Main video',content:'标题：Main video',content_verified:true,facts_verified:false,content_source:'web_page',page_kind:'video',extraction_method:'video_metadata',video_content_read:false,related_links:[{url:'https://video.example/other',text:'Related video'}],truncated:false})});
 const r=await p.fetch({url:'https://video.example/watch'});assert.match(r.body.content,/视频标题\/作者简介/);assert.match(r.body.content,/"content_source": "web_page"/);assert.match(r.body.content,/https:\/\/video.example\/other/);assert.match(r.body.content,/视频、音频和字幕未读取/);assert.match(r.body.content,/"video_content_read": false/);assert.doesNotMatch(r.body.content,/正文（来源 web_page）/);
});
test('labels Bilibili search descriptions and API video metadata with their actual sources',async()=>{
 const p=new GatewaySearchProvider({baseURL:'https://gateway.example',resolveKey:async()=>'test',fetcher:async()=>Response.json({sources:[{url:'https://www.bilibili.com/video/BV0000000001/',title:'Game video',snippet:'Creator description',snippet_source:'platform_search',engines:['bilibili'],platform_metadata:{author:'Creator'}}],truncated:false})});
 const r=await p.search({query:'Game video'});assert.equal(r.content,undefined);assert.match(r.sources[0].snippet,/B站站内搜索/);assert.match(r.sources[0].snippet,/Creator description/);
 const fetcher=new GatewayFetchProvider({baseURL:'https://gateway.example',resolveKey:async()=>'test',fetcher:async()=>Response.json({url:'https://www.bilibili.com/video/BV0000000001/',statusCode:200,content:'标题：Current\n简介：Description',content_verified:true,content_source:'platform_api',page_kind:'video',video_content_read:false,extraction_method:'bilibili_api',retrieved_from:['https://api.bilibili.com/x/web-interface/view?bvid=BV0000000001'],related_links:[],truncated:false})});
 const v=await fetcher.fetch({url:'https://www.bilibili.com/video/BV0000000001/'});assert.match(v.body.content,/平台视频信息读取记录/);assert.match(v.body.content,/"content_source": "platform_api"/);assert.match(v.body.content,/视频标题\/作者简介/);assert.match(v.body.content,/"video_content_read": false/);
});
test('fails missing credentials before networking and surfaces gateway errors',async()=>{
 const missing=new GatewaySearchProvider({baseURL:'https://gateway.example',resolveKey:async()=>undefined,fetcher:()=>assert.fail('must not fetch')});
 await assert.rejects(missing.search({query:'q'}),{code:'WEB_PROVIDER_CREDENTIAL_MISSING'});
 const failed=new GatewaySearchProvider({baseURL:'https://gateway.example',resolveKey:async()=>'test',fetcher:async()=>Response.json({error:{code:'SEARCH_BACKEND_BLOCKED',message:'verification'}},{status:502})});
 await assert.rejects(failed.search({query:'q'}),/SEARCH_BACKEND_BLOCKED/);
});
test('rejects invented malformed sources and cancellation',async()=>{
 const p=new GatewaySearchProvider({baseURL:'https://gateway.example',resolveKey:async()=>'test',fetcher:async()=>Response.json({sources:[{url:'javascript:bad',title:'bad'}],truncated:false})});
 await assert.rejects(p.search({query:'q'}),{code:'WEB_PROVIDER_ERROR'});
 const c=new AbortController();c.abort();await assert.rejects(p.search({query:'q'},c.signal),{code:'WEB_ABORTED'});
});
test('date, version, comparison and parameter queries only search; the caller chooses pages to fetch',async()=>{
 const requests=[];
 const p=new GatewaySearchProvider({baseURL:'https://gateway.example',resolveKey:async()=>'test',fetcher:async(url,init)=>{requests.push({url,body:JSON.parse(init.body)});return Response.json({sources:[{url:'https://example.org/blog',title:'Blog',snippet:'Search snippet'}],truncated:false});}});
 for(const query of ['发布日期','Product V3.2 release date','V3 vs V4','NumPy reshape -1 meaning']){
  const before=requests.length,r=await p.search({query,maxResults:5});
  assert.equal(requests.length,before+1);assert.deepEqual(requests.at(-1),{url:'https://gateway.example/v1/web/search',body:{query,maxResults:5}});
  assert.equal(r.content,undefined);assert.match(r.sources[0].snippet,/原文未读取/);
 }
});
test('search preserves source order and never promotes legacy research bodies or warnings',async()=>{
 const sources=[{url:'https://example.org/second',title:'Second',snippet:'Search B'},{url:'https://example.org/first',title:'First',snippet:'Search A'}];
 const p=new GatewaySearchProvider({baseURL:'https://gateway.example',resolveKey:async()=>'test',fetcher:async()=>Response.json({sources,truncated:false,research:{mode:'deep',incomplete:true,warnings:['RESEARCH_DEADLINE'],evidence:[{url:'https://example.org/new',content:'Legacy body'}]}})});
 const r=await p.search({query:'Product V3.2 release date'});assert.deepEqual(r.sources.map(x=>x.url),sources.map(x=>x.url));assert.equal(r.content,undefined);assert.ok(r.sources.every(x=>!x.snippet.includes('Legacy body')));
});
