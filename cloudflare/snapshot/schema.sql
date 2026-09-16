CREATE TABLE IF NOT EXISTS snapshot_runs (
  run_id          TEXT PRIMARY KEY NOT NULL,
  symbol          TEXT NOT NULL,
  profile         TEXT NOT NULL DEFAULT 'current',
  status          TEXT NOT NULL,
  started_at_ms   INTEGER NOT NULL,
  ended_at_ms     INTEGER,
  generated_at_ms INTEGER NOT NULL,
  page_scopes_json TEXT NOT NULL DEFAULT '[]',
  agent_ids_json   TEXT NOT NULL DEFAULT '[]',
  error_json       TEXT NOT NULL DEFAULT '[]',
  extra_json       TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_snapshot_runs_generated
  ON snapshot_runs (generated_at_ms DESC);

CREATE TABLE IF NOT EXISTS market_snapshots (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id               TEXT NOT NULL,
  scope                TEXT NOT NULL,
  symbol               TEXT NOT NULL,
  snapshot_version     TEXT NOT NULL,
  generated_at_ms      INTEGER NOT NULL,
  payload_json         TEXT NOT NULL,
  data_freshness_json  TEXT NOT NULL DEFAULT '{}',
  llm_brief            TEXT NOT NULL DEFAULT '',
  source_fingerprint   TEXT NOT NULL DEFAULT '',
  created_at_ms        INTEGER NOT NULL,
  UNIQUE(run_id, scope)
);

CREATE INDEX IF NOT EXISTS idx_market_snapshots_scope_generated
  ON market_snapshots (scope, generated_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_market_snapshots_run
  ON market_snapshots (run_id);

CREATE TABLE IF NOT EXISTS agent_snapshot_inputs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id              TEXT NOT NULL,
  agent_id            TEXT NOT NULL,
  symbol              TEXT NOT NULL,
  generated_at_ms     INTEGER NOT NULL,
  source_pages_json   TEXT NOT NULL DEFAULT '[]',
  input_json          TEXT NOT NULL,
  data_freshness_json TEXT NOT NULL DEFAULT '{}',
  created_at_ms       INTEGER NOT NULL,
  UNIQUE(run_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_inputs_agent_generated
  ON agent_snapshot_inputs (agent_id, generated_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_agent_inputs_run
  ON agent_snapshot_inputs (run_id);
