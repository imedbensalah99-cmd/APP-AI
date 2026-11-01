import test from 'node:test';
import assert from 'node:assert/strict';
import agency from './agency-worker-v1.6.mjs';
class KV{
 data=new Map(); constructor(){this.data.set('agent-content-creator','Role: Content Creator. '.repeat(45));this.data.set('agent-reality-checker','Role: Reality Checker. '.repeat(45));}
 async list({prefix}){return{keys:[...this.data.keys()].filter(x=>x.startsWith(prefix)).map(name=>({name}))}}
 async get(name,format){const v=this.data.get(name)||null;return format==='json'&&v?JSON.parse(v):v}
 async put(name,value){this.data.set(name,value)}
}
const makeEnv=(mode='fail')=>{
 const store=new KV(),stepOutputs=[];
 const job={id:'safe-pilot',task:'اكتب إعلانًا من جملتين لمقهى خيالي دون ادعاءات.',agents:['content-creator','reality-checker'],modelProvider:'openrouter-free',status:'QUEUED',steps:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),paidAllowed:false,publishAllowed:false};store.data.set('job-safe-pilot',JSON.stringify(job));
 return {store,env:{AGENCY_STATUS:store,AGENT_DEFS:store,INTERNAL_BRIDGE_KEY:'ab'.repeat(32),MODEL_GATEWAY:{fetch:async()=>new Response(JSON.stringify(mode==='fail'?{error:'Two free pilot attempts per UTC day maximum'}:{ok:true,provider:'openrouter-free',model:'google/gemma-4-26b-a4b-it:free',output:'أهلاً بالقهوة والخيال.'}),{status:mode==='fail'?429:200})},AI:{run:async(model,req)=>{stepOutputs.push({model,req});return{choices:[{message:{content:req.messages[1].content.startsWith('STRICT QA')?'VERDICT: PASS\nFINDINGS: Fictional text only.':'إعلان لمقهى خيالي بلا ادعاءات واقعية.'}}]}}}},stepOutputs};
};
async function execute(x){let p;await agency.scheduled({},x.env,{waitUntil(v){p=v}});await p;return JSON.parse(x.store.data.get('job-safe-pilot'))}
await test('zero-cost fallback when upstream quota blocks without false provider claims',async()=>{const x=makeEnv('fail');const job=await execute(x);assert.equal(job.status,'REVIEW');assert.equal(job.steps.length,2);assert.equal(job.steps[0].provider,'cloudflare-ai');assert.match(job.steps[0].fallbackReason,/Two free pilot/);assert.equal(job.steps[1].provider,'cloudflare-ai');assert.equal(x.stepOutputs.length,2)});
await test('successful free provider response is kept, QA runs on Cloudflare',async()=>{const x=makeEnv('success');const job=await execute(x);assert.equal(job.status,'REVIEW');assert.equal(job.steps[0].provider,'openrouter-free');assert.equal(job.steps[0].fallbackReason,null);assert.equal(job.steps[0].output,'أهلاً بالقهوة والخيال.');assert.equal(job.steps[1].provider,'cloudflare-ai');assert.equal(x.stepOutputs.length,1)});
