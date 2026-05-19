const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const workerPath = path.join(ROOT, "cloudflare", "yuqing", "yuqing-worker.js");
const migrationPath = path.join(ROOT, "cloudflare", "migrations", "yuqing", "0002_reports.sql");
const modelMigrationPath = path.join(ROOT, "cloudflare", "migrations", "yuqing", "0004_model_channels.sql");
const codexBridgeMigrationPath = path.join(ROOT, "cloudflare", "migrations", "yuqing", "0005_codex_bridge_tasks.sql");
const systemLlmRoutesMigrationPath = path.join(ROOT, "cloudflare", "migrations", "yuqing", "0006_system_llm_routes.sql");
const wranglerPath = path.join(ROOT, "cloudflare", "wrangler.yuqing.toml");
const dataEnginePath = path.join(ROOT, "js", "data-engine.js");
const eventsPagePath = path.join(ROOT, "js", "pages", "events.js");
const settingsPagePath = path.join(ROOT, "js", "pages", "settings.js");
const newsPagePath = path.join(ROOT, "js", "pages", "news.js");
const codexBridgePath = path.join(ROOT, "scripts", "codex-cli-bridge.cjs");
const codexDailySchemaPath = path.join(ROOT, "scripts", "codex-schemas", "daily_event.schema.json");
const codexSentimentSchemaPath = path.join(ROOT, "scripts", "codex-schemas", "sentiment_analysis.schema.json");
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
const codexBridgeMigration = fs.readFileSync(codexBridgeMigrationPath, "utf8");
const systemLlmRoutesMigration = fs.readFileSync(systemLlmRoutesMigrationPath, "utf8");
const wrangler = fs.readFileSync(wranglerPath, "utf8");
const dataEngine = fs.readFileSync(dataEnginePath, "utf8");
const eventsPage = fs.readFileSync(eventsPagePath, "utf8");
const settingsPage = fs.readFileSync(settingsPagePath, "utf8");
const newsPage = fs.readFileSync(newsPagePath, "utf8");
const codexBridge = fs.readFileSync(codexBridgePath, "utf8");
const codexDailySchema = JSON.parse(fs.readFileSync(codexDailySchemaPath, "utf8"));
const codexSentimentSchema = JSON.parse(fs.readFileSync(codexSentimentSchemaPath, "utf8"));
const shijianIndex = fs.readFileSync(shijianIndexPath, "utf8");
const githubTools = fs.readFileSync(githubToolsPath, "utf8");
const temperature = fs.readFileSync(temperaturePath, "utf8");
const trendClues = fs.readFileSync(trendCluesPath, "utf8");
const ctx = loadWorkerContext();

