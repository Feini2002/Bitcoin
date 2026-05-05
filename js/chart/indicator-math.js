/* =======================================================
   指标纯计算：输入 D1/OHLCV（t 为毫秒），输出 LWC 用 time(秒)
   VWAP 按 UTC 自然日重置（与常见加密终端一致）
   ======================================================= */

(function (global) {
  "use strict";

  function timeSec(row) {
    return row.t / 1000;
  }

  function emaSeries(closes, period) {
    const n = closes.length;
    const vals = new Array(n);
    for (let i = 0; i < n; i++) vals[i] = null;
    if (period <= 0 || n < period) return vals;
    const k = 2 / (period + 1);
    let sum = 0;
    for (let i = 0; i < period; i++) sum += closes[i];
    let ema = sum / period;
    vals[period - 1] = ema;
    for (let i = period; i < n; i++) {
      ema = closes[i] * k + ema * (1 - k);
      vals[i] = ema;
    }
    return vals;
  }

  function smaAtIndex(closes, period, endIdx) {
    let sum = 0;
    for (let j = endIdx - period + 1; j <= endIdx; j++) sum += closes[j];
    return sum / period;
  }

  function rollingSmaStdevBb(closes, period, mult) {
    const n = closes.length;
    const middle = new Array(n).fill(null);
    const upper = new Array(n).fill(null);
    const lower = new Array(n).fill(null);
    for (let i = period - 1; i < n; i++) {
      const mean = smaAtIndex(closes, period, i);
      let s2 = 0;
      for (let j = i - period + 1; j <= i; j++) {
        const d = closes[j] - mean;
        s2 += d * d;
      }
      const stdev = Math.sqrt(s2 / period);
      middle[i] = mean;
      upper[i] = mean + mult * stdev;
      lower[i] = mean - mult * stdev;
    }
    return { middle, upper, lower };
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

  function rsiFromAvgs(avgG, avgL) {
    if (avgL === 0) return avgG === 0 ? 50 : 100;
    if (avgG === 0) return 0;
    const rs = avgG / avgL;
    return 100 - 100 / (1 + rs);
  }

  function rsiSeries(closes, period) {
    const n = closes.length;
    const out = new Array(n).fill(null);
    if (n < period + 1) return out;
    const gains = new Array(n);
    const losses = new Array(n);
    for (let i = 1; i < n; i++) {
      const ch = closes[i] - closes[i - 1];
      gains[i] = ch > 0 ? ch : 0;
      losses[i] = ch < 0 ? -ch : 0;
    }
    let avgG = 0;
    let avgL = 0;
    for (let i = 1; i <= period; i++) {
      avgG += gains[i];
      avgL += losses[i];
    }
    avgG /= period;
    avgL /= period;
    out[period] = rsiFromAvgs(avgG, avgL);
    for (let i = period + 1; i < n; i++) {
      avgG = (avgG * (period - 1) + gains[i]) / period;
      avgL = (avgL * (period - 1) + losses[i]) / period;
      out[i] = rsiFromAvgs(avgG, avgL);
    }
    return out;
  }

  function macdTriple(klines, closes, fast, slow, signalPeriod) {
    const emaF = emaSeries(closes, fast);
    const emaS = emaSeries(closes, slow);
    const n = closes.length;
    const macd = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      if (emaF[i] != null && emaS[i] != null) macd[i] = emaF[i] - emaS[i];
    }
    const start = macd.findIndex((v) => v != null);
    if (start < 0) {
      return { line: [], signal: [], hist: [] };
    }
    const macdVals = [];
    const idxMap = [];
    for (let i = start; i < n; i++) {
      if (macd[i] != null) {
        macdVals.push(macd[i]);
        idxMap.push(i);
      }
    }
    const sigEma = emaSeries(macdVals, signalPeriod);
    const lineOut = [];
    const signalOut = [];
    const histOut = [];
    for (let j = 0; j < macdVals.length; j++) {
      const sig = sigEma[j];
      if (sig == null) continue;
      const m = macdVals[j];
      const barIdx = idxMap[j];
      const t = timeSec(klines[barIdx]);
      const h = m - sig;
      const prevH = histOut.length ? histOut[histOut.length - 1].value : 0;
      const color = h >= prevH ? "rgba(16,185,129,0.7)" : "rgba(239,68,68,0.7)";
      lineOut.push({ time: t, value: m });
      signalOut.push({ time: t, value: sig });
      histOut.push({ time: t, value: h, color });
    }
    return { line: lineOut, signal: signalOut, hist: histOut };
  }

  function vwapSeries(klines) {
    const out = [];
    let dayKey = null;
    let cumPV = 0;
    let cumV = 0;
    for (let i = 0; i < klines.length; i++) {
      const row = klines[i];
      const ms = row.t;
      const d = new Date(ms);
      const key = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      if (dayKey !== key) {
        dayKey = key;
        cumPV = 0;
        cumV = 0;
      }
      const tp = (row.h + row.l + row.c) / 3;
      const vol = Number(row.v) || 0;
      cumPV += tp * vol;
      cumV += vol;
      if (cumV > 0) out.push({ time: timeSec(row), value: cumPV / cumV });
      else out.push({ time: timeSec(row), value: tp });
    }
    return out;
  }

  function toLinePoints(klines, values) {
    const pts = [];
    for (let i = 0; i < values.length; i++) {
      if (values[i] == null || !Number.isFinite(values[i])) continue;
      pts.push({ time: timeSec(klines[i]), value: values[i] });
    }
    return pts;
  }

  function dayKeyUtc(ms) {
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  function mergeKeyLevelCandidate(list, candidate, mergeDistance) {
    if (!candidate || !Number.isFinite(candidate.price)) return;
    const dist = Math.max(1e-8, Number(mergeDistance) || 0);
    const found = list.find((row) => Math.abs(row.price - candidate.price) <= dist);
    if (!found) {
      list.push({
        ...candidate,
        touches: candidate.touches || 1,
        sources: candidate.source ? [candidate.source] : [],
      });
      return;
    }
    found.touches += candidate.touches || 1;
    found.score = Math.max(Number(found.score) || 0, Number(candidate.score) || 0) + 0.25;
    if (candidate.source && found.sources.indexOf(candidate.source) < 0) found.sources.push(candidate.source);
    if ((candidate.t || 0) > (found.t || 0)) found.t = candidate.t;
    found.price = (found.price + candidate.price) / 2;
  }

  function prevCompletedDayRange(klines) {
    if (!Array.isArray(klines) || klines.length < 2) return null;
    const latestDay = dayKeyUtc(klines[klines.length - 1].t);
    let targetDay = null;
    for (let i = klines.length - 2; i >= 0; i--) {
      const key = dayKeyUtc(klines[i].t);
      if (key < latestDay) {
        targetDay = key;
        break;
      }
    }
    if (targetDay == null) return null;
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    for (const row of klines) {
      if (dayKeyUtc(row.t) !== targetDay) continue;
      high = Math.max(high, Number(row.h));
      low = Math.min(low, Number(row.l));
      volume += Number(row.v) || 0;
    }
    if (!Number.isFinite(high) || !Number.isFinite(low)) return null;
    return { high, low, volume, day: targetDay };
  }

  function rankLevels(levels, currentPrice, side, limit) {
    const cp = Number(currentPrice);
    return levels
      .filter((row) => Number.isFinite(row.price) && (side === "resistance" ? row.price > cp : row.price < cp))
      .sort((a, b) => {
        const near = Math.abs(a.price - cp) - Math.abs(b.price - cp);
        if (Math.abs(near) > 1e-9) return near;
        return (Number(b.score) || 0) - (Number(a.score) || 0);
      })
      .slice(0, limit || 6);
  }

  /**
   * 各周期震荡区间窗口：按「根数」近似计划中的墙钟跨度（5m≈3 日 … 1w≈3 年）。
   */
  const RANGE_INTERVAL_CONFIG = {
    "5m": { windowBars: 864, minBars: 120, label: "约近 3 日（864×5m）" },
    "15m": { windowBars: 480, minBars: 96, label: "约近 5 日（480×15m）" },
    "1h": { windowBars: 336, minBars: 72, label: "约近 14 日（1h）" },
    "4h": { windowBars: 360, minBars: 72, label: "约近 60 日（4h）" },
    "1d": { windowBars: 180, minBars: 60, label: "约近 180 日（1d）" },
    "3d": { windowBars: 180, minBars: 50, label: "约 18 个月（3d×180）" },
    "1w": { windowBars: 156, minBars: 40, label: "约 3 年（1w×156）" },
  };

  function resolveRangeIntervalConfig(interval) {
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

  function resolveChartHigherInterval(interval) {
    const key = String(interval || "1d").toLowerCase();
    return Object.prototype.hasOwnProperty.call(CHART_HIGHER_INTERVAL_MAP, key)
      ? CHART_HIGHER_INTERVAL_MAP[key]
      : null;
  }

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

  function normalizeKlineRows(klines) {
    if (!Array.isArray(klines)) return [];
    return klines
      .filter((row) =>
        row &&
        Number.isFinite(Number(row.t)) &&
        Number.isFinite(Number(row.h)) &&
        Number.isFinite(Number(row.l)) &&
        Number.isFinite(Number(row.c))
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
    const found = list.find((row) =>
      row.side === candidate.side &&
      price >= Number(row.bandLow) - dist &&
      price <= Number(row.bandHigh) + dist
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
        evidence: [
          `${row.touches || 1} 次触碰`,
          ageBars == null ? "最近性未知" : `距今 ${ageBars} 根`,
          ...(row.evidence || []),
        ],
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
      side === "resistance" ? Number(row.price) >= cp : Number(row.price) <= cp
    );
    const basePool = directional.length ? directional : levels;
    const strong = basePool.filter((row) =>
      (Number(row.touches) || 0) >= 2 ||
      (row.sources || []).some((src) => src === "prev-day-high" || src === "prev-day-low")
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
    mergeChartLevelBand(resistancePool, {
      price: prev.high,
      side: "resistance",
      label: "前日高点",
      source: "prev-day-high",
      scoreBase: 1.1,
      t: prev.day,
      index: offsetIndex,
      evidence: "前一完整 UTC 日高点",
    }, mergeDistance);
    mergeChartLevelBand(supportPool, {
      price: prev.low,
      side: "support",
      label: "前日低点",
      source: "prev-day-low",
      scoreBase: 1.1,
      t: prev.day,
      index: offsetIndex,
      evidence: "前一完整 UTC 日低点",
    }, mergeDistance);
  }

  function computeChartStructureLevels(klines, opts) {
    opts = opts || {};
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

    const atrP = Number(opts.atrPeriod) || 14;
    const atrArr = atrSeries(windowSlice, atrP);
    const latestAtr = [...atrArr].reverse().find((v) => Number.isFinite(v)) || Math.abs(currentPrice) * 0.006;
    const breakoutMult = Number.isFinite(Number(opts.breakoutAtrMult)) ? Number(opts.breakoutAtrMult) : 0.35;
    const minPct = Number(opts.minBufferPct) > 0 ? Number(opts.minBufferPct) : 0.0015;
    const buffer = Math.max(latestAtr * breakoutMult, Math.abs(currentPrice) * minPct);
    const mergeDistance = Math.max(latestAtr * 0.25, Math.abs(currentPrice) * 0.0008);
    const wing = Math.max(2, Number(opts.swingWing) || 3);
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
        mergeChartLevelBand(resistancePool, {
          price: Number(row.h),
          side: "resistance",
          label: "摆动高点",
          source: "swing-high",
          scoreBase: 1 + recency,
          t: Number(row.t),
          index: i,
          reactionScore: reaction,
          evidence: reaction >= 1 ? "触碰后反向超过 1 ATR" : "摆动确认",
        }, mergeDistance);
      }
      if (isSwingLow) {
        const reaction = reactionAfterTouch(windowSlice, i, "support", latestAtr);
        mergeChartLevelBand(supportPool, {
          price: Number(row.l),
          side: "support",
          label: "摆动低点",
          source: "swing-low",
          scoreBase: 1 + recency,
          t: Number(row.t),
          index: i,
          reactionScore: reaction,
          evidence: reaction >= 1 ? "触碰后反向超过 1 ATR" : "摆动确认",
        }, mergeDistance);
      }
    }

    const prev = prevCompletedDayRange(rows);
    addPreviousRangeLevels(resistancePool, supportPool, prev, mergeDistance, Math.max(0, historic.length - 1));

    const resistanceAll = finalizeChartLevelBands(resistancePool, historic.length - 1)
      .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    const supportAll = finalizeChartLevelBands(supportPool, historic.length - 1)
      .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
    const upperLevel = chooseRangeBand(resistanceAll, currentPrice, latestAtr, "resistance");
    const lowerLevel = chooseRangeBand(supportAll, currentPrice, latestAtr, "support");
    const recentHigh = extremeFromRows(historic, "resistance");
    const recentLow = extremeFromRows(historic, "support");
    const previousHigh = prev ? { price: prev.high, t: prev.day, label: "前日高点", source: "prev-day-high" } : null;
    const previousLow = prev ? { price: prev.low, t: prev.day, label: "前日低点", source: "prev-day-low" } : null;

    if (!upperLevel || !lowerLevel || !(Number(upperLevel.price) > Number(lowerLevel.price))) {
      const empty = emptyChartStructure(interval, sampleBars, sampleState);
      empty.currentPrice = currentPrice;
      empty.atr = latestAtr;
      empty.buffer = buffer;
      empty.rangeContext.sampleState = "区间待确认";
      empty.rangeContext.evidence = ["缺少可配对的上沿/下沿价位带"];
      empty.nearContext.state = "区间待确认";
      empty.extremeContext = { recentHigh, recentLow, previousHigh, previousLow };
      empty.resistance = rankStructureLevels(resistanceAll, currentPrice, "resistance", Number(opts.limit) || 6);
      empty.support = rankStructureLevels(supportAll, currentPrice, "support", Number(opts.limit) || 6);
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

    const resistance = rankStructureLevels(resistanceAll, currentPrice, "resistance", Number(opts.limit) || 6);
    const support = rankStructureLevels(supportAll, currentPrice, "support", Number(opts.limit) || 6);
    const nearResistance = resistance[0] || (upper > currentPrice ? upperLevel : null);
    const nearSupport = support[0] || (lower < currentPrice ? lowerLevel : null);
    const nearBreakout = nearResistance
      ? { price: Number(nearResistance.price) + buffer, base: Number(nearResistance.price), buffer }
      : null;
    const nearBreakdown = nearSupport
      ? { price: Number(nearSupport.price) - buffer, base: Number(nearSupport.price), buffer }
      : null;
    let nearState = "区间内";
    if (nearBreakout && currentPrice > nearBreakout.price) nearState = "近端上破确认";
    else if (nearResistance && currentPrice > Number(nearResistance.price)) nearState = "测试近端压力";
    else if (nearBreakdown && currentPrice < nearBreakdown.price) nearState = "近端跌破确认";
    else if (nearSupport && currentPrice < Number(nearSupport.price)) nearState = "测试近端支撑";

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

  function buildChartHigherContext(current, higher) {
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

  /**
   * 当前周期下的震荡区间与突破/跌破规则（同尺度 ATR 缓冲）。
   * 区间上下沿默认用窗口内「除最后一根外」的高低，减少未收盘 K 抖动；状态判断用最后一根收盘价。
   */
  function computeRangeContext(rows, opts) {
    opts = opts || {};
    const cfg = resolveRangeIntervalConfig(opts.interval);
    const windowTarget = Math.max(2, Number(cfg.windowBars) || 180);
    const minBars = Math.max(2, Number(cfg.minBars) || 60);
    const sampleBars = Math.min(rows.length, windowTarget);
    const windowSlice = rows.slice(-sampleBars);
    const historic = windowSlice.length > 1 ? windowSlice.slice(0, -1) : windowSlice.slice(0);
    const latestBar = windowSlice[windowSlice.length - 1];
    const currentPrice = Number(latestBar.c);
    const atrP = Number(opts.atrPeriod) || 14;
    const mult = Number(opts.breakoutAtrMult);
    const breakoutMult = Number.isFinite(mult) ? mult : 0.35;
    const minPct = Number(opts.minBufferPct) > 0 ? Number(opts.minBufferPct) : 0.0015;

    let sampleState = "ok";
    if (sampleBars < minBars) sampleState = "样本偏少";
    else if (sampleBars < windowTarget) sampleState = "窗口压缩";

    if (!Number.isFinite(currentPrice) || historic.length < 1) {
      return {
        interval: String(opts.interval || "1d").toLowerCase(),
        label: cfg.label,
        windowBars: windowTarget,
        minBars,
        sampleBars,
        sampleState,
        upper: null,
        lower: null,
        mid: null,
        width: null,
        widthPct: null,
        atr: null,
        buffer: null,
        breakout: null,
        breakdown: null,
        state: "样本不足",
        confidence: 0,
        evidence: [],
      };
    }

    let upper = -Infinity;
    let lower = Infinity;
    for (let i = 0; i < historic.length; i++) {
      upper = Math.max(upper, Number(historic[i].h));
      lower = Math.min(lower, Number(historic[i].l));
    }
    if (!Number.isFinite(upper) || !Number.isFinite(lower) || upper <= lower) {
      return {
        interval: String(opts.interval || "1d").toLowerCase(),
        label: cfg.label,
        windowBars: windowTarget,
        minBars,
        sampleBars,
        sampleState,
        upper: null,
        lower: null,
        mid: null,
        width: null,
        widthPct: null,
        atr: null,
        buffer: null,
        breakout: null,
        breakdown: null,
        state: "样本不足",
        confidence: 0,
        evidence: ["窗口内无有效高低"],
      };
    }

    const atrArr = atrSeries(windowSlice, atrP);
    const latestAtr = [...atrArr].reverse().find((v) => Number.isFinite(v)) || currentPrice * 0.006;
    const buffer = Math.max(latestAtr * breakoutMult, currentPrice * minPct);
    const mergeDistance = Math.max(latestAtr * 0.22, currentPrice * 0.0008);
    const wing = Math.max(2, Number(opts.swingWing) || 3);
    const start = wing;
    const resistancePool = [];
    const supportPool = [];
    for (let i = start; i < windowSlice.length - wing; i++) {
      const row = windowSlice[i];
      if (i === windowSlice.length - 1) continue;
      let isSwingHigh = true;
      let isSwingLow = true;
      for (let j = i - wing; j <= i + wing; j++) {
        if (j === i) continue;
        if (Number(windowSlice[j].h) > Number(row.h)) isSwingHigh = false;
        if (Number(windowSlice[j].l) < Number(row.l)) isSwingLow = false;
      }
      if (isSwingHigh) {
        mergeKeyLevelCandidate(
          resistancePool,
          { price: Number(row.h), label: "摆动高点", source: "swing-high", score: 1, t: Number(row.t) },
          mergeDistance
        );
      }
      if (isSwingLow) {
        mergeKeyLevelCandidate(
          supportPool,
          { price: Number(row.l), label: "摆动低点", source: "swing-low", score: 1, t: Number(row.t) },
          mergeDistance
        );
      }
    }
    const nearHigh = resistancePool.filter((r) => Math.abs(r.price - upper) <= mergeDistance * 2).length;
    const nearLow = supportPool.filter((r) => Math.abs(r.price - lower) <= mergeDistance * 2).length;

    const mid = (upper + lower) / 2;
    const width = upper - lower;
    const widthPct = currentPrice > 0 ? (width / currentPrice) * 100 : null;
    const breakout = { price: upper + buffer, base: upper, buffer };
    const breakdown = { price: lower - buffer, base: lower, buffer };
    const touchDist = Math.max(latestAtr * 0.25, currentPrice * minPct);

    let state = "区间内";
    if (currentPrice >= breakout.price) state = "已向上突破";
    else if (currentPrice <= breakdown.price) state = "已向下跌破";
    else if (currentPrice > upper && currentPrice < breakout.price) state = "向上突破待确认";
    else if (currentPrice < lower && currentPrice > breakdown.price) state = "向下跌破待确认";
    else if (currentPrice >= upper - touchDist && currentPrice <= upper) state = "测试区间上沿";
    else if (currentPrice <= lower + touchDist && currentPrice >= lower) state = "测试区间下沿";
    else state = "区间内";

    const confScale = Math.min(1, sampleBars / minBars);
    const widthNorm = widthPct != null ? Math.min(1, widthPct / 25) : 0.5;
    const confidence = Math.round(Math.min(1, confScale * (0.5 + 0.5 * widthNorm)) * 100) / 100;

    const evidence = [
      cfg.label,
      `样本 ${sampleBars}/${windowTarget} 根`,
      `窗内摆动贴近上/下沿≈${nearHigh}/${nearLow} 簇`,
    ];
    if (sampleState !== "ok") evidence.push(`状态:${sampleState}`);

    return {
      interval: String(opts.interval || "1d").toLowerCase(),
      label: cfg.label,
      windowBars: windowTarget,
      minBars,
      sampleBars,
      sampleState,
      upper,
      lower,
      mid,
      width,
      widthPct,
      atr: latestAtr,
      buffer,
      breakout,
      breakdown,
      state,
      confidence,
      evidence,
    };
  }

  /**
   * 纯 OHLCV 关键价位：最近摆动高低点、前日高低、ATR 突破缓冲。
   * 输出只做数据层候选，不做交易建议。
   */
  function computeKeyLevels(klines, opts) {
    opts = opts || {};
    if (!Array.isArray(klines) || klines.length < 20) {
      return {
        currentPrice: null,
        atr: null,
        buffer: null,
        resistance: [],
        support: [],
        breakout: null,
        breakdown: null,
        state: "样本不足",
        rangeContext: null,
      };
    }
    const rows = klines
      .filter((row) =>
        row &&
        Number.isFinite(Number(row.t)) &&
        Number.isFinite(Number(row.h)) &&
        Number.isFinite(Number(row.l)) &&
        Number.isFinite(Number(row.c))
      )
      .sort((a, b) => Number(a.t) - Number(b.t));
    if (rows.length < 20) return computeKeyLevels([], opts);

    const latest = rows[rows.length - 1];
    const currentPrice = Number(latest.c);
    const atrP = Number(opts.atrPeriod) || 14;
    const atrArr = atrSeries(rows, atrP);
    const latestAtr = [...atrArr].reverse().find((v) => Number.isFinite(v)) || currentPrice * 0.006;
    const buffer = Math.max(latestAtr * (Number(opts.breakoutAtrMult) || 0.35), currentPrice * 0.0015);
    const mergeDistance = Math.max(latestAtr * 0.22, currentPrice * 0.0008);
    const lookback = Math.max(30, Math.min(rows.length, Number(opts.lookbackBars) || 180));
    const wing = Math.max(2, Number(opts.swingWing) || 3);
    const start = Math.max(wing, rows.length - lookback);
    const resistancePool = [];
    const supportPool = [];

    for (let i = start; i < rows.length - wing; i++) {
      const row = rows[i];
      let isSwingHigh = true;
      let isSwingLow = true;
      for (let j = i - wing; j <= i + wing; j++) {
        if (j === i) continue;
        if (Number(rows[j].h) > Number(row.h)) isSwingHigh = false;
        if (Number(rows[j].l) < Number(row.l)) isSwingLow = false;
      }
      const recency = (i - start + 1) / Math.max(1, rows.length - start);
      if (isSwingHigh) {
        mergeKeyLevelCandidate(resistancePool, {
          price: Number(row.h),
          label: "摆动高点",
          source: "swing-high",
          score: 1 + recency,
          t: Number(row.t),
        }, mergeDistance);
      }
      if (isSwingLow) {
        mergeKeyLevelCandidate(supportPool, {
          price: Number(row.l),
          label: "摆动低点",
          source: "swing-low",
          score: 1 + recency,
          t: Number(row.t),
        }, mergeDistance);
      }
    }

    const prev = prevCompletedDayRange(rows);
    if (prev) {
      mergeKeyLevelCandidate(resistancePool, {
        price: prev.high,
        label: "前日高点",
        source: "prev-day-high",
        score: 2.2,
        t: prev.day,
      }, mergeDistance);
      mergeKeyLevelCandidate(supportPool, {
        price: prev.low,
        label: "前日低点",
        source: "prev-day-low",
        score: 2.2,
        t: prev.day,
      }, mergeDistance);
    }

    const resistance = rankLevels(resistancePool, currentPrice, "resistance", Number(opts.limit) || 6);
    const support = rankLevels(supportPool, currentPrice, "support", Number(opts.limit) || 6);
    const nearestResistance = resistance[0] || null;
    const nearestSupport = support[0] || null;
    const breakout = nearestResistance
      ? { price: nearestResistance.price + buffer, base: nearestResistance.price, buffer }
      : null;
    const breakdown = nearestSupport
      ? { price: nearestSupport.price - buffer, base: nearestSupport.price, buffer }
      : null;

    let state = "区间内";
    if (breakout && currentPrice >= breakout.price) state = "已向上突破";
    else if (nearestResistance && currentPrice >= nearestResistance.price) state = "测试上方压力";
    else if (breakdown && currentPrice <= breakdown.price) state = "已向下跌破";
    else if (nearestSupport && currentPrice <= nearestSupport.price) state = "测试下方支撑";

    const rangeContext = computeRangeContext(rows, {
      interval: opts.interval,
      atrPeriod: atrP,
      breakoutAtrMult: Number(opts.breakoutAtrMult) || 0.35,
      swingWing: wing,
      minBufferPct: Number(opts.minBufferPct) > 0 ? Number(opts.minBufferPct) : 0.0015,
    });

    const fibonacci = computeFibonacciBands(rangeContext, currentPrice, latestAtr);

    return {
      currentPrice,
      atr: latestAtr,
      buffer,
      resistance,
      support,
      breakout,
      breakdown,
      state,
      rangeContext,
      fibonacci,
    };
  }

  /**
   * @param {Array<{t:number,o:number,h:number,l:number,c:number,v:number}>} klines
   * @param {object} opts
   */
  function computeAll(klines, opts) {
    if (!Array.isArray(klines) || klines.length === 0) {
      return {
        ema: [],
        bbUpper: [],
        bbMiddle: [],
        bbLower: [],
        atr: [],
        vwap: [],
        rsi: [],
        macdLine: [],
        macdSignal: [],
        macdHist: [],
      };
    }
    opts = opts || {};
    const closes = klines.map((k) => k.c);
    const emaP = opts.emaPeriod || 20;
    const bbP = opts.bbPeriod || 20;
    const bbM = opts.bbMult != null ? opts.bbMult : 2;
    const atrP = opts.atrPeriod || 14;
    const rsiP = opts.rsiPeriod || 14;
    const macdF = opts.macdFast || 12;
    const macdS = opts.macdSlow || 26;
    const macdSig = opts.macdSignal || 9;

    const emaArr = emaSeries(closes, emaP);
    const bb = rollingSmaStdevBb(closes, bbP, bbM);
    const atrArr = atrSeries(klines, atrP);
    const rsiArr = rsiSeries(closes, rsiP);
    const vwapPts = vwapSeries(klines);
    const macd = macdTriple(klines, closes, macdF, macdS, macdSig);

    return {
      ema: toLinePoints(klines, emaArr),
      bbUpper: toLinePoints(klines, bb.upper),
      bbMiddle: toLinePoints(klines, bb.middle),
      bbLower: toLinePoints(klines, bb.lower),
      atr: toLinePoints(klines, atrArr),
      vwap: vwapPts,
      rsi: toLinePoints(klines, rsiArr),
      macdLine: macd.line,
      macdSignal: macd.signal,
      macdHist: macd.hist,
    };
  }

  global.IndicatorMath = {
    computeAll,
    computeKeyLevels,
    computeChartStructureLevels,
    buildChartHigherContext,
    computeRangeContext,
    computeFibonacciBands,
    resolveChartHigherInterval,
    resolveRangeIntervalConfig,
    timeSec,
  };
})(typeof window !== "undefined" ? window : globalThis);
