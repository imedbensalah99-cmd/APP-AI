import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/types.js';
import { TaskSessionError } from '../lib/omda-task-session-core.js';

export const MAX_ACTIVE_OMDA_WORKERS_PER_USER = 10;
export const MAX_OMDA_WORKER_REGISTRY_RECORDS_PER_USER = 50;
export const MAX_OMDA_WORKER_EVENTS = 1_000;
const ZERO_HASH = '0'.repeat(64);
const WORKER_TOKEN_RE = /^omda_worker_[A-Za-z0-9_-]{43}$/;

type WorkerEventAction = 'created' | 'rotated' | 'revoked';
interface WorkerRow {
  id: string;
  user_id: number;
  worker_id: string;
  label: string;
  token_hash: string | null;
  status: 'active' | 'revoked';
  revision: number;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
}
interface WorkerEventRow {
  registry_id: string;
  seq: number;
  action: WorkerEventAction;
  credential_hash: string;
  occurred_at: string;
  previous_hash: string;
  event_hash: string;
}
export interface OmdaWorkerPrincipal {
  registryId: string;
  workerId: string;
  userId: number;
  label: string;
  revision: number;
}
export interface CreateOmdaWorkerInput { label: string; }

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

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function tokenMatches(token: string, expectedHash: string | null): boolean {
  if (!expectedHash || !/^[a-f0-9]{64}$/.test(expectedHash) || !WORKER_TOKEN_RE.test(token)) return false;
  return timingSafeEqual(Buffer.from(digest(token), 'hex'), Buffer.from(expectedHash, 'hex'));
}

function makeToken(): string {
  return 'omda_worker_' + randomBytes(32).toString('base64url');
}

function hashEvent(input: {
  registryId: string;
  workerId: string;
  label: string;
  credentialHash: string;
  seq: number;
  action: WorkerEventAction;
  occurredAt: string;
  previousHash: string;
}): string {
  return digest(JSON.stringify(input));
}

function getOwnedWorker(db: Db, userId: number, registryId: string): WorkerRow {
  const row = db.prepare(
    'SELECT id, user_id, worker_id, label, token_hash, status, revision, created_at, updated_at, last_seen_at, revoked_at ' +
    'FROM omda_workers WHERE id = ? AND user_id = ?'
  ).get(registryId, userId) as WorkerRow | undefined;
  if (!row) throw new TaskSessionError(404, 'worker_not_found', 'Worker not found');
  return row;
}

function getEvents(db: Db, registryId: string): WorkerEventRow[] {
  return db.prepare(
    'SELECT registry_id, seq, action, credential_hash, occurred_at, previous_hash, event_hash ' +
    'FROM omda_worker_events WHERE registry_id = ? ORDER BY seq ASC LIMIT ?'
  ).all(registryId, MAX_OMDA_WORKER_EVENTS + 1) as WorkerEventRow[];
}

function verifyRowHistory(db: Db, row: WorkerRow) {
  const events = getEvents(db, row.id);
  if (events.length === 0 || events.length > MAX_OMDA_WORKER_EVENTS || events.length !== row.revision) {
    return { valid: false, reason: 'event_count_mismatch', eventCount: events.length, lastHash: (events.length ? events[events.length - 1]!.event_hash : null) };
  }
  let previousHash = ZERO_HASH;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.registry_id !== row.id || event.seq !== index || event.previous_hash !== previousHash) {
      return { valid: false, reason: 'event_order_mismatch', eventCount: events.length, lastHash: events.at(-1)?.event_hash ?? null };
    }
    if (!/^[a-f0-9]{64}$/.test(event.credential_hash)) {
      return { valid: false, reason: 'credential_fingerprint_invalid', eventCount: events.length, lastHash: event.event_hash };
    }
    const expected = hashEvent({
      registryId: event.registry_id,
      workerId: row.worker_id,
      label: row.label,
      credentialHash: event.credential_hash,
      seq: event.seq,
      action: event.action,
      occurredAt: event.occurred_at,
      previousHash: event.previous_hash,
    });
    if (expected !== event.event_hash) {
      return { valid: false, reason: 'event_hash_mismatch', eventCount: events.length, lastHash: events.at(-1)?.event_hash ?? null };
    }
    if (index === 0 && event.action !== 'created') {
      return { valid: false, reason: 'creation_event_missing', eventCount: events.length, lastHash: event.event_hash };
    }
    previousHash = event.event_hash;
  }
  const lastEvent = events[events.length - 1]!;
  if (row.status === 'active' && lastEvent.credential_hash !== row.token_hash) {
    return { valid: false, reason: 'credential_fingerprint_mismatch', eventCount: events.length, lastHash: previousHash };
  }
  const lastAction = lastEvent.action;
  const stateMatches = row.status === 'active'
    ? (lastAction === 'created' || lastAction === 'rotated') && row.token_hash !== null
    : lastAction === 'revoked' && row.token_hash === null;
  if (!stateMatches) {
    return { valid: false, reason: 'worker_status_mismatch', eventCount: events.length, lastHash: previousHash };
  }
  return { valid: true, reason: null, eventCount: events.length, lastHash: previousHash };
}

