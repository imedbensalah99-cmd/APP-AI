import test from 'node:test';
import assert from 'node:assert/strict';
import worker,{check,run,classify} from './worker.mjs';
function mockDb(){
  const rows=[];
  return {rows, prepare(sql){
    let args=[];
    return {bind(...values){args=values;return this},async run(){
      if(sql.startsWith('INSERT INTO agent_checks'))rows.push({id:args[0],created_at:args[1],health_http:args[2],model_http:args[3],verdict:args[4]});
      else if(sql.startsWith('DELETE FROM agent_checks')){rows.sort((a,b)=>b.created_at.localeCompare(a.created_at));rows.splice(args[0]);}
      else throw Error('Unexpected SQL');
    }}},
    async batch(items){for(const x of items) await x.run();}
  };
}
test('only 2 allowlisted anonymous GET calls; no prompts or provider secrets',async()=>{
 const calls=[];
 const fake=async(url,opts)=>{calls.push({url,opts});return {status:url.endsWith('/api/ping')?200:403};};
 const x=await check(fake);
 assert.deepEqual(x,{healthCode:200,modelsCode:403,state:'PERIMETER_OK'});
 assert.deepEqual(calls.map(x=>new URL(x.url).pathname),['/api/ping','/v1/models']);
 for(const x of calls){
  assert.equal(x.opts.method,'GET');assert.equal(x.opts.redirect,'manual');assert.equal(x.opts.credentials,'omit');
  assert.equal(x.opts.body,undefined);assert.equal(x.opts.headers.Authorization,undefined);
  assert.equal(new URL(x.url).hostname,'omda-freellmapi-secure-staging-v1.onrender.com');
 }
});
test('fail closed if origin authorization is accidentally open',async()=>{
 assert.equal(classify(200,200),'ORIGIN_GATE_OPEN');
 const x=await check(async()=>({status:200}));assert.equal(x.state,'ORIGIN_GATE_OPEN');
});
test('fail closed when health route is not healthy or network times out',async()=>{
 assert.equal((await check(async(url)=>({status:url.endsWith('/api/ping')?503:403}))).state,'PERIMETER_NOT_READY');
 assert.equal((await check(async()=>{throw Error('timeout')})).state,'NETWORK_UNAVAILABLE');
});
test('record only status codes, zero secrets and bounded last 30 checks',async()=>{
 const db=mockDb(),env={CHECK_DB:db};
 for(let i=0;i<34;i++) {
  const out=await run(env,async url=>({status:url.endsWith('/api/ping')?200:403}),()=>new Date(Date.UTC(2026,10,2,0,i)).toISOString());
  assert.equal(out.agentInferenceAllowed,false);
  assert.equal(out.paidAllowed,false);
  assert.equal(out.publishAllowed,false);
 }
 assert.equal(db.rows.length,30);
 assert.ok(db.rows.every(r=>r.verdict==='PERIMETER_OK'));
 assert.ok(db.rows.every(r=>Object.keys(r).join(',')==='id,created_at,health_http,model_http,verdict'));
});
test('public Worker route is unavailable and scheduled checks never return content',async()=>{
 const res=await worker.fetch(new Request('https://example.invalid/'));assert.equal(res.status,404);
 assert.equal(res.headers.get('Cache-Control'),'no-store');
 let task;const db=mockDb();
 const prior=globalThis.fetch;
 globalThis.fetch=async url=>({status:url.endsWith('/api/ping')?200:403});
 try {
   const fn=worker.scheduled({},{CHECK_DB:db},{waitUntil(p){task=p;}});
   await task;await fn;
 } finally {globalThis.fetch=prior;}
 assert.equal(db.rows.length,1);
});
test('no changes to OMDA Director, billing or publishing APIs',async()=>{
 const fs=await import('node:fs');
 const code=fs.readFileSync(new URL('./worker.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(code,/['"]POST['"]|['"]PUT['"]|['"]PATCH['"]|\/chat\/completions|\/v1\/responses|\/agents\/run/);
});