assertOk(/CREATE TABLE IF NOT EXISTS yuqing_reports/.test(migration), "migration creates yuqing_reports");
assertOk(/model_channels/.test(modelMigration) && /yuqing_settings/.test(modelMigration), "model channel migration seeds yuqing_settings");
assertOk(/CREATE TABLE IF NOT EXISTS yuqing_codex_tasks/.test(codexBridgeMigration), "codex bridge migration creates task queue");
assertOk(/execution_channels/.test(codexBridgeMigration) && /gemini_worker/.test(codexBridgeMigration) && /codex_cli/.test(worker), "codex bridge migration seeds execution channels");
assertOk(
  /0006_system_llm_routes/.test(systemLlmRoutesMigration) &&
    /json_patch/.test(systemLlmRoutesMigration) &&
    /json_extract\(value_json, '\$\.routes'\)/.test(systemLlmRoutesMigration),
  "system LLM route migration backfills defaults while preserving existing choices",
);
const expectedExecutionRouteIds = [
  "daily_event",
  "sentiment_analysis",
  "overview.advice",
  "premarket.brief",
  "boardroom.meeting",
  "agent.chief",
  "agent.env",
  "agent.flow",
  "agent.deriv",
  "agent.risk",
  "agent.archive",
  "strategy.templates",
  "order.draft",
  "positions.risk",
  "review.journal",
  "review.daily",
  "review.performance",
  "review.patterns",
  "playbook.assistant",
];
for (const routeId of expectedExecutionRouteIds) {
  assertOk(worker.includes(routeId), `worker reserves execution route ${routeId}`);
  assertOk(settingsPage.includes(`id: "${routeId}"`), `settings page reserves execution route ${routeId}`);
  assertOk(codexBridgeMigration.includes(`"${routeId}":"gemini_worker"`), `migration seeds execution route ${routeId}`);
  assertOk(systemLlmRoutesMigration.includes(`"${routeId}":"gemini_worker"`), `backfill migration seeds execution route ${routeId}`);
}
for (const routeId of expectedExecutionRouteIds.filter((id) => id !== "daily_event" && id !== "sentiment_analysis")) {
  assertOk(modelMigration.includes(`"${routeId}":`), `model migration seeds model route ${routeId}`);
  assertOk(systemLlmRoutesMigration.includes(`"${routeId}":`), `backfill migration seeds model route ${routeId}`);
}
assertOk(worker.includes("raw.routes") && worker.includes("bodyIn.routes"), "worker accepts routes alias when saving execution channels");
assertOk(!settingsPage.includes("key && value && !el.disabled") && settingsPage.includes("if (key && value) routes[key] = value"), "settings page saves reserved execution defaults to D1");
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
assertOk(worker.includes("createYuqingCostTracker") && worker.includes("geminiCostEntry"), "worker estimates Gemini usage and search cost");
assertOk(worker.includes("costEstimate: legacy && legacy.costEstimate"), "worker persists cost estimate inside report grounding");
assertOk(worker.includes("YUQING_COST_USD_CNY") && worker.includes("usdCnyRate") && worker.includes(": 7;"), "worker defaults cost conversion to 7 CNY per USD");
assertOk(worker.includes("totalCostCny") && worker.includes("searchCostCny") && worker.includes("searchQueries"), "worker exposes cost aliases for archive compatibility");
const p31ProSmall = ctx.yuqingGeminiPricing("gemini-3.1-pro-preview", 200000);
const p31ProLarge = ctx.yuqingGeminiPricing("gemini-3.1-pro-preview", 200001);
const p31Lite = ctx.yuqingGeminiPricing("gemini-3.1-flash-lite", 1000);
const p31LitePreview = ctx.yuqingGeminiPricing("gemini-3.1-flash-lite-preview", 1000);
assertOk(p31ProSmall.inputPer1mUsd === 2 && p31ProSmall.outputPer1mUsd === 12 && p31ProSmall.searchPer1kUsd === 14, "Gemini 3.1 Pro pricing matches official <=200k standard rate");
assertOk(p31ProLarge.inputPer1mUsd === 4 && p31ProLarge.outputPer1mUsd === 18 && p31ProLarge.searchPer1kUsd === 14, "Gemini 3.1 Pro pricing matches official >200k standard rate");
assertOk(p31Lite.inputPer1mUsd === 0.25 && p31Lite.outputPer1mUsd === 1.5 && p31Lite.searchPer1kUsd === 14, "Gemini 3.1 Flash Lite pricing matches official standard rate");
assertOk(p31LitePreview.inputPer1mUsd === 0.25 && p31LitePreview.outputPer1mUsd === 1.5 && p31LitePreview.searchPer1kUsd === 14, "Gemini 3.1 Flash Lite Preview pricing matches official standard rate");
assertOk(worker.includes("pricingModelId") && worker.includes("gemini_api_pricing_snapshot_2026-05-11"), "worker records exact pricing key for each LLM cost entry");
const modelSwitchEnvelope = { settings: { assignments: { "daily_event.trends": "gemini-3.1-pro-preview" } } };
const modelSwitchResolved = ctx.resolveYuqingModel({}, modelSwitchEnvelope, "daily_event.trends", {});
assertOk(modelSwitchResolved.modelId === "gemini-3.1-pro-preview" && modelSwitchResolved.source === "d1", "worker resolves D1 model channel before costing LLM calls");

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
  "/api/yuqing/settings/execution-channels",
  "/api/yuqing/codex/tasks",
  "/api/yuqing/codex/bridge-task",
]) {
  assertOk(worker.includes(route), `worker exposes ${route}`);
}
assertOk(worker.includes("validCodexBridgeRequest") && worker.includes("CODEX_BRIDGE_TOKEN"), "worker requires bridge token before Codex task claim");
assertOk(worker.includes("createCodexBridgeTask") && worker.includes("completeCodexBridgeTask") && worker.includes("codexDailyStreamResponse"), "worker creates, completes, and streams Codex bridge tasks");
assertOk(worker.includes("readYuqingModelSettingsEnvelope") && worker.includes("resolveYuqingModel"), "worker resolves model channels before LLM calls");
assertOk(worker.includes("gemini-3.1-pro-preview") && worker.includes("gemini-3.1-flash-lite") && worker.includes("gemini-3-flash-preview"), "worker embeds approved Gemini model catalog");
assertOk(worker.includes("DELETE FROM yuqing_reports WHERE generated_at < ?"), "worker prunes reports by retention");
assertOk(worker.includes("createYuqingReport(env"), "worker has manual/scheduled report generation path");
const streamingPlaceholder = ctx.buildDailyEventStreamingReport("2026-05-19T07:00:00.000Z", { triggerType: "manual", forceSearch: true });
assertOk(streamingPlaceholder.status === "streaming" && streamingPlaceholder.kind === "daily_event" && streamingPlaceholder.reportDate === "2026-05-19", "worker creates daily_event streaming placeholder");
assertOk(worker.includes("await insertYuqingReport(env.YUQING_DB, progressPayload)") && worker.includes("reportId: progressPayload.id"), "worker persists streaming placeholder before final daily report");
assertOk(worker.includes("kind: SENTIMENT_ANALYSIS_KIND"), "legacy report endpoint maps to sentiment_analysis");
assertOk(worker.includes("assetMoves") && worker.includes("fetchAssetMoveRows(env, finQuotes, btc)"), "worker builds multi-window asset moves");
assertOk(worker.includes("/api/d1/klines?symbol=BTCUSDT&interval=1h&limit=192&sync=0"), "worker uses enough BTC 1h D1 klines for 7d window");
assertOk(temperature.includes("24h=短线冲击") && temperature.includes("3d=短线延续") && temperature.includes("7d=背景趋势"), "temperature prompt defines multi-window semantics");
assertOk(temperature.includes("assets") && temperature.includes("normalizeTemperatureAssets"), "temperature payload exposes asset move rows");
assertOk(shijianIndex.includes("buildDailyGithubToolsPrompt") && shijianIndex.includes("./github-tools.js"), "shijian exports github tools module");
assertOk(githubTools.includes("normalizeDailyGithubToolItems") && githubTools.includes("renderDailyGithubToolsMarkdownForTrends"), "github tools module normalizes and renders trends input");
assertOk(trendClues.includes("必须使用 Google Search") && trendClues.includes("外部搜索校准"), "trend clues prompt uses Google Search calibration");
assertOk(trendClues.includes("closingRead") && trendClues.includes("searchFindings") && trendClues.includes("watchline"), "trend clues prompt uses closing editorial structure");
assertOk(worker.includes("module: \"githubTools\"") && worker.includes("normalizeDailyGithubToolItems(parsed.githubTools)"), "worker streams github tools partials");
assertOk(worker.includes("githubTools: modules.githubTools") && worker.includes("dailyGithubToolsFromFacts()"), "worker persists github tools module state and fallback");
assertOk(worker.includes("const trendSearchEnabled = dailyEventFocus ? true : trendsUseSearch") && worker.includes("usedSearchTrends") && worker.includes("googleSearch: trendSearchEnabled"), "worker enables and records search for daily trend clues");
assertOk(eventsPage.includes("githubTools: !!s.githubTools") && eventsPage.includes("mergeDailyStreamEvent(evt)"), "events page sends and merges github tools stream data");
assertOk(eventsPage.includes("renderDailyGithubTools") && eventsPage.includes("GitHub 工具雷达暂无结果"), "events page renders github tools with empty state");
assertOk(eventsPage.includes("trendsUseSearch: true") && eventsPage.includes("趋势线索 · 外部校准收束") && eventsPage.includes("daily-trend-brief"), "events page marks trend clues as searched closing read");
assertOk(eventsPage.includes("趋势线索会等上游完成后再做外部搜索校准") && eventsPage.includes("最新外部来源里校准"), "events page copy aligns trend clues with searched closing read");
assertOk(eventsPage.includes("daily-temperature-assets") && eventsPage.includes("move3d") && eventsPage.includes("move7d"), "events page renders temperature asset moves");
assertOk(eventsPage.includes("历史报告与费用") && eventsPage.includes("renderDailyArchiveCostSummary"), "events page renders report archive cost summary");
assertOk(eventsPage.includes("DAILY_ARCHIVE_FILTERS") && eventsPage.includes("近30天") && eventsPage.includes("近七天"), "events page filters reports by archive range");
assertOk(eventsPage.includes("DAILY_PENDING_PREVIEW_KEY") && eventsPage.includes("dailyRestorePendingPreview") && eventsPage.includes("preservePending"), "events page restores in-progress daily preview after refresh");
assertOk(eventsPage.includes("dailyCloudReportShouldReplacePending") && eventsPage.includes("D1 最新记录仍是同一轮未完成扫描"), "events page prevents stale D1 latest from replacing pending scan");

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
  "fetchYuqingExecutionChannelSettings",
  "updateYuqingExecutionChannelSettings",
  "pollYuqingCodexTask",
]) {
  assertOk(dataEngine.includes(method), `DataEngine has ${method}`);
}

