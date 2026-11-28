import { createHash, randomUUID } from 'node:crypto';
import type { Db } from '../db/types.js';
import { TaskSessionError } from '../lib/omda-task-session-core.js';
import { revokeActiveTaskSessionLease } from './omda-task-session-leases.js';
import { verifyOmdaWorker, type OmdaWorkerPrincipal } from './omda-workers.js';

export const MAX_ACTIVE_OMDA_ASSIGNMENTS_PER_WORKER = 100;
export const MAX_ACTIVE_OMDA_ASSIGNMENTS_PER_SESSION = 50;
export const MAX_RETAINED_OMDA_ASSIGNMENTS_PER_USER = 500;
export const MAX_OMDA_ASSIGNMENT_EVENTS = 2;
const ZERO_HASH = '0'.repeat(64);
const TERMINAL_SESSION_STATUSES = new Set(['completed', 'cancelled', 'failed']);

interface AssignmentRow {
  id: string; user_id: number; registry_id: string; worker_id: string; session_id: string;
  status: 'active' | 'revoked'; revision: number; created_at: string; updated_at: string; revoked_at: string | null;
}
interface AssignmentEventRow {
  assignment_id: string; seq: number; action: 'assigned' | 'revoked'; occurred_at: string; previous_hash: string; event_hash: string;
}
function runTransaction<T>(db: Db, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { try { db.exec('ROLLBACK'); } catch { /* preserve original failure */ } throw error; }
}
function assertUser(userId: number): void {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new TaskSessionError(401, 'authentication_required', 'Authentication required');
}
function digest(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function hashAssignmentEvent(input: {
  assignmentId: string; userId: number; registryId: string; workerId: string; sessionId: string;
  seq: number; action: 'assigned' | 'revoked'; occurredAt: string; previousHash: string;
}): string { return digest(JSON.stringify(input)); }

function assertOwnedWorker(db: Db, userId: number, registryId: string, requireActive: boolean) {
  const verification = verifyOmdaWorker(db, userId, registryId);
  if (!verification.valid) throw new TaskSessionError(409, 'worker_ledger_invalid', 'Worker registry history failed integrity verification');
  if (requireActive && verification.worker.status !== 'active') throw new TaskSessionError(409, 'worker_not_active', 'Only an active worker can receive task assignments');
  return verification.worker;
}
function getOwnedSession(db: Db, userId: number, sessionId: string): { id: string; status: string } {
  const row = db.prepare('SELECT id, status FROM omda_task_sessions WHERE id = ? AND user_id = ?')
    .get(sessionId, userId) as { id: string; status: string } | undefined;
  if (!row) throw new TaskSessionError(404, 'not_found', 'Task session not found');
  return row;
}
function getAssignmentRow(db: Db, userId: number, registryId: string, sessionId: string, activeOnly = false): AssignmentRow | undefined {
  return db.prepare(
    'SELECT id, user_id, registry_id, worker_id, session_id, status, revision, created_at, updated_at, revoked_at ' +
    'FROM omda_worker_session_assignments WHERE user_id = ? AND registry_id = ? AND session_id = ? ' +
    (activeOnly ? 'AND status = \'active\' ' : '') + 'ORDER BY created_at DESC, id DESC LIMIT 1'
  ).get(userId, registryId, sessionId) as AssignmentRow | undefined;
}
function getAssignmentEvents(db: Db, assignmentId: string): AssignmentEventRow[] {
  return db.prepare(
    'SELECT assignment_id, seq, action, occurred_at, previous_hash, event_hash FROM omda_worker_assignment_events ' +
    'WHERE assignment_id = ? ORDER BY seq ASC LIMIT ?'
  ).all(assignmentId, MAX_OMDA_ASSIGNMENT_EVENTS + 1) as AssignmentEventRow[];
}
function verifyAssignmentRow(db: Db, row: AssignmentRow) {
  const events = getAssignmentEvents(db, row.id);
  if (events.length === 0 || events.length > MAX_OMDA_ASSIGNMENT_EVENTS || events.length !== row.revision) {
    return { valid: false, reason: 'event_count_mismatch', eventCount: events.length, lastHash: events.at(-1)?.event_hash ?? null };
  }
  let previousHash = ZERO_HASH;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    if (event.assignment_id !== row.id || event.seq !== index || event.previous_hash !== previousHash) {
      return { valid: false, reason: 'event_order_mismatch', eventCount: events.length, lastHash: events.at(-1)?.event_hash ?? null };
    }
    const expected = hashAssignmentEvent({
      assignmentId: row.id, userId: row.user_id, registryId: row.registry_id, workerId: row.worker_id,
      sessionId: row.session_id, seq: event.seq, action: event.action, occurredAt: event.occurred_at, previousHash: event.previous_hash,
    });
    if (expected !== event.event_hash) return { valid: false, reason: 'event_hash_mismatch', eventCount: events.length, lastHash: event.event_hash };
    if (index === 0 && event.action !== 'assigned') return { valid: false, reason: 'creation_event_missing', eventCount: events.length, lastHash: event.event_hash };
    previousHash = event.event_hash;
  }
  const last = events[events.length - 1]!;
  const stateMatches = row.status === 'active'
    ? last.action === 'assigned' && row.revoked_at === null
    : last.action === 'revoked' && row.revoked_at !== null;
  if (!stateMatches) return { valid: false, reason: 'assignment_status_mismatch', eventCount: events.length, lastHash: previousHash };
  return { valid: true, reason: null, eventCount: events.length, lastHash: previousHash };
}
function assertValidAssignment(db: Db, row: AssignmentRow): void {
  if (!verifyAssignmentRow(db, row).valid) throw new TaskSessionError(409, 'worker_assignment_invalid', 'Worker task assignment history failed integrity verification');
}
function appendAssignmentEvent(db: Db, row: AssignmentRow, action: 'assigned' | 'revoked', occurredAt: string): void {
  const last = db.prepare('SELECT seq, event_hash FROM omda_worker_assignment_events WHERE assignment_id = ? ORDER BY seq DESC LIMIT 1')
    .get(row.id) as { seq: number; event_hash: string } | undefined;
  const seq = last ? last.seq + 1 : 0;
  if (seq >= MAX_OMDA_ASSIGNMENT_EVENTS) throw new TaskSessionError(409, 'worker_assignment_event_limit', 'This worker assignment reached its event limit');
  const input = {
    assignmentId: row.id, userId: row.user_id, registryId: row.registry_id, workerId: row.worker_id,
    sessionId: row.session_id, seq, action, occurredAt, previousHash: last?.event_hash ?? ZERO_HASH,
  };
  db.prepare('INSERT INTO omda_worker_assignment_events (assignment_id, seq, action, occurred_at, previous_hash, event_hash) VALUES (?, ?, ?, ?, ?, ?)')
    .run(row.id, seq, action, occurredAt, input.previousHash, hashAssignmentEvent(input));
}
function publicAssignment(row: AssignmentRow) {
  return { id: row.id, workerId: row.worker_id, sessionId: row.session_id, status: row.status, revision: row.revision,
    createdAt: row.created_at, updatedAt: row.updated_at, revokedAt: row.revoked_at };
}

