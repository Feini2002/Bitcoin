/**
 * Cloudflare Worker：舆情日报（yuqing.feiniwork.com）
 *
 * - 聚合非 LLM：FNG、CoinGecko BTC、Finnhub 批量 ETF/股票报价（仅行情数字，不喂新闻）
 * - 今日头条 / 动态速览 / AI 情报站 / GitHub 工具雷达：固定 Gemini + Google Search（不调 Finnhub 新闻事实池回填）
 * - LLM：可配置 YUQING_LLM_PROVIDER=none|gemini|auto（默认 auto）；模型通道优先读取 D1 yuqing_settings:model_channels，再 fallback 环境变量；密钥仅存 Worker Secret
 *
 * 兼容旧 api.feiniwork.com 的路径：/finnhub-bulk、/finnhub/*（建议使用 /api/yuqing/*）
 *
 * 目录：与本文件同包的 `yuqing-facts.js`（事实池）、`shijian/`（事件一览拆分）、`fenxi/`（舆情分析拆分）。
 */

import {
  d1Bound,
  filterAiFactsFromNewsItems,
  ingestFactPool,
  loadHistoryStats,
  loadItemsPage,
  loadRecentItems,
  pruneOldItems,
} from "./yuqing-facts.js";
import {
  YUQING_FENXI_PAGE,
  YUQING_FENXI_MODULES,
  YUQING_FENXI_SEARCH_SCOPES,
  YUQING_FENXI_SETTING_KEY,
  calendarFromFacts,
  defaultFenxiDashboardSettings,
  fenxiModuleShell,
  fenxiSettingsSnapshot,
  marketStateFromLegacy,
  normalizeFenxiDashboardSettings,
  opportunitiesFromInputs,
  riskRadarFromInputs,
  trendReadForSentiment,
} from "./fenxi/index.js";
import {
  YUQING_SHIJIAN_PAGE,
  buildDailyAiIntelPrompt,
  buildDailyBriefsPrompt,
  buildDailyGithubToolsPrompt,
  buildDailyTemperature,
  buildDailyTemperaturePrompt,
  buildDailyTopStoriesPrompt,
  buildDailyTopStoriesWirePrompt,
  buildDailyTrendCluesPrompt,
  buildTrendReadFromDailyEventInputs,
  cleanText,
  dailyThemeFromStoriesAndBriefs,
  itemSummary,
  mergeTopStoryCandidatesForDaily,
  normalizeDailyAiIntelItems,
  normalizeDailyBriefItems,
  normalizeDailyGithubToolItems,
  normalizeDailyTopStoryItems,
  renderDailyAiIntelMarkdownForTrends,
  renderDailyBriefsMarkdown,
  renderDailyGithubToolsMarkdownForTrends,
  renderDailyTopStoriesMarkdown,
  shijianModuleShell,
} from "./shijian/index.js";
import { accessCorsHeaders, accessServiceHeaders, requireCloudflareAccess } from "../access-auth.js";


/** 开发期省 token：`true` 时跳过本 Worker 「Cron→createYuqingReport」链路（事件日报 / 舆情二次研判均含 LLM）；手动 `POST …/reports/generate` 等仍可用；事实池 `POST …/ingest` 不含 LLM 不受影响。BTC K 线在 `binance-klines-worker`，与此开关无关。定型后改为 `false` 一行即恢复定点。 */
const YUQING_SKIP_SCHEDULED_LLM_REPORTS = false;

const GEMINI_ORIGIN = "https://generativelanguage.googleapis.com";
const FINNHUB_ORIGIN = "https://finnhub.io";
const ALT_FNG = "https://api.alternative.me/fng/";
const COINGECKO_BTC = "https://api.coingecko.com/api/v3/simple/price";
const YAHOO_CHART_ORIGIN = "https://query1.finance.yahoo.com/v8/finance/chart";

const WORKER_BUILD = "yuqing-worker/1.6.0-cloud-only";
const FETCH_TIMEOUT_SOURCES_MS = 12_000;
const FETCH_TIMEOUT_LLM_MS = 240_000;

/** 舆情链路 Gemini 默认模型；可通过 Worker 环境变量 YUQING_LLM_MODEL_FLASH / _PRO / _TRENDS / _FAST_PROSE 单独覆盖 */
const YUQING_GEMINI_MODEL_DEFAULT = "gemini-3.1-flash-lite";
const REPORT_RETENTION_DAYS = 7;
const DAILY_EVENT_KIND = "daily_event";
const SENTIMENT_ANALYSIS_KIND = "sentiment_analysis";
const DAILY_EVENT_SLOTS_BJT = new Set(["00:00", "08:00", "12:00", "20:00"]);
const SENTIMENT_ANALYSIS_SLOTS_BJT = new Set(["09:00", "14:00", "22:00"]);
const DEFAULT_MARKET_API_BASE = "https://btc.feiniwork.com";
const YUQING_MODEL_SETTING_KEY = "model_channels";
const YUQING_MODEL_CATALOG = [
  {
    id: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro Preview",
    tier: "deep",
    hint: "复杂归纳、二次研判、首席策略类任务",
  },
  {
    id: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash Lite",
    tier: "lite",
    hint: "低成本、短文本、状态与温度类任务",
  },
  {
    id: "gemini-3-flash-preview",
    label: "Gemini 3 Flash Preview",
    tier: "fast",
    hint: "实时检索、事件扫描、常规模块生成",
  },
];
const YUQING_MODEL_IDS = new Set(YUQING_MODEL_CATALOG.map((m) => m.id));
const YUQING_MODEL_PRICING = {
  "gemini-3.1-pro-preview": {
    inputPer1mUsd: { underOrEqual200k: 2, over200k: 4 },
    outputPer1mUsd: { underOrEqual200k: 12, over200k: 18 },
    searchPer1kUsd: 14,
    searchBilling: "gemini3_search_query",
  },
  "gemini-3.1-pro-preview-customtools": {
    inputPer1mUsd: { underOrEqual200k: 2, over200k: 4 },
    outputPer1mUsd: { underOrEqual200k: 12, over200k: 18 },
    searchPer1kUsd: 14,
    searchBilling: "gemini3_search_query",
  },
  "gemini-3.1-flash-lite": {
    inputPer1mUsd: 0.25,
    outputPer1mUsd: 1.5,
    searchPer1kUsd: 14,
    searchBilling: "gemini3_search_query",
  },
  "gemini-3.1-flash-lite-preview": {
    inputPer1mUsd: 0.25,
    outputPer1mUsd: 1.5,
    searchPer1kUsd: 14,
    searchBilling: "gemini3_search_query",
  },
  "gemini-3-flash-preview": {
    inputPer1mUsd: 0.5,
    outputPer1mUsd: 3,
    searchPer1kUsd: 14,
    searchBilling: "gemini3_search_query",
  },
  "gemini-2.5-pro": {
    inputPer1mUsd: { underOrEqual200k: 1.25, over200k: 2.5 },
    outputPer1mUsd: { underOrEqual200k: 10, over200k: 15 },
    searchPer1kUsd: 35,
    searchBilling: "grounded_prompt",
  },
  "gemini-2.5-flash": {
    inputPer1mUsd: 0.3,
    outputPer1mUsd: 2.5,
    searchPer1kUsd: 35,
    searchBilling: "grounded_prompt",
  },
  "gemini-2.5-flash-lite": {
    inputPer1mUsd: 0.1,
    outputPer1mUsd: 0.4,
    searchPer1kUsd: 35,
    searchBilling: "grounded_prompt",
  },
};
const YUQING_MODEL_TARGETS = [
  {
    id: "daily_event.dashboard",
    group: "事件一览",
    page: "事件一览",
    module: "信息温度",
    kind: DAILY_EVENT_KIND,
    slot: "dashboard",
    status: "active",
    defaultModel: "gemini-3.1-flash-lite",
    envSlot: "flash",
    note: "市场温度 JSON 与低延迟状态摘要。",
  },
  {
    id: "daily_event.news",
    group: "事件一览",
    page: "事件一览",
    module: "今日头条",
    kind: DAILY_EVENT_KIND,
    slot: "news",
    status: "active",
    defaultModel: "gemini-3-flash-preview",
    envSlot: "prose",
    note: "Google Search 事件检索与结构化头条。",
  },
  {
    id: "daily_event.timeline",
    group: "事件一览",
    page: "事件一览",
    module: "动态速览",
    kind: DAILY_EVENT_KIND,
    slot: "timeline",
    status: "active",
    defaultModel: "gemini-3-flash-preview",
    envSlot: "prose",
    note: "实时动态简报与来源归纳。",
  },
  {
    id: "daily_event.ai",
    group: "事件一览",
    page: "事件一览",
    module: "AI 情报站",
    kind: DAILY_EVENT_KIND,
    slot: "ai",
    status: "active",
    defaultModel: "gemini-3-flash-preview",
    envSlot: "prose",
    note: "AI 行业新闻检索与可用性提炼。",
  },
  {
    id: "daily_event.githubTools",
    group: "事件一览",
    page: "事件一览",
    module: "GitHub 工具雷达",
    kind: DAILY_EVENT_KIND,
    slot: "githubTools",
    status: "active",
    defaultModel: "gemini-3-flash-preview",
    envSlot: "prose",
    note: "开发工具与开源项目动态检索。",
  },
  {
    id: "daily_event.trends",
    group: "事件一览",
    page: "事件一览",
    module: "趋势线索",
    kind: DAILY_EVENT_KIND,
    slot: "trends",
    status: "active",
    defaultModel: "gemini-3.1-flash-lite",
    envSlot: "trends",
    note: "基于本轮模块输出的二次叠加，不默认联网。",
  },
  {
    id: "sentiment_analysis.dashboard",
    group: "舆情分析",
    page: "舆情分析",
    module: "市场状态",
    kind: SENTIMENT_ANALYSIS_KIND,
    slot: "dashboard",
    status: "active",
    defaultModel: "gemini-3.1-flash-lite",
    envSlot: "flash",
    note: "二次分析页的市场温度与状态底座。",
  },
  {
    id: "sentiment_analysis.news",
    group: "舆情分析",
    page: "舆情分析",
    module: "事件复盘",
    kind: SENTIMENT_ANALYSIS_KIND,
    slot: "news",
    status: "active",
    defaultModel: "gemini-3.1-pro-preview",
    envSlot: "prose",
    note: "复盘上游事件、动态速览与宏观主线。",
  },
  {
    id: "sentiment_analysis.ai",
    group: "舆情分析",
    page: "舆情分析",
    module: "AI 线索复核",
    kind: SENTIMENT_ANALYSIS_KIND,
    slot: "ai",
    status: "active",
    defaultModel: "gemini-3.1-pro-preview",
    envSlot: "prose",
    note: "将 AI 事件放回市场语境做二次筛选。",
  },
  {
    id: "sentiment_analysis.trends",
    group: "舆情分析",
    page: "舆情分析",
    module: "趋势研判",
    kind: SENTIMENT_ANALYSIS_KIND,
    slot: "trends",
    status: "active",
    defaultModel: "gemini-3.1-pro-preview",
    envSlot: "trends",
    note: "综合上游日报、事实池与市场快照。",
  },
  {
    id: "agent.chief",
    group: "员工 Agent",
    page: "智囊团",
    module: "首席策略官",
    kind: "agent",
    slot: "chief",
    status: "reserved",
    defaultModel: "gemini-3.1-pro-preview",
    envSlot: "prose",
    note: "预留：未来总控汇总与最终策略指引。",
  },
  {
    id: "agent.env",
    group: "员工 Agent",
    page: "智囊团",
    module: "环境评估员",
    kind: "agent",
    slot: "env",
    status: "reserved",
    defaultModel: "gemini-3-flash-preview",
    envSlot: "prose",
    note: "预留：未来读取行情、波动率与宏观环境。",
  },
  {
    id: "agent.flow",
    group: "员工 Agent",
    page: "智囊团",
    module: "盘口流动性官",
    kind: "agent",
    slot: "flow",
    status: "reserved",
    defaultModel: "gemini-3-flash-preview",
    envSlot: "prose",
    note: "预留：未来读取足迹图、成交分布与强平。",
  },
  {
    id: "agent.deriv",
    group: "员工 Agent",
    page: "智囊团",
    module: "衍生品情报官",
    kind: "agent",
    slot: "deriv",
    status: "reserved",
    defaultModel: "gemini-3-flash-preview",
    envSlot: "prose",
    note: "预留：未来读取资金费率、OI、期权与基差。",
  },
  {
    id: "agent.risk",
    group: "员工 Agent",
    page: "智囊团",
    module: "风控官",
    kind: "agent",
    slot: "risk",
    status: "reserved",
    defaultModel: "gemini-3-flash-preview",
    envSlot: "prose",
    note: "预留：未来读取仓位、风险预算与异常模式。",
  },
  {
    id: "overview.advice",
    group: "核心",
    page: "概览 Dashboard",
    module: "首席综合建议",
    kind: "dashboard_agent",
    slot: "advice",
    status: "reserved",
    defaultModel: "gemini-3.1-pro-preview",
    envSlot: "prose",
    note: "预留：未来聚合全局市场、舆情与员工结论。",
  },
  {
    id: "premarket.brief",
    group: "核心",
    page: "盘前简报",
    module: "盘前简报",
    kind: "briefing",
    slot: "brief",
    status: "reserved",
    defaultModel: "gemini-3.1-pro-preview",
    envSlot: "prose",
    note: "预留：未来生成开盘前 checklist 与交易倾向。",
  },
  {
    id: "boardroom.meeting",
    group: "智囊团",
    page: "会议室",
    module: "会议召集与追问",
    kind: "agent_meeting",
    slot: "meeting",
    status: "reserved",
    defaultModel: "gemini-3.1-pro-preview",
    envSlot: "prose",
    note: "预留：未来协调多 Agent 发言与会议纪要。",
  },
  {
    id: "agent.archive",
    group: "智囊团",
    page: "发言历史库",
    module: "发言检索与准确性复盘",
    kind: "agent_archive",
    slot: "archive",
    status: "reserved",
    defaultModel: "gemini-3-flash-preview",
    envSlot: "prose",
    note: "预留：未来检索历史发言并做归因复盘。",
  },
  {
    id: "strategy.templates",
    group: "交易执行",
    page: "策略模板库",
    module: "策略模板助手",
    kind: "strategy_assistant",
    slot: "templates",
    status: "reserved",
    defaultModel: "gemini-3.1-pro-preview",
    envSlot: "prose",
    note: "预留：未来按市场状态推荐或生成策略模板。",
  },
  {
    id: "order.draft",
    group: "交易执行",
    page: "订单草稿台",
    module: "订单草稿风控预检",
    kind: "order_risk_review",
    slot: "draft",
    status: "reserved",
    defaultModel: "gemini-3-flash-preview",
    envSlot: "prose",
    note: "预留：未来检查订单方向、仓位与止损参数。",
  },
  {
    id: "positions.risk",
    group: "交易执行",
    page: "当前持仓",
    module: "持仓风险解读",
    kind: "position_risk_read",
    slot: "positions",
    status: "reserved",
    defaultModel: "gemini-3-flash-preview",
    envSlot: "prose",
    note: "预留：未来解释保证金、清算价和风险占用。",
  },
  {
    id: "review.journal",
    group: "复盘系统",
    page: "交易日志",
    module: "交易日志点评",
    kind: "journal_review",
    slot: "journal",
    status: "reserved",
    defaultModel: "gemini-3-flash-preview",
    envSlot: "prose",
    note: "预留：未来点评单笔交易和情绪偏差。",
  },
  {
    id: "review.daily",
    group: "复盘系统",
    page: "每日复盘",
    module: "每日复盘",
    kind: "daily_review",
    slot: "daily",
    status: "reserved",
    defaultModel: "gemini-3.1-pro-preview",
    envSlot: "prose",
    note: "预留：未来汇总执行偏差、员工点评和明日清单。",
  },
  {
    id: "review.performance",
    group: "复盘系统",
    page: "绩效统计",
    module: "绩效归因",
    kind: "performance_attribution",
    slot: "performance",
    status: "reserved",
    defaultModel: "gemini-3-flash-preview",
    envSlot: "prose",
    note: "预留：未来解释胜率、盈亏比和回撤变化。",
  },
  {
    id: "review.patterns",
    group: "复盘系统",
    page: "错误模式",
    module: "错误模式归因",
    kind: "mistake_pattern_review",
    slot: "patterns",
    status: "reserved",
    defaultModel: "gemini-3.1-pro-preview",
    envSlot: "prose",
    note: "预留：未来归类高频错误并生成纠偏建议。",
  },
  {
    id: "playbook.assistant",
    group: "系统",
    page: "知识库 Playbook",
    module: "AI 检索与纪律推荐",
    kind: "playbook_assistant",
    slot: "assistant",
    status: "reserved",
    defaultModel: "gemini-3-flash-preview",
    envSlot: "prose",
    note: "预留：未来按场景检索纪律与策略卡片。",
  },
];
const YUQING_MODEL_TARGET_MAP = Object.fromEntries(YUQING_MODEL_TARGETS.map((t) => [t.id, t]));

/** 设为 true（环境变量字符串 "1"|"true"）时全线 503（用于紧急下线） */
function maintenanceEnabled(env) {
  const raw = env && env.MAINTENANCE_MODE != null ? String(env.MAINTENANCE_MODE).trim().toLowerCase() : "";
  return raw === "1" || raw === "true";
}

function corsHeaders(extra = {}) {
  return accessCorsHeaders(null, {
    "Access-Control-Expose-Headers": "X-Worker-Build, X-Yuqing-Worker",
    ...extra,
  });
}

function json(body, status = 200, extraHeaders = {}) {
  const headers = {
    ...corsHeaders(extraHeaders.headers || {}),
    "Content-Type": "application/json; charset=utf-8",
    "X-Worker-Build": WORKER_BUILD,
    "X-Yuqing-Worker": "1",
    ...extraHeaders,
  };
  return new Response(JSON.stringify(body), { status, headers });
}

async function fetchWithTimeout(url, opts, timeoutMs = FETCH_TIMEOUT_SOURCES_MS) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...(opts || {}), signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

function pad2(n) {
  return String(Number(n) || 0).padStart(2, "0");
}

function bjtParts(input) {
  const d = input instanceof Date ? input : new Date(input || Date.now());
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const m = {};
  for (const p of parts) {
    if (p.type !== "literal") m[p.type] = p.value;
  }
  return {
    year: String(m.year || "1970"),
    month: String(m.month || "01"),
    day: String(m.day || "01"),
    hour: String(m.hour || "00"),
    minute: String(m.minute || "00"),
    second: String(m.second || "00"),
  };
}

function bjtDateKey(input) {
  const p = bjtParts(input);
  return `${p.year}-${p.month}-${p.day}`;
}

function bjtTimeKey(input) {
  const p = bjtParts(input);
  return `${p.hour}:${p.minute}`;
}

function bjtSlotLabel(kind, input) {
  const t = bjtTimeKey(input);
  if (kind === DAILY_EVENT_KIND && DAILY_EVENT_SLOTS_BJT.has(t)) return t.slice(0, 2);
  if (kind === SENTIMENT_ANALYSIS_KIND && SENTIMENT_ANALYSIS_SLOTS_BJT.has(t)) return t.slice(0, 2);
  return `manual-${t}`;
}

function scheduledKindsForDate(input) {
  const t = bjtTimeKey(input);
  const out = [];
  if (DAILY_EVENT_SLOTS_BJT.has(t)) out.push({ kind: DAILY_EVENT_KIND, slot: t.slice(0, 2) });
  if (SENTIMENT_ANALYSIS_SLOTS_BJT.has(t)) out.push({ kind: SENTIMENT_ANALYSIS_KIND, slot: t.slice(0, 2) });
  return out;
}

function normalizeReportKind(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (s === DAILY_EVENT_KIND || s === "daily" || s === "event" || s === "events") return DAILY_EVENT_KIND;
  return SENTIMENT_ANALYSIS_KIND;
}

