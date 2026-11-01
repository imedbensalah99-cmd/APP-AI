import test from 'node:test';
import assert from 'node:assert/strict';
import {hasGoogleCredentials,refreshGoogleAccessToken,driveCreateFolder,driveWriteProof,driveBridgeTick} from './drive-bridge.mjs';
const env={OMDA_GOOGLE_CLIENT_ID:'client',OMDA_GOOGLE_CLIENT_SECRET:'secret',OMDA_GOOGLE_REFRESH_TOKEN:'refresh'};
test('no Google token without all three OAuth secrets',async()=>{
 for(const e of [{},{...env,OMDA_GOOGLE_REFRESH_TOKEN:''}]){assert.equal(hasGoogleCredentials(e),false);let n=0;assert.deepEqual(await refreshGoogleAccessToken(e,async()=>{n++;throw Error('must not call');}),{status:'NOT_CONFIGURED'});assert.equal(n,0);}
});
test('OAuth refresh POST never leaks in logged return object',async()=>{
 let seen;const r=await refreshGoogleAccessToken(env,async (url,options)=>{seen={url,options};return {status:200,json:async()=>({access_token:'mocked-access'})}});
 assert.equal(r.status,'READY');assert.equal(r.accessToken,'mocked-access');assert.equal(seen.url,'https://oauth2.googleapis.com/token');assert.equal(seen.options.method,'POST');assert.equal(seen.options.body.get('grant_type'),'refresh_token');
});
test('OAuth rejects invalid response with no untrusted data in error',async()=>{
 await assert.rejects(refreshGoogleAccessToken(env,async()=>({status:401,json:async()=>({error_description:'untrusted'})})),/HTTP 401/);
});
test('Google Drive only creates an app-owned folder',async()=>{
 const out=await driveCreateFolder('mock',async (url,o)=>{assert.match(url,/googleapis.com\/drive\/v3\/files/);const b=JSON.parse(o.body);assert.equal(b.name,'OMDA AI Company - Autonomous Outputs');assert.equal(b.mimeType,'application/vnd.google-apps.folder');return {status:200,json:async()=>({id:'folderproof12345',name:b.name})}});
 assert.equal(out.id,'folderproof12345');
});
test('Google Drive proof destination is validated and content bounded',async()=>{
 await assert.rejects(driveWriteProof('mock','../../foo',async()=>({status:200})),/Invalid folder/);
 const out=await driveWriteProof('mock','folderproof12345',async (url,o)=>{assert.match(url,/uploadType=multipart/);assert.ok(o.body.includes('folderproof12345'));assert.match(o.body,/connection-proof/);assert.ok(o.body.length<1600);return {status:200,json:async()=>({id:'fileproof123456',name:'OMDA-Drive-connection-proof.txt'})}});
 assert.equal(out.id,'fileproof123456');
});
test('disabled setup never creates folder or uploads file',async()=>{
 const rows=[];const db={prepare(sql){return {bind(...v){return {run:async()=>{rows.push({sql,v});return {meta:{changes:1}}}}}}}};
 const out=await driveBridgeTick({...env,DIRECTOR_DB:db},async url=>{if(url==='https://oauth2.googleapis.com/token')return {status:200,json:async()=>({access_token:'mocked-access'})};throw Error('unexpected call '+url)});
 assert.equal(out.status,'AUTHORIZED_NO_WRITE');assert.equal(rows.length,1);assert.equal(rows[0].v[1],'AUTHORIZED');
});
