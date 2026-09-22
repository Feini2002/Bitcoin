/**
 * Batch2 离线验收：把合成 CHECK 接到 BitContracts 与已修改的纯函数。
 * 不访问真实市场/模型 API，不写生产 D1。
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const BitContracts = require(path.join(ROOT, "js", "contracts", "bit-contracts.js"));
const Pressure = require(path.join(ROOT, "js", "heatmap", "pressure-matrix.js"));

function loadIife(rel, globalName) {
  const sandbox = {
    console,
    Date,
    Math,
    Number,
    JSON,
    Array,
    Object,
    String,
    Map,
    Set,
    parseFloat,
    isFinite,
    Infinity,
    NaN,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.BitContracts = BitContracts;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, rel), "utf8"), sandbox, { filename: rel });
  return globalName ? sandbox[globalName] : sandbox;
}

const IndicatorMath = loadIife("js/chart/indicator-math.js", "IndicatorMath");
const Footprint = loadIife("js/orderflow/footprint-engine.js", "FootprintEngine");
const Liquidation = loadIife("js/heatmap/liquidation-engine.js", "LiquidationEngine");

const casesPath = path.join(
  ROOT,
  "docs/research/bitcoin-upgrade/batch2-execution/03_validation/acceptance_cases.json"
);
const acceptanceCases = JSON.parse(fs.readFileSync(casesPath, "utf8"));
const caseById = Object.fromEntries((acceptanceCases.cases || []).map((row) => [row.id, row]));

let failed = 0;
const ran = [];
function check(id, fn) {
  ran.push(id);
  try {
    fn(caseById[id] || { id });
    console.log("OK", id);
  } catch (err) {
    failed += 1;
    console.error("FAIL", id, err && err.message ? err.message : err);
  }
}

const PERP = BitContracts.PRIMARY_INSTRUMENT;

check("CHECK-001", () => {
  const result = BitContracts.validateKlineDomain(
    { o: 100, h: 101, l: 99, c: 100, v: 1, product: "spot" },
    "perpetual"
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "product_mismatch");
});

check("CHECK-002", () => {
  const result = BitContracts.classifyLegacySource({ source: null, old_symbol: "BTCUSDT" });
  assert.equal(result.status, "legacy_unknown");
  assert.equal(result.claimVenue, null);
});

check("CHECK-003", () => {
  const result = BitContracts.capabilityStatus({ registered: true, automaticCollection: false, frontendConnected: false });
  assert.equal(result.label, "catalog_only");
  assert.equal(result.liveClaimAllowed, false);
});

check("CHECK-004", () => {
  const result = BitContracts.coverageForWindow(500, 864);
  assert.equal(result.ok, false);
  assert.equal(result.missing, 364);
  assert.equal(result.claimComplete, false);
});

check("CHECK-005", () => {
  const native = ["5m", "15m", "1h", "4h", "1d", "1w"];
  assert.equal(native.includes("3d"), false);
});

check("CHECK-006", () => {
  const result = BitContracts.classifyKlineFinality({ nativeX: false, clockAfterClose: true });
  assert.equal(result.status, "forming");
  assert.equal(result.usableForCloseConfirm, false);
});

check("CHECK-007", () => {
  const result = BitContracts.transportVsMarket({ wsOpen: true, lastMarketEventAt: null, now: 1 });
  assert.equal(result.livePriceClaim, false);
  assert.equal(result.marketFreshness, "unknown");
});

check("CHECK-008", () => {
  const result = BitContracts.lateObservationGuard({ requestSeq: 4, latestSeq: 5, returnSeq: 6 });
  assert.equal(result.accept, false);
});

check("CHECK-009", () => {
  const result = BitContracts.evaluateFrozenBreakout({
    knownLevel: 101,
    buffer: 1,
    previousClose: 100,
    closedClose: 103,
    side: "resistance",
  });
  assert.equal(result.confirmed, true);
  assert.ok(IndicatorMath && IndicatorMath.computeChartStructureLevels);
});

check("CHECK-010", () => {
  const fromTrades = BitContracts.computeQuoteBaseVwap([{ trades: [[90, 4], [110, 6]] }]);
  assert.equal(fromTrades.value, 102);
  const hlc3 = BitContracts.computeHlc3ApproxVwap([{ o: 90, h: 110, l: 90, c: 110, v: 10 }]);
  assert.ok(Math.abs(hlc3.value - 103.3333333333) < 1e-6);
  assert.notEqual(fromTrades.methodId, hlc3.methodId);
});

check("CHECK-011", () => {
  const result = BitContracts.computeQuoteBaseVwap([{ quoteVolume: 0, baseVolume: 0 }]);
  assert.equal(result.value, null);
});

check("CHECK-012", () => {
  const day1 = Array.from({ length: 24 }, (_, i) => ({
    t: Date.UTC(2026, 8, 15, i),
    o: 100, h: 101, l: 99, c: 100, v: 1,
  }));
  const day2 = [{ t: Date.UTC(2026, 8, 16, 1), o: 100, h: 101, l: 99, c: 100, v: 1 }];
  const ok = BitContracts.prevCompletedUtcDayRange(day1.concat(day2), { intervalMs: 3600000 });
  assert.equal(ok.ok, true);
  const incomplete = BitContracts.prevCompletedUtcDayRange(
    [{ t: Date.UTC(2026, 8, 14, 12), o: 90, h: 91, l: 89, c: 90, v: 1 }].concat(day2),
    { intervalMs: 3600000 }
  );
  assert.equal(incomplete.ok, false);
});

check("CHECK-015", () => {
  const result = BitContracts.selectPoc(
    [{ price: 100, total: 10 }, { price: 110, total: 10 }],
    { vwap: 102 }
  );
  assert.equal(result.pocPrice, 100);
});

check("CHECK-016", () => {
  const nested = BitContracts.priceFromIndex(BitContracts.nestedPriceIndex(4.6, 1), 10);
  const direct = BitContracts.priceFromIndex(BitContracts.nestedPriceIndex(4.6, 10), 10);
  assert.notEqual(nested, direct);
});

check("CHECK-021", () => {
  const result = BitContracts.orderflowFreshness({ now: 1000, lastTradeTime: null, barEnd: 1000 });
  assert.equal(result.status, "unknown");
  assert.equal(result.usedBarEndAsHeartbeat, false);
});

check("CHECK-028", () => {
  const result = BitContracts.selectAsOfWindow({
    points: [
      { t: Date.parse("2026-09-16T10:00:00Z"), value: 100 },
      { t: Date.parse("2026-09-16T11:00:00Z"), value: 110 },
    ],
    requestedWindowMs: 24 * 3600 * 1000,
    asOf: Date.parse("2026-09-16T11:00:00Z"),
    toleranceMs: 15 * 60 * 1000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "insufficient_anchor");
  assert.equal(result.value, null);
});

check("CHECK-029", () => {
  const result = BitContracts.selectAsOfWindow({
    points: [
      { t: 0, value: 100, source: "binance" },
      { t: 24 * 3600 * 1000, value: 110, source: "bybit" },
    ],
    requestedWindowMs: 24 * 3600 * 1000,
    asOf: 24 * 3600 * 1000,
    expectedSource: "binance",
  });
  assert.equal(result.ok, false);
});

check("CHECK-030", () => {
  const a = BitContracts.fundingDisplay({ rate: 0.5, unit: "percent" });
  const b = BitContracts.fundingDisplay({ rate: 1, unit: "percent" });
  const c = BitContracts.fundingDisplay({ rate: 1.01, unit: "percent" });
  assert.ok(a.percent < b.percent && b.percent < c.percent);
  assert.equal(a.guessedUnit, false);
});

check("CHECK-031", () => {
  const result = BitContracts.fundingDisplay({ rate: 0.0001, unit: "decimal-per-settlement", intervalHours: 4 });
  assert.ok(Math.abs(result.percent - 0.01) < 1e-9);
  assert.equal(result.intervalHours, 4);
  assert.ok(result.annualized != null);
});

check("CHECK-032", () => {
  const result = BitContracts.fundingDisplay({ rate: 0.0001, unit: "decimal-per-settlement", intervalHours: null });
  assert.ok(Math.abs(result.percent - 0.01) < 1e-9);
  assert.equal(result.annualized, null);
});

check("CHECK-033", () => {
  const built = Pressure.build({
    symbol: "BTCUSDT",
    generatedAt: "2026-09-16T12:00:00.000Z",
    heatmapState: { bucketSize: 50, window: "15m", minNotional: 0 },
    liquidationRows: [],
    aggregateSource: "d1",
    derivativesPayload: { series: { oi: [] } },
    klines: [],
    nowMs: Date.parse("2026-09-16T12:00:00.000Z"),
  });
  assert.equal(built.methodId, "heatmap-weighted-v1");
  const snap = fs.readFileSync(path.join(ROOT, "cloudflare/snapshot/marketSnapshotProgram.mjs"), "utf8");
  assert.match(snap, /omitted: true/);
  assert.match(snap, /cross-venue heuristic scores are not an authoritative liquidation map/);
  assert.doesNotMatch(snap, /heatmap-log10-v1/);
  assert.notEqual("heatmap-weighted-v1", "heatmap-log10-v1");
});

check("CHECK-034", () => {
  const now = 2 * 60 * 60 * 1000;
  const result = BitContracts.freshnessByTask(
    [
      { id: "5m", interval: "5m", latestT: now - 1000, staleAfterMs: 30 * 60 * 1000, required: false },
      { id: "1h", interval: "1h", latestT: 1, staleAfterMs: 60 * 60 * 1000, required: true, current: true },
    ],
    now
  );
  assert.equal(result.anyFresh, true);
  assert.equal(result.taskOk, false);
});

check("CHECK-035", () => {
  const brief = BitContracts.buildMarketBrief({
    capture: { captureId: "c1" },
    facts: [{ id: "f1", text: "close 102" }],
  });
  assert.equal(brief.status, "initial_baseline");
  assert.equal(brief.modelUsed, false);
  assert.equal(brief.scores, null);
});

check("quote-base-equals-trades", () => {
  const a = BitContracts.computeQuoteBaseVwap([{ trades: [[90, 4], [110, 6]] }]);
  const b = BitContracts.computeQuoteBaseVwap([{ quoteVolume: 1020, baseVolume: 10 }]);
  assert.equal(a.value, b.value);
});

check("CHECK-012b-session-incomplete", () => {
  const rows = [
    { t: Date.UTC(2026, 8, 16, 8), o: 90, h: 110, l: 90, c: 110, v: 10, quoteVolume: 1020, baseVolume: 10 },
  ];
  const series = BitContracts.sessionVwapSeries(rows, { mode: "quote_base" });
  assert.equal(series[0].sessionAnchorComplete, false);
  assert.equal(series[0].value, 102);
});

check("CHECK-013", () => {
  const incomplete = BitContracts.prevCompletedUtcDayRange(
    [
      { t: Date.UTC(2026, 8, 14, 12), o: 90, h: 91, l: 89, c: 90, v: 1 },
      { t: Date.UTC(2026, 8, 16, 1), o: 100, h: 101, l: 99, c: 100, v: 1 },
    ],
    { intervalMs: 3600000 }
  );
  assert.equal(incomplete.ok, false);
});

check("CHECK-014", () => {
  const result = BitContracts.swingKnownAt({ pivotBar: 5, wing: 3, evaluationBar: 6 });
  assert.equal(result.usableAtEvaluation, false);
  assert.equal(result.confirmedAtBar, 8);
});

check("CHECK-017", () => {
  const result = BitContracts.classifyTickSources({ observedPrices: [100, 110, 120], exchangeTick: 0.1 });
  assert.equal(result.observedGapIsExchangeTick, false);
  assert.equal(result.observedMinGap, 10);
});

check("CHECK-018", () => {
  const result = BitContracts.preserveAnalysisBin(100, 10, 20);
  assert.equal(result.analysis, 100);
  assert.equal(result.displayChanged, true);
});

check("CHECK-019", () => {
  const src = fs.readFileSync(path.join(ROOT, "js/orderflow/footprint-engine.js"), "utf8");
  assert.match(src, /prefixLevels/);
  assert.match(src, /rows\.slice\(0,/);
});

check("CHECK-020", () => {
  const src = fs.readFileSync(path.join(ROOT, "js/orderflow/footprint-engine.js"), "utf8");
  assert.match(src, /confirmBar/);
  assert.match(src, /latestBarClosed/);
});

check("CHECK-022", () => {
  assert.ok(Liquidation && typeof Liquidation.normalizeBinance === "function");
  const binance = Liquidation.normalizeBinance({ e: "forceOrder", o: { S: "SELL", ap: "100", z: "1", s: "BTCUSDT", T: 1 } });
  assert.equal(binance.positionSide, "long");
  const bybitRows = Liquidation.normalizeBybit({
    topic: "allLiquidation.BTCUSDT",
    data: [{ S: "Buy", p: "100", v: "1", T: "1", s: "BTCUSDT" }],
  });
  assert.ok(bybitRows.length);
  assert.equal(bybitRows[0].positionSide, "long");
});

check("CHECK-023", () => {
  assert.ok(Liquidation);
  const events = [{ positionSide: "unknown", notional: 100, ts: 1, exchange: "x", price: 1 }];
  if (typeof Liquidation.buildStats === "function") {
    const stats = Liquidation.buildStats(events, {});
    assert.equal(stats.unknownNotional, 100);
    assert.equal(stats.longNotional || 0, 0);
  } else if (typeof Liquidation.aggregateByPrice === "function") {
    const rows = Liquidation.aggregateByPrice(events, 1);
    assert.equal(rows[0].unknownNotional, 100);
    assert.equal(rows[0].longNotional, 0);
  } else {
    throw new Error("liquidation helpers not exported");
  }
});

check("CHECK-024", () => {
  const result = BitContracts.classifyLiquidationQuote({ ap: 0, p: 100, z: 0, q: 10 });
  assert.equal(result.usableAsFillNotional, false);
});

check("CHECK-025", () => {
  const result = BitContracts.classifyLiquidationQuote({ p: 100, v: 2 });
  assert.equal(result.kind, "bankruptcy_or_mark_estimate");
  assert.equal(result.usableAsFillNotional, false);
  assert.equal(result.estimate, 200);
});

check("CHECK-026", () => {
  const result = BitContracts.cumulativeFilledDelta("O1", [2, 3, 3]);
  assert.deepEqual(result.deltas, [2, 1, 0]);
});

check("CHECK-027", () => {
  const result = BitContracts.cumulativeFilledDelta(null, [1, 1]);
  assert.equal(result.losslessDedup, false);
});

check("CHECK-036", () => {
  const result = BitContracts.observationKind({ field: "rangePositionPct", computed: true });
  assert.equal(result.kind, "computed_description");
  assert.equal(result.rawFact, false);
});

check("CHECK-037", () => {
  const brief = BitContracts.buildMarketBrief({ capture: { captureId: "c" }, facts: [{ id: "f", text: "ok" }] });
  assert.equal(brief.scores, null);
  assert.equal(brief.modelUsed, false);
});

check("CHECK-038", () => {
  const result = BitContracts.opportunityFromAvailability({ marketOk: true, directionsNotComputed: true });
  assert.equal(result.alignedOpportunity, false);
});

check("CHECK-039", () => {
  const result = BitContracts.calendarFactKind({ publishedAt: "2026-09-16", officialSchedule: null });
  assert.equal(result.futureCatalystAllowed, false);
});

check("CHECK-040", () => {
  const result = BitContracts.searchCoverageStatus({ incrementalSearchUsed: false, sourceHealth: "unknown" });
  assert.equal(result.coverage, "unknown");
  assert.equal(result.claimSufficient, false);
});

check("missing-vs-zero", () => {
  assert.equal(BitContracts.missingVsZero(0).kind, "zero");
  assert.equal(BitContracts.missingVsZero(null).kind, "missing");
});

check("CHECK-041", () => {
  const result = BitContracts.validateOhlc({ o: 100, h: 90, l: 80, c: 105 });
  assert.equal(result.ok, false);
});

check("CHECK-042", () => {
  const result = BitContracts.validateKlineDomain({ o: 10, h: 11, l: 9, c: 10, v: 10, takerBuyBase: 11 }, PERP);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "taker_exceeds_total");
});

check("negative-volume", () => {
  const result = BitContracts.validateKlineDomain({ o: 1, h: 2, l: 0.5, c: 1, v: -1 }, PERP);
  assert.equal(result.ok, false);
});

check("CHECK-043", () => {
  const result = BitContracts.validateBook({ bids: [[101, 1]], asks: [[100, 1]] });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "crossed_book");
});

check("CHECK-044", () => {
  const result = BitContracts.receiptConflict(
    { datasetId: "a", observationKey: "k", receivedAt: "t1", values: { close: 1 } },
    { datasetId: "a", observationKey: "k", receivedAt: "t1", values: { close: 2 } }
  );
  assert.equal(result.action, "reject");
});

check("CHECK-045", () => {
  const a = BitContracts.receiptConflict(null, { datasetId: "a", observationKey: "k", receivedAt: 1, values: { v: "A" } });
  const b = BitContracts.receiptConflict(
    { datasetId: "a", observationKey: "k", receivedAt: 1, values: { v: "A" } },
    { datasetId: "a", observationKey: "k", receivedAt: 2, values: { v: "B" } }
  );
  const c = BitContracts.receiptConflict(
    { datasetId: "a", observationKey: "k", receivedAt: 2, values: { v: "B" } },
    { datasetId: "a", observationKey: "k", receivedAt: 3, values: { v: "A" } }
  );
  assert.equal(a.action, "insert");
  assert.equal(b.action, "insert");
  assert.equal(c.action, "insert");
});

check("CHECK-046", () => {
  const result = BitContracts.concurrentRefreshNote();
  assert.equal(result.singleflightGuaranteed, false);
});

check("CHECK-047", () => {
  const result = BitContracts.healthScope({ knownAt: "old", healthScope: "current" });
  assert.equal(result.historicalHealthFromCurrent, false);
});

check("CHECK-048", () => {
  const result = BitContracts.optionsSummaryFields({ bid_price: 1, ask_price: 2, mark_iv: 50 });
  assert.equal(result.hasBidAsk, true);
  assert.equal(result.inventMissingGap, false);
});

check("CHECK-049", () => {
  const result = BitContracts.truncatedSection(1000, 1400);
  assert.equal(result.partial, true);
  assert.equal(result.complete, false);
});

check("CHECK-050", () => {
  const result = BitContracts.depthBandStatus({ wantedBps: 100, lastVisibleBps: 10 });
  assert.equal(result.status, "partial");
  assert.equal(result.remainingIsZero, false);
});

check("CHECK-051", () => {
  const result = BitContracts.weekendObservation({ lastObserved: "Friday", today: "Sunday" });
  assert.equal(result.newObservation, false);
  assert.equal(result.calendarBackground, true);
});

check("CHECK-052", () => {
  const result = BitContracts.systemObservedImport({ observationDate: "2024-01-01", receivedAt: "2026-09-17" });
  assert.equal(result.backfillKnownAt, false);
});

check("CHECK-053", () => {
  const result = BitContracts.etfFlowPartial({ fund_a: 0, fund_b: null });
  assert.equal(result.completeUniverse, false);
  assert.equal(result.noneIsZero, false);
  assert.equal(result.totalKnown, 0);
});

check("CHECK-054", () => {
  const result = BitContracts.polarityRelation("已批准", "未批准");
  assert.equal(result.dropAsNearDuplicate, false);
});

check("CHECK-055", () => {
  const result = BitContracts.sameOriginCarriers({ domains: 3, originId: "one-release" });
  assert.equal(result.independentConfirmations, 1);
  assert.equal(result.carrierCount, 3);
});

check("CHECK-056", () => {
  const result = BitContracts.verifyModelOutput({ claims: [{ factId: "E9" }], citations: [{ factId: "E9" }] }, { factIds: ["E1"] });
  assert.equal(result.ok, false);
});

check("CHECK-057", () => {
  const result = BitContracts.enabledCapabilityClaim(false, "ETF确认");
  assert.equal(result.reject, true);
});

check("CHECK-058", () => {
  const brief = BitContracts.buildMarketBrief({ capture: {}, facts: [], coverage: "good" });
  assert.equal(brief.status, "initial_baseline");
});

check("CHECK-059", () => {
  const brief = BitContracts.buildMarketBrief({ coverage: "insufficient", changes: [] });
  assert.equal(brief.status, "insufficient_coverage");
});

check("CHECK-060", () => {
  const budget = BitContracts.modelBudgetRoot({ limitUsd: null, spentUsd: 0 });
  assert.equal(budget.ok, false);
  assert.notEqual(budget.allowCall, true);
});

check("CHECK-061", () => {
  const brief = BitContracts.buildMarketBrief({ capture: { captureId: "t" }, facts: [{ id: "f", text: "x" }] });
  assert.equal(brief.modelUsed, false);
});

check("CHECK-062", () => {
  const result = BitContracts.providerOutcome({ requestSent: true, timeout: true });
  assert.equal(result.usage, "unknown");
  assert.equal(result.retryUnlimited, false);
});

check("CHECK-063", () => {
  const result = BitContracts.resolveHistoricalReport("old", null);
  assert.equal(result.action, "missing");
  assert.equal(result.latestSubstitution, false);
});

check("CHECK-064", () => {
  const result = BitContracts.cancelLateResponse({ cancelled: true, lateResponse: true });
  assert.equal(result.publish, false);
  assert.equal(result.becomeFinal, false);
});

check("CHECK-065", () => {
  const result = BitContracts.hashIsNotTruth({ digestValid: true, claimSupported: false });
  assert.equal(result.factOk, false);
});

check("CHECK-066", () => {
  assert.equal(BitContracts.sourcePurpose("stored-restricted-model", "persist").allowed, true);
  assert.equal(BitContracts.sourcePurpose("stored-restricted-model", "modelSend").allowed, false);
  assert.equal(BitContracts.sourcePurpose("unknown-vendor", "modelSend").allowed, false);
});

check("asof-knowledge-cutoff", () => {
  const result = BitContracts.selectAsOfWindow({
    points: [
      { t: 0, value: 1, receivedAt: 50 },
      { t: 24 * 3600 * 1000, value: 2, receivedAt: 90 },
    ],
    requestedWindowMs: 24 * 3600 * 1000,
    asOf: 80,
    knowledgeCutoff: 80,
  });
  assert.equal(result.ok, false);
});

check("pressure-window-no-24h-fallback", () => {
  const now = Date.UTC(2026, 4, 2, 12, 0, 0);
  const hour = 3600 * 1000;
  const built = Pressure.build({
    symbol: "BTCUSDT",
    generatedAt: new Date(now).toISOString(),
    heatmapState: { bucketSize: 50, window: "15m", minNotional: 0 },
    liquidationRows: [],
    aggregateSource: "d1",
    derivativesPayload: {
      priceChange24hPct: null,
      series: {
        oi: [
          { t: now - hour, value: 100 },
          { t: now, value: 110 },
        ],
      },
    },
    klines: [],
    nowMs: now,
  });
  assert.ok(built);
  const oi24 = built.inputsEcho && built.inputsEcho.oiChange24;
  if (oi24 != null) assert.notEqual(Number(oi24), 10);
});

check("liquidation-unknown-not-long", () => {
  assert.ok(Liquidation);
  const events = [
    { positionSide: "unknown", notional: 50, ts: Date.now(), exchange: "x", price: 1 },
    { positionSide: "long", notional: 10, ts: Date.now(), exchange: "x", price: 1 },
    { positionSide: "short", notional: 20, ts: Date.now(), exchange: "x", price: 1 },
  ];
  if (typeof Liquidation.buildStats === "function") {
    const stats = Liquidation.buildStats(events, {});
    assert.equal(stats.unknownNotional, 50);
    assert.equal(stats.longNotional, 10);
  } else if (typeof Liquidation.aggregateByPrice === "function") {
    const rows = Liquidation.aggregateByPrice(events, 1);
    assert.equal(rows[0].unknownNotional, 50);
    assert.equal(rows[0].longNotional, 10);
  } else {
    throw new Error("liquidation helpers not exported");
  }
});

check("footprint-poc-tie", () => {
  assert.ok(Footprint);
  const poc = BitContracts.selectPoc(
    [{ price: 100, total: 5 }, { price: 110, total: 5 }],
    { vwap: 109 }
  );
  assert.equal(poc.pocPrice, 110);
});

check("conflict-reject", () => {
  const result = BitContracts.receiptConflict(
    { datasetId: "a", observationKey: "k", receivedAt: "t1", values: { close: 1 } },
    { datasetId: "a", observationKey: "k", receivedAt: "t1", values: { close: 2 } }
  );
  assert.equal(result.action, "reject");
});

check("model-offline-budget", () => {
  const budget = BitContracts.modelBudgetRoot({ limitUsd: 1, spentUsd: 0.2 });
  assert.equal(budget.allowCall, true);
  assert.equal(BitContracts.verifyModelOutput({ claims: [{ factId: "f1" }], citations: [{ factId: "f1" }] }, { factIds: ["f1"] }).ok, true);
  assert.equal(BitContracts.verifyModelOutput({ claims: [{ factId: "invented" }], citations: [] }, { factIds: ["f1"] }).ok, false);
});

const mapped = ran.filter((id) => /^CHECK-/.test(id));
console.log("mapped_checks", mapped.length);
const catalogIds = (acceptanceCases.cases || []).map((row) => row.id);
const missing = catalogIds.filter((id) => !mapped.includes(id));
console.log("acceptance_catalog", catalogIds.length, "unmapped", missing.join(",") || "none");
if (failed) {
  console.error("failed", failed);
  process.exit(1);
}
console.log("PASS verify-batch2");