function assertValidHistory(db: Db, row: WorkerRow): void {
  if (!verifyRowHistory(db, row).valid) {
    throw new TaskSessionError(409, 'worker_ledger_invalid', 'Worker registry history failed integrity verification');
  }
}

function appendEvent(
  db: Db,
  registryId: string,
  workerId: string,
  label: string,
  credentialHash: string,
  action: WorkerEventAction,
  occurredAt: string,
): void {
  const last = db.prepare(
    'SELECT seq, event_hash FROM omda_worker_events WHERE registry_id = ? ORDER BY seq DESC LIMIT 1'
  ).get(registryId) as { seq: number; event_hash: string } | undefined;
  const seq = last ? last.seq + 1 : 0;
  if (seq >= MAX_OMDA_WORKER_EVENTS) {
    throw new TaskSessionError(409, 'worker_event_limit', 'This worker reached its audit history limit');
  }
  const input = {
    registryId,
    workerId,
    label,
    credentialHash,
    seq,
    action,
    occurredAt,
    previousHash: last?.event_hash ?? ZERO_HASH,
  };
  db.prepare(
    'INSERT INTO omda_worker_events (registry_id, seq, action, credential_hash, occurred_at, previous_hash, event_hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(registryId, seq, action, credentialHash, occurredAt, input.previousHash, hashEvent(input));
}

function publicWorker(row: WorkerRow) {
  return {
    id: row.id,
    workerId: row.worker_id,
    label: row.label,
    status: row.status,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
    scope: ['task_sessions:leases'] as const,
  };
}

export function createOmdaWorker(db: Db, userId: number, input: CreateOmdaWorkerInput, now = new Date()) {
  assertUser(userId);
  const label = input.label.trim();
  if (!label || label.length > 80) {
    throw new TaskSessionError(400, 'invalid_worker_label', 'Worker label must be 1–80 characters');
  }
  const id = randomUUID();
  const workerId = 'wrk_' + id.replace(/-/g, '');
  const workerToken = makeToken();
  const nowIso = now.toISOString();
  let row: WorkerRow | undefined;
  runTransaction(db, () => {
    const counts = db.prepare(
      'SELECT COUNT(*) AS total, SUM(CASE WHEN status = \'active\' THEN 1 ELSE 0 END) AS active FROM omda_workers WHERE user_id = ?'
    ).get(userId) as { total: number; active: number | null };
    if (counts.total >= MAX_OMDA_WORKER_REGISTRY_RECORDS_PER_USER) {
      throw new TaskSessionError(429, 'worker_registry_limit_reached', 'At most ' + MAX_OMDA_WORKER_REGISTRY_RECORDS_PER_USER + ' worker registry records are retained per user');
    }
    if ((counts.active ?? 0) >= MAX_ACTIVE_OMDA_WORKERS_PER_USER) {
      throw new TaskSessionError(429, 'worker_limit_reached', 'At most ' + MAX_ACTIVE_OMDA_WORKERS_PER_USER + ' active workers are allowed per user');
    }
    db.prepare(
      'INSERT INTO omda_workers (id, user_id, worker_id, label, token_hash, status, revision, created_at, updated_at, last_seen_at, revoked_at) ' +
      'VALUES (?, ?, ?, ?, ?, \'active\', 1, ?, ?, NULL, NULL)'
    ).run(id, userId, workerId, label, digest(workerToken), nowIso, nowIso);
    appendEvent(db, id, workerId, label, digest(workerToken), 'created', nowIso);
    row = getOwnedWorker(db, userId, id);
  });
  if (!row) throw new TaskSessionError(500, 'worker_create_failed', 'Unable to create worker');
  return { worker: publicWorker(row), workerToken, tokenDelivery: 'shown_once' as const };
}

export function listOmdaWorkers(db: Db, userId: number) {
  assertUser(userId);
  const rows = db.prepare(
    'SELECT id, user_id, worker_id, label, token_hash, status, revision, created_at, updated_at, last_seen_at, revoked_at ' +
    'FROM omda_workers WHERE user_id = ? ORDER BY created_at DESC, id ASC LIMIT ?'
  ).all(userId, MAX_OMDA_WORKER_REGISTRY_RECORDS_PER_USER) as WorkerRow[];
  return {
    items: rows.map(row => ({ worker: publicWorker(row), verification: verifyRowHistory(db, row) })),
    maxActiveWorkers: MAX_ACTIVE_OMDA_WORKERS_PER_USER,
  };
}

export function verifyOmdaWorker(db: Db, userId: number, registryId: string) {
  assertUser(userId);
  const row = getOwnedWorker(db, userId, registryId);
  return { worker: publicWorker(row), ...verifyRowHistory(db, row) };
}

export function rotateOmdaWorkerToken(
  db: Db,
  userId: number,
  registryId: string,
  expectedRevision: number,
  now = new Date(),
) {
  assertUser(userId);
  const workerToken = makeToken();
  const nowIso = now.toISOString();
  let row: WorkerRow | undefined;
  runTransaction(db, () => {
    const current = getOwnedWorker(db, userId, registryId);
    assertValidHistory(db, current);
    if (current.status !== 'active') throw new TaskSessionError(409, 'worker_not_active', 'A revoked worker cannot be rotated');
    if (current.revision !== expectedRevision) throw new TaskSessionError(409, 'worker_revision_conflict', 'Worker registry changed; reload before retrying');
    if (current.revision >= MAX_OMDA_WORKER_EVENTS) throw new TaskSessionError(409, 'worker_revision_limit', 'Worker registry reached its revision limit');
    db.prepare(
      'UPDATE omda_workers SET token_hash = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND user_id = ? AND revision = ? AND status = \'active\''
    ).run(digest(workerToken), nowIso, registryId, userId, expectedRevision);
    appendEvent(db, registryId, current.worker_id, current.label, digest(workerToken), 'rotated', nowIso);
    row = getOwnedWorker(db, userId, registryId);
  });
  if (!row) throw new TaskSessionError(500, 'worker_rotation_failed', 'Unable to rotate worker token');
  return { worker: publicWorker(row), workerToken, tokenDelivery: 'shown_once' as const };
}

export function revokeOmdaWorker(
  db: Db,
  userId: number,
  registryId: string,
  expectedRevision: number,
  now = new Date(),
) {
  assertUser(userId);
  const nowIso = now.toISOString();
  let row: WorkerRow | undefined;
  runTransaction(db, () => {
    const current = getOwnedWorker(db, userId, registryId);
    assertValidHistory(db, current);
    if (current.status !== 'active') throw new TaskSessionError(409, 'worker_not_active', 'Worker is already revoked');
    if (current.revision !== expectedRevision) throw new TaskSessionError(409, 'worker_revision_conflict', 'Worker registry changed; reload before retrying');
    if (current.revision >= MAX_OMDA_WORKER_EVENTS) throw new TaskSessionError(409, 'worker_revision_limit', 'Worker registry reached its revision limit');
    db.prepare(
      'UPDATE omda_workers SET status = \'revoked\', token_hash = NULL, revision = revision + 1, updated_at = ?, revoked_at = ? WHERE id = ? AND user_id = ? AND revision = ? AND status = \'active\''
    ).run(nowIso, nowIso, registryId, userId, expectedRevision);
    appendEvent(db, registryId, current.worker_id, current.label, current.token_hash!, 'revoked', nowIso);
    row = getOwnedWorker(db, userId, registryId);
  });
  if (!row) throw new TaskSessionError(500, 'worker_revoke_failed', 'Unable to revoke worker');
  return { worker: publicWorker(row) };
}

export function authenticateOmdaWorker(db: Db, token: string | undefined | null): OmdaWorkerPrincipal | null {
  if (!token || !WORKER_TOKEN_RE.test(token)) return null;
  const tokenHash = digest(token);
  const row = db.prepare(
    'SELECT id, user_id, worker_id, label, token_hash, status, revision, created_at, updated_at, last_seen_at, revoked_at ' +
    'FROM omda_workers WHERE token_hash = ? AND status = \'active\''
  ).get(tokenHash) as WorkerRow | undefined;
  if (!row || !tokenMatches(token, row.token_hash)) return null;
  if (!verifyRowHistory(db, row).valid) return null;
  const now = new Date();
  const threshold = new Date(now.getTime() - 60_000).toISOString();
  try {
    db.prepare(
      'UPDATE omda_workers SET last_seen_at = ? WHERE id = ? AND status = \'active\' AND (last_seen_at IS NULL OR last_seen_at <= ?)'
    ).run(now.toISOString(), row.id, threshold);
  } catch {
    // Last-seen telemetry is advisory and must not turn a valid credential into an outage.
  }
  return {
    registryId: row.id,
    workerId: row.worker_id,
    userId: row.user_id,
    label: row.label,
    revision: row.revision,
  };
}
