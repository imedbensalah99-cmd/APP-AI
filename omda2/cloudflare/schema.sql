CREATE TABLE IF NOT EXISTS agent_runs(
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN('research','qa')),
  task TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','completed','failed','blocked')),
  model TEXT, result TEXT, error TEXT, started_at TEXT, finished_at TEXT,
  created_at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_events(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  event TEXT NOT NULL,
  detail TEXT,
  at TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE IF NOT EXISTS daily_limits(
  day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0,
  last_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_created ON agent_runs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_run ON audit_events(run_id);
