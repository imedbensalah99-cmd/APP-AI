// OMDA FreeLLMAPI: zero-credit, zero-network artifact factory.
// Generates real, downloadable static outputs from a natural-language request.
// It is an *offline tool*, not an LLM call or a promise of completed job research.
const ALIASES = [
  ['website',/\b(?:website|web\s*site|landing\s*page|webpage|site)\b|ويب\s?سايت|موقع|صفحة\s*ويب/i],
  ['spreadsheet',/\b(?:excel|spreadsheet|csv|xlsx)\b|إكسل|اكسل|إكسيل|اكسيل|جدول|جداول/i],
  ['email',/\b(?:e-?mail|message)\b|إيميل|ايميل|بريد|رسالة\s*إلكترونية/i],
  ['job_research',/\b(?:job|jobs|vacanc(?:y|ies)|career|employment)\b|وظائف|وظيفة|توظيف|شغل|فرص\s*عمل/i],
  ['document',/\b(?:word|document|pdf|report)\b|مستند|تقرير|ملف\s*وورد|وورد|بي\s*دي\s*اف/i]
];
const MAX_COMMAND=2500, MAX_ROWS=100, MAX_COLUMNS=20;
const LIMITS={command:MAX_COMMAND,rows:MAX_ROWS,columns:MAX_COLUMNS};
const esc=(s)=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
function assertRequest(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Request must be an object');
  const allowed=new Set(['command','title','rows','recipient']);
  if(Object.keys(input).some(k=>!allowed.has(k)))throw Error('Unexpected property');
  if(typeof input.command!=='string'||input.command.trim().length<3||input.command.length>MAX_COMMAND)throw Error('Command must be 3–2500 characters');
  if(input.title!==undefined&&(typeof input.title!=='string'||input.title.length>150))throw Error('Invalid title');
  if(input.recipient!==undefined&&(typeof input.recipient!=='string'||input.recipient.length>254||!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.recipient))))throw Error('Invalid recipient');
  if(input.rows!==undefined){
    if(!Array.isArray(input.rows)||input.rows.length>MAX_ROWS)throw Error('Invalid rows');
    for(const row of input.rows){
      if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).length>MAX_COLUMNS)throw Error('Invalid row');
      for(const [key,value] of Object.entries(row)){
        if(key.length>100||!['string','number','boolean'].includes(typeof value)||String(value).length>2000)throw Error('Invalid cell');
      }
    }
  }
  return {command:input.command.trim(),title:input.title?.trim()||'',rows:input.rows,recipient:input.recipient};
}
function classify(command){
  const types=ALIASES.filter(([,pattern])=>pattern.test(command)).map(([type])=>type);
  return types.length?types:['general'];
}
function safeTitle(title,fallback){return title||fallback;}
function website(input){
  const title=safeTitle(input.title,'Your Website');
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="description" content="Preview of a requested website"><title>'+esc(title)+'</title><style>:root{color-scheme:dark;font-family:system-ui,-apple-system,sans-serif;background:#080c16;color:#eef1ff}*{box-sizing:border-box}body{margin:0}header{max-width:1100px;margin:auto;display:flex;align-items:center;justify-content:space-between;padding:26px}main{max-width:1100px;margin:9vh auto;padding:30px}h1{font-size:clamp(2.3rem,7vw,5rem);max-width:850px;letter-spacing:-.06em;line-height:1.05}p{color:#afbad3;font-size:1.1rem;line-height:1.7;max-width:640px}.pill{border:1px solid #51618c;border-radius:99px;padding:10px 15px;display:inline-block;color:#cbd7ff}.box{background:#111b31;border:1px solid #243451;border-radius:18px;margin-top:45px;padding:25px}footer{max-width:1100px;margin:6rem auto 2rem;padding:30px;color:#9aa9c6}@media(max-width:600px){header{padding:18px}main{margin:4vh auto;padding:20px}footer{padding:20px}}</style></head><body><header><strong>'+esc(title)+'</strong><span class="pill">Draft preview</span></header><main><span class="pill">OMDA • Website Builder</span><h1>'+esc(title)+'</h1><p>A responsive starter layout created from your request. Review the requirements and replace placeholder sections before publishing.</p><section class="box"><h2>Project brief</h2><p>'+esc(input.command)+'</p></section><section class="box"><h2>Next step</h2><p>Add approved business details, images, contact links and features, then run accessibility and device tests.</p></section></main><footer>Draft only — not published.</footer></body></html>\n';
}
function csvCell(v){
  const cell=String(v??'');
  // Prevent spreadsheet formula execution; always treat risky leading syntax as plain text.
  const neutral=/^[\s\uFEFF]*[=+\-@]/.test(cell)?"'"+cell:cell;
  return '"'+neutral.replace(/"/g,'""')+'"';
}
function csv(input){
  const rows=input.rows?.length?input.rows:[{Task:'Review generated template',Owner:'',Status:'Draft',Notes:input.command}];
  const keys=[...new Set(rows.flatMap(x=>Object.keys(x)))].slice(0,MAX_COLUMNS);
  const lines=[keys.map(csvCell).join(',')];
  for(const row of rows)lines.push(keys.map(k=>csvCell(row[k]??'')).join(','));
  return '\uFEFF'+lines.join('\r\n')+'\r\n';
}
function email(input){
  const subject=safeTitle(input.title,'Draft for review');
  const heads=['Subject: '+subject.replace(/[\r\n]/g,' '),'X-OMDA-Draft: true'];
  if(input.recipient)heads.unshift('To: '+input.recipient);
  return heads.join('\r\n')+'\r\n\r\nHello,\r\n\r\nI am writing regarding the following request:\r\n'+input.command.replace(/[\r\n]+/g,' ')+'\r\n\r\nPlease review and customize this draft before sending.\r\n\r\nBest regards\r\n';
}
function document(input){
  const title=safeTitle(input.title,'Project Brief');
  return '# '+title.replace(/[\r\n]/g,' ')+'\n\n## Original request\n\n'+input.command+'\n\n## Proposed next steps\n\n1. Verify requirements and missing details.\n2. Prepare supporting content and source material.\n3. Review the draft and validate facts.\n4. Export to the desired document format after approval.\n\n**Status:** DRAFT — no PDF or DOCX was generated.\n';
}
function jobPlan(input){
  return JSON.stringify({status:'RESEARCH_NOT_RUN',request:input.command,steps:['Search recent employer vacancy pages','Check current openings and official application URLs','Compare each description with the supplied CV','Prepare structured results and draft applications for review'],note:'No job advertisements were searched or verified in this offline run.'},null,2)+'\n';
}
const ARTIFACTS={
  website:{name:'website/index.html',mime:'text/html',build:website},
  spreadsheet:{name:'spreadsheet/data.csv',mime:'text/csv',build:csv},
  email:{name:'email/draft.eml',mime:'message/rfc822',build:email},
  document:{name:'document/brief.md',mime:'text/markdown',build:document},
  job_research:{name:'jobs/research-plan.json',mime:'application/json',build:jobPlan},
  general:{name:'project/brief.md',mime:'text/markdown',build:document}
};
function execute(input){
  const req=assertRequest(input);
  const intents=classify(req.command);
  const artifacts=intents.map(kind=>({kind,path:ARTIFACTS[kind].name,mime:ARTIFACTS[kind].mime,content:ARTIFACTS[kind].build(req)}));
  return {intents,artifacts,executedActions:['generate_artifacts'],externalActions:[],paidApiCalls:0,publishing:false,
    notice:'Generated offline drafts only. No emails sent, jobs searched, websites published or LLMs called.'};
}
export {execute,classify,assertRequest,website,csv,csvCell,email,document,jobPlan,LIMITS};
