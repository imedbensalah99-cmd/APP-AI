import test from 'node:test';
import assert from 'node:assert/strict';
import {run,ready,MODEL,ROUTE} from './worker.mjs';

const key='a'.repeat(64),bridgeKey='b'.repeat(64);
const url='https://internal.invalid'+ROUTE;
function env(){
 let calls=[];
 const bridge={fetch:async(url,init)=>{
  calls.push({url,init});
  return new Response(JSON.stringify({model:MODEL,answer:'OMDA_AGENT_BRIDGE_OK',staging:true}),{
   status:200,headers:{'content-type':'application/json'}
  });
 }};
 return {OMDA_PRIVATE_TEST_ENABLED:'true',OMDA_PRIVATE_TEST_TOKEN:key,
  OMDA_BRIDGE_TOKEN:bridgeKey,AGENT_BRIDGE:bridge,calls};
}
function make(task='Reply exactly OMDA_AGENT_BRIDGE_OK',opts={}){
 return new Request(url,{
  method:opts.method||'POST',
  headers:{authorization:opts.authorization||'Bearer '+key,
   'content-type':opts.contentType||'application/json'},
  body:opts.method==='GET'?undefined:JSON.stringify({task,...opts.extra})
 });
}
test('private runner is disabled by default, even with credentials',async()=>{
 const x=env();delete x.OMDA_PRIVATE_TEST_ENABLED;
 assert.equal(ready(x),false);
 assert.equal((await run(make(),x)).status,503);
 assert.equal(x.calls.length,0);
});
test('missing binding or credentials always blocks calls',async()=>{
 for(const field of ['OMDA_PRIVATE_TEST_TOKEN','OMDA_BRIDGE_TOKEN','AGENT_BRIDGE']){
  const x=env();delete x[field];assert.equal(ready(x),false);
  assert.equal((await run(make(),x)).status,503);
 }
});
test('wrong bearer, wrong method, wrong route do not reach private bridge',async()=>{
 const x=env();
 assert.equal((await run(make(undefined,{authorization:'Bearer '+'f'.repeat(64)}),x)).status,401);
 assert.equal((await run(new Request(url,{method:'GET'}),x)).status,405);
 assert.equal((await run(new Request('https://internal.invalid/nope',{method:'GET'}),x)).status,404);
 assert.equal(x.calls.length,0);
});
test('rejects extra fields, long task, bad body and content-type',async()=>{
 const x=env();
 assert.equal((await run(make('test',{extra:{model:'paid-model'}}),x)).status,400);
 assert.equal((await run(make('x'.repeat(161)),x)).status,400);
 assert.equal((await run(make('test',{contentType:'text/plain'}),x)).status,400);
 const invalid=new Request(url,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:'broken'});
 assert.equal((await run(invalid,x)).status,400);
 assert.equal(x.calls.length,0);
});
test('fixed internal service binding forwards exactly one bounded POST',async()=>{
 const x=env();const result=await run(make(),x);
 assert.equal(result.status,200);
 const v=await result.json();assert.deepEqual(v,{model:MODEL,answer:'OMDA_AGENT_BRIDGE_OK',staging:true});
 assert.equal(x.calls.length,1);
 assert.equal(x.calls[0].url,'https://agent.internal/agent/chat');
 assert.equal(x.calls[0].init.redirect,'manual');
 assert.equal(x.calls[0].init.method,'POST');
 assert.equal(x.calls[0].init.headers.authorization,'Bearer '+bridgeKey);
 assert.deepEqual(JSON.parse(x.calls[0].init.body),{task:'Reply exactly OMDA_AGENT_BRIDGE_OK'});
});
test('paid-model substitution and upstream failure return only sanitized errors',async()=>{
 const x=env();x.AGENT_BRIDGE.fetch=async()=>new Response(JSON.stringify({model:'paid-model',answer:'bad',staging:true}),{status:200});
 let r=await run(make(),x);assert.equal(r.status,502);assert.deepEqual(await r.json(),{error:'unexpected_response'});
 const y=env();y.AGENT_BRIDGE.fetch=async()=>new Response('internal secret',{status:401});
 r=await run(make(),y);assert.equal(r.status,502);
 assert.ok(!JSON.stringify(await r.json()).includes('internal secret'));
});
test('there are no provider calls, direct origin calls, media or cron in source',async()=>{
 const src=(await import('node:fs')).readFileSync(new URL('./worker.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(src,/onrender\\.com|api\\.groq\\.com|openai\\.com|scheduled\\s*\\(/);
 assert.match(src,/env\\.AGENT_BRIDGE\\.fetch/);
 assert.doesNotMatch(src,/publish|video generation|createPayment/i);
});
