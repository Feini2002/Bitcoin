import { accessCorsHeaders, requireCloudflareAccess } from "./access-auth.js";

/**
 * Cloudflare Worker：币安 U 本位永续 K 线的云端数据层
 *
 * 三件事：
 *   1) Cron（每 5 分钟）按需增量拉取 5m/15m/1h/4h/1d/3d/1w 的 K 线，入库 D1；
 *      每个 (symbol, interval) 只保留最新 2000 根。
 *   2) 提供读接口：GET /api/d1/klines?symbol=&interval=&limit=   → 从 D1 读并返回 JSON
 *   3) 提供设置页/运维手动同步接口：POST/GET /api/d1/sync?symbol=&interval=(all|5m,15m,...)
 *      图表页只读 /api/d1/klines?sync=0；以及向后兼容的 fapi 代理：
 *      /api/binance/klines | /fapi/v1/klines | /api/binance/ticker/price
 *   4) 低权重稳定币背景：内部同步 USDT/USDC 到 D1，并合并进衍生品 payload / AI snapshot。
 *
 * 重要：
 *   - K 线优先用币安数据。直连 5 个 fapi 入口重试；若全部失败，可由 env.BINANCE_FAPI_ORIGIN
 *     指向一个你自有 HTTPS 反代（仅把 /fapi/* 转发到 fapi.binance.com）。
 *   - 若币安在当前 Worker 边缘地域不可用，K 线可回退 Bybit linear 同形数据（可用
 *     KLINE_ALTERNATE_FAILOVER=0 禁用）。不返回任何演示/假数据。
 *   - 免费版 Workers Cron Triggers + D1 Free 足够使用；写入为增量（每次 2~3 行），
 *     不会超免费额度。
 */

const BINANCE_HOSTS = [
  "fapi.binance.com",
  "fapi1.binance.com",
  "fapi2.binance.com",
  "fapi3.binance.com",
  "fapi4.binance.com",
];
const BINANCE_DERIVATIVE_HOSTS = [
  "fapi.binance.com",
  "fapi1.binance.com",
  "fapi2.binance.com",
  "fapi3.binance.com",
  "fapi4.binance.com",
];

const DEFAULT_SYMBOL = "BTCUSDT";
const SUPPORTED_INTERVALS = ["5m", "15m", "1h", "4h", "1d", "3d", "1w"];
const FOOTPRINT_INTERVALS = ["5m", "15m", "1h", "4h"];
const FOOTPRINT_BASE_INTERVAL = "5m";
const FOOTPRINT_BASE_TICK = 1;
const FOOTPRINT_MAX_BARS = 8640;
const FOOTPRINT_API_MAX_LIMIT = 240;
const FOOTPRINT_BACKFILL_WINDOW_MS = 5 * 60 * 1000;
const FOOTPRINT_BACKFILL_DEFAULT_WINDOWS = 36;
const FOOTPRINT_BACKFILL_MAX_WINDOWS = 40;
const FOOTPRINT_FETCH_LIMIT = 1000;
/** Cron / 手动 footprint 单次最多拉取的 aggTrades 页数（每页 FOOTPRINT_FETCH_LIMIT）；增大以追上 last_trade_id 积压，避免前台「延迟/503」误判。*/
const FOOTPRINT_MAX_FETCH_PAGES = 14;
const FOOTPRINT_READ_AUTO_SYNC_MIN_MS = 45 * 1000;
const FOOTPRINT_READ_CACHE_SECONDS = 20;
const MAX_KLINES_PER_INTERVAL = 2000;
const BINANCE_MAX_LIMIT_PER_REQUEST = 1500;
const BYBIT_MAX_LIMIT_PER_REQUEST = 1000;
const FETCH_TIMEOUT_MS = 8000;
/** Gemini REST（与 yuqing Worker 对齐）；密钥来自 Secret GEMINI_API_KEY / GOOGLE_API_KEY */
const FETCH_TIMEOUT_LLM_MS = 118_000;
const GEMINI_ORIGIN = "https://generativelanguage.googleapis.com";
/** Worker 构建标识（部署后可用于对照线上是否与仓库一致）；仅元数据头，不影响业务语义。 */
const WORKER_BUILD = "btc-worker/3.7.9-gemini-llm-sync";
const KLINE_READ_AUTO_SYNC_MIN_MS = 45 * 1000;
const KLINE_READ_CACHE_SECONDS = 8;
const DERIVATIVE_READ_CACHE_SECONDS = 30;
const LIQUIDATION_READ_CACHE_SECONDS = 20;
const STATUS_READ_CACHE_SECONDS = 30;
const LIQUIDATION_SYMBOL = DEFAULT_SYMBOL;
const LIQUIDATION_BUCKET_MS = 5 * 60 * 1000;
const LIQUIDATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const LIQUIDATION_COLLECTOR_NAME = "BTCUSDT";
const LIQUIDATION_BINANCE_STALE_MS = 90_000;
const LIQUIDATION_BYBIT_STALE_MS = 60_000;
const LIQUIDATION_RECONNECT_MS = 3500;
const LIQUIDATION_ALARM_MS = 60_000;
const LIQUIDATION_HEALTH_FRESH_MS = 2 * 60 * 1000;
const DERIVATIVE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DERIVATIVE_FAST_SYNC_MIN_MS = 15 * 60 * 1000;
const DERIVATIVE_SLOW_SYNC_MIN_MS = 60 * 60 * 1000;
const DERIVATIVE_STALE_RETRY_GRACE_MS = 10 * 60 * 1000;
const DERIVATIVE_STALE_RETRY_MIN_ATTEMPT_GAP_MS = 12 * 60 * 1000;
const DERIVATIVE_METRICS = [
  "funding_binance",
  "oi_binance",
  "vix",
  "vix3m",
  "move",
  "long_short",
  "taker_buy_sell",
  "basis_perp",
  "basis_quarter",
  "top_account_long_short",
  "top_position_long_short",
];

/** 衍生品面板：口径与衍生品面板 `derivativesSnapshotCore.mjs` 保持一致（仅数值与分层规则同步）。 */
const DERIV_MACRO_METRICS = ["vix", "vix3m", "move"];
const DERIV_MACRO_METRICS_SET = new Set(DERIV_MACRO_METRICS);

/** Yahoo 宏观旁路：独立预算，不阻塞核心链路。 */
const DERIV_MACRO_SYNC_MIN_MS = 6 * 60 * 60 * 1000;

/** `groups=core-proprietary` 仅补齐 Binance 专有历史（不含 Funding/OI fast 快照与 funding/oi hist）。 */
const DERIV_CORE_BINANCE_HEAVY = [
  "long_short",
  "taker_buy_sell",
  "basis_perp",
  "basis_quarter",
  "top_account_long_short",
  "top_position_long_short",
];
const DERIV_CORE_BINANCE_HEAVY_SET = new Set(DERIV_CORE_BINANCE_HEAVY);

/** 衍生品同步任务粒度（写入 D1 derivative_metric_health 的 metric 字段，与业务 metric 区分开）。*/
function derivativeTaskHealthKey(metric, task = "snap") {
  const m = String(metric || "").trim();
  const t = String(task || "snap").trim();
  return `${m}#${t}`;
}

const DERIV_TASK_MIN_INTERVAL_MS = {
  /** fast 快照 */
  [derivativeTaskHealthKey("funding_binance", "snap")]: 10 * 60 * 1000,
  [derivativeTaskHealthKey("oi_binance", "snap")]: 10 * 60 * 1000,
  /** 常用 1h 历史聚合 */
  [derivativeTaskHealthKey("funding_binance", "hist")]: 45 * 60 * 1000,
  [derivativeTaskHealthKey("oi_binance", "hist")]: 45 * 60 * 1000,
  [derivativeTaskHealthKey("long_short", "hist")]: 45 * 60 * 1000,
  [derivativeTaskHealthKey("taker_buy_sell", "hist")]: 45 * 60 * 1000,
  /** 更重端点 */
  [derivativeTaskHealthKey("basis_perp", "hist")]: 60 * 60 * 1000,
  [derivativeTaskHealthKey("basis_quarter", "hist")]: 60 * 60 * 1000,
  [derivativeTaskHealthKey("top_account_long_short", "hist")]: 60 * 60 * 1000,
  [derivativeTaskHealthKey("top_position_long_short", "hist")]: 60 * 60 * 1000,
  /** 宏观 Yahoo */
  [derivativeTaskHealthKey("vix", "macro")]: DERIV_MACRO_SYNC_MIN_MS,
  [derivativeTaskHealthKey("vix3m", "macro")]: DERIV_MACRO_SYNC_MIN_MS,
  [derivativeTaskHealthKey("move", "macro")]: DERIV_MACRO_SYNC_MIN_MS + 90 * 60 * 1000,
};

const DERIV_FUNDING_CROWD_ABS = 0.0005;
const DERIV_RATIO_BAND_HIGH = 1.05;
const DERIV_RATIO_BAND_LOW = 0.95;
const DERIV_TAKER_IMBALANCE_TOL = 0.1;
const DERIV_BASIS_ELEVATED_PCT = 8;
const DERIV_BASIS_DISCOUNT_PCT = -1;

const ONCHAIN_GLOBAL_SCOPE = "GLOBAL";
/** 与其他面板一致：约 90 天展示窗口；超期点由 prune 删掉 */
const ONCHAIN_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const ONCHAIN_STABLE_METRICS = ["stable_usdt_circ", "stable_usdc_circ"];
const ONCHAIN_METRICS = [...ONCHAIN_STABLE_METRICS];
const ONCHAIN_RELIABILITY = {
  tier: "free-stablecoin-only",
  weight: "low",
  confidence: "low_to_medium",
  score: 0.2,
  rationale: [
    "稳定币历史主要来自 CoinGecko 公共接口，可能被限流；DeFiLlama 仅作为当前快照兜底。",
    "交易所余额、鲸鱼、矿工、BTC 网络健康等指标不再接入，避免免费源口径弱、空数据和维护成本误导 LLM。",
    "本页只适合观察稳定币流动性背景，不应单独触发交易方向、开仓、加仓或止损决策。",
  ],
  llmPolicy:
    "Treat on-chain panel as low-weight stablecoin liquidity background only. Ignore missing exchange, whale, miner, or network-health fields; never make this page the primary trade trigger.",
};

const CORS = {
  "Access-Control-Expose-Headers":
    "X-Worker-Build, X-Proxy-Target, X-Data-Source, X-Upstream-Status, X-Upstream-Error, X-Failover-Chain, X-Worker-Note, X-D1-Count, X-D1-Latest-T, X-D1-Auto-Sync, X-D1-Auto-Sync-Ok, X-D1-Manual-Sync, X-D1-Footprint-Count, X-D1-Footprint-Synced",
};

/* =============================================================
 * 工具函数
 * ============================================================= */

function headersMerge(extra) {
  return new Headers(accessCorsHeaders(null, { ...CORS, ...Object.fromEntries(Object.entries(extra || {})) }));
}

function publicCacheHeader(maxAgeSeconds, staleSeconds = 30) {
  const maxAge = Math.max(0, Math.round(Number(maxAgeSeconds) || 0));
  const stale = Math.max(0, Math.round(Number(staleSeconds) || 0));
  if (!maxAge) return "no-store";
  return `public, max-age=${maxAge}, stale-while-revalidate=${stale}`;
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: headersMerge({
      "Content-Type": "application/json; charset=utf-8",
      "X-Worker-Build": WORKER_BUILD,
      ...extraHeaders,
    }),
  });
}

function parseCustomFapiOrigin(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  try {
    const u = new URL(String(raw).trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    u.hash = "";
    u.pathname = "";
    u.search = "";
    return u.origin;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(u, opts, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(u, { ...(opts || {}), signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function getGeminiApiKey(env) {
  if (!env) return "";
  const k = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
  return k ? String(k) : "";
}

/** BTC_LLM_PROVIDER：none | gemini | google | auto（默认 auto：有密钥则启用） */
function resolveBtcLlmProvider(env) {
  const hasExplicit = env && env.BTC_LLM_PROVIDER != null && String(env.BTC_LLM_PROVIDER).trim() !== "";
  const raw = hasExplicit ? String(env.BTC_LLM_PROVIDER).trim().toLowerCase() : "auto";
  if (raw === "auto") return getGeminiApiKey(env) ? "gemini" : "none";
  if (raw === "none" || raw === "off" || raw === "disable") return "none";
  if (raw === "gemini" || raw === "google") return "gemini";
  return "none";
}

function btcGeminiModel(env) {
  return env && env.BTC_GEMINI_MODEL ? String(env.BTC_GEMINI_MODEL) : "gemini-2.0-flash";
}

async function btcGeminiGenerateText(env, prompt, opts) {
  const key = getGeminiApiKey(env);
  if (!key) throw new Error("GEMINI_API_KEY / GOOGLE_API_KEY 未配置");
  const modelId = btcGeminiModel(env);
  const useSearch = !!(opts && opts.googleSearch);
  /** @type {any} */
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: opts && opts.temperature != null ? opts.temperature : useSearch ? 0.35 : 0.12,
    },
  };
  if (useSearch) body.tools = [{ google_search: {} }];
  const url =
    GEMINI_ORIGIN +
    `/v1beta/models/${encodeURIComponent(modelId)}:generateContent` +
    `?key=` +
    encodeURIComponent(key);
  const res = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    },
    FETCH_TIMEOUT_LLM_MS,
  );
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

async function handleAiLlmStatus(_request, env) {
  const keyOk = !!getGeminiApiKey(env);
  const provider = resolveBtcLlmProvider(env);
  return json(
    {
      ok: true,
      worker: "btc",
      geminiKeyConfigured: keyOk,
      llmProvider: provider,
      llmActive: provider === "gemini" && keyOk,
      modelDefault: btcGeminiModel(env),
      workerBuild: WORKER_BUILD,
    },
    200,
    { "Cache-Control": "no-store" },
  );
}

function intervalMs(interval) {
  const unit = String(interval || "").slice(-1);
  const num = parseInt(String(interval || "1m").slice(0, -1), 10) || 1;
  if (unit === "m") return num * 60 * 1000;
  if (unit === "h") return num * 60 * 60 * 1000;
  if (unit === "d") return num * 24 * 60 * 60 * 1000;
  if (unit === "w") return num * 7 * 24 * 60 * 60 * 1000;
  return 5 * 60 * 1000;
}

function bucketStart(ms, interval) {
  const step = intervalMs(interval);
  return Math.floor(Number(ms) / step) * step;
}

function roundToTick(price, tick) {
  const t = Number(tick) || 1;
  const d = String(t).includes(".") ? Math.min(8, String(t).split(".")[1].length) : 0;
  return Number((Math.round(Number(price) / t) * t).toFixed(d));
}

function klineAlternateFailoverEnabled(env) {
  const raw = env && env.KLINE_ALTERNATE_FAILOVER != null ? String(env.KLINE_ALTERNATE_FAILOVER).trim() : "1";
  return !/^0|false$/i.test(raw);
}

function mapIntervalToBybit(interval) {
  const map = {
    "1m": "1",
    "3m": "3",
    "5m": "5",
    "15m": "15",
    "30m": "30",
    "1h": "60",
    "2h": "120",
    "4h": "240",
    "6h": "360",
    "12h": "720",
    "1d": "D",
    "3d": "D",
    "1w": "W",
  };
  return map[String(interval)] || "15";
}

function mapSymbolToOkxSwap(symbol) {
  const s = String(symbol || "").toUpperCase();
  if (s === "BTCUSDT") return "BTC-USDT-SWAP";
  const m = /^([A-Z0-9]+)USDT$/.exec(s);
  return m && m[1] ? `${m[1]}-USDT-SWAP` : null;
}

function mapIntervalToOkx(interval) {
  const map = {
    "1m": "1m",
    "3m": "3m",
    "5m": "5m",
    "15m": "15m",
    "30m": "30m",
    "1h": "1H",
    "2h": "2H",
    "4h": "4H",
    "1d": "1Dutc",
    "3d": "3Dutc",
    "1w": "1Wutc",
  };
  return map[String(interval)] || "15m";
}

function bybitListToBinanceKlines(list, interval) {
  if (String(interval) === "3d") {
    const buckets = new Map();
    for (const row of Array.isArray(list) ? list : []) {
      const t = parseInt(String(row && row[0]), 10);
      const o = Number(row && row[1]);
      const h = Number(row && row[2]);
      const l = Number(row && row[3]);
      const c = Number(row && row[4]);
      const v = Number(row && row[5] != null ? row[5] : 0);
      if (![t, o, h, l, c].every(Number.isFinite)) continue;
      const start = bucketStart(t, "3d");
      const current = buckets.get(start);
      if (!current) {
        buckets.set(start, { t: start, o, h, l, c, v: Number.isFinite(v) ? v : 0, lastT: t });
        continue;
      }
      current.h = Math.max(current.h, h);
      current.l = Math.min(current.l, l);
      if (t >= current.lastT) {
        current.c = c;
        current.lastT = t;
      }
      current.v += Number.isFinite(v) ? v : 0;
    }
    const step = intervalMs("3d");
    return Array.from(buckets.values())
      .sort((a, b) => a.t - b.t)
      .map((row) => [
        row.t,
        String(row.o),
        String(row.h),
        String(row.l),
        String(row.c),
        String(row.v),
        row.t + step - 1,
        "0",
        "0",
        "0",
        "0",
        "0",
      ]);
  }

  const step = intervalMs(interval);
  return (Array.isArray(list) ? list : []).map((row) => {
    const t = parseInt(String(row && row[0]), 10);
    return [
      t,
      String(row && row[1]),
      String(row && row[2]),
      String(row && row[3]),
      String(row && row[4]),
      String(row && row[5] != null ? row[5] : "0"),
      t + step - 1,
      "0",
      "0",
      "0",
      "0",
      "0",
    ];
  }).filter((row) => Number.isFinite(Number(row[0])));
}

function okxCandlesToBinanceKlines(list, interval, startTime) {
  const step = intervalMs(interval);
  const minT = Number(startTime);
  return (Array.isArray(list) ? list : [])
    .map((row) => {
      const t = parseInt(String(row && row[0]), 10);
      const o = Number(row && row[1]);
      const h = Number(row && row[2]);
      const l = Number(row && row[3]);
      const c = Number(row && row[4]);
      const volCcy = Number(row && row[6]);
      const vol = Number(row && row[5]);
      const v = Number.isFinite(volCcy) ? volCcy : Number.isFinite(vol) ? vol : 0;
      if (![t, o, h, l, c].every(Number.isFinite)) return null;
      if (Number.isFinite(minT) && minT > 0 && t < minT) return null;
      return [
        t,
        String(o),
        String(h),
        String(l),
        String(c),
        String(v),
        t + step - 1,
        "0",
        "0",
        "0",
        "0",
        "0",
      ];
    })
    .filter(Boolean)
    .sort((a, b) => Number(a[0]) - Number(b[0]));
}

/* =============================================================
 * 从币安拉取 klines（依次尝试多个 host + 自定义反代）
 * 返回原始数组（[t, o, h, l, c, v, T, ...]）或失败信息
 * ============================================================= */

async function fetchKlinesFromBinance(env, { symbol, interval, limit, startTime, endTime }) {
  const customOrigin = parseCustomFapiOrigin(env && env.BINANCE_FAPI_ORIGIN);
  const origins = customOrigin ? [customOrigin] : BINANCE_HOSTS.map((h) => `https://${h}`);

  const p = new URLSearchParams();
  p.set("symbol", symbol);
  p.set("interval", interval);
  if (limit != null) p.set("limit", String(Math.min(BINANCE_MAX_LIMIT_PER_REQUEST, Math.max(1, limit))));
  if (startTime != null) p.set("startTime", String(startTime));
  if (endTime != null) p.set("endTime", String(endTime));

  const chain = [];
  let firstErr = { status: 0, error: "" };

  for (const origin of origins) {
    const target = origin.replace(/\/$/, "") + "/fapi/v1/klines?" + p.toString();
    let host = origin;
    try { host = new URL(origin).host; } catch (_) {}
    try {
      const r = await fetchWithTimeout(target, {
        headers: {
          "User-Agent": "BitDesk-CF-Worker/3.0 (KlinesSync)",
          Accept: "application/json",
        },
      });
      if (!r.ok) {
        let err = "";
        try { err = (await r.text()).slice(0, 180); } catch (_) { err = r.statusText || ""; }
        chain.push(`${host}:${r.status}`);
        if (!firstErr.error) firstErr = { status: r.status, error: err.replace(/\s+/g, " ").trim() };
        continue;
      }
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch (_) {
        chain.push(`${host}:parse`);
        if (!firstErr.error) firstErr = { status: r.status, error: "parse fail" };
        continue;
      }
      if (!Array.isArray(data)) {
        chain.push(`${host}:bad-shape`);
        if (!firstErr.error) firstErr = { status: r.status, error: "bad shape" };
        continue;
      }
      chain.push(`${host}:ok`);
      return { ok: true, klines: data, host, chain, raw: text };
    } catch (e) {
      const msg = (e && e.message ? e.message : String(e)).replace(/\s+/g, " ").trim().slice(0, 140);
      chain.push(`${host}:err ${msg.slice(0, 40)}`);
      if (!firstErr.error) firstErr = { status: 0, error: msg || "network error" };
    }
  }

  return { ok: false, chain, error: firstErr.error || "all failed", status: firstErr.status };
}

async function fetchKlinesFromBybit(_env, { symbol, interval, limit, startTime, endTime }) {
  const p = new URLSearchParams();
  p.set("category", "linear");
  p.set("symbol", symbol);
  p.set("interval", mapIntervalToBybit(interval));
  p.set("limit", String(Math.min(BYBIT_MAX_LIMIT_PER_REQUEST, Math.max(1, Number(limit) || BYBIT_MAX_LIMIT_PER_REQUEST))));
  if (startTime != null) p.set("start", String(startTime));
  if (endTime != null) p.set("end", String(endTime));

  const target = "https://api.bybit.com/v5/market/kline?" + p.toString();
  try {
    const r = await fetchWithTimeout(target, {
      headers: {
        "User-Agent": "BitDesk-CF-Worker/3.0 (KlinesBybitFailover)",
        Accept: "application/json",
      },
    });
    if (!r.ok) {
      let err = "";
      try { err = (await r.text()).slice(0, 180); } catch (_) { err = r.statusText || ""; }
      return { ok: false, chain: [`bybit:${r.status}`], error: err.replace(/\s+/g, " ").trim() || `HTTP ${r.status}`, status: r.status };
    }
    const data = await r.json().catch(() => null);
    if (!data || Number(data.retCode) !== 0 || !data.result || !Array.isArray(data.result.list)) {
      const msg = data && data.retMsg ? String(data.retMsg) : "bad shape";
      return { ok: false, chain: ["bybit:bad-shape"], error: msg, status: r.status };
    }
    const klines = bybitListToBinanceKlines(data.result.list.slice().reverse(), interval);
    if (!klines.length) {
      return { ok: false, chain: ["bybit:empty"], error: "empty bybit kline response", status: r.status };
    }
    return {
      ok: true,
      klines,
      host: "api.bybit.com",
      source: "bybit-failover",
      chain: ["bybit:ok"],
      raw: JSON.stringify(klines),
    };
  } catch (e) {
    const msg = (e && e.message ? e.message : String(e)).replace(/\s+/g, " ").trim().slice(0, 140);
    return { ok: false, chain: [`bybit:err ${msg.slice(0, 40)}`], error: msg || "network error", status: 0 };
  }
}

async function fetchKlinesFromOkx(_env, { symbol, interval, limit, startTime }) {
  const instId = mapSymbolToOkxSwap(symbol);
  if (!instId) {
    return { ok: false, chain: ["okx:unsupported-symbol"], error: `unsupported OKX symbol ${symbol}`, status: 0 };
  }
  const p = new URLSearchParams();
  p.set("instId", instId);
  p.set("bar", mapIntervalToOkx(interval));
  p.set("limit", String(Math.min(300, Math.max(1, Number(limit) || 300))));

  const target = "https://www.okx.com/api/v5/market/candles?" + p.toString();
  try {
    const r = await fetchWithTimeout(target, {
      headers: {
        "User-Agent": "BitDesk-CF-Worker/3.7 (KlinesOkxFailover)",
        Accept: "application/json",
      },
    });
    if (!r.ok) {
      let err = "";
      try { err = (await r.text()).slice(0, 180); } catch (_) { err = r.statusText || ""; }
      return { ok: false, chain: [`okx:${r.status}`], error: err.replace(/\s+/g, " ").trim() || `HTTP ${r.status}`, status: r.status };
    }
    const data = await r.json().catch(() => null);
    if (!data || String(data.code) !== "0" || !Array.isArray(data.data)) {
      const msg = data && data.msg ? String(data.msg) : "bad shape";
      return { ok: false, chain: ["okx:bad-shape"], error: msg, status: r.status };
    }
    const klines = okxCandlesToBinanceKlines(data.data, interval, startTime);
    if (!klines.length) {
      return { ok: false, chain: ["okx:empty"], error: "empty okx candle response after startTime filter", status: r.status };
    }
    return {
      ok: true,
      klines,
      host: "www.okx.com",
      source: "okx-swap-failover",
      chain: ["okx:ok"],
      raw: JSON.stringify(klines),
    };
  } catch (e) {
    const msg = (e && e.message ? e.message : String(e)).replace(/\s+/g, " ").trim().slice(0, 140);
    return { ok: false, chain: [`okx:err ${msg.slice(0, 40)}`], error: msg || "network error", status: 0 };
  }
}

async function fetchKlinesWithFailover(env, args) {
  const primary = await fetchKlinesFromBinance(env, args);
  if (primary.ok || !klineAlternateFailoverEnabled(env)) {
    return { ...primary, source: primary.ok ? "binance-fapi" : "none" };
  }
  const alternate = await fetchKlinesFromBybit(env, args);
  if (alternate.ok) {
    return {
      ...alternate,
      primaryError: primary.error,
      primaryStatus: primary.status,
      chain: (primary.chain || []).concat(alternate.chain || []),
    };
  }
  const tertiary = await fetchKlinesFromOkx(env, args);
  if (tertiary.ok) {
    return {
      ...tertiary,
      primaryError: primary.error,
      primaryStatus: primary.status,
      alternateError: alternate.error,
      chain: (primary.chain || []).concat(alternate.chain || []).concat(tertiary.chain || []),
    };
  }
  return {
    ok: false,
    source: "none",
    error: [
      primary.error ? `binance: ${primary.error}` : "",
      alternate.error ? `bybit-failover: ${alternate.error}` : "",
      tertiary.error ? `okx-failover: ${tertiary.error}` : "",
    ].filter(Boolean).join(" | ") || "all failed",
    status: primary.status || alternate.status || tertiary.status || 0,
    chain: (primary.chain || []).concat(alternate.chain || []).concat(tertiary.chain || []),
    alternateError: alternate.error,
    tertiaryError: tertiary.error,
  };
}

/* =============================================================
 * D1 读写
 * ============================================================= */

async function fetchAggTradesFromBinance(env, { symbol, limit, fromId, startTime, endTime }) {
  const customOrigin = parseCustomFapiOrigin(env && env.BINANCE_FAPI_ORIGIN);
  const origins = customOrigin ? [customOrigin] : BINANCE_HOSTS.map((h) => `https://${h}`);

  const p = new URLSearchParams();
  p.set("symbol", symbol);
  p.set("limit", String(Math.min(FOOTPRINT_FETCH_LIMIT, Math.max(1, Number(limit) || FOOTPRINT_FETCH_LIMIT))));
  if (fromId != null && Number(fromId) > 0) p.set("fromId", String(fromId));
  if (startTime != null) p.set("startTime", String(startTime));
  if (endTime != null) p.set("endTime", String(endTime));

  const chain = [];
  let firstErr = { status: 0, error: "" };

  for (const origin of origins) {
    const target = origin.replace(/\/$/, "") + "/fapi/v1/aggTrades?" + p.toString();
    let host = origin;
    try { host = new URL(origin).host; } catch (_) {}
    try {
      const r = await fetchWithTimeout(target, {
        headers: {
          "User-Agent": "BitDesk-CF-Worker/3.0 (FootprintSync)",
          Accept: "application/json",
        },
      });
      if (!r.ok) {
        let err = "";
        try { err = (await r.text()).slice(0, 180); } catch (_) { err = r.statusText || ""; }
        chain.push(`${host}:${r.status}`);
        if (!firstErr.error) firstErr = { status: r.status, error: err.replace(/\s+/g, " ").trim() };
        continue;
      }
      const data = await r.json().catch(() => null);
      if (!Array.isArray(data)) {
        chain.push(`${host}:bad-shape`);
        if (!firstErr.error) firstErr = { status: r.status, error: "bad shape" };
        continue;
      }
      chain.push(`${host}:ok`);
      return { ok: true, trades: data, host, chain };
    } catch (e) {
      const msg = (e && e.message ? e.message : String(e)).replace(/\s+/g, " ").trim().slice(0, 140);
      chain.push(`${host}:err ${msg.slice(0, 40)}`);
      if (!firstErr.error) firstErr = { status: 0, error: msg || "network error" };
    }
  }

  return { ok: false, chain, error: firstErr.error || "all failed", status: firstErr.status };
}

async function d1QueryLatestMeta(env, symbol, interval) {
  const latest = await env.DB.prepare(
    "SELECT t FROM klines WHERE symbol = ?1 AND interval = ?2 ORDER BY t DESC LIMIT 1"
  ).bind(symbol, interval).first();
  const status = await env.DB.prepare(
    "SELECT last_t, last_count FROM sync_status WHERE symbol = ?1 AND interval = ?2"
  ).bind(symbol, interval).first();
  return {
    maxT: Number(latest?.t || status?.last_t || 0),
    count: Number(status?.last_count || (latest ? 1 : 0)),
  };
}

/** 批量 INSERT OR REPLACE 后按 2000 根上限 prune */
async function persistKlines(env, symbol, interval, rawKlines) {
  if (!Array.isArray(rawKlines) || rawKlines.length === 0) return { inserted: 0, pruned: 0 };

  const insertSql =
    "INSERT OR REPLACE INTO klines (symbol, interval, t, o, h, l, c, v) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)";
  const prep = env.DB.prepare(insertSql);

  const stmts = [];
  for (const row of rawKlines) {
    const t = Number(row[0]);
    const o = parseFloat(row[1]);
    const h = parseFloat(row[2]);
    const l = parseFloat(row[3]);
    const c = parseFloat(row[4]);
    const v = parseFloat(row[5]);
    if (!Number.isFinite(t) || !Number.isFinite(o) || !Number.isFinite(c)) continue;
    stmts.push(prep.bind(symbol, interval, t, o, h, l, c, v));
  }
  if (stmts.length === 0) return { inserted: 0, pruned: 0 };

  const CHUNK = 100;
  for (let i = 0; i < stmts.length; i += CHUNK) {
    await env.DB.batch(stmts.slice(i, i + CHUNK));
  }

  let pruned = 0;
  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) AS cnt FROM klines WHERE symbol = ?1 AND interval = ?2"
  ).bind(symbol, interval).first();
  const total = Number(countRow?.cnt || 0);
  if (total > MAX_KLINES_PER_INTERVAL) {
    const res = await env.DB.prepare(
      `DELETE FROM klines
         WHERE symbol = ?1 AND interval = ?2
           AND t NOT IN (
             SELECT t FROM klines
              WHERE symbol = ?1 AND interval = ?2
              ORDER BY t DESC LIMIT ?3
           )`
    ).bind(symbol, interval, MAX_KLINES_PER_INTERVAL).run();
    pruned = res?.meta?.changes || Math.max(0, total - MAX_KLINES_PER_INTERVAL);
  }

  return { inserted: stmts.length, pruned };
}

async function updateSyncStatus(env, symbol, interval, { ok, inserted, latestT, error }) {
  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO sync_status (symbol, interval, last_run, last_t, last_count, last_ok, last_error)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
    ).bind(
      symbol,
      interval,
      Date.now(),
      Number(latestT || 0),
      Number(inserted || 0),
      ok ? 1 : 0,
      error ? String(error).slice(0, 300) : null
    ).run();
  } catch (_) {}
}

/* =============================================================
 * 单次同步（增量）
 * ============================================================= */

async function syncKlinesOne(env, symbol, interval) {
  if (!env.DB) return { ok: false, symbol, interval, error: "D1 binding missing" };
  if (!SUPPORTED_INTERVALS.includes(interval)) return { ok: false, symbol, interval, error: "unsupported interval" };

  let meta;
  try {
    meta = await d1QueryLatestMeta(env, symbol, interval);
  } catch (e) {
    const err = "meta-read " + (e && e.message ? e.message : String(e)).slice(0, 120);
    await updateSyncStatus(env, symbol, interval, { ok: false, error: err });
    return { ok: false, symbol, interval, error: err };
  }

  const bulkFill = meta.count === 0;
  const fetchArgs = bulkFill
    ? { symbol, interval, limit: MAX_KLINES_PER_INTERVAL }
    : { symbol, interval, startTime: meta.maxT, limit: BINANCE_MAX_LIMIT_PER_REQUEST };

  const got = await fetchKlinesWithFailover(env, fetchArgs);
  if (!got.ok) {
    const detail = [
      got.error || "fetch failed",
      got.chain && got.chain.length ? `chain=${got.chain.join(" > ")}` : "",
    ].filter(Boolean).join(" | ");
    if (!isKlineTailStaleForRead(meta.maxT, interval)) {
      await updateSyncStatus(env, symbol, interval, { ok: true, inserted: 0, latestT: meta.maxT });
      return {
        ok: true,
        symbol,
        interval,
        skippedBecause: "d1_tail_fresh_upstream_unavailable",
        latestT: meta.maxT,
        warning: detail,
        chain: got.chain,
      };
    }
    await updateSyncStatus(env, symbol, interval, { ok: false, latestT: meta.maxT, error: detail });
    return { ok: false, symbol, interval, error: detail, chain: got.chain };
  }

  let persist;
  try {
    persist = await persistKlines(env, symbol, interval, got.klines);
  } catch (e) {
    const err = "persist " + (e && e.message ? e.message : String(e)).slice(0, 160);
    await updateSyncStatus(env, symbol, interval, { ok: false, latestT: meta.maxT, error: err });
    return { ok: false, symbol, interval, error: err };
  }

  const latestT = got.klines.length ? Number(got.klines[got.klines.length - 1][0]) : meta.maxT;
  await updateSyncStatus(env, symbol, interval, {
    ok: true,
    inserted: persist.inserted,
    latestT,
  });

  return {
    ok: true,
    symbol,
    interval,
    bulkFill,
    fetched: got.klines.length,
    inserted: persist.inserted,
    pruned: persist.pruned,
    host: got.host,
    source: got.source || "binance-fapi",
    primaryStatus: got.primaryStatus || null,
  };
}

function emptyFootprintBar(t, price) {
  const p = Number(price);
  return {
    t: Number(t),
    o: p,
    h: p,
    l: p,
    c: p,
    buyVol: 0,
    sellVol: 0,
    delta: 0,
    volume: 0,
    pocPrice: null,
    levels: [],
    lastTradeId: 0,
  };
}

function recomputeFootprintBar(bar) {
  let buyVol = 0;
  let sellVol = 0;
  let pocPrice = null;
  let maxTotal = -1;
  const levels = (bar.levels || [])
    .map((level) => {
      const buy = Number(level.buyVol) || 0;
      const sell = Number(level.sellVol) || 0;
      return {
        price: Number(level.price),
        buyVol: buy,
        sellVol: sell,
        delta: buy - sell,
        total: buy + sell,
      };
    })
    .filter((level) => Number.isFinite(level.price) && level.total > 0)
    .sort((a, b) => b.price - a.price);

  for (const level of levels) {
    buyVol += level.buyVol;
    sellVol += level.sellVol;
    if (level.total > maxTotal) {
      maxTotal = level.total;
      pocPrice = level.price;
    }
  }

  return {
    ...bar,
    buyVol,
    sellVol,
    delta: buyVol - sellVol,
    volume: buyVol + sellVol,
    pocPrice,
    levels,
  };
}

function footprintBarCount(env, symbol) {
  return env.DB.prepare(
    "SELECT COUNT(*) AS cnt, MIN(t) AS minT, MAX(t) AS maxT FROM footprint_bars WHERE symbol = ?1 AND interval = ?2"
  ).bind(symbol, FOOTPRINT_BASE_INTERVAL).first();
}

function ingestTradeIntoFootprintBars(map, trade) {
  const t = Number(trade.T || trade.E || 0);
  const price = Number(trade.p);
  const qty = Number(trade.q);
  const id = Number(trade.a || 0);
  if (!Number.isFinite(t) || !Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) return null;
  const start = bucketStart(t, FOOTPRINT_BASE_INTERVAL);
  let bar = map.get(start);
  if (!bar) {
    bar = emptyFootprintBar(start, price);
    map.set(start, bar);
  }
  bar.h = Math.max(bar.h, price);
  bar.l = Math.min(bar.l, price);
  bar.c = price;
  bar.lastTradeId = Math.max(Number(bar.lastTradeId) || 0, id);

  const levelPrice = roundToTick(price, FOOTPRINT_BASE_TICK);
  let level = bar.levels.find((row) => row.price === levelPrice);
  if (!level) {
    level = { price: levelPrice, buyVol: 0, sellVol: 0 };
    bar.levels.push(level);
  }
  if (trade.m === false || trade.m === "false") level.buyVol += qty;
  else level.sellVol += qty;
  return bar;
}

async function readFootprintStatus(env, symbol) {
  const row = await env.DB.prepare(
    "SELECT last_trade_id, last_trade_time FROM footprint_sync_status WHERE symbol = ?1"
  ).bind(symbol).first();
  return {
    lastTradeId: Number(row?.last_trade_id || 0),
    lastTradeTime: Number(row?.last_trade_time || 0),
  };
}

function footprintReadReferenceTime(status, latestT, now = Date.now()) {
  const lastTradeTime = Number(status?.last_trade_time || 0);
  if (Number.isFinite(lastTradeTime) && lastTradeTime > 0) return lastTradeTime;
  const t = Number(latestT);
  if (!Number.isFinite(t) || t <= 0) return 0;
  return Math.min(now, t + intervalMs(FOOTPRINT_BASE_INTERVAL));
}

function isFootprintTailStaleForRead(status, latestT, now = Date.now()) {
  const ref = footprintReadReferenceTime(status, latestT, now);
  if (!ref) return true;
  const step = intervalMs(FOOTPRINT_BASE_INTERVAL);
  const freshLimit = Math.max(45_000, Math.min(step, 2 * 60_000));
  return now - ref > freshLimit;
}

function recentlyTriedFootprintSync(status, now = Date.now()) {
  if (!status || !status.last_run) return false;
  const raw = status.last_run;
  const numeric = Number(raw);
  const lastRunMs = Number.isFinite(numeric) && numeric > 0 ? numeric : Date.parse(String(raw));
  return Number.isFinite(lastRunMs) && now - lastRunMs < FOOTPRINT_READ_AUTO_SYNC_MIN_MS;
}

async function loadExistingFootprintBars(env, symbol, starts) {
  const out = new Map();
  if (!starts.length) return out;
  const placeholders = starts.map((_, i) => `?${i + 3}`).join(",");
  const stmt = env.DB.prepare(
    `SELECT t, o, h, l, c, buy_vol, sell_vol, poc_price, levels_json, last_trade_id
       FROM footprint_bars
      WHERE symbol = ?1 AND interval = ?2 AND t IN (${placeholders})`
  ).bind(symbol, FOOTPRINT_BASE_INTERVAL, ...starts);
  const { results } = await stmt.all();
  for (const row of results || []) {
    let levels = [];
    try { levels = JSON.parse(row.levels_json || "[]"); } catch (_) {}
    out.set(Number(row.t), recomputeFootprintBar({
      t: Number(row.t),
      o: Number(row.o),
      h: Number(row.h),
      l: Number(row.l),
      c: Number(row.c),
      buyVol: Number(row.buy_vol) || 0,
      sellVol: Number(row.sell_vol) || 0,
      pocPrice: row.poc_price == null ? null : Number(row.poc_price),
      levels,
      lastTradeId: Number(row.last_trade_id || 0),
    }));
  }
  return out;
}

async function persistFootprintBars(env, symbol, barMap) {
  const bars = [...barMap.values()].map((bar) => recomputeFootprintBar(bar));
  if (!bars.length) return { written: 0, pruned: 0 };

  const prep = env.DB.prepare(
    `INSERT OR REPLACE INTO footprint_bars
      (symbol, interval, t, o, h, l, c, buy_vol, sell_vol, delta, volume, poc_price, levels_json, last_trade_id, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)`
  );
  const now = Date.now();
  const stmts = bars.map((bar) => prep.bind(
    symbol,
    FOOTPRINT_BASE_INTERVAL,
    bar.t,
    bar.o,
    bar.h,
    bar.l,
    bar.c,
    bar.buyVol,
    bar.sellVol,
    bar.delta,
    bar.volume,
    bar.pocPrice,
    JSON.stringify(bar.levels.map((level) => ({
      price: level.price,
      buyVol: level.buyVol,
      sellVol: level.sellVol,
    }))),
    Number(bar.lastTradeId || 0),
    now
  ));
  await env.DB.batch(stmts);

  let pruned = 0;
  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) AS cnt FROM footprint_bars WHERE symbol = ?1 AND interval = ?2"
  ).bind(symbol, FOOTPRINT_BASE_INTERVAL).first();
  const total = Number(countRow?.cnt || 0);
  if (total > FOOTPRINT_MAX_BARS) {
    const res = await env.DB.prepare(
      `DELETE FROM footprint_bars
        WHERE symbol = ?1 AND interval = ?2
          AND t NOT IN (
            SELECT t FROM footprint_bars
             WHERE symbol = ?1 AND interval = ?2
             ORDER BY t DESC LIMIT ?3
          )`
    ).bind(symbol, FOOTPRINT_BASE_INTERVAL, FOOTPRINT_MAX_BARS).run();
    pruned = res?.meta?.changes || Math.max(0, total - FOOTPRINT_MAX_BARS);
  }
  return { written: bars.length, pruned };
}

async function updateFootprintStatus(env, symbol, { ok, lastTradeId, lastTradeTime, count, error }) {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO footprint_sync_status
      (symbol, last_run, last_trade_id, last_trade_time, last_count, last_ok, last_error)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  ).bind(
    symbol,
    Date.now(),
    Number(lastTradeId || 0),
    Number(lastTradeTime || 0),
    Number(count || 0),
    ok ? 1 : 0,
    error ? String(error).slice(0, 300) : null
  ).run();
}

async function syncFootprintOne(env, symbol) {
  if (!env.DB) return { ok: false, symbol, error: "D1 binding missing" };
  const before = await footprintBarCount(env, symbol);
  const status = await readFootprintStatus(env, symbol);
  let nextFromId = status.lastTradeId > 0 ? status.lastTradeId + 1 : null;
  const allTrades = [];
  let lastTradeId = status.lastTradeId;
  let lastTradeTime = status.lastTradeTime;
  let host = "";

  for (let page = 0; page < FOOTPRINT_MAX_FETCH_PAGES; page++) {
    const got = await fetchAggTradesFromBinance(env, {
      symbol,
      limit: FOOTPRINT_FETCH_LIMIT,
      fromId: nextFromId,
    });
    if (!got.ok) {
      const err = got.error || "aggTrades fetch failed";
      await updateFootprintStatus(env, symbol, { ok: false, lastTradeId, lastTradeTime, count: allTrades.length, error: err });
      return { ok: false, symbol, error: err, chain: got.chain };
    }
    host = got.host || host;
    const fresh = got.trades
      .filter((row) => Number(row.a || 0) > lastTradeId)
      .sort((a, b) => Number(a.a || 0) - Number(b.a || 0));
    if (!fresh.length) break;
    allTrades.push(...fresh);
    const tail = fresh[fresh.length - 1];
    lastTradeId = Number(tail.a || lastTradeId);
    lastTradeTime = Number(tail.T || tail.E || lastTradeTime);
    nextFromId = lastTradeId + 1;
    if (got.trades.length < FOOTPRINT_FETCH_LIMIT) break;
  }

  if (!allTrades.length) {
    await updateFootprintStatus(env, symbol, { ok: true, lastTradeId, lastTradeTime, count: 0 });
    const out = { ok: true, symbol, fetched: 0, written: 0, pruned: 0, lastTradeId, host };
    if (Number(before?.cnt || 0) === 0) {
      out.bootstrapBackfill = await syncFootprintBackfill(env, symbol, {
        windows: FOOTPRINT_BACKFILL_DEFAULT_WINDOWS,
      });
    }
    return out;
  }

  const starts = [...new Set(allTrades.map((row) => bucketStart(Number(row.T || row.E), FOOTPRINT_BASE_INTERVAL)))];
  const barMap = await loadExistingFootprintBars(env, symbol, starts);
  for (const trade of allTrades) ingestTradeIntoFootprintBars(barMap, trade);
  const persisted = await persistFootprintBars(env, symbol, barMap);
  await updateFootprintStatus(env, symbol, {
    ok: true,
    lastTradeId,
    lastTradeTime,
    count: allTrades.length,
  });
  const out = {
    ok: true,
    symbol,
    fetched: allTrades.length,
    written: persisted.written,
    pruned: persisted.pruned,
    lastTradeId,
    lastTradeTime,
    host,
  };
  if (Number(before?.cnt || 0) === 0) {
    out.bootstrapBackfill = await syncFootprintBackfill(env, symbol, {
      windows: FOOTPRINT_BACKFILL_DEFAULT_WINDOWS,
    });
  }
  return out;
}

async function syncFootprintBackfill(env, symbol, opts = {}) {
  if (!env.DB) return { ok: false, symbol, error: "D1 binding missing" };
  const windows = Math.min(
    FOOTPRINT_BACKFILL_MAX_WINDOWS,
    Math.max(1, parseInt(String(opts.windows || FOOTPRINT_BACKFILL_DEFAULT_WINDOWS), 10) || FOOTPRINT_BACKFILL_DEFAULT_WINDOWS)
  );
  const meta = await footprintBarCount(env, symbol);
  let cursorEnd = Number(opts.endTime || meta?.minT || Date.now());
  if (!Number.isFinite(cursorEnd) || cursorEnd <= 0) cursorEnd = Date.now();
  cursorEnd = Math.min(cursorEnd, Date.now());

  let fetched = 0;
  let written = 0;
  let pruned = 0;
  let host = "";
  let lastError = "";

  for (let i = 0; i < windows; i++) {
    const endTime = cursorEnd - i * FOOTPRINT_BACKFILL_WINDOW_MS - 1;
    const startTime = endTime - FOOTPRINT_BACKFILL_WINDOW_MS + 1;
    if (endTime <= 0 || startTime <= 0) break;

    const got = await fetchAggTradesFromBinance(env, {
      symbol,
      limit: FOOTPRINT_FETCH_LIMIT,
      startTime,
      endTime,
    });
    if (!got.ok) {
      lastError = got.error || "aggTrades backfill failed";
      return { ok: false, symbol, fetched, written, pruned, error: lastError, chain: got.chain };
    }
    host = got.host || host;
    const trades = (got.trades || [])
      .filter((row) => {
        const t = Number(row.T || row.E || 0);
        return t >= startTime && t <= endTime;
      })
      .sort((a, b) => Number(a.a || 0) - Number(b.a || 0));
    if (!trades.length) continue;

    const starts = [...new Set(trades.map((row) => bucketStart(Number(row.T || row.E), FOOTPRINT_BASE_INTERVAL)))];
    const barMap = await loadExistingFootprintBars(env, symbol, starts);
    for (const trade of trades) ingestTradeIntoFootprintBars(barMap, trade);
    const persisted = await persistFootprintBars(env, symbol, barMap);
    fetched += trades.length;
    written += persisted.written;
    pruned += persisted.pruned;
  }

  return { ok: true, symbol, windows, fetched, written, pruned, host };
}

function rebinLevels(levels, tickSize) {
  const tick = resolveFootprintTickSize(tickSize);
  const map = new Map();
  for (const level of levels || []) {
    const price = roundToTick(Number(level.price), tick);
    if (!map.has(price)) map.set(price, { price, buyVol: 0, sellVol: 0 });
    const row = map.get(price);
    row.buyVol += Number(level.buyVol) || 0;
    row.sellVol += Number(level.sellVol) || 0;
  }
  return [...map.values()];
}

function resolveFootprintTickSize(tickSize) {
  if (tickSize === "auto" || tickSize == null || tickSize === "") return 10;
  return Math.max(1, Number(tickSize) || 10);
}

function mergeFootprintRows(rows, interval, tickSize) {
  const step = intervalMs(interval);
  const map = new Map();
  for (const row of rows || []) {
    let levels = [];
    try { levels = JSON.parse(row.levels_json || "[]"); } catch (_) {}
    const bucket = Math.floor(Number(row.t) / step) * step;
    let bar = map.get(bucket);
    if (!bar) {
      bar = emptyFootprintBar(bucket, Number(row.o));
      bar._lvlAcc = new Map();
      map.set(bucket, bar);
    }
    bar.h = Math.max(bar.h, Number(row.h));
    bar.l = Math.min(bar.l, Number(row.l));
    if (Number(row.t) <= bucket || bar.o == null) bar.o = Number(row.o);
    if (Number(row.t) >= (bar._lastBaseT || 0)) {
      bar.c = Number(row.c);
      bar._lastBaseT = Number(row.t);
    }
    bar.lastTradeId = Math.max(Number(bar.lastTradeId) || 0, Number(row.last_trade_id || 0));
    for (const level of rebinLevels(levels, tickSize)) {
      const pri = Number(level.price);
      if (!Number.isFinite(pri)) continue;
      let target = bar._lvlAcc.get(pri);
      if (!target) {
        target = { price: pri, buyVol: 0, sellVol: 0 };
        bar._lvlAcc.set(pri, target);
      }
      target.buyVol += Number(level.buyVol) || 0;
      target.sellVol += Number(level.sellVol) || 0;
    }
  }
  return [...map.values()]
    .map((bar) => {
      bar.levels = [...bar._lvlAcc.values()].sort((a, b) => Number(b.price) - Number(a.price));
      delete bar._lvlAcc;
      delete bar._lastBaseT;
      return recomputeFootprintBar(bar);
    })
    .sort((a, b) => a.t - b.t);
}

/* =============================================================
 * Cron 时机判断
 * ============================================================= */

/**
 * 判断当前 UTC 时间应同步哪些周期。
 * - 5m: 每 5 分钟
 * - 15m: 每 15 分钟
 * - 1h: 每小时整点
 * - 4h: 每 4 小时整点 (UTC 0/4/8/12/16/20)
 * - 1d: 每天 UTC 00:00
 * - 3d: 每天 UTC 00:00（相对 3 日 K 线的增量极小，多拉一次无伤大雅，确保不会错过关闭时点）
 * - 1w: 每周一 UTC 00:00（Binance 周线在此时关闭）
 */
function intervalsDueAt(date) {
  const min = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dayOfWeek = date.getUTCDay();
  const due = [];
  if (min % 5 === 0) due.push("5m");
  if (min % 15 === 0) due.push("15m");
  if (min === 0) due.push("1h");
  if (min === 0 && hour % 4 === 0) due.push("4h");
  if (min === 0 && hour === 0) {
    due.push("1d");
    due.push("3d");
    if (dayOfWeek === 1) due.push("1w");
  }
  return due;
}

function isKlineTailStaleForRead(latestT, interval, now = Date.now()) {
  const t = Number(latestT);
  if (!Number.isFinite(t) || t <= 0) return true;
  const step = intervalMs(interval);
  const openSlackMs = Math.min(90_000, Math.max(15_000, Math.floor(step / 20)));
  if (now > t + step + openSlackMs) return true;
  return now - t > step * 2 + 120_000;
}

function recentlyTriedKlineSync(status, now = Date.now()) {
  if (!status || !status.last_run) return false;
  const raw = status.last_run;
  const numeric = Number(raw);
  const lastRunMs = Number.isFinite(numeric) && numeric > 0 ? numeric : Date.parse(String(raw));
  return Number.isFinite(lastRunMs) && now - lastRunMs < KLINE_READ_AUTO_SYNC_MIN_MS;
}

function getConfiguredSymbols(env) {
  const raw = env && env.SYMBOLS ? String(env.SYMBOLS) : DEFAULT_SYMBOL;
  return Array.from(new Set(raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)));
}

/* =============================================================
 * Derivatives panel sync/read helpers
 * ============================================================= */

function roundNum(v, digits = 6) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const m = 10 ** digits;
  return Math.round(n * m) / m;
}

function rangeToMs(range) {
  const r = String(range || "30d").toLowerCase();
  if (r === "24h" || r === "1d") return 24 * 60 * 60 * 1000;
  if (r === "7d") return 7 * 24 * 60 * 60 * 1000;
  return DERIVATIVE_RETENTION_MS;
}

function symbolToCurrency(symbol) {
  const s = String(symbol || DEFAULT_SYMBOL).toUpperCase();
  if (s.startsWith("ETH")) return "ETH";
  return "BTC";
}

function symbolToPair(symbol) {
  const s = String(symbol || DEFAULT_SYMBOL).toUpperCase();
  if (s.endsWith("USDT")) return s.slice(0, -4) + "USDT";
  if (s.endsWith("BUSD")) return s.slice(0, -4) + "USDT";
  return s;
}

function derivativeStatusGroup(metric) {
  if (
    metric === "funding_binance" ||
    metric === "oi_binance" ||
    metric === "long_short" ||
    metric === "taker_buy_sell" ||
    metric === "top_account_long_short" ||
    metric === "top_position_long_short"
  ) {
    return "fast";
  }
  return "slow";
}

function binanceUpstreamMode(env) {
  return parseCustomFapiOrigin(env && env.BINANCE_FAPI_ORIGIN) ? "custom" : "direct";
}

function derivativeBinanceHealthSourceKey(binMode) {
  return binMode === "custom" ? "binance_custom_origin" : "binance_direct";
}

function binanceDerivativeFapiOrigins(env) {
  const customOrigin = parseCustomFapiOrigin(env && env.BINANCE_FAPI_ORIGIN);
  if (customOrigin) return [customOrigin];
  return BINANCE_DERIVATIVE_HOSTS.map((h) => `https://${h}`);
}

function shouldStopDerivativeOriginRetry(customOriginEnabled, classifiedFailure) {
  const kind = classifiedFailure && classifiedFailure.kind ? String(classifiedFailure.kind) : "";
  if (kind === "geo_restricted") return !!customOriginEnabled;
  if (kind === "blacklisted_ip") return classifiedFailure && classifiedFailure.banUntilMs != null;
  return false;
}

/** @param {number|string|null} httpStatus */
function classifyBinanceUpstreamError(httpStatus, bodyText) {
  const raw = String(bodyText || "");
  const st = Number(httpStatus);
  if (st === 451) return "geo_restricted";
  if (/restricted location|according to[^\n]{0,80}eligibility|service unavailable from a restricted/i.test(raw)) {
    return "geo_restricted";
  }
  if (st === 429) return "rate_limited";
  if (st === 418) return "blacklisted_ip";
  if (st >= 500) return "upstream_5xx";
  if (/abort|timed out|timeout|The operation was aborted/i.test(raw)) return "timeout";
  if (!Number.isFinite(st) || st === 0) return "network";
  if (st >= 400) return `http_${st}`;
  return "upstream_error";
}

function classifyGenericHttp(httpStatus, bodyText) {
  const st = Number(httpStatus);
  if (st === 429) return "rate_limited";
  if (st >= 500) return "upstream_5xx";
  if (!Number.isFinite(st) || st === 0) return "network";
  if (/abort|timed out|timeout/i.test(String(bodyText || ""))) return "timeout";
  return st >= 400 ? `http_${st}` : "upstream_error";
}

/** 解析币安 FAPI REST 正文：支持 JSON {code,msg} 与普通文本中带 banned until(ms)。*/
function parseBinanceApiBody(bodyText) {
  const raw = String(bodyText || "");
  const condensed = raw.replace(/\s+/g, " ").trim();
  let code = null;
  let msg = condensed;
  try {
    const j = JSON.parse(raw.trim());
    if (j && j.code != null && Number.isFinite(Number(j.code))) code = Number(j.code);
    if (j && j.msg != null) msg = String(j.msg).replace(/\s+/g, " ").trim();
  } catch (_) {
    //
  }
  let banUntilMs = null;
  const hay = `${msg}\n${condensed}`;
  const m = hay.match(/banned\s+until\s+(\d{10,17})\b/i);
  if (m && m[1]) {
    const vRaw = Number(m[1]);
    if (Number.isFinite(vRaw)) {
      /** Binance Way too many requests 常为毫秒 Unix */
      banUntilMs = vRaw >= 1e15 ? Math.round(vRaw / 1000)
        : vRaw >= 1e13 ? Math.round(vRaw / 1000)
        : vRaw >= 1e12 ? Math.round(vRaw)
          : Math.round(vRaw * 1000);
    }
  }
  const now = Date.now();
  /** 过滤明显垃圾值 */
  if (banUntilMs != null && (banUntilMs < now - 86400000 || banUntilMs > now + 86400000 * 14)) banUntilMs = null;
  return { code, msg, condensed, banUntilMs };
}

/**
 * 结合 HTTP status + Binance JSON/body：body 先于 status（应对 -1003 落在 418/429 的场景）。
 * @returns {{kind: string, banUntilMs?: number|null, binanceCode?: number|null}}
 */
function classifyBinanceFapiFailure(httpStatus, bodyText) {
  const st = Number(httpStatus);
  const p = parseBinanceApiBody(bodyText);
  if (Number(p.code) === -1003) {
    return { kind: "blacklisted_ip", banUntilMs: p.banUntilMs, binanceCode: p.code };
  }
  const msgAll = `${p.msg || ""} ${p.condensed || ""}`.trim();
  if (/restricted\s+location|service\s+unavailable\s+from\s+a\s+restricted\s+location/i.test(msgAll)) {
    return { kind: "geo_restricted", banUntilMs: p.banUntilMs, binanceCode: p.code };
  }
  if (/according\s+to\s+[^\n]{0,80}eligibility/i.test(msgAll)) {
    return { kind: "geo_restricted", banUntilMs: p.banUntilMs, binanceCode: p.code };
  }
  if (/banned\s+until\s+\d+/i.test(msgAll)) {
    return { kind: "blacklisted_ip", banUntilMs: p.banUntilMs, binanceCode: p.code };
  }
  if (/too\s+many\s+requests|way\s+too\s+many\s+requests|ip\s*\(/i.test(msgAll)) {
    if (Number(p.code) === -1003 || p.banUntilMs != null) {
      return { kind: "blacklisted_ip", banUntilMs: p.banUntilMs, binanceCode: p.code };
    }
    if (st === 429 || st === 418) return { kind: "rate_limited", banUntilMs: p.banUntilMs, binanceCode: p.code };
  }
  if (st === 451) return { kind: "geo_restricted", banUntilMs: null, binanceCode: p.code };
  if (st === 429) return { kind: "rate_limited", banUntilMs: p.banUntilMs, binanceCode: p.code };
  if (st === 418) return { kind: "blacklisted_ip", banUntilMs: p.banUntilMs, banUntilFallback: true, binanceCode: p.code };
  const fallback = classifyBinanceUpstreamError(st, p.condensed || p.msg || String(bodyText || ""));
  return { kind: fallback, banUntilMs: p.banUntilMs, binanceCode: p.code };
}

function cooldownMsForDerivativeErrorKind(kind) {
  switch (kind) {
    case "geo_restricted":
      return 45 * 60 * 1000;
    case "rate_limited":
      return 20 * 60 * 1000;
    case "upstream_5xx":
      return 5 * 60 * 1000;
    case "blacklisted_ip":
      return 60 * 60 * 1000;
    case "cooldown":
      return 2 * 60 * 1000;
    case "timeout":
    case "network":
      return 90 * 1000;
    default:
      return 3 * 60 * 1000;
  }
}

function mergeDerivativeExtraJson(prevJsonString, patch) {
  let base = {};
  try {
    base = prevJsonString ? JSON.parse(String(prevJsonString)) : {};
  } catch (_) {
    base = {};
  }
  return JSON.stringify({ ...base, ...(patch || {}) }).slice(0, 4500);
}

async function readDerivativeSourceHealthRow(env, sourceKey) {
  if (!env || !env.DB || !sourceKey) return null;
  try {
    const { results } = await env.DB.prepare(
      `SELECT source, last_run, last_ok, last_error_kind, last_error, cooldown_until_ms,
              consecutive_failures, last_success_at_ms, extra_json
       FROM derivative_source_health WHERE source = ?1`
    ).bind(String(sourceKey)).all();
    return results && results[0] ? results[0] : null;
  } catch (_) {
    return null;
  }
}

async function readDerivativeSourceHealthAllSafe(env) {
  if (!env || !env.DB) return [];
  try {
    const { results } = await env.DB.prepare(
      `SELECT source, last_run, last_ok, last_error_kind, last_error, cooldown_until_ms,
              consecutive_failures, last_success_at_ms, extra_json
       FROM derivative_source_health ORDER BY source ASC`
    ).all();
    return results || [];
  } catch (_) {
    return [];
  }
}

function parseDerivativeSourceHealthExtra(row) {
  try {
    return row && row.extra_json ? JSON.parse(String(row.extra_json)) : {};
  } catch (_) {
    return {};
  }
}

function derivativeSourceCooldownState(row, nowMs = Date.now()) {
  if (!row || !Number(row.cooldown_until_ms)) return { blocked: false };
  const untilMs = Number(row.cooldown_until_ms) || 0;
  if (untilMs <= nowMs) return { blocked: false };
  const kind = String(row.last_error_kind || "");
  const extra = parseDerivativeSourceHealthExtra(row);
  const banUntilMs = Number(extra.binanceBanUntilMs);
  if (
    kind === "blacklisted_ip" &&
    Number.isFinite(banUntilMs) &&
    banUntilMs + 60_000 <= nowMs
  ) {
    return {
      blocked: false,
      expiredExactBan: true,
      cooldownUntilMs: untilMs,
      banUntilMs,
      lastKind: kind,
    };
  }
  return {
    blocked: true,
    untilMs,
    cooldownUntilMs: untilMs,
    banUntilMs: Number.isFinite(banUntilMs) ? banUntilMs : null,
    lastKind: kind,
  };
}

/**
 * Upsert衍生品上游聚合健康记录（独立于按 metric 的 derivative_sync_status）。
 * @returns {Promise<null|undefined>}
 */
async function finalizeDerivativeUpstreamHealth(env, sourceKey, { ok, errorKind, error, extraPatch = {}, banUntilMs = null }) {
  if (!env || !env.DB || !sourceKey) return null;
  const key = String(sourceKey).slice(0, 64);
  const nowMs = Date.now();
  let prevRow = null;
  try {
    prevRow = await readDerivativeSourceHealthRow(env, key);
  } catch (_) {
    prevRow = null;
  }
  let cf = prevRow ? Number(prevRow.consecutive_failures) || 0 : 0;
  if (ok === true) cf = 0;
  else cf = Math.min(999, cf + 1);

  let cooldownUntilMs = prevRow ? Number(prevRow.cooldown_until_ms) || 0 : 0;
  if (ok === true) cooldownUntilMs = 0;
  else {
    const k = errorKind ? String(errorKind) : "upstream_error";
    const bt = banUntilMs != null && Number.isFinite(Number(banUntilMs)) ? Number(banUntilMs) : null;
    if (k === "blacklisted_ip" && bt != null) {
      /** Binance -1003 会给出精确 banUntil；优先按该时间恢复，避免内部冷却把 D1 多卡几十分钟。 */
      cooldownUntilMs = Math.max(nowMs + 2 * 60_000, bt + 60_000);
    } else {
      const bump = cooldownMsForDerivativeErrorKind(k);
      cooldownUntilMs = Math.max(cooldownUntilMs, nowMs + bump);
      if (bt != null) cooldownUntilMs = Math.max(cooldownUntilMs, bt + 60_000);
    }
  }

  let lastSucc = prevRow && prevRow.last_success_at_ms != null ? Number(prevRow.last_success_at_ms) : null;
  if (ok === true) lastSucc = nowMs;

  const patchMerge = {
    ...(extraPatch || {}),
    ...(banUntilMs != null && Number.isFinite(Number(banUntilMs)) ? { binanceBanUntilMs: Math.round(Number(banUntilMs)) } : {}),
  };
  const extraMerged = mergeDerivativeExtraJson(prevRow && prevRow.extra_json ? prevRow.extra_json : "{}", patchMerge);

  try {
    await env.DB.prepare(
      `INSERT OR REPLACE INTO derivative_source_health
       (source, last_run, last_ok, last_error_kind, last_error, cooldown_until_ms,
        consecutive_failures, last_success_at_ms, extra_json)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`
    ).bind(
      key,
      new Date(nowMs).toISOString(),
      ok === true ? 1 : ok === false ? 0 : (prevRow && Number(prevRow.last_ok)) ? 1 : 0,
      ok === false && errorKind ? String(errorKind).slice(0, 64) : null,
      ok === false && error ? String(error).slice(0, 380) : null,
      Math.max(0, Math.round(cooldownUntilMs)),
      Math.max(0, Math.round(cf)),
      lastSucc == null ? null : Math.round(lastSucc),
      extraMerged
    ).run();
  } catch (_) {
    /** D1 无表或未迁移时不阻塞主链路 */
  }
  return undefined;
}

const DERIV_SYNC_LOCK_PREFIX = "deriv_sync";

async function tryAcquireDerivativeSyncLock(env, lockKey, owner, ttlMs, patch = {}) {
  if (!env || !env.DB || !lockKey || !owner) return { acquired: true, noopDb: true };
  const now = Date.now();
  const expires = Math.round(now + ttlMs);
  try {
    const row = await env.DB.prepare(`SELECT expires_at_ms, owner FROM derivative_sync_locks WHERE lock_key = ?1`).bind(String(lockKey)).first();
    if (row && Number(row.expires_at_ms) > now) {
      return { acquired: false, untilMs: Number(row.expires_at_ms), holder: row.owner };
    }
    const extra = JSON.stringify(patch || {}).slice(0, 1800);
    if (!row) {
      await env.DB.prepare(
        `INSERT INTO derivative_sync_locks (lock_key, owner, expires_at_ms, created_at_ms, extra_json) VALUES (?1,?2,?3,?4,?5)`
      ).bind(String(lockKey), String(owner).slice(0, 128), expires, Math.round(now), extra).run();
    } else {
      await env.DB.prepare(
        `UPDATE derivative_sync_locks SET owner=?2, expires_at_ms=?3, created_at_ms=?4, extra_json=?5 WHERE lock_key=?1`
      ).bind(String(lockKey), String(owner).slice(0, 128), expires, Math.round(now), extra).run();
    }
    return { acquired: true };
  } catch (_) {
    return { acquired: true, degraded: true };
  }
}

async function releaseDerivativeSyncLock(env, lockKey, owner) {
  if (!env || !env.DB || !lockKey || !owner) return;
  try {
    await env.DB.prepare(`DELETE FROM derivative_sync_locks WHERE lock_key = ?1 AND owner = ?2`).bind(String(lockKey), String(owner).slice(0, 128)).run();
  } catch (_) {
    //
  }
}

async function readDerivativeGroupedMaxTsForSymbol(env, symbol) {
  if (!env || !env.DB) return {};
  try {
    const { results } = await env.DB.prepare(
      `SELECT metric, MAX(t) AS mx FROM derivative_timeseries WHERE symbol = ?1 GROUP BY metric`
    ).bind(String(symbol)).all();
    const out = {};
    for (const r of results || []) {
      if (r.metric && Number.isFinite(Number(r.mx))) out[String(r.metric)] = Number(r.mx);
    }
    return out;
  } catch (_) {
    return {};
  }
}

async function readDerivativeMetricHealthMap(env, symbol) {
  const out = {};
  if (!env || !env.DB) return out;
  try {
    const { results } = await env.DB.prepare(
      `SELECT metric, last_attempt_at_ms, last_success_at_ms, next_allowed_at_ms, consecutive_failures, last_error_kind, last_error, extra_json
       FROM derivative_metric_health WHERE symbol = ?1`
    ).bind(String(symbol)).all();
    for (const row of results || []) {
      if (!row.metric) continue;
      out[String(row.metric)] = row;
    }
  } catch (_) {
    //
  }
  return out;
}

async function finalizeDerivativeMetricTaskHealth(env, symbol, taskCompoundKey, { ok, kind = "", shortErr = "", banUntilMs = null }) {
  if (!env || !env.DB || !symbol || !taskCompoundKey) return;
  const now = Date.now();
  const minGapDefault =
    DERIV_TASK_MIN_INTERVAL_MS[String(taskCompoundKey)] || DERIVATIVE_SLOW_SYNC_MIN_MS || 3600000;
  let prev = null;
  try {
    const { results } = await env.DB.prepare(
      `SELECT symbol, metric, last_attempt_at_ms, last_success_at_ms, next_allowed_at_ms, consecutive_failures, last_error_kind, last_error, extra_json
       FROM derivative_metric_health WHERE symbol = ?1 AND metric = ?2`
    ).bind(String(symbol), String(taskCompoundKey)).all();
    prev = results && results[0] ? results[0] : null;
  } catch (_) {
    prev = null;
  }
  let cf = prev ? Number(prev.consecutive_failures) || 0 : 0;
  let lastSuccMs = prev && prev.last_success_at_ms != null ? Number(prev.last_success_at_ms) : null;
  let nextAllowed = prev ? Number(prev.next_allowed_at_ms) || 0 : 0;
  if (ok === true) {
    cf = 0;
    lastSuccMs = now;
    nextAllowed = now + minGapDefault;
  } else {
    cf = Math.min(999, cf + 1);
    lastSuccMs = prev && prev.last_success_at_ms != null ? Number(prev.last_success_at_ms) : null;
    const expPow = Math.min(8, Math.max(0, cf - 1));
    const backoff = Math.min(6 * 60 * 60 * 1000, Math.round(minGapDefault * 2 ** expPow));
    nextAllowed = Math.max(Number(nextAllowed || 0), now + backoff);
    const bt = banUntilMs != null && Number.isFinite(Number(banUntilMs)) ? Number(banUntilMs) + 120_000 : null;
    if (bt != null) nextAllowed = Math.max(nextAllowed, bt);
  }
  const extraMerged = mergeDerivativeExtraJson(prev && prev.extra_json ? prev.extra_json : "{}", {
    lastFinalizeAtIso: new Date(now).toISOString(),
    lastKind: ok ? "" : kind,
    ...(banUntilMs != null && Number.isFinite(Number(banUntilMs)) ? { binanceBanUntilMs: Math.round(Number(banUntilMs)) } : {}),
  });
  try {
    await env.DB.prepare(
      `INSERT INTO derivative_metric_health (symbol, metric, last_attempt_at_ms, last_success_at_ms, next_allowed_at_ms, consecutive_failures, last_error_kind, last_error, extra_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
       ON CONFLICT(symbol, metric) DO UPDATE SET
       last_attempt_at_ms=excluded.last_attempt_at_ms,
       last_success_at_ms=excluded.last_success_at_ms,
       next_allowed_at_ms=excluded.next_allowed_at_ms,
       consecutive_failures=excluded.consecutive_failures,
       last_error_kind=excluded.last_error_kind,
       last_error=excluded.last_error,
       extra_json=excluded.extra_json`
    ).bind(
      String(symbol),
      String(taskCompoundKey),
      Math.round(now),
      lastSuccMs == null ? null : Math.round(lastSuccMs),
      Math.round(nextAllowed || 0),
      Math.round(cf),
      ok ? null : String(kind || "").slice(0, 64),
      ok ? null : String(shortErr || "").slice(0, 280),
      extraMerged
    ).run();
  } catch (_) {
    //
  }
}

function derivativeTaskBaseMetric(taskCompoundKey) {
  return String(taskCompoundKey || "").split("#")[0] || String(taskCompoundKey || "");
}

function parseJsonObjectSafe(raw) {
  try {
    const obj = raw ? JSON.parse(String(raw)) : {};
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  } catch (_) {
    return {};
  }
}

function derivativeTaskRunnable(healthMap, taskCompoundKey, nowMs, force, opts = {}) {
  if (force) return { ok: true };
  const row = healthMap && taskCompoundKey ? healthMap[taskCompoundKey] : null;
  const na = row ? Number(row.next_allowed_at_ms) || 0 : 0;
  if (na > nowMs) {
    const baseMetric = derivativeTaskBaseMetric(taskCompoundKey);
    const maxTsByMetric = opts && opts.maxTsByMetric && typeof opts.maxTsByMetric === "object" ? opts.maxTsByMetric : null;
    const maxTs = maxTsByMetric ? Number(maxTsByMetric[baseMetric]) : NaN;
    const missing = !Number.isFinite(maxTs);
    const staleMs = missing ? Infinity : Math.max(0, Number(nowMs) - maxTs);
    const staleLimit = derivativeStaleLimitWorker(baseMetric);
    const lastAttempt = row ? Number(row.last_attempt_at_ms) || 0 : 0;
    const extra = parseJsonObjectSafe(row && row.extra_json);
    const banUntilMs = Number(extra.binanceBanUntilMs != null ? extra.binanceBanUntilMs : extra.banUntilMs);
    const kind = row ? String(row.last_error_kind || "") : "";
    const hardBanActive =
      (kind === "blacklisted_ip" || kind === "rate_limited") &&
      Number.isFinite(banUntilMs) &&
      banUntilMs > nowMs;
    const oldEnoughToRetry = nowMs - lastAttempt >= DERIVATIVE_STALE_RETRY_MIN_ATTEMPT_GAP_MS;
    const staleEnough = missing || staleMs > staleLimit + DERIVATIVE_STALE_RETRY_GRACE_MS;
    if (!hardBanActive && staleEnough && oldEnoughToRetry) {
      return { ok: true, staleRetry: true, untilMs: na };
    }
    return { ok: false, untilMs: na };
  }
  return { ok: true };
}

function hourlyHistoryPullLimit(nowMs, maxTMs, barMs = 3600000) {
  const gapMs = maxTMs == null || !Number.isFinite(Number(maxTMs)) ? Infinity : Math.max(0, nowMs - Number(maxTMs));
  const bars = gapMs / barMs;
  if (!Number.isFinite(bars)) return 96;
  if (bars <= 3) return 16;
  if (bars <= 48) return 48;
  if (bars <= 200) return 96;
  return 120;
}

function hourlyHistoryStartTimeMs(maxTMs, slackMs = 2 * 3600000) {
  if (maxTMs == null || !Number.isFinite(Number(maxTMs))) return null;
  const v = Math.floor(Number(maxTMs) - slackMs);
  return v > 0 ? v : null;
}

async function derivativeBinanceHourlyUpstreamBlocked(env, derivativeSyncOpts) {
  if (!env || !env.DB || derivativeSyncOpts && derivativeSyncOpts.force) return { blocked: false };
  try {
    const mode = binanceUpstreamMode(env);
    const hk = derivativeBinanceHealthSourceKey(mode);
    const row = await readDerivativeSourceHealthRow(env, hk);
    const state = derivativeSourceCooldownState(row);
    if (!state.blocked) return { blocked: false, expiredExactBan: !!state.expiredExactBan };
    return {
      blocked: true,
      untilMs: state.untilMs,
      healthKey: hk,
      lastKind: state.lastKind || row.last_error_kind || "",
    };
  } catch (_) {
    return { blocked: false };
  }
}

/** 自检：配置了 BINANCE_FAPI_ORIGIN 时先轻量 ping，失败则暂不进入大批量历史抓取。*/
async function derivativeWarmBinanceCustomPing(env) {
  const customOrigin = parseCustomFapiOrigin(env && env.BINANCE_FAPI_ORIGIN);
  if (!customOrigin) return { skipped: true, ok: false };
  const target = `${String(customOrigin).replace(/\/$/, "")}/fapi/v1/ping`;
  const hk = "binance_custom_origin";
  try {
    const r = await fetchWithTimeout(target, { headers: { Accept: "*/*", "User-Agent": "BitDesk-CF-Worker/3.7 (DerivativePing)" } });
    if (!r.ok) {
      const msg = `${r.status}:${(await r.text().catch(() => "")).slice(0, 120)}`;
      await finalizeDerivativeUpstreamHealth(env, hk, {
        ok: false,
        errorKind: classifyGenericHttp(r.status, msg),
        error: msg,
        extraPatch: { ping: "/fapi/v1/ping" },
      });
      return { skipped: false, ok: false, status: r.status };
    }
    await finalizeDerivativeUpstreamHealth(env, hk, { ok: true, extraPatch: { ping: "/fapi/v1/ping" } });
    return { skipped: false, ok: true };
  } catch (e) {
    await finalizeDerivativeUpstreamHealth(env, hk, {
      ok: false,
      errorKind: "network",
      error: String(e && e.message ? e.message : e).slice(0, 260),
      extraPatch: { ping: "/fapi/v1/ping" },
    });
    return { skipped: false, ok: false, net: true };
  }
}

async function pingBinanceFapiEndpoints(env, label) {
  const customOrigin = parseCustomFapiOrigin(env && env.BINANCE_FAPI_ORIGIN);
  async function pokeOrigin(origin, tag) {
    const target = `${String(origin).replace(/\/$/, "")}/fapi/v1/ping`;
    const t = Date.now();
    try {
      const r = await fetchWithTimeout(target, { headers: { Accept: "*/*", "User-Agent": `BitDesk-CF-Worker/3.7 (${label || "DerivedPing"}-${tag})` } });
      const ok = !!r.ok;
      return { origin: origin, tag, ms: Date.now() - t, ok, status: r.status };
    } catch (e) {
      return {
        origin: origin,
        tag,
        ms: Date.now() - t,
        ok: false,
        status: 0,
        error: String(e && e.message ? e.message : e),
      };
    }
  }
  const out = { directHosts: BINANCE_DERIVATIVE_HOSTS.slice(0, 5), pings: [], customOrigin: !!customOrigin, binMode: binanceUpstreamMode(env) };
  if (customOrigin) out.pings.push(await pokeOrigin(customOrigin, "custom"));
  for (let i = 0; i < Math.min(5, BINANCE_DERIVATIVE_HOSTS.length); i++) {
    out.pings.push(await pokeOrigin(`https://${BINANCE_DERIVATIVE_HOSTS[i]}`, `direct:${BINANCE_DERIVATIVE_HOSTS[i]}`));
  }
  return out;
}

function hourlySubsetAllows(fg, metric) {
  if (!fg.hourlyHeavyOnlySet) return true;
  return fg.hourlyHeavyOnlySet.has(String(metric || ""));
}

function derivCoreLooksStale(metric, maxTs, nowMs) {
  const mx = maxTs && maxTs[String(metric)];
  const limMs = derivativeStaleLimitWorker(metric);
  if (!Number.isFinite(Number(mx))) return true;
  return nowMs - Number(mx) > limMs + 2500;
}

function buildDerivativeSyncPlanSummary({
  fg,
  manualBlockingFastOnlySkipped,
  hourlyBinanceUpstreamBlockedFlag,
  customPingFailed,
}) {
  return {
    includeFast: !!fg.includeFast,
    includeHourly: !!fg.includeHourly,
    includeMacro: !!fg.includeMacro,
    hourlyHeavyOnly: !!(fg.hourlyHeavyOnlySet && fg.hourlyHeavyOnlySet.size),
    manualBlockedFreshFast: !!manualBlockingFastOnlySkipped,
    hourlyBinanceUpstreamBlocked: !!hourlyBinanceUpstreamBlockedFlag,
    customPingFailedBeforeHourly: !!customPingFailed,
  };
}

function buildBinanceErrorFromFetchBinanceGot(got) {
  const e = new Error(String(got?.error || "binance_upstream_failed"));
  e.errorKind = got?.errorKind || classifyBinanceUpstreamError(got?.httpStatus ?? got?.status, got?.error);
  e.binanceSkipped = !!(got && got.skipped);
  if (got && got.banUntilMs != null) e.banUntilMs = got.banUntilMs;
  return e;
}

async function fetchBinanceFapiJson(env, pathname, params, label, derivativeSyncOpts = {}) {
  const binMode = binanceUpstreamMode(env);
  const healthKey = derivativeBinanceHealthSourceKey(binMode);
  const customOrigin = parseCustomFapiOrigin(env && env.BINANCE_FAPI_ORIGIN);
  const origins = binanceDerivativeFapiOrigins(env);
  const p = new URLSearchParams(params || {});
  const chain = [];
  let firstErr = { status: 0, error: "", body: "" };
  let firstFailDetail = null;
  let hardFailDetail = null;
  const force = !!(derivativeSyncOpts && derivativeSyncOpts.force);

  const healthRowPre = force ? null : await readDerivativeSourceHealthRow(env, healthKey).catch(() => null);
  const cooldownPre = !force ? derivativeSourceCooldownState(healthRowPre) : { blocked: false };
  if (!force && cooldownPre.blocked) {
    const errLine = `[${healthKey}] upstream cooldown_until_ms=${cooldownPre.untilMs}`;
    chain.push(`${healthKey}:cooldown_skip`);
    const got = {
      ok: false,
      data: null,
      host: healthKey,
      chain,
      error: errLine.slice(0, 220),
      errorKind: "cooldown",
      httpStatus: 0,
      skipped: true,
      binanceOriginMode: binMode,
      label: label || "",
    };
    /** 仍处于冷却期不重写聚合健康以免重复打点 */
    return got;
  }

  for (const origin of origins) {
    const target = origin.replace(/\/$/, "") + pathname + (p.toString() ? `?${p.toString()}` : "");
    let host = origin;
    try { host = new URL(origin).host; } catch (_) {}
    try {
      const r = await fetchWithTimeout(target, {
        headers: {
          "User-Agent": `BitDesk-CF-Worker/3.0 (${label || "DerivativesSync"})`,
          Accept: "application/json",
        },
      });
      if (!r.ok) {
        let err = "";
        try { err = (await r.text()).slice(0, 480); } catch (_) { err = r.statusText || ""; }
        const classified = classifyBinanceFapiFailure(r.status, err);
        if (!firstFailDetail) firstFailDetail = classified;
        if (classified.kind === "blacklisted_ip" || classified.kind === "rate_limited") hardFailDetail = classified;
        chain.push(`${host}:${r.status}:${classified.kind}`);
        if (!firstErr.error) firstErr = { status: r.status, error: err.replace(/\s+/g, " ").trim(), body: err };
        if (shouldStopDerivativeOriginRetry(!!customOrigin, classified)) {
          break;
        }
        continue;
      }
      const data = await r.json().catch(() => null);
      if (data == null) {
        chain.push(`${host}:bad-json`);
        if (!firstErr.error) firstErr = { status: r.status, error: "bad json", body: "" };
        continue;
      }
      chain.push(`${host}:ok`);
      const okGot = {
        ok: true,
        data,
        host,
        chain,
        binanceOriginMode: binMode,
        errorKind: null,
        httpStatus: r.status,
        label: label || "",
      };
      await finalizeDerivativeUpstreamHealth(env, healthKey, {
        ok: true,
        errorKind: "",
        error: "",
        extraPatch: { chain, label: label || "", lastHost: host, binanceOriginMode: binMode },
      });
      return okGot;
    } catch (e) {
      const msg = (e && e.message ? e.message : String(e)).replace(/\s+/g, " ").trim().slice(0, 220);
      const classified = classifyBinanceUpstreamError(0, msg);
      chain.push(`${host}:err_${classified}_${msg.slice(0, 50)}`);
      if (!firstErr.error) firstErr = { status: 0, error: msg || "network error", body: msg };
    }
  }

  const detailFail = hardFailDetail || firstFailDetail || classifyBinanceFapiFailure(firstErr.status, firstErr.body || firstErr.error);
  const kindFinal = detailFail.kind;
  const failGot = {
    ok: false,
    data: null,
    chain,
    host: origins[origins.length - 1] || healthKey,
    error: String(firstErr.error || "all failed").slice(0, 340),
    errorKind: kindFinal,
    banUntilMs: detailFail.banUntilMs != null ? detailFail.banUntilMs : null,
    binanceCode: detailFail.binanceCode != null ? detailFail.binanceCode : null,
    httpStatus: firstErr.status,
    skipped: false,
    binanceOriginMode: binMode,
    label: label || "",
  };
  await finalizeDerivativeUpstreamHealth(env, healthKey, {
    ok: false,
    errorKind: kindFinal,
    error: failGot.error,
    banUntilMs: detailFail.banUntilMs != null ? detailFail.banUntilMs : null,
    extraPatch: {
      chain: chain.slice(0, 32),
      label: label || "",
      binanceOriginMode: binMode,
      pathname,
      httpStatus: firstErr.status,
      binanceCode: detailFail.binanceCode != null ? detailFail.binanceCode : null,
    },
  });
  return failGot;
}

const YAHOO_DERIV_SOURCE_KEY = "yahoo_side_channel";

/** Bybit Linear 公开市场 ticker：仅语义接近的 snapshot 回填（Funding 当前值 + Open Interest）。 */
async function fetchBybitLinearTickerSnapshot(normalizedSymbol) {
  const u = `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${encodeURIComponent(normalizedSymbol)}`;
  const r = await fetchWithTimeout(u, {
    headers: {
      "User-Agent": "BitDesk-CF-Worker/3.0 (BybitDerivFallback)",
      Accept: "application/json",
    },
  }, FETCH_TIMEOUT_MS);
  const txt = await r.text().catch(() => "");
  if (!r.ok) {
    return { ok: false, status: r.status, error: txt.slice(0, 260) };
  }
  let data = null;
  try {
    data = JSON.parse(txt);
  } catch (_) {
    return { ok: false, status: r.status || 502, error: "bybit json parse" };
  }
  if (!data || Number(data.retCode || 0) !== 0 || !data.result || !Array.isArray(data.result.list) || !data.result.list[0]) {
    return { ok: false, status: 502, error: `bybit ret ${data && data.retCode}` };
  }
  const lst = data.result.list[0];
  return {
    ok: true,
    fundingRate: Number(lst.fundingRate),
    openInterest: Number(lst.openInterest),
    turnover24h: Number(lst.turnover24h),
    markPrice: Number(lst.markPrice),
    nextFundingTime: Number(lst.nextFundingTime || 0) || Date.now(),
  };
}

async function fetchYahooChart(symbol, range = "1mo", interval = "1h", envOrNull = null) {
  const u = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  u.searchParams.set("range", range);
  u.searchParams.set("interval", interval);
  const r = await fetchWithTimeout(u.toString(), {
    headers: {
      "User-Agent": "BitDesk-CF-Worker/3.0 (YahooSideChannel)",
      Accept: "application/json",
    },
  });
  if (!r.ok) {
    let err = "";
    try { err = (await r.text()).slice(0, 160); } catch (_) { err = r.statusText || ""; }
    const kind = classifyGenericHttp(r.status, err);
    if (envOrNull && envOrNull.DB) {
      await finalizeDerivativeUpstreamHealth(envOrNull, YAHOO_DERIV_SOURCE_KEY, {
        ok: false,
        errorKind: kind,
        error: `Yahoo ${symbol} ${r.status}: ${err.replace(/\s+/g, " ").trim()}`.slice(0, 360),
        extraPatch: { symbol, range, interval, httpStatus: r.status },
      });
    }
    throw new Error(`Yahoo ${symbol} ${r.status}: ${err.replace(/\s+/g, " ").trim()}`);
  }
  const data = await r.json().catch(() => null);
  const result = data?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  if (envOrNull && envOrNull.DB) {
    await finalizeDerivativeUpstreamHealth(envOrNull, YAHOO_DERIV_SOURCE_KEY, {
      ok: true,
      errorKind: "",
      error: "",
      extraPatch: { symbol, range, interval, bars: timestamps.length },
    });
  }
  return timestamps
    .map((sec, idx) => {
      const raw = closes[idx];
      return raw == null ? null : { t: Number(sec) * 1000, value: Number(raw) };
    })
    .filter(Boolean)
    .filter((row) => Number.isFinite(row.t) && Number.isFinite(row.value));
}

function derivativePoint(symbol, metric, t, value, source, extra) {
  const ts = Number(t || Date.now());
  const v = Number(value);
  if (!Number.isFinite(ts) || !Number.isFinite(v)) return null;
  return {
    symbol,
    metric,
    t: ts,
    value: v,
    source: source || "",
    extra: extra || {},
  };
}

async function persistDerivativePoints(env, points) {
  if (!env.DB || !Array.isArray(points) || !points.length) return { written: 0, pruned: 0 };
  const stmt = env.DB.prepare(
    `INSERT OR REPLACE INTO derivative_timeseries
      (symbol, metric, t, value, source, extra_json, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  );
  const now = Date.now();
  const rows = points.filter(Boolean);
  if (rows.length) {
    await env.DB.batch(rows.map((p) => stmt.bind(
      p.symbol,
      p.metric,
      p.t,
      p.value,
      p.source || "",
      JSON.stringify(p.extra || {}),
      now
    )));
  }
  const cutoff = now - DERIVATIVE_RETENTION_MS;
  const pruned = await env.DB.prepare("DELETE FROM derivative_timeseries WHERE t < ?1").bind(cutoff).run();
  return { written: rows.length, pruned: pruned?.meta?.changes || 0 };
}

async function updateDerivativeSyncStatus(env, symbol, metric, { ok, count, error }) {
  if (!env.DB) return;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO derivative_sync_status
      (symbol, metric, last_run, last_count, last_ok, last_error)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  ).bind(
    symbol,
    metric,
    new Date().toISOString(),
    Number(count) || 0,
    ok ? 1 : 0,
    error ? String(error).slice(0, 300) : null
  ).run();
}

function compactDerivativeSeriesRow(row) {
  let extra = {};
  try { extra = row.extra_json ? JSON.parse(row.extra_json) : {}; } catch (_) {}
  return {
    t: Number(row.t),
    value: Number(row.value),
    source: row.source || "",
    extra,
  };
}

function latestFromRows(rows) {
  return rows && rows.length ? rows[rows.length - 1] : null;
}

function pctChange(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y) || y === 0) return null;
  return ((x - y) / Math.abs(y)) * 100;
}

function derivativeStaleLimitWorker(metricKey) {
  const k = String(metricKey || "");
  if (k === "funding_binance" || k === "oi_binance") return 45 * 60 * 1000;
  if (DERIV_MACRO_METRICS_SET.has(k)) {
    /** VIX/VIX3M/MOVE are exchange-session series; 96h covers normal weekend gaps without hiding weekday stalls. */
    return 96 * 60 * 60 * 1000;
  }
  return 3 * 60 * 60 * 1000;
}

function rollupDerivativeLevels(freshnessByMetric, keys) {
  let ok = 0;
  let stale = 0;
  let missing = 0;
  for (const k of keys) {
    const lvl = freshnessByMetric[k];
    if (!lvl || lvl.level === "missing") missing++;
    else if (lvl.level === "stale") stale++;
    else ok++;
  }
  return { okCount: ok, staleCount: stale, missingCount: missing, totalKeys: keys.length };
}

/** 与 `衍生品面板/derivativesSnapshotCore.mjs` 的 freshness 结构对齐。 */
function buildPayloadFreshnessFromSeries(series, nowMs) {
  const freshnessByMetric = {};
  let maxAnyLatestT = 0;
  const staleByMetric = {};
  const coreStaleKeys = [];
  const coreKeys = DERIVATIVE_METRICS.filter((k) => !DERIV_MACRO_METRICS_SET.has(k));
  const warningsCore = [];
  const warningsMacro = [];

  for (const key of DERIVATIVE_METRICS) {
    const rows = (series[key] || []).slice().sort((a, b) => Number(a.t) - Number(b.t));
    const lst = latestFromRows(rows);
    if (!lst) {
      freshnessByMetric[key] = {
        latestT: null,
        staleMs: null,
        staleLimitMs: derivativeStaleLimitWorker(key),
        level: "missing",
        source: "",
        points: 0,
      };
      staleByMetric[key] = null;
      if (DERIV_MACRO_METRICS_SET.has(key)) warningsMacro.push(`[宏观旁路] ${key} 无数据`);
      else warningsCore.push(`核心 ${key} 暂无数据`);
      continue;
    }

    maxAnyLatestT = Math.max(maxAnyLatestT, lst.t);
    const staleMs = Math.max(0, nowMs - lst.t);
    staleByMetric[key] = staleMs;
    const limit = derivativeStaleLimitWorker(key);
    const level = staleMs > limit ? "stale" : "ok";

    freshnessByMetric[key] = {
      latestT: lst.t,
      latestTime: new Date(lst.t).toISOString(),
      staleMs,
      staleLimitMs: limit,
      level,
      source: lst.source || "",
      points: rows.length,
    };

    if (level === "stale") {
      if (DERIV_MACRO_METRICS_SET.has(key)) warningsMacro.push(`[宏观旁路] ${key} 数据偏旧`);
      else {
        warningsCore.push(`核心 ${key} 偏旧 (${Math.round(staleMs / 60000)} 分钟)`);
        coreStaleKeys.push(key);
      }
    }
  }

  const coreLevels = {};
  for (const k of coreKeys) coreLevels[k] = freshnessByMetric[k];
  const coreRollup = rollupDerivativeLevels(coreLevels, coreKeys);
  const macroLevels = {};
  for (const k of DERIV_MACRO_METRICS) macroLevels[k] = freshnessByMetric[k];
  const macroRollup = rollupDerivativeLevels(macroLevels, DERIV_MACRO_METRICS);

  let worstCoreStaleMs = null;
  for (const k of coreKeys) {
    const row = freshnessByMetric[k];
    if (row && row.staleMs != null) worstCoreStaleMs = worstCoreStaleMs == null ? row.staleMs : Math.max(worstCoreStaleMs, row.staleMs);
  }

  const sourceOk = coreRollup.missingCount === 0 && coreRollup.staleCount === 0 && warningsCore.length === 0;
  const optimisticLatestT = maxAnyLatestT || null;

  return {
    latestT: optimisticLatestT,
    latestTime: optimisticLatestT ? new Date(optimisticLatestT).toISOString() : null,
    staleMs: optimisticLatestT ? nowMs - optimisticLatestT : null,
    worstCoreStaleMs: worstCoreStaleMs == null ? null : Math.round(worstCoreStaleMs),
    worstCoreStaleMinutes: worstCoreStaleMs == null ? null : Math.round(worstCoreStaleMs / 60000),
    rollup: { core: coreRollup, macro: macroRollup },
    freshnessByMetric,
    sourceOk,
    staleByMetric,
    warnings: [...warningsCore, ...warningsMacro],
    coreStaleMetrics: coreStaleKeys,
  };
}

function compactStablecoinContext(input) {
  const ctx = input?.stablecoinContext || null;
  const series = ctx?.series || {};
  const get = (key) => (series[key] || []).slice().sort((a, b) => Number(a.t) - Number(b.t));
  const beforeWindow = (key, ms) => {
    const rows = get(key);
    const latest = latestFromRows(rows);
    if (!latest) return { status: "missing", points: rows.length };
    let prev = rows[0] || null;
    for (const row of rows) {
      if (Number(row.t) <= Number(latest.t) - ms) prev = row;
      else break;
    }
    return {
      status: "ok",
      latest: roundNum(latest.value, 2),
      changePct: prev ? roundNum(pctChange(latest.value, prev.value), 2) : null,
      latestT: latest.t,
      source: latest.source || "",
      points: rows.length,
    };
  };
  const d7 = 7 * 24 * 60 * 60 * 1000;
  return {
    reliability: ONCHAIN_RELIABILITY,
    dataFreshness: ctx?.dataFreshness || null,
    signals: {
      usdt: beforeWindow("stable_usdt_circ", d7),
      usdc: beforeWindow("stable_usdc_circ", d7),
    },
    llmPolicy: ONCHAIN_RELIABILITY.llmPolicy,
  };
}

async function fetchLatestKlinePriceChange(env, symbol) {
  if (!env.DB) {
    return {
      priceChange24hPct: null,
      priceChange24hMeta: { sampleSufficient: false, reason: "no_db", source: "d1-klines-1h" },
    };
  }
  try {
    const { results } = await env.DB.prepare(
      "SELECT t, c FROM klines WHERE symbol = ?1 AND interval = '1h' ORDER BY t DESC LIMIT 30"
    ).bind(symbol).all();
    const rows = (results || []).sort((a, b) => Number(a.t) - Number(b.t));
    if (rows.length < 25) {
      return {
        priceChange24hPct: null,
        priceChange24hMeta: {
          sampleSufficient: false,
          reason: "insufficient_bars",
          reasonHint: "价格涨跌样本不足：暂不判断价量背离（1h K 线不足以覆盖约 24h 窗口）",
          barCount: rows.length,
          source: "d1-klines-1h",
        },
      };
    }
    const last = latestFromRows(rows);
    const prev = rows[rows.length - 25];
    const pct = last && prev ? pctChange(last.c, prev.c) : null;
    const gapMs = last && prev ? Number(last.t) - Number(prev.t) : 0;
    return {
      priceChange24hPct: pct,
      priceChange24hMeta: {
        sampleSufficient: Number.isFinite(Number(pct)),
        reason: Number.isFinite(Number(pct)) ? "ok" : "bad_prices",
        barCount: rows.length,
        gapMsApprox: gapMs,
        latestT: last ? Number(last.t) : null,
        anchorT: prev ? Number(prev.t) : null,
        source: "d1-klines-1h",
      },
    };
  } catch (e) {
    return {
      priceChange24hPct: null,
      priceChange24hMeta: {
        sampleSufficient: false,
        reason: "query_error",
        reasonHint: String(e && e.message ? e.message : e).slice(0, 160),
        source: "d1-klines-1h",
      },
    };
  }
}

function preferSameSourceSortedRows(rows) {
  const sorted = (rows || []).slice().sort((a, b) => Number(a.t) - Number(b.t));
  const l = latestFromRows(sorted);
  if (!l || !l.source) return sorted;
  const same = sorted.filter((r) => (r.source || "") === l.source);
  return same.length >= 2 ? same : sorted;
}

function beforeWindowPreferSource(getKey, ms) {
  const rows = preferSameSourceSortedRows(getKey());
  const l = latestFromRows(rows);
  if (!l) return null;
  let prev = rows[0] || null;
  for (const row of rows) {
    if (Number(row.t) <= Number(l.t) - ms) prev = row;
    else break;
  }
  const mixedSource = !!(prev && l.source !== prev.source);
  return {
    latest: roundNum(l.value, 8),
    change: prev ? roundNum(Number(l.value) - Number(prev.value), 8) : null,
    changePct: prev ? roundNum(pctChange(l.value, prev.value), 2) : null,
    latestT: l.t,
    source: l.source || "",
    mixedSource,
  };
}

function workerBasisPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) <= 1 ? n * 100 : n;
}

function workerBasisState(quarterLast) {
  const p = workerBasisPct(quarterLast == null ? null : quarterLast.value);
  if (p == null) return "样本不足";
  if (p > DERIV_BASIS_ELEVATED_PCT) return "升水偏高";
  if (p < DERIV_BASIS_DISCOUNT_PCT) return "贴水";
  if (p > 0) return "温和升水";
  return "轻微贴水";
}

function workerTopAlignment(accountVal, positionVal) {
  const a = Number(accountVal);
  const p = Number(positionVal);
  if (!Number.isFinite(a) || !Number.isFinite(p)) return "样本不足";
  if (a > DERIV_RATIO_BAND_HIGH && p > DERIV_RATIO_BAND_HIGH) return "大户账户与仓位同向偏多";
  if (a < DERIV_RATIO_BAND_LOW && p < DERIV_RATIO_BAND_LOW) return "大户账户与仓位同向偏空";
  if ((a - 1) * (p - 1) < 0) return "账户与仓位分歧";
  return "大户方向中性";
}

function workerRatioStateLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "样本不足";
  if (n >= DERIV_RATIO_BAND_HIGH) return "多头占优";
  if (n <= DERIV_RATIO_BAND_LOW) return "空头占优";
  return "均衡";
}

function workerFundingCrowding(rate) {
  const v = Number(rate);
  if (!Number.isFinite(v)) return "样本不足";
  if (Math.abs(v) >= DERIV_FUNDING_CROWD_ABS) return "拥挤";
  return "中性";
}

/** 对齐 `衍生品面板/derivativesSnapshotCore.mjs` 口径 */
function workerOiDivergenceLine(pricePct, oiWindow, pcm) {
  const pcNum = Number(pricePct);
  const pcmObj = pcm && typeof pcm === "object" ? pcm : null;
  const priceSampleOk =
    pcmObj && pcmObj.sampleSufficient === false ? false : Number.isFinite(pcNum);
  const oiPctOk = oiWindow != null && oiWindow.changePct != null && Number.isFinite(Number(oiWindow.changePct));

  if (priceSampleOk && oiPctOk) {
    if (pcNum > 1 && oiWindow.changePct < -1) return "价格上涨但 OI 下降，偏空仓减压/现货驱动";
    if (pcNum < -1 && oiWindow.changePct > 1) return "价格下跌但 OI 上升，偏新增空头拥挤";
    if (pcNum < 0 && oiWindow.changePct < -1) return "价格小跌且 OI 下降，偏去杠杆/减仓";
    if (Math.abs(pcNum) < 1 && Math.abs(oiWindow.changePct) > 3) return "价格横盘但 OI 快速变化，警惕杠杆蓄力";
    return "价格与 OI 暂无明显背离";
  }
  if (!priceSampleOk) {
    return pcmObj && pcmObj.reasonHint
      ? String(pcmObj.reasonHint)
      : "价格涨跌样本不足：暂不判断价量背离（基于 1h K 线近似 24h）";
  }
  return "OI 变化样本不足：暂不判断价量背离";
}

function buildCompactDerivativesSnapshot(input, profile) {
  const series = input.series || {};
  const get = (key) => (series[key] || []).slice().sort((a, b) => Number(a.t) - Number(b.t));
  const last = (key) => latestFromRows(get(key));
  const lastExtra = (key) => last(key)?.extra || {};
  const msDay = 24 * 60 * 60 * 1000;
  const ms6h = 6 * 60 * 60 * 1000;
  const coherent = (key, ms) => beforeWindowPreferSource(() => get(key), ms);

  const vixLast = last("vix");
  const vix3mLast = last("vix3m");
  const vixTerm =
    vixLast && vix3mLast && Number(vix3mLast.value)
      ? roundNum(Number(vixLast.value) / Number(vix3mLast.value), 3)
      : null;
  const taker = last("taker_buy_sell");
  const basisPerp = last("basis_perp");
  const basisQuarter = last("basis_quarter");
  const topAccount = last("top_account_long_short");
  const topPosition = last("top_position_long_short");
  const fb24 = coherent("funding_binance", msDay);
  const oi6 = coherent("oi_binance", ms6h);
  const oi24 = coherent("oi_binance", msDay);
  const oiDiv = workerOiDivergenceLine(input.priceChange24hPct, oi24, input.priceChange24hMeta);
  const topAlign = workerTopAlignment(topAccount?.value, topPosition?.value);
  const fundingLast = last("funding_binance");
  const longShortRatio = last("long_short");

  const rows = [
    {
      metric: "funding",
      state: workerFundingCrowding(fundingLast?.value),
      value: roundNum(fundingLast?.value, 8),
    },
    {
      metric: "oi",
      state: oiDiv,
      value: oi24?.changePct ?? null,
    },
    {
      metric: "taker",
      state: workerRatioStateLabel(taker?.value),
      value: roundNum(taker?.value, 4),
    },
    {
      metric: "basis",
      state: workerBasisState(basisQuarter),
      value: roundNum(workerBasisPct(basisQuarter?.value), 2),
    },
    {
      metric: "top_trader",
      state: topAlign,
      value: roundNum(topPosition?.value, 4),
    },
    {
      metric: "long_short",
      state: workerRatioStateLabel(longShortRatio?.value),
      value: roundNum(longShortRatio?.value, 4),
    },
  ];
  const stablecoinContext = compactStablecoinContext(input);

  const staleObsLines = Array.isArray(input.stalenessReasons) ? input.stalenessReasons.slice(0, 4) : [];

  /** 与衍生品面板快照核心 DERIVATIVES_SNAPSHOT_VERSION 对齐 */
  const snapshotVersionAi = "1.3.0";

  const notableConflictRe =
    /拥挤|样本不足|升水偏高|贴水|主动|多头占优|空头占优|分歧|同向|背离|杠杆|震荡|空仓|去杠杆|蓄水|加价|买盘|卖盘/;
  const ingestedMeta = {
    priceChange24hMeta: input.priceChange24hMeta || null,
    usedPayloadFreshness: !!(input.dataFreshness && input.dataFreshness.freshnessByMetric),
    workerBuild:
      input.syncHints && typeof input.syncHints.workerBuild === "string" ? input.syncHints.workerBuild : WORKER_BUILD,
    binanceOriginMode:
      input.syncHints && typeof input.syncHints.binanceOriginMode === "string"
        ? input.syncHints.binanceOriginMode
        : "direct",
    metricHealthStaleSignals:
      typeof input.syncHints?.metricHealthStaleSignals === "number"
        ? Number(input.syncHints.metricHealthStaleSignals)
        : staleObsLines.length,
    metricHealthStaleSamples: staleObsLines,
    ingestHintsCompact: [
      fb24?.mixedSource ? "funding_24h_mixed_source" : null,
      oi24?.mixedSource ? "oi_24h_mixed_source" : null,
      oi6?.mixedSource ? "oi_6h_mixed_source" : null,
      staleObsLines.length ? `metric_health_stale=${staleObsLines.length}` : null,
      input.syncHints && input.syncHints.binanceOriginMode === "direct" ? "binance_upstream_mode_direct" : null,
      input.syncHints && input.syncHints.binanceOriginMode === "custom" ? "binance_upstream_mode_custom_origin" : null,
    ].filter(Boolean),
  };

  return {
    page: "衍生品面板",
    snapshotVersion: snapshotVersionAi,
    generatedAt: input.generatedAt,
    profile,
    dataSource: input.dataSource,
    currentView: { symbol: input.symbol, currency: symbolToCurrency(input.symbol), range: input.range || "30d" },
    dataFreshness: input.dataFreshness,
    ingestHints: ingestedMeta,
    currentViewTabs: {
      funding: { binance: fb24 },
      openInterest: {
        binance6h: oi6,
        binance24h: oi24,
        priceChange24hPct: input.priceChange24hPct,
        priceChange24hMeta: input.priceChange24hMeta || null,
        divergenceCompact: oiDiv,
      },
      taker: {
        latest: taker ? { ...taker, value: roundNum(taker.value, 4), extra: lastExtra("taker_buy_sell") } : null,
        change24h: coherent("taker_buy_sell", msDay),
      },
      basis: {
        perp: basisPerp ? { ...basisPerp, value: roundNum(basisPerp.value, 4), extra: lastExtra("basis_perp") } : null,
        quarter: basisQuarter ? { ...basisQuarter, value: roundNum(basisQuarter.value, 4), extra: lastExtra("basis_quarter") } : null,
      },
      topTrader: {
        account: topAccount ? { ...topAccount, value: roundNum(topAccount.value, 4), extra: lastExtra("top_account_long_short") } : null,
        position: topPosition ? { ...topPosition, value: roundNum(topPosition.value, 4), extra: lastExtra("top_position_long_short") } : null,
        alignmentCompact: topAlign,
      },
      positioning: {
        globalLongShort: longShortRatio ? { ...longShortRatio, value: roundNum(longShortRatio.value, 4) } : null,
      },
      macro: {
        vix24h: coherent("vix", msDay),
        move24h: coherent("move", msDay),
        vixTermStructure: vixTerm,
      },
      stablecoinContext,
    },
    analysisMatrix: { description: "衍生品六项矩阵", rows },
    notableConflicts: rows.filter((row) => notableConflictRe.test(String(row.state || ""))),
    warnings: [
      ...(input.dataFreshness?.warnings || []),
      ...((stablecoinContext.dataFreshness?.warnings || []).map((w) => `stablecoin:${w}`)),
      ...(staleObsLines.map((ln) => `metric_health:${ln}`)),
    ],
    llmBrief:
      rows.map((row) => `${row.metric}:${row.state}${row.value == null ? "" : `(${row.value})`}`).join("；") +
      `。稳定币背景低权重，USDT 7d=${stablecoinContext.signals.usdt.changePct ?? "--"}%，USDC 7d=${stablecoinContext.signals.usdc.changePct ?? "--"}%；仅作流动性背景，不作独立触发器。` +
      (staleObsLines.length ? ` 「数据陈旧提示」${staleObsLines.join("｜").slice(0, 460)}（降低结论权重）。` : ""),
  };
}

function resolveDerivativeSyncFlagGroups(groups) {
  const g = String(groups || "all").toLowerCase().trim();
  if (g === "fast") return { includeFast: true, includeHourly: false, includeMacro: false, hourlyHeavyOnlySet: null, backfillMode: false };
  /** 仅 1h 历史类：不含 fast 快照（与页面分阶段同步配合）。 */
  if (g === "hourly") return { includeFast: false, includeHourly: true, includeMacro: false, hourlyHeavyOnlySet: null, backfillMode: false };
  if (g === "core") return { includeFast: true, includeHourly: true, includeMacro: false, hourlyHeavyOnlySet: null, backfillMode: false };
  if (g === "core-proprietary" || g === "coreheavy") {
    return { includeFast: false, includeHourly: true, includeMacro: false, hourlyHeavyOnlySet: new Set(DERIV_CORE_BINANCE_HEAVY), backfillMode: false };
  }
  if (g === "backfill") return { includeFast: false, includeHourly: true, includeMacro: false, hourlyHeavyOnlySet: null, backfillMode: true };
  if (g === "slow" || g === "macro") return { includeFast: false, includeHourly: false, includeMacro: true, hourlyHeavyOnlySet: null, backfillMode: false };
  return { includeFast: true, includeHourly: true, includeMacro: true, hourlyHeavyOnlySet: null, backfillMode: false };
}

async function syncDerivativesOne(env, symbol, opts = {}) {
  const normalizedSymbol = String(symbol || DEFAULT_SYMBOL).toUpperCase();
  const pair = symbolToPair(normalizedSymbol);
  const now = Date.now();
  const fg = resolveDerivativeSyncFlagGroups(opts.groups);
  fg.backfillMode = !!opts.backfillMode || !!fg.backfillMode;
  const derivativeSyncOpts = { force: !!opts.force };
  const interaction = String(opts.interaction || opts.sourceInteraction || "").trim();

  /** Plan / UI 诊断：同步闸门、跳过原因与健康摘要汇总 */
  /** @type {Record<string, any>} */
  let syncPlanExtras = {};

  /** @type {{acquired:false,untilMs:number,holder:string}|{acquired:true}} */
  let lockMeta = null;
  const skipLockRequested = !!(opts.skipSyncLock === true || opts.skipDerivLock === true);
  const syncRunStarted = Date.now();
  const syncRunId =
    typeof crypto.randomUUID === "function" ? crypto.randomUUID()
      : `run_${normalizedSymbol}_${syncRunStarted}`;

  /** 手动阻塞式「仅 fast」：若Funding/OI 已在容忍窗口内且无 force，跳过整个同步且不抢锁（避免无谓打上游）。 */
  if (
    interaction === "manual_blocking" &&
    !derivativeSyncOpts.force &&
    fg.includeFast &&
    !fg.includeHourly &&
    !fg.includeMacro &&
    env &&
    env.DB
  ) {
    const preMax = await readDerivativeGroupedMaxTsForSymbol(env, normalizedSymbol);
    const fuSt = !derivCoreLooksStale("funding_binance", preMax, now);
    const oiSt = !derivCoreLooksStale("oi_binance", preMax, now);
    if (fuSt && oiSt) {
      syncPlanExtras = {
        ...syncPlanExtras,
        queuedOrSkipped: "fresh_same_window",
        skippedBecause: "fresh_enough_fast",
        syncPlanSummary: buildDerivativeSyncPlanSummary({
          fg,
          manualBlockingFastOnlySkipped: true,
          hourlyBinanceUpstreamBlockedFlag: false,
          customPingFailed: false,
        }),
      };
      return {
        ok: true,
        partial: false,
        symbol: normalizedSymbol,
        written: 0,
        writtenByMetric: {},
        pruned: 0,
        errors: [],
        attemptedMetrics: [],
        failedMetrics: [],
        metricErrorKinds: [],
        sourceHealthSnapshot: [],
        binanceOriginMode: binanceUpstreamMode(env),
        workerBuild: WORKER_BUILD,
        background: !!opts.background,
        groups: fg,
        forceApplied: !!derivativeSyncOpts.force,
        runId: syncRunId,
        skipped: true,
        skippedBecause: "fresh_enough_fast",
        syncPlanSummary: syncPlanExtras.syncPlanSummary,
      };
    }
  }

  /** 抢占同步锁（避免 Cron / blocking / queue 并行打 Binance REST）。 force 仍可绕过锁用于排障 */
  let lockHeld = false;
  const lockKey = `${DERIV_SYNC_LOCK_PREFIX}:${normalizedSymbol}`;
  const lockOwner =
    interaction === "cron"
      ? `cron@${syncRunStarted}`
      : interaction === "manual_queue" || interaction === "manual_async" || interaction === "async_queue" || interaction === "wait_until"
        ? `queue@${syncRunStarted}`
        : `blocking@${syncRunStarted}`;
  let lockUntilMsReturned = null;
  if (
    env &&
    env.DB &&
    !derivativeSyncOpts.force &&
    !skipLockRequested
  ) {
    const ttlMs = fg.includeMacro ? 620_000 : fg.includeHourly ? 390_000 : 150_000;
    lockMeta = await tryAcquireDerivativeSyncLock(env, lockKey, lockOwner, ttlMs, {
      groups: String(opts.groups || "all"),
      interaction,
      runId: syncRunId,
    });
    lockUntilMsReturned = lockMeta && lockMeta.acquired === false ? lockMeta.untilMs || null : null;
    if (lockMeta && lockMeta.acquired === false && !lockUntilMsReturned) lockUntilMsReturned = null;
    if (lockMeta && lockMeta.acquired === false && lockUntilMsReturned) {
      return {
        ok: true,
        partial: false,
        symbol: normalizedSymbol,
        written: 0,
        writtenByMetric: {},
        pruned: 0,
        errors: [],
        attemptedMetrics: [],
        failedMetrics: [],
        metricErrorKinds: [],
        sourceHealthSnapshot: [],
        binanceOriginMode: binanceUpstreamMode(env),
        workerBuild: WORKER_BUILD,
        background: !!opts.background,
        groups: fg,
        forceApplied: !!derivativeSyncOpts.force,
        runId: syncRunId,
        skipped: true,
        skippedBecause: "sync_lock_busy",
        queuedOrSkipped: "locked",
        lockUntilIso: lockUntilMsReturned ? new Date(lockUntilMsReturned).toISOString() : null,
        lockHolder: lockMeta.holder || null,
      };
    }
    lockHeld = !!(lockMeta && lockMeta.acquired === true && !lockMeta.degraded && !lockMeta.noopDb);
    if (!(lockHeld)) lockHeld = false;
  }

  const points = [];
  /** @type {Map<string,string>} */
  const firstErrorByMetric = new Map();
  /** @type {Map<string,string>} */
  const metricUpstreamKindByMetric = new Map();
  const attemptedMetrics = new Set();

  function bumpDerivativeMetric(metricKey, err) {
    const m = String(metricKey || "");
    if (!m) return;
    const msg = err && err.message ? String(err.message).replace(/\s+/g, " ").trim() : String(err || "").replace(/\s+/g, " ").trim();
    if (!firstErrorByMetric.has(m)) firstErrorByMetric.set(m, msg.slice(0, 300));
    const k = err && err.errorKind ? String(err.errorKind) : "";
    if (k && !metricUpstreamKindByMetric.has(m)) metricUpstreamKindByMetric.set(m, k);
    if (err && err.banUntilMs != null && !metricUpstreamKindByMetric.has(`${m}:ban`)) metricUpstreamKindByMetric.set(`${m}:ban`, String(err.banUntilMs));
  }

  const touchAttempt = (...metrics) => {
    for (const m of metrics) attemptedMetrics.add(m);
  };

  const maxTs = env && env.DB ? await readDerivativeGroupedMaxTsForSymbol(env, normalizedSymbol) : {};
  /** @type {Record<string, object>} */
  let mh =
    env && env.DB ? await readDerivativeMetricHealthMap(env, normalizedSymbol)
      : {};
  const taskRunnableNow = (taskKey) =>
    derivativeTaskRunnable(mh, taskKey, Date.now(), derivativeSyncOpts.force, { maxTsByMetric: maxTs });
  /** 是否进入 Binance hourly 聚合（健康表冷却 + ping + 网关）。 */
  const hourlyGateProbe = fg.includeHourly && env && env.DB ? await derivativeBinanceHourlyUpstreamBlocked(env, derivativeSyncOpts)
    : { blocked: false };
  const hourlyBinanceBlockedEffective = !!(hourlyGateProbe && hourlyGateProbe.blocked);
  let customPingFail = false;
  if (
    fg.includeHourly &&
    parseCustomFapiOrigin(env && env.BINANCE_FAPI_ORIGIN) &&
    !hourlyBinanceBlockedEffective &&
    !derivativeSyncOpts.force
  ) {
    const pw = await derivativeWarmBinanceCustomPing(env);
    if (!pw.skipped && !pw.ok) customPingFail = true;
  }
  syncPlanExtras = {
    ...syncPlanExtras,
    hourlyBinanceUpstreamBlockedFlag: hourlyBinanceBlockedEffective,
    customPingFail,
    hourlyUntilIso:
      hourlyBinanceBlockedEffective && hourlyGateProbe && hourlyGateProbe.untilMs ? new Date(hourlyGateProbe.untilMs).toISOString() : null,
  };

  /** heavyOnly：仅 DERIV_CORE_BINANCE_HEAVY；否则全量 hourly 聚合。*/
  const heavyOnlyMode = !!(fg.hourlyHeavyOnlySet && fg.hourlyHeavyOnlySet.size);

  function allowHourlyHistoricalFetch(datasetMetricKey) {
    if (!fg.includeHourly) return false;
    if (hourlyBinanceBlockedEffective && !derivativeSyncOpts.force) return false;
    if (customPingFail && !derivativeSyncOpts.force) return false;
    if (!hourlySubsetAllows(fg, datasetMetricKey)) return false;
    if (heavyOnlyMode && !(DERIV_CORE_BINANCE_HEAVY_SET.has(datasetMetricKey))) return false;
    return true;
  }

  /** --- fast snaps --- */
  let fastFundingSnapOk = false;
  let fastOiSnapOk = false;

  async function finalizeTaskOk(symbolArg, tk) {
    await finalizeDerivativeMetricTaskHealth(env, symbolArg, tk, { ok: true, kind: "" });
  }
  async function finalizeTaskFail(symbolArg, tk, e) {
    await finalizeDerivativeMetricTaskHealth(env, symbolArg, tk, {
      ok: false,
      kind:
        e && typeof e.errorKind === "string" && e.errorKind !== ""
          ? e.errorKind
          : classifyGenericHttp(0, e && e.message ? e.message : String(e)),
      shortErr: String(e && e.message ? e.message : e || "").slice(0, 180),
      banUntilMs: e && e.banUntilMs != null ? Number(e.banUntilMs) : null,
    });
  }

  if (fg.includeFast) {
    const kFundingSnap = derivativeTaskHealthKey("funding_binance", "snap");
    const runnableFu = taskRunnableNow(kFundingSnap).ok || derivativeSyncOpts.force;
    if (runnableFu) {
      touchAttempt("funding_binance");
      try {
        const got = await fetchBinanceFapiJson(env, "/fapi/v1/premiumIndex", { symbol: normalizedSymbol }, "DerivativePremiumIndex", derivativeSyncOpts);
        if (!got.ok) throw buildBinanceErrorFromFetchBinanceGot(got);
        const row =
          Array.isArray(got.data) ? got.data.find((x) => String(x.symbol).toUpperCase() === normalizedSymbol) : got.data;
        points.push(
          derivativePoint(normalizedSymbol, "funding_binance", row.time || now, Number(row.lastFundingRate), "binance-premiumIndex", {
            markPrice: Number(row.markPrice),
            nextFundingTime: Number(row.nextFundingTime),
          })
        );
        fastFundingSnapOk = true;
        await finalizeTaskOk(normalizedSymbol, kFundingSnap);
      } catch (e) {
        bumpDerivativeMetric("funding_binance", e);
        await finalizeTaskFail(normalizedSymbol, kFundingSnap, e);
      }
    }

    const kOiSnap = derivativeTaskHealthKey("oi_binance", "snap");
    const runnableOi = taskRunnableNow(kOiSnap).ok || derivativeSyncOpts.force;
    if (runnableOi) {
      touchAttempt("oi_binance");
      try {
        const got = await fetchBinanceFapiJson(env, "/fapi/v1/openInterest", { symbol: normalizedSymbol }, "DerivativeOpenInterest", derivativeSyncOpts);
        if (!got.ok) throw buildBinanceErrorFromFetchBinanceGot(got);
        points.push(derivativePoint(normalizedSymbol, "oi_binance", got.data.time || now, Number(got.data.openInterest), "binance-openInterest", {}));
        fastOiSnapOk = true;
        await finalizeTaskOk(normalizedSymbol, kOiSnap);
      } catch (e) {
        bumpDerivativeMetric("oi_binance", e);
        await finalizeTaskFail(normalizedSymbol, kOiSnap, e);
      }
    }
  }

  /** Bybit Funding/OI 兜底 */
  if (fg.includeFast && !opts.disableBybitLinearFallback && (!fastFundingSnapOk || !fastOiSnapOk)) {
    const restrictive =
      [...metricUpstreamKindByMetric.values()].some((x) => x === "geo_restricted" || x === "blacklisted_ip") ||
      [...firstErrorByMetric.values()].some((msg) => /restricted location|according to[^\n]{0,40}eligibility|451/u.test(msg));
    if (restrictive) {
      try {
        const wb = await fetchBybitLinearTickerSnapshot(normalizedSymbol);
        if (wb.ok) {
          await finalizeDerivativeUpstreamHealth(env, "bybit_public_linear_fallback", {
            ok: true,
            errorKind: "",
            error: "",
            extraPatch: { symbol: normalizedSymbol, note: "linear_tickers_snap" },
          });
          if (!fastFundingSnapOk && Number.isFinite(wb.fundingRate)) {
            points.push(
              derivativePoint(normalizedSymbol, "funding_binance", wb.nextFundingTime || now, wb.fundingRate, "bybit-linear-tickers-snapshot", {
                markPrice: Number.isFinite(wb.markPrice) ? wb.markPrice : null,
                nextFundingTime: wb.nextFundingTime || null,
              })
            );
            firstErrorByMetric.delete("funding_binance");
            metricUpstreamKindByMetric.delete("funding_binance");
            metricUpstreamKindByMetric.delete("funding_binance:ban");
            fastFundingSnapOk = true;
          }
          if (!fastOiSnapOk && Number.isFinite(wb.openInterest)) {
            points.push(
              derivativePoint(normalizedSymbol, "oi_binance", now, wb.openInterest, "bybit-linear-tickers-snapshot", {
                failoverNote: "bybit_linear_openInterest_snapshot",
              })
            );
            firstErrorByMetric.delete("oi_binance");
            metricUpstreamKindByMetric.delete("oi_binance");
            metricUpstreamKindByMetric.delete("oi_binance:ban");
            fastOiSnapOk = true;
          }
          if (env && env.DB) {
            if (fastFundingSnapOk) await finalizeTaskOk(normalizedSymbol, derivativeTaskHealthKey("funding_binance", "snap"));
            if (fastOiSnapOk) await finalizeTaskOk(normalizedSymbol, derivativeTaskHealthKey("oi_binance", "snap"));
          }
        } else {
          await finalizeDerivativeUpstreamHealth(env, "bybit_public_linear_fallback", {
            ok: false,
            errorKind: classifyGenericHttp(wb.status, wb.error),
            error: String(wb.error || "bybit_fail").slice(0, 360),
            extraPatch: { symbol: normalizedSymbol },
          });
        }
      } catch (e) {
        await finalizeDerivativeUpstreamHealth(env, "bybit_public_linear_fallback", {
          ok: false,
          errorKind: "network",
          error: String(e && e.message ? e.message : e).slice(0, 380),
          extraPatch: { symbol: normalizedSymbol },
        });
      }
    }
  }

  /** --- hourly aggregates --- */
  if (allowHourlyHistoricalFetch("funding_binance") && !(heavyOnlyMode)) {
    const tk = derivativeTaskHealthKey("funding_binance", "hist");
    const gate = taskRunnableNow(tk);
    if (!gate.ok && !derivativeSyncOpts.force && !fg.backfillMode) {
      /* skip */
    } else {
      touchAttempt("funding_binance");
      try {
        const mx = maxTs["funding_binance"];
        const lim = hourlyHistoryPullLimit(now, mx, fg.backfillMode ? 1800000 : 3600000);
        const q = { symbol: normalizedSymbol, limit: String(lim > 499 ? 499 : lim) };
        const sts = hourlyHistoryStartTimeMs(mx, fg.backfillMode ? 6 * 3600000 : 2 * 3600000);
        if (sts) q.startTime = String(sts);
        const got = await fetchBinanceFapiJson(env, "/fapi/v1/fundingRate", q, "DerivativeFundingHistory", derivativeSyncOpts);
        if (!got.ok) throw buildBinanceErrorFromFetchBinanceGot(got);
        for (const row of Array.isArray(got.data) ? got.data : []) {
          points.push(
            derivativePoint(normalizedSymbol, "funding_binance", row.fundingTime, Number(row.fundingRate), "binance-fundingRate", {
              markPrice: Number(row.markPrice),
            })
          );
        }
        await finalizeTaskOk(normalizedSymbol, tk);
      } catch (e) {
        bumpDerivativeMetric("funding_binance", e);
        await finalizeTaskFail(normalizedSymbol, tk, e);
      }
    }
  }

  if (allowHourlyHistoricalFetch("oi_binance") && !(heavyOnlyMode)) {
    const tk = derivativeTaskHealthKey("oi_binance", "hist");
    const gate = taskRunnableNow(tk);
    if (!gate.ok && !derivativeSyncOpts.force && !fg.backfillMode) {
      /* skip */
    } else {
      touchAttempt("oi_binance");
      try {
        const mx = maxTs["oi_binance"];
        const lim = hourlyHistoryPullLimit(now, mx, fg.backfillMode ? 1800000 : 3600000);
        const q = { symbol: normalizedSymbol, period: "1h", limit: String(Math.min(lim, 499)) };
        const sts = hourlyHistoryStartTimeMs(mx, fg.backfillMode ? 6 * 3600000 : 2 * 3600000);
        if (sts) q.startTime = String(sts);
        const got = await fetchBinanceFapiJson(env, "/futures/data/openInterestHist", q, "DerivativeOpenInterestHist", derivativeSyncOpts);
        if (!got.ok) throw buildBinanceErrorFromFetchBinanceGot(got);
        for (const row of Array.isArray(got.data) ? got.data : []) {
          points.push(
            derivativePoint(normalizedSymbol, "oi_binance", row.timestamp, Number(row.sumOpenInterest), "binance-openInterestHist", {
              sumOpenInterestValue: Number(row.sumOpenInterestValue),
            })
          );
        }
        await finalizeTaskOk(normalizedSymbol, tk);
      } catch (e) {
        bumpDerivativeMetric("oi_binance", e);
        await finalizeTaskFail(normalizedSymbol, tk, e);
      }
    }
  }

  /** long/short、taker、basis、top */
  if (allowHourlyHistoricalFetch("long_short")) {
    touchAttempt("long_short");
    const tk = derivativeTaskHealthKey("long_short", "hist");
    try {
      if (!taskRunnableNow(tk).ok && !derivativeSyncOpts.force && !fg.backfillMode) throw new Error("__skip_window__");
      const mx = maxTs["long_short"];
      const lim = hourlyHistoryPullLimit(now, mx, fg.backfillMode ? 900000 : 3600000);
      const q = { symbol: normalizedSymbol, period: "1h", limit: String(Math.min(lim, 499)) };
      const sts = hourlyHistoryStartTimeMs(mx, fg.backfillMode ? 12 * 3600000 : 2 * 3600000);
      if (sts) q.startTime = String(sts);
      const got = await fetchBinanceFapiJson(env, "/futures/data/globalLongShortAccountRatio", q, "DerivativeLongShort", derivativeSyncOpts);
      if (!got.ok) throw buildBinanceErrorFromFetchBinanceGot(got);
      for (const row of Array.isArray(got.data) ? got.data : []) {
        points.push(
          derivativePoint(normalizedSymbol, "long_short", row.timestamp, Number(row.longShortRatio), "binance-longShort", {
            longAccount: Number(row.longAccount),
            shortAccount: Number(row.shortAccount),
          })
        );
      }
      await finalizeTaskOk(normalizedSymbol, tk);
    } catch (e) {
      if (String(e && e.message) === "__skip_window__") {
        /* no-op */
      } else {
        bumpDerivativeMetric("long_short", e);
        await finalizeTaskFail(normalizedSymbol, tk, e);
      }
    }
  }

  if (allowHourlyHistoricalFetch("taker_buy_sell")) {
    touchAttempt("taker_buy_sell");
    const tk = derivativeTaskHealthKey("taker_buy_sell", "hist");
    try {
      if (!taskRunnableNow(tk).ok && !derivativeSyncOpts.force && !fg.backfillMode) throw new Error("__skip_window__");
      const mx = maxTs["taker_buy_sell"];
      const lim = hourlyHistoryPullLimit(now, mx, fg.backfillMode ? 900000 : 3600000);
      const q = { symbol: normalizedSymbol, period: "1h", limit: String(Math.min(lim, 499)) };
      const sts = hourlyHistoryStartTimeMs(mx, fg.backfillMode ? 12 * 3600000 : 2 * 3600000);
      if (sts) q.startTime = String(sts);
      const got = await fetchBinanceFapiJson(env, "/futures/data/takerlongshortRatio", q, "DerivativeTakerBuySell", derivativeSyncOpts);
      if (!got.ok) throw buildBinanceErrorFromFetchBinanceGot(got);
      for (const row of Array.isArray(got.data) ? got.data : []) {
        points.push(
          derivativePoint(normalizedSymbol, "taker_buy_sell", row.timestamp, Number(row.buySellRatio), "binance-takerlongshortRatio", {
            buyVol: Number(row.buyVol),
            sellVol: Number(row.sellVol),
            buySellRatio: Number(row.buySellRatio),
          })
        );
      }
      await finalizeTaskOk(normalizedSymbol, tk);
    } catch (e) {
      if (String(e && e.message) === "__skip_window__") {
        /* no-op */
      } else {
        bumpDerivativeMetric("taker_buy_sell", e);
        await finalizeTaskFail(normalizedSymbol, tk, e);
      }
    }
  }

  if (allowHourlyHistoricalFetch("basis_perp")) {
    touchAttempt("basis_perp");
    const tk = derivativeTaskHealthKey("basis_perp", "hist");
    try {
      if (!taskRunnableNow(tk).ok && !derivativeSyncOpts.force && !fg.backfillMode) throw new Error("__skip_window__");
      const mx = maxTs["basis_perp"];
      const lim = hourlyHistoryPullLimit(now, mx, fg.backfillMode ? 900000 : 3600000);
      const q = { pair, contractType: "PERPETUAL", period: "1h", limit: String(Math.min(lim, 499)) };
      const sts = hourlyHistoryStartTimeMs(mx, fg.backfillMode ? 12 * 3600000 : 4 * 3600000);
      if (sts) {
        q.startTime = String(sts);
        q.endTime = String(now);
      }
      const got = await fetchBinanceFapiJson(env, "/futures/data/basis", q, "DerivativeBasisPerp", derivativeSyncOpts);
      if (!got.ok) throw buildBinanceErrorFromFetchBinanceGot(got);
      for (const row of Array.isArray(got.data) ? got.data : []) {
        points.push(
          derivativePoint(normalizedSymbol, "basis_perp", row.timestamp, Number(row.annualizedBasisRate ?? row.basisRate ?? row.basis), "binance-basis", {
            pair: row.pair || pair,
            contractType: row.contractType || "PERPETUAL",
            futuresPrice: Number(row.futuresPrice),
            indexPrice: Number(row.indexPrice),
            basis: Number(row.basis),
            basisRate: Number(row.basisRate),
            annualizedBasisRate: Number(row.annualizedBasisRate),
          })
        );
      }
      await finalizeTaskOk(normalizedSymbol, tk);
    } catch (e) {
      if (String(e && e.message) === "__skip_window__") {
        /* noop */
      } else {
        bumpDerivativeMetric("basis_perp", e);
        await finalizeTaskFail(normalizedSymbol, tk, e);
      }
    }
  }

  if (allowHourlyHistoricalFetch("basis_quarter")) {
    touchAttempt("basis_quarter");
    const tk = derivativeTaskHealthKey("basis_quarter", "hist");
    try {
      if (!taskRunnableNow(tk).ok && !derivativeSyncOpts.force && !fg.backfillMode) throw new Error("__skip_window__");
      const mx = maxTs["basis_quarter"];
      const lim = hourlyHistoryPullLimit(now, mx, fg.backfillMode ? 900000 : 3600000);
      const q = { pair, contractType: "CURRENT_QUARTER", period: "1h", limit: String(Math.min(lim, 499)) };
      const sts = hourlyHistoryStartTimeMs(mx, fg.backfillMode ? 12 * 3600000 : 4 * 3600000);
      if (sts) {
        q.startTime = String(sts);
        q.endTime = String(now);
      }
      const got = await fetchBinanceFapiJson(env, "/futures/data/basis", q, "DerivativeBasisQuarter", derivativeSyncOpts);
      if (!got.ok) throw buildBinanceErrorFromFetchBinanceGot(got);
      for (const row of Array.isArray(got.data) ? got.data : []) {
        points.push(
          derivativePoint(normalizedSymbol, "basis_quarter", row.timestamp, Number(row.annualizedBasisRate ?? row.basisRate ?? row.basis), "binance-basis", {
            pair: row.pair || pair,
            contractType: row.contractType || "CURRENT_QUARTER",
            futuresPrice: Number(row.futuresPrice),
            indexPrice: Number(row.indexPrice),
            basis: Number(row.basis),
            basisRate: Number(row.basisRate),
            annualizedBasisRate: Number(row.annualizedBasisRate),
          })
        );
      }
      await finalizeTaskOk(normalizedSymbol, tk);
    } catch (e) {
      if (String(e && e.message) === "__skip_window__") {
        /* noop */
      } else {
        bumpDerivativeMetric("basis_quarter", e);
        await finalizeTaskFail(normalizedSymbol, tk, e);
      }
    }
  }

  if (allowHourlyHistoricalFetch("top_account_long_short")) {
    touchAttempt("top_account_long_short");
    const tk = derivativeTaskHealthKey("top_account_long_short", "hist");
    try {
      if (!taskRunnableNow(tk).ok && !derivativeSyncOpts.force && !fg.backfillMode) throw new Error("__skip_window__");
      const mx = maxTs["top_account_long_short"];
      const lim = hourlyHistoryPullLimit(now, mx, fg.backfillMode ? 900000 : 3600000);
      const q = { symbol: normalizedSymbol, period: "1h", limit: String(Math.min(lim, 499)) };
      const sts = hourlyHistoryStartTimeMs(mx, fg.backfillMode ? 18 * 3600000 : 4 * 3600000);
      if (sts) q.startTime = String(sts);
      const got = await fetchBinanceFapiJson(env, "/futures/data/topLongShortAccountRatio", q, "DerivativeTopAccountLongShort", derivativeSyncOpts);
      if (!got.ok) throw buildBinanceErrorFromFetchBinanceGot(got);
      for (const row of Array.isArray(got.data) ? got.data : []) {
        points.push(
          derivativePoint(normalizedSymbol, "top_account_long_short", row.timestamp, Number(row.longShortRatio), "binance-topLongShortAccountRatio", {
            longAccount: Number(row.longAccount),
            shortAccount: Number(row.shortAccount),
          })
        );
      }
      await finalizeTaskOk(normalizedSymbol, tk);
    } catch (e) {
      if (String(e && e.message) === "__skip_window__") {
        /* noop */
      } else {
        bumpDerivativeMetric("top_account_long_short", e);
        await finalizeTaskFail(normalizedSymbol, tk, e);
      }
    }
  }

  if (allowHourlyHistoricalFetch("top_position_long_short")) {
    touchAttempt("top_position_long_short");
    const tk = derivativeTaskHealthKey("top_position_long_short", "hist");
    try {
      if (!taskRunnableNow(tk).ok && !derivativeSyncOpts.force && !fg.backfillMode) throw new Error("__skip_window__");
      const mx = maxTs["top_position_long_short"];
      const lim = hourlyHistoryPullLimit(now, mx, fg.backfillMode ? 900000 : 3600000);
      const q = { symbol: normalizedSymbol, period: "1h", limit: String(Math.min(lim, 499)) };
      const sts = hourlyHistoryStartTimeMs(mx, fg.backfillMode ? 18 * 3600000 : 4 * 3600000);
      if (sts) q.startTime = String(sts);
      const got = await fetchBinanceFapiJson(env, "/futures/data/topLongShortPositionRatio", q, "DerivativeTopPositionLongShort", derivativeSyncOpts);
      if (!got.ok) throw buildBinanceErrorFromFetchBinanceGot(got);
      for (const row of Array.isArray(got.data) ? got.data : []) {
        points.push(
          derivativePoint(normalizedSymbol, "top_position_long_short", row.timestamp, Number(row.longShortRatio), "binance-topLongShortPositionRatio", {
            longAccount: Number(row.longAccount),
            shortAccount: Number(row.shortAccount),
          })
        );
      }
      await finalizeTaskOk(normalizedSymbol, tk);
    } catch (e) {
      if (String(e && e.message) === "__skip_window__") {
        /* noop */
      } else {
        bumpDerivativeMetric("top_position_long_short", e);
        await finalizeTaskFail(normalizedSymbol, tk, e);
      }
    }
  }

  /** --- Macro Yahoo --- */
  if (fg.includeMacro && env && env.DB) {
    mh = await readDerivativeMetricHealthMap(env, normalizedSymbol);
    touchAttempt("vix", "vix3m", "move");

    const runMacro = async (ticker, canon, range, iv) => {
      const tkMacro = derivativeTaskHealthKey(canon, "macro");
      const runnable = taskRunnableNow(tkMacro).ok || derivativeSyncOpts.force || fg.backfillMode;
      if (!runnable) return;
      try {
        const vy = await fetchYahooChart(ticker, range, iv, env);
        for (const row of vy) points.push(derivativePoint(normalizedSymbol, canon, row.t, row.value, "yahoo-chart-side-channel", { ticker, unofficial: true }));
        await finalizeTaskOk(normalizedSymbol, tkMacro);
      } catch (e) {
        bumpDerivativeMetric(canon, e);
        await finalizeTaskFail(normalizedSymbol, tkMacro, e);
      }
    };

    await runMacro("^VIX", "vix", "1mo", "1h");
    await runMacro("^VIX3M", "vix3m", "1mo", "1h");
    await runMacro("^MOVE", "move", "1mo", "1d");
  }

  const persisted = await persistDerivativePoints(env, points);
  const countByMetric = {};
  for (const point of points.filter(Boolean)) countByMetric[point.metric] = (countByMetric[point.metric] || 0) + 1;
  const attemptedArr = [...attemptedMetrics];
  const failedMetricsList = attemptedArr.filter((m) => (countByMetric[m] || 0) === 0);

  const errorListForReturn = [...firstErrorByMetric.entries()].slice(0, 12).map(([metric, error]) => ({
    metric,
    error,
    kind: metricUpstreamKindByMetric.get(metric) || "",
  }));

  for (const metric of DERIVATIVE_METRICS) {
    if (!attemptedMetrics.has(metric)) continue;
    await updateDerivativeSyncStatus(env, normalizedSymbol, metric, {
      ok: (countByMetric[metric] || 0) > 0,
      count: countByMetric[metric] || 0,
      error: firstErrorByMetric.get(metric) || "",
    });
  }

  let sourceHealthSnapshot = [];
  try {
    sourceHealthSnapshot = await readDerivativeSourceHealthAllSafe(env);
  } catch (_) {
    sourceHealthSnapshot = [];
  }

  const partial = attemptedArr.length > 0 && failedMetricsList.length > 0 && failedMetricsList.length < attemptedArr.length;

  syncPlanExtras = {
    ...syncPlanExtras,
    syncPlanSummary: buildDerivativeSyncPlanSummary({
      fg,
      manualBlockingFastOnlySkipped: !!(syncPlanExtras && syncPlanExtras.manualSkippedFreshFast),
      hourlyBinanceUpstreamBlockedFlag: !!hourlyBinanceBlockedEffective,
      customPingFailed: !!customPingFail,
    }),
  };

  const endMs = Date.now();
  if (env && env.DB) {
    try {
      await env.DB.prepare(
        `INSERT INTO derivative_sync_runs (run_id, symbol, trigger, groups_json, started_at_ms, ended_at_ms, duration_ms, written_json, failed_json, ok, extra_json)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`
      ).bind(
        syncRunId,
        normalizedSymbol,
        interaction || (opts.background ? "background" : "api"),
        JSON.stringify({
          resolvedGroups: fg,
          requestedGroupsRaw: opts.groups || "all",
        }).slice(0, 2900),
        Math.round(syncRunStarted),
        Math.round(endMs),
        Math.round(endMs - syncRunStarted),
        JSON.stringify(countByMetric || {}).slice(0, 3800),
        JSON.stringify((failedMetricsList || []).slice(0, 32)).slice(0, 1200),
        firstErrorByMetric.size === 0 || points.length > 0 ? 1 : 0,
        JSON.stringify(syncPlanExtras || {}).slice(0, 2900)
      ).run();
    } catch (_) {
      /** 表缺失时忽略 */
    }
  }

  if (lockHeld) await releaseDerivativeSyncLock(env, lockKey, lockOwner);

  return {
    ok: firstErrorByMetric.size === 0 || points.length > 0,
    partial,
    symbol: normalizedSymbol,
    written: persisted.written,
    writtenByMetric: countByMetric,
    pruned: persisted.pruned,
    errors: errorListForReturn,
    attemptedMetrics: attemptedArr,
    failedMetrics: failedMetricsList,
    metricErrorKinds: [...metricUpstreamKindByMetric.entries()].slice(0, 28).map(([metric, kind]) => ({ metric, kind })),
    sourceHealthSnapshot: sourceHealthSnapshot.slice(0, 16),
    binanceOriginMode: binanceUpstreamMode(env),
    workerBuild: WORKER_BUILD,
    background: !!opts.background,
    groups: fg,
    forceApplied: !!derivativeSyncOpts.force,
    runId: syncRunId,
    syncPlanSummary: syncPlanExtras.syncPlanSummary,
    hourlyBinanceUpstreamBlocked: !!(syncPlanExtras && syncPlanExtras.hourlyBinanceUpstreamBlockedFlag),
    customOriginPingBlockedHourly: !!(syncPlanExtras && syncPlanExtras.customPingFail),
    hourlyUpstreamUntilIso: syncPlanExtras && syncPlanExtras.hourlyUntilIso ? syncPlanExtras.hourlyUntilIso : null,
    skippedBecause: syncPlanExtras && syncPlanExtras.skippedBecause ? syncPlanExtras.skippedBecause : undefined,
    queuedOrSkipped: syncPlanExtras && syncPlanExtras.queuedOrSkipped ? syncPlanExtras.queuedOrSkipped : undefined,
  };
}


const DERIVATIVE_METRIC_HEALTH_LABEL_ZH = {
  funding_binance: "Funding",
  oi_binance: "未平仓(OI)",
  long_short: "全市场多空比",
  taker_buy_sell: "主动买卖比",
  basis_perp: "永续基差",
  basis_quarter: "季度基差",
  top_account_long_short: "大户账户多空",
  top_position_long_short: "大户持仓多空",
  vix: "VIX(宏观)",
  vix3m: "VIX3M(宏观)",
  move: "MOVE(宏观)",
};

function extractBanUntilMsFromSourceHealthRows(rows, preferredSources) {
  const pref = [...(preferredSources || [])];
  for (const pk of pref) {
    const row = (rows || []).find((r) => String(r.source) === String(pk));
    if (!row) continue;
    let extra = {};
    try {
      extra = row.extra_json ? JSON.parse(String(row.extra_json)) : {};
    } catch (_) {
      extra = {};
    }
    const b = Number(extra.binanceBanUntilMs);
    if (Number.isFinite(b) && b > Date.now() - 86400000) return b;
  }
  return null;
}

/** 结构化「按指标的健康视图」：供前端与 LLM（不改变 series 语义）。*/
function buildDerivativeMetricHealthPresentation({
  canonicalSymbol,
  nowMs,
  freshnessByMetric,
  mhMap,
  upstreamRows,
  originModeLabel,
}) {
  const sym = String(canonicalSymbol || DEFAULT_SYMBOL).toUpperCase();
  const fm = freshnessByMetric && typeof freshnessByMetric === "object" ? freshnessByMetric : {};
  const mh = mhMap && typeof mhMap === "object" ? mhMap : {};
  const rows = upstreamRows || [];
  const upstreamBanMs = extractBanUntilMsFromSourceHealthRows(rows, originModeLabel === "custom"
    ? ["binance_custom_origin", "binance_direct"]
    : ["binance_direct", "binance_custom_origin"]);

  /** @type {Array<object>} */
  const out = [];
  for (const metric of DERIVATIVE_METRICS) {
    const fr = fm[String(metric)] || {};
    let nextAttemptAfterMs = 0;
    let taskKindWorst = "";
    let taskErrWorst = "";
    const pref = `${String(metric)}#`;
    for (const [taskKey, r] of Object.entries(mh)) {
      if (!(String(taskKey) === String(metric) || String(taskKey).startsWith(pref))) continue;
      const na = Number(r && r.next_allowed_at_ms) || 0;
      if (na > nextAttemptAfterMs) nextAttemptAfterMs = na;
      const kk = String(r.last_error_kind || "");
      const er = String(r.last_error || "");
      if (kk && kk.length >= taskKindWorst.length) {
        taskKindWorst = kk;
        taskErrWorst = er;
      }
    }

    let actionHintZh = "";
    const isMacroMetric = DERIV_MACRO_METRICS_SET.has(String(metric));
    if (isMacroMetric) actionHintZh += "[宏观旁路] 独立于核心 Funding/OI/Binance 判定；使用 Yahoo 低频拉取，不参与 sourceOk。";
    if (nextAttemptAfterMs > nowMs) {
      actionHintZh += `[调度冷却] 「${DERIVATIVE_METRIC_HEALTH_LABEL_ZH[metric] || metric}」任务至 ${new Date(nextAttemptAfterMs).toISOString()} 前可能不再触发同一口径请求；仍可读 D1 缓存。`;
    }
    if (!isMacroMetric && taskKindWorst === "geo_restricted" && originModeLabel === "direct") {
      actionHintZh += "[出口] Binance direct 可能被地域拦截；可考虑为 Worker 配置「BINANCE_FAPI_ORIGIN」自有反代并仅透传 /fapi 路径、不重写字段、不做过期缓存。";
    }
    if (!isMacroMetric && (taskKindWorst === "blacklisted_ip" || taskKindWorst === "rate_limited")) {
      actionHintZh += `[限流/IP] kind=${taskKindWorst}${taskErrWorst ? `：` + taskErrWorst.slice(0, 140) : ""}`;
      const banIso =
        upstreamBanMs && Number(upstreamBanMs) > Date.now()
          ? new Date(Number(upstreamBanMs)).toISOString()
          : null;
      if (banIso) actionHintZh += `[封禁预估至] ${banIso}（取自 sourceHealth.extra_json.binanceBanUntilMs）。`;
    }

    const ageMin = Number.isFinite(Number(fr.staleMs)) ? Math.round(Number(fr.staleMs) / 60000) : null;
    const needMin = Number.isFinite(Number(fr.staleLimitMs)) ? Math.round(Number(fr.staleLimitMs) / 60000) : null;
    let reasonZh = "--";
    if (fr.level === "missing") reasonZh = "无 D1 点或区间内缺失";
    else if (fr.level === "stale") reasonZh = `偏旧～${ageMin != null ? `${ageMin} 分钟（容忍约 ${needMin ?? "--"} 分钟）` : "未知"}`;
    else reasonZh = "在容忍窗口内";
    reasonZh += actionHintZh ? `；${actionHintZh}` : "";

    out.push({
      metric: String(metric),
      metricLabelZh: DERIVATIVE_METRIC_HEALTH_LABEL_ZH[String(metric)] || String(metric),
      symbol: sym,
      level: fr.level || "missing",
      latestT: fr.latestT == null ? null : Number(fr.latestT),
      source: fr.source || "",
      ageMinutes: ageMin,
      requiredFreshMinutes: needMin,
      nextAttemptAfterIso: nextAttemptAfterMs > nowMs ? new Date(nextAttemptAfterMs).toISOString() : null,
      lastTaskErrorKind: taskKindWorst || null,
      lastTaskErrorShort: taskErrWorst ? taskErrWorst.slice(0, 260) : null,
      actionHintZh,
      reasonZh,
    });
  }
  return out;
}

function buildDerivativeStaleReasonLines(metricHealthPresentation) {
  const arr = Array.isArray(metricHealthPresentation) ? metricHealthPresentation : [];
  const lines = [];
  for (const row of arr) {
    if (row.level === "stale" || row.level === "missing") lines.push(`${row.metricLabelZh}（${row.metric}）：${row.reasonZh}`);
  }
  return lines.slice(0, 16);
}

function derivativeCoreStaleKeysFromFreshness(dataFreshness) {
  const fm =
    dataFreshness && dataFreshness.freshnessByMetric && typeof dataFreshness.freshnessByMetric === "object"
      ? dataFreshness.freshnessByMetric
      : {};
  return DERIVATIVE_METRICS.filter((key) => {
    if (DERIV_MACRO_METRICS_SET.has(key)) return false;
    const row = fm[key] || {};
    return row.level === "stale" || row.level === "missing";
  });
}

function derivativeSyncGroupForStaleCoreKeys(keys) {
  const arr = Array.isArray(keys) ? keys.map(String).filter(Boolean) : [];
  if (!arr.length) return "";
  if (arr.every((key) => DERIV_CORE_BINANCE_HEAVY_SET.has(key))) return "core-proprietary";
  return "core";
}

function buildDerivativeSyntheticFreshnessByMetric(nowMs, countRowsForSym) {
  const fm = {};
  const cmap = {};
  for (const r of countRowsForSym || []) cmap[String(r.metric)] = r;
  for (const key of DERIVATIVE_METRICS) {
    const r = cmap[key];
    const mxRaw = r && r.maxT != null ? Number(r.maxT) : null;
    if (!Number.isFinite(mxRaw)) {
      fm[key] = {
        latestT: null,
        staleMs: null,
        staleLimitMs: derivativeStaleLimitWorker(key),
        level: "missing",
        source: "",
        points: r && Number(r.cnt) ? Number(r.cnt) : 0,
      };
      continue;
    }
    const staleMs = Math.max(0, nowMs - mxRaw);
    const limitMs = derivativeStaleLimitWorker(key);
    const level = staleMs > limitMs ? "stale" : "ok";
    fm[key] = {
      latestT: mxRaw,
      latestTime: new Date(mxRaw).toISOString(),
      staleMs,
      staleLimitMs: limitMs,
      level,
      source: "",
      points: r && Number(r.cnt) ? Number(r.cnt) : 0,
    };
  }
  return fm;
}

async function handleDerivativesOriginProbe(_request, env) {
  try {
    const ping = await pingBinanceFapiEndpoints(env, "OriginProbe");
    const src = await readDerivativeSourceHealthAllSafe(env);
    return json(
      {
        workerBuild: WORKER_BUILD,
        binanceOriginMode: binanceUpstreamMode(env),
        ping,
        derivativeSourceHealth: (src || []).slice(0, 24),
      },
      200,
      { "Cache-Control": "no-store" },
    );
  } catch (e) {
    return json({ error: String(e && e.message ? e.message : e) }, 500);
  }
}

async function readDerivativesPayload(env, symbol, range) {
  const normalizedSymbol = String(symbol || DEFAULT_SYMBOL).toUpperCase();
  const since = Date.now() - rangeToMs(range);
  const { results } = await env.DB.prepare(
    "SELECT symbol, metric, t, value, source, extra_json FROM derivative_timeseries WHERE symbol = ?1 AND t >= ?2 ORDER BY metric, t ASC"
  ).bind(normalizedSymbol, since).all();
  const series = {};
  for (const row of results || []) {
    if (!DERIVATIVE_METRICS.includes(row.metric)) continue;
    if (!series[row.metric]) series[row.metric] = [];
    series[row.metric].push(compactDerivativeSeriesRow(row));
  }

  const priceOut = await fetchLatestKlinePriceChange(env, normalizedSymbol);
  const priceChangeRaw = priceOut && priceOut.priceChange24hPct;
  const generatedAtIso = new Date().toISOString();
  const nowMs = Date.parse(generatedAtIso);
  const dataFreshnessCore = buildPayloadFreshnessFromSeries(series, Number.isFinite(nowMs) ? nowMs : Date.now());

  let stablecoinContext = null;
  try {
    stablecoinContext = await readOnchainPayload(env, ONCHAIN_GLOBAL_SCOPE, "90d");
  } catch (e) {
    stablecoinContext = {
      scope: ONCHAIN_GLOBAL_SCOPE,
      range: "90d",
      generatedAt: new Date().toISOString(),
      dataSource: { primary: "cloudflare-d1-onchain", endpoints: [] },
      reliability: ONCHAIN_RELIABILITY,
      llmGuidance: {
        weight: ONCHAIN_RELIABILITY.weight,
        confidence: ONCHAIN_RELIABILITY.confidence,
        policy: ONCHAIN_RELIABILITY.llmPolicy,
      },
      series: {},
      dataFreshness: {
        latestT: null,
        latestTime: null,
        staleMs: null,
        sourceOk: false,
        warnings: [`稳定币背景读取失败：${e && e.message ? e.message : String(e)}`],
      },
    };
  }

  const upstreamSnap = await readDerivativeSourceHealthAllSafe(env);
  let mhCompoundMap = {};
  try {
    mhCompoundMap = await readDerivativeMetricHealthMap(env, normalizedSymbol);
  } catch (_) {
    mhCompoundMap = {};
  }

  const originLbl = binanceUpstreamMode(env) === "custom" ? "custom" : "direct";
  const metricHealth = buildDerivativeMetricHealthPresentation({
    canonicalSymbol: normalizedSymbol,
    nowMs: Number.isFinite(nowMs) ? nowMs : Date.now(),
    freshnessByMetric: dataFreshnessCore && dataFreshnessCore.freshnessByMetric ? dataFreshnessCore.freshnessByMetric : {},
    mhMap: mhCompoundMap,
    upstreamRows: upstreamSnap,
    originModeLabel: originLbl,
  });
  const stalenessReasonLines = buildDerivativeStaleReasonLines(metricHealth);
  const syncUpstreamWarnings = [];
  for (const row of upstreamSnap) {
    const cdState = derivativeSourceCooldownState(row, Date.now());
    if (cdState.blocked) {
      syncUpstreamWarnings.push(
        `[${row.source}] 上游冷却至 ${new Date(cdState.untilMs).toISOString()}：` +
          `${String(row.last_error_kind || "")}${row.last_error ? ` · ${String(row.last_error).slice(0, 140)}` : ""}`
      );
    }
  }

  /** 不改变 dataFreshness.sourceOk：仅附带诊断信息供前端 / LLM */
  let dataFreshOut = dataFreshnessCore;
  if (syncUpstreamWarnings.length && dataFreshOut && Array.isArray(dataFreshOut.warnings)) {
    dataFreshOut = {
      ...dataFreshOut,
      warnings: [...syncUpstreamWarnings.slice(0, 4), ...(dataFreshOut.warnings || [])],
    };
  }
  if (stalenessReasonLines.length && dataFreshOut && Array.isArray(dataFreshOut.warnings)) {
    const mhLines = stalenessReasonLines.slice(0, 6).map((l) => `[按指标观测] ${l}`);
    dataFreshOut = {
      ...dataFreshOut,
      warnings: [...mhLines, ...(dataFreshOut.warnings || [])],
    };
  }

  return {
    symbol: normalizedSymbol,
    range: range || "30d",
    generatedAt: generatedAtIso,
    dataSource: {
      primary: "cloudflare-d1-derivatives",
      endpoints: [
        "Binance USD-M public market data",
        "Bybit Linear public ticker (Funding/OI fail-over only)",
        "Yahoo chart side-channel for VIX/MOVE",
      ],
    },
    series,
    stablecoinContext,
    optionSurface: [],
    priceChange24hPct: priceChangeRaw == null ? null : roundNum(priceChangeRaw, 2),
    priceChange24hMeta: priceOut && priceOut.priceChange24hMeta ? priceOut.priceChange24hMeta : null,
    dataFreshness: dataFreshOut || dataFreshnessCore,
    metricHealth,
    stalenessReasons: stalenessReasonLines,
    sourceHealth: upstreamSnap,
    syncHints: {
      workerBuild: WORKER_BUILD,
      binanceOriginMode: binanceUpstreamMode(env),
      metricHealthStaleSignals: stalenessReasonLines.length,
      staleCoreMetrics: derivativeCoreStaleKeysFromFreshness(dataFreshOut || dataFreshnessCore),
      suggestedSyncGroup: derivativeSyncGroupForStaleCoreKeys(derivativeCoreStaleKeysFromFreshness(dataFreshOut || dataFreshnessCore)),
    },
  };
}

async function handleReadDerivatives(_request, env, url, ctx) {
  if (!env.DB) return json({ error: "D1 binding missing" }, 500);
  const symbol = String(url.searchParams.get("symbol") || DEFAULT_SYMBOL).toUpperCase();
  const range = String(url.searchParams.get("range") || "30d");
  const sync = String(url.searchParams.get("sync") || "auto").toLowerCase();
  let syncResult = null;
  const payload = await readDerivativesPayload(env, symbol, range);
  if (sync === "1" || sync === "true") {
    syncResult = await syncDerivativesOne(env, symbol, { interaction: "read_blocking", groups: "core" });
    const freshPayload = await readDerivativesPayload(env, symbol, range);
    return json({ ...freshPayload, syncResult }, 200, {
      "Cache-Control": "no-store",
      "X-Data-Source": "cloudflare-d1-derivatives",
    });
  }
  if (sync !== "0" && sync !== "false" && sync !== "off") {
    const staleCore = derivativeCoreStaleKeysFromFreshness(payload.dataFreshness);
    const groups = derivativeSyncGroupForStaleCoreKeys(staleCore);
    if (groups) {
      const run = () => syncDerivativesOne(env, symbol, {
        background: true,
        interaction: "read_auto",
        groups,
      });
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(run());
      else syncResult = await run();
      payload.syncHints = {
        ...(payload.syncHints || {}),
        autoRepairQueued: true,
        autoRepairGroup: groups,
        staleCoreMetrics: staleCore,
      };
      syncResult = syncResult || { ok: true, queued: true, groups, staleCoreMetrics: staleCore };
    }
  }
  return json({ ...payload, syncResult }, 200, {
    "Cache-Control": publicCacheHeader(syncResult ? 0 : DERIVATIVE_READ_CACHE_SECONDS, 60),
    "X-Data-Source": "cloudflare-d1-derivatives",
  });
}

async function handleManualDerivativesSync(_request, env, url, ctx) {
  if (!env.DB) return json({ error: "D1 binding missing" }, 500);
  const symbol = String(url.searchParams.get("symbol") || DEFAULT_SYMBOL).toUpperCase();
  const wait = String(url.searchParams.get("wait") || "1") !== "0";
  const groupsParam = String(url.searchParams.get("groups") || "all").toLowerCase();
  const force = String(url.searchParams.get("force") || "0").trim() === "1";
  const opts = { groups: groupsParam, force, interaction: wait ? "manual_blocking" : "manual_async" };
  const run = () => syncDerivativesOne(env, symbol, opts);
  if (!wait && ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(run());
    return json(
      { ok: true, queued: true, symbol, groups: groupsParam, force },
      202,
      { "Cache-Control": "no-store" }
    );
  }
  return json(await run(), 200, { "Cache-Control": "no-store" });
}

async function handleDerivativesStatus(_request, env) {
  if (!env.DB) return json({ error: "D1 binding missing" }, 500);
  const symUpper = String(DEFAULT_SYMBOL).toUpperCase();
  const nowDiag = Date.now();
  const { results: countsRaw } = await env.DB.prepare(
    "SELECT symbol, metric, COUNT(*) AS cnt, MIN(t) AS minT, MAX(t) AS maxT FROM derivative_timeseries GROUP BY symbol, metric"
  ).all();
  const { results: statusRaw } = await env.DB.prepare(
    "SELECT symbol, metric, last_run, last_count, last_ok, last_error FROM derivative_sync_status ORDER BY symbol, metric"
  ).all();
  const sourceHealth = await readDerivativeSourceHealthAllSafe(env);

  const countsForSym = (countsRaw || []).filter(
    (row) =>
      DERIVATIVE_METRICS.includes(row.metric) && String(row.symbol || "").toUpperCase() === symUpper
  );
  const statusForSym = (statusRaw || []).filter(
    (row) =>
      DERIVATIVE_METRICS.includes(row.metric) && String(row.symbol || "").toUpperCase() === symUpper
  );
  let mhCompoundMapStatus = {};
  try {
    mhCompoundMapStatus = await readDerivativeMetricHealthMap(env, symUpper);
  } catch (_) {
    mhCompoundMapStatus = {};
  }
  const originLbl = binanceUpstreamMode(env) === "custom" ? "custom" : "direct";
  const freshnessSym = buildDerivativeSyntheticFreshnessByMetric(nowDiag, countsForSym);
  const metricHealth = buildDerivativeMetricHealthPresentation({
    canonicalSymbol: symUpper,
    nowMs: nowDiag,
    freshnessByMetric: freshnessSym,
    mhMap: mhCompoundMapStatus,
    upstreamRows: sourceHealth,
    originModeLabel: originLbl,
  });
  const stalenessReasons = buildDerivativeStaleReasonLines(metricHealth);

  return json({
    retentionDays: 30,
    metrics: DERIVATIVE_METRICS,
    counts: countsForSym,
    status: statusForSym,
    sourceHealth,
    metricHealth,
    stalenessReasons,
    workerBuild: WORKER_BUILD,
    binanceOriginMode: binanceUpstreamMode(env),
  }, 200, { "Cache-Control": "no-store" });
}

async function handleDerivativesSnapshot(_request, env, url) {
  if (!env.DB) return json({ error: "D1 binding missing" }, 500);
  const symbol = String(url.searchParams.get("symbol") || DEFAULT_SYMBOL).toUpperCase();
  const profile = String(url.searchParams.get("profile") || "current");
  const range = String(url.searchParams.get("range") || "30d");
  const payload = await readDerivativesPayload(env, symbol, range);
  /** @type {any} */
  const compact = buildCompactDerivativesSnapshot(payload, profile);
  const wantGeminiSummary = String(url.searchParams.get("geminiSummary") || "").trim() === "1";
  if (wantGeminiSummary && resolveBtcLlmProvider(env) === "gemini" && getGeminiApiKey(env)) {
    try {
      const brief = compact.llmBrief || "";
      const prompt =
        "你是衍生品与市场微观结构的简报助手。基于下列结构化要点（中文），输出一段不超过 120 字的 Markdown：" +
        "提炼杠杆情绪与宏观波动的组合含义，标注不确定性；禁止编造要点中未出现的数字。\n\n" +
        brief;
      compact.llmSummary = await btcGeminiGenerateText(env, prompt, { temperature: 0.12 });
      compact.llmSummaryProvider = "gemini";
    } catch (e) {
      compact.llmSummaryError = String(e && e.message ? e.message : e).slice(0, 260);
    }
  }
  return json(compact, 200, { "Cache-Control": "no-store", "X-Data-Source": "cloudflare-ai-derivatives-snapshot" });
}

async function handleReadOnchain(_request, env, url) {
  if (!env.DB) return json({ error: "D1 binding missing" }, 500);
  const scope = String(url.searchParams.get("scope") || ONCHAIN_GLOBAL_SCOPE);
  const range = String(url.searchParams.get("range") || "90d");
  const payload = await readOnchainPayload(env, scope, range);
  return json(payload, 200, { "Cache-Control": "no-store", "X-Data-Source": "cloudflare-d1-onchain" });
}

async function syncDerivativesIfDue(env, symbol, time) {
  if (!env.DB) return { ok: false, error: "D1 binding missing" };
  const min = time.getUTCMinutes();
  const hour = time.getUTCHours();
  if (min % 15 !== 0) return { ok: true, skipped: true };

  if (min === 0) {
    const includeMacro = hour % 6 === 0;
    return syncDerivativesOne(env, symbol, {
      background: true,
      interaction: "cron",
      groups: includeMacro ? "all" : "hourly",
    });
  }
  const maxTs = await readDerivativeGroupedMaxTsForSymbol(env, String(symbol || DEFAULT_SYMBOL).toUpperCase());
  const staleHeavy = DERIV_CORE_BINANCE_HEAVY.filter((key) => derivCoreLooksStale(key, maxTs, Date.now()));
  if (staleHeavy.length) {
    return syncDerivativesOne(env, symbol, {
      background: true,
      interaction: "cron",
      groups: "core-proprietary",
    });
  }
  return syncDerivativesOne(env, symbol, {
    background: true,
    interaction: "cron",
    groups: "fast",
  });
}

function onchainRangeToMs(range) {
  const r = String(range || "90d").toLowerCase();
  if (r === "24h" || r === "1d") return 24 * 60 * 60 * 1000;
  if (r === "7d") return 7 * 24 * 60 * 60 * 1000;
  if (r === "30d") return 30 * 24 * 60 * 60 * 1000;
  return ONCHAIN_RETENTION_MS;
}

function onchainPoint(scope, metric, t, value, source, extra) {
  const ts = Number(t || Date.now());
  const v = Number(value);
  if (!Number.isFinite(ts) || !Number.isFinite(v)) return null;
  return {
    scope: String(scope || ONCHAIN_GLOBAL_SCOPE),
    metric,
    t: ts,
    value: v,
    source: source || "",
    extra: extra || {},
  };
}

async function persistOnchainPoints(env, points) {
  if (!env.DB || !Array.isArray(points) || !points.length) return { written: 0, pruned: 0 };
  const stmt = env.DB.prepare(
    `INSERT OR REPLACE INTO onchain_timeseries
      (scope, metric, t, value, source, extra_json, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  );
  const now = Date.now();
  const rows = points.filter(Boolean);
  if (rows.length) {
    await env.DB.batch(
      rows.map((p) =>
        stmt.bind(
          p.scope,
          p.metric,
          p.t,
          p.value,
          p.source || "",
          JSON.stringify(p.extra || {}),
          now
        )
      )
    );
  }
  const cutoff = now - ONCHAIN_RETENTION_MS;
  const pruned = await env.DB.prepare("DELETE FROM onchain_timeseries WHERE t < ?1").bind(cutoff).run();
  return { written: rows.length, pruned: pruned?.meta?.changes || 0 };
}

async function updateOnchainSyncStatus(env, scope, metric, { ok, count, error }) {
  if (!env.DB) return;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO onchain_sync_status
      (scope, metric, last_run, last_count, last_ok, last_error)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  ).bind(
    scope,
    metric,
    new Date().toISOString(),
    Number(count) || 0,
    ok ? 1 : 0,
    error ? String(error).slice(0, 300) : null
  ).run();
}

function compactOnchainSeriesRow(row) {
  let extra = {};
  try {
    extra = row.extra_json ? JSON.parse(row.extra_json) : {};
  } catch (_) {}
  return {
    t: Number(row.t),
    value: Number(row.value),
    source: row.source || "",
    extra,
  };
}

async function fetchLlamaStableListingSpot(env) {
  const r = await fetchWithTimeout(
    "https://stablecoins.llama.fi/stablecoins",
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "BitDesk-CF-Worker/3.0 (OnchainCrossCheck)",
      },
    },
    FETCH_TIMEOUT_MS
  );
  if (!r.ok) {
    let err = "";
    try {
      err = (await r.text()).slice(0, 140);
    } catch (_) {
      err = r.statusText || "";
    }
    return { ok: false, error: `DefiLlama stablecoins HTTP ${r.status}: ${err}` };
  }
  const data = await r.json().catch(() => null);
  const list = Array.isArray(data?.peggedAssets) ? data.peggedAssets : [];
  const sumSym = (sym) => {
    let s = 0;
    for (const row of list) {
      if (String(row.symbol || "").toUpperCase() !== sym) continue;
      const v = Number(row?.circulating?.peggedUSD ?? row?.circulatingPrevDay?.peggedUSD);
      if (!Number.isFinite(v)) continue;
      s += v;
    }
    return Number.isFinite(s) ? s : null;
  };
  return {
    ok: true,
    usdt: sumSym("USDT"),
    usdc: sumSym("USDC"),
  };
}

async function fetchCoinGeckoStableMarketCapPoints(env, geckoId, scope, metric) {
  const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
    geckoId
  )}/market_chart?vs_currency=usd&days=90&interval=daily`;
  const headers = {
    Accept: "application/json",
    "User-Agent": "BitDesk-CF-Worker/3.0 (OnchainStable)",
  };
  const demoKey = env?.COINGECKO_DEMO_API_KEY || env?.COINGECKO_API_KEY;
  if (demoKey) headers["x-cg-demo-api-key"] = String(demoKey);
  const r = await fetchWithTimeout(url, {
    headers,
  });
  if (!r.ok) {
    let err = "";
    try {
      err = (await r.text()).slice(0, 160);
    } catch (_) {
      err = r.statusText || "";
    }
    throw new Error(`CoinGecko ${metric} HTTP ${r.status}: ${err.replace(/\s+/g, " ").trim()}`);
  }
  const data = await r.json().catch(() => null);
  const caps = Array.isArray(data?.market_caps) ? data.market_caps : [];
  const points = [];
  for (const row of caps) {
    const ts = row && Number(row[0]);
    const v = row && Number(row[1]);
    if (!Number.isFinite(ts) || !Number.isFinite(v)) continue;
    points.push(
      onchainPoint(scope, metric, ts, v, "coingecko-market-cap-usd", { gecko_id: geckoId })
    );
  }
  return points;
}

function stableFallbackPointFromLlama(scope, metric, llamaShot) {
  if (!llamaShot || !llamaShot.ok) return null;
  const value = metric === "stable_usdt_circ" ? llamaShot.usdt : metric === "stable_usdc_circ" ? llamaShot.usdc : null;
  if (!Number.isFinite(Number(value))) return null;
  return onchainPoint(scope, metric, Date.now(), Number(value), "defillama-stablecoins-spot", {
    note: "CoinGecko unavailable; DeFiLlama circulating snapshot used as latest point.",
  });
}

async function annotateLatestStableWithLlama(points, metric, llamaUsd) {
  const rows = points.filter(Boolean).slice().sort((a, b) => a.t - b.t);
  const last = rows.length ? rows[rows.length - 1] : null;
  if (last != null && Number.isFinite(llamaUsd)) {
    last.extra = {
      ...(last.extra || {}),
      llama_circulating_usd_approx: llamaUsd,
      compare_note: "DeFiLlama 列表 circulating 之和（美元）；与同日 CoinGecko 市值可作交叉参考。",
    };
  }
}

async function syncOnchainOne(env, opts = {}) {
  if (!env.DB) return { ok: false, error: "D1 binding missing" };
  const scope = ONCHAIN_GLOBAL_SCOPE;
  const points = [];
  let llamaShot = null;
  const sourceErrors = [];

  try {
    llamaShot = await fetchLlamaStableListingSpot(env);
    if (!llamaShot.ok) sourceErrors.push(`defillama: ${llamaShot.error || "failed"}`);
  } catch (e) {
    sourceErrors.push(`defillama: ${e && e.message ? e.message : String(e)}`);
  }

  const tryStable = async (geckoId, metric) => {
    try {
      const batch = await fetchCoinGeckoStableMarketCapPoints(env, geckoId, scope, metric);
      if (metric === "stable_usdt_circ" && llamaShot && llamaShot.ok && Number.isFinite(llamaShot.usdt)) {
        await annotateLatestStableWithLlama(batch, metric, llamaShot.usdt);
      }
      if (metric === "stable_usdc_circ" && llamaShot && llamaShot.ok && Number.isFinite(llamaShot.usdc)) {
        await annotateLatestStableWithLlama(batch, metric, llamaShot.usdc);
      }
      for (const p of batch) if (p) points.push(p);
      await updateOnchainSyncStatus(env, scope, metric, {
        ok: batch.length > 0,
        count: batch.length,
        error: batch.length ? "" : "CoinGecko 未返回市值序列",
      });
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      sourceErrors.push(`coingecko ${metric}: ${msg}`);
      const fallback = stableFallbackPointFromLlama(scope, metric, llamaShot);
      if (fallback) points.push(fallback);
      await updateOnchainSyncStatus(env, scope, metric, {
        ok: !!fallback,
        count: fallback ? 1 : 0,
        error: fallback ? `CoinGecko 失败，已用 DeFiLlama 当前快照兜底：${msg}`.slice(0, 300) : msg.slice(0, 300),
      });
    }
  };

  await tryStable("tether", "stable_usdt_circ");
  await tryStable("usd-coin", "stable_usdc_circ");

  const persisted = await persistOnchainPoints(env, points);
  const okStable = ONCHAIN_STABLE_METRICS.every((m) => points.some((p) => p && p.metric === m));

  return {
    ok: okStable || points.length > 0,
    scope,
    written: persisted.written,
    pruned: persisted.pruned,
    errors: sourceErrors.slice(0, 14),
    background: !!opts.background,
    llama: llamaShot && llamaShot.ok ? { usdtUsd: llamaShot.usdt, usdcUsd: llamaShot.usdc } : null,
  };
}

async function syncOnchainIfDue(env, time) {
  if (!env.DB) return { ok: false, error: "D1 binding missing" };
  const m = time.getUTCMinutes();
  const h = time.getUTCHours();
  if (m !== 12 || h % 2 !== 0) return { ok: true, skipped: true };
  return syncOnchainOne(env, { background: true });
}

async function readOnchainPayload(env, scope, range) {
  const normalizedScope = String(scope || ONCHAIN_GLOBAL_SCOPE);
  const since = Date.now() - onchainRangeToMs(range);
  const { results } = await env.DB.prepare(
    "SELECT scope, metric, t, value, source, extra_json FROM onchain_timeseries WHERE scope = ?1 AND t >= ?2 ORDER BY metric, t ASC"
  )
    .bind(normalizedScope, since)
    .all();
  const series = {};
  for (const row of results || []) {
    if (!series[row.metric]) series[row.metric] = [];
    series[row.metric].push(compactOnchainSeriesRow(row));
  }
  const latestT = Math.max(0, ...Object.values(series).flat().map((row) => Number(row.t) || 0));
  const missing = ONCHAIN_METRICS.filter((metric) => !series[metric] || !series[metric].length);
  const warnings = missing.map((metric) => `${metric} 暂无 D1 数据`);
  return {
    scope: normalizedScope,
    range: range || "90d",
    generatedAt: new Date().toISOString(),
    dataSource: {
      primary: "cloudflare-d1-onchain",
      endpoints: [
        "CoinGecko public market_chart (USD market cap as circulating proxy, 90d daily)",
        "DeFiLlama stablecoins list (cross-check + fallback latest point)",
      ],
    },
    reliability: ONCHAIN_RELIABILITY,
    llmGuidance: {
      weight: ONCHAIN_RELIABILITY.weight,
      confidence: ONCHAIN_RELIABILITY.confidence,
      policy: ONCHAIN_RELIABILITY.llmPolicy,
    },
    series,
    dataFreshness: {
      latestT: latestT || null,
      latestTime: latestT ? new Date(latestT).toISOString() : null,
      staleMs: latestT ? Date.now() - latestT : null,
      sourceOk: missing.length === 0,
      warnings,
    },
  };
}

/* =============================================================
 * Strong liquidation 5m aggregation
 * ============================================================= */

function liquidationBucketStart(ts) {
  return Math.floor(Number(ts || Date.now()) / LIQUIDATION_BUCKET_MS) * LIQUIDATION_BUCKET_MS;
}

function liquidationPositionSide(exchange, rawSide) {
  const side = String(rawSide || "");
  if (exchange === "binance") {
    if (side.toUpperCase() === "SELL") return "long";
    if (side.toUpperCase() === "BUY") return "short";
  }
  if (exchange === "bybit") {
    if (side === "Buy") return "long";
    if (side === "Sell") return "short";
  }
  return "unknown";
}

function normalizeBinanceLiquidation(msg) {
  if (!msg || msg.e !== "forceOrder" || !msg.o) return null;
  const o = msg.o;
  const symbol = String(o.s || msg.s || LIQUIDATION_SYMBOL).toUpperCase();
  const price = Number(o.ap || o.p);
  const qty = Number(o.z || o.l || o.q);
  if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) return null;
  const rawSide = String(o.S || "");
  const ts = Number(o.T || msg.E || Date.now());
  return {
    exchange: "binance",
    symbol,
    ts,
    side: liquidationPositionSide("binance", rawSide),
    price,
    qty,
    notional: price * qty,
  };
}

function normalizeBybitLiquidationRow(row) {
  if (!row) return null;
  const symbol = String(row.s || LIQUIDATION_SYMBOL).toUpperCase();
  const price = Number(row.p);
  const qty = Number(row.v);
  if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) return null;
  const rawSide = String(row.S || "");
  return {
    exchange: "bybit",
    symbol,
    ts: Number(row.T || Date.now()),
    side: liquidationPositionSide("bybit", rawSide),
    price,
    qty,
    notional: price * qty,
  };
}

function normalizeBybitLiquidation(msg) {
  if (!msg || !/^allLiquidation\./.test(String(msg.topic || ""))) return [];
  const rows = Array.isArray(msg.data) ? msg.data : (msg.data ? [msg.data] : []);
  return rows.map(normalizeBybitLiquidationRow).filter(Boolean);
}

function normalizeBybitLegacyLiquidationRow(row) {
  if (!row) return null;
  const symbol = String(row.symbol || row.s || LIQUIDATION_SYMBOL).toUpperCase();
  const price = Number(row.price != null ? row.price : row.p);
  const qty = Number(row.size != null ? row.size : row.v);
  if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) return null;
  const rawSide = String(row.side || row.S || "");
  return {
    exchange: "bybit",
    symbol,
    ts: Number(row.updatedTime != null ? row.updatedTime : row.T || Date.now()),
    side: liquidationPositionSide("bybit", rawSide),
    price,
    qty,
    notional: price * qty,
    rawTopic: "liquidation",
  };
}

function normalizeBybitLegacyLiquidation(msg) {
  if (!msg || !/^liquidation\./.test(String(msg.topic || ""))) return [];
  const rows = Array.isArray(msg.data) ? msg.data : (msg.data ? [msg.data] : []);
  return rows.map(normalizeBybitLegacyLiquidationRow).filter(Boolean);
}

function emptyLiquidationBucket(symbol, exchange, bucketStart) {
  return {
    symbol,
    exchange,
    bucketStart,
    longNotional: 0,
    shortNotional: 0,
    longCount: 0,
    shortCount: 0,
    maxNotional: 0,
    maxSide: "",
    minPrice: null,
    maxPrice: null,
    vwapNumerator: 0,
    vwapQty: 0,
    updatedAt: Date.now(),
  };
}

function addLiquidationToBucket(bucket, event) {
  const side = event.side === "short" ? "short" : "long";
  if (side === "short") {
    bucket.shortNotional += event.notional;
    bucket.shortCount += 1;
  } else {
    bucket.longNotional += event.notional;
    bucket.longCount += 1;
  }
  if (!bucket.maxNotional || event.notional > bucket.maxNotional) {
    bucket.maxNotional = event.notional;
    bucket.maxSide = side;
  }
  bucket.minPrice = bucket.minPrice == null ? event.price : Math.min(bucket.minPrice, event.price);
  bucket.maxPrice = bucket.maxPrice == null ? event.price : Math.max(bucket.maxPrice, event.price);
  bucket.vwapNumerator += event.price * event.qty;
  bucket.vwapQty += event.qty;
  bucket.updatedAt = Date.now();
}

function serializeLiquidationBucket(bucket) {
  const qty = Number(bucket.vwapQty) || 0;
  return {
    symbol: bucket.symbol,
    exchange: bucket.exchange,
    bucket_start: bucket.bucketStart,
    long_notional: bucket.longNotional,
    short_notional: bucket.shortNotional,
    long_count: bucket.longCount,
    short_count: bucket.shortCount,
    max_notional: bucket.maxNotional,
    max_side: bucket.maxSide || null,
    min_price: bucket.minPrice,
    max_price: bucket.maxPrice,
    vwap_price: qty > 0 ? bucket.vwapNumerator / qty : null,
    updated_at: bucket.updatedAt || Date.now(),
  };
}

function serializeActiveLiquidationBucket(bucket) {
  return { ...serializeLiquidationBucket(bucket), is_active: true };
}

function maxLiquidationTime(rows, field) {
  return (rows || []).reduce((m, row) => Math.max(m, Number(row && row[field]) || 0), 0);
}

function liquidationFreshness(rows, sources, generatedAt = Date.now()) {
  const sourceRows = Object.values(sources || {});
  const latestPersistedEventAt = Math.max(maxLiquidationTime(rows, "updated_at"), maxLiquidationTime(rows, "bucket_start"));
  const latestMessageAt = sourceRows.reduce((m, src) => Math.max(
    m,
    Number(src && src.lastMarketMessageAt) || 0,
    Number(src && src.lastEventAt) || 0
  ), 0);
  const latestEventAt = Math.max(
    latestPersistedEventAt,
    sourceRows.reduce((m, src) => Math.max(m, Number(src && src.lastEventAt) || 0), 0)
  );
  const latestBucketStart = maxLiquidationTime(rows, "bucket_start");
  const anyRealtime = sourceRows.some((src) => src && src.status === "realtime");
  const activeSources = sourceRows.filter((src) => {
    const last = Math.max(Number(src && src.lastMarketMessageAt) || 0, Number(src && src.lastEventAt) || 0);
    return src && src.status === "realtime" && last > 0 && generatedAt - last <= LIQUIDATION_HEALTH_FRESH_MS;
  }).length;
  return {
    generatedAt,
    latestMessageAt,
    latestEventAt,
    latestBucketStart,
    latestMessageAgeMs: latestMessageAt ? generatedAt - latestMessageAt : null,
    latestEventAgeMs: latestEventAt ? generatedAt - latestEventAt : null,
    latestBucketAgeMs: latestBucketStart ? generatedAt - latestBucketStart : null,
    activeSources,
    anyRealtime,
    ok: activeSources > 0,
  };
}

