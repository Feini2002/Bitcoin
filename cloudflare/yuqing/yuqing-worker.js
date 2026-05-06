/**
 * Cloudflare Worker：舆情日报（yuqing.feiniwork.com）
 *
 * - 聚合非 LLM：FNG、CoinGecko BTC、Finnhub 批量 ETF/股票报价（仅行情数字，不喂新闻）
 * - 今日头条 / 动态速览 / AI 情报站：固定 Gemini + Google Search（不调 Finnhub 新闻事实池回填）
 * - LLM：可配置 YUQING_LLM_PROVIDER=none|gemini|auto（默认 auto）；默认模型见 YUQING_GEMINI_MODEL_DEFAULT，可被 YUQING_LLM_MODEL_* 覆盖；密钥仅存 Worker Secret
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
import { YUQING_FENXI_PAGE, fenxiModuleShell } from "./fenxi/index.js";
import {
  YUQING_SHIJIAN_PAGE,
  buildDailyAiIntelPrompt,
  buildDailyBriefsPrompt,
  buildDailyTemperature,
  buildDailyTemperaturePrompt,
  buildDailyTopStoriesPrompt,
  buildDailyTopStoriesWirePrompt,
  buildDailyTrendCluesPrompt,
  buildTrendReadFromDailyEventInputs,
  dailyThemeFromStoriesAndBriefs,
  mergeTopStoryCandidatesForDaily,
  normalizeDailyAiIntelItems,
  normalizeDailyBriefItems,
  normalizeDailyTopStoryItems,
  renderDailyAiIntelMarkdownForTrends,
  renderDailyBriefsMarkdown,
  renderDailyTopStoriesMarkdown,
  shijianModuleShell,
} from "./shijian/index.js";

const WORKER_BUILD = "yuqing-worker/1.4.0-ndjson-stream";

/** 开发期省 token：`true` 时跳过本 Worker 「Cron→createYuqingReport」链路（事件日报 / 舆情二次研判均含 LLM）；手动 `POST …/reports/generate` 等仍可用；事实池 `POST …/ingest` 不含 LLM 不受影响。BTC K 线在 `binance-klines-worker`，与此开关无关。定型后改为 `false` 一行即恢复定点。 */
const YUQING_SKIP_SCHEDULED_LLM_REPORTS = true;

const GEMINI_ORIGIN = "https://generativelanguage.googleapis.com";
const FINNHUB_ORIGIN = "https://finnhub.io";
const ALT_FNG = "https://api.alternative.me/fng/";
const COINGECKO_BTC = "https://api.coingecko.com/api/v3/simple/price";

const FETCH_TIMEOUT_SOURCES_MS = 12_000;
const FETCH_TIMEOUT_LLM_MS = 118_000;

/** 舆情链路 Gemini 默认模型；可通过 Worker 环境变量 YUQING_LLM_MODEL_FLASH / _PRO / _TRENDS / _FAST_PROSE 单独覆盖 */
const YUQING_GEMINI_MODEL_DEFAULT = "gemini-3.1-flash-lite-preview";
const REPORT_RETENTION_DAYS = 7;
const DAILY_EVENT_KIND = "daily_event";
const SENTIMENT_ANALYSIS_KIND = "sentiment_analysis";
const DAILY_EVENT_SLOTS_BJT = new Set(["00:00", "08:00", "12:00", "20:00"]);
const SENTIMENT_ANALYSIS_SLOTS_BJT = new Set(["09:00", "14:00", "22:00"]);
const DEFAULT_MARKET_API_BASE = "https://btc.feiniwork.com";

/** 设为 true（环境变量字符串 "1"|"true"）时全线 503（用于紧急下线） */
function maintenanceEnabled(env) {
  const raw = env && env.MAINTENANCE_MODE != null ? String(env.MAINTENANCE_MODE).trim().toLowerCase() : "";
  return raw === "1" || raw === "true";
}

function corsHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    "Access-Control-Expose-Headers": "X-Worker-Build, X-Yuqing-Worker",
    ...extra,
  };
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

function itemSummary(it, fallback = "事实池未提供摘要，需结合来源标题保守阅读。") {
  return String((it && (it.summary || it.title)) || fallback).slice(0, 260);
}

function cleanReportText(value, fallback = "", max = 260) {
  const s = String(value == null ? "" : value).trim();
  return (s || fallback).slice(0, max);
}

function normalizeImpactDirection(value) {
  const s = String(value || "").trim().toLowerCase();
  if (s === "up" || s.includes("bull") || s.includes("long") || s.includes("buy") || s.includes("利多") || s.includes("上行")) return "up";
  if (s === "down" || s.includes("bear") || s.includes("short") || s.includes("sell") || s.includes("利空") || s.includes("下行")) return "down";
  return "shock";
}

function normalizeStoryStructure(raw, fallbackFact) {
  if (Array.isArray(raw)) {
    return {
      trigger: cleanReportText(raw[0], "直接诱因仍需结合事实池继续核对。", 180),
      conflict: cleanReportText(raw[1], "深层矛盾尚未形成明确单边解释。", 180),
      divergence: cleanReportText(raw[2], "预期差需要等待价格、资金流和官方口径确认。", 180),
    };
  }
  if (raw && typeof raw === "object") {
    return {
      trigger: cleanReportText(raw.trigger || raw.cause || raw.reason, "直接诱因仍需结合事实池继续核对。", 180),
      conflict: cleanReportText(raw.conflict || raw.tension || raw.structure, "深层矛盾尚未形成明确单边解释。", 180),
      divergence: cleanReportText(raw.divergence || raw.gap || raw.disagreement, "预期差需要等待价格、资金流和官方口径确认。", 180),
    };
  }
  return {
    trigger: cleanReportText(raw, fallbackFact || "事实池已记录该事件，但诱因仍需继续核对。", 180),
    conflict: "市场需要区分短线情绪冲击与真实基本面变化。",
    divergence: "关注叙事、价格和资金流是否出现同向确认。",
  };
}

