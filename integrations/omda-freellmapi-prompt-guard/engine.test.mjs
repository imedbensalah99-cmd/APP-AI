import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_PROMPT_BYTES, MAX_PROMPT_CHARS, scanPrompt, redactPrompt } from './engine.mjs';

test('detects common provider tokens without returning their values', () => {
  const secret = 'sk-' + 'A'.repeat(28);
  const result = scanPrompt('Use this key: ' + secret);
  assert.equal(result.counts.high, 1);
  assert.equal(result.findings[0].id, 'openai-key');
  assert.equal(JSON.stringify(result.findings).includes(secret), false);
  assert.equal(result.sanitizedPrompt.includes(secret), false);
});

test('detects private key blocks across line breaks', () => {
  const input = '-----BEGIN PRIVATE KEY-----\\nSYNTHETIC-MATERIAL\\n-----END PRIVATE KEY-----';
  const result = scanPrompt(input);
  assert.equal(result.counts.critical, 1);
  assert.equal(result.sanitizedPrompt, '[REDACTED:secret]');
});

test('detects credential assignments and URL query secrets', () => {
  const result = scanPrompt('password="example-pass-123" https://example.test/?access_token=abcdefgh123456');
  assert.ok(result.findings.some(item => item.id === 'credential-assignment'));
  assert.ok(result.findings.some(item => item.id === 'url-query-secret'));
  assert.ok(!result.sanitizedPrompt.includes('example-pass-123'));
  assert.ok(!result.sanitizedPrompt.includes('abcdefgh123456'));
});

test('detects email, Qatar mobile and Qatar ID as personal data', () => {
  const result = scanPrompt('Contact person@example.test or 50960486; ID 12345678901');
  assert.equal(result.counts.medium, 3);
  assert.equal(result.categories.personal, 3);
  assert.ok(!result.sanitizedPrompt.includes('person@example.test'));
  assert.ok(!result.sanitizedPrompt.includes('50960486'));
  assert.ok(!result.sanitizedPrompt.includes('12345678901'));
});

test('validates card candidates with Luhn to reduce false positives', () => {
  const result = scanPrompt('Card 4111 1111 1111 1111 and reference 1234 5678 9012 3456');
  assert.equal(result.findings.filter(item => item.id === 'credit-card').length, 1);
  assert.ok(!result.sanitizedPrompt.includes('4111 1111 1111 1111'));
  assert.ok(result.sanitizedPrompt.includes('1234 5678 9012 3456'));
});

test('merges overlapping detections into a single redaction range', () => {
  const token = 'sk-' + 'B'.repeat(28);
  const result = scanPrompt('api_key=' + token);
  assert.ok(result.findings.length >= 1);
  assert.equal(result.redactedRanges, 1);
  assert.ok(!result.sanitizedPrompt.includes(token));
});

test('does not modify caller input and leaves ordinary text unchanged', () => {
  const input = 'Summarize the public product roadmap for next quarter.';
  const before = input;
  assert.equal(redactPrompt(input), input);
  assert.equal(input, before);
});

test('accepts an empty prompt and reports no findings', () => {
  const result = scanPrompt('');
  assert.equal(result.counts.total, 0);
  assert.equal(result.sanitizedPrompt, '');
});

test('rejects non-text, oversized character and oversized UTF-8 inputs', () => {
  assert.throws(() => scanPrompt({ prompt: 'x' }), /prompt_must_be_text/);
  assert.throws(() => scanPrompt('x'.repeat(MAX_PROMPT_CHARS + 1)), /prompt_character_limit_exceeded/);
  assert.throws(() => scanPrompt('界'.repeat(Math.floor(MAX_PROMPT_BYTES / 3) + 1)), /prompt_byte_limit_exceeded/);
});
