/**
 * Snapshot / Worker-side chart structure math (parity with js/chart/indicator-math.js).
 * Keeps browser IIFE unchanged; Worker ESM imports this module.
 */

export const CHART_STRUCTURE_ALGO_ID = "swing-cluster-atr-buffer";
export const CHART_STRUCTURE_ALGO_VERSION = "chart-structure-swing-cluster-1.0.0";

/** Default params synced with IndicatorMath.computeChartStructureLevels callers */
export const CHART_STRUCTURE_DEFAULT_PARAMS = Object.freeze({
  atrPeriod: 14,
  breakoutAtrMult: 0.35,
  minBufferPct: 0.0015,
  swingWing: 3,
  /** Swings enumerated on historic slice excluding the forming bar; state uses latest close */
  structuralScanExcludesLatestBar: true,
  limit: 6,
});

const RANGE_INTERVAL_CONFIG = {
  "5m": { windowBars: 864, minBars: 120, label: "约近 3 日（864×5m）" },
  "15m": { windowBars: 480, minBars: 96, label: "约近 5 日（480×15m）" },
  "1h": { windowBars: 336, minBars: 72, label: "约近 14 日（1h）" },
  "4h": { windowBars: 360, minBars: 72, label: "约近 60 日（4h）" },
  "1d": { windowBars: 180, minBars: 60, label: "约近 180 日（1d）" },
  "3d": { windowBars: 180, minBars: 50, label: "约 18 个月（3d×180）" },
  "1w": { windowBars: 156, minBars: 40, label: "约 3 年（1w×156）" },
};

export function resolveRangeIntervalConfig(interval) {
  const key = String(interval || "1d").toLowerCase();
  return RANGE_INTERVAL_CONFIG[key] || RANGE_INTERVAL_CONFIG["1d"];
}

const CHART_HIGHER_INTERVAL_MAP = {
  "5m": "15m",
  "15m": "1h",
  "1h": "4h",
  "4h": "1d",
  "1d": "3d",
  "3d": "1w",
  "1w": null,
};

export function resolveChartHigherInterval(interval) {
  const key = String(interval || "1d").toLowerCase();
  return Object.prototype.hasOwnProperty.call(CHART_HIGHER_INTERVAL_MAP, key) ? CHART_HIGHER_INTERVAL_MAP[key] : null;
}

function trueRange(high, low, closePrev) {
  const hl = high - low;
  const hc = Math.abs(high - closePrev);
  const lc = Math.abs(low - closePrev);
  return Math.max(hl, hc, lc);
}

function atrSeries(klines, period) {
  const n = klines.length;
  const out = new Array(n).fill(null);
  if (n < period) return out;
  const tr = new Array(n);
  tr[0] = klines[0].h - klines[0].l;
  for (let i = 1; i < n; i++) {
    tr[i] = trueRange(klines[i].h, klines[i].l, klines[i - 1].c);
  }
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  out[period - 1] = sum / period;
  for (let i = period; i < n; i++) {
    out[i] = (out[i - 1] * (period - 1) + tr[i]) / period;
  }
  return out;
}

function dayKeyUtc(ms) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function normalizeKlineRows(klines) {
  if (!Array.isArray(klines)) return [];
  return klines
    .filter(
      (row) =>
        row &&
        Number.isFinite(Number(row.t)) &&
        Number.isFinite(Number(row.h)) &&
        Number.isFinite(Number(row.l)) &&
        Number.isFinite(Number(row.c)),
    )
    .map((row) => ({
      t: Number(row.t),
      o: Number.isFinite(Number(row.o)) ? Number(row.o) : Number(row.c),
      h: Number(row.h),
      l: Number(row.l),
      c: Number(row.c),
      v: Number(row.v) || 0,
    }))
    .sort((a, b) => a.t - b.t);
}

function prevCompletedDayRange(klines, intervalMs) {
  if (!Array.isArray(klines) || klines.length < 2) return null;
  const latestDay = dayKeyUtc(klines[klines.length - 1].t);
  const targetDay = latestDay - 24 * 60 * 60 * 1000;
  let high = -Infinity;
  let low = Infinity;
  let volume = 0;
  let count = 0;
  let minT = Infinity;
  let maxT = -Infinity;
  for (const row of klines) {
    if (dayKeyUtc(row.t) !== targetDay) continue;
    high = Math.max(high, Number(row.h));
    low = Math.min(low, Number(row.l));
    volume += Number(row.v) || 0;
    count += 1;
    minT = Math.min(minT, Number(row.t));
    maxT = Math.max(maxT, Number(row.t));
  }
  if (!count || !Number.isFinite(high) || !Number.isFinite(low)) return null;
  const step = intervalMs || 60 * 60 * 1000;
  const expected = step >= 24 * 60 * 60 * 1000 ? 1 : Math.round((24 * 60 * 60 * 1000) / step);
  const complete = expected <= 1 ? count >= 1 : count >= Math.floor(expected * 0.9) || (maxT - minT) >= 24 * 60 * 60 * 1000 - step;
  if (!complete) return null;
  return { high, low, volume, day: targetDay };
}

