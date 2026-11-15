import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeLogs,exportJSON,exportCSV,MAX_BYTES,MAX_LINES,MAX_LINE_CHARS} from './engine.mjs';

test('classifies common staging failures into actionable incident groups',()=>{
  const report=analyzeLogs([
    '2026-11-15T04:00:00Z GET /api/ping 502 Bad Gateway',
    '2026-11-15T04:00:01Z status=429 quota exhausted',
    '2026-11-15T04:00:02Z HTTP/1.1 403 Forbidden origin gate',
    '2026-11-15T04:00:03Z status_code=401 authentication failed',
    '2026-11-15T04:00:04Z worker out of memory'
  ].join('\n'));
  assert.equal(report.summary.incidentGroups,5);
  assert.deepEqual(new Set(report.incidents.map(x=>x.category)),new Set(['upstream','rate_limit','authorization','authentication','memory']));
  assert.equal(report.incidents[0].severity,'critical');
  assert.ok(report.incidents.every(x=>x.recommendedAction.length>20));
});

test('redacts bearer tokens, JWTs, provider tokens, key-value secrets, URLs and emails',()=>{
  const raw=[
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456',
    'jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcdefghijklmnopqrstuvwxyz123456',
    'ghp_abcdefghijklmnopqrstuvwxyz1234567890',
    'api_key=super-secret-value-12345',
    'GET /health?access_token=query-secret-123&mode=check',
    'contact imed@example.com',
    'https://user:password@example.test/private'
  ].join('\n');
  const report=analyzeLogs(raw);
  const output=exportJSON(report);
  for(const secret of ['abcdefghijklmnopqrstuvwxyz123456','super-secret-value-12345','query-secret-123','imed@example.com','user:password','ghp_abcdefghijklmnopqrstuvwxyz','eyJhbGciOiJIUzI1NiJ9'])
    assert.ok(!output.includes(secret), 'secret leaked: '+secret);
  assert.ok(output.includes('[REDACTED]'));
  assert.ok(output.includes('[EMAIL]'));
  assert.ok(report.summary.redactedLines>=6);
});

test('redacts multi-line private key blocks before creating report lines',()=>{
  const report=analyzeLogs('start\n-----BEGIN PRIVATE KEY-----\nMIIE-private-material-must-not-escape\n-----END PRIVATE KEY-----\nend');
  const output=exportJSON(report);
  assert.ok(!output.includes('MIIE-private-material'));
  assert.ok(output.includes('[REDACTED_PRIVATE_KEY_BLOCK]'));
  assert.equal(report.summary.redactedLines,1);
});

test('JSON and CSV exports contain sanitized evidence only',()=>{
  const report=analyzeLogs('ERROR status=502 api_key=top-secret-123456789');
  const json=exportJSON(report);
  const csv=exportCSV(report);
  assert.ok(json.includes('top-secret')===false);
  assert.ok(csv.includes('top-secret')===false);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.match(csv,/Incident ID,|\"Incident ID\"/);
});

test('groups repeated fingerprints and preserves line references',()=>{
  const report=analyzeLogs([
    'GET /v1/models status=403 Forbidden request=11111111-1111-1111-1111-111111111111',
    'GET /v1/models status=403 Forbidden request=22222222-2222-2222-2222-222222222222',
    'startup complete'
  ].join('\n'));
  assert.equal(report.incidents.length,1);
  assert.equal(report.incidents[0].count,2);
  assert.equal(report.incidents[0].firstLine,1);
  assert.equal(report.incidents[0].lastLine,2);
  assert.equal(report.summary.bySeverity.info,1);
});

test('enforces byte and line bounds before processing',()=>{
  assert.throws(()=>analyzeLogs('x'.repeat(MAX_BYTES+1)),RangeError);
  assert.throws(()=>analyzeLogs(Array(MAX_LINES+1).fill('info').join('\n')),RangeError);
});

test('rejects empty and non-string input',()=>{
  assert.throws(()=>analyzeLogs('   '),TypeError);
  assert.throws(()=>analyzeLogs(null),TypeError);
  assert.throws(()=>analyzeLogs({text:'not a string'}),TypeError);
});

test('neutralizes spreadsheet formulas and quotes CSV cells',()=>{
  const report=analyzeLogs('=HYPERLINK(\"https://evil.invalid\",\"click\") error status=500');
  const csv=exportCSV(report);
  assert.ok(csv.includes(\"'=HYPERLINK(\"));
  assert.ok(csv.includes('\"\"https://evil.invalid\"\"'));
});

test('sanitizes control characters and truncates very long individual lines',()=>{
  const report=analyzeLogs('error\u0000 status=500 '+('x'.repeat(MAX_LINE_CHARS+100)));
  assert.equal(report.summary.truncatedLines,1);
  assert.ok(report.lines[0].text.length<MAX_LINE_CHARS+30);
  assert.ok(!report.lines[0].text.includes('\u0000'));
});

test('analysis is deterministic and does not add a wall-clock dependency',()=>{
  const input='2026-11-15T04:00:00Z status=503 service unavailable';
  assert.deepEqual(analyzeLogs(input),analyzeLogs(input));
});

test('unknown informational lines are retained but not promoted to incidents',()=>{
  const report=analyzeLogs('server started\nhealth probe completed\nlistening on port 8080');
  assert.equal(report.summary.incidentGroups,0);
  assert.equal(report.summary.analyzedLines,3);
  assert.equal(report.summary.bySeverity.info,3);
});

test('rejects forged export envelopes and does not expose browser or network APIs',async()=>{
  const report=analyzeLogs('error status=500');
  assert.throws(()=>exportJSON({...report,source:'remote'}),TypeError);
  const fs=await import('node:fs');
  const source=fs.readFileSync(new URL('./engine.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\bfetch\s*\(|XMLHttpRequest|localStorage|document\.cookie|sendBeacon/);
});
