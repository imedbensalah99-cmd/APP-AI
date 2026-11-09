import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuditLedger,verifyAuditLedger} from './audit.mjs';
test('ledger records a verified two-step task lifecycle',()=>{
 const a=createAuditLedger();a.append({type:'task.created',taskId:'job-1',detail:'Create spreadsheet',at:'2026-11-09T05:00:00.000Z'});a.append({type:'artifact.created',taskId:'job-1',detail:'tracker.csv',at:'2026-11-09T05:00:01.000Z'});
 const s=a.snapshot();assert.equal(s.length,2);assert.equal(s[1].previousHash,s[0].hash);assert.ok(verifyAuditLedger(s));assert.deepEqual(JSON.parse(a.exportJson()).events,s);
});
test('tampering and reordering are detected',()=>{
 const a=createAuditLedger();a.append({type:'task.created'});a.append({type:'task.completed'});
 const s=a.snapshot();s[0].detail='tampered';assert.equal(verifyAuditLedger(s),false);
 assert.equal(verifyAuditLedger(a.snapshot().reverse()),false);
});
test('secrets are redacted from detail',()=>{
 const a=createAuditLedger();const e=a.append({type:'task.failed',detail:'password=SuperSecret123 token=abc12345'});
 assert.ok(!e.detail.includes('SuperSecret123'));assert.ok(!e.detail.includes('abc12345'));assert.ok(e.detail.includes('[REDACTED]'));
});
test('unsupported events and unsafe bounds are rejected',()=>{
 assert.throws(()=>createAuditLedger({limit:501}),RangeError);
 const a=createAuditLedger({limit:1});assert.throws(()=>a.append({type:'send.email'}),TypeError);
 a.append({type:'task.created'});assert.throws(()=>a.append({type:'task.completed'}),RangeError);
});
test('snapshots are copies and no network or persistence is required',()=>{
 const a=createAuditLedger();a.append({type:'task.started',taskId:'1'});const s=a.snapshot();s[0].detail='changed';assert.equal(a.snapshot()[0].detail,'');assert.ok(verifyAuditLedger(a.snapshot()));
});
