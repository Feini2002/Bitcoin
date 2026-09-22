const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

(async () => {
  const { klineAuthority, buildChartDesk, buildContextDesk, buildHeatmapDesk, DESK_SCHEMA_VERSION } =
    await import(pathToFileURL(path.join(root, 'cloudflare/finance/desk.mjs')));
  const now = Date.parse('2026-09-21T02:00:00.000Z');
  const stale = {
    ok: true,
    id: 'binance-perp-klines-15m',
    observations: [{
      observedAt: '2026-09-16T08:00:00.000Z',
      receivedAt: '2026-09-16T08:02:00.000Z',
      storedAt: '2026-09-16T08:02:00.000Z',
      sourceHost: 'fapi.binance.com',
      ingestionMode: 'local-bootstrap',
      publicAvailableAt: null,
      values: { open: 1, high: 2, low: 0, close: 1, baseVolume: 1, quoteVolume: 1, trades: 1, closed: true, windowEnded: true, finality: 'time_elapsed_only', closureBasis: 'request-after-scheduled-close; no exchange confirmation flag' },
    }],
    collectionStale: true,
    sourceStale: true,
    coverage: { available: 1, returned: 1, truncated: false },
  };
  const auth = klineAuthority(stale, { now, interval: '15m' });
  assert.equal(auth.ok, false);
  assert.equal(auth.reason, 'stale_bootstrap');
  const chart = buildChartDesk(stale, '15m', now);
  assert.equal(chart.schemaVersion, DESK_SCHEMA_VERSION);
  assert.equal(chart.pricePathAvailable, false);
  assert.equal(chart.tradingNarrative, false);
  assert.equal(chart.series.length, 0);
  assert.equal(chart.asKnownMode, 'system_observed');
  assert.ok(chart.gap && chart.gap.reason === 'stale_bootstrap');
  const live = JSON.parse(JSON.stringify(stale));
  live.observations[0].observedAt = '2026-09-21T01:59:00.000Z';
  live.observations[0].ingestionMode = 'cloud-readthrough';
  live.collectionStale = false;
  live.sourceStale = false;
  const liveDesk = buildChartDesk(live, '15m', now);
  assert.equal(liveDesk.pricePathAvailable, true);
  assert.equal(liveDesk.venue, 'binance-usdm');
  assert.equal(liveDesk.closed, true);
  assert.notEqual(liveDesk.windowEnded, undefined);
  const ctx = buildContextDesk({
    'fred-dollar': { ok: true, observations: [{ observedAt: '2026-09-18', values: { value: 120 }, publicAvailableAt: null, receivedAt: '2026-09-21T01:56:00Z', sourceHost: 'fred.stlouisfed.org', sourceRevision: { realtimeStart: '2026-09-21', realtimeEnd: '2026-09-21' } }], collectionStale: false, fields: { value: 'index-Jan2006=100' } },
  }, now);
  assert.equal(ctx.contract.unavailable, true);
  assert.equal(ctx.groups.weeklyDollarH41.residualForbidden, true);
  assert.match(ctx.groups.weeklyDollarH41.cards[0].label, /广义贸易加权美元/);
  assert.ok(!JSON.stringify(ctx).includes('DXY'));
  const heat = buildHeatmapDesk([
    { exchange: 'bybit', bucket_start: now, long_notional: 10, short_notional: 2, long_count: 1, short_count: 1 },
    { exchange: 'binance', bucket_start: now, long_notional: 3, short_notional: 4, long_count: 1, short_count: 1 },
  ], now);
  assert.equal(heat.combinedTotalsForbidden, true);
  assert.ok(heat.byExchange.bybit && heat.byExchange.binance);
  assert.equal(heat.byExchange.bybit.longNotional, 10);
  assert.ok(!JSON.stringify(ctx).includes('DXY'));
  assert.ok(!JSON.stringify(chart).includes('拥挤'));
  const pages = ['js/pages/chart.js', 'js/pages/orderflow.js', 'js/pages/heatmap.js', 'js/pages/derivatives.js'];
  const extra = ['js/orderflow/footprint-engine.js', 'cloudflare/yuqing/yuqing-worker.js'];
  const forbidden = ['拥挤', '占优', '挤压', '清算池', '主链路达标', 'DXY'];
  for (const file of pages.concat(extra)) {
    const text = require('fs').readFileSync(path.join(root, file), 'utf8');
    for (const word of forbidden) {
      if (file.endsWith('yuqing-worker.js') && word === 'DXY') continue;
      assert.ok(!text.includes(word), `${file} still contains ${word}`);
    }
  }
  const heatmap = require('fs').readFileSync(path.join(root, 'js/pages/heatmap.js'), 'utf8');
  assert.ok(!heatmap.includes('实时流'), 'heatmap still advertises live stream fallback');
  assert.ok(!heatmap.includes('fetchKlinesFromD1'), 'heatmap still reads P5 klines for pressure');
  assert.ok(!heatmap.includes('hm-cloud-1h-total'), 'heatmap still has combined 1h total card');
  const yuqing = require('fs').readFileSync(path.join(root, 'cloudflare/yuqing/yuqing-worker.js'), 'utf8');
  assert.ok(!yuqing.includes('/api/ai/derivatives-snapshot'), 'yuqing still fetches legacy derivatives snapshot');
  assert.ok(!yuqing.includes('totalLongNotional'), 'yuqing still emits combined liquidation totals');
  const worker = require('fs').readFileSync(path.join(root, 'cloudflare/binance-klines-worker.js'), 'utf8');
  assert.match(worker, /legacy analysis snapshot/);
  console.log('PASS desk assembly identity, stale bootstrap, split liquidations, macro labels, adversarial harden');
})().catch((error) => { console.error(error); process.exitCode = 1; });
