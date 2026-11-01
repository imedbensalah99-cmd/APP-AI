// OMDA Google Drive bridge v1 — isolated, credential-gated, drive.file-only.
// Cloudflare Worker scheduled only; no public OAuth callbacks or public HTTP API.
const now=()=>new Date().toISOString();
const OAUTH='https://oauth2.googleapis.com/token';
const DRIVE='https://www.googleapis.com/drive/v3/files';
const FOLDER_NAME='OMDA AI Company - Autonomous Outputs';
export function hasGoogleCredentials(env){
 return Boolean(env?.OMDA_GOOGLE_CLIENT_ID && env?.OMDA_GOOGLE_CLIENT_SECRET && env?.OMDA_GOOGLE_REFRESH_TOKEN);
}
export async function refreshGoogleAccessToken(env, transport=fetch){
 if(!hasGoogleCredentials(env))return {status:'NOT_CONFIGURED'};
 const body=new URLSearchParams({client_id:env.OMDA_GOOGLE_CLIENT_ID,client_secret:env.OMDA_GOOGLE_CLIENT_SECRET,refresh_token:env.OMDA_GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'});
 const r=await transport(OAUTH,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body,signal:AbortSignal.timeout(8000)});
 if(r.status!==200)throw Error('Google OAuth rejected HTTP '+r.status);
 const json=await r.json();
 if(typeof json.access_token!=='string'||!json.access_token)throw Error('Google OAuth access token missing');
 return {status:'READY',accessToken:json.access_token};
}
export async function driveCreateFolder(token,transport=fetch){
 const r=await transport(DRIVE+'?fields=id,name,mimeType,webViewLink',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({name:FOLDER_NAME,mimeType:'application/vnd.google-apps.folder'}),signal:AbortSignal.timeout(8000)});
 if(r.status!==200 && r.status!==201)throw Error('Drive folder HTTP '+r.status);
 const file=await r.json();
 if(!/^[A-Za-z0-9_-]{10,}$/.test(file.id||''))throw Error('Drive folder ID invalid');
 return {id:file.id,name:file.name};
}
export async function driveWriteProof(token,folderId,transport=fetch){
 if(!/^[A-Za-z0-9_-]{10,}$/.test(folderId))throw Error('Invalid folder');
 const data='OMDA AI Company cloud Drive bridge proof. No personal data. '+now()+'\n';
 const boundary='omda'+crypto.randomUUID().replaceAll('-','');
 const metadata={name:'OMDA-Drive-connection-proof.txt',mimeType:'text/plain',parents:[folderId]};
 const body=['--'+boundary,'Content-Type: application/json; charset=UTF-8','',JSON.stringify(metadata),'--'+boundary,'Content-Type: text/plain; charset=UTF-8','',data,'--'+boundary+'--',''].join('\r\n');
 const r=await transport('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,parents',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'multipart/related; boundary='+boundary},body,signal:AbortSignal.timeout(8000)});
 if(r.status!==200&&r.status!==201)throw Error('Drive proof HTTP '+r.status);
 const json=await r.json();
 if(!/^[A-Za-z0-9_-]{10,}$/.test(json.id||''))throw Error('Drive proof ID invalid');
 return {id:json.id,url:json.webViewLink||'',name:json.name};
}
async function report(db,status,details){
 await db.prepare('INSERT INTO tool_checks(name,status,detail,checked_at) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET status=excluded.status,detail=excluded.detail,checked_at=excluded.checked_at').bind('google_drive_oauth',status,String(details||'').slice(0,350),now()).run();
}
export async function driveBridgeTick(env,transport=fetch){
 if(!env.DIRECTOR_DB)throw Error('D1 binding missing');
 const db=env.DIRECTOR_DB;
 if(!hasGoogleCredentials(env)){await report(db,'NOT_CONFIGURED','OAuth secrets absent: no Google API calls');return {status:'NOT_CONFIGURED'};}
 let access;
 try{access=await refreshGoogleAccessToken(env,transport);}
 catch(err){await report(db,'AUTH_FAILED',err.message);return {status:'AUTH_FAILED'};}
 await report(db,'AUTHORIZED','Google OAuth refresh succeeded; access token discarded');
 if(env.OMDA_DRIVE_SETUP_ENABLED!=='true')return {status:'AUTHORIZED_NO_WRITE'};
 const row=await db.prepare("SELECT state FROM drive_bridge_jobs WHERE id='once-v1'").first();
 if(row?.state!=='READY')return {status:'NO_APPROVED_JOB'};
 // Claim before requests; unknown HTTP outcomes must never auto-repeat.
 const claim=await db.prepare("UPDATE drive_bridge_jobs SET state='RESERVED',updated_at=? WHERE id='once-v1' AND state='READY'").bind(now()).run();
 if(Number(claim.meta?.changes||0)!==1)return {status:'DUPLICATE_GUARD'};
 try{
  const folder=await driveCreateFolder(access.accessToken,transport);
  const proof=await driveWriteProof(access.accessToken,folder.id,transport);
  await db.prepare("UPDATE drive_bridge_jobs SET state='COMPLETED',folder_id=?,file_id=?,detail=?,updated_at=? WHERE id='once-v1' AND state='RESERVED'").bind(folder.id,proof.id,JSON.stringify({folder:folder.name,filename:proof.name}).slice(0,350),now()).run();
  await report(db,'PROOF_WRITTEN','New app-owned folder and proof file created');
  return {status:'PROOF_WRITTEN',folderId:folder.id,fileId:proof.id};
 }catch(err){
  // Never store an OAuth token or plaintext secret in D1.
  await db.prepare("UPDATE drive_bridge_jobs SET state='FAILED',detail=?,updated_at=? WHERE id='once-v1' AND state='RESERVED'").bind(err.message.slice(0,170),now()).run();
  await report(db,'WRITE_FAILED',err.message);
  return {status:'WRITE_FAILED'};
 }
}
export default {
 async fetch(){return new Response('Not found',{status:404,headers:{'cache-control':'no-store'}})},
 async scheduled(_controller,env,ctx){ctx.waitUntil(driveBridgeTick(env));}
};
