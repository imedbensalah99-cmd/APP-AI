import test from 'node:test';
import assert from 'node:assert/strict';
import {routeCommand,classify} from './router.mjs';
test('email is routed to offline draft artifact',()=>{
 assert.equal(classify('اكتب إيميل للموارد البشرية'),'email');
 const r=routeCommand('Draft email for AML application',{email:{recipient:'hr@example.com',facts:['I have AML analyst experience']}});
 assert.equal(r.kind,'email');
 assert.equal(r.artifact.filename,'omda-email-draft.txt');
 assert.match(r.artifact.content,/hr@example.com/);
 assert.equal(r.sent,false);assert.equal(r.networkCalls,0);assert.equal(r.paidCalls,0);
});
test('invalid email address is rejected',()=>assert.throws(()=>routeCommand('Write email',{email:{recipient:'not-an-email'}})));
test('other existing routing remains intact',()=>assert.equal(classify('Make Excel table'),'spreadsheet'));
