import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS omda_task_session_leases (\n' +
    '  session_id TEXT PRIMARY KEY REFERENCES omda_task_sessions(id) ON DELETE RESTRICT,\n' +
    '  lease_id TEXT NOT NULL UNIQUE,\n' +
    '  worker_id TEXT NOT NULL CHECK (length(worker_id) BETWEEN 1 AND 64),\n' +
    '  token_hash TEXT CHECK (token_hash IS NULL OR (length(token_hash) = 64 AND token_hash NOT GLOB \'*[^0-9a-f]*\')),\n' +
    '  status TEXT NOT NULL CHECK (status IN (\'active\', \'released\', \'expired\', \'revoked\')),\n' +
    '  revision INTEGER NOT NULL CHECK (revision >= 1 AND revision <= 2000),\n' +
    '  claimed_at TEXT NOT NULL,\n' +
    '  renewed_at TEXT,\n' +
    '  expires_at TEXT NOT NULL,\n' +
    '  closed_at TEXT,\n' +
    '  updated_at TEXT NOT NULL,\n' +
    '  CHECK ((status = \'active\' AND token_hash IS NOT NULL AND closed_at IS NULL) OR (status <> \'active\' AND token_hash IS NULL AND closed_at IS NOT NULL))\n' +
    ');\n' +
    'CREATE INDEX IF NOT EXISTS idx_omda_task_session_leases_status_expiry ON omda_task_session_leases(status, expires_at);\n' +
    'CREATE TABLE IF NOT EXISTS omda_task_session_lease_events (\n' +
    '  session_id TEXT NOT NULL REFERENCES omda_task_sessions(id) ON DELETE RESTRICT,\n' +
    '  seq INTEGER NOT NULL CHECK (seq >= 0 AND seq < 2000),\n' +
    '  lease_id TEXT NOT NULL,\n' +
    '  action TEXT NOT NULL CHECK (action IN (\'claim\', \'renew\', \'release\', \'expire\', \'revoke\')),\n' +
    '  worker_id TEXT NOT NULL CHECK (length(worker_id) BETWEEN 1 AND 64),\n' +
    '  occurred_at TEXT NOT NULL,\n' +
    '  expires_at TEXT NOT NULL,\n' +
    '  previous_hash TEXT NOT NULL CHECK (length(previous_hash) = 64),\n' +
    '  event_hash TEXT NOT NULL CHECK (length(event_hash) = 64),\n' +
    '  PRIMARY KEY (session_id, seq)\n' +
    ');\n' +
    'CREATE INDEX IF NOT EXISTS idx_omda_task_session_lease_events_lease ON omda_task_session_lease_events(session_id, lease_id, seq);\n' +
    'CREATE TRIGGER IF NOT EXISTS trg_omda_task_session_lease_events_no_update BEFORE UPDATE ON omda_task_session_lease_events BEGIN SELECT RAISE(ABORT, \'OMDA task session lease events are append-only\'); END;\n' +
    'CREATE TRIGGER IF NOT EXISTS trg_omda_task_session_lease_events_no_delete BEFORE DELETE ON omda_task_session_lease_events BEGIN SELECT RAISE(ABORT, \'OMDA task session lease events are append-only\'); END;\n' +
    'CREATE TRIGGER IF NOT EXISTS trg_omda_task_session_leases_no_delete BEFORE DELETE ON omda_task_session_leases BEGIN SELECT RAISE(ABORT, \'OMDA task session leases are retained\'); END;'
  );
}

export function down(db: Db): void {
  const leases = db.prepare('SELECT COUNT(*) AS count FROM omda_task_session_leases').get() as { count: number };
  const events = db.prepare('SELECT COUNT(*) AS count FROM omda_task_session_lease_events').get() as { count: number };
  if (leases.count > 0 || events.count > 0) {
    throw new Error('OMDA task session lease history is retained; export and explicitly clear it before rollback');
  }
  db.exec(
    'DROP TRIGGER IF EXISTS trg_omda_task_session_lease_events_no_update;\n' +
    'DROP TRIGGER IF EXISTS trg_omda_task_session_lease_events_no_delete;\n' +
    'DROP TRIGGER IF EXISTS trg_omda_task_session_leases_no_delete;\n' +
    'DROP INDEX IF EXISTS idx_omda_task_session_lease_events_lease;\n' +
    'DROP TABLE IF EXISTS omda_task_session_lease_events;\n' +
    'DROP INDEX IF EXISTS idx_omda_task_session_leases_status_expiry;\n' +
    'DROP TABLE IF EXISTS omda_task_session_leases;'
  );
}
