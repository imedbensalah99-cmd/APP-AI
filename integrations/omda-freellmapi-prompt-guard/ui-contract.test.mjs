import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('./app.mjs', import.meta.url), 'utf8');
const commandCenter = readFileSync(new URL('../omda-freellmapi-command-center/index.html', import.meta.url), 'utf8');

test('page has a restrictive offline Content Security Policy', () => {
  assert.match(html, /default-src 'none'/);
  assert.match(html, /connect-src 'none'/);
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /https?:\\/\\//i);
});

test('browser code avoids network and persistent storage APIs', () => {
  assert.doesNotMatch(app, /\\bfetch\\s*\\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon/);
  assert.match(app, /textContent/);
  assert.match(app, /navigator\\.clipboard\\.writeText/);
});

test('command center links to the new Prompt Guard', () => {
  assert.match(commandCenter, /\\.\\.\\/omda-freellmapi-prompt-guard\\/index\\.html/);
});
