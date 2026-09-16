/**
 * 对照教科书公式校验 indicator-math.js（Node 下加载同名逻辑）
 */
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "js", "chart", "indicator-math.js");
global.window = undefined;
eval(fs.readFileSync(file, "utf8"));
const {
  computeAll,
  computeKeyLevels,
  computeChartStructureLevels,
  buildChartHigherContext,
  resolveChartHigherInterval,
  resolveRangeIntervalConfig,
} = globalThis.IndicatorMath;

function approx(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

let failed = 0;
function assert(name, cond, detail) {
  if (!cond) {
    failed++;
    console.error("FAIL:", name, detail || "");
  } else {
    console.log("OK:", name);
  }
}

// --- 手工 EMA(3)：首值 SMA，其后 EMA ---
const closes3 = [1, 2, 3, 4, 5];
const k3 = 2 / 4;
let emaManual = (1 + 2 + 3) / 3;
emaManual = 4 * k3 + emaManual * (1 - k3);
emaManual = 5 * k3 + emaManual * (1 - k3);

// 用 computeAll 只关心 ema：构造足够长的 klines
const k3lines = closes3.map((c, i) => ({ t: i * 60000, o: c, h: c, l: c, c, v: 1 }));
const r3 = computeAll(k3lines, { emaPeriod: 3 });
const emaLast = r3.ema[r3.ema.length - 1].value;
assert("EMA(3) 末值与手算一致", approx(emaLast, emaManual), `got ${emaLast} want ${emaManual}`);

// --- 布林带：middle = SMA，upper = middle + 2*stdev(population) ---
const closesBb = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const bbK = closesBb.map((c, i) => ({ t: i * 60000, o: c, h: c, l: c, c, v: 1 }));
const bbR = computeAll(bbK, { bbPeriod: 20, bbMult: 2 });
const lastMid =
  closesBb.slice(1, 21).reduce((s, x) => s + x, 0) / 20; // index 1..20 的 SMA 在 i=20 处？closesBb[20]=21
const slice = closesBb.slice(1, 21);
const mean = slice.reduce((s, x) => s + x, 0) / 20;
const st = Math.sqrt(slice.reduce((s, x) => s + (x - mean) ** 2, 0) / 20);
const wantUpper = mean + 2 * st;
const ptUpper = bbR.bbUpper[bbR.bbUpper.length - 1];
assert(
  "布林上轨末值与手算一致",
  ptUpper && approx(ptUpper.value, wantUpper),
  `got ${ptUpper && ptUpper.value} want ${wantUpper}`
);

// --- RSI：全涨序列首有效 RSI 应为 100（Wilder 平滑下无损失）---
const up = Array.from({ length: 30 }, (_, i) => ({ t: i * 60000, o: 100 + i, h: 100 + i, l: 100 + i, c: 100 + i, v: 1 }));
const rsiR = computeAll(up, { rsiPeriod: 14 });
const firstRsi = rsiR.rsi[0].value;
assert("RSI 全涨首点应为 100", approx(firstRsi, 100, 1e-6), `got ${firstRsi}`);

// --- ATR：Wilder 首值 = 前 N 根 TR 简单平均（须含 bar0）；用首根宽 TR 与后续窄 TR 区分错误实现 ---
function trAt(k, i) {
  if (i === 0) return k[0].h - k[0].l;
  const hi = k[i].h,
    lo = k[i].l,
    cp = k[i - 1].c;
  return Math.max(hi - lo, Math.abs(hi - cp), Math.abs(lo - cp));
}
const atrK = [{ t: 0, o: 100, h: 110, l: 90, c: 100, v: 1000 }];
for (let i = 1; i < 20; i++) {
  atrK.push({ t: i * 60000, o: 100, h: 101, l: 99, c: 100, v: 1000 });
}
let sumTr = 0;
for (let i = 0; i < 14; i++) sumTr += trAt(atrK, i);
const wantFirstAtr = sumTr / 14;
let wrongInit = 0;
for (let i = 1; i <= 14; i++) wrongInit += trAt(atrK, i);
wrongInit /= 14;
assert("ATR 错误实现应对照数据可区分", !approx(wantFirstAtr, wrongInit, 1e-9), `both ${wantFirstAtr}`);
const atrR = computeAll(atrK, { atrPeriod: 14 });
const implFirst = atrR.atr[0].value;
assert(
  "ATR 首值含 bar0 的 TR 平均",
  approx(implFirst, wantFirstAtr, 1e-6),
  `got ${implFirst} want ${wantFirstAtr}`
);

// --- MACD：line = EMA12 - EMA26，抽样末值 ---
const macdCloses = Array.from({ length: 50 }, (_, i) => 50 + Math.sin(i / 5) * 10);
const macdK = macdCloses.map((c, i) => ({ t: i * 60000, o: c, h: c, l: c, c, v: 1 }));
const macdR = computeAll(macdK, { macdFast: 12, macdSlow: 26, macdSignal: 9 });
assert("MACD 线有点", macdR.macdLine.length > 0);
const lastM = macdR.macdLine[macdR.macdLine.length - 1].value;
assert("MACD 末值为有限数", Number.isFinite(lastM), String(lastM));

// --- VWAP：单日常成交量下应等于典型价累计均值 ---
const dayMs = Date.UTC(2024, 0, 15);
const vwapK = [1, 2, 3].map((i) => ({
  t: dayMs + i * 3600000,
  o: 10,
  h: 12,
  l: 8,
  c: 10,
  v: 100,
}));
const vw = computeAll(vwapK).vwap;
const tp = (12 + 8 + 10) / 3;
assert("VWAP 常量 bar 等于典型价", vw.length === 3 && vw.every((p) => approx(p.value, tp)), JSON.stringify(vw));

assert(
  "周期区间窗口：5m 与 1d 配置不同",
  resolveRangeIntervalConfig("5m").windowBars === 864 && resolveRangeIntervalConfig("1d").windowBars === 180
);
assert(
  "未知周期回退到 1d 窗口长度",
  resolveRangeIntervalConfig("bogus").windowBars === resolveRangeIntervalConfig("1d").windowBars
);
assert("行情工作台上级周期：5m -> 15m", resolveChartHigherInterval("5m") === "15m");
assert("行情工作台上级周期：1d -> 3d", resolveChartHigherInterval("1d") === "3d");
assert("行情工作台上级周期：1w 无上级", resolveChartHigherInterval("1w") === null);

const ms5m = 5 * 60 * 1000;
const bars5m = Array.from({ length: 220 }, (_, i) => ({ t: i * ms5m, o: 100, h: 108, l: 92, c: 100, v: 1 }));
const k5 = computeKeyLevels(bars5m, { interval: "5m", lookbackBars: 180, limit: 5 });
assert("5m rangeContext 有效上沿", k5.rangeContext && Number.isFinite(k5.rangeContext.upper));
assert("5m rangeContext 窗口目标为 864", k5.rangeContext && k5.rangeContext.windowBars === 864);

const ms1d = 24 * 60 * 60 * 1000;
const bars1d = Array.from({ length: 220 }, (_, i) => ({ t: i * ms1d, o: 100, h: 130, l: 70, c: 100, v: 1 }));
const k1d = computeKeyLevels(bars1d, { interval: "1d", lookbackBars: 180, limit: 5 });
assert("1d rangeContext 窗口目标为 180", k1d.rangeContext && k1d.rangeContext.windowBars === 180);
assert(
  "长周期区间宽度不小于短周期（同价缩放模拟）",
  (k1d.rangeContext.upper - k1d.rangeContext.lower) >= (k5.rangeContext.upper - k5.rangeContext.lower) - 1e-6,
  `1d width ${k1d.rangeContext.upper - k1d.rangeContext.lower} vs 5m ${k5.rangeContext.upper - k5.rangeContext.lower}`
);

function makeBoxBars({
  length,
  ms,
  high = 110,
  low = 90,
  close = 100,
  finalClose = close,
  finalHigh,
  finalLow,
  spikeHigh,
  spikeLow,
}) {
  return Array.from({ length }, (_, i) => {
    const isLast = i === length - 1;
    const row = {
      t: i * ms,
      o: close,
      h: isLast && Number.isFinite(finalHigh) ? finalHigh : high,
      l: isLast && Number.isFinite(finalLow) ? finalLow : low,
      c: isLast ? finalClose : close,
      v: 1,
    };
    if (i === 80 && Number.isFinite(spikeHigh)) row.h = spikeHigh;
    if (i === 120 && Number.isFinite(spikeLow)) row.l = spikeLow;
    return row;
  });
}

const structureBase = computeChartStructureLevels(
  makeBoxBars({ length: 220, ms: ms5m, high: 110, low: 90, spikeHigh: 145 }),
  { interval: "5m", atrPeriod: 14, limit: 6 }
);
assert("结构算法返回 5m windowBars", structureBase.rangeContext.windowBars === 864);
assert(
  "反复触碰箱体上沿胜过孤立长影线",
  Math.abs(structureBase.rangeContext.upper - 110) < 1e-6,
  `upper ${structureBase.rangeContext.upper}`
);
assert(
  "孤立长影线进入近极端高点",
  structureBase.extremeContext.recentHigh && structureBase.extremeContext.recentHigh.price === 145,
  JSON.stringify(structureBase.extremeContext)
);

const pendingBreak = computeChartStructureLevels(
  makeBoxBars({ length: 220, ms: ms5m, high: 110, low: 90, finalHigh: 122, finalLow: 100, finalClose: 113 }),
  { interval: "5m", atrPeriod: 14, limit: 6 }
);
assert(
  "刺穿但收盘未越过缓冲时不是已突破",
  pendingBreak.rangeContext.state !== "已向上突破",
  pendingBreak.rangeContext.state
);
assert(
  "收盘站上上沿但未越过缓冲为待确认",
  pendingBreak.rangeContext.state === "向上突破待确认",
  pendingBreak.rangeContext.state
);

const confirmedBreak = computeChartStructureLevels(
  makeBoxBars({ length: 220, ms: ms5m, high: 110, low: 90, finalHigh: 126, finalLow: 104, finalClose: 125 }),
  { interval: "5m", atrPeriod: 14, limit: 6 }
);
assert(
  "收盘越过上沿 + ATR 缓冲后确认上破",
  confirmedBreak.rangeContext.state === "已向上突破",
  `${confirmedBreak.rangeContext.state} breakout ${confirmedBreak.rangeContext.breakout && confirmedBreak.rangeContext.breakout.price}`
);

const current1hBreak = computeChartStructureLevels(
  makeBoxBars({ length: 220, ms: 60 * 60 * 1000, high: 110, low: 90, finalHigh: 126, finalLow: 104, finalClose: 125 }),
  { interval: "1h", atrPeriod: 14, limit: 6 }
);
const higher4hRange = computeChartStructureLevels(
  makeBoxBars({ length: 220, ms: 4 * 60 * 60 * 1000, high: 130, low: 70, finalHigh: 125, finalLow: 95, finalClose: 100 }),
  { interval: "4h", atrPeriod: 14, limit: 6 }
);
const higherContext = buildChartHigherContext(current1hBreak, higher4hRange);
assert(
  "当前周期上破但上级周期仍压制时标为受压",
  higherContext.alignment === "受压",
  JSON.stringify(higherContext)
);

const emptyStructure = computeChartStructureLevels([], { interval: "15m" });
assert("结构算法样本不足稳定返回", emptyStructure.rangeContext.state === "样本不足" && Array.isArray(emptyStructure.resistance));

async function assertSnapshotParityVsBrowser() {
  const { pathToFileURL } = require("url");
  const snapMod = await import(pathToFileURL(path.join(__dirname, "..", "cloudflare", "snapshot", "chartStructureSnapshot.mjs")).href);
  const opts = { interval: "5m", atrPeriod: 14, limit: 6 };
  const boxBars = makeBoxBars({ length: 220, ms: ms5m, high: 110, low: 90, spikeHigh: 145 });
  const snapS = snapMod.computeSnapshotChartStructureLevels(boxBars, opts);
  const webS = computeChartStructureLevels(boxBars, opts);
  assert(
    "快照结构与浏览器 swing upper 对齐",
    Math.abs(Number(snapS.rangeContext.upper) - Number(webS.rangeContext.upper)) < 1e-6,
    `${snapS.rangeContext.upper} vs ${webS.rangeContext.upper}`
  );
  assert(
    "快照结构与浏览器 swing lower 对齐",
    Number.isFinite(Number(snapS.rangeContext.lower)) && Number.isFinite(Number(webS.rangeContext.lower))
      ? Math.abs(Number(snapS.rangeContext.lower) - Number(webS.rangeContext.lower)) < 1e-6
      : !Number.isFinite(Number(snapS.rangeContext.lower)) && !Number.isFinite(Number(webS.rangeContext.lower)),
    `${snapS.rangeContext.lower} vs ${webS.rangeContext.lower}`
  );
  assert("快照结构与浏览器 state 对齐", snapS.rangeContext.state === webS.rangeContext.state, `${snapS.rangeContext.state} vs ${webS.rangeContext.state}`);
  assert(
    "快照 buildChartHigherContext 对齐",
    JSON.stringify(snapMod.buildChartHigherContext(current1hBreak, higher4hRange)) === JSON.stringify(buildChartHigherContext(current1hBreak, higher4hRange)),
    "higher mismatch"
  );
}

assertSnapshotParityVsBrowser()
  .then(() => {
    console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
    process.exitCode = failed ? 1 : 0;
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
