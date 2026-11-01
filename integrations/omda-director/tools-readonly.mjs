import {driveBridgeTick} from './drive-bridge.mjs';
// OMDA Agency Tools v1: public read-only sources; no external writes, tokens or public HTTP.
const NOW=()=>new Date().toISOString();
const UA='OMDA-Agency-Research/1.0 (public data; no automated editing)';
const CLEAN=s=>String(s??'').replace(/<[^>]*>/g,'').replace(/[\x00-\x1f]/g,' ').trim();
export function validateQuery(q) {
 if(typeof q!=='string'||q.trim().length<2||q.trim().length>120||/[\x00-\x1f]/.test(q))throw Error('Invalid bounded research query');
 return q.trim();
}
export async function publicResearch(query,transport=fetch){
 const q=validateQuery(query);
 const url='https://en.wikipedia.org/w/rest.php/v1/search/page?q='+encodeURIComponent(q)+'&limit=3';
 const response=await transport(url,{headers:{'Api-User-Agent':UA,'Accept':'application/json'},signal:AbortSignal.timeout(8000)});
 if(response.status!==200)throw Error('Wikipedia HTTP '+response.status);
 const data=await response.json();
 if(!Array.isArray(data.pages))throw Error('Invalid Wikipedia response');
 return data.pages.slice(0,3).map(x=>({title:CLEAN(x.title).slice(0,180),snippet:CLEAN(x.excerpt).slice(0,300),url:'https://en.wikipedia.org/wiki/'+encodeURIComponent(String(x.key||x.title||'').replaceAll(' ','_'))}));
}
export async function githubPublicInfo(transport=fetch){
 const res=await transport('https://api.github.com/repos/imedbensalah99-cmd/APP-AI',{headers:{'Accept':'application/vnd.github+json','User-Agent':UA},signal:AbortSignal.timeout(8000)});
 if(res.status!==200)throw Error('GitHub HTTP '+res.status);
 const body=await res.json();
 if(body.full_name!=='imedbensalah99-cmd/APP-AI')throw Error('Wrong public repository');
 return {repo:body.full_name,default_branch:body.default_branch,updated_at:body.updated_at,html_url:body.html_url};
}
export async function runToolsTick(env,transport=fetch){
 if(!env.DIRECTOR_DB)throw Error('D1 binding missing');
 const db=env.DIRECTOR_DB;const stamp=NOW();const result={github:'ERROR',research:'IDLE',at:stamp};
 try {
  const info=await githubPublicInfo(transport);
  result.github='PASS';
  await db.prepare('INSERT INTO tool_checks(name,status,detail,checked_at) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET status=excluded.status,detail=excluded.detail,checked_at=excluded.checked_at').bind('github_public_read','PASS',JSON.stringify(info).slice(0,600),stamp).run();
 }catch(err){
  await db.prepare('INSERT INTO tool_checks(name,status,detail,checked_at) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET status=excluded.status,detail=excluded.detail,checked_at=excluded.checked_at').bind('github_public_read','ERROR',CLEAN(err?.message).slice(0,180),stamp).run();
 }
 const jobs=(await db.prepare("SELECT id,query FROM research_requests WHERE state='QUEUED' ORDER BY created_at LIMIT 2").all()).results||[];
 for(const job of jobs){
  const claimed=await db.prepare("UPDATE research_requests SET state='RUNNING',updated_at=? WHERE id=? AND state='QUEUED'").bind(stamp,job.id).run();
  if(Number(claimed.meta?.changes||0)!==1)continue;
  try{
   const sources=await publicResearch(job.query,transport);
   await db.prepare("UPDATE research_requests SET state='COMPLETED',result_json=?,updated_at=? WHERE id=? AND state='RUNNING'").bind(JSON.stringify({source:'Wikipedia',sources}).slice(0,3600),NOW(),job.id).run();
   result.research='COMPLETED';
  }catch(err){
   await db.prepare("UPDATE research_requests SET state='FAILED',result_json=?,updated_at=? WHERE id=? AND state='RUNNING'").bind(JSON.stringify({error:CLEAN(err?.message).slice(0,200)}),NOW(),job.id).run();
   result.research='FAILED';
  }
 }
 await db.prepare('INSERT INTO tool_checks(name,status,detail,checked_at) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET status=excluded.status,detail=excluded.detail,checked_at=excluded.checked_at').bind('wikipedia_research',result.research,JSON.stringify({jobs:jobs.length}),NOW()).run();
 return result;
}
export default {async fetch(){return new Response('Not found',{status:404,headers:{'cache-control':'no-store'}});},async scheduled(event,env,ctx){ctx.waitUntil(Promise.all([runToolsTick(env),driveBridgeTick(env)]));}};
