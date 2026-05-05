const path = require("path");
const { pathToFileURL } = require("url");
const {
  FakeSourceD1,
  assertOk,
  createRows,
} = require("./market-snapshot-test-utils.cjs");

async function main() {
  const root = path.join(__dirname, "..");
  const mod = await import(pathToFileURL(path.join(root, "快照程序分析", "marketSnapshotProgram.mjs")).href);
  const now = Date.UTC(2026, 4, 4, 8, 0, 0);
  const env = { BTC_DB: new FakeSourceD1(createRows(now)) };

  const chart = await mod.buildChartSnapshot(env, { nowMs: now });
  assertOk(chart.scope === "chart", "chart snapshot scope");
  assertOk(chart.snapshotVersion === "chart-unified-1.1.0", "chart snapshot version");
  assertOk(chart.currentView && chart.currentView.latestClose > 0, "chart latest close available");
  assertOk(Array.isArray(chart.multiTimeframeSummary) && chart.multiTimeframeSummary.length >= 4, "chart MTF summary available");
  assertOk(chart.chartStructureForLlm && chart.chartStructureForLlm.rawFactEnvelope && chart.chartStructureForLlm.rawFactEnvelope.tier === "raw_fact", "chart llm rawFactEnvelope");
  const der = chart.chartStructureForLlm && chart.chartStructureForLlm.derivedStructureHeuristic;
  assertOk(der && der.tier === "derived_heuristic" && der.algorithmVersion && Array.isArray(der.integrityFlags), "chart llm derived");
  assertOk(chart.currentView.tier === "raw_fact", "currentView tier labeled");

  const orderflow = await mod.buildOrderflowSnapshot(env, { nowMs: now });
  assertOk(orderflow.scope === "orderflow", "orderflow snapshot scope");
  assertOk(orderflow.currentDashboard && orderflow.currentDashboard.cards.length >= 2, "orderflow dashboard cards available");

  const heatmap = await mod.buildHeatmapSnapshot(env, { nowMs: now });
  assertOk(heatmap.scope === "heatmap", "heatmap snapshot scope");
  assertOk(heatmap.analysisMatrix.rows.some((row) => row.window === "1h"), "heatmap 1h window available");

  const derivatives = await mod.buildDerivativesSnapshot(env, { nowMs: now });
  assertOk(derivatives.scope === "derivatives", "derivatives snapshot scope");
  assertOk(derivatives.analysisMatrix.description === "衍生品六项矩阵", "derivatives matrix description");
  assertOk(derivatives.analysisMatrix.rows.length === 6, "derivatives six-row matrix");

  const desk = await mod.buildMarketDeskSnapshot(env, { nowMs: now, runId: "test-run" });
  assertOk(desk.scope === "market-desk", "market desk scope");
  assertOk(Object.keys(desk.pages).length === 4, "market desk includes four pages");
  assertOk(desk.agentInputs.env.llmDataContract && desk.agentInputs.env.llmDataContract.version === "1.0.0", "agent llmDataContract");
  assertOk(desk.agentInputs.env.inputVersion === "agent-input-1.1.0", "agent input version");
  assertOk(desk.agentInputs.env.sourcePages.includes("chart"), "env input receives chart");
  assertOk(desk.agentInputs.flow.sourcePages.includes("orderflow") && desk.agentInputs.flow.sourcePages.includes("heatmap"), "flow input receives orderflow and heatmap");
  assertOk(desk.agentInputs.deriv.sourcePages.includes("derivatives"), "deriv input receives derivatives");
  assertOk(desk.agentInputs.risk.sourcePages.length === 1 && desk.agentInputs.risk.sourcePages[0] === "heatmap", "risk input limited to heatmap");
  assertOk(desk.agentInputs.chief.sourcePages.length === 4, "chief input receives all market pages");
  assertOk(!JSON.stringify(desk).includes("levels_json"), "desk snapshot does not expose raw footprint levels");

  console.log("OK market snapshot program");
}

main().catch((err) => {
  console.error("FAIL market snapshot program:", err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
