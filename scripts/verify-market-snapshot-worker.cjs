const path = require("path");
const { pathToFileURL } = require("url");
const {
  FakeSnapshotD1,
  FakeSourceD1,
  assertOk,
  createRows,
} = require("./market-snapshot-test-utils.cjs");

async function readJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`invalid JSON ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function main() {
  const root = path.join(__dirname, "..");
  const worker = (await import(pathToFileURL(path.join(root, "快照程序分析", "market-snapshot-worker.js")).href)).default;
  const now = Date.UTC(2026, 4, 4, 8, 0, 0);
  const env = {
    BTC_DB: new FakeSourceD1(createRows(now)),
    SNAPSHOT_DB: new FakeSnapshotD1(),
    SNAPSHOT_WRITE_TOKEN: "local-token",
  };

  let res = await worker.fetch(new Request("https://snapshot.local/api/ai/health"), env, {});
  let body = await readJson(res);
  assertOk(res.status === 200 && body.btcDb && body.snapshotDb, "health sees both D1 bindings");

  res = await worker.fetch(new Request("https://snapshot.local/api/ai/market-desk-snapshot"), env, {});
  body = await readJson(res);
  assertOk(res.status === 200 && body.scope === "market-desk", "GET market desk preview");
  assertOk(env.SNAPSHOT_DB.snapshot_runs.length === 0, "GET preview does not write snapshot db");

  res = await worker.fetch(new Request("https://snapshot.local/api/ai/market-desk-snapshot", {
    method: "POST",
    headers: { "X-Bitdesk-Snapshot-Token": "bad-token" },
  }), env, {});
  body = await readJson(res);
  assertOk(res.status === 401 && body.error, "POST rejects bad token");

  res = await worker.fetch(new Request("https://snapshot.local/api/ai/market-desk-snapshot", {
    method: "POST",
    headers: { "X-Bitdesk-Snapshot-Token": "local-token" },
  }), env, {});
  body = await readJson(res);
  assertOk(res.status === 200 && body.ok && body.runId, "POST stores market desk snapshot");
  const runId = body.runId;
  assertOk(env.SNAPSHOT_DB.snapshot_runs.length === 1, "snapshot run stored");
  assertOk(env.SNAPSHOT_DB.market_snapshots.length === 5, "four pages plus market desk stored");
  assertOk(env.SNAPSHOT_DB.agent_snapshot_inputs.length === 5, "five agent inputs stored");

  res = await worker.fetch(new Request("https://snapshot.local/api/ai/snapshot/latest?scope=market-desk"), env, {});
  body = await readJson(res);
  assertOk(res.status === 200 && body.runId === runId && body.payload.scope === "market-desk", "latest market desk returns stored run");

  for (const agent of ["env", "flow", "deriv", "risk", "chief"]) {
    res = await worker.fetch(new Request(`https://snapshot.local/api/ai/agent-input/latest?agent=${agent}`), env, {});
    body = await readJson(res);
    assertOk(res.status === 200 && body.runId === runId && body.agentId === agent, `latest agent input ${agent}`);
    assertOk(Array.isArray(body.sourcePages) && body.sourcePages.length > 0, `agent ${agent} source pages`);
  }

  res = await worker.fetch(new Request(`https://snapshot.local/api/ai/snapshot-run?runId=${encodeURIComponent(runId)}`), env, {});
  body = await readJson(res);
  assertOk(res.status === 200 && body.runId === runId, "snapshot run lookup");
  assertOk(body.snapshots.length === 5 && body.agents.length === 5, "snapshot run index complete");

  console.log("OK market snapshot worker");
}

main().catch((err) => {
  console.error("FAIL market snapshot worker:", err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
