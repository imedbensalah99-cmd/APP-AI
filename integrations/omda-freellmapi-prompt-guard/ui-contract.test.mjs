import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('./app.mjs', import.meta.url), 'utf8');
const commandCenter = readFileSync(new URL('../omda-freellmapi-command-center/index.html', import.meta.url), 'utf8');

test('page has a restrictive offline Content Security Policy', () => {
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes("connect-src 'none'"));
  assert.ok(html.includes("script-src 'self'"));
  assert.equal(html.includes('https://'), false);
});

test('browser code avoids network and persistent storage APIs', () => {
  for (const forbidden of ['fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'indexedDB', 'sendBeacon']) {
    assert.equal(app.includes(forbidden), false, forbidden);
  }
  assert.ok(app.includes('textContent'));
  assert.ok(app.includes('navigator.clipboard.writeText'));
});

test('command center links to the new Prompt Guard', () => {
  assert.ok(commandCenter.includes('../omda-freellmapi-prompt-guard/index.html'));
});
