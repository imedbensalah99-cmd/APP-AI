// OMDA Workflow Studio — deterministic, zero-network planning engine.
// Converts Arabic/English requests into a bounded, reviewable work board.
// IMPORTANT: This module NEVER executes an external task or calls a provider.
const MAX_INPUT = 2000;
const MAX_STEPS = 24;
const TYPES = Object.freeze([
  {kind:'website',label:'Website draft',match:/\b(website|web\s?site|landing page|webpage)\b|موقع|ويبسايت|صفحة ويب/i,
    steps:['Collect requirements','Generate local website draft','Review mobile and accessibility','Approval before public deployment'],gate:true},
  {kind:'spreadsheet',label:'Spreadsheet',match:/\b(excel|spreadsheet|csv|xlsx)\b|اكسل|إكسل|جدول|جداول/i,
    steps:['Define sheet columns','Generate offline XLSX draft','Validate workbook formulas and exported data'],gate:false},
  {kind:'document',label:'Document',match:/\b(word|document|pdf|report)\b|تقرير|مستند|وورد|بي دي اف/i,
    steps:['Outline document','Prepare draft','Check accuracy and formatting'],gate:false},
  {kind:'email',label:'Email draft',match:/\b(email|e-mail|outreach|message)\b|ايميل|إيميل|بريد|رسالة إلكترونية/i,
    steps:['Prepare email draft','Review recipient and content','Approval before sending'],gate:true},
  {kind:'jobs',label:'Job applications',match:/\b(jobs?|vacanc(?:y|ies)|careers?|recruitment)\b|وظائف|وظيفة|توظيف/i,
    steps:['Identify current openings (research required)','Match CV against requirements','Draft applications','Approval before submitting'],gate:true},
  {kind:'code',label:'Code and tests',match:/\b(code|software|api|backend|program|script|test)\b|برمجة|كود|باك إند|تطبيق|اختبار/i,
    steps:['Define acceptance criteria','Implement in isolated branch','Run tests and review changes','Approval before production release'],gate:true}
]);
const STATES = new Set(['todo','doing','done','blocked']);
function assertCommand(command) {
  if(typeof command!=='string'||command.trim().length<3||command.length>MAX_INPUT||
     /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(command)) throw new Error('Invalid command');
  return command.trim();
}
function detectWork(command) {
  const request=assertCommand(command);
  const found=TYPES.filter(type=>type.match.test(request));
  return found.length?found:[{kind:'general',label:'General task',
    steps:['Clarify outcome','Create a local draft','Review result'],gate:false}];
}
function makePlan(command) {
  const request=assertCommand(command);
  const types=detectWork(request);
  const steps=[];
  for(const type of types){
    let previous=null;
    for(let i=0;i<type.steps.length;i++){
      if(steps.length>=MAX_STEPS)break;
      const label=type.steps[i];
      const approval=type.gate && i===type.steps.length-1;
      const id=type.kind+'-'+(i+1);
      steps.push({id,kind:type.kind,title:label,status:'todo',
        dependsOn:previous?[previous]:[],
        approvalRequired:approval,approved:false,
        execution:'manual',note:approval?'External action is NOT performed by Workflow Studio.':''});
      previous=id;
    }
  }
  return {schemaVersion:1,command:request,mode:'PLAN_ONLY',networkCalls:0,paidCalls:0,
    generatedAt:null,steps};
}
function validatePlan(plan){
  if(!plan||typeof plan!=='object'||Array.isArray(plan)||plan.schemaVersion!==1||
     plan.mode!=='PLAN_ONLY'||typeof plan.command!=='string'||plan.command.length>MAX_INPUT||
     !Array.isArray(plan.steps)||plan.steps.length<1||plan.steps.length>MAX_STEPS) throw new Error('Invalid plan');
  const ids=new Set(), statuses=new Map();
  for(const step of plan.steps){
    if(!step||typeof step!=='object'||typeof step.id!=='string'||ids.has(step.id)||
       !/^[a-z]+-[1-9][0-9]?$/.test(step.id)||!STATES.has(step.status)||
       typeof step.title!=='string'||step.title.length>140||
       !Array.isArray(step.dependsOn)||typeof step.approvalRequired!=='boolean'||
       typeof step.approved!=='boolean'||step.execution!=='manual') throw new Error('Invalid step');
    for(const dep of step.dependsOn){
      if(!ids.has(dep)) throw new Error('Dependencies must precede their tasks');
    }
    if((step.status==='doing'||step.status==='done')&&
       step.dependsOn.some(dep=>statuses.get(dep)!=='done'))
      throw new Error('Active milestones require finished prerequisites');
    ids.add(step.id);statuses.set(step.id,step.status);
    if(step.approvalRequired&&step.status==='done'&&!step.approved)
      throw new Error('Approval required for protected milestone');
  }
  return plan;
}
function updateStep(plan,id,next,{approve=false}={}){
  validatePlan(plan);
  if(!STATES.has(next))throw new Error('Invalid status');
  const step=plan.steps.find(s=>s.id===id);
  if(!step)throw new Error('Unknown step');
  if(approve!==false && approve!==true)throw new Error('Invalid approval');
  const allDone=step.dependsOn.every(dep=>plan.steps.find(s=>s.id===dep)?.status==='done');
  if((next==='doing'||next==='done')&&!allDone)throw new Error('Finish prerequisite steps first');
  if(next==='done'&&step.approvalRequired&&!approve&&!step.approved)
    throw new Error('This milestone needs explicit approval');
  const steps=plan.steps.map(s=>s.id===id?{...s,status:next,approved:s.approved||approve}:s);
  return validatePlan({...plan,steps});
}
function summary(plan){
  validatePlan(plan);
  const counts={todo:0,doing:0,done:0,blocked:0};
  for(const step of plan.steps)counts[step.status]++;
  return {...counts,total:plan.steps.length,percent:Math.round(100*counts.done/plan.steps.length)};
}
function csvCell(value){
  const raw=String(value??'');
  // Excel/LibreOffice formula-injection guard, including leading whitespace.
  const safe=/^[\s\uFEFF]*[=+\-@]/.test(raw)?"'"+raw:raw;
  return '"'+safe.replace(/"/g,'""')+'"';
}
function exportCSV(plan){
  validatePlan(plan);
  const rows=[['ID','Workstream','Task','Status','Dependencies','Approval required']];
  for(const s of plan.steps)rows.push([s.id,s.kind,s.title,s.status,s.dependsOn.join(' | '),s.approvalRequired?'Yes':'No']);
  return '\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';
}
function exportJSON(plan){validatePlan(plan);return JSON.stringify(plan,null,2)+'\n';}
export {makePlan,detectWork,updateStep,summary,validatePlan,exportJSON,exportCSV,MAX_INPUT,MAX_STEPS};