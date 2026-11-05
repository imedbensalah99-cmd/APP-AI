import test from 'node:test';
import assert from 'node:assert/strict';
import {classify,routeCommand} from './router.mjs';
test('Arabic website produces real JSON brief without deployment',()=>{
 const r=routeCommand('اعمل موقع مطعم مع قائمة الطعام وواتساب');
 assert.equal(r.kind,'website');assert.equal(JSON.parse(r.artifact.content).industry,'restaurant');
 assert.equal(r.published,false);assert.equal(r.networkCalls,0);assert.equal(r.requiresExternalApproval,true);
});
test('English jobs creates spreadsheet artifact with no submissions',()=>{
 const r=routeCommand('Find me jobs in Qatar',{jobs:[{company:'Example',role:'AML Analyst',url:'https://example.org/jobs/1'}]});
 assert.equal(r.kind,'jobs');assert.match(r.artifact.content,/AML Analyst/);assert.equal(r.sent,false);
});
test('Arabic Excel defaults to valid CSV',()=>{
 const r=routeCommand('اعمل لي إكسل');assert.equal(r.kind,'spreadsheet');assert.equal(r.artifact.rowCount,0);
});
test('spreadsheet protects formula injection',()=>{
 const r=routeCommand('create an excel file',{columns:['Name'],rows:[['=HYPERLINK("bad")']]});
 assert.match(r.artifact.content,/'=HYPERLINK/);
});
test('unrecognized command gets a structured workflow plan',()=>{
 const r=routeCommand('Organize my weekly tasks');assert.equal(r.kind,'workflow');
 assert.equal(JSON.parse(r.artifact.content).mode,'PLAN_ONLY');
});
test('reject invalid commands and invalid job links',()=>{
 for(const x of ['', 'hi', 'a'.repeat(2001), 'valid\u0000bad'])assert.throws(()=>routeCommand(x));
 assert.throws(()=>routeCommand('Find jobs',{jobs:[{url:'javascript:alert(1)'}]}));
});
test('does not allow oversized spreadsheet',()=>{
 assert.throws(()=>routeCommand('Excel',{columns:['A'],rows:Array.from({length:1001},()=>['x'])}));
});
test('does not mutate caller input',()=>{
 const jobs=[{company:'Test',role:'Analyst'}];routeCommand('Find jobs',{jobs});assert.deepEqual(jobs,[{company:'Test',role:'Analyst'}]);
});
test('routes deterministic requests',()=>{
 assert.equal(classify('Build a portfolio website'),'website');
 assert.equal(classify('وظائف قطر'),'jobs');
 assert.equal(classify('create CSV'),'spreadsheet');
});