export function assignOmdaWorkerToSession(db: Db, userId: number, registryId: string, sessionId: string, now = new Date()) {
  assertUser(userId);
  const nowIso = now.toISOString();
  let result: { row: AssignmentRow; created: boolean } | undefined;
  runTransaction(db, () => {
    const worker = assertOwnedWorker(db, userId, registryId, true);
    const session = getOwnedSession(db, userId, sessionId);
    if (TERMINAL_SESSION_STATUSES.has(session.status)) throw new TaskSessionError(409, 'session_terminal', 'A completed, cancelled or failed task session cannot receive a worker assignment');
    const existing = getAssignmentRow(db, userId, registryId, sessionId, true);
    if (existing) { assertValidAssignment(db, existing); result = { row: existing, created: false }; return; }
    const retained = db.prepare('SELECT COUNT(*) AS count FROM omda_worker_session_assignments WHERE user_id = ?').get(userId) as { count: number };
    if (retained.count >= MAX_RETAINED_OMDA_ASSIGNMENTS_PER_USER) throw new TaskSessionError(429, 'worker_assignment_retention_limit', 'The account reached its retained worker assignment limit');
    const activeForWorker = db.prepare('SELECT COUNT(*) AS count FROM omda_worker_session_assignments WHERE registry_id = ? AND status = \'active\'').get(registryId) as { count: number };
    if (activeForWorker.count >= MAX_ACTIVE_OMDA_ASSIGNMENTS_PER_WORKER) throw new TaskSessionError(429, 'worker_assignment_worker_limit', 'This worker reached its active task assignment limit');
    const activeForSession = db.prepare('SELECT COUNT(*) AS count FROM omda_worker_session_assignments WHERE session_id = ? AND status = \'active\'').get(sessionId) as { count: number };
    if (activeForSession.count >= MAX_ACTIVE_OMDA_ASSIGNMENTS_PER_SESSION) throw new TaskSessionError(429, 'worker_assignment_session_limit', 'This task session reached its active worker assignment limit');
    const row: AssignmentRow = {
      id: randomUUID(), user_id: userId, registry_id: registryId, worker_id: worker.workerId, session_id: sessionId,
      status: 'active', revision: 1, created_at: nowIso, updated_at: nowIso, revoked_at: null,
    };
    db.prepare(
      'INSERT INTO omda_worker_session_assignments (id, user_id, registry_id, worker_id, session_id, status, revision, created_at, updated_at, revoked_at) ' +
      'VALUES (?, ?, ?, ?, ?, \'active\', 1, ?, ?, NULL)'
    ).run(row.id, userId, registryId, worker.workerId, sessionId, nowIso, nowIso);
    appendAssignmentEvent(db, row, 'assigned', nowIso);
    result = { row, created: true };
  });
  if (!result) throw new TaskSessionError(500, 'worker_assignment_failed', 'Unable to create worker task assignment');
  return { assignment: publicAssignment(result.row), verification: verifyAssignmentRow(db, result.row), created: result.created };
}

