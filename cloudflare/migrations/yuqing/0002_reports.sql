-- Yuqing unified reports: event digest + sentiment analysis.
-- Run remotely after 0001:
--   npx wrangler d1 execute yuqing --remote --file=cloudflare/migrations/yuqing/0002_reports.sql

CREATE TABLE IF NOT EXISTS yuqing_reports (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  report_date TEXT NOT NULL,
  slot TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready',
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  grounding_json TEXT NOT NULL DEFAULT '{}',
  market_snapshot_json TEXT NOT NULL DEFAULT '{}',
  report_json TEXT NOT NULL DEFAULT '{}',
  source_errors_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_yuqing_reports_kind_generated
  ON yuqing_reports (kind, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_yuqing_reports_kind_date_slot
  ON yuqing_reports (kind, report_date DESC, slot);

CREATE INDEX IF NOT EXISTS idx_yuqing_reports_created
  ON yuqing_reports (created_at DESC);
