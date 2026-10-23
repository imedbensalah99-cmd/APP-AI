import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
const root=path.resolve('public/nimoloo');
const data=JSON.parse(fs.readFileSync(path.join(root,'data/latest.json'),'utf8'));
function assert(ok,message){if(!ok)throw new Error('NIMOLOO CHECK FAILED: '+message)}
assert(data.schemaVersion===1,'schema version');
assert(Array.isArray(data.channels)&&Array.isArray(data.videos),'channels/videos');
assert(Array.isArray(data.alerts)&&Array.isArray(data.agents),'alerts/agents');
assert(typeof data.source==='string','data source');
for(const c of data.channels){
 assert(typeof c.id==='string'&&typeof c.name==='string','channel id/name');
 if(c.youtubeId!==null&&c.youtubeId!==undefined)assert(/^UC[a-zA-Z0-9_-]{22}$/.test(c.youtubeId),'channel ID syntax');
 for(const metric of ['totalViews','subscribers','videoCount']){
  const value=c[metric];
  assert(value===null||value===undefined||(Number.isSafeInteger(value)&&value>=0),'nonnegative '+metric)
 }
}
for(const video of data.videos){
 assert(/^[\w-]{11}$/.test(video.id),'video ID syntax');
 assert(data.channels.some(c=>c.id===video.channel),'video channel reference');
}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
assert(html.includes('id="views"')&&html.includes('id="videoRows"'),'dashboard elements');
assert(html.includes('reports/latest.xlsx')&&html.includes('manifest.webmanifest'),'Excel/PWA links');
const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
assert(scripts.length>0,'dashboard has JavaScript');
for(const s of scripts) new vm.Script(s[1],{filename:'nimoloo-dashboard.js'});
JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));
assert(fs.existsSync(path.join(root,'nimoloo-icon.svg')),'PWA icon');
const excel=fs.readFileSync(path.join(root,'reports/latest.xlsx'));
assert(excel.subarray(0,4).toString('hex')==='504b0304','Excel ZIP signature');
console.log('PASS: Nimoloo JSON schema, honest metrics, dashboard JS, PWA, and Excel');