function sourceLabel(source) {
  if (source === "swing-high") return "摆动高点";
  if (source === "swing-low") return "摆动低点";
  if (source === "prev-day-high") return "前日高点";
  if (source === "prev-day-low") return "前日低点";
  if (source === "recent-high") return "近极端高点";
  if (source === "recent-low") return "近极端低点";
  return source || "结构位";
}

function sourceWeight(source) {
  if (source === "prev-day-high" || source === "prev-day-low") return 1.1;
  if (source === "swing-high" || source === "swing-low") return 1;
  if (source === "recent-high" || source === "recent-low") return 0.35;
  return 0.5;
}

function reactionAfterTouch(rows, idx, side, atr) {
  const row = rows[idx];
  const look = Math.min(rows.length - 1, idx + 8);
  if (!row || look <= idx) return 0;
  let reaction = 0;
  for (let i = idx + 1; i <= look; i++) {
    if (side === "resistance") reaction = Math.max(reaction, Number(row.h) - Number(rows[i].l));
    else reaction = Math.max(reaction, Number(rows[i].h) - Number(row.l));
  }
  const a = Math.max(1e-8, Number(atr) || 0);
  return Math.min(1, Math.max(0, reaction / a));
}

function mergeChartLevelBand(list, candidate, mergeDistance) {
  if (!candidate || !Number.isFinite(Number(candidate.price))) return;
  const price = Number(candidate.price);
  const dist = Math.max(1e-8, Number(mergeDistance) || 0);
  const found = list.find(
    (row) =>
      row.side === candidate.side && price >= Number(row.bandLow) - dist && price <= Number(row.bandHigh) + dist,
  );
  if (!found) {
    const source = candidate.source || "";
    list.push({
      price,
      bandLow: price,
      bandHigh: price,
      label: candidate.label || sourceLabel(source),
      side: candidate.side,
      scoreBase: Number(candidate.scoreBase) || sourceWeight(source),
      score: Number(candidate.scoreBase) || sourceWeight(source),
      touches: candidate.touches || 1,
      sources: source ? [source] : [],
      lastTouchT: Number(candidate.t) || null,
      lastTouchIndex: Number.isFinite(Number(candidate.index)) ? Number(candidate.index) : null,
      reactionScore: Number(candidate.reactionScore) || 0,
      evidence: candidate.evidence ? [candidate.evidence] : [],
    });
    return;
  }
  const prevTouches = Number(found.touches) || 1;
  const nextTouches = prevTouches + (candidate.touches || 1);
  found.price = (found.price * prevTouches + price * (candidate.touches || 1)) / nextTouches;
  found.bandLow = Math.min(Number(found.bandLow), price);
  found.bandHigh = Math.max(Number(found.bandHigh), price);
  found.touches = nextTouches;
  found.scoreBase = Math.max(Number(found.scoreBase) || 0, Number(candidate.scoreBase) || 0);
  found.reactionScore = Math.max(Number(found.reactionScore) || 0, Number(candidate.reactionScore) || 0);
  if (candidate.source && found.sources.indexOf(candidate.source) < 0) found.sources.push(candidate.source);
  if ((Number(candidate.t) || 0) > (Number(found.lastTouchT) || 0)) {
    found.lastTouchT = Number(candidate.t);
    found.lastTouchIndex = Number.isFinite(Number(candidate.index)) ? Number(candidate.index) : found.lastTouchIndex;
  }
  if (candidate.evidence && found.evidence.indexOf(candidate.evidence) < 0) found.evidence.push(candidate.evidence);
}

function finalizeChartLevelBands(levels, latestIndex) {
  const lastIdx = Math.max(0, Number(latestIndex) || 0);
  return levels.map((row) => {
    const ageBars = row.lastTouchIndex == null ? null : Math.max(0, lastIdx - Number(row.lastTouchIndex));
    const recency = ageBars == null || lastIdx <= 0 ? 0.5 : Math.max(0, 1 - ageBars / Math.max(1, lastIdx));
    const touchScore = Math.min(5, Number(row.touches) || 1) * 0.9;
    const sourceScore = (row.sources || []).reduce((sum, src) => sum + sourceWeight(src), 0);
    const reactionScore = Math.min(1.2, Number(row.reactionScore) || 0) * 0.9;
    const score = touchScore + sourceScore + recency * 1.2 + reactionScore;
    return {
      price: row.price,
      bandLow: row.bandLow,
      bandHigh: row.bandHigh,
      label: row.label,
      side: row.side,
      score: Math.round(score * 100) / 100,
      touches: row.touches,
      sources: row.sources || [],
      lastTouchT: row.lastTouchT,
      ageBars,
      evidence: [`${row.touches || 1} 次触碰`, ageBars == null ? "最近性未知" : `距今 ${ageBars} 根`, ...(row.evidence || [])],
    };
  });
}

function rankStructureLevels(levels, currentPrice, side, limit) {
  const cp = Number(currentPrice);
  return (levels || [])
    .filter((row) => Number.isFinite(row.price) && (side === "resistance" ? row.price > cp : row.price < cp))
    .sort((a, b) => {
      const near = Math.abs(a.price - cp) - Math.abs(b.price - cp);
      if (Math.abs(near) > 1e-9) return near;
      return (Number(b.score) || 0) - (Number(a.score) || 0);
    })
    .slice(0, limit || 6);
}

function chooseRangeBand(levels, currentPrice, atr, side) {
  if (!levels || !levels.length) return null;
  const cp = Number(currentPrice);
  const a = Math.max(1, Number(atr) || Math.abs(cp) * 0.006 || 1);
  const directional = levels.filter((row) =>
    side === "resistance" ? Number(row.price) >= cp : Number(row.price) <= cp,
  );
  const basePool = directional.length ? directional : levels;
  const strong = basePool.filter(
    (row) =>
      (Number(row.touches) || 0) >= 2 || (row.sources || []).some((src) => src === "prev-day-high" || src === "prev-day-low"),
  );
  const pool = strong.length ? strong : basePool;
  return pool
    .map((row) => ({
      row,
      rank: (Number(row.score) || 0) - Math.min(2.5, Math.abs(Number(row.price) - cp) / a) * 0.25,
    }))
    .sort((aRow, bRow) => bRow.rank - aRow.rank)[0].row;
}

function emptyChartStructure(interval, sampleBars, sampleState) {
  const cfg = resolveRangeIntervalConfig(interval);
  return {
    currentPrice: null,
    interval: String(interval || "1d").toLowerCase(),
    atr: null,
    buffer: null,
    rangeContext: {
      upper: null,
      lower: null,
      mid: null,
      width: null,
      widthPct: null,
      positionPct: null,
      state: "样本不足",
      breakout: null,
      breakdown: null,
      confidence: 0,
      sampleBars: Number(sampleBars) || 0,
      windowBars: cfg.windowBars,
      minBars: cfg.minBars,
      sampleState: sampleState || "样本不足",
      evidence: [],
    },
    nearContext: {
      resistance: null,
      support: null,
      breakout: null,
      breakdown: null,
      state: "样本不足",
    },
    extremeContext: {
      recentHigh: null,
      recentLow: null,
      previousHigh: null,
      previousLow: null,
    },
    higherContext: null,
    resistance: [],
    support: [],
    breakout: null,
    breakdown: null,
    state: "样本不足",
  };
}

function extremeFromRows(rows, side) {
  if (!rows || !rows.length) return null;
  let best = null;
  for (let i = 0; i < rows.length; i++) {
    const price = side === "resistance" ? Number(rows[i].h) : Number(rows[i].l);
    if (!Number.isFinite(price)) continue;
    if (!best || (side === "resistance" ? price > best.price : price < best.price)) {
      best = {
        price,
        t: Number(rows[i].t),
        label: side === "resistance" ? "近极端高点" : "近极端低点",
        source: side === "resistance" ? "recent-high" : "recent-low",
      };
    }
  }
  return best;
}

function addPreviousRangeLevels(resistancePool, supportPool, prev, mergeDistance, offsetIndex) {
  if (!prev) return;
  mergeChartLevelBand(
    resistancePool,
    {
      price: prev.high,
      side: "resistance",
      label: "前日高点",
      source: "prev-day-high",
      scoreBase: 1.1,
      t: prev.day,
      index: offsetIndex,
      evidence: "前一完整 UTC 日高点",
    },
    mergeDistance,
  );
  mergeChartLevelBand(
    supportPool,
    {
      price: prev.low,
      side: "support",
      label: "前日低点",
      source: "prev-day-low",
      scoreBase: 1.1,
      t: prev.day,
      index: offsetIndex,
      evidence: "前一完整 UTC 日低点",
    },
    mergeDistance,
  );
}

/**
 * Same semantics as IndicatorMath.computeChartStructureLevels (browser).
 */
function computeFibonacciBands(rangeContext, currentPrice, atr) {
  if (!rangeContext || rangeContext.sampleState !== "ok" && rangeContext.sampleState !== "窗口压缩" && rangeContext.sampleState !== "样本偏少") {
    return null;
  }
  const upper = Number(rangeContext.upper);
  const lower = Number(rangeContext.lower);
  if (!Number.isFinite(upper) || !Number.isFinite(lower) || upper <= lower) {
    return null;
  }
  if ((Number(rangeContext.confidence) || 0) < 0.45) {
    return null;
  }
  
  const k = 0.25;
  const a = Math.max(1e-8, Number(atr) || 0);
  const bandHalfWidth = k * a;
  const diff = upper - lower;
  
  const levels = [];
  const state = String(rangeContext.state || "");
  let leg = "";
  let bias = "";
  
  const createLevel = (price, ratio, role) => {
    return {
      price,
      ratio,
      role,
      bandLow: price - bandHalfWidth,
      bandHigh: price + bandHalfWidth,
      halfWidth: bandHalfWidth
    };
  };

  if (state.indexOf("突破") >= 0 || state.indexOf("上沿") >= 0 && state.indexOf("已向") >= 0) {
    // Upward breakout
    leg = "0=upper, 1=lower";
    bias = "upward";
    levels.push(createLevel(upper + diff * (1.272 - 1), 1.272, "extension"));
    levels.push(createLevel(upper + diff * (1.618 - 1), 1.618, "extension"));
    levels.push(createLevel(upper - diff * 0.382, 0.382, "retracement"));
    levels.push(createLevel(upper - diff * 0.5, 0.5, "retracement"));
    levels.push(createLevel(upper - diff * 0.618, 0.618, "retracement"));
  } else if (state.indexOf("跌破") >= 0 || state.indexOf("下沿") >= 0 && state.indexOf("已向") >= 0) {
    // Downward breakdown
    leg = "0=lower, 1=upper";
    bias = "downward";
    levels.push(createLevel(lower - diff * (1.272 - 1), 1.272, "extension"));
    levels.push(createLevel(lower - diff * (1.618 - 1), 1.618, "extension"));
    levels.push(createLevel(lower + diff * 0.382, 0.382, "retracement"));
    levels.push(createLevel(lower + diff * 0.5, 0.5, "retracement"));
    levels.push(createLevel(lower + diff * 0.618, 0.618, "retracement"));
  } else {
    // Inside range
    leg = "0=lower, 1=upper";
    bias = "neutral";
    levels.push(createLevel(lower + diff * 0.382, 0.382, "retracement"));
    levels.push(createLevel(lower + diff * 0.5, 0.5, "retracement"));
    levels.push(createLevel(lower + diff * 0.618, 0.618, "retracement"));
  }

  return {
    levels,
    meta: {
      leg,
      bias,
      gatesSkipped: false
    }
  };
}

export function computeSnapshotChartStructureLevels(klines, opts = {}) {
  const interval = String(opts.interval || "1d").toLowerCase();
  const cfg = resolveRangeIntervalConfig(interval);
  const rows = normalizeKlineRows(klines);
  if (rows.length < 20) return emptyChartStructure(interval, rows.length, "样本不足");

  const windowTarget = Math.max(2, Number(cfg.windowBars) || 180);
  const minBars = Math.max(2, Number(cfg.minBars) || 60);
  const sampleBars = Math.min(rows.length, windowTarget);
  const windowSlice = rows.slice(-sampleBars);
  const historic = windowSlice.length > 1 ? windowSlice.slice(0, -1) : windowSlice.slice(0);
  const latestBar = windowSlice[windowSlice.length - 1];
  const currentPrice = Number(latestBar.c);
  if (!Number.isFinite(currentPrice) || !historic.length) {
    return emptyChartStructure(interval, sampleBars, "样本不足");
  }

  let sampleState = "ok";
  if (sampleBars < minBars) sampleState = "样本偏少";
  else if (sampleBars < windowTarget) sampleState = "窗口压缩";

  const atrP = Number(opts.atrPeriod) || CHART_STRUCTURE_DEFAULT_PARAMS.atrPeriod;
  const atrArr = atrSeries(windowSlice, atrP);
  const latestAtr = [...atrArr].reverse().find((v) => Number.isFinite(v)) || Math.abs(currentPrice) * 0.006;
  const breakoutMult =
    Number.isFinite(Number(opts.breakoutAtrMult)) ? Number(opts.breakoutAtrMult) : CHART_STRUCTURE_DEFAULT_PARAMS.breakoutAtrMult;
  const minPct =
    Number(opts.minBufferPct) > 0 ? Number(opts.minBufferPct) : CHART_STRUCTURE_DEFAULT_PARAMS.minBufferPct;
  const buffer = Math.max(latestAtr * breakoutMult, Math.abs(currentPrice) * minPct);
  const mergeDistance = Math.max(latestAtr * 0.25, Math.abs(currentPrice) * 0.0008);
  const wing =
    opts.swingWing != null ? Math.max(2, Number(opts.swingWing)) : CHART_STRUCTURE_DEFAULT_PARAMS.swingWing;

  const resistancePool = [];
  const supportPool = [];

  for (let i = wing; i < historic.length - wing; i++) {
    const row = historic[i];
    let isSwingHigh = true;
    let isSwingLow = true;
    for (let j = i - wing; j <= i + wing; j++) {
      if (j === i) continue;
      if (Number(historic[j].h) > Number(row.h)) isSwingHigh = false;
      if (Number(historic[j].l) < Number(row.l)) isSwingLow = false;
    }
    const recency = (i + 1) / Math.max(1, historic.length);
    if (isSwingHigh) {
      const reaction = reactionAfterTouch(windowSlice, i, "resistance", latestAtr);
      mergeChartLevelBand(
        resistancePool,
        {
          price: Number(row.h),
          side: "resistance",
          label: "摆动高点",
          source: "swing-high",
          scoreBase: 1 + recency,
          t: Number(row.t),
          index: i,
          reactionScore: reaction,
          evidence: reaction >= 1 ? "触碰后反向超过 1 ATR" : "摆动确认",
        },
        mergeDistance,
      );
    }
    if (isSwingLow) {
      const reaction = reactionAfterTouch(windowSlice, i, "support", latestAtr);
      mergeChartLevelBand(
        supportPool,
        {
          price: Number(row.l),
          side: "support",
          label: "摆动低点",
          source: "swing-low",
          scoreBase: 1 + recency,
          t: Number(row.t),
          index: i,
          reactionScore: reaction,
          evidence: reaction >= 1 ? "触碰后反向超过 1 ATR" : "摆动确认",
        },
        mergeDistance,
      );
    }
  }

  const prev = prevCompletedDayRange(rows, {
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
    "3d": 3 * 24 * 60 * 60 * 1000,
    "1w": 7 * 24 * 60 * 60 * 1000,
  }[interval] || 60 * 60 * 1000);
  addPreviousRangeLevels(resistancePool, supportPool, prev, mergeDistance, Math.max(0, historic.length - 1));

  const resistanceAll = finalizeChartLevelBands(resistancePool, historic.length - 1).sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  const supportAll = finalizeChartLevelBands(supportPool, historic.length - 1).sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  const upperLevel = chooseRangeBand(resistanceAll, currentPrice, latestAtr, "resistance");
  const lowerLevel = chooseRangeBand(supportAll, currentPrice, latestAtr, "support");
  const recentHigh = extremeFromRows(historic, "resistance");
  const recentLow = extremeFromRows(historic, "support");
  const previousHigh = prev ? { price: prev.high, t: prev.day, label: "前日高点", source: "prev-day-high" } : null;
  const previousLow = prev ? { price: prev.low, t: prev.day, label: "前日低点", source: "prev-day-low" } : null;

  const limitVal = opts.limit != null ? Number(opts.limit) : CHART_STRUCTURE_DEFAULT_PARAMS.limit;

  if (!upperLevel || !lowerLevel || !(Number(upperLevel.price) > Number(lowerLevel.price))) {
    const empty = emptyChartStructure(interval, sampleBars, sampleState);
    empty.currentPrice = currentPrice;
    empty.atr = latestAtr;
    empty.buffer = buffer;
    empty.rangeContext.sampleState = "区间待确认";
    empty.rangeContext.evidence = ["缺少可配对的上沿/下沿价位带"];
    empty.nearContext.state = "区间待确认";
    empty.extremeContext = { recentHigh, recentLow, previousHigh, previousLow };
    empty.resistance = rankStructureLevels(resistanceAll, currentPrice, "resistance", limitVal);
    empty.support = rankStructureLevels(supportAll, currentPrice, "support", limitVal);
    empty.state = "区间待确认";
    return empty;
  }

  const upper = Number(upperLevel.price);
  const lower = Number(lowerLevel.price);
  const mid = (upper + lower) / 2;
  const width = upper - lower;
  const widthPct = currentPrice > 0 ? (width / currentPrice) * 100 : null;
  const positionPct = width > 0 ? Math.max(0, Math.min(100, ((currentPrice - lower) / width) * 100)) : null;
  const breakout = { price: upper + buffer, base: upper, buffer };
  const breakdown = { price: lower - buffer, base: lower, buffer };
  const touchDist = Math.max(latestAtr * 0.25, Math.abs(currentPrice) * minPct);
  let state = "区间内";
  if (currentPrice > breakout.price) state = "已向上突破";
  else if (currentPrice < breakdown.price) state = "已向下跌破";
  else if (currentPrice > upper) state = "向上突破待确认";
  else if (currentPrice < lower) state = "向下跌破待确认";
  else if (Number(latestBar.h) > upper || currentPrice >= upper - touchDist) state = "测试区间上沿";
  else if (Number(latestBar.l) < lower || currentPrice <= lower + touchDist) state = "测试区间下沿";

  const previousClose = Number(historic[historic.length - 1].c);
  const displayResistance = rankStructureLevels(resistanceAll, currentPrice, "resistance", limitVal);
  const displaySupport = rankStructureLevels(supportAll, currentPrice, "support", limitVal);
  const testedResistance = rankStructureLevels(resistanceAll, previousClose, "resistance", limitVal);
  const testedSupport = rankStructureLevels(supportAll, previousClose, "support", limitVal);
  const frozenRes = testedResistance[0] || (upper > previousClose ? upperLevel : null);
  const frozenSup = testedSupport[0] || (lower < previousClose ? lowerLevel : null);
  const resistance = displayResistance;
  const support = displaySupport;
  const nearResistance = resistance[0] || (upper > currentPrice ? upperLevel : null);
  const nearSupport = support[0] || (lower < currentPrice ? lowerLevel : null);
  const nearBreakout = frozenRes ? { price: Number(frozenRes.price) + buffer, base: Number(frozenRes.price), buffer, knownAtClose: previousClose } : null;
  const nearBreakdown = frozenSup ? { price: Number(frozenSup.price) - buffer, base: Number(frozenSup.price), buffer, knownAtClose: previousClose } : null;
  let nearState = "区间内";
  if (frozenRes && currentPrice > Number(frozenRes.price) + buffer) nearState = "近端上破确认";
  else if (frozenRes && currentPrice > Number(frozenRes.price)) nearState = "测试近端压力";
  else if (frozenSup && currentPrice < Number(frozenSup.price) - buffer) nearState = "近端跌破确认";
  else if (frozenSup && currentPrice < Number(frozenSup.price)) nearState = "测试近端支撑";

  const rangeTouchStrength = Math.min(1, ((Number(upperLevel.touches) || 1) + (Number(lowerLevel.touches) || 1)) / 8);
  const sampleStrength = Math.min(1, sampleBars / minBars);
  const sourceStrength = Math.min(1, ((upperLevel.sources || []).length + (lowerLevel.sources || []).length) / 4);
  const confidence = Math.round((0.45 * sampleStrength + 0.4 * rangeTouchStrength + 0.15 * sourceStrength) * 100) / 100;

  const rangeContext = {
    upper,
    lower,
    mid,
    width,
    widthPct,
    positionPct,
    state,
    breakout,
    breakdown,
    confidence,
    sampleBars,
    windowBars: windowTarget,
    minBars,
    sampleState,
    upperLevel,
    lowerLevel,
    evidence: [
      `${cfg.label} · 样本 ${sampleBars}/${windowTarget}`,
      `上沿 ${upperLevel.touches || 1} 次触碰 · 下沿 ${lowerLevel.touches || 1} 次触碰`,
      `缓冲 ${Math.round(buffer * 100) / 100} = max(${breakoutMult} ATR, ${minPct * 100}%)`,
    ],
  };

  const fibonacci = computeFibonacciBands(rangeContext, currentPrice, latestAtr);

  return {
    currentPrice,
    interval,
    atr: latestAtr,
    buffer,
    rangeContext,
    fibonacci,
    nearContext: {
      resistance: nearResistance,
      support: nearSupport,
      testedResistance: frozenRes || null,
      testedSupport: frozenSup || null,
      breakout: nearBreakout,
      breakdown: nearBreakdown,
      state: nearState,
    },
    extremeContext: {
      recentHigh,
      recentLow,
      previousHigh,
      previousLow,
    },
    higherContext: null,
    resistance,
    support,
    breakout: nearBreakout,
    breakdown: nearBreakdown,
    state: nearState,
  };
}

/** Same semantics as IndicatorMath.buildChartHigherContext */
export function buildChartHigherContext(current, higher) {
  const higherInterval = current && current.interval ? resolveChartHigherInterval(current.interval) : null;
  if (!higherInterval) {
    return {
      interval: null,
      state: "无上级周期",
      alignment: "中性",
      note: "当前已是最高观察周期。",
      rangeContext: null,
    };
  }
  if (!higher || !higher.rangeContext || !Number.isFinite(Number(higher.rangeContext.upper))) {
    return {
      interval: higherInterval,
      state: "上级周期不可用",
      alignment: "不可用",
      note: "上级周期数据暂不可用，先按当前周期观察。",
      rangeContext: null,
    };
  }
  const curState = current && current.rangeContext ? String(current.rangeContext.state || "") : "";
  const higherRc = higher.rangeContext;
  const cp = Number(current && current.currentPrice);
  const hUpper = Number(higherRc.upper);
  const hLower = Number(higherRc.lower);
  const hBreakout = higherRc.breakout ? Number(higherRc.breakout.price) : NaN;
  const hBreakdown = higherRc.breakdown ? Number(higherRc.breakdown.price) : NaN;
  let alignment = "中性";
  let note = `上级 ${higherInterval} ${higherRc.state || "区间状态未知"}`;
  if (curState.indexOf("向上") >= 0 || curState.indexOf("上沿") >= 0) {
    if (Number.isFinite(hBreakout) && cp > hBreakout) {
      alignment = "顺向";
      note = `上级 ${higherInterval} 也已越过上破确认，当前上破顺向。`;
    } else if (Number.isFinite(hUpper) && cp < hUpper) {
      alignment = "受压";
      note = `上级 ${higherInterval} 仍在区间内，当前上破需先看 ${Math.round(hUpper * 100) / 100} 上沿。`;
    } else {
      alignment = "待确认";
      note = `上级 ${higherInterval} 接近上沿，等待收盘越过上级确认价。`;
    }
  } else if (curState.indexOf("向下") >= 0 || curState.indexOf("下沿") >= 0 || curState.indexOf("跌破") >= 0) {
    if (Number.isFinite(hBreakdown) && cp < hBreakdown) {
      alignment = "顺向";
      note = `上级 ${higherInterval} 也已跌破确认，当前下破顺向。`;
    } else if (Number.isFinite(hLower) && cp > hLower) {
      alignment = "受支撑";
      note = `上级 ${higherInterval} 仍在区间内，当前下破需先看 ${Math.round(hLower * 100) / 100} 下沿。`;
    } else {
      alignment = "待确认";
      note = `上级 ${higherInterval} 接近下沿，等待收盘跌破上级确认价。`;
    }
  }
  return {
    interval: higherInterval,
    state: higherRc.state || "",
    alignment,
    note,
    rangeContext: {
      upper: higherRc.upper,
      lower: higherRc.lower,
      mid: higherRc.mid,
      widthPct: higherRc.widthPct,
      breakout: higherRc.breakout,
      breakdown: higherRc.breakdown,
      sampleBars: higherRc.sampleBars,
      windowBars: higherRc.windowBars,
    },
  };
}