function normalizeTriggerType(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "scheduled" || s === "dependency") return s;
  return "manual";
}

function safeJsonParse(text, fallback) {
  if (text == null || text === "") return fallback;
  try {
    return JSON.parse(String(text));
  } catch (_) {
    return fallback;
  }
}

function safeJsonStringify(value, fallback) {
  try {
    return JSON.stringify(value == null ? fallback : value);
  } catch (_) {
    return JSON.stringify(fallback);
  }
}

function cleanModelId(value) {
  return String(value == null ? "" : value).trim();
}

function envSlotModel(env, slot) {
  if (!env) return "";
  if (slot === "flash") return cleanModelId(env.YUQING_LLM_MODEL_FLASH);
  if (slot === "fast_prose") return cleanModelId(env.YUQING_LLM_MODEL_FAST_PROSE || env.YUQING_LLM_MODEL_FLASH);
  if (slot === "trends") {
    return cleanModelId(env.YUQING_LLM_MODEL_TRENDS || env.YUQING_LLM_MODEL_PRO || env.YUQING_LLM_MODEL_FLASH);
  }
  if (slot === "prose") return cleanModelId(env.YUQING_LLM_MODEL_PRO || env.YUQING_LLM_MODEL_FLASH);
  return "";
}

function defaultModelForTarget(env, target) {
  const t = target || {};
  return envSlotModel(env, t.envSlot) || cleanModelId(t.defaultModel) || YUQING_GEMINI_MODEL_DEFAULT;
}

function normalizeYuqingModelAssignments(raw) {
  const src =
    raw && typeof raw === "object" && raw.assignments && typeof raw.assignments === "object"
      ? raw.assignments
      : raw && typeof raw === "object"
        ? raw
        : {};
  const out = {};
  for (const target of YUQING_MODEL_TARGETS) {
    const modelId = cleanModelId(src[target.id]);
    if (YUQING_MODEL_IDS.has(modelId)) out[target.id] = modelId;
  }
  return out;
}

function normalizeYuqingModelSettings(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    version: 1,
    assignments: normalizeYuqingModelAssignments(src),
    updatedAt: cleanModelId(src.updatedAt || src.updated_at),
  };
}

function effectiveYuqingModelAssignments(settings, env) {
  const src = settings && settings.assignments ? settings.assignments : {};
  const out = {};
  for (const target of YUQING_MODEL_TARGETS) {
    out[target.id] = cleanModelId(src[target.id]) || defaultModelForTarget(env, target);
  }
  return out;
}

function yuqingModelCacheKey(assignments) {
  const src = assignments && typeof assignments === "object" ? assignments : {};
  return YUQING_MODEL_TARGETS.map((target) => `${target.id}:${cleanModelId(src[target.id])}`).join("|");
}

async function readYuqingModelSettingsEnvelope(env) {
  const emptySettings = normalizeYuqingModelSettings(null);
  if (!d1Bound(env)) {
    const effectiveAssignments = effectiveYuqingModelAssignments(emptySettings, env);
    return {
      d1Ready: false,
      source: "fallback",
      settings: emptySettings,
      effectiveAssignments,
      cacheKey: yuqingModelCacheKey(effectiveAssignments),
      error: null,
    };
  }
  try {
    const raw = await getYuqingSettings(env.YUQING_DB, YUQING_MODEL_SETTING_KEY);
    const settings = normalizeYuqingModelSettings(raw);
    const effectiveAssignments = effectiveYuqingModelAssignments(settings, env);
    return {
      d1Ready: true,
      source: raw ? "d1" : "fallback",
      settings,
      effectiveAssignments,
      cacheKey: yuqingModelCacheKey(effectiveAssignments),
      error: null,
    };
  } catch (e) {
    const effectiveAssignments = effectiveYuqingModelAssignments(emptySettings, env);
    return {
      d1Ready: true,
      source: "fallback",
      settings: emptySettings,
      effectiveAssignments,
      cacheKey: yuqingModelCacheKey(effectiveAssignments),
      error: String(e && e.message ? e.message : e),
    };
  }
}

function requestedModelForTarget(bodyIn, targetId) {
  const target = YUQING_MODEL_TARGET_MAP[targetId] || null;
  const direct = cleanModelId(bodyIn && bodyIn.modelId);
  if (direct) return direct;
  const maps = [
    bodyIn && bodyIn.modelAssignments,
    bodyIn && bodyIn.modelOverrides,
    bodyIn && bodyIn.models,
  ].filter((x) => x && typeof x === "object");
  for (const map of maps) {
    const byId = cleanModelId(map[targetId]);
    if (byId) return byId;
    if (target && map[target.kind] && typeof map[target.kind] === "object") {
      const nested = cleanModelId(map[target.kind][target.slot]);
      if (nested) return nested;
    }
  }
  return "";
}

function resolveYuqingModel(env, envelope, targetId, bodyIn) {
  const explicit = requestedModelForTarget(bodyIn, targetId);
  if (explicit) return { targetId, modelId: explicit, source: "request" };
  const assigned = cleanModelId(envelope && envelope.settings && envelope.settings.assignments && envelope.settings.assignments[targetId]);
  if (assigned) return { targetId, modelId: assigned, source: "d1" };
  const target = YUQING_MODEL_TARGET_MAP[targetId] || null;
  const modelId = defaultModelForTarget(env, target);
  return { targetId, modelId, source: envSlotModel(env, target && target.envSlot) ? "env" : "default" };
}

function yuqingModelSettingsResponse(env, envelope) {
  const box = envelope || {
    d1Ready: false,
    source: "fallback",
    settings: normalizeYuqingModelSettings(null),
    effectiveAssignments: {},
    cacheKey: "",
    error: null,
  };
  const effective = box.effectiveAssignments || effectiveYuqingModelAssignments(box.settings, env);
  return {
    ok: true,
    workerBuild: WORKER_BUILD,
    d1Ready: box.d1Ready,
    source: box.source,
    catalog: YUQING_MODEL_CATALOG,
    targets: YUQING_MODEL_TARGETS,
    settings: box.settings,
    effective,
    warning: box.error || null,
  };
}

function reportId(kind, generatedAt) {
  const stamp = String(generatedAt || new Date().toISOString()).replace(/[^0-9TZ]/g, "").slice(0, 16);
  let suffix = "";
  try {
    suffix = crypto.randomUUID().slice(0, 8);
  } catch (_) {
    suffix = Math.random().toString(36).slice(2, 10);
  }
  return `${kind}:${stamp}:${suffix}`;
}

function decodeReportRow(row) {
  if (!row) return null;
  const grounding = safeJsonParse(row.grounding_json || row.groundingJson, {});
  const report = safeJsonParse(row.report_json || row.reportJson, {});
  const costEstimate =
    (grounding && grounding.costEstimate && typeof grounding.costEstimate === "object" ? grounding.costEstimate : null) ||
    (report && report.costEstimate && typeof report.costEstimate === "object" ? report.costEstimate : null);
  return {
    id: String(row.id || ""),
    kind: String(row.kind || ""),
    reportDate: String(row.report_date || row.reportDate || ""),
    slot: String(row.slot || ""),
    triggerType: String(row.trigger_type || row.triggerType || ""),
    generatedAt: String(row.generated_at || row.generatedAt || ""),
    status: String(row.status || "ready"),
    sourceRefs: safeJsonParse(row.source_refs_json || row.sourceRefsJson, []),
    grounding,
    costEstimate,
    marketSnapshot: safeJsonParse(row.market_snapshot_json || row.marketSnapshotJson, {}),
    report,
    quality: report && report.quality ? report.quality : grounding && grounding.quality ? grounding.quality : {},
    sourceErrors: safeJsonParse(row.source_errors_json || row.sourceErrorsJson, []),
  };
}

async function insertYuqingReport(db, payload) {
  await db
    .prepare(
      `INSERT OR REPLACE INTO yuqing_reports
       (id, kind, report_date, slot, trigger_type, generated_at, status, source_refs_json, grounding_json, market_snapshot_json, report_json, source_errors_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      payload.id,
      payload.kind,
      payload.reportDate,
      payload.slot,
      payload.triggerType,
      payload.generatedAt,
      payload.status || "ready",
      safeJsonStringify(payload.sourceRefs, []),
      safeJsonStringify(payload.grounding, {}),
      safeJsonStringify(payload.marketSnapshot, {}),
      safeJsonStringify(payload.report, {}),
      safeJsonStringify(payload.sourceErrors, []),
    )
    .run();
}

async function loadLatestYuqingReport(db, kind) {
  const row = await db
    .prepare(`SELECT * FROM yuqing_reports WHERE kind = ? ORDER BY generated_at DESC LIMIT 1`)
    .bind(kind)
    .first();
  return decodeReportRow(row);
}

async function loadYuqingReportById(db, id) {
  const row = await db.prepare(`SELECT * FROM yuqing_reports WHERE id = ? LIMIT 1`).bind(String(id || "")).first();
  return decodeReportRow(row);
}

async function deleteYuqingReportById(db, id) {
  const sid = String(id || "").trim();
  if (!sid) return { deleted: 0 };
  const res = await db.prepare(`DELETE FROM yuqing_reports WHERE id = ?`).bind(sid).run();
  const meta = res && res.meta ? res.meta : {};
  return { deleted: Number(meta.changes || 0) };
}

async function loadYuqingReportHistory(db, kind, days) {
  const d = Math.min(30, Math.max(1, Number(days) || REPORT_RETENTION_DAYS));
  const cutoff = new Date(Date.now() - d * 86400000).toISOString();
  const res = await db
    .prepare(`SELECT * FROM yuqing_reports WHERE kind = ? AND generated_at >= ? ORDER BY generated_at DESC LIMIT 80`)
    .bind(kind, cutoff)
    .all();
  return ((res && res.results) || []).map(decodeReportRow).filter(Boolean);
}

async function pruneYuqingReports(db, days = REPORT_RETENTION_DAYS) {
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  await db.prepare(`DELETE FROM yuqing_reports WHERE generated_at < ?`).bind(cutoff).run();
}

function reportListSummary(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    reportDate: row.reportDate,
    slot: row.slot,
    triggerType: row.triggerType,
    generatedAt: row.generatedAt,
    status: row.status,
    title: row.report && (row.report.title || row.report.headline || row.report.summaryTitle),
    quality: row.report && row.report.quality ? row.report.quality : row.grounding && row.grounding.quality,
    costEstimate: row.costEstimate || (row.grounding && row.grounding.costEstimate) || null,
  };
}

function sourceRefsFromFacts(items, max = 10) {
  return (items || []).slice(0, max).map((it) => ({
    type: "fact",
    id: it.id || "",
    label: it.title || it.source || "事实条目",
    source: it.source || "",
    category: it.category || "",
    url: it.url || "",
  }));
}

function uniqueSourceRows(items) {
  const map = new Map();
  for (const it of items || []) {
    const key = String(it.source || it.sourceType || "Unknown");
    const cur = map.get(key) || {
      name: key,
      type: it.sourceType || it.category || "fact_pool",
      reliability: Number(it.confidence || 0) >= 0.75 ? "高" : Number(it.confidence || 0) >= 0.55 ? "中高" : "中",
      count: 0,
      url: it.url || "",
    };
    cur.count += 1;
    if (!cur.url && it.url) cur.url = it.url;
    map.set(key, cur);
  }
  return [...map.values()].slice(0, 8);
}

function itemDateLabel(ts) {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return "";
  return new Date(n).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
}

function marketApiBase(env) {
  const raw = env && env.BIT_DATA_API_BASE ? String(env.BIT_DATA_API_BASE) : DEFAULT_MARKET_API_BASE;
  return raw.replace(/\/$/, "");
}

async function fetchJsonOptional(url, timeoutMs = 12_000, headers = {}) {
  try {
    const res = await fetchWithTimeout(url, { headers: { Accept: "application/json", ...headers } }, timeoutMs);
    const text = await res.text();
    const data = text ? safeJsonParse(text, null) : null;
    if (!res.ok) return { ok: false, status: res.status, error: data && (data.error || data.message) ? String(data.error || data.message) : text.slice(0, 180) };
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: String(e && e.message ? e.message : e) };
  }
}

function compactMarketEndpoint(key, result) {
  if (!result || !result.ok) return result;
  const data = result.data || {};
  if (key === "chart") {
    return {
      url: result.url,
      ok: true,
      status: result.status,
      data: {
        schemaVersion: data.schemaVersion || null,
        asKnownMode: data.asKnownMode || "system_observed",
        pricePathAvailable: data.pricePathAvailable === true,
        tradingNarrative: data.tradingNarrative === true,
        venue: data.venue || null,
        instrumentId: data.instrumentId || null,
        observedAt: data.observedAt || null,
        coverage: data.coverage || null,
        gap: data.gap || null,
        quality: data.quality || null,
      },
    };
  }
  if (key === "klines") {
    if (data.schemaVersion && data.scope === "chart") {
      return compactMarketEndpoint("chart", result);
    }
    return {
      url: result.url,
      ok: true,
      status: result.status,
      data: {
        omitted: true,
        pricePathAvailable: false,
        reason: "legacy klines compact refused; use desk chart",
      },
    };
  }
  if (key === "heatmap" || key === "liquidations") {
    if (data.byExchange && typeof data.byExchange === "object") {
      const exchanges = Object.keys(data.byExchange);
      const byExchange = {};
      for (const ex of exchanges) {
        const g = data.byExchange[ex] || {};
        byExchange[ex] = {
          exchange: g.exchange || ex,
          longNotional: Number(g.longNotional) || 0,
          shortNotional: Number(g.shortNotional) || 0,
          buckets: Array.isArray(g.buckets) ? g.buckets.length : 0,
        };
      }
      return {
        url: result.url,
        ok: true,
        status: result.status,
        data: {
          schemaVersion: data.schemaVersion || null,
          combinedTotalsForbidden: true,
          exchanges,
          byExchange,
          note: data.note || null,
        },
      };
    }
    return {
      url: result.url,
      ok: true,
      status: result.status,
      data: {
        schemaVersion: data.schemaVersion || null,
        combinedTotalsForbidden: true,
        omittedCombinedTotals: true,
        reason: "legacy mixed liquidation rows refused; desk heatmap must split by exchange",
      },
    };
  }
  if (key === "context" || key === "derivatives") {
    if (data.scope === "context" || data.groups) {
      return {
        url: result.url,
        ok: true,
        status: result.status,
        data: {
          schemaVersion: data.schemaVersion || null,
          asKnownMode: data.asKnownMode || "system_observed",
          tradingNarrative: false,
          contractUnavailable: !!(data.contract && data.contract.unavailable),
          groups: data.groups ? Object.keys(data.groups) : [],
        },
      };
    }
    return {
      url: result.url,
      ok: true,
      status: result.status,
      data: {
        symbol: data.symbol,
        range: data.range,
        generatedAt: data.generatedAt,
        dataFreshness: data.dataFreshness || null,
        analysisMatrix: data.analysisMatrix || null,
        sourceHealthSummary: data.sourceHealthSummary || null,
      },
    };
  }
  if (key === "orderflow") {
    return {
      url: result.url,
      ok: true,
      status: result.status,
      data: {
        schemaVersion: data.schemaVersion || null,
        venue: data.venue || null,
        instrumentId: data.instrumentId || null,
        coverage: data.coverage || null,
        gap: data.gap || null,
        quality: data.quality || null,
        seriesCount: Array.isArray(data.series) ? data.series.length : 0,
      },
    };
  }
  if (key === "derivativesSnapshot") {
    return {
      url: result.url,
      ok: true,
      status: result.status,
      data: {
        omitted: true,
        legacy: true,
        authority: "/api/desk/context",
        reason: "legacy compact snapshot omitted from analysis input",
      },
    };
  }
  return result;
}

async function fetchMarketContext(env) {
  const base = marketApiBase(env);
  const endpoints = {
    chart: `${base}/api/desk/chart?interval=1h`,
    context: `${base}/api/desk/context`,
    heatmap: `${base}/api/desk/heatmap?range=24h`,
    orderflow: `${base}/api/desk/orderflow?symbol=BTCUSDT`,
    derivatives: `${base}/api/desk/context`,
  };
  const entries = await Promise.all(
    Object.entries(endpoints).map(async ([key, url]) => [
      key,
      compactMarketEndpoint(key, { url, ...(await fetchJsonOptional(url, 15_000, accessServiceHeaders(env))) }),
    ]),
  );
  const byKey = Object.fromEntries(entries);
  const errors = Object.entries(byKey)
    .filter(([, v]) => !v.ok)
    .map(([key, v]) => ({ source: key, message: v.error || `HTTP ${v.status}` }));
  const chart = (byKey.chart && byKey.chart.data) || {};
  const pricePathAvailable = chart.pricePathAvailable === true;
  return {
    ok: errors.length === 0,
    base,
    generatedAt: new Date().toISOString(),
    endpoints,
    data: byKey,
    errors,
    pricePathAvailable,
    tradingNarrativeForbidden: !pricePathAvailable,
  };
}

function shouldUseIncrementalSearch(input) {
  const reasons = [];
  const factCount = Number(input && input.factCount) || 0;
  const dailyAgeMs = Number(input && input.dailyAgeMs) || 0;
  const marketErrors = Array.isArray(input && input.marketErrors) ? input.marketErrors : [];
  if (!input || !input.dailyReport) reasons.push("事件日报缺失");
  if (dailyAgeMs > 15 * 3600 * 1000) reasons.push("上游日报超过 15 小时");
  if (factCount < 18) reasons.push("事实池条目不足");
  if (marketErrors.length) reasons.push("市场快照存在缺口");
  if (input && input.forceSearch) reasons.push("用户强制增量搜索");
  return { useSearch: reasons.length > 0, reasons };
}

const RL_WINDOW_MS = 60 * 1000;

async function checkRateLimit(request, tier, limit) {
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown";
  const cacheKeyUrl = `https://yuqing-rl-internal/${tier}/${ip}`;
  const now = Date.now();
  try {
    const cached = await caches.default.match(cacheKeyUrl);
    let win = { start: now, count: 1 };
    if (cached) {
      const data = await cached.json();
      if (now - data.start <= RL_WINDOW_MS) {
        if (data.count >= limit) {
          return json(
            { ok: false, error: `请求过于频繁（${tier}），请稍后重试。` },
            429,
          );
        }
        win = { start: data.start, count: data.count + 1 };
      }
    }
    await caches.default.put(
      cacheKeyUrl,
      new Response(JSON.stringify(win), { headers: { "Cache-Control": "max-age=60" } }),
    );
  } catch (_) {}
  return null;
}

/** ---- 数据源 ---- */

function fngLabel(v) {
  const n = Number(v) || 0;
  if (n <= 24) return "极度恐慌";
  if (n <= 44) return "恐慌";
  if (n <= 55) return "中性";
  if (n <= 75) return "贪婪";
  return "极度贪婪";
}

async function fetchFng() {
  const url = ALT_FNG + "?limit=1&format=json";
  const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`FNG HTTP ${res.status}`);
  const j = await res.json();
  const item = j && Array.isArray(j.data) ? j.data[0] : null;
  if (!item) throw new Error("FNG empty");
  const value = parseInt(item.value, 10);
  return {
    ok: true,
    value,
    label: fngLabel(value),
    updatedAt: new Date().toISOString(),
    rawClassification: item.value_classification || null,
  };
}

async function fetchBtcUsd() {
  const url =
    COINGECKO_BTC + "?ids=bitcoin&vs_currencies=usd&include_24hr_change=true";
  const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`CoinGecko BTC HTTP ${res.status}`);
  const j = await res.json();
  const b = j && j.bitcoin;
  if (!b) throw new Error("CoinGecko BTC empty");
  const priceUsd = Number(b.usd);
  const ch = b.usd_24h_change;
  const changePct =
    ch != null && Number.isFinite(Number(ch)) ? Number(Number(ch).toFixed(4)) : null;
  return {
    ok: true,
    priceUsd: Number.isFinite(priceUsd) ? Number(priceUsd.toFixed(4)) : null,
    change24hPct: changePct,
    source: "coingecko",
    updatedAt: new Date().toISOString(),
  };
}

