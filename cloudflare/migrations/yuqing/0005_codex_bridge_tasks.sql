-- Yuqing Codex CLI bridge queue.
-- npx wrangler d1 execute yuqing --remote --file=cloudflare/migrations/yuqing/0005_codex_bridge_tasks.sql

CREATE TABLE IF NOT EXISTS yuqing_codex_tasks (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  report_id TEXT NOT NULL,
  report_date TEXT NOT NULL,
  slot TEXT NOT NULL,
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'queued',
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  lease_owner TEXT,
  lease_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at TEXT,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_yuqing_codex_tasks_status_created
  ON yuqing_codex_tasks (status, created_at);

CREATE INDEX IF NOT EXISTS idx_yuqing_codex_tasks_kind_created
  ON yuqing_codex_tasks (kind, created_at DESC);

INSERT OR IGNORE INTO yuqing_settings (key, value_json)
VALUES (
  'execution_channels',
  '{"version":1,"assignments":{"daily_event":"gemini_worker","sentiment_analysis":"gemini_worker","overview.advice":"gemini_worker","premarket.brief":"gemini_worker","boardroom.meeting":"gemini_worker","agent.chief":"gemini_worker","agent.env":"gemini_worker","agent.flow":"gemini_worker","agent.deriv":"gemini_worker","agent.risk":"gemini_worker","agent.archive":"gemini_worker","strategy.templates":"gemini_worker","order.draft":"gemini_worker","positions.risk":"gemini_worker","review.journal":"gemini_worker","review.daily":"gemini_worker","review.performance":"gemini_worker","review.patterns":"gemini_worker","playbook.assistant":"gemini_worker"},"updatedAt":null}'
);