/** Merge higher-TF analysis when rows exist */
export function mergeChartHigherFromRows(baseAnalysis, higherKlines, higherInterval) {
  if (!baseAnalysis || !higherInterval) return baseAnalysis;
  const higher = computeSnapshotChartStructureLevels(higherKlines || [], { interval: higherInterval });
  return { ...baseAnalysis, higherContext: buildChartHigherContext(baseAnalysis, higher) };
}

function shallowPriceLevel(level) {
  if (!level || !Number.isFinite(Number(level.price))) return null;
  return {
    price: Number(level.price),
    label: level.label || null,
    touches: Number(level.touches) || null,
    sources: Array.isArray(level.sources) ? level.sources.slice() : [],
  };
}

/**
 * Integrity flags comparing structure envelope vs summarized window extrema (summarizeKlines).
 */
export function deriveStructureIntegrityFlags(structureAnalysis, windowExtremaRange) {
  const flags = [];
  const rc = structureAnalysis && structureAnalysis.rangeContext;
  if (!rc || !Number.isFinite(rc.upper) || !Number.isFinite(rc.lower)) {
    flags.push({ key: "structure_incomplete", detail: "结构上下沿不可用或待确认。" });
    return flags;
  }
  if (rc.sampleState && rc.sampleState !== "ok") {
    flags.push({ key: "sample_quality", detail: String(rc.sampleState) });
  }
  const atr = Number(structureAnalysis.atr);
  const cp = Number(structureAnalysis.currentPrice);
  const wHigh = Number(windowExtremaRange && windowExtremaRange.windowHigh);
  const wLow = Number(windowExtremaRange && windowExtremaRange.windowLow);
  const thr = Number.isFinite(atr) && atr > 0 ? 2 * atr : Math.abs(cp) * 0.01;
  if (Number.isFinite(wHigh) && Number.isFinite(rc.upper) && wHigh - rc.upper > thr) {
    flags.push({ key: "structure_vs_extrema_high", detail: `窗口最高价高于结构上沿较多（阈值≈${Math.round(thr * 100) / 100}）。` });
  }
  if (Number.isFinite(wLow) && Number.isFinite(rc.lower) && rc.lower - wLow > thr) {
    flags.push({ key: "structure_vs_extrema_low", detail: `窗口最低价低于结构下沿较多（阈值≈${Math.round(thr * 100) / 100}）。` });
  }
  const width = rc.upper - rc.lower;
  if (Number.isFinite(width) && Number.isFinite(atr) && atr > 0 && width < 0.5 * atr) {
    flags.push({ key: "narrow_structure_width_vs_atr", detail: "结构宽度过窄，相对 ATR 易噪声。" });
  }
  const widthPct = Number(rc.widthPct);
  if (Number.isFinite(widthPct) && widthPct > 25) {
    flags.push({ key: "very_wide_structure_pct", detail: `结构宽度占现价 ${Math.round(widthPct * 100) / 100}%，语义上偏宽区间震荡。` });
  }
  return flags;
}

