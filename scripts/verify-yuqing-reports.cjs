const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const workerPath = path.join(ROOT, "cloudflare", "yuqing", "yuqing-worker.js");
const migrationPath = path.join(ROOT, "cloudflare", "migrations", "yuqing", "0002_reports.sql");
const modelMigrationPath = path.join(ROOT, "cloudflare", "migrations", "yuqing", "0004_model_channels.sql");
const wranglerPath = path.join(ROOT, "cloudflare", "wrangler.yuqing.toml");
const dataEnginePath = path.join(ROOT, "js", "data-engine.js");
const eventsPagePath = path.join(ROOT, "js", "pages", "events.js");
const shijianIndexPath = path.join(ROOT, "cloudflare", "yuqing", "shijian", "index.js");
const githubToolsPath = path.join(ROOT, "cloudflare", "yuqing", "shijian", "github-tools.js");
const temperaturePath = path.join(ROOT, "cloudflare", "yuqing", "shijian", "temperature.js");
const trendCluesPath = path.join(ROOT, "cloudflare", "yuqing", "shijian", "trend-clues.js");

function assertOk(cond, label, detail = "") {
  if (!cond) {
    throw new Error(`${label}${detail ? `: ${detail}` : ""}`);
  }
  console.log(`OK yuqing ${label}`);
}

function stripYuqingWorkerImports(src) {
  let prev = "";
  while (prev !== src) {
    prev = src;
    src = src.replace(/^\s*import\s+[\s\S]*?from\s+["'][^"']+["']\s*;?\s*/m, "");
  }
  return src;
}

