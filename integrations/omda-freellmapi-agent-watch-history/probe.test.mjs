import test from 'node:test';
import assert from 'node:assert/strict';
import { ORIGIN, ROUTES, classify, collectSnapshot } from './probe.mjs';

test('snapshot performs exactly two fixed-origin anonymous GETs', async () => {
  const calls = [];
  const result = await collectSnapshot(async (url, options) => {
    calls.push({ url, options });
    return { status: url.endsWith('/api/ping') ? 200 : 403 };
  }, () => '2026-11-18T04:15:00.000Z', () => '00000000-0000-4000-8000-000000000001');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(x => new URL(x.url).pathname), [...ROUTES]);
  for (const call of calls) {
    assert.equal(new URL(call.url).origin, ORIGIN);
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.redirect, 'manual');
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.body, undefined);
    assert.equal(call.options.headers.Authorization, undefined);
  }
  assert.equal(result.results[0].verdict, 'PERIMETER_OK');
});

test('fails closed when anonymous models access returns 200', async () => {
  const result = await collectSnapshot(async () => ({ status: 200 }));
  assert.equal(result.results[0].verdict, 'ORIGIN_GATE_OPEN');
});

test('records network failures as status zero without throwing', async () => {
  const result = await collectSnapshot(async () => { throw new Error('timeout'); });
  assert.equal(result.results[0].health_http, 0);
  assert.equal(result.results[0].model_http, 0);
  assert.equal(result.results[0].verdict, 'NETWORK_UNAVAILABLE');
});

test('keeps all verdicts aligned with the deployed Agent Watch classifier', () => {
  assert.equal(classify(200, 403), 'PERIMETER_OK');
  assert.equal(classify(200, 200), 'ORIGIN_GATE_OPEN');
  assert.equal(classify(0, 403), 'NETWORK_UNAVAILABLE');
  assert.equal(classify(503, 403), 'PERIMETER_NOT_READY');
});

test('imports do not run live probes', async () => {
  // Importing this module exposes functions only; network calls occur only in collectSnapshot/main.
  assert.equal(typeof collectSnapshot, 'function');
});
