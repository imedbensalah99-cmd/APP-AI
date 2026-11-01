// OMDA + Agency OS — isolated private integration hub v1.0
// Never modifies the existing OMDA Worker, OMDA 2, or MoneyPrinterTurbo services.
// Reads existing OMDA D1, shares Agency OS task KV, no paid APIs/publishing.
const allowedAgents = ['studio-producer','trend-researcher','sales-outreach','content-creator','ui-designer','frontend-developer','reality-checker','proposal-strategist'];
const links = Object.freeze({
  omda:'https://omda-studio-private.imedbensalah9988.workers.dev/',
  agency:'https://agency-os-pro-max-preview.imedbensalah9988.workers.dev/',
  report:'https://drive.google.com/drive/folders/1orHEGZqM3ziqNrqFktXNi6MC4NogkbLH',
  freellmapi:'https://drive.google.com/drive/folders/1Jfl2vDmNZXLZ6PcAB6-ANEOR9uk-QTPz'
});
const site = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>OMDA · Unified Command Center</title><style>
:root{font-family:system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif;color:#ece8fb;background:#090910}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 84% 0,#241044 0,transparent 42%),#090910;min-height:100vh}main{max-width:1050px;margin:auto;padding:26px 18px 80px}header{display:flex;justify-content:space-between;align-items:center;gap:14px;margin-bottom:30px}.logo{font-weight:900;letter-spacing:.5px;font-size:21px}.sub{color:#aca1c2;font-size:12px}.tag{font-size:11px;padding:7px 11px;background:#251e38;color:#d7c5ff;border:1px solid #4b365f;border-radius:99px}h1{font-size:clamp(27px,5vw,43px);margin:10px 0 7px}p{line-height:1.7}a{color:#c4a8ff}article,.panel{background:linear-gradient(150deg,#1b1628,#12111c);border:1px solid #383047;border-radius:18px;padding:20px}.hero{padding:24px;margin-bottom:20px;border-color:#684499}.hero p{color:#b9afc7;max-width:670px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}.panel b{font-size:15px}.metric{font-size:28px;font-weight:800;margin:11px 0}.detail{font-size:12px;color:#bcb2ca}.small{font-size:11px;color:#9187a3}.full{grid-column:1/-1}.cols{display:grid;grid-template-columns:1.2fr .8fr;gap:14px;margin-top:14px}select,textarea,button{width:100%;border:1px solid #50415e;background:#1a1626;color:#fff;border-radius:11px;padding:11px;outline-color:#a980ff;font:inherit}textarea{min-height:110px;resize:vertical}label{font-weight:600;font-size:13px;display:block;margin:15px 0 7px}button{cursor:pointer;margin-top:14px;font-weight:750;background:linear-gradient(120deg,#9b6cf2,#5839b5);border-color:#b89af6}button:hover{filter:brightness(1.08)}.links{display:flex;flex-wrap:wrap;gap:10px}.links a{border:1px solid #57456f;padding:10px 15px;border-radius:10px;text-decoration:none}.result{white-space:pre-wrap;overflow-wrap:anywhere;border-radius:10px;padding:14px;background:#101018;border:1px solid #302b39;min-height:60px;font-size:12px}.notice{border-right:3px solid #eab868;background:#382d1b44;padding:11px;font-size:12px;color:#efd6aa;border-radius:6px}.line{border-bottom:1px solid #383044;padding:10px 0;font-size:12px}.mono{direction:ltr;text-align:left;font-family:ui-monospace,monospace}.good{color:#7ee5b2}.warn{color:#efc177}@media(max-width:750px){.grid{grid-template-columns:1fr 1fr}.cols{grid-template-columns:1fr}}@media(max-width:430px){.grid{grid-template-columns:1fr}.tag{font-size:9px}}
</style></head><body><main><header><div><div class="logo">عمدة <span style="color:#af8dff">OMDA</span> <span style="font-weight:500">/ Agency OS</span></div><div class="sub">Private Unified Command Center · v1.4</div></div><span class="tag">OWNER ONLY</span></header><article class="hero"><span style="color:#c2a6ff;font-size:12px">CONTROL PLANE — READ ONLY FOR OMDA</span><h1>شركة عمدة · مركز القيادة الموحد</h1><p>لوحة خاصة تجمع الحالة الحقيقية من قاعدة بيانات عمدة، وقائمة مهام Agency Agents. إرسال مهام مسودات إلى Agency OS فقط. لا نشر، لا دفع، ولا تغيير في إنتاج عمدة.</p><div class="links"><a href="${links.omda}" target="_blank" rel="noreferrer">OMDA Studio</a><a href="${links.agency}" target="_blank" rel="noreferrer">Agency OS</a><a href="${links.report}" target="_blank" rel="noreferrer">Google Drive</a></div></article><div class="grid"><article class="panel"><b>OMDA · مهام الإنتاج</b><div id="omda-status" class="metric">…</div><div class="detail">صفوف قائمة الإنتاج: مصدر حيّ للقراءة فقط</div></article><article class="panel"><b>Agency · أوامر AI</b><div id="agent-status" class="metric">…</div><div class="detail">من KV المشتركة مع محرك الوكلاء</div></article><article class="panel"><b>FreeLLMAPI · Gateway</b><div class="metric warn" style="font-size:19px">Not connected</div><div class="detail">لا استضافة دائمة ولا مفاتيح بعد. <a href="${links.freellmapi}" target="_blank" rel="noreferrer">دليل الربط</a></div></article></div><div class="cols"><article><h2>أرسل مهمة لوكيل حقيقي</h2><p class="sub">المهمة تُحفظ في قائمة Agency OS؛ تشغيلها الفعلي يتطلب أن يلتقطها الـWorker ويؤكد الحالة. مسودات فقط.</p><label for="task">المهمة المطلوبة</label><textarea id="task" maxlength="1400" placeholder="مثال: اكتب تصورًا لموقع صغير ثم راجعه"></textarea><label for="agents">تسلسل الوكلاء</label><select id="agents"><option value="content-creator,reality-checker">Content Creator → Reality Checker</option><option value="trend-researcher,proposal-strategist,reality-checker">Research → Proposal → QA</option><option value="ui-designer,frontend-developer,reality-checker">UI → Developer → QA</option><option value="studio-producer,reality-checker">Producer → QA</option></select><label style="font-size:12px;font-weight:500"><input id="use-free-router" type="checkbox" style="width:auto;vertical-align:middle;margin-left:7px">تجربة OpenRouter المجانية للوكيل الأول فقط (الباقي Cloudflare AI) — سقف تجربتين يوميًا ولا نشر</label><button id="send">إرسال مهمة آمنة إلى Agency OS</button><div id="result" class="result" role="status" style="margin-top:14px">جاهز</div></article><article><h2>حالة الربط</h2><div class="notice">محرك FreeLLMAPI وأدوات Gemini/Groq وغيرها ليست متصلة تلقائيًا بهذه اللوحة. لا تُدخل مفاتيح في النصوص.</div><div id="status-list" style="margin-top:13px">جاري فحص المصادر…</div><h3>أحدث مهام Agency</h3><div id="jobs">جاري التحميل…</div><button id="reload" style="background:#2a2340">تحديث الحالة</button></article></div><article id="providers-panel" style="margin-top:18px"><h2>🔐 API Connections — إضافة الخدمات واحدة واحدة</h2><p class="sub">كل مفتاح يُحفظ مشفرًا في قاعدة بيانات عمدة المستقلة، ولا يظهر في الصفحة أو GitHub. لا توجد طلبات AI مدفوعة أو نشر. هذا مدير مفاتيح مبدئي، <b>وليس خادم FreeLLMAPI</b>. لا تستخدم خيار «حفظ كلمة المرور» في المتصفح لمفاتيح API.</p><div class="notice">التوصيل هنا يعني حفظ مفتاح مزوّد وفحص قائمة نماذجه عند الطلب، وليس تشغيل الوكلاء بهذا المزوّد تلقائيًا. لا تضف مفاتيح مفعّل عليها Billing إلا بعد مراجعة حدودها.</div><div id="providers-status" class="sub" style="padding-top:15px">جارٍ فحص خزنة المفاتيح…</div><div id="providers-cards" class="grid" style="margin-top:13px"></div><button id="providers-refresh" type="button" style="background:#292039">تحديث حالة API Connections</button><div class="small">الربط القادم: محرك توزيع النماذج / FreeLLMAPI بعد تجهيز استضافة آمنة دائمة. Cloudflare Workers AI الموجود حاليًا مستقل عن هذه المفاتيح.</div></article><p class="small" style="margin-top:25px">Access is enforced by Cloudflare; an additional signed Access JWT is verified by this Worker. No provider credentials or private OMDA scripts are shown in this interface. External actions disabled.</p></main><script>
const $=id=>document.getElementById(id);const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function json(url,options){const r=await fetch(url,{credentials:'same-origin',headers:{'accept':'application/json',...(options?.body?{'content-type':'application/json'}:{})},...options});const v=await r.json();if(!r.ok)throw Error(v.error||'HTTP '+r.status);return v}
async function refresh(){try{const x=await json('/api/overview');$('omda-status').textContent=String(x.omda?.production_queue?.total??0);$('agent-status').textContent=String(x.agency?.jobCount??0);$('status-list').innerHTML=[['OMDA D1 Read',x.omda?.ok],['Agency KV Read',x.agency?.ok],['Cloudflare AI',true],['FreeLLMAPI',false],['Live video job dispatch',false]].map(([n,s])=>'<div class="line">'+esc(n)+' — <span class="'+(s?'good':'warn')+'">'+(s?'CONNECTED':'PENDING')+'</span></div>').join('');$('jobs').innerHTML=x.agency?.recentJobs?.map(j=>'<div class="line"><b class="mono">'+esc(j.id)+'</b> '+esc(j.status)+' · '+esc(j.agents?.join(' → '))+'</div>').join('')||'لا توجد مهام';}catch(e){$('status-list').textContent='تعذر التحديث: '+e.message;}}

const providerNames={groq:'Groq',gemini:'Google Gemini',cerebras:'Cerebras',openrouter:'OpenRouter',mistral:'Mistral'};
async function refreshProviders(){
 const label=$('providers-status'),cards=$('providers-cards');if(!label||!cards)return;
 try{const v=await json('/api/providers');label.textContent='خزنة مشفرة · مزودون محفوظون: '+v.providers.filter(x=>x.connected).length+'/'+v.providers.length;
 cards.innerHTML=v.providers.map(x=>'<section class="panel"><b>'+esc(providerNames[x.provider]||x.provider)+'</b><div class="small">'+(x.connected?'مفتاح محفوظ مشفر · '+esc(x.state||'UNTESTED'):'لم يُضف مفتاح')+'</div>'+(x.connected?'<div class="small">معرّف آمن: '+esc(x.fingerprint||'')+'</div>':'')+(x.lastTestAt?'<div class="small">آخر اختبار: '+esc(x.lastTestReason||'UNKNOWN')+(x.lastHttpStatus?' · HTTP '+esc(x.lastHttpStatus):' · بدون استجابة HTTP')+'</div>':'')+'<input type="password" autocomplete="off" data-lpignore="true" data-1p-ignore="true" spellcheck="false" data-provider-key="'+esc(x.provider)+'" placeholder="ألصق مفتاح API داخل هذا الحقل فقط" aria-label="API Key for '+esc(x.provider)+'" style="width:100%;margin-top:11px;background:#0d0b13;color:white;border:1px solid #554768;border-radius:10px;padding:11px" maxlength="512"><button type="button" data-provider-action="save" data-provider="'+esc(x.provider)+'">'+(x.connected?'استبدال المفتاح':'حفظ المفتاح')+'</button><button type="button" data-provider-action="test" data-provider="'+esc(x.provider)+'" '+(x.connected?'':'disabled')+' style="background:#24213b">اختبار قراءة النماذج</button><button type="button" data-provider-action="delete" data-provider="'+esc(x.provider)+'" '+(x.connected?'':'disabled')+' style="background:#38232d">حذف المفتاح</button><div class="small" role="status" data-result="'+esc(x.provider)+'" style="padding:5px 0"></div></section>').join('');
 }catch(e){label.textContent='فحص الخزنة تعذّر: '+e.message;cards.replaceChildren();}
}
async function providerAction(button){const provider=button.dataset.provider,action=button.dataset.providerAction;
 if(!providerNames[provider]||!['save','test','delete'].includes(action))return;
 const input=document.querySelector('[data-provider-key="'+provider+'"]');const res=document.querySelector('[data-result="'+provider+'"]');const key=input?.value.trim();
 if(action==='save'&&(!key||key.length<8)){res.textContent='أدخل مفتاح API صالحًا أولًا';return}
 if(action==='delete'&&!confirm('حذف مفتاح '+providerNames[provider]+' من الخزنة؟'))return;
 button.disabled=true;res.textContent='جارٍ تنفيذ '+(action==='test'?'اختبار النماذج':'طلب الحفظ/الحذف')+'…';
 try{const path='/api/providers/'+provider+(action==='test'?'/test':'');let method=action==='test'?'POST':action==='delete'?'DELETE':'POST';const url=action==='save'?'/api/providers':path;
 const v=await json(url,{method,headers:{'content-type':'application/json','x-omda-safe-action':'connections'},body:action==='save'?JSON.stringify({provider,key}):JSON.stringify({})});
 input.value='';res.textContent=(v.message||v.state||'تم')+(action==='test'?' · '+(v.reason||'UNKNOWN')+(v.httpStatus?' · HTTP '+v.httpStatus:''):'');setTimeout(()=>refreshProviders(),2000);
 }catch(e){res.textContent='تعذر الإجراء: '+e.message;}finally{button.disabled=false;}
}
$('providers-panel').addEventListener('click',event=>{const btn=event.target.closest('button[data-provider-action]');if(btn)providerAction(btn)});
$('providers-refresh').onclick=refreshProviders;refreshProviders();
$('send').onclick=async()=>{const t=$('task').value.trim();if(t.length<8){$('result').textContent='اكتب مهمة من 8 أحرف على الأقل';return}const b=$('send');b.disabled=true;$('result').textContent='جاري الإضافة إلى قائمة المهام…';try{const v=await json('/api/agency/tasks',{method:'POST',body:JSON.stringify({task:t,agents:$('agents').value.split(','),modelProvider:$('use-free-router').checked?'openrouter-free':'cloudflare-ai'})});$('result').textContent='تم تسجيل الطلب '+v.id+' بحالة '+v.status+'؛ انتظر تحديث نتائج التنفيذ.';$('task').value='';await refresh()}catch(e){$('result').textContent='لم يتم الإرسال: '+e.message}finally{b.disabled=false}};$('reload').onclick=refresh;refresh();
</script></body></html>`;
function headers(type='application/json; charset=utf-8'){return {'content-type':type,'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY','strict-transport-security':'max-age=31536000','content-security-policy':"default-src 'none'; script-src 'sha256-j9CsV8dfC3aX2g/prGdIvo29TVQGm3oeRlSQ/0dcRVM='; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"};}
function respond(x,status=200){return new Response(JSON.stringify(x),{status,headers:headers()});}
function decodePart(v){const b=v.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(b.padEnd(Math.ceil(b.length/4)*4,'=')),c=>c.charCodeAt(0));}
async function verifyAccess(req,env){
  const jwt=req.headers.get('Cf-Access-Jwt-Assertion');if(!jwt||!env.ACCESS_AUD||!env.ACCESS_TEAM)return false;
  const pieces=jwt.split('.');if(pieces.length!==3)return false;
  let header,payload;try{header=JSON.parse(new TextDecoder().decode(decodePart(pieces[0])));payload=JSON.parse(new TextDecoder().decode(decodePart(pieces[1])));}catch{return false;}
  if(header.alg!=='RS256'||!header.kid||!Array.isArray(payload.aud)||!payload.aud.includes(env.ACCESS_AUD)||payload.email!==env.OWNER_EMAIL)return false;
  const issuer='https://'+env.ACCESS_TEAM;if(payload.iss!==issuer||!payload.exp||payload.exp<=(Date.now()/1000)||payload.nbf>Date.now()/1000)return false;
  try{const r=await fetch(issuer+'/cdn-cgi/access/certs',{cf:{cacheTtl:120}});if(!r.ok)return false;const j=await r.json();const jwk=(j.keys||[]).find(x=>x.kid===header.kid&&x.kty==='RSA');if(!jwk)return false;
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);return await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decodePart(pieces[2]),new TextEncoder().encode(pieces[0]+'.'+pieces[1]));}catch{return false;}
}
async function summarize(env){
  const tables=[['jobs','status'],['agent_tasks','status'],['cloud_production_queue','status'],['omda_bridge_jobs','status']];const omda={ok:true};
  try{for(const [name,col] of tables){const res=await env.OMDA_READ.prepare(`SELECT ${col} AS state, COUNT(*) AS count FROM ${name} GROUP BY ${col}`).all();const states=res.results||[];omda[name==='cloud_production_queue'?'production_queue':name]={total:states.reduce((n,x)=>n+Number(x.count||0),0),byState:Object.fromEntries(states.map(x=>[String(x.state),Number(x.count)]))};}
  const v=await env.VIDEO_READ.prepare('SELECT state,COUNT(*) AS count FROM video_jobs GROUP BY state').all();omda.video_queue={total:(v.results||[]).reduce((n,x)=>n+Number(x.count||0),0),byState:Object.fromEntries((v.results||[]).map(x=>[String(x.state),Number(x.count)]))};}
  catch{omda.ok=false;omda.error='D1 summary unavailable';}
  const agency={ok:true,jobCount:0,recentJobs:[]};try{const k=await env.AGENCY_JOBS.list({prefix:'job-',limit:75});agency.jobCount=k.keys.length;const ids=k.keys.slice(-12);const jobs=await Promise.all(ids.map(x=>env.AGENCY_JOBS.get(x.name,'json')));agency.recentJobs=jobs.filter(Boolean).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,8).map(x=>({id:x.id,status:x.status,agents:x.agents||[],createdAt:x.createdAt,steps:(x.steps||[]).length}));}
  catch{agency.ok=false;agency.error='Agency KV unavailable';}
  return {omda,agency,providers:{cloudflareAi:'BOUND',groq:'NOT_CONFIGURED',gemini:'NOT_CONFIGURED',freellmapi:'NOT_DEPLOYED'},capabilities:{videoPublish:false,paidApi:false,externalWrite:false},updatedAt:new Date().toISOString()};
}
async function queueDraft(req,env){
  const length=Number(req.headers.get('content-length')||'0');if(length>6500)return respond({error:'Request too large'},413);
  let body;try{body=await req.json()}catch{return respond({error:'Invalid JSON'},400)}
  const task=typeof body.task==='string'?body.task.trim():'';const agents=body.agents;const modelProvider=body.modelProvider||'cloudflare-ai';
  if(task.length<8||task.length>1400)return respond({error:'Task must be 8–1400 characters'},422);
   if(!['cloudflare-ai','openrouter-free'].includes(modelProvider))return respond({error:'Only free experimental model routes are supported'},422);
  if(!Array.isArray(agents)||agents.length<1||agents.length>3||agents.some(x=>!allowedAgents.includes(x))||new Set(agents).size!==agents.length)return respond({error:'Only 1–3 unique approved agents'},422);
  const keys=await env.AGENCY_JOBS.list({prefix:'job-',limit:90});const today=new Date().toISOString().slice(0,10);const jobs=await Promise.all(keys.keys.map(x=>env.AGENCY_JOBS.get(x.name,'json')));
  if(jobs.filter(x=>x?.createdAt?.slice(0,10)===today).length>=6)return respond({error:'Daily free quota safety cap reached'},429);
  if(jobs.filter(x=>x&&['QUEUED','IN_PROGRESS'].includes(x.status)).length>=3)return respond({error:'Queue busy'},429);
  const id=crypto.randomUUID().slice(0,8);const now=new Date().toISOString();const job={id,task,agents,modelProvider,status:'QUEUED',steps:[],createdAt:now,updatedAt:now,origin:'OMDA-AGENCY-HUB',paidAllowed:false,publishAllowed:false};
  await env.AGENCY_JOBS.put('job-'+id,JSON.stringify(job),{metadata:{status:'QUEUED',steps:0,updatedAt:now}});return respond({id,status:'QUEUED',agents},202);
}

const PROVIDERS=Object.freeze({
  groq:{url:'https://api.groq.com/openai/v1/models',auth:'bearer',verification:true},
  gemini:{url:'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',auth:'google',verification:true},
  cerebras:{url:'https://api.cerebras.ai/v1/models',auth:'bearer',verification:true},
  openrouter:{url:'https://openrouter.ai/api/v1/key',auth:'bearer',verification:true},
  mistral:{url:'https://api.mistral.ai/v1/models',auth:'bearer',verification:true}
});
function isValidProvider(p){return typeof p==='string'&&Object.prototype.hasOwnProperty.call(PROVIDERS,p)}
function toBase64(bytes){let v='';for(let i=0;i<bytes.length;i+=8192)v+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(v)}
async function vaultKey(env){if(!env.PROVIDER_MASTER_KEY||!/^[a-f0-9]{64}$/i.test(env.PROVIDER_MASTER_KEY))throw Error('Vault not configured');const raw=Uint8Array.from(env.PROVIDER_MASTER_KEY.match(/.{2}/g),x=>parseInt(x,16));return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);}
async function encryptProviderKey(env,provider,providerKey){const iv=crypto.getRandomValues(new Uint8Array(12));const key=await vaultKey(env);const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('omda-connection:'+provider)},key,new TextEncoder().encode(providerKey)));const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('omda:'+provider+':'+providerKey)));return {ciphertext:toBase64(ciphertext),nonce:toBase64(iv),fingerprint:Array.from(hash.slice(0,6),n=>n.toString(16).padStart(2,'0')).join('')};}
async function decryptProviderKey(env,p,row){const key=await vaultKey(env);const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:Uint8Array.from(atob(row.nonce),c=>c.charCodeAt(0)),additionalData:new TextEncoder().encode('omda-connection:'+p)},key,Uint8Array.from(atob(row.ciphertext),c=>c.charCodeAt(0)));return new TextDecoder().decode(plain);}
async function auditVault(env,p,action,outcome){try{await env.PROVIDER_DB.prepare('INSERT INTO vault_audit(id,provider,action,outcome,at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),p,action,outcome,new Date().toISOString()).run();}catch{/* audit is best effort, never log secrets */}}
function providerHeaders(key,cfg){return cfg.auth==='google'?{'x-goog-api-key':key,'accept':'application/json'}:{authorization:'Bearer '+key,'accept':'application/json'};}
async function providerAPI(req,env,path){
 // Only same-origin browser actions. No CORS and no credentials written to logs.
 if(req.method!=='GET'){if(req.headers.get('origin')!==new URL(req.url).origin||req.headers.get('x-omda-safe-action')!=='connections')return respond({error:'Same-origin required'},403);if(req.headers.get('content-type')?.split(';')[0].trim()!=='application/json')return respond({error:'JSON required'},415);if(Number(req.headers.get('content-length')||'0')>2200)return respond({error:'Request too large'},413);}
 try{await vaultKey(env)}catch{return respond({error:'Secret vault unavailable'},503)}
 if(req.method==='GET'&&path==='/api/providers'){
  const rows=(await env.PROVIDER_DB.prepare('SELECT provider,state,fingerprint,updated_at,last_test_at,last_http_status,last_test_reason FROM provider_connections ORDER BY provider').all()).results||[];
  return respond({vault:'READY',gateway:'NOT_DEPLOYED',inference:'DISABLED',providers:Object.keys(PROVIDERS).map(provider=>{const r=rows.find(x=>x.provider===provider);return {provider,connected:!!r,state:r?.state||'NOT_CONFIGURED',fingerprint:r?.fingerprint||null,updatedAt:r?.updated_at||null,lastTestAt:r?.last_test_at||null,lastHttpStatus:r?.last_http_status??null,lastTestReason:r?.last_test_reason||null}})});
 }
 if(req.method==='POST'&&path==='/api/providers'){
  let o;try{o=await req.json()}catch{return respond({error:'Invalid JSON'},400)}
  if(!isValidProvider(o?.provider)||typeof o?.key!=='string'||o.key.length<8||o.key.length>512||/[\r\n\0]/.test(o.key))return respond({error:'Invalid provider or key'},422);
  const p=o.provider,now=new Date().toISOString(),encrypted=await encryptProviderKey(env,p,o.key.trim());
  await env.PROVIDER_DB.prepare("INSERT INTO provider_connections(provider,ciphertext,nonce,fingerprint,state,updated_at,last_test_at,last_test_day,test_count) VALUES(?,?,?,?, 'UNTESTED',?,NULL,NULL,0) ON CONFLICT(provider) DO UPDATE SET ciphertext=excluded.ciphertext,nonce=excluded.nonce,fingerprint=excluded.fingerprint,state='UNTESTED',updated_at=excluded.updated_at,last_test_at=NULL,last_test_day=NULL,test_count=0,last_http_status=NULL,last_test_reason=NULL").bind(p,encrypted.ciphertext,encrypted.nonce,encrypted.fingerprint,now).run();
  await auditVault(env,p,'CREATE','OK');return respond({message:'تم حفظ المفتاح مشفّرًا. لم يُرسل أي طلب للنموذج.',provider:p,state:'UNTESTED'},201);
 }
 const m=path.match(/^\/api\/providers\/(groq|gemini|cerebras|openrouter|mistral)(\/test)?$/);if(!m)return respond({error:'Not found'},404);
 const p=m[1],test=!!m[2];const row=await env.PROVIDER_DB.prepare('SELECT * FROM provider_connections WHERE provider=?').bind(p).first();
 if(!row)return respond({error:'No saved key for this provider'},404);
 if(!test&&req.method==='DELETE'){
  await env.PROVIDER_DB.prepare('DELETE FROM provider_connections WHERE provider=?').bind(p).run();await auditVault(env,p,'DELETE','OK');return respond({message:'حُذف مفتاح المزود من الخزنة'});
 }
 if(test&&req.method==='POST'){
  const now=new Date().toISOString(),today=now.slice(0,10),count=row.last_test_day===today?Number(row.test_count||0):0;
  if(count>=4)return respond({error:'4 provider tests/day maximum',state:'RATE_LIMITED'},429);
  await env.PROVIDER_DB.prepare('UPDATE provider_connections SET test_count=?,last_test_day=?,last_test_at=? WHERE provider=?').bind(count+1,today,now,p).run();
  let state='UNKNOWN',httpStatus=null,reason='UNVERIFIED';
  try{
    const apiKey=await decryptProviderKey(env,p,row);
    const cfg=PROVIDERS[p];
    // Cloudflare Workers does not implement redirect:'error'. Use 'manual' and NEVER follow a redirect with credentials.
    const res=await fetch(cfg.url,{method:'GET',headers:providerHeaders(apiKey,cfg),redirect:'manual',signal:AbortSignal.timeout(9000)});
    httpStatus=res.status;
    if(res.status===200){state=cfg.verification?'VALID':'UNKNOWN';reason=p==='openrouter'?'KEY_AUTH_OK':cfg.verification?'MODELS_OK':'MODELS_PUBLIC';}
    else if(res.status===401){state='INVALID';reason='AUTH_401';}
    else if(res.status===403){state='INVALID';reason='FORBIDDEN_403';}
    else if(res.status===429){state='RATE_LIMITED';reason='PROVIDER_429';}
    else if(res.status>=300&&res.status<400){state='ERROR';reason='REDIRECT_REJECTED';}
    else{state='ERROR';reason='UPSTREAM_HTTP';}
  }catch(e){
    state='ERROR';
    // Never return exception messages; some runtimes include URLs, which might contain credentials.
    reason=['AbortError','TimeoutError'].includes(e?.name)?'TIMEOUT':'NETWORK_OR_RUNTIME';
  }
  await env.PROVIDER_DB.prepare('UPDATE provider_connections SET state=?,last_http_status=?,last_test_reason=? WHERE provider=?').bind(state,httpStatus,reason,p).run();
  await auditVault(env,p,'TEST',state==='RATE_LIMITED'?'RATE_LIMITED':state==='ERROR'?'ERROR':state==='INVALID'?'DENIED':'OK');
  const msg=state==='VALID'?(p==='openrouter'?'تم التحقق من قبول مفتاح OpenRouter عبر نقطة المفتاح الخاصة. لم يُجرَ توليد AI.':'تم الوصول لقائمة النماذج بنجاح. لم يُجرَ توليد AI.'):state==='UNKNOWN'?'استجاب المزود، لكن قائمة النماذج لا تؤكد صلاحية المفتاح وحدها.':state==='INVALID'?'رفض مزوّد الخدمة الطلب أو صلاحية المفتاح؛ راجع رمز HTTP.':state==='RATE_LIMITED'?'تجاوز المزود حد طلبات الاختبار.':reason==='REDIRECT_REJECTED'?'رفضنا إعادة التوجيه لحماية المفتاح.':reason==='TIMEOUT'?'انتهى وقت انتظار مزود API.':'فشل اختبار قائمة النماذج؛ راجع رمز HTTP وتشخيص الاتصال أدناه.';
  return respond({provider:p,state,message:msg,httpStatus,reason});
 }
 return respond({error:'Method not allowed'},405);
}

// Cloudflare Service Binding-only bridge: authenticated with an independent HMAC secret.
// This branch is deliberately separate from browser Access; unsigned web callers are denied.
const FREE_ROUTE='openrouter/free';
const MAX_ROUTED_DAILY=2;
const hexBytes=x=>Uint8Array.from(x.match(/.{2}/g),h=>parseInt(h,16));
const toHex=a=>Array.from(a,x=>x.toString(16).padStart(2,'0')).join('');
async function routeInternal(req,env){
 if(req.method!=='POST'||!env.INTERNAL_BRIDGE_KEY||!/^[a-f0-9]{64}$/i.test(env.INTERNAL_BRIDGE_KEY))return respond({error:'Unavailable'},404);
 if(!req.headers.get('content-type')?.startsWith('application/json'))return respond({error:'JSON required'},415);
 const t=req.headers.get('x-omda-ts'),nonce=req.headers.get('x-omda-nonce'),sig=req.headers.get('x-omda-signature');
 if(!/^\d{13}$/.test(t||'')||!/^[-a-f0-9]{36}$/.test(nonce||'')||!/^[a-f0-9]{64}$/.test(sig||'')||Math.abs(Date.now()-Number(t))>30_000)return respond({error:'Unauthorized'},401);
 const body=await req.text();if(body.length>17_000)return respond({error:'Payload too large'},413);
 const hmacKey=await crypto.subtle.importKey('raw',hexBytes(env.INTERNAL_BRIDGE_KEY),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const verified=await crypto.subtle.verify('HMAC',hmacKey,hexBytes(sig),new TextEncoder().encode(t+'\n'+nonce+'\n'+body));
 if(!verified)return respond({error:'Unauthorized'},401);
 let data;try{data=JSON.parse(body)}catch{return respond({error:'Invalid JSON'},400)}
 if(data?.provider!=='openrouter-free'||data?.model!==FREE_ROUTE||!Array.isArray(data.messages)||data.messages.length!==2||data.messages[0]?.role!=='system'||data.messages[1]?.role!=='user'||typeof data.messages[0].content!=='string'||typeof data.messages[1].content!=='string'||data.messages[0].content.length>11500||data.messages[1].content.length>4500||data.messages[1].content.length<8)return respond({error:'Free-only allowlist rejected request'},422);
 // Deduplicate signed attempts (including failed ones). Prevent replay and enforce <=2/day across jobs.
 const date=new Date().toISOString().slice(0,10),ts=new Date().toISOString();
 const reservation=await env.PROVIDER_DB.prepare(`INSERT INTO free_inference_attempts(id,day,provider,state,created_at) SELECT ?,?,'openrouter-free','RESERVED',? WHERE (SELECT COUNT(*) FROM free_inference_attempts WHERE day=? AND provider='openrouter-free') < ?`).bind(nonce,date,ts,date,MAX_ROUTED_DAILY).run();
 if(!reservation.meta?.changes)return respond({error:'Two free pilot attempts per UTC day maximum'},429);
 const update=async state=>{try{await env.PROVIDER_DB.prepare('UPDATE free_inference_attempts SET state=? WHERE id=?').bind(state,nonce).run()}catch{}};
 try{
  const provider=await env.PROVIDER_DB.prepare('SELECT * FROM provider_connections WHERE provider=?').bind('openrouter').first();
  if(!provider||provider.state!=='VALID'){await update('NO_VALID_KEY');return respond({error:'OpenRouter key is not verified'},503)}
  const key=await decryptProviderKey(env,'openrouter',provider);const auth={'authorization':'Bearer '+key,'accept':'application/json'};
  const info=await fetch('https://openrouter.ai/api/v1/key',{method:'GET',headers:auth,redirect:'manual',signal:AbortSignal.timeout(8000)});
  if(info.status!==200){await update('KEY_REJECTED');return respond({error:'OpenRouter key check failed'},503)}
  const keyInfo=await info.json();if(keyInfo?.data?.is_free_tier!==true||keyInfo?.data?.is_management_key===true){await update('NO_FREE_TIER');return respond({error:'Account not confirmed free tier; no inference was sent'},403)}
  const request={model:FREE_ROUTE,messages:data.messages,max_tokens:160,temperature:0.25,stream:false};
  const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{...auth,'content-type':'application/json','HTTP-Referer':'https://omda-agency-unified.imedbensalah9988.workers.dev','X-Title':'OMDA Agency Free Pilot'},body:JSON.stringify(request),redirect:'manual',signal:AbortSignal.timeout(23000)});
  if(response.status!==200){await update('UPSTREAM_'+String(response.status));return respond({error:'Free model unavailable',upstreamStatus:response.status},503)}
  const out=await response.json();const answer=out?.choices?.[0]?.message?.content;
  if(typeof answer!=='string'||answer.trim().length<4){await update('EMPTY_OUTPUT');return respond({error:'Free model returned no usable content'},502)}
  await update('COMPLETED');return respond({ok:true,provider:'openrouter-free',model:FREE_ROUTE,output:answer.slice(0,2200),usage:out.usage?{prompt_tokens:out.usage.prompt_tokens||null,completion_tokens:out.usage.completion_tokens||null}:null},200);
 }catch(e){await update('FAILED_SAFE');return respond({error:'Free router failed safely',reason:e?.name==='TimeoutError'?'TIMEOUT':'UPSTREAM_FAILURE'},503)}
}

export default {async fetch(req,env){
  if(new URL(req.url).pathname==='/internal/free-inference')return routeInternal(req,env);
  // No health-check bypass: every route is protected by Access + verified JWT.
  if(!(await verifyAccess(req,env)))return respond({error:'Owner authentication required'},401);
  const path=new URL(req.url).pathname;
  try{if(req.method==='GET'&&path==='/')return new Response(site,{status:200,headers:headers('text/html; charset=utf-8')});
    if(req.method==='GET'&&path==='/api/health')return respond({status:'READY',integrations:'READ_ONLY_OMDA_AND_AGENCY_DRAFT_QUEUE',version:'1.4'});
    if(path==='/api/providers'||path.startsWith('/api/providers/'))return providerAPI(req,env,path);
    if(req.method==='GET'&&path==='/api/overview')return respond(await summarize(env));
    if(req.method==='POST'&&path==='/api/agency/tasks')return queueDraft(req,env);
    return respond({error:'Not found or method disallowed'},404);
  }catch{return respond({error:'Service unavailable; no actions were published'},503);}
}}