/**
 * Layered payload for LLM / Agent consumption (derived_heuristic + raw_fact refs).
 */
export function buildChartStructureLlmPayload(structureAnalysis, windowExtremaRange, mergedParams = {}) {
  const params = { ...CHART_STRUCTURE_DEFAULT_PARAMS, ...mergedParams };
  const integrityFlags = deriveStructureIntegrityFlags(structureAnalysis, windowExtremaRange);

  const rawFact = windowExtremaRange
    ? {
        tier: "raw_fact",
        kind: "window_extrema_from_klines",
        interval: windowExtremaRange.interval,
        sampleSize: windowExtremaRange.sampleSize,
        windowHigh: windowExtremaRange.windowHigh,
        windowLow: windowExtremaRange.windowLow,
        rangePositionPct: windowExtremaRange.rangePositionPct,
        trendLabel: windowExtremaRange.trend || null,
        note:
          "与 structureRange（摆动聚类）不是同一种「区间定义」：不得数值混写成单一区间叙事。最新一根 K 线为形成中或未收盘时点，解读收盘价状态需谨慎。",
      }
    : { tier: "raw_fact", kind: "window_extrema_from_klines", note: "无窗口极值摘要；仅结构启发式不可用。" };

  const rc = structureAnalysis && structureAnalysis.rangeContext;
  const derived = structureAnalysis
    ? {
        tier: "derived_heuristic",
        algorithmId: CHART_STRUCTURE_ALGO_ID,
        algorithmVersion: CHART_STRUCTURE_ALGO_VERSION,
        params: {
          ...params,
          windowBarsTarget: rc && rc.windowBars,
          sampleBarsEffective: rc && rc.sampleBars,
          interval: structureAnalysis.interval,
        },
        structureRange:
          rc && Number.isFinite(rc.upper) && Number.isFinite(rc.lower)
            ? {
                upper: rc.upper,
                lower: rc.lower,
                mid: rc.mid,
                width: rc.width,
                widthPct: rc.widthPct,
                positionPct: rc.positionPct,
                intervalState: rc.state,
                sampleState: rc.sampleState,
                confidence: rc.confidence,
                evidence: Array.isArray(rc.evidence) ? rc.evidence : [],
              }
            : null,
        breakoutObservation: rc && rc.breakout ? { price: rc.breakout.price, base: rc.breakout.base, buffer: rc.breakout.buffer } : null,
        breakdownObservation: rc && rc.breakdown ? { price: rc.breakdown.price, base: rc.breakdown.base, buffer: rc.breakdown.buffer } : null,
        nearSupportCandidate: shallowPriceLevel(structureAnalysis.nearContext && structureAnalysis.nearContext.support),
        nearResistanceCandidate: shallowPriceLevel(structureAnalysis.nearContext && structureAnalysis.nearContext.resistance),
        nearState: structureAnalysis.nearContext ? structureAnalysis.nearContext.state : null,
        higherContextSummary: structureAnalysis.higherContext
          ? {
              interval: structureAnalysis.higherContext.interval,
              alignment: structureAnalysis.higherContext.alignment,
              state: structureAnalysis.higherContext.state,
              note: structureAnalysis.higherContext.note,
            }
          : null,
        extremes: structureAnalysis.extremeContext || null,
        fibonacci: structureAnalysis.fibonacci ? {
          meta: structureAnalysis.fibonacci.meta,
          levels: structureAnalysis.fibonacci.levels.map(l => ({
            price: Number(l.price.toFixed(2)),
            ratio: l.ratio,
            role: l.role,
            bandLow: Number(l.bandLow.toFixed(2)),
            bandHigh: Number(l.bandHigh.toFixed(2))
          }))
        } : null,
        usagePolicy: [
          "本块为摆动聚类 + ATR 缓冲规则得到的启发式结构位，非成交建议；不得单独作为开仓/止盈依据。",
          "breakoutObservation/breakdownObservation 表示「收盘价越过基准 + 缓冲」的规则化名，不等于交易所或策略回测口径。",
          "若 integrityFlags 非空，先向用户复述风险再继续推理。",
        ],
        integrityFlags,
      }
    : {
        tier: "derived_heuristic",
        algorithmId: CHART_STRUCTURE_ALGO_ID,
        algorithmVersion: CHART_STRUCTURE_ALGO_VERSION,
        params,
        integrityFlags: [{ key: "no_analysis", detail: "结构分析对象为 null" }],
        usagePolicy: ["结构不可用；勿推断价位。"],
      };

  return {
    latestCloseObserved: structureAnalysis && Number.isFinite(structureAnalysis.currentPrice) ? structureAnalysis.currentPrice : null,
    rawFactEnvelope: rawFact,
    derivedStructureHeuristic: derived,
  };
}
