import {
  buildChartStructureLlmPayload,
  CHART_STRUCTURE_DEFAULT_PARAMS,
  computeSnapshotChartStructureLevels,
  mergeChartHigherFromRows,
  resolveChartHigherInterval,
} from "./chartStructureSnapshot.mjs";

const PROGRAM_VERSION = "market-desk-1.1.0";
const DEFAULT_SYMBOL = "BTCUSDT";
const MS_MIN = 60 * 1000;
const MS_HOUR = 60 * MS_MIN;
const MS_DAY = 24 * MS_HOUR;

const CHART_INTERVALS = ["5m", "15m", "1h", "4h", "1d"];
/** 不小于 indicator-math 窗口目标 + 小幅余量，供摆动结构算法使用 */
const CHART_READ_LIMITS = Object.freeze({
  "5m": 900,
  "15m": 520,
  "1h": 380,
  "4h": 400,
  "1d": 240,
});
const DERIVATIVE_METRICS = [
  "funding_binance",
  "oi_binance",
  "long_short",
  "taker_buy_sell",
  "basis_perp",
  "basis_quarter",
  "top_account_long_short",
  "top_position_long_short",
  "vix",
  "vix3m",
  "move",
];

const AGENT_PAGE_MAP = {
  env: ["chart", "derivatives"],
  flow: ["orderflow", "heatmap", "chart"],
  deriv: ["derivatives"],
  risk: ["heatmap"],
  chief: ["chart", "orderflow", "heatmap", "derivatives"],
};

export {
  AGENT_PAGE_MAP,
  CHART_INTERVALS,
  DERIVATIVE_METRICS,
  DEFAULT_SYMBOL,
  PROGRAM_VERSION,
};

function nowMs(options) {
  return Number.isFinite(Number(options && options.nowMs)) ? Number(options.nowMs) : Date.now();
}

function iso(ms) {
  return Number.isFinite(Number(ms)) && Number(ms) > 0 ? new Date(Number(ms)).toISOString() : null;
}

function num(v, fallback = null) {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round(v, digits = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

function pct(from, to) {
  const a = Number(from);
  const b = Number(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null;
  return round(((b - a) / Math.abs(a)) * 100, 2);
}

function clamp(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, n));
}

function parseJsonSafe(text, fallback = {}) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch (_) {
    return fallback;
  }
}

function latestByTime(rows, key = "t") {
  const list = Array.isArray(rows) ? rows : [];
  let best = null;
  for (const row of list) {
    if (!row) continue;
    const t = Number(row[key]);
    if (!Number.isFinite(t)) continue;
    if (!best || t > Number(best[key])) best = row;
  }
  return best;
}

function requireDb(env) {
  const db = env && (env.BTC_DB || env.DB);
  if (!db || typeof db.prepare !== "function") {
    throw new Error("BTC_DB binding missing");
  }
  return db;
}

async function d1All(db, sql, params = []) {
  const stmt = params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
  const res = await stmt.all();
  return Array.isArray(res && res.results) ? res.results : [];
}

function chartReadLimitForInterval(interval) {
  const key = String(interval || "").toLowerCase();
  return CHART_READ_LIMITS[key] != null ? CHART_READ_LIMITS[key] : 320;
}

async function readKlines(db, symbol, interval, limit = 240) {
  const rows = await d1All(
    db,
    "SELECT t, o, h, l, c, v FROM klines WHERE symbol = ?1 AND interval = ?2 ORDER BY t DESC LIMIT ?3",
    [symbol, interval, limit],
  );
  return rows
    .map((row) => ({
      t: num(row.t),
      o: num(row.o),
      h: num(row.h),
      l: num(row.l),
      c: num(row.c),
      v: num(row.v, 0),
    }))
    .filter((row) => Number.isFinite(row.t) && Number.isFinite(row.c))
    .sort((a, b) => a.t - b.t);
}

async function readFootprintBars(db, symbol, limit = 288) {
  const rows = await d1All(
    db,
    "SELECT t, o, h, l, c, buy_vol, sell_vol, delta, volume, poc_price, updated_at FROM footprint_bars WHERE symbol = ?1 AND interval = '5m' ORDER BY t DESC LIMIT ?2",
    [symbol, limit],
  );
  return rows
    .map((row) => ({
      t: num(row.t),
      o: num(row.o),
      h: num(row.h),
      l: num(row.l),
      c: num(row.c),
      buyVol: num(row.buy_vol, 0),
      sellVol: num(row.sell_vol, 0),
      delta: num(row.delta, 0),
      volume: num(row.volume, 0),
      pocPrice: num(row.poc_price),
      updatedAt: num(row.updated_at),
    }))
    .filter((row) => Number.isFinite(row.t))
    .sort((a, b) => a.t - b.t);
}

async function readLiquidationBuckets(db, symbol, limit = 864) {
  const rows = await d1All(
    db,
    "SELECT symbol, exchange, bucket_start, long_notional, short_notional, long_count, short_count, max_notional, max_side, min_price, max_price, vwap_price, updated_at FROM liquidation_5m_buckets WHERE symbol = ?1 ORDER BY bucket_start DESC LIMIT ?2",
    [symbol, limit],
  );
  return rows
    .map((row) => ({
      symbol: row.symbol || symbol,
      exchange: row.exchange || "",
      bucketStart: num(row.bucket_start),
      longNotional: num(row.long_notional, 0),
      shortNotional: num(row.short_notional, 0),
      longCount: num(row.long_count, 0),
      shortCount: num(row.short_count, 0),
      maxNotional: num(row.max_notional, 0),
      maxSide: row.max_side || "",
      minPrice: num(row.min_price),
      maxPrice: num(row.max_price),
      vwapPrice: num(row.vwap_price),
      updatedAt: num(row.updated_at),
    }))
    .filter((row) => Number.isFinite(row.bucketStart))
    .sort((a, b) => a.bucketStart - b.bucketStart);
}

async function readDerivativeSeries(db, symbol, rangeMs = 30 * MS_DAY, now = Date.now()) {
  const since = now - rangeMs;
  const rows = await d1All(
    db,
    "SELECT symbol, metric, t, value, source, extra_json FROM derivative_timeseries WHERE symbol = ?1 AND t >= ?2 ORDER BY metric, t ASC",
    [symbol, since],
  );
  const series = {};
  for (const metric of DERIVATIVE_METRICS) series[metric] = [];
  for (const row of rows) {
    if (!row || !DERIVATIVE_METRICS.includes(String(row.metric))) continue;
    series[row.metric].push({
      t: num(row.t),
      value: num(row.value),
      source: row.source || "",
      extra: parseJsonSafe(row.extra_json, {}),
    });
  }
  return series;
}

async function readDerivativeHealth(db, symbol) {
  const [sourceHealth, metricHealth] = await Promise.all([
    d1All(
      db,
      "SELECT source, last_run, last_ok, last_error_kind, last_error, cooldown_until_ms, consecutive_failures, last_success_at_ms, extra_json FROM derivative_source_health ORDER BY source ASC",
      [],
    ).catch(() => []),
    d1All(
      db,
      "SELECT symbol, metric, last_attempt_at_ms, last_success_at_ms, next_allowed_at_ms, consecutive_failures, last_error_kind, last_error, extra_json FROM derivative_metric_health WHERE symbol = ?1 ORDER BY metric ASC",
      [symbol],
    ).catch(() => []),
  ]);
  return { sourceHealth, metricHealth };
}

function freshnessFromLatest(latestT, now, staleMs, label, warnings = []) {
  const latest = num(latestT);
  const stale = Number.isFinite(latest) ? Math.max(0, now - latest) : null;
  const sourceOk = Number.isFinite(stale) && stale <= staleMs;
  const outWarnings = warnings.slice();
  if (!Number.isFinite(latest)) outWarnings.push(`${label} no data`);
  else if (!sourceOk) outWarnings.push(`${label} stale ${Math.round(stale / MS_MIN)}m`);
  return {
    latestT: latest,
    latestTime: iso(latest),
    staleMs: stale,
    sourceOk,
    status: sourceOk ? "fresh" : "degraded",
    warnings: outWarnings,
  };
}

function summarizeKlines(rows, interval, now) {
  const list = Array.isArray(rows) ? rows : [];
  const first = list[0];
  const latest = list[list.length - 1];
  if (!latest) {
    return {
      interval,
      sampleSize: 0,
      latestClose: null,
      changePct: null,
      high: null,
      low: null,
      rangePositionPct: null,
      trend: "missing",
      latestT: null,
      freshness: freshnessFromLatest(null, now, MS_HOUR, `klines ${interval}`),
    };
  }
  const highs = list.map((row) => num(row.h)).filter(Number.isFinite);
  const lows = list.map((row) => num(row.l)).filter(Number.isFinite);
  const high = highs.length ? Math.max(...highs) : null;
  const low = lows.length ? Math.min(...lows) : null;
  const changePct = pct(first && first.c, latest.c);
  const rangePositionPct =
    Number.isFinite(high) && Number.isFinite(low) && high > low
      ? round(((latest.c - low) / (high - low)) * 100, 1)
      : null;
  const trend = changePct == null ? "unknown" : changePct > 0.35 ? "up" : changePct < -0.35 ? "down" : "range";
  const staleMs = interval === "5m" ? 30 * MS_MIN : interval === "15m" ? 60 * MS_MIN : interval === "1h" ? 3 * MS_HOUR : 2 * MS_DAY;
  return {
    interval,
    sampleSize: list.length,
    latestClose: round(latest.c, 2),
    changePct,
    high: round(high, 2),
    low: round(low, 2),
    rangePositionPct: clamp(rangePositionPct, 0, 100),
    trend,
    latestT: latest.t,
    latestTime: iso(latest.t),
    volumeSum: round(list.reduce((sum, row) => sum + (num(row.v, 0) || 0), 0), 2),
    freshness: freshnessFromLatest(latest.t, now, staleMs, `klines ${interval}`),
  };
}

function summarizeOrderflowBars(bars, now) {
  const list = Array.isArray(bars) ? bars : [];
  const latest = list[list.length - 1];
  const windowBars = list.slice(-48);
  const buy = windowBars.reduce((sum, row) => sum + (num(row.buyVol, 0) || 0), 0);
  const sell = windowBars.reduce((sum, row) => sum + (num(row.sellVol, 0) || 0), 0);
  const delta = buy - sell;
  const volume = buy + sell;
  const top = windowBars
    .filter((row) => Number.isFinite(num(row.pocPrice)) && Number.isFinite(num(row.volume)))
    .sort((a, b) => Number(b.volume) - Number(a.volume))[0];
  const deltaPct = volume > 0 ? round((delta / volume) * 100, 2) : null;
  const bias = deltaPct == null ? "missing" : deltaPct > 8 ? "buy" : deltaPct < -8 ? "sell" : "neutral";
  const latestT = latest ? latest.updatedAt || latest.t : null;
  return {
    sampleSize: list.length,
    visibleBars: windowBars.length,
    latestBar: latest
      ? {
          t: latest.t,
          time: iso(latest.t),
          close: round(latest.c, 2),
          delta: round(latest.delta, 4),
          buyVol: round(latest.buyVol, 4),
          sellVol: round(latest.sellVol, 4),
          pocPrice: round(latest.pocPrice, 2),
        }
      : null,
    window: {
      buyVol: round(buy, 4),
      sellVol: round(sell, 4),
      delta: round(delta, 4),
      deltaPct,
      bias,
      pocPrice: top ? round(top.pocPrice, 2) : null,
    },
    dashboard: {
      primary: bias === "buy" ? "aggTrade 主动买量大于卖量（近似，非 CVD）" : bias === "sell" ? "aggTrade 主动卖量大于买量（近似，非 CVD）" : bias === "neutral" ? "主动买卖量接近" : "样本不足",
      activeKey: bias === "neutral" ? "volumeProfile" : "imbalance",
      cards: [
        { key: "imbalance", label: "买卖失衡", state: bias, value: deltaPct },
        { key: "volumeProfile", label: "成交集中", state: top ? "available" : "missing", value: top ? round(top.pocPrice, 2) : null },
      ],
    },
    freshness: freshnessFromLatest(latestT, now, 45 * MS_MIN, "footprint"),
  };
}

function sumLiquidations(rows, since) {
  const filtered = rows.filter((row) => Number(row.bucketStart) >= since);
  const longNotional = filtered.reduce((sum, row) => sum + (num(row.longNotional, 0) || 0), 0);
  const shortNotional = filtered.reduce((sum, row) => sum + (num(row.shortNotional, 0) || 0), 0);
  const max = filtered.slice().sort((a, b) => Number(b.maxNotional || 0) - Number(a.maxNotional || 0))[0] || null;
  return {
    bucketCount: filtered.length,
    longNotional: round(longNotional, 2),
    shortNotional: round(shortNotional, 2),
    maxNotional: max ? round(max.maxNotional, 2) : null,
    maxSide: max ? max.maxSide || null : null,
    maxPrice: max ? round(max.vwapPrice || max.maxPrice || max.minPrice, 2) : null,
  };
}

function groupLiquidationsByExchange(rows) {
  const out = {};
  for (const row of rows || []) {
    const ex = String(row.exchange || "unknown").toLowerCase() || "unknown";
    if (!out[ex]) out[ex] = [];
    out[ex].push(row);
  }
  return out;
}

function summarizeLiquidations(rows, now) {
  const latest = latestByTime(rows, "bucketStart");
  const grouped = groupLiquidationsByExchange(rows);
  const byExchange = {};
  for (const [ex, exRows] of Object.entries(grouped)) {
    byExchange[ex] = {
      "1h": sumLiquidations(exRows, now - MS_HOUR),
      "24h": sumLiquidations(exRows, now - MS_DAY),
    };
  }
  return {
    sampleSize: rows.length,
    combinedTotalsForbidden: true,
    byExchange,
    pressure: {
      omitted: true,
      reason: "cross-venue heuristic scores are not an authoritative liquidation map",
    },
    freshness: freshnessFromLatest(latest ? latest.updatedAt || latest.bucketStart : null, now, 2 * MS_HOUR, "liquidations"),
  };
}

function seriesLatest(series, metric) {
  return latestByTime((series && series[metric] || []).filter(row => num(row.value) != null), "t");
}

function changeOver(series, metric, windowMs, now) {
  const allRows = (series && series[metric] ? series[metric] : []).filter((row) => Number.isFinite(num(row.t)) && num(row.value) != null);
  const latest = latestByTime(allRows, "t");
  if (!latest) return null;
  const family = String(latest.source || "").split("-")[0];
  const rows = allRows.filter(row => String(row.source || "").split("-")[0] === family).sort((a,b) => Number(a.t)-Number(b.t));
  const target = now - windowMs;
  let base = null;
  for (const row of rows) {
    if (Number(row.t) <= target) base = row;
  }
  if (!base) return null;
  return {
    fromT: base ? base.t : null,
    toT: latest.t,
    fromValue: base ? round(base.value, 6) : null,
    toValue: round(latest.value, 6),
    changePct: base ? pct(base.value, latest.value) : null,
  };
}

function summarizeDerivatives(series, health, now) {
  const funding = seriesLatest(series, "funding_binance");
  const oi = seriesLatest(series, "oi_binance");
  const taker = seriesLatest(series, "taker_buy_sell");
  const basisQuarter = seriesLatest(series, "basis_quarter");
  const topAccount = seriesLatest(series, "top_account_long_short");
  const topPosition = seriesLatest(series, "top_position_long_short");
  const longShort = seriesLatest(series, "long_short");
  const vix = seriesLatest(series, "vix");
  const vix3m = seriesLatest(series, "vix3m");
  const latestTs = [funding, oi, taker, basisQuarter, topAccount, topPosition, longShort]
    .map((row) => row && num(row.t))
    .filter(Number.isFinite);
  const oldestCore = latestTs.length ? Math.min(...latestTs) : null;
  const fundingValue = funding ? num(funding.value) : null;
  const takerValue = taker ? num(taker.value) : null;
  const basisValue = basisQuarter ? num(basisQuarter.value) : null;
  const oi24h = changeOver(series, "oi_binance", MS_DAY, now);
  const fundingState = fundingValue == null ? "missing" : Math.abs(fundingValue) >= 0.0005 ? "crowded" : "normal";
  const takerState = takerValue == null ? "missing" : takerValue >= 1.1 ? "buy_imbalanced" : takerValue <= 0.9 ? "sell_imbalanced" : "balanced";
  return {
    matrix: [
      { metric: "funding", state: fundingState, value: round(fundingValue, 8), source: funding ? funding.source : "" },
      { metric: "oi", state: !oi24h ? "missing" : oi24h.changePct > 3 ? "expanding" : oi24h && oi24h.changePct < -3 ? "contracting" : "neutral", value: oi24h ? oi24h.changePct : null },
      { metric: "taker", state: takerState, value: round(takerValue, 4), source: taker ? taker.source : "" },
      { metric: "basis", state: basisValue == null ? "missing" : basisValue > 8 ? "elevated" : basisValue < -1 ? "discount" : "normal", value: round(basisValue, 4) },
      { metric: "top_trader", state: "reference", value: round(topPosition ? topPosition.value : null, 4), account: round(topAccount ? topAccount.value : null, 4) },
      { metric: "long_short", state: !longShort ? "missing" : Number(longShort.value) > 1.05 ? "long_bias" : longShort && Number(longShort.value) < 0.95 ? "short_bias" : "balanced", value: round(longShort ? longShort.value : null, 4) },
    ],
    macro: {
      vix: vix ? round(vix.value, 2) : null,
      vix3m: vix3m ? round(vix3m.value, 2) : null,
      vixTerm: vix && vix3m && Number(vix3m.value) ? round(Number(vix.value) / Number(vix3m.value), 3) : null,
      weight: "low",
    },
    changes: {
      oi24h,
      funding24h: changeOver(series, "funding_binance", MS_DAY, now),
      taker24h: changeOver(series, "taker_buy_sell", MS_DAY, now),
    },
    health: {
      sourceHealthCount: Array.isArray(health && health.sourceHealth) ? health.sourceHealth.length : 0,
      metricHealthCount: Array.isArray(health && health.metricHealth) ? health.metricHealth.length : 0,
      metricWarnings: (health && health.metricHealth ? health.metricHealth : [])
        .filter((row) => row && row.last_error)
        .slice(0, 8)
        .map((row) => `${row.metric}: ${String(row.last_error).slice(0, 100)}`),
    },
    freshness: freshnessFromLatest(oldestCore, now, 3 * MS_HOUR, "derivatives core"),
  };
}

function pageErrorSnapshot(scope, err, generatedAt, symbol) {
  const message = err && err.message ? err.message : String(err);
  return {
    page: scope,
    scope,
    symbol,
    snapshotVersion: `${scope}-error-1.0.0`,
    generatedAt,
    dataFreshness: {
      latestT: null,
      latestTime: null,
      staleMs: null,
      sourceOk: false,
      status: "error",
      warnings: [message],
    },
    notableConflicts: [],
    llmBrief: `${scope} 快照生成失败：${message}`,
    error: message,
  };
}

export async function buildChartSnapshot(env, options = {}) {
  const db = requireDb(env);
  const symbol = String(options.symbol || DEFAULT_SYMBOL).toUpperCase();
  const now = nowMs(options);
  const generatedAt = iso(now);
  const intervals = options.intervals || CHART_INTERVALS;
  const rowsByInterval = {};
  for (const interval of intervals) {
    rowsByInterval[interval] = [];
  }
  const summaries = intervals.map((interval) => summarizeKlines([], interval, now));
  const activeInterval = String(options.activeInterval || "1h").toLowerCase();
  const current = {
    interval: activeInterval,
    latestClose: null,
    trend: null,
    rangePositionPct: null,
    sampleSize: 0,
    high: null,
    low: null,
    latestT: 0,
    freshness: { sourceOk: false, staleMs: null, warnings: ["authoritative Binance klines unavailable; P5 klines are analysis-forbidden"] },
  };
  const chartStructureForLlm = { omitted: true, reason: "no_authoritative_binance_klines" };
  return {
    page: "行情工作台",
    scope: "chart",
    symbol,
    snapshotVersion: "chart-unified-1.2.0-desk",
    generatedAt,
    asKnownMode: "system_observed",
    pricePathAvailable: false,
    tradingNarrative: false,
    dataSource: { primary: "finance_dataset_observations", refused: ["BTC_DB.klines"] },
    chartStructureForLlm,
    currentView: {
      tier: "raw_fact",
      symbol,
      interval: current.interval,
      latestClose: null,
      trend: null,
      rangePositionPct: null,
      note: "无权威币安 K 线；遗留 klines 表禁读。不得输出交易向段落。",
    },
    currentViewTabs: {
      price: { ...current, tier: "raw_fact" },
      structure: { omitted: true, reason: "no_authoritative_binance_klines" },
    },
    multiTimeframeSummary: summaries,
    analysisMatrix: {
      description: "主带缺失，不提供多周期倾向",
      rows: [],
    },
    dataFreshness: {
      latestT: null,
      latestTime: null,
      staleMs: null,
      sourceOk: false,
      status: "missing",
      warnings: current.freshness.warnings,
    },
    notableConflicts: [],
    llmBrief: "pricePathAvailable=false; asKnownMode=system_observed; no trading narrative.",
    sourceFingerprint: `chart:${symbol}:missing`,
  };
}

