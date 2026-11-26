import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/types.js';
import { TaskSessionError } from '../lib/omda-task-session-core.js';
import {
  hashTaskSessionLeaseEvent,
  MAX_TASK_SESSION_LEASE_EVENTS,
  TASK_SESSION_LEASE_ZERO_HASH,
  verifyTaskSessionLeaseEventChain,
  type TaskSessionLeaseAction,
  type TaskSessionLeaseCurrent,
  type TaskSessionLeaseEvent,
  type TaskSessionLeaseStatus,
} from '../lib/omda-task-session-lease-core.js';

export const MIN_TASK_SESSION_LEASE_TTL_SECONDS = 30;
export const MAX_TASK_SESSION_LEASE_TTL_SECONDS = 300;
export const DEFAULT_TASK_SESSION_LEASE_TTL_SECONDS = 90;

interface SessionRow { id: string; status: string; }
interface LeaseRow {
  session_id: string;
  lease_id: string;
  worker_id: string;
  token_hash: string | null;
  status: TaskSessionLeaseStatus;
  revision: number;
  claimed_at: string;
  renewed_at: string | null;
  expires_at: string;
  closed_at: string | null;
  updated_at: string;
}
interface EventRow {
  session_id: string;
  seq: number;
  lease_id: string;
  action: TaskSessionLeaseAction;
  worker_id: string;
  occurred_at: string;
  expires_at: string;
  previous_hash: string;
  event_hash: string;
}

export interface ClaimTaskSessionLeaseInput { workerId: string; ttlSeconds?: number; }
export interface MutateTaskSessionLeaseInput {
  leaseId: string;
  leaseToken: string;
  expectedRevision: number;
  ttlSeconds?: number;
}

function runTransaction<T>(db: Db, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* preserve the original failure */ }
    throw error;
  }
}

function assertUser(userId: number): void {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new TaskSessionError(401, 'authentication_required', 'Authentication required');
  }
}

function getOwnedSession(db: Db, userId: number, sessionId: string): SessionRow {
  const row = db.prepare(
    'SELECT id, status FROM omda_task_sessions WHERE id = ? AND user_id = ?'
  ).get(sessionId, userId) as SessionRow | undefined;
  if (!row) throw new TaskSessionError(404, 'not_found', 'Task session not found');
  return row;
}

function getLeaseRow(db: Db, userId: number, sessionId: string): LeaseRow | undefined {
  return db.prepare(
    'SELECT l.session_id, l.lease_id, l.worker_id, l.token_hash, l.status, l.revision, ' +
    'l.claimed_at, l.renewed_at, l.expires_at, l.closed_at, l.updated_at ' +
    'FROM omda_task_session_leases l JOIN omda_task_sessions s ON s.id = l.session_id ' +
    'WHERE l.session_id = ? AND s.user_id = ?'
  ).get(sessionId, userId) as LeaseRow | undefined;
}

function getEventRows(db: Db, sessionId: string): EventRow[] {
  return db.prepare(
    'SELECT session_id, seq, lease_id, action, worker_id, occurred_at, expires_at, previous_hash, event_hash ' +
    'FROM omda_task_session_lease_events WHERE session_id = ? ORDER BY seq ASC LIMIT ?'
  ).all(sessionId, MAX_TASK_SESSION_LEASE_EVENTS + 1) as EventRow[];
}

function mapEvent(row: EventRow): TaskSessionLeaseEvent {
  return {
    sessionId: row.session_id,
    seq: row.seq,
    leaseId: row.lease_id,
    action: row.action,
    workerId: row.worker_id,
    occurredAt: row.occurred_at,
    expiresAt: row.expires_at,
    previousHash: row.previous_hash,
    eventHash: row.event_hash,
  };
}

function currentForVerification(row: LeaseRow | undefined): TaskSessionLeaseCurrent | null {
  return row ? {
    lease_id: row.lease_id,
    worker_id: row.worker_id,
    status: row.status,
    revision: row.revision,
    expires_at: row.expires_at,
  } : null;
}

function verifyHistory(db: Db, userId: number, sessionId: string) {
  const current = getLeaseRow(db, userId, sessionId);
  const events = getEventRows(db, sessionId).map(mapEvent);
  return verifyTaskSessionLeaseEventChain(events, currentForVerification(current));
}

