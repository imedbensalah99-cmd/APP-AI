import { verifyAuditLedger } from '../omda-freellmapi-audit/audit.mjs';

const MAX_BYTES = 512 * 1024;
const MAX_EVENTS = 500;
const MAX_QUERY = 120;
const EVENT_TYPE_LIST = Object.freeze([
  'task.created', 'task.started', 'task.completed', 'task.failed',
  'artifact.created', 'approval.requested', 'approval.granted', 'approval.denied'
]);
const EVENT_TYPES = new Set(EVENT_TYPE_LIST);
const ROOT_KEYS = ['events', 'schemaVersion'];
const EVENT_KEYS = ['at', 'detail', 'hash', 'previousHash', 'seq', 'taskId', 'type'];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertEventShape(events) {
  if (!Array.isArray(events) || events.length > MAX_EVENTS) {
    throw new RangeError('Invalid event collection size');
  }
  for (const event of events) {
    if (!isRecord(event) || Object.keys(event).sort().join(',') !== EVENT_KEYS.join(',')) {
      throw new TypeError('Invalid audit event shape');
    }
    if (!Number.isSafeInteger(event.seq) || typeof event.at !== 'string' ||
        typeof event.type !== 'string' || !EVENT_TYPES.has(event.type) ||
        typeof event.taskId !== 'string' || typeof event.detail !== 'string' ||
        typeof event.previousHash !== 'string' || typeof event.hash !== 'string') {
      throw new TypeError('Invalid audit event fields');
    }
  }
}

function parseAuditExport(input) {
  if (typeof input !== 'string') throw new TypeError('Expected JSON text');
  if (new TextEncoder().encode(input).byteLength > MAX_BYTES) {
    throw new RangeError('Audit export exceeds 512 KB');
  }

  let parsed;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new SyntaxError('Invalid JSON export');
  }

  if (!isRecord(parsed) || Object.keys(parsed).sort().join(',') !== ROOT_KEYS.join(',') ||
      parsed.schemaVersion !== 1 || !Array.isArray(parsed.events)) {
    throw new TypeError('Unsupported audit export schema');
  }
  assertEventShape(parsed.events);
  if (!verifyAuditLedger(parsed.events)) throw new TypeError('Audit hash chain verification failed');

  const events = Object.freeze(parsed.events.map(event => Object.freeze({ ...event })));
  return Object.freeze({ schemaVersion: 1, events });
}

function assertVerifiedEvents(events) {
  assertEventShape(events);
  if (!verifyAuditLedger(events)) throw new TypeError('Audit hash chain verification failed');
}

function summarizeAudit(events) {
  assertVerifiedEvents(events);
  const byType = Object.create(null);
  const taskIds = new Set();
  for (const event of events) {
    byType[event.type] = (byType[event.type] ?? 0) + 1;
    if (event.taskId) taskIds.add(event.taskId);
  }
  return Object.freeze({
    total: events.length,
    tasks: taskIds.size,
    byType: Object.freeze({ ...byType }),
    firstAt: events[0]?.at ?? null,
    lastAt: events.at(-1)?.at ?? null,
    verified: true
  });
}

function filterAuditEvents(events, { type = 'all', query = '' } = {}) {
  assertVerifiedEvents(events);
  if (type !== 'all' && !EVENT_TYPES.has(type)) throw new TypeError('Unsupported event filter');
  if (typeof query !== 'string' || query.length > MAX_QUERY) throw new RangeError('Search query is too long');
  const needle = query.trim().toLocaleLowerCase();
  return events.filter(event => {
    if (type !== 'all' && event.type !== type) return false;
    if (!needle) return true;
    return [event.type, event.taskId, event.detail].some(value => value.toLocaleLowerCase().includes(needle));
  });
}

function redactForDisplay(value) {
  return String(value ?? '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|github_pat_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/gi, '[REDACTED]')
    .replace(/\b(password|token|secret|api[_-]?key)\s*[:=]\s*([^\s,;]+)/gi, '$1=[REDACTED]');
}

function csvCell(value) {
  let text = redactForDisplay(value);
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

function exportAuditCsv(events, verifiedSource = events) {
  assertVerifiedEvents(verifiedSource);
  assertEventShape(events);
  const sourceByHash = new Map(verifiedSource.map(event => [event.hash, JSON.stringify(event)]));
  if (events.some(event => sourceByHash.get(event.hash) !== JSON.stringify(event))) {
    throw new TypeError('CSV rows must come from the verified source chain');
  }
  const columns = ['seq', 'at', 'type', 'taskId', 'detail', 'previousHash', 'hash'];
  const rows = [columns, ...events.map(event => columns.map(column => event[column]))];
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function exportAuditJson(events) {
  assertVerifiedEvents(events);
  return JSON.stringify({ schemaVersion: 1, events }, null, 2) + '\n';
}

export {
  MAX_BYTES,
  MAX_EVENTS,
  EVENT_TYPE_LIST,
  parseAuditExport,
  summarizeAudit,
  filterAuditEvents,
  redactForDisplay,
  exportAuditCsv,
  exportAuditJson
};
