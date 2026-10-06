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
-- Tail and summary walks seek the newest observed_at instead of scanning every receipt.
-- One extra secondary index per inserted observation; acceptable next to the receipt index
-- because chart tail and context summary run on every read.
CREATE INDEX IF NOT EXISTS idx_finance_dataset_observed
  ON finance_dataset_observations(dataset_id, observed_at DESC, observation_key);
-- Bounded winner seeks. The partial index excludes receipts superseded by a
-- newer WS message; historical eligibility remains checked by the query.
CREATE INDEX IF NOT EXISTS idx_finance_kline_winner
  ON finance_dataset_observations(dataset_id,observation_key,
    (CASE WHEN json_extract(value_json,'$.closed')=1 THEN 1 ELSE 0 END) DESC,
    (CASE WHEN received_at=observed_at THEN stored_at ELSE received_at END) DESC,
    received_at DESC)
  WHERE dataset_id GLOB 'binance-perp-klines-*' AND time_precision<>'receipt'
    AND json_extract(value_json,'$.supersededByWs') IS NOT 1;
CREATE INDEX IF NOT EXISTS idx_finance_kline_confirmed
  ON finance_dataset_observations(dataset_id,observation_key,received_at DESC)
  WHERE dataset_id GLOB 'binance-perp-klines-*' AND json_extract(value_json,'$.finality')='exchange_closed';
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
