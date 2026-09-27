// Deterministic regressions against the actual page functions; no server/network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
let passed = 0;
const pass = (message) => console.log(`PASS WB-REVIEW-${++passed} ${message}`);

function loadFunctions(context, file, names) {
  const source = read(file);
  for (const name of names) {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n}`));
    assert.ok(match, `${file}: actual ${name} function must exist`);
    vm.runInContext(match[0], context, { filename: `${file}:${name}`, timeout: 1000 });
  }
}

function evidenceContext(extra = {}) {
  const context = vm.createContext({
    console, Date, Map, Set, Math, AbortController,
    BitContracts: { exportPurposeGuard: () => ({ status: 'allowed', allowed: true }) },
    ...extra,
  });
  vm.runInContext(read('js/workbench-evidence.js') + '\nglobalThis.evidence = WorkbenchEvidence;', context, { timeout: 1000 });
  return context;
}

const bar = (t, c) => ({ t, o: c, h: c + 1, l: c - 1, c, v: 1, sourceVerification: 'verified', origin: 'canonical' });
const chart = evidenceContext({
  CHART_SYMBOL: 'BTCUSDT', currentInterval: '5m', chartOhlcv: [], chartDeskPayload: null,
  chartLatestDesk: null, chartCommittedIdentity: null, chartWindowGapCount: null,
  CHART_PRODUCT: {}, window: {}, lwChart: null, lastRenderedCount: 0,
  DataEngine: { getIntervalMs: () => 300000 },
  countReportedGaps: (gaps) => gaps.length, countSeriesGaps: () => 0,
  clampChartRightBlank() {}, applyIndicatorsFromOhlcv() {}, applyChartKeyLevelsFromOhlcv() {},
  applyChartPrimaryHeadline() {}, renderChartEvidence() {}, setChartStatusLine() {},
  rememberChartMeta() {}, setChartDeskHalt() {},
});
const displayed = [];
chart.candleSeries = { setData: (rows) => displayed.push(plain(rows)) };
loadFunctions(chart, 'js/pages/chart.js', [
  'getIntervalStepMs', 'deskRevision', 'responseStale', 'normalizeKlineRows',
  'mergeDeskRows', 'commitChartSeries', 'applyCommittedDesk', 'publishChartEvidence',
]);
const full = {
  asOf: '2026-09-27T00:00:00.000Z', inputRevision: 'full-v1', historyRevision: 1,
  pricePathAvailable: true, returnedRange: { from: 0, to: 600000 },
  coverage: { inWindowGaps: [] }, researchWindow: { status: 'partial' },
};
const tail = { ...full, asOf: '2026-09-27T00:05:00.000Z', inputRevision: 'tail-v2', historyRevision: 2,
  returnedRange: { from: 300000, to: 900000 }, coverageScope: 'tail', researchWindow: null };
chart.applyCommittedDesk({ desk: full, rows: [bar(0, 10), bar(300000, 20)] },
  { symbol: 'BTCUSDT', interval: '5m', mode: 'full' });
chart.applyCommittedDesk({ desk: tail, rows: [bar(300000, 21), bar(600000, 30)] },
  { symbol: 'BTCUSDT', interval: '5m', mode: 'tail' });
const exported = chart.evidence.capture().pages.chart;
assert.equal(exported.readAt, tail.asOf);
assert.equal(exported.contentRevision, 'tail-v2');
assert.equal(exported.historyRevision, 2);
assert.equal(exported.committedHistoryRevision, 1);
assert.deepEqual(plain(exported.window), { from: 0, to: 900000 });
assert.deepEqual(plain(exported.latestReadWindow), tail.returnedRange);
assert.deepEqual(plain(exported.coverageWindow), full.returnedRange);
assert.deepEqual(plain(exported.researchWindow), full.researchWindow);
assert.deepEqual(plain(exported.series).map((row) => row.c), displayed.at(-1).map((row) => row.close));
assert.ok(exported.series.every((row) => row.t >= exported.window.from && row.t < exported.window.to));
pass('tail export matches the rendered series and latest read, with separate full-window provenance');

const merged = chart.mergeDeskRows([bar(0, 1), bar(300000, 2), bar(600000, 3), bar(900000, 4)],
  [bar(300000, 22)], { from: 300000, to: 900000 });
assert.deepEqual(plain(merged).map((row) => [row.t, row.c]), [[0, 1], [300000, 22], [900000, 4]]);
assert.deepEqual(plain(chart.mergeDeskRows(merged, [], { from: 300000, to: 900000 })).map((row) => row.t), [0, 900000]);
pass('chart corrections delete missing trailing rows inside the replacement window, preserving newer tail');

const orderflow = evidenceContext({
  ORDERFLOW_SYMBOL: 'BTCUSDT', readOrderflowState: () => ({ interval: '15m' }),
  orderflowBars: [{ ...bar(0, 12), buyVol: 3, sellVol: 2, delta: 1, volume: 5 }],
  orderflowDeskEvidence: { asOf: full.asOf, inputRevision: 'of-1' },
  orderflowMeta: { authoritative: true },
});
loadFunctions(orderflow, 'js/pages/orderflow.js', ['publishOrderflowEvidence']);
orderflow.publishOrderflowEvidence();
const before = orderflow.evidence.capture().pages.orderflow;
orderflow.orderflowMeta = { authoritative: false, streamBroken: true, gap: { reason: 'stream_broken' } };
orderflow.publishOrderflowEvidence();
const broken = orderflow.evidence.capture().pages.orderflow;
assert.equal(broken.stale, true);
assert.equal(broken.authoritative, false);
assert.equal(broken.streamBroken, true);
assert.equal(broken.failure.message, 'stream_broken');
assert.ok(broken.failure.at);
assert.equal(broken.gaps[0].reason, 'stream_broken');
assert.deepEqual(plain(broken.bars), plain(before.bars));
assert.equal(broken.readAt, before.readAt);
orderflow.orderflowMeta = { authoritative: true, aggregationIncomplete: true };
orderflow.publishOrderflowEvidence();
const recovered = orderflow.evidence.capture().pages.orderflow;
assert.equal(recovered.stale, false);
assert.equal(recovered.failure, null);
assert.equal(recovered.gaps[0].reason, 'incomplete_aggregation');
pass('orderflow retained bars carry a stream failure and recover without masking aggregation gaps');

async function checkChartPoll() {
  chart.lwChart = {};
  chart.document = { hidden: false, getElementById: () => ({}) };
  chart.chartLoadGen = 1;
  chart.chartD1PollGen = 1;
  chart.chartD1PollInFlight = false;
  chart.CHART_D1_POLL_LIMIT = 20;
  chart.console = { warn() {} };
  loadFunctions(chart, 'js/pages/chart.js', ['chartPageStillCurrent', 'queueD1Poll']);
  const previous = plain(chart.evidence.capture().pages.chart);
  chart.readChartD1Klines = () => Promise.reject(new Error('fixture: tail unavailable'));
  chart.queueD1Poll();
  await new Promise(setImmediate);
  const failed = chart.evidence.capture().pages.chart;
  assert.equal(failed.stale, true);
  assert.equal(failed.failure.message, 'fixture: tail unavailable');
  assert.equal(failed.readAt, previous.readAt);
  assert.deepEqual(plain(failed.series), previous.series);
  assert.equal(chart.chartD1PollInFlight, false);
  pass('actual chart poll rejection marks retained export stale without inventing a new data read');

  chart.publishChartEvidence(null);
  let rejectOld;
  chart.readChartD1Klines = () => new Promise((_resolve, reject) => { rejectOld = reject; });
  chart.queueD1Poll();
  chart.chartLoadGen += 1;
  rejectOld(new Error('fixture: superseded request'));
  await new Promise(setImmediate);
  assert.equal(chart.evidence.capture().pages.chart.stale, false);
  assert.equal(chart.evidence.capture().pages.chart.failure, null);
  pass('superseded chart poll failure cannot mark the current export stale');
}

function mtfHarness() {
  const context = vm.createContext({
    console, Date, Math, Map, Set, URL, URLSearchParams, AbortController,
    window: { __bitDeskChartPricePathAvailable: true }, document: { hidden: false },
    localStorage: { getItem: () => null },
  });
  vm.runInContext(read('js/data-engine.js') + '\nglobalThis.engine = DataEngine;', context, { timeout: 1000 });
  vm.runInContext(read('js/chart/mtf-tiles.js'), context, { timeout: 1000 });
  const ctrl = Object.create(context.window.MtfTiles);
  ctrl._open = true;
  ctrl._tiles = [];
  ctrl._tfs = [];
  ctrl._createTileAt = ctrl._setTileHint = ctrl.syncTimeFromMain = () => {};
  ctrl._tileSignal = () => undefined;
  ctrl._tileEvidence = () => '';
  const addTile = () => {
    const tile = { loadGen: 0, fullReadAt: 0, rendered: [], series: {} };
    tile.series.setData = (rows) => { tile.rendered = plain(rows); };
    ctrl._tiles.push(tile);
    ctrl._tfs.push('1h');
    return tile;
  };
  return { ctrl, engine: context.engine, addTile };
}

async function checkMtf() {
  const { ctrl, engine, addTile } = mtfHarness();
  const a = addTile();
  const b = addTile();
  let phase = 'initial';
  const calls = [];
  engine.fetchDesk = async (_page, options) => {
    calls.push({ phase, ...options });
    const initial = phase === 'initial';
    return {
      pricePathAvailable: true, historyRevision: initial ? 1 : 2,
      series: initial ? [bar(0, 10), bar(3600000, 20), bar(7200000, 30)]
        : options.tail ? [bar(7200000, 31)] : [bar(0, 99), bar(7200000, 31)],
    };
  };
  await ctrl._loadTile(0);
  await ctrl._loadTile(1);
  // Main chart has already consumed v2: neither independent tile has.
  engine.confirmDeskHistory('BTCUSDT', '1h', 2);
  phase = 'corrected';
  await ctrl._loadTile(0);
  await ctrl._loadTile(1);
  assert.equal(a.confirmedHistoryRevision, 2);
  assert.equal(b.confirmedHistoryRevision, 2);
  assert.deepEqual(a.rendered.map((row) => row.close), [99, 31]);
  assert.deepEqual(b.rendered.map((row) => row.close), [99, 31]);
  assert.equal(calls.filter((call) => call.phase === 'corrected' && call.from != null).length, 2);
  const beforeCount = calls.length;
  await ctrl._loadTile(0);
  assert.equal(calls.length, beforeCount + 1);
  assert.equal(calls.at(-1).tail, 20);
  pass('each same-interval tile rereads its own revision exactly once, deleting removed historical bars');

  const retained = plain(a.rendered);
  engine.fetchDesk = async () => ({ pricePathAvailable: true, historyRevision: 1, series: [bar(7200000, 5)] });
  await ctrl._loadTile(0);
  assert.deepEqual(a.rendered, retained);
  assert.equal(a.confirmedHistoryRevision, 2);
  pass('older response cannot regress the tile version or displayed values');

  let retryCalls = 0;
  engine.fetchDesk = async (_page, options) => {
    retryCalls += 1;
    return { pricePathAvailable: true, historyRevision: options.tail ? 3 : 2, series: [bar(7200000, 32)] };
  };
  await ctrl._loadTile(0);
  assert.equal(a.confirmedHistoryRevision, 2);
  assert.deepEqual(a.rendered, retained);
  await ctrl._loadTile(0);
  assert.equal(retryCalls, 4);
  pass('lagging bounded reread does not confirm a revision and is retried by the next existing poll');

  let finish;
  engine.fetchDesk = () => new Promise((resolve) => { finish = resolve; });
  const oldRequest = ctrl._loadTile(0);
  a.loadGen += 1;
  a.rendered = [{ close: 777 }];
  finish({ pricePathAvailable: true, historyRevision: 9, series: [bar(0, 999)] });
  await oldRequest;
  assert.deepEqual(a.rendered, [{ close: 777 }]);
  assert.equal(a.confirmedHistoryRevision, 2);
  pass('superseded tile request cannot commit data or confirm history');
}

checkChartPoll().then(checkMtf).then(() => console.log(`PASS ${passed} workbench review regressions`)).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
