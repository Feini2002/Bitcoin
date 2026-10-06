-- Local candidate migration; remote execution requires the rollout's explicit
-- migration step and its measured creation cost. No data deletion or rewrite.
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
