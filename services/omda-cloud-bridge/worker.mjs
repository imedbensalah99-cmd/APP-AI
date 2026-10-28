// OMDA staging-only, no-spend, server-to-server runner bridge.
// No Google Flow, Gemini, YouTube, arbitrary commands, or public job APIs.
const RENDER = 'https://omda-video-runner-staging.onrender.com';
const JSON_HEADERS = {'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const result = (data,status=200)=>new Response(JSON.stringify(data),{status,headers:JSON_HEADERS});
const safeEq=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;};
async function digest(x){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(x));return [...new Uint8Array(b)].map(c=>c.toString(16).padStart(2,'0')).join('');}
function allowed(body){return body&&['SARDERA','NIMOLOO'].includes(body.channel)&&body.provider==='NO_SPEND_SYNTHETIC'&&Number.isFinite(body.duration_seconds)&&body.duration_seconds>=5&&body.duration_seconds<=30&&typeof body.title==='string'&&body.title.length>0&&body.title.length<=100&&Array.isArray(body.scenes)&&body.scenes.length>0&&body.scenes.length<=12&&body.scenes.every(x=>typeof x.text==='string'&&x.text.length>0&&x.text.length<=250)&&typeof body.idempotency_key==='string'&&/^[a-zA-Z0-9_.-]{12,128}$/.test(body.idempotency_key)&&body.require_narration===true;}
async function renderFetch(path,env,opts={}){const h=new Headers(opts.headers||{});h.set('Authorization','Bearer '+env.OMDA_RUNNER_TOKEN);const c=new AbortController();const timer=setTimeout(()=>c.abort(),25000);try{return await fetch(RENDER+path,{...opts,headers:h,signal:c.signal});}finally{clearTimeout(timer);}}
export default {async fetch(request,env){
  try{
    const url=new URL(request.url);const method=request.method;
    if(url.pathname==='/health'&&method==='GET'){
      // Public health contains no job details, credentials, or account metadata.
      let remote='UNKNOWN';try{const r=await fetch(RENDER+'/health',{signal:AbortSignal.timeout(6000)});const d=await r.json();remote=r.ok?d.status:'BLOCKED';}catch(_){remote='UNAVAILABLE';}
      return result({name:'OMDA Cloud Bridge STAGING',status:'STAGING',runner:remote,paid_generation:false,publishing:false,storage:'STAGING_D1_METADATA_AND_EPHEMERAL_RENDER_FILES'});
    }
    if(!env.DB||!env.OMDA_RUNNER_TOKEN||!env.OMDA_BRIDGE_ADMIN_KEY)return result({error:'NOT_CONFIGURED'},503);
    const authorization=request.headers.get('authorization')||'';
    if(!safeEq(authorization,'Bearer '+env.OMDA_BRIDGE_ADMIN_KEY))return result({error:'UNAUTHORIZED'},401);
    if(url.pathname==='/v1/jobs'&&method==='POST'){
      if(Number(request.headers.get('content-length')||0)>10000)return result({error:'BODY_TOO_LARGE'},413);
      const raw=await request.text();if(raw.length>10000)return result({error:'BODY_TOO_LARGE'},413);
      let data;try{data=JSON.parse(raw);}catch(_){return result({error:'BAD_JSON'},400);}
      if(!allowed(data))return result({error:'INVALID_OR_UNAPPROVED_REQUEST'},422);
      const canonical=JSON.stringify({channel:data.channel,title:data.title,duration_seconds:data.duration_seconds,scenes:data.scenes,provider:data.provider,require_narration:data.require_narration});
      const fingerprint=await digest(canonical);const key=data.idempotency_key;
      let old=await env.DB.prepare('SELECT id,fingerprint,status FROM staging_jobs WHERE request_key=?').bind(key).first();
      if(old){if(old.fingerprint!==fingerprint)return result({error:'IDEMPOTENCY_CONFLICT'},409);return result({job_id:old.id,status:old.status,reused:true},200);}
      const id=crypto.randomUUID();const now=new Date().toISOString();
      try{await env.DB.prepare('INSERT INTO staging_jobs (id,request_key,channel,title,status,created_at,updated_at,fingerprint) VALUES (?,?,?,?,?,?,?,?)').bind(id,key,data.channel,data.title,'QUEUED',now,now,fingerprint).run();}
      catch(_){old=await env.DB.prepare('SELECT id,fingerprint,status FROM staging_jobs WHERE request_key=?').bind(key).first();if(old&&old.fingerprint===fingerprint)return result({job_id:old.id,status:old.status,reused:true});return result({error:'QUEUE_WRITE_FAILED'},503);}
      let r;try{r=await renderFetch('/v1/render',env,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});}catch(_){await env.DB.prepare("UPDATE staging_jobs SET status='RENDER_UNREACHABLE',updated_at=? WHERE id=?").bind(new Date().toISOString(),id).run();return result({job_id:id,status:'RENDER_UNREACHABLE'},503);}
      const v=await r.json().catch(()=>({}));if(!r.ok||!v.job_id){await env.DB.prepare("UPDATE staging_jobs SET status='RENDER_REJECTED',error_code=?,updated_at=? WHERE id=?").bind('RENDER_'+r.status,new Date().toISOString(),id).run();return result({job_id:id,status:'RENDER_REJECTED'},502);}
      await env.DB.prepare("UPDATE staging_jobs SET render_job_id=?,status=?,updated_at=? WHERE id=?").bind(v.job_id,v.state||'QUEUED',new Date().toISOString(),id).run();return result({job_id:id,status:v.state||'QUEUED',artifact_retention:'EPHEMERAL'},202);
    }
    const match=url.pathname.match(/^\/v1\/jobs\/([0-9a-f-]{36})(?:\/(video|captions|manifest))?$/);
    if(match&&method==='GET'){
      const record=await env.DB.prepare('SELECT id,render_job_id,status,artifact_sha256,error_code FROM staging_jobs WHERE id=?').bind(match[1]).first();
      if(!record)return result({error:'NOT_FOUND'},404);
      if(!record.render_job_id)return result({job_id:record.id,status:record.status,error_code:record.error_code});
      if(match[2]){
        if(!['COMPLETE','DEMO_ONLY'].includes(record.status))return result({error:'NOT_READY'},409);
        const kind=match[2];let r;try{r=await renderFetch('/v1/files/'+record.render_job_id+'/'+kind,env);}catch(_){return result({error:'RENDER_UNAVAILABLE'},503);}
        if(!r.ok)return result({error:r.status===410?'ARTIFACT_EXPIRED':'ARTIFACT_UNAVAILABLE'},r.status===410?410:502);
        const h=new Headers({'content-type':r.headers.get('content-type')||'application/octet-stream','cache-control':'private, no-store','x-content-type-options':'nosniff','content-disposition':'attachment; filename="omda-'+kind+'"'});
        return new Response(r.body,{status:200,headers:h});
      }
      let remote;try{const r=await renderFetch('/v1/jobs/'+record.render_job_id,env);if(!r.ok)return result({job_id:record.id,status:'RUNNER_JOB_UNKNOWN',artifact_retention:'EPHEMERAL'},503);remote=await r.json();}catch(_){return result({job_id:record.id,status:'RENDER_UNREACHABLE'},503);}
      const state=remote.state||'UNKNOWN',sha=remote.result?.sha256||null,err=remote.error_code||null;
      await env.DB.prepare('UPDATE staging_jobs SET status=?,artifact_sha256=?,error_code=?,updated_at=? WHERE id=?').bind(state,sha,err,new Date().toISOString(),record.id).run();
      return result({job_id:record.id,status:state,narration_present:remote.result?.narration_present??null,sha256:sha,error_code:err,artifact_retention:'EPHEMERAL',flow_credits_used:0,ai_video_generated:false,published:false});
    }
    return result({error:'NOT_FOUND'},404);
  }catch(_){return result({error:'INTERNAL_ERROR'},500);}

}, async scheduled(_event, env) {
  // Bounded staging probe: one synthetic narrated job per request key.
  // It is not a recurring media schedule, spends zero credits and never publishes.
  if (!env.DB || !env.OMDA_RUNNER_TOKEN) return;
  const key='omda-bridge-staging-smoke-20261028-01';
  const original={channel:'SARDERA',duration_seconds:10,title:'الطابق الثالث عشر',
    scenes:['في منتصف الليل','توقف المصعد','ظهر طابق غريب','انفتح الباب','سمعت همسة','لا تلتفت'].map(text=>({text})),
    provider:'NO_SPEND_SYNTHETIC',idempotency_key:key,require_narration:true};
  const existing=await env.DB.prepare('SELECT id,render_job_id,status FROM staging_jobs WHERE request_key=?').bind(key).first();
  if(existing && ['COMPLETE','FAILED','BLOCKED','DEMO_ONLY','RENDER_REJECTED','RENDER_UNREACHABLE'].includes(existing.status))return;
  if(existing && existing.render_job_id){
    let r;try{r=await renderFetch('/v1/jobs/'+existing.render_job_id,env);}catch(_){return;}
    if(!r.ok)return;
    const v=await r.json();
    await env.DB.prepare('UPDATE staging_jobs SET status=?,artifact_sha256=?,error_code=?,updated_at=? WHERE id=?')
      .bind(v.state||'UNKNOWN',v.result?.sha256||null,v.error_code||null,new Date().toISOString(),existing.id).run();
    return;
  }
  const id=existing?.id||crypto.randomUUID();
  if(!existing){
    const fingerprint=await digest(JSON.stringify({channel:original.channel,title:original.title,duration_seconds:original.duration_seconds,scenes:original.scenes,provider:original.provider,require_narration:true}));
    await env.DB.prepare('INSERT OR IGNORE INTO staging_jobs (id,render_job_id,request_key,channel,title,status,created_at,updated_at,fingerprint) VALUES (?,NULL,?,?,?,?,?,?,?)')
      .bind(id,key,original.channel,original.title,'QUEUED',new Date().toISOString(),new Date().toISOString(),fingerprint).run();
  }
  let r;try{r=await renderFetch('/v1/render',env,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(original)});}catch(_){
    await env.DB.prepare("UPDATE staging_jobs SET status='RENDER_UNREACHABLE',updated_at=? WHERE request_key=?").bind(new Date().toISOString(),key).run();return;}
  const v=await r.json().catch(()=>({}));
  if(!r.ok||!v.job_id){
    await env.DB.prepare("UPDATE staging_jobs SET status='RENDER_REJECTED',error_code=?,updated_at=? WHERE request_key=?")
      .bind('RENDER_'+r.status,new Date().toISOString(),key).run();return;}
  await env.DB.prepare('UPDATE staging_jobs SET render_job_id=?,status=?,updated_at=? WHERE request_key=?')
    .bind(v.job_id,v.state||'QUEUED',new Date().toISOString(),key).run();
}
};