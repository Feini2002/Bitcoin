-- K 线云端存储（Cloudflare D1 / SQLite 语法）
-- 每个 (symbol, interval) 仅保留最新 6000 根（Worker 写入后硬删除，无回收站）
CREATE TABLE IF NOT EXISTS klines (
  symbol    TEXT    NOT NULL,
  interval  TEXT    NOT NULL,
  t         INTEGER NOT NULL,
  o         REAL    NOT NULL,
  h         REAL    NOT NULL,
  l         REAL    NOT NULL,
  c         REAL    NOT NULL,
  v         REAL    NOT NULL,
  PRIMARY KEY (symbol, interval, t)
);

CREATE INDEX IF NOT EXISTS idx_klines_sym_iv_t
  ON klines (symbol, interval, t DESC);

-- 记录每个 (symbol, interval) 的最近一次同步状态，便于可观测性（可选）
CREATE TABLE IF NOT EXISTS sync_status (
  symbol     TEXT    NOT NULL,
  interval   TEXT    NOT NULL,
  last_run   INTEGER NOT NULL,
  last_t     INTEGER NOT NULL DEFAULT 0,
  last_count INTEGER NOT NULL DEFAULT 0,
  last_ok    INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  PRIMARY KEY (symbol, interval)
);

-- Footprint 云端存储：只落最多 8640 根 5m 基础足迹，15m/1h/4h 由 Worker 读取时合成。
-- levels_json 为 [{price,buyVol,sellVol}]，price 按 1 USDT 基础档归并，前端可再合成 5/10/25。
CREATE TABLE IF NOT EXISTS footprint_bars (
  symbol        TEXT    NOT NULL,
  interval      TEXT    NOT NULL DEFAULT '5m',
  t             INTEGER NOT NULL,
  o             REAL    NOT NULL,
  h             REAL    NOT NULL,
  l             REAL    NOT NULL,
  c             REAL    NOT NULL,
  buy_vol       REAL    NOT NULL DEFAULT 0,
  sell_vol      REAL    NOT NULL DEFAULT 0,
  delta         REAL    NOT NULL DEFAULT 0,
  volume        REAL    NOT NULL DEFAULT 0,
  poc_price     REAL,
  levels_json   TEXT    NOT NULL DEFAULT '[]',
  last_trade_id INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (symbol, interval, t)
);

CREATE INDEX IF NOT EXISTS idx_footprint_bars_sym_iv_t
  ON footprint_bars (symbol, interval, t DESC);

CREATE TABLE IF NOT EXISTS footprint_sync_status (
  symbol          TEXT    NOT NULL PRIMARY KEY,
  last_run        INTEGER NOT NULL,
  last_trade_id   INTEGER NOT NULL DEFAULT 0,
  last_trade_time INTEGER NOT NULL DEFAULT 0,
  last_count      INTEGER NOT NULL DEFAULT 0,
  last_ok         INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT
);

-- Strong liquidation radar: 5m aggregate buckets only.
-- Raw force-order events stay in the live browser/collector tape and are not persisted.
CREATE TABLE IF NOT EXISTS liquidation_5m_buckets (
  symbol         TEXT    NOT NULL,
  exchange       TEXT    NOT NULL,
  bucket_start   INTEGER NOT NULL,
  long_notional  REAL    NOT NULL DEFAULT 0,
  short_notional REAL    NOT NULL DEFAULT 0,
  long_count     INTEGER NOT NULL DEFAULT 0,
  short_count    INTEGER NOT NULL DEFAULT 0,
  max_notional   REAL    NOT NULL DEFAULT 0,
  max_side       TEXT,
  min_price      REAL,
  max_price      REAL,
  vwap_price     REAL,
  updated_at     INTEGER NOT NULL,
  PRIMARY KEY (symbol, exchange, bucket_start)
);

CREATE INDEX IF NOT EXISTS idx_liquidation_5m_symbol_t
  ON liquidation_5m_buckets (symbol, bucket_start DESC);

CREATE INDEX IF NOT EXISTS idx_liquidation_5m_bucket_start
  ON liquidation_5m_buckets (bucket_start);

-- Derivatives panel: lightweight public market time series.
-- Metrics include funding_binance, funding_deribit, oi_binance, oi_deribit,
-- dvol, vix, vix3m, move, and long_short.
CREATE TABLE IF NOT EXISTS derivative_timeseries (
  symbol     TEXT    NOT NULL,
  metric     TEXT    NOT NULL,
  t          INTEGER NOT NULL,
  value      REAL    NOT NULL,
  source     TEXT    NOT NULL DEFAULT '',
  extra_json TEXT    NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (symbol, metric, t)
);

CREATE INDEX IF NOT EXISTS idx_derivative_timeseries_sym_metric_t
  ON derivative_timeseries (symbol, metric, t DESC);

