// OMDA Agent Watch History: bounded, offline analysis of D1 agent_checks exports.
// This module never performs network requests or persists imported data.
const MAX_BYTES = 64 * 1024;
const MAX_ROWS = 30;
const STALE_AFTER_MS = 36 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const VERDICTS = new Set([
  'PERIMETER_OK',
  'ORIGIN_GATE_OPEN',
  'NETWORK_UNAVAILABLE',
  'PERIMETER_NOT_READY',
]);
const ROW_KEYS = ['created_at', 'health_http', 'id', 'model_http', 'verdict'];

function expectedVerdict(health, models) {
  if (health === 200 && models === 403) return 'PERIMETER_OK';
  if (models === 200) return 'ORIGIN_GATE_OPEN';
  if (health === 0 || models === 0) return 'NETWORK_UNAVAILABLE';
  return 'PERIMETER_NOT_READY';
}

function extractRows(input) {
  if (Array.isArray(input)) return input;
  if (!input || typeof input !== 'object') throw new TypeError('Expected a JSON object or array');
  if (Array.isArray(input.results)) return input.results;
  if (Array.isArray(input.result) && input.result.length === 1 && Array.isArray(input.result[0]?.results)) {
    return input.result[0].results;
  }
  throw new TypeError('Unsupported snapshot: expected D1 query results');
}

function normalizeRows(input) {
  const rows = extractRows(input);
  if (rows.length > MAX_ROWS) throw new RangeError(`Snapshot exceeds ${MAX_ROWS} retained checks`);
  const ids = new Set();
  const normalized = rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError(`Invalid row ${index + 1}`);
    const keys = Object.keys(row).sort();
    if (keys.length !== ROW_KEYS.length || keys.some((key, i) => key !== ROW_KEYS[i])) {
      throw new TypeError(`Unexpected fields in row ${index + 1}`);
    }
    if (typeof row.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id)) {
      throw new TypeError(`Invalid row id at ${index + 1}`);
    }
    if (ids.has(row.id)) throw new TypeError(`Duplicate row id at ${index + 1}`);
    ids.add(row.id);
    if (typeof row.created_at !== 'string') throw new TypeError(`Invalid timestamp at ${index + 1}`);
    const parsed = Date.parse(row.created_at);
    if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== row.created_at) {
      throw new TypeError(`Timestamp must be canonical ISO-8601 UTC at ${index + 1}`);
    }
    for (const key of ['health_http', 'model_http']) {
      if (!Number.isInteger(row[key]) || row[key] < 0 || row[key] > 599) {
        throw new TypeError(`Invalid ${key} at ${index + 1}`);
      }
    }
    if (!VERDICTS.has(row.verdict)) throw new TypeError(`Unknown verdict at ${index + 1}`);
    const derived = expectedVerdict(row.health_http, row.model_http);
    if (derived !== row.verdict) throw new TypeError(`Verdict/status mismatch at ${index + 1}`);
    return {
      id: row.id,
      createdAt: row.created_at,
      healthHttp: row.health_http,
      modelHttp: row.model_http,
      verdict: row.verdict,
    };
  });
  normalized.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return normalized;
}

function parseSnapshotText(text) {
  if (typeof text !== 'string') throw new TypeError('Snapshot must be text');
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new RangeError(`Snapshot exceeds ${MAX_BYTES} bytes`);
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new TypeError('Invalid JSON snapshot'); }
  normalizeRows(parsed);
  return parsed;
}

function analyzeHistory(input, { now = new Date() } = {}) {
  const rows = normalizeRows(input);
  const counts = {
    PERIMETER_OK: 0,
    ORIGIN_GATE_OPEN: 0,
    NETWORK_UNAVAILABLE: 0,
    PERIMETER_NOT_READY: 0,
  };
  for (const row of rows) counts[row.verdict] += 1;
  if (rows.length === 0) {
    return {
      status: 'NO_DATA',
      checks: 0,
      successfulChecks: 0,
      failedChecks: 0,
      uptimePercent: null,
      latestVerdict: null,
      latestAt: null,
      ageHours: null,
      counts,
      currentFailureStreak: 0,
      longestHealthyStreak: 0,
      rows,
    };
  }
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new TypeError('Invalid analysis clock');
  const latest = rows[rows.length - 1];
  const ageMs = nowMs - Date.parse(latest.createdAt);
  const futureSkew = ageMs < -FUTURE_TOLERANCE_MS;
  const stale = ageMs > STALE_AFTER_MS;
  let longestHealthyStreak = 0;
  let streak = 0;
  for (const row of rows) {
    if (row.verdict === 'PERIMETER_OK') {
      streak += 1;
      longestHealthyStreak = Math.max(longestHealthyStreak, streak);
    } else streak = 0;
  }
  let currentFailureStreak = 0;
  for (let i = rows.length - 1; i >= 0 && rows[i].verdict !== 'PERIMETER_OK'; i -= 1) currentFailureStreak += 1;
  const successfulChecks = counts.PERIMETER_OK;
  const failedChecks = rows.length - successfulChecks;
  const status = futureSkew ? 'CLOCK_SKEW' : stale ? 'STALE' : latest.verdict === 'PERIMETER_OK' ? 'HEALTHY' : 'ATTENTION';
  return {
    status,
    checks: rows.length,
    successfulChecks,
    failedChecks,
    uptimePercent: Math.round((successfulChecks / rows.length) * 10000) / 100,
    latestVerdict: latest.verdict,
    latestAt: latest.createdAt,
    ageHours: Math.max(0, Math.round((Math.max(0, ageMs) / 3600000) * 10) / 10),
    counts,
    currentFailureStreak,
    longestHealthyStreak,
    rows,
  };
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@\-]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportHistoryCsv(report) {
  if (!report || !Array.isArray(report.rows)) throw new TypeError('A verified history report is required');
  const lines = [
    ['created_at', 'health_http', 'model_http', 'verdict'].map(csvCell).join(','),
    ...report.rows.map(row => [row.createdAt, row.healthHttp, row.modelHttp, row.verdict].map(csvCell).join(',')),
  ];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

function exportHistoryJson(report, generatedAt = new Date().toISOString()) {
  if (!report || !Array.isArray(report.rows)) throw new TypeError('A verified history report is required');
  return JSON.stringify({
    schemaVersion: 1,
    generatedAt,
    summary: {
      status: report.status,
      checks: report.checks,
      successfulChecks: report.successfulChecks,
      failedChecks: report.failedChecks,
      uptimePercent: report.uptimePercent,
      latestVerdict: report.latestVerdict,
      latestAt: report.latestAt,
      counts: report.counts,
      currentFailureStreak: report.currentFailureStreak,
      longestHealthyStreak: report.longestHealthyStreak,
    },
    checks: report.rows.map(({ createdAt, healthHttp, modelHttp, verdict }) => ({
      created_at: createdAt,
      health_http: healthHttp,
      model_http: modelHttp,
      verdict,
    })),
  }, null, 2) + '\n';
}

export {
  MAX_BYTES,
  MAX_ROWS,
  STALE_AFTER_MS,
  expectedVerdict,
  normalizeRows,
  parseSnapshotText,
  analyzeHistory,
  exportHistoryCsv,
  exportHistoryJson,
};
