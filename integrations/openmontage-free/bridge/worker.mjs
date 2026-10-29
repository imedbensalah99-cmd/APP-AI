import {verifyOwnerAccess} from './access.mjs';
import {dashboardResponse,staticResponse,accessLoginResponse} from './ui.mjs';
import {claimJob,findJob,listJobs,normalizeState,updateJob} from './queue.mjs';
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
// Access JWT is signed by Cloudflare and validated independently by Render.
// Never send user cookies to Render, only the application-scoped signed token.
function accessBearer(request,env){
  if(typeof env.OMDA_DOC_RUNNER_TOKEN==='string' && env.OMDA_DOC_RUNNER_TOKEN.length>=32)
    return env.OMDA_DOC_RUNNER_TOKEN;
  let token=request.headers.get('Cf-Access-Jwt-Assertion');
  if(!token){
    const cookies=request.headers.get('Cookie')||'';
    if(cookies.length>16000)return null;
    const parts=cookies.split(';').map(x=>x.trim())
      .filter(x=>x.startsWith('CF_Authorization='));
    if(parts.length!==1)return null;
    try{token=decodeURIComponent(parts[0].slice('CF_Authorization='.length))}
    catch{return null}
  }
  if(typeof token!=='string'||token.length>8192||
      !/^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+$/.test(token))
    return null;
  return token;
}
async function upstream(env,path,method='GET',payload,credential=null) {
  if(!credential)return {ok:false,status:503,data:{error:'CLOUDFLARE_ACCESS_TOKEN_REQUIRED'}};
  const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(),method==='POST'?65000:12000);
  try{
    const r=await fetch(UPSTREAM+path,{
      method,redirect:'manual',signal:ctrl.signal,
      headers:{authorization:'Bearer '+credential,
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
  if(!await verifyOwnerAccess(request,env,ctx)){
    if(request.method==='GET'&&url.pathname==='/')return accessLoginResponse(request);
    return json({error:'CLOUDFLARE_ACCESS_OWNER_REQUIRED'},403);
  }
  if(url.pathname==='/'&&request.method==='GET')return dashboardResponse();
  if((url.pathname==='/static/ui.css'||url.pathname==='/static/ui.js')&&request.method==='GET')return staticResponse(url.pathname);
  if(url.pathname==='/api/readiness'&&request.method==='GET'){
    let d1Connected=false, storedJobCount=null, renderOnline=false;
    let renderHealth='UNVERIFIED', driveStorage='NOT_CONFIGURED';
    try{
      const row=await env.OMDA_DOC_DB.prepare('SELECT COUNT(*) AS total FROM documentary_jobs').first();
      if(Number.isInteger(row?.total)&&row.total>=0){d1Connected=true;storedJobCount=row.total}
    }catch{}
    try{
      const rr=await fetch(UPSTREAM+'/health',{redirect:'manual',
        signal:AbortSignal.timeout(9000)});
      if(rr.ok&&(rr.headers.get('content-type')||'').includes('application/json')){
        const info=await rr.json();
        renderOnline=info?.status==='AVAILABLE';
        renderHealth=typeof info?.status==='string'?info.status.slice(0,40):'UNKNOWN';
        driveStorage=info?.storage==='DRIVE_OAUTH_CONFIGURED'?
          'DRIVE_OAUTH_CONFIGURED':'DRIVE_OAUTH_REQUIRED';
      }
    }catch{}
    const credential=accessBearer(request,env);
    const proof=credential?await upstream(env,'/v1/auth/check','GET',null,credential):null;
    const verified=proof?.ok===true && proof.data?.authenticated===true &&
      ['CLOUDFLARE_ACCESS_JWT','LEGACY_SHARED_SECRET'].includes(proof.data?.method);
    const sharedCredential=typeof env.OMDA_DOC_RUNNER_TOKEN==='string' &&
      env.OMDA_DOC_RUNNER_TOKEN.length>=32;
    return json({mode:'STAGING',d1_connected:d1Connected,
      stored_job_count:storedJobCount,render_online:renderOnline,
      render_health:renderHealth,drive_oauth_state:driveStorage,
      render_shared_token_configured:sharedCredential,
      access_token_available:!!credential,
      authenticated_handshake_verified:verified,
      job_submission_ready:verified && d1Connected && driveStorage==='DRIVE_OAUTH_CONFIGURED',
      publishing_enabled:false,
      paid_generation_enabled:false});
  }
  if(url.pathname==='/api/queue'&&request.method==='GET'){
    try{return json({jobs:await listJobs(env.OMDA_DOC_DB),storage:'D1_PERSISTENT',publishing:false});}
    catch{return json({error:'D1_UNAVAILABLE'},503)}
  }
  const credential=accessBearer(request,env);
  if(!credential)return json({error:'CLOUDFLARE_ACCESS_TOKEN_REQUIRED'},503);
  if(url.pathname==='/api/status'&&request.method==='GET'){
    // Safe read-only handshake: Render verifies Cloudflare signature independently.
    const r=await upstream(env,'/v1/auth/check','GET',null,credential);
    const verified=r.ok&&r.data?.authenticated===true&&
      ['CLOUDFLARE_ACCESS_JWT','LEGACY_SHARED_SECRET'].includes(r.data?.method);
    return json({bridge:'STAGING',render_authenticated:verified,
      render_api_status:verified?'AUTHENTICATED':r.data?.error||'UNAVAILABLE',
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
    let claimed;
    try{claimed=await claimJob(env.OMDA_DOC_DB,data);}
    catch(e){const code=String(e?.message||'D1_UNAVAILABLE');
      return json({error:code==='IDEMPOTENCY_CONFLICT'||code==='JOB_ID_CONFLICT'?code:'D1_UNAVAILABLE'},
        code.endsWith('CONFLICT')?409:503)}
    if(!claimed.new)return json({job_id:claimed.job.job_id,state:claimed.job.state,existing:true,published:false},200);
    const result=await upstream(env,'/v1/documentaries','POST',data,credential);
    if(!result.ok||result.data?.job_id!==data.job_id){
      try{await updateJob(env.OMDA_DOC_DB,data.job_id,'DISPATCH_BLOCKED',null,
        /^RENDER_HTTP_[0-9]{3}$/.test(result.data?.error||'')?result.data.error:'DISPATCH_FAILED')}catch{}
      return safeResult(result.ok?{status:502,data:{error:'UPSTREAM_JOB_ID_MISMATCH'}}:result);
    }
    try{await updateJob(env.OMDA_DOC_DB,data.job_id,normalizeState(result.data?.state),data.job_id)}
    catch{return json({error:'D1_WRITE_FAILED_AFTER_DISPATCH'},503)}
    return safeResult(result);
  }
  const match=url.pathname.match(/^\/api\/jobs\/([A-Za-z0-9_-]{6,100})$/);
  if(match&&request.method==='GET'){
    let row;try{row=await findJob(env.OMDA_DOC_DB,match[1]);}catch{return json({error:'D1_UNAVAILABLE'},503)}
    if(!row)return json({error:'JOB_NOT_FOUND'},404);
    if(!row.remote_job_id||!credential){
      return json({job_id:row.job_id,state:row.state,error_code:row.error_code,published:false});
    }
    if(['FAILED','BLOCKED','READY_FOR_OWNER_REVIEW'].includes(row.state))
      return json({job_id:row.job_id,state:row.state,error_code:row.error_code,published:false});
    const result=await upstream(env,'/v1/documentaries/'+encodeURIComponent(row.remote_job_id),'GET',null,credential);
    if(!result.ok)return json({job_id:row.job_id,state:row.state,
      remote_status:'UNAVAILABLE',published:false,error:'UPSTREAM_CHECK_FAILED'},200);
    const state=normalizeState(result.data?.state);
    try{await updateJob(env.OMDA_DOC_DB,row.job_id,state,row.remote_job_id,
       typeof result.data?.error_code==='string'?result.data.error_code:null)}
    catch{return json({error:'D1_STATUS_UPDATE_FAILED'},503)}
    return json({job_id:row.job_id,state,published:false,
      ...(typeof result.data?.error_code==='string'?{error_code:result.data.error_code.slice(0,70)}:{})});
  }
  return json({error:'NOT_FOUND'},404);
 }
};