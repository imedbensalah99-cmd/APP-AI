import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makePlan } from '../omda-freellmapi-workflow-studio/engine.mjs';
import {
  analyzePlan, analyzePlanJson, exportReportJSON, exportReportCSV, csvCell, MAX_PLAN_BYTES
} from './engine.mjs';

const clock = new Date('2026-11-21T05:00:00.000Z');

test('marks a simple offline plan READY and does not mutate it', async () => {
  const plan = makePlan('prepare a general project brief');
  const before = JSON.stringify(plan);
  const report = await analyzePlan(plan, { now: clock });
  assert.equal(report.decision, 'READY');
  assert.equal(report.score, 100);
  assert.equal(report.summary.totalSteps, 3);
  assert.equal(JSON.stringify(plan), before);
});

test('accepts protected workstreams when their approval gate is terminal', async () => {
  const report = await analyzePlan(makePlan('build a website and draft an email'), { now: clock });
  assert.equal(report.decision, 'READY');
  assert.equal(report.summary.protectedWorkstreams, 2);
  assert.equal(report.summary.gatedWorkstreams, 2);
});

test('blocks a protected workstream when its approval gate is removed', async () => {
  const plan = makePlan('build a website');
  plan.steps[3].approvalRequired = false;
  const report = await analyzePlan(plan, { now: clock });
  assert.equal(report.decision, 'BLOCKED');
  assert.ok(report.findings.some(item => item.code === 'protected-workstream-missing-gate'));
});

test('blocks an explicit external action without a gate', async () => {
  const plan = makePlan('general project');
  plan.steps[1].title = 'Publish the public website';
  const report = await analyzePlan(plan, { now: clock });
  assert.equal(report.decision, 'BLOCKED');
  assert.ok(report.findings.some(item => item.code === 'external-action-without-gate' && item.stepId === plan.steps[1].id));
});

test('does not trust an imported approved boolean as reviewer evidence', async () => {
  const plan = makePlan('prepare a spreadsheet');
  plan.steps[0].approved = true;
  const report = await analyzePlan(plan, { now: clock });
  assert.ok(report.findings.some(item => item.code === 'imported-approval-untrusted'));
  assert.equal(report.decision, 'REVIEW');
});

test('detects a missing dependency within a workstream', async () => {
  const plan = makePlan('build a website');
  plan.steps[2].dependsOn = [];
  const report = await analyzePlan(plan, { now: clock });
  assert.ok(report.findings.some(item => item.code === 'workstream-dependency-gap'));
  assert.equal(report.decision, 'REVIEW');
});

test('detects an approval gate placed before later work in the same stream', async () => {
  const plan = makePlan('build a website');
  plan.steps[0].approvalRequired = true;
  const report = await analyzePlan(plan, { now: clock });
  assert.ok(report.findings.some(item => item.code === 'approval-gate-not-terminal'));
  assert.equal(report.decision, 'REVIEW');
});

test('blocks non-zero network and paid-call declarations', async () => {
  const plan = makePlan('prepare a document');
  plan.networkCalls = 1;
  plan.paidCalls = 1;
  const report = await analyzePlan(plan, { now: clock });
  assert.equal(report.decision, 'BLOCKED');
  assert.ok(report.findings.some(item => item.code === 'network-calls-enabled'));
  assert.ok(report.findings.some(item => item.code === 'paid-calls-enabled'));
});

test('flags imported approvals and completed steps without evidence notes', async () => {
  const plan = makePlan('prepare a document');
  plan.steps[0].status = 'done';
  const report = await analyzePlan(plan, { now: clock });
  assert.ok(report.findings.some(item => item.code === 'completed-without-evidence-note'));
});

test('rejects unknown plan or step fields instead of silently ignoring them', async () => {
  const plan = makePlan('prepare a document');
  plan.adminOverride = true;
  await assert.rejects(() => analyzePlan(plan, { now: clock }), /Unexpected or missing fields in plan/);
  const second = makePlan('prepare a document');
  second.steps[0].external = true;
  await assert.rejects(() => analyzePlan(second, { now: clock }), /Unexpected or missing fields in step/);
});

test('rejects unsupported workstream kinds and malformed timestamps', async () => {
  const plan = makePlan('prepare a document');
  plan.steps[0].kind = 'unknown';
  await assert.rejects(() => analyzePlan(plan, { now: clock }), /Unsupported workstream kind/);
  const invalidTime = makePlan('prepare a document');
  invalidTime.generatedAt = 'not-a-date';
  await assert.rejects(() => analyzePlan(invalidTime, { now: clock }), /Invalid generatedAt/);
});

test('bounds imported JSON by UTF-8 byte length', async () => {
  await assert.rejects(() => analyzePlanJson(' '.repeat(MAX_PLAN_BYTES + 1), { now: clock }), /128 KiB/);
});

test('parses valid JSON and fingerprints the complete plan deterministically', async () => {
  const plan = makePlan('prepare a document');
  const one = await analyzePlanJson(JSON.stringify(plan), { now: clock });
  const two = await analyzePlanJson(JSON.stringify(plan), { now: clock });
  assert.equal(one.planDigest, two.planDigest);
  const changed = structuredClone(plan);
  changed.steps[0].title = 'Prepare a different outline';
  const three = await analyzePlan(changed, { now: clock });
  assert.notEqual(one.planDigest, three.planDigest);
});

test('readiness report does not echo the original command or prompt', async () => {
  const secretLike = 'prepare a document using private customer phrase 7F3A9';
  const report = await analyzePlan(makePlan(secretLike), { now: clock });
  const serialized = exportReportJSON(report);
  assert.equal(serialized.includes(secretLike), false);
});

test('CSV output neutralizes formulas and quotes fields', async () => {
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  assert.equal(csvCell('safe, "quoted"'), '"safe, ""quoted"""');
  const report = await analyzePlan(makePlan('build a website'), { now: clock });
  const csv = exportReportCSV(report);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv, /Code,Severity,Step ID/);
});

test('browser UI uses local modules only and avoids unsafe DOM or persistent storage', () => {
  const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /from '\.\/engine\.mjs'/);
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
  assert.doesNotMatch(html, /\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/);
  assert.doesNotMatch(html, /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/);
  assert.match(html, /textContent/);
  assert.doesNotMatch(html, /\b(innerHTML|outerHTML|insertAdjacentHTML)\b/);
  assert.match(html, /file\.size>131072/);
  assert.match(html, /exportReportJSON/);
  assert.match(html, /exportReportCSV/);
});