/** Yahoo Chart 为非官方数据源，仅作 CoinGecko 失败时的回填。 */
async function fetchBtcUsdYahoo() {
  const url =
    "https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?interval=1d&range=5d";
  const res = await fetchWithTimeout(url, {
    headers: { Accept: "application/json", "User-Agent": "yuqing-worker/1.1 (+cf)" },
  });
  if (!res.ok) throw new Error(`Yahoo BTC HTTP ${res.status}`);
  const j = await res.json();
  const r = j && j.chart && j.chart.result && j.chart.result[0];
  const meta = r && r.meta;
  if (!meta || meta.regularMarketPrice == null) throw new Error("Yahoo BTC empty meta");
  const priceUsd = Number(meta.regularMarketPrice);
  const prev = meta.chartPreviousClose != null ? Number(meta.chartPreviousClose) : null;
  let changePct =
    prev != null && Number.isFinite(prev) && prev !== 0 ? ((priceUsd - prev) / prev) * 100 : null;
  if (changePct != null && Number.isFinite(changePct)) changePct = Number(changePct.toFixed(4));
  return {
    ok: true,
    priceUsd: Number.isFinite(priceUsd) ? Number(priceUsd.toFixed(4)) : null,
    change24hPct: changePct,
    source: "yahoo",
    updatedAt: new Date().toISOString(),
  };
}

async function fetchFinnhubBulkQuotes(env, symbols) {
  const token = env && env.FINNHUB_API_KEY;
  if (!token) throw new Error("FINNHUB_API_KEY 未配置");
  const uniq = [...new Set(symbols.map(String))].filter(Boolean);
  const tasks = uniq.map(async (sym) => {
    const url = `${FINNHUB_ORIGIN}/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(token)}`;
    try {
      const r = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
      const j = await r.json().catch(() => null);
      if (!r.ok) return [sym, { ok: false, error: String((j && j.error) || r.status), symbol: sym }];
      return [
        sym,
        {
          ok: true,
          symbol: sym,
          price: j && j.c != null ? Number(Number(j.c).toFixed(4)) : null,
          changePct: j && j.dp != null ? Number(Number(j.dp).toFixed(4)) : null,
        },
      ];
    } catch (e) {
      return [sym, { ok: false, error: String(e && e.message ? e.message : e), symbol: sym }];
    }
  });
  const entries = await Promise.all(tasks);
  return Object.fromEntries(entries);
}

const ASSET_ROWS = [
  { name: "纳指", symbol: "QQQ", yahooSymbol: "QQQ", label: "纳斯达克100 ETF" },
  { name: "标普500", symbol: "SPY", yahooSymbol: "SPY", label: "标普500 ETF" },
  { name: "英伟达", symbol: "NVDA", yahooSymbol: "NVDA", label: "英伟达" },
  { name: "黄金", symbol: "GLD", yahooSymbol: "GLD", label: "黄金ETF" },
];

const MARKET_MOVE_ROWS = [
  { name: "比特币", symbol: "BTC", yahooSymbol: "BTC-USD", label: "Bitcoin USD" },
  ...ASSET_ROWS,
];

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundNumber(value, digits = 4) {
  const n = finiteNumber(value);
  return n == null ? null : Number(n.toFixed(digits));
}

function pctChange(latest, base) {
  const a = finiteNumber(latest);
  const b = finiteNumber(base);
  if (a == null || b == null || b === 0) return null;
  return roundNumber(((a - b) / b) * 100, 4);
}

function fmtPctForPrompt(value) {
  const n = finiteNumber(value);
  if (n == null) return "缺失";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function jsonNumberForPrompt(value) {
  const n = finiteNumber(value);
  return n == null ? "null" : String(roundNumber(n, 4));
}

function chartPointsFromYahoo(data) {
  const r = data && data.chart && data.chart.result && data.chart.result[0];
  const timestamps = r && Array.isArray(r.timestamp) ? r.timestamp : [];
  const closes = r && r.indicators && r.indicators.quote && r.indicators.quote[0] && r.indicators.quote[0].close;
  const rows = [];
  if (!Array.isArray(closes)) return rows;
  for (let i = 0; i < timestamps.length && i < closes.length; i += 1) {
    const close = finiteNumber(closes[i]);
    const t = finiteNumber(timestamps[i]);
    if (close == null || t == null) continue;
    rows.push({ t: t * 1000, close });
  }
  rows.sort((a, b) => a.t - b.t);
  return rows;
}

function closeAtOrBefore(points, targetT) {
  const target = finiteNumber(targetT);
  if (!Array.isArray(points) || !points.length || target == null) return null;
  let picked = null;
  for (const p of points) {
    if (p.t <= target) picked = p;
    else break;
  }
  return picked;
}

function movesFromChartPoints(points) {
  if (!Array.isArray(points) || points.length < 2) return { h24: null, d3: null, d7: null };
  const latest = points[points.length - 1];
  const windows = {
    h24: 24 * 3600 * 1000,
    d3: 3 * 24 * 3600 * 1000,
    d7: 7 * 24 * 3600 * 1000,
  };
  const out = {};
  for (const [key, ms] of Object.entries(windows)) {
    const base = closeAtOrBefore(points, latest.t - ms);
    out[key] = base ? pctChange(latest.close, base.close) : null;
  }
  return out;
}

async function fetchYahooAssetMove(row) {
  const url = `${YAHOO_CHART_ORIGIN}/${encodeURIComponent(row.yahooSymbol)}?interval=1h&range=10d`;
  const res = await fetchWithTimeout(url, {
    headers: { Accept: "application/json", "User-Agent": "yuqing-worker/1.4 (+cf)" },
  }, FETCH_TIMEOUT_SOURCES_MS);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Yahoo Chart ${row.yahooSymbol} HTTP ${res.status}`);
  const points = chartPointsFromYahoo(data);
  if (points.length < 2) throw new Error(`Yahoo Chart ${row.yahooSymbol} points insufficient`);
  const latest = points[points.length - 1];
  const meta = data && data.chart && data.chart.result && data.chart.result[0] && data.chart.result[0].meta;
  const price = finiteNumber(meta && meta.regularMarketPrice) ?? latest.close;
  const moves = movesFromChartPoints(points);
  return {
    ok: true,
    name: row.name,
    symbol: row.symbol,
    dataSymbol: row.yahooSymbol,
    label: row.label || row.symbol,
    price: roundNumber(price, 4),
    moves,
    latestAt: new Date(latest.t).toISOString(),
    source: "yahoo_chart_1h",
    points: points.length,
  };
}

async function fetchBtcD1AssetMove(env) {
  const url = `${marketApiBase(env)}/api/desk/chart?interval=1h`;
  const res = await fetchWithTimeout(url, {
    headers: { Accept: "application/json", "User-Agent": "yuqing-worker/1.4 (+cf)" },
  }, FETCH_TIMEOUT_SOURCES_MS);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`BTC desk chart HTTP ${res.status}`);
  if (!data || data.pricePathAvailable !== true) throw new Error("BTC desk has no authoritative price path");
  const rows = data && Array.isArray(data.series) ? data.series : [];
  const points = rows
    .map((row) => ({ t: finiteNumber(row.t), close: finiteNumber(row.c) }))
    .filter((row) => row.t != null && row.close != null)
    .sort((a, b) => a.t - b.t);
  if (points.length < 25) throw new Error(`BTC D1 1h points insufficient: ${points.length}`);
  const latest = points[points.length - 1];
  const moves = movesFromChartPoints(points);
  return {
    ok: true,
    name: "比特币",
    symbol: "BTC",
    dataSymbol: "BTCUSDT",
    label: "BTCUSDT 1h D1",
    price: roundNumber(latest.close, 4),
    moves,
    latestAt: new Date(latest.t).toISOString(),
    source: "bitdesk_d1_1h",
    points: points.length,
  };
}

function fallbackAssetMove(row, finnhubQuotes, btc) {
  if (row.name === "比特币") {
    const h24 = btc && btc.ok ? roundNumber(btc.change24hPct, 4) : null;
    return {
      ok: h24 != null || (btc && btc.priceUsd != null),
      name: row.name,
      symbol: row.symbol,
      dataSymbol: row.yahooSymbol,
      label: row.label || row.symbol,
      price: btc && btc.priceUsd != null ? roundNumber(btc.priceUsd, 4) : null,
      moves: { h24, d3: null, d7: null },
      latestAt: btc && btc.updatedAt ? btc.updatedAt : new Date().toISOString(),
      source: btc && btc.source ? `${btc.source}_fallback` : "btc_fallback",
      error: btc && btc.error ? btc.error : "historical series unavailable",
    };
  }
  const q = finnhubQuotes && finnhubQuotes[row.symbol] ? finnhubQuotes[row.symbol] : null;
  const h24 = q && q.ok ? roundNumber(q.changePct, 4) : null;
  return {
    ok: h24 != null || (q && q.price != null),
    name: row.name,
    symbol: row.symbol,
    dataSymbol: row.yahooSymbol,
    label: row.label || row.symbol,
    price: q && q.price != null ? roundNumber(q.price, 4) : null,
    moves: { h24, d3: null, d7: null },
    latestAt: new Date().toISOString(),
    source: "finnhub_quote_fallback",
    error: q && q.error ? q.error : "historical series unavailable",
  };
}

async function fetchAssetMoveRows(env, finnhubQuotes, btc) {
  const rows = await Promise.all(
    MARKET_MOVE_ROWS.map(async (row) => {
      if (row.name === "比特币") {
        try {
          return await fetchBtcD1AssetMove(env);
        } catch (d1Error) {
          try {
            return await fetchYahooAssetMove(row);
          } catch (yahooError) {
            const fallback = fallbackAssetMove(row, finnhubQuotes, btc);
            return {
              ...fallback,
              error: `D1:${String(d1Error && d1Error.message ? d1Error.message : d1Error)}；Yahoo:${String(yahooError && yahooError.message ? yahooError.message : yahooError)}`,
            };
          }
        }
      }
      try {
        return await fetchYahooAssetMove(row);
      } catch (e) {
        const fallback = fallbackAssetMove(row, finnhubQuotes, btc);
        return {
          ...fallback,
          error: String(e && e.message ? e.message : e),
        };
      }
    }),
  );
  return rows;
}

function marketMoveLineFromData(realMarketData) {
  const mk = realMarketData || {};
  return MARKET_MOVE_ROWS.map((row) => {
    const item = mk[row.name] || {};
    const moves = item.moves || {};
    return `${row.name}(${item.symbol || row.symbol}) 24h ${fmtPctForPrompt(moves.h24 ?? item.change)} / 3d ${fmtPctForPrompt(moves.d3)} / 7d ${fmtPctForPrompt(moves.d7)}`;
  }).join("；");
}

function buildRealMarketData(finnhubQuotes, btc, assetMoves = []) {
  const moveByName = Object.fromEntries((assetMoves || []).map((row) => [row.name, row]));
  const mk = {};
  for (const row of MARKET_MOVE_ROWS) {
    const move = moveByName[row.name] || null;
    const fallback = fallbackAssetMove(row, finnhubQuotes, btc);
    const src = move || fallback;
    const h24 = src && src.moves ? src.moves.h24 : null;
    mk[row.name] = {
      symbol: row.symbol,
      dataSymbol: row.yahooSymbol,
      label: row.label || row.symbol,
      change: h24 != null ? String(h24) : "数据缺失",
      price: src && src.price != null ? String(src.price) : "数据缺失",
      moves: {
        h24: src && src.moves ? src.moves.h24 : null,
        d3: src && src.moves ? src.moves.d3 : null,
        d7: src && src.moves ? src.moves.d7 : null,
      },
      source: src && src.source ? src.source : "missing",
      ok: !!(src && src.ok),
      latestAt: src && src.latestAt ? src.latestAt : null,
    };
  }
  for (const row of ASSET_ROWS) {
    const q = finnhubQuotes[row.symbol];
    if (mk[row.name] && mk[row.name].price === "数据缺失" && q && q.ok && q.price != null) {
      mk[row.name].price = String(q.price);
    }
  }
  if (mk["比特币"] && mk["比特币"].price === "数据缺失" && btc && btc.ok && btc.priceUsd != null) {
    mk["比特币"].price = String(btc.priceUsd);
  }
  return mk;
}

async function aggregateSources(env) {
  const errors = [];
  let fng = { ok: false, value: null, label: "", updatedAt: null, error: null };
  try {
    fng = { ...(await fetchFng()), error: null };
  } catch (e) {
    fng.ok = false;
    fng.error = String(e && e.message ? e.message : e);
    errors.push({ source: "fng", message: fng.error });
    fng = { ok: false, value: null, label: "", updatedAt: null, error: fng.error };
  }

  let btcCgErr = null;
  let btc = { ok: false, priceUsd: null, change24hPct: null, source: "coingecko", error: null };
  try {
    btc = { ...(await fetchBtcUsd()), error: null };
  } catch (e) {
    btcCgErr = String(e && e.message ? e.message : e);
    btc = { ok: false, priceUsd: null, change24hPct: null, source: "coingecko", error: btcCgErr };
  }
  if (!btc.ok || btc.priceUsd == null) {
    try {
      const y = await fetchBtcUsdYahoo();
      btc = { ...y, error: null };
      if (btcCgErr) {
        errors.push({ source: "btc", message: `CoinGecko：${btcCgErr}（已降级 Yahoo Chart，非官方）` });
      }
    } catch (eY) {
      const yMsg = String(eY && eY.message ? eY.message : eY);
      if (btcCgErr) errors.push({ source: "btc", message: `CoinGecko：${btcCgErr}；Yahoo：${yMsg}` });
      else errors.push({ source: "btc", message: yMsg });
      btc = { ok: false, priceUsd: null, change24hPct: null, source: "coingecko", error: yMsg };
    }
  }

  const assetSymbols = ASSET_ROWS.map((r) => r.symbol);
  let finQuotes = {};
  try {
    finQuotes = await fetchFinnhubBulkQuotes(env, assetSymbols);
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    errors.push({ source: "finnhub", message: msg });
    for (const s of assetSymbols) finQuotes[s] = { ok: false, error: msg, symbol: s };
  }

  const assetMoves = await fetchAssetMoveRows(env, finQuotes, btc);
  const failedMoveRows = assetMoves.filter((row) => !row.ok || row.error);
  if (failedMoveRows.length) {
    errors.push({
      source: "asset_history",
      message: failedMoveRows.map((row) => `${row.name}:${row.error || "series incomplete"}`).join("；").slice(0, 500),
    });
  }

  const assets = assetMoves.map((row) => ({
    name: row.name,
    symbol: row.symbol,
    dataSymbol: row.dataSymbol,
    price: row.price,
    changePct: row.moves && row.moves.h24 != null ? row.moves.h24 : null,
    change3dPct: row.moves && row.moves.d3 != null ? row.moves.d3 : null,
    change7dPct: row.moves && row.moves.d7 != null ? row.moves.d7 : null,
    source: row.source,
    ok: !!row.ok,
    error: row.ok ? undefined : row.error || "history missing",
  }));

  const mkData = buildRealMarketData(finQuotes, btc, assetMoves);
  return {
    sources: {
      fng,
      btc,
      assets,
      assetMoves,
      errors,
    },
    realMarketData: mkData,
  };
}

/** ---- Prompts（由原 ribao-cloudflare/index.html 迁入） ---- */

function buildFlashPrompt(timeStr, fngScore, fngClass, realMarketData) {
  const bt = "```";
  const mkData = realMarketData;
  const moveLine = marketMoveLineFromData(mkData);
  return (
    "当前时间：" +
    timeStr +
    "。\n" +
    "今日恐慌贪婪指数：" +
    fngScore +
    "（" +
    fngClass +
    "）。\n\n" +
    "【真实行情数据（Worker 基于 1h 历史序列计算，不是 quote 单点）】\n" +
    moveLine +
    "\n\n" +
    "使用规则：24h 只代表短线冲击，3d 代表短线延续，7d 代表背景趋势；不要把单日异动误判为趋势。\n" +
    "阅读建议只能指导今天先重点阅读哪些事件，禁止输出买入、卖出、加仓、减仓等投资建议。\n\n" +
    "---\n\n" +
    "请基于以上数据，输出以下JSON块（仅供代码解析，前后不要有任何说明文字）：\n\n" +
    bt +
    "json\n" +
    "{\n" +
    '  "sentiment_summary": "结合恐慌指数与涨跌幅，一句话描述今日市场整体情绪状态（20字内）",\n' +
    '  "market_regime": "今日风险偏好状态，从以下选一并输出中文：追逐风险 / 回避风险 / 结构分化 / 防御轮动",\n' +
    '  "key_assets": [\n' +
    "    {\n" +
    '      "name": "纳指",\n' +
    '      "change": ' +
    jsonNumberForPrompt(mkData["纳指"].moves && mkData["纳指"].moves.h24) +
    ",\n" +
    '      "h24": ' +
    jsonNumberForPrompt(mkData["纳指"].moves && mkData["纳指"].moves.h24) +
    ",\n" +
    '      "d3": ' +
    jsonNumberForPrompt(mkData["纳指"].moves && mkData["纳指"].moves.d3) +
    ",\n" +
    '      "d7": ' +
    jsonNumberForPrompt(mkData["纳指"].moves && mkData["纳指"].moves.d7) +
    ",\n" +
    '      "catalyst": "【新闻催化】直接驱动本次涨跌的具体事件或数据（一句话，30字内）",\n' +
    '      "structure": "【结构判断】这个涨跌是强化还是打破原有趋势？机构资金方向有何信号？（一句话，35字内）"\n' +
    "    },\n" +
    "    {\n" +
    '      "name": "标普500",\n' +
    '      "change": ' +
    jsonNumberForPrompt(mkData["标普500"].moves && mkData["标普500"].moves.h24) +
    ",\n" +
    '      "h24": ' +
    jsonNumberForPrompt(mkData["标普500"].moves && mkData["标普500"].moves.h24) +
    ",\n" +
    '      "d3": ' +
    jsonNumberForPrompt(mkData["标普500"].moves && mkData["标普500"].moves.d3) +
    ",\n" +
    '      "d7": ' +
    jsonNumberForPrompt(mkData["标普500"].moves && mkData["标普500"].moves.d7) +
    ",\n" +
    '      "catalyst": "直接驱动事件（30字内）",\n' +
    '      "structure": "趋势结构与机构信号（35字内）"\n' +
    "    },\n" +
    "    {\n" +
    '      "name": "英伟达",\n' +
    '      "change": ' +
    jsonNumberForPrompt(mkData["英伟达"].moves && mkData["英伟达"].moves.h24) +
    ",\n" +
    '      "h24": ' +
    jsonNumberForPrompt(mkData["英伟达"].moves && mkData["英伟达"].moves.h24) +
    ",\n" +
    '      "d3": ' +
    jsonNumberForPrompt(mkData["英伟达"].moves && mkData["英伟达"].moves.d3) +
    ",\n" +
    '      "d7": ' +
    jsonNumberForPrompt(mkData["英伟达"].moves && mkData["英伟达"].moves.d7) +
    ",\n" +
    '      "catalyst": "直接驱动事件（30字内）",\n' +
    '      "structure": "趋势结构与机构信号（35字内）"\n' +
    "    },\n" +
    "    {\n" +
    '      "name": "比特币",\n' +
    '      "change": ' +
    jsonNumberForPrompt(mkData["比特币"].moves && mkData["比特币"].moves.h24) +
    ",\n" +
    '      "h24": ' +
    jsonNumberForPrompt(mkData["比特币"].moves && mkData["比特币"].moves.h24) +
    ",\n" +
    '      "d3": ' +
    jsonNumberForPrompt(mkData["比特币"].moves && mkData["比特币"].moves.d3) +
    ",\n" +
    '      "d7": ' +
    jsonNumberForPrompt(mkData["比特币"].moves && mkData["比特币"].moves.d7) +
    ",\n" +
    '      "catalyst": "直接驱动事件（30字内）",\n' +
    '      "structure": "趋势结构与机构信号（35字内）"\n' +
    "    },\n" +
    "    {\n" +
    '      "name": "黄金",\n' +
    '      "change": ' +
    jsonNumberForPrompt(mkData["黄金"].moves && mkData["黄金"].moves.h24) +
    ",\n" +
    '      "h24": ' +
    jsonNumberForPrompt(mkData["黄金"].moves && mkData["黄金"].moves.h24) +
    ",\n" +
    '      "d3": ' +
    jsonNumberForPrompt(mkData["黄金"].moves && mkData["黄金"].moves.d3) +
    ",\n" +
    '      "d7": ' +
    jsonNumberForPrompt(mkData["黄金"].moves && mkData["黄金"].moves.d7) +
    ",\n" +
    '      "catalyst": "直接驱动事件（30字内）",\n' +
    '      "structure": "趋势结构与机构信号（35字内）"\n' +
    "    }\n" +
    "  ],\n" +
    '  "cross_asset": "跨资产关联解读：以3d为主轴，结合24h冲击与7d背景，判断风险偏好、资金流向和资产背离（60字内）",\n' +
    '  "anomaly_alert": "定价背离/异动预警：指出哪个资产表现出了不合理的Alpha异动，揭示定价逻辑的断裂（例如黄金脱离实际利率锚定），并简述其潜在含义。若无明显异动，输出「无明显背离」。（50字内）",\n' +
    '  "action_suggestion": "阅读建议：指出今天阅读事件时应优先关注哪类线索，禁止写交易动作。（40字内）"\n' +
    "}\n" +
    bt +
    "\n"
  );
}

function buildProNewsPrompt(timeStr, fngScore, fngClass, realMarketData) {
  const mkData = realMarketData;
  const bt = "```";
  const moveLine = marketMoveLineFromData(mkData);
  return (
    "当前时间：" +
    timeStr +
    "。\n" +
    "今日恐慌贪婪指数：" +
    fngScore +
    "（" +
    fngClass +
    "）。\n" +
    "主要资产多周期涨跌（Worker 历史序列计算；24h=短线冲击，3d=短线延续，7d=背景趋势）：\n" +
    moveLine +
    "\n" +
    "请把这些数字作为事件筛选背景，不要把单日 quote 异动误判为趋势，不要输出交易建议。\n" +
    "---\n\n" +
    "请使用Google Search工具搜集最新资讯，并严格按照以下 JSON 格式输出，不要带有前缀和解释，请仅输出一个 JSON 块：\n\n" +
    "【结构要求】\n" +
    "输出必须包含三个字段：topStories（头条事件，1~3条）、dynamicBriefs（动态速览，必须5条）、macroTrend（宏观趋势总结）。\n\n" +
    "## 1. topStories (今日头条)\n" +
    "执行双轨搜索：\n" +
    "一轨（72小时热点）：过去72小时内影响最大的宏观/科技/地缘事件。\n" +
    "二轨（一周时间重量级）：若过去一周内存在重量级程度明显碾压所有72小时新闻的事件（标准：千亿级以上市值公司战略级发布、国家级政策转向、系统性金融风险、头部科技公司年度大会、地缘政治危机），优先纳入并标注[持续追踪]。\n\n" +
    "【条数判断规则】萃取今日最核心的 1~3 条高价值事件。若今日仅有 1-2 件真正的大事，果断只返回 1-2 条，坚决不拿次要新闻凑数；读者的时间极度宝贵，宁缺毋滥。若事实不足，不强行补齐 3 条，也不要输出脚手架解释。\n\n" +
    "对于每一个头条对象，包含以下字段：\n" +
    '- "category"：事件类别，必须使用中文，如 [地缘政治] / [宏观经济] / [科技产业] / [加密市场] / [企业动态] / [政策监管]\n' +
    '- "title"：事件核心标题\n' +
    '- "fact"：一句话说明事件时间、人物、动作和影响\n' +
    '- "structure"：包含三个字段的对象：\n' +
    '  - "trigger"：简述表面诱因\n' +
    '  - "conflict"：简述深层矛盾\n' +
    '  - "divergence"：交叉对比各方的官方声明与其实际行动\n' +
    '- "impacts"：受影响资产数组（通常1-3个），每个对象包含：\n' +
    '  - "asset"：资产名称（必须使用中文，如 "比特币", "纳指", "美元", "黄金" 等）\n' +
    '  - "direction"：利多/利空/震荡（必须是 "up", "down", 或 "shock" 之一）\n' +
    '  - "logic"：传导逻辑预判（一句话说明为什么）\n' +
    '- "nextWatch"：一句话说明后续观察什么数据或事件节点\n\n' +
    "## 2. dynamicBriefs (动态速览)\n" +
    "**【第一步：强制搜索】** 执行双轨检索：\n" +
    "- 24小时轨：Google News国际头条、X/Twitter热搜话题、TechCrunch/华尔街日报科技财经版。至少获取8条候选。\n" +
    "- 72小时重量级轨：若存在过去24-72小时内发生的重量级事件（资产冲击力评分预估≥8分），允许纳入候选池并标注[持续追踪]。\n\n" +
    "**【第二步：去重与打分】** 对候选新闻评估资产价格潜在冲击力、社交热度和时效性，挑选出5条。\n\n" +
    "对于每一个速览对象，包含以下字段：\n" +
    '- "category"：类别\n' +
    '- "title"：事件标题\n' +
    '- "body"：一句话说明具体发生了什么\n' +
    '- "description"：补充主体、动作和影响\n' +
    '- "analysis"：说明可能影响与后续验证信号，不出现具体时间窗口标签\n\n' +
    "## 3. macroTrend (宏观趋势总结)\n" +
    "一段话概括上述新闻共同指向的近期宏观结构性变化。\n\n" +
    bt + "json\n" +
    "{\n" +
    '  "topStories": [\n' +
    "    {\n" +
    '      "category": "...",\n' +
    '      "title": "...",\n' +
    '      "fact": "...",\n' +
    '      "structure": {\n' +
    '        "trigger": "...",\n' +
    '        "conflict": "...",\n' +
    '        "divergence": "..."\n' +
    "      },\n" +
    '      "impacts": [\n' +
    '        { "asset": "...", "direction": "up", "logic": "..." }\n' +
    "      ],\n" +
    '      "nextWatch": "..."\n' +
    "    }\n" +
    "  ],\n" +
    '  "dynamicBriefs": [\n' +
    "    {\n" +
    '      "category": "...",\n' +
    '      "title": "...",\n' +
    '      "body": "...",\n' +
    '      "description": "...",\n' +
    '      "analysis": "..."\n' +
    "    }\n" +
    "  ],\n" +
    '  "macroTrend": "..."\n' +
    "}\n" +
    bt + "\n"
  );
}

function buildProTrendsPrompt(newsText, timelineText, aiText, flashDataJsonText, scope = "full") {
  const flashContext = flashDataJsonText
    ? scope === "daily_event_above_trend"
      ? "\n【模块一：市场温度计 / 风险偏好（dashboard JSON，与事件一览温度卡同源）】\n" + flashDataJsonText + "\n"
      : "\n【基础市场行情状态（供参考）】\n" + flashDataJsonText + "\n"
    : "";
  const newsBlock = "\n【今日头条】\n" + (newsText || "（暂无）");
  const timelineBlock = "\n【动态速览】\n" + (timelineText || "（暂无）");
  const aiBlock =
    scope === "daily_event_above_trend"
      ? ""
      : "\n【AI情报站】\n" + (aiText || "（暂无）");
  const head =
    scope === "daily_event_above_trend"
      ? "下列内容来自「事件一览」同一次生成流水线中、页面展示顺序上位于「趋势线索」**之上**且**已经产出**的三块：市场温度计（dashboard JSON）、今日头条、动态速览。你是趋势编辑，必须**只根据这三块**做二次综合；不得引用、猜测或依赖尚未提供的「AI 情报站」等其他模块；不得联网检索。\n"
      : "这是今日已生成的其他模块内容，请仔细阅读分析：";
  const bridge =
    scope === "daily_event_above_trend"
      ? "\n\n---\n基于**以上三节**（温度计 JSON、今日头条、动态速览），请直接输出以下三部分（不要带有前缀和解释，不需要额外搜索）：\n\n"
      : "\n\n---\n基于以上全部内容，请直接输出以下三部分（不要带有前缀和解释，不需要额外搜索）：\n\n";
  return (
    head +
    flashContext +
    newsBlock +
    timelineBlock +
    aiBlock +
    bridge +
    "### 📶 正在强化的信号\n\n" +
    "哪些趋势在过去0-72小时内得到了新的数据/事件确认，正在变得更加确定？评估时注意区分：这是真正的范式转移信号，还是短期均值回归噪音？（2-3条，每条必须独立成段，段落间留空行）\n\n" +
    "### ⚡ 正在裂变的信号\n\n" +
    "哪些此前普遍接受的判断，正在被新出现的数据或事件所挑战？重点关注叙事与资金面/基本面出现背离的领域。（1-2条，每条必须独立成段，无则明确说明「暂无明显裂变信号」）\n\n" +
    "### 🎯 0-72小时观察清单\n\n" +
    "围绕最近72小时内已经出现的事件，有哪些具体事件、数据发布或价格节点值得继续盯住？给出3-5个具体的观察项，格式必须是：\n\n" +
    "- **事件/数据名称**：观察什么？若结果是X，意味着Y，市场将如何反应。若结果是Z，意味着W，市场将如何反应。\n\n" +
    "（每一项作为列表的一项，步骤不可拆分换行）"
  );
}

/** AI 情报站：Gemini + Google Search，输出结构化 JSON（与事件一览 renderDailyAi 对齐）。 */
function buildProAIJsonPrompt(timeStr) {
  const bt = "```";
  return (
    "当前时间：" +
    timeStr +
    "。\n" +
    "请使用 Google Search 工具检索最新可核验资讯，并**仅输出一个 JSON 代码块**（不要前缀说明、不要 Markdown 报告体）。\n\n" +
    "【受众】关注 AI 工具与日常可用性的普通用户；重点在「新了什么」「对我有什么用」，少堆参数。\n\n" +
    "【检索规则——与 ribao 一致】\n" +
    "1) 仅纳入可指向近 72 小时内公开来源的信息；严禁用训练记忆里的旧闻凑数。\n" +
    "2) 优先：Anthropic / OpenAI / Google(Gemini 等) / Meta / xAI / Mistral / 苹果 AI / 微软 Copilot 等有**可核验新动作**才写。\n" +
    "3) 次要：Cursor、Perplexity、OpenClaw 等热门工具在 72h 内的**新增量**（版本、功能、社区玩法）；无新增量则不写。\n" +
    "4) 若 72h 内无满足条件的条目：`aiIntel` 输出空数组 `[]`。\n\n" +
    "【输出 schema】顶层对象仅含 `aiIntel` 数组；每条含字段：\n" +
    '- "title"：短标题\n' +
    '- "date"：发布日期（如 2026年5月5日 或 ISO 日期）\n' +
    '- "what"：一句话「新了什么」\n' +
    '- "use"：一句话「对我有什么用」\n' +
    '- "attention"：只能是「高」「中」「低」之一\n' +
    '- "sourceName"：媒体或官方来源名\n' +
    '- "sourceUrl"：可选，有可核验链接则填写\n\n' +
    "条数：**3～6 条**；若无达标新闻则 `aiIntel`: []。\n\n" +
    bt +
    "json\n" +
    "{\n" +
    '  "aiIntel": [\n' +
    "    {\n" +
    '      "title": "...",\n' +
    '      "date": "...",\n' +
    '      "what": "...",\n' +
    '      "use": "...",\n' +
    '      "attention": "高",\n' +
    '      "sourceName": "...",\n' +
    '      "sourceUrl": ""\n' +
    "    }\n" +
    "  ]\n" +
    "}\n" +
    bt +
    "\n"
  );
}

/** ---- Gemini ---- */

function getGeminiKey(env) {
  return env && (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) ? String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY) : "";
}

