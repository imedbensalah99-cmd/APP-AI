import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS omda_worker_session_assignments (\n' +
    '  id TEXT PRIMARY KEY,\n' +
    '  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,\n' +
    '  registry_id TEXT NOT NULL REFERENCES omda_workers(id) ON DELETE RESTRICT,\n' +
    '  worker_id TEXT NOT NULL CHECK (length(worker_id) BETWEEN 8 AND 40),\n' +
    '  session_id TEXT NOT NULL REFERENCES omda_task_sessions(id) ON DELETE RESTRICT,\n' +
    '  status TEXT NOT NULL CHECK (status IN (\'active\', \'revoked\')),\n' +
    '  revision INTEGER NOT NULL CHECK (revision IN (1, 2)),\n' +
    '  created_at TEXT NOT NULL,\n' +
    '  updated_at TEXT NOT NULL,\n' +
    '  revoked_at TEXT,\n' +
    '  CHECK ((status = \'active\' AND revision = 1 AND revoked_at IS NULL) OR (status = \'revoked\' AND revision = 2 AND revoked_at IS NOT NULL))\n' +
    ');\n' +
    'CREATE INDEX IF NOT EXISTS idx_omda_worker_assignments_worker ON omda_worker_session_assignments(user_id, registry_id, created_at DESC);\n' +
    'CREATE INDEX IF NOT EXISTS idx_omda_worker_assignments_session ON omda_worker_session_assignments(user_id, session_id, status);\n' +
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_omda_worker_assignments_active_pair ON omda_worker_session_assignments(registry_id, session_id) WHERE status = \'active\';\n' +
    'CREATE TABLE IF NOT EXISTS omda_worker_assignment_events (\n' +
    '  assignment_id TEXT NOT NULL REFERENCES omda_worker_session_assignments(id) ON DELETE RESTRICT,\n' +
    '  seq INTEGER NOT NULL CHECK (seq IN (0, 1)),\n' +
    '  action TEXT NOT NULL CHECK (action IN (\'assigned\', \'revoked\')),\n' +
    '  occurred_at TEXT NOT NULL,\n' +
    '  previous_hash TEXT NOT NULL CHECK (length(previous_hash) = 64 AND previous_hash NOT GLOB \'*[^0-9a-f]*\'),\n' +
    '  event_hash TEXT NOT NULL CHECK (length(event_hash) = 64 AND event_hash NOT GLOB \'*[^0-9a-f]*\'),\n' +
    '  PRIMARY KEY (assignment_id, seq)\n' +
    ');\n' +
    'CREATE TRIGGER IF NOT EXISTS trg_omda_worker_assignments_identity_immutable BEFORE UPDATE OF id, user_id, registry_id, worker_id, session_id, created_at ON omda_worker_session_assignments BEGIN SELECT RAISE(ABORT, \'OMDA worker assignment identity is immutable\'); END;\n' +
    'CREATE TRIGGER IF NOT EXISTS trg_omda_worker_assignments_no_delete BEFORE DELETE ON omda_worker_session_assignments BEGIN SELECT RAISE(ABORT, \'OMDA worker assignments are retained\'); END;\n' +
    'CREATE TRIGGER IF NOT EXISTS trg_omda_worker_assignment_events_no_update BEFORE UPDATE ON omda_worker_assignment_events BEGIN SELECT RAISE(ABORT, \'OMDA worker assignment events are append-only\'); END;\n' +
    'CREATE TRIGGER IF NOT EXISTS trg_omda_worker_assignment_events_no_delete BEFORE DELETE ON omda_worker_assignment_events BEGIN SELECT RAISE(ABORT, \'OMDA worker assignment events are append-only\'); END;'
  );
}
export function down(db: Db): void {
  const row = db.prepare('SELECT COUNT(*) AS count FROM omda_worker_session_assignments').get() as { count: number };
  if (row.count > 0) throw new Error('Cannot roll back OMDA worker assignments while assignment records or audit history are retained');
  db.exec(
    'DROP TRIGGER IF EXISTS trg_omda_worker_assignment_events_no_delete;\n' +
    'DROP TRIGGER IF EXISTS trg_omda_worker_assignment_events_no_update;\n' +
    'DROP TRIGGER IF EXISTS trg_omda_worker_assignments_no_delete;\n' +
    'DROP TRIGGER IF EXISTS trg_omda_worker_assignments_identity_immutable;\n' +
    'DROP TABLE IF EXISTS omda_worker_assignment_events;\n' +
    'DROP INDEX IF EXISTS idx_omda_worker_assignments_active_pair;\n' +
    'DROP INDEX IF EXISTS idx_omda_worker_assignments_session;\n' +
    'DROP INDEX IF EXISTS idx_omda_worker_assignments_worker;\n' +
    'DROP TABLE IF EXISTS omda_worker_session_assignments;'
  );
}
