import test from 'node:test';
import assert from 'node:assert/strict';
import bridge from './worker.mjs';

const env={OMDA_OWNER_EMAIL:'owner@example.com',OMDA_DOC_RUNNER_TOKEN:'T'.repeat(48)};
const goodCtx={access:{getIdentity:async()=>({email:'owner@example.com'})}};
const noCtx={};
const endpoint='https://omda-documentary-bridge-staging.example.workers.dev';
const req=(path,method='GET',data,origin=endpoint)=>new Request(endpoint+path,{
 method,headers:{...(method==='POST'?{'content-type':'application/json',origin}:{} )},
 ...(data!==undefined?{body:JSON.stringify(data)}:{})
});
const ref={drive_file_id:'file123456789',drive_sha256:'b'.repeat(64)};
function sample(){
 const scene={...ref,duration_seconds:1,place_name:'Germany test place',
  source_url:'https://example.com/original',license:'CC0-1.0',
  license_evidence_url:'https://example.com/license',
  location_verification_url:'https://example.com/location',
  narration_text:'فيديو تجريبي موثق للاختبار فقط'};
 return {job_id:'germanypilot0001',idempotency_key:'germanypilot2026',
  folder_id:'11GaLY8grDizEbpsHBxwieOobg5KDRvZ2',title:'Germany documentary',
  country:'Germany',language:'ar',provider_policy:'FREE_ONLY',publish_intent:false,
  duration_seconds:2,narration:ref,scenes:[{...scene},{...scene}]};
}
const json=async r=>JSON.parse(await r.text());
const okResponse=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});

test('anonymous and wrong Access identity denied before any fetch',async()=>{
 const old=globalThis.fetch;let count=0;globalThis.fetch=async()=>{count++;throw Error('network should not happen')};
 try{
  let r=await bridge.fetch(req('/api/status'),env,noCtx);
  assert.equal(r.status,403);
  r=await bridge.fetch(req('/api/status'),env,{access:{getIdentity:async()=>({email:'outsider@example.com'})}});
  assert.equal(r.status,403);
  r=await bridge.fetch(req('/api/status'),{...env,OMDA_OWNER_EMAIL:''},goodCtx);
  assert.equal(r.status,403);
  assert.equal(count,0);
 }finally{globalThis.fetch=old}
});
test('runner secret missing fails closed',async()=>{
 const r=await bridge.fetch(req('/api/status'),{OMDA_OWNER_EMAIL:env.OMDA_OWNER_EMAIL},goodCtx);
 assert.equal(r.status,503);
 assert.equal((await json(r)).error,'BRIDGE_SECRET_NOT_CONFIGURED');
});
test('denies cross-origin POST, paid requests and missing rights before network',async()=>{
 const old=globalThis.fetch;let count=0;globalThis.fetch=async()=>{count++;throw Error('unexpected network')};
 try{
  let r=await bridge.fetch(req('/api/jobs','POST',sample(),'https://evil.example'),env,goodCtx);
  assert.equal(r.status,403);
  const paid=sample();paid.provider_policy='GOOGLE_FLOW';
  r=await bridge.fetch(req('/api/jobs','POST',paid),env,goodCtx);
  assert.equal(r.status,400);
  const publish=sample();publish.publish_intent=true;
  r=await bridge.fetch(req('/api/jobs','POST',publish),env,goodCtx);
  assert.equal(r.status,400);
  const bad=sample();delete bad.scenes[0].license_evidence_url;
  r=await bridge.fetch(req('/api/jobs','POST',bad),env,goodCtx);
  assert.equal(r.status,400);
  const unknown=sample();unknown.provider_key='secret';
  r=await bridge.fetch(req('/api/jobs','POST',unknown),env,goodCtx);
  assert.equal(r.status,400);
  assert.equal(count,0);
 }finally{globalThis.fetch=old}
});
test('health is public, sanitized and read-only',async()=>{
 const old=globalThis.fetch;let called=0;globalThis.fetch=async (url,options)=>{
  called++;assert.equal(String(url),'https://omda-documentary-runner-staging.onrender.com/health');
  assert.equal(options.redirect,'manual');
  return okResponse({status:'AVAILABLE',storage:'DRIVE_OAUTH_REQUIRED',private_token:'never-forward'});
 };
 try{
  const r=await bridge.fetch(req('/health'),env,noCtx);
  const d=await json(r);
  assert.equal(r.status,200);assert.equal(d.upstream_online,true);assert.equal(d.render_status,'AVAILABLE');
  assert.equal(d.publishing,false);assert.equal(d.paid_generation,false);
  assert.equal('private_token' in d,false);
  assert.equal(called,1);
 }finally{globalThis.fetch=old}
});
test('authenticated Render probe uses server bearer and no job mutation',async()=>{
 const old=globalThis.fetch;let count=0;globalThis.fetch=async (url,opts)=>{
  count++;assert.match(String(url),/\/v1\/documentaries\/omdabridgeprobe0001$/);
  assert.equal(opts.headers.authorization,'Bearer '+env.OMDA_DOC_RUNNER_TOKEN);
  assert.equal(opts.method,'GET');
  return okResponse({detail:'JOB_NOT_FOUND'},404);
 };
 try{
  const r=await bridge.fetch(req('/api/status'),env,goodCtx);
  const d=await json(r);
  assert.equal(d.render_authenticated,true);
  assert.equal(d.render_api_status,'AUTHENTICATED');
  assert.equal(count,1);
 }finally{globalThis.fetch=old}
});
test('job POST forwards only free validated payload and no owner token',async()=>{
 const old=globalThis.fetch;let count=0;globalThis.fetch=async(url,opts)=>{
  count++;assert.equal(String(url),'https://omda-documentary-runner-staging.onrender.com/v1/documentaries');
  assert.equal(opts.method,'POST');
  assert.equal(opts.headers.authorization,'Bearer '+env.OMDA_DOC_RUNNER_TOKEN);
  const forwarded=JSON.parse(opts.body);
  assert.equal(forwarded.provider_policy,'FREE_ONLY');assert.equal(forwarded.publish_intent,false);
  assert.equal(forwarded.scenes.length,2);
  assert.equal(forwarded.country,'Germany');
  assert.equal('OMDA_DOC_RUNNER_TOKEN' in forwarded,false);
  return okResponse({job_id:forwarded.job_id,state:'QUEUED',published:false},202);
 };
 try{
  const r=await bridge.fetch(req('/api/jobs','POST',sample()),env,goodCtx);
  assert.equal(r.status,202);
  const d=await json(r);assert.equal(d.job_id,'germanypilot0001');
  assert.equal(d.published,false);assert.equal(count,1);
 }finally{globalThis.fetch=old}
});
test('status GET and upstream auth errors redacted',async()=>{
 const old=globalThis.fetch;let count=0;globalThis.fetch=async(url,opts)=>{
  count++;
  assert.match(String(url),/\/v1\/documentaries\/germanypilot0001$/);
  return okResponse({detail:'wrong secret',token:'sensitive'},401);
 };
 try{
  const r=await bridge.fetch(req('/api/jobs/germanypilot0001'),env,goodCtx);
  assert.equal(r.status,502);assert.deepEqual(await json(r),{error:'RENDER_AUTH_REJECTED'});
  assert.equal(count,1);
 }finally{globalThis.fetch=old}
});
test('malformed and publish routes are absent',async()=>{
 for(const path of ['/api/publish','/api/billing','/api/jobs/../../publish']){
  let r=await bridge.fetch(req(path),env,goodCtx);
  assert.equal(r.status,404);
 }
});
