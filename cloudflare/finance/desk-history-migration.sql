-- Desk history revision baseline. Create only; do not drop on code rollback.
CREATE TABLE IF NOT EXISTS desk_history_state (
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  head_t INTEGER NOT NULL,
  history_revision INTEGER NOT NULL,
  PRIMARY KEY (symbol, interval)
);

-- D1/workerd rejects CREATE TEMP TABLE. Reuse one helper row per history key;
-- reset, detect, revise and data writes must remain in the same D1 batch.
CREATE TABLE IF NOT EXISTS _desk_hist_bump (
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  bump INTEGER NOT NULL,
  PRIMARY KEY (symbol, interval)
);

-- Existing databases need the same observed-time seek index as new installs.
-- The receipt index alone cannot bound latest-tail/history-summary key walks.
CREATE INDEX IF NOT EXISTS idx_finance_dataset_observed
  ON finance_dataset_observations(dataset_id, observed_at DESC, observation_key);