function appendLeaseEvent(
  db: Db,
  sessionId: string,
  leaseId: string,
  action: TaskSessionLeaseAction,
  workerId: string,
  occurredAt: string,
  expiresAt: string,
): void {
  const count = db.prepare(
    'SELECT COUNT(*) AS count FROM omda_task_session_lease_events WHERE session_id = ?'
  ).get(sessionId) as { count: number };
  if (count.count >= MAX_TASK_SESSION_LEASE_EVENTS) {
    throw new TaskSessionError(409, 'lease_event_limit', 'This task session reached its lease history limit');
  }
  const last = db.prepare(
    'SELECT seq, event_hash FROM omda_task_session_lease_events WHERE session_id = ? ORDER BY seq DESC LIMIT 1'
  ).get(sessionId) as { seq: number; event_hash: string } | undefined;
  const eventInput = {
    sessionId,
    seq: last ? last.seq + 1 : 0,
    leaseId,
    action,
    workerId,
    occurredAt,
    expiresAt,
    previousHash: last?.event_hash ?? TASK_SESSION_LEASE_ZERO_HASH,
  };
  const eventHash = hashTaskSessionLeaseEvent(eventInput);
  db.prepare(
    'INSERT INTO omda_task_session_lease_events ' +
    '(session_id, seq, lease_id, action, worker_id, occurred_at, expires_at, previous_hash, event_hash) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    eventInput.sessionId, eventInput.seq, eventInput.leaseId, eventInput.action,
    eventInput.workerId, eventInput.occurredAt, eventInput.expiresAt,
    eventInput.previousHash, eventHash,
  );
}

function validateTtl(ttlSeconds: number | undefined): number {
  const value = ttlSeconds ?? DEFAULT_TASK_SESSION_LEASE_TTL_SECONDS;
  if (!Number.isSafeInteger(value) || value < MIN_TASK_SESSION_LEASE_TTL_SECONDS || value > MAX_TASK_SESSION_LEASE_TTL_SECONDS) {
    throw new TaskSessionError(400, 'invalid_lease_ttl', 'Lease TTL must be between 30 and 300 seconds');
  }
  return value;
}

function validateWorkerId(workerId: string): string {
  const value = workerId.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(value)) {
    throw new TaskSessionError(400, 'invalid_worker_id', 'Worker ID must be 1–64 safe ASCII characters');
  }
  return value;
}

