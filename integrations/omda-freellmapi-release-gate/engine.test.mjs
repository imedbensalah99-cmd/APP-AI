import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { analyzeSnapshot, analyzeSnapshotText, exportReportCsv, exportReportJson, MAX_INPUT_BYTES } from './engine.mjs';

const FIXTURE = JSON.parse(fs.readFileSync(new URL('./fixtures/current-staging-snapshot.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-11-16T04:55:43Z');
const clone = value => structuredClone(value);
function healthySnapshot() {
  const s = clone(FIXTURE);
  s.github.branchProtected = true;
  s.github.requiredChecks = ['omda-release-gate'];
  s.github.runs = [{ id: 999, branch: s.github.branch, headSha: s.github.headSha, status: 'completed', conclusion: 'success', updatedAt: '2026-11-16T04:50:00Z' }];
  s.render.ipAllowList = ['203.0.113.0/24'];
  s.render.latestDeploySha = s.github.headSha;
  s.render.latestDeployStatus = 'live';
  s.cloudflare.d1DatabaseCount = 8;
  return s;
}
const ids = report => new Set(report.findings.map(item => item.id));

test('current verified staging snapshot is BLOCKED for concrete release risks', () => {
  const report = analyzeSnapshot(FIXTURE, { now: NOW });
  assert.equal(report.readiness, 'BLOCKED');
  const found = ids(report);
  for (const id of ['branch_unprotected', 'required_checks_missing', 'ci_stale', 'render_open_allowlist', 'render_deploy_behind', 'd1_capacity_full']) assert.ok(found.has(id), id);
  assert.equal(report.deploymentPerformed, false);
  assert.equal(report.externalActionsPerformed, false);
});

test('fully healthy, fresh snapshot becomes review-ready but never authorizes deployment', () => {
  const report = analyzeSnapshot(healthySnapshot(), { now: NOW });
  assert.equal(report.readiness, 'REVIEW_READY');
  assert.equal(report.counts.BLOCKER, 0);
  assert.equal(report.deploymentPerformed, false);
});

test('wrong repository or branch is blocked without echoing imported values', () => {
  const s = healthySnapshot(); s.github.repository = 'other/private-repo'; s.github.branch = 'main';
  const report = analyzeSnapshot(s, { now: NOW });
  assert.ok(ids(report).has('github_repository_mismatch'));
  assert.ok(ids(report).has('github_branch_mismatch'));
  assert.doesNotMatch(JSON.stringify(report), /other\/private-repo/);
});

test('missing CI, pending CI and failed CI all block', () => {
  let s = healthySnapshot(); s.github.runs = [];
  assert.ok(ids(analyzeSnapshot(s, { now: NOW })).has('ci_missing'));
  s = healthySnapshot(); s.github.runs[0].status = 'in_progress'; s.github.runs[0].conclusion = null;
  assert.ok(ids(analyzeSnapshot(s, { now: NOW })).has('ci_pending'));
  s = healthySnapshot(); s.github.runs[0].conclusion = 'failure';
  assert.ok(ids(analyzeSnapshot(s, { now: NOW })).has('ci_failed'));
});

test('stale snapshot and stale CI produce warnings', () => {
  const s = healthySnapshot(); s.capturedAt = '2026-11-14T00:00:00Z'; s.github.runs[0].updatedAt = '2026-11-14T00:00:00Z';
  const report = analyzeSnapshot(s, { now: NOW });
  assert.ok(ids(report).has('snapshot_stale'));
  assert.ok(ids(report).has('ci_stale'));
  assert.equal(report.readiness, 'CONDITIONAL');
});

test('branch protection and required checks are independent gates', () => {
  const s = healthySnapshot(); s.github.branchProtected = false;
  assert.ok(ids(analyzeSnapshot(s, { now: NOW })).has('branch_unprotected'));
  s.github.branchProtected = true; s.github.requiredChecks = [];
  assert.ok(ids(analyzeSnapshot(s, { now: NOW })).has('required_checks_missing'));
});

test('Render branch mismatch, non-free plan and auto deploy block', () => {
  const s = healthySnapshot(); s.render.branch = 'main'; s.render.plan = 'pro'; s.render.autoDeployEnabled = true;
  const found = ids(analyzeSnapshot(s, { now: NOW }));
  assert.ok(found.has('render_branch_mismatch'));
  assert.ok(found.has('render_not_free'));
  assert.ok(found.has('render_auto_deploy'));
});

test('open IPv4 or IPv6 allowlist blocks; empty allowlist warns', () => {
  const s = healthySnapshot(); s.render.ipAllowList = ['::/0'];
  assert.ok(ids(analyzeSnapshot(s, { now: NOW })).has('render_open_allowlist'));
  s.render.ipAllowList = [];
  assert.ok(ids(analyzeSnapshot(s, { now: NOW })).has('render_allowlist_unknown'));
});

test('non-live deployment blocks and a stale deployment warns', () => {
  const s = healthySnapshot(); s.render.latestDeployStatus = 'build_failed';
  assert.ok(ids(analyzeSnapshot(s, { now: NOW })).has('render_deploy_not_live'));
  s.render.latestDeployStatus = 'live'; s.render.latestDeploySha = 'e8d3731c25f78599f04d645f2603244902636023';
  assert.ok(ids(analyzeSnapshot(s, { now: NOW })).has('render_deploy_behind'));
});

test('missing workers and full D1 quota warn without requesting resource creation', () => {
  const s = healthySnapshot(); s.cloudflare.workerNames = []; s.cloudflare.d1DatabaseCount = 10;
  const report = analyzeSnapshot(s, { now: NOW });
  assert.ok(ids(report).has('cloudflare_workers_missing'));
  assert.ok(ids(report).has('d1_capacity_full'));
  assert.match(report.findings.find(x => x.id === 'd1_capacity_full').detail, /لا تنشئ قاعدة جديدة/);
});

test('rejects malformed JSON and payloads over 64 KiB', () => {
  assert.throws(() => analyzeSnapshotText('{bad'), /valid JSON/);
  assert.throws(() => analyzeSnapshotText(' '.repeat(MAX_INPUT_BYTES + 1)), /64 KiB/);
});

test('rejects unknown fields at every schema level', () => {
  const s = healthySnapshot(); s.github.token = 'not-accepted';
  assert.throws(() => analyzeSnapshot(s, { now: NOW }), /unsupported fields/);
  const t = healthySnapshot(); t.render.extra = true;
  assert.throws(() => analyzeSnapshot(t, { now: NOW }), /unsupported fields/);
});

test('rejects invalid timestamps, CIDRs, duplicate worker names and inconsistent D1 capacity', () => {
  let s = healthySnapshot(); s.capturedAt = 'yesterday';
  assert.throws(() => analyzeSnapshot(s, { now: NOW }), /ISO timestamp/);
  s = healthySnapshot(); s.render.ipAllowList = ['0.0.0.0/99'];
  assert.throws(() => analyzeSnapshot(s, { now: NOW }), /invalid CIDR/);
  s = healthySnapshot(); s.cloudflare.workerNames.push(s.cloudflare.workerNames[0]);
  assert.throws(() => analyzeSnapshot(s, { now: NOW }), /duplicates/);
  s = healthySnapshot(); s.cloudflare.d1DatabaseCount = 11;
  assert.throws(() => analyzeSnapshot(s, { now: NOW }), /inconsistent/);
});

test('rejects future snapshots beyond five minutes', () => {
  const s = healthySnapshot(); s.capturedAt = '2026-11-16T05:02:00Z';
  assert.throws(() => analyzeSnapshot(s, { now: NOW }), /future/);
});

test('exports contain only findings and are safe for spreadsheet consumers', () => {
  const report = analyzeSnapshot(FIXTURE, { now: NOW });
  const json = exportReportJson(report);
  const csv = exportReportCsv(report);
  assert.match(json, /IMPORTED_SNAPSHOT_ONLY/);
  assert.match(csv, /^\uFEFF/);
  assert.match(csv, /BLOCKER/);
  assert.doesNotMatch(json + csv, /gh[pousr]_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]+/);
  assert.throws(() => exportReportJson({ findings: [] }), /Invalid report/);
});
