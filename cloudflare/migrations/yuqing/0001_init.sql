-- 舆情 Yuqing Worker 专用 D1（与 btc 库分离）。
-- 创建库并绑定 wrangler.yuqing.toml 后：
--   npx wrangler d1 execute <database_name> --remote --file=cloudflare/migrations/yuqing/0001_init.sql

PRAGMA foreign_keys = OFF;

CREATE TABLE IF NOT EXISTS yuqing_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  source_errors TEXT
);

CREATE INDEX IF NOT EXISTS idx_yuqing_snapshots_captured ON yuqing_snapshots(captured_at DESC);

CREATE TABLE IF NOT EXISTS yuqing_items (
  id TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL,
  source_type TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  url TEXT,
  published_at INTEGER,
  fetched_at INTEGER NOT NULL,
  severity TEXT,
  confidence REAL,
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_yuqing_items_fetched ON yuqing_items(fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_yuqing_items_published ON yuqing_items(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_yuqing_items_cat ON yuqing_items(category);

CREATE TABLE IF NOT EXISTS yuqing_report_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generated_at TEXT NOT NULL,
  run_type TEXT NOT NULL,
  mode TEXT,
  grounding_json TEXT,
  report_json TEXT
);
