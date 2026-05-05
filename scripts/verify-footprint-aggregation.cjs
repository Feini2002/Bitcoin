/**
 * Verify Footprint aggregation math without a browser.
 */
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const file = path.join(__dirname, "..", "js", "orderflow", "footprint-engine.js");
eval(fs.readFileSync(file, "utf8"));

const {
  FootprintAggregator,
  bucketStart,
  roundPriceToTick,
  levelImbalance,
  rebinDisplayBars,
  analyzeImbalance,
  buildVolumeProfile,
  buildSfpKeyLevels,
  analyzeSfp,
  buildOrderflowReadModel,
} = globalThis.FootprintEngine;

let failed = 0;
function assert(name, cond, detail) {
  if (!cond) {
    failed++;
    console.error("FAIL:", name, detail || "");
  } else {
    console.log("OK:", name);
  }
}

function approx(a, b, eps = 1e-12) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

const t0 = Date.UTC(2026, 3, 28, 8, 0, 12);
const agg = new FootprintAggregator({
  interval: "5m",
  tickSize: "5",
  maxBars: 120,
});

agg.ingestAggTrade({ T: t0, p: "10002", q: "0.5", m: false });
agg.ingestAggTrade({ T: t0 + 1000, p: "10001", q: "0.3", m: true });
agg.ingestAggTrade({ T: t0 + 2000, p: "10011", q: "0.9", m: false });
agg.ingestAggTrade({ T: t0 + 3000, p: "10009", q: "0.1", m: true });
agg.ingestAggTrade({ T: t0 + 5 * 60 * 1000, p: "10020", q: "0.2", m: true });

const bars = agg.getBars();
const first = bars[0];
const second = bars[1];

assert("creates one bar per 5m bucket", bars.length === 2, JSON.stringify(bars));
assert("bucket start is aligned", first.t === bucketStart(t0, "5m"), `got ${first.t}`);
assert("next trade creates next bucket", second.t === bucketStart(t0 + 5 * 60 * 1000, "5m"));
assert("round price to explicit tick", roundPriceToTick(10011, 5) === 10010);
assert("m=false maps to aggressive buy", approx(first.buyVol, 1.4), `got ${first.buyVol}`);
assert("m=true maps to aggressive sell", approx(first.sellVol, 0.4), `got ${first.sellVol}`);
assert("delta equals buy minus sell", approx(first.delta, 1.0), `got ${first.delta}`);
assert("volume equals buy plus sell", approx(first.volume, 1.8), `got ${first.volume}`);
assert("POC picks highest total price level", first.pocPrice === 10010, `got ${first.pocPrice}`);

const level10010 = first.levels.find((row) => row.price === 10010);
assert("imbalance marks buy side at 3x threshold", level10010 && level10010.imbalance === "buy", JSON.stringify(level10010));
assert("small side minimum suppresses zero/small imbalance", levelImbalance(1, 0.001, 3, 0.01) === null);
assert("second bar keeps sell-only direction", approx(second.sellVol, 0.2) && approx(second.buyVol, 0));

const rebinnedStudy = rebinDisplayBars([
  {
    t: t0,
    open: 10000,
    high: 10015,
    low: 9995,
    close: 10010,
    levels: [
      { price: 10001, buyVol: 0.9, sellVol: 0.2 },
      { price: 10004, buyVol: 0.6, sellVol: 0.1 },
      { price: 10011, buyVol: 0.2, sellVol: 1.0 },
    ],
  },
], "10").bars[0];
const rebinned10000 = rebinnedStudy.levels.find((row) => row.price === 10000);
assert("display rebin merges levels into chosen tick", rebinned10000 && approx(rebinned10000.buyVol, 1.5) && approx(rebinned10000.sellVol, 0.3), JSON.stringify(rebinnedStudy));
assert("display rebin recomputes imbalance after merge", rebinned10000 && rebinned10000.imbalance === "buy", JSON.stringify(rebinned10000));

const studyBars = [
  {
    t: t0,
    delta: 1,
    levels: [
      { price: 10000, buyVol: 3, sellVol: 1 },
      { price: 10010, buyVol: 2, sellVol: 4 },
    ],
  },
  {
    t: t0 + 5 * 60 * 1000,
    delta: 2,
    levels: [
      { price: 10000, buyVol: 6, sellVol: 1 },
      { price: 10020, buyVol: 2, sellVol: 1 },
    ],
  },
  {
    t: t0 + 10 * 60 * 1000,
    delta: -1,
    levels: [
      { price: 10030, buyVol: 1, sellVol: 4 },
      { price: 10020, buyVol: 1, sellVol: 5 },
    ],
  },
];
const imb = analyzeImbalance(studyBars);
assert("imbalance analyzer counts buy side", imb.buyCount === 2, JSON.stringify(imb));
assert("imbalance analyzer counts sell side", imb.sellCount === 2, JSON.stringify(imb));
assert("imbalance analyzer reports latest event", imb.latest && imb.latest.side === "sell" && imb.latest.price === 10020, JSON.stringify(imb.latest));
assert("imbalance analyzer detects longest run", imb.longestRun.side === "buy" && imb.longestRun.count === 2, JSON.stringify(imb.longestRun));
assert("imbalance analyzer handles empty input", analyzeImbalance([]).buyCount === 0 && analyzeImbalance([]).topPrices.length === 0);

const vp = buildVolumeProfile([
  {
    levels: [
      { price: 10000, buyVol: 4, sellVol: 6 },
      { price: 10010, buyVol: 8, sellVol: 2 },
      { price: 10020, buyVol: 2, sellVol: 4 },
      { price: 10030, buyVol: 1, sellVol: 3 },
    ],
  },
  {
    levels: [
      { price: 10010, buyVol: 5, sellVol: 5 },
      { price: 10040, buyVol: 1, sellVol: 1 },
    ],
  },
]);
assert("volume profile picks POC by highest total", vp.pocPrice === 10010, JSON.stringify(vp));
assert("volume profile computes value area bounds", vp.val === 10000 && vp.vah === 10010, JSON.stringify(vp));
assert("volume profile reaches 70% coverage", vp.coverage >= 0.7 && vp.coverage < 0.9, `got ${vp.coverage}`);
assert("volume profile keeps buy/sell totals", approx(vp.buyVol, 21) && approx(vp.sellVol, 21), JSON.stringify(vp));
assert("volume profile handles empty input", buildVolumeProfile([]).levels.length === 0 && buildVolumeProfile([]).pocPrice === null);

function sfpBar(idx, o, h, l, c, buy, sell, levelPrice = 10000) {
  return {
    t: t0 + idx * 5 * 60 * 1000,
    open: o,
    high: h,
    low: l,
    close: c,
    buyVol: buy,
    sellVol: sell,
    delta: buy - sell,
    volume: buy + sell,
    levels: [
      { price: levelPrice, buyVol: buy, sellVol: sell, imbalance: buy >= sell * 3 ? "buy" : (sell >= buy * 3 ? "sell" : null) },
    ],
  };
}

const calmSfpBars = Array.from({ length: 20 }, (_, idx) =>
  sfpBar(idx, 10010, 10025, 9995, 10010, 4, 4)
);
const bullishSfpBars = calmSfpBars.concat([
  sfpBar(20, 10008, 10018, 9950, 10012, 9, 2),
  sfpBar(21, 10012, 10028, 10008, 10020, 8, 3),
]);
const bullishSfp = analyzeSfp(bullishSfpBars, {
  effectiveTickSize: 5,
  minBars: 10,
  keyLevels: [{ price: 10000, side: "support", label: "测试支撑", score: 5, sources: ["test-support"] }],
});
assert("SFP analyzer confirms bullish sweep and reclaim", bullishSfp.status === "confirmed" && bullishSfp.direction === "bullish", JSON.stringify(bullishSfp));
assert("SFP analyzer scores confirmed bullish signal", bullishSfp.score >= 75, JSON.stringify(bullishSfp));

const bearishSfpBars = calmSfpBars.concat([
  sfpBar(20, 9992, 10050, 9985, 9990, 2, 9),
  sfpBar(21, 9990, 9998, 9970, 9980, 3, 8),
]);
const bearishSfp = analyzeSfp(bearishSfpBars, {
  effectiveTickSize: 5,
  minBars: 10,
  keyLevels: [{ price: 10000, side: "resistance", label: "测试压力", score: 5, sources: ["test-resistance"] }],
});
assert("SFP analyzer confirms bearish sweep and reclaim", bearishSfp.status === "confirmed" && bearishSfp.direction === "bearish", JSON.stringify(bearishSfp));

const failedSfpBars = calmSfpBars.concat([
  sfpBar(20, 10008, 10012, 9950, 9980, 3, 9),
  sfpBar(21, 9980, 9990, 9965, 9975, 3, 8),
  sfpBar(22, 9975, 9988, 9960, 9970, 2, 7),
]);
const failedSfp = analyzeSfp(failedSfpBars, {
  effectiveTickSize: 5,
  minBars: 10,
  keyLevels: [{ price: 10000, side: "support", label: "测试支撑", score: 5, sources: ["test-support"] }],
});
assert("SFP analyzer does not confirm unreclaimed sweep", failedSfp.status !== "confirmed", JSON.stringify(failedSfp));