async function persistLiquidationBuckets(env, buckets) {
  if (!env.DB || !Array.isArray(buckets) || buckets.length === 0) return { written: 0, pruned: 0 };
  const stmt = env.DB.prepare(
    `INSERT OR REPLACE INTO liquidation_5m_buckets
      (symbol, exchange, bucket_start, long_notional, short_notional, long_count, short_count,
       max_notional, max_side, min_price, max_price, vwap_price, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`
  );
  const serialized = buckets.map(serializeLiquidationBucket);
  await env.DB.batch(serialized.map((b) => stmt.bind(
    b.symbol,
    b.exchange,
    b.bucket_start,
    b.long_notional,
    b.short_notional,
    b.long_count,
    b.short_count,
    b.max_notional,
    b.max_side,
    b.min_price,
    b.max_price,
    b.vwap_price,
    b.updated_at
  )));
  const pruned = await pruneLiquidationBuckets(env);
  return { written: serialized.length, pruned };
}

async function pruneLiquidationBuckets(env, now = Date.now()) {
  if (!env.DB) return 0;
  const cutoff = now - LIQUIDATION_RETENTION_MS;
  try {
    const res = await env.DB.prepare("DELETE FROM liquidation_5m_buckets WHERE bucket_start < ?1").bind(cutoff).run();
    return res?.meta?.changes || 0;
  } catch (_) {
    return 0;
  }
}

function getLiquidationCollectorStub(env) {
  if (!env || !env.LIQUIDATION_COLLECTOR) return null;
  const id = env.LIQUIDATION_COLLECTOR.idFromName(LIQUIDATION_COLLECTOR_NAME);
  return env.LIQUIDATION_COLLECTOR.get(id);
}

async function handleLiquidationWake(env) {
  const stub = getLiquidationCollectorStub(env);
  if (!stub) return json({ ok: false, error: "Durable Object binding LIQUIDATION_COLLECTOR missing" }, 501);
  return stub.fetch("https://liquidation-collector.local/wake", { method: "POST" });
}

async function handleLiquidationCollectorStatus(env) {
  const stub = getLiquidationCollectorStub(env);
  if (!stub) return json({ ok: false, error: "Durable Object binding LIQUIDATION_COLLECTOR missing" }, 501);
  return stub.fetch("https://liquidation-collector.local/status");
}

async function getLiquidationCollectorSnapshot(env) {
  const stub = getLiquidationCollectorStub(env);
  if (!stub) return null;
  try {
    const res = await stub.fetch("https://liquidation-collector.local/status");
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.collector ? data.collector : null;
  } catch (_) {
    return null;
  }
}

async function handleReadLiquidations(_request, env, url) {
  if (!env.DB) return json({ error: "D1 binding missing" }, 500);
  const symbol = String(url.searchParams.get("symbol") || LIQUIDATION_SYMBOL).toUpperCase();
  const range = String(url.searchParams.get("range") || "30d");
  const includeActive = ["1", "true", "yes", "on"].includes(String(url.searchParams.get("includeActive") || "").toLowerCase());
  const rangeMs = (range === "24h" || range === "1d")
    ? 24 * 60 * 60 * 1000
    : range === "7d"
      ? 7 * 24 * 60 * 60 * 1000
      : LIQUIDATION_RETENTION_MS;
  const since = Date.now() - rangeMs;
  const { results } = await env.DB.prepare(
    `SELECT symbol, exchange, bucket_start, long_notional, short_notional, long_count, short_count,
            max_notional, max_side, min_price, max_price, vwap_price, updated_at
       FROM liquidation_5m_buckets
      WHERE symbol = ?1 AND bucket_start >= ?2
      ORDER BY bucket_start ASC, exchange ASC`
  ).bind(symbol, since).all();
  const closedRows = results || [];
  const collector = includeActive ? await getLiquidationCollectorSnapshot(env) : null;
  const activeRows = includeActive && collector && Array.isArray(collector.activeBucketRows)
    ? collector.activeBucketRows.filter((row) => row && row.symbol === symbol && Number(row.bucket_start) >= since)
    : [];
  const rows = closedRows.concat(activeRows).sort((a, b) => {
    const dt = (Number(a.bucket_start) || 0) - (Number(b.bucket_start) || 0);
    return dt || String(a.exchange || "").localeCompare(String(b.exchange || ""));
  });
  const generatedAt = Date.now();
  const sources = collector && collector.sources ? collector.sources : {};
  const freshness = liquidationFreshness(rows, sources, generatedAt);
  return json({
    ok: true,
    symbol,
    interval: "5m",
    retentionDays: 30,
    count: rows.length,
    closedCount: closedRows.length,
    activeCount: activeRows.length,
    generatedAt,
    latestBucketStart: freshness.latestBucketStart,
    latestEventAt: freshness.latestEventAt,
    sources,
    freshness,
    buckets: rows,
  }, 200, {
    "Cache-Control": publicCacheHeader(LIQUIDATION_READ_CACHE_SECONDS, 40),
    "X-Data-Source": "cloudflare-d1-liquidations",
  });
}

/* =============================================================
 * HTTP 路由处理
 * ============================================================= */

async function handleReadKlines(_request, env, url) {
  if (!env.DB) return json({ error: "D1 binding missing" }, 500);

  const symbol = String(url.searchParams.get("symbol") || DEFAULT_SYMBOL).toUpperCase();
  const interval = String(url.searchParams.get("interval") || "15m");
  if (!SUPPORTED_INTERVALS.includes(interval)) {
    return json({ error: "unsupported interval", supported: SUPPORTED_INTERVALS }, 400);
  }
  const limit = Math.min(
    MAX_KLINES_PER_INTERVAL,
    Math.max(1, parseInt(String(url.searchParams.get("limit") || MAX_KLINES_PER_INTERVAL), 10) || MAX_KLINES_PER_INTERVAL)
  );
  const syncParam = String(url.searchParams.get("sync") || "auto").toLowerCase();
  const allowAutoSync = syncParam !== "0" && syncParam !== "false" && syncParam !== "off";

  let meta = null;
  let status = null;
  let syncResult = null;
  if (allowAutoSync) {
    try {
      meta = await d1QueryLatestMeta(env, symbol, interval);
    } catch (_) {}
    try {
      status = await env.DB.prepare(
        "SELECT last_run, last_count, last_ok, last_error FROM sync_status WHERE symbol = ?1 AND interval = ?2"
      ).bind(symbol, interval).first();
    } catch (_) {}

    if (
      isKlineTailStaleForRead(meta && meta.maxT, interval) &&
      !recentlyTriedKlineSync(status)
    ) {
      syncResult = await syncKlinesOne(env, symbol, interval);
    }
  }

  const { results } = await env.DB.prepare(
    "SELECT t, o, h, l, c, v FROM klines WHERE symbol = ?1 AND interval = ?2 ORDER BY t DESC LIMIT ?3"
  ).bind(symbol, interval, limit).all();

  const rows = (results || []).slice().reverse();

  status = await env.DB.prepare(
    "SELECT last_run, last_count, last_ok, last_error FROM sync_status WHERE symbol = ?1 AND interval = ?2"
  ).bind(symbol, interval).first();

  const latestT = rows.length ? rows[rows.length - 1].t : 0;

  return new Response(
    JSON.stringify({
      symbol,
      interval,
      count: rows.length,
      latestT,
      lastSync: status || null,
      syncResult,
      klines: rows.map((r) => ({
        t: Number(r.t),
        o: Number(r.o),
        h: Number(r.h),
        l: Number(r.l),
        c: Number(r.c),
        v: Number(r.v),
      })),
    }),
    {
      status: 200,
      headers: headersMerge({
        "Content-Type": "application/json; charset=utf-8",
        "X-Data-Source": "cloudflare-d1",
        "X-D1-Count": String(rows.length),
        "X-D1-Latest-T": String(latestT),
        "X-D1-Auto-Sync": syncResult ? "1" : "0",
        "X-D1-Auto-Sync-Ok": syncResult ? String(syncResult.ok ? 1 : 0) : "",
        "Cache-Control": publicCacheHeader(syncResult ? 0 : KLINE_READ_CACHE_SECONDS, 20),
      }),
    }
  );
}

async function handleManualSync(request, env, url, ctx) {
  if (!env.DB) return json({ error: "D1 binding missing" }, 500);
  if (request && request.method === "HEAD") {
    return json({ error: "Method Not Allowed", allow: ["GET", "POST"] }, 405, { Allow: "GET, POST" });
  }

  const symbol = String(url.searchParams.get("symbol") || DEFAULT_SYMBOL).toUpperCase();
  const intervalParam = String(url.searchParams.get("interval") || "").trim();
  const intervals = (!intervalParam || intervalParam.toLowerCase() === "all")
    ? SUPPORTED_INTERVALS.slice()
    : intervalParam.split(",").map((s) => s.trim()).filter(Boolean);

  const waitParam = String(url.searchParams.get("wait") || "1").trim();
  const wait = waitParam !== "0" && waitParam.toLowerCase() !== "false";

  const runAll = async () => {
    const results = [];
    for (const iv of intervals) {
      if (!SUPPORTED_INTERVALS.includes(iv)) {
        results.push({ symbol, interval: iv, ok: false, error: "unsupported" });
        continue;
      }
      results.push(await syncKlinesOne(env, symbol, iv));
    }
    return results;
  };

  if (wait) {
    const results = await runAll();
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      return json(
        {
          error: "kline sync failed (check Worker logs: Binance geo/network, Bybit failover, or D1 error)",
          workerBuild: WORKER_BUILD,
          mode: "manual-wait",
          symbol,
          intervals,
          results,
          firstError: failed[0],
        },
        502,
        { "Cache-Control": "no-store", "X-D1-Manual-Sync": "1" }
      );
    }
    return json(
      { ok: true, workerBuild: WORKER_BUILD, mode: "manual-wait", symbol, intervals, results },
      200,
      { "Cache-Control": "no-store", "X-D1-Manual-Sync": "1" }
    );
  }
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(runAll());
  }
  return json(
    { ok: true, workerBuild: WORKER_BUILD, mode: "manual-background", symbol, queued: intervals },
    202,
    { "Cache-Control": "no-store", "X-D1-Manual-Sync": "1" }
  );
}

async function handleReadFootprint(_request, env, url, ctx) {
  if (!env.DB) return json({ error: "D1 binding missing" }, 500);

  const symbol = String(url.searchParams.get("symbol") || DEFAULT_SYMBOL).toUpperCase();
  const interval = String(url.searchParams.get("interval") || "5m");
  if (!FOOTPRINT_INTERVALS.includes(interval)) {
    return json({ error: "unsupported footprint interval", supported: FOOTPRINT_INTERVALS }, 400);
  }
  const tickSize = String(url.searchParams.get("tickSize") || "auto");
  const limit = Math.min(
    FOOTPRINT_API_MAX_LIMIT,
    Math.max(1, parseInt(String(url.searchParams.get("limit") || String(FOOTPRINT_API_MAX_LIMIT)), 10) || FOOTPRINT_API_MAX_LIMIT)
  );
  const syncParam = String(url.searchParams.get("sync") || "auto").toLowerCase();
  const forceSync = syncParam === "1" || syncParam === "true" || syncParam === "force";
  const allowAutoSync = syncParam !== "0" && syncParam !== "false" && syncParam !== "off";
  let syncResult = null;
  let status = await env.DB.prepare(
    "SELECT last_run, last_trade_id, last_trade_time, last_count, last_ok, last_error FROM footprint_sync_status WHERE symbol = ?1"
  ).bind(symbol).first();
  if (forceSync) {
    syncResult = await syncFootprintOne(env, symbol);
  } else if (
    allowAutoSync &&
    isFootprintTailStaleForRead(status, 0) &&
    !recentlyTriedFootprintSync(status)
  ) {
    const run = () => syncFootprintOne(env, symbol);
    syncResult = { ok: true, queued: true, reason: "read_auto", symbol };
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(run());
    } else {
      syncResult = await run();
    }
  }
  if (syncResult) {
    status = await env.DB.prepare(
      "SELECT last_run, last_trade_id, last_trade_time, last_count, last_ok, last_error FROM footprint_sync_status WHERE symbol = ?1"
    ).bind(symbol).first();
  }

  const mult = Math.max(1, Math.ceil(intervalMs(interval) / intervalMs(FOOTPRINT_BASE_INTERVAL)));
  const baseLimit = Math.min(FOOTPRINT_MAX_BARS, limit * mult + mult);
  const { results } = await env.DB.prepare(
    `SELECT t, o, h, l, c, buy_vol, sell_vol, poc_price, levels_json, last_trade_id
       FROM footprint_bars
      WHERE symbol = ?1 AND interval = ?2
      ORDER BY t DESC LIMIT ?3`
  ).bind(symbol, FOOTPRINT_BASE_INTERVAL, baseLimit).all();
  const rows = (results || []).slice().reverse();
  const bars = mergeFootprintRows(rows, interval, tickSize).slice(-limit);
  const availableBaseRows = rows.length;
  const availableBaseMinT = rows.length ? Number(rows[0].t || 0) : 0;
  const availableBaseMaxT = rows.length ? Number(rows[rows.length - 1].t || 0) : 0;

  return new Response(
    JSON.stringify({
      symbol,
      interval,
      tickSize,
      effectiveTickSize: resolveFootprintTickSize(tickSize),
      /** 供浏览器新鲜度对齐（弱化客户端时钟漂移）；不传时仍用客户端 Date.now()。 */
      now: Date.now(),
      count: bars.length,
      latestT: bars.length ? bars[bars.length - 1].t : 0,
      baseInterval: FOOTPRINT_BASE_INTERVAL,
      maxBaseBars: FOOTPRINT_MAX_BARS,
      availableBaseBars: availableBaseRows,
      availableBaseMinT,
      availableBaseMaxT,
      lastSync: status || null,
      syncResult,
      bars,
    }),
    {
      status: 200,
      headers: headersMerge({
        "Content-Type": "application/json; charset=utf-8",
        "X-Data-Source": "cloudflare-d1-footprint",
        "X-D1-Footprint-Count": String(bars.length),
        "X-D1-Footprint-Synced": syncResult ? "1" : "0",
        "Cache-Control": publicCacheHeader(syncResult && !syncResult.queued ? 0 : FOOTPRINT_READ_CACHE_SECONDS, 30),
      }),
    }
  );
}

async function handleManualFootprintSync(_request, env, url, ctx) {
  if (!env.DB) return json({ error: "D1 binding missing" }, 500);
  const symbol = String(url.searchParams.get("symbol") || DEFAULT_SYMBOL).toUpperCase();
  const waitParam = String(url.searchParams.get("wait") || "1").trim();
  const wait = waitParam !== "0" && waitParam.toLowerCase() !== "false";
  const backfill = String(url.searchParams.get("backfill") || "0") === "1";
  const windows = Math.min(
    FOOTPRINT_BACKFILL_MAX_WINDOWS,
    Math.max(1, parseInt(String(url.searchParams.get("windows") || FOOTPRINT_BACKFILL_DEFAULT_WINDOWS), 10) || FOOTPRINT_BACKFILL_DEFAULT_WINDOWS)
  );
  const run = async () => {
    const sync = await syncFootprintOne(env, symbol);
    if (!backfill) return sync;
    const fill = await syncFootprintBackfill(env, symbol, { windows });
    return { ...sync, backfill: fill };
  };
  if (wait) {
    const result = await run();
    return json({ symbol, result }, result.ok ? 200 : 502);
  }
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(run());
  return json({ symbol, queued: true, backfill, windows: backfill ? windows : 0 }, 202);
}

async function handleProxyKlines(_request, env, url) {
  const customOrigin = parseCustomFapiOrigin(env && env.BINANCE_FAPI_ORIGIN);
  const origins = customOrigin ? [customOrigin] : BINANCE_HOSTS.map((h) => `https://${h}`);

  const allow = new Set(["symbol", "interval", "limit", "startTime", "endTime"]);
  const p = new URLSearchParams();
  for (const [k, v] of url.searchParams) if (allow.has(k) && v !== "") p.set(k, v);

  const chain = [];
  let firstErr = { status: 0, error: "" };

  for (const origin of origins) {
    const target = origin.replace(/\/$/, "") + "/fapi/v1/klines?" + p.toString();
    let host = origin;
    try { host = new URL(origin).host; } catch (_) {}
    try {
      const r = await fetchWithTimeout(target, {
        headers: {
          "User-Agent": "BitDesk-CF-Worker/3.0 (KlinesProxy)",
          Accept: "application/json",
        },
      });
      if (!r.ok) {
        let err = "";
        try { err = (await r.text()).slice(0, 180); } catch (_) { err = r.statusText || ""; }
        chain.push(`${host}:${r.status}`);
        if (!firstErr.error) firstErr = { status: r.status, error: err.replace(/\s+/g, " ").trim() };
        continue;
      }
      const text = await r.text();
      return new Response(text, {
        status: 200,
        headers: headersMerge({
          "Content-Type": "application/json; charset=utf-8",
          "X-Proxy-Target": host,
          "X-Data-Source": "binance-fapi",
          "X-Worker-Note": customOrigin ? "BINANCE_FAPI_ORIGIN" : "direct",
          "X-Failover-Chain": chain.concat(`${host}:ok`).join(" | "),
        }),
      });
    } catch (e) {
      const msg = (e && e.message ? e.message : String(e)).replace(/\s+/g, " ").trim().slice(0, 140);
      chain.push(`${host}:err ${msg.slice(0, 40)}`);
      if (!firstErr.error) firstErr = { status: 0, error: msg };
    }
  }

  if (klineAlternateFailoverEnabled(env)) {
    const alternate = await fetchKlinesFromBybit(env, {
      symbol: String(p.get("symbol") || DEFAULT_SYMBOL).toUpperCase(),
      interval: String(p.get("interval") || "15m"),
      limit: Number(p.get("limit") || BYBIT_MAX_LIMIT_PER_REQUEST),
      startTime: p.get("startTime"),
      endTime: p.get("endTime"),
    });
    chain.push(...(alternate.chain || []));
    if (alternate.ok) {
      return new Response(JSON.stringify(alternate.klines), {
        status: 200,
        headers: headersMerge({
          "Content-Type": "application/json; charset=utf-8",
          "X-Proxy-Target": "bybit:v5/market/kline",
          "X-Data-Source": "bybit-failover",
          "X-Worker-Note": "binance failed; converted Bybit linear klines to fapi/klines shape",
          "X-Failover-Chain": chain.join(" | "),
          "X-Upstream-Status": String(firstErr.status || 0),
          "X-Upstream-Error": firstErr.error || "binance failed",
        }),
      });
    }
  }

  return json(
    {
      error: "binance unreachable from this edge",
      hint:
        "Keep [placement] mode = smart; optionally set BINANCE_FAPI_ORIGIN to a self-hosted reverse proxy in a region Binance allows (HK/SG/TYO).",
      chain,
      firstError: firstErr,
    },
    502,
    {
      "X-Proxy-Target": "binance (all hosts failed)",
      "X-Data-Source": "none",
      "X-Failover-Chain": chain.join(" | "),
      "X-Upstream-Status": String(firstErr.status || 0),
      "X-Upstream-Error": firstErr.error || "all failed",
    }
  );
}

async function handleProxyAggTrades(_request, env, url) {
  const customOrigin = parseCustomFapiOrigin(env && env.BINANCE_FAPI_ORIGIN);
  const origins = customOrigin ? [customOrigin] : BINANCE_HOSTS.map((h) => `https://${h}`);

  const allow = new Set(["symbol", "limit", "fromId", "startTime", "endTime"]);
  const p = new URLSearchParams();
  for (const [k, v] of url.searchParams) if (allow.has(k) && v !== "") p.set(k, v);
  if (!p.get("symbol")) p.set("symbol", DEFAULT_SYMBOL);
  if (!p.get("limit")) p.set("limit", "500");

  const chain = [];
  let firstErr = { status: 0, error: "" };

  for (const origin of origins) {
    const target = origin.replace(/\/$/, "") + "/fapi/v1/aggTrades?" + p.toString();
    let host = origin;
    try { host = new URL(origin).host; } catch (_) {}
    try {
      const r = await fetchWithTimeout(target, {
        headers: {
          "User-Agent": "BitDesk-CF-Worker/3.0 (AggTradesProxy)",
          Accept: "application/json",
        },
      });
      if (!r.ok) {
        let err = "";
        try { err = (await r.text()).slice(0, 180); } catch (_) { err = r.statusText || ""; }
        chain.push(`${host}:${r.status}`);
        if (!firstErr.error) firstErr = { status: r.status, error: err.replace(/\s+/g, " ").trim() };
        continue;
      }
      const text = await r.text();
      return new Response(text, {
        status: 200,
        headers: headersMerge({
          "Content-Type": "application/json; charset=utf-8",
          "X-Proxy-Target": host,
          "X-Data-Source": "binance-fapi-aggTrades",
          "X-Worker-Note": customOrigin ? "BINANCE_FAPI_ORIGIN" : "direct",
          "X-Failover-Chain": chain.concat(`${host}:ok`).join(" | "),
          "Cache-Control": "no-store",
        }),
      });
    } catch (e) {
      const msg = (e && e.message ? e.message : String(e)).replace(/\s+/g, " ").trim().slice(0, 140);
      chain.push(`${host}:err ${msg.slice(0, 40)}`);
      if (!firstErr.error) firstErr = { status: 0, error: msg };
    }
  }

  return json(
    {
      error: "binance aggTrades unreachable from this edge",
      hint:
        "Optionally set BINANCE_FAPI_ORIGIN to a self-hosted reverse proxy in a region Binance allows.",
      chain,
      firstError: firstErr,
    },
    502,
    {
      "X-Proxy-Target": "binance aggTrades (all hosts failed)",
      "X-Data-Source": "none",
      "X-Failover-Chain": chain.join(" | "),
      "X-Upstream-Status": String(firstErr.status || 0),
      "X-Upstream-Error": firstErr.error || "all failed",
    }
  );
}

/** 与历史同源 `/api/binance/ticker/price` 行为对齐：标题栏价格在浏览器直连 Binance CORS 失败时可走 Worker。 */
async function handleProxyTickerPrice(_request, env, url) {
  const customOrigin = parseCustomFapiOrigin(env && env.BINANCE_FAPI_ORIGIN);
  const origins = customOrigin ? [customOrigin] : BINANCE_HOSTS.map((h) => `https://${h}`);
  const symbol = String(url.searchParams.get("symbol") || DEFAULT_SYMBOL).toUpperCase();
  const qs = new URLSearchParams({ symbol }).toString();

  const chain = [];
  let firstErr = { status: 0, error: "" };

  for (const origin of origins) {
    const target = `${origin.replace(/\/$/, "")}/fapi/v1/ticker/price?${qs}`;
    let host = origin;
    try {
      host = new URL(origin).host;
    } catch (_) {}
    try {
      const r = await fetchWithTimeout(target, {
        headers: {
          "User-Agent": "BitDesk-CF-Worker/3.0 (TickerPriceProxy)",
          Accept: "application/json",
        },
      });
      if (!r.ok) {
        let err = "";
        try {
          err = (await r.text()).slice(0, 180);
        } catch (_) {
          err = r.statusText || "";
        }
        chain.push(`${host}:${r.status}`);
        if (!firstErr.error) firstErr = { status: r.status, error: err.replace(/\s+/g, " ").trim() };
        continue;
      }
      const text = await r.text();
      return new Response(text, {
        status: 200,
        headers: headersMerge({
          "Content-Type": "application/json; charset=utf-8",
          "X-Proxy-Target": host,
          "X-Data-Source": "binance-fapi-ticker-price",
          "X-Worker-Note": customOrigin ? "BINANCE_FAPI_ORIGIN" : "direct",
          "X-Failover-Chain": chain.concat(`${host}:ok`).join(" | "),
          "Cache-Control": "no-store",
        }),
      });
    } catch (e) {
      const msg = (e && e.message ? e.message : String(e)).replace(/\s+/g, " ").trim().slice(0, 140);
      chain.push(`${host}:err ${msg.slice(0, 40)}`);
      if (!firstErr.error) firstErr = { status: 0, error: msg };
    }
  }

  const spotUrl = `https://api.binance.com/api/v3/ticker/price?${qs}`;
  try {
    const r = await fetchWithTimeout(spotUrl, {
      headers: {
        "User-Agent": "BitDesk-CF-Worker/3.0 (TickerPriceProxy)",
        Accept: "application/json",
      },
    });
    if (r.ok) {
      const text = await r.text();
      return new Response(text, {
        status: 200,
        headers: headersMerge({
          "Content-Type": "application/json; charset=utf-8",
          "X-Proxy-Target": "binance-spot",
          "X-Alternate-Note": "fapi ticker/price failed; spot v3/ticker/price",
          "X-Upstream-Status": String(firstErr.status || 0),
          "X-Upstream-Error": firstErr.error || "",
          "X-Failover-Chain": [...chain, "spot:v3:ok"].join(" | "),
          "Cache-Control": "no-store",
        }),
      });
    }
    chain.push(`spot:v3:${r.status}`);
  } catch (e) {
    const msg = (e && e.message ? e.message : String(e)).replace(/\s+/g, " ").trim().slice(0, 120);
    chain.push(`spot:v3:err ${msg.slice(0, 40)}`);
  }

  return json(
    {
      error: "ticker/price upstream failed",
      chain,
      firstError: firstErr,
    },
    502,
    {
      "X-Proxy-Target": "binance ticker/price (all paths failed)",
      "X-Data-Source": "none",
      "X-Failover-Chain": chain.join(" | "),
      "X-Upstream-Status": String(firstErr.status || 0),
      "X-Upstream-Error": firstErr.error || "all failed",
    }
  );
}

