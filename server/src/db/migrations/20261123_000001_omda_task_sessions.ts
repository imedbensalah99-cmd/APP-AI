import type { Db } from '../types.js';

/** Lifecycle metadata only; this migration does not create an executable queue. */
export function up(db: Db): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS omda_task_sessions (\n' +
    '  id TEXT PRIMARY KEY,\n' +
    '  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,\n' +
    '  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 120),\n' +
    '  plan_sha256 TEXT NOT NULL CHECK (length(plan_sha256) = 64 AND plan_sha256 = lower(plan_sha256) AND plan_sha256 NOT GLOB \'*[^0-9a-f]*\'),\n' +
    '  status TEXT NOT NULL CHECK (status IN (\'draft\', \'running\', \'paused\', \'completed\', \'cancelled\', \'failed\')),\n' +
    '  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),\n' +
    '  created_at TEXT NOT NULL,\n' +
    '  updated_at TEXT NOT NULL\n' +
    ');\n' +
    'CREATE INDEX IF NOT EXISTS idx_omda_task_sessions_user_updated ON omda_task_sessions(user_id, updated_at DESC);\n' +
    'CREATE TABLE IF NOT EXISTS omda_task_session_events (\n' +
    '  session_id TEXT NOT NULL REFERENCES omda_task_sessions(id) ON DELETE RESTRICT,\n' +
    '  seq INTEGER NOT NULL CHECK (seq >= 0),\n' +
    '  action TEXT NOT NULL CHECK (action IN (\'created\', \'start\', \'pause\', \'resume\', \'complete\', \'cancel\', \'fail\')),\n' +
    '  from_status TEXT CHECK (from_status IS NULL OR from_status IN (\'draft\', \'running\', \'paused\', \'completed\', \'cancelled\', \'failed\')),\n' +
    '  to_status TEXT NOT NULL CHECK (to_status IN (\'draft\', \'running\', \'paused\', \'completed\', \'cancelled\', \'failed\')),\n' +
    '  note TEXT CHECK (note IS NULL OR length(note) <= 500),\n' +
    '  occurred_at TEXT NOT NULL,\n' +
    '  previous_hash TEXT NOT NULL CHECK (length(previous_hash) = 64),\n' +
    '  event_hash TEXT NOT NULL CHECK (length(event_hash) = 64),\n' +
    '  PRIMARY KEY (session_id, seq)\n' +
    ');\n' +
    'CREATE INDEX IF NOT EXISTS idx_omda_task_session_events_time ON omda_task_session_events(session_id, occurred_at, seq);'
  );
}

export function down(db: Db): void {
  const row = db.prepare('SELECT COUNT(*) AS count FROM omda_task_sessions').get() as { count: number };
  if (row.count > 0) {
    throw new Error('OMDA task sessions contain retained audit history; export and explicitly clear records before rolling back this migration');
  }
  db.exec(
    'DROP INDEX IF EXISTS idx_omda_task_session_events_time;\n' +
    'DROP TABLE IF EXISTS omda_task_session_events;\n' +
    'DROP INDEX IF EXISTS idx_omda_task_sessions_user_updated;\n' +
    'DROP TABLE IF EXISTS omda_task_sessions;'
  );
}
