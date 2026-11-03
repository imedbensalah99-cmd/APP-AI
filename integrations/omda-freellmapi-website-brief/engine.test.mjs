import test from 'node:test';
import assert from 'node:assert/strict';
import {buildBrief} from './engine.mjs';
test('Arabic restaurant brief extracts pages and approvals',()=>{
 const p=buildBrief('اعمل موقع مطعم فيه قائمة الطعام وحجز واتساب بالعربية والإنجليزية');
 assert.equal(p.industry,'restaurant');assert.deepEqual(p.languages,['ar','en']);
 assert.deepEqual(p.pages.map(x=>x.slug),['home','menu','contact']);
 assert.ok(p.approvalGates.some(x=>x.includes('reservation')));
 assert.equal(p.published,false);assert.equal(p.networkCalls,0);
});
test('English portfolio is minimal and accessible',()=>{
 const p=buildBrief('Build a portfolio website with gallery');
 assert.equal(p.industry,'portfolio');assert.deepEqual(p.languages,['en']);
 assert.equal(p.requirements.accessible,true);assert.equal(p.pages[1].slug,'gallery');
});
test('never assumes payment is ready or live',()=>{
 const p=buildBrief('Create ecommerce store with payment and checkout');
 assert.equal(p.industry,'store');assert.ok(p.approvalGates.some(x=>x.includes('Payment')));
 assert.equal(p.paidCalls,0);
});
test('rejects control characters, overlong and malformed requests',()=>{
 for(const s of ['', 'x', 'a'.repeat(2501),'hello\nworld',null])assert.throws(()=>buildBrief(s));
});
test('output is deterministic and does not invent contacts',()=>{
 const p=buildBrief('أريد موقع شركة');
 assert.deepEqual(p,buildBrief('أريد موقع شركة'));
 assert.ok(!JSON.stringify(p).includes('example.com'));
});
