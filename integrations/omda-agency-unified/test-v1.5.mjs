import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,webcrypto as crypto} from 'node:crypto';
import hub from './unified-worker-v1.5.mjs';
const source=readFileSync(new URL('./unified-worker-v1.5.mjs',import.meta.url),'utf8');
const agent=readFileSync(new URL('./agency-worker-v1.5.mjs',import.meta.url),'utf8');
const master='aa'.repeat(32),bridge='bb'.repeat(32);
const b64=a=>Buffer.from(a).toString('base64');
const now=()=>String(Date.now());
class MockD1 {
  attempts=[];keyrow=null;
  prepare(sql){const self=this;return{bind(...args){this.args=args;return this},async first(){if(sql.startsWith('SELECT * FROM provider_connections'))return self.keyrow;return null;},async run(){let p=this.args||[];
    if(sql.startsWith('INSERT INTO free_inference_attempts')){if(self.attempts.filter(a=>a.day===p[1]).length>=p[4]||self.attempts.find(a=>a.id===p[0]))return{meta:{changes:0}};self.attempts.push({id:p[0],day:p[1],state:'RESERVED'});return{meta:{changes:1}}}
    if(sql.startsWith('UPDATE free_inference_attempts')){const a=self.attempts.find(x=>x.id===p[1]);if(a)a.state=p[0];return{success:true}}
    throw Error('Unexpected SQL: '+sql);
  }};}
}
const db=new MockD1(),env={PROVIDER_DB:db,PROVIDER_MASTER_KEY:master,INTERNAL_BRIDGE_KEY:bridge};
const keyString='sk-or-v1-NOTREAL-local-fixture-000000000000';
const key=await crypto.subtle.importKey('raw',Buffer.from(master,'hex'),{name:'AES-GCM'},false,['encrypt']);
const iv=crypto.getRandomValues(new Uint8Array(12));
const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('omda-connection:openrouter')},key,new TextEncoder().encode(keyString));
db.keyrow={provider:'openrouter',state:'VALID',ciphertext:b64(ciphertext),nonce:b64(iv)};
const body=JSON.stringify({provider:'openrouter-free',model:'google/gemma-4-26b-a4b-it:free',messages:[{role:'system',content:'Role instructions fictitious'},{role:'user',content:'Write an original fictional two-line ad.'}]});
async function sign(data,ts=now(),nonce=crypto.randomUUID()){const hkey=await crypto.subtle.importKey('raw',Buffer.from(bridge,'hex'),{name:'HMAC',hash:'SHA-256'},false,['sign']);const h=await crypto.subtle.sign('HMAC',hkey,new TextEncoder().encode(ts+'\n'+nonce+'\n'+data));return{ts,nonce,sig:Buffer.from(h).toString('hex')}}
async function route(data=body,headers=null){const h=headers||await sign(data);return hub.fetch(new Request('https://omda-agency-unified.internal/internal/free-inference',{method:'POST',headers:{'content-type':'application/json','x-omda-ts':h.ts,'x-omda-nonce':h.nonce,'x-omda-signature':h.sig},body:data}),env)}
let keyFree=false,modelCalls=0,keyCalls=0;
const oldfetch=globalThis.fetch;
globalThis.fetch=async(u,o)=>{if(String(u)==='https://openrouter.ai/api/v1/key'){keyCalls++;assert.equal(o.headers.authorization,'Bearer '+keyString);return new Response(JSON.stringify({data:{is_free_tier:keyFree,is_management_key:false}}),{status:200});}if(String(u)==='https://openrouter.ai/api/v1/chat/completions'){modelCalls++;assert.equal(o.headers.authorization,'Bearer '+keyString);const d=JSON.parse(o.body);assert.equal(d.model,'google/gemma-4-26b-a4b-it:free');assert.equal(d.max_tokens,320);assert.equal(d.reasoning.enabled,false);return new Response(JSON.stringify({choices:[{message:{content:'إعلان تجريبي لمقهى خيالي.'}}],usage:{prompt_tokens:12,completion_tokens:10}}),{status:200})}throw Error('Unexpected egress '+u)};
try{
await test('syntax/security contract',()=>{assert.match(source,/script-src 'sha256-/);const s=source.match(/<script>([\s\S]*?)<\/script>/)[1];assert.equal(source.match(/script-src 'sha256-([^']+)'/)[1],createHash('sha256').update(s).digest('base64'));assert.match(source,/redirect:'manual'/);assert.match(source,/INTERNAL_BRIDGE_KEY/);assert.match(agent,/MODEL_GATEWAY/);assert.match(agent,/FREE_MODEL='google\/gemma-4-26b-a4b-it:free'/);assert.doesNotMatch(agent,/modelProvider==='openrouter-free'&&agent==='reality-checker'/)});
await test('unsigned internal route denied',async()=>{const r=await hub.fetch(new Request('https://omda-agency-unified.internal/internal/free-inference',{method:'POST',body,headers:{'content-type':'application/json'}}),env);assert.equal(r.status,401)});
await test('bad signature denied',async()=>{const h=await sign(body);h.sig='0'.repeat(64);assert.equal((await route(body,h)).status,401)});
await test('expired timestamp denied',async()=>{const h=await sign(body,String(Date.now()-90000));assert.equal((await route(body,h)).status,401)});
await test('paid model string rejected',async()=>{const b=JSON.stringify({...JSON.parse(body),model:'openai/gpt-5.4'});assert.equal((await route(b)).status,422);assert.equal(db.attempts.length,0)});
await test('verified key without free tier cannot infer',async()=>{const r=await route();assert.equal(r.status,403);assert.match((await r.text()),/not confirmed free tier/);assert.equal(modelCalls,0);assert.equal(db.attempts.length,1)});
await test('free tier key and free model allow one text inference',async()=>{keyFree=true;const r=await route();assert.equal(r.status,200);const v=await r.json();assert.equal(v.provider,'openrouter-free');assert.equal(v.model,'google/gemma-4-26b-a4b-it:free');assert.equal(v.output,'إعلان تجريبي لمقهى خيالي.');assert.equal(modelCalls,1);assert.equal(db.attempts.length,2);assert.equal(db.attempts[1].state,'COMPLETED');assert.ok(!JSON.stringify(v).includes(keyString))});
await test('third signed request is blocked by server daily cap',async()=>{const r=await route();assert.equal(r.status,429);assert.equal(modelCalls,1)});
await test('normal public route still rejects unsigned owner request',async()=>{const r=await hub.fetch(new Request('https://omda-agency-unified.internal/api/providers'),env);assert.equal(r.status,401)});
} finally{globalThis.fetch=oldfetch}
