import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,webcrypto} from 'node:crypto';
import bridge from './worker.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;

const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk=publicKey.export({format:'jwk'});
const issuer='https://integration.cloudflareaccess.com',aud='f'.repeat(64);
const base='https://doc-staging.example.workers.dev';
const token='S'.repeat(48);
const hash='a'.repeat(64);
const info={OMDA_ACCESS_AUD:aud,OMDA_ACCESS_ISS:issuer,
 OMDA_OWNER_EMAIL:'owner@example.com',OMDA_DOC_RUNNER_TOKEN:token};
const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function jwt(){
 const n=Math.floor(Date.now()/1000),h=enc({alg:'RS256',kid:'test-key'}),p=enc({
  iss:issuer,aud:[aud],email:'owner@example.com',iat:n-5,exp:n+100
 });
 return h+'.'+p+'.'+sign('RSA-SHA256',Buffer.from(h+'.'+p),privateKey).toString('base64url');
}
function scene(file){
 return {drive_file_id:file,drive_sha256:hash,duration_seconds:1,
  place_name:'Verified test location',source_url:'https://example.com/footage',
  license:'CC0-1.0',license_evidence_url:'https://example.com/rights',
  location_verification_url:'https://example.com/geography',
  narration_text:'هذا نص اختباري وهمي للمونتاج'};
}
function job(){
 return {job_id:'germanytest001',idempotency_key:'germanyunique2026',
  folder_id:'11GaLY8grDizEbpsHBxwieOobg5KDRvZ2',title:'Germany staging pilot',
  country:'Germany',language:'ar',duration_seconds:2,provider_policy:'FREE_ONLY',
  publish_intent:false,narration:{drive_file_id:'narration001',drive_sha256:hash},
  scenes:[scene('scene00001'),scene('scene00002')]}
}
function request(path,method='GET',body){
 const headers={'Cf-Access-Jwt-Assertion':jwt()};
 if(method==='POST'){headers.origin=base;headers['content-type']='application/json'}
 return new Request(base+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
}
const answer=(data,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json'}
});

class MemoryD1{
 constructor(){this.records=new Map()}
 prepare(sql){
  return {
    all:async()=>({results:[...this.records.values()].map(x=>({...x})).slice(0,30)}),
    bind:(...p)=>({
      first:async()=>{
        if(sql.includes('request_key=?'))
          return [...this.records.values()].find(x=>x.request_key===p[0])||null;
        if(sql.includes('job_id=?'))return this.records.get(p[0])||null;
        throw Error('Unexpected query');
      },
      run:async()=>{
        if(sql.startsWith('INSERT OR IGNORE')){
          const [id,key,digest,title,country,duration,state,created,updated]=p;
          if(this.records.has(id)||[...this.records.values()].some(x=>x.request_key===key))
            return {meta:{changes:0}};
          this.records.set(id,{job_id:id,request_key:key,fingerprint:digest,title,country,
           duration_seconds:duration,state,remote_job_id:null,error_code:null,
           created_at:created,updated_at:updated});
          return {meta:{changes:1}};
        }
        if(sql.startsWith('UPDATE documentary_jobs')){
          const [state,remote,error,updated,id]=p,prev=this.records.get(id);
          if(!prev)return {meta:{changes:0}};
          prev.state=state;prev.remote_job_id=remote||prev.remote_job_id;
          prev.error_code=error;prev.updated_at=updated;return {meta:{changes:1}};
        }
        throw Error('Unexpected D1 mutation');
      }
    })
  }
 }
}
function createEnvironment(fn,db){
 const env={...info,OMDA_DOC_DB:db};
 const hits=[];
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(u,opts)=>{
  if(String(u)===issuer+'/cdn-cgi/access/certs')
    return answer({keys:[{...jwk,kid:'test-key',use:'sig',alg:'RS256'}]});
  hits.push({url:String(u),method:opts?.method,authorization:opts?.headers?.authorization});
  return fn(u,opts);
 };
 return {env,hits,restore:()=>{globalThis.fetch=originalFetch}};
}

test('mock signed Cloudflare -> Render -> persistent D1 -> status + idempotency',async()=>{
 const db=new MemoryD1();
 let remoteState='QUEUED',submits=0;
 const e=createEnvironment((u,opts)=>{
   if(u.toString().endsWith('/v1/documentaries')&&opts.method==='POST'){
     submits++;
     const sent=JSON.parse(opts.body);
     assert.equal(sent.provider_policy,'FREE_ONLY');assert.equal(sent.publish_intent,false);
     return answer({job_id:sent.job_id,state:'QUEUED',published:false},202);
   }
   if(u.toString().endsWith('/v1/documentaries/germanytest001'))
     return answer({job_id:'germanytest001',state:remoteState,published:false});
   throw Error('Unexpected downstream URL');
 },db);
 try{
   const first=await bridge.fetch(request('/api/jobs','POST',job()),e.env,{});
   assert.equal(first.status,202);
   assert.equal((await first.json()).state,'QUEUED');
   assert.equal(db.records.size,1);assert.equal(submits,1);
   assert.equal(db.records.get('germanytest001').state,'QUEUED');

   const again=await bridge.fetch(request('/api/jobs','POST',job()),e.env,{});
   assert.equal(again.status,200);
   assert.equal((await again.json()).existing,true);
   assert.equal(submits,1);

   remoteState='RENDERING';
   const status=await bridge.fetch(request('/api/jobs/germanytest001'),e.env,{});
   assert.equal(status.status,200);
   assert.equal((await status.json()).state,'RENDERING');
   assert.equal(db.records.get('germanytest001').state,'RENDERING');

   const list=await bridge.fetch(request('/api/queue'),e.env,{});
   const body=await list.json();
   assert.equal(body.jobs.length,1);
   assert.equal(body.jobs[0].state,'RENDERING');
   assert.ok(e.hits.every(x=>x.authorization==='Bearer '+token));
 }finally{e.restore()}
});

test('failed downstream dispatch persists blocked record without retrying unsafely',async()=>{
 const db=new MemoryD1();
 let dispatched=0;
 const e=createEnvironment((u,opts)=>{
   if(opts?.method==='POST'){dispatched++;return answer({detail:'not configured'},503)}
   throw Error('Unexpected network');
 },db);
 try{
   const a=await bridge.fetch(request('/api/jobs','POST',job()),e.env,{});
   assert.equal(a.status,503);
   assert.equal(db.records.get('germanytest001').state,'DISPATCH_BLOCKED');
   const b=await bridge.fetch(request('/api/jobs','POST',job()),e.env,{});
   assert.equal(b.status,200);
   assert.equal((await b.json()).state,'DISPATCH_BLOCKED');
   assert.equal(dispatched,1);
 }finally{e.restore()}
});

test('conflicting payload does not dispatch twice',async()=>{
 const db=new MemoryD1(),e=createEnvironment((u,opts)=>{
  if(opts?.method==='POST')return answer({job_id:'germanytest001',state:'QUEUED'},202);
  throw Error('Unexpected network');
 },db);
 try{
   assert.equal((await bridge.fetch(request('/api/jobs','POST',job()),e.env,{})).status,202);
   const bad=job();bad.title='Altered documentary';
   const conflict=await bridge.fetch(request('/api/jobs','POST',bad),e.env,{});
   assert.equal(conflict.status,409);
   assert.equal((await conflict.json()).error,'IDEMPOTENCY_CONFLICT');
 }finally{e.restore()}
});
