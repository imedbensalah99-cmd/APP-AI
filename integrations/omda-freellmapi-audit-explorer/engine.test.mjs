import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuditLedger } from '../omda-freellmapi-audit/audit.mjs';
import {
  MAX_BYTES, parseAuditExport, summarizeAudit, filterAuditEvents,
  redactForDisplay, exportAuditCsv, exportAuditJson
} from './engine.mjs';

function sampleLedger() {
  const ledger = createAuditLedger();
  ledger.append({ type: 'task.created', taskId: 'task-1', detail: 'Create a review plan', at: '2026-11-17T06:00:00.000Z' });
  ledger.append({ type: 'approval.requested', taskId: 'task-1', detail: 'Review external publish', at: '2026-11-17T06:00:01.000Z' });
  ledger.append({ type: 'task.completed', taskId: 'task-1', detail: 'Plan exported', at: '2026-11-17T06:00:02.000Z' });
  return ledger.snapshot();
}
const asExport = events => JSON.stringify({ schemaVersion: 1, events });

test('imports a valid bounded hash-chained audit export as immutable data', () => {
  const imported = parseAuditExport(asExport(sampleLedger()));
  assert.equal(imported.events.length, 3);
  assert.equal(Object.isFrozen(imported.events), true);
  assert.equal(Object.isFrozen(imported.events[0]), true);
  assert.equal(summarizeAudit(imported.events).verified, true);
});

test('rejects malformed JSON, wrong schema, extra root fields and non-text input', () => {
  assert.throws(() => parseAuditExport('{'), SyntaxError);
  assert.throws(() => parseAuditExport({}), TypeError);
  assert.throws(() => parseAuditExport(JSON.stringify({ schemaVersion: 2, events: [] })), TypeError);
  assert.throws(() => parseAuditExport(JSON.stringify({ schemaVersion: 1, events: [], extra: true })), TypeError);
});

test('enforces the byte and event limits before rendering', () => {
  assert.throws(() => parseAuditExport(' '.repeat(MAX_BYTES + 1)), RangeError);
  const events = Array.from({ length: 501 }, (_, index) => ({ seq: index + 1 }));
  assert.throws(() => parseAuditExport(asExport(events)), RangeError);
});

test('rejects modified, reordered and unknown-type events', () => {
  const events = sampleLedger();
  const changed = events.map(event => ({ ...event }));
  changed[0].detail = 'modified';
  assert.throws(() => parseAuditExport(asExport(changed)), /hash chain/);
  assert.throws(() => parseAuditExport(asExport(events.slice().reverse())), /hash chain/);
  const unknown = events.map(event => ({ ...event }));
  unknown[0].type = 'secret.exported';
  assert.throws(() => parseAuditExport(asExport(unknown)), /fields/);
});

test('summarizes and filters without mutating the verified chain', () => {
  const events = parseAuditExport(asExport(sampleLedger())).events;
  const summary = summarizeAudit(events);
  assert.equal(summary.total, 3);
  assert.equal(summary.tasks, 1);
  assert.equal(summary.byType['task.created'], 1);
  assert.equal(filterAuditEvents(events, { type: 'approval.requested' }).length, 1);
  assert.equal(filterAuditEvents(events, { query: 'external publish' }).length, 1);
  assert.equal(events.length, 3);
  assert.throws(() => filterAuditEvents(events, { type: 'unknown' }), TypeError);
  assert.throws(() => filterAuditEvents(events, { query: 'x'.repeat(121) }), RangeError);
});

test('CSV export quotes cells and neutralizes spreadsheet formulas', () => {
  const ledger = createAuditLedger();
  ledger.append({ type: 'task.created', taskId: 'task-2', detail: '=HYPERLINK("https://example.invalid","open")', at: '2026-11-17T06:00:00.000Z' });
  const csv = exportAuditCsv(ledger.snapshot());
  assert.match(csv, /'=HYPERLINK\(""https:\/\/example\.invalid"",""open""\)/);
  assert.match(csv, /\r\n/);
});

test('display redaction masks common tokens and credential assignments', () => {
  const value = redactForDisplay('Bearer abc.def.ghi token=SuperSecretValue123 ghp_12345678901234567890');
  assert.doesNotMatch(value, /abc\.def\.ghi|SuperSecretValue123|ghp_12345678901234567890/);
  assert.match(value, /REDACTED/);
});

test('JSON export preserves a verifiable chain and ends with a newline', () => {
  const events = sampleLedger();
  const output = exportAuditJson(events);
  assert.equal(output.endsWith('\n'), true);
  assert.equal(parseAuditExport(output).events.length, 3);
});
