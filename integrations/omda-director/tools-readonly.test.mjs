import test from 'node:test';
import assert from 'node:assert/strict';
import {validateQuery,publicResearch,githubPublicInfo} from './tools-readonly.mjs';
test('reject bad or oversized queries',()=>{for(const q of ['', 'x','a'.repeat(121),'bad\nquery'])assert.throws(()=>validateQuery(q));});
test('Wikipedia returns sourced bounded results only',async()=>{
 let seen;const x=await publicResearch('anti money laundering',async (url,opts)=>{seen={url,opts};return {status:200,json:async()=>({pages:[{title:'Money laundering',key:'Money_laundering',excerpt:'<span>Meaning</span> overview'}]})}});
 assert.equal(x.length,1);assert.equal(x[0].title,'Money laundering');assert.match(x[0].url,/wikipedia.org/);assert.equal(x[0].snippet,'Meaning overview');assert.match(seen.url,/limit=3/);
});
test('GitHub target fixed; cannot redirect to arbitrary repo',async()=>{
 const x=await githubPublicInfo(async url=>{assert.match(url,/imedbensalah99-cmd\/APP-AI/);return {status:200,json:async()=>({full_name:'imedbensalah99-cmd/APP-AI',default_branch:'main',html_url:'https://github.com/imedbensalah99-cmd/APP-AI'})}});
 assert.equal(x.default_branch,'main');
});
test('fails closed when public source returns HTTP failure',async()=>{
 await assert.rejects(publicResearch('valid query',async()=>({status:429})),/429/);
 await assert.rejects(githubPublicInfo(async()=>({status:403})),/403/);
});
