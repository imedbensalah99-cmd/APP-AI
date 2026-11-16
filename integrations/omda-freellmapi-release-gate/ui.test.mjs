import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');

test('release gate page imports only its local deterministic engine', () => {
  assert.match(html, /\.\/engine\.mjs/);
  assert.match(html, /type="module"/);
  assert.doesNotMatch(html, /https?:\/\//i);
});

test('release gate UI does not use network, storage, eval or unsafe HTML sinks', () => {
  for (const forbidden of [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /localStorage/, /sessionStorage/, /indexedDB/, /\beval\s*\(/, /innerHTML\s*=/, /outerHTML\s*=/]) {
    assert.doesNotMatch(html, forbidden, String(forbidden));
  }
  assert.match(html, /file\.text\(\)/);
  assert.match(html, /textContent/);
});

test('release gate UI exposes bounded JSON import and both report downloads', () => {
  assert.match(html, /accept="\.json,application\/json"/);
  assert.match(html, /MAX_INPUT_BYTES/);
  assert.match(html, /exportReportJson/);
  assert.match(html, /exportReportCsv/);
  assert.match(html, /clear/);
});
