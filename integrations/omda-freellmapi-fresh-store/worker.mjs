// OMDA FreeLLMAPI fresh-start backup store v1.
// New independent D1 only; never reuse the legacy D1 or its credentials.
// AES-256-GCM encryption is performed by the FreeLLMAPI server, not here.
// This store validates the encrypted envelope and its SHA-256 before release.
const PATH = '/freeapi.db.backup';
const MAX_BYTES = 2 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;
const MAGIC = new Uint8Array([70,65,80,73,66,75,49,0]); // FAPIBK1\0
const NO_STORE = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};

function reply(status, msg) {
  return new Response(msg,{status,headers:{...NO_STORE,'Content-Type':'text/plain; charset=utf-8'}});
}
async function hashHex(data) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256',data));
  return [...hash].map(n=>n.toString(16).padStart(2,'0')).join('');
}
async function authorized(request,token) {
  if (typeof token!=='string' || token.length<48) return false;
  const got = request.headers.get('Authorization')||'';
  if (!/^Bearer [A-Za-z0-9_-]{48,256}$/.test(got)) return false;
  const provided = got.slice(7);
  const enc = new TextEncoder();
  const [a,b] = await Promise.all([crypto.subtle.digest('SHA-256',enc.encode(provided)),crypto.subtle.digest('SHA-256',enc.encode(token))]);
  const av = new Uint8Array(a),bv = new Uint8Array(b);
  let mismatch = 0;
  for(let i=0;i<av.length;i++)mismatch |= (av[i]^bv[i]);
  return mismatch===0;
}
function envelopeOk(bytes){
  if(bytes.length < MAGIC.length+12+16+1) return false;
  for(let i=0;i<MAGIC.length;i++)if(bytes[i]!==MAGIC[i])return false;
  return true;
}
function chunkToBase64(bytes) {return btoa(String.fromCharCode(...bytes));}
function base64ToBytes(s) {
  const raw = atob(s);
  return Uint8Array.from(raw, c=>c.charCodeAt(0));
}
async function consumeBounded(request) {
  if(!request.body)return new Uint8Array(0);
  const hinted = request.headers.get('content-length');
  if(hinted && (!/^\d+$/.test(hinted)||Number(hinted)>MAX_BYTES))return null;
  const reader = request.body.getReader(),parts=[];
  let total=0;
  try {
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>MAX_BYTES){await reader.cancel();return null;}
      parts.push(value);
    }
  }finally{reader.releaseLock();}
  const output=new Uint8Array(total);
  let cursor=0;
  for(const part of parts){output.set(part,cursor);cursor+=part.byteLength;}
  return output;
}
async function upload(req,db){
  if((req.headers.get('content-type')||'').split(';')[0].trim()!=='application/octet-stream')return reply(415,'Unsupported content type');
  const bytes=await consumeBounded(req);
  if(bytes===null)return reply(413,'Backup is too large');
  if(!envelopeOk(bytes))return reply(422,'Invalid encrypted backup envelope');
  const sha=await hashHex(bytes);
  const existing=await db.prepare('SELECT v.sha256, v.size_bytes FROM fresh_backup_head h JOIN fresh_backup_versions v ON v.version_id=h.version_id WHERE h.id=1').first();
  if(existing && existing.sha256===sha && existing.size_bytes===bytes.length)return reply(200,'Unchanged');
  const id=crypto.randomUUID();
  const chunks=[];
  for(let i=0;i<bytes.length;i+=CHUNK_BYTES)chunks.push(chunkToBase64(bytes.subarray(i,i+CHUNK_BYTES)));
  const now=new Date().toISOString();
  const steps=[
    db.prepare('INSERT INTO fresh_backup_versions(version_id,sha256,size_bytes,chunk_count,created_at) VALUES(?,?,?,?,?)').bind(id,sha,bytes.length,chunks.length,now),
    ...chunks.map((item,i)=>db.prepare('INSERT INTO fresh_backup_chunks(version_id,ordinal,payload_b64) VALUES(?,?,?)').bind(id,i,item)),
    db.prepare('INSERT INTO fresh_backup_head(id,version_id) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET version_id=excluded.version_id').bind(id)
  ];
  // Cloudflare D1 batch is an atomic transaction: partial backups never become current.
  await db.batch(steps);
  return reply(200,'Stored');
}
async function download(db){
  const head=await db.prepare('SELECT v.version_id,v.sha256,v.size_bytes,v.chunk_count FROM fresh_backup_head h JOIN fresh_backup_versions v ON v.version_id=h.version_id WHERE h.id=1').first();
  if(!head)return reply(404,'No backup exists');
  if(!Number.isInteger(head.chunk_count)||head.chunk_count<1||head.chunk_count>Math.ceil(MAX_BYTES/CHUNK_BYTES)||head.size_bytes>MAX_BYTES)return reply(503,'Backup unavailable');
  const {results}=await db.prepare('SELECT ordinal,payload_b64 FROM fresh_backup_chunks WHERE version_id=? ORDER BY ordinal ASC').bind(head.version_id).all();
  if(!results || results.length!==head.chunk_count)return reply(503,'Backup unavailable');
  let parts=[],total=0;
  try{
    for(let i=0;i<results.length;i++){
      if(results[i].ordinal!==i || typeof results[i].payload_b64!=='string')return reply(503,'Backup unavailable');
      const part=base64ToBytes(results[i].payload_b64);
      total+=part.length;
      if(total>MAX_BYTES)return reply(503,'Backup unavailable');
      parts.push(part);
    }
  }catch{return reply(503,'Backup unavailable');}
  if(total!==head.size_bytes)return reply(503,'Backup unavailable');
  const buffer=new Uint8Array(total);
  let offset=0;for(const part of parts){buffer.set(part,offset);offset+=part.length;}
  if(!envelopeOk(buffer)||await hashHex(buffer)!==head.sha256)return reply(503,'Backup unavailable');
  return new Response(buffer,{status:200,headers:{...NO_STORE,'Content-Type':'application/octet-stream','Content-Length':String(total)}});
}
async function handle(request,env){
  const url=new URL(request.url);
  if(url.pathname!=='/freeapi.db.backup')return reply(404,'Not found');
  if(!['GET','PUT'].includes(request.method))return reply(405,'Method not allowed');
  if(!env?.FRESH_BACKUPS || !env?.BACKUP_TOKEN)return reply(503,'Not configured');
  if(!(await authorized(request,env.BACKUP_TOKEN)))return reply(401,'Unauthorized');
  try{return request.method==='GET'?await download(env.FRESH_BACKUPS):await upload(request,env.FRESH_BACKUPS);}
  catch{return reply(503,'Backup unavailable');}
}
export default {fetch:handle};
export {handle,envelopeOk,consumeBounded,hashHex};
