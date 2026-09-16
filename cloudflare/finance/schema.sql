-- Dedicated latest-response cache. Existing market/history tables are untouched.
CREATE TABLE IF NOT EXISTS finance_channel_state (
  channel_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  last_http_status INTEGER NOT NULL,
  last_error TEXT,
  upstream_status INTEGER,
  retry_at TEXT,
  snapshot_id TEXT,
  received_at TEXT,
  stored_at TEXT,
  payload_bytes INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS finance_snapshot_chunks (
  channel_key TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  part INTEGER NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY(channel_key, snapshot_id, part)
);
