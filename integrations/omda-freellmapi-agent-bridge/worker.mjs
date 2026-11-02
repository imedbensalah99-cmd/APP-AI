// OMDA AI Company — FreeLLMAPI Agent Bridge (STAGING ONLY)
// Isolated: never changes or calls OMDA Director, OMDA 2, media, or publication.
// Fail closed until 3 server-side secrets and all enable flags are explicitly set.
// State guard: Cloudflare D1 atomic daily/minute quotas. No cron; no provider spend by default.
const ORIGIN = 'https://omda-freellmapi-secure-staging-v1.onrender.com';
const MODEL = 'openai/gpt-oss-20b';
const PATH = '/agent/chat';
const DAILY = 10;
const PER_MINUTE = 1;
const MAX_REQUEST_BYTES = 3072;
const MAX_TEXT_CHARS = 1000;
const MAX_OUTPUT_TOKENS = 128;
const HEADERS = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
function reply(status, body) { return new Response(JSON.stringify(body),{status,headers:{...HEADERS,'Content-Type':'application/json; charset=utf-8'}}); }
function ready(env) {
  return env?.OMDA_AGENT_ENABLED==='true' &&
    env?.OMDA_FREE_ONLY_CONFIRMED==='true' &&
    env?.OMDA_PROVIDER_SCOPE==='groq:openai/gpt-oss-20b' &&
    typeof env?.OMDA_BRIDGE_TOKEN==='string' && /^[a-f0-9]{64}$/i.test(env.OMDA_BRIDGE_TOKEN) &&
    typeof env?.OMDA_CLIENT_KEY==='string' && /^sk-cp-[a-f0-9]{48}$/.test(env.OMDA_CLIENT_KEY) &&
    typeof env?.OMDA_ORIGIN_TOKEN==='string' && env.OMDA_ORIGIN_TOKEN.length>=48 &&
    !!env?.QUOTA_DB;
}
async function authorized(req, token) {
  const auth=req.headers.get('authorization')||'';
  if(!/^Bearer [a-f0-9]{64}$/i.test(auth))return false;
  const encoder=new TextEncoder();
  const [a,b]=await Promise.all([crypto.subtle.digest('SHA-256',encoder.encode(auth.slice(7))),crypto.subtle.digest('SHA-256',encoder.encode(token))]);
  const aa=new Uint8Array(a),bb=new Uint8Array(b);
  let mismatch=0;for(let i=0;i<aa.length;i++)mismatch|=aa[i]^bb[i];
  return mismatch===0;
}
async function boundedBody(req){
  if((req.headers.get('content-type')||'').split(';')[0].trim()!=='application/json')return {error:'content_type'};
  const length=req.headers.get('content-length');
  if(length&&(!/^\d+$/.test(length)||Number(length)>MAX_REQUEST_BYTES))return {error:'too_large'};
  if(!req.body)return {error:'empty'};
  const reader=req.body.getReader();let count=0;const data=[];
  try {
    while(true){const {done,value}=await reader.read();if(done)break;
      count+=value.byteLength;if(count>MAX_REQUEST_BYTES){await reader.cancel();return {error:'too_large'};}
      data.push(value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(count);let off=0;for(const c of data){bytes.set(c,off);off+=c.length;}
  let json;try{json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return{error:'json'};}
  if(!json||typeof json!=='object'||Array.isArray(json)||Object.keys(json).sort().join(',')!=='task')return{error:'schema'};
  if(typeof json.task!=='string'||json.task.trim().length===0||json.task.length>MAX_TEXT_CHARS||/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(json.task))return{error:'task'};
  return {task:json.task.trim()};
}
async function reserveQuota(db,stamp){
  const iso=stamp.toISOString(),day=iso.slice(0,10),minute=iso.slice(0,16);
  const statement=`INSERT INTO agent_quotas(day,minute,daily_count,minute_count) VALUES(?,?,1,1)
    ON CONFLICT(day) DO UPDATE SET
      minute=excluded.minute,
      daily_count=agent_quotas.daily_count+1,
      minute_count=CASE WHEN agent_quotas.minute=excluded.minute THEN agent_quotas.minute_count+1 ELSE 1 END
    WHERE agent_quotas.daily_count < ? AND
      (agent_quotas.minute <> excluded.minute OR agent_quotas.minute_count < ?)
    RETURNING daily_count,minute_count`;
  const row=await db.prepare(statement).bind(day,minute,DAILY,PER_MINUTE).first();
  return !!row && row.daily_count<=DAILY && row.minute_count<=PER_MINUTE;
}
async function handle(request,env,fetcher=fetch,now=()=>new Date()){
  const pathname=new URL(request.url).pathname;
  if(pathname!==PATH)return reply(404,{error:'not_found'});
  if(request.method!=='POST')return reply(405,{error:'method_not_allowed'});
  if(!ready(env))return reply(503,{error:'bridge_disabled'});
  if(!(await authorized(request,env.OMDA_BRIDGE_TOKEN)))return reply(401,{error:'unauthorized'});
  const body=await boundedBody(request);
  if(body.error)return reply(400,{error:'invalid_request'});
  if(!(await reserveQuota(env.QUOTA_DB,now())))return reply(429,{error:'daily_or_minute_quota',retry_after_seconds:60});
  const outbound={
    model:MODEL,
    stream:false,
    max_tokens:MAX_OUTPUT_TOKENS,
    temperature:0.2,
    messages:[
      {role:'system',content:'You are an internal staging analyst. Only answer the user task briefly. Do not request tools, browsing, payments, credentials, publishing or automation.'},
      {role:'user',content:body.task}
    ]
  };
  try{
    const response=await fetcher(ORIGIN+'/v1/chat/completions',{
      method:'POST',redirect:'manual',
      headers:{
        'content-type':'application/json',
        'authorization':'Bearer '+env.OMDA_CLIENT_KEY,
        'x-omda-origin-token':env.OMDA_ORIGIN_TOKEN
      },
      body:JSON.stringify(outbound),
      signal:AbortSignal.timeout(20000)
    });
    if(response.status!==200)return reply(502,{error:'upstream_unavailable',http_status:response.status});
    // Do not relay unbounded body. Reject model substitutions.
    const length=response.headers.get('content-length');
    if(length&&Number(length)>16384)return reply(502,{error:'upstream_response_too_large'});
    const raw=await response.text();
    if(raw.length>16384)return reply(502,{error:'upstream_response_too_large'});
    const parsed=JSON.parse(raw);
    if(parsed.model!==MODEL || !Array.isArray(parsed.choices))return reply(502,{error:'upstream_model_mismatch'});
    const answer=parsed.choices[0]?.message?.content;
    if(typeof answer!=='string')return reply(502,{error:'unexpected_upstream_payload'});
    return reply(200,{model:MODEL,answer:answer.slice(0,3000),staging:true});
  }catch{return reply(502,{error:'upstream_unavailable'});}
}
export default {fetch:handle};
export {handle,ready,boundedBody,reserveQuota,MODEL,PATH};
