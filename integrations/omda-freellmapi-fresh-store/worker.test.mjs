import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
const token='t'.repeat(64);
const endpoint='https://example.invalid/freeapi.db.backup';
const body=Uint8Array.from([...Buffer.from('FAPIBK1\0'),...Array.from({length:12+16+300},(_,i)=>i%256)]);
function db(){
  const versions=new Map(),chunks=new Map();let current=null;
  function result(sql,args){
    if(sql.startsWith('SELECT v.sha256')) {const v=versions.get(current);return v?{sha256:v.sha256,size_bytes:v.size_bytes}:null;}
    if(sql.startsWith('SELECT v.version_id'))return versions.get(current)||null;
    if(sql.startsWith('SELECT ordinal'))return {results:(chunks.get(args[0])||[]).map(x=>({...x})).sort((a,b)=>a.ordinal-b.ordinal)};
    if(sql.startsWith('INSERT INTO fresh_backup_versions')){versions.set(args[0],{version_id:args[0],sha256:args[1],size_bytes:args[2],chunk_count:args[3]});return{};}
    if(sql.startsWith('INSERT INTO fresh_backup_chunks')){const arr=chunks.get(args[0])||[];arr.push({ordinal:args[1],payload_b64:args[2]});chunks.set(args[0],arr);return{};}
    if(sql.startsWith('INSERT INTO fresh_backup_head')){current=args[0];return{};}
    throw Error('Unexpected SQL: '+sql);
  }
  const fake={prepare(sql){let params=[];return{bind(...a){params=a;return this},async first(){return result(sql,params)},async all(){return result(sql,params)},async run(){return result(sql,params)}}},async batch(steps){for(const s of steps)await s.run();return[]}};
  return {fake,versions,chunks,getCurrent:()=>current};
}
const req=(method='GET',auth=token,buffer)=>new Request(endpoint,{method,headers:{...(auth?{Authorization:'Bearer '+auth}:{}),...(buffer?{'Content-Type':'application/octet-stream'}:{})},body:buffer});
const env=s=>({FRESH_BACKUPS:s.fake,BACKUP_TOKEN:token});
test('unauthorized GET, PUT and missing bindings fail closed',async()=>{
  const s=db();assert.equal((await worker.fetch(req('GET',null),env(s))).status,401);
  assert.equal((await worker.fetch(req('PUT',null,body),env(s))).status,401);
  assert.equal((await worker.fetch(req(),{})).status,503);assert.equal(s.versions.size,0);
});
test('missing backup returns 404, no public status leak',async()=>{
  const s=db();assert.equal((await worker.fetch(req(),env(s))).status,404);
  assert.equal((await worker.fetch(new Request('https://example.invalid/health'),env(s))).status,404);
});
test('roundtrip encrypted envelope, exact bytes, and deduplication',async()=>{
  const s=db();
  assert.equal((await worker.fetch(req('PUT',token,body),env(s))).status,200);
  const read=await worker.fetch(req(),env(s));
  assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'no-store');
  assert.deepEqual(Buffer.from(await read.arrayBuffer()),Buffer.from(body));
  const before=s.versions.size;
  assert.equal((await worker.fetch(req('PUT',token,body),env(s))).status,200);
  assert.equal(s.versions.size,before);
});
test('wrong token, invalid envelope, wrong content type fail',async()=>{
  const s=db();assert.equal((await worker.fetch(req('PUT','a'.repeat(64),body),env(s))).status,401);
  assert.equal((await worker.fetch(req('PUT',token,new Uint8Array(50)),env(s))).status,422);
  assert.equal((await worker.fetch(new Request(endpoint,{method:'PUT',headers:{Authorization:'Bearer '+token,'Content-Type':'text/plain'},body:'abc'}),env(s))).status,415);
  assert.equal(s.versions.size,0);
});
test('corrupt D1 chunk fails closed instead of returning backup',async()=>{
  const s=db();await worker.fetch(req('PUT',token,body),env(s));
  s.chunks.get(s.getCurrent())[0].payload_b64=btoa('corrupted');
  assert.equal((await worker.fetch(req(),env(s))).status,503);
});
test('oversized payload is rejected without writes',async()=>{
  const s=db(),oversized=new Uint8Array(2*1024*1024+1);
  assert.equal((await worker.fetch(req('PUT',token,oversized),env(s))).status,413);
  assert.equal(s.versions.size,0);
});
test('unsupported route and verb fail closed',async()=>{
 const s=db();
 assert.equal((await worker.fetch(new Request('https://example.invalid/'),env(s))).status,404);
 assert.equal((await worker.fetch(new Request(endpoint,{method:'DELETE'}),env(s))).status,405);
});
