-- Yuqing model channel settings.
-- npx wrangler d1 execute yuqing --remote --file=cloudflare/migrations/yuqing/0004_model_channels.sql

CREATE TABLE IF NOT EXISTS yuqing_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO yuqing_settings (key, value_json)
VALUES (
  'model_channels',
  '{"version":1,"assignments":{"daily_event.dashboard":"gemini-3.1-flash-lite","daily_event.news":"gemini-3-flash-preview","daily_event.timeline":"gemini-3-flash-preview","daily_event.ai":"gemini-3-flash-preview","daily_event.githubTools":"gemini-3-flash-preview","daily_event.trends":"gemini-3.1-flash-lite","sentiment_analysis.dashboard":"gemini-3.1-flash-lite","sentiment_analysis.news":"gemini-3.1-pro-preview","sentiment_analysis.ai":"gemini-3.1-pro-preview","sentiment_analysis.trends":"gemini-3.1-pro-preview","agent.chief":"gemini-3.1-pro-preview","agent.env":"gemini-3-flash-preview","agent.flow":"gemini-3-flash-preview","agent.deriv":"gemini-3-flash-preview","agent.risk":"gemini-3-flash-preview","overview.advice":"gemini-3.1-pro-preview","premarket.brief":"gemini-3.1-pro-preview","boardroom.meeting":"gemini-3.1-pro-preview","agent.archive":"gemini-3-flash-preview","strategy.templates":"gemini-3.1-pro-preview","order.draft":"gemini-3-flash-preview","positions.risk":"gemini-3-flash-preview","review.journal":"gemini-3-flash-preview","review.daily":"gemini-3.1-pro-preview","review.performance":"gemini-3-flash-preview","review.patterns":"gemini-3.1-pro-preview","playbook.assistant":"gemini-3-flash-preview"},"updatedAt":null}'
);
