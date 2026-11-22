import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { makePlan } from '../omda-freellmapi-workflow-studio/engine.mjs';
import { parseArgs } from './cli.mjs';

const cliPath = resolve('integrations/omda-freellmapi-workflow-simulation/cli.mjs');

test('parses only documented bounded options', () => {
  const parsed = parseArgs(['plan.json', '--format', 'csv', '--concurrency', '3', '--minutes', '20', '--approval-wait', '5']);
  assert.equal(parsed.format, 'csv');
  assert.equal(parsed.options.concurrency, 3);
  assert.equal(parsed.options.defaultMinutes, 20);
  assert.equal(parsed.options.approvalWaitMinutes, 5);
  assert.throws(() => parseArgs(['plan.json', '--network', 'true']), /Unknown/);
  assert.throws(() => parseArgs(['plan.json', '--format']), /Missing/);
  assert.equal(parseArgs(['--help']).help, true);
});
test('CLI emits a JSON simulation report and exits successfully', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omda-sim-'));
  try {
    const file = join(dir, 'plan.json');
    writeFileSync(file, JSON.stringify(makePlan('Create document')), 'utf8');
    const run = spawnSync(process.execPath, [cliPath, file, '--minutes', '9'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.mode, 'SIMULATION_ONLY');
    assert.equal(report.summary.totalWorkMinutes, 27);
    assert.equal(report.executionStarted, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('CLI emits CSV to stdout and creates no output file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omda-sim-'));
  try {
    const file = join(dir, 'plan.json');
    writeFileSync(file, JSON.stringify(makePlan('Create document')), 'utf8');
    const run = spawnSync(process.execPath, [cliPath, file, '--format', 'csv'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /"ID","Task","State"/);
    assert.deepEqual(readdirSync(dir), ['plan.json']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('CLI rejects malformed JSON with a bounded error code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omda-sim-'));
  try {
    const file = join(dir, 'bad.json');
    writeFileSync(file, '{broken', 'utf8');
    const run = spawnSync(process.execPath, [cliPath, file], { encoding: 'utf8' });
    assert.equal(run.status, 2);
    assert.match(run.stderr, /Simulation failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
