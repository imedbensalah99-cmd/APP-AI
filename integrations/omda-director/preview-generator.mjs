// Deterministic, bounded output for OMDA GitHub executor pilot. No arbitrary commands.
import {mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
export function validatePreview(input={}) {
  const title=input.title ?? 'OMDA Agent Pilot';
  const description=input.description ?? 'Safe autonomous build demonstration.';
  for (const [name,value,max] of [['title',title,80],['description',description,500]]) {
    if (typeof value!=='string' || !value.trim() || value.length>max || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(value)) throw Error('Invalid '+name);
  }
  return {title:title.trim(),description:description.trim()};
}
const escapeHtml=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
export function renderPreview(input){
 const {title,description}=validatePreview(input);
 return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>'+escapeHtml(title)+'</title></head><body><main><h1>'+escapeHtml(title)+'</h1><p>'+escapeHtml(description)+'</p><small>OMDA internal build — not published</small></main></body></html>\n';
}
export async function generate(input, directory='.omda-build'){
 const html=renderPreview(input);
 await mkdir(directory,{recursive:true});
 await writeFile(resolve(directory,'index.html'),html,{flag:'w'});
 const summary={task:'create_static_preview',sha256:createHash('sha256').update(html).digest('hex'),bytes:Buffer.byteLength(html),title:validatePreview(input).title};
 await writeFile(resolve(directory,'manifest.json'),JSON.stringify(summary,null,2)+'\n',{flag:'w'});
 return summary;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 generate({title:process.env.OMDA_TITLE||undefined,description:process.env.OMDA_DESCRIPTION||undefined}).then(s=>console.log('OMDA safe preview built:',s.sha256)).catch(e=>{console.error('OMDA build rejected:',e.message);process.exitCode=1});
}
