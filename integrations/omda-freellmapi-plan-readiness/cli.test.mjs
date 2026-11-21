import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { makePlan } from '../omda-freellmapi-workflow-studio/engine.mjs';

const cli = resolve(new URL('./cli.mjs', import.meta.url).pathname);
function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 5000 });
}
function withPlan(t, planOrText, callback) {
  const dir = mkdtempSync(join(tmpdir(), 'omda-plan-readiness-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'plan.json');
  writeFileSync(file, typeof planOrText === 'string' ? planOrText : JSON.stringify(planOrText));
  return callback(file);
}

test('CLI prints a READY summary and exits zero for a safe plan', t => withPlan(t, makePlan('prepare a project brief'), file => {
  const result = run([file]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Decision: READY/);
  assert.match(result.stdout, /Plan SHA-256:/);
}));

test('CLI exits one for a blocked plan', t => {
  const plan = makePlan('build a website');
  plan.steps[3].approvalRequired = false;
  return withPlan(t, plan, file => {
    const result = run([file]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Decision: BLOCKED/);
  });
});

test('CLI supports JSON and CSV output formats', t => withPlan(t, makePlan('prepare a document'), file => {
  const json = run([file, '--format', 'json']);
  assert.equal(json.status, 0, json.stderr);
  assert.equal(JSON.parse(json.stdout).schemaVersion, 1);
  assert.equal(json.stdout.includes('prepare a document'), false);
  const csv = run([file, '--format=csv']);
  assert.equal(csv.status, 0, csv.stderr);
  assert.ok(csv.stdout.startsWith('\uFEFF'));
}));

test('CLI can make REVIEW a failing CI gate', t => {
  const plan = makePlan('prepare a document');
  plan.steps[0].approved = true;
  return withPlan(t, plan, file => {
    assert.equal(run([file]).status, 0);
    assert.equal(run([file, '--fail-on-review']).status, 1);
  });
});

test('CLI rejects missing arguments and oversized files', t => {
  const usage = run([]);
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /plan JSON file is required/);
  return withPlan(t, ' '.repeat(131073), file => {
    const oversized = run([file]);
    assert.equal(oversized.status, 2);
    assert.match(oversized.stderr, /128 KiB/);
  });
});
