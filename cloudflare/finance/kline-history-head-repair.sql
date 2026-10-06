-- Candidate-only derived-state repair. Do not run on production until the
-- isolated cost gate and explicit migration approval. Facts are untouched.
-- Each of seven periods seeks its own raw/canonical head; an old spot/perp
-- shared head can move backwards here, while its revision must increase.
WITH periods(interval) AS (VALUES('5m'),('15m'),('1h'),('4h'),('1d'),('3d'),('1w')),
heads AS MATERIALIZED (
  SELECT interval,MAX(
    COALESCE((SELECT MAX(t) FROM klines WHERE symbol='BTCUSDT' AND klines.interval=periods.interval),0),
    COALESCE((SELECT CAST(observation_key AS INTEGER) FROM finance_dataset_observations
      WHERE dataset_id='binance-perp-klines-'||periods.interval AND observed_at IS NOT NULL
      ORDER BY observed_at DESC,observation_key DESC LIMIT 1),0)) AS actual_head FROM periods)
UPDATE desk_history_state SET
  head_t=(SELECT actual_head FROM heads WHERE heads.interval=desk_history_state.interval),
  history_revision=history_revision+1
WHERE symbol='BTCUSDT' AND EXISTS (SELECT 1 FROM heads WHERE heads.interval=desk_history_state.interval
  AND actual_head>0 AND actual_head<>desk_history_state.head_t);
