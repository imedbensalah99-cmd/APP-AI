// OMDA FreeLLMAPI Agents — owner-only Task API (not deployed).
// Durable state transitions only; no provider calls, sends or public publishing.
import {classify} from '../omda-freellmapi-artifact-factory/engine.mjs';
import {createAccessVerifier} from './access.mjs';
const HEADERS={'Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
  'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'",
  'Vary':'Cf-Access-Jwt-Assertion'};
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const VALID_IDEMPOTENCY=/^[A-Za-z0-9._:-]{8,128}$/;
const MAX_BODY=8192;
const SELECT_TASK='SELECT task_id,status,original_command,intent_json,priority,checkpoint_version,cancel_requested,created_at,updated_at,request_digest_sha256 FROM omda_task_tasks';
function reply(status,body,extra={}){return new Response(JSON.stringify(body),{status,headers:{...HEADERS,...extra}});}
function view(row){return row?{id:row.task_id,status:row.status,command:row.original_command,
  intents:JSON.parse(row.intent_json),priority:row.priority,version:row.checkpoint_version,
  cancelRequested:row.cancel_requested===1,createdAt:row.created_at,updatedAt:row.updated_at}:null;}
function etag(version){return '"v'+version+'"';}
function parseIfMatch(h){return typeof h==='string'&&/^"v[1-9]\d{0,8}"$/.test(h)?Number(h.slice(2,-1)):null;}
function hash(text){return crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))
  .then(b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join(''));}