async function handleStatus(_request, env, url) {
  if (!env.DB) return json({ error: "D1 binding missing" }, 500);
  const detail = ["1", "true", "full", "counts"].includes(
    String(url && url.searchParams ? url.searchParams.get("detail") || "" : "").toLowerCase()
  );
  if (!detail) {
    const { results: statusRaw } = await env.DB.prepare(
      "SELECT symbol, interval, last_run, last_t, last_count, last_ok, last_error FROM sync_status"
    ).all();
    const { results: footprintStatusRaw } = await env.DB.prepare(
      "SELECT symbol, last_run, last_trade_id, last_trade_time, last_count, last_ok, last_error FROM footprint_sync_status"
    ).all();
    let derivativeStatusRaw = [];
    try {
      const status = await env.DB.prepare(
        "SELECT symbol, metric, last_run, last_count, last_ok, last_error FROM derivative_sync_status ORDER BY symbol, metric"
      ).all();
      derivativeStatusRaw = status.results || [];
    } catch (_) {}
    const derivativeSourceHealthRaw = await readDerivativeSourceHealthAllSafe(env);
    const klineCounts = (statusRaw || []).map((row) => ({
      symbol: row.symbol,
      interval: row.interval,
      cnt: Number(row.last_t || 0) > 0 ? Math.max(1, Number(row.last_count || 0)) : 0,
      minT: null,
      maxT: Number(row.last_t || 0),
      estimated: true,
      estimateSource: "sync_status",
    }));
    const footprintCounts = (footprintStatusRaw || []).map((row) => ({
      symbol: row.symbol,
      interval: FOOTPRINT_BASE_INTERVAL,
      cnt: Number(row.last_trade_time || 0) > 0 ? Math.max(1, Number(row.last_count || 0)) : 0,
      minT: null,
      maxT: Number(row.last_trade_time || 0),
      estimated: true,
      estimateSource: "footprint_sync_status",
    }));
    const derivativeCounts = (derivativeStatusRaw || []).map((row) => ({
      symbol: row.symbol,
      metric: row.metric,
      cnt: Number(row.last_count || 0),
      minT: null,
      maxT: null,
      estimated: true,
      estimateSource: "derivative_sync_status",
    }));
    return json(
      {
        ok: true,
        lightweight: true,
        detailEndpoint: "/api/d1/status?detail=1",
        workerBuild: WORKER_BUILD,
        generatedAt: Date.now(),
        dataSource: "cloudflare-d1-status",
        kline: {
          symbol: DEFAULT_SYMBOL,
          upstream: "Binance FAPI with Bybit linear and OKX swap failover",
          binanceOriginMode: binanceUpstreamMode(env),
          alternateFailover: klineAlternateFailoverEnabled(env),
          readEndpoint: "/api/d1/klines?symbol=BTCUSDT&interval=15m&limit=2000&sync=0",
          manualSyncEndpoint: "/api/d1/sync?symbol=BTCUSDT&interval=all&wait=1",
          readAutoSyncMinMs: KLINE_READ_AUTO_SYNC_MIN_MS,
          cron: "Workers Cron writes due intervals; Pages chart reads D1 and only queues repair when stale",
        },
        supportedIntervals: SUPPORTED_INTERVALS,
        maxPerInterval: MAX_KLINES_PER_INTERVAL,
        counts: klineCounts,
        status: statusRaw || [],
        footprint: {
          baseInterval: FOOTPRINT_BASE_INTERVAL,
          maxBaseBars: FOOTPRINT_MAX_BARS,
          apiMaxLimit: FOOTPRINT_API_MAX_LIMIT,
          counts: footprintCounts,
          status: footprintStatusRaw || [],
        },
        liquidation: {
          interval: "5m",
          retentionDays: 30,
          counts: [],
          lightweight: true,
        },
        derivatives: {
          retentionDays: 30,
          metrics: DERIVATIVE_METRICS,
          counts: derivativeCounts,
          status: derivativeStatusRaw,
          sourceHealth: derivativeSourceHealthRaw,
          workerBuild: WORKER_BUILD,
          binanceOriginMode: binanceUpstreamMode(env),
        },
      },
      200,
      { "Cache-Control": publicCacheHeader(STATUS_READ_CACHE_SECONDS, 60) }
    );
  }
  const { results: countsRaw } = await env.DB.prepare(
    "SELECT symbol, interval, COUNT(*) AS cnt, MIN(t) AS minT, MAX(t) AS maxT FROM klines GROUP BY symbol, interval"
  ).all();
  const { results: statusRaw } = await env.DB.prepare(
    "SELECT symbol, interval, last_run, last_t, last_count, last_ok, last_error FROM sync_status"
  ).all();
  const { results: footprintCountsRaw } = await env.DB.prepare(
    "SELECT symbol, interval, COUNT(*) AS cnt, MIN(t) AS minT, MAX(t) AS maxT FROM footprint_bars GROUP BY symbol, interval"
  ).all();
  const { results: footprintStatusRaw } = await env.DB.prepare(
    "SELECT symbol, last_run, last_trade_id, last_trade_time, last_count, last_ok, last_error FROM footprint_sync_status"
  ).all();
  let liquidationCountsRaw = [];
  try {
    const out = await env.DB.prepare(
      "SELECT symbol, exchange, COUNT(*) AS cnt, MIN(bucket_start) AS minT, MAX(bucket_start) AS maxT FROM liquidation_5m_buckets GROUP BY symbol, exchange"
    ).all();
    liquidationCountsRaw = out.results || [];
  } catch (_) {}
  let derivativeCountsRaw = [];
  let derivativeStatusRaw = [];
  try {
    const counts = await env.DB.prepare(
      "SELECT symbol, metric, COUNT(*) AS cnt, MIN(t) AS minT, MAX(t) AS maxT FROM derivative_timeseries GROUP BY symbol, metric"
    ).all();
    derivativeCountsRaw = counts.results || [];
    const status = await env.DB.prepare(
      "SELECT symbol, metric, last_run, last_count, last_ok, last_error FROM derivative_sync_status ORDER BY symbol, metric"
    ).all();
    derivativeStatusRaw = status.results || [];
  } catch (_) {}
  const derivativeSourceHealthRaw = await readDerivativeSourceHealthAllSafe(env);
  return json(
    {
      ok: true,
      workerBuild: WORKER_BUILD,
      generatedAt: Date.now(),
      dataSource: "cloudflare-d1",
      kline: {
        symbol: DEFAULT_SYMBOL,
        upstream: "Binance FAPI with Bybit linear and OKX swap failover",
        binanceOriginMode: binanceUpstreamMode(env),
        alternateFailover: klineAlternateFailoverEnabled(env),
        readEndpoint: "/api/d1/klines?symbol=BTCUSDT&interval=15m&limit=2000&sync=0",
        manualSyncEndpoint: "/api/d1/sync?symbol=BTCUSDT&interval=all&wait=1",
        readAutoSyncMinMs: KLINE_READ_AUTO_SYNC_MIN_MS,
        cron: "Workers Cron writes due intervals; Pages chart reads with sync=0",
      },
      supportedIntervals: SUPPORTED_INTERVALS,
      maxPerInterval: MAX_KLINES_PER_INTERVAL,
      counts: countsRaw || [],
      status: statusRaw || [],
      footprint: {
        baseInterval: FOOTPRINT_BASE_INTERVAL,
        maxBaseBars: FOOTPRINT_MAX_BARS,
        apiMaxLimit: FOOTPRINT_API_MAX_LIMIT,
        counts: footprintCountsRaw || [],
        status: footprintStatusRaw || [],
      },
      liquidation: {
        interval: "5m",
        retentionDays: 30,
        counts: liquidationCountsRaw,
      },
      derivatives: {
        retentionDays: 30,
        metrics: DERIVATIVE_METRICS,
        counts: derivativeCountsRaw,
        status: derivativeStatusRaw,
        sourceHealth: derivativeSourceHealthRaw,
        workerBuild: WORKER_BUILD,
        binanceOriginMode: binanceUpstreamMode(env),
      },
    },
    200,
    { "Cache-Control": publicCacheHeader(STATUS_READ_CACHE_SECONDS, 60) }
  );
}

/* =============================================================
 * 入口
 * ============================================================= */

export class LiquidationCollector {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.symbol = LIQUIDATION_SYMBOL;
    this.sources = {
      binance: this.emptySource("binance"),
      bybit: this.emptySource("bybit"),
    };
    this.buckets = new Map();
    this.lastFlushAt = 0;
    this.lastWritten = 0;
    this.lastPruned = 0;
    this.startedAt = 0;
    this.binanceWs = null;
    this.binanceProbeWs = null;
    this.bybitWs = null;
    this.bybitPingTimer = null;
    this.seenEventIds = new Set();
    this.seenEventQueue = [];
  }

  emptySource(exchange) {
    return {
      exchange,
      status: "idle",
      connectedAt: 0,
      lastMessageAt: 0,
      lastHeartbeatAt: 0,
      lastTransportAt: 0,
      lastMarketMessageAt: 0,
      lastEventAt: 0,
      messageCount: 0,
      heartbeatCount: 0,
      eventCount: 0,
      legacyEventCount: 0,
      lastLegacyEventAt: 0,
      ignoredCount: 0,
      parseErrorCount: 0,
      lastError: "",
      lastRawType: "",
      lastSubscribeAt: 0,
      lastSubscribeOk: 0,
      reconnectCount: 0,
      reconnectAt: 0,
    };
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/wake") {
      await this.ensureStarted();
      await this.flushClosedBuckets();
      return json({ ok: true, collector: this.statusSnapshot() }, 200, { "Cache-Control": "no-store" });
    }
    if (url.pathname === "/status") {
      await this.ensureStarted();
      return json({ ok: true, collector: this.statusSnapshot() }, 200, { "Cache-Control": "no-store" });
    }
    return json({ ok: false, error: "collector path not found" }, 404);
  }

  async alarm() {
    await this.ensureStarted();
    await this.flushClosedBuckets();
    this.lastPruned = await pruneLiquidationBuckets(this.env);
    await this.scheduleAlarm();
  }

  async ensureStarted() {
    if (!this.startedAt) this.startedAt = Date.now();
    if (!this.binanceWs) this.connectBinance();
    if (!this.binanceProbeWs) this.connectBinanceProbe();
    if (!this.bybitWs) this.connectBybit();
    this.checkStaleSources();
    await this.scheduleAlarm();
  }

  async scheduleAlarm() {
    if (this.state && this.state.storage && typeof this.state.storage.setAlarm === "function") {
      await this.state.storage.setAlarm(Date.now() + LIQUIDATION_ALARM_MS);
    }
  }

  sourceStatus(exchange, patch) {
    this.sources[exchange] = { ...this.sources[exchange], ...patch };
  }

  touchSource(exchange, patch) {
    const current = this.sources[exchange] || this.emptySource(exchange);
    const now = Date.now();
    this.sources[exchange] = {
      ...current,
      status: "realtime",
      lastMessageAt: now,
      lastMarketMessageAt: now,
      messageCount: (Number(current.messageCount) || 0) + 1,
      lastError: "",
      reconnectAt: 0,
      ...patch,
    };
  }

  touchHeartbeat(exchange, rawType) {
    const current = this.sources[exchange] || this.emptySource(exchange);
    const now = Date.now();
    this.sources[exchange] = {
      ...current,
      status: "realtime",
      lastHeartbeatAt: now,
      lastMarketMessageAt: now,
      heartbeatCount: (Number(current.heartbeatCount) || 0) + 1,
      lastRawType: rawType || current.lastRawType || "",
      lastError: "",
      reconnectAt: 0,
    };
  }

  touchTransport(exchange, rawType) {
    const current = this.sources[exchange] || this.emptySource(exchange);
    this.sources[exchange] = {
      ...current,
      status: "realtime",
      lastTransportAt: Date.now(),
      lastRawType: rawType || current.lastRawType || "",
      lastError: "",
      reconnectAt: 0,
    };
  }

  noteSubscribe(exchange, ok, detail) {
    const current = this.sources[exchange] || this.emptySource(exchange);
    this.sources[exchange] = {
      ...current,
      lastSubscribeAt: Date.now(),
      lastSubscribeOk: ok ? 1 : 0,
      lastError: ok ? "" : String(detail || "subscribe failed").slice(0, 160),
      lastRawType: "subscribe",
    };
  }

  noteParseError(exchange, e) {
    const current = this.sources[exchange] || this.emptySource(exchange);
    this.sources[exchange] = {
      ...current,
      parseErrorCount: (Number(current.parseErrorCount) || 0) + 1,
      lastError: (e && e.message ? e.message : String(e)).slice(0, 160),
    };
  }

  connectBinance() {
    if (typeof WebSocket === "undefined") {
      this.sourceStatus("binance", { status: "unavailable", lastError: "WebSocket unavailable" });
      return;
    }
    const url = "wss://fstream.binance.com/ws/!forceOrder@arr";
    this.sourceStatus("binance", { status: "connecting", lastError: "" });
    let ws;
    try {
      ws = new WebSocket(url);
      this.binanceWs = ws;
    } catch (e) {
      this.sourceStatus("binance", { status: "error", lastError: e?.message || String(e) });
      this.scheduleReconnect("binance");
      return;
    }
    ws.onopen = () => {
      if (ws !== this.binanceWs) return;
      this.sourceStatus("binance", { status: "realtime", connectedAt: Date.now(), lastError: "" });
    };
    ws.onmessage = (ev) => {
      if (ws !== this.binanceWs) return;
      try {
        const event = normalizeBinanceLiquidation(JSON.parse(ev.data));
        if (event && event.symbol === this.symbol) {
          this.touchSource("binance", {
            lastEventAt: Number(event.ts) || Date.now(),
            eventCount: (Number(this.sources.binance.eventCount) || 0) + 1,
            lastRawType: "all-market forceOrder",
          });
          this.ingest(event);
        } else {
          this.touchSource("binance", {
            ignoredCount: (Number(this.sources.binance.ignoredCount) || 0) + 1,
            lastRawType: "all-market forceOrder",
          });
        }
      } catch (e) {
        this.noteParseError("binance", e);
      }
    };
    ws.onerror = () => {
      if (ws !== this.binanceWs) return;
      this.sourceStatus("binance", { status: "error", lastError: "WS error" });
      try { ws.close(); } catch (_) {}
    };
    ws.onclose = () => {
      if (ws !== this.binanceWs) return;
      this.binanceWs = null;
      this.scheduleReconnect("binance");
    };
  }

  connectBinanceProbe() {
    if (typeof WebSocket === "undefined") return;
    const sym = this.symbol.toLowerCase();
    const url = `wss://fstream.binance.com/stream?streams=${sym}@aggTrade/${sym}@forceOrder`;
    let ws;
    try {
      ws = new WebSocket(url);
      this.binanceProbeWs = ws;
    } catch (e) {
      this.sourceStatus("binance", { status: "error", lastError: e?.message || String(e) });
      this.scheduleReconnect("binance-probe");
      return;
    }
    ws.onopen = () => {
      if (ws !== this.binanceProbeWs) return;
      this.touchHeartbeat("binance", "probe-open");
    };
    ws.onmessage = (ev) => {
      if (ws !== this.binanceProbeWs) return;
      try {
        const msg = JSON.parse(ev.data);
        const stream = String(msg.stream || "");
        const data = msg.data || msg;
        if (stream.endsWith("@aggTrade") || data.e === "aggTrade") {
          this.touchHeartbeat("binance", "aggTrade");
          return;
        }
        if (stream.endsWith("@forceOrder") || data.e === "forceOrder") {
          const event = normalizeBinanceLiquidation(data);
          this.touchSource("binance", { lastRawType: "single forceOrder" });
          if (event && event.symbol === this.symbol) {
            this.sourceStatus("binance", {
              lastEventAt: Number(event.ts) || Date.now(),
              eventCount: (Number(this.sources.binance.eventCount) || 0) + 1,
            });
            this.ingest(event);
          }
        }
      } catch (e) {
        this.noteParseError("binance", e);
      }
    };
    ws.onerror = () => {
      if (ws !== this.binanceProbeWs) return;
      this.sourceStatus("binance", { status: "error", lastError: "probe WS error" });
      try { ws.close(); } catch (_) {}
    };
    ws.onclose = () => {
      if (ws !== this.binanceProbeWs) return;
      this.binanceProbeWs = null;
      this.scheduleReconnect("binance-probe");
    };
  }

  connectBybit() {
    if (typeof WebSocket === "undefined") {
      this.sourceStatus("bybit", { status: "unavailable", lastError: "WebSocket unavailable" });
      return;
    }
    const url = "wss://stream.bybit.com/v5/public/linear";
    this.sourceStatus("bybit", { status: "connecting", lastError: "" });
    let ws;
    try {
      ws = new WebSocket(url);
      this.bybitWs = ws;
    } catch (e) {
      this.sourceStatus("bybit", { status: "error", lastError: e?.message || String(e) });
      this.scheduleReconnect("bybit");
      return;
    }
    ws.onopen = () => {
      if (ws !== this.bybitWs) return;
      this.sourceStatus("bybit", { status: "realtime", connectedAt: Date.now(), lastError: "" });
      try {
        ws.send(JSON.stringify({ op: "subscribe", req_id: "liq-all", args: [`allLiquidation.${this.symbol}`] }));
        ws.send(JSON.stringify({ op: "subscribe", req_id: "liq-ticker", args: [`tickers.${this.symbol}`] }));
        ws.send(JSON.stringify({ op: "subscribe", req_id: "liq-legacy", args: [`liquidation.${this.symbol}`] }));
      } catch (_) {}
      if (this.bybitPingTimer) clearInterval(this.bybitPingTimer);
      this.bybitPingTimer = setInterval(() => {
        if (ws !== this.bybitWs || ws.readyState !== WebSocket.OPEN) return;
        try { ws.send(JSON.stringify({ op: "ping" })); } catch (_) {}
      }, 20_000);
    };
    ws.onmessage = (ev) => {
      if (ws !== this.bybitWs) return;
      try {
        const msg = JSON.parse(ev.data);
        const rawType = String(msg.topic || msg.op || msg.type || "");
        if (/^tickers\./.test(rawType)) {
          this.touchHeartbeat("bybit", "ticker");
          return;
        }
        if (msg.op === "pong" || msg.ret_msg === "pong") {
          this.touchTransport("bybit", "pong");
          return;
        }
        if (msg.op === "subscribe") {
          const ok = msg.success !== false && Number(msg.retCode || 0) === 0;
          this.noteSubscribe("bybit", ok, msg.retMsg || msg.ret_msg || JSON.stringify(msg).slice(0, 120));
          return;
        }
        this.touchSource("bybit", { lastRawType: rawType || "control" });
        const rows = normalizeBybitLiquidation(msg).filter((event) => event.symbol === this.symbol);
        for (const event of rows) {
          this.sourceStatus("bybit", {
            lastEventAt: Number(event.ts) || Date.now(),
            eventCount: (Number(this.sources.bybit.eventCount) || 0) + 1,
          });
          this.ingest(event);
        }
        const legacyRows = normalizeBybitLegacyLiquidation(msg).filter((event) => event.symbol === this.symbol);
        if (legacyRows.length) {
          this.sourceStatus("bybit", {
            lastLegacyEventAt: Math.max(...legacyRows.map((event) => Number(event.ts) || 0)),
            legacyEventCount: (Number(this.sources.bybit.legacyEventCount) || 0) + legacyRows.length,
          });
        }
        for (const event of legacyRows) {
          this.sourceStatus("bybit", {
            lastEventAt: Number(event.ts) || Date.now(),
            eventCount: (Number(this.sources.bybit.eventCount) || 0) + 1,
          });
          this.ingest(event);
        }
      } catch (e) {
        this.noteParseError("bybit", e);
      }
    };
    ws.onerror = () => {
      if (ws !== this.bybitWs) return;
      this.sourceStatus("bybit", { status: "error", lastError: "WS error" });
      try { ws.close(); } catch (_) {}
    };
    ws.onclose = () => {
      if (ws !== this.bybitWs) return;
      if (this.bybitPingTimer) clearInterval(this.bybitPingTimer);
      this.bybitPingTimer = null;
      this.bybitWs = null;
      this.scheduleReconnect("bybit");
    };
  }

  scheduleReconnect(exchange) {
    const reconnectAt = Date.now() + LIQUIDATION_RECONNECT_MS;
    const sourceName = exchange === "binance-probe" ? "binance" : exchange;
    const current = this.sources[sourceName] || this.emptySource(sourceName);
    this.sourceStatus(sourceName, {
      status: "reconnecting",
      reconnectAt,
      reconnectCount: (Number(current.reconnectCount) || 0) + 1,
    });
    setTimeout(() => {
      if (exchange === "binance" && !this.binanceWs) this.connectBinance();
      if (exchange === "binance-probe" && !this.binanceProbeWs) this.connectBinanceProbe();
      if (exchange === "bybit" && !this.bybitWs) this.connectBybit();
    }, LIQUIDATION_RECONNECT_MS);
  }

  checkStaleSources() {
    this.checkOneStale("binance", this.binanceWs, LIQUIDATION_BINANCE_STALE_MS);
    this.checkOneStale("bybit", this.bybitWs, LIQUIDATION_BYBIT_STALE_MS);
  }

  checkOneStale(exchange, ws, staleMs) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const st = this.sources[exchange] || {};
    const last = Number(st.lastMarketMessageAt || st.lastEventAt || st.lastHeartbeatAt || st.lastTransportAt || st.lastMessageAt || st.connectedAt || 0);
    if (!last || Date.now() - last < staleMs) return;
    this.sourceStatus(exchange, {
      status: "error",
      lastError: `WS stale: ${Math.round((Date.now() - last) / 1000)}s no message`,
    });
    try { ws.close(); } catch (_) {}
  }

  ingest(event) {
    if (!event || event.symbol !== this.symbol) return;
    const eventId = `${event.exchange}:${event.symbol}:${event.ts}:${event.side}:${event.price}:${event.qty}`;
    if (this.seenEventIds.has(eventId)) return;
    this.seenEventIds.add(eventId);
    this.seenEventQueue.push(eventId);
    while (this.seenEventQueue.length > 1000) {
      const old = this.seenEventQueue.shift();
      this.seenEventIds.delete(old);
    }
    const bucketStart = liquidationBucketStart(event.ts);
    const key = `${event.exchange}:${bucketStart}`;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = emptyLiquidationBucket(event.symbol, event.exchange, bucketStart);
      this.buckets.set(key, bucket);
    }
    addLiquidationToBucket(bucket, event);
    this.flushClosedBuckets().catch((e) => console.warn("[liquidation] flush failed", e?.message || e));
  }

  async flushClosedBuckets(now = Date.now()) {
    const currentStart = liquidationBucketStart(now);
    const closed = [];
    for (const [key, bucket] of this.buckets.entries()) {
      if (Number(bucket.bucketStart) < currentStart) {
        closed.push(bucket);
        this.buckets.delete(key);
      }
    }
    if (!closed.length) return { written: 0, pruned: 0 };
    const out = await persistLiquidationBuckets(this.env, closed);
    this.lastFlushAt = Date.now();
    this.lastWritten += out.written || 0;
    this.lastPruned += out.pruned || 0;
    return out;
  }

  statusSnapshot() {
    const activeBucketRows = [...this.buckets.values()]
      .map(serializeActiveLiquidationBucket)
      .sort((a, b) => (Number(a.bucket_start) || 0) - (Number(b.bucket_start) || 0) || String(a.exchange || "").localeCompare(String(b.exchange || "")));
    const latestEventAt = Object.values(this.sources).reduce((m, src) => Math.max(m, Number(src && src.lastEventAt) || 0), 0);
    const latestMessageAt = Object.values(this.sources).reduce((m, src) => Math.max(
      m,
      Number(src && src.lastMarketMessageAt) || 0,
      Number(src && src.lastEventAt) || 0
    ), 0);
    return {
      symbol: this.symbol,
      startedAt: this.startedAt,
      activeBuckets: this.buckets.size,
      activeBucketRows,
      latestEventAt,
      latestMessageAt,
      lastFlushAt: this.lastFlushAt,
      lastWritten: this.lastWritten,
      lastPruned: this.lastPruned,
      sources: this.sources,
    };
  }
}

export const __footprintTestHooks = {
  FOOTPRINT_BASE_INTERVAL,
  FOOTPRINT_MAX_BARS,
  FOOTPRINT_API_MAX_LIMIT,
  FOOTPRINT_MAX_FETCH_PAGES,
  FOOTPRINT_BACKFILL_MAX_WINDOWS,
  FOOTPRINT_READ_AUTO_SYNC_MIN_MS,
  LIQUIDATION_BUCKET_MS,
  LIQUIDATION_RETENTION_MS,
  isFootprintTailStaleForRead,
  recentlyTriedFootprintSync,
  resolveFootprintTickSize,
  mergeFootprintRows,
  recomputeFootprintBar,
  liquidationBucketStart,
  normalizeBinanceLiquidation,
  normalizeBybitLiquidation,
  normalizeBybitLegacyLiquidation,
  emptyLiquidationBucket,
  addLiquidationToBucket,
  serializeLiquidationBucket,
  serializeActiveLiquidationBucket,
  liquidationFreshness,
  parseBinanceApiBody,
  classifyBinanceFapiFailure,
  BINANCE_DERIVATIVE_HOSTS,
  binanceDerivativeFapiOrigins,
  shouldStopDerivativeOriginRetry,
  derivativeSourceCooldownState,
  derivativeStaleLimitWorker,
  derivativeTaskHealthKey,
  derivativeTaskRunnable,
  resolveDerivativeSyncFlagGroups,
  derivativeSyncGroupForStaleCoreKeys,
};

export default {
  /**
   * @param {Request} request
   * @param {object} env
   * @param {ExecutionContext} ctx
   */
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headersMerge() });
    if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "POST") {
      return json({ error: "Method Not Allowed" }, 405);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    const accessDenied = await requireCloudflareAccess(request, env, json);
    if (accessDenied) return accessDenied;

    if (path === "/api/d1/klines") return handleReadKlines(request, env, url);
    if (path === "/api/d1/sync") return handleManualSync(request, env, url, ctx);
    if (path === "/api/d1/status") return handleStatus(request, env, url);
    if (path === "/api/d1/footprint") return handleReadFootprint(request, env, url, ctx);
    if (path === "/api/d1/footprint/sync") return handleManualFootprintSync(request, env, url, ctx);
    if (path === "/api/d1/liquidations") return handleReadLiquidations(request, env, url);
    if (path === "/api/d1/liquidations/status") return handleLiquidationCollectorStatus(env);
    if (path === "/api/d1/liquidations/wake") return handleLiquidationWake(env);
    if (path === "/api/d1/derivatives") return handleReadDerivatives(request, env, url, ctx);
    if (path === "/api/d1/derivatives/sync") return handleManualDerivativesSync(request, env, url, ctx);
    if (path === "/api/d1/derivatives/status") return handleDerivativesStatus(request, env);
    if (path === "/api/d1/derivatives/origin-check") return handleDerivativesOriginProbe(request, env);
    if (path === "/api/d1/onchain") return handleReadOnchain(request, env, url);
    if (path === "/api/ai/llm-status") return handleAiLlmStatus(request, env);
    if (path === "/api/ai/derivatives-snapshot") return handleDerivativesSnapshot(request, env, url);

    const isLegacyProxy =
      path === "/api/binance/klines" ||
      path === "/fapi/v1/klines" ||
      path.endsWith("/fapi/v1/klines");
    if (isLegacyProxy) return handleProxyKlines(request, env, url);

    const isAggTradesProxy =
      path === "/api/binance/aggTrades" ||
      path === "/fapi/v1/aggTrades" ||
      path.endsWith("/fapi/v1/aggTrades");
    if (isAggTradesProxy) return handleProxyAggTrades(request, env, url);

    if (path === "/api/binance/ticker/price") return handleProxyTickerPrice(request, env, url);

    return json(
      {
        error: "path not found",
        hint:
          "GET /api/d1/klines?symbol=BTCUSDT&interval=15m  |  /api/binance/ticker/price?symbol=BTCUSDT  |  /api/d1/footprint?symbol=BTCUSDT&interval=5m  |  /api/d1/liquidations?symbol=BTCUSDT&range=30d  |  /api/d1/derivatives?symbol=BTCUSDT&range=30d  |  /api/ai/derivatives-snapshot?profile=brief  |  /api/ai/llm-status  |  /api/d1/status",
      },
      404
    );
  },

  /**
   * Cron 触发：每分钟一次。按当前 UTC 时间决定需要同步的 K 线周期。
   * @param {{scheduledTime: number, cron: string}} event
   * @param {object} env
   * @param {ExecutionContext} ctx
   */
  async scheduled(event, env, ctx) {
    const time = new Date(event?.scheduledTime || Date.now());
    const due = intervalsDueAt(time);

    const symbols = getConfiguredSymbols(env);
    const run = async () => {
      const summary = [];
      const liq = await handleLiquidationWake(env).then((r) => r.json()).catch((e) => ({ ok: false, error: e?.message || String(e) }));
      const liqPruned = await pruneLiquidationBuckets(env);
      summary.push(
        liq.ok
          ? `liquidation:collector ok prune=${liqPruned}`
          : `liquidation:collector fail ${liq.error || ""} prune=${liqPruned}`
      );
      for (const symbol of symbols) {
        const der = await syncDerivativesIfDue(env, symbol, time);
        if (!der.skipped) {
          summary.push(
            der.ok
              ? `${symbol}/derivatives:ok points=${der.written || 0} options=${der.optionWritten || 0}`
              : `${symbol}/derivatives:fail ${der.error || ""}`
          );
        }
        const fp = await syncFootprintOne(env, symbol);
        summary.push(
          fp.ok
            ? `${symbol}/footprint:ok got=${fp.fetched || 0} written=${fp.written || 0}`
            : `${symbol}/footprint:fail ${fp.error || ""}`
        );
        for (const interval of due) {
          const r = await syncKlinesOne(env, symbol, interval);
          summary.push(
            r.ok
              ? `${symbol}/${interval}:ok ins=${r.inserted} prune=${r.pruned}${r.bulkFill ? " bulk" : ""}`
              : `${symbol}/${interval}:fail ${r.error || ""}`
          );
        }
      }
      const oc = await syncOnchainIfDue(env, time);
      if (!oc.skipped) {
        summary.push(
          oc.ok
            ? `onchain:ok written=${oc.written ?? 0} pruned=${oc.pruned ?? 0}`
            : `onchain:fail ${((oc.errors && oc.errors.join(";")) || oc.error || "unknown").slice(0, 120)}`
        );
      }
      console.log(`[cron ${time.toISOString()}] due=${due.join(",")} → ${summary.join(" | ")}`);
    };

    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(run());
    else await run();
  },
};
