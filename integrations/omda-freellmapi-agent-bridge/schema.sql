-- Independent staging Bridge daily+minute quota; no secrets or prompts stored.
CREATE TABLE IF NOT EXISTS agent_quotas (
 day TEXT PRIMARY KEY,
 minute TEXT NOT NULL,
 daily_count INTEGER NOT NULL CHECK(daily_count >= 0 AND daily_count <= 10),
 minute_count INTEGER NOT NULL CHECK(minute_count >= 0 AND minute_count <= 1)
);
