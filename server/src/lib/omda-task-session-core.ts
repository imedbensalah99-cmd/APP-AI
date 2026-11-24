import { createHash } from 'node:crypto';

export const TASK_SESSION_STATUSES = ['draft', 'running', 'paused', 'completed', 'cancelled', 'failed'] as const;
export type TaskSessionStatus = typeof TASK_SESSION_STATUSES[number];

export const TASK_SESSION_ACTIONS = ['start', 'pause', 'resume', 'complete', 'cancel', 'fail'] as const;
export type TaskSessionAction = typeof TASK_SESSION_ACTIONS[number];

export const TASK_SESSION_ZERO_HASH = '0'.repeat(64);

export interface TaskSessionEventForHash {
  sessionId: string;
  seq: number;
  action: 'created' | TaskSessionAction;
  fromStatus: TaskSessionStatus | null;
  toStatus: TaskSessionStatus;
  note: string | null;
  occurredAt: string;
  previousHash: string;
}

export interface VerifiableTaskSessionEvent extends TaskSessionEventForHash {
  eventHash: string;
}

export interface VerifiableTaskSession {
  status: TaskSessionStatus;
  revision: number;
}

export class TaskSessionError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'TaskSessionError';
  }
}

const TRANSITIONS: Record<TaskSessionStatus, Partial<Record<TaskSessionAction, TaskSessionStatus>>> = {
  draft: { start: 'running', cancel: 'cancelled' },
  running: { pause: 'paused', complete: 'completed', cancel: 'cancelled', fail: 'failed' },
  paused: { resume: 'running', cancel: 'cancelled', fail: 'failed' },
  completed: {},
  cancelled: {},
  failed: {},
};

export function resolveTaskSessionTransition(
  current: TaskSessionStatus,
  action: TaskSessionAction,
): TaskSessionStatus {
  const next = TRANSITIONS[current][action];
  if (!next) {
    throw new TaskSessionError(409, 'invalid_transition', 'Action ' + action + ' is not allowed while the session is ' + current);
  }
  return next;
}

export function hashTaskSessionEvent(event: TaskSessionEventForHash): string {
  const canonical = JSON.stringify({
    sessionId: event.sessionId,
    seq: event.seq,
    action: event.action,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    note: event.note,
    occurredAt: event.occurredAt,
    previousHash: event.previousHash,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export function verifyTaskSessionEventChain(
  events: readonly VerifiableTaskSessionEvent[],
  session: VerifiableTaskSession,
): { valid: boolean; eventCount: number; lastHash: string; reason?: string } {
  if (events.length === 0) {
    return { valid: false, eventCount: 0, lastHash: TASK_SESSION_ZERO_HASH, reason: 'missing_creation_event' };
  }
  if (events.length > 2_000) {
    return { valid: false, eventCount: events.length, lastHash: TASK_SESSION_ZERO_HASH, reason: 'event_limit_exceeded' };
  }

  let previousHash = TASK_SESSION_ZERO_HASH;
  let currentStatus: TaskSessionStatus | null = null;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.seq !== index) {
      return { valid: false, eventCount: events.length, lastHash: previousHash, reason: 'sequence_gap' };
    }
    if (event.previousHash !== previousHash) {
      return { valid: false, eventCount: events.length, lastHash: previousHash, reason: 'previous_hash_mismatch' };
    }

    if (index === 0) {
      if (event.action !== 'created' || event.fromStatus !== null || event.toStatus !== 'draft') {
        return { valid: false, eventCount: events.length, lastHash: previousHash, reason: 'invalid_creation_event' };
      }
    } else {
      if (currentStatus === null || event.fromStatus !== currentStatus || event.action === 'created') {
        return { valid: false, eventCount: events.length, lastHash: previousHash, reason: 'status_chain_mismatch' };
      }
      try {
        if (resolveTaskSessionTransition(currentStatus, event.action) !== event.toStatus) {
          return { valid: false, eventCount: events.length, lastHash: previousHash, reason: 'invalid_transition_record' };
        }
      } catch {
        return { valid: false, eventCount: events.length, lastHash: previousHash, reason: 'invalid_transition_record' };
      }
    }

    const computed = hashTaskSessionEvent(event);
    if (computed !== event.eventHash) {
      return { valid: false, eventCount: events.length, lastHash: previousHash, reason: 'event_hash_mismatch' };
    }

    previousHash = event.eventHash;
    currentStatus = event.toStatus;
  }

  if (session.revision !== events.length - 1) {
    return { valid: false, eventCount: events.length, lastHash: previousHash, reason: 'revision_mismatch' };
  }
  if (session.status !== currentStatus) {
    return { valid: false, eventCount: events.length, lastHash: previousHash, reason: 'session_status_mismatch' };
  }

  return { valid: true, eventCount: events.length, lastHash: previousHash };
}


export const TASK_SESSION_EVIDENCE_SCHEMA = 'omda.task-session-evidence.v1' as const;

export interface TaskSessionEvidenceSession {
  id: string;
  label: string;
  planSha256: string;
  status: TaskSessionStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskSessionEvidenceBundle {
  schemaVersion: typeof TASK_SESSION_EVIDENCE_SCHEMA;
  exportedAt: string;
  session: TaskSessionEvidenceSession;
  events: VerifiableTaskSessionEvent[];
  verification: { valid: true; eventCount: number; lastHash: string };
  bundleSha256: string;
}

export function canonicalizeEvidenceJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError('Evidence JSON value cannot be encoded');
    return encoded;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Evidence JSON numbers must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalizeEvidenceJson).join(',') + ']';
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Evidence JSON must contain plain objects only');
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    return '{' + keys.map(key => {
      const item = record[key];
      if (item === undefined) throw new TypeError('Evidence JSON cannot contain undefined values');
      return JSON.stringify(key) + ':' + canonicalizeEvidenceJson(item);
    }).join(',') + '}';
  }
  throw new TypeError('Unsupported value in evidence JSON');
}

export function createTaskSessionEvidenceBundle(
  session: TaskSessionEvidenceSession,
  events: readonly VerifiableTaskSessionEvent[],
  exportedAt = new Date().toISOString(),
): TaskSessionEvidenceBundle {
  const exportDate = new Date(exportedAt);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(exportedAt)
    || !Number.isFinite(exportDate.getTime()) || exportDate.toISOString() !== exportedAt) {
    throw new TaskSessionError(500, 'invalid_export_timestamp', 'Evidence export timestamp is invalid');
  }

  const chain = verifyTaskSessionEventChain(events, session);
  if (!chain.valid) {
    throw new TaskSessionError(409, 'ledger_invalid', 'Task session evidence cannot be exported because its event ledger failed verification');
  }

  const unsigned = {
    schemaVersion: TASK_SESSION_EVIDENCE_SCHEMA,
    exportedAt,
    session,
    events: [...events],
    verification: { valid: true as const, eventCount: chain.eventCount, lastHash: chain.lastHash },
  };
  const bundleSha256 = createHash('sha256')
    .update(canonicalizeEvidenceJson(unsigned), 'utf8')
    .digest('hex');
  return { ...unsigned, bundleSha256 };
}
