// OMDA FreeLLMAPI agent staging heartbeat (READ ONLY), cron-only.
// Does not call providers, submit prompts, create jobs, publish or spend credits.
const ORIGIN = 'https://omda-freellmapi-secure-staging-v1.onrender.com';
const SAFE_ROUTES = Object.freeze(['/api/ping','/v1/models']);
const MAX_HISTORY=30;
function classify(ping,models) {
  if (ping===200 && models===403) return 'PERIMETER_OK';
  if (models===200) return 'ORIGIN_GATE_OPEN';
  if (ping===0 || models===0) return 'NETWORK_UNAVAILABLE';
  return 'PERIMETER_NOT_READY';
}
async function check(fetcher=fetch) {
  const codes=[];
  for (const route of SAFE_ROUTES) {
    try {
      const response=await fetcher(ORIGIN+route,{
        method:'GET',redirect:'manual',credentials:'omit',
        headers:{Accept:'application/json'},
        signal:AbortSignal.timeout(15000)
      });
      codes.push(Number.isInteger(response.status)?response.status:0);
    } catch { codes.push(0); }
  }
  const [ping,models]=codes;
  return {healthCode:ping,modelsCode:models,state:classify(ping,models)};
}
async function run(env,fetcher=fetch,now=()=>new Date().toISOString()){
  if(!env?.CHECK_DB) throw Error('CHECK_DB missing');
  const state=await check(fetcher);
  const stamp=now();
  await env.CHECK_DB.batch([
    env.CHECK_DB.prepare('INSERT INTO agent_checks(id,created_at,health_http,model_http,verdict) VALUES(?,?,?,?,?)')
      .bind(crypto.randomUUID(),stamp,state.healthCode,state.modelsCode,state.state),
    env.CHECK_DB.prepare('DELETE FROM agent_checks WHERE id NOT IN (SELECT id FROM agent_checks ORDER BY created_at DESC, rowid DESC LIMIT ?)')
      .bind(MAX_HISTORY)
  ]);
  return {...state,at:stamp,agentInferenceAllowed:false,paidAllowed:false,publishAllowed:false};
}
export default {
  async fetch(){return new Response('Not found',{status:404,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});},
  async scheduled(_controller,env,ctx){ctx.waitUntil(run(env));}
};
export {check,run,classify};
