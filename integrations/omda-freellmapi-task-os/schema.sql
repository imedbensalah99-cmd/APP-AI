-- OMDA FreeLLMAPI Agents Task OS: candidate SQLite/D1 schema, offline rehearsal only.
-- DO NOT apply to live D1 until owner authentication, backup/restore,
-- free quotas, compatibility and deploy approval have been verified.
-- This namespace is never installed in a legacy OMDA or OMDA 2 database.
PRAGMA foreign_keys = ON;

-- One bounded counter per authenticated owner (never an unbounded per-minute history).
-- Must be in the owner-only isolated Task OS D1 namespace.
CREATE TABLE IF NOT EXISTS omda_task_request_limits (
  owner_scope TEXT PRIMARY KEY CHECK(length(owner_scope) BETWEEN 8 AND 128),
  minute_bucket INTEGER NOT NULL CHECK(minute_bucket >= 0),
  consumed INTEGER NOT NULL CHECK(consumed BETWEEN 1 AND 30),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS omda_task_schema_versions (
  version INTEGER PRIMARY KEY CHECK(version > 0),
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS omda_task_sessions (
  session_id TEXT PRIMARY KEY,
  owner_scope TEXT NOT NULL CHECK(length(owner_scope) BETWEEN 8 AND 128),
  session_digest TEXT NOT NULL UNIQUE CHECK(length(session_digest)=64),
  scope TEXT NOT NULL CHECK(scope='owner'),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  CHECK(expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS idx_omda_sessions_owner
  ON omda_task_sessions(owner_scope, expires_at);

CREATE TABLE IF NOT EXISTS omda_task_tasks (
  task_id TEXT PRIMARY KEY,
  owner_scope TEXT NOT NULL CHECK(length(owner_scope) BETWEEN 8 AND 128),
  project_scope TEXT NOT NULL DEFAULT 'omda-freellmapi-agents'
    CHECK(project_scope='omda-freellmapi-agents'),
  idempotency_key TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 128),
  request_digest_sha256 TEXT NOT NULL CHECK(length(request_digest_sha256)=64),
  original_command TEXT NOT NULL CHECK(length(original_command) BETWEEN 3 AND 2500),
  intent_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(intent_json)),
  status TEXT NOT NULL CHECK(status IN
    ('DRAFT','PLANNED','QUEUED','RUNNING','WAITING_FOR_APPROVAL','PAUSED',
     'BLOCKED','RETRYABLE_FAILURE','FAILED','COMPLETED','CANCELED')),
  priority INTEGER NOT NULL DEFAULT 3 CHECK(priority BETWEEN 0 AND 5),
  checkpoint_version INTEGER NOT NULL DEFAULT 1 CHECK(checkpoint_version > 0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 2 CHECK(max_attempts BETWEEN 0 AND 3),
  budget_microunits INTEGER NOT NULL DEFAULT 0 CHECK(budget_microunits = 0),
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_scope, idempotency_key),
  UNIQUE(task_id, owner_scope)
);
CREATE INDEX IF NOT EXISTS idx_omda_tasks_owner_state_time
  ON omda_task_tasks(owner_scope, status, created_at);

CREATE TABLE IF NOT EXISTS omda_task_steps (
  step_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  owner_scope TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(length(kind) BETWEEN 1 AND 64),
  input_json TEXT NOT NULL CHECK(json_valid(input_json)),
  status TEXT NOT NULL CHECK(status IN
    ('DRAFT','PLANNED','QUEUED','RUNNING','WAITING_FOR_APPROVAL','PAUSED',
     'BLOCKED','RETRYABLE_FAILURE','FAILED','COMPLETED','CANCELED')),
  approval_required INTEGER NOT NULL DEFAULT 0 CHECK(approval_required IN (0,1)),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 2 CHECK(max_attempts BETWEEN 0 AND 3),
  lease_owner TEXT,
  lease_expires_at TEXT,
  deadline_at TEXT,
  checkpoint_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(checkpoint_json)),
  output_digest TEXT CHECK(output_digest IS NULL OR length(output_digest)=64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(step_id, owner_scope),
  FOREIGN KEY(task_id, owner_scope)
    REFERENCES omda_task_tasks(task_id, owner_scope) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_omda_steps_queue
  ON omda_task_steps(status, lease_expires_at, created_at);

CREATE TABLE IF NOT EXISTS omda_task_dependencies (
  step_id TEXT NOT NULL,
  prerequisite_step_id TEXT NOT NULL,
  owner_scope TEXT NOT NULL,
  PRIMARY KEY(step_id, prerequisite_step_id),
  CHECK(step_id <> prerequisite_step_id),
  FOREIGN KEY(step_id, owner_scope)
    REFERENCES omda_task_steps(step_id, owner_scope) ON DELETE CASCADE,
  FOREIGN KEY(prerequisite_step_id, owner_scope)
    REFERENCES omda_task_steps(step_id, owner_scope) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS omda_task_approvals (
  approval_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  owner_scope TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN
    ('email.send','job.apply','website.publish','production.mutate')),
  target TEXT NOT NULL CHECK(length(target) BETWEEN 1 AND 1024),
  payload_digest_sha256 TEXT NOT NULL CHECK(length(payload_digest_sha256)=64),
  payload_version INTEGER NOT NULL CHECK(payload_version > 0),
  status TEXT NOT NULL DEFAULT 'WAITING_FOR_APPROVAL' CHECK(status IN
    ('WAITING_FOR_APPROVAL','APPROVED','CONSUMED','REJECTED','EXPIRED')),
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  consumed_at TEXT,
  audit_event_id TEXT NOT NULL,
  UNIQUE(approval_id, task_id, owner_scope),
  CHECK(expires_at > issued_at),
  FOREIGN KEY(task_id, owner_scope)
    REFERENCES omda_task_tasks(task_id, owner_scope) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_omda_approvals_owner_pending
  ON omda_task_approvals(owner_scope, status, expires_at);

CREATE TABLE IF NOT EXISTS omda_task_external_actions (
  action_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  owner_scope TEXT NOT NULL,
  approval_id TEXT NOT NULL UNIQUE,
  action_kind TEXT NOT NULL,
  target TEXT NOT NULL,
  payload_digest_sha256 TEXT NOT NULL CHECK(length(payload_digest_sha256)=64),
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN
    ('PREPARED','IN_FLIGHT','RECONCILE','SUCCEEDED','FAILED')),
  receipt_redacted TEXT,
  recorded_at TEXT NOT NULL,
  FOREIGN KEY(task_id, owner_scope)
    REFERENCES omda_task_tasks(task_id, owner_scope) ON DELETE RESTRICT,
  FOREIGN KEY(approval_id, task_id, owner_scope)
    REFERENCES omda_task_approvals(approval_id, task_id, owner_scope) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS omda_task_artifacts (
  artifact_id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  owner_scope TEXT NOT NULL,
  filename TEXT NOT NULL CHECK(length(filename) BETWEEN 1 AND 200),
  mime TEXT NOT NULL CHECK(length(mime) BETWEEN 3 AND 128),
  size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 4194304),
  sha256 TEXT NOT NULL CHECK(length(sha256)=64),
  object_ref TEXT NOT NULL CHECK(length(object_ref) BETWEEN 1 AND 500),
  version INTEGER NOT NULL CHECK(version > 0),
  validation_state TEXT NOT NULL CHECK(validation_state IN ('PASS','FAIL')),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  UNIQUE(task_id, owner_scope, filename, version),
  FOREIGN KEY(task_id, owner_scope)
    REFERENCES omda_task_tasks(task_id, owner_scope) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_omda_artifacts_owner_task
  ON omda_task_artifacts(owner_scope, task_id);

CREATE TABLE IF NOT EXISTS omda_task_audit (
  event_id TEXT PRIMARY KEY,
  owner_scope TEXT NOT NULL,
  task_id TEXT,
  event_type TEXT NOT NULL CHECK(length(event_type) BETWEEN 1 AND 96),
  context_redacted_json TEXT NOT NULL CHECK(json_valid(context_redacted_json)),
  recorded_at TEXT NOT NULL,
  FOREIGN KEY(task_id, owner_scope)
    REFERENCES omda_task_tasks(task_id, owner_scope) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_omda_audit_owner_time
  ON omda_task_audit(owner_scope, recorded_at);

-- A transactionally claimed approval requires a single guarded UPDATE:
-- UPDATE omda_task_approvals SET status='CONSUMED', consumed_at=:now
-- WHERE approval_id=:id AND owner_scope=:owner AND status='APPROVED'
--   AND target=:target AND payload_digest_sha256=:digest
--   AND expires_at>:now RETURNING approval_id;
-- External actions must also use the unique effect ledger and reconciliation.
-- SQL constraints alone do NOT authenticate owner sessions or prevent every
-- cross-record/semantic mismatch. Enforce authorization/approval in the API.
