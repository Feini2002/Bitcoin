-- New source-specific research observations; legacy market tables remain unchanged.
CREATE TABLE IF NOT EXISTS finance_dataset_observations (
  dataset_id TEXT NOT NULL,
  observation_key TEXT NOT NULL,
  observed_at TEXT,
  time_precision TEXT NOT NULL,
  received_at TEXT NOT NULL,
  stored_at TEXT NOT NULL,
  source_host TEXT NOT NULL,
  ingestion_mode TEXT NOT NULL,
  source_revision_json TEXT,
  value_json TEXT NOT NULL,
  PRIMARY KEY(dataset_id, observation_key, received_at)
);
CREATE INDEX IF NOT EXISTS idx_finance_dataset_receipt
  ON finance_dataset_observations(dataset_id, received_at DESC);
CREATE TABLE IF NOT EXISTS finance_dataset_state (
  dataset_id TEXT PRIMARY KEY,
  attempted_at TEXT NOT NULL,
  last_http_status INTEGER NOT NULL,
  last_error TEXT,
  last_success_received_at TEXT,
  last_success_stored_at TEXT,
  last_ingestion_mode TEXT,
  row_count INTEGER NOT NULL DEFAULT 0
);
