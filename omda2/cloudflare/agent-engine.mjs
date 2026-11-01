// OMDA 2: real AI task engine, behind authentication and explicit no-spend launch gate.
// This is NOT Paperclip. It is a future task/model adapter which Paperclip can call.
const MODEL='@cf/meta/llama-3.2-1b-instruct';
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','access-control-allow-origin':'null'}});
const digest=async s=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
async function authorized(req,env){
  if(typeof env.ADMIN_TOKEN!=='string'||env.ADMIN_TOKEN.length<32)return false;
  const v=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
  if(v.length<32||v.length>256)return false;
  const [a,b]=await Promise.all([digest(env.ADMIN_TOKEN),digest(v)]);
  let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
export default {async fetch(req,env){
  const path=new URL(req.url).pathname;
  if(req.method==='GET'&&path==='/healthz')return reply({service:'omda2-agent-engine',ai:!!env.AI,d1:!!env.TASK_DB,enabled:env.RUN_ENABLED==='true'});
  if(!env.ADMIN_TOKEN)return reply({error:'admin_setup_required'},503);
  if(!(await authorized(req,env)))return reply({error:'unauthorized'},401);
  if(!env.TASK_DB)return reply({error:'d1_binding_missing'},503);
  if(req.method==='GET'&&path==='/v1/status'){
    const day=new Date().toISOString().slice(0,10);
    const n=await env.TASK_DB.prepare('SELECT calls FROM daily_limits WHERE day=?').bind(day).first();
    return reply({model:MODEL,enabled:env.RUN_ENABLED==='true',calls_today:n?.calls||0,hard_call_limit:4});
  }
  if(req.method==='GET'&&path==='/v1/runs'){
    const x=await env.TASK_DB.prepare('SELECT id,role,task,status,model,result,error,created_at,finished_at FROM agent_runs ORDER BY created_at DESC LIMIT 20').all();
    return reply({runs:x.results||[]});
  }
  if(req.method==='POST'&&path==='/v1/tasks'){
    if(env.RUN_ENABLED!=='true')return reply({error:'inference_disabled',reason:'Billing and free quota must be verified first.'},423);
    if(!env.AI)return reply({error:'model_binding_missing'},503);
    if(!(req.headers.get('content-type')||'').includes('application/json'))return reply({error:'json_required'},415);
    const raw=await req.text();if(raw.length>1800)return reply({error:'large_payload'},413);
    let input;try{input=JSON.parse(raw);}catch{return reply({error:'invalid_json'},400);}
    const role=input?.role;const task=typeof input?.task==='string'?input.task.trim():'';
    if(!['research','qa'].includes(role)||!task||task.length>500)return reply({error:'invalid_task'},400);
    const day=new Date().toISOString().slice(0,10);
    const budget=await env.TASK_DB.prepare("INSERT INTO daily_limits(day,calls,last_at) VALUES(?,1,datetime('now')) ON CONFLICT(day) DO UPDATE SET calls=calls+1,last_at=datetime('now') WHERE calls < 4 RETURNING calls").bind(day).first();
    if(!budget)return reply({error:'daily_limit'},429);
    const id=crypto.randomUUID();
    await env.TASK_DB.prepare("INSERT INTO agent_runs(id,role,task,status,model,started_at) VALUES(?,?,?,'running',?,datetime('now'))").bind(id,role,task,MODEL).run();
    await env.TASK_DB.prepare('INSERT INTO audit_events(run_id,event,detail) VALUES(?,?,?)').bind(id,'started',role).run();
    try{
      const system=role==='research'?
        'You are OMDA 2 Research. Produce a concise useful DRAFT about the supplied public topic. No fabricated sources, no false claims about web access, no secrets, no external actions.':
        'You are OMDA 2 QA. Check the supplied text for internal contradictions, uncertainty and unsupported factual claims. Do not pretend to have browsed sources. Return PASS or NEEDS_REVIEW with precise reasons.';
      const response=await env.AI.run(MODEL,{messages:[{role:'system',content:system},{role:'user',content:task}],max_tokens:320,temperature:0.2});
      const out=String(response?.response||response?.result?.response||'').trim();
      if(!out)throw Error('empty_response');
      await env.TASK_DB.prepare("UPDATE agent_runs SET status='completed',result=?,finished_at=datetime('now') WHERE id=?").bind(out,id).run();
      await env.TASK_DB.prepare('INSERT INTO audit_events(run_id,event,detail) VALUES(?,?,?)').bind(id,'completed',MODEL).run();
      return reply({id,role,model:MODEL,status:'completed',output:out});
    }catch(e){
      await env.TASK_DB.prepare("UPDATE agent_runs SET status='failed',error='AI unavailable',finished_at=datetime('now') WHERE id=?").bind(id).run();
      await env.TASK_DB.prepare('INSERT INTO audit_events(run_id,event,detail) VALUES(?,?,?)').bind(id,'failed','AI unavailable').run();
      return reply({id,status:'failed',error:'AI unavailable'},502);
    }
  }
  return reply({error:'not_found'},404);
}};