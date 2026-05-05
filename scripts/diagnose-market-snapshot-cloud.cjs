/**
 * Remote smoke diagnostic for the market snapshot Worker.
 *
 * Usage:
 *   $env:SNAPSHOT_WRITE_TOKEN="..."
 *   node scripts/diagnose-market-snapshot-cloud.cjs https://<你的 market-snapshot Worker>
 */

const BASE = String(process.argv[2] || process.env.MARKET_SNAPSHOT_BASE || "").replace(/\/$/, "");
const TOKEN = process.env.SNAPSHOT_WRITE_TOKEN || "";

if (!BASE) {
  console.error("Usage: node scripts/diagnose-market-snapshot-cloud.cjs <worker-url>");
  process.exit(2);
}

async function fetchJson(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    cache: "no-store",
    ...options,
    headers: {
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (_) {}
  if (!res.ok) {
    throw new Error(`${path} HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  return data;
}

async function main() {
  console.log(`Market snapshot diagnose -> ${BASE}`);
  const health = await fetchJson("/api/ai/health");
  console.log("health", JSON.stringify({
    btcDb: health.btcDb,
    snapshotDb: health.snapshotDb,
    programVersion: health.programVersion,
  }));
  if (!health.btcDb || !health.snapshotDb) throw new Error("D1 health check failed");

  const preview = await fetchJson("/api/ai/market-desk-snapshot");
  console.log("preview", JSON.stringify({
    scope: preview.scope,
    pages: Object.keys(preview.pages || {}),
    sourceOk: preview.dataFreshness && preview.dataFreshness.sourceOk,
  }));
  if (!preview.pages || Object.keys(preview.pages).length !== 4) throw new Error("preview missing market pages");

  if (!TOKEN) throw new Error("SNAPSHOT_WRITE_TOKEN env var is required for remote POST write test");
  const stored = await fetchJson("/api/ai/market-desk-snapshot", {
    method: "POST",
    headers: { "X-Bitdesk-Snapshot-Token": TOKEN },
  });
  console.log("stored", JSON.stringify({
    runId: stored.runId,
    pageScopes: stored.pageScopes,
    agentIds: stored.agentIds,
  }));
  if (!stored.runId) throw new Error("POST did not return runId");

  const latest = await fetchJson("/api/ai/snapshot/latest?scope=market-desk");
  if (latest.runId !== stored.runId) throw new Error(`latest run mismatch ${latest.runId} != ${stored.runId}`);
  console.log("latest market-desk OK", latest.runId);

  for (const agent of ["env", "flow", "deriv", "risk", "chief"]) {
    const input = await fetchJson(`/api/ai/agent-input/latest?agent=${agent}`);
    if (input.runId !== stored.runId) throw new Error(`${agent} run mismatch ${input.runId} != ${stored.runId}`);
    if (!Array.isArray(input.sourcePages) || !input.sourcePages.length) throw new Error(`${agent} sourcePages empty`);
    console.log(`agent ${agent} OK`, input.sourcePages.join(","));
  }

  const run = await fetchJson(`/api/ai/snapshot-run?runId=${encodeURIComponent(stored.runId)}`);
  if (!Array.isArray(run.snapshots) || run.snapshots.length !== 5) throw new Error("snapshot-run missing snapshots");
  if (!Array.isArray(run.agents) || run.agents.length !== 5) throw new Error("snapshot-run missing agent inputs");
  console.log("snapshot-run OK", stored.runId);
}

main().catch((err) => {
  console.error("FAIL market snapshot cloud diagnose:", err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
