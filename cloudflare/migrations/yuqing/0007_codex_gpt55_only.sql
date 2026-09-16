-- Force Codex CLI model settings to GPT-5.5 while preserving per-module reasoning effort.
-- npx wrangler d1 execute yuqing --remote --file=cloudflare/migrations/yuqing/0007_codex_gpt55_only.sql

CREATE TABLE IF NOT EXISTS yuqing_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO yuqing_settings (key, value_json)
VALUES (
  'model_channels',
  '{"version":1,"assignments":{},"codex":{"modules":{},"routes":{}},"updatedAt":null}'
);

UPDATE yuqing_settings
SET value_json = json_set(
  COALESCE(value_json, '{"version":1,"assignments":{},"codex":{"modules":{},"routes":{}},"updatedAt":null}'),
  '$.version',
  1,
  '$.codex.modules',
  json_patch(
    '{"daily_event.dashboard":{"model":"gpt-5.5","reasoningEffort":"low"},"daily_event.news":{"model":"gpt-5.5","reasoningEffort":"medium"},"daily_event.timeline":{"model":"gpt-5.5","reasoningEffort":"medium"},"daily_event.ai":{"model":"gpt-5.5","reasoningEffort":"medium"},"daily_event.githubTools":{"model":"gpt-5.5","reasoningEffort":"medium"},"daily_event.trends":{"model":"gpt-5.5","reasoningEffort":"medium"},"sentiment_analysis.dashboard":{"model":"gpt-5.5","reasoningEffort":"low"},"sentiment_analysis.news":{"model":"gpt-5.5","reasoningEffort":"medium"},"sentiment_analysis.ai":{"model":"gpt-5.5","reasoningEffort":"medium"},"sentiment_analysis.trends":{"model":"gpt-5.5","reasoningEffort":"medium"},"agent.chief":{"model":"gpt-5.5","reasoningEffort":"medium"},"agent.env":{"model":"gpt-5.5","reasoningEffort":"medium"},"agent.flow":{"model":"gpt-5.5","reasoningEffort":"medium"},"agent.deriv":{"model":"gpt-5.5","reasoningEffort":"medium"},"agent.risk":{"model":"gpt-5.5","reasoningEffort":"medium"},"overview.advice":{"model":"gpt-5.5","reasoningEffort":"medium"},"premarket.brief":{"model":"gpt-5.5","reasoningEffort":"medium"},"boardroom.meeting":{"model":"gpt-5.5","reasoningEffort":"medium"},"agent.archive":{"model":"gpt-5.5","reasoningEffort":"medium"},"strategy.templates":{"model":"gpt-5.5","reasoningEffort":"medium"},"order.draft":{"model":"gpt-5.5","reasoningEffort":"medium"},"positions.risk":{"model":"gpt-5.5","reasoningEffort":"medium"},"review.journal":{"model":"gpt-5.5","reasoningEffort":"medium"},"review.daily":{"model":"gpt-5.5","reasoningEffort":"medium"},"review.performance":{"model":"gpt-5.5","reasoningEffort":"medium"},"review.patterns":{"model":"gpt-5.5","reasoningEffort":"medium"},"playbook.assistant":{"model":"gpt-5.5","reasoningEffort":"medium"}}',
    COALESCE(
      (
        SELECT json_group_object(key, json_set(CASE WHEN json_valid(value) THEN value ELSE '{}' END, '$.model', 'gpt-5.5'))
        FROM json_each(COALESCE(json_extract(value_json, '$.codex.modules'), '{}'))
      ),
      '{}'
    )
  ),
  '$.codex.routes',
  json_patch(
    '{"daily_event":{"model":"gpt-5.5","reasoningEffort":"high"},"sentiment_analysis":{"model":"gpt-5.5","reasoningEffort":"high"},"overview.advice":{"model":"gpt-5.5","reasoningEffort":"high"},"premarket.brief":{"model":"gpt-5.5","reasoningEffort":"high"},"boardroom.meeting":{"model":"gpt-5.5","reasoningEffort":"high"},"agent.chief":{"model":"gpt-5.5","reasoningEffort":"high"},"agent.env":{"model":"gpt-5.5","reasoningEffort":"high"},"agent.flow":{"model":"gpt-5.5","reasoningEffort":"high"},"agent.deriv":{"model":"gpt-5.5","reasoningEffort":"high"},"agent.risk":{"model":"gpt-5.5","reasoningEffort":"high"},"agent.archive":{"model":"gpt-5.5","reasoningEffort":"high"},"strategy.templates":{"model":"gpt-5.5","reasoningEffort":"high"},"order.draft":{"model":"gpt-5.5","reasoningEffort":"high"},"positions.risk":{"model":"gpt-5.5","reasoningEffort":"high"},"review.journal":{"model":"gpt-5.5","reasoningEffort":"high"},"review.daily":{"model":"gpt-5.5","reasoningEffort":"high"},"review.performance":{"model":"gpt-5.5","reasoningEffort":"high"},"review.patterns":{"model":"gpt-5.5","reasoningEffort":"high"},"playbook.assistant":{"model":"gpt-5.5","reasoningEffort":"high"}}',
    COALESCE(
      (
        SELECT json_group_object(key, json_set(CASE WHEN json_valid(value) THEN value ELSE '{}' END, '$.model', 'gpt-5.5'))
        FROM json_each(COALESCE(json_extract(value_json, '$.codex.routes'), '{}'))
      ),
      '{}'
    )
  ),
  '$.updatedAt',
  CURRENT_TIMESTAMP
)
WHERE key = 'model_channels';

UPDATE yuqing_settings
SET updated_at = CURRENT_TIMESTAMP
WHERE key = 'model_channels';