async function readBoundedJson(req){
  const header=req.headers.get('content-length');
  if(header && (!/^\d+$/.test(header)||Number(header)>MAX_BODY))throw Error('Invalid length');
  if((req.headers.get('content-type')||'').split(';')[0].trim().toLowerCase()!=='application/json')
    throw Error('Invalid content type');
  if(!req.body)throw Error('Missing body');
  const reader=req.body.getReader(),parts=[];let total=0;
  try{
    while(true){const {done,value}=await reader.read();if(done)break;
      total+=value.byteLength;if(total>MAX_BODY){await reader.cancel();throw Error('Oversized body');}
      parts.push(value);}
  }finally{reader.releaseLock();}
  const joined=new Uint8Array(total);let offset=0;
  for(const bytes of parts){joined.set(bytes,offset);offset+=bytes.length;}
  const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(joined));
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('Invalid payload');
  return parsed;
}
function parseCreate(data){
  if(Object.keys(data).some(k=>!['command','priority'].includes(k)))throw Error('Unexpected field');
  if(typeof data.command!=='string'||data.command.trim().length<3||data.command.length>2500||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(data.command))throw Error('Invalid command');
  if(data.priority!==undefined&&(!Number.isInteger(data.priority)||data.priority<0||data.priority>5))
    throw Error('Invalid priority');
  return {command:data.command.trim(),priority:data.priority??3};
}
// Atomic, per-owner limit: 30 authenticated API calls per UTC minute.
// One row per owner, not a growing per-request log; D1 conditional UPSERT is concurrency-safe.
async function chargeRateLimit(db,owner,at=Date.now()){
  const bucket=Math.floor(at/60000),now=new Date(at).toISOString();
  const row=await db.prepare(
    'INSERT INTO omda_task_request_limits(owner_scope,minute_bucket,consumed,updated_at) '+
    'VALUES(?,?,1,?) ON CONFLICT(owner_scope) DO UPDATE SET '+
    'consumed=CASE WHEN minute_bucket=excluded.minute_bucket THEN consumed+1 ELSE 1 END,'+
    'minute_bucket=excluded.minute_bucket,updated_at=excluded.updated_at '+
    'WHERE minute_bucket<>excluded.minute_bucket OR consumed<30 RETURNING consumed')
    .bind(owner,bucket,now).first();
  return Boolean(row);
}
const find=(db,id,owner)=>db.prepare(SELECT_TASK+' WHERE task_id=? AND owner_scope=? LIMIT 1').bind(id,owner).first();
async function create(req,db,owner){
  const idem=req.headers.get('idempotency-key');
  if(!VALID_IDEMPOTENCY.test(idem||''))return reply(400,{error:'idempotency_key_required'});
  let parsed;try{parsed=parseCreate(await readBoundedJson(req));}catch{return reply(400,{error:'invalid_request'});}
  const intents=classify(parsed.command),digest=await hash(JSON.stringify({...parsed,intents}));
  const id=crypto.randomUUID(),now=new Date().toISOString();
  // Atomic insert and event; a duplicate idempotency key never creates a second task.
  await db.batch([
    db.prepare('INSERT INTO omda_task_tasks '+
      '(task_id,owner_scope,idempotency_key,request_digest_sha256,original_command,intent_json,'+
      'status,priority,created_at,updated_at) VALUES(?,?,?,?,?,?,'+"'PLANNED'"+',?,?,?) '+
      'ON CONFLICT(owner_scope,idempotency_key) DO NOTHING')
      .bind(id,owner,idem,digest,parsed.command,JSON.stringify(intents),parsed.priority,now,now),
    db.prepare('INSERT INTO omda_task_audit '+
      '(event_id,owner_scope,task_id,event_type,context_redacted_json,recorded_at) '+
      "SELECT ?,owner_scope,task_id,'task.created','{}',? FROM omda_task_tasks "+
      'WHERE task_id=? AND owner_scope=?').bind(crypto.randomUUID(),now,id,owner)
  ]);
  const row=await db.prepare(SELECT_TASK+' WHERE owner_scope=? AND idempotency_key=? LIMIT 1')
    .bind(owner,idem).first();
  if(!row)return reply(503,{error:'task_unavailable'});
  if(row.request_digest_sha256!==digest)return reply(409,{error:'idempotency_conflict'});
  return reply(row.task_id===id?201:200,{task:view(row),executedActions:[],
    notice:'Plan stored only. No provider or external actions executed.'},{ETag:etag(row.checkpoint_version)});
}
async function list(db,owner){
  const data=await db.prepare(SELECT_TASK+
    ' WHERE owner_scope=? ORDER BY created_at DESC,task_id DESC LIMIT 25').bind(owner).all();
  return reply(200,{tasks:(data.results||[]).map(view),limit:25,mode:'PLAN_ONLY'});
}
async function inspect(db,id,owner){
  const row=await find(db,id,owner);
  return row?reply(200,{task:view(row),mode:'PLAN_ONLY'},{ETag:etag(row.checkpoint_version)})
    :reply(404,{error:'not_found'});
}
async function events(db,id,owner){
  if(!(await find(db,id,owner)))return reply(404,{error:'not_found'});
  const data=await db.prepare('SELECT event_id,event_type,context_redacted_json,recorded_at '+
    'FROM omda_task_audit WHERE task_id=? AND owner_scope=? '+
    'ORDER BY recorded_at DESC,event_id DESC LIMIT 50').bind(id,owner).all();
  return reply(200,{events:(data.results||[]).map(x=>({id:x.event_id,type:x.event_type,
    context:JSON.parse(x.context_redacted_json),at:x.recorded_at}))});
}
async function transition(req,db,owner,id,op){
  const match=parseIfMatch(req.headers.get('if-match'));
  if(match===null)return reply(428,{error:'version_required'});
  if(req.body)return reply(400,{error:'body_not_allowed'});
  const current=await find(db,id,owner);
  if(!current)return reply(404,{error:'not_found'});
  if(match!==current.checkpoint_version)return reply(412,{error:'version_conflict'});
  let state=current.status,cancel=current.cancel_requested;
  if(op==='pause'){
    if(!['PLANNED','QUEUED','RETRYABLE_FAILURE'].includes(state))
      return reply(409,{error:'transition_not_permitted'});
    state='PAUSED';
  }else if(op==='resume'){
    if(state!=='PAUSED')return reply(409,{error:'transition_not_permitted'});
    state='PLANNED';
  }else if(op==='cancel'){
    if(['CANCELED','COMPLETED','FAILED'].includes(state))
      return reply(409,{error:'transition_not_permitted'});
    cancel=1;
    if(state!=='RUNNING')state='CANCELED';
  }else return reply(404,{error:'not_found'});
  const now=new Date().toISOString(),newVersion=match+1;
  const action=op==='cancel'&&state==='RUNNING'?'task.cancel_requested':'task.'+op;
  const context=JSON.stringify({from:current.status,to:state,cancelRequested:cancel===1});
  const result=await db.batch([
    db.prepare('UPDATE omda_task_tasks SET status=?,cancel_requested=?,'+
      'checkpoint_version=checkpoint_version+1,updated_at=? '+
      'WHERE task_id=? AND owner_scope=? AND status=? AND checkpoint_version=? RETURNING task_id')
      .bind(state,cancel,now,id,owner,current.status,match),
    db.prepare('INSERT INTO omda_task_audit '+
      '(event_id,owner_scope,task_id,event_type,context_redacted_json,recorded_at) '+
      'SELECT ?,owner_scope,task_id,?,?,? FROM omda_task_tasks '+
      'WHERE task_id=? AND owner_scope=? AND checkpoint_version=? AND status=?')
      .bind(crypto.randomUUID(),action,context,now,id,owner,newVersion,state)
  ]);
  if(!result?.[0]?.results?.length)return reply(412,{error:'version_conflict'});
  const updated=await find(db,id,owner);
  return reply(state==='RUNNING'?202:200,{task:view(updated),
    note:state==='RUNNING'?'Cancellation requested; acknowledgement pending.':
      'State updated; no external action executed.'},{ETag:etag(updated.checkpoint_version)});
}
function createTaskApi({verifyAccess=createAccessVerifier()}={}){
  return {async fetch(req,env){
    const auth=await verifyAccess(req,env);
    if(!auth.ok)return reply(auth.status,{error:auth.status===503?'access_not_configured':'unauthorized'});
    if(!env?.TASK_DB || typeof env.TASK_DB.prepare!=='function'||typeof env.TASK_DB.batch!=='function')
      return reply(503,{error:'database_not_configured'});
    try{if(!await chargeRateLimit(env.TASK_DB,auth.owner))
      return reply(429,{error:'rate_limited'}, {'Retry-After':'60'});
    }catch{return reply(503,{error:'task_backend_unavailable'});}
    const url=new URL(req.url);
    if(url.search||url.hash)return reply(400,{error:'unsupported_query'});
    if(!['GET','POST'].includes(req.method))return reply(405,{error:'method_not_allowed'});
    if(req.method==='POST'&&req.headers.get('origin')!==auth.config.allowedOrigin)
      return reply(403,{error:'origin_denied'});
    try{
      if(url.pathname==='/api/me'&&req.method==='GET')
        return reply(200,{authenticated:true,scope:'owner',project:'omda-freellmapi-agents'});
      if(url.pathname==='/api/tasks'){
        if(req.method==='POST')return await create(req,env.TASK_DB,auth.owner);
        if(req.method==='GET')return await list(env.TASK_DB,auth.owner);
      }
      const parts=/^\/api\/tasks\/([a-f0-9-]{36})(?:\/(events|pause|resume|cancel))?$/.exec(url.pathname);
      if(!parts||!UUID.test(parts[1]))return reply(404,{error:'not_found'});
      const id=parts[1],op=parts[2];
      if(req.method==='GET'&&!op)return await inspect(env.TASK_DB,id,auth.owner);
      if(req.method==='GET'&&op==='events')return await events(env.TASK_DB,id,auth.owner);
      if(req.method==='POST'&&['pause','resume','cancel'].includes(op))
        return await transition(req,env.TASK_DB,auth.owner,id,op);
      return reply(405,{error:'method_not_allowed'});
    }catch{return reply(503,{error:'task_backend_unavailable'});}
  }};
}
export default createTaskApi();
export {createTaskApi,parseCreate,parseIfMatch,readBoundedJson,chargeRateLimit};
