/**
 * Cloudflare Worker：舆情日报（yuqing.feiniwork.com）
 *
 * - 聚合 FNG、CoinGecko BTC、Finnhub 批量 ETF/股票报价及事实池。
 * - 历史报告只读；自动与手动模型报告生成均已退役。
 *
 * 兼容旧 api.feiniwork.com 的路径：/finnhub-bulk、/finnhub/*（建议使用 /api/yuqing/*）
 *
 * 目录：与本文件同包的 `yuqing-facts.js`（事实池）、`shijian/`（事件一览拆分）、`fenxi/`（舆情分析拆分）。
 */

import {
  d1Bound,
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
  defaultFenxiDashboardSettings,
  fenxiModuleShell,
  normalizeFenxiDashboardSettings,
} from "./fenxi/index.js";
import {
  YUQING_SHIJIAN_PAGE,
  shijianModuleShell,
} from "./shijian/index.js";
import { accessCorsHeaders, accessServiceHeaders, requireCloudflareAccess } from "../access-auth.js";


const FINNHUB_ORIGIN = "https://finnhub.io";
const ALT_FNG = "https://api.alternative.me/fng/";
const COINGECKO_BTC = "https://api.coingecko.com/api/v3/simple/price";
const YAHOO_CHART_ORIGIN = "https://query1.finance.yahoo.com/v8/finance/chart";

const WORKER_BUILD = "yuqing-worker/1.6.0-cloud-only";
const FETCH_TIMEOUT_SOURCES_MS = 12_000;
const REPORT_RETENTION_DAYS = 7;
const DAILY_EVENT_KIND = "daily_event";
const SENTIMENT_ANALYSIS_KIND = "sentiment_analysis";
const DAILY_EVENT_SLOTS_BJT = new Set(["00:00", "08:00", "12:00", "20:00"]);
const SENTIMENT_ANALYSIS_SLOTS_BJT = new Set(["09:00", "14:00", "22:00"]);
const DEFAULT_MARKET_API_BASE = "https://btc.feiniwork.com";
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
      return json({
        ok: true,
        workerBuild: WORKER_BUILD,
        time: new Date().toISOString(),
        maintenance: maintenanceEnabled(env),
        automaticReports: false,
        llm: { provider: "none", enabled: false },
        secrets: {
          finnhub: !!(env && env.FINNHUB_API_KEY),
          d1Ready: d1Bound(env),
        },
      });
    }

    if (
      path === "/api/yuqing/settings/model-channels" ||
      path === "/api/yuqing/reports/generate" ||
      path === "/api/yuqing/reports/generate-stream" ||
      path === "/api/yuqing/report" ||
      path === "/api/yuqing/llm/test"
    ) {
      return json({ ok: false, error: "模型报告生成已退役；历史报告仍可读取。" }, 410);
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
          "GET /api/yuqing/settings/event-dashboard",
          "PUT /api/yuqing/settings/event-dashboard",
          "GET /api/yuqing/settings/sentiment-analysis",
          "PUT /api/yuqing/settings/sentiment-analysis",
          "POST /api/yuqing/ingest (+X-Yuqing-Cron-Secret)",
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

};
