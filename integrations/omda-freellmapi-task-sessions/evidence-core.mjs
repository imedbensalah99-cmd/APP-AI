export const TASK_SESSION_EVIDENCE_SCHEMA = 'omda.task-session-evidence.v1';
export const TASK_SESSION_ZERO_HASH = '0'.repeat(64);
export const MAX_EVIDENCE_BUNDLE_BYTES = 2 * 1024 * 1024;
export const MAX_EVIDENCE_EVENTS = 2_000;

const STATUSES = new Set(['draft', 'running', 'paused', 'completed', 'cancelled', 'failed']);
const ACTIONS = new Set(['created', 'start', 'pause', 'resume', 'complete', 'cancel', 'fail']);
const TRANSITIONS = {
  draft: { start: 'running', cancel: 'cancelled' },
  running: { pause: 'paused', complete: 'completed', cancel: 'cancelled', fail: 'failed' },
  paused: { resume: 'running', cancel: 'cancelled', fail: 'failed' },
  completed: {}, cancelled: {}, failed: {},
};

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function hasExactKeys(value, expected) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
export function canonicalizeEvidenceJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non_finite_number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalizeEvidenceJson).join(',') + ']';
  if (isRecord(value)) {
    const keys = Object.keys(value).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    return '{' + keys.map(key => {
      if (value[key] === undefined) throw new TypeError('undefined_value');
      return JSON.stringify(key) + ':' + canonicalizeEvidenceJson(value[key]);
    }).join(',') + '}';
  }
  throw new TypeError('unsupported_json_value');
}
async function sha256Hex(value) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function isIsoUtc(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
function invalid(reason) { return { valid: false, reason, summary: null }; }

export async function verifyTaskSessionEvidenceBundle(bundle) {
  if (!hasExactKeys(bundle, ['schemaVersion', 'exportedAt', 'session', 'events', 'verification', 'bundleSha256'])) return invalid('invalid_bundle_shape');
  if (bundle.schemaVersion !== TASK_SESSION_EVIDENCE_SCHEMA) return invalid('unsupported_schema');
  if (!isIsoUtc(bundle.exportedAt)) return invalid('invalid_export_timestamp');
  if (!/^[a-f0-9]{64}$/.test(bundle.bundleSha256 || '')) return invalid('invalid_bundle_digest');

  if (!hasExactKeys(bundle.session, ['id', 'label', 'planSha256', 'status', 'revision', 'createdAt', 'updatedAt'])) return invalid('invalid_session_shape');
  const session = bundle.session;
  if (typeof session.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(session.id)) return invalid('invalid_session_id');
  if (typeof session.label !== 'string' || session.label.trim().length < 1 || session.label.length > 120) return invalid('invalid_session_label');
  if (typeof session.planSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(session.planSha256)) return invalid('invalid_plan_digest');
  if (!STATUSES.has(session.status)) return invalid('invalid_session_status');
  if (!Number.isSafeInteger(session.revision) || session.revision < 0 || session.revision >= MAX_EVIDENCE_EVENTS) return invalid('invalid_session_revision');
  if (!isIsoUtc(session.createdAt) || !isIsoUtc(session.updatedAt)) return invalid('invalid_session_timestamp');

  if (!Array.isArray(bundle.events) || bundle.events.length < 1 || bundle.events.length > MAX_EVIDENCE_EVENTS) return invalid('invalid_event_count');
  const eventKeys = ['sessionId', 'seq', 'action', 'fromStatus', 'toStatus', 'note', 'occurredAt', 'previousHash', 'eventHash'];
  let previousHash = TASK_SESSION_ZERO_HASH;
  let currentStatus = null;
  for (let index = 0; index < bundle.events.length; index += 1) {
    const event = bundle.events[index];
    if (!hasExactKeys(event, eventKeys)) return invalid('invalid_event_shape');
    if (event.sessionId !== session.id) return invalid('event_session_mismatch');
    if (!Number.isSafeInteger(event.seq) || event.seq !== index) return invalid('sequence_gap');
    if (!ACTIONS.has(event.action) || !STATUSES.has(event.toStatus)) return invalid('invalid_event_action_or_status');
    if (event.fromStatus !== null && !STATUSES.has(event.fromStatus)) return invalid('invalid_event_from_status');
    if (event.note !== null && (typeof event.note !== 'string' || event.note.length > 500)) return invalid('invalid_event_note');
    if (!isIsoUtc(event.occurredAt)) return invalid('invalid_event_timestamp');
    if (typeof event.previousHash !== 'string' || !/^[a-f0-9]{64}$/.test(event.previousHash)) return invalid('invalid_previous_hash');
    if (typeof event.eventHash !== 'string' || !/^[a-f0-9]{64}$/.test(event.eventHash)) return invalid('invalid_event_hash');
    if (event.previousHash !== previousHash) return invalid('previous_hash_mismatch');
    if (index === 0) {
      if (event.action !== 'created' || event.fromStatus !== null || event.toStatus !== 'draft' || event.note !== null) return invalid('invalid_creation_event');
    } else {
      if (currentStatus === null || event.fromStatus !== currentStatus || event.action === 'created') return invalid('status_chain_mismatch');
      if (TRANSITIONS[currentStatus][event.action] !== event.toStatus) return invalid('invalid_transition_record');
    }
    const canonicalEvent = {
      sessionId: event.sessionId, seq: event.seq, action: event.action, fromStatus: event.fromStatus,
      toStatus: event.toStatus, note: event.note, occurredAt: event.occurredAt, previousHash: event.previousHash,
    };
    if (await sha256Hex(JSON.stringify(canonicalEvent)) !== event.eventHash) return invalid('event_hash_mismatch');
    previousHash = event.eventHash;
    currentStatus = event.toStatus;
  }
  if (session.revision !== bundle.events.length - 1) return invalid('revision_mismatch');
  if (session.status !== currentStatus) return invalid('session_status_mismatch');
  if (!hasExactKeys(bundle.verification, ['valid', 'eventCount', 'lastHash'])) return invalid('invalid_verification_shape');
  if (bundle.verification.valid !== true || bundle.verification.eventCount !== bundle.events.length || bundle.verification.lastHash !== previousHash) return invalid('verification_summary_mismatch');

  const unsigned = {
    schemaVersion: bundle.schemaVersion, exportedAt: bundle.exportedAt, session: bundle.session,
    events: bundle.events, verification: bundle.verification,
  };
  let computedBundleHash;
  try { computedBundleHash = await sha256Hex(canonicalizeEvidenceJson(unsigned)); }
  catch { return invalid('invalid_bundle_json_value'); }
  if (computedBundleHash !== bundle.bundleSha256) return invalid('bundle_digest_mismatch');
  return {
    valid: true, reason: null,
    summary: {
      sessionId: session.id, status: session.status, revision: session.revision,
      eventCount: bundle.events.length, lastHash: previousHash,
      bundleSha256: computedBundleHash, planSha256: session.planSha256, exportedAt: bundle.exportedAt,
    },
  };
}
