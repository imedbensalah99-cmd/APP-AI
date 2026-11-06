// Offline OMDA correspondence drafting. Never sends messages or contacts external services.
const MAX=4000;
function required(value,label,max=MAX){
 if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value))throw new TypeError('Invalid '+label);
 return value.trim();
}
function optional(value,label,max=MAX){
 if(value===undefined||value===null||value==='')return '';
 return required(value,label,max);
}
function safeEmail(value){
 if(value===undefined||value===null||value==='')return '';
 const v=required(value,'recipient',254);
 if(!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(v))throw new TypeError('Invalid recipient');
 return v;
}
export function draftEmail({purpose,recipient='',subject='',facts=[],tone='professional',language='en',signature=''}={}){
 const goal=required(purpose,'purpose');
 if(!['en','ar'].includes(language))throw new TypeError('Invalid language');
 if(!['professional','concise','friendly'].includes(tone))throw new TypeError('Invalid tone');
 if(!Array.isArray(facts)||facts.length>12)throw new TypeError('Invalid facts');
 const verified=facts.map((f)=>required(f,'fact',400));
 const to=safeEmail(recipient);
 const subjectInput=optional(subject,'subject',160);
 if(/[\r\n]/u.test(subjectInput))throw new TypeError('Invalid subject');
 const title=subjectInput||(language==='ar'?'بخصوص: ':'Regarding: ')+goal.replace(/[\r\n]+/gu,' ').slice(0,90);
 const sign=optional(signature,'signature',160);
 const greeting=language==='ar'?'السادة المحترمون،':tone==='friendly'?'Hello,':'Dear Hiring Team,';
 const opener=language==='ar'?'أتواصل معكم بخصوص '+goal+'.':tone==='concise'?'I am writing regarding '+goal+'.':'I am reaching out regarding '+goal+'.';
 const bullets=verified.map(f=>'• '+f).join('\n');
 const closing=language==='ar'?'يسعدني تزويدكم بمزيد من التفاصيل عند الحاجة.\nمع خالص التحية،':'Please let me know if further details would be helpful.\nKind regards,';
 const body=[greeting,'',opener,bullets?'\n'+bullets:'','',closing,sign].filter((v,i)=>v!==''||i===1).join('\n').trim()+'\n';
 return {schemaVersion:1,status:'DRAFT_ONLY',to,subject:title,body,language,tone,verifiedFacts:verified.length,requiresApproval:true,sent:false,networkCalls:0,paidCalls:0};
}
export function exportDraftText(draft){
 if(!draft||draft.status!=='DRAFT_ONLY'||draft.sent!==false)throw new TypeError('Invalid draft');
 return {filename:'omda-email-draft.txt',mimeType:'text/plain; charset=utf-8',content:'To: '+draft.to+'\nSubject: '+draft.subject+'\n\n'+draft.body};
}
