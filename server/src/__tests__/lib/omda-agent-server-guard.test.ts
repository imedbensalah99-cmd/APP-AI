import {beforeAll,describe,expect,it} from 'vitest';
import {initDb,getDb} from '../../db/index.js';
import {encrypt} from '../../lib/crypto.js';
import {mintClientProfileKey,hashClientProfileKey,resolveAuth} from '../../lib/system-prompt.js';
import {OMDA_AGENT_MODEL,OMDA_AGENT_PROFILE,isOmdaAgentAuth,validOmdaAgentRequest,omdaProviderAllowed,omdaAgentProfileGate} from '../../lib/omda-agent-server-guard.js';

const payload={model:OMDA_AGENT_MODEL,max_tokens:128,temperature:0.2,stream:false,messages:[
  {role:'system',content:'You are a short-answer analyst.'},
  {role:'user',content:'Summarize a test.'}
]};
function fakeRequest(token:string,body:unknown=payload,method='POST',originalUrl='/v1/chat/completions'){
 return {method,originalUrl,body,get:(k:string)=>k==='authorization'?'Bearer '+token:undefined} as any;
}
function fakeResponse(){
 const state:{status:number;body:any}={status:200,body:null};
 const res:any={setHeader:()=>res,status:(n:number)=>{state.status=n;return res;},json:(x:any)=>{state.body=x;return res;}};
 return {state,res};
}
describe('OMDA staging client policy',()=>{
 beforeAll(()=>{process.env.ENCRYPTION_KEY='7'.repeat(64);initDb(':memory:');});
 it('allows the one intended payload, only one route and model',()=>{
   expect(validOmdaAgentRequest('POST','/v1/chat/completions',payload)).toBe(true);
   for(const body of [{...payload,model:'auto'},{...payload,model:'paid'},{...payload,stream:true},
     {...payload,max_tokens:129},{...payload,tools:[]},{...payload,messages:[{role:'user',content:'no'}]},
     {...payload,messages:[{role:'system',content:'safe'}, {role:'user',content:'x'.repeat(1001)}]}])
     expect(validOmdaAgentRequest('POST','/v1/chat/completions',body)).toBe(false);
   expect(validOmdaAgentRequest('POST','/v1/responses',payload)).toBe(false);
   expect(validOmdaAgentRequest('GET','/v1/chat/completions',payload)).toBe(false);
 });
 it('allows only genuine Groq GPT OSS 20B at provider dispatch',()=>{
   expect(omdaProviderAllowed({platform:'groq',modelId:OMDA_AGENT_MODEL})).toBe(true);
   for(const route of [{platform:'openrouter',modelId:OMDA_AGENT_MODEL},{platform:'groq',modelId:'openai/gpt-oss-120b'},{platform:'custom',modelId:OMDA_AGENT_MODEL}])
     expect(omdaProviderAllowed(route)).toBe(false);
 });
 function add(name:string,enabled:number){
   const key=mintClientProfileKey(),c=encrypt(key);
   getDb().prepare('INSERT INTO client_profiles (name,token_hash,encrypted_key,iv,auth_tag,system_prompt,enabled) VALUES (?,?,?,?,?,NULL,?)')
     .run(name,hashClientProfileKey(key),c.encrypted,c.iv,c.authTag,enabled);
   return key;
 }
 it('the disabled OMDA profile remains unauthorized, and ordinary clients are unaffected',()=>{
   const disabled=add(OMDA_AGENT_PROFILE,0);
   expect(resolveAuth(disabled)).toBeNull();
   const regular=add('other-client',1);expect(isOmdaAgentAuth(resolveAuth(regular))).toBe(false);
   const {res}=fakeResponse();let next=0;omdaAgentProfileGate(fakeRequest(regular),res,()=>{next++;});
   expect(next).toBe(1);
 });
 it('blocks OMDA client attempts to use another route, tools, larger outputs and paid model',()=>{
   const key=add(OMDA_AGENT_PROFILE,1);
   const variants=[
     fakeRequest(key,payload,'POST','/v1/responses'),
     fakeRequest(key,{...payload,model:'auto'}),
     fakeRequest(key,{...payload,tools:[{type:'function'}]}),
     fakeRequest(key,{...payload,max_tokens:2048}),
     fakeRequest(key,payload,'GET')
   ];
   for(const req of variants){const {state,res}=fakeResponse();let next=0;
     omdaAgentProfileGate(req,res,()=>{next++;});expect(state.status).toBe(403);expect(next).toBe(0);}
   expect((getDb().prepare("SELECT name FROM sqlite_master WHERE name='omda_agent_server_quotas'").get() as any)).toBeUndefined();
 });
 it('enforces server-side one-minute and ten-per-day quotas, with 429 on overuse',()=>{
   const key=add(OMDA_AGENT_PROFILE,1);
   let now=new Date('2026-11-02T11:00:00Z');
   const original=Date.prototype.toISOString;
   try {
     // Make the clock controllable without network.
     Date.prototype.toISOString=function(){return now.toISOString===Date.prototype.toISOString?original.call(now):original.call(now);};
     let calls=0;
     function invoke(){const {state,res}=fakeResponse();omdaAgentProfileGate(fakeRequest(key),res,()=>{calls++;});return state.status;}
     expect(invoke()).toBe(200);expect(invoke()).toBe(429);
     for(let i=1;i<10;i++){now=new Date(Date.UTC(2026,10,2,11,i));expect(invoke()).toBe(200);}
     now=new Date('2026-11-02T11:15:00Z');expect(invoke()).toBe(429);
     expect(calls).toBe(10);
   }finally{Date.prototype.toISOString=original;}
 });
});