function resolveProvider(env) {
  const hasExplicit = env && env.YUQING_LLM_PROVIDER != null && String(env.YUQING_LLM_PROVIDER).trim() !== "";
  const raw = hasExplicit ? String(env.YUQING_LLM_PROVIDER).trim().toLowerCase() : "auto";
  if (raw === "auto") return getGeminiKey(env) ? "gemini" : "none";
  if (!raw || raw === "none" || raw === "off" || raw === "disable") return "none";
  if (raw === "gemini" || raw === "google") return "gemini";
  return raw;
}

function flashModel(env) {
  return envSlotModel(env, "flash") || YUQING_GEMINI_MODEL_DEFAULT;
}

function proseModel(env, mode) {
  const defFlash = flashModel(env);
  const pro = envSlotModel(env, "prose");
  const isFast = String(mode || "").toLowerCase() === "fast";
  if (isFast) return envSlotModel(env, "fast_prose") || defFlash;
  return pro || defFlash || YUQING_GEMINI_MODEL_DEFAULT;
}

function trendsModel(env, mode) {
  const t = envSlotModel(env, "trends");
  return t || proseModel(env, mode);
}

function geminiGenerateBody(prompt, opts) {
  const useSearch = !!(opts && opts.googleSearch);
  /** @type {any} */
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: opts && opts.temperature != null ? opts.temperature : useSearch ? 0.35 : 0.1,
    },
  };
  if (useSearch) {
    /** @see Google GenAI tools */
    body.tools = [{ google_search: {} }];
  }
  return body;
}

function geminiCandidateText(payload) {
  const parts =
    payload &&
    payload.candidates &&
    payload.candidates[0] &&
    payload.candidates[0].content &&
    payload.candidates[0].content.parts;
  if (!Array.isArray(parts)) return "";
  let out = "";
  for (const p of parts) {
    if (p && p.text) out += p.text;
  }
  return out;
}

function geminiApiErrorMessage(payload, fallbackText) {
  return payload && payload.error
    ? String(payload.error.message || payload.error.status || JSON.stringify(payload.error))
    : String(fallbackText || "").slice(0, 200);
}

function yuqingUsdCnyRate(env) {
  const raw = env && env.YUQING_COST_USD_CNY != null ? Number(env.YUQING_COST_USD_CNY) : 7;
  return Number.isFinite(raw) && raw > 0 ? raw : 7;
}

function yuqingGeminiPricing(modelId, promptTokens) {
  const id = String(modelId || "").toLowerCase();
  const over200k = Number(promptTokens || 0) > 200000;
  const exact = YUQING_MODEL_PRICING[id];
  const row =
    exact ||
    (id.includes("3.1-pro")
      ? YUQING_MODEL_PRICING["gemini-3.1-pro-preview"]
      : id.includes("3.1-flash-lite")
        ? YUQING_MODEL_PRICING["gemini-3.1-flash-lite"]
        : id.includes("2.5-pro")
          ? YUQING_MODEL_PRICING["gemini-2.5-pro"]
          : id.includes("2.5-flash-lite")
            ? YUQING_MODEL_PRICING["gemini-2.5-flash-lite"]
            : id.includes("2.5-flash")
              ? YUQING_MODEL_PRICING["gemini-2.5-flash"]
              : id.includes("gemini-3")
                ? YUQING_MODEL_PRICING["gemini-3-flash-preview"]
                : null);
  const pick = (value) => (value && typeof value === "object" ? (over200k ? value.over200k : value.underOrEqual200k) : value);
  if (row) {
    return {
      pricingModelId: exact ? id : "family_fallback",
      inputPer1mUsd: pick(row.inputPer1mUsd),
      outputPer1mUsd: pick(row.outputPer1mUsd),
      searchPer1kUsd: row.searchPer1kUsd,
      searchBilling: row.searchBilling,
    };
  }
  return { pricingModelId: "estimated_unknown_gemini", inputPer1mUsd: 0.5, outputPer1mUsd: 3, searchPer1kUsd: 14, searchBilling: "estimated_search_query" };
}

function geminiMetadataForCost(payload) {
  const candidate = payload && payload.candidates && payload.candidates[0] ? payload.candidates[0] : {};
  const grounding = candidate.groundingMetadata || candidate.grounding_metadata || payload?.groundingMetadata || payload?.grounding_metadata || {};
  const queries = Array.isArray(grounding.webSearchQueries)
    ? grounding.webSearchQueries
    : Array.isArray(grounding.web_search_queries)
      ? grounding.web_search_queries
      : [];
  const chunks = Array.isArray(grounding.groundingChunks)
    ? grounding.groundingChunks
    : Array.isArray(grounding.grounding_chunks)
      ? grounding.grounding_chunks
      : [];
  const supports = Array.isArray(grounding.groundingSupports)
    ? grounding.groundingSupports
    : Array.isArray(grounding.grounding_supports)
      ? grounding.grounding_supports
      : [];
  return {
    usage: payload && (payload.usageMetadata || payload.usage_metadata) ? payload.usageMetadata || payload.usage_metadata : {},
    webSearchQueries: [...new Set(queries.map((q) => String(q || "").trim()).filter(Boolean))],
    groundingChunkCount: chunks.length,
    groundingSupportCount: supports.length,
  };
}

function geminiCostEntry(env, modelId, opts, payload) {
  const meta = geminiMetadataForCost(payload);
  const usage = meta.usage || {};
  const promptTokens = Number(usage.promptTokenCount || usage.prompt_token_count || 0) || 0;
  const candidateTokens = Number(usage.candidatesTokenCount || usage.candidates_token_count || 0) || 0;
  const thoughtsTokens = Number(usage.thoughtsTokenCount || usage.thoughts_token_count || 0) || 0;
  const outputTokens = candidateTokens + thoughtsTokens;
  const totalTokens = Number(usage.totalTokenCount || usage.total_token_count || promptTokens + outputTokens) || 0;
  const googleSearch = !!(opts && opts.googleSearch);
  const pricing = yuqingGeminiPricing(modelId, promptTokens);
  const queryCount = meta.webSearchQueries.length;
  const hasGrounding = queryCount > 0 || meta.groundingChunkCount > 0 || meta.groundingSupportCount > 0;
  const billableSearchUnits = googleSearch
    ? pricing.searchBilling === "grounded_prompt"
      ? 1
      : Math.max(1, queryCount)
    : 0;
  const inputUsd = (promptTokens / 1000000) * pricing.inputPer1mUsd;
  const outputUsd = (outputTokens / 1000000) * pricing.outputPer1mUsd;
  const searchUsd = (billableSearchUnits / 1000) * pricing.searchPer1kUsd;
  const totalUsd = inputUsd + outputUsd + searchUsd;
  const usdCny = yuqingUsdCnyRate(env);
  return {
    provider: "gemini",
    model: String(modelId || ""),
    targetId: opts && opts.targetId ? String(opts.targetId) : "",
    module: opts && opts.costModule ? String(opts.costModule) : "",
    googleSearch,
    hasGrounding,
    usage: { promptTokens, outputTokens, candidateTokens, thoughtsTokens, totalTokens },
    search: {
      billing: pricing.searchBilling,
      queryCount,
      billableUnits: billableSearchUnits,
      webSearchQueries: meta.webSearchQueries.slice(0, 12),
      groundingChunkCount: meta.groundingChunkCount,
      groundingSupportCount: meta.groundingSupportCount,
    },
    pricing: { ...pricing, usdCny, source: "gemini_api_pricing_snapshot_2026-05-11" },
    costUsd: Number(totalUsd.toFixed(6)),
    costCny: Number((totalUsd * usdCny).toFixed(4)),
    inputCostUsd: Number(inputUsd.toFixed(6)),
    outputCostUsd: Number(outputUsd.toFixed(6)),
    searchCostUsd: Number(searchUsd.toFixed(6)),
    searchCostCny: Number((searchUsd * usdCny).toFixed(4)),
    estimated: true,
  };
}

