import test from 'node:test';
import assert from 'node:assert/strict';
import {draftEmail,exportDraftText} from './email-draft.mjs';
test('English draft is not sent and requires approval',()=>{
 const d=draftEmail({purpose:'AML Analyst application',recipient:'hr@example.com',facts:['AML analyst since May 2025']});
 assert.equal(d.to,'hr@example.com');assert.equal(d.sent,false);assert.equal(d.requiresApproval,true);assert.match(d.body,/May 2025/);
 assert.equal(exportDraftText(d).filename,'omda-email-draft.txt');
});
test('Arabic draft',()=>{const d=draftEmail({purpose:'طلب معلومات',language:'ar'});assert.match(d.body,/أتواصل/);assert.equal(d.status,'DRAFT_ONLY');});
test('reject invalid recipient',()=>assert.throws(()=>draftEmail({purpose:'hello',recipient:'invalid'})));
test('reject unbounded facts',()=>assert.throws(()=>draftEmail({purpose:'hello',facts:Array(13).fill('x')})));
test('reject control chars',()=>assert.throws(()=>draftEmail({purpose:'hello\u0000'})));
test('reject unknown language',()=>assert.throws(()=>draftEmail({purpose:'hello',language:'fr'})));
test('reject fake sent artifact',()=>assert.throws(()=>exportDraftText({status:'DRAFT_ONLY',sent:true})));
test('empty recipient is valid for drafting',()=>assert.equal(draftEmail({purpose:'follow up'}).to,''));