export function listOmdaWorkerAssignments(db: Db, userId: number, registryId: string) {
  assertUser(userId);
  const worker = assertOwnedWorker(db, userId, registryId, false);
  const rows = db.prepare(
    'SELECT id, user_id, registry_id, worker_id, session_id, status, revision, created_at, updated_at, revoked_at ' +
    'FROM omda_worker_session_assignments WHERE user_id = ? AND registry_id = ? ORDER BY created_at DESC, id DESC LIMIT ?'
  ).all(userId, registryId, MAX_RETAINED_OMDA_ASSIGNMENTS_PER_USER + 1) as AssignmentRow[];
  if (rows.length > MAX_RETAINED_OMDA_ASSIGNMENTS_PER_USER) throw new TaskSessionError(409, 'worker_assignment_history_over_limit', 'Worker assignment history exceeded its configured limit');
  return { workerId: worker.workerId, items: rows.map(row => ({ assignment: publicAssignment(row), verification: verifyAssignmentRow(db, row) })),
    maxActiveAssignments: MAX_ACTIVE_OMDA_ASSIGNMENTS_PER_WORKER };
}

export function verifyOmdaWorkerAssignment(db: Db, userId: number, registryId: string, sessionId: string) {
  assertUser(userId);
  assertOwnedWorker(db, userId, registryId, false);
  getOwnedSession(db, userId, sessionId);
  const row = getAssignmentRow(db, userId, registryId, sessionId, false);
  if (!row) throw new TaskSessionError(404, 'worker_assignment_not_found', 'Worker assignment not found');
  return { assignment: publicAssignment(row), ...verifyAssignmentRow(db, row) };
}

