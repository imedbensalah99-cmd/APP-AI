-- Dedicated telemetry for OMDA read-only AI Agent staging, no credentials or content.
CREATE TABLE IF NOT EXISTS agent_checks(
 id TEXT PRIMARY KEY,
 created_at TEXT NOT NULL,
 health_http INTEGER NOT NULL,
 model_http INTEGER NOT NULL,
 verdict TEXT NOT NULL CHECK(verdict IN ('PERIMETER_OK','ORIGIN_GATE_OPEN','NETWORK_UNAVAILABLE','PERIMETER_NOT_READY'))
);
CREATE INDEX IF NOT EXISTS idx_agent_checks_date ON agent_checks(created_at DESC);
