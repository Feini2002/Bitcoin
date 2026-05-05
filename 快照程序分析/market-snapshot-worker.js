import {
  buildAgentInputs,
  buildChartSnapshot,
  buildDerivativesSnapshot,
  buildHeatmapSnapshot,
  buildMarketDeskSnapshot,
  buildOrderflowSnapshot,
  PROGRAM_VERSION,
} from "./marketSnapshotProgram.mjs";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Bitdesk-Snapshot-Token",
  "Access-Control-Max-Age": "86400",
};

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS_HEADERS,
      ...headers,
    },
  });
}

function parseUrlOptions(url) {
  return {
    symbol: String(url.searchParams.get("symbol") || "BTCUSDT").toUpperCase(),
    profile: String(url.searchParams.get("profile") || "current"),
  };
}

function generatedAtMs(payload) {
  const t = Date.parse(payload && payload.generatedAt ? payload.generatedAt : "");
  return Number.isFinite(t) ? t : Date.now();
}

function makeRunId(now = Date.now()) {
  const rnd = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `msnap_${now}_${rnd}`;
}

async function d1All(db, sql, params = []) {
  const stmt = params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
  const res = await stmt.all();
  return Array.isArray(res && res.results) ? res.results : [];
}

async function d1First(db, sql, params = []) {
  const stmt = params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
  return await stmt.first();
}

async function d1Run(db, sql, params = []) {
  const stmt = params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
  return await stmt.run();
}

function requireSnapshotDb(env) {
  if (!env || !env.SNAPSHOT_DB || typeof env.SNAPSHOT_DB.prepare !== "function") {
    throw new Error("SNAPSHOT_DB binding missing");
  }
  return env.SNAPSHOT_DB;
}

function validateWriteToken(request, env) {
  const expected = env && env.SNAPSHOT_WRITE_TOKEN ? String(env.SNAPSHOT_WRITE_TOKEN) : "";
  if (!expected) return { ok: false, status: 500, error: "SNAPSHOT_WRITE_TOKEN secret missing" };
  const got = request.headers.get("X-Bitdesk-Snapshot-Token") || "";
  if (got !== expected) return { ok: false, status: 401, error: "invalid snapshot token" };
  return { ok: true };
}

async function health(env) {
  const checks = {
    worker: true,
    programVersion: PROGRAM_VERSION,
    btcDb: false,
    snapshotDb: false,
  };
  if (env && env.BTC_DB) {
    try {
      await d1First(env.BTC_DB, "SELECT 1 AS ok");
      checks.btcDb = true;
    } catch (err) {
      checks.btcDbError = err && err.message ? err.message : String(err);
    }
  }
  if (env && env.SNAPSHOT_DB) {
    try {
      await d1First(env.SNAPSHOT_DB, "SELECT 1 AS ok");
      checks.snapshotDb = true;
    } catch (err) {
      checks.snapshotDbError = err && err.message ? err.message : String(err);
    }
  }
  return checks;
}

async function storeMarketDeskSnapshot(env, desk, opts = {}) {
  const db = requireSnapshotDb(env);
  const runId = desk.runId || opts.runId || makeRunId();
  const startedAt = Number(opts.startedAtMs) || Date.now();
  const endedAt = Date.now();
  const genMs = generatedAtMs(desk);
  const symbol = desk.symbol || "BTCUSDT";
  const pageScopes = Object.keys(desk.pages || {});
  const agentInputs = desk.agentInputs && Object.keys(desk.agentInputs).length
    ? desk.agentInputs
    : buildAgentInputs({ ...desk, runId });
  const agentIds = Object.keys(agentInputs);
  const errors = Object.values(desk.pages || {})
    .filter((page) => page && page.error)
    .map((page) => ({ scope: page.scope, error: page.error }));

  await d1Run(
    db,
    "INSERT OR REPLACE INTO snapshot_runs (run_id, symbol, profile, status, started_at_ms, ended_at_ms, generated_at_ms, page_scopes_json, agent_ids_json, error_json, extra_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
    [
      runId,
      symbol,
      opts.profile || "current",
      errors.length ? "completed_with_warnings" : "completed",
      startedAt,
      endedAt,
      genMs,
      JSON.stringify(pageScopes),
      JSON.stringify(agentIds),
      JSON.stringify(errors),
      JSON.stringify({ programVersion: PROGRAM_VERSION }),
    ],
  );

  const scopes = { ...(desk.pages || {}), "market-desk": { ...desk, agentInputs: undefined } };
  for (const [scope, payload] of Object.entries(scopes)) {
    await d1Run(
      db,
      "INSERT OR REPLACE INTO market_snapshots (run_id, scope, symbol, snapshot_version, generated_at_ms, payload_json, data_freshness_json, llm_brief, source_fingerprint, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
      [
        runId,
        scope,
        symbol,
        payload.snapshotVersion || desk.snapshotVersion || PROGRAM_VERSION,
        genMs,
        JSON.stringify({ ...payload, runId }),
        JSON.stringify(payload.dataFreshness || {}),
        payload.llmBrief || "",
        payload.sourceFingerprint || desk.sourceFingerprint || "",
        endedAt,
      ],
    );
  }

  for (const [agentId, input] of Object.entries(agentInputs)) {
    await d1Run(
      db,
      "INSERT OR REPLACE INTO agent_snapshot_inputs (run_id, agent_id, symbol, generated_at_ms, source_pages_json, input_json, data_freshness_json, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
      [
        runId,
        agentId,
        symbol,
        genMs,
        JSON.stringify(input.sourcePages || []),
        JSON.stringify({ ...input, runId }),
        JSON.stringify(input.dataFreshness || {}),
        endedAt,
      ],
    );
  }

  await cleanupOldRows(db, endedAt);
  return { runId, pageScopes, agentIds, status: errors.length ? "completed_with_warnings" : "completed" };
}

async function cleanupOldRows(db, now) {
  const cutoff = now - 30 * 24 * 60 * 60 * 1000;
  await d1Run(db, "DELETE FROM agent_snapshot_inputs WHERE generated_at_ms < ?1", [cutoff]).catch(() => {});
  await d1Run(db, "DELETE FROM market_snapshots WHERE generated_at_ms < ?1", [cutoff]).catch(() => {});
  await d1Run(db, "DELETE FROM snapshot_runs WHERE generated_at_ms < ?1", [cutoff]).catch(() => {});
  const oldRuns = await d1All(
    db,
    "SELECT run_id FROM snapshot_runs ORDER BY generated_at_ms DESC LIMIT -1 OFFSET 500",
    [],
  ).catch(() => []);
  for (const row of oldRuns) {
    if (!row || !row.run_id) continue;
    await d1Run(db, "DELETE FROM agent_snapshot_inputs WHERE run_id = ?1", [row.run_id]).catch(() => {});
    await d1Run(db, "DELETE FROM market_snapshots WHERE run_id = ?1", [row.run_id]).catch(() => {});
    await d1Run(db, "DELETE FROM snapshot_runs WHERE run_id = ?1", [row.run_id]).catch(() => {});
  }
}

function parseJson(text, fallback = null) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch (_) {
    return fallback;
  }
}

async function latestSnapshot(env, scope) {
  const db = requireSnapshotDb(env);
  const row = await d1First(
    db,
    "SELECT run_id, scope, symbol, snapshot_version, generated_at_ms, payload_json, data_freshness_json, llm_brief, source_fingerprint FROM market_snapshots WHERE scope = ?1 ORDER BY generated_at_ms DESC LIMIT 1",
    [scope || "market-desk"],
  );
  if (!row) return null;
  return {
    runId: row.run_id,
    scope: row.scope,
    symbol: row.symbol,
    snapshotVersion: row.snapshot_version,
    generatedAt: new Date(Number(row.generated_at_ms)).toISOString(),
    payload: parseJson(row.payload_json, {}),
    dataFreshness: parseJson(row.data_freshness_json, {}),
    llmBrief: row.llm_brief || "",
    sourceFingerprint: row.source_fingerprint || "",
  };
}

async function latestAgentInput(env, agentId) {
  const db = requireSnapshotDb(env);
  const row = await d1First(
    db,
    "SELECT run_id, agent_id, symbol, generated_at_ms, source_pages_json, input_json, data_freshness_json FROM agent_snapshot_inputs WHERE agent_id = ?1 ORDER BY generated_at_ms DESC LIMIT 1",
    [agentId],
  );
  if (!row) return null;
  return {
    runId: row.run_id,
    agentId: row.agent_id,
    symbol: row.symbol,
    generatedAt: new Date(Number(row.generated_at_ms)).toISOString(),
    sourcePages: parseJson(row.source_pages_json, []),
    input: parseJson(row.input_json, {}),
    dataFreshness: parseJson(row.data_freshness_json, {}),
  };
}