export function revokeOmdaWorkerSessionAssignment(db: Db, userId: number, registryId: string, sessionId: string, expectedRevision: number, now = new Date()) {
  assertUser(userId);
  const nowIso = now.toISOString();
  let updated: AssignmentRow | undefined;
  runTransaction(db, () => {
    assertOwnedWorker(db, userId, registryId, false);
    getOwnedSession(db, userId, sessionId);
    const row = getAssignmentRow(db, userId, registryId, sessionId, true);
    if (!row) throw new TaskSessionError(404, 'worker_assignment_not_found', 'Active worker assignment not found');
    assertValidAssignment(db, row);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || expectedRevision > MAX_OMDA_ASSIGNMENT_EVENTS) throw new TaskSessionError(400, 'invalid_revision', 'A valid expected assignment revision is required');
    if (row.revision !== expectedRevision) throw new TaskSessionError(409, 'worker_assignment_revision_conflict', 'Worker assignment changed; reload before retrying');
    revokeActiveTaskSessionLease(db, userId, sessionId, nowIso);
    db.prepare(
      'UPDATE omda_worker_session_assignments SET status = \'revoked\', revision = revision + 1, updated_at = ?, revoked_at = ? ' +
      'WHERE id = ? AND user_id = ? AND revision = ? AND status = \'active\''
    ).run(nowIso, nowIso, row.id, userId, expectedRevision);
    const revokedRow: AssignmentRow = { ...row, status: 'revoked', revision: row.revision + 1, updated_at: nowIso, revoked_at: nowIso };
    appendAssignmentEvent(db, row, 'revoked', nowIso);
    updated = revokedRow;
  });
  if (!updated) throw new TaskSessionError(500, 'worker_assignment_revoke_failed', 'Unable to revoke worker task assignment');
  return { assignment: publicAssignment(updated), verification: verifyAssignmentRow(db, updated) };
}

export function revokeActiveOmdaWorkerAssignmentsForSession(db: Db, userId: number, sessionId: string, nowIso: string): void {
  const rows = db.prepare(
    'SELECT id, user_id, registry_id, worker_id, session_id, status, revision, created_at, updated_at, revoked_at ' +
    'FROM omda_worker_session_assignments WHERE user_id = ? AND session_id = ? AND status = \'active\' ORDER BY created_at ASC, id ASC LIMIT ?'
  ).all(userId, sessionId, MAX_ACTIVE_OMDA_ASSIGNMENTS_PER_SESSION + 1) as AssignmentRow[];
  if (rows.length > MAX_ACTIVE_OMDA_ASSIGNMENTS_PER_SESSION) throw new TaskSessionError(409, 'worker_assignment_session_limit', 'Task session assignment count exceeded its configured limit');
  for (const row of rows) {
    assertValidAssignment(db, row);
    db.prepare(
      'UPDATE omda_worker_session_assignments SET status = \'revoked\', revision = revision + 1, updated_at = ?, revoked_at = ? ' +
      'WHERE id = ? AND user_id = ? AND revision = ? AND status = \'active\''
    ).run(nowIso, nowIso, row.id, userId, row.revision);
    appendAssignmentEvent(db, row, 'revoked', nowIso);
  }
}

export function assertOmdaWorkerSessionAssignment(db: Db, principal: OmdaWorkerPrincipal, sessionId: string): void {
  getOwnedSession(db, principal.userId, sessionId);
  const row = getAssignmentRow(db, principal.userId, principal.registryId, sessionId, true);
  if (!row) throw new TaskSessionError(403, 'worker_assignment_required', 'The task owner has not assigned this session to the worker');
  if (row.worker_id !== principal.workerId) throw new TaskSessionError(403, 'worker_assignment_mismatch', 'The worker assignment does not match the authenticated identity');
  assertValidAssignment(db, row);
}
