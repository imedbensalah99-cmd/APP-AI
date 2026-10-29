import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,webcrypto} from 'node:crypto';
import bridge from './worker.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const key=publicKey.export({format:'jwk'});
const issuer='https://testorg.cloudflareaccess.com', audience='a'.repeat(64);
const env={OMDA_OWNER_EMAIL:'owner@example.com',OMDA_ACCESS_ISS:issuer,
 OMDA_ACCESS_AUD:audience,OMDA_DOC_RUNNER_TOKEN:'T'.repeat(48)};
const uri='https://omda-documentary-bridge-staging.example.workers.dev';
function enc(s){return Buffer.from(typeof s==='string'?s:JSON.stringify(s)).toString('base64url')}
function jwt(overrides={}){
 const now=Math.floor(Date.now()/1000);
 const h=enc({alg:'RS256',kid:'test-1'}),p=enc({iss:issuer,aud:[audience],iat:now-5,exp:now+300,
  email:'owner@example.com',...overrides});
 return h+'.'+p+'.'+sign('RSA-SHA256',Buffer.from(h+'.'+p),privateKey).toString('base64url');
}
const ref={drive_file_id:'file123456789',drive_sha256:'a'.repeat(64)};
function sample(){
 const s={...ref,duration_seconds:1,place_name:'Germany pilot location',
  source_url:'https://example.org/source',license:'CC0-1.0',
  license_evidence_url:'https://example.org/licence',
  location_verification_url:'https://example.org/place',
  narration_text:'هذه جملة اختبارية للأفلام'};
 return {job_id:'germanypilot001',idempotency_key:'germanypilotkey01',
  folder_id:'11GaLY8grDizEbpsHBxwieOobg5KDRvZ2',country:'Germany',
  title:'German Alps pilot',language:'ar',duration_seconds:2,
  provider_policy:'FREE_ONLY',publish_intent:false,narration:ref,scenes:[s,s]};
}
const json=async r=>r.json();
function req(path,method='GET',payload,options={}){
 const headers={...(!options.anonymous?{'Cf-Access-Jwt-Assertion':jwt(options.claims)}:{}),
  ...(method==='POST'?{origin:options.origin||uri,'content-type':'application/json'}:{})};
 return new Request(uri+path,{method,headers,...(payload===undefined?{}:{body:JSON.stringify(payload)})});
}
function mock(handler){
 globalThis.fetch=async(url,opts)=>{
  if(String(url)===issuer+'/cdn-cgi/access/certs')
   return new Response(JSON.stringify({keys:[{...key,kid:'test-1',use:'sig',alg:'RS256'}]}),
    {status:200,headers:{'content-type':'application/json'}});
  return handler(url,opts);
 };
}
const ok=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{'content-type':'application/json'}});
const absent=()=>{throw Error('Unexpected Render fetch')};
test('unsigned, wrong-email, absent owner config all denied before Render',async()=>{
 mock(absent);
 let r=await bridge.fetch(req('/api/status','GET',undefined,{anonymous:true}),env,{});
 assert.equal(r.status,403);
 r=await bridge.fetch(req('/api/status','GET',undefined,{claims:{email:'attacker@example.com'}}),env,{});
 assert.equal(r.status,403);
 r=await bridge.fetch(req('/api/status'),{...env,OMDA_OWNER_EMAIL:''},{});
 assert.equal(r.status,403);
});
test('signed Cloudflare JWT authenticates the Render bridge with no shared secret',async()=>{
 mock((url,opts)=>{
  assert.equal(String(url),'https://omda-documentary-runner-staging.onrender.com/v1/auth/check');
  const token=opts.headers.authorization.slice(7);
  assert.equal(token.split('.').length,3);
  return ok({authenticated:true,method:'CLOUDFLARE_ACCESS_JWT',created_job:false});
 });
 const r=await bridge.fetch(req('/api/status'),{...env,OMDA_DOC_RUNNER_TOKEN:undefined},{});
 assert.equal(r.status,200);
 assert.equal((await json(r)).render_authenticated,true);
});
test('paid, publish, bad rights and foreign origin denied',async()=>{
 mock(absent);
 const cases=[(p)=>{p.provider_policy='FLOW'},
  p=>{p.publish_intent=true},p=>{p.scenes[0]={...p.scenes[0],license_evidence_url:''}},
  p=>{p.unexpected_secret='secret'}];
 for(const mutate of cases){
  const p=sample();mutate(p);
  const r=await bridge.fetch(req('/api/jobs','POST',p),env,{});
  assert.equal(r.status,400);
 }
 const r=await bridge.fetch(req('/api/jobs','POST',sample(),{origin:'https://evil.example'}),env,{});
 assert.equal(r.status,403);
});
test('read-only health gives safe response',async()=>{
 mock((url,opts)=>{
  assert.equal(String(url),'https://omda-documentary-runner-staging.onrender.com/health');
  return ok({status:'AVAILABLE',token:'private'});
 });
 const d=await json(await bridge.fetch(req('/health','GET',undefined,{anonymous:true}),env,{}));
 assert.equal(d.render_status,'AVAILABLE');assert.equal(d.publishing,false);
 assert.equal('token' in d,false);
});
test('authenticated probe uses private bearer but creates no job',async()=>{
 mock((url,opts)=>{
  assert.match(String(url),/\/v1\/auth\/check$/);
  assert.equal(opts.method,'GET');
  assert.equal(opts.headers.authorization,'Bearer '+env.OMDA_DOC_RUNNER_TOKEN);
  return ok({authenticated:true,method:'LEGACY_SHARED_SECRET',created_job:false,publishing:false},200);
 });
 const d=await json(await bridge.fetch(req('/api/status'),env,{}));
 assert.equal(d.render_authenticated,true);
});
test('D1 queue path fails closed when storage binding is absent',async()=>{
 mock(absent);
 const r=await bridge.fetch(req('/api/queue'),env,{});
 assert.equal(r.status,503);
 assert.equal((await json(r)).error,'D1_UNAVAILABLE');
});
test('valid job cannot dispatch if D1 is not bound',async()=>{
 mock(absent);
 const r=await bridge.fetch(req('/api/jobs','POST',sample()),env,{});
 assert.equal(r.status,503);
});
test('no publish or billing routes exist',async()=>{
 mock(absent);
 for(const path of ['/api/publish','/api/billing','/api/youtube/upload']){
  const r=await bridge.fetch(req(path),env,{});
  assert.equal(r.status,404);
 }
});

