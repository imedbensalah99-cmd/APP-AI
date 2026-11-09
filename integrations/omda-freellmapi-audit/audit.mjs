// OMDA bounded, append-only audit ledger. No persistence, network, or secrets.
import {createHash} from 'node:crypto';
const MAX_EVENTS=500, MAX_TEXT=160;
const TYPES=new Set(['task.created','task.started','task.completed','task.failed','artifact.created','approval.requested','approval.granted','approval.denied']);
const SECRET=/\b(?:sk-[a-zA-Z0-9_-]{8,}|gh[pousr]_[a-zA-Z0-9_]{8,}|Bearer\s+\S+|(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+)\b/gi;
function safeText(value){if(typeof value!=='string')throw new TypeError('Expected text');return value.replace(SECRET,'[REDACTED]').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,MAX_TEXT);}
function digest(obj){return createHash('sha256').update(JSON.stringify(obj)).digest('hex');}
function createAuditLedger({limit=MAX_EVENTS}={}){
 if(!Number.isSafeInteger(limit)||limit<1||limit>MAX_EVENTS)throw new RangeError('Invalid audit limit');
 const events=[];
 function append({type,taskId='',detail='',at}={}){
  if(!TYPES.has(type))throw new TypeError('Unsupported event type');
  if(events.length>=limit)throw new RangeError('Audit ledger full; export and rotate explicitly');
  if(at===undefined)at=new Date().toISOString();
  if(typeof at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(at)||!Number.isFinite(Date.parse(at)))throw new TypeError('Invalid timestamp');
  const base={seq:events.length+1,at,type,taskId:safeText(taskId),detail:safeText(detail),previousHash:events.at(-1)?.hash??'GENESIS'};
  const event=Object.freeze({...base,hash:digest(base)});events.push(event);return {...event};
 }
 function snapshot(){return events.map(x=>({...x}));}
 function exportJson(){return JSON.stringify({schemaVersion:1,events:snapshot()},null,2)+'\n';}
 return Object.freeze({append,snapshot,exportJson});
}
function verifyAuditLedger(events){
 if(!Array.isArray(events)||events.length>MAX_EVENTS)return false;
 let prev='GENESIS';
 for(let i=0;i<events.length;i++){
  const e=events[i];if(!e||typeof e!=='object'||Array.isArray(e))return false;
  const {hash,...base}=e;
  if(e.seq!==i+1||e.previousHash!==prev||!TYPES.has(e.type)||typeof e.taskId!=='string'||typeof e.detail!=='string'||typeof e.at!=='string'||!Number.isFinite(Date.parse(e.at))||e.taskId.length>MAX_TEXT||e.detail.length>MAX_TEXT||Object.keys(base).sort().join(',')!==['seq','at','type','taskId','detail','previousHash'].sort().join(',')||hash!==digest(base))return false;
  prev=hash;
 }
 return true;
}
export {createAuditLedger,verifyAuditLedger};
