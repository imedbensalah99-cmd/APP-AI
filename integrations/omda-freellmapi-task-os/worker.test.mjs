import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {d1} from './sqlite-d1.test-helper.mjs';
import {createTaskApi} from './worker.mjs';
import {accessConfig,createAccessVerifier} from './access.mjs';

const issuer='https://test-team.cloudflareaccess.com';
const audience='omda-task-test-audience';
const origin='https://private.example.test';
const baseEnv={OMDA_API_ENABLED:'true',OMDA_ACCESS_ISSUER:issuer,
  OMDA_ACCESS_AUD:audience,OMDA_OWNER_EMAIL:'owner@example.test',
  OMDA_ALLOWED_ORIGIN:origin};
const rsa=await crypto.subtle.generateKey(
  {name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},
  true,['sign','verify']);
const pub=await crypto.subtle.exportKey('jwk',rsa.publicKey);
Object.assign(pub,{kid:'test-key-1',alg:'RS256',use:'sig'});
const rawBase64=(b)=>Buffer.from(b).toString('base64url');
const jwtPart=(x)=>rawBase64(JSON.stringify(x));
async function sign(payload={},header={}){
  const now=Math.floor(Date.now()/1000);
  const head=jwtPart({alg:'RS256',kid:'test-key-1',typ:'JWT',...header});
  const body=jwtPart({iss:issuer,aud:audience,exp:now+1800,iat:now-5,
    email:'owner@example.test',sub:'access-user-0001',...payload});
  const source=head+'.'+body;
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',rsa.privateKey,new TextEncoder().encode(source));
  return source+'.'+rawBase64(new Uint8Array(signature));
}
const secureVerifier=createAccessVerifier({
  getJwks:async url=>{
    assert.equal(url,issuer+'/cdn-cgi/access/certs');
    return Response.json({keys:[pub]});
  }
});
const handler=createTaskApi({verifyAccess:secureVerifier});
async function fixture(file=':memory:',init=true){
  const db=d1(file,init),env={...baseEnv,TASK_DB:db},token=await sign();
  const req=(path,{method='GET',headers={},body,auth=token}={})=>{
    const hs=new Headers({...headers});
    if(auth)hs.set('cf-access-jwt-assertion',auth);
    if(method==='POST')hs.set('origin',origin);
    if(body!==undefined)hs.set('content-type','application/json');
    return new Request(origin+path,{method,headers:hs,body:body===undefined?undefined:JSON.stringify(body)});
  };
  return {db,env,token,req,call:(path,opts)=>handler.fetch(req(path,opts),env)};
}
async function add(f,key='task-idempotency-01',command='اعمل لي جدول إكسل و مسودة إيميل'){
  const r=await f.call('/api/tasks',{method:'POST',headers:{'idempotency-key':key},
    body:{command}});
  return {res:r,data:await r.json()};
}
test('fail-closed configuration and cryptographically signed Access identity',async()=>{
  const f=await fixture();
  assert.equal(accessConfig({...baseEnv,OMDA_API_ENABLED:'false'}),null);
  assert.equal(accessConfig({...baseEnv,OMDA_ACCESS_ISSUER:'https://evil.com'}),null);
  assert.equal((await handler.fetch(f.req('/api/me'),{...f.env,OMDA_API_ENABLED:'false'})).status,503);
  assert.equal((await f.call('/api/me',{auth:null})).status,401);
  assert.equal((await f.call('/api/me',{auth:'made.up.invalid'})).status,401);
  assert.equal((await f.call('/api/me',{auth:await sign({aud:'another-application'})})).status,401);
  assert.equal((await f.call('/api/me',{auth:await sign({email:'intruder@example.test'})})).status,401);
  assert.equal((await f.call('/api/me',{auth:await sign({exp:1})})).status,401);
  assert.equal((await f.call('/api/me',{auth:await sign({}, {alg:'none'})})).status,401);
  const invalid=(await sign()).replace(/.$/,'x');
  assert.equal((await f.call('/api/me',{auth:invalid})).status,401);
  assert.equal((await f.call('/api/me')).status,200);
  const body=await (await f.call('/api/me')).json();
  assert.equal(body.project,'omda-freellmapi-agents');
  assert.ok(!(await f.call('/api/me')).headers.get('access-control-allow-origin'));
  f.db.close();
});
test('real SQL create/read/list with stable owner, dedup, audit and exact payload binding',async()=>{
  const f=await fixture();
  const x=await add(f);
  assert.equal(x.res.status,201);
  assert.equal(x.data.task.status,'PLANNED');
  assert.deepEqual(x.data.task.intents,['spreadsheet','email']);
  assert.deepEqual(x.data.executedActions,[]);
  const id=x.data.task.id;
  assert.ok(id && x.data.task.version===1);
  const dup=await add(f);
  assert.equal(dup.res.status,200);
  assert.equal(dup.data.task.id,id);
  const conflict=await add(f,'task-idempotency-01','Create a different spreadsheet');
  assert.equal(conflict.res.status,409);
  const rows=f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM omda_task_tasks').get();
  const audit=f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM omda_task_audit').get();
  assert.equal(rows.n,1);assert.equal(audit.n,1);
  assert.equal((await f.call('/api/tasks/'+id)).status,200);
  const listed=await (await f.call('/api/tasks')).json();
  assert.equal(listed.tasks.length,1);
  assert.equal(listed.tasks[0].id,id);
  assert.equal((await f.call('/api/tasks/not-a-uuid')).status,404);
  f.db.close();
});
test('strict Origin and bounded JSON, unrecognized fields and no CORS reflection',async()=>{
  const f=await fixture();
  const r=f.req('/api/tasks',{method:'POST',headers:{'idempotency-key':'task-idempotency-02'},
    body:{command:'Create excel sheet'}});
  r.headers.set('origin','https://evil.example.test');
  assert.equal((await handler.fetch(r,f.env)).status,403);
  assert.equal((await f.call('/api/tasks',{method:'POST',body:{command:'Create excel sheet'}})).status,400);
  assert.equal((await f.call('/api/tasks',{method:'POST',headers:{'idempotency-key':'task-idempotency-03'},body:{command:'Create excel sheet',externalSend:true}})).status,400);
  assert.equal((await f.call('/api/tasks',{method:'POST',headers:{'idempotency-key':'task-idempotency-04'},body:{command:'x'.repeat(9000)}})).status,400);
  assert.equal((await f.call('/api/tasks',{method:'DELETE'})).status,405);
  assert.equal((await f.call('/api/tasks?debug=1')).status,400);
  f.db.close();
});
test('versioned pause/resume/cancel with atomic audit and stale version refusal',async()=>{
  const f=await fixture();
  const id=(await add(f,'task-idempotency-05')).data.task.id;
  assert.equal((await f.call('/api/tasks/'+id+'/pause',{method:'POST'})).status,428);
  let res=await f.call('/api/tasks/'+id+'/pause',{method:'POST',headers:{'if-match':'"v1"'}});
  assert.equal(res.status,200);
  assert.equal(res.headers.get('etag'),'"v2"');
  assert.equal((await res.json()).task.status,'PAUSED');
  assert.equal((await f.call('/api/tasks/'+id+'/pause',{method:'POST',headers:{'if-match':'"v1"'}})).status,412);
  res=await f.call('/api/tasks/'+id+'/resume',{method:'POST',headers:{'if-match':'"v2"'}});
  assert.equal(res.status,200);
  assert.equal((await res.json()).task.status,'PLANNED');
  res=await f.call('/api/tasks/'+id+'/cancel',{method:'POST',headers:{'if-match':'"v3"'}});
  assert.equal(res.status,200);
  assert.equal((await res.json()).task.status,'CANCELED');
  assert.equal((await f.call('/api/tasks/'+id+'/cancel',{method:'POST',headers:{'if-match':'"v4"'}})).status,409);
  const events=await (await f.call('/api/tasks/'+id+'/events')).json();
  assert.equal(events.events.length,4);
  assert.equal(events.events.filter(e=>e.type==='task.pause').length,1);
  f.db.close();
});
test('running cancellation is a REQUEST, never a false stopped/complete state',async()=>{
  const f=await fixture();
  const id=(await add(f,'task-idempotency-06')).data.task.id;
  f.db.sqlite.prepare("UPDATE omda_task_tasks SET status='RUNNING' WHERE task_id=?").run(id);
  const r=await f.call('/api/tasks/'+id+'/cancel',{method:'POST',headers:{'if-match':'"v1"'}});
  assert.equal(r.status,202);
  const b=await r.json();
  assert.equal(b.task.status,'RUNNING');
  assert.equal(b.task.cancelRequested,true);
  assert.ok(b.note.includes('acknowledgement'));
  f.db.close();
});
test('signed user B cannot list, mutate or inspect another owner task',async()=>{
  const f=await fixture();
  const id=(await add(f,'task-idempotency-07')).data.task.id;
  const envB={...f.env,OMDA_OWNER_EMAIL:'other@example.test'};
  const tokenB=await sign({email:'other@example.test',sub:'access-user-0002'});
  const get=(path,method='GET',headers={})=>
    handler.fetch(f.req(path,{method,headers,auth:tokenB}),envB);
  const listed=await (await get('/api/tasks')).json();
  assert.equal(listed.tasks.length,0);
  assert.equal((await get('/api/tasks/'+id)).status,404);
  assert.equal((await get('/api/tasks/'+id+'/events')).status,404);
  assert.equal((await get('/api/tasks/'+id+'/cancel','POST',{'if-match':'"v1"'})).status,404);
  f.db.close();
});
test('real SQLite state persists across new API instances and process-level DB reopen',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'omda-task-sqlite-'));
  const file=join(dir,'tasks.sqlite');
  try{
    const f=await fixture(file);
    const id=(await add(f,'task-idempotency-08')).data.task.id;
    f.db.close();
    const reopened=await fixture(file,false);
    const res=await reopened.call('/api/tasks/'+id);
    assert.equal(res.status,200);
    assert.equal((await res.json()).task.id,id);
    reopened.db.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('parallel posts same key are deduplicated by transactional unique constraint',async()=>{
  const f=await fixture();
  const requests=[0,1].map(()=>add(f,'parallel-create-09','Make a website with home page'));
  const results=await Promise.all(requests);
  assert.deepEqual(results.map(x=>x.res.status).sort(),[200,201]);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM omda_task_tasks').get().n,1);
  f.db.close();
});