test('private dashboard renders real D1 UI, without active publish control',async()=>{
 mock(absent);
 let r=await bridge.fetch(req('/','GET',undefined,{anonymous:true}),env,{});
 assert.equal(r.status,401);
 assert.match(r.headers.get('content-type'),/text\/html/);
 const signIn=await r.text();
 assert.match(signIn,/Verify your secure session/);
 assert.doesNotMatch(signIn,/cdn-cgi\/access\/login/);
 assert.doesNotMatch(signIn,/OMDA_DOC_RUNNER_TOKEN/);
 r=await bridge.fetch(req('/'),env,{});
 assert.equal(r.status,200);
 const html=await r.text();
 assert.match(html,/OMDA/);
 assert.match(html,/Start new documentary — locked/);
 assert.match(html,/button disabled/);
 assert.doesNotMatch(html,/OMDA_DOC_RUNNER_TOKEN/);
 const js=await bridge.fetch(req('/static/ui.js'),env,{});
 assert.equal(js.status,200);
 assert.match(await js.text(),/\/api\/queue/);
});

test('readiness identifies D1 and Drive blockers even after authenticated Render handshake',async()=>{
 mock((url,opts)=>{
  assert.equal(opts.redirect,'manual');
  if(String(url).endsWith('/health'))return ok({status:'AVAILABLE',storage:'DRIVE_OAUTH_REQUIRED'},200);
  if(String(url).endsWith('/v1/auth/check'))
    return ok({authenticated:true,method:'LEGACY_SHARED_SECRET',created_job:false},200);
  throw Error('Unexpected endpoint');
 });
 const result=await bridge.fetch(req('/api/readiness'),env,{});
 assert.equal(result.status,200);
 const status=await result.json();
 assert.equal(status.mode,'STAGING');
 assert.equal(status.d1_connected,false);
 assert.equal(status.render_online,true);
 assert.equal(status.render_shared_token_configured,true);
 assert.equal(status.authenticated_handshake_verified,true);
 assert.equal(status.job_submission_ready,false);
 assert.equal(status.paid_generation_enabled,false);
 assert.equal(status.publishing_enabled,false);
 const noAuth=await bridge.fetch(req('/api/readiness','GET',undefined,{anonymous:true}),env,{});
 assert.equal(noAuth.status,403);
});


test('authenticated Cloudflare Worker context opens dashboard without JWT or cookie',async()=>{
 mock(absent);
 const ctx={access:{aud:env.OMDA_ACCESS_AUD,getIdentity:async()=>({email:'owner@example.com'})}};
 const r=await bridge.fetch(req('/','GET',undefined,{anonymous:true}),env,ctx);
 assert.equal(r.status,200);
 assert.match(await r.text(),/Documentary operations/);
});
test('Cloudflare Worker context never trusts arbitrary identity or wrong owner',async()=>{
 mock(absent);
 const ctx={access:{aud:env.OMDA_ACCESS_AUD,getIdentity:async()=>({email:'outsider@example.com'})}};
 const r=await bridge.fetch(req('/','GET',undefined,{anonymous:true}),env,ctx);
 assert.equal(r.status,401);
 assert.match(await r.text(),/Verify your secure session/);
});