function normalizeDailyImpacts(raw, fallbackAsset = "BTC") {
  const arr = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  const out = [];
  for (const it of arr.slice(0, 4)) {
    if (it == null) continue;
    if (typeof it === "string") {
      out.push({ asset: fallbackAsset, direction: "shock", logic: cleanReportText(it, "等待价格和资金流确认。", 160) });
      continue;
    }
    if (typeof it !== "object") continue;
    out.push({
      asset: cleanReportText(it.asset || it.symbol || fallbackAsset, fallbackAsset, 32),
      direction: normalizeImpactDirection(it.direction || it.bias || it.impact),
      logic: cleanReportText(it.logic || it.reason || it.why, "等待价格、资金流和衍生品结构确认。", 180),
    });
  }
  if (out.length) return out;
  return [{ asset: fallbackAsset, direction: "shock", logic: "等待价格、资金流和衍生品结构确认。" }];
}

function normalizeDailyTopStoryInput(raw, fallback) {
  const src = raw && typeof raw === "object" ? raw : {};
  const fact = cleanReportText(src.fact || src.summary || src.body || (fallback && fallback.fact), "事实池已有事件，但摘要仍需补强。", 260);
  const fallbackAsset = fallback && fallback.impacts && fallback.impacts[0] ? fallback.impacts[0].asset : "BTC";
  return {
    category: cleanReportText(src.category || src.type || (fallback && fallback.category), "综合事件", 32),
    title: cleanReportText(src.title || src.headline || (fallback && fallback.title), "未命名事件", 140),
    fact,
    structure: normalizeStoryStructure(src.structure || src.deconstruction || src.analysis, fact),
    impacts: normalizeDailyImpacts(src.impacts || src.impact || src.transmission, fallbackAsset),
    nextWatch: cleanReportText(src.nextWatch || src.next_watch || src.watch || (fallback && fallback.nextWatch), "关注官方确认、资金流与价格结构是否同向。", 180),
    sourceName: cleanReportText(src.sourceName || src.source || (fallback && fallback.sourceName), "", 64),
    sourceUrl: cleanReportText(src.sourceUrl || src.url || (fallback && fallback.sourceUrl), "", 240),
  };
}

function normalizeDailyTopStoriesFromLlm(raw, fallbackRows) {
  const candidates = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  const fallbackStories = dailyTopStoriesFromFacts(fallbackRows);
  const out = [];
  for (let i = 0; i < candidates.length && out.length < 3; i += 1) {
    out.push(normalizeDailyTopStoryInput(candidates[i], fallbackStories[out.length]));
  }
  while (out.length < 3 && fallbackStories[out.length]) out.push(fallbackStories[out.length]);
  return out.length ? out : fallbackStories;
}

function normalizeDailyBriefsFromLlm(raw, fallbackRows) {
  const candidates = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  const fallbackBriefs = dailyBriefsFromFacts(fallbackRows);
  const out = [];
  for (let i = 0; i < candidates.length && out.length < 5; i += 1) {
    const src = candidates[i] && typeof candidates[i] === "object" ? candidates[i] : {};
    const fallback = fallbackBriefs[out.length] || {};
    const body = cleanReportText(src.body || src.fact || src.summary || fallback.body, "事件细节等待事实池补强。", 220);
    out.push({
      category: cleanReportText(src.category || src.type || fallback.category, "综合", 32),
      title: cleanReportText(src.title || src.headline || fallback.title, "未命名动态", 120),
      body,
      description: cleanReportText(src.description || src.detail || fallback.description || body, body, 240),
      analysis: cleanReportText(src.analysis || src.watch || fallback.analysis, "后续观察官方确认、主流媒体跟进和相关资产二次反应。", 220),
      watch: cleanReportText(src.watch || src.analysis || fallback.watch, "后续观察官方确认、主流媒体跟进和相关资产二次反应。", 220),
      sourceName: cleanReportText(src.sourceName || src.source || fallback.sourceName, "", 64),
      sourceUrl: cleanReportText(src.sourceUrl || src.url || fallback.sourceUrl, "", 240),
    });
  }
  while (out.length < 5 && fallbackBriefs[out.length]) out.push(fallbackBriefs[out.length]);
  return out.length ? out : fallbackBriefs;
}

function renderTopStoriesMarkdown(stories, macroTrend) {
  const lines = [];
  const macro = cleanReportText(macroTrend, "", 420);
  if (macro) lines.push(`### 宏观主线\n\n${macro}`);
  (stories || []).forEach((story, idx) => {
    const impacts = (story.impacts || [])
      .map((imp) => `[${imp.asset}] ${imp.direction === "up" ? "利多" : imp.direction === "down" ? "利空" : "震荡"}：${imp.logic}`)
      .join("；");
    lines.push(
      [
        `### ${idx + 1}. ${story.title}`,
        `- 事实：${story.fact}`,
        `- 诱因：${story.structure && story.structure.trigger ? story.structure.trigger : ""}`,
        `- 矛盾：${story.structure && story.structure.conflict ? story.structure.conflict : ""}`,
        `- 预期差：${story.structure && story.structure.divergence ? story.structure.divergence : ""}`,
        `- 传导：${impacts || "等待资产传导确认。"}`,
        `- 后续观察：${story.nextWatch || "继续跟踪官方确认和价格反应。"}`,
      ].join("\n"),
    );
  });
  return lines.join("\n\n").trim();
}

function renderBriefsMarkdown(briefs) {
  return (briefs || [])
    .map((item, idx) => `### ${idx + 1}. ${item.title}\n\n${item.body}\n\n${item.analysis || item.watch || ""}`)
    .join("\n\n")
    .trim();
}

function marketScoreFromSources(sources) {
  const fng = sources && sources.fng && sources.fng.ok ? Number(sources.fng.value) : 50;
  return Math.max(0, Math.min(100, Number.isFinite(fng) ? fng : 50));
}

function marketTemperatureFromSources(sources, dashboard) {
  const score = marketScoreFromSources(sources);
  const label =
    dashboard && dashboard.marketRegime
      ? String(dashboard.marketRegime)
      : score >= 70
        ? "信息温度偏热"
        : score <= 35
          ? "信息温度偏冷"
          : "信息温度中性";
  const summary =
    dashboard && dashboard.sentimentSummary
      ? String(dashboard.sentimentSummary)
      : "仅作为阅读时的市场背景温度，详细交易影响交给舆情分析页处理。";
  return { score, label, summary };
}

