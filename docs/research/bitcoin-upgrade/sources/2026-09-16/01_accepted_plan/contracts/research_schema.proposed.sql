-- final-review-1.1: reference DDL only; NOT a production migration.
-- Article content digests may recur (A -> B -> A); observation keys remain unique.
-- DESIGN ONLY. Not a migration applied to the user repository.
-- Each research_*_v2 name is PROPOSED. Confirm real migration order, D1 binding,
-- auth and retention with WP-001/015/049 before any deployment.
-- Reference SQLite syntax. JSON validation, hashes, ownership, transitions and
-- multi-object consistency remain application duties. No existing-table DROP/ALTER.
PRAGMA foreign_keys = ON;

CREATE TABLE research_source_policy_v2 (
  policy_id TEXT NOT NULL,
  version TEXT NOT NULL,
  source_id TEXT NOT NULL,
  reviewed_at TEXT,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(policy_id,version)
);

CREATE TABLE research_instrument_spec_v2 (
  instrument_id TEXT NOT NULL,
  version TEXT NOT NULL,
  venue TEXT NOT NULL,
  venue_symbol TEXT NOT NULL,
  market_type TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(instrument_id,version)
);

CREATE TABLE research_artifact_v2 (
  artifact_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  digest TEXT NOT NULL CHECK(length(digest)=64),
  storage_kind TEXT NOT NULL CHECK(storage_kind IN ('inline','object')),
  storage_locator TEXT NOT NULL,
  payload_inline TEXT,
  byte_length INTEGER NOT NULL CHECK(byte_length>=0),
  policy_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  availability TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  UNIQUE(owner_id,artifact_id)
);

CREATE TABLE research_run_v2 (
  run_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  profile TEXT NOT NULL,
  request_json TEXT NOT NULL,
  status TEXT NOT NULL,
  final_bundle_id TEXT,
  report_id TEXT,
  lease_epoch INTEGER NOT NULL DEFAULT 0,
  lease_until TEXT,
  publication_token TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reason_json TEXT NOT NULL
);

CREATE TABLE research_bundle_v2 (
  bundle_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES research_run_v2(run_id),
  parent_bundle_id TEXT REFERENCES research_bundle_v2(bundle_id),
  digest TEXT NOT NULL CHECK(length(digest)=64),
  market_cutoff_at TEXT NOT NULL,
  knowledge_cutoff_at TEXT NOT NULL,
  as_known_mode TEXT NOT NULL,
  manifest_artifact_id TEXT NOT NULL REFERENCES research_artifact_v2(artifact_id),
  sealed_at TEXT NOT NULL
);

CREATE TABLE research_evidence_v2 (
  bundle_id TEXT NOT NULL REFERENCES research_bundle_v2(bundle_id),
  evidence_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL REFERENCES research_artifact_v2(artifact_id),
  json_pointer TEXT NOT NULL,
  kind TEXT NOT NULL,
  digest TEXT NOT NULL,
  PRIMARY KEY(bundle_id,evidence_id)
);

CREATE TABLE research_observation_v2 (
  observation_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  instrument_id TEXT,
  metric_key TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  published_at TEXT,
  received_at TEXT NOT NULL,
  value_text TEXT,
  unit TEXT NOT NULL,
  vintage TEXT,
  revision_of TEXT REFERENCES research_observation_v2(observation_id),
  artifact_id TEXT NOT NULL REFERENCES research_artifact_v2(artifact_id),
  quality_json TEXT NOT NULL
);

CREATE TABLE research_metric_v2 (
  metric_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  bundle_id TEXT NOT NULL REFERENCES research_bundle_v2(bundle_id),
  method_id TEXT NOT NULL,
  method_version TEXT NOT NULL,
  instrument_id TEXT,
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  value_text TEXT,
  unit TEXT NOT NULL,
  input_digest TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  quality_json TEXT NOT NULL,
  artifact_id TEXT NOT NULL REFERENCES research_artifact_v2(artifact_id)
);

CREATE TABLE research_article_version_v2 (
  article_version_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  published_at TEXT,
  first_seen_at TEXT,
  fetched_at TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  version_observed_at TEXT,
  version_observation_key TEXT NOT NULL,
  source_content_digest TEXT,
  source_revision_id TEXT,
  origin_group_id TEXT,
  artifact_id TEXT REFERENCES research_artifact_v2(artifact_id),
  policy_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  supersedes TEXT REFERENCES research_article_version_v2(article_version_id),
  UNIQUE(owner_id,article_id,version_observation_key)
);

CREATE TABLE research_event_version_v2 (
  version_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  known_at TEXT NOT NULL,
  event_time_start TEXT,
  event_time_end TEXT,
  scheduled_at TEXT,
  status TEXT NOT NULL,
  relevance_band TEXT NOT NULL,
  novelty TEXT NOT NULL,
  priority TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  supersedes TEXT REFERENCES research_event_version_v2(version_id)
);

CREATE TABLE research_event_article_v2 (
  event_version_id TEXT NOT NULL REFERENCES research_event_version_v2(version_id),
  article_version_id TEXT NOT NULL REFERENCES research_article_version_v2(article_version_id),
  relation TEXT NOT NULL,
  PRIMARY KEY(event_version_id,article_version_id)
);

CREATE TABLE research_claim_version_v2 (
  version_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  event_id TEXT,
  known_at TEXT NOT NULL,
  epistemic_type TEXT NOT NULL,
  relation TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE research_event_head_v2 (
  owner_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  version_id TEXT NOT NULL REFERENCES research_event_version_v2(version_id),
  revision INTEGER NOT NULL,
  PRIMARY KEY(owner_id,event_id)
);

CREATE TABLE research_report_v2 (
  report_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES research_run_v2(run_id),
  input_bundle_id TEXT NOT NULL REFERENCES research_bundle_v2(bundle_id),
  artifact_id TEXT NOT NULL REFERENCES research_artifact_v2(artifact_id),
  state TEXT NOT NULL,
  validated_at TEXT NOT NULL,
  validator_version TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  supersedes_report_id TEXT REFERENCES research_report_v2(report_id)
);

CREATE TABLE research_report_preview_v2 (
  owner_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES research_run_v2(run_id),
  step_seq INTEGER NOT NULL,
  preview_json TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(owner_id,run_id)
);

CREATE TABLE research_model_step_v2 (
  step_id TEXT PRIMARY KEY,
  logical_step_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES research_run_v2(run_id),
  attempt INTEGER NOT NULL,
  input_bundle_id TEXT NOT NULL REFERENCES research_bundle_v2(bundle_id),
  input_artifact_id TEXT NOT NULL REFERENCES research_artifact_v2(artifact_id),
  output_artifact_id TEXT REFERENCES research_artifact_v2(artifact_id),
  prompt_version TEXT NOT NULL,
  model_id TEXT NOT NULL,
  tool_config_version TEXT NOT NULL,
  provider_request_id TEXT,
  status TEXT NOT NULL,
  usage_json TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE(run_id,logical_step_id,attempt)
);

CREATE TABLE research_budget_account_v2 (
  owner_id TEXT NOT NULL,
  budget_profile_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  currency TEXT NOT NULL,
  limit_microunits INTEGER,
  reserved_microunits INTEGER NOT NULL DEFAULT 0 CHECK(reserved_microunits>=0),
  settled_microunits INTEGER NOT NULL DEFAULT 0 CHECK(settled_microunits>=0),
  price_version TEXT NOT NULL,
  last_reservation_key TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(owner_id,budget_profile_id,period_key)
);

CREATE TABLE research_budget_ledger_v2 (
  entry_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES research_run_v2(run_id),
  step_id TEXT,
  reservation_key TEXT NOT NULL UNIQUE,
  currency TEXT NOT NULL,
  reserved_microunits INTEGER NOT NULL CHECK(reserved_microunits>=0),
  settled_microunits INTEGER,
  state TEXT NOT NULL CHECK(state IN ('reserved','settled','released','provider_outcome_unknown')),
  price_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE research_view_version_v2 (
  view_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>=1),
  owner_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES research_run_v2(run_id),
  bundle_id TEXT NOT NULL REFERENCES research_bundle_v2(bundle_id),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(view_id,revision)
);

CREATE TABLE research_viewpoint_version_v2 (
  viewpoint_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>=1),
  owner_id TEXT NOT NULL,
  research_view_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(viewpoint_id,revision)
);

CREATE TABLE research_forecast_v2 (
  forecast_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  viewpoint_id TEXT,
  created_at TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  probability REAL CHECK(probability IS NULL OR (probability>=0 AND probability<=1)),
  probability_status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  outcome TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE research_alert_rule_v2 (
  rule_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  owner_id TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),
  payload_json TEXT NOT NULL,
  PRIMARY KEY(rule_id,revision)
);

CREATE TABLE research_alert_episode_v2 (
  episode_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  rule_revision INTEGER NOT NULL,
  state TEXT NOT NULL,
  data_state TEXT NOT NULL,
  last_window_end_at TEXT NOT NULL,
  revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY(rule_id,rule_revision) REFERENCES research_alert_rule_v2(rule_id,revision)
);

CREATE TABLE research_outbox_v2 (
  message_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  episode_id TEXT NOT NULL REFERENCES research_alert_episode_v2(episode_id),
  channel TEXT NOT NULL,
  dedup_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  payload_json TEXT NOT NULL
);

CREATE TABLE research_idempotency_v2 (
  owner_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  result_ref TEXT,
  state TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(owner_id,operation,idempotency_key)
);

CREATE TABLE research_legacy_link_v2 (
  owner_id TEXT NOT NULL,
  legacy_kind TEXT NOT NULL,
  legacy_id TEXT NOT NULL,
  target_kind TEXT,
  target_id TEXT,
  restore_level TEXT NOT NULL,
  note TEXT NOT NULL,
  PRIMARY KEY(owner_id,legacy_kind,legacy_id)
);

CREATE TABLE research_audit_event_v2 (
  audit_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  action TEXT NOT NULL,
  object_kind TEXT NOT NULL,
  object_id TEXT NOT NULL,
  event_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL
);

CREATE TABLE research_study_v2 (
  study_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  config_digest TEXT NOT NULL,
  config_artifact_id TEXT NOT NULL REFERENCES research_artifact_v2(artifact_id),
  result_artifact_id TEXT REFERENCES research_artifact_v2(artifact_id),
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE research_evaluation_v2 (
  evaluation_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  dataset_version TEXT NOT NULL,
  system_version TEXT NOT NULL,
  config_digest TEXT NOT NULL,
  result_artifact_id TEXT NOT NULL REFERENCES research_artifact_v2(artifact_id),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL
);
CREATE INDEX research_run_lookup_v2 ON research_run_v2(owner_id, created_at);
CREATE INDEX research_observation_lookup_v2 ON research_observation_v2(source_id, metric_key, observed_at, received_at);
CREATE INDEX research_metric_lookup_v2 ON research_metric_v2(bundle_id, method_id, instrument_id);
CREATE INDEX research_article_version_lookup_v2 ON research_article_version_v2(owner_id, article_id, fetched_at);
CREATE INDEX research_event_version_lookup_v2 ON research_event_version_v2(owner_id, known_at, event_id);
CREATE INDEX research_claim_version_lookup_v2 ON research_claim_version_v2(owner_id, claim_id, known_at);
CREATE INDEX research_report_lookup_v2 ON research_report_v2(owner_id, validated_at);
CREATE INDEX research_artifact_lookup_v2 ON research_artifact_v2(owner_id, expires_at, availability);
CREATE INDEX research_model_step_lookup_v2 ON research_model_step_v2(run_id, created_at);
CREATE INDEX research_forecast_lookup_v2 ON research_forecast_v2(owner_id, outcome, deadline_at);
CREATE INDEX research_audit_event_lookup_v2 ON research_audit_event_v2(owner_id, event_at);
CREATE INDEX research_outbox_lookup_v2 ON research_outbox_v2(state, next_attempt_at);

CREATE TABLE research_review_v2 (
 review_id TEXT PRIMARY KEY,
 owner_id TEXT NOT NULL,
 viewpoint_id TEXT NOT NULL,
 viewpoint_revision INTEGER NOT NULL,
 run_id TEXT NOT NULL REFERENCES research_run_v2(run_id),
 result_bundle_id TEXT NOT NULL REFERENCES research_bundle_v2(bundle_id),
 artifact_id TEXT NOT NULL REFERENCES research_artifact_v2(artifact_id),
 assessment TEXT NOT NULL,
 created_at TEXT NOT NULL,
 FOREIGN KEY(viewpoint_id,viewpoint_revision) REFERENCES research_viewpoint_version_v2(viewpoint_id,revision)
);
CREATE INDEX research_review_lookup_v2 ON research_review_v2(owner_id,viewpoint_id,created_at);
