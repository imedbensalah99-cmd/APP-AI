-- OMDA MoneyPrinter60 staging — independent D1 schema
-- All inserts are owner-draft-only. State READY_FOR_RENDER does NOT dispatch.
CREATE TABLE IF NOT EXISTS video_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  idem_key TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL DEFAULT 'SARDERA' CHECK(channel='SARDERA'),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 5 AND 120),
  script TEXT NOT NULL CHECK(length(script) BETWEEN 100 AND 2500),
  language TEXT NOT NULL DEFAULT 'ar' CHECK(language='ar'),
  duration_seconds INTEGER NOT NULL DEFAULT 60 CHECK(duration_seconds=60),
  state TEXT NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','READY_FOR_RENDER','REJECTED','REVIEW_READY')),
  provider_policy TEXT NOT NULL DEFAULT 'FREE_ONLY' CHECK(provider_policy='FREE_ONLY'),
  publish_intent INTEGER NOT NULL DEFAULT 0 CHECK(publish_intent=0),
  paid_generation INTEGER NOT NULL DEFAULT 0 CHECK(paid_generation=0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_video_jobs_created ON video_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS ix_video_jobs_state ON video_jobs(state,created_at);
