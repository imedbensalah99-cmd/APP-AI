import test from 'node:test';
import assert from 'node:assert/strict';
import {handle,ready,MODEL} from './worker.mjs';
const bridge='b'.repeat(64),profile='sk-cp-'+'a'.repeat(48),origin='o'.repeat(64),url='https://omda.invalid/agent/chat';
const env=()=>({OMDA_AGENT_ENABLED:'true',OMDA_FREE_ONLY_CONFIRMED:'true',OMDA_PROVIDER_SCOPE:'groq:openai/gpt-oss-20b',OMDA_BRIDGE_TOKEN:bridge,OMDA_CLIENT_KEY:profile,OMDA_ORIGIN_TOKEN:origin,QUOTA_DB:fakeQuota()});
const make=(task='A simple test',token=bridge,method='POST')=>new Request(url,{method,headers:{'content-type':'application/json',authorization:'Bearer '+token},body:method==='POST'?JSON.stringify({task}):undefined});
function fakeQuota(){
 const records=new Map();
 return {records,prepare(sql){let args=[];return {bind(...x){args=x;return this},async first(){
  assert.match(sql,/ON CONFLICT\(day\)/);
  const [day,minute,maxDay,maxMinute]=args;
  const old=records.get(day);
  if(old&&old.daily_count>=maxDay)return undefined;
  if(old&&old.minute===minute&&old.minute_count>=maxMinute)return undefined;
  const next={minute,daily_count:(old?.daily_count||0)+1,minute_count:old?.minute===minute?old.minute_count+1:1};
  records.set(day,next);return next;
 }}}};
}
const success=async(_url,init)=>({status:200,headers:new Headers(),text:async()=>JSON.stringify({model:MODEL,choices:[{message:{content:'OK'}}]}),outbound:JSON.parse(init.body)});
test('defaults to OFF even with valid credentials unless all explicit gates present',async()=>{
 const x=env();delete x.OMDA_AGENT_ENABLED;
 let called=false;
 const res=await handle(make(),x,async()=>{called=true;throw Error('should not call')});
 assert.equal(res.status,503);assert.equal(called,false);assert.equal(x.QUOTA_DB.records.size,0);
});
test('does not open when profile key, origin token, provider lock or other secrets are missing',async()=>{
 for(const prop of ['OMDA_BRIDGE_TOKEN','OMDA_CLIENT_KEY','OMDA_ORIGIN_TOKEN','OMDA_FREE_ONLY_CONFIRMED','OMDA_PROVIDER_SCOPE','QUOTA_DB']){
  const x=env();delete x[prop];assert.equal(ready(x),false,prop);
  assert.equal((await handle(make(),x,async()=>{throw Error('not allowed')})).status,503);
 }
});
test('unauthorized, unknown routes, unexpected methods, and overlong tasks make no provider call',async()=>{
 const x=env();let called=0;const fetcher=async()=>{called++;throw Error('unexpected')};
 assert.equal((await handle(make('hello','c'.repeat(64)),x,fetcher)).status,401);
 assert.equal((await handle(new Request('https://omda.invalid/health'),x,fetcher)).status,404);
 assert.equal((await handle(new Request(url),x,fetcher)).status,405);
 assert.equal((await handle(make('x'.repeat(1001)),x,fetcher)).status,400);
 assert.equal(called,0);assert.equal(x.QUOTA_DB.records.size,0);
});
test('exact one pinned model, bounded output, no tools or streaming, and no user-controlled URL',async()=>{
 const x=env();let call;
 const r=await handle(make('summarize this'),x,async(url,options)=>{call={url,options};return success(url,options)},()=>new Date('2026-11-02T11:00:00Z'));
 assert.equal(r.status,200);assert.equal((await r.json()).answer,'OK');
 const payload=JSON.parse(call.options.body);
 assert.equal(payload.model,'openai/gpt-oss-20b');assert.equal(payload.max_tokens,128);assert.equal(payload.stream,false);assert.equal(payload.tools,undefined);
 assert.equal(payload.messages[1].content,'summarize this');
 assert.equal(call.url,'https://omda-freellmapi-secure-staging-v1.onrender.com/v1/chat/completions');
 assert.equal(call.options.redirect,'manual');
});
test('minute quota blocks second call and day quota blocks eleventh even with new minutes',async()=>{
 const x=env();let calls=0;
 const fetcher=async(u,o)=>{calls++;return success(u,o)};
 assert.equal((await handle(make(),x,fetcher,()=>new Date('2026-11-02T11:00:00Z'))).status,200);
 assert.equal((await handle(make(),x,fetcher,()=>new Date('2026-11-02T11:00:30Z'))).status,429);
 for(let m=1;m<10;m++)assert.equal((await handle(make(),x,fetcher,()=>new Date(Date.UTC(2026,10,2,11,m)))).status,200);
 assert.equal((await handle(make(),x,fetcher,()=>new Date('2026-11-02T11:11:00Z'))).status,429);
 assert.equal(calls,10);
});
test('wrong upstream model and upstream failures fail closed',async()=>{
 const x=env();
 const wrong=async()=>({status:200,headers:new Headers(),text:async()=>JSON.stringify({model:'paid-model',choices:[{message:{content:'oops'}}]})});
 assert.equal((await handle(make(),x,wrong)).status,502);
 const x2=env();
 assert.equal((await handle(make(),x2,async()=>({status:403}))).status,502);
});

