function resolveDerivativeSyncFlagGroups(groups) {
  const g = String(groups || "all").toLowerCase().trim();
  if (g === "fast") return { includeFast: true, includeHourly: false, includeMacro: false, hourlyHeavyOnlySet: null, backfillMode: false };
  /** 仅 1h 历史类：不含 fast 快照（与页面分阶段同步配合）。 */
  if (g === "hourly") return { includeFast: false, includeHourly: true, includeMacro: false, hourlyHeavyOnlySet: null, backfillMode: false };
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

  /** @type {{plan: Record<string,string>, queuedOrSkipped?: string|null, skippedBecause?: string|null, hourlyBinanceUpstreamBlockedFlag?:boolean, customPingFail?:boolean, manualSkippedFreshFast?:boolean}} */
  let syncPlanExtras = {};
  const syncPlanFlags = {};

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
      : interaction === "manual_queue" || interaction === "async_queue" || interaction === "wait_until"
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
    mh =
      env && env.DB ? await readDerivativeMetricHealthMap(env, symbolArg) : mh;
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
    mh =
      env && env.DB ? await readDerivativeMetricHealthMap(env, symbolArg) : mh;
  }

  if (fg.includeFast) {
    const kFundingSnap = derivativeTaskHealthKey("funding_binance", "snap");
    const runnableFu = derivativeTaskRunnable(mh, kFundingSnap, now, derivativeSyncOpts.force).ok || derivativeSyncOpts.force;
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
    const runnableOi = derivativeTaskRunnable(mh, kOiSnap, now, derivativeSyncOpts.force).ok || derivativeSyncOpts.force;
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
    const gate = derivativeTaskRunnable(mh, tk, Date.now(), derivativeSyncOpts.force);
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
    const gate = derivativeTaskRunnable(mh, tk, Date.now(), derivativeSyncOpts.force);
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
      if (!derivativeTaskRunnable(mh, tk, Date.now(), derivativeSyncOpts.force).ok && !derivativeSyncOpts.force && !fg.backfillMode) throw new Error("__skip_window__");
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
      if (!derivativeTaskRunnable(mh, tk, Date.now(), derivativeSyncOpts.force).ok && !derivativeSyncOpts.force && !fg.backfillMode) throw new Error("__skip_window__");
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
      if (!derivativeTaskRunnable(mh, tk, Date.now(), derivativeSyncOpts.force).ok && !derivativeSyncOpts.force && !fg.backfillMode) throw new Error("__skip_window__");
      const mx = maxTs["basis_perp"];
      const lim = hourlyHistoryPullLimit(now, mx, fg.backfillMode ? 900000 : 3600000);
      const q = { pair, contractType: "PERPETUAL", period: "1h", limit: String(Math.min(lim, 499)) };
      const sts = hourlyHistoryStartTimeMs(mx, fg.backfillMode ? 12 * 3600000 : 4 * 3600000);
      if (sts) q.startTime = String(sts);
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
      if (!derivativeTaskRunnable(mh, tk, Date.now(), derivativeSyncOpts.force).ok && !derivativeSyncOpts.force && !fg.backfillMode) throw new Error("__skip_window__");
      const mx = maxTs["basis_quarter"];
      const lim = hourlyHistoryPullLimit(now, mx, fg.backfillMode ? 900000 : 3600000);
      const q = { pair, contractType: "CURRENT_QUARTER", period: "1h", limit: String(Math.min(lim, 499)) };
      const sts = hourlyHistoryStartTimeMs(mx, fg.backfillMode ? 12 * 3600000 : 4 * 3600000);
      if (sts) q.startTime = String(sts);
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
      if (!derivativeTaskRunnable(mh, tk, Date.now(), derivativeSyncOpts.force).ok && !derivativeSyncOpts.force && !fg.backfillMode) throw new Error("__skip_window__");
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
      if (!derivativeTaskRunnable(mh, tk, Date.now(), derivativeSyncOpts.force).ok && !derivativeSyncOpts.force && !fg.backfillMode) throw new Error("__skip_window__");
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
      const runnable = derivativeTaskRunnable(mh, tkMacro, Date.now(), derivativeSyncOpts.force).ok || derivativeSyncOpts.force || fg.backfillMode;
      if (!runnable) return;
      try {
        const vy = await fetchYahooChart(ticker, range, iv, env);
        for (const row of vy) points.push(derivativePoint(normalizedSymbol, canon, row.t, row.value, "yahoo-chart-side-channel", { ticker, unofficial: true }));
        await finalizeTaskOk(normalizedSymbol, tkMacro);
      } catch (e) {
        bumpDerivativeMetric(canon, e);
        await finalizeTaskFail(normalizedSymbol, tkMacro, e);
      }
      mh = await readDerivativeMetricHealthMap(env, normalizedSymbol);
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
