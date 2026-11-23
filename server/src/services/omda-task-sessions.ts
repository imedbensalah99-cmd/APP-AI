import { randomUUID } from 'node:crypto';
import type { Db } from '../db/types.js';
import {
  hashTaskSessionEvent,
  resolveTaskSessionTransition,
  TASK_SESSION_ZERO_HASH,
  TaskSessionError,
  verifyTaskSessionEventChain,
  type TaskSessionAction,
  type TaskSessionStatus,
  type VerifiableTaskSessionEvent,
} from '../lib/omda-task-session-core.js';

export const MAX_ACTIVE_TASK_SESSIONS_PER_USER = 50;
export const MAX_EVENTS_PER_TASK_SESSION = 2_000;

interface SessionRow {
  id: string;
  user_id: number;
  label: string;
  plan_sha256: string;
  status: TaskSessionStatus;
  revision: number;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  session_id: string;
  seq: number;
  action: 'created' | TaskSessionAction;
  from_status: TaskSessionStatus | null;
  to_status: TaskSessionStatus;
  note: string | null;
  occurred_at: string;
  previous_hash: string;
  event_hash: string;
}

export interface CreateTaskSessionInput {
  label: string;
  planSha256: string;
}

export interface TaskSessionPageInput {
  page: number;
  pageSize: number;
  status?: TaskSessionStatus;
}

export interface TransitionTaskSessionInput {
  action: TaskSessionAction;
  expectedRevision: number;
  note?: string;
}

