// Cloudflare-to-GitHub optional outbound tool. NOT enabled in deployed Director v1.
// Github fine-grained token should have Actions:write for APP-AI only.
// Workflows must exist on GitHub default branch before workflow_dispatch is available.
const API='https://api.github.com/repos/imedbensalah99-cmd/APP-AI/actions/workflows/omda-agent-build.yml/dispatches';
export async function dispatchGithubBuild(env, params, transport=fetch){
 if(env?.OMDA_GITHUB_BUILD_ENABLED!=='true')return {status:'DISABLED'};
 if(!env?.OMDA_GITHUB_TOKEN)return {status:'NOT_CONFIGURED'};
 if(!params || params.task!=='create_static_preview')throw Error('Task not allowlisted');
 const title=params.title,description=params.description;
 for(const [name,v,max] of [['title',title,80],['description',description,500]]){
  if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x1F]/.test(v))throw Error('Invalid '+name);
 }
 const response=await transport(API,{
  method:'POST',
  headers:{'Authorization':'Bearer '+env.OMDA_GITHUB_TOKEN,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json','User-Agent':'omda-director-safe-pilot'},
  body:JSON.stringify({ref:'main',inputs:{title,description}}),
 });
 return response.status===204?{status:'ACCEPTED',workflow:'omda-agent-build.yml'}:{status:'FAILED',httpStatus:response.status};
}
