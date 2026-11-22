import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

test('browser UI imports the real simulation engine and supports bounded plan input', () => {
  assert.match(html, /import \{ simulatePlan/);
  assert.match(html, /MAX_PLAN_BYTES/);
  assert.match(html, /accept="\.json,application\/json"/);
  assert.match(html, /approvalWaitMinutes/);
});
test('browser UI renders untrusted labels through textContent and has no HTML injection sink', () => {
  assert.match(html, /textContent/);
  assert.doesNotMatch(html, /innerHTML|insertAdjacentHTML/);
});
test('browser UI is offline-only and does not persist imported plans', () => {
  assert.doesNotMatch(html, /\bfetch\s*\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB|sendBeacon/);
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/);
});
test('changing simulation settings invalidates stale results before export', () => {
  assert.match(html, /function invalidateResult\(\)/);
  assert.match(html, /concurrency\.addEventListener\('change'/);
  assert.match(html, /approvalWait\.addEventListener\('change'/);
  assert.match(html, /defaultMinutes\.addEventListener\('change'/);
});
test('browser UI exports reports as user-initiated downloads', () => {
  assert.match(html, /URL\.createObjectURL/);
  assert.match(html, /downloadFile\(exportJSON/);
  assert.match(html, /downloadFile\(exportCSV/);
});