export async function buildOrderflowSnapshot(env, options = {}) {
  const db = requireDb(env);
  const symbol = String(options.symbol || DEFAULT_SYMBOL).toUpperCase();
  const now = nowMs(options);
  const generatedAt = iso(now);
  const bars = await readFootprintBars(db, symbol, 288);
  const klines = [];
  const summary = summarizeOrderflowBars(bars, now);
  const warnings = [...summary.freshness.warnings].slice(0, 8);
  return {
    page: "订单流与足迹图",
    scope: "orderflow",
    symbol,
    snapshotVersion: "orderflow-unified-1.0.1-desk",
    generatedAt,
    tradingNarrative: false,
    dataSource: { primary: "BTC_DB.footprint_bars", tables: ["footprint_bars"], refused: ["klines"] },
    currentView: {
      symbol,
      interval: "5m",
      visibleBars: summary.visibleBars,
      tickSize: "compact",
      note: "delta is aggTrade taker-volume approximation, not CVD",
    },
    currentViewTabs: {
      imbalance: summary.dashboard.cards.find((row) => row.key === "imbalance"),
      volumeProfile: summary.dashboard.cards.find((row) => row.key === "volumeProfile"),
      keyLevels: { omitted: true, reason: "no_authoritative_binance_klines" },
      sfp: { status: "not_evaluated", reason: "unified compact snapshot" },
    },
    currentDashboard: summary.dashboard,
    readModel: {
      summary: summary.dashboard.primary,
      latestBar: summary.latestBar,
      window: summary.window,
    },
    multiTimeframeSummary: [
      { interval: "5m", dashboard: summary.dashboard, sourceOk: summary.freshness.sourceOk },
    ],
    dataFreshness: {
      ...summary.freshness,
      sourceOk: summary.freshness.sourceOk,
      warnings,
    },
    notableConflicts: [],
    llmBrief: `orderflow ${symbol}: ${summary.visibleBars} footprint bars; delta is aggTrade taker-volume approximation, not CVD.`,
    sourceFingerprint: `orderflow:${symbol}:${summary.latestBar ? summary.latestBar.t : 0}`,
  };
}

export async function buildHeatmapSnapshot(env, options = {}) {
  const db = requireDb(env);
  const symbol = String(options.symbol || DEFAULT_SYMBOL).toUpperCase();
  const now = nowMs(options);
  const generatedAt = iso(now);
  const rows = await readLiquidationBuckets(db, symbol, 864);
  const summary = summarizeLiquidations(rows, now);
  return {
    page: "强平雷达",
    scope: "heatmap",
    symbol,
    snapshotVersion: "heatmap-unified-1.1.1-desk",
    generatedAt,
    tradingNarrative: false,
    combinedTotalsForbidden: true,
    dataSource: { primary: "BTC_DB.liquidation_5m_buckets", tables: ["liquidation_5m_buckets"], refused: ["derivative_timeseries"] },
    currentView: {
      symbol,
      window: "24h",
      bucketSize: "5m-d1",
      note: "realized notional split by exchange; combined totals forbidden",
    },
    currentViewTabs: {
      realtimeRadar: { omitted: true, reason: "browser live stream is not the authority path" },
      pressureMatrix: {
        omitted: true,
        reason: "cross-venue heuristic scores are not an authoritative liquidation map",
      },
    },
    analysisMatrix: {
      description: "分所已实现强平；禁止跨所合计",
      rows: Object.entries(summary.byExchange || {}).flatMap(([exchange, windows]) =>
        Object.entries(windows || {}).map(([window, row]) => ({ exchange, window, ...row }))
      ),
    },
    dataFreshness: summary.freshness,
    notableConflicts: [],
    llmBrief: `liquidations byExchange=${Object.keys(summary.byExchange || {}).join(",") || "none"}; combinedTotalsForbidden; no pressure scenario.`,
    sourceFingerprint: `heatmap:${symbol}:${summary.freshness.latestT || 0}:${rows.length}`,
  };
}

