-- Dedicated to the NEW FreeLLMAPI account; not legacy backups. 
CREATE TABLE IF NOT EXISTS fresh_backup_versions (
  version_id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes > 0 AND size_bytes <= 2097152),
  chunk_count INTEGER NOT NULL CHECK(chunk_count >= 1 AND chunk_count <= 32),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fresh_backup_chunks (
  version_id TEXT NOT NULL REFERENCES fresh_backup_versions(version_id),
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  payload_b64 TEXT NOT NULL,
  PRIMARY KEY(version_id,ordinal)
);
CREATE TABLE IF NOT EXISTS fresh_backup_head (
  id INTEGER PRIMARY KEY CHECK(id=1),
  version_id TEXT NOT NULL REFERENCES fresh_backup_versions(version_id)
);
