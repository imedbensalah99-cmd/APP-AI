import test from 'node:test';
import assert from 'node:assert/strict';

const render='https://omda-documentary-runner-staging.onrender.com';
const cloudflare='https://omda-documentary-bridge-staging.imedbensalah9988.workers.dev';
async function get(url,timeout=85000){
  return fetch(url,{redirect:'manual',signal:AbortSignal.timeout(timeout)});
}
test('Render is live, no paid generation and no publishing', {timeout:115000}, async()=>{
  const response=await get(render+'/health');
  assert.equal(response.status,200,'Render health must respond 200');
  const data=await response.json();
  assert.equal(data.mode,'DOCUMENTARY_STAGING');
  assert.equal(data.paid_generation,false);
  assert.equal(data.youtube_publishing,false);
  assert.equal(data.auth_mode,'CLOUDFLARE_ACCESS_JWT_ENABLED',
    'staging Render must have verified nonsecret issuer/audience/owner configuration');
  assert.ok(['AVAILABLE','FFMPEG_UNAVAILABLE'].includes(data.status));
  console.log('Render safe health:',data.status,'storage:',data.storage);
});
test('anonymous requests cannot read jobs on Render', {timeout:115000}, async()=>{
  const r=await get(render+'/v1/documentaries/omdabridgeprobe0001');
  assert.ok([401,403,503].includes(r.status),
    'anonymous Render job status must require secret; observed '+r.status);
  console.log('Render anonymous job request blocked:',r.status);
});
test('Cloudflare Access blocks anonymous job operations', {timeout:40000}, async()=>{
  const r=await get(cloudflare+'/api/jobs/omdabridgeprobe0001',30000);
  assert.ok([302,303,307,401,403].includes(r.status),
    'Access must deny anonymous job status: got '+r.status);
  console.log('Cloudflare Access anonymous request:',r.status);
});
test('Cloudflare Access covers the health route too (no authentication bypass)',{timeout:40000},async()=>{
  const r=await get(cloudflare+'/health',30000);
  assert.ok([302,303,307,401,403].includes(r.status),
    'Access app must protect all paths until a reviewed public diagnostic route is configured: got '+r.status);
  console.log('Cloudflare Access health protection:',r.status);
});

test('Render read-only authentication handshake rejects anonymous calls', {timeout:115000},async()=>{
  const r=await get(render+'/v1/auth/check');
  assert.equal(r.status,401,'read-only handshake must reject unsigned requests');
  const data=await r.json();
  assert.equal(data.detail,'UNAUTHORIZED');
  console.log('Render auth handshake anonymous correctly denied:',r.status);
});

test('Render Drive preflight denies unsigned requests', {timeout:115000}, async()=>{
  const response=await get(render+'/v1/storage/preflight');
  assert.equal(response.status,401);
  console.log('Render storage preflight anonymous correctly denied:',response.status);
});
test('Cloudflare Drive preflight stays Access-protected', {timeout:40000}, async()=>{
  const response=await get(cloudflare+'/api/storage/preflight',30000);
  assert.ok([302,303,307,401,403].includes(response.status));
  console.log('Cloudflare storage preflight anonymous protected:',response.status);
});
test('Render Drive smoke cannot run without an authenticated owner', {timeout:115000},async()=>{
  const response=await fetch(render+'/v1/storage/smoke',{
    method:'POST',redirect:'manual',signal:AbortSignal.timeout(85000)});
  assert.equal(response.status,401);
  console.log('Render storage smoke anonymous correctly denied:',response.status);
});