export async function buildDerivativesSnapshot(env, options = {}) {
  const db = requireDb(env);
  const symbol = String(options.symbol || DEFAULT_SYMBOL).toUpperCase();
  const now = nowMs(options);
  const generatedAt = iso(now);
  void db;
  return {
    page: "环境背景",
    scope: "derivatives",
    symbol,
    snapshotVersion: "derivatives-unified-1.1.1-desk",
    generatedAt,
    tradingNarrative: false,
    dataSource: { primary: "finance_dataset_observations", refused: ["BTC_DB.derivative_timeseries"] },
    currentView: {
      symbol,
      range: "30d",
      usedPayloadFreshness: false,
      note: "contract group empty until Binance cloud path recovers",
    },
    currentViewTabs: {
      funding: { omitted: true, reason: "binance_cloud_path_missing" },
      openInterest: { omitted: true, reason: "binance_cloud_path_missing" },
      taker: { omitted: true, reason: "binance_cloud_path_missing" },
      basis: { omitted: true, reason: "binance_cloud_path_missing" },
      topTrader: { omitted: true, reason: "binance_cloud_path_missing" },
      longShort: { omitted: true, reason: "binance_cloud_path_missing" },
      macro: { omitted: true, reason: "use /api/desk/context frequency groups" },
    },
    analysisMatrix: {
      description: "合约状态在币安云端路径缺失时整组空",
      rows: [],
    },
    dataFreshness: {
      latestT: null,
      latestTime: null,
      staleMs: null,
      sourceOk: false,
      status: "missing",
      warnings: ["P5 derivative_timeseries is analysis-forbidden"],
    },
    notableConflicts: [],
    llmBrief: "contract group empty until Binance cloud path recovers; no crowding or dominance labels.",
    sourceFingerprint: `derivatives:${symbol}:omitted`,
  };
}

function collectFreshness(pages) {
  const rows = Object.values(pages || {}).map((page) => page && page.dataFreshness).filter(Boolean);
  const latestTs = rows.map((row) => num(row.latestT)).filter(Number.isFinite);
  const warnings = rows.flatMap((row) => row.warnings || []).slice(0, 16);
  return {
    latestT: latestTs.length ? Math.max(...latestTs) : null,
    latestTime: latestTs.length ? iso(Math.max(...latestTs)) : null,
    sourceOk: rows.length > 0 && rows.every((row) => !!row.sourceOk),
    degradedPages: Object.entries(pages || {})
      .filter(([, page]) => !(page && page.dataFreshness && page.dataFreshness.sourceOk))
      .map(([key]) => key),
    warnings,
  };
}

function detectConflicts(pages) {
  const conflicts = [];
  const chartTrend = pages.chart && pages.chart.currentView ? pages.chart.currentView.trend : "";
  const chartDerived = pages.chart && pages.chart.chartStructureForLlm ? pages.chart.chartStructureForLlm.derivedStructureHeuristic : null;
  const structuralState =
    chartDerived && chartDerived.structureRange && chartDerived.structureRange.intervalState ? chartDerived.structureRange.intervalState : "";
  const ofBias = pages.orderflow && pages.orderflow.readModel && pages.orderflow.readModel.window ? pages.orderflow.readModel.window.bias : "";
  const derivFunding = pages.derivatives && pages.derivatives.analysisMatrix ? pages.derivatives.analysisMatrix.rows.find((row) => row.metric === "funding") : null;
  void ofBias;
  void derivFunding;
  if (pages.chart && pages.chart.pricePathAvailable !== true) {
    conflicts.push({ key: "price_path_missing", severity: "high", detail: "无权威币安价格路径；禁止交易向段落。" });
  }
  if (chartTrend === "up" && typeof structuralState === "string" && (structuralState.indexOf("跌") >= 0 || structuralState.indexOf("下") >= 0)) {
    conflicts.push({
      key: "chart_trend_vs_structure_state",
      severity: "low",
      detail: "多周期首尾涨跌粗判为偏多，但与当前周期摆动结构状态表述不一致（可能因窗口口径不同）；LLM 须分别引用两处来源。",
    });
  }
  if (chartTrend === "down" && typeof structuralState === "string" && (structuralState.indexOf("涨") >= 0 || structuralState.indexOf("上") >= 0)) {
    conflicts.push({
      key: "chart_trend_vs_structure_state",
      severity: "low",
      detail: "多周期首尾涨跌粗判为偏空，但与当前周期摆动结构状态表述不一致（可能因窗口口径不同）；LLM 须分别引用两处来源。",
    });
  }
  return conflicts;
}

