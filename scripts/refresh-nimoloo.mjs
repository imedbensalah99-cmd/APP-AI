/**
 * Read-only public YouTube statistics refresh. Never uploads or changes privacy.
 * GitHub secret YOUTUBE_DATA_API_KEY is optional and NEVER written to JSON/logs.
 */
import fs from 'node:fs/promises';
const location='public/nimoloo/data/latest.json';
const doc=JSON.parse(await fs.readFile(location,'utf8'));
if(doc.schemaVersion!==1)throw Error('Unrecognized dashboard data format');
const key=process.env.YOUTUBE_DATA_API_KEY?.trim()||'';
const stamp=()=>new Date().toISOString();
const previousVideos=doc.videos||[];
const nextChannels=[], nextVideos=[], errors=[];
let complete=0;
async function request(url,asText=false){
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),15000);
 try{
  const response=await fetch(url,{signal:controller.signal,headers:{'User-Agent':'NimolooControl/1.0'}});
  if(!response.ok)throw Error('YouTube HTTP '+response.status);
  return asText?response.text():response.json();
 }finally{clearTimeout(timeout)}
}
async function api(name,args){
 const u=new URL('https://www.googleapis.com/youtube/v3/'+name);
 for(const [k,v] of Object.entries({...args,key}))u.searchParams.set(k,String(v));
 const data=await request(u.toString());
 if(data.error)throw Error('YouTube API status '+data.error.code);
 return data;
}
function decode(text){
 return String(text||'').replace(/&#x([0-9a-f]+);|&#([0-9]+);|&amp;|&lt;|&gt;|&quot;|&apos;/gi,(match,hex,dec)=>
 hex?String.fromCodePoint(parseInt(hex,16)):dec?String.fromCodePoint(parseInt(dec,10)):
 {'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'" }[match]||match)
}
function tag(entry,name){
 const a=entry.match(new RegExp('<'+name+'>([\\s\\S]*?)<\\/'+name+'>'));
 return decode(a?.[1]);
}
async function readRss(channel){
 const xml=await request('https://www.youtube.com/feeds/videos.xml?channel_id='+encodeURIComponent(channel.youtubeId),true);
 if(!xml.includes('<feed')||!xml.includes('youtube.com/xml/schemas/2015'))throw Error('YouTube RSS not valid');
 const videos=[];
 for(const part of xml.split('<entry>').slice(1)){
  const entry=part.split('</entry>')[0];
  const id=tag(entry,'yt:videoId');
  if(/^[\w-]{11}$/.test(id))videos.push({channel:channel.id,channelName:channel.name,id,
    title:tag(entry,'title'),publishedAt:tag(entry,'published')||null,
    privacy:'public',views:null,likes:null});
 }
 return {channel:{...channel,totalViews:null,subscribers:null,videoCount:null,
   lastCheckedAt:stamp()},videos};
}
async function readApi(channel){
 const cr=await api('channels',{part:'statistics,contentDetails',id:channel.youtubeId});
 const found=cr.items?.[0];
 if(!found)throw Error('Channel inaccessible from public YouTube Data API');
 const s=found.statistics||{};
 const updated={...channel,
  totalViews:s.viewCount===undefined?null:Number(s.viewCount),
  subscribers:s.hiddenSubscriberCount||s.subscriberCount===undefined?null:Number(s.subscriberCount),
  videoCount:s.videoCount===undefined?null:Number(s.videoCount),
  lastCheckedAt:stamp()};
 const videos=[];
 const playlist=found.contentDetails?.relatedPlaylists?.uploads;
 if(playlist){
  const pr=await api('playlistItems',{part:'contentDetails',playlistId:playlist,maxResults:50});
  const ids=(pr.items||[]).map(v=>v.contentDetails?.videoId).filter(Boolean);
  if(ids.length){
   const vr=await api('videos',{part:'snippet,statistics,status',id:ids.join(',')});
   for(const v of vr.items||[]){
    videos.push({channel:channel.id,channelName:channel.name,id:v.id,
      title:v.snippet?.title||'Untitled',publishedAt:v.snippet?.publishedAt||null,
      privacy:v.status?.privacyStatus||'public',
      views:v.statistics?.viewCount===undefined?null:Number(v.statistics.viewCount),
      likes:v.statistics?.likeCount===undefined?null:Number(v.statistics.likeCount)})
   }
  }
 }
 return {channel:updated,videos};
}
for(const c of doc.channels){
 if(!c.youtubeId){
   nextChannels.push(c);
   nextVideos.push(...previousVideos.filter(v=>v.channel===c.id));
   continue;
 }
 try{
  const result=key?await readApi(c):await readRss(c);
  nextChannels.push(result.channel);
  nextVideos.push(...result.videos);
  complete++;
  console.log('Verified channel '+c.name+' via '+(key?'YouTube API':'RSS')+'; '+result.videos.length+' public videos');
 }catch(error){
  console.warn('YouTube lookup failed for '+c.name+': '+String(error.message).slice(0,80));
  errors.push(c.name+': '+String(error.message).slice(0,100));
  nextChannels.push(c);
  nextVideos.push(...previousVideos.filter(v=>v.channel===c.id));
 }
}
if(complete){
 doc.channels=nextChannels;
 doc.videos=nextVideos;
 doc.updatedAt=stamp();
 doc.source=key?'YouTube Data API (public)':'YouTube public RSS (no view counts)';
}
doc.alerts=(doc.alerts||[]).filter(a=>a.code!=='youtube_public_sync');
if(errors.length)doc.alerts.push({code:'youtube_public_sync',severity:'medium',
 title:'Public YouTube refresh incomplete',detail:errors.join('; ').slice(0,350)});
else if(!key)doc.alerts.push({code:'youtube_public_sync',severity:'medium',
 title:'View counters require API authorization',
 detail:'Automatic RSS sync checks public video titles only. For views and subscribers add a YouTube Data API key as a GitHub Actions repository secret, or connect from the web dashboard. Private uploads require OAuth in Termux.'});
await fs.writeFile(location,JSON.stringify(doc,null,2)+'\n');
console.log('Sync: successful channels='+complete+', errors='+errors.length+', verified video rows='+doc.videos.length);