const mixedLevels = buildSfpKeyLevels(bullishSfpBars, {
  effectiveTickSize: 5,
  technicalLevels: {
    support: [{ price: 10000, label: "前日低点", source: "prev-day-low", score: 2.2 }],
    resistance: [{ price: 10050, label: "前日高点", source: "prev-day-high", score: 2.2 }],
  },
});
assert("SFP key levels include mixed technical sources", mixedLevels.some((row) => row.sources.includes("prev-day-low")), JSON.stringify(mixedLevels));

const readModel = buildOrderflowReadModel(bullishSfpBars, {
  effectiveTickSize: 5,
  technicalLevels: {
    support: [{ price: 10000, label: "前日低点", source: "prev-day-low", score: 2.2 }],
    resistance: [{ price: 10050, label: "前日高点", source: "prev-day-high", score: 2.2 }],
  },
});
assert("read model exposes volume profile", readModel.volumeProfile && readModel.volumeProfile.pocPrice === 10000, JSON.stringify(readModel.volumeProfile));
assert("read model exposes imbalance counts", readModel.imbalance && readModel.imbalance.buyCount > readModel.imbalance.sellCount, JSON.stringify(readModel.imbalance));
assert("read model exposes key level state", readModel.keyLevels && readModel.keyLevels.support.length > 0 && readModel.keyLevels.resistance.length > 0, JSON.stringify(readModel.keyLevels));
assert("read model reuses SFP confirmation", readModel.sfp && readModel.sfp.status === "confirmed" && readModel.sfp.direction === "bullish", JSON.stringify(readModel.sfp));
assert("read model carries human summary", readModel.summary && /窗口 POC/.test(readModel.summary.volume) && /结构分/.test(readModel.summary.sfp), JSON.stringify(readModel.summary));
assert("read model exposes dashboard", readModel.dashboard && readModel.dashboard.activeKey === "sfp" && readModel.dashboard.cards && readModel.dashboard.cards.levels, JSON.stringify(readModel.dashboard));
assert("read model exposes non-degraded SFP display", readModel.sfpDisplay && readModel.sfpDisplay.status === "confirmed" && readModel.sfpDisplay.scoreLabel === "结构分", JSON.stringify(readModel.sfpDisplay));

const neutralDeltaModel = buildOrderflowReadModel([
  {
    t: t0,
    open: 10000,
    high: 10005,
    low: 9995,
    close: 10000,
    buyVol: 5,
    sellVol: 5,
    delta: 0,
    volume: 10,
    levels: [
      { price: 10000, buyVol: 5, sellVol: 5 },
    ],
  },
], {
  effectiveTickSize: 5,
  interval: "5m",
  dataFreshness: {
    latestT: t0,
    lastSync: { last_trade_time: t0 + 1000, last_ok: 1 },
    now: t0 + 2000,
  },
});
assert("read model treats zero delta as neutral", neutralDeltaModel.deltaBias && neutralDeltaModel.deltaBias.side === "neutral", JSON.stringify(neutralDeltaModel.deltaBias));
assert("read model reports fresh D1 polling", neutralDeltaModel.dataFreshness && neutralDeltaModel.dataFreshness.status === "fresh", JSON.stringify(neutralDeltaModel.dataFreshness));

const staleSfpModel = buildOrderflowReadModel(bullishSfpBars, {
  effectiveTickSize: 5,
  interval: "5m",
  dataFreshness: {
    latestT: bullishSfpBars[bullishSfpBars.length - 1].t,
    lastSync: { last_trade_time: bullishSfpBars[bullishSfpBars.length - 1].t, last_ok: 1 },
    now: bullishSfpBars[bullishSfpBars.length - 1].t + 60 * 60 * 1000,
  },
  technicalLevels: {
    support: [{ price: 10000, label: "前日低点", source: "prev-day-low", score: 2.2 }],
    resistance: [{ price: 10050, label: "前日高点", source: "prev-day-high", score: 2.2 }],
  },
});
assert("stale data degrades read model freshness", staleSfpModel.dataFreshness && staleSfpModel.dataFreshness.status === "stale", JSON.stringify(staleSfpModel.dataFreshness));
assert("stale data downgrades confirmed SFP display", staleSfpModel.sfp.status === "confirmed" && staleSfpModel.sfpDisplay.status === "forming", JSON.stringify(staleSfpModel.sfpDisplay));
assert("stale data adds cautious warning", staleSfpModel.warnings.some((row) => /规则读数已降级/.test(row)), JSON.stringify(staleSfpModel.warnings));

console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exitCode = failed ? 1 : 0;
