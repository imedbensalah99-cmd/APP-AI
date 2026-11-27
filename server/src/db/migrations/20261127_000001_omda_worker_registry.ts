import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS omda_workers (\n' +
    '  id TEXT PRIMARY KEY,\n' +
    '  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,\n' +
    '  worker_id TEXT NOT NULL UNIQUE CHECK (length(worker_id) BETWEEN 8 AND 40),\n' +
    '  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),\n' +
    '  token_hash TEXT UNIQUE CHECK (token_hash IS NULL OR (length(token_hash) = 64 AND token_hash NOT GLOB \'*[^0-9a-f]*\')),\n' +
    '  status TEXT NOT NULL CHECK (status IN (\'active\', \'revoked\')),\n' +
    '  revision INTEGER NOT NULL CHECK (revision >= 1 AND revision <= 1000),\n' +
    '  created_at TEXT NOT NULL,\n' +
    '  updated_at TEXT NOT NULL,\n' +
    '  last_seen_at TEXT,\n' +
    '  revoked_at TEXT,\n' +
    '  CHECK ((status = \'active\' AND token_hash IS NOT NULL AND revoked_at IS NULL) OR (status = \'revoked\' AND token_hash IS NULL AND revoked_at IS NOT NULL))\n' +
    ');\n' +
    'CREATE INDEX IF NOT EXISTS idx_omda_workers_user_status ON omda_workers(user_id, status);\n' +
    'CREATE TABLE IF NOT EXISTS omda_worker_events (\n' +
    '  registry_id TEXT NOT NULL REFERENCES omda_workers(id) ON DELETE RESTRICT,\n' +
    '  seq INTEGER NOT NULL CHECK (seq >= 0 AND seq < 1000),\n' +
    '  action TEXT NOT NULL CHECK (action IN (\'created\', \'rotated\', \'revoked\')),\n' +
    '  credential_hash TEXT NOT NULL CHECK (length(credential_hash) = 64 AND credential_hash NOT GLOB \'*[^0-9a-f]*\'),\n' +
    '  occurred_at TEXT NOT NULL,\n' +
    '  previous_hash TEXT NOT NULL CHECK (length(previous_hash) = 64),\n' +
    '  event_hash TEXT NOT NULL CHECK (length(event_hash) = 64),\n' +
    '  PRIMARY KEY (registry_id, seq)\n' +
    ');\n' +
    'CREATE TRIGGER IF NOT EXISTS trg_omda_workers_identity_immutable BEFORE UPDATE OF id, user_id, worker_id, label, created_at ON omda_workers BEGIN SELECT RAISE(ABORT, \'OMDA worker identity fields are immutable\'); END;\n' +
    'CREATE TRIGGER IF NOT EXISTS trg_omda_worker_events_no_update BEFORE UPDATE ON omda_worker_events BEGIN SELECT RAISE(ABORT, \'OMDA worker events are append-only\'); END;\n' +
    'CREATE TRIGGER IF NOT EXISTS trg_omda_worker_events_no_delete BEFORE DELETE ON omda_worker_events BEGIN SELECT RAISE(ABORT, \'OMDA worker events are append-only\'); END;\n' +
    'CREATE TRIGGER IF NOT EXISTS trg_omda_workers_no_delete BEFORE DELETE ON omda_workers BEGIN SELECT RAISE(ABORT, \'OMDA worker registry records are retained\'); END;'
  );
}

export function down(db: Db): void {
  const row = db.prepare('SELECT COUNT(*) AS count FROM omda_workers').get() as { count: number };
  if (row.count > 0) {
    throw new Error('Cannot roll back OMDA worker registry while worker credentials or audit history are retained');
  }
  db.exec(
    'DROP TRIGGER IF EXISTS trg_omda_workers_no_delete;\n' +
    'DROP TRIGGER IF EXISTS trg_omda_workers_identity_immutable;\n' +
    'DROP TRIGGER IF EXISTS trg_omda_worker_events_no_delete;\n' +
    'DROP TRIGGER IF EXISTS trg_omda_worker_events_no_update;\n' +
    'DROP TABLE IF EXISTS omda_worker_events;\n' +
    'DROP INDEX IF EXISTS idx_omda_workers_user_status;\n' +
    'DROP TABLE IF EXISTS omda_workers;'
  );
}
