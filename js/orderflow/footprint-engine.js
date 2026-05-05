/* =======================================================
   Footprint engine: Binance aggTrade -> per-bar footprint
   ======================================================= */
(function (global) {
  "use strict";

  const DEFAULT_SYMBOL = "BTCUSDT";
const SUPPORTED_INTERVALS = ["5m", "15m", "1h", "4h"];
const DEFAULT_INTERVAL = "15m";
const MAX_CACHE_BARS = 240;
const DEFAULT_LOAD_BARS = 240;
const IMBALANCE_RATIO = 3;
const IMBALANCE_MIN_SMALL = 0.01;
const VALUE_AREA_RATIO = 0.7;
const DELTA_NEUTRAL_SHARE = 0.05;
const STORAGE_PREFIX = "bitdesk.orderflow.footprint";
const WS_RECONNECT_MS = 3000;
const POLL_MS = 10000;
const DISPLAY_AUTO_TICKS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];

  const INTERVAL_MS = {
    "1m": 60 * 1000,
    "3m": 3 * 60 * 1000,
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "30m": 30 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
  };

  function getIntervalMs(interval) {
    if (
      global.DataEngine &&
      typeof global.DataEngine.getIntervalMs === "function"
    ) {
      return global.DataEngine.getIntervalMs(interval);
    }
    return INTERVAL_MS[interval] || INTERVAL_MS[DEFAULT_INTERVAL];
  }

  function autoTickSize(price) {
    const p = Math.abs(Number(price) || 0);
    if (p >= 100000) return 25;
    if (p >= 50000) return 10;
    if (p >= 10000) return 5;
    return 1;
  }

  function resolveTickSize(tickSize, price) {
    if (tickSize === "auto" || tickSize == null || tickSize === "") {
      return autoTickSize(price);
    }
    const n = Number(tickSize);
    return Number.isFinite(n) && n > 0 ? n : autoTickSize(price);
  }

  function decimalsForTick(tick) {
    const s = String(tick);
    const dot = s.indexOf(".");
    return dot >= 0 ? Math.min(8, s.length - dot - 1) : 0;
  }

  function roundPriceToTick(price, tick) {
    const t = Number(tick) || 1;
    const d = decimalsForTick(t);
    return Number((Math.round(Number(price) / t) * t).toFixed(d));
  }

  function detectBaseTick(bars) {
    const prices = [];
    for (const bar of bars || []) {
      for (const level of bar.levels || []) {
        const p = Number(level.price);
        if (Number.isFinite(p)) prices.push(p);
      }
    }
    const uniq = [...new Set(prices)].sort((a, b) => a - b);
    let best = Infinity;
    for (let i = 1; i < uniq.length; i++) {
      const gap = Math.abs(uniq[i] - uniq[i - 1]);
      if (gap > 0 && gap < best) best = gap;
    }
    return Number.isFinite(best) ? best : 10;
  }

  function chooseDisplayTick(bars, plotH) {
    const prices = [];
    for (const bar of bars || []) {
      for (const level of bar.levels || []) {
        const p = Number(level.price);
        if (Number.isFinite(p)) prices.push(p);
      }
    }
    if (!prices.length) return 10;
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    const range = Math.max(1, hi - lo);
    const targetRows = Math.max(30, Math.min(45, Math.floor((Number(plotH) || 640) / 16)));
    const baseTick = detectBaseTick(bars);
    for (const tick of DISPLAY_AUTO_TICKS) {
      if (tick < baseTick) continue;
      if (Math.ceil(range / tick) + 1 <= targetRows) return tick;
    }
    return DISPLAY_AUTO_TICKS[DISPLAY_AUTO_TICKS.length - 1];
  }

  function bucketStart(timeMs, interval) {
    const step = getIntervalMs(interval);
    return Math.floor(Number(timeMs) / step) * step;
  }

  function levelImbalance(buyVol, sellVol, ratio, minSmall) {
    const b = Number(buyVol) || 0;
    const s = Number(sellVol) || 0;
    const small = Math.min(b, s);
    const big = Math.max(b, s);
    if (small < minSmall || big <= 0) return null;
    if (big / small < ratio) return null;
    return b > s ? "buy" : "sell";
  }

  function normalizeLevel(level, ratio, minSmall) {
    const buyVol = Number(level.buyVol) || 0;
    const sellVol = Number(level.sellVol) || 0;
    const total = buyVol + sellVol;
    return {
      price: Number(level.price),
      buyVol,
      sellVol,
      delta: buyVol - sellVol,
      total,
      imbalance: levelImbalance(buyVol, sellVol, ratio, minSmall),
    };
  }

  function rebinDisplayBars(bars, tickSize, opts) {
    opts = opts || {};
    const explicit = tickSize !== "auto" && tickSize != null && tickSize !== "";
    const tick = explicit
      ? Math.max(1e-8, Number(tickSize) || 10)
      : chooseDisplayTick(bars, opts.plotH);
    const ratio = Number(opts.imbalanceRatio) || IMBALANCE_RATIO;
    const minSmall = Number(opts.imbalanceMinSmall) || IMBALANCE_MIN_SMALL;
    const out = (bars || []).map((bar) => {
      const map = new Map();
      for (const level of bar.levels || []) {
        const price = roundPriceToTick(level.price, tick);
        if (!map.has(price)) map.set(price, { price, buyVol: 0, sellVol: 0 });
        const row = map.get(price);
        row.buyVol += Number(level.buyVol) || 0;
        row.sellVol += Number(level.sellVol) || 0;
      }
      const levels = [...map.values()]
        .map((level) => normalizeLevel(level, ratio, minSmall))
        .filter((level) => Number.isFinite(level.price) && level.total > 0)
        .sort((a, b) => b.price - a.price);
      let buyVol = 0;
      let sellVol = 0;
      let pocPrice = null;
      let maxTotal = -1;
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
    });
    return { bars: out, tick };
  }

  function analyzeImbalance(bars, opts) {
    opts = opts || {};
    const ratio = Number(opts.imbalanceRatio) || IMBALANCE_RATIO;
    const minSmall = Number(opts.imbalanceMinSmall) || IMBALANCE_MIN_SMALL;
    const byPrice = new Map();
    const events = [];
    let buyCount = 0;
    let sellCount = 0;
    let currentSide = null;
    let currentRun = 0;
    let longestRun = { side: null, count: 0, endT: null };

    for (const bar of bars || []) {
      let barBuy = 0;
      let barSell = 0;
      for (const level of bar.levels || []) {
        const side = level.imbalance || levelImbalance(level.buyVol, level.sellVol, ratio, minSmall);
        if (!side) continue;
        const buyVol = Number(level.buyVol) || 0;
        const sellVol = Number(level.sellVol) || 0;
        const total = buyVol + sellVol;
        const price = Number(level.price);
        if (side === "buy") {
          buyCount++;
          barBuy++;
        } else {
          sellCount++;
          barSell++;
        }
        if (!byPrice.has(price)) {
          byPrice.set(price, { price, buyCount: 0, sellCount: 0, totalVol: 0, netCount: 0 });
        }
        const row = byPrice.get(price);
        if (side === "buy") row.buyCount++;
        else row.sellCount++;
        row.totalVol += total;
        row.netCount = row.buyCount - row.sellCount;
        events.push({
          t: Number(bar.t),
          price,
          side,
          buyVol,
          sellVol,
          total,
          barDelta: Number(bar.delta) || 0,
        });
      }
      const side = barBuy > barSell ? "buy" : (barSell > barBuy ? "sell" : null);
      if (!side) {
        currentSide = null;
        currentRun = 0;
      } else if (side === currentSide) {
        currentRun++;
      } else {
        currentSide = side;
        currentRun = 1;
      }
      if (currentRun > longestRun.count) {
        longestRun = { side: currentSide, count: currentRun, endT: Number(bar.t) };
      }
    }

    const topPrices = [...byPrice.values()]
      .sort((a, b) => Math.abs(b.netCount) - Math.abs(a.netCount) || b.totalVol - a.totalVol || b.price - a.price)
      .slice(0, Number(opts.limit) || 8);

    return {
      barCount: Array.isArray(bars) ? bars.length : 0,
      buyCount,
      sellCount,
      netCount: buyCount - sellCount,
      latest: events.length ? events[events.length - 1] : null,
      longestRun,
      topPrices,
      events,
    };
  }

  function buildVolumeProfile(bars, opts) {
    opts = opts || {};
    const valueAreaRatio = Math.max(0.01, Math.min(1, Number(opts.valueAreaRatio) || VALUE_AREA_RATIO));
    const map = new Map();
    for (const bar of bars || []) {
      for (const level of bar.levels || []) {
        const price = Number(level.price);
        if (!Number.isFinite(price)) continue;
        if (!map.has(price)) map.set(price, { price, buyVol: 0, sellVol: 0, delta: 0, total: 0 });
        const row = map.get(price);
        row.buyVol += Number(level.buyVol) || 0;
        row.sellVol += Number(level.sellVol) || 0;
        row.delta = row.buyVol - row.sellVol;
        row.total = row.buyVol + row.sellVol;
      }
    }

    const levels = [...map.values()]
      .filter((level) => level.total > 0)
      .sort((a, b) => a.price - b.price);
    let totalVolume = 0;
    let buyVol = 0;
    let sellVol = 0;
    let pocIndex = -1;
    let maxTotal = -1;
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      totalVolume += level.total;
      buyVol += level.buyVol;
      sellVol += level.sellVol;
      if (level.total > maxTotal) {
        maxTotal = level.total;
        pocIndex = i;
      }
    }
    if (!levels.length || totalVolume <= 0 || pocIndex < 0) {
      return {
        levels: [],
        topLevels: [],
        totalVolume: 0,
        buyVol: 0,
        sellVol: 0,
        pocPrice: null,
        vah: null,
        val: null,
        valueVolume: 0,
        coverage: 0,
        valueAreaRatio,
      };
    }

    let low = pocIndex;
    let high = pocIndex;
    let valueVolume = levels[pocIndex].total;
    const targetVolume = totalVolume * valueAreaRatio;
    while (valueVolume < targetVolume && (low > 0 || high < levels.length - 1)) {
      const lower = low > 0 ? levels[low - 1] : null;
      const upper = high < levels.length - 1 ? levels[high + 1] : null;
      if (lower && upper && Math.abs(lower.total - upper.total) < 1e-12) {
        low--;
        high++;
        valueVolume += lower.total + upper.total;
      } else if (!upper || (lower && lower.total > upper.total)) {
        low--;
        valueVolume += levels[low].total;
      } else {
        high++;
        valueVolume += levels[high].total;
      }
    }

    const topLevels = levels
      .slice()
      .sort((a, b) => b.total - a.total || b.price - a.price)
      .slice(0, Number(opts.limit) || 10);

    return {
      levels,
      topLevels,
      totalVolume,
      buyVol,
      sellVol,
      pocPrice: levels[pocIndex].price,
      vah: levels[high].price,
      val: levels[low].price,
      valueVolume,
      coverage: valueVolume / totalVolume,
      valueAreaRatio,
    };
  }

  function barField(bar, longKey, shortKey) {
    const v = bar && bar[longKey] != null ? bar[longKey] : (bar ? bar[shortKey] : null);
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }

  function normalizeSfpBar(bar) {
    if (!bar) return null;
    const open = barField(bar, "open", "o");
    const high = barField(bar, "high", "h");
    const low = barField(bar, "low", "l");
    const close = barField(bar, "close", "c");
    const volume = Number(bar.volume != null ? bar.volume : bar.v);
    return {
      ...bar,
      t: Number(bar.t),
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) ? volume : (Number(bar.buyVol) || 0) + (Number(bar.sellVol) || 0),
      buyVol: Number(bar.buyVol) || 0,
      sellVol: Number(bar.sellVol) || 0,
      delta: Number(bar.delta) || 0,
      levels: Array.isArray(bar.levels) ? bar.levels : [],
    };
  }

  function median(nums) {
    const arr = (nums || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!arr.length) return 0;
    const mid = Math.floor(arr.length / 2);
    return arr.length % 2 ? arr[mid] : (arr[mid - 1] + arr[mid]) / 2;
  }

  function addSfpLevel(list, level, mergeDistance) {
    if (!level || !Number.isFinite(Number(level.price))) return;
    const side = level.side === "resistance" ? "resistance" : "support";
    const price = Number(level.price);
    const dist = Math.max(1e-8, Number(mergeDistance) || 0);
    const found = list.find((row) => row.side === side && Math.abs(Number(row.price) - price) <= dist);
    const source = level.source || level.label || "level";
    if (!found) {
      list.push({
        price,
        side,
        label: level.label || (side === "resistance" ? "上方关键位" : "下方关键位"),
        score: Number(level.score) || 1,
        sources: [source],
      });
      return;
    }
    found.score += Number(level.score) || 1;
    if (source && found.sources.indexOf(source) < 0) found.sources.push(source);
    found.label = found.label || level.label;
    found.price = Number(((found.price + price) / 2).toFixed(8));
  }

  function buildSfpKeyLevels(bars, opts) {
    opts = opts || {};
    const rows = (bars || []).map(normalizeSfpBar).filter((bar) =>
      bar &&
      Number.isFinite(bar.t) &&
      Number.isFinite(bar.high) &&
      Number.isFinite(bar.low) &&
      Number.isFinite(bar.close)
    );
    if (!rows.length) return [];

    const latest = Number(rows[rows.length - 1].close);
    const tick = Number(opts.effectiveTickSize) || detectBaseTick(rows) || autoTickSize(latest);
    const span = Math.max(1, latest * 0.004);
    const mergeDistance = Math.max(tick * 2, span * 0.2, latest * 0.0008);
    const out = [];
    const route = (price, base) => {
      const n = Number(price);
      if (!Number.isFinite(n)) return;
      const side = base.side || (n >= latest ? "resistance" : "support");
      addSfpLevel(out, { ...base, price: n, side }, mergeDistance);
    };

    const profile = buildVolumeProfile(rows);
    if (profile && profile.levels && profile.levels.length) {
      route(profile.vah, { label: "价值区上沿", source: "VAH", score: 4, side: "resistance" });
      route(profile.val, { label: "价值区下沿", source: "VAL", score: 4, side: "support" });
      route(profile.pocPrice, { label: "POC", source: "POC", score: 3 });
      for (const row of profile.topLevels || []) {
        route(row.price, {
          label: "高成交节点",
          source: "VP",
          score: 1.5 + (Number(row.total) || 0) / Math.max(1, Number(profile.totalVolume) || 1),
        });
      }
    }

    const imbalance = analyzeImbalance(rows);
    for (const row of (imbalance && imbalance.topPrices) || []) {
      route(row.price, {
        label: Number(row.netCount) >= 0 ? "买方失衡密集价" : "卖方失衡密集价",
        source: "Imbalance",
        score: 2 + Math.min(3, Math.abs(Number(row.netCount) || 0) * 0.4),
      });
    }

    const wing = Math.max(2, Number(opts.swingWing) || 2);
    const start = Math.max(wing, rows.length - (Number(opts.lookbackBars) || 48));
    for (let i = start; i < rows.length - wing; i++) {
      let high = true;
      let low = true;
      for (let j = i - wing; j <= i + wing; j++) {
        if (j === i) continue;
        if (rows[j].high > rows[i].high) high = false;
        if (rows[j].low < rows[i].low) low = false;
      }
      const recency = (i - start + 1) / Math.max(1, rows.length - start);
      if (high) route(rows[i].high, { label: "足迹摆动高点", source: "footprint-swing-high", score: 1.4 + recency, side: "resistance" });
      if (low) route(rows[i].low, { label: "足迹摆动低点", source: "footprint-swing-low", score: 1.4 + recency, side: "support" });
    }

    const technical = opts.technicalLevels || {};
    for (const row of technical.resistance || []) {
      route(row.price, {
        label: row.label || "K线压力",
        source: row.source || "technical",
        score: 2.6 + (Number(row.score) || 0),
        side: "resistance",
      });
    }
    for (const row of technical.support || []) {
      route(row.price, {
        label: row.label || "K线支撑",
        source: row.source || "technical",
        score: 2.6 + (Number(row.score) || 0),
        side: "support",
      });
    }

    return out
      .sort((a, b) => b.score - a.score || Math.abs(a.price - latest) - Math.abs(b.price - latest))
      .slice(0, Number(opts.limit) || 18);
  }

  function sfpNone(reason) {
    return {
      status: "none",
      direction: null,
      score: 0,
      level: null,
      levelLabel: "",
      levelSources: [],
      sweepBar: null,
      confirmBar: null,
      sweepPrice: null,
      reclaimPrice: null,
      invalidationPrice: null,
      evidence: reason ? [{ label: "样本状态", state: "miss", detail: reason }] : [],
      candidates: [],
    };
  }

  function zoneFootprintStats(bars, level, zone) {
    const out = { buyVol: 0, sellVol: 0, delta: 0, buyImbalance: 0, sellImbalance: 0 };
    for (const bar of bars || []) {
      for (const row of bar.levels || []) {
        const price = Number(row.price);
        if (!Number.isFinite(price) || Math.abs(price - level) > zone) continue;
        const buy = Number(row.buyVol) || 0;
        const sell = Number(row.sellVol) || 0;
        out.buyVol += buy;
        out.sellVol += sell;
        const side = row.imbalance || levelImbalance(buy, sell, IMBALANCE_RATIO, IMBALANCE_MIN_SMALL);
        if (side === "buy") out.buyImbalance++;
        if (side === "sell") out.sellImbalance++;
      }
    }
    out.delta = out.buyVol - out.sellVol;
    out.total = out.buyVol + out.sellVol;
    out.buyShare = out.total > 0 ? out.buyVol / out.total : 0;
    out.sellShare = out.total > 0 ? out.sellVol / out.total : 0;
    return out;
  }

  function describeSfpStatus(status) {
    if (status === "confirmed") return "规则收回已满足";
    if (status === "forming") return "候选形成中";
    if (status === "expired") return "候选已失效";
    return "无信号";
  }

  function analyzeSfp(bars, opts) {
    opts = opts || {};
    const rows = (bars || []).map(normalizeSfpBar).filter((bar) =>
      bar &&
      Number.isFinite(bar.t) &&
      Number.isFinite(bar.high) &&
      Number.isFinite(bar.low) &&
      Number.isFinite(bar.close)
    );
    const minBars = Number(opts.minBars) || 20;
    if (rows.length < minBars) return sfpNone(`至少需要 ${minBars} 根足迹 Bar`);

    const latest = Number(rows[rows.length - 1].close);
    const tick = Number(opts.effectiveTickSize) || detectBaseTick(rows) || autoTickSize(latest);
    const lookbackBars = Number(opts.lookbackBars) || 48;
    const recentBars = Number(opts.recentBars) || 8;
    const confirmBars = Number(opts.confirmBars) || 2;
    const sweepBuffer = Math.max(tick, latest * 0.0003);
    const zone = Math.max(tick * 2, latest * 0.0008);
    const levels = Array.isArray(opts.keyLevels) ? opts.keyLevels : buildSfpKeyLevels(rows, {
      ...opts,
      effectiveTickSize: tick,
    });
    if (!levels.length) return sfpNone("当前窗口没有可用于 SFP 的关键位");

    const volumeMedian = median(rows.map((bar) => bar.volume));
    const scanStart = Math.max(0, rows.length - lookbackBars);
    const candidates = [];

    for (const level of levels) {
      const price = Number(level.price);
      if (!Number.isFinite(price)) continue;
      const isSupport = level.side !== "resistance";
      for (let i = scanStart; i < rows.length; i++) {
        const sweepBar = rows[i];
        const swept = isSupport
          ? sweepBar.low < price - sweepBuffer
          : sweepBar.high > price + sweepBuffer;
        if (!swept) continue;

        let confirmIndex = -1;
        const maxConfirm = Math.min(rows.length - 1, i + confirmBars);
        for (let j = i; j <= maxConfirm; j++) {
          const close = Number(rows[j].close);
          if (isSupport ? close > price : close < price) {
            confirmIndex = j;
            break;
          }
        }

        const stillOpen = i + confirmBars >= rows.length - 1;
        const status = confirmIndex >= 0 ? "confirmed" : (stillOpen ? "forming" : "expired");
        const confirmBar = confirmIndex >= 0 ? rows[confirmIndex] : null;
        const eventIndex = confirmIndex >= 0 ? confirmIndex : i;
        const recencyBars = rows.length - 1 - eventIndex;
        if (recencyBars > recentBars && status !== "confirmed") continue;

        const scanBars = rows.slice(i, Math.max(i + 1, (confirmIndex >= 0 ? confirmIndex : i) + 1));
        const zoneStats = zoneFootprintStats(scanBars, price, zone);
        const dir = isSupport ? "bullish" : "bearish";
        const deltaOk = dir === "bullish" ? zoneStats.delta > 0 : zoneStats.delta < 0;
        const shareOk = dir === "bullish" ? zoneStats.buyShare >= 0.55 : zoneStats.sellShare >= 0.55;
        const imbOk = dir === "bullish" ? zoneStats.buyImbalance > 0 : zoneStats.sellImbalance > 0;
        const volumeSpike = volumeMedian > 0 && Number(sweepBar.volume) >= volumeMedian * 1.15;
        const keyScore = Math.min(25, 6 + (Array.isArray(level.sources) ? level.sources.length : 1) * 4 + (Number(level.score) || 0) * 1.5);
        const footprintScore = Math.min(25, (deltaOk ? 10 : 0) + (shareOk ? 8 : 0) + (imbOk ? 7 : 0));
        const baseScore = status === "confirmed" ? 40 : (status === "forming" ? 24 : 12);
        const recencyScore = Math.max(0, 10 - recencyBars * 1.5);
        const score = Math.round(Math.max(0, Math.min(100, baseScore + keyScore + footprintScore + recencyScore)));
        const sweepPrice = isSupport ? sweepBar.low : sweepBar.high;
        const reclaimPrice = confirmBar ? confirmBar.close : null;
        const invalidationPrice = isSupport ? sweepPrice - sweepBuffer : sweepPrice + sweepBuffer;
        const evidence = [
          {
            label: "关键位",
            state: keyScore >= 16 ? "ok" : "warn",
            detail: `${level.label || (isSupport ? "支撑" : "压力")} · ${(level.sources || []).join(" / ") || "orderflow"}`,
          },
          {
            label: "扫流动性",
            state: "ok",
            detail: isSupport ? `最低价下探到 ${sweepPrice}` : `最高价上探到 ${sweepPrice}`,
          },
          {
            label: "收回确认",
            state: status === "confirmed" ? "ok" : (status === "forming" ? "warn" : "miss"),
            detail: status === "confirmed" ? `收盘收回到 ${reclaimPrice}` : describeSfpStatus(status),
          },
          {
            label: "足迹确认",
            state: footprintScore >= 15 ? "ok" : (footprintScore > 0 ? "warn" : "miss"),
            detail: `Delta ${zoneStats.delta.toFixed(2)} · 买 ${(zoneStats.buyShare * 100).toFixed(1)}% / 卖 ${(zoneStats.sellShare * 100).toFixed(1)}%`,
          },
          {
            label: "失效价",
            state: "warn",
            detail: `${Number(invalidationPrice).toFixed(tick >= 1 ? 0 : 2)}`,
          },
        ];
        candidates.push({
          status,
          direction: dir,
          score,
          level: price,
          levelLabel: level.label || (isSupport ? "支撑" : "压力"),
          levelSources: Array.isArray(level.sources) ? level.sources.slice() : [],
          sweepBar,
          confirmBar,
          sweepPrice,
          reclaimPrice,
          invalidationPrice,
          evidence,
          recencyBars,
        });
      }
    }

    candidates.sort((a, b) => {
      const rank = { confirmed: 3, forming: 2, expired: 1, none: 0 };
      return (rank[b.status] || 0) - (rank[a.status] || 0) || b.score - a.score || a.recencyBars - b.recencyBars;
    });

    const active = candidates.find((row) => row.status === "confirmed" || row.status === "forming")
      || candidates.find((row) => row.recencyBars <= recentBars)
      || null;
    if (!active) {
      const none = sfpNone("最近窗口未识别到有效扫位收回");
      none.candidates = candidates.slice(0, 5);
      return none;
    }
    return {
      ...active,
      candidates: candidates.slice(0, 5),
    };
  }

  function addReadModelLevel(list, level, mergeDistance) {
    if (!level || !Number.isFinite(Number(level.price))) return;
    const dist = Math.max(1e-8, Number(mergeDistance) || 0);
    const price = Number(level.price);
    const found = list.find((row) => Math.abs(Number(row.price) - price) <= dist);
    if (!found) {
      list.push({
        price,
        label: level.label || "关键价位",
        score: Number(level.score) || 1,
        sources: level.source ? [level.source] : (Array.isArray(level.sources) ? level.sources.slice() : []),
      });
      return;
    }
    found.score += Number(level.score) || 1;
    const sources = level.source ? [level.source] : (Array.isArray(level.sources) ? level.sources : []);
    for (const source of sources) {
      if (source && found.sources.indexOf(source) < 0) found.sources.push(source);
    }
    found.label = found.label || level.label;
  }

  function readModelSideText(side) {
    return side === "buy" ? "买方" : (side === "sell" ? "卖方" : "无明显方向");
  }

  function readModelPriceText(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "--";
    return n >= 1000 ? n.toFixed(0) : n.toFixed(2);
  }

  function readModelVolText(v) {
    const n = Number(v) || 0;
    if (Math.abs(n) >= 100) return n.toFixed(0);
    if (Math.abs(n) >= 10) return n.toFixed(1);
    if (Math.abs(n) >= 1) return n.toFixed(2);
    return n.toFixed(3);
  }

  function readModelPctText(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "--";
    return `${(n * 100).toFixed(1)}%`;
  }

  function barVolumeForDelta(bar) {
    if (!bar) return 0;
    const v = Number(bar.volume != null ? bar.volume : bar.v);
    if (Number.isFinite(v) && v > 0) return v;
    return (Number(bar.buyVol) || 0) + (Number(bar.sellVol) || 0);
  }

  function readModelDeltaBias(bar, opts) {
    opts = opts || {};
    const delta = Number(bar && bar.delta) || 0;
    const volume = barVolumeForDelta(bar);
    const neutralShare = Number.isFinite(Number(opts.neutralShare))
      ? Math.max(0, Number(opts.neutralShare))
      : DELTA_NEUTRAL_SHARE;
    const share = volume > 0 ? Math.abs(delta) / volume : 0;
    if (volume <= 0 || share < neutralShare || delta === 0) {
      return {
        side: "neutral",
        tone: "",
        label: "主动成交接近均衡",
        detail: volume > 0 ? `Delta 占比 ${readModelPctText(share)}` : "当前 Bar 成交量为空",
        delta,
        volume,
        share,
      };
    }
    const side = delta > 0 ? "buy" : "sell";
    return {
      side,
      tone: side === "buy" ? "up" : "down",
      label: `${readModelSideText(side)}主动成交相对占优`,
      detail: `Delta 占比 ${readModelPctText(share)}`,
      delta,
      volume,
      share,
    };
  }

  function normalizeOrderflowDataFreshness(input, latestBar, interval) {
    const hasInput = !!input;
    const meta = input || {};
    const lastSync = meta.lastSync || {};
    const syncResult = meta.syncResult || null;
    const now = Number.isFinite(Number(meta.now)) ? Number(meta.now) : Date.now();
    const intervalName = meta.interval || interval || DEFAULT_INTERVAL;
    const step = getIntervalMs(intervalName);
    const latestT = Number(meta.latestT != null ? meta.latestT : NaN);
    const lastTradeTime = Number(lastSync.last_trade_time != null ? lastSync.last_trade_time : NaN);
    const fallbackBarT = hasInput && latestBar ? Number(latestBar.t) : NaN;
    const reference = Number.isFinite(lastTradeTime) && lastTradeTime > 0
      ? lastTradeTime
      : (Number.isFinite(latestT) && latestT > 0
        ? Math.min(now, latestT + step)
        : (Number.isFinite(fallbackBarT) && fallbackBarT > 0 ? Math.min(now, fallbackBarT + step) : NaN));
    const ageMs = Number.isFinite(reference) ? Math.max(0, now - reference) : null;
    const latestBarT = latestBar ? Number(latestBar.t) : NaN;
    const latestBarClosed = Number.isFinite(latestBarT) ? now >= latestBarT + step : null;
    const syncFailed = (lastSync.last_ok != null && Number(lastSync.last_ok) === 0) ||
      (syncResult && syncResult.ok === false);
    const freshLimit = Math.max(45_000, Math.min(step, 2 * 60_000));
    const staleLimit = Math.max(step * 2, 10 * 60_000);
    let status = "unknown";
    if (ageMs != null) {
      if (syncFailed && ageMs > freshLimit) status = "stale";
      else if (ageMs <= freshLimit) status = syncFailed ? "delayed" : "fresh";
      else if (ageMs <= staleLimit) status = "delayed";
      else status = "stale";
    } else if (syncFailed) {
      status = "stale";
    }
    const label = status === "fresh"
      ? "D1 轮询新鲜"
      : (status === "delayed" ? "D1 轮询延迟" : (status === "stale" ? "D1 数据过旧" : "新鲜度待确认"));
    return {
      status,
      label,
      tone: status === "fresh" ? "ok" : (status === "unknown" ? "" : "warn"),
      isDegraded: status === "delayed" || status === "stale",
      syncFailed,
      ageMs,
      latestT: Number.isFinite(latestT) ? latestT : null,
      lastTradeTime: Number.isFinite(lastTradeTime) ? lastTradeTime : null,
      latestBarClosed,
      interval: intervalName,
      reason: syncFailed ? "同步状态异常" : "",
    };
  }

  function buildSfpPresentation(sfp, dataFreshness) {
    const rawStatus = sfp && sfp.status ? sfp.status : "none";
    let status = rawStatus;
    let reason = "";
    if (
      rawStatus === "confirmed" &&
      dataFreshness &&
      (dataFreshness.isDegraded || dataFreshness.latestBarClosed === false)
    ) {
      status = "forming";
      reason = dataFreshness.isDegraded ? dataFreshness.label : "最新 Bar 尚未收完";
    }
    return {
      status,
      originalStatus: rawStatus,
      statusText: describeSfpStatus(status),
      scoreLabel: "结构分",
      isDegraded: status !== rawStatus,
      reason,
    };
  }

  function dashboardMetric(label, value, tone) {
    return {
      label,
      value: value == null || value === "" ? "--" : String(value),
      tone: tone || "",
    };
  }

  function buildOrderflowDashboard(ctx) {
    ctx = ctx || {};
    const latestBar = ctx.latestBar || null;
    const volumeProfile = ctx.volumeProfile || buildVolumeProfile([]);
    const imbalance = ctx.imbalance || analyzeImbalance([]);
    const keyLevels = ctx.keyLevels || buildReadModelKeyLevels([], null, null, {});
    const sfp = ctx.sfp || sfpNone("SFP 暂不可用");
    const dataFreshness = ctx.dataFreshness || normalizeOrderflowDataFreshness(null, latestBar, ctx.interval);
    const deltaBias = ctx.deltaBias || readModelDeltaBias(latestBar);
    const sfpDisplay = ctx.sfpDisplay || buildSfpPresentation(sfp, dataFreshness);
    const summary = ctx.summary || {};
    const nearestResistance = keyLevels.resistance && keyLevels.resistance[0] ? keyLevels.resistance[0] : null;
    const nearestSupport = keyLevels.support && keyLevels.support[0] ? keyLevels.support[0] : null;
    const totalImbalance = Number(imbalance.buyCount || 0) + Number(imbalance.sellCount || 0);
    const netImbalance = Number(imbalance.netCount) || 0;
    const imbalanceTone = netImbalance > 2 ? "up" : (netImbalance < -2 ? "down" : "");
    const sfpTone = sfp.direction === "bullish" ? "up" : (sfp.direction === "bearish" ? "down" : "");
    const levelsTone = keyLevels.location === "breakout" || keyLevels.location === "above-value"
      ? "up"
      : (keyLevels.location === "breakdown" || keyLevels.location === "below-value" ? "down" : "");
    const hasSfp = sfpDisplay.status !== "none" && sfpDisplay.status !== "expired";
    const activeKey = hasSfp
      ? "sfp"
      : (totalImbalance ? "imbalance" : (volumeProfile && volumeProfile.levels && volumeProfile.levels.length ? "volumeProfile" : "levels"));
    const freshnessSummary = dataFreshness.isDegraded
      ? `${dataFreshness.label}，规则读数需谨慎`
      : (dataFreshness.status === "unknown" ? "数据新鲜度待确认" : dataFreshness.label);
    const imbalanceStatus = totalImbalance
      ? (netImbalance > 2 ? "买方阈值价位较多" : (netImbalance < -2 ? "卖方阈值价位较多" : "阈值价位相对均衡"))
      : "无阈值失衡";

    return {
      activeKey,
      primary: summary.primary || "等待当前可视足迹数据",
      dataFreshness,
      deltaBias,
      sfpDisplay,
      cards: {
        levels: {
          title: "关键位观察",
          status: keyLevels.state || "样本不足",
          badge: dataFreshness.isDegraded ? "降级" : "规则",
          tone: levelsTone,
          summary: summary.levels || "关键位观察暂不可用",
          metrics: [
            dashboardMetric("上方压力", nearestResistance ? readModelPriceText(nearestResistance.price) : "--", "down"),
            dashboardMetric("下方支撑", nearestSupport ? readModelPriceText(nearestSupport.price) : "--", "up"),
            dashboardMetric("上破观察价", keyLevels.breakout ? readModelPriceText(keyLevels.breakout.price) : "--", "down"),
            dashboardMetric("下破观察价", keyLevels.breakdown ? readModelPriceText(keyLevels.breakdown.price) : "--", "up"),
          ],
        },
        imbalance: {
          title: "买卖失衡",
          status: imbalanceStatus,
          badge: totalImbalance ? `价位净 ${netImbalance >= 0 ? "+" : ""}${netImbalance}` : "均衡",
          tone: imbalanceTone,
          summary: summary.imbalance || "买卖失衡暂不可用",
          metrics: [
            dashboardMetric("买方失衡", imbalance.buyCount || 0, "up"),
            dashboardMetric("卖方失衡", imbalance.sellCount || 0, "down"),
            dashboardMetric("净失衡", `${netImbalance >= 0 ? "+" : ""}${netImbalance}`, imbalanceTone),
            dashboardMetric("最近失衡", imbalance.latest ? `${readModelSideText(imbalance.latest.side)} @ ${readModelPriceText(imbalance.latest.price)}` : "--"),
          ],
        },
        volumeProfile: {
          title: "成交分布",
          status: volumeProfile && volumeProfile.levels && volumeProfile.levels.length ? "可视窗口价值区" : "样本不足",
          badge: volumeProfile && Number.isFinite(Number(volumeProfile.pocPrice)) ? `POC ${readModelPriceText(volumeProfile.pocPrice)}` : "等待",
          tone: "",
          summary: summary.volume || "成交分布暂不可用",
          metrics: [
            dashboardMetric("POC", readModelPriceText(volumeProfile.pocPrice)),
            dashboardMetric("VAH", readModelPriceText(volumeProfile.vah), "down"),
            dashboardMetric("VAL", readModelPriceText(volumeProfile.val), "up"),
            dashboardMetric("覆盖", readModelPctText(volumeProfile.coverage)),
          ],
        },
        sfp: {
          title: "SFP 假突破",
          status: sfpDisplay.statusText,
          badge: sfpDisplay.status !== "none" ? sfpDisplay.statusText : "无信号",
          tone: sfpTone,
          summary: summary.sfp || "SFP 暂不可用",
          metrics: [
            dashboardMetric("方向", sfp.direction === "bullish" ? "多头" : (sfp.direction === "bearish" ? "空头" : "无方向"), sfpTone),
            dashboardMetric("关键位", readModelPriceText(sfp.level)),
            dashboardMetric("结构分", sfp.score != null ? `${sfp.score}/100` : "--", sfp.score >= 75 ? "up" : ""),
            dashboardMetric("失效价", readModelPriceText(sfp.invalidationPrice), "down"),
          ],
        },
      },
      latest: latestBar ? `当前 ${readModelPriceText(latestBar.close)}，Delta ${readModelVolText(latestBar.delta)}，${deltaBias.label}` : "等待最新 Bar",
      dataNote: freshnessSummary,
    };
  }

  function buildReadModelKeyLevels(rows, profile, imbalance, opts) {
    opts = opts || {};
    const latestBar = rows && rows.length ? rows[rows.length - 1] : null;
    const latest = latestBar ? Number(latestBar.close) : NaN;
    if (!Number.isFinite(latest)) {
      return {
        latest: null,
        support: [],
        resistance: [],
        breakout: null,
        breakdown: null,
        buffer: null,
        state: "样本不足",
        location: "unknown",
        technicalState: "",
        technicalAtr: null,
      };
    }
    const span = profile && Number.isFinite(Number(profile.vah)) && Number.isFinite(Number(profile.val))
      ? Math.max(1, Number(profile.vah) - Number(profile.val))
      : Math.max(1, latest * 0.004);
    const buffer = Math.max(span * 0.08, latest * 0.0015);
    const mergeDistance = Math.max(span * 0.05, latest * 0.0008);
    const support = [];
    const resistance = [];
    const route = (price, base) => {
      const n = Number(price);
      if (!Number.isFinite(n)) return;
      const target = n >= latest ? resistance : support;
      addReadModelLevel(target, { ...base, price: n }, mergeDistance);
    };

    if (profile && profile.levels && profile.levels.length) {
      route(profile.vah, { label: "价值区上沿", source: "VAH", score: 3 });
      route(profile.val, { label: "价值区下沿", source: "VAL", score: 3 });
      route(profile.pocPrice, { label: "成交最集中", source: "POC", score: 2.5 });
      for (const row of profile.topLevels || []) {
        route(row.price, {
          label: "高成交节点",
          source: "VP",
          score: 1.2 + (Number(row.total) || 0) / Math.max(1, Number(profile.totalVolume) || 1),
        });
      }
    }

    for (const row of (imbalance && imbalance.topPrices) || []) {
      const net = Number(row.netCount) || 0;
      route(row.price, {
        label: net >= 0 ? "买方失衡密集价" : "卖方失衡密集价",
        source: "Imbalance",
        score: 1.8 + Math.abs(net) * 0.2,
      });
    }

    const technical = opts.technicalLevels || {};
    for (const row of technical.resistance || []) {
      route(row.price, {
        label: row.label || "K线压力",
        source: row.source || "technical",
        score: 2.2 + (Number(row.score) || 0),
      });
    }
    for (const row of technical.support || []) {
      route(row.price, {
        label: row.label || "K线支撑",
        source: row.source || "technical",
        score: 2.2 + (Number(row.score) || 0),
      });
    }

    const sortNear = (a, b) => Math.abs(a.price - latest) - Math.abs(b.price - latest) || b.score - a.score;
    support.sort(sortNear);
    resistance.sort(sortNear);
    const nearestResistance = resistance[0] || null;
    const nearestSupport = support[0] || null;
    const breakout = nearestResistance ? { base: nearestResistance.price, price: nearestResistance.price + buffer, buffer } : null;
    const breakdown = nearestSupport ? { base: nearestSupport.price, price: nearestSupport.price - buffer, buffer } : null;
    let state = "仍在主要成交区内";
    let location = "value";
    if (breakout && latest >= breakout.price) {
      state = "越过上破观察价";
      location = "breakout";
    } else if (nearestResistance && latest >= nearestResistance.price) {
      state = "进入上方压力测试区";
      location = "resistance";
    } else if (breakdown && latest <= breakdown.price) {
      state = "跌破下破观察价";
      location = "breakdown";
    } else if (nearestSupport && latest <= nearestSupport.price) {
      state = "进入下方支撑测试区";
      location = "support";
    } else if (profile && Number.isFinite(Number(profile.vah)) && latest > Number(profile.vah)) {
      state = "价格站在价值区上方";
      location = "above-value";
    } else if (profile && Number.isFinite(Number(profile.val)) && latest < Number(profile.val)) {
      state = "价格站在价值区下方";
      location = "below-value";
    }

    return {
      latest,
      support: support.slice(0, 5),
      resistance: resistance.slice(0, 5),
      breakout,
      breakdown,
      buffer,
      state,
      location,
      technicalState: technical.state || "",
      technicalAtr: technical.atr,
    };
  }

  function buildOrderflowReadModel(bars, opts) {
    opts = opts || {};
    const rows = (bars || []).map(normalizeSfpBar).filter((bar) =>
      bar &&
      Number.isFinite(bar.t) &&
      Number.isFinite(bar.high) &&
      Number.isFinite(bar.low) &&
      Number.isFinite(bar.close)
    );
    const warnings = [];
    if (!rows.length) {
      warnings.push("当前窗口没有可分析的足迹 Bar");
      const emptyVolumeProfile = buildVolumeProfile([]);
      const emptyImbalance = analyzeImbalance([]);
      const emptyKeyLevels = buildReadModelKeyLevels([], null, null, opts);
      const emptySfp = sfpNone("当前窗口没有可分析的足迹 Bar");
      const emptyFreshness = normalizeOrderflowDataFreshness(opts.dataFreshness, null, opts.interval);
      const emptyDeltaBias = readModelDeltaBias(null);
      const emptySfpDisplay = buildSfpPresentation(emptySfp, emptyFreshness);
      const emptySummary = {
        primary: "等待当前可视足迹数据",
        volume: "成交分布暂不可用",
        imbalance: "买卖失衡暂不可用",
        levels: "压力/支撑暂不可用",
        sfp: "SFP 暂不可用",
      };
      return {
        barCount: 0,
        latestBar: null,
        effectiveTickSize: opts.effectiveTickSize || null,
        volumeProfile: emptyVolumeProfile,
        imbalance: emptyImbalance,
        keyLevels: emptyKeyLevels,
        sfp: emptySfp,
        summary: emptySummary,
        dashboard: buildOrderflowDashboard({
          latestBar: null,
          volumeProfile: emptyVolumeProfile,
          imbalance: emptyImbalance,
          keyLevels: emptyKeyLevels,
          sfp: emptySfp,
          sfpDisplay: emptySfpDisplay,
          dataFreshness: emptyFreshness,
          deltaBias: emptyDeltaBias,
          summary: emptySummary,
        }),
        warnings,
        dataFreshness: emptyFreshness,
        deltaBias: emptyDeltaBias,
        sfpDisplay: emptySfpDisplay,
      };
    }

    const latestBar = rows[rows.length - 1];
    const latest = Number(latestBar.close);
    const effectiveTickSize = Number(opts.effectiveTickSize) || detectBaseTick(rows) || autoTickSize(latest);
    const dataFreshness = normalizeOrderflowDataFreshness(opts.dataFreshness, latestBar, opts.interval);
    const deltaBias = readModelDeltaBias(latestBar);
    const volumeProfile = buildVolumeProfile(rows);
    const imbalance = analyzeImbalance(rows);
    const keyLevels = buildReadModelKeyLevels(rows, volumeProfile, imbalance, opts);
    const sfp = analyzeSfp(rows, {
      ...opts,
      effectiveTickSize,
    });
    const sfpDisplay = buildSfpPresentation(sfp, dataFreshness);

    const totalImbalance = Number(imbalance.buyCount || 0) + Number(imbalance.sellCount || 0);
    const imbalanceSide = Math.abs(Number(imbalance.netCount) || 0) <= 2
      ? "均衡"
      : (Number(imbalance.netCount) > 0 ? "买方阈值价位较多" : "卖方阈值价位较多");
    const volumeText = volumeProfile && volumeProfile.levels && volumeProfile.levels.length
      ? `窗口 POC ${readModelPriceText(volumeProfile.pocPrice)}，价值区 ${readModelPriceText(volumeProfile.val)}-${readModelPriceText(volumeProfile.vah)}`
      : "成交分布样本不足";
    const imbalanceText = totalImbalance
      ? `阈值失衡价位 ${imbalanceSide}，买 ${imbalance.buyCount} / 卖 ${imbalance.sellCount}，价位净 ${Number(imbalance.netCount) >= 0 ? "+" : ""}${imbalance.netCount}`
      : "当前窗口无阈值失衡";
    const nearestResistance = keyLevels.resistance[0] || null;
    const nearestSupport = keyLevels.support[0] || null;
    const levelsText = `${keyLevels.state}；上方 ${nearestResistance ? readModelPriceText(nearestResistance.price) : "--"}，下方 ${nearestSupport ? readModelPriceText(nearestSupport.price) : "--"}`;
    const sfpText = sfp && sfp.status !== "none"
      ? `${sfp.direction === "bullish" ? "多头" : "空头"} SFP ${sfpDisplay.statusText} @ ${readModelPriceText(sfp.level)}，结构分 ${sfp.score}/100${sfpDisplay.reason ? "，" + sfpDisplay.reason : ""}`
      : "未识别有效 SFP";
    const primaryPrefix = dataFreshness.isDegraded
      ? `${dataFreshness.label}，规则读数需谨慎`
      : keyLevels.state;
    const summary = {
      primary: `${primaryPrefix}，${volumeText}`,
      volume: volumeText,
      imbalance: imbalanceText,
      levels: levelsText,
      sfp: sfpText,
      latest: `当前 ${readModelPriceText(latest)}，Delta ${Number(latestBar.delta || 0).toFixed(1)}，${deltaBias.label}`,
    };
    const dashboard = buildOrderflowDashboard({
      latestBar,
      volumeProfile,
      imbalance,
      keyLevels,
      sfp,
      sfpDisplay,
      dataFreshness,
      deltaBias,
      interval: opts.interval,
      summary,
    });

    if (rows.length < 20) warnings.push("SFP 至少需要 20 根足迹 Bar，当前窗口可能只适合读路径和成交区");
    if (!volumeProfile || !volumeProfile.levels || !volumeProfile.levels.length) warnings.push("成交分布样本不足");
    if (dataFreshness.isDegraded) warnings.push(`${dataFreshness.label}，无 LLM 规则读数已降级`);

    return {
      barCount: rows.length,
      latestBar,
      effectiveTickSize,
      dataFreshness,
      deltaBias,
      volumeProfile,
      imbalance,
      keyLevels,
      sfp,
      sfpDisplay,
      summary,
      dashboard,
      warnings,
    };
  }

  function recomputeBar(bar, opts) {
    const ratio = Number(opts && opts.imbalanceRatio) || IMBALANCE_RATIO;
    const minSmall = Number(opts && opts.imbalanceMinSmall) || IMBALANCE_MIN_SMALL;
    const open = barField(bar, "open", "o");
    const high = barField(bar, "high", "h");
    const low = barField(bar, "low", "l");
    const close = barField(bar, "close", "c");
    let buyVol = 0;
    let sellVol = 0;
    let pocPrice = null;
    let maxTotal = -1;
    const levels = (bar.levels || [])
      .map((level) => normalizeLevel(level, ratio, minSmall))
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
      t: Number(bar.t),
      open,
      high,
      low,
      close,
      o: open,
      h: high,
      l: low,
      c: close,
      buyVol,
      sellVol,
      delta: buyVol - sellVol,
      volume: buyVol + sellVol,
      pocPrice,
      levels,
    };
  }

  function emptyBar(t, price) {
    const p = Number(price);
    return {
      t: Number(t),
      open: p,
      high: p,
      low: p,
      close: p,
      buyVol: 0,
      sellVol: 0,
      delta: 0,
      volume: 0,
      pocPrice: null,
      levels: [],
    };
  }

  function cloneBars(bars) {
    return JSON.parse(JSON.stringify(Array.isArray(bars) ? bars : []));
  }

  function storageKey(symbol, interval, tickSize) {
    return [STORAGE_PREFIX, symbol || DEFAULT_SYMBOL, interval || DEFAULT_INTERVAL, tickSize || "auto"].join(".");
  }

  class FootprintAggregator {
    constructor(opts) {
      opts = opts || {};
      this.symbol = opts.symbol || DEFAULT_SYMBOL;
      this.interval = SUPPORTED_INTERVALS.includes(opts.interval) ? opts.interval : DEFAULT_INTERVAL;
      this.tickSize = opts.tickSize || "auto";
      this.maxBars = Math.min(MAX_CACHE_BARS, Math.max(1, Number(opts.maxBars) || MAX_CACHE_BARS));
      this.imbalanceRatio = Number(opts.imbalanceRatio) || IMBALANCE_RATIO;
      this.imbalanceMinSmall = Number(opts.imbalanceMinSmall) || IMBALANCE_MIN_SMALL;
      this.bars = [];
    }

    setOptions(opts) {
      opts = opts || {};
      if (opts.symbol) this.symbol = opts.symbol;
      if (SUPPORTED_INTERVALS.includes(opts.interval)) this.interval = opts.interval;
      if (opts.tickSize != null) this.tickSize = opts.tickSize;
      if (opts.maxBars != null) this.maxBars = Math.min(MAX_CACHE_BARS, Math.max(1, Number(opts.maxBars) || this.maxBars));
      if (opts.imbalanceRatio != null) this.imbalanceRatio = Number(opts.imbalanceRatio) || this.imbalanceRatio;
      if (opts.imbalanceMinSmall != null) this.imbalanceMinSmall = Number(opts.imbalanceMinSmall) || this.imbalanceMinSmall;
      this.bars = this.bars.map((bar) => recomputeBar(bar, this)).slice(-this.maxBars);
    }

    loadBars(bars) {
      this.bars = (Array.isArray(bars) ? bars : [])
        .map((bar) => recomputeBar(bar, this))
        .filter((bar) => Number.isFinite(bar.t))
        .sort((a, b) => a.t - b.t)
        .slice(-this.maxBars);
      return this.getBars();
    }

    reset() {
      this.bars = [];
    }

    ingestAggTrade(raw) {
      if (!raw) return null;
      const time = Number(raw.T != null ? raw.T : raw.E);
      const price = Number(raw.p);
      const qty = Number(raw.q);
      if (!Number.isFinite(time) || !Number.isFinite(price) || !Number.isFinite(qty) || qty <= 0) {
        return null;
      }

      const start = bucketStart(time, this.interval);
      let bar = this.bars.length ? this.bars[this.bars.length - 1] : null;
      if (!bar || bar.t !== start) {
        bar = emptyBar(start, price);
        this.bars.push(bar);
        if (this.bars.length > this.maxBars) this.bars = this.bars.slice(-this.maxBars);
      }

      bar.high = Math.max(bar.high, price);
      bar.low = Math.min(bar.low, price);
      bar.close = price;

      const tick = resolveTickSize(this.tickSize, price);
      const levelPrice = roundPriceToTick(price, tick);
      let level = bar.levels.find((row) => row.price === levelPrice);
      if (!level) {
        level = { price: levelPrice, buyVol: 0, sellVol: 0, delta: 0, total: 0, imbalance: null };
        bar.levels.push(level);
      }

      if (raw.m === false || raw.m === "false") level.buyVol += qty;
      else level.sellVol += qty;

      const computed = recomputeBar(bar, this);
      this.bars[this.bars.length - 1] = computed;
      return computed;
    }

    getBars() {
      return cloneBars(this.bars);
    }

    latest() {
      return this.bars.length ? cloneBars([this.bars[this.bars.length - 1]])[0] : null;
    }
  }

  class FootprintStream {
    constructor(opts) {
      opts = opts || {};
      this.symbol = opts.symbol || DEFAULT_SYMBOL;
      this.interval = opts.interval || DEFAULT_INTERVAL;
      this.tickSize = opts.tickSize || "auto";
      this.maxBars = opts.maxBars || DEFAULT_LOAD_BARS;
      this.onBars = typeof opts.onBars === "function" ? opts.onBars : function () {};
      this.onStatus = typeof opts.onStatus === "function" ? opts.onStatus : function () {};
      this.aggregator = new FootprintAggregator(opts);
      this.ws = null;
      this.reconnectTimer = null;
      this.pollTimer = null;
      this.wsWatchdogTimer = null;
      this.lastMeta = null;
      this.closedByUser = false;
      this.flushTimer = null;
      this.seenTradeIds = new Set();
      this.seenTradeQueue = [];
      this.polling = false;
    }

    cacheKey() {
      return storageKey(this.symbol, this.interval, this.tickSize);
    }

    loadCache() {
      try {
        const raw = global.localStorage && global.localStorage.getItem(this.cacheKey());
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return this.aggregator.loadBars(parsed && parsed.bars);
      } catch (_) {
        return [];
      }
    }

    saveCacheSoon() {
      if (this.flushTimer) clearTimeout(this.flushTimer);
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.saveCacheNow();
      }, 300);
    }

    saveCacheNow() {
      try {
        if (!global.localStorage) return;
        global.localStorage.setItem(
          this.cacheKey(),
          JSON.stringify({
            symbol: this.symbol,
            interval: this.interval,
            tickSize: this.tickSize,
            savedAt: Date.now(),
            bars: this.aggregator.getBars().slice(-MAX_CACHE_BARS),
          })
        );
      } catch (_) {}
    }

    clearCache() {
      this.aggregator.reset();
      try {
        if (global.localStorage) global.localStorage.removeItem(this.cacheKey());
      } catch (_) {}
      this.onBars(this.aggregator.getBars());
    }

    setOptions(opts) {
      opts = opts || {};
      const nextSymbol = opts.symbol || this.symbol;
      const nextInterval = opts.interval || this.interval;
      const nextTickSize = opts.tickSize != null ? opts.tickSize : this.tickSize;
      const nextMaxBars = opts.maxBars || this.maxBars;
      const streamChanged = nextSymbol !== this.symbol;
      const aggregateChanged = nextInterval !== this.interval || nextTickSize !== this.tickSize;
      const historyChanged = Number(nextMaxBars) !== Number(this.maxBars);

      this.saveCacheNow();
      this.symbol = nextSymbol;
      this.interval = nextInterval;
      this.tickSize = nextTickSize;
      this.maxBars = nextMaxBars;
      this.aggregator = new FootprintAggregator({
        symbol: this.symbol,
        interval: this.interval,
        tickSize: this.tickSize,
        maxBars: this.maxBars,
      });
      this.resetSeenTrades();
      const cached = this.loadCache();
      this.onBars(cached);
      if (streamChanged || aggregateChanged || historyChanged) this.pollOnce();
      this.onStatus(this.statusText());
    }

    statusText() {
      if (this.pollTimer) return "Cloud D1 polling";
      if (!this.ws) return "WS not connected";
      switch (this.ws.readyState) {
        case WebSocket.CONNECTING:
          return "WS connecting";
        case WebSocket.OPEN:
          return "Realtime";
        case WebSocket.CLOSING:
          return "WS closing";
        case WebSocket.CLOSED:
          return "WS closed";
        default:
          return "WS unknown";
      }
    }

    start() {
      this.closedByUser = false;
      this.loadCache();
      this.onBars(this.aggregator.getBars());
      this.pollOnce();
      this.pollTimer = setInterval(() => this.pollOnce(), POLL_MS);
      this.onStatus("Cloud D1 polling");
    }

    restart() {
      this.stop(false);
      this.start();
    }

    resetSeenTrades() {
      this.seenTradeIds = new Set();
      this.seenTradeQueue = [];
    }

    rememberTrade(raw) {
      if (!raw) return false;
      const id = raw.a != null
        ? String(raw.a)
        : [raw.T, raw.p, raw.q, raw.m].map((v) => String(v)).join("|");
      if (this.seenTradeIds.has(id)) return false;
      this.seenTradeIds.add(id);
      this.seenTradeQueue.push(id);
      while (this.seenTradeQueue.length > 5000) {
        const old = this.seenTradeQueue.shift();
        this.seenTradeIds.delete(old);
      }
      return true;
    }

    ingestAndPublish(raw) {
      if (!this.rememberTrade(raw)) return;
      this.aggregator.ingestAggTrade(raw);
      this.onBars(this.aggregator.getBars());
      this.saveCacheSoon();
    }

    apiBases() {
      const out = [];
      const host =
        typeof location !== "undefined" && location.hostname ? String(location.hostname) : "";
      if (
        typeof location !== "undefined" &&
        (location.protocol === "http:" || location.protocol === "https:") &&
        typeof isLocalDevPageHostname === "function" &&
        isLocalDevPageHostname(host)
      ) {
        out.push(location.origin);
      }
      if (typeof global.getBitDataApiBase === "function") {
        try {
          out.push(global.getBitDataApiBase());
        } catch (_) {}
      }
      if (typeof BIT_KLINE_DEFAULT_CLOUD !== "undefined") {
        out.push(BIT_KLINE_DEFAULT_CLOUD);
      }
      return [...new Set(out.filter(Boolean).map((x) => String(x).replace(/\/$/, "")))];
    }

    armWsWatchdog() {
      if (this.wsWatchdogTimer) clearTimeout(this.wsWatchdogTimer);
      this.wsWatchdogTimer = setTimeout(() => {
        this.wsWatchdogTimer = null;
        if (this.closedByUser) return;
        if (!this.aggregator.getBars().length) this.startPollFallback("WS no data");
      }, 4000);
    }

    startPollFallback(reason) {
      if (this.pollTimer || this.closedByUser) return;
      this.onStatus(reason ? `Cloud D1 polling (${reason})` : "Cloud D1 polling");
      this.pollOnce();
      this.pollTimer = setInterval(() => this.pollOnce(), POLL_MS);
    }

    async pollOnce() {
      if (this.polling || this.closedByUser) return;
      this.polling = true;
      let lastErr = "";
      try {
        const q = new URLSearchParams({
          symbol: this.symbol,
          interval: this.interval,
          tickSize: String(this.tickSize || "auto"),
          limit: String(Math.min(MAX_CACHE_BARS, Math.max(1, Number(this.maxBars) || 80))),
          sync: "auto",
        });
        let bars = null;
        let meta = null;
        let source = "";
        for (const base of this.apiBases()) {
          try {
            const res = await fetch(`${base}/api/d1/footprint?${q.toString()}`, {
              cache: "no-store",
            });
            if (!res.ok) throw new Error(`${base} HTTP ${res.status}`);
            const parsed = await res.json();
            if (!parsed || !Array.isArray(parsed.bars)) throw new Error(`${base} bad shape`);
            bars = parsed.bars;
            meta = {
              symbol: parsed.symbol,
              interval: parsed.interval,
              tickSize: parsed.tickSize,
              effectiveTickSize: parsed.effectiveTickSize,
              now: Number.isFinite(Number(parsed.now)) ? Number(parsed.now) : undefined,
              count: parsed.count,
              latestT: parsed.latestT,
              baseInterval: parsed.baseInterval,
              maxBaseBars: parsed.maxBaseBars,
              availableBaseBars: parsed.availableBaseBars,
              availableBaseMinT: parsed.availableBaseMinT,
              availableBaseMaxT: parsed.availableBaseMaxT,
              lastSync: parsed.lastSync || null,
              syncResult: parsed.syncResult || null,
            };
            source = res.headers.get("X-Data-Source") || base;
            break;
          } catch (e) {
            lastErr = e && e.message ? e.message : String(e);
          }
        }
        if (!Array.isArray(bars)) throw new Error(lastErr || "all footprint candidates failed");
        this.aggregator.loadBars(bars);
        this.lastMeta = meta;
        this.onBars(this.aggregator.getBars(), this.lastMeta);
        this.saveCacheSoon();
        this.onStatus(source ? `Cloud D1 (${source})` : "Cloud D1 polling");
      } catch (e) {
        this.onStatus(`Cloud D1 failed: ${e && e.message ? e.message : e}`);
      } finally {
        this.polling = false;
      }
    }

    connect() {
      if (typeof WebSocket === "undefined") {
        this.onStatus("WebSocket unavailable");
        this.startPollFallback("WS unavailable");
        return;
      }
      const stream = `${this.symbol.toLowerCase()}@aggTrade`;
      const url = `wss://fstream.binance.com/ws/${stream}`;
      try {
        this.ws = new WebSocket(url);
      } catch (e) {
        this.onStatus("WS create failed");
        this.startPollFallback("WS create failed");
        return;
      }
      const ws = this.ws;
      this.onStatus(this.statusText());

      ws.onopen = () => {
        if (ws !== this.ws) return;
        this.onStatus(this.statusText());
      };
      ws.onmessage = (ev) => {
        if (ws !== this.ws) return;
        let msg = null;
        try {
          msg = JSON.parse(ev.data);
        } catch (_) {
          return;
        }
        if (this.pollTimer) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
        }
        this.ingestAndPublish(msg);
      };
      ws.onerror = () => {
        if (ws === this.ws) this.onStatus("WS error");
      };
      ws.onclose = () => {
        if (ws !== this.ws) return;
        this.onStatus(this.statusText());
        if (this.closedByUser) return;
        this.startPollFallback("WS closed");
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connect();
        }, WS_RECONNECT_MS);
      };
    }

    stop(markClosed) {
      this.saveCacheNow();
      this.closedByUser = markClosed !== false;
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      if (this.wsWatchdogTimer) {
        clearTimeout(this.wsWatchdogTimer);
        this.wsWatchdogTimer = null;
      }
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
      if (this.ws) {
        try {
          this.ws.onopen = this.ws.onmessage = this.ws.onerror = this.ws.onclose = null;
          this.ws.close();
        } catch (_) {}
        this.ws = null;
      }
      this.onStatus("WS not connected");
    }
  }

  global.FootprintEngine = {
    DEFAULT_SYMBOL,
    SUPPORTED_INTERVALS,
    DEFAULT_INTERVAL,
    MAX_CACHE_BARS,
    DEFAULT_LOAD_BARS,
    IMBALANCE_RATIO,
    IMBALANCE_MIN_SMALL,
    VALUE_AREA_RATIO,
    storageKey,
    getIntervalMs,
    resolveTickSize,
    roundPriceToTick,
    detectBaseTick,
    chooseDisplayTick,
    bucketStart,
    levelImbalance,
    rebinDisplayBars,
    analyzeImbalance,
    buildVolumeProfile,
    buildSfpKeyLevels,
    analyzeSfp,
    normalizeOrderflowDataFreshness,
    readModelDeltaBias,
    buildOrderflowReadModel,
    recomputeBar,
    FootprintAggregator,
    FootprintStream,
  };
})(typeof window !== "undefined" ? window : globalThis);