function marketApiBase(env) {
  const raw = env && env.BIT_DATA_API_BASE ? String(env.BIT_DATA_API_BASE) : DEFAULT_MARKET_API_BASE;
  return raw.replace(/\/$/, "");
}

async function fetchJsonOptional(url, timeoutMs = 12_000) {
  try {
    const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, timeoutMs);
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
  if (key === "klines") {
    const rows = Array.isArray(data.klines) ? data.klines : [];
    const first = rows[0] || null;
    const last = rows.length ? rows[rows.length - 1] : null;
    const firstClose = first && first.c != null ? Number(first.c) : null;
    const lastClose = last && last.c != null ? Number(last.c) : null;
    const changePct =
      firstClose && lastClose && Number.isFinite(firstClose) && Number.isFinite(lastClose)
        ? Number((((lastClose - firstClose) / firstClose) * 100).toFixed(4))
        : null;
    return {
      url: result.url,
      ok: true,
      status: result.status,
      data: {
        symbol: data.symbol,
        interval: data.interval,
        count: data.count || rows.length,
        latestT: data.latestT || (last && last.t) || null,
        lastSync: data.lastSync || null,
        firstClose,
        lastClose,
        changePct,
      },
    };
  }
  if (key === "liquidations") {
    const rows = Array.isArray(data.rows) ? data.rows : Array.isArray(data.buckets) ? data.buckets : [];
    const totalLong = rows.reduce((sum, r) => sum + (Number(r.long_notional || r.longNotional) || 0), 0);
    const totalShort = rows.reduce((sum, r) => sum + (Number(r.short_notional || r.shortNotional) || 0), 0);
    return {
      url: result.url,
      ok: true,
      status: result.status,
      data: {
        symbol: data.symbol || "BTCUSDT",
        range: data.range || "30d",
        count: data.count || rows.length,
        latestEventAt: data.latestEventAt || data.freshness?.latestEventAt || null,
        totalLongNotional: Number(totalLong.toFixed(2)),
        totalShortNotional: Number(totalShort.toFixed(2)),
        collector: data.collector
          ? {
              status: data.collector.status,
              latestEventAt: data.collector.latestEventAt,
              latestEventAgeMs: data.collector.latestEventAgeMs,
            }
          : null,
      },
    };
  }
  if (key === "derivatives") {
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
  if (key === "derivativesSnapshot") {
    return {
      url: result.url,
      ok: true,
      status: result.status,
      data: {
        scope: data.scope,
        generatedAt: data.generatedAt,
        snapshotVersion: data.snapshotVersion,
        profile: data.profile,
        summary: data.summary || data.llmSummary || null,
        matrix: data.matrix || data.analysisMatrix || null,
        dataFreshness: data.dataFreshness || null,
      },
    };
  }
  return result;
}

async function fetchMarketContext(env) {
  const base = marketApiBase(env);
  const endpoints = {
    klines: `${base}/api/d1/klines?symbol=BTCUSDT&interval=1h&limit=96&sync=0`,
    derivatives: `${base}/api/d1/derivatives?symbol=BTCUSDT&range=30d&sync=0`,
    liquidations: `${base}/api/d1/liquidations?symbol=BTCUSDT&range=30d&includeActive=1`,
    derivativesSnapshot: `${base}/api/ai/derivatives-snapshot?profile=brief`,
  };
  const entries = await Promise.all(
    Object.entries(endpoints).map(async ([key, url]) => [key, compactMarketEndpoint(key, { url, ...(await fetchJsonOptional(url, 15_000)) })]),
  );
  const byKey = Object.fromEntries(entries);
  const errors = Object.entries(byKey)
    .filter(([, v]) => !v.ok)
    .map(([key, v]) => ({ source: key, message: v.error || `HTTP ${v.status}` }));
  return {
    ok: errors.length === 0,
    base,
    generatedAt: new Date().toISOString(),
    endpoints,
    data: byKey,
    errors,
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
  { name: "纳指", symbol: "QQQ" },
  { name: "标普500", symbol: "SPY" },
  { name: "英伟达", symbol: "NVDA" },
  { name: "黄金", symbol: "GLD" },
];

function buildRealMarketData(finnhubQuotes, btc) {
  const mk = {};
  for (const row of ASSET_ROWS) {
    const q = finnhubQuotes[row.symbol];
    const ch =
      q && q.ok && q.changePct != null ? String(q.changePct) : typeof q?.changePct === "number" ? String(q.changePct) : "0";
    mk[row.name] = { change: ch, price: q && q.ok && q.price != null ? String(q.price) : "0" };
  }
  const btcChange =
    btc && btc.ok && btc.change24hPct != null
      ? String(Number(btc.change24hPct).toFixed(4))
      : "0";
  const btcPrice =
    btc && btc.ok && btc.priceUsd != null ? String(btc.priceUsd) : "0";
  mk["比特币"] = { change: btcChange, price: btcPrice };
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

  const assets = [];
  for (const row of ASSET_ROWS) {
    const q = finQuotes[row.symbol] || {};
    assets.push({
      name: row.name,
      symbol: row.symbol,
      price: q.ok ? q.price : null,
      changePct: q.ok ? q.changePct : null,
      source: "finnhub",
      ok: !!q.ok,
      error: q.ok ? undefined : q.error || "quote missing",
    });
  }
  if (btc && btc.ok && btc.priceUsd != null) {
    assets.push({
      name: "比特币",
      symbol: "BTC",
      price: btc.priceUsd,
      changePct: btc.change24hPct,
      source: btc.source === "yahoo" ? "yahoo" : "coingecko",
      ok: true,
    });
  }

  const mkData = buildRealMarketData(finQuotes, btc);
  return {
    sources: {
      fng,
      btc,
      assets,
      errors,
    },
    realMarketData: mkData,
  };
}

/** ---- Prompts（由原 ribao-cloudflare/index.html 迁入） ---- */

function buildFlashPrompt(timeStr, fngScore, fngClass, realMarketData) {
  const bt = "```";
  const mkData = realMarketData;
  return (
    "当前时间：" +
    timeStr +
    "。\n" +
    "今日恐慌贪婪指数：" +
    fngScore +
    "（" +
    fngClass +
    "）。\n\n" +
    "【真实行情数据（以下数字已确认，无需猜测）】\n" +
    "- 纳斯达克100 ETF(QQQ) 24H涨跌：" +
    mkData["纳指"].change +
    "%\n" +
    "- 标普500 ETF(SPY) 24H涨跌：" +
    mkData["标普500"].change +
    "%\n" +
    "- 英伟达(NVDA) 24H涨跌：" +
    mkData["英伟达"].change +
    "%\n" +
    "- 比特币(BTC) 24H涨跌：" +
    mkData["比特币"].change +
    "%\n" +
    "- 黄金ETF(GLD) 24H涨跌：" +
    mkData["黄金"].change +
    "%\n\n" +
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
    mkData["纳指"].change +
    ",\n" +
    '      "catalyst": "【新闻催化】直接驱动本次涨跌的具体事件或数据（一句话，30字内）",\n' +
    '      "structure": "【结构判断】这个涨跌是强化还是打破原有趋势？机构资金方向有何信号？（一句话，35字内）"\n' +
    "    },\n" +
    "    {\n" +
    '      "name": "标普500",\n' +
    '      "change": ' +
    mkData["标普500"].change +
    ",\n" +
    '      "catalyst": "直接驱动事件（30字内）",\n' +
    '      "structure": "趋势结构与机构信号（35字内）"\n' +
    "    },\n" +
    "    {\n" +
    '      "name": "英伟达",\n' +
    '      "change": ' +
    mkData["英伟达"].change +
    ",\n" +
    '      "catalyst": "直接驱动事件（30字内）",\n' +
    '      "structure": "趋势结构与机构信号（35字内）"\n' +
    "    },\n" +
    "    {\n" +
    '      "name": "比特币",\n' +
    '      "change": ' +
    mkData["比特币"].change +
    ",\n" +
    '      "catalyst": "直接驱动事件（30字内）",\n' +
    '      "structure": "趋势结构与机构信号（35字内）"\n' +
    "    },\n" +
    "    {\n" +
    '      "name": "黄金",\n' +
    '      "change": ' +
    mkData["黄金"].change +
    ",\n" +
    '      "catalyst": "直接驱动事件（30字内）",\n' +
    '      "structure": "趋势结构与机构信号（35字内）"\n' +
    "    }\n" +
    "  ],\n" +
    '  "cross_asset": "跨资产关联解读：综合以上5个资产的涨跌组合，当前整体风险偏好是什么？资金在不同资产间如何流动？有无异常的资产背离信号？（60字内）",\n' +
    '  "anomaly_alert": "定价背离/异动预警：指出哪个资产表现出了不合理的Alpha异动，揭示定价逻辑的断裂（例如黄金脱离实际利率锚定），并简述其潜在含义。若无明显异动，输出「无明显背离」。（50字内）",\n' +
    '  "action_suggestion": "跨资产关联建议：针对当前的定价异动或整体资产关联状态，给小白投资者明确的操作或关注建议（例如建议观望、留意XX风险、减仓XX资产），并说明理由。（40字内）"\n' +
    "}\n" +
    bt +
    "\n"
  );
}

function buildProNewsPrompt(timeStr, fngScore, fngClass, realMarketData) {
  const mkData = realMarketData;
  const bt = "```";
  return (
    "当前时间：" +
    timeStr +
    "。\n" +
    "今日恐慌贪婪指数：" +
    fngScore +
    "（" +
    fngClass +
    "）。\n" +
    "主要资产24H涨跌：纳指 " +
    mkData["纳指"].change +
    "%，标普500 " +
    mkData["标普500"].change +
    "%，英伟达 " +
    mkData["英伟达"].change +
    "%，比特币 " +
    mkData["比特币"].change +
    "%，黄金 " +
    mkData["黄金"].change +
    "%。\n" +
    "---\n\n" +
    "请使用Google Search工具搜集最新资讯，并严格按照以下 JSON 格式输出，不要带有前缀和解释，请仅输出一个 JSON 块：\n\n" +
    "【结构要求】\n" +
    "输出必须包含三个字段：topStories（头条事件，必须3条）、dynamicBriefs（动态速览，必须5条）、macroTrend（宏观趋势总结）。\n\n" +
    "## 1. topStories (今日头条)\n" +
    "执行双轨搜索：\n" +
    "一轨（72小时热点）：过去72小时内影响最大的宏观/科技/地缘事件。\n" +
    "二轨（一周时间重量级）：若过去一周内存在重量级程度明显碾压所有72小时新闻的事件（标准：千亿级以上市值公司战略级发布、国家级政策转向、系统性金融风险、头部科技公司年度大会、地缘政治危机），优先纳入并标注[持续追踪]。\n\n" +
    "【条数判断规则】今日头条固定输出3条高价值事件。若多个事件属于同一宏观背景，也要拆成不同的资产传导维度；若事实不足，选择最新72小时内可验证性更高的事件补足，不要输出脚手架解释。\n\n" +
    "对于每一个头条对象，包含以下字段：\n" +
    '- "category"：事件类别，如 [地缘政治] / [宏观经济] / [科技产业] / [加密市场] / [企业动态] / [政策监管]\n' +
    '- "title"：事件核心标题\n' +
    '- "fact"：一句话说明事件时间、人物、动作和影响\n' +
    '- "structure"：包含三个字段的对象：\n' +
    '  - "trigger"：简述表面诱因\n' +
    '  - "conflict"：简述深层矛盾\n' +
    '  - "divergence"：交叉对比各方的官方声明与其实际行动\n' +
    '- "impacts"：受影响资产数组（通常1-3个），每个对象包含：\n' +
    '  - "asset"：资产名称（如 "BTC", "纳指", "美元", "黄金" 等）\n' +
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

function normalizeAiIntelFromLlm(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const it of arr.slice(0, 8)) {
    if (!it || typeof it !== "object") continue;
    const attentionRaw = String(it.attention || it.level || "中").trim();
    let attention = "中";
    if (/高/.test(attentionRaw)) attention = "高";
    else if (/低/.test(attentionRaw)) attention = "低";
    out.push({
      title: cleanReportText(it.title || it.headline, "AI 动态", 200),
      date: cleanReportText(
        it.date || it.publishDate || "",
        new Date().toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }),
        48,
      ),
      what: cleanReportText(it.what || it.news || it.summary, "", 500),
      use: cleanReportText(it.use || it.valueForUser || it.impact, "", 500),
      attention,
      sourceName: cleanReportText(it.sourceName || it.source || "Google 检索", 100),
      sourceUrl: cleanReportText(it.sourceUrl || it.url || "", "", 600),
    });
  }
  if (!out.length) {
    return [
      {
        title: "近72小时暂无满足筛选条目的重大 AI 发布",
        date: new Date().toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" }),
        what: "检索未命中符合时间窗与可核验要求的条目，未用训练记忆补位。",
        use: "可稍后使用「实时扫描」重试，或查看舆情分析全文。",
        attention: "低",
        sourceName: "Gemini + Google Search",
        sourceUrl: "",
      },
    ];
  }
  return out.slice(0, 6);
}

function renderAiIntelMarkdownForTrends(items) {
  const lines = [];
  for (const x of items || []) {
    lines.push(
      "### " +
        cleanReportText(x.title, "AI", 120) +
        "\n\n" +
        "**发布日期**：" +
        cleanReportText(x.date, "", 48) +
        "\n\n" +
        "**新了什么**：" +
        cleanReportText(x.what, "", 400) +
        "\n\n" +
        "**对我有什么用**：" +
        cleanReportText(x.use, "", 400) +
        "\n\n" +
        "**值得关注的程度**：" +
        cleanReportText(x.attention, "中", 8),
    );
  }
  return lines.join("\n\n");
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
  return env && env.YUQING_LLM_MODEL_FLASH ? String(env.YUQING_LLM_MODEL_FLASH) : YUQING_GEMINI_MODEL_DEFAULT;
}

function proseModel(env, mode) {
  const defFlash = flashModel(env);
  const pro = env && env.YUQING_LLM_MODEL_PRO ? String(env.YUQING_LLM_MODEL_PRO) : "";
  const isFast = String(mode || "").toLowerCase() === "fast";
  if (isFast) return env && env.YUQING_LLM_MODEL_FAST_PROSE ? String(env.YUQING_LLM_MODEL_FAST_PROSE) : defFlash;
  return pro || defFlash || YUQING_GEMINI_MODEL_DEFAULT;
}

function trendsModel(env, mode) {
  const t = env && env.YUQING_LLM_MODEL_TRENDS ? String(env.YUQING_LLM_MODEL_TRENDS) : "";
  return t || proseModel(env, mode);
}

async function geminiGenerateContent(env, modelId, prompt, opts) {
  const key = getGeminiKey(env);
  if (!key) throw new Error("GEMINI_API_KEY / GOOGLE_API_KEY 未配置");

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
    const apiErr =
      j && j.error ? String(j.error.message || j.error.status || JSON.stringify(j.error)) : textRaw.slice(0, 200);
    throw new Error(`Gemini HTTP ${res.status}: ${apiErr}`);
  }

  const parts = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts;
  if (!Array.isArray(parts)) throw new Error("Gemini 返回无 candidates/parts");
  let out = "";
  for (const p of parts) {
    if (p && p.text) out += p.text;
  }
  return out.trim();
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
  const keyAssets = [
    { name: "纳指", change: mkData["纳指"].change, catalyst: "（占位）数据源已就绪；催化需启用 LLM 后生成。", structure: "结构性判断待 LLM 输出。" },
    { name: "标普500", change: mkData["标普500"].change, catalyst: "（占位）", structure: "（占位）" },
    { name: "英伟达", change: mkData["英伟达"].change, catalyst: "（占位）", structure: "（占位）" },
    { name: "比特币", change: mkData["比特币"].change, catalyst: "（占位）", structure: "（占位）" },
    { name: "黄金", change: mkData["黄金"].change, catalyst: "（占位）", structure: "（占位）" },
  ];

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
      "多资产涨跌组合已拉取；跨资产传导与背离解读在已配置 GEMINI_API_KEY 且 YUQING_LLM_PROVIDER 为 gemini 或 auto（默认）时由模型生成。",
    anomalyAlert: "无明显背离",
    actionSuggestion: "建议先观察数据与新闻模块输出，勿据此单独做出交易决策。",
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
    trends: true,
    ...(bodyIn && bodyIn.modules && typeof bodyIn.modules === "object" ? bodyIn.modules : {}),
  };

  /** 默认 true（趋势综合含 AI 情报）。事件一览日报传 false：趋势仅综合「温度计 dashboard + 今日头条 + 动态速览」三块。 */
  const trendsUseAiIntel = !(bodyIn && bodyIn.trendsUseAiIntel === false);
  const dailyEventFocus = !!(bodyIn && bodyIn.dailyEventFocus);
  const dualHeadlineLanes = !!(bodyIn && bodyIn.dualHeadlineLanes);

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
  };

  const warnings = [];
  warnings.push({
    code: "notInvestmentAdvice",
    text: "本日报含模型生成内容，仅供信息整理与内部研究，不构成投资建议。",
  });

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
        trends: modules.trends,
        trendsUseAiIntel,
        dailyEventFocus,
        dualHeadlineLanes,
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
  let trendsMd = "";

  const sections = {
    news: { markdown: "", items: [], status: "planned", message: null },
    timeline: { markdown: "", items: [], status: "planned", message: null },
    ai: { markdown: "", status: "planned", message: null },
    trends: { markdown: "", status: "planned", message: null },
  };

  if (!llmEnabled) {
    sections.news = sectionsDisabledStatus("请在 Worker 设置 GEMINI_API_KEY（或 GOOGLE_API_KEY），并将 YUQING_LLM_PROVIDER 设为 gemini 或 auto（默认 auto：有密钥即启用）。");
    sections.timeline = sectionsDisabledStatus("同上。");
    sections.ai = { markdown: "", status: "disabled", message: "LLM 未启用", data: { aiIntel: [] } };
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
          const model = flashModel(env);
          const text = await geminiGenerateContent(env, model, prompt, { temperature: 0.1, googleSearch: false });
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

    let dailyTopStories = [];
    let dailyBriefs = [];

    const macroP =
      !dailyEventFocus &&
      needMacro &&
      (async () => {
        try {
          usedSearchNews = true;
          const prompt = buildProNewsPrompt(timeStr, fngScore, fngClass, realMarketData);
          const model = proseModel(env, mode);
          const combined = await geminiGenerateContent(env, model, prompt, { googleSearch: true });
          const inner = extractJsonFence(combined);
          const parsed = JSON.parse(inner);
          const topStories = normalizeDailyTopStoriesFromLlm(parsed.topStories, []);
          const dynamicBriefs = normalizeDailyBriefsFromLlm(parsed.dynamicBriefs, []);
          const macroTrend = cleanReportText(parsed.macroTrend, "", 420);
          newsMd = renderTopStoriesMarkdown(topStories, macroTrend);
          timelineMd = renderBriefsMarkdown(dynamicBriefs);

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
          const model = proseModel(env, mode);
          let rawList = [];
          if (dualHeadlineLanes) {
            const [ra, rb] = await Promise.all([
              (async () => {
                const text = await geminiGenerateContent(env, model, buildDailyTopStoriesPrompt(timeStr), {
                  googleSearch: true,
                  temperature: 0.25,
                });
                const inner = extractJsonFence(text);
                const parsed = JSON.parse(inner);
                return Array.isArray(parsed.topStories) ? parsed.topStories : [];
              })(),
              (async () => {
                const text = await geminiGenerateContent(env, model, buildDailyTopStoriesWirePrompt(timeStr), {
                  googleSearch: true,
                  temperature: 0.28,
                });
                const inner = extractJsonFence(text);
                const parsed = JSON.parse(inner);
                return Array.isArray(parsed.topStories) ? parsed.topStories : [];
              })(),
            ]);
            rawList = mergeTopStoryCandidatesForDaily(ra, rb);
          } else {
            const prompt = buildDailyTopStoriesPrompt(timeStr);
            const text = await geminiGenerateContent(env, model, prompt, { googleSearch: true, temperature: 0.25 });
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
          const model = proseModel(env, mode);
          const text = await geminiGenerateContent(env, model, prompt, { googleSearch: true, temperature: 0.3 });
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
          const model = proseModel(env, mode);
          const text = await geminiGenerateContent(env, model, prompt, { googleSearch: true, temperature: 0.35 });
          const inner = extractJsonFence(text);
          const parsed = JSON.parse(inner);
          const aiIntelItems = dailyEventFocus ? normalizeDailyAiIntelItems(parsed.aiIntel) : normalizeAiIntelFromLlm(parsed.aiIntel);
          aiMd = dailyEventFocus ? renderDailyAiIntelMarkdownForTrends(aiIntelItems) : renderAiIntelMarkdownForTrends(aiIntelItems);
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

    const runTrends = async () => {
      try {
        const prompt = dailyEventFocus
          ? buildDailyTrendCluesPrompt(newsMd, timelineMd, aiMd, flashDataJsonText)
          : buildProTrendsPrompt(newsMd, timelineMd, aiMd, flashDataJsonText, trendsUseAiIntel ? "full" : "daily_event_above_trend");
        const model = trendsModel(env, mode);
        trendsMd = await geminiGenerateContent(env, model, prompt, { googleSearch: false, temperature: 0.35 });
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
    llmStatus.capabilities.search = !!(usedSearchNews || usedSearchAi);
    if (streamSink) llmStatus.capabilities.stream = true;
  }

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
      usedSearch: { news: usedSearchNews, ai: usedSearchAi },
    },
    sources: {
      fng: sources.fng,
      btc: sources.btc,
      assets: sources.assets,
      errors: sources.errors,
    },
    llmStatus,
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
          JSON.stringify({ dashboard: out.dashboard, sections: out.sections, llmStatus: out.llmStatus }),
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
          trends: modules.trends,
          trendsUseAiIntel,
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

function trendMdSubstantiveLines(md) {
  return String(md || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith("#"));
}

/** 与 trends 同源；取第二段非空行或首段后半句，避免「还要等其他云端报告」的误导（定点/手动均走同一 buildReport）。 */
function crackingSnippetFromTrendsMd(trendsMd) {
  const lines = trendMdSubstantiveLines(trendsMd);
  if (lines.length >= 2) return lines[1];
  if (lines.length === 1) {
    const parts = lines[0]
      .split(/(?<=[。！？])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length >= 2) return parts.slice(1).join("");
  }
  return "与左侧强化同源：均为本轮同一请求内模型输出的趋势段落；全文仅一段时请重点阅读段内的风险、对立假设与限定条件。";
}

function trendReadFromDailyInputs(legacy, factCount) {
  const trendsMd = legacy && legacy.sections && legacy.sections.trends && legacy.sections.trends.markdown;
  const newsData = legacy && legacy.sections && legacy.sections.news && legacy.sections.news.data;
  const macroTrend = cleanReportText(newsData && newsData.macroTrend, "", 420);
  const hasLlm = !!String(trendsMd || "").trim();
  return {
    strengthening: macroTrend
      ? [macroTrend]
      : hasLlm
        ? [String(trendsMd).split("\n").find((x) => x.trim() && !x.startsWith("#")) || "LLM 已生成趋势研判，详见原始报告。"]
      : [`最近72小时内已有 ${factCount} 条候选，优先观察哪些主题正在连续出现。`],
    cracking: hasLlm ? [crackingSnippetFromTrendsMd(trendsMd)] : ["若事实密度不足，先降低分歧判断权重，等待更多来源确认。"],
    conclusion: "0-72小时观察：跟踪高价值事件是否获得官方口径、资金流与价格结构的共同确认。",
  };
}

async function buildDailyEventReport(env, opts) {
  const generatedAt = new Date(opts && opts.scheduledTime ? opts.scheduledTime : Date.now()).toISOString();
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
  try {
    legacy = await buildReport(env, {
      mode: opts && opts.mode ? opts.mode : "deep",
      force: true,
      allowSearch: !!(opts && opts.forceSearch),
      forceSearch: !!(opts && opts.forceSearch),
      dailyEventFocus: true,
      trendsUseAiIntel: true,
      dualHeadlineLanes: !!(opts && opts.dualHeadlineLanes),
      __streamSink: opts && opts.__streamSink,
      modules: { dashboard: true, news: true, timeline: true, ai: true, trends: true },
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
  
  let topStories = dailyTopStoriesFromFacts([]);
  let dynamicBriefs = dailyBriefsFromFacts([]);
  let macroTrend = "";

  if (legacy && legacy.sections && legacy.sections.news && legacy.sections.news.data) {
    const data = legacy.sections.news.data;
    if (Array.isArray(data.topStories) && data.topStories.length > 0) {
      topStories = normalizeDailyTopStoryItems(data.topStories, []);
    }
    if (Array.isArray(data.dynamicBriefs) && data.dynamicBriefs.length > 0) {
      dynamicBriefs = normalizeDailyBriefItems(data.dynamicBriefs, []);
    }
    macroTrend = cleanReportText(data.macroTrend, "", 420);
  }

  let aiIntel =
    legacy && legacy.sections && legacy.sections.ai && legacy.sections.ai.data && Array.isArray(legacy.sections.ai.data.aiIntel)
      ? legacy.sections.ai.data.aiIntel
      : dailyAiIntelFromFacts([]);

  const report = {
    title: "事件日报",
    subtitle: "日常新闻早午晚报",
    marketTemperature: buildDailyTemperature(agg.sources, dashboard),
    macroTrend,
    topStory: topStories[0],
    topStories,
    dynamicBriefs,
    aiIntel,
    trendRead: buildTrendReadFromDailyEventInputs(legacy, factRows.length),
    sources,
    quality: {
      factCount: factRows.length,
      sourceCoverage: Math.min(100, Math.max(20, sources.length * 14 + Math.min(30, factRows.length))),
      usedSearch: !!(legacy && legacy.grounding && legacy.grounding.usedSearch && (legacy.grounding.usedSearch.news || legacy.grounding.usedSearch.ai)),
      ingestRows: ingestResult ? Number(ingestResult.insertedRows || 0) : 0,
      caveat: "覆盖率按来源数量、事实密度与可追溯程度估算。",
    },
  };
  return {
    id: reportId(DAILY_EVENT_KIND, generatedAt),
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

function marketStateFromLegacy(legacy, marketSnapshot) {
  const dash = legacy && legacy.dashboard ? legacy.dashboard : null;
  const src = marketSnapshot && marketSnapshot.data && marketSnapshot.data.derivativesSnapshot && marketSnapshot.data.derivativesSnapshot.data;
  const score = dash && dash.sentimentSummary ? 62 : marketSnapshot && marketSnapshot.ok ? 58 : 46;
  return {
    regime: dash && dash.marketRegime ? dash.marketRegime : marketSnapshot && marketSnapshot.ok ? "市场数据可用，等待二次确认" : "市场快照存在缺口",
    score,
    bias: score >= 65 ? "偏多但需确认" : score <= 42 ? "偏谨慎" : "中性",
    confidence: marketSnapshot && marketSnapshot.ok ? 72 : 54,
    summary:
      dash && dash.crossAsset
        ? dash.crossAsset
        : "已读取事件日报和市场监测上下文，详细交易推演需结合风险雷达与机会条件。",
    keyAssets: Array.isArray(dash && dash.keyAssets)
      ? dash.keyAssets.map((x) => ({
          name: x.name || "",
          change: x.change != null ? String(x.change) : "",
          stance: x.structure || x.catalyst || "",
          driver: x.catalyst || x.structure || "",
        }))
      : [
          { name: "BTC", change: "", stance: "待确认", driver: "读取主行情 Worker 快照作为背景。" },
          { name: "衍生品", change: "", stance: src ? "有快照" : "待补齐", driver: "资金费率、OI 与期权快照参与二次判断。" },
        ],
  };
}

function riskRadarFromInputs(daily, marketSnapshot, facts) {
  const risks = [];
  const marketErrors = (marketSnapshot && marketSnapshot.errors) || [];
  if (marketErrors.length) {
    risks.push({
      level: "high",
      title: "市场监测上下文不完整",
      window: "当前",
      trigger: marketErrors.map((e) => e.source).join(" / "),
      assets: ["BTC", "衍生品", "强平"],
      response: "不要把本轮舆情结论当成完整交易信号，先核对市场监测页。",
    });
  }
  const dailyTitle = daily && daily.report && daily.report.topStory ? daily.report.topStory.title : "上游日报";
  risks.push({
    level: "mid",
    title: "上游事件继续发酵",
    window: "48-72h",
    trigger: dailyTitle,
    assets: ["BTC", "纳指", "美元", "美债"],
    response: "只在价格、资金流和衍生品结构同向时提高权重。",
  });
  if ((facts || []).length < 18) {
    risks.push({
      level: "mid",
      title: "事实池覆盖不足",
      window: "本轮",
      trigger: "D1 事实条目偏少",
      assets: ["信息质量"],
      response: "等待下一轮日报或手动强制增量搜索。",
    });
  }
  return risks.slice(0, 4);
}

function opportunitiesFromInputs(daily, marketSnapshot) {
  const hasMarket = !!(marketSnapshot && marketSnapshot.ok);
  return [
    {
      label: "顺势确认",
      direction: "BTC 方向确认",
      setup: hasMarket ? "事件日报主题与 K 线、衍生品、强平数据同向。" : "先恢复市场快照，再判断方向。",
      invalidation: "价格反应与事件叙事背离，或资金费率/OI 出现拥挤。",
      priority: hasMarket ? 76 : 52,
    },
    {
      label: "等待复核",
      direction: "不追第一反应",
      setup: "事件发生后等待 1-2 根高波动 K 线收敛，再观察 ETF/资金流确认。",
      invalidation: "上游日报事件被官方来源否认或热度迅速消退。",
      priority: 66,
    },
  ];
}

function calendarFromFacts(facts) {
  const rows = [];
  for (const it of facts || []) {
    if (rows.length >= 6) break;
    const cat = String(it.category || "").toLowerCase();
    const title = String(it.title || "");
    if (!/macro|calendar|economic|cpi|fed|fomc|就业|通胀|利率/i.test(`${cat} ${title}`)) continue;
    rows.push({
      id: it.id || `event-${rows.length}`,
      title: title || "宏观事件",
      startsAtUtc: new Date(Number(it.publishedAt || it.fetchedAt || Date.now())).toISOString(),
      precision: "date",
      displayTimezone: "Asia/Shanghai",
      sourceType: it.sourceType || "fact_pool",
      sourceName: it.source || "Yuqing D1",
      sourceUrl: it.url || "",
      confidence: Number(it.confidence || 0.62),
      impactScore: Math.max(50, Math.round(Number(it.confidence || 0.62) * 100)),
      assets: ["BTC", "美元", "美债", "纳指"],
      why: itemSummary(it, "宏观事件可能影响风险资产定价。"),
    });
  }
  return rows;
}

function trendReadForSentiment(legacy, incremental) {
  const md = legacy && legacy.sections && legacy.sections.trends && legacy.sections.trends.markdown;
  return {
    strengthening: md ? ["云端趋势模块已生成，结合事件日报与市场快照给出二次判断。"] : ["事件日报和市场监测已合并为本轮舆情底座。"],
    fracturing: incremental && incremental.used ? ["本轮触发按需增量搜索，说明上游事实或市场上下文存在缺口。"] : ["未触发额外搜索，说明上游日报与事实池覆盖暂时够用。"],
    checklist: ["先核对市场监测页数据新鲜度。", "再看事件日报主题是否继续出现新事实。", "最后用风险雷达决定是否需要降低仓位或等待确认。"],
  };
}

async function buildSentimentAnalysisReport(env, opts) {
  const generatedAt = new Date(opts && opts.scheduledTime ? opts.scheduledTime : Date.now()).toISOString();
  const triggerType = normalizeTriggerType(opts && opts.triggerType);
  const slot = opts && opts.slot ? String(opts.slot) : bjtSlotLabel(SENTIMENT_ANALYSIS_KIND, generatedAt);
  const sourceErrors = [];
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
    forceSearch: !!(opts && opts.forceSearch),
  });
  if (inc.useSearch) {
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
      allowSearch: inc.useSearch,
      forceSearch: !!(opts && opts.forceSearch),
      modules: { dashboard: true, news: true, timeline: true, ai: true, trends: true },
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
  const incrementalSearch = { used: inc.useSearch, reasons: inc.reasons, excludedSourceIds };
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
    marketState: marketStateFromLegacy(legacy, marketSnapshot),
    riskRadar: riskRadarFromInputs(daily, marketSnapshot, factRows),
    opportunityScanner: opportunitiesFromInputs(daily, marketSnapshot),
    eventCalendar: calendarFromFacts(factRows),
    aiIntel: (
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
    trendRead: trendReadForSentiment(legacy, incrementalSearch),
    incrementalSearch,
    quality: {
      factCount: factRows.length,
      sourceCoverage: Math.min(100, Math.max(20, factRows.length + (marketSnapshot.ok ? 35 : 10))),
      marketSnapshotOk: !!marketSnapshot.ok,
      usedSearch: inc.useSearch,
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
      quality: report.quality,
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
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (maintenanceEnabled(env)) {
      return json({ ok: false, error: "舆情日报 Worker 维护中，暂不可用。" }, 503);
    }

    const url = new URL(request.url);
    const path = url.pathname;

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
            flash: env && env.YUQING_LLM_MODEL_FLASH ? String(env.YUQING_LLM_MODEL_FLASH) : YUQING_GEMINI_MODEL_DEFAULT,
            pro: env && env.YUQING_LLM_MODEL_PRO ? String(env.YUQING_LLM_MODEL_PRO) : "",
            trends: env && env.YUQING_LLM_MODEL_TRENDS ? String(env.YUQING_LLM_MODEL_TRENDS) : "",
          },
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
        if (!report) return json({ ok: false, error: "报告不存在" }, 404);
        return json({ ok: true, workerBuild: WORKER_BUILD, d1Ready: true, report });
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
          dualHeadlineLanes: !!(bodyIn && bodyIn.dualHeadlineLanes),
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
          const safeWrite = (obj) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
            } catch (_) {}
          };
          try {
            safeWrite({ type: "start", workerBuild: WORKER_BUILD, d1Ready: true });
            const payload = await buildDailyEventReport(env, {
              triggerType: "manual",
              forceSearch: !!(bodyIn && bodyIn.forceSearch),
              mode: bodyIn && bodyIn.mode,
              dualHeadlineLanes: !!(bodyIn && bodyIn.dualHeadlineLanes),
              __streamSink: (evt) => safeWrite(evt),
            });
            await insertYuqingReport(env.YUQING_DB, payload);
            await pruneYuqingReports(env.YUQING_DB, REPORT_RETENTION_DAYS).catch(() => {});
            await pruneOldItems(env.YUQING_DB, REPORT_RETENTION_DAYS).catch(() => {});
            safeWrite({ type: "done", ok: true, report: payload });
          } catch (e) {
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
        const model = String((bodyIn && bodyIn.model) || flashModel(env));
        const text = await geminiGenerateContent(env, model, prompt, { googleSearch: false, temperature: 0.2 });
        return json({ ok: true, model, text });
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
          "POST /api/yuqing/reports/generate",
          "POST /api/yuqing/reports/generate-stream",
          "POST /api/yuqing/report (compat: sentiment_analysis)",
          "POST /api/yuqing/ingest (+X-Yuqing-Cron-Secret)",
          "POST /api/yuqing/llm/test",
        ],
      });
    }

    return json({ ok: false, error: "Not found" }, 404);
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
