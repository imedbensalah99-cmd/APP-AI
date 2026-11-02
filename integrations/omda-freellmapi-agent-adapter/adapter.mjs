// OMDA AI Agents -> FreeLLMAPI staging readiness adapter v1.
// Strictly read-only; does NOT submit prompts, run agents, write jobs or use provider keys.
const STAGING='https://omda-freellmapi-secure-staging-v1.onrender.com';
const VALID_HOST='omda-freellmapi-secure-staging-v1.onrender.com';
const SAFE_ROUTES=['/api/ping','/v1/models'];
function assertStagingUrl(value){
  const u=new URL(value);
  if(u.protocol!=='https:'||u.hostname!==VALID_HOST||u.port||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('Non-allowlisted FreeLLMAPI origin');
  return u.origin;
}
async function requestCode(fetchFn,origin,route){
  if(!SAFE_ROUTES.includes(route))throw Error('Non-readiness endpoint rejected');
  const res=await fetchFn(origin+route,{method:'GET',redirect:'manual',headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});
  return res.status;
}
async function probeReadiness({origin=STAGING,fetchFn=fetch}={}){
  const host=assertStagingUrl(origin);
  const health=await requestCode(fetchFn,host,'/api/ping');
  const models=await requestCode(fetchFn,host,'/v1/models');
  const ready=health===200 && models===403;
  return {
    origin:'omda-freellmapi-secure-staging-v1',
    healthHttp:health,
    unauthenticatedModelRouteHttp:models,
    originProtected:models===403,
    readiness:ready?'PERIMETER_ONLY':'NOT_READY',
    agentsEnabled:false,
    providerCredentialsVerified:false,
    paidCallsAllowed:false,
    writeCallsAllowed:false,
    nextGate:'Private server-to-server authentication and provider configuration before any agent inference'
  };
}
export {assertStagingUrl,probeReadiness};
