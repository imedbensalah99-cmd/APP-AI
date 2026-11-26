import { createHash } from 'node:crypto';

export const TASK_SESSION_LEASE_ACTIONS = ['claim', 'renew', 'release', 'expire', 'revoke'] as const;
export type TaskSessionLeaseAction = typeof TASK_SESSION_LEASE_ACTIONS[number];
export type TaskSessionLeaseStatus = 'active' | 'released' | 'expired' | 'revoked';
export const TASK_SESSION_LEASE_ZERO_HASH = '0'.repeat(64);
export const MAX_TASK_SESSION_LEASE_EVENTS = 2_000;

export interface TaskSessionLeaseEvent {
  sessionId: string;
  seq: number;
  leaseId: string;
  action: TaskSessionLeaseAction;
  workerId: string;
  occurredAt: string;
  expiresAt: string;
  previousHash: string;
  eventHash: string;
}

export interface TaskSessionLeaseCurrent {
  lease_id: string;
  worker_id: string;
  status: TaskSessionLeaseStatus;
  revision: number;
  expires_at: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const HASH_RE = /^[a-f0-9]{64}$/;

export function hashTaskSessionLeaseEvent(event: Omit<TaskSessionLeaseEvent, 'eventHash'>): string {
  const canonical = JSON.stringify({
    sessionId: event.sessionId,
    seq: event.seq,
    leaseId: event.leaseId,
    action: event.action,
    workerId: event.workerId,
    occurredAt: event.occurredAt,
    expiresAt: event.expiresAt,
    previousHash: event.previousHash,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function invalid(reason: string, eventCount: number, lastHash = TASK_SESSION_LEASE_ZERO_HASH) {
  return { valid: false, reason, eventCount, lastHash };
}

/**
 * Verify the append-only lease history and, when supplied, the mutable current
 * lease row. Hash chaining detects edits; it is not a digital signature.
 */
export function verifyTaskSessionLeaseEventChain(
  events: readonly TaskSessionLeaseEvent[],
  currentLease: TaskSessionLeaseCurrent | null,
) {
  if (events.length > MAX_TASK_SESSION_LEASE_EVENTS) {
    return invalid('event_limit_exceeded', events.length);
  }
  if (events.length === 0) {
    return currentLease ? invalid('current_lease_without_events', 0) : {
      valid: true, eventCount: 0, lastHash: TASK_SESSION_LEASE_ZERO_HASH,
    };
  }

  const leaseStates = new Map<string, {
    workerId: string;
    count: number;
    lastAction: TaskSessionLeaseAction;
    expiresAt: string;
  }>();
  let previousHash = TASK_SESSION_LEASE_ZERO_HASH;
  let previousTime = -Infinity;
  const sessionId = events[0]!.sessionId;

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (
      event.sessionId !== sessionId ||
      event.seq !== index ||
      !UUID_RE.test(event.sessionId) ||
      !UUID_RE.test(event.leaseId) ||
      !WORKER_RE.test(event.workerId) ||
      !TASK_SESSION_LEASE_ACTIONS.includes(event.action) ||
      !HASH_RE.test(event.previousHash) ||
      !HASH_RE.test(event.eventHash)
    ) return invalid('invalid_event_shape', events.length, previousHash);

    const occurred = Date.parse(event.occurredAt);
    const expires = Date.parse(event.expiresAt);
    if (
      !Number.isFinite(occurred) ||
      !Number.isFinite(expires) ||
      new Date(occurred).toISOString() !== event.occurredAt ||
      new Date(expires).toISOString() !== event.expiresAt ||
      occurred < previousTime
    ) return invalid('invalid_event_time', events.length, previousHash);

    if (event.previousHash !== previousHash) {
      return invalid('previous_hash_mismatch', events.length, previousHash);
    }
    if (hashTaskSessionLeaseEvent({
      sessionId: event.sessionId,
      seq: event.seq,
      leaseId: event.leaseId,
      action: event.action,
      workerId: event.workerId,
      occurredAt: event.occurredAt,
      expiresAt: event.expiresAt,
      previousHash: event.previousHash,
    }) !== event.eventHash) {
      return invalid('event_hash_mismatch', events.length, previousHash);
    }

    const state = leaseStates.get(event.leaseId);
    if (event.action === 'claim') {
      if (state) return invalid('duplicate_lease_claim', events.length, previousHash);
      leaseStates.set(event.leaseId, {
        workerId: event.workerId, count: 1, lastAction: 'claim', expiresAt: event.expiresAt,
      });
    } else {
      if (!state) return invalid('lease_event_without_claim', events.length, previousHash);
      if (state.lastAction === 'release' || state.lastAction === 'expire' || state.lastAction === 'revoke') {
        return invalid('event_after_terminal_lease_action', events.length, previousHash);
      }
      if (state.workerId !== event.workerId) return invalid('worker_identity_changed', events.length, previousHash);
      state.count += 1;
      state.lastAction = event.action;
      state.expiresAt = event.expiresAt;
    }

    previousHash = event.eventHash;
    previousTime = occurred;
  }

  if (!currentLease) return invalid('current_lease_missing', events.length, previousHash);
  const state = leaseStates.get(currentLease.lease_id);
  if (!state) return invalid('current_lease_not_in_history', events.length, previousHash);
  const expectedStatus: Record<TaskSessionLeaseAction, TaskSessionLeaseStatus> = {
    claim: 'active',
    renew: 'active',
    release: 'released',
    expire: 'expired',
    revoke: 'revoked',
  };
  if (currentLease.status !== expectedStatus[state.lastAction]) {
    return invalid('current_lease_status_mismatch', events.length, previousHash);
  }
  if (
    currentLease.revision !== state.count ||
    currentLease.worker_id !== state.workerId ||
    currentLease.expires_at !== state.expiresAt
  ) return invalid('current_lease_revision_mismatch', events.length, previousHash);

  return { valid: true, eventCount: events.length, lastHash: previousHash };
}