function createYuqingCostTracker() {
  const calls = [];
  return {
    add(entry) {
      if (entry && typeof entry === "object") calls.push(entry);
    },
    summary() {
      const totals = calls.reduce(
        (acc, c) => {
          acc.callCount += 1;
          acc.searchCallCount += c.googleSearch ? 1 : 0;
          acc.searchQueryCount += Number(c.search && c.search.queryCount) || 0;
          acc.billableSearchUnits += Number(c.search && c.search.billableUnits) || 0;
          acc.promptTokens += Number(c.usage && c.usage.promptTokens) || 0;
          acc.outputTokens += Number(c.usage && c.usage.outputTokens) || 0;
          acc.totalTokens += Number(c.usage && c.usage.totalTokens) || 0;
          acc.totalUsd += Number(c.costUsd) || 0;
          acc.totalCny += Number(c.costCny) || 0;
          acc.searchUsd += Number(c.searchCostUsd) || 0;
          acc.searchCny += Number(c.searchCostCny) || 0;
          return acc;
        },
        { callCount: 0, searchCallCount: 0, searchQueryCount: 0, billableSearchUnits: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0, totalUsd: 0, totalCny: 0, searchUsd: 0, searchCny: 0 },
      );
      const usdCnyRate = calls.reduce((rate, c) => {
        if (rate) return rate;
        const v = Number(c && c.pricing && c.pricing.usdCny);
        return Number.isFinite(v) && v > 0 ? v : 0;
      }, 0) || 7;
      const totalCny = Number(totals.totalCny.toFixed(4));
      const searchCny = Number(totals.searchCny.toFixed(4));
      return {
        ...totals,
        totalUsd: Number(totals.totalUsd.toFixed(6)),
        totalCny,
        totalCostCny: totalCny,
        searchUsd: Number(totals.searchUsd.toFixed(6)),
        searchCny,
        searchCostCny: searchCny,
        searchQueries: totals.searchQueryCount,
        usdCnyRate: Number(usdCnyRate.toFixed(4)),
        currency: "CNY",
        estimated: true,
        note: "Google Search grounding 的网页正文 token 不可见；搜索费按 Gemini grounding 计费单位估算。",
        calls: calls.slice(),
      };
    },
  };
}

async function geminiGenerateContent(env, modelId, prompt, opts) {
  const key = getGeminiKey(env);
  if (!key) throw new Error("GEMINI_API_KEY / GOOGLE_API_KEY 未配置");
  if (opts && typeof opts.streamText === "function") {
    return geminiStreamGenerateContent(env, modelId, prompt, opts);
  }

  const body = geminiGenerateBody(prompt, opts);
  const url =
    GEMINI_ORIGIN +
    `/v1beta/models/${encodeURIComponent(modelId)}:generateContent` +
    `?key=` +
    encodeURIComponent(key);

  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  }, FETCH_TIMEOUT_LLM_MS);

  const textRaw = await res.text();
  /** @type {any} */
  let j = null;
  try {
    j = textRaw ? JSON.parse(textRaw) : null;
  } catch (_) {
    j = null;
  }

  if (!res.ok) {
    throw new Error(`Gemini HTTP ${res.status}: ${geminiApiErrorMessage(j, textRaw)}`);
  }

  const out = geminiCandidateText(j);
  if (!out) throw new Error("Gemini 返回无 candidates/parts");
  if (opts && typeof opts.usageSink === "function") {
    try {
      opts.usageSink(geminiCostEntry(env, modelId, opts, j));
    } catch (_) {}
  }
  return out.trim();
}

async function geminiStreamGenerateContent(env, modelId, prompt, opts) {
  const key = getGeminiKey(env);
  if (!key) throw new Error("GEMINI_API_KEY / GOOGLE_API_KEY 未配置");
  const body = geminiGenerateBody(prompt, opts);
  const url =
    GEMINI_ORIGIN +
    `/v1beta/models/${encodeURIComponent(modelId)}:streamGenerateContent` +
    `?alt=sse&key=` +
    encodeURIComponent(key);
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), Math.max(FETCH_TIMEOUT_LLM_MS, Number(opts && opts.timeoutMs) || 0));
  const emit = typeof opts.streamText === "function" ? opts.streamText : () => {};
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const textRaw = await res.text().catch(() => "");
      let j = null;
      try {
        j = textRaw ? JSON.parse(textRaw) : null;
      } catch (_) {
        j = null;
      }
      throw new Error(`Gemini HTTP ${res.status}: ${geminiApiErrorMessage(j, textRaw)}`);
    }

    const reader = res.body && res.body.getReader ? res.body.getReader() : null;
    if (!reader) throw new Error("Gemini 流式响应不可读");

    const dec = new TextDecoder();
    let buf = "";
    let out = "";
    let lastCostPayload = null;
    let lastGroundingPayload = null;
    const consumeLine = (line) => {
      const trimmed = String(line || "").trim();
      if (!trimmed) return;
      const payloadText = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
      if (!payloadText || payloadText === "[DONE]" || (!payloadText.startsWith("{") && !payloadText.startsWith("["))) return;
      let payload = null;
      try {
        payload = JSON.parse(payloadText);
      } catch (_) {
        return;
      }
      if (payload && (payload.usageMetadata || payload.usage_metadata)) lastCostPayload = payload;
      const c0 = payload && payload.candidates && payload.candidates[0] ? payload.candidates[0] : null;
      if (c0 && (c0.groundingMetadata || c0.grounding_metadata)) lastGroundingPayload = payload;
      const delta = geminiCandidateText(payload);
      if (!delta) return;
      out += delta;
      try {
        emit(delta, { modelId, length: out.length });
      } catch (_) {}
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        consumeLine(line);
      }
    }
    const tail = dec.decode();
    if (tail) buf += tail;
    if (buf.trim()) consumeLine(buf);
    if (!out) throw new Error("Gemini 流式响应无 candidates/parts");
    if (lastCostPayload && lastGroundingPayload && lastCostPayload !== lastGroundingPayload) {
      const groundingCandidate = lastGroundingPayload.candidates && lastGroundingPayload.candidates[0] ? lastGroundingPayload.candidates[0] : {};
      lastCostPayload = {
        ...lastCostPayload,
        candidates: [
          {
            ...((lastCostPayload.candidates && lastCostPayload.candidates[0]) || {}),
            groundingMetadata: groundingCandidate.groundingMetadata || groundingCandidate.grounding_metadata,
          },
        ],
      };
    }
    if (opts && typeof opts.usageSink === "function" && lastCostPayload) {
      try {
        opts.usageSink(geminiCostEntry(env, modelId, opts, lastCostPayload));
      } catch (_) {}
    }
    return out.trim();
  } finally {
    clearTimeout(tid);
  }
}

function makeDailyTextStreamer(streamSink, module, streamKey, label) {
  if (typeof streamSink !== "function") return null;
  let seq = 0;
  return (delta) => {
    const text = String(delta || "");
    if (!text) return;
    streamSink({
      type: "chunk",
      module,
      streamKey: streamKey || module,
      label: label || "",
      seq: ++seq,
      delta: text,
    });
  };
}

function extractJsonFence(text) {
  const s = String(text || "").trim();
  const m = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (m) return String(m[1] || "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) return s.slice(start, end + 1).trim();
  return s;
}

/** ---- 兜底 dashboard（无 LLM） ---- */

function fallbackDashboard(realMarketData, fngScore, fngClass) {
  const mkData = realMarketData;
  const keyAssets = MARKET_MOVE_ROWS.map((row) => {
    const item = mkData[row.name] || {};
    const moves = item.moves || {};
    return {
      name: row.name,
      symbol: row.symbol,
      change: moves.h24 ?? item.change,
      h24: moves.h24 ?? null,
      d3: moves.d3 ?? null,
      d7: moves.d7 ?? null,
      catalyst: "数据源已就绪；事件催化需启用 LLM 后生成。",
      structure: "多周期结构判断待 LLM 输出。",
    };
  });

  let regime = "结构分化";
  const q = Number(mkData["纳指"].change);
  const b = Number(mkData["比特币"].change);
  if (!Number.isNaN(q) && q > 0.5 && !Number.isNaN(b) && b > 0) regime = "追逐风险";
  if (!Number.isNaN(q) && q < -0.8) regime = "回避风险";

  return {
    sentimentSummary: `${fngClass}（${fngScore}），风险情绪需结合数据源与后续 LLM 研判。（非投资决策）`,
    marketRegime: regime,
    keyAssets,
    crossAsset:
      "多资产 24h/3d/7d 已计算；跨资产传导与背离解读在已配置 GEMINI_API_KEY 且 YUQING_LLM_PROVIDER 为 gemini 或 auto（默认）时由模型生成。",
    anomalyAlert: "无明显背离",
    actionSuggestion: "先看三日延续，再读今日事件。",
  };
}

function sectionsDisabledStatus(message) {
  return {
    markdown: "",
    items: [],
    status: "disabled",
    message: message || "LLM 未启用",
  };
}

async function buildReport(env, bodyIn) {
  const mode = String(bodyIn && bodyIn.mode ? bodyIn.mode : "deep").toLowerCase() === "fast" ? "fast" : "deep";
  const modules = {
    dashboard: true,
    news: true,
    timeline: true,
    ai: true,
    githubTools: true,
    trends: true,
    ...(bodyIn && bodyIn.modules && typeof bodyIn.modules === "object" ? bodyIn.modules : {}),
  };

  /** 默认 true（趋势综合含 AI 情报）。事件一览日报传 false：趋势仅综合「温度计 dashboard + 今日头条 + 动态速览」三块。 */
  const trendsUseAiIntel = !(bodyIn && bodyIn.trendsUseAiIntel === false);
  const dailyEventFocus = !!(bodyIn && bodyIn.dailyEventFocus);
  const dualHeadlineLanes = !!(bodyIn && bodyIn.dualHeadlineLanes);
  const trendsUseSearch = !!(bodyIn && bodyIn.trendsUseSearch);

  const force = !!(bodyIn && bodyIn.force);
  const generatedAt = new Date().toISOString();
  const timeStr = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });

  const agg = await aggregateSources(env);
  const { sources, realMarketData } = agg;

  const fngScore = sources.fng && sources.fng.ok ? Number(sources.fng.value) : 50;
  const fngClass =
    sources.fng && sources.fng.ok && sources.fng.label
      ? String(sources.fng.label)
      : fngLabel(fngScore);

  const provider = resolveProvider(env);
  const llmEnabled = provider === "gemini" && !!getGeminiKey(env);
  const llmStatus = {
    provider,
    enabled: llmEnabled,
    capabilities: { search: false, stream: false },
    models: { source: "fallback", d1Ready: d1Bound(env), effective: {}, used: {} },
  };

  const warnings = [];
  warnings.push({
    code: "notInvestmentAdvice",
    text: "本日报含模型生成内容，仅供信息整理与内部研究，不构成投资建议。",
  });

  const modelEnvelope = await readYuqingModelSettingsEnvelope(env);
  llmStatus.models = {
    source: modelEnvelope.source,
    d1Ready: modelEnvelope.d1Ready,
    effective: modelEnvelope.effectiveAssignments,
    used: {},
  };
  if (modelEnvelope.error) {
    warnings.push({ code: "model_channels_read", message: modelEnvelope.error });
  }
  const pickModel = (targetId) => {
    const resolved = resolveYuqingModel(env, modelEnvelope, targetId, bodyIn);
    llmStatus.models.used[targetId] = resolved;
    return resolved.modelId;
  };
  const costTracker = createYuqingCostTracker();
  const trackCost = (targetId, module) => (entry) => {
    costTracker.add({ ...entry, targetId, module });
  };

  let factRows = [];
  if (d1Bound(env)) {
    try {
      factRows = await loadRecentItems(env.YUQING_DB, 55);
    } catch (e) {
      warnings.push({ code: "d1_read", message: String(e && e.message ? e.message : e) });
    }
  }
  const groundingItemIds = factRows.slice(0, 48).map((r) => r.id);
  let usedSearchNews = false;
  let usedSearchAi = false;
  let usedSearchTrends = false;

  let cacheHit = false;
  const ttlSec = 600;

  if (!force) {
    const cacheUrl = new URL("https://yuqing-cache-internal/report");
    cacheUrl.searchParams.set("m", mode);
    cacheUrl.searchParams.set(
      "v",
      JSON.stringify({
        dashboard: modules.dashboard,
        news: modules.news,
        timeline: modules.timeline,
        ai: modules.ai,
        githubTools: modules.githubTools,
        trends: modules.trends,
        trendsUseAiIntel,
        trendsUseSearch,
        dailyEventFocus,
        dualHeadlineLanes,
        modelChannels: modelEnvelope.cacheKey,
      }),
    );
    const hit = await caches.default.match(new Request(cacheUrl.toString()));
    if (hit) {
      const j = await hit.json().catch(() => null);
      if (j && j.ok) {
        cacheHit = true;
        return {
          ...j,
          cache: { hit: true, ttlSec },
          generatedAt,
          workerBuild: WORKER_BUILD,
        };
      }
    }
  }

  let dashboard = fallbackDashboard(realMarketData, fngScore, fngClass);
  let flashDataJsonText = JSON.stringify(dashboard);
  let newsMd = "";
  let timelineMd = "";
  let aiMd = "";
  let githubToolsMd = "";
  let trendsMd = "";

  const sections = {
    news: { markdown: "", items: [], status: "planned", message: null },
    timeline: { markdown: "", items: [], status: "planned", message: null },
    ai: { markdown: "", status: "planned", message: null },
    githubTools: { markdown: "", status: "planned", message: null },
    trends: { markdown: "", status: "planned", message: null },
  };

  if (!llmEnabled) {
    sections.news = sectionsDisabledStatus("请在 Worker 设置 GEMINI_API_KEY（或 GOOGLE_API_KEY），并将 YUQING_LLM_PROVIDER 设为 gemini 或 auto（默认 auto：有密钥即启用）。");
    sections.timeline = sectionsDisabledStatus("同上。");
    sections.ai = { markdown: "", status: "disabled", message: "LLM 未启用", data: { aiIntel: [] } };
    sections.githubTools = { markdown: "", status: "disabled", message: "LLM 未启用", data: { githubTools: [] } };
    sections.trends = { markdown: "", status: "disabled", message: "LLM 未启用" };
  } else {
    const streamSink =
      dailyEventFocus && bodyIn && typeof bodyIn.__streamSink === "function" ? bodyIn.__streamSink : null;

    const runDashboardLlm =
      modules.dashboard &&
      (async () => {
        try {
          const prompt = dailyEventFocus
            ? buildDailyTemperaturePrompt(timeStr, fngScore, fngClass, realMarketData)
            : buildFlashPrompt(timeStr, fngScore, fngClass, realMarketData);
          const model = pickModel(dailyEventFocus ? "daily_event.dashboard" : "sentiment_analysis.dashboard");
          const targetId = dailyEventFocus ? "daily_event.dashboard" : "sentiment_analysis.dashboard";
          const text = await geminiGenerateContent(env, model, prompt, {
            targetId,
            costModule: "dashboard",
            temperature: 0.1,
            googleSearch: false,
            usageSink: trackCost(targetId, "dashboard"),
            streamText: dailyEventFocus ? makeDailyTextStreamer(streamSink, "temperature") : null,
          });
          const inner = extractJsonFence(text);
          const parsed = JSON.parse(inner);
          dashboard = {
            sentimentSummary: String(parsed.sentiment_summary || parsed.sentimentSummary || "").trim(),
            marketRegime: String(parsed.market_regime || parsed.marketRegime || "").trim(),
            keyAssets: Array.isArray(parsed.key_assets) ? parsed.key_assets : parsed.keyAssets || [],
            crossAsset: String(parsed.cross_asset || parsed.crossAsset || "").trim(),
            anomalyAlert: String(parsed.anomaly_alert || parsed.anomalyAlert || "").trim(),
            actionSuggestion: String(parsed.action_suggestion || parsed.actionSuggestion || "").trim(),
          };
          flashDataJsonText = JSON.stringify(dashboard);
          if (streamSink) {
            try {
              streamSink({
                type: "partial",
                module: "temperature",
                marketTemperature: buildDailyTemperature(sources, dashboard),
                dashboard: {
                  sentimentSummary: dashboard.sentimentSummary,
                  marketRegime: dashboard.marketRegime,
                  keyAssets: dashboard.keyAssets,
                  crossAsset: dashboard.crossAsset,
                  anomalyAlert: dashboard.anomalyAlert,
                  actionSuggestion: dashboard.actionSuggestion,
                },
              });
            } catch (_) {}
          }
        } catch (e) {
          warnings.push({ code: "dashboardLlm", message: String(e && e.message ? e.message : e) });
          dashboard = fallbackDashboard(realMarketData, fngScore, fngClass);
          flashDataJsonText = JSON.stringify(dashboard);
        }
      })();

    if (!dailyEventFocus) {
      if (runDashboardLlm) await runDashboardLlm;
    }

    const needMacro = modules.news || modules.timeline;
    const needAi = modules.ai;
    const needGithubTools = modules.githubTools;

    let dailyTopStories = [];
    let dailyBriefs = [];

    const macroP =
      !dailyEventFocus &&
      needMacro &&
      (async () => {
        try {
          usedSearchNews = true;
          const prompt = buildProNewsPrompt(timeStr, fngScore, fngClass, realMarketData);
          const targetId = "sentiment_analysis.news";
          const model = pickModel(targetId);
          const combined = await geminiGenerateContent(env, model, prompt, {
            targetId,
            costModule: "news",
            googleSearch: true,
            usageSink: trackCost(targetId, "news"),
          });
          const inner = extractJsonFence(combined);
          const parsed = JSON.parse(inner);
          const topStories = normalizeDailyTopStoryItems(parsed.topStories, []);
          const dynamicBriefs = normalizeDailyBriefItems(parsed.dynamicBriefs, []);
          const macroTrend = cleanText(parsed.macroTrend, "", 420);
          const macroPrefix = macroTrend ? `> **本轮趋势摘要：** ${macroTrend}\n\n` : "";
          newsMd = macroPrefix + renderDailyTopStoriesMarkdown(topStories);
          timelineMd = renderDailyBriefsMarkdown(dynamicBriefs);

          if (modules.news) {
            sections.news = {
              data: {
                topStories,
                dynamicBriefs,
                macroTrend: macroTrend
              },
              markdown: newsMd,
              items: topStories,
              status: "ready",
              message: null
            };
          } else sections.news = { markdown: "", items: [], status: "planned", message: "模块已关闭" };
          if (modules.timeline) {
            sections.timeline = {
              data: { dynamicBriefs },
              markdown: timelineMd,
              items: dynamicBriefs,
              status: "ready",
              message: null,
            };
          } else sections.timeline = { markdown: "", items: [], status: "planned", message: "模块已关闭" };
        } catch (e) {
          const msg = String(e && e.message ? e.message : e);
          warnings.push({ code: "macroLlm", message: msg });
          if (modules.news) sections.news = { markdown: "", items: [], status: "error", message: msg };
          if (modules.timeline) sections.timeline = { markdown: "", items: [], status: "error", message: msg };
        }
      })();

    const topStoriesP =
      dailyEventFocus &&
      modules.news &&
      (async () => {
        try {
          usedSearchNews = true;
          const targetId = "daily_event.news";
          const model = pickModel(targetId);
          let rawList = [];
          if (dualHeadlineLanes) {
            const [ra, rb] = await Promise.all([
              (async () => {
                const text = await geminiGenerateContent(env, model, buildDailyTopStoriesPrompt(timeStr), {
                  targetId,
                  costModule: "topStories.primary",
                  googleSearch: true,
                  temperature: 0.25,
                  usageSink: trackCost(targetId, "topStories.primary"),
                  streamText: makeDailyTextStreamer(streamSink, "topStories", "topStories.primary", "今日头条 · 主线"),
                });
                const inner = extractJsonFence(text);
                const parsed = JSON.parse(inner);
                return Array.isArray(parsed.topStories) ? parsed.topStories : [];
              })(),
              (async () => {
                const text = await geminiGenerateContent(env, model, buildDailyTopStoriesWirePrompt(timeStr), {
                  targetId,
                  costModule: "topStories.wire",
                  googleSearch: true,
                  temperature: 0.28,
                  usageSink: trackCost(targetId, "topStories.wire"),
                  streamText: makeDailyTextStreamer(streamSink, "topStories", "topStories.wire", "今日头条 · 快讯"),
                });
                const inner = extractJsonFence(text);
                const parsed = JSON.parse(inner);
                return Array.isArray(parsed.topStories) ? parsed.topStories : [];
              })(),
            ]);
            rawList = mergeTopStoryCandidatesForDaily(ra, rb);
          } else {
            const prompt = buildDailyTopStoriesPrompt(timeStr);
            const text = await geminiGenerateContent(env, model, prompt, {
              targetId,
              costModule: "topStories",
              googleSearch: true,
              temperature: 0.25,
              usageSink: trackCost(targetId, "topStories"),
              streamText: makeDailyTextStreamer(streamSink, "topStories"),
            });
            const inner = extractJsonFence(text);
            const parsed = JSON.parse(inner);
            rawList = Array.isArray(parsed.topStories) ? parsed.topStories : [];
          }
          dailyTopStories = normalizeDailyTopStoryItems(rawList, []);
          newsMd = renderDailyTopStoriesMarkdown(dailyTopStories);
          sections.news = {
            data: { topStories: dailyTopStories, dynamicBriefs: dailyBriefs, macroTrend: "" },
            markdown: newsMd,
            items: dailyTopStories,
            status: "ready",
            message: null,
          };
          if (streamSink) {
            try {
              streamSink({ type: "partial", module: "topStories", topStories: dailyTopStories, dualHeadlineLanes });
            } catch (_) {}
          }
        } catch (e) {
          const msg = String(e && e.message ? e.message : e);
          warnings.push({ code: "dailyTopStoriesLlm", message: msg });
          sections.news = { markdown: "", items: [], status: "error", message: msg };
        }
      })();

    const dailyBriefsP =
      dailyEventFocus &&
      modules.timeline &&
      (async () => {
        try {
          usedSearchNews = true;
          const prompt = buildDailyBriefsPrompt(timeStr);
          const targetId = "daily_event.timeline";
          const model = pickModel(targetId);
          const text = await geminiGenerateContent(env, model, prompt, {
            targetId,
            costModule: "dynamicBriefs",
            googleSearch: true,
            temperature: 0.3,
            usageSink: trackCost(targetId, "dynamicBriefs"),
            streamText: makeDailyTextStreamer(streamSink, "dynamicBriefs"),
          });
          const inner = extractJsonFence(text);
          const parsed = JSON.parse(inner);
          dailyBriefs = normalizeDailyBriefItems(parsed.dynamicBriefs, []);
          timelineMd = renderDailyBriefsMarkdown(dailyBriefs);
          sections.timeline = {
            data: { dynamicBriefs: dailyBriefs },
            markdown: timelineMd,
            items: dailyBriefs,
            status: "ready",
            message: null,
          };
          if (streamSink) {
            try {
              streamSink({ type: "partial", module: "dynamicBriefs", dynamicBriefs });
            } catch (_) {}
          }
        } catch (e) {
          const msg = String(e && e.message ? e.message : e);
          warnings.push({ code: "dailyBriefsLlm", message: msg });
          sections.timeline = { markdown: "", items: [], status: "error", message: msg };
        }
      })();

    const aiP =
      needAi &&
      (async () => {
        try {
          usedSearchAi = true;
          const prompt = dailyEventFocus ? buildDailyAiIntelPrompt(timeStr) : buildProAIJsonPrompt(timeStr);
          const targetId = dailyEventFocus ? "daily_event.ai" : "sentiment_analysis.ai";
          const model = pickModel(targetId);
          const text = await geminiGenerateContent(env, model, prompt, {
            targetId,
            costModule: "ai",
            googleSearch: true,
            temperature: 0.35,
            usageSink: trackCost(targetId, "ai"),
            streamText: dailyEventFocus ? makeDailyTextStreamer(streamSink, "aiIntel") : null,
          });
          const inner = extractJsonFence(text);
          const parsed = JSON.parse(inner);
          const aiIntelItems = normalizeDailyAiIntelItems(parsed.aiIntel);
          aiMd = renderDailyAiIntelMarkdownForTrends(aiIntelItems);
          sections.ai = {
            markdown: aiMd,
            data: { aiIntel: aiIntelItems },
            status: aiMd ? "ready" : "error",
            message: null,
          };
          if (streamSink && dailyEventFocus) {
            try {
              streamSink({ type: "partial", module: "aiIntel", aiIntel: aiIntelItems });
            } catch (_) {}
          }
        } catch (e) {
          const msg = String(e && e.message ? e.message : e);
          warnings.push({ code: "aiLlm", message: msg });
          sections.ai = { markdown: "", data: { aiIntel: [] }, status: "error", message: msg };
        }
      })();

    const githubToolsP =
      needGithubTools &&
      dailyEventFocus &&
      (async () => {
        try {
          usedSearchAi = true;
          const prompt = buildDailyGithubToolsPrompt(timeStr);
          const targetId = "daily_event.githubTools";
          const model = pickModel(targetId);
          const text = await geminiGenerateContent(env, model, prompt, {
            targetId,
            costModule: "githubTools",
            googleSearch: true,
            temperature: 0.32,
            usageSink: trackCost(targetId, "githubTools"),
            streamText: makeDailyTextStreamer(streamSink, "githubTools"),
          });
          const inner = extractJsonFence(text);
          const parsed = JSON.parse(inner);
          const githubTools = normalizeDailyGithubToolItems(parsed.githubTools);
          githubToolsMd = renderDailyGithubToolsMarkdownForTrends(githubTools);
          sections.githubTools = {
            markdown: githubToolsMd,
            data: { githubTools },
            status: githubToolsMd ? "ready" : "error",
            message: null,
          };
          if (streamSink) {
            try {
              streamSink({ type: "partial", module: "githubTools", githubTools });
            } catch (_) {}
          }
        } catch (e) {
          const msg = String(e && e.message ? e.message : e);
          warnings.push({ code: "githubToolsLlm", message: msg });
          sections.githubTools = { markdown: "", data: { githubTools: [] }, status: "error", message: msg };
        }
      })();

    const runTrends = async () => {
      try {
        const prompt = dailyEventFocus
          ? buildDailyTrendCluesPrompt(newsMd, timelineMd, aiMd, flashDataJsonText, githubToolsMd)
          : buildProTrendsPrompt(newsMd, timelineMd, aiMd, flashDataJsonText, trendsUseAiIntel ? "full" : "daily_event_above_trend");
        const targetId = dailyEventFocus ? "daily_event.trends" : "sentiment_analysis.trends";
        const trendSearchEnabled = dailyEventFocus ? true : trendsUseSearch;
        if (trendSearchEnabled) usedSearchTrends = true;
        const model = pickModel(targetId);
        trendsMd = await geminiGenerateContent(env, model, prompt, {
          targetId,
          costModule: "trends",
          googleSearch: trendSearchEnabled,
          temperature: 0.35,
          usageSink: trackCost(targetId, "trends"),
          streamText: dailyEventFocus ? makeDailyTextStreamer(streamSink, "trends") : null,
        });
        sections.trends = { markdown: trendsMd, status: trendsMd ? "ready" : "error", message: null };
        if (streamSink && dailyEventFocus) {
          try {
            const legacySnap = {
              sections: {
                trends: { markdown: trendsMd },
                news: { data: sections.news && sections.news.data },
              },
            };
            streamSink({
              type: "partial",
              module: "trends",
              trendRead: buildTrendReadFromDailyEventInputs(legacySnap, factRows.length),
            });
          } catch (_) {}
        }
      } catch (e) {
        const msg = String(e && e.message ? e.message : e);
        warnings.push({ code: "trendsLlm", message: msg });
        sections.trends = { markdown: "", status: "error", message: msg };
      }
    };

    if (dailyEventFocus) {
      await Promise.all([
        runDashboardLlm || Promise.resolve(),
        topStoriesP || Promise.resolve(),
        dailyBriefsP || Promise.resolve(),
        aiP || Promise.resolve(),
        githubToolsP || Promise.resolve(),
      ]);
      const macroTrend = dailyThemeFromStoriesAndBriefs(dailyTopStories, dailyBriefs);
      if (modules.news && sections.news.status === "ready") {
        sections.news.data = { topStories: dailyTopStories, dynamicBriefs: dailyBriefs, macroTrend };
      }
      if (streamSink) {
        try {
          streamSink({
            type: "partial",
            module: "digest",
            macroTrend,
            topStories: [...dailyTopStories],
            dynamicBriefs: [...dailyBriefs],
          });
        } catch (_) {}
      }
      if (modules.trends) await runTrends();
    } else if (!trendsUseAiIntel && modules.trends && needMacro) {
      await (macroP || Promise.resolve());
      await Promise.all([runTrends(), aiP || Promise.resolve()]);
    } else {
      await Promise.all([macroP || Promise.resolve(), aiP || Promise.resolve()]);
      if (modules.trends) await runTrends();
    }

    if (!modules.trends) {
      sections.trends = { markdown: "", status: "planned", message: "模块已关闭" };
    }

    if (!needMacro) {
      sections.news = { markdown: "", items: [], status: "planned", message: "模块已关闭" };
      sections.timeline = { markdown: "", items: [], status: "planned", message: "模块已关闭" };
    }
    if (!needAi) {
      sections.ai = { markdown: "", status: "planned", message: "模块已关闭", data: { aiIntel: [] } };
    }
    if (!needGithubTools) {
      sections.githubTools = { markdown: "", status: "planned", message: "模块已关闭", data: { githubTools: [] } };
    }
    llmStatus.capabilities.search = !!(usedSearchNews || usedSearchAi || usedSearchTrends);
    if (streamSink) llmStatus.capabilities.stream = true;
  }

  const costEstimate = costTracker.summary();
  const out = {
    ok: true,
    workerBuild: WORKER_BUILD,
    generatedAt,
    mode,
    cache: { hit: cacheHit, ttlSec },
    d1Ready: d1Bound(env),
    grounding: {
      factCount: factRows.length,
      itemIdsSample: groundingItemIds,
      usedSearch: { news: usedSearchNews, ai: usedSearchAi, trends: usedSearchTrends },
    },
    sources: {
      fng: sources.fng,
      btc: sources.btc,
      assets: sources.assets,
      errors: sources.errors,
    },
    llmStatus,
    costEstimate,
    dashboard: {
      sentimentSummary: dashboard.sentimentSummary,
      marketRegime: dashboard.marketRegime,
      keyAssets: dashboard.keyAssets,
      crossAsset: dashboard.crossAsset,
      anomalyAlert: dashboard.anomalyAlert,
      actionSuggestion: dashboard.actionSuggestion,
    },
    sections,
    warnings,
  };

  if (d1Bound(env)) {
    try {
      await env.YUQING_DB.prepare(
        `INSERT INTO yuqing_report_runs (generated_at, run_type, mode, grounding_json, report_json) VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(
          generatedAt,
          "on_demand",
          mode,
          JSON.stringify(out.grounding),
          JSON.stringify({ dashboard: out.dashboard, sections: out.sections, llmStatus: out.llmStatus, costEstimate: out.costEstimate }),
        )
        .run();
    } catch (_) {}
  }

  if (!force) {
    try {
      const cacheUrl = new URL("https://yuqing-cache-internal/report");
      cacheUrl.searchParams.set("m", mode);
      cacheUrl.searchParams.set(
        "v",
        JSON.stringify({
          dashboard: modules.dashboard,
          news: modules.news,
          timeline: modules.timeline,
          ai: modules.ai,
          githubTools: modules.githubTools,
          trends: modules.trends,
          trendsUseAiIntel,
          trendsUseSearch,
          dailyEventFocus,
          dualHeadlineLanes,
        }),
      );
      await caches.default.put(
        new Request(cacheUrl.toString()),
        new Response(JSON.stringify(out), {
          headers: { "Cache-Control": `max-age=${ttlSec}` },
        }),
      );
    } catch (_) {}
  }

  return out;
}

async function loadFactsBundle(env, limit = 70) {
  const factRows = d1Bound(env) ? await loadRecentItems(env.YUQING_DB, limit).catch(() => []) : [];
  const nonAiFacts = factRows.filter((r) => String(r.category || "").toUpperCase() !== "AI");
  const aiFacts = filterAiFactsFromNewsItems(factRows);
  return { factRows, nonAiFacts, aiFacts };
}

function dailyStoryFromFact(primary) {
  return {
    category: primary.category || "综合事件",
    title: primary.title || "未命名事件",
    fact: itemSummary(primary),
    structure: {
      trigger: `来源：${primary.source || primary.sourceType || "事实池"}`,
      conflict: primary.url ? "已保留原文链接，适合继续核对。" : "事实池未提供可跳转原文，需降低置信度。",
      divergence: "继续关注官方口径、市场价格与资金流是否同向确认。"
    },
    impacts: [
      { asset: "BTC", direction: "shock", logic: "事件影响被纳入现有定价，相关资产维持震荡消化。" }
    ],
    nextWatch: "若出现新的官方确认或数据冲击，主题资产短线重新定价。",
    sourceName: primary.source || primary.sourceType || "Yuqing D1",
    sourceUrl: primary.url || "",
  };
}

function dailyTopStoriesFromFacts(rows) {
  const out = [];
  for (const it of (rows || []).slice(0, 3)) {
    out.push(dailyStoryFromFact(it));
  }
  if (!out.length) {
    out.push({
      category: "综合事件",
      title: "等待高价值事件更新",
      fact: "当前事实池尚未形成足够明确的跨资产事件主线。",
      structure: {
        trigger: "优先等待官方来源、金融日历和主流新闻源补充。",
        conflict: "无",
        divergence: "无"
      },
      impacts: [
        { asset: "BTC", direction: "shock", logic: "市场继续由行情与资金流主导。" }
      ],
      nextWatch: "关注增量信息。",
      sourceName: "Yuqing D1",
      sourceUrl: "",
    });
  }
  return out;
}

function dailyTopStoryFromFacts(rows) {
  return dailyTopStoriesFromFacts(rows)[0];
}

function dailyBriefsFromFacts(rows) {
  const out = [];
  const secondary = (rows || []).length > 3 ? (rows || []).slice(3, 8) : (rows || []).slice(0, 5);
  for (const it of secondary) {
    const analysis = it.url
      ? "后续重点看官方确认、主流媒体跟进和相关资产是否出现二次反应。"
      : "缺少原文时先降低权重，等待来源补强后再提高结论强度。";
    out.push({
      category: it.category || "综合",
      title: it.title || "未命名动态",
      body: itemSummary(it),
      description: itemSummary(it),
      analysis,
      watch: analysis,
      sourceName: it.source || it.sourceType || "",
      sourceUrl: it.url || "",
    });
  }
  if (!out.length) {
    out.push({
      category: "系统状态",
      title: "等待下一轮事实采集",
      body: "暂未出现新的次级事件。",
      description: "主要市场变量仍由行情、资金流和上一轮高价值事件延续影响。",
      analysis: "等待下一轮采集刷新后，再判断是否出现新的主题扩散。",
      watch: "等待下一轮采集刷新后，再判断是否出现新的主题扩散。",
      sourceName: "Yuqing Worker",
      sourceUrl: "",
    });
  }
  return out;
}

function dailyAiIntelFromFacts(rows) {
  const out = [];
  for (const it of (rows || []).slice(0, 4)) {
    out.push({
      title: it.title || "AI 动态",
      date: itemDateLabel(it.publishedAt || it.fetchedAt),
      what: itemSummary(it),
      use: "作为风险偏好和科技叙事背景，不直接替代市场结构判断。",
      attention: Number(it.confidence || 0) >= 0.7 ? "高" : "中",
      sourceName: it.source || it.sourceType || "",
      sourceUrl: it.url || "",
    });
  }
  if (!out.length) {
    out.push({
      title: "本期暂无高置信 AI 产业条目",
      date: new Date().toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }),
      what: "事实池没有命中明确 AI / 云平台 / 大模型工具链动态。",
      use: "不拿旧闻补位，等待下一轮采集。",
      attention: "低",
      sourceName: "Yuqing D1",
      sourceUrl: "",
    });
  }
  return out;
}

function dailyGithubToolsFromFacts() {
  return [
    {
      title: "等待 GitHub 工具雷达检索",
      repo: "",
      kind: "tool",
      target: "通用",
      date: new Date().toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }),
      whyUseful: "事实池不回填 GitHub 工具雷达；该模块依赖 Gemini + Google Search 实时检索 GitHub。",
      howToUse: "点击事件一览的实时扫描，等待 GitHub 工具雷达模块返回结果。",
      fit: "低",
      sourceName: "Yuqing Worker",
      sourceUrl: "",
    },
  ];
}

function trendMdSubstantiveLines(md) {
  return String(md || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
}

function buildDailyEventStreamingReport(generatedAt, opts = {}) {
  const triggerType = normalizeTriggerType(opts && opts.triggerType);
  const slot = opts && opts.slot ? String(opts.slot) : bjtSlotLabel(DAILY_EVENT_KIND, generatedAt);
  return {
    id: reportId(DAILY_EVENT_KIND, generatedAt),
    kind: DAILY_EVENT_KIND,
    reportDate: bjtDateKey(generatedAt),
    slot,
    triggerType,
    generatedAt,
    status: "streaming",
    sourceRefs: [],
    grounding: {
      startedAt: generatedAt,
      quality: { factCount: 0, sourceCoverage: 0, usedSearch: !!(opts && opts.forceSearch) },
    },
    marketSnapshot: {},
    report: {
      title: "事件日报",
      subtitle: "流式生成中…",
      marketTemperature: {
        score: 50,
        label: "生成中",
        summary: "实时扫描已经开始，等待信息温度模块返回。",
        regime: "",
        crossAsset: "",
        anomaly: "",
        suggestion: "",
      },
      macroTrend: "",
      topStory: null,
      topStories: [],
      dynamicBriefs: [],
      aiIntel: [],
      githubTools: [],
      trendRead: {
        title: "总编辑收束",
        summary: "",
        verdict: "",
        closingRead: [],
        searchFindings: [],
        watchline: [],
        uncertainty: "",
        strengthening: [],
        cracking: [],
        conclusion: "",
        methodology: { usesGoogleSearch: true, inputOnly: false, mode: "上游模块 + 外部搜索校准" },
      },
      sources: [],
      quality: { factCount: 0, sourceCoverage: 0, usedSearch: !!(opts && opts.forceSearch), caveat: "报告仍在生成中。" },
    },
    sourceErrors: [],
  };
}

async function buildDailyEventReport(env, opts) {
  const generatedAtInput = opts && (opts.generatedAt || opts.scheduledTime);
  const generatedAt = new Date(generatedAtInput || Date.now()).toISOString();
  const triggerType = normalizeTriggerType(opts && opts.triggerType);
  const slot = opts && opts.slot ? String(opts.slot) : bjtSlotLabel(DAILY_EVENT_KIND, generatedAt);
  const sourceErrors = [];
  let ingestResult = null;
  if (!opts || opts.ingest !== false) {
    try {
      ingestResult = await ingestFactPool(env, { aggregateSources });
      sourceErrors.push(...(ingestResult.ingestErrors || []));
    } catch (e) {
      sourceErrors.push({ source: "ingest", message: String(e && e.message ? e.message : e) });
    }
  }

  const { factRows } = await loadFactsBundle(env, 80);
  let legacy = null;
  const passedModules = opts && opts.modules && typeof opts.modules === "object" 
    ? opts.modules 
    : { dashboard: true, news: true, timeline: true, ai: true, githubTools: true, trends: true };
    
  try {
    legacy = await buildReport(env, {
      mode: opts && opts.mode ? opts.mode : "deep",
      force: true,
      allowSearch: !!(opts && opts.forceSearch),
      forceSearch: !!(opts && opts.forceSearch),
      dailyEventFocus: true,
      trendsUseAiIntel: true,
      trendsUseSearch: !!(opts && opts.trendsUseSearch),
      dualHeadlineLanes: !!(opts && opts.dualHeadlineLanes),
      modelId: opts && opts.modelId,
      modelAssignments: opts && opts.modelAssignments,
      __streamSink: opts && opts.__streamSink,
      modules: passedModules,
    });
    if (legacy && Array.isArray(legacy.warnings)) sourceErrors.push(...legacy.warnings);
  } catch (e) {
    sourceErrors.push({ source: "daily_llm", message: String(e && e.message ? e.message : e) });
  }

  const agg = await aggregateSources(env).catch((e) => {
    sourceErrors.push({ source: "market_sources", message: String(e && e.message ? e.message : e) });
    return { sources: { fng: { ok: false }, btc: { ok: false }, assets: [], errors: [] }, realMarketData: {} };
  });
  const dashboard = legacy && legacy.dashboard ? legacy.dashboard : fallbackDashboard(agg.realMarketData, marketScoreFromSources(agg.sources), "中性");
  const sourceRefs = [
    ...sourceRefsFromFacts(factRows, 14),
    { type: "route", label: "舆情分析", href: "#/news-analysis", route: "news-analysis" },
  ];
  const sources = uniqueSourceRows(factRows);
  
  let topStories = normalizeDailyTopStoryItems([], []);
  let dynamicBriefs = normalizeDailyBriefItems([], []);
  let macroTrend = "";

  if (legacy && legacy.sections && legacy.sections.news && legacy.sections.news.data) {
    const data = legacy.sections.news.data;
    if (Array.isArray(data.topStories) && data.topStories.length > 0) {
      topStories = normalizeDailyTopStoryItems(data.topStories, []);
    }
    if (Array.isArray(data.dynamicBriefs) && data.dynamicBriefs.length > 0) {
      dynamicBriefs = normalizeDailyBriefItems(data.dynamicBriefs, []);
    }
    macroTrend = cleanText(data.macroTrend, "", 420);
  }

  let aiIntel =
    legacy && legacy.sections && legacy.sections.ai && legacy.sections.ai.data && Array.isArray(legacy.sections.ai.data.aiIntel)
      ? normalizeDailyAiIntelItems(legacy.sections.ai.data.aiIntel)
      : normalizeDailyAiIntelItems([]);
  let githubTools =
    legacy && legacy.sections && legacy.sections.githubTools && legacy.sections.githubTools.data && Array.isArray(legacy.sections.githubTools.data.githubTools)
      ? normalizeDailyGithubToolItems(legacy.sections.githubTools.data.githubTools)
      : normalizeDailyGithubToolItems([]);
  if (passedModules.githubTools === false) {
    githubTools = [];
  }


  const report = {
    title: "事件日报",
    subtitle: "日常新闻早午晚报",
    marketTemperature: buildDailyTemperature(agg.sources, dashboard),
    macroTrend,
    topStory: topStories[0],
    topStories,
    dynamicBriefs,
    aiIntel,
    githubTools,
    trendRead: buildTrendReadFromDailyEventInputs(legacy, factRows.length),
    sources,
    quality: {
      factCount: factRows.length,
      sourceCoverage: Math.min(100, Math.max(20, sources.length * 14 + Math.min(30, factRows.length))),
      usedSearch: !!(legacy && legacy.grounding && legacy.grounding.usedSearch && (legacy.grounding.usedSearch.news || legacy.grounding.usedSearch.ai || legacy.grounding.usedSearch.trends)),
      ingestRows: ingestResult ? Number(ingestResult.insertedRows || 0) : 0,
      caveat: "覆盖率按来源数量、事实密度与可追溯程度估算。",
    },
  };
  return {
    id: opts && opts.reportId ? String(opts.reportId) : reportId(DAILY_EVENT_KIND, generatedAt),
    kind: DAILY_EVENT_KIND,
    reportDate: bjtDateKey(generatedAt),
    slot,
    triggerType,
    generatedAt,
    status: "ready",
    sourceRefs,
    grounding: {
      factCount: factRows.length,
      itemIdsSample: factRows.slice(0, 32).map((r) => r.id),
      ingest: ingestResult,
      quality: report.quality,
      costEstimate: legacy && legacy.costEstimate ? legacy.costEstimate : createYuqingCostTracker().summary(),
    },
    marketSnapshot: { sources: agg.sources, realMarketData: agg.realMarketData },
    report,
    sourceErrors,
  };
}

function dailyAgeMs(daily) {
  const t = daily && daily.generatedAt ? Date.parse(daily.generatedAt) : 0;
  return t > 0 ? Date.now() - t : Infinity;
}

async function buildSentimentAnalysisReport(env, opts) {
  const generatedAt = new Date(opts && opts.scheduledTime ? opts.scheduledTime : Date.now()).toISOString();
  const triggerType = normalizeTriggerType(opts && opts.triggerType);
  const slot = opts && opts.slot ? String(opts.slot) : bjtSlotLabel(SENTIMENT_ANALYSIS_KIND, generatedAt);
  const sourceErrors = [];
  const settingsEnvelope = await readFenxiDashboardSettings(env, opts && (opts.analysisSettings || opts.settings));
  const analysisSettings = settingsEnvelope.settings;
  const analysisCoverage = analysisSettings.analysisCoverage || {};
  const searchCoverage = analysisSettings.searchCoverage || {};
  if (settingsEnvelope.error) {
    sourceErrors.push({ source: "fenxi_settings", message: settingsEnvelope.error });
  }
  let daily = null;
  try {
    daily = await loadLatestYuqingReport(env.YUQING_DB, DAILY_EVENT_KIND);
  } catch (e) {
    sourceErrors.push({ source: "daily_event", message: String(e && e.message ? e.message : e) });
  }
  let { factRows, aiFacts } = await loadFactsBundle(env, 80);
  const marketSnapshot = await fetchMarketContext(env);
  const inc = shouldUseIncrementalSearch({
    dailyReport: daily,
    dailyAgeMs: dailyAgeMs(daily),
    factCount: factRows.length,
    marketErrors: marketSnapshot.errors,
    forceSearch: !!(opts && opts.forceSearch) && !!(searchCoverage.factFill || searchCoverage.narrativePricing || searchCoverage.aiTech || searchCoverage.macroEvents),
  });
  const useIncrementalSearch = shouldRunFenxiIncrementalSearch(inc, analysisSettings);
  if (useIncrementalSearch) {
    try {
      const ingest = await ingestFactPool(env, { aggregateSources });
      sourceErrors.push(...(ingest.ingestErrors || []));
      const refreshed = await loadFactsBundle(env, 90);
      factRows = refreshed.factRows;
      aiFacts = refreshed.aiFacts;
    } catch (e) {
      sourceErrors.push({ source: "incremental_ingest", message: String(e && e.message ? e.message : e) });
    }
  }

  let legacy = null;
  try {
    legacy = await buildReport(env, {
      mode: opts && opts.mode ? opts.mode : "deep",
      force: true,
      allowSearch: useIncrementalSearch,
      forceSearch: !!(opts && opts.forceSearch),
      modelId: opts && opts.modelId,
      modelAssignments: opts && opts.modelAssignments,
      modules: opts && opts.modules && typeof opts.modules === "object"
        ? opts.modules
        : fenxiLegacyModulesFromCoverage(analysisCoverage),
    });
    if (legacy && Array.isArray(legacy.warnings)) sourceErrors.push(...legacy.warnings);
  } catch (e) {
    sourceErrors.push({ source: "sentiment_llm", message: String(e && e.message ? e.message : e) });
  }

  const excludedSourceIds = daily && daily.grounding && Array.isArray(daily.grounding.itemIdsSample)
    ? daily.grounding.itemIdsSample
    : [];
  const sourceRefs = [
    daily
      ? { type: "daily_event", id: daily.id, label: "上游事件日报", href: `#/news?reportId=${encodeURIComponent(daily.id)}` }
      : { type: "daily_event", label: "上游事件日报缺失", href: "#/news" },
    { type: "market", label: "行情工作台", href: "#/chart", route: "chart" },
    { type: "market", label: "衍生品面板", href: "#/derivatives", route: "derivatives" },
    { type: "market", label: "强平雷达", href: "#/heatmap", route: "heatmap" },
    ...sourceRefsFromFacts(factRows.filter((x) => !excludedSourceIds.includes(x.id)), 8),
  ];
  const incrementalSearch = {
    used: useIncrementalSearch,
    requested: inc.useSearch,
    reasons: inc.reasons,
    excludedSourceIds,
    searchCoverage,
  };
  const report = {
    title: "BTC 核心跨资产情报日报",
    upstreamDaily: daily
      ? {
          id: daily.id,
          title: daily.report && daily.report.title ? daily.report.title : "事件一览",
          generatedAt: daily.generatedAt,
          slot: daily.slot,
          href: `#/news?reportId=${encodeURIComponent(daily.id)}`,
        }
      : null,
    marketState: analysisCoverage.riskRegime === false ? marketStateFromLegacy(null, { ok: false, errors: [] }) : marketStateFromLegacy(legacy, marketSnapshot),
    riskRadar: analysisCoverage.riskThresholds === false ? [] : riskRadarFromInputs(daily, marketSnapshot, factRows),
    opportunityScanner: analysisCoverage.riskThresholds === false ? [] : opportunitiesFromInputs(daily, marketSnapshot),
    eventCalendar: analysisCoverage.catalystCalendar === false ? [] : calendarFromFacts(factRows),
    aiIntel: analysisCoverage.techPremium === false
      ? []
      : (
          legacy && legacy.sections && legacy.sections.ai && legacy.sections.ai.data && Array.isArray(legacy.sections.ai.data.aiIntel)
            ? legacy.sections.ai.data.aiIntel
            : dailyAiIntelFromFacts(aiFacts)
        ).map((x) => ({
          title: x.title,
          relevance: x.use || "",
          watch: x.what || "",
          confidence: x.attention === "高" ? 0.72 : 0.58,
          sourceName: x.sourceName || "",
          sourceUrl: x.sourceUrl || "",
        })),
    trendRead: analysisCoverage.distortionAudit === false ? { title: "趋势研判已关闭", summary: "本轮设置未纳入抗失真/趋势研判。", strengthening: [], weakening: [] } : trendReadForSentiment(legacy, incrementalSearch),
    incrementalSearch,
    settingsSnapshot: fenxiSettingsSnapshot(analysisSettings),
    quality: {
      factCount: factRows.length,
      sourceCoverage: Math.min(100, Math.max(20, factRows.length + (marketSnapshot.ok ? 35 : 10))),
      marketSnapshotOk: !!(marketSnapshot.ok && marketSnapshot.pricePathAvailable === true),
      pricePathAvailable: marketSnapshot.pricePathAvailable === true,
      tradingNarrativeForbidden: marketSnapshot.tradingNarrativeForbidden !== false,
      usedSearch: useIncrementalSearch,
      caveat: "本页是二次舆情研判，不构成投资建议。",
    },
  };
  return {
    id: reportId(SENTIMENT_ANALYSIS_KIND, generatedAt),
    kind: SENTIMENT_ANALYSIS_KIND,
    reportDate: bjtDateKey(generatedAt),
    slot,
    triggerType,
    generatedAt,
    status: "ready",
    sourceRefs,
    grounding: {
      basedOnDailyReportId: daily ? daily.id : null,
      factCount: factRows.length,
      itemIdsSample: factRows.slice(0, 32).map((r) => r.id),
      incrementalSearch,
      settingsSnapshot: fenxiSettingsSnapshot(analysisSettings),
      settingsSource: settingsEnvelope.source,
      quality: report.quality,
      costEstimate: legacy && legacy.costEstimate ? legacy.costEstimate : createYuqingCostTracker().summary(),
    },
    marketSnapshot,
    report,
    sourceErrors: [...sourceErrors, ...(marketSnapshot.errors || [])],
  };
}

async function createYuqingReport(env, opts) {
  if (!d1Bound(env)) throw new Error("D1 未绑定");
  const kind = normalizeReportKind(opts && opts.kind);
  const payload =
    kind === DAILY_EVENT_KIND
      ? await buildDailyEventReport(env, opts)
      : await buildSentimentAnalysisReport(env, opts);
  await insertYuqingReport(env.YUQING_DB, payload);
  await pruneYuqingReports(env.YUQING_DB, REPORT_RETENTION_DAYS).catch(() => {});
  await pruneOldItems(env.YUQING_DB, REPORT_RETENTION_DAYS).catch(() => {});
  return payload;
}

async function getYuqingSettings(db, key) {
  const row = await db.prepare(`SELECT value_json FROM yuqing_settings WHERE key = ?`).bind(key).first();
  if (row && row.value_json) {
    try {
      return JSON.parse(row.value_json);
    } catch (_) {}
  }
  return null;
}

async function putYuqingSettings(db, key, settings) {
  await db.prepare(
    `INSERT INTO yuqing_settings (key, value_json, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP`
  ).bind(key, JSON.stringify(settings)).run();
}

async function readFenxiDashboardSettings(env, override) {
  if (override && typeof override === "object") {
    return { settings: normalizeFenxiDashboardSettings(override), source: "request", error: null };
  }
  if (!d1Bound(env)) {
    return { settings: defaultFenxiDashboardSettings(), source: "fallback", error: "D1 未绑定" };
  }
  try {
    const raw = await getYuqingSettings(env.YUQING_DB, YUQING_FENXI_SETTING_KEY);
    return {
      settings: normalizeFenxiDashboardSettings(raw),
      source: raw ? "d1" : "fallback",
      error: null,
    };
  } catch (e) {
    return {
      settings: defaultFenxiDashboardSettings(),
      source: "fallback",
      error: String(e && e.message ? e.message : e),
    };
  }
}

function fenxiLegacyModulesFromCoverage(coverage) {
  const c = coverage && typeof coverage === "object" ? coverage : {};
  return {
    dashboard: c.riskRegime !== false || c.hardDataMatrix !== false || c.agentContext !== false,
    news: c.narrativeValidation !== false || c.riskThresholds !== false,
    timeline: c.catalystCalendar !== false,
    ai: c.techPremium !== false,
    githubTools: false,
    trends: c.distortionAudit !== false || c.narrativeValidation !== false,
  };
}

function shouldRunFenxiIncrementalSearch(inc, settings) {
  if (!inc || !inc.useSearch) return false;
  const scopes = settings && settings.searchCoverage ? settings.searchCoverage : {};
  return !!(scopes.factFill || scopes.narrativePricing || scopes.aiTech || scopes.macroEvents);
}

/** ---- 兼容旧路径：Finnhub 代理 ---- */

async function handleLegacyFinnhubBulk(request, env) {
  const token = env && env.FINNHUB_API_KEY;
  if (!token) return json({ error: "系统未配置 FINNHUB_API_KEY" }, 500);
  const url = new URL(request.url);
  const symbols = (url.searchParams.get("symbols") || "").split(",").filter(Boolean);
  const results = {};
  await Promise.all(
    symbols.map(async (sym) => {
      const target = `${FINNHUB_ORIGIN}/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(token)}`;
      try {
        const resp = await fetchWithTimeout(target, { headers: { Accept: "application/json" } });
        if (resp.ok) results[sym] = await resp.json();
      } catch (_) {}
    }),
  );
  return new Response(JSON.stringify(results), { headers: corsHeaders({ "Content-Type": "application/json" }) });
}

async function handleLegacyFinnhubSingle(request, env) {
  const token = env && env.FINNHUB_API_KEY;
  if (!token) return json({ error: "系统未配置 FINNHUB_API_KEY" }, 500);
  const url = new URL(request.url);
  const sym = url.searchParams.get("symbol") || "";
  const target = `${FINNHUB_ORIGIN}/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(token)}`;
  const res = await fetchWithTimeout(target, { headers: { Accept: "application/json" } });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: corsHeaders({ "Content-Type": "application/json" }),
  });
}

