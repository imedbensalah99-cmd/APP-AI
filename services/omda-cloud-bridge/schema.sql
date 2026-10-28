-- Staging-only OMDA queue. Never apply blindly to the production database.
CREATE TABLE IF NOT EXISTS staging_jobs (
  id TEXT PRIMARY KEY,
  render_job_id TEXT,
  request_key TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL CHECK (channel IN ('SARDERA','NIMOLOO')),
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  artifact_sha256 TEXT,
  error_code TEXT,
  fingerprint TEXT
);
CREATE INDEX IF NOT EXISTS staging_jobs_updated ON staging_jobs(updated_at DESC);