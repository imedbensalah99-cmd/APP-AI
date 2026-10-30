// OMDA MoneyPrinter 60 — isolated owner-only draft queue.
// Never dispatches generation, never publishes; DB is independent of production.
const ISSUER = "https://super-mode-8f54.cloudflareaccess.com";
const AUD = "8702c89851c132f8f441358083aae78d706777c646c658e6371281fbd00fbf20";
// Owner identity is bound securely from Cloudflare secret OMDA_OWNER_EMAIL.
const HOST = "omda-moneyprinter60-queue.imedbensalah9988.workers.dev";
const PROOF = "https://omda-moneyprinter-60-readonly.imedbensalah9988.workers.dev/v1/proof";
const security = {"Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer","X-Frame-Options":"DENY"};
let certificates;
let certificatesExpires = 0;
function json(data,status=200){return new Response(JSON.stringify(data),{status,
  headers:{...security,"Content-Type":"application/json; charset=utf-8"}});}
function b64url(s){
  if(!/^[A-Za-z0-9_-]*$/.test(s))throw Error("bad base64url");
  const fixed=s.replace(/-/g,"+").replace(/_/g,"/");
  const decoded=atob(fixed+"=".repeat((4-fixed.length%4)%4));
  return Uint8Array.from(decoded,c=>c.charCodeAt(0));
}
async function jwks(){
  if(certificates && Date.now()<certificatesExpires)return certificates;
  const r=await fetch(ISSUER+"/cdn-cgi/access/certs",{redirect:"error"});
  if(!r.ok)throw Error("certificates_unavailable");
  const data=await r.json();
  if(!Array.isArray(data.keys)||!data.keys.length)throw Error("invalid_jwks");
  certificates=data.keys;
  certificatesExpires=Date.now()+300000;
  return certificates;
}
async function authorize(request,env){
  const token=request.headers.get("Cf-Access-Jwt-Assertion")||"";
  if(token.length>8192||token.length<100)throw Error("not_authorized");
  const parts=token.split(".");
  if(parts.length!==3)throw Error("not_authorized");
  const header=JSON.parse(new TextDecoder().decode(b64url(parts[0])));
  const payload=JSON.parse(new TextDecoder().decode(b64url(parts[1])));
  const now=Math.floor(Date.now()/1000);
  const validAudience=payload.aud===AUD||(Array.isArray(payload.aud)&&payload.aud.includes(AUD));
  if(header.alg!=="RS256"||typeof header.kid!=="string"||
     payload.iss!==ISSUER||!validAudience||String(payload.email||"").toLowerCase()!==String(env.OMDA_OWNER_EMAIL||"").toLowerCase()||
     typeof payload.exp!=="number"||payload.exp<=now||payload.exp>now+14*3600||
     typeof payload.iat!=="number"||payload.iat>now+60||
     (typeof payload.nbf==="number"&&payload.nbf>now+60))throw Error("not_authorized");
  const keys=await jwks();
  const key=keys.find(x=>x.kid===header.kid&&x.kty==="RSA"&&x.alg!=="HS256");
  if(!key)throw Error("not_authorized");
  const imported=await crypto.subtle.importKey("jwk",key,
    {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  const ok=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",imported,
    b64url(parts[2]),new TextEncoder().encode(parts[0]+"."+parts[1]));
  if(!ok)throw Error("not_authorized");
  return true;
}
function checkWrite(request,action){
  if(request.headers.get("Origin")!=="https://"+HOST||
     request.headers.get("X-OMDA-Action")!==action||
     !/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type")||""))
    throw Error("write_denied");
}
const PAGE = [
'<!doctype html><html lang="en"><head><meta charset="utf-8">',
'<meta name="viewport" content="width=device-width,initial-scale=1">',
'<meta name="color-scheme" content="dark"><title>OMDA // MoneyPrinter 60</title>',
'<style>*{box-sizing:border-box}body{margin:0;background:#080e1a;color:#e8eef9;font:15px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}',
'body:before{content:"";pointer-events:none;position:fixed;inset:0;background:radial-gradient(ellipse at 80% -10%,#19376365,transparent 52%),radial-gradient(ellipse at -10% 90%,#123d444a,transparent 55%)}',
'.shell{position:relative;max-width:1080px;margin:auto;padding:26px 20px 75px}',
'.top{display:flex;align-items:center;justify-content:space-between;gap:18px;border-bottom:1px solid #ffffff18;padding-bottom:20px}',
'.brand{font-weight:800;letter-spacing:.15em;font-size:24px}.brand small{font-size:10px;font-weight:600;letter-spacing:.25em;display:block;color:#81afc2}',
'.pill{border:1px solid #589c87;padding:5px 13px;border-radius:99px;color:#9fe4c8;font-size:12px}',
'h1{font-size:clamp(30px,6vw,60px);line-height:1.06;margin:54px 0 12px;letter-spacing:-.045em}',
'h1 span{color:#80a9e5}.intro{color:#a4b6ca;max-width:710px;margin-bottom:32px}',
'.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}',
'.card,.panel{background:#101b2cb8;border:1px solid #7c9dbe25;border-radius:19px;padding:23px;backdrop-filter:blur(14px)}',
'.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:#8da8c8}',
'.metric{font-size:24px;font-weight:760;margin-top:5px}.muted{color:#91a7c1;font-size:13px}',
'.grid{display:grid;grid-template-columns:1.2fr .8fr;gap:17px;margin-top:19px}',
'.panel h2{margin:0 0 16px;font-size:18px}label{display:block;margin:14px 0 6px;font-size:13px;color:#c1d3e9}',
'input,textarea{display:block;width:100%;padding:12px 14px;border-radius:11px;border:1px solid #3b5877;background:#0a1424;color:#e8f3ff;font:inherit}',
'textarea{resize:vertical;min-height:170px;direction:auto}button,.button{display:inline-block;background:#7daaf1;color:#05111d;border:0;border-radius:10px;padding:12px 16px;font-weight:750;font:inherit;cursor:pointer;text-decoration:none}',
'button[disabled]{opacity:.45;cursor:default}.actions{margin-top:17px;display:flex;align-items:center;gap:11px;flex-wrap:wrap}',
'.list{display:grid;gap:10px}.job{border-radius:12px;border:1px solid #42618766;background:#0b1727;padding:13px 15px}',
'.job strong{display:block;font-size:14px}.job small{color:#92a8bd}.status{color:#a6dbce;font-weight:700}',
'.note{font-size:12px;border-left:3px solid #b4905b;color:#bfcce0;padding:11px 14px;background:#2e2b292b;margin-top:17px}',
'.link{color:#a4c6ff}footer{margin-top:34px;color:#8397ab;font-size:12px}',
'@media(max-width:790px){.cards{grid-template-columns:1fr 1fr}.grid{grid-template-columns:1fr}}',
'@media(max-width:520px){.cards{grid-template-columns:1fr}.top{align-items:flex-start}.pill{font-size:10px}}',
'</style></head><body><div class="shell"><header class="top">',
'<div class="brand">OMDA<small>MONEYPRINTER / 60S</small></div>',
'<span class="pill">OWNER ONLY · SECURE STAGING</span></header>',
'<h1>Stories in motion.<br><span>Built in the cloud.</span></h1>',
'<p class="intro">Your private video-operations workspace. Prepare original SARDERA stories, track real MoneyPrinterTurbo render tests, and keep every publishing action under your control.</p>',
'<section class="cards"><div class="card"><div class="eyebrow">Video specification</div><div class="metric">60 sec</div><div class="muted">1080×1920 · Arabic</div></div>',
'<div class="card"><div class="eyebrow">Cloud rendering</div><div id="proof" class="metric">Checking…</div><div class="muted">GitHub Actions · MoneyPrinterTurbo</div></div>',
'<div class="card"><div class="eyebrow">Publishing policy</div><div class="metric">Locked</div><div class="muted">No credits spent · Review first</div></div></section>',
'<div class="grid"><section class="panel"><h2>Create an original story draft</h2>',
'<form id="f"><label for="title">Story title</label><input id="title" maxlength="120" minlength="5" required placeholder="رسالة وصلت بعد عشرين عاماً">',
'<label for="script">Arabic narration script</label><textarea id="script" minlength="100" maxlength="2500" required placeholder="اكتب قصة أصلية بالعربية..."></textarea>',
'<div class="actions"><button id="save" type="submit">Save secure draft</button><span class="muted" id="message">Draft only. No video will be generated.</span></div></form>',
'<div class="note">Generation is intentionally not connected to this form yet. A saved draft does not start a paid service, spend credits or publish a YouTube video.</div></section>',
'<section class="panel"><h2>Video job queue</h2><div id="jobs" class="list"><span class="muted">Loading protected queue…</span></div>',
'<div class="actions"><button type="button" id="refresh">Refresh</button><a id="prooflink" class="link" href="#" rel="noopener noreferrer" target="_blank">Latest real render evidence</a></div></section></div>',
'<footer>OMDA STAGING • Isolated D1 database • Protected by Cloudflare Access • Cloud evidence is read-only</footer></div>',
'<script>',
'const qs=id=>document.getElementById(id);',
'async function api(p,options){const r=await fetch(p,{credentials:"same-origin",cache:"no-store",...options});const data=await r.json();if(!r.ok)throw Error(data.error||"REQUEST_FAILED");return data;}',
'function renderJob(job){const box=document.createElement("article");box.className="job";const label=document.createElement("strong");label.textContent=job.title;const desc=document.createElement("small");desc.textContent=job.state+" · "+new Date(job.created_at*1000).toLocaleString();box.append(label,desc);if(job.state==="DRAFT"){const btn=document.createElement("button");btn.type="button";btn.style.marginTop="9px";btn.textContent="Approve for rendering (queue only)";btn.onclick=async()=>{btn.disabled=true;try{await api("/api/jobs/"+encodeURIComponent(job.id)+"/approve",{method:"POST",headers:{"Content-Type":"application/json","X-OMDA-Action":"approve-render"},body:"{}"});await refresh()}catch(e){qs("message").textContent=e.message}finally{btn.disabled=false}};box.append(btn)}return box;}',
'async function refresh(){try{const data=await api("/api/jobs");qs("jobs").replaceChildren(...data.jobs.map(renderJob));if(!data.jobs.length)qs("jobs").textContent="No jobs yet. Save the first story draft."}catch(e){qs("jobs").textContent="Protected queue unavailable: "+e.message}}',
'async function proof(){try{const d=await api("/api/proof");qs("proof").textContent=d.conclusion==="success"?"Verified":d.status==="in_progress"?"Rendering":d.status||"Unavailable";if(d.run_url)qs("prooflink").href=d.run_url}catch{qs("proof").textContent="Unknown"}}',
'qs("refresh").onclick=refresh;',
'qs("f").onsubmit=async e=>{e.preventDefault();const btn=qs("save");btn.disabled=true;qs("message").textContent="Saving draft…";try{const d=await api("/api/jobs",{method:"POST",headers:{"Content-Type":"application/json","X-OMDA-Action":"create-draft"},body:JSON.stringify({title:qs("title").value,script:qs("script").value,idem_key:crypto.randomUUID(),duration_seconds:60,language:"ar",provider_policy:"FREE_ONLY",publish_intent:false})});qs("message").textContent="Saved "+d.id+" · draft only";qs("script").value="";await refresh()}catch(e){qs("message").textContent="Blocked: "+e.message}finally{btn.disabled=false}};',
'refresh();proof();setInterval(proof,60000);',
'</script></body></html>'
].join("");
async function proof(){
  const r=await fetch(PROOF,{redirect:"manual",cf:{cacheTtl:30,cacheEverything:true}});
  if(!r.ok)throw Error("proof_unavailable");
  const data=await r.json();
  return {status:data.status,conclusion:data.conclusion,run_url:data.run_url,
    target:60,published:false,paid_generation:false};
}
async function app(request,env){
  const url=new URL(request.url);
  if(url.hostname!==HOST)return json({error:"INVALID_HOST"},400);
  if(!env.JOBS)return json({error:"STORAGE_UNCONFIGURED"},503);
  try{await authorize(request,env);}catch{return json({error:"UNAUTHORIZED"},401);}
  if(request.method==="GET"&&url.pathname==="/"){
    return new Response(PAGE,{headers:{...security,"Content-Type":"text/html; charset=utf-8",
      "Content-Security-Policy":"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"}});
  }
  if(request.method==="GET"&&url.pathname==="/api/health"){
    return json({status:"AVAILABLE",mode:"PRIVATE_DRAFT_QUEUE",target_seconds:60,
      generation_enabled:false,publishing:false,paid_generation:false,owner_verified:true});
  }
  if(request.method==="GET"&&url.pathname==="/api/proof"){
    try{return json(await proof());}catch{return json({error:"PROOF_UNAVAILABLE"},503);}
  }
  if(request.method==="GET"&&url.pathname==="/api/jobs"){
    const rows=await env.JOBS.prepare("SELECT id,title,state,duration_seconds,created_at,updated_at FROM video_jobs ORDER BY created_at DESC LIMIT 30").all();
    return json({jobs:rows.results||[],publishing:false,generation_enabled:false});
  }
  if(request.method==="POST"&&url.pathname==="/api/jobs"){
    try{checkWrite(request,"create-draft");}catch{return json({error:"WRITE_POLICY_DENIED"},403);}
    const body=await request.text();
    if(body.length>5000)return json({error:"JOB_TOO_LARGE"},413);
    let d;
    try{d=JSON.parse(body);}catch{return json({error:"MALFORMED_JSON"},400);}
    if(!d||typeof d!=="object"||Array.isArray(d)||
       typeof d.title!=="string"||d.title.trim().length<5||d.title.length>120||
       typeof d.script!=="string"||d.script.trim().length<100||d.script.length>2500||
       !/^[a-zA-Z0-9._-]{12,100}$/.test(d.idem_key||"")||
       d.duration_seconds!==60||d.language!=="ar"||
       d.publish_intent!==false||d.provider_policy!=="FREE_ONLY")return json({error:"INVALID_FREE_ONLY_60S_JOB"},400);
    // Capacity gate: staging drafts only, no generation or scheduling.
    const now=Math.floor(Date.now()/1000);
    const previous=await env.JOBS.prepare("SELECT id,title,state FROM video_jobs WHERE idem_key=?").bind(d.idem_key).first();
    if(previous)return json({id:previous.id,state:previous.state,idempotent:true});
    const count=await env.JOBS.prepare("SELECT COUNT(*) AS n FROM video_jobs WHERE created_at>=?").bind(now-86400).first();
    if((count?.n||0)>=4)return json({error:"DAILY_DRAFT_LIMIT"},429);
    const id=crypto.randomUUID();
    try{
      await env.JOBS.prepare(
        "INSERT INTO video_jobs(id,idem_key,title,script,language,duration_seconds,state,provider_policy,publish_intent,paid_generation,created_at,updated_at) VALUES(?,?,?,?,'ar',60,'DRAFT','FREE_ONLY',0,0,?,?)"
      ).bind(id,d.idem_key,d.title.trim(),d.script.trim(),now,now).run();
    }catch{return json({error:"STORAGE_WRITE_FAILED"},503);}
    return json({id,state:"DRAFT",published:false,generation_started:false},201);
  }
  const match=url.pathname.match(/^\/api\/jobs\/([a-f0-9-]{36})\/(approve|reject)$/);
  if(request.method==="POST"&&match){
    const action=match[2]==="approve"?"approve-render":"reject-draft";
    try{checkWrite(request,action);}catch{return json({error:"WRITE_POLICY_DENIED"},403);}
    if((await request.text()).length>100)return json({error:"JOB_TOO_LARGE"},413);
    const state=match[2]==="approve"?"READY_FOR_RENDER":"REJECTED";
    const result=await env.JOBS.prepare("UPDATE video_jobs SET state=?,updated_at=? WHERE id=? AND state='DRAFT'")
      .bind(state,Math.floor(Date.now()/1000),match[1]).run();
    if((result.meta?.changes||0)!==1)return json({error:"JOB_NOT_FOUND_OR_NOT_DRAFT"},409);
    return json({id:match[1],state,published:false,generation_started:false});
  }
  return json({error:"ROUTE_NOT_FOUND"},404);
}
export default {async fetch(request,env){try{return await app(request,env);}catch{return json({error:"INTERNAL_ERROR"},500);}}};