export default {
  /**
   * @param {Request} request
   * @param {any} env
   * @param {any} _ctx
   */
  async fetch(request, env, _ctx) {
    const response = await (async () => {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders({ origin: request.headers.get("Origin") }) });
    }

    if (maintenanceEnabled(env)) {
      return json({ ok: false, error: "舆情日报 Worker 维护中，暂不可用。" }, 503);
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const accessDenied = await requireCloudflareAccess(request, env, json);
    if (accessDenied) return accessDenied;

    if (path === "/finnhub-bulk" || path === "/api/yuqing/finnhub-bulk") {
      const rl = await checkRateLimit(request, "finnhub", 40);
      if (rl) return rl;
      return handleLegacyFinnhubBulk(request, env);
    }
    if (path.startsWith("/finnhub/")) {
      const rl = await checkRateLimit(request, "finnhub", 40);
      if (rl) return rl;
      return handleLegacyFinnhubSingle(request, env);
    }

    if (path === "/api/yuqing/health") {
      const rl = await checkRateLimit(request, "health", 120);
      if (rl) return rl;
      const p = resolveProvider(env);
      const modelEnvelope = await readYuqingModelSettingsEnvelope(env);
      return json({
        ok: true,
        workerBuild: WORKER_BUILD,
        time: new Date().toISOString(),
        maintenance: maintenanceEnabled(env),
        scheduledLlmCronSkipped: YUQING_SKIP_SCHEDULED_LLM_REPORTS,
        codeLayout: {
          shijian: YUQING_SHIJIAN_PAGE,
          fenxi: YUQING_FENXI_PAGE,
          shell: `${shijianModuleShell()}/${fenxiModuleShell()}`,
        },
        llm: {
          provider: p,
          enabled: p === "gemini" && !!getGeminiKey(env),
          models: {
            source: modelEnvelope.source,
            d1Ready: modelEnvelope.d1Ready,
            effective: modelEnvelope.effectiveAssignments,
            envFallbacks: {
              flash: flashModel(env),
              pro: envSlotModel(env, "prose"),
              trends: trendsModel(env),
            },
          },
        },
        modelChannels: {
          catalog: YUQING_MODEL_CATALOG.map((m) => m.id),
          targets: YUQING_MODEL_TARGETS.length,
          warning: modelEnvelope.error || null,
        },
        secrets: {
          finnhub: !!(env && env.FINNHUB_API_KEY),
          gemini: !!getGeminiKey(env),
          d1Ready: d1Bound(env),
        },
      });
    }

    if (path === "/api/yuqing/reports/latest" && request.method === "GET") {
      const rl = await checkRateLimit(request, "reports_latest", 80);
      if (rl) return rl;
      if (!d1Bound(env)) return json({ ok: true, workerBuild: WORKER_BUILD, d1Ready: false, report: null });
      try {
        const kind = normalizeReportKind(url.searchParams.get("kind"));
        const report = await loadLatestYuqingReport(env.YUQING_DB, kind);
        return json({ ok: true, workerBuild: WORKER_BUILD, d1Ready: true, kind, report });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message ? e.message : e) }, 500);
      }
    }

    if (path === "/api/yuqing/reports/history" && request.method === "GET") {
      const rl = await checkRateLimit(request, "reports_history", 50);
      if (rl) return rl;
      if (!d1Bound(env)) return json({ ok: true, workerBuild: WORKER_BUILD, d1Ready: false, items: [] });
      try {
        const kind = normalizeReportKind(url.searchParams.get("kind"));
        const days = url.searchParams.get("days") || String(REPORT_RETENTION_DAYS);
        const items = await loadYuqingReportHistory(env.YUQING_DB, kind, days);
        return json({
          ok: true,
          workerBuild: WORKER_BUILD,
          d1Ready: true,
          kind,
          days: Math.min(30, Math.max(1, Number(days) || REPORT_RETENTION_DAYS)),
          items: items.map(reportListSummary),
        });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message ? e.message : e) }, 500);
      }
    }

    if (path === "/api/yuqing/reports/item" && request.method === "GET") {
      const rl = await checkRateLimit(request, "reports_item", 80);
      if (rl) return rl;
      if (!d1Bound(env)) return json({ ok: true, workerBuild: WORKER_BUILD, d1Ready: false, report: null });
      try {
        const id = url.searchParams.get("id") || "";
        const report = await loadYuqingReportById(env.YUQING_DB, id);
        if (!report) return json({ ok: false, error: "报告不存在", recovery: { grade: "missing", latestSubstitution: false } }, 404);
        return json({ ok: true, workerBuild: WORKER_BUILD, d1Ready: true, report, recovery: { grade: "exact_inputs", latestSubstitution: false } });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message ? e.message : e) }, 500);
      }
    }

    if (path === "/api/yuqing/reports/item" && request.method === "DELETE") {
      const rl = await checkRateLimit(request, "reports_delete", 24);
      if (rl) return rl;
      if (!d1Bound(env)) return json({ ok: false, error: "D1 未绑定或未迁移", d1Ready: false }, 503);
      try {
        const id = String(url.searchParams.get("id") || "").trim();
        if (!id) return json({ ok: false, error: "缺少 id" }, 400);
        const { deleted } = await deleteYuqingReportById(env.YUQING_DB, id);
        if (!deleted) return json({ ok: false, error: "报告不存在或已删除" }, 404);
        return json({ ok: true, workerBuild: WORKER_BUILD, d1Ready: true, id, deleted });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message ? e.message : e) }, 500);
      }
    }

    if (path === "/api/yuqing/settings/model-channels" && request.method === "GET") {
      const rl = await checkRateLimit(request, "model_settings_get", 100);
      if (rl) return rl;
      const envelope = await readYuqingModelSettingsEnvelope(env);
      return json(yuqingModelSettingsResponse(env, envelope));
    }

    if (path === "/api/yuqing/settings/model-channels" && request.method === "PUT") {
      const rl = await checkRateLimit(request, "model_settings_put", 20);
      if (rl) return rl;
      if (!d1Bound(env)) return json({ ok: false, error: "D1 未绑定", d1Ready: false }, 503);
      let bodyIn;
      try {
        bodyIn = await request.json();
      } catch (_) {
        return json({ ok: false, error: "格式错误" }, 400);
      }
      try {
        const rawAssignments =
          bodyIn && bodyIn.assignments
            ? { assignments: bodyIn.assignments }
            : bodyIn && bodyIn.models
              ? { assignments: bodyIn.models }
              : bodyIn;
        const settings = {
          ...normalizeYuqingModelSettings(rawAssignments),
          updatedAt: new Date().toISOString(),
        };
        await putYuqingSettings(env.YUQING_DB, YUQING_MODEL_SETTING_KEY, settings);
        const effectiveAssignments = effectiveYuqingModelAssignments(settings, env);
        return json(yuqingModelSettingsResponse(env, {
          d1Ready: true,
          source: "d1",
          settings,
          effectiveAssignments,
          cacheKey: yuqingModelCacheKey(effectiveAssignments),
          error: null,
        }));
      } catch (e) {
        return json({ ok: false, error: String(e && e.message ? e.message : e) }, 500);
      }
    }

    if (path === "/api/yuqing/settings/event-dashboard" && request.method === "GET") {
      const rl = await checkRateLimit(request, "settings_get", 100);
      if (rl) return rl;
      if (!d1Bound(env)) return json({ ok: false, error: "D1 未绑定" }, 503);
      try {
        const s = await getYuqingSettings(env.YUQING_DB, "event_dashboard");
        if (!s) {
          return json({
            ok: true,
            settings: {
              visibility: { dashboard: true, news: true, timeline: true, ai: true, githubTools: true, trends: true },
              scanCoverage: { dashboard: true, news: true, timeline: true, ai: true, githubTools: true, trends: true }
            }
          });
        }
        return json({
          ok: true,
          settings: {
            visibility: { dashboard: true, news: true, timeline: true, ai: true, githubTools: true, trends: true, ...(s.visibility || {}) },
            scanCoverage: { dashboard: true, news: true, timeline: true, ai: true, githubTools: true, trends: true, ...(s.scanCoverage || {}) },
          },
        });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message ? e.message : e) }, 500);
      }
    }

    if (path === "/api/yuqing/settings/event-dashboard" && request.method === "PUT") {
      const rl = await checkRateLimit(request, "settings_put", 20);
      if (rl) return rl;
      if (!d1Bound(env)) return json({ ok: false, error: "D1 未绑定" }, 503);
      let bodyIn;
      try {
        bodyIn = await request.json();
      } catch (_) {
        return json({ ok: false, error: "格式错误" }, 400);
      }
      try {
        const v = bodyIn.visibility || {};
        const s = bodyIn.scanCoverage || {};
        const settings = {
          visibility: {
            dashboard: !!v.dashboard,
            news: !!v.news,
            timeline: !!v.timeline,
            ai: !!v.ai,
            githubTools: !!v.githubTools,
            trends: !!v.trends
          },
          scanCoverage: {
            dashboard: !!s.dashboard,
            news: !!s.news,
            timeline: !!s.timeline,
            ai: !!s.ai,
            githubTools: !!s.githubTools,
            trends: !!s.trends
          }
        };
        await putYuqingSettings(env.YUQING_DB, "event_dashboard", settings);
        return json({ ok: true, settings });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message ? e.message : e) }, 500);
      }
    }

    if (path === "/api/yuqing/settings/sentiment-analysis" && request.method === "GET") {
      const rl = await checkRateLimit(request, "fenxi_settings_get", 100);
      if (rl) return rl;
      const envelope = await readFenxiDashboardSettings(env, null);
      return json({
        ok: true,
        workerBuild: WORKER_BUILD,
        d1Ready: d1Bound(env),
        source: envelope.source,
        modules: YUQING_FENXI_MODULES,
        searchScopes: YUQING_FENXI_SEARCH_SCOPES,
        settings: envelope.settings,
        warning: envelope.error || null,
      });
    }

    if (path === "/api/yuqing/settings/sentiment-analysis" && request.method === "PUT") {
      const rl = await checkRateLimit(request, "fenxi_settings_put", 20);
      if (rl) return rl;
      if (!d1Bound(env)) return json({ ok: false, error: "D1 未绑定", d1Ready: false }, 503);
      let bodyIn;
      try {
        bodyIn = await request.json();
      } catch (_) {
        return json({ ok: false, error: "格式错误" }, 400);
      }
      try {
        const settings = {
          ...normalizeFenxiDashboardSettings(bodyIn),
          updatedAt: new Date().toISOString(),
        };
        await putYuqingSettings(env.YUQING_DB, YUQING_FENXI_SETTING_KEY, settings);
        return json({
          ok: true,
          workerBuild: WORKER_BUILD,
          d1Ready: true,
          source: "d1",
          modules: YUQING_FENXI_MODULES,
          searchScopes: YUQING_FENXI_SEARCH_SCOPES,
          settings,
        });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message ? e.message : e) }, 500);
      }
    }

    if (path === "/api/yuqing/reports/generate" && request.method === "POST") {
      const rl = await checkRateLimit(request, "reports_generate", 8);
      if (rl) return rl;
      let bodyIn = {};
      try {
        bodyIn = await request.json();
      } catch (_) {
        bodyIn = {};
      }
      try {
        const kind = normalizeReportKind(bodyIn && bodyIn.kind);
        const out = await createYuqingReport(env, {
          kind,
          triggerType: "manual",
          forceSearch: !!(bodyIn && bodyIn.forceSearch),
          mode: bodyIn && bodyIn.mode,
          trendsUseSearch: !!(bodyIn && bodyIn.trendsUseSearch),
          dualHeadlineLanes: !!(bodyIn && bodyIn.dualHeadlineLanes),
          modelId: bodyIn && bodyIn.modelId,
          modelAssignments: bodyIn && (bodyIn.modelAssignments || bodyIn.modelOverrides || bodyIn.models),
          modules: bodyIn && bodyIn.modules,
          analysisSettings: bodyIn && (bodyIn.analysisSettings || bodyIn.settings),
        });
        return json({ ok: true, workerBuild: WORKER_BUILD, d1Ready: true, report: out });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message ? e.message : e) }, 500);
      }
    }

    if (path === "/api/yuqing/reports/generate-stream" && request.method === "POST") {
      const rl = await checkRateLimit(request, "reports_generate", 8);
      if (rl) return rl;
      let bodyIn = {};
      try {
        bodyIn = await request.json();
      } catch (_) {
        bodyIn = {};
      }
      if (!d1Bound(env)) {
        return json({ ok: false, error: "D1 未绑定", d1Ready: false }, 503);
      }
      const kind = normalizeReportKind(bodyIn && bodyIn.kind);
      if (kind !== DAILY_EVENT_KIND) {
        return json({ ok: false, error: "流式生成仅支持 daily_event" }, 400);
      }
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          let closed = false;
          let progressPayload = null;
          const safeWrite = (obj) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
            } catch (_) {}
          };
          try {
            const generatedAt = new Date().toISOString();
            progressPayload = buildDailyEventStreamingReport(generatedAt, {
              triggerType: "manual",
              forceSearch: !!(bodyIn && bodyIn.forceSearch),
            });
            await insertYuqingReport(env.YUQING_DB, progressPayload);
            safeWrite({ type: "start", workerBuild: WORKER_BUILD, d1Ready: true, report: progressPayload });
            const payload = await buildDailyEventReport(env, {
              generatedAt,
              reportId: progressPayload.id,
              triggerType: "manual",
              forceSearch: !!(bodyIn && bodyIn.forceSearch),
              mode: bodyIn && bodyIn.mode,
              trendsUseSearch: !!(bodyIn && bodyIn.trendsUseSearch),
              dualHeadlineLanes: !!(bodyIn && bodyIn.dualHeadlineLanes),
              modelId: bodyIn && bodyIn.modelId,
              modelAssignments: bodyIn && (bodyIn.modelAssignments || bodyIn.modelOverrides || bodyIn.models),
              modules: bodyIn && bodyIn.modules,
              __streamSink: (evt) => safeWrite(evt),
            });
            await insertYuqingReport(env.YUQING_DB, payload);
            await pruneYuqingReports(env.YUQING_DB, REPORT_RETENTION_DAYS).catch(() => {});
            await pruneOldItems(env.YUQING_DB, REPORT_RETENTION_DAYS).catch(() => {});
            safeWrite({ type: "done", ok: true, report: payload });
          } catch (e) {
            if (progressPayload) {
              const errorPayload = {
                ...progressPayload,
                status: "error",
                sourceErrors: [
                  ...(Array.isArray(progressPayload.sourceErrors) ? progressPayload.sourceErrors : []),
                  { source: "generate_stream", message: String(e && e.message ? e.message : e) },
                ],
              };
              await insertYuqingReport(env.YUQING_DB, errorPayload).catch(() => {});
            }
            safeWrite({ type: "error", ok: false, error: String(e && e.message ? e.message : e) });
          } finally {
            closed = true;
            try {
              controller.close();
            } catch (_) {}
          }
        },
      });

      return new Response(stream, {
        headers: {
          ...corsHeaders(),
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "X-Worker-Build": WORKER_BUILD,
          "X-Yuqing-Worker": "1",
          "Cache-Control": "no-store",
        },
      });
    }

    if (path === "/api/yuqing/latest" && request.method === "GET") {
      const rl = await checkRateLimit(request, "latest", 60);
      if (rl) return rl;
      try {
        const agg = await aggregateSources(env);
        if (!d1Bound(env)) {
          return json({
            ok: true,
            workerBuild: WORKER_BUILD,
            d1Ready: false,
            capturedAt: null,
            sources: agg.sources,
            items: [],
            note: "D1 未绑定或未执行迁移：请配置 wrangler.yuqing.toml 中的 yuqing 库并执行 SQL。",
          });
        }
        const items = await loadRecentItems(env.YUQING_DB, 45);
        const last = await env.YUQING_DB.prepare(
          `SELECT captured_at as capturedAt FROM yuqing_snapshots ORDER BY id DESC LIMIT 1`,
        ).first();
        const capturedAt = last && last.capturedAt ? String(last.capturedAt) : null;
        return json({
          ok: true,
          workerBuild: WORKER_BUILD,
          d1Ready: true,
          capturedAt,
          sources: agg.sources,
          items,
        });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message ? e.message : e) }, 500);
      }
    }

    if (path === "/api/yuqing/items" && request.method === "GET") {
      const rl = await checkRateLimit(request, "items", 60);
      if (rl) return rl;
      const category = url.searchParams.get("category") || "";
      const limit = url.searchParams.get("limit") || "40";
      if (!d1Bound(env)) {
        return json({ ok: true, workerBuild: WORKER_BUILD, d1Ready: false, items: [] });
      }
      try {
        const page = await loadItemsPage(env.YUQING_DB, category, limit);
        return json({ ok: true, workerBuild: WORKER_BUILD, d1Ready: true, ...page });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message ? e.message : e) }, 500);
      }
    }

    if (path === "/api/yuqing/history" && request.method === "GET") {
      const rl = await checkRateLimit(request, "hist", 30);
      if (rl) return rl;
      const days = url.searchParams.get("days") || "7";
      if (!d1Bound(env)) {
        return json({ ok: true, workerBuild: WORKER_BUILD, d1Ready: false, stats: null });
      }
      try {
        const stats = await loadHistoryStats(env.YUQING_DB, days);
        return json({ ok: true, workerBuild: WORKER_BUILD, d1Ready: true, stats });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message ? e.message : e) }, 500);
      }
    }

    if (path === "/api/yuqing/ingest" && request.method === "POST") {
      const sec = env && env.CRON_SECRET ? String(env.CRON_SECRET) : "";
      const h = request.headers.get("X-Yuqing-Cron-Secret") || "";
      if (!sec || h !== sec) {
        return json({ ok: false, error: "需要配置 CRON_SECRET 并在请求头 X-Yuqing-Cron-Secret 传入" }, 403);
      }
      if (!d1Bound(env)) {
        return json({ ok: false, error: "D1 未绑定" }, 503);
      }
      try {
        const r = await ingestFactPool(env, { aggregateSources });
        return json({ ok: true, workerBuild: WORKER_BUILD, ...r });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message ? e.message : e) }, 500);
      }
    }

    if (path === "/api/yuqing/sources") {
      const rl = await checkRateLimit(request, "sources", 45);
      if (rl) return rl;
      try {
        const agg = await aggregateSources(env);
        return json({ ok: true, ...agg.sources, workerBuild: WORKER_BUILD });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message ? e.message : e) }, 500);
      }
    }

    if (path === "/api/yuqing/report" && request.method === "POST") {
      const rl = await checkRateLimit(request, "report", 8);
      if (rl) return rl;
      let bodyIn = {};
      try {
        bodyIn = await request.json();
      } catch (_) {
        bodyIn = {};
      }
      try {
        const out = await createYuqingReport(env, {
          kind: SENTIMENT_ANALYSIS_KIND,
          triggerType: "manual",
          forceSearch: !!(bodyIn && (bodyIn.forceSearch || bodyIn.allowSearch)),
          mode: bodyIn && bodyIn.mode,
          modules: bodyIn && bodyIn.modules,
          analysisSettings: bodyIn && (bodyIn.analysisSettings || bodyIn.settings),
        });
        return json({ ok: true, workerBuild: WORKER_BUILD, d1Ready: true, report: out });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message ? e.message : e) }, 500);
      }
    }

    if (path === "/api/yuqing/llm/test" && request.method === "POST") {
      const rl = await checkRateLimit(request, "llmtest", 6);
      if (rl) return rl;
      const p = resolveProvider(env);
      if (p !== "gemini" || !getGeminiKey(env)) {
        return json({ ok: false, error: "需要 Gemini：配置 GEMINI_API_KEY 且 YUQING_LLM_PROVIDER 不可为 none/off" }, 400);
      }
      let bodyIn = {};
      try {
        bodyIn = await request.json();
      } catch (_) {
        bodyIn = {};
      }
      const prompt = String((bodyIn && bodyIn.prompt) || "用一句话回复：系统在线。");
      try {
        const targetId = cleanModelId(bodyIn && bodyIn.targetId) || "daily_event.dashboard";
        const envelope = await readYuqingModelSettingsEnvelope(env);
        const resolved = resolveYuqingModel(env, envelope, targetId, { ...(bodyIn || {}), modelId: bodyIn && bodyIn.model });
        const model = resolved.modelId;
        const text = await geminiGenerateContent(env, model, prompt, { googleSearch: false, temperature: 0.2 });
        return json({ ok: true, targetId: resolved.targetId, model, modelSource: resolved.source, text });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message ? e.message : e) }, 500);
      }
    }

    if (path === "/" || path === "") {
      return json({
        ok: true,
        service: "yuqing",
        workerBuild: WORKER_BUILD,
        endpoints: [
          "GET /api/yuqing/health",
          "GET /api/yuqing/sources",
          "GET /api/yuqing/latest",
          "GET /api/yuqing/items",
          "GET /api/yuqing/history",
          "GET /api/yuqing/reports/latest?kind=daily_event|sentiment_analysis",
          "GET /api/yuqing/reports/history?kind=...&days=7",
          "GET /api/yuqing/reports/item?id=...",
          "DELETE /api/yuqing/reports/item?id=...",
          "GET /api/yuqing/settings/model-channels",
          "PUT /api/yuqing/settings/model-channels",
          "GET /api/yuqing/settings/event-dashboard",
          "PUT /api/yuqing/settings/event-dashboard",
          "GET /api/yuqing/settings/sentiment-analysis",
          "PUT /api/yuqing/settings/sentiment-analysis",
          "POST /api/yuqing/reports/generate",
          "POST /api/yuqing/reports/generate-stream",
          "POST /api/yuqing/report (compat: sentiment_analysis)",
          "POST /api/yuqing/ingest (+X-Yuqing-Cron-Secret)",
          "POST /api/yuqing/llm/test",
        ],
      });
    }

    return json({ ok: false, error: "Not found" }, 404);
    })();
    // Apply request-specific CORS after every route, including errors and streaming reports.
    const outgoing = new Response(response.body, response);
    const vary = outgoing.headers.get("Vary");
    for (const [key, value] of Object.entries(accessCorsHeaders(env, { origin: request.headers.get("Origin") }))) {
      outgoing.headers.set(key, key === "Vary" && vary && vary !== "Origin" ? `${vary}, Origin` : value);
    }
    return outgoing;
  },

  /** Cloudflare Cron：北京时间事件日报 00/08/12/20，舆情分析 09/14/22。 */
  async scheduled(event, env) {
    try {
      if (YUQING_SKIP_SCHEDULED_LLM_REPORTS) {
        console.log("[yuqing scheduled] YUQING_SKIP_SCHEDULED_LLM_REPORTS=true, skip LLM report jobs");
        return;
      }
      if (!d1Bound(env)) return;
      const scheduledTime = event && event.scheduledTime ? Number(event.scheduledTime) : Date.now();
      const due = scheduledKindsForDate(scheduledTime);
      if (!due.length) return;
      for (const task of due) {
        await createYuqingReport(env, {
          kind: task.kind,
          triggerType: "scheduled",
          slot: task.slot,
          scheduledTime,
        });
      }
    } catch (e) {
      console.error("yuqing scheduled reports:", e && e.message ? e.message : e);
    }
  },
};
