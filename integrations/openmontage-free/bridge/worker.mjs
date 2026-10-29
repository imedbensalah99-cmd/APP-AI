/**
 * OMDA Documentary Bridge (staging only).
 * Strictly no paid API access, no publish operation, no browser-visible secrets.
 * Anonymous GET /health is read-only; all job operations require verified
 * Cloudflare Access owner identity and a server-side Render bearer secret.
 */
const UPSTREAM = 'https://omda-documentary-runner-staging.onrender.com';
const MAX_BODY = 40000;
const SAFE_ID = /^[A-Za-z0-9_-]{6,100}$/;
const SHA = /^[a-f0-9]{64}$/;
const SCENE_FIELDS = ['drive_file_id','drive_sha256','duration_seconds','place_name','source_url','license','license_evidence_url','location_verification_url','narration_text'];
const VALID_LICENSES = new Set(['CC0-1.0','CC-BY-4.0','PEXELS','PIXABAY','OWNER']);

function json(obj, status=200) {
  return new Response(JSON.stringify(obj),{status,headers:{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store', 'x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer','x-frame-options':'DENY',
    'content-security-policy':"default-src 'none'; frame-ancestors 'none'"
  }});
}
function authorizedIdentity(ctx, env) {
  return (async()=>{
    if (!env.OMDA_OWNER_EMAIL || !ctx?.access || typeof ctx.access.getIdentity!=='function') return false;
    try {
      const identity=await ctx.access.getIdentity();
      return typeof identity?.email==='string' &&
        identity.email.trim().toLowerCase()===env.OMDA_OWNER_EMAIL.trim().toLowerCase();
    } catch {return false;}
  })();
}
function isHttps(u) {
  try { const x=new URL(u);return x.protocol==='https:'&&x.hostname&& !x.username&&!x.password;}catch{return false;}
}
function validRef(x) {
  return x&&typeof x==='object'&&!Array.isArray(x)&&
    /^[A-Za-z0-9_-]{8,150}$/.test(x.drive_file_id||'')&&SHA.test(x.drive_sha256||'');
}
function assertJob(obj) {
  if (!obj||typeof obj!=='object'||Array.isArray(obj))throw Error('INVALID_JOB');
  if(obj.provider_policy!=='FREE_ONLY'||obj.publish_intent!==false)throw Error('FREE_ONLY_REQUIRED');
  if(!SAFE_ID.test(obj.job_id||''))throw Error('JOB_ID_INVALID');
  if(!/^[A-Za-z0-9_.-]{6,128}$/.test(obj.idempotency_key||''))throw Error('IDEMPOTENCY_REQUIRED');
  if(!/^[A-Za-z0-9_-]{10,150}$/.test(obj.folder_id||''))throw Error('FOLDER_ID_INVALID');
  if(obj.language!=='ar')throw Error('LANGUAGE_INVALID');
  if(typeof obj.title!=='string'||obj.title.trim().length<3||obj.title.length>120)throw Error('TITLE_INVALID');
  if(typeof obj.country!=='string'||obj.country.trim().length<2||obj.country.length>80)throw Error('COUNTRY_INVALID');
  if(!Number.isFinite(obj.duration_seconds)||obj.duration_seconds<2||obj.duration_seconds>120)throw Error('DURATION_INVALID');
  if(!Array.isArray(obj.scenes)||obj.scenes.length<2||obj.scenes.length>24)throw Error('SCENES_INVALID');
  let duration=0;
  for(const s of obj.scenes){
    if(!validRef(s)||!Number.isFinite(s.duration_seconds)||s.duration_seconds<1||s.duration_seconds>60||
      !VALID_LICENSES.has(s.license)||typeof s.place_name!=='string'||s.place_name.trim().length<2||
      typeof s.narration_text!=='string'||s.narration_text.length<5||s.narration_text.length>1200||
      !isHttps(s.source_url)||!isHttps(s.license_evidence_url)||!isHttps(s.location_verification_url))
      throw Error('SCENE_INVALID');
    duration+=s.duration_seconds;
  }
  if(Math.abs(duration-obj.duration_seconds)>.04)throw Error('SCENE_TIMING_INVALID');
  if(obj.narration!==undefined && obj.narration!==null && !validRef(obj.narration))throw Error('NARRATION_REFERENCE_INVALID');
  if(obj.music!==undefined&&obj.music!==null &&
     (!validRef(obj.music)||!VALID_LICENSES.has(obj.music.license)||
      !isHttps(obj.music.source_url)||!isHttps(obj.music.license_evidence_url)))throw Error('MUSIC_REFERENCE_INVALID');
  // Force small, specific contract without allowing hidden instructions
  const wanted=['job_id','idempotency_key','folder_id','title','country','language',
    'duration_seconds','provider_policy','publish_intent','narration','music','scenes'];
  if(Object.keys(obj).some(k=>!wanted.includes(k)))throw Error('UNSUPPORTED_JOB_FIELD');
  return {
    job_id:obj.job_id,idempotency_key:obj.idempotency_key,folder_id:obj.folder_id,
    title:obj.title.trim(),country:obj.country.trim(),language:'ar',
    duration_seconds:obj.duration_seconds,provider_policy:'FREE_ONLY',publish_intent:false,
    narration:obj.narration||null,
    ...(obj.music?{music:obj.music}:{}),
    scenes:obj.scenes.map(s=>Object.fromEntries(SCENE_FIELDS.map(k=>[k,s[k]])))
  };
}
async function upstream(env,path,method='GET',payload) {
  if(typeof env.OMDA_DOC_RUNNER_TOKEN!=='string'||env.OMDA_DOC_RUNNER_TOKEN.length<32)
    return {ok:false,status:503,data:{error:'BRIDGE_SECRET_NOT_CONFIGURED'}};
  const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(),method==='POST'?65000:12000);
  try{
    const r=await fetch(UPSTREAM+path,{
      method,redirect:'manual',signal:ctrl.signal,
      headers:{authorization:'Bearer '+env.OMDA_DOC_RUNNER_TOKEN,
        ...(method==='POST'?{'content-type':'application/json'}:{})},
      ...(payload?{body:JSON.stringify(payload)}:{})
    });
    if(r.status>=300&&r.status<400)return {ok:false,status:502,data:{error:'UPSTREAM_REDIRECT_REJECTED'}};
    if(r.status===401||r.status===403)return {ok:false,status:502,data:{error:'RENDER_AUTH_REJECTED'}};
    const type=r.headers.get('content-type')||'';
    if(!type.includes('application/json'))return {ok:false,status:502,data:{error:'UPSTREAM_NOT_JSON'}};
    const len=Number(r.headers.get('content-length')||0);
    if(len>10000)return {ok:false,status:502,data:{error:'UPSTREAM_TOO_LARGE'}};
    let data=await r.json();
    if(!data||typeof data!=='object'||Array.isArray(data))throw Error('INVALID_JSON');
    return {ok:r.ok,status:r.status,data};
  }catch{return {ok:false,status:502,data:{error:'UPSTREAM_UNAVAILABLE'}}}
  finally{clearTimeout(timer)}
}
function safeResult(response) {
  // Keep external service internals, paths and tokens out of user-facing UI.
  const x=response.data||{};
  return json({
    ...(typeof x.job_id==='string'&&SAFE_ID.test(x.job_id)?{job_id:x.job_id}:{}),
    ...(typeof x.state==='string'?{state:x.state.slice(0,50)}:{}),
    ...(typeof x.error_code==='string'?{error_code:x.error_code.slice(0,70)}:{}),
    ...(typeof x.error==='string'?{error:x.error.slice(0,70)}:{}),
    ...(x.published===false?{published:false}:{})
  }, response.status);
}
export default {
 async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(url.pathname==='/health'&&request.method==='GET'){
    try{
      const response=await fetch(UPSTREAM+'/health',{redirect:'manual',signal:AbortSignal.timeout(9000)});
      let info=null;
      if(response.ok&&(response.headers.get('content-type')||'').includes('application/json'))info=await response.json();
      return json({bridge:'OMDA_DOCUMENTARY_STAGING',version:'v1',upstream_online:response.ok,
        render_status:typeof info?.status==='string'?info.status.slice(0,50):'UNKNOWN',
        paid_generation:false,publishing:false,write_access:'OWNER_ACCESS_REQUIRED'});
    }catch{return json({bridge:'OMDA_DOCUMENTARY_STAGING',upstream_online:false,paid_generation:false,publishing:false},503)}
  }
  if(!await authorizedIdentity(ctx,env))return json({error:'CLOUDFLARE_ACCESS_OWNER_REQUIRED'},403);
  if(!env.OMDA_DOC_RUNNER_TOKEN||env.OMDA_DOC_RUNNER_TOKEN.length<32)
    return json({error:'BRIDGE_SECRET_NOT_CONFIGURED'},503);
  if(url.pathname==='/api/status'&&request.method==='GET'){
    // The exact probe ID is syntactically valid but never submitted.
    const r=await upstream(env,'/v1/documentaries/omdabridgeprobe0001');
    return json({bridge:'STAGING',render_authenticated:r.status===404,
      render_api_status:r.status===404?'AUTHENTICATED':r.data.error||'UNAVAILABLE',
      paid_generation:false,publishing:false});
  }
  if(url.pathname==='/api/jobs'&&request.method==='POST'){
    if(request.headers.get('origin')!==url.origin)return json({error:'ORIGIN_REQUIRED'},403);
    if(!(request.headers.get('content-type')||'').startsWith('application/json'))
      return json({error:'JSON_REQUIRED'},415);
    if(Number(request.headers.get('content-length')||0)>MAX_BODY)return json({error:'PAYLOAD_TOO_LARGE'},413);
    let raw='';
    try{raw=await request.text()}catch{return json({error:'BODY_READ_FAILED'},400)}
    if(raw.length>MAX_BODY)return json({error:'PAYLOAD_TOO_LARGE'},413);
    let data;
    try{data=assertJob(JSON.parse(raw))}catch(e){return json({error:String(e?.message||'INVALID_PAYLOAD').slice(0,70)},400)}
    return safeResult(await upstream(env,'/v1/documentaries','POST',data));
  }
  const match=url.pathname.match(/^\/api\/jobs\/([A-Za-z0-9_-]{6,100})$/);
  if(match&&request.method==='GET')return safeResult(await upstream(env,'/v1/documentaries/'+match[1]));
  return json({error:'NOT_FOUND'},404);
 }
};