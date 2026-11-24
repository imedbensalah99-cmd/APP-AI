import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { canonicalizeEvidenceJson, verifyTaskSessionEvidenceBundle } from './evidence-core.mjs';
const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, 'verify-evidence.mjs');
const zero = '0'.repeat(64), now = '2026-11-24T04:00:00.000Z';
const hash = value => createHash('sha256').update(value, 'utf8').digest('hex');
function event(input) {
  const canonical = { sessionId: input.sessionId, seq: input.seq, action: input.action, fromStatus: input.fromStatus,
    toStatus: input.toStatus, note: input.note, occurredAt: input.occurredAt, previousHash: input.previousHash };
  return { ...canonical, eventHash: hash(JSON.stringify(canonical)) };
}
function bundleFixture() {
  const id = randomUUID();
  const created = event({sessionId:id,seq:0,action:'created',fromStatus:null,toStatus:'draft',note:null,occurredAt:now,previousHash:zero});
  const started = event({sessionId:id,seq:1,action:'start',fromStatus:'draft',toStatus:'running',note:null,occurredAt:now,previousHash:created.eventHash});
  const completed = event({sessionId:id,seq:2,action:'complete',fromStatus:'running',toStatus:'completed',note:'Local test evidence',occurredAt:now,previousHash:started.eventHash});
  const unsigned = {schemaVersion:'omda.task-session-evidence.v1',exportedAt:now,
    session:{id,label:'Synthetic test session',planSha256:'a'.repeat(64),status:'completed',revision:2,createdAt:now,updatedAt:now},
    events:[created,started,completed],verification:{valid:true,eventCount:3,lastHash:completed.eventHash}};
  return {...unsigned,bundleSha256:hash(canonicalizeEvidenceJson(unsigned))};
}
test('accepts valid bundle and returns only safe summary fields', async () => {
  const result = await verifyTaskSessionEvidenceBundle(bundleFixture());
  assert.equal(result.valid,true); assert.equal(result.summary.status,'completed'); assert.equal(result.summary.eventCount,3);
  assert.equal(Object.hasOwn(result.summary,'label'),false); assert.equal(Object.hasOwn(result.summary,'notes'),false);
});
test('rejects note tampering even if bundle digest is recomputed', async () => {
  const b=bundleFixture(); b.events[2].note='altered'; const {bundleSha256,...unsigned}=b; b.bundleSha256=hash(canonicalizeEvidenceJson(unsigned));
  const result=await verifyTaskSessionEvidenceBundle(b); assert.equal(result.reason,'event_hash_mismatch');
});
test('rejects digest mismatch and unknown top-level keys', async () => {
  const b=bundleFixture(); b.bundleSha256='f'.repeat(64); assert.equal((await verifyTaskSessionEvidenceBundle(b)).reason,'bundle_digest_mismatch');
  assert.equal((await verifyTaskSessionEvidenceBundle({...bundleFixture(),command:'forbidden'})).reason,'invalid_bundle_shape');
});
test('rejects invalid transitions, sequence gaps and foreign session events', async () => {
  const a=bundleFixture(); a.events[2].toStatus='paused'; assert.equal((await verifyTaskSessionEvidenceBundle(a)).reason,'invalid_transition_record');
  const b=bundleFixture(); b.events[1].seq=4; assert.equal((await verifyTaskSessionEvidenceBundle(b)).reason,'sequence_gap');
  const c=bundleFixture(); c.events[1].sessionId=randomUUID(); assert.equal((await verifyTaskSessionEvidenceBundle(c)).reason,'event_session_mismatch');
});
test('rejects unsupported schemas, event overflow and non-canonical timestamps', async () => {
  const a=bundleFixture(); a.schemaVersion='other'; assert.equal((await verifyTaskSessionEvidenceBundle(a)).reason,'unsupported_schema');
  const b=bundleFixture(); b.events=Array.from({length:2001},(_,i)=>b.events[i%3]); assert.equal((await verifyTaskSessionEvidenceBundle(b)).reason,'invalid_event_count');
  const c=bundleFixture(); c.exportedAt='2026-11-24T04:00:00Z'; assert.equal((await verifyTaskSessionEvidenceBundle(c)).reason,'invalid_export_timestamp');
});
test('CLI verifies files and does not echo labels or notes', () => {
  const dir=mkdtempSync(join(tmpdir(),'omda-evidence-'));
  try {
    const file=join(dir,'bundle.json'); writeFileSync(file,JSON.stringify(bundleFixture()),'utf8');
    const result=spawnSync(process.execPath,[cli,file,'--format','json'],{encoding:'utf8'});
    assert.equal(result.status,0); assert.match(result.stdout,/"valid":true/);
    assert.doesNotMatch(result.stdout,/Synthetic test session|Local test evidence/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('mobile browser verifier remains offline and uses textContent', () => {
  const html=readFileSync(join(here,'evidence-verifier','index.html'),'utf8');
  assert.match(html,/type="module"/); assert.doesNotMatch(html,/<script[^>]+src="https?:\/\//i);
  assert.doesNotMatch(html,/href="https?:\/\//i); assert.doesNotMatch(html,/localStorage|sessionStorage|innerHTML|fetch\s*\(/);
  assert.match(html,/\.textContent\s*=/);
});
