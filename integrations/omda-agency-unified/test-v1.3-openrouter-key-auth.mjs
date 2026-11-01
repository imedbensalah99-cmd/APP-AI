import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash, webcrypto as crypto} from 'node:crypto';
import module from './worker.mjs';
const src=readFileSync(new URL('./worker.mjs',import.meta.url),'utf8');
const host='https://omda-agency-unified.imedbensalah9988.workers.dev';
const aud='b7be3a76ada5ff347e5df7612e3c17e9113ca2a028898f256ba99c4a80c3ffa4';
const issuer='https://super-mode-8f54.cloudflareaccess.com';
const fakeKey='gsk_this-key-is-for-TEST-only-not-real-0001234567';
const base64=x=>Buffer.from(x).toString('base64url');
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const pub=await crypto.subtle.exportKey('jwk',keys.publicKey);pub.kid='local-test-kid';
async function jwt(email='imedbensalah9988@gmail.com'){const now=Math.floor(Date.now()/1000);const a=base64(JSON.stringify({alg:'RS256',kid:pub.kid,typ:'JWT'}));const b=base64(JSON.stringify({aud:[aud],iss:issuer,iat:now,exp:now+300,email}));const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(a+'.'+b));return `${a}.${b}.${base64(Buffer.from(sig))}`;}
class MockD1{
 rows=new Map();audits=[];
 prepare(sql){const self=this;return{bind(...params){this.params=params;return this},async all(){if(sql.startsWith('SELECT provider'))return {results:[...self.rows.values()].map(r=>({provider:r.provider,state:r.state,fingerprint:r.fingerprint,updated_at:r.updated_at,last_test_at:r.last_test_at,last_http_status:r.last_http_status,last_test_reason:r.last_test_reason}))};return{results:[]}},async first(){return self.rows.get(this.params[0])||null},async run(){const a=this.params||[];
 if(sql.startsWith('INSERT INTO provider_connections')){const [p,c,nonce,fprint,ts]=a;self.rows.set(p,{provider:p,ciphertext:c,nonce,fingerprint:fprint,updated_at:ts,state:'UNTESTED',last_test_at:null,last_test_day:null,test_count:0,last_http_status:null,last_test_reason:null});return {success:true};}
 if(sql.startsWith('UPDATE provider_connections SET test_count')){const [cnt,day,ts,p]=a;Object.assign(self.rows.get(p),{test_count:cnt,last_test_day:day,last_test_at:ts});return{success:true};}
 if(sql.startsWith('UPDATE provider_connections SET state')){const [state,status,reason,p]=a;Object.assign(self.rows.get(p),{state,last_http_status:status,last_test_reason:reason});return{success:true};}
 if(sql.startsWith('DELETE FROM provider_connections')){self.rows.delete(a[0]);return{success:true};}
 if(sql.startsWith('INSERT INTO vault_audit')){self.audits.push(a);return{success:true};}
 throw Error('Unsupported SQL '+sql);
 }}};
}
const db=new MockD1();const env={ACCESS_AUD:aud,ACCESS_TEAM:'super-mode-8f54.cloudflareaccess.com',OWNER_EMAIL:'imedbensalah9988@gmail.com',PROVIDER_MASTER_KEY:'aa'.repeat(32),PROVIDER_DB:db};
const originalFetch=globalThis.fetch;let providerCalls=0,providerMode=200,openrouterCalls=0,openrouterMode=200;globalThis.fetch=async(url,opts)=>{if(String(url)===issuer+'/cdn-cgi/access/certs')return new Response(JSON.stringify({keys:[pub]}),{status:200});if(String(url)==='https://api.groq.com/openai/v1/models'){providerCalls++;assert.equal(opts.headers.authorization,'Bearer '+fakeKey);assert.equal(opts.method,'GET');assert.equal(opts.redirect,'manual','Cloudflare Workers rejects redirect:error');if(providerMode==='throw')throw new TypeError('Mock network failure — do not leak this text');return new Response(JSON.stringify({data:[]}),{status:providerMode});}if(String(url)==='https://openrouter.ai/api/v1/key'){openrouterCalls++;assert.equal(opts.method,'GET');assert.equal(opts.redirect,'manual');assert.equal(opts.headers.authorization,'Bearer '+fakeKey);return new Response(JSON.stringify({data:{is_free_tier:true}}),{status:openrouterMode});}throw Error('Unexpected egress: '+url);};
async function invoke(path,token,method='GET',body=null,origin=host){const headers=new Headers({'Cf-Access-Jwt-Assertion':token});if(method!=='GET'){headers.set('origin',origin);headers.set('content-type','application/json');headers.set('x-omda-safe-action','connections');}const req=new Request(host+path,{method,headers,body:body===null?undefined:JSON.stringify(body)});return module.fetch(req,env)}
try{
 test('source: strong CSP, no dynamic public provider keys',()=>{assert.ok(!src.includes("script-src 'unsafe-inline'"));assert.ok(src.includes("script-src 'sha256-"));assert.ok(!src.includes(fakeKey));assert.ok(!src.includes('FreeLLMAPI: CONNECTED'));});
 test('no JWT is rejected, even health',async()=>{let r=await module.fetch(new Request(host+'/api/providers'),env);assert.equal(r.status,401);r=await module.fetch(new Request(host+'/api/health'),env);assert.equal(r.status,401);});
 test('wrong signed owner is rejected',async()=>{const r=await invoke('/api/providers',await jwt('somebody@example.com'));assert.equal(r.status,401)});
 test('owner can see empty provider list without keys',async()=>{const r=await invoke('/api/providers',await jwt());assert.equal(r.status,200);const j=await r.json();assert.equal(j.providers.length,5);assert.equal(j.inference,'DISABLED');assert.equal(j.providers.filter(x=>x.connected).length,0)});
 test('cross-origin key attempt rejected before parsing',async()=>{const r=await invoke('/api/providers',await jwt(),'POST',{provider:'groq',key:fakeKey},'https://malicious.example');assert.equal(r.status,403);assert.equal(db.rows.size,0)});
 test('same-origin key stored encrypted and never revealed',async()=>{const r=await invoke('/api/providers',await jwt(),'POST',{provider:'groq',key:fakeKey});assert.equal(r.status,201);assert.ok(!JSON.stringify(await r.json()).includes(fakeKey));const row=db.rows.get('groq');assert.ok(row);assert.ok(!JSON.stringify(row).includes(fakeKey));assert.ok(row.ciphertext.length>40);const v=await (await invoke('/api/providers',await jwt())).text();assert.ok(!v.includes(fakeKey));assert.match(v,/"connected":true/);});
 test('key-only model-list test and no inference',async()=>{const r=await invoke('/api/providers/groq/test',await jwt(),'POST',{});assert.equal(r.status,200);const j=await r.json();assert.equal(j.state,'VALID');assert.equal(providerCalls,1);assert.equal(j.reason,'MODELS_OK');assert.equal(j.httpStatus,200);assert.equal(db.rows.get('groq').test_count,1);assert.ok(!JSON.stringify(j).includes(fakeKey));});
 test('at most 4 daily model list tests',async()=>{for(let i=0;i<3;i++){const r=await invoke('/api/providers/groq/test',await jwt(),'POST',{});assert.equal(r.status,200)}const limited=await invoke('/api/providers/groq/test',await jwt(),'POST',{});assert.equal(limited.status,429);assert.equal(providerCalls,4);});
 test('delete credential succeeds',async()=>{const r=await invoke('/api/providers/groq',await jwt(),'DELETE',{});assert.equal(r.status,200);assert.equal(db.rows.size,0);});
 test('redirect is rejected without following or exposing secrets',async()=>{
  providerMode=302;let r=await invoke('/api/providers',await jwt(),'POST',{provider:'groq',key:fakeKey});assert.equal(r.status,201);
  r=await invoke('/api/providers/groq/test',await jwt(),'POST',{});const j=await r.json();assert.equal(j.state,'ERROR');assert.equal(j.reason,'REDIRECT_REJECTED');assert.equal(j.httpStatus,302);assert.ok(!JSON.stringify(j).includes(fakeKey));
  const listing=await (await invoke('/api/providers',await jwt())).json();const v=listing.providers.find(x=>x.provider==='groq');assert.equal(v.lastTestReason,'REDIRECT_REJECTED');assert.equal(v.lastHttpStatus,302);
 });
 test('network failure exposes only safe diagnostic code',async()=>{
  providerMode='throw';const r=await invoke('/api/providers/groq/test',await jwt(),'POST',{});const j=await r.json();assert.equal(j.state,'ERROR');assert.equal(j.reason,'NETWORK_OR_RUNTIME');assert.equal(j.httpStatus,null);assert.ok(!JSON.stringify(j).includes('Mock network failure'));
 });
 test('401 is classified as auth failure',async()=>{
  providerMode=401;const r=await invoke('/api/providers/groq/test',await jwt(),'POST',{});const j=await r.json();assert.equal(j.state,'INVALID');assert.equal(j.reason,'AUTH_401');assert.equal(j.httpStatus,401);
 });
 test('OpenRouter key-auth endpoint verifies bearer instead of public catalog',async()=>{
  const r=await invoke('/api/providers',await jwt(),'POST',{provider:'openrouter',key:fakeKey});assert.equal(r.status,201);
  const x=await invoke('/api/providers/openrouter/test',await jwt(),'POST',{});assert.equal(x.status,200);const j=await x.json();assert.equal(j.state,'VALID');assert.equal(j.reason,'KEY_AUTH_OK');assert.equal(j.httpStatus,200);assert.equal(openrouterCalls,1);assert.ok(!JSON.stringify(j).includes(fakeKey));
});
test('OpenRouter rejects an invalid token with HTTP 401',async()=>{
  openrouterMode=401;const x=await invoke('/api/providers/openrouter/test',await jwt(),'POST',{});const j=await x.json();assert.equal(j.state,'INVALID');assert.equal(j.reason,'AUTH_401');assert.equal(j.httpStatus,401);
});
test('OpenRouter token cleared after mock tests',async()=>{const r=await invoke('/api/providers/openrouter',await jwt(),'DELETE',{});assert.equal(r.status,200);});
test('delete temporary credential after extended diagnostics',async()=>{const r=await invoke('/api/providers/groq',await jwt(),'DELETE',{});assert.equal(r.status,200);assert.equal(db.rows.size,0);});
}finally{process.on('exit',()=>{globalThis.fetch=originalFetch});}
