/** OMDA Video Studio — SAFE STAGING ONLY.
 * Auth: Cloudflare Access app must protect the worker.dev hostname.
 * Each browser/API request fails closed unless ctx.access.getIdentity() succeeds.
 * Back-end job service: Render staging with server-side bearer binding only.
 * Storage: D1 BLOB <= 1.6 MB (demo proof, not for production scale).
 * NO paid AI generation, no YouTube, no public file links.
 */
const RENDER = 'https://omda-video-runner-staging.onrender.com';
const LIMIT_VIDEO = 1600000;
const LIMIT_OTHER = 180000;
const DEFAULT_SCENES = ['في منتصف الليل','توقف المصعد','ظهر طابق غريب','انفتح الباب','سمعت همسة','لا تلتفت'];
const now = () => new Date().toISOString();
function json(data, status=200, extra={}) {
  return new Response(JSON.stringify(data), {status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...extra}});
}
function validId(s) {return /^[a-z0-9_-]{6,128}$/i.test(s||'');}
function sameSite(request) {
  const o = request.headers.get('origin');
  return !o || o === new URL(request.url).origin;
}
async function owner(ctx) {
  // Cloudflare Access validates identity before the Worker; independently require
  // Access runtime identity. No fallback to untrusted request headers.
  if (!ctx.access || typeof ctx.access.getIdentity !== 'function') return null;
  try {const v=await ctx.access.getIdentity(); return v?.email ? true : null;} catch {return null;}
}
async function renderFetch(env, path, opt={}) {
  if (!env.RUNNER_TOKEN || env.RUNNER_TOKEN.length < 32) throw new Error('RUNNER_SECRET_MISSING');
  let c = new AbortController(); const timeout=setTimeout(()=>c.abort(),90000);
  try {return await fetch(RENDER+path,{...opt,signal:c.signal,headers:{...(opt.headers||{}),'Authorization':'Bearer '+env.RUNNER_TOKEN}});} finally{clearTimeout(timeout);}
}
function checkPayload(d) {
  if (!d || typeof d !== 'object') throw new Error('INVALID_JSON');
  const title=String(d.title||'').trim();
  if (title.length<2||title.length>100) throw new Error('TITLE_LENGTH');
  if (!['SARDERA','NIMOLOO'].includes(d.channel)) throw new Error('INVALID_CHANNEL');
  const scenes=Array.isArray(d.scenes)?d.scenes.map(s=>({text:String(typeof s==='string'?s:s?.text||'').trim()})):[];
  if (!scenes.length||scenes.length>12||scenes.some(s=>s.text.length<1||s.text.length>250))throw new Error('INVALID_SCENES');
  const duration=Number(d.duration_seconds??10);
  if(duration!==10)throw new Error('STAGING_ONLY_10_SECONDS');
  return {title,channel:d.channel,scenes,duration_seconds:10,provider:'NO_SPEND_SYNTHETIC',require_narration:true};
}
async function createJob(env,raw) {
  let d=checkPayload(raw);
  const key = typeof raw.idempotency_key==='string' && /^[a-z0-9_.-]{12,128}$/i.test(raw.idempotency_key)
    ? raw.idempotency_key : 'omda_'+crypto.randomUUID().replace(/-/g,'');
  let id = 'job_'+crypto.randomUUID().replace(/-/g,'');
  let stored = await env.DB.prepare('SELECT id,status FROM staging_jobs WHERE request_key=?').bind(key).first();
  if(stored)return {id:stored.id,state:stored.status,existing:true};
  const payload={...d,idempotency_key:key};
  let timestamp=now();
  await env.DB.prepare(`INSERT INTO staging_jobs (id,request_key,channel,title,status,created_at,updated_at,request_json)
    VALUES(?,?,?,?,?,?,?,?)`).bind(id,key,d.channel,d.title,'QUEUED',timestamp,timestamp,JSON.stringify(payload)).run();
  const result=await dispatch(env,id,payload);
  return {id,state:result.state,render_id:result.render_id};
}
async function dispatch(env,id,payload) {
  try {
    const r=await renderFetch(env,'/v1/render',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if (!r.ok) { await env.DB.prepare('UPDATE staging_jobs SET status=?,error_code=?,updated_at=? WHERE id=?')
      .bind('DISPATCH_BLOCKED','RENDER_HTTP_'+r.status,now(),id).run();
      return {state:'DISPATCH_BLOCKED',error_code:'RENDER_HTTP_'+r.status}; }
    const b=await r.json();
    if(!b.job_id || !validId(b.job_id))throw new Error('REMOTE_JOB_ID_INVALID');
    await env.DB.prepare('UPDATE staging_jobs SET render_job_id=?,status=?,updated_at=?,error_code=NULL WHERE id=?')
      .bind(b.job_id,b.state||'QUEUED',now(),id).run();
    return {state:b.state||'QUEUED',render_id:b.job_id};
  }catch(e){const code=String(e?.message||'RENDER_OFFLINE').slice(0,70);
    await env.DB.prepare('UPDATE staging_jobs SET status=?,error_code=?,updated_at=? WHERE id=?')
      .bind('DISPATCH_BLOCKED',code,now(),id).run();
    return {state:'DISPATCH_BLOCKED',error_code:code};}
}
async function fetchArtifact(env,renderId,kind) {
  const r=await renderFetch(env,`/v1/files/${encodeURIComponent(renderId)}/${kind}`);
  if(!r.ok)throw new Error('ARTIFACT_HTTP_'+r.status);
  const cap=kind==='video'?LIMIT_VIDEO:LIMIT_OTHER;
  const hint=Number(r.headers.get('content-length')||0);
  if(hint>cap)throw new Error('ARTIFACT_OVER_STAGING_LIMIT');
  const bytes=new Uint8Array(await r.arrayBuffer());
  if(bytes.length<10 || bytes.length>cap)throw new Error('ARTIFACT_INVALID_SIZE');
  return bytes;
}
const hex = b=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join('');
async function reconcile(env,id) {
  const job=await env.DB.prepare('SELECT id,render_job_id,status FROM staging_jobs WHERE id=?').bind(id).first();
  if(!job)return {state:'NOT_FOUND'};
  if(job.status==='VIDEO_READY_FOR_REVIEW'||job.status==='APPROVED'||job.status==='REJECTED')return {state:job.status};
  if(!job.render_job_id)return {state:job.status};
  try {
    const r=await renderFetch(env,'/v1/jobs/'+encodeURIComponent(job.render_job_id));
    if(!r.ok) {const state=r.status===404?'REMOTE_EXPIRED':'REMOTE_UNAVAILABLE';
      await env.DB.prepare('UPDATE staging_jobs SET status=?,error_code=?,updated_at=? WHERE id=?').bind(state,'RENDER_HTTP_'+r.status,now(),id).run();return {state};}
    const obj=await r.json();
    if(obj.state!=='COMPLETE') {
      let state=['QUEUED','RUNNING','DEMO_ONLY','FAILED','BLOCKED'].includes(obj.state)?obj.state:'REMOTE_UNKNOWN';
      await env.DB.prepare('UPDATE staging_jobs SET status=?,error_code=?,updated_at=? WHERE id=?')
        .bind(state,obj.error_code||null,now(),id).run();return {state};
    }
    if(!obj.result?.narration_present)throw new Error('NARRATION_ABSENT');
    // Download from the authenticated runner and save durably before marking ready.
    const video=await fetchArtifact(env,job.render_job_id,'video');
    const digest=hex(await crypto.subtle.digest('SHA-256',video));
    if(obj.result.sha256!==digest)throw new Error('CHECKSUM_MISMATCH');
    const captions=await fetchArtifact(env,job.render_job_id,'captions');
    const manifest=await fetchArtifact(env,job.render_job_id,'manifest');
    for(const [kind,data,mime] of [['video',video,'video/mp4'],['captions',captions,'application/x-subrip'],['manifest',manifest,'application/json']]){
      await env.DB.prepare(`INSERT INTO staging_assets(job_id,kind,bytes,mime,sha256,created_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT(job_id,kind) DO NOTHING`)
        .bind(id,kind,data,mime,hex(await crypto.subtle.digest('SHA-256',data)),now()).run();
    }
    await env.DB.prepare('UPDATE staging_jobs SET status=?,artifact_sha256=?,error_code=NULL,updated_at=? WHERE id=?')
      .bind('VIDEO_READY_FOR_REVIEW',digest,now(),id).run();
    return {state:'VIDEO_READY_FOR_REVIEW',sha256:digest,bytes:video.length};
  }catch(e){let code=String(e?.message||'SYNC_ERROR').slice(0,70);
    const state=code==='ARTIFACT_OVER_STAGING_LIMIT'?'STORAGE_LIMIT_BLOCKED':'SYNC_BLOCKED';
    await env.DB.prepare('UPDATE staging_jobs SET status=?,error_code=?,updated_at=? WHERE id=?').bind(state,code,now(),id).run();
    return {state,error_code:code};}
}
async function getAsset(env,id,kind) {
  const row=await env.DB.prepare('SELECT bytes,mime,sha256 FROM staging_assets WHERE job_id=? AND kind=?').bind(id,kind).first();
  if(!row)return json({error:'ARTIFACT_NOT_FOUND'},404);
  // D1 converts BLOB to Uint8Array; normalize for Response.
  const bytes=row.bytes instanceof Uint8Array ? row.bytes : new Uint8Array(row.bytes);
  return new Response(bytes,{headers:{'content-type':row.mime,'cache-control':'private, no-store','content-disposition':kind==='video'?`inline; filename="${id}.mp4"`:`attachment; filename="${id}.${kind==='captions'?'srt':'json'}"`,'x-content-type-options':'nosniff'}});
}
const css=`:root{color-scheme:dark;font-family:Inter,system-ui,'Segoe UI',sans-serif;background:#070f21;color:#e9f2ff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 70% -25%,#1a3861,transparent 55%),#070f21}header,main{max-width:1150px;margin:auto;padding:24px}header{display:flex;justify-content:space-between;align-items:center}h1{font-size:clamp(24px,5vw,38px);margin:8px 0}.dim{color:#9daec6}.pill{font:600 11px system-ui;border:1px solid #395b81;padding:7px 12px;border-radius:30px;color:#a6c9fa}.grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}@media(max-width:850px){.grid{grid-template-columns:1fr}}.panel{padding:24px;border:1px solid #28446a;border-radius:20px;background:#0e1c33d8;box-shadow:0 14px 50px #0004}label{display:block;margin:14px 0 5px;color:#b9cce7;font-size:13px}input,select,textarea,button{font:inherit}input,select,textarea{width:100%;border-radius:10px;border:1px solid #335170;background:#09152b;color:white;padding:12px}textarea{min-height:150px;resize:vertical;direction:rtl;text-align:right}button{background:linear-gradient(110deg,#4b83f2,#49bad3);color:#071528;font-weight:700;border:0;border-radius:10px;padding:11px 16px;cursor:pointer}button:disabled{opacity:.6;cursor:not-allowed}.ghost{background:#1d3651;color:#bddbff}.entry{border-bottom:1px solid #2c4763;padding:14px 0}.status{font-size:11px;background:#173c55;padding:5px 9px;border-radius:7px}.video{width:100%;max-width:320px;border-radius:16px;background:#05070d}a{color:#80c6ff}.small{font-size:12px}#notice{min-height:22px;color:#9be1d2}`;
const html=`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"/><meta charset="utf-8"/><meta name="robots" content="noindex,nofollow"/><title>OMDA | Cloud Studio Staging</title><style>${css}</style></head><body><header><div><span class="pill">OMDA AI COMPANY — PRIVATE STAGING</span><h1>Cloud Video Studio</h1><div class="dim">Real Arabic-narrated MP4s · No spend · Owner review</div></div><span class="pill">PUBLISHING LOCKED</span></header><main class="grid"><section class="panel"><h2>Create 10-sec video</h2><form id="form"><label>Channel</label><select id="channel"><option>SARDERA</option><option>NIMOLOO</option></select><label>Title</label><input id="title" maxlength="100" required value="الطابق الثالث عشر"/><label>Arabic scenes (one per line)</label><textarea id="scenes">${DEFAULT_SCENES.join('\n')}</textarea><p class="dim small">Synthetic visual graphics + local Arabic TTS. Not Google Flow or Gemini footage.</p><button id="create">Generate video in cloud</button></form><p id="notice"></p><h3>Renderer</h3><pre id="health" class="dim small">Checking…</pre></section><section class="panel"><h2>Production queue</h2><div id="jobs"><p class="dim">Loading jobs…</p></div></section></main><script>
const $=s=>document.querySelector(s);function esc(s){return String(s??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));}
async function api(path,opt){const r=await fetch(path,{credentials:'same-origin',...opt});const j=await r.json();if(!r.ok)throw Error(j.error||r.status);return j;}
const active=new Set();async function refresh(){try{const r=await api('/api/jobs');$('#jobs').innerHTML=r.jobs.length?r.jobs.map(j=>'<div class="entry"><strong>'+esc(j.title)+'</strong><br><span class="status">'+esc(j.status)+'</span> <span class="dim small">'+esc(j.channel)+'</span><br>'+(j.status==='VIDEO_READY_FOR_REVIEW'||j.status==='APPROVED'||j.status==='REJECTED'?'<video class="video" controls preload="metadata" src="/api/assets/'+encodeURIComponent(j.id)+'/video"></video><div class="small"><a href="/api/assets/'+encodeURIComponent(j.id)+'/video" download>Download MP4</a> · <a href="/api/assets/'+encodeURIComponent(j.id)+'/captions" download>SRT</a></div><div class="small">SHA-256: '+esc(j.artifact_sha256||'')+'</div>':'')+(j.error_code?'<p class="dim small">'+esc(j.error_code)+'</p>':'')+(j.status==='VIDEO_READY_FOR_REVIEW'?'<button class="ghost" data-id="'+esc(j.id)+'" data-review="rejected">Reject</button> <button data-id="'+esc(j.id)+'" data-review="approved">Approve Video</button>':'')+(!['VIDEO_READY_FOR_REVIEW','APPROVED','REJECTED'].includes(j.status)?'<button data-sync="'+esc(j.id)+'" class="ghost">Check progress</button>':'')+'</div>').join(''):'<p class="dim">No jobs yet.</p>';for(const b of document.querySelectorAll('[data-sync]'))b.onclick=async()=>{b.disabled=true;try{await api('/api/jobs/'+b.dataset.sync+'/sync',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});await refresh();}catch(e){$('#notice').textContent=e.message}finally{b.disabled=false}};for(const b of document.querySelectorAll('[data-review]'))b.onclick=async()=>{b.disabled=true;try{await api('/api/jobs/'+b.dataset.id+'/review',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({decision:b.dataset.review})});await refresh()}catch(e){$('#notice').textContent=e.message}finally{b.disabled=false}};}catch(e){$('#jobs').textContent='Job service unavailable: '+e.message}}
$('#form').addEventListener('submit',async e=>{e.preventDefault();$('#create').disabled=true;$('#notice').textContent='Queuing video…';try{const body={channel:$('#channel').value,title:$('#title').value,duration_seconds:10,scenes:$('#scenes').value.split('\n').map(s=>s.trim()).filter(Boolean)};const j=await api('/api/jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});$('#notice').textContent='Job '+j.id+' created. Track it below.';await refresh()}catch(e){$('#notice').textContent='Error: '+e.message}finally{$('#create').disabled=false}});(async()=>{await refresh();try{let h=await api('/api/status');$('#health').textContent=JSON.stringify(h,null,2)}catch(e){$('#health').textContent=e.message}})();setInterval(refresh,16000);
</script></body></html>`;
export default {
  async fetch(request,env,ctx) {
    const url=new URL(request.url);const method=request.method;
    if(!(await owner(ctx)))return json({error:'CLOUDFLARE_ACCESS_REQUIRED'},403);
    if(method!=='GET' && method!=='HEAD' && !sameSite(request))return json({error:'ORIGIN_REJECTED'},403);
    try {
      if(url.pathname==='/'&&method==='GET')return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-frame-options':'DENY','content-security-policy':"default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; media-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",'referrer-policy':'no-referrer'}});
      if(url.pathname==='/api/status' && method==='GET'){
        let status='UNREACHABLE';try{let x=await fetch(RENDER+'/health'); if(x.ok){let y=await x.json();status=y.status}}catch{}
        return json({bridge:'READY',render_service:status,storage:'D1_LIMITED_UNDER_1_6MB',paid_generation:false,publishing:false,auth:'ACCESS_REQUIRED'});
      }
      if(url.pathname==='/api/jobs'&&method==='GET'){
        const x=await env.DB.prepare('SELECT id,title,channel,status,created_at,updated_at,artifact_sha256,error_code FROM staging_jobs ORDER BY created_at DESC LIMIT 40').all();return json({jobs:x.results||[]});
      }
      if(url.pathname==='/api/jobs'&&method==='POST'){
        if(Number(request.headers.get('content-length')||0)>30000)return json({error:'PAYLOAD_TOO_LARGE'},413);
        const obj=await request.json();return json(await createJob(env,obj),202);
      }
      if(url.pathname==='/api/staging/import-smoke'&&method==='POST'){
        const id='staging-smoke-10s';const created=now();
        await env.DB.prepare(`INSERT INTO staging_jobs(id,request_key,channel,title,status,created_at,updated_at,render_job_id)
          VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`).bind(id,id,'SARDERA','OMDA verified smoke proof','QUEUED',created,created,id).run();
        return json(await reconcile(env,id));
      }
      let m=url.pathname.match(/^\/api\/jobs\/([a-zA-Z0-9_-]+)\/sync$/);
      if(m&&method==='POST'&&validId(m[1]))return json(await reconcile(env,m[1]));
      m=url.pathname.match(/^\/api\/jobs\/([a-zA-Z0-9_-]+)\/review$/);
      if(m&&method==='POST'&&validId(m[1])){
        const obj=await request.json();if(!['approved','rejected'].includes(obj.decision))return json({error:'INVALID_DECISION'},400);
        const row=await env.DB.prepare('SELECT status,artifact_sha256 FROM staging_jobs WHERE id=?').bind(m[1]).first();
        if(!row||row.status!=='VIDEO_READY_FOR_REVIEW'||!row.artifact_sha256)return json({error:'VIDEO_NOT_READY_FOR_REVIEW'},409);
        const state=obj.decision==='approved'?'APPROVED':'REJECTED';
        await env.DB.prepare('UPDATE staging_jobs SET status=?,updated_at=? WHERE id=? AND status=?').bind(state,now(),m[1],'VIDEO_READY_FOR_REVIEW').run();
        return json({state,artifact_sha256:row.artifact_sha256,published:false});
      }
      m=url.pathname.match(/^\/api\/assets\/([a-zA-Z0-9_-]+)\/(video|captions|manifest)$/);
      if(m&&method==='GET'&&validId(m[1]))return getAsset(env,m[1],m[2]);
      return json({error:'NOT_FOUND'},404);
    } catch(e) {const message=String(e?.message||'UNKNOWN').slice(0,100);return json({error:message},message==='INVALID_JSON'||message.startsWith('INVALID_')?400:503)}
  },
  async scheduled(event,env,ctx) {
    ctx.waitUntil((async()=>{
      const rows=await env.DB.prepare(`SELECT id,render_job_id,status,request_json FROM staging_jobs
        WHERE status IN ('QUEUED','RUNNING','SYNC_BLOCKED','REMOTE_UNAVAILABLE','DISPATCH_BLOCKED') ORDER BY created_at ASC LIMIT 4`).all();
      for(const row of rows.results||[]) {
        if(!row.render_job_id && row.request_json){const p=JSON.parse(row.request_json);await dispatch(env,row.id,p)}
        else if(row.render_job_id) await reconcile(env,row.id);
      }
    })());
  }
};