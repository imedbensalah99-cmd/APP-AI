import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_BYTES, MAX_ROWS, analyzeHistory, exportHistoryCsv, exportHistoryJson,
  expectedVerdict, normalizeRows, parseSnapshotText,
} from './engine.mjs';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const row = (n, at, health = 200, models = 403) => ({
  id: id(n), created_at: at, health_http: health, model_http: models,
  verdict: expectedVerdict(health, models),
});
const sample = [
  row(1, '2026-11-16T04:15:00.000Z'),
  row(2, '2026-11-17T04:15:00.000Z'),
  row(3, '2026-11-18T04:15:00.000Z', 200, 200),
];

test('accepts the actual Cloudflare D1 query envelope', () => {
  const envelope = { success: true, result: [{ results: sample, success: true, meta: { rows_read: 3 } }], errors: [], messages: [] };
  assert.equal(normalizeRows(envelope).length, 3);
});

test('accepts a direct results array and sorts chronologically', () => {
  const rows = normalizeRows({ results: [sample[2], sample[0], sample[1]] });
  assert.deepEqual(rows.map(x => x.id), [id(1), id(2), id(3)]);
});

test('classifies the four Agent Watch outcomes exactly like the deployed worker', () => {
  assert.equal(expectedVerdict(200, 403), 'PERIMETER_OK');
  assert.equal(expectedVerdict(200, 200), 'ORIGIN_GATE_OPEN');
  assert.equal(expectedVerdict(0, 403), 'NETWORK_UNAVAILABLE');
  assert.equal(expectedVerdict(503, 403), 'PERIMETER_NOT_READY');
});

test('rejects a verdict that does not match the recorded HTTP codes', () => {
  assert.throws(() => normalizeRows([{ ...sample[0], verdict: 'ORIGIN_GATE_OPEN' }]), /mismatch/);
});

test('rejects extra fields so arbitrary log content cannot enter the dashboard', () => {
  assert.throws(() => normalizeRows([{ ...sample[0], token: 'should-not-be-here' }]), /Unexpected fields/);
});

test('rejects duplicate IDs and malformed timestamps', () => {
  assert.throws(() => normalizeRows([sample[0], sample[0]]), /Duplicate/);
  assert.throws(() => normalizeRows([{ ...sample[0], created_at: 'yesterday' }]), /timestamp/i);
});

test('rejects invalid HTTP status values and unknown verdicts', () => {
  assert.throws(() => normalizeRows([{ ...sample[0], health_http: 700 }]), /health_http/);
  assert.throws(() => normalizeRows([{ ...sample[0], verdict: 'UNKNOWN' }]), /Unknown verdict/);
});

test('enforces the retained history and byte limits', () => {
  assert.equal(MAX_ROWS, 30);
  assert.throws(() => normalizeRows(Array.from({ length: 31 }, (_, i) => row(i + 1, `2026-11-${String(i + 1).padStart(2, '0')}T04:15:00.000Z`))), /exceeds 30/);
  assert.throws(() => parseSnapshotText(' '.repeat(MAX_BYTES + 1)), /bytes/);
});

test('returns NO_DATA instead of fabricating a healthy state', () => {
  const result = analyzeHistory([], { now: new Date('2026-11-18T05:00:00.000Z') });
  assert.equal(result.status, 'NO_DATA');
  assert.equal(result.uptimePercent, null);
  assert.equal(result.checks, 0);
});

test('computes counts, uptime and consecutive streaks from verified rows', () => {
  const rows = [
    row(1, '2026-11-15T04:15:00.000Z'),
    row(2, '2026-11-16T04:15:00.000Z'),
    row(3, '2026-11-17T04:15:00.000Z', 503, 403),
    row(4, '2026-11-18T04:15:00.000Z'),
  ];
  const result = analyzeHistory(rows, { now: new Date('2026-11-18T05:00:00.000Z') });
  assert.equal(result.status, 'HEALTHY');
  assert.equal(result.checks, 4);
  assert.equal(result.successfulChecks, 3);
  assert.equal(result.failedChecks, 1);
  assert.equal(result.uptimePercent, 75);
  assert.equal(result.currentFailureStreak, 0);
  assert.equal(result.longestHealthyStreak, 2);
});

test('flags a currently open origin gate and stale history', () => {
  const open = analyzeHistory([row(1, '2026-11-18T04:15:00.000Z', 200, 200)], { now: new Date('2026-11-18T05:00:00.000Z') });
  assert.equal(open.status, 'ATTENTION');
  assert.equal(open.currentFailureStreak, 1);
  const stale = analyzeHistory([sample[0]], { now: new Date('2026-11-18T17:00:00.000Z') });
  assert.equal(stale.status, 'STALE');
});

test('flags future clock skew rather than claiming freshness', () => {
  const result = analyzeHistory([sample[2]], { now: new Date('2026-11-18T03:00:00.000Z') });
  assert.equal(result.status, 'CLOCK_SKEW');
});

test('exports only verified, bounded columns and neutralizes CSV formula starters', () => {
  const report = analyzeHistory(sample, { now: new Date('2026-11-18T05:00:00.000Z') });
  const csv = exportHistoryCsv(report);
  assert.match(csv, /created_at/);
  assert.match(csv, /ORIGIN_GATE_OPEN/);
  assert.doesNotMatch(csv, /00000000-0000/);
  const json = JSON.parse(exportHistoryJson(report, '2026-11-18T05:00:00.000Z'));
  assert.equal(json.schemaVersion, 1);
  assert.equal(json.checks.length, 3);
  assert.equal(json.checks[0].id, undefined);
});

test('parseSnapshotText validates and preserves the D1 envelope for analysis', () => {\n  const parsed = parseSnapshotText(JSON.stringify({ success: true, result: [{ results: sample }] }));\n  assert.equal(analyzeHistory(parsed, { now: new Date('2026-11-18T05:00:00.000Z') }).checks, 3);\n});\n\ntest('parseSnapshotText rejects malformed JSON', () => {
  assert.throws(() => parseSnapshotText('{bad json'), /Invalid JSON/);
});