function tokenDigest(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function tokenMatches(token: string, expectedHash: string | null): boolean {
  if (!expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash) || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const actual = Buffer.from(tokenDigest(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return timingSafeEqual(actual, expected);
}

function publicLease(row: LeaseRow, nowMs = Date.now()) {
  const expired = row.status === 'active' && Date.parse(row.expires_at) <= nowMs;
  return {
    leaseId: row.lease_id,
    workerId: row.worker_id,
    status: row.status,
    expired,
    revision: row.revision,
    claimedAt: row.claimed_at,
    renewedAt: row.renewed_at,
    expiresAt: row.expires_at,
    closedAt: row.closed_at,
  };
}

function assertValidHistory(db: Db, userId: number, sessionId: string): void {
  const verification = verifyHistory(db, userId, sessionId);
  if (!verification.valid) {
    throw new TaskSessionError(409, 'lease_ledger_invalid', 'Task session lease history failed integrity verification');
  }
}

export function claimTaskSessionLease(
  db: Db,
  userId: number,
  sessionId: string,
  input: ClaimTaskSessionLeaseInput,
  now = new Date(),
) {
  assertUser(userId);
  const workerId = validateWorkerId(input.workerId);
  const ttlSeconds = validateTtl(input.ttlSeconds);
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const leaseId = randomUUID();
  const leaseToken = randomBytes(32).toString('base64url');
  const tokenHash = tokenDigest(leaseToken);
  const expiresAt = new Date(nowMs + ttlSeconds * 1_000).toISOString();
  let claimed: LeaseRow | undefined;

  runTransaction(db, () => {
    const session = getOwnedSession(db, userId, sessionId);
    if (session.status !== 'running') {
      throw new TaskSessionError(409, 'session_not_running', 'A worker lease can only be claimed for a running task session');
    }
    assertValidHistory(db, userId, sessionId);
    const existing = getLeaseRow(db, userId, sessionId);
    if (existing?.status === 'active') {
      const oldExpiry = Date.parse(existing.expires_at);
      if (!Number.isFinite(oldExpiry)) {
        throw new TaskSessionError(409, 'lease_state_invalid', 'The existing lease expiry is invalid');
      }
      if (oldExpiry > nowMs) {
        throw new TaskSessionError(409, 'lease_held', 'This task session already has an active worker lease');
      }
      db.prepare(
        'UPDATE omda_task_session_leases SET status = \'expired\', token_hash = NULL, revision = revision + 1, closed_at = ?, updated_at = ? WHERE session_id = ? AND status = \'active\''
      ).run(nowIso, nowIso, sessionId);
      appendLeaseEvent(db, sessionId, existing.lease_id, 'expire', existing.worker_id, nowIso, existing.expires_at);
    }

    if (existing) {
      db.prepare(
        'UPDATE omda_task_session_leases SET lease_id = ?, worker_id = ?, token_hash = ?, status = \'active\', revision = 1, claimed_at = ?, renewed_at = NULL, expires_at = ?, closed_at = NULL, updated_at = ? WHERE session_id = ?'
      ).run(leaseId, workerId, tokenHash, nowIso, expiresAt, nowIso, sessionId);
    } else {
      db.prepare(
        'INSERT INTO omda_task_session_leases (session_id, lease_id, worker_id, token_hash, status, revision, claimed_at, renewed_at, expires_at, closed_at, updated_at) VALUES (?, ?, ?, ?, \'active\', 1, ?, NULL, ?, NULL, ?)'
      ).run(sessionId, leaseId, workerId, tokenHash, nowIso, expiresAt, nowIso);
    }
    appendLeaseEvent(db, sessionId, leaseId, 'claim', workerId, nowIso, expiresAt);
    claimed = getLeaseRow(db, userId, sessionId);
  });

  if (!claimed) throw new TaskSessionError(500, 'lease_claim_failed', 'Unable to claim worker lease');
  return {
    lease: publicLease(claimed, nowMs),
    leaseToken,
    tokenDelivery: 'shown_once' as const,
    ttlSeconds,
  };
}

function getMutableLease(
  db: Db,
  userId: number,
  sessionId: string,
  input: MutateTaskSessionLeaseInput,
  nowMs: number,
): LeaseRow {
  const session = getOwnedSession(db, userId, sessionId);
  if (session.status !== 'running') {
    throw new TaskSessionError(409, 'session_not_running', 'The task session is not running; its worker lease cannot be changed');
  }
  assertValidHistory(db, userId, sessionId);
  const lease = getLeaseRow(db, userId, sessionId);
  if (!lease || lease.lease_id !== input.leaseId || lease.status !== 'active') {
    throw new TaskSessionError(409, 'lease_not_active', 'The supplied worker lease is no longer active');
  }
  if (Date.parse(lease.expires_at) <= nowMs) {
    throw new TaskSessionError(409, 'lease_expired', 'The worker lease has expired; claim a new lease');
  }
  if (lease.revision !== input.expectedRevision) {
    throw new TaskSessionError(409, 'lease_revision_conflict', 'The worker lease changed; inspect it before retrying');
  }
  if (!tokenMatches(input.leaseToken, lease.token_hash)) {
    throw new TaskSessionError(403, 'lease_token_invalid', 'The worker lease token is invalid');
  }
  return lease;
}

export function renewTaskSessionLease(
  db: Db,
  userId: number,
  sessionId: string,
  input: MutateTaskSessionLeaseInput,
  now = new Date(),
) {
  assertUser(userId);
  const ttlSeconds = validateTtl(input.ttlSeconds);
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  let updated: LeaseRow | undefined;
  runTransaction(db, () => {
    const lease = getMutableLease(db, userId, sessionId, input, nowMs);
    const expiresAt = new Date(nowMs + ttlSeconds * 1_000).toISOString();
    const nextRevision = lease.revision + 1;
    if (nextRevision > MAX_TASK_SESSION_LEASE_EVENTS) {
      throw new TaskSessionError(409, 'lease_revision_limit', 'This worker lease reached its revision limit');
    }
    db.prepare(
      'UPDATE omda_task_session_leases SET revision = ?, renewed_at = ?, expires_at = ?, updated_at = ? WHERE session_id = ? AND lease_id = ? AND revision = ? AND status = \'active\''
    ).run(nextRevision, nowIso, expiresAt, nowIso, sessionId, lease.lease_id, lease.revision);
    appendLeaseEvent(db, sessionId, lease.lease_id, 'renew', lease.worker_id, nowIso, expiresAt);
    updated = getLeaseRow(db, userId, sessionId);
  });
  if (!updated) throw new TaskSessionError(500, 'lease_renew_failed', 'Unable to renew worker lease');
  return { lease: publicLease(updated, nowMs), ttlSeconds };
}

export function releaseTaskSessionLease(
  db: Db,
  userId: number,
  sessionId: string,
  input: MutateTaskSessionLeaseInput,
  now = new Date(),
) {
  assertUser(userId);
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  let updated: LeaseRow | undefined;
  runTransaction(db, () => {
    const lease = getMutableLease(db, userId, sessionId, input, nowMs);
    const nextRevision = lease.revision + 1;
    if (nextRevision > MAX_TASK_SESSION_LEASE_EVENTS) {
      throw new TaskSessionError(409, 'lease_revision_limit', 'This worker lease reached its revision limit');
    }
    db.prepare(
      'UPDATE omda_task_session_leases SET status = \'released\', token_hash = NULL, revision = ?, closed_at = ?, updated_at = ? WHERE session_id = ? AND lease_id = ? AND revision = ? AND status = \'active\''
    ).run(nextRevision, nowIso, nowIso, sessionId, lease.lease_id, lease.revision);
    appendLeaseEvent(db, sessionId, lease.lease_id, 'release', lease.worker_id, nowIso, lease.expires_at);
    updated = getLeaseRow(db, userId, sessionId);
  });
  if (!updated) throw new TaskSessionError(500, 'lease_release_failed', 'Unable to release worker lease');
  return { lease: publicLease(updated, nowMs) };
}

export function revokeActiveTaskSessionLease(
  db: Db,
  userId: number,
  sessionId: string,
  nowIso: string,
): void {
  const lease = getLeaseRow(db, userId, sessionId);
  if (!lease || lease.status !== 'active') return;
  assertValidHistory(db, userId, sessionId);
  const expired = Date.parse(lease.expires_at) <= Date.parse(nowIso);
  const action: TaskSessionLeaseAction = expired ? 'expire' : 'revoke';
  const status: TaskSessionLeaseStatus = expired ? 'expired' : 'revoked';
  const nextRevision = lease.revision + 1;
  if (nextRevision > MAX_TASK_SESSION_LEASE_EVENTS) {
    throw new TaskSessionError(409, 'lease_revision_limit', 'This worker lease reached its revision limit');
  }
  db.prepare(
    'UPDATE omda_task_session_leases SET status = ?, token_hash = NULL, revision = ?, closed_at = ?, updated_at = ? WHERE session_id = ? AND lease_id = ? AND revision = ? AND status = \'active\''
  ).run(status, nextRevision, nowIso, nowIso, sessionId, lease.lease_id, lease.revision);
  appendLeaseEvent(db, sessionId, lease.lease_id, action, lease.worker_id, nowIso, lease.expires_at);
}

export function getTaskSessionLease(db: Db, userId: number, sessionId: string) {
  assertUser(userId);
  getOwnedSession(db, userId, sessionId);
  const row = getLeaseRow(db, userId, sessionId);
  const verification = verifyHistory(db, userId, sessionId);
  return {
    sessionId,
    lease: row ? publicLease(row) : null,
    verification,
  };
}

export function verifyTaskSessionLease(db: Db, userId: number, sessionId: string) {
  assertUser(userId);
  getOwnedSession(db, userId, sessionId);
  return { sessionId, ...verifyHistory(db, userId, sessionId) };
}
