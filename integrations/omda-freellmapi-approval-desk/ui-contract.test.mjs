import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');

test('approval desk uses its local engine and has no remote or persistent browser integration', () => {
  assert.match(html, /from '\.\/engine\.mjs'/);
  assert.doesNotMatch(html, /<script[^>]+src=["']https?:/i);
  assert.doesNotMatch(html, /\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/);
  assert.doesNotMatch(html, /\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/);
  assert.match(html, /textContent/);
  assert.doesNotMatch(html, /\b(innerHTML|outerHTML|insertAdjacentHTML)\b/);
  assert.match(html, /file\.size>131072/);
  assert.match(html, /تنزيل سجل JSON/);
  assert.match(html, /تنزيل CSV/);
});