const LLM_AGENT_INPUT_CONTRACT = Object.freeze({
  version: "1.0.0",
  tiers: ["raw_fact", "derived_heuristic"],
  usageRulesZh: [
    "若 pricePathAvailable 为 false，报告头必须是无价格路径/仅宏观背景，不得输出交易向段落。",
    "禁止使用拥挤、占优、挤压、情景分或置信百分比作为结论。",
    "不得将 chart 页的 chartStructureForLlm.derivedStructureHeuristic 中价位当成已验证的交易信号或交易所口径；仅能作启发式上下文。",
    "不得合并叙述 rawFactEnvelope（窗口 OHLC 极值）与 structureRange（摆动聚类）；二者定义不同，数值可能显著偏离。",
    "若 derivedStructureHeuristic.integrityFlags 非空，须在分析中先复述这些标记再给观点。",
    "禁止捏造未出现在本输入 JSON（含嵌套字段）中的价格、链上数值或宏观数据。",
  ],
});

export function buildAgentInputs(deskSnapshot, options = {}) {
  const generatedAt = deskSnapshot.generatedAt || iso(nowMs(options));
  const runId = deskSnapshot.runId || options.runId || null;
  const out = {};
  for (const [agentId, pageKeys] of Object.entries(AGENT_PAGE_MAP)) {
    const pages = {};
    for (const key of pageKeys) {
      if (deskSnapshot.pages && deskSnapshot.pages[key]) pages[key] = deskSnapshot.pages[key];
    }
    const freshness = collectFreshness(pages);
    out[agentId] = {
      agentId,
      inputVersion: "agent-input-1.1.0",
      generatedAt,
      runId,
      sourcePages: pageKeys,
      pages,
      llmDataContract: LLM_AGENT_INPUT_CONTRACT,
      dataFreshness: freshness,
      notableConflicts: (deskSnapshot.notableConflicts || []).filter((row) => {
        const text = JSON.stringify(row);
        return pageKeys.some((key) => text.includes(key)) || agentId === "chief";
      }),
      llmBrief: `${agentId} 输入：${pageKeys.join(" + ")}；pricePathAvailable=${pages.chart && pages.chart.pricePathAvailable === true}；无交易向补洞。`,
    };
  }
  return out;
}

export async function buildMarketDeskSnapshot(env, options = {}) {
  const symbol = String(options.symbol || DEFAULT_SYMBOL).toUpperCase();
  const now = nowMs(options);
  const generatedAt = iso(now);
  const runId = options.runId || null;
  const builders = {
    chart: buildChartSnapshot,
    orderflow: buildOrderflowSnapshot,
    heatmap: buildHeatmapSnapshot,
    derivatives: buildDerivativesSnapshot,
  };
  const pages = {};
  for (const [key, builder] of Object.entries(builders)) {
    try {
      pages[key] = await builder(env, { ...options, symbol, nowMs: now });
    } catch (err) {
      pages[key] = pageErrorSnapshot(key, err, generatedAt, symbol);
    }
  }
  const dataFreshness = collectFreshness(pages);
  const notableConflicts = detectConflicts(pages);
  const desk = {
    scope: "market-desk",
    symbol,
    runId,
    snapshotVersion: PROGRAM_VERSION,
    generatedAt,
    pages,
    dataFreshness,
    notableConflicts,
    llmBrief: `market-desk ${symbol}; pricePathAvailable=${pages.chart && pages.chart.pricePathAvailable === true}; no trading narrative.`,
    sourceFingerprint: Object.values(pages).map((page) => page.sourceFingerprint || `${page.scope}:error`).join("||"),
  };
  desk.agentInputs = buildAgentInputs(desk, { runId, nowMs: now });
  return desk;
}