CREATE INDEX IF NOT EXISTS idx_derivative_timeseries_t
  ON derivative_timeseries (t);

-- Deribit option surface snapshots for 25-delta skew and compact smile views.
CREATE TABLE IF NOT EXISTS derivative_option_surface (
  symbol          TEXT    NOT NULL,
  currency        TEXT    NOT NULL,
  snapshot_t      INTEGER NOT NULL,
  expiration      TEXT    NOT NULL,
  strike          REAL    NOT NULL,
  option_type     TEXT    NOT NULL,
  instrument_name TEXT    NOT NULL,
  delta           REAL,
  mark_iv         REAL,
  open_interest   REAL,
  volume          REAL,
  source          TEXT    NOT NULL DEFAULT 'deribit',
  updated_at      INTEGER NOT NULL,
  PRIMARY KEY (symbol, snapshot_t, instrument_name)
);

CREATE INDEX IF NOT EXISTS idx_derivative_surface_sym_t
  ON derivative_option_surface (symbol, snapshot_t DESC);

CREATE TABLE IF NOT EXISTS derivative_sync_status (
  symbol      TEXT    NOT NULL,
  metric      TEXT    NOT NULL,
  last_run    TEXT    NOT NULL,
  last_count  INTEGER NOT NULL DEFAULT 0,
  last_ok     INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  PRIMARY KEY (symbol, metric)
);

/** 衍生品上游健康度（可观测）：按 source 聚合，不写业务时间序列本体。*/
CREATE TABLE IF NOT EXISTS derivative_source_health (
  source                TEXT PRIMARY KEY NOT NULL,
  last_run              TEXT NOT NULL,
  last_ok               INTEGER NOT NULL DEFAULT 0,
  last_error_kind       TEXT,
  last_error            TEXT,
  cooldown_until_ms     INTEGER NOT NULL DEFAULT 0,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  last_success_at_ms    INTEGER,
  extra_json            TEXT NOT NULL DEFAULT '{}'
);

/** 单次同步全局互斥与审计：避免 Cron / 手动 / waitUntil 并行打满上游（只增不改旧表语义）。*/
CREATE TABLE IF NOT EXISTS derivative_sync_locks (
  lock_key      TEXT PRIMARY KEY NOT NULL,
  owner         TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  extra_json    TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS derivative_sync_runs (
  run_id        TEXT PRIMARY KEY NOT NULL,
  symbol        TEXT NOT NULL,
  trigger       TEXT NOT NULL,
  groups_json   TEXT NOT NULL DEFAULT '{}',
  started_at_ms INTEGER NOT NULL,
  ended_at_ms   INTEGER,
  duration_ms   INTEGER,
  written_json  TEXT NOT NULL DEFAULT '{}',
  failed_json   TEXT NOT NULL DEFAULT '[]',
  ok            INTEGER NOT NULL DEFAULT 1,
  extra_json    TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_deriv_sync_runs_sym_started ON derivative_sync_runs (symbol, started_at_ms DESC);

/** 按 symbol+metric：调度冷却、下一次允许拉取时间与错误分类（可观测）。*/
CREATE TABLE IF NOT EXISTS derivative_metric_health (
  symbol                   TEXT NOT NULL,
  metric                   TEXT NOT NULL,
  last_attempt_at_ms       INTEGER,
  last_success_at_ms       INTEGER,
  next_allowed_at_ms       INTEGER NOT NULL DEFAULT 0,
  consecutive_failures     INTEGER NOT NULL DEFAULT 0,
  last_error_kind          TEXT,
  last_error               TEXT,
  extra_json               TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (symbol, metric)
);

CREATE INDEX IF NOT EXISTS idx_deriv_metric_health_next ON derivative_metric_health (symbol, next_allowed_at_ms);

-- On-chain panel: aggregated metrics (multiple chains / proxies), scope GLOBAL for system-wide totals.
CREATE TABLE IF NOT EXISTS onchain_timeseries (
  scope       TEXT    NOT NULL,
  metric      TEXT    NOT NULL,
  t           INTEGER NOT NULL,
  value       REAL    NOT NULL,
  source      TEXT    NOT NULL DEFAULT '',
  extra_json  TEXT    NOT NULL DEFAULT '{}',
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (scope, metric, t)
);

CREATE INDEX IF NOT EXISTS idx_onchain_timeseries_scope_metric_t
  ON onchain_timeseries (scope, metric, t DESC);

CREATE TABLE IF NOT EXISTS onchain_sync_status (
  scope       TEXT    NOT NULL,
  metric      TEXT    NOT NULL,
  last_run    TEXT    NOT NULL,
  last_count  INTEGER NOT NULL DEFAULT 0,
  last_ok     INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  PRIMARY KEY (scope, metric)
);