async function snapshotRun(env, runId) {
  const db = requireSnapshotDb(env);
  const run = await d1First("prepare" in db ? db : env.SNAPSHOT_DB, "SELECT * FROM snapshot_runs WHERE run_id = ?1", [runId]);
  if (!run) return null;
  const scopes = await d1All(
    db,
    "SELECT scope, snapshot_version, generated_at_ms, llm_brief, source_fingerprint FROM market_snapshots WHERE run_id = ?1 ORDER BY scope ASC",
    [runId],
  );
  const agents = await d1All(
    db,
    "SELECT agent_id, source_pages_json, generated_at_ms FROM agent_snapshot_inputs WHERE run_id = ?1 ORDER BY agent_id ASC",
    [runId],
  );
  return {
    runId: run.run_id,
    symbol: run.symbol,
    profile: run.profile,
    status: run.status,
    generatedAt: new Date(Number(run.generated_at_ms)).toISOString(),
    pageScopes: parseJson(run.page_scopes_json, []),
    agentIds: parseJson(run.agent_ids_json, []),
    errors: parseJson(run.error_json, []),
    snapshots: scopes,
    agents: agents.map((row) => ({
      agentId: row.agent_id,
      sourcePages: parseJson(row.source_pages_json, []),
      generatedAt: new Date(Number(row.generated_at_ms)).toISOString(),
    })),
  };
}

async function routeGet(path, env, url) {
  const options = parseUrlOptions(url);
  if (path === "/api/ai/health") return json(await health(env));
  if (path === "/api/ai/chart-snapshot") return json(await buildChartSnapshot(env, options));
  if (path === "/api/ai/orderflow-snapshot") return json(await buildOrderflowSnapshot(env, options));
  if (path === "/api/ai/heatmap-snapshot") return json(await buildHeatmapSnapshot(env, options));
  if (path === "/api/ai/derivatives-snapshot") return json(await buildDerivativesSnapshot(env, options));
  if (path === "/api/ai/market-desk-snapshot") return json(await buildMarketDeskSnapshot(env, options));
  if (path === "/api/ai/snapshot/latest") {
    const scope = String(url.searchParams.get("scope") || "market-desk");
    const row = await latestSnapshot(env, scope);
    return row ? json({ ok: true, ...row }) : json({ ok: false, error: "snapshot not found", scope }, 404);
  }
  if (path === "/api/ai/agent-input/latest") {
    const agent = String(url.searchParams.get("agent") || "");
    const row = await latestAgentInput(env, agent);
    return row ? json({ ok: true, ...row }) : json({ ok: false, error: "agent input not found", agent }, 404);
  }
  if (path === "/api/ai/snapshot-run") {
    const runId = String(url.searchParams.get("runId") || "");
    const row = runId ? await snapshotRun(env, runId) : null;
    return row ? json({ ok: true, ...row }) : json({ ok: false, error: "snapshot run not found", runId }, 404);
  }
  return json({ ok: false, error: "Not found" }, 404);
}

async function routePost(path, request, env, url) {
  if (path !== "/api/ai/market-desk-snapshot") return json({ ok: false, error: "Not found" }, 404);
  const token = validateWriteToken(request, env);
  if (!token.ok) return json({ ok: false, error: token.error }, token.status);
  const startedAtMs = Date.now();
  const options = parseUrlOptions(url);
  const runId = makeRunId(startedAtMs);
  const desk = await buildMarketDeskSnapshot(env, { ...options, runId, nowMs: startedAtMs });
  const stored = await storeMarketDeskSnapshot(env, desk, { runId, startedAtMs, profile: options.profile });
  return json({ ok: true, ...stored, snapshot: { runId, scope: desk.scope, generatedAt: desk.generatedAt, dataFreshness: desk.dataFreshness } });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
    const url = new URL(request.url);
    try {
      if (request.method === "GET" || request.method === "HEAD") return await routeGet(url.pathname, env, url);
      if (request.method === "POST") return await routePost(url.pathname, request, env, url);
      return json({ ok: false, error: "Method Not Allowed" }, 405);
    } catch (err) {
      return json({ ok: false, error: err && err.message ? err.message : String(err) }, 500);
    }
  },
};
