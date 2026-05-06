-- 舆情 Worker 模块与全局设置表
-- npx wrangler d1 execute yuqing --remote --file=cloudflare/migrations/yuqing/0003_event_dashboard_settings.sql

CREATE TABLE IF NOT EXISTS yuqing_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 初始化事件一览仪表盘默认设置
INSERT OR IGNORE INTO yuqing_settings (key, value_json)
VALUES (
  'event_dashboard',
  '{"visibility":{"dashboard":true,"news":true,"timeline":true,"ai":true,"trends":true},"scanCoverage":{"dashboard":true,"news":true,"timeline":true,"ai":true,"trends":true}}'
);
