import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = new URL('.', import.meta.url);
const cli = fileURLToPath(new URL('./cli.mjs', here));

function runCli(file, ...args) {
  return spawnSync(process.execPath, [cli, file, ...args], { encoding: 'utf8', timeout: 3000 });
}

test('summary reports findings without echoing secret values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omda-prompt-guard-'));
  try {
    const file = join(dir, 'prompt.txt');
    const secret = 'sk-' + 'C'.repeat(28);
    writeFileSync(file, 'Use key ' + secret, 'utf8');
    const result = runCli(file);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Findings: 1/);
    assert.equal(result.stdout.includes(secret), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('redacted output contains placeholders and not the matched token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omda-prompt-guard-'));
  try {
    const file = join(dir, 'prompt.txt');
    const secret = 'ghp_' + 'D'.repeat(28);
    writeFileSync(file, 'token ' + secret, 'utf8');
    const result = runCli(file, '--format', 'redacted');
    assert.equal(result.status, 0);
    assert.match(result.stdout, /REDACTED:secret/);
    assert.equal(result.stdout.includes(secret), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('strict mode exits nonzero when findings exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omda-prompt-guard-'));
  try {
    const file = join(dir, 'prompt.txt');
    writeFileSync(file, 'Mail user@example.test', 'utf8');
    assert.equal(runCli(file, '--strict').status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('invalid options and missing input fail with exit code 2', () => {
  assert.equal(spawnSync(process.execPath, [cli, '--format', 'unknown'], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [cli], { encoding: 'utf8' }).status, 2);
});
