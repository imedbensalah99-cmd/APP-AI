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
