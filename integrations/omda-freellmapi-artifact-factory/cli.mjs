// Execute OMDA draft generation offline on GitHub Actions or Node 24.
// Input can be one natural-language sentence; output is always local files.
import {mkdir,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {execute} from './engine.mjs';
const command=process.env.OMDA_TASK_TEXT||process.argv.slice(2).join(' ');
const input={command,title:process.env.OMDA_TASK_TITLE||undefined};
if(process.env.OMDA_TASK_JSON){
 const parsed=JSON.parse(process.env.OMDA_TASK_JSON);
 Object.assign(input,parsed);
}
const outputRoot=new URL('./generated/',import.meta.url);
try{
 const result=execute(input);
 const manifestFiles=[];
 for(const entry of result.artifacts){
  const target=new URL('./generated/'+entry.path,import.meta.url);
  if(!target.href.startsWith(outputRoot.href))throw Error('Invalid artifact path');
  await mkdir(dirname(target.pathname),{recursive:true});
  const bytes=typeof entry.content==='string'?Buffer.from(entry.content,'utf8'):Buffer.from(entry.content);
  await writeFile(target,bytes);
  manifestFiles.push({kind:entry.kind,path:entry.path,mime:entry.mime,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
 await writeFile(new URL('./generated/manifest.json',import.meta.url),
   JSON.stringify({intents:result.intents,files:manifestFiles,
   externalActions:result.externalActions,paidApiCalls:result.paidApiCalls,publishing:result.publishing,
   notice:result.notice},null,2)+'\n','utf8');
 console.log('OMDA_GENERATED_ARTIFACTS='+result.artifacts.length);
 console.log('OMDA_INTENTS='+result.intents.join(','));
 console.log('OMDA_PAID_CALLS='+result.paidApiCalls);
}catch(error){
 console.error('OMDA_INPUT_REJECTED: '+error.message);
 process.exitCode=1;
}
