import test from 'node:test';
import assert from 'node:assert/strict';
import {assertStagingUrl,probeReadiness} from './adapter.mjs';
test('strict staging origin allowlist prevents SSRF and lookalike hosts',()=>{
  for(const url of ['http://omda-freellmapi-secure-staging-v1.onrender.com','https://omda-freellmapi-secure-staging-v1.onrender.com.evil.invalid','https://evil.invalid','https://user:pass@omda-freellmapi-secure-staging-v1.onrender.com','https://omda-freellmapi-secure-staging-v1.onrender.com/api/ping','https://omda-freellmapi-secure-staging-v1.onrender.com/?token=leak']){
    assert.throws(()=>assertStagingUrl(url));
  }
  assert.equal(assertStagingUrl('https://omda-freellmapi-secure-staging-v1.onrender.com'),'https://omda-freellmapi-secure-staging-v1.onrender.com');
});
test('uses only two anonymous GET probes with no credentials, jobs or prompts',async()=>{
  const calls=[];
  const fake=async(url,init)=>{calls.push({url,init});return{status:url.endsWith('/api/ping')?200:403}};
  const result=await probeReadiness({fetchFn:fake});
  assert.equal(result.readiness,'PERIMETER_ONLY');
  assert.equal(result.agentsEnabled,false);
  assert.equal(result.paidCallsAllowed,false);
  assert.equal(result.writeCallsAllowed,false);
  assert.equal(result.providerCredentialsVerified,false);
  assert.deepEqual(calls.map(x=>new URL(x.url).pathname),['/api/ping','/v1/models']);
  for(const call of calls){assert.equal(call.init.method,'GET');assert.equal(call.init.redirect,'manual');assert.ok(!('Authorization' in call.init.headers));assert.ok(!('body' in call.init));}
});
test('fails closed if origin gate accidentally opens',async()=>{
 const result=await probeReadiness({fetchFn:async()=>({status:200})});
 assert.equal(result.readiness,'NOT_READY');
 assert.equal(result.originProtected,false);
});
test('fails closed if health endpoint is unavailable',async()=>{
 const result=await probeReadiness({fetchFn:async(url)=>({status:url.endsWith('/api/ping')?503:403})});
 assert.equal(result.readiness,'NOT_READY');
});
test('prevents requests to agent execution endpoints in source',async()=>{
 const fs=await import('node:fs');
 const s=fs.readFileSync(new URL('./adapter.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(s, /method:\s*['"]POST['"]|\/chat\/completions|\/v1\/responses|\/jobs\/create/);
});