test('bad JSON, content type, extra fields, and oversized bodies fail before provider',async()=>{
 const x=env();let calls=0;const remote=async()=>{calls++;return success()};
 const bad=[
  new Request(url,{method:'POST',headers:{authorization:'Bearer '+bridge,'content-type':'text/plain'},body:'hello'}),
  new Request(url,{method:'POST',headers:{authorization:'Bearer '+bridge,'content-type':'application/json'},body:'{invalid'}),
  new Request(url,{method:'POST',headers:{authorization:'Bearer '+bridge,'content-type':'application/json'},body:JSON.stringify({task:'test',model:'paid-model'})}),
  new Request(url,{method:'POST',headers:{authorization:'Bearer '+bridge,'content-type':'application/json'},body:JSON.stringify({task:'x'.repeat(3000)})})
 ];
 for(const req of bad)assert.equal((await handle(req,x,remote)).status,400);
 assert.equal(calls,0);assert.equal(x.QUOTA_DB.records.size,0);
});
test('unknown routes and methods are rejected even with valid bearer',async()=>{
 const x=env();let calls=0;const remote=async()=>{calls++;return success()};
 for(const path of ['/agent/whoami','/agent/chat/extra','/api/ping'])
  assert.equal((await handle(new Request('https://omda.invalid'+path,{headers:{authorization:'Bearer '+bridge}}),x,remote)).status,404);
 assert.equal((await handle(new Request(url,{method:'GET',headers:{authorization:'Bearer '+bridge}}),x,remote)).status,405);
 assert.equal(calls,0);
});
test('redirects, oversized answers, absent answers or substituted models fail closed',async()=>{
 const cases=[
  async()=>({status:302}),
  async()=>({status:200,headers:new Headers({'content-length':'50000'}),text:async()=>String.fromCharCode(123) }),
  async()=>({status:200,headers:new Headers(),text:async()=>JSON.stringify({model:MODEL,choices:[{message:{}}]})}),
  async()=>({status:200,headers:new Headers(),text:async()=>JSON.stringify({model:'paid-model',choices:[{message:{content:'bad'}}]})})
 ];
 for(const remote of cases){const x=env();assert.equal((await handle(make(),x,remote)).status,502)}
});
test('daily quota and fixed nonpaid parameters survive 10 requests and block 11th',async()=>{
 const x=env();let calls=0;
 const remote=async(u,init)=>{
  calls++;assert.equal(u,'https://omda-freellmapi-secure-staging-v1.onrender.com/v1/chat/completions');
  const body=JSON.parse(init.body);
  assert.deepEqual(Object.keys(body).sort(),['max_tokens','messages','model','stream','temperature']);
  assert.equal(body.model,MODEL);assert.equal(body.max_tokens,128);
  assert.equal(body.stream,false);assert.equal(body.temperature,0.2);assert.equal(init.redirect,'manual');
  return success(u,init);
 };
 for(let m=0;m<10;m++)assert.equal((await handle(make(),x,remote,()=>new Date(Date.UTC(2026,10,2,12,m)))).status,200);
 assert.equal((await handle(make(),x,remote,()=>new Date('2026-11-02T13:00:00Z'))).status,429);
 assert.equal(calls,10);
});
