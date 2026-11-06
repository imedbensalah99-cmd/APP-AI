// OMDA Command Router: bounded, offline command -> actual exportable artifact.
// No network, AI provider, email, job submission, deployment, or filesystem access.
import {makePlan} from '../omda-freellmapi-workflow-studio/engine.mjs';
import {buildBrief} from '../omda-freellmapi-website-brief/engine.mjs';
import {buildCsv,buildJobTrackerCsv} from '../omda-freellmapi-artifacts/artifact-kit.mjs';
import {draftEmail,exportDraftText} from '../omda-freellmapi-email-drafts/email-draft.mjs';
const MAX=2000;
const reject=/[\u0000-\u001f]/u;
function classify(command){
 if(typeof command!=='string'||command.trim().length<3||command.length>MAX||reject.test(command))throw new TypeError('Invalid command');
 const s=command.trim();
 if(/(?:email|e-mail|mail draft|بريد|إيميل|ايميل|رسالة إلكترونية)/i.test(s))return 'email';
 if(/(?:website|web\s?site|landing page|portfolio|restaurant site|موقع|ويبسايت|بورتفوليو)/i.test(s))return 'website';
 if(/(?:job|vacanc|career|وظيف|وظائف|توظيف)/i.test(s))return 'jobs';
 if(/(?:excel|spreadsheet|csv|xlsx|إكسل|اكسل|جدول|جداول)/i.test(s))return 'spreadsheet';
 return 'workflow';
}
function routeCommand(command,{jobs=[],columns,rows,email={}}={}){
 const kind=classify(command),plan=makePlan(command);
 let artifact;
 if(kind==='email'){
  artifact=exportDraftText(draftEmail({purpose:command,...email}));
 }else if(kind==='website'){
  artifact={filename:'omda-website-brief.json',mimeType:'application/json; charset=utf-8',content:JSON.stringify(buildBrief(command),null,2)+'\n'};
 }else if(kind==='jobs'){
  artifact=buildJobTrackerCsv(jobs);
 }else if(kind==='spreadsheet'){
  artifact=buildCsv({columns:columns??['Task','Status','Notes'],rows:rows??[],filename:'omda-spreadsheet.csv'});
 }else{
  artifact={filename:'omda-workflow-plan.json',mimeType:'application/json; charset=utf-8',content:JSON.stringify(plan,null,2)+'\n'};
 }
 return {schemaVersion:1,mode:'OFFLINE_ARTIFACT',kind,plan,artifact,requiresExternalApproval:plan.steps.some(x=>x.approvalRequired),networkCalls:0,paidCalls:0,published:false,sent:false};
}
export {classify,routeCommand};
