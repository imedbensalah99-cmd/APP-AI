-- OMDA documentary staging D1: created in separate free database
-- Database: omda-documentary-bridge-staging-db
-- Contains no footage, scripts, credentials or access tokens.
CREATE TABLE IF NOT EXISTS documentary_jobs (
  job_id TEXT PRIMARY KEY NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  fingerprint TEXT NOT NULL,
  country TEXT NOT NULL,
  title TEXT NOT NULL,
  duration_seconds REAL NOT NULL,
  state TEXT NOT NULL,
  remote_job_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documentary_jobs_recent
  ON documentary_jobs(created_at DESC);
