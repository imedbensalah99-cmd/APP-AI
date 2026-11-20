import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createApprovalPacket, decideApproval, digestPlan, exportApprovalCsv, exportApprovalJson,
  parsePlanJson, summarizeApprovals, validateApprovalPacket, validatePlan, MAX_PLAN_BYTES,
} from './engine.mjs';

function plan() {
  return {
    schemaVersion: 1,
    command: 'Build a website and prepare an email draft',
    mode: 'PLAN_ONLY', networkCalls: 0, paidCalls: 0, generatedAt: null,
    steps: [
      { id: 'website-1', kind: 'website', title: 'Collect requirements', status: 'todo', dependsOn: [], approvalRequired: false, approved: false, execution: 'manual', note: '' },
      { id: 'website-2', kind: 'website', title: 'Create local draft', status: 'todo', dependsOn: ['website-1'], approvalRequired: false, approved: false, execution: 'manual', note: '' },
      { id: 'website-3', kind: 'website', title: 'Approval before public deployment', status: 'todo', dependsOn: ['website-2'], approvalRequired: true, approved: false, execution: 'manual', note: 'No external deployment' },
      { id: 'email-1', kind: 'email', title: 'Prepare email', status: 'todo', dependsOn: [], approvalRequired: false, approved: false, execution: 'manual', note: '' },
      { id: 'email-2', kind: 'email', title: 'Review recipient', status: 'todo', dependsOn: ['email-1'], approvalRequired: false, approved: false, execution: 'manual', note: '' },
      { id: 'email-3', kind: 'email', title: 'Approval before sending', status: 'todo', dependsOn: ['email-2'], approvalRequired: true, approved: false, execution: 'manual', note: 'No email is sent' },
    ],
  };
}
const at = new Date('2026-11-20T04:00:00.000Z');

test('accepts a valid Workflow Studio export and rejects oversized or malformed JSON', () => {
  assert.deepEqual(parsePlanJson(JSON.stringify(plan())), plan());
  assert.throws(() => parsePlanJson('{'), /valid JSON/);
  assert.throws(() => parsePlanJson('x'.repeat(MAX_PLAN_BYTES + 1)), /128 KiB/);
});

test('strictly rejects execution modes, extra fields and removed approval gates', () => {
  const badMode = { ...plan(), mode: 'EXECUTE' };
  assert.throws(() => validatePlan(badMode), /envelope/);
  const extra = { ...plan(), execute: true };
  assert.throws(() => validatePlan(extra), /envelope/);
  const noGate = plan();
  noGate.steps[2].approvalRequired = false;
  assert.throws(() => validatePlan(noGate), /must end with an approval-required step/);
});

test('creates pending decisions bound to a canonical SHA-256 plan digest', async () => {
  const p = plan();
  const packet = await createApprovalPacket(p, at);
  assert.equal(packet.planDigest, await digestPlan(p));
  assert.equal(packet.decisions.length, 2);
  assert.deepEqual(summarizeApprovals(packet), { pending: 2, approved: 0, rejected: 0, total: 2, complete: false });
  const reordered = JSON.parse(JSON.stringify(p));
  reordered.steps[0] = Object.fromEntries(Object.entries(reordered.steps[0]).reverse());
  assert.equal(await digestPlan(reordered), packet.planDigest);
});

test('records an explicit approval without changing the source plan', async () => {
  const p = plan();
  const packet = await createApprovalPacket(p, at);
  const next = await decideApproval(packet, p, 'website-3', 'approved', 'Reviewed preview only', at);
  assert.equal(next.decisions[0].decision, 'approved');
  assert.equal(next.decisions[0].decidedAt, at.toISOString());
  assert.equal(packet.decisions[0].decision, 'pending');
  assert.equal(p.steps[2].status, 'todo');
  assert.equal(summarizeApprovals(next).approved, 1);
});

test('requires a meaningful rejection reason and prevents decision overwrite', async () => {
  const p = plan();
  const packet = await createApprovalPacket(p, at);
  await assert.rejects(() => decideApproval(packet, p, 'email-3', 'rejected', 'no', at), /at least 5/);
  const rejected = await decideApproval(packet, p, 'email-3', 'rejected', 'Recipient not verified', at);
  await assert.rejects(() => decideApproval(rejected, p, 'email-3', 'approved', '', at), /cannot be overwritten/);
});

test('rejects a packet when its plan changes or its decisions are tampered with', async () => {
  const p = plan();
  const packet = await createApprovalPacket(p, at);
  const changed = JSON.parse(JSON.stringify(p));
  changed.steps[0].title = 'Different requirement';
  await assert.rejects(() => validateApprovalPacket(packet, changed), /different plan/);
  const malformed = { ...packet, decisions: [{ ...packet.decisions[0], decision: 'approved', decidedAt: null }, packet.decisions[1]] };
  await assert.rejects(() => validateApprovalPacket(malformed, p), /timestamp/);
});

test('exports only verified decisions and neutralizes CSV formula injection', async () => {
  const p = plan();
  let packet = await createApprovalPacket(p, at);
  packet = await decideApproval(packet, p, 'website-3', 'approved', '=SUM(1,1)', at);
  const json = await exportApprovalJson(packet, p);
  assert.deepEqual(JSON.parse(json), packet);
  const csv = await exportApprovalCsv(packet, p);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /'=SUM\(1,1\)/);
});

test('rejects malformed dependencies and unbounded reviewer notes', async () => {
  const p = plan();
  const bad = JSON.parse(JSON.stringify(p));
  bad.steps[1].dependsOn = ['missing-1'];
  assert.throws(() => validatePlan(bad), /earlier steps/);
  const packet = await createApprovalPacket(p, at);
  await assert.rejects(() => decideApproval(packet, p, 'website-3', 'approved', 'x'.repeat(241), at), /240 characters/);
});
