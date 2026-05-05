/* =======================================================
   强平雷达 · 估算压力矩阵（纯函数，浏览器 + Node 共用）
   输出为风险情景评分，非 CoinGlass 式“潜在清算池”金额。
   ======================================================= */

(function pressureMatrixModule(globalTarget) {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const HOUR_MS = 60 * 60 * 1000;
  const STALE_DERIV_MS = 6 * HOUR_MS;
  const FUND_CROWD = 0.0005;

  function num(v) {
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  }

  function clamp(x, lo, hi) {
    return Math.min(hi, Math.max(lo, x));
  }

  function rowLongNotional(row) {
    if (!row) return 0;
    if (row.long_notional != null) return Number(row.long_notional) || 0;
    return Number(row.longNotional) || 0;
  }

  function rowShortNotional(row) {
    if (!row) return 0;
    if (row.short_notional != null) return Number(row.short_notional) || 0;
    return Number(row.shortNotional) || 0;
  }

  function summarizeLiquidationRows(rows) {
    let longN = 0;
    let shortN = 0;
    for (const row of rows || []) {
      longN += rowLongNotional(row);
      shortN += rowShortNotional(row);
    }
    const totalN = longN + shortN;
    return {
      longN,
      shortN,
      totalN,
      longRatio: totalN > 0 ? longN / totalN : null,
    };
  }

  function sortedSeriesPoints(series) {
    if (!Array.isArray(series) || !series.length) return [];
    return series
      .map((p) => ({ t: Number(p.t), value: num(p.value) }))
      .filter((p) => p.value != null && Number.isFinite(p.t))
      .sort((a, b) => a.t - b.t);
  }

  function latestSeriesValue(series) {
    const pts = sortedSeriesPoints(series);
    if (!pts.length) return null;
    return pts[pts.length - 1].value;
  }

  function changePctOverWindow(series, windowMs) {
    const pts = sortedSeriesPoints(series);
    if (pts.length < 2) return null;
    const end = pts[pts.length - 1];
    const cutoff = end.t - windowMs;
    let prev = null;
    for (let i = pts.length - 2; i >= 0; i -= 1) {
      if (pts[i].t <= cutoff) {
        prev = pts[i];
        break;
      }
    }
    if (!prev) prev = pts[0];
    if (!prev || !prev.value || prev.value === 0) return null;
    return ((end.value - prev.value) / Math.abs(prev.value)) * 100;
  }

  function analyzeKlines(klines) {
    const out = {
      ok: false,
      close: null,
      high24: null,
      low24: null,
      rangePos: null,
      atr14Approx: null,
    };
    if (!Array.isArray(klines) || klines.length < 5) return out;
    const rows = klines
      .map((k) => ({
        t: Number(k.t),
        h: num(k.h),
        l: num(k.l),
        c: num(k.c),
      }))
      .filter((k) => Number.isFinite(k.t) && k.c != null && k.h != null && k.l != null);
    if (!rows.length) return out;
    rows.sort((a, b) => a.t - b.t);
    const last = rows[rows.length - 1];
    out.close = last.c;
    const last24 = rows.filter((k) => k.t >= last.t - DAY_MS);
    const slice = last24.length ? last24 : rows.slice(-25);
    out.high24 = Math.max(...slice.map((k) => k.h));
    out.low24 = Math.min(...slice.map((k) => k.l));
    const span = out.high24 - out.low24;
    if (span > 0 && out.close != null) {
      out.rangePos = clamp((out.close - out.low24) / span, 0, 1);
    }
    const n = Math.min(14, rows.length - 1);
    if (n >= 1) {
      let sumTr = 0;
      for (let i = rows.length - n; i < rows.length; i += 1) {
        const cur = rows[i];
        const prev = rows[i - 1];
        const tr = Math.max(
          cur.h - cur.l,
          Math.abs(cur.h - prev.c),
          Math.abs(cur.l - prev.c)
        );
        sumTr += tr;
      }
      out.atr14Approx = sumTr / n;
    }
    out.ok = out.close != null && out.high24 != null && out.low24 != null;
    return out;
  }

  function basisLatestValue(deriv) {
    const s = deriv && deriv.series ? deriv.series.basis_quarter : null;
    const v = latestSeriesValue(s);
    return v;
  }

  /**
   * @param {object} input
   * @param {string} [input.symbol]
   * @param {string} [input.generatedAt] ISO
   * @param {{ bucketSize?: number, window?: string, minNotional?: number }} [input.heatmapState]
   * @param {Array} [input.liquidationRows] D1 行 snake_case 或归一化行
   * @param {object} [input.derivativesPayload]
   * @param {Array} [input.klines1h]
   * @param {'d1'|'live'} [input.aggregateSource]
   * @param {string} [input.derivativesError]
   * @param {string} [input.klinesError]
   */
  function build(input) {
    const warnings = [];
    const nowIso = new Date().toISOString();
    const symbol = String((input && input.symbol) || "BTCUSDT").toUpperCase();
    const generatedAt = (input && input.generatedAt) || nowIso;
    const aggregateSource = (input && input.aggregateSource) === "live" ? "live" : "d1";
    const deriv = input && input.derivativesPayload;
    const klines = input && input.klines1h;
    const liqRows = (input && input.liquidationRows) || [];

    if (input && input.derivativesError) {
      warnings.push(`衍生品读取：${String(input.derivativesError).slice(0, 120)}`);
    }
    if (input && input.klinesError) {
      warnings.push(`K线背景：${String(input.klinesError).slice(0, 120)}`);
    }

    const fundingLast = deriv && deriv.series ? latestSeriesValue(deriv.series.funding_binance) : null;
    const oiSeries = deriv && deriv.series ? deriv.series.oi_binance : null;
    const oiCh6 = changePctOverWindow(oiSeries, 6 * HOUR_MS);
    const oiCh24 = changePctOverWindow(oiSeries, DAY_MS);
    const priceCh24 = num(deriv && deriv.priceChange24hPct);
    const basisQ = basisLatestValue(deriv);

    let derivStale = false;
    const derivFreshness = deriv && deriv.dataFreshness ? deriv.dataFreshness : {};
    const staleMs = num(derivFreshness.staleMs);
    const worstCoreStaleMs = num(derivFreshness.worstCoreStaleMs);
    const coreStaleMetrics = Array.isArray(derivFreshness.coreStaleMetrics) ? derivFreshness.coreStaleMetrics : [];
    if (
      derivFreshness.sourceOk === false ||
      (Number.isFinite(worstCoreStaleMs) && worstCoreStaleMs > STALE_DERIV_MS) ||
      (Number.isFinite(staleMs) && staleMs > STALE_DERIV_MS)
    ) {
      derivStale = true;
      const ageMs = Number.isFinite(worstCoreStaleMs) ? worstCoreStaleMs : staleMs;
      const ageText = Number.isFinite(ageMs) ? `约 ${Math.round(ageMs / HOUR_MS)} 小时` : "核心口径";
      const keysText = coreStaleMetrics.length ? `：${coreStaleMetrics.slice(0, 4).join(",")}` : "";
      warnings.push(`衍生品核心样本偏旧${keysText}（${ageText}），置信度下调。`);
    }

    const k = analyzeKlines(klines);
    if (!k.ok) {
      warnings.push("1h K 线背景不足：价格区间位置等维度降级，可用 24h 涨跌幅兜底。");
    }

    const liq = summarizeLiquidationRows(liqRows);
    if (aggregateSource === "live") {
      warnings.push("D1 强平聚合不可用：压力矩阵中的「已发生强平」分量仅来自本页缓存，置信度下调。");
    }

    let completeness = 100;
    if (fundingLast == null) {
      completeness -= 25;
      warnings.push("缺少 Funding 最新点。");
    }
    if (oiCh24 == null && oiCh6 == null) {
      completeness -= 25;
      warnings.push("缺少 OI  usable 样本。");
    }
    if (!k.ok) completeness -= 15;
    if (aggregateSource === "live") completeness -= 10;
    completeness = clamp(completeness, 0, 100);

    let confidence = 100;
    if (fundingLast == null) confidence -= 22;
    if (oiCh24 == null && oiCh6 == null) confidence -= 22;
    if (!k.ok) confidence -= 14;
    if (aggregateSource === "live") confidence -= 12;
    if (derivStale) confidence -= 18;
    confidence = clamp(confidence, 0, 100);

    const oiUp =
      (oiCh24 != null && oiCh24 > 1) ||
      (oiCh6 != null && oiCh6 > 0.8);
    const oiDown =
      (oiCh24 != null && oiCh24 < -1) ||
      (oiCh6 != null && oiCh6 < -0.8);

    /** @type {{ id: string, label: string, score: number, factors: { label: string, detail: string, contribution: number }[] }[]} */
    const factorsDown = [];
    const factorsUp = [];
    const factorsDelev = [];
    let scoreDown = 0;
    let scoreUp = 0;
    let scoreDelev = 0;

    if (fundingLast != null) {
      if (fundingLast >= FUND_CROWD) {
        scoreDown += 14;
        factorsDown.push({ label: "Funding", detail: `多头拥挤 ${(fundingLast * 100).toFixed(3)}%/8h 口径`, contribution: 14 });
        if (fundingLast >= 0.001) {
          scoreDown += 8;
          factorsDown.push({ label: "Funding+", detail: "费率处于更强正区间", contribution: 8 });
        }
      }
      if (fundingLast <= -FUND_CROWD) {
        scoreUp += 14;
        factorsUp.push({ label: "Funding", detail: `空头拥挤 ${(fundingLast * 100).toFixed(3)}%/8h 口径`, contribution: 14 });
        if (fundingLast <= -0.001) {
          scoreUp += 8;
          factorsUp.push({ label: "Funding+", detail: "费率处于更强负区间", contribution: 8 });
        }
      }
    }

    if (oiUp) {
      scoreDown += 10;
      scoreUp += 10;
      factorsDown.push({
        label: "OI",
        detail: `杠杆堆升（6h ${oiCh6 != null ? oiCh6.toFixed(1) : "--"}% / 24h ${oiCh24 != null ? oiCh24.toFixed(1) : "--"}%）`,
        contribution: 10,
      });
      factorsUp.push({
        label: "OI",
        detail: `杠杆堆升（6h ${oiCh6 != null ? oiCh6.toFixed(1) : "--"}% / 24h ${oiCh24 != null ? oiCh24.toFixed(1) : "--"}%）`,
        contribution: 10,
      });
    }

    if (priceCh24 != null) {
      if (priceCh24 < -0.5) {
        scoreDown += 12;
        factorsDown.push({ label: "价格偏离", detail: `24h ${priceCh24.toFixed(1)}%（不利多头）`, contribution: 12 });
      }
      if (priceCh24 > 0.5) {
        scoreUp += 12;
        factorsUp.push({ label: "价格偏离", detail: `24h +${priceCh24.toFixed(1)}%（不利空头）`, contribution: 12 });
      }
      if (Math.abs(priceCh24) < 1 && oiUp) {
        scoreDown += 6;
        scoreUp += 6;
        factorsDown.push({ label: "蓄力", detail: "横盘/弱波动但 OI 抬升", contribution: 6 });
        factorsUp.push({ label: "蓄力", detail: "横盘/弱波动但 OI 抬升", contribution: 6 });
      }
    }

    if (basisQ != null) {
      if (basisQ > 5) {
        scoreDown += 10;
        factorsDown.push({ label: "基差", detail: `季度年化偏高 ${basisQ.toFixed(1)}`, contribution: 10 });
      } else if (basisQ > 2) {
        scoreDown += 5;
        factorsDown.push({ label: "基差", detail: `升水温和偏高 ${basisQ.toFixed(1)}`, contribution: 5 });
      }
      if (basisQ < -1) {
        scoreUp += 10;
        factorsUp.push({ label: "基差", detail: `贴水 ${basisQ.toFixed(1)}`, contribution: 10 });
      }
    }

    if (liq.totalN > 0) {
      if (liq.longN > liq.shortN * 1.15) {
        scoreDown += 18;
        factorsDown.push({
          label: "已发生强平",
          detail: `窗口内多头被强平占优（多/空≈${(liq.longN / Math.max(1, liq.shortN)).toFixed(2)}）`,
          contribution: 18,
        });
      }
      if (liq.shortN > liq.longN * 1.15) {
        scoreUp += 18;
        factorsUp.push({
          label: "已发生强平",
          detail: `窗口内空头被强平占优（空/多≈${(liq.shortN / Math.max(1, liq.longN)).toFixed(2)}）`,
          contribution: 18,
        });
      }
    }

    if (k.ok && priceCh24 != null) {
      if (k.rangePos != null && k.rangePos > 0.65 && priceCh24 < 0) {
        scoreDown += 10;
        factorsDown.push({ label: "价位位置", detail: "接近 24h 区间上沿且回落", contribution: 10 });
      }
      if (k.rangePos != null && k.rangePos < 0.35 && priceCh24 > 0) {
        scoreUp += 10;
        factorsUp.push({ label: "价位位置", detail: "接近 24h 区间下沿且反弹", contribution: 10 });
      }
    }

    if (oiDown) {
      scoreDelev += 22;
      factorsDelev.push({
        label: "OI",
        detail: `去杠杆（24h ${oiCh24 != null ? oiCh24.toFixed(1) : "--"}% / 6h ${oiCh6 != null ? oiCh6.toFixed(1) : "--"}%）`,
        contribution: 22,
      });
    }
    if (liq.totalN >= 5e5) {
      scoreDelev += Math.min(22, 12 + liq.totalN / 5e6);
      factorsDelev.push({
        label: "已发生强平",
        detail: `窗口名义金额 ${(liq.totalN / 1e6).toFixed(2)}M`,
        contribution: Math.min(22, 12 + liq.totalN / 5e6),
      });
    }
    if (fundingLast != null && Math.abs(fundingLast) < 0.0003) {
      scoreDelev += 8;
      factorsDelev.push({ label: "Funding", detail: "费率接近中性", contribution: 8 });
    }

    scoreDown = clamp(Math.round(scoreDown), 0, 100);
    scoreUp = clamp(Math.round(scoreUp), 0, 100);
    scoreDelev = clamp(Math.round(scoreDelev), 0, 100);

    const watchBase = clamp(Math.round(38 + (100 - confidence) * 0.35), 0, 100);

    const scenarios = [
      { id: "down-long", label: "下行多头挤压风险", score: scoreDown, factors: factorsDown },
      { id: "up-short", label: "上行空头挤压风险", score: scoreUp, factors: factorsUp },
      { id: "delever", label: "去杠杆释放", score: scoreDelev, factors: factorsDelev },
      { id: "watch", label: "观望·样本不足", score: watchBase, factors: [{ label: "数据覆盖", detail: "低置信或关键输入缺失时的中性情景", contribution: watchBase }] },
    ];

    const ranked = scenarios.filter((s) => s.id !== "watch").sort((a, b) => b.score - a.score);
    let primary = ranked[0];
    if (!primary || confidence < 38 || (fundingLast == null && oiCh24 == null && oiCh6 == null)) {
      primary = scenarios.find((s) => s.id === "watch");
    } else if (primary.score < 18 && watchBase >= primary.score) {
      primary = scenarios.find((s) => s.id === "watch");
    }

    const summary = {
      primaryId: primary.id,
      primaryLabel: primary.label,
      primaryScore: primary.score,
      confidence: Math.round(confidence),
      dataCompleteness: Math.round(completeness),
      updatedAt: generatedAt,
      symbol,
    };

    const llmBrief =
      `估算压力（非清算池金额）：${primary.label} 评分 ${primary.score}，数据置信 ${summary.confidence}%。` +
      `已发生强平窗口名义 ${liq.totalN ? (liq.totalN / 1e6).toFixed(2) + "M" : "接近 0"}，` +
      `Funding ${fundingLast != null ? (fundingLast * 100).toFixed(3) + "%" : "-- "}，` +
      `OI 24h ${oiCh24 != null ? oiCh24.toFixed(1) + "%" : "--"}。仅供风险视角，不作独立交易触发。`;

    return {
      snapshotVersion: "1.0.0",
      summary,
      rows: scenarios,
      warnings,
      llmBrief,
      inputsEcho: {
        aggregateSource,
        liquidationWindowNotional: liq.totalN,
        hasDerivatives: !!deriv,
        hasKlines: k.ok,
      },
    };
  }

  const HeatmapPressureMatrix = { build };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = HeatmapPressureMatrix;
    module.exports.build = build;
    module.exports.HeatmapPressureMatrix = HeatmapPressureMatrix;
  }
  if (globalTarget && typeof globalTarget === "object") {
    globalTarget.HeatmapPressureMatrix = HeatmapPressureMatrix;
  }
})(
  typeof window !== "undefined"
    ? window
    : typeof globalThis !== "undefined"
      ? globalThis
      : null
);
