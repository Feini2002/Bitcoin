const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'js/workbench-evidence.js'), 'utf8');
let passed = 0;
const pass = (message) => console.log(`PASS WB-EVIDENCE-${++passed} ${message}`);

function load(guard) {
  const context = vm.createContext({
    BitContracts: { exportPurposeGuard: guard },
    console,
  });
  vm.runInContext(source + '\nglobalThis.evidence = WorkbenchEvidence;', context);
  context.evidence.reset();
  return context.evidence;
}

const allow = () => ({ status: 'allowed', allowed: true });
const deny = () => ({ status: 'unknown', allowed: false, reason: 'unregistered_purpose' });

const chartView = {
  sourceId: 'binance-usdm-klines',
  displayedAt: '2026-09-27T00:00:00.000Z',
  readAt: '2026-09-27T00:00:01.000Z',
  asOf: '2026-09-27T00:00:01.000Z',
  parameters: { symbol: 'BTCUSDT', interval: '15m' },
  contentRevision: 'abc',
  historyRevision: 2,
  sourceVerification: 'verified',
  window: { from: 1, to: 2 },
  gaps: [],
  units: { price: 'USDT/BTC' },
  series: [{ t: 1, o: 10, h: 12, l: 9, c: 11, sourceVerification: 'verified', closed: true }],
  tradingNarrative: true,
};

const allowed = load(allow);
const committed = allowed.commitDisplayed('chart', chartView);
assert.equal(committed.series[0].c, 11);
assert.equal(committed.tradingNarrative, undefined);
assert.ok(committed.withheldFields.includes('tradingNarrative'));
const frozen = allowed.capture('2026-09-27T00:00:02.000Z');
allowed.commitDisplayed('chart', { ...chartView, series: [{ t: 1, c: 99 }], contentRevision: 'later' });
assert.equal(frozen.pages.chart.series[0].c, 11);
assert.equal(frozen.pages.chart.contentRevision, 'abc');
assert.equal(frozen.atomicSnapshot, false);
assert.equal(allowed.serialize(frozen), allowed.serialize(JSON.parse(allowed.serialize(frozen))));
assert.equal(frozen.pages.orderflow.access, 'not_visited');
assert.equal(frozen.pages.heatmap.access, 'not_visited');
assert.equal(frozen.pages.derivatives.access, 'not_visited');
pass('WB-13 frozen displayed values stay stable and omit trading conclusions');

// Source clocks may run ahead of the browser clock; preserve, rather than sort or rewrite, them.
const crossClock = allowed.capture('2026-09-27T00:00:00.500Z');
assert.equal(crossClock.generatedAt, '2026-09-27T00:00:00.500Z');
assert.equal(crossClock.pages.chart.asOf, chartView.asOf);
assert.equal(crossClock.pages.chart.readAt, chartView.readAt);
assert.match(crossClock.captureNote, /未核验同步/);
assert.match(crossClock.captureNote, /浏览器本机/);
pass('clock domains are explicit and original source timestamps remain unchanged');

const long = load(allow);
const series = Array.from({ length: 6001 }, (_, i) => ({ t: i, c: i }));
const capped = long.commitDisplayed('chart', { ...chartView, series });
assert.equal(capped.series.length, 6000);
assert.equal(capped.series[0].t, 1);
assert.equal(capped.truncatedToLimit, 6000);
pass('WB-13 chart evidence keeps at most 6000 bars');

const restricted = load(deny);
const hidden = restricted.commitDisplayed('chart', chartView);
assert.equal(hidden.series, undefined);
assert.ok(hidden.withheldFields.includes('series'));
assert.match(hidden.limitation, /未获用户本地下载授权/);
assert.equal(hidden.window.from, 1);
assert.equal(hidden.units.price, 'USDT/BTC');
assert.equal(hidden.gaps.length, 0);
pass('WB-14 unknown export purpose keeps metadata and withholds values');

const failed = load(allow);
failed.commitFailure('derivatives', { at: '2026-09-27T00:00:03.000Z', message: 'desk 503' });
let snap = failed.capture('2026-09-27T00:00:04.000Z');
assert.equal(snap.pages.derivatives.access, 'unavailable');
assert.equal(snap.pages.derivatives.failure.message, 'desk 503');
failed.commitDisplayed('derivatives', {
  sourceId: 'binance-usdm-premium',
  displayedAt: '2026-09-27T00:00:05.000Z',
  readAt: '2026-09-27T00:00:05.000Z',
  cards: [{ id: 'premium', value: 100000, unit: 'USDT/BTC' }],
});
failed.commitFailure('derivatives', { at: '2026-09-27T00:00:06.000Z', message: 'later failure' });
snap = failed.capture('2026-09-27T00:00:07.000Z');
assert.equal(snap.pages.derivatives.access, 'displayed');
assert.equal(snap.pages.derivatives.stale, true);
assert.equal(snap.pages.derivatives.cards[0].value, 100000);
assert.equal(snap.pages.derivatives.failure.at, '2026-09-27T00:00:06.000Z');
assert.equal(snap.pages.chart.access, 'not_visited');
pass('WB-14 failure without a view stays unavailable; later failure keeps the previous values');

const mixed = load(allow);
const mixedView = mixed.commitDisplayed('chart', {
  ...chartView,
  series: [
    { t: 1, o: 10, h: 12, l: 9, c: 11, sourceVerification: 'verified' },
    { t: 2, o: 20, h: 22, l: 19, c: 21, sourceVerification: 'unverified', origin: 'raw-tape' },
  ],
});
assert.equal(mixedView.series[0].c, 11);
assert.equal(mixedView.series[1].c, undefined);
assert.equal(mixedView.series[1].withheld, true);
assert.equal(mixedView.series[1].t, 2);
pass('WB-14 unverified bars keep the open time and withhold OHLC');

assert.throws(() => load(allow).commitDisplayed('news', {}), /unknown_evidence_slot/);
pass('unknown page slots are rejected');

console.log(`Workbench evidence: ${passed} PASS`);