function loadWorkerContext() {
  let src = fs.readFileSync(workerPath, "utf8");
  src = stripYuqingWorkerImports(src);
  src = src.replace(/\bexport\s+default\s*\{/, "const __yuqingWorkerDefault = {");
  const context = {
    console,
    Date,
    Intl,
    URL,
    URLSearchParams,
    TextEncoder,
    crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000000" },
    setTimeout,
    clearTimeout,
    Response,
    Request,
    caches: { default: { match: async () => null, put: async () => null } },
  };
  vm.createContext(context);
  new vm.Script(src, { filename: "cloudflare/yuqing/yuqing-worker.js" }).runInContext(context);
  return context;
}

const worker = fs.readFileSync(workerPath, "utf8");
const migration = fs.readFileSync(migrationPath, "utf8");
const modelMigration = fs.readFileSync(modelMigrationPath, "utf8");
const wrangler = fs.readFileSync(wranglerPath, "utf8");
const dataEngine = fs.readFileSync(dataEnginePath, "utf8");
const eventsPage = fs.readFileSync(eventsPagePath, "utf8");
const shijianIndex = fs.readFileSync(shijianIndexPath, "utf8");
const githubTools = fs.readFileSync(githubToolsPath, "utf8");
const temperature = fs.readFileSync(temperaturePath, "utf8");
const trendClues = fs.readFileSync(trendCluesPath, "utf8");
const ctx = loadWorkerContext();

assertOk(/CREATE TABLE IF NOT EXISTS yuqing_reports/.test(migration), "migration creates yuqing_reports");
assertOk(/model_channels/.test(modelMigration) && /yuqing_settings/.test(modelMigration), "model channel migration seeds yuqing_settings");
for (const field of [
  "kind",
  "report_date",
  "slot",
  "trigger_type",
  "generated_at",
  "status",
  "source_refs_json",
  "grounding_json",
  "market_snapshot_json",
  "report_json",
  "source_errors_json",
]) {
  assertOk(new RegExp(`\\b${field}\\b`).test(migration), `migration has ${field}`);
}

assertOk(/crons\s*=\s*\["0 0,1,4,6,12,14,16 \* \* \*"\]/.test(wrangler), "wrangler cron covers BJT report slots");

const dueDaily = ctx.scheduledKindsForDate(new Date("2026-05-05T00:00:00+08:00").getTime());
assertOk(dueDaily.length === 1 && dueDaily[0].kind === "daily_event" && dueDaily[0].slot === "00", "BJT 00:00 maps to daily_event 00");
const dueNoon = ctx.scheduledKindsForDate(new Date("2026-05-05T12:00:00+08:00").getTime());
assertOk(dueNoon.length === 1 && dueNoon[0].kind === "daily_event" && dueNoon[0].slot === "12", "BJT 12:00 maps to daily_event 12");
const dueAnalysis = ctx.scheduledKindsForDate(new Date("2026-05-05T22:00:00+08:00").getTime());
assertOk(dueAnalysis.length === 1 && dueAnalysis[0].kind === "sentiment_analysis" && dueAnalysis[0].slot === "22", "BJT 22:00 maps to sentiment_analysis 22");
assertOk(ctx.bjtDateKey(new Date("2026-05-05T00:00:00+08:00").getTime()) === "2026-05-05", "BJT 00:00 belongs to new natural day");

const incMissingDaily = ctx.shouldUseIncrementalSearch({
  dailyReport: null,
  factCount: 30,
  marketErrors: [],
});
assertOk(incMissingDaily.useSearch && incMissingDaily.reasons.includes("事件日报缺失"), "missing daily triggers incremental search");
const incClean = ctx.shouldUseIncrementalSearch({
  dailyReport: { id: "daily" },
  dailyAgeMs: 30 * 60 * 1000,
  factCount: 30,
  marketErrors: [],
});
assertOk(!incClean.useSearch, "fresh daily and enough facts skip incremental search");
const incMarket = ctx.shouldUseIncrementalSearch({
  dailyReport: { id: "daily" },
  dailyAgeMs: 30 * 60 * 1000,
  factCount: 30,
  marketErrors: [{ source: "klines", message: "fail" }],
});
assertOk(incMarket.useSearch && incMarket.reasons.includes("市场快照存在缺口"), "market snapshot error triggers incremental search");

const hourlyPoints = Array.from({ length: 193 }, (_, i) => ({ t: i * 3600 * 1000, close: 100 + i }));
const moves = ctx.movesFromChartPoints(hourlyPoints);
assertOk(moves.h24 === 8.9552, "asset move computes 24h from hourly closes");
assertOk(moves.d3 === 32.7273, "asset move computes 3d from hourly closes");
assertOk(moves.d7 === 135.4839, "asset move computes 7d from hourly closes");

const decoded = ctx.decodeReportRow({
  id: "r1",
  kind: "daily_event",
  report_date: "2026-05-05",
  slot: "08",
  trigger_type: "manual",
  generated_at: "2026-05-05T00:00:00Z",
  status: "ready",
  source_refs_json: '[{"label":"行情工作台","href":"#/chart"}]',
  grounding_json: '{"quality":{"factCount":2}}',
  market_snapshot_json: "{}",
  report_json: '{"title":"赛博前哨站"}',
  source_errors_json: "[]",
});
assertOk(decoded && decoded.quality.factCount === 2 && decoded.sourceRefs[0].href === "#/chart", "decode report row contract");

assertOk(worker.includes("request.method === \"DELETE\"") && worker.includes("reports_delete"), "worker handles DELETE reports/item");
assertOk(/DELETE FROM yuqing_reports WHERE id = \?/.test(worker), "worker deletes report by primary id");

for (const route of [
  "/api/yuqing/reports/latest",
  "/api/yuqing/reports/history",
  "/api/yuqing/reports/item",
  "/api/yuqing/reports/generate",
  "/api/yuqing/reports/generate-stream",
  "/api/yuqing/settings/model-channels",
]) {
  assertOk(worker.includes(route), `worker exposes ${route}`);
}
assertOk(worker.includes("readYuqingModelSettingsEnvelope") && worker.includes("resolveYuqingModel"), "worker resolves model channels before LLM calls");
assertOk(worker.includes("gemini-3.1-pro-preview") && worker.includes("gemini-3.1-flash-lite-preview") && worker.includes("gemini-3-flash-preview"), "worker embeds approved Gemini model catalog");
assertOk(worker.includes("DELETE FROM yuqing_reports WHERE generated_at < ?"), "worker prunes reports by retention");
assertOk(worker.includes("createYuqingReport(env"), "worker has manual/scheduled report generation path");
assertOk(worker.includes("kind: SENTIMENT_ANALYSIS_KIND"), "legacy report endpoint maps to sentiment_analysis");
assertOk(worker.includes("assetMoves") && worker.includes("fetchAssetMoveRows(env, finQuotes, btc)"), "worker builds multi-window asset moves");
assertOk(worker.includes("/api/d1/klines?symbol=BTCUSDT&interval=1h&limit=192&sync=0"), "worker uses enough BTC 1h D1 klines for 7d window");
assertOk(temperature.includes("24h=短线冲击") && temperature.includes("3d=短线延续") && temperature.includes("7d=背景趋势"), "temperature prompt defines multi-window semantics");
assertOk(temperature.includes("assets") && temperature.includes("normalizeTemperatureAssets"), "temperature payload exposes asset move rows");
assertOk(shijianIndex.includes("buildDailyGithubToolsPrompt") && shijianIndex.includes("./github-tools.js"), "shijian exports github tools module");
assertOk(githubTools.includes("normalizeDailyGithubToolItems") && githubTools.includes("renderDailyGithubToolsMarkdownForTrends"), "github tools module normalizes and renders trends input");
assertOk(trendClues.includes("不使用 Google Search") && trendClues.includes("只基于下方输入做二次叠加分析"), "trend clues prompt is input-only by default");
assertOk(trendClues.includes("重度世界新闻 + 中度科技 + 轻量金融背景") && trendClues.includes("worldNews"), "trend clues prompt uses daily editorial structure");
assertOk(worker.includes("module: \"githubTools\"") && worker.includes("normalizeDailyGithubToolItems(parsed.githubTools)"), "worker streams github tools partials");
assertOk(worker.includes("githubTools: modules.githubTools") && worker.includes("dailyGithubToolsFromFacts()"), "worker persists github tools module state and fallback");
assertOk(worker.includes("trendsUseSearch") && worker.includes("googleSearch: dailyEventFocus ? false : trendsUseSearch"), "worker keeps daily trend clues off Google Search by default");
assertOk(eventsPage.includes("githubTools: !!s.githubTools") && eventsPage.includes("mergeDailyStreamEvent(evt)"), "events page sends and merges github tools stream data");
assertOk(eventsPage.includes("renderDailyGithubTools") && eventsPage.includes("GitHub 工具雷达暂无结果"), "events page renders github tools with empty state");
assertOk(eventsPage.includes("trendsUseSearch: false") && eventsPage.includes("趋势线索 · 本轮叠加分析"), "events page marks trend clues as upstream synthesis");
assertOk(eventsPage.includes("daily-temperature-assets") && eventsPage.includes("move3d") && eventsPage.includes("move7d"), "events page renders temperature asset moves");

for (const method of [
  "fetchYuqingReportLatest",
  "fetchYuqingReportHistory",
  "fetchYuqingReportItem",
  "deleteYuqingReportItem",
  "generateYuqingStructuredReport",
  "streamYuqingDailyEventReport",
  "fetchYuqingReportStatus",
  "fetchYuqingModelSettings",
  "updateYuqingModelSettings",
]) {
  assertOk(dataEngine.includes(method), `DataEngine has ${method}`);
}

console.log("\nYuqing report verification passed");