function mapSession(row: SessionRow) {
  return {
    id: row.id,
    label: row.label,
    planSha256: row.plan_sha256,
    status: row.status,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: EventRow): VerifiableTaskSessionEvent {
  return {
    sessionId: row.session_id,
    seq: row.seq,
    action: row.action,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    note: row.note,
    occurredAt: row.occurred_at,
    previousHash: row.previous_hash,
    eventHash: row.event_hash,
  };
}

function makeEvent(input: Omit<VerifiableTaskSessionEvent, 'eventHash'>): VerifiableTaskSessionEvent {
  return { ...input, eventHash: hashTaskSessionEvent(input) };
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

function getSessionRow(db: Db, userId: number, sessionId: string): SessionRow {
  const row = db.prepare(
    'SELECT id, user_id, label, plan_sha256, status, revision, created_at, updated_at ' +
    'FROM omda_task_sessions WHERE id = ? AND user_id = ?'
  ).get(sessionId, userId) as SessionRow | undefined;
  if (!row) throw new TaskSessionError(404, 'not_found', 'Task session not found');
  return row;
}

function getEventRows(db: Db, sessionId: string, limit = MAX_EVENTS_PER_TASK_SESSION + 1): EventRow[] {
  return db.prepare(
    'SELECT session_id, seq, action, from_status, to_status, note, occurred_at, previous_hash, event_hash ' +
    'FROM omda_task_session_events WHERE session_id = ? ORDER BY seq ASC LIMIT ?'
  ).all(sessionId, limit) as EventRow[];
}

export function createTaskSession(db: Db, userId: number, input: CreateTaskSessionInput) {
  const label = input.label.trim();
  const planSha256 = input.planSha256.toLowerCase();
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new TaskSessionError(401, 'authentication_required', 'Authentication required');
  }
  if (!label || label.length > 120 || !/^[a-f0-9]{64}$/.test(planSha256)) {
    throw new TaskSessionError(400, 'invalid_request', 'A label and a 64-character SHA-256 plan fingerprint are required');
  }

  const id = randomUUID();
  const now = new Date().toISOString();
  runTransaction(db, () => {
    const active = db.prepare(
      'SELECT COUNT(*) AS count FROM omda_task_sessions ' +
      'WHERE user_id = ? AND status IN (\'draft\', \'running\', \'paused\')'
    ).get(userId) as { count: number };
    if (active.count >= MAX_ACTIVE_TASK_SESSIONS_PER_USER) {
      throw new TaskSessionError(429, 'active_session_limit', 'At most ' + MAX_ACTIVE_TASK_SESSIONS_PER_USER + ' active task sessions are allowed');
    }

    const event = makeEvent({
      sessionId: id,
      seq: 0,
      action: 'created',
      fromStatus: null,
      toStatus: 'draft',
      note: null,
      occurredAt: now,
      previousHash: TASK_SESSION_ZERO_HASH,
    });

    db.prepare(
      'INSERT INTO omda_task_sessions (id, user_id, label, plan_sha256, status, revision, created_at, updated_at) ' +
      'VALUES (?, ?, ?, ?, \'draft\', 0, ?, ?)'
    ).run(id, userId, label, planSha256, now, now);
    db.prepare(
      'INSERT INTO omda_task_session_events ' +
      '(session_id, seq, action, from_status, to_status, note, occurred_at, previous_hash, event_hash) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(event.sessionId, event.seq, event.action, event.fromStatus, event.toStatus, event.note, event.occurredAt, event.previousHash, event.eventHash);
  });

  return getTaskSession(db, userId, id);
}

export function listTaskSessions(db: Db, userId: number, input: TaskSessionPageInput) {
  const offset = (input.page - 1) * input.pageSize;
  const where = input.status ? 'WHERE user_id = ? AND status = ?' : 'WHERE user_id = ?';
  const params = input.status ? [userId, input.status] : [userId];
  const count = db.prepare('SELECT COUNT(*) AS count FROM omda_task_sessions ' + where).get(...params) as { count: number };
  const rows = db.prepare(
    'SELECT id, user_id, label, plan_sha256, status, revision, created_at, updated_at ' +
    'FROM omda_task_sessions ' + where + ' ORDER BY updated_at DESC, id ASC LIMIT ? OFFSET ?'
  ).all(...params, input.pageSize, offset) as SessionRow[];
  return { items: rows.map(mapSession), page: input.page, pageSize: input.pageSize, total: count.count };
}

export function getTaskSession(db: Db, userId: number, sessionId: string) {
  const session = getSessionRow(db, userId, sessionId);
  const events = getEventRows(db, sessionId);
  return { session: mapSession(session), events: events.map(mapEvent) };
}

export function transitionTaskSession(
  db: Db,
  userId: number,
  sessionId: string,
  input: TransitionTaskSessionInput,
) {
  runTransaction(db, () => {
    const session = getSessionRow(db, userId, sessionId);
    if (session.revision !== input.expectedRevision) {
      throw new TaskSessionError(409, 'revision_conflict', 'The task session changed; reload it before retrying');
    }
    if ((input.action === 'complete' || input.action === 'fail') && (input.note ?? '').trim().length < 5) {
      throw new TaskSessionError(400, 'evidence_note_required', 'Complete and fail transitions require a note of at least 5 characters');
    }

    const eventCount = db.prepare(
      'SELECT COUNT(*) AS count FROM omda_task_session_events WHERE session_id = ?'
    ).get(sessionId) as { count: number };
    if (eventCount.count >= MAX_EVENTS_PER_TASK_SESSION) {
      throw new TaskSessionError(409, 'event_limit_reached', 'This task session reached its event history limit');
    }

    const last = db.prepare(
      'SELECT seq, event_hash FROM omda_task_session_events WHERE session_id = ? ORDER BY seq DESC LIMIT 1'
    ).get(sessionId) as { seq: number; event_hash: string } | undefined;
    if (!last || last.seq !== session.revision) {
      throw new TaskSessionError(409, 'ledger_inconsistent', 'The task session event ledger is inconsistent; no transition was applied');
    }

    const nextStatus = resolveTaskSessionTransition(session.status, input.action);
    const now = new Date().toISOString();
    const event = makeEvent({
      sessionId,
      seq: session.revision + 1,
      action: input.action,
      fromStatus: session.status,
      toStatus: nextStatus,
      note: input.note?.trim() || null,
      occurredAt: now,
      previousHash: last.event_hash,
    });

    const updated = db.prepare(
      'UPDATE omda_task_sessions SET status = ?, revision = revision + 1, updated_at = ? ' +
      'WHERE id = ? AND user_id = ? AND revision = ?'
    ).run(nextStatus, now, sessionId, userId, input.expectedRevision);
    if (updated.changes !== 1) {
      throw new TaskSessionError(409, 'revision_conflict', 'The task session changed; reload it before retrying');
    }

    db.prepare(
      'INSERT INTO omda_task_session_events ' +
      '(session_id, seq, action, from_status, to_status, note, occurred_at, previous_hash, event_hash) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(event.sessionId, event.seq, event.action, event.fromStatus, event.toStatus, event.note, event.occurredAt, event.previousHash, event.eventHash);
  });

  return getTaskSession(db, userId, sessionId);
}

export function verifyTaskSession(db: Db, userId: number, sessionId: string) {
  const session = getSessionRow(db, userId, sessionId);
  const events = getEventRows(db, sessionId);
  const verification = verifyTaskSessionEventChain(events.map(mapEvent), mapSession(session));
  return { sessionId, ...verification };
}
