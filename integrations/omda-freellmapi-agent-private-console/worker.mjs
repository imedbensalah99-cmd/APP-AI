// OMDA AI Agent — internal owner test runner (STAGING, disabled by default).
// Source-only until private service binding, two independent secrets and owner-only
// Cloudflare Access entrypoint are provisioned. No public URL, Cron or inference.
const MODEL='openai/gpt-oss-20b';
const ROUTE='/agent/test';
const BRIDGE_URL='https://agent.internal/agent/chat';
const HEADERS={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const response=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
function ready(env){
 return env?.OMDA_PRIVATE_TEST_ENABLED==='true'
   && typeof env?.OMDA_PRIVATE_TEST_TOKEN==='string'
   && /^[a-f0-9]{64}$/i.test(env.OMDA_PRIVATE_TEST_TOKEN)
   && typeof env?.OMDA_BRIDGE_TOKEN==='string'
   && /^[a-f0-9]{64}$/i.test(env.OMDA_BRIDGE_TOKEN)
   && typeof env?.AGENT_BRIDGE?.fetch==='function';
}
async function authOK(value,expected){
 const match=/^Bearer ([a-f0-9]{64})$/i.exec(value||'');
 if(!match)return false;
 const enc=new TextEncoder();
 const [a,b]=await Promise.all([
  crypto.subtle.digest('SHA-256',enc.encode(match[1])),
  crypto.subtle.digest('SHA-256',enc.encode(expected))
 ]);
 const x=new Uint8Array(a),y=new Uint8Array(b);
 let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];
 return diff===0;
}
async function run(request,env){
 if(new URL(request.url).pathname!==ROUTE)return response(404,{error:'not_found'});
 if(request.method!=='POST')return response(405,{error:'method_not_allowed'});
 if(!ready(env))return response(503,{error:'test_runner_disabled'});
 if(!(await authOK(request.headers.get('authorization'),env.OMDA_PRIVATE_TEST_TOKEN)))
  return response(401,{error:'unauthorized'});
 if((request.headers.get('content-type')||'').split(';')[0]!=='application/json')
  return response(400,{error:'invalid_request'});
 if(Number(request.headers.get('content-length')||'0')>512)
  return response(400,{error:'invalid_request'});
 let input;
 try{const text=await request.text();if(text.length>512)throw Error('too_large');input=JSON.parse(text);}
 catch{return response(400,{error:'invalid_request'});}
 if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).sort().join(',')!=='task'||
    typeof input.task!=='string'||input.task.trim().length<1||
    input.task.length>160||/[\u0000-\u001f]/.test(input.task))
  return response(400,{error:'invalid_request'});
 try{
  const res=await env.AGENT_BRIDGE.fetch(BRIDGE_URL,{
   method:'POST',redirect:'manual',
   headers:{'authorization':'Bearer '+env.OMDA_BRIDGE_TOKEN,'content-type':'application/json'},
   body:JSON.stringify({task:input.task.trim()}),
   signal:AbortSignal.timeout(25000)
  });
  if(res.status!==200)return response(502,{error:'agent_unavailable',http_status:res.status});
  const raw=await res.text();
  if(raw.length>8192)return response(502,{error:'unexpected_response'});
  const parsed=JSON.parse(raw);
  if(parsed.model!==MODEL||parsed.staging!==true||typeof parsed.answer!=='string')
   return response(502,{error:'unexpected_response'});
  return response(200,{model:MODEL,answer:parsed.answer.slice(0,1000),staging:true});
 }catch{return response(502,{error:'agent_unavailable'});}
}
export default {fetch:run};
export {run,ready,authOK,MODEL,ROUTE};