assertOk(settingsPage.includes("Codex CLI 隧道") && settingsPage.includes("settings-execution"), "settings page renders execution channel controls");
assertOk(newsPage.includes("onTaskStatus") && newsPage.includes("Codex CLI 任务已排队"), "news analysis page shows Codex task waiting status");
assertOk(codexBridge.includes("--sandbox") && codexBridge.includes("read-only") && !codexBridge.includes("dangerously-bypass-approvals"), "codex bridge runs codex exec with read-only sandbox and no dangerous bypass");
assertOk(codexBridge.includes("CODEX_BRIDGE_TOKEN") && codexBridge.includes("YUQING_BRIDGE_TOKEN") && codexBridge.includes(".codex-bridge.env"), "codex bridge reads local bridge token configuration");
assertOk(codexBridge.includes("daily_event") && codexBridge.includes("sentiment_analysis") && codexBridge.includes("TASK_ENDPOINT"), "codex bridge only accepts yuqing report task kinds");
assertOk(codexBridge.includes("readPromptFileBundle") && codexBridge.includes("context.promptFiles"), "codex bridge preloads Worker prompt files before exec");
assertOk(codexBridge.includes("schemaPathForTask") && codexBridge.includes("validateCodexPayloadShape") && codexBridge.includes("REQUIRED_REPORT_SECTIONS"), "codex bridge checks per-kind report shape after exec");
assertOk(!codexBridge.includes("--output-schema"), "codex bridge avoids strict CLI output-schema that would flatten flexible report bodies");
assertOk(codexBridge.includes("DEFAULT_POLL_INTERVAL_MS = 2000"), "codex bridge default polling is tightened without changing report generation");
assertOk(worker.includes("task.status === \"queued\" ? 1500 : 2000"), "worker waits on Codex tasks with tighter polling");
assertOk(dataEngine.includes("Number(opts.pollIntervalMs) || 2_000"), "DataEngine polls Codex tasks every 2s by default");
assertOk(
  codexDailySchema.properties.kind.enum.includes("daily_event") &&
    codexDailySchema.properties.report.required.includes("topStories") &&
    codexDailySchema.properties.report.required.includes("trendRead"),
  "daily_event schema keeps required report sections",
);
assertOk(
  codexSentimentSchema.properties.kind.enum.includes("sentiment_analysis") &&
    codexSentimentSchema.properties.report.required.includes("upstreamDaily") &&
    codexSentimentSchema.properties.report.required.includes("riskRadar"),
  "sentiment_analysis schema keeps required report sections",
);

console.log("\nYuqing report verification passed");
