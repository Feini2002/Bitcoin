const fs = require("fs");
const path = require("path");

function runFibonacciVerification() {
  console.log("=========================================");
  console.log("   Fibonacci Bands 验证脚本 (Walk-forward)  ");
  console.log("=========================================");
  
  // Load math module
  const mathCode = fs.readFileSync(path.join(__dirname, "../js/chart/indicator-math.js"), "utf-8");
  const mathModule = {};
  const mockGlobal = { IndicatorMath: null };
  const fn = new Function("globalThis", "window", "global", mathCode);
  fn(mockGlobal, undefined, mockGlobal);
  const IndicatorMath = mockGlobal.IndicatorMath;

  if (!IndicatorMath || !IndicatorMath.computeChartStructureLevels) {
    console.error("无法加载 IndicatorMath，请检查 js/chart/indicator-math.js");
    process.exit(1);
  }

  // Generate synthetic test data to avoid needing a live API during test
  // Generate a trending + ranging series
  console.log("正在生成合成测试 K 线数据...");
  const klines = [];
  let currentPrice = 50000;
  let t = Date.now() - 365 * 24 * 3600 * 1000;
  const intervalMs = 24 * 3600 * 1000;
  
  for (let i = 0; i < 500; i++) {
    // Generate some trend and some range
    let trend = 0;
    if (i < 100) trend = 50; // uptrend
    else if (i < 200) trend = Math.sin(i / 10) * 200; // range
    else if (i < 300) trend = -50; // downtrend
    else if (i < 400) trend = Math.sin(i / 10) * 200; // range
    else trend = 100; // uptrend breakout
    
    // add noise
    const noise = (Math.random() - 0.5) * 500;
    const move = trend + noise;
    
    const o = currentPrice;
    const c = currentPrice + move;
    const h = Math.max(o, c) + Math.random() * 200;
    const l = Math.min(o, c) - Math.random() * 200;
    
    klines.push({ t, o, h, l, c, v: Math.random() * 1000 });
    
    currentPrice = c;
    t += intervalMs;
  }
  
  console.log(`生成了 ${klines.length} 根日 K 线，开始 Walk-forward 测试...`);
  
  const stats = {
    totalEvaluated: 0,
    fibHitCount: 0,
    baselineHitCount: 0,
    retracement: { count: 0, hits: 0 },
    extension: { count: 0, hits: 0 },
    lowAtr: { count: 0, hits: 0 },
    highAtr: { count: 0, hits: 0 }
  };

  // Start from bar 100 to allow range context to build up
  for (let i = 100; i < klines.length - 10; i++) {
    const historyWindow = klines.slice(0, i + 1);
    const analysis = IndicatorMath.computeChartStructureLevels(historyWindow, {
      interval: "1d",
      atrPeriod: 14,
      limit: 6
    });

    if (!analysis || !analysis.fibonacci || !analysis.fibonacci.levels || analysis.fibonacci.levels.length === 0) {
      continue;
    }
    
    stats.totalEvaluated++;
    const currentClose = klines[i].c;
    const atr = analysis.atr || 0;
    const isHighAtr = atr > currentClose * 0.03;
    
    // Determine closest fib level
    let closestFib = null;
    let minDistance = Infinity;
    
    for (const level of analysis.fibonacci.levels) {
      const dist = Math.abs(currentClose - level.price);
      if (dist < minDistance) {
        minDistance = dist;
        closestFib = level;
      }
    }
    
    // Also create a random baseline level (random price within the range)
    const rangeHeight = analysis.rangeContext.upper - analysis.rangeContext.lower;
    const baselinePrice = analysis.rangeContext.lower + Math.random() * rangeHeight;
    
    // Check next 10 bars for reaction
    let fibHit = false;
    let baselineHit = false;
    
    for (let j = i + 1; j <= i + 10 && j < klines.length; j++) {
      const nextH = klines[j].h;
      const nextL = klines[j].l;
      
      // Fib hit check: did price enter the band and then reverse > 0.5 ATR?
      if (!fibHit) {
        const inBand = (nextL <= closestFib.bandHigh && nextH >= closestFib.bandLow);
        if (inBand) {
          // Look ahead a bit more for reaction
          let reaction = 0;
          for (let k = j + 1; k <= i + 10 && k < klines.length; k++) {
            if (currentClose > closestFib.price) { // price came down to support
              reaction = Math.max(reaction, klines[k].h - nextL);
            } else { // price came up to resistance
              reaction = Math.max(reaction, nextH - klines[k].l);
            }
          }
          if (reaction > 0.5 * atr) {
            fibHit = true;
          }
        }
      }
      
      // Baseline hit check
      if (!baselineHit) {
        const baselineLow = baselinePrice - closestFib.halfWidth;
        const baselineHigh = baselinePrice + closestFib.halfWidth;
        const inBand = (nextL <= baselineHigh && nextH >= baselineLow);
        if (inBand) {
          let reaction = 0;
          for (let k = j + 1; k <= i + 10 && k < klines.length; k++) {
            if (currentClose > baselinePrice) { 
              reaction = Math.max(reaction, klines[k].h - nextL);
            } else { 
              reaction = Math.max(reaction, nextH - klines[k].l);
            }
          }
          if (reaction > 0.5 * atr) {
            baselineHit = true;
          }
        }
      }
    }
    
    // Update stats
    if (fibHit) {
      stats.fibHitCount++;
      if (closestFib.role === "retracement") stats.retracement.hits++;
      if (closestFib.role === "extension") stats.extension.hits++;
      if (isHighAtr) stats.highAtr.hits++;
      else stats.lowAtr.hits++;
    }
    
    if (baselineHit) stats.baselineHitCount++;
    
    if (closestFib.role === "retracement") stats.retracement.count++;
    if (closestFib.role === "extension") stats.extension.count++;
    if (isHighAtr) stats.highAtr.count++;
    else stats.lowAtr.count++;
  }
  
  console.log("\n=========================================");
  console.log("   验证结果统计");
  console.log("=========================================");
  console.log(`总评估点数: ${stats.totalEvaluated}`);
  console.log(`Fibonacci 胜率: ${((stats.fibHitCount / Math.max(1, stats.totalEvaluated)) * 100).toFixed(2)}%`);
  console.log(`随机基准胜率: ${((stats.baselineHitCount / Math.max(1, stats.totalEvaluated)) * 100).toFixed(2)}%`);
  console.log("-----------------------------------------");
  console.log(`回撤任务胜率: ${((stats.retracement.hits / Math.max(1, stats.retracement.count)) * 100).toFixed(2)}% (${stats.retracement.count} 样本)`);
  console.log(`扩展任务胜率: ${((stats.extension.hits / Math.max(1, stats.extension.count)) * 100).toFixed(2)}% (${stats.extension.count} 样本)`);
  console.log("-----------------------------------------");
  console.log(`低 ATR 胜率: ${((stats.lowAtr.hits / Math.max(1, stats.lowAtr.count)) * 100).toFixed(2)}% (${stats.lowAtr.count} 样本)`);
  console.log(`高 ATR 胜率: ${((stats.highAtr.hits / Math.max(1, stats.highAtr.count)) * 100).toFixed(2)}% (${stats.highAtr.count} 样本)`);
  console.log("=========================================\n");
  
  const hasEdge = (stats.fibHitCount / Math.max(1, stats.totalEvaluated)) > (stats.baselineHitCount / Math.max(1, stats.totalEvaluated));
  if (hasEdge) {
    console.log("结论：Fibonacci 带宽具有统计学优势（优于随机基准）。");
  } else {
    console.log("结论：未跑赢随机基准，建议调整 k 值、置信度阈值或仅在特定状态启用。");
  }
}

runFibonacciVerification();
