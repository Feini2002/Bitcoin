-- Lightweight read/prune indexes for the btc D1 database.
-- Apply remotely from cloudflare/ with:
-- npx wrangler d1 execute btc --remote --file=./d1-lightweight-indexes.sql

CREATE INDEX IF NOT EXISTS idx_liquidation_5m_bucket_start
  ON liquidation_5m_buckets (bucket_start);

CREATE INDEX IF NOT EXISTS idx_derivative_timeseries_t
  ON derivative_timeseries (t);
