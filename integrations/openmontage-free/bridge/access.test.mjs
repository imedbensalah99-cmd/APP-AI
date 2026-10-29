import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, sign as rsaSign, webcrypto} from 'node:crypto';
import {verifyAccessRequest} from './access.mjs';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const kid='test-key-kid';
const jwk=publicKey.export({format:'jwk'});
const env={OMDA_OWNER_EMAIL:'owner@example.com',OMDA_ACCESS_ISS:'https://testorg.cloudflareaccess.com',
  OMDA_ACCESS_AUD:'a'.repeat(64)};
function b64(s){return Buffer.from(typeof s==='string'?s:JSON.stringify(s)).toString('base64url')}
function token(overrides={},head={}){
 const now=Math.floor(Date.now()/1000);
 const header={alg:'RS256',kid,typ:'JWT',...head};
 const payload={aud:[env.OMDA_ACCESS_AUD],iss:env.OMDA_ACCESS_ISS,email:'owner@example.com',
  iat:now-10,exp:now+300,...overrides};
 const message=b64(header)+'.'+b64(payload);
 return message+'.'+rsaSign('RSA-SHA256',Buffer.from(message),privateKey).toString('base64url');
}
function request(value){return new Request('https://preview.example.test/api/queue',
 {headers:{'Cf-Access-Jwt-Assertion':value}})}
const oldFetch=globalThis.fetch;
globalThis.fetch=async function(url){
 assert.equal(String(url),env.OMDA_ACCESS_ISS+'/cdn-cgi/access/certs');
 return new Response(JSON.stringify({keys:[{...jwk,kid,use:'sig',alg:'RS256'}]}),
  {status:200,headers:{'content-type':'application/json'}})
};
test('valid signed Access identity accepted',async()=>{assert.equal(await verifyAccessRequest(request(token()),env),true)});
test('wrong email denied',async()=>{assert.equal(await verifyAccessRequest(request(token({email:'attacker@example.com'})),env),false)});
test('wrong aud denied',async()=>{assert.equal(await verifyAccessRequest(request(token({aud:['z'.repeat(64)]})),env),false)});
test('wrong issuer denied',async()=>{assert.equal(await verifyAccessRequest(request(token({iss:'https://attacker.example'})),env),false)});
test('expired JWT denied',async()=>{assert.equal(await verifyAccessRequest(request(token({iat:1,exp:2})),env),false)});
test('future JWT denied',async()=>{assert.equal(await verifyAccessRequest(request(token({iat:Math.floor(Date.now()/1000)+120})),env),false)});
test('tampered signature denied',async()=>{
 const x=token();const p=x.split('.');p[1]=b64({email:'owner@example.com',iss:env.OMDA_ACCESS_ISS,aud:[env.OMDA_ACCESS_AUD],iat:1,exp:Math.floor(Date.now()/1000)+60});
 assert.equal(await verifyAccessRequest(request(p.join('.')),env),false)
});
test('alg none and wrong kid denied',async()=>{
 assert.equal(await verifyAccessRequest(request(token({}, {alg:'none'})),env),false);
 assert.equal(await verifyAccessRequest(request(token({}, {kid:'untrusted-key'})),env),false);
});
test('missing identity/config fails closed',async()=>{
 assert.equal(await verifyAccessRequest(new Request('https://preview.example.test/'),env),false);
 assert.equal(await verifyAccessRequest(request(token()),{...env,OMDA_ACCESS_AUD:''}),false);
 assert.equal(await verifyAccessRequest(request(token()),{...env,OMDA_OWNER_EMAIL:''}),false);
});
test('no request to attacker cert host even if poisoned config',async()=>{
 assert.equal(await verifyAccessRequest(request(token()),{...env,OMDA_ACCESS_ISS:'https://attacker.example'}),false);
});
