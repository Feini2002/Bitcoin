const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

(async () => {
  const { klineAuthority, buildChartDesk, buildContextDesk, buildHeatmapDesk, finishChartDesk, DESK_SCHEMA_VERSION, binanceHostOk, handleDesk } =
    await import(pathToFileURL(path.join(root, 'cloudflare/finance/desk.mjs')));
  const oldThree=Date.parse('2023-08-08T00:00:00Z');
  const oldThreeBars=[0,1,2].map(i=>({t:oldThree+i*259200000,o:100,h:110,l:90,c:105,v:1}));
  assert.equal(finishChartDesk({interval:'3d',series:oldThreeBars}).coverage.inWindowGaps.length,0);
  assert.equal(finishChartDesk({interval:'3d',series:[oldThreeBars[0],oldThreeBars[2]]}).coverage.inWindowGaps.length,1);
  console.log('PASS native historical 3d anchor stays continuous while a real missing bar remains a gap');
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
  const contextNow=Date.parse('2026-09-26T14:03:03.000Z');
  const makeContract=(id,observedAt,values,extra={})=>({ok:true,id,collectionStale:false,sourceStale:null,
    state:{last_success_received_at:new Date(contextNow).toISOString()},
    observations:[{observedAt,receivedAt:new Date(contextNow).toISOString(),sourceHost:'fapi.binance.com',ingestionMode:'cloud-readthrough',values}],...extra});
  const contractFixtures={
    'binance-perp-premium':makeContract('binance-perp-premium',new Date(contextNow).toISOString(),{markPrice:100000,lastFundingRate:0.0001,nextFundingTime:'2026-09-26T16:00:00.000Z'}),
    'binance-perp-funding':makeContract('binance-perp-funding','2026-09-26T08:00:00.001Z',{fundingRate:0.0001,markPrice:99900}),
    'binance-perp-funding-info':makeContract('binance-perp-funding-info',null,{adjustmentReported:true,record:{symbol:'BTCUSDT',fundingIntervalHours:8}}),
    'binance-perp-basis':makeContract('binance-perp-basis','2026-09-26T12:00:00.000Z',{basis:10,basisRate:0.0001,annualizedBasisRate:null}),
  };
  let contractDesk=buildContextDesk(contractFixtures,contextNow);
  assert.equal(contractDesk.contract.unavailable,false);
  assert.equal(contractDesk.contract.funding.sourceStale,false);
  assert.equal(contractDesk.contract.funding.referencePeriod,'2026-09-26T08:00:00.001Z');
  assert.equal(contractDesk.contract.funding.fundingIntervalHours,8);
  assert.equal(contractDesk.contract.funding.intervalBasis,'exchange-funding-info');
  assert.equal(contractDesk.contract.premium.values.markPrice,100000);
  assert.equal(contractDesk.contract.basis.sourceStale,false);
  // The interval comes from the reported record. An explicit 4h schedule must
  // flag the missing 12:00 settlement instead of silently assuming 8h.
  const fourHour=structuredClone(contractFixtures);
  fourHour['binance-perp-funding-info'].observations[0].values.record.fundingIntervalHours=4;
  contractDesk=buildContextDesk(fourHour,contextNow);
  assert.equal(contractDesk.contract.unavailable,false);
  assert.equal(contractDesk.contract.partial,true);
  assert.equal(contractDesk.contract.funding.sourceStale,true);
  assert.equal(contractDesk.contract.funding.reason,'latest_scheduled_settlement_missing');
  assert.equal(contractDesk.contract.premium.unavailable,false);
  assert.equal(contractDesk.contract.basis.unavailable,false);
  const oldCollection=structuredClone(contractFixtures);
  oldCollection['binance-perp-funding'].state.last_success_received_at='2026-09-26T13:39:05.811Z';
  oldCollection['binance-perp-funding'].observations[0].receivedAt='2026-09-26T13:39:05.811Z';
  contractDesk=buildContextDesk(oldCollection,contextNow);
  assert.equal(contractDesk.contract.unavailable,false);
  assert.equal(contractDesk.contract.funding.collectionStale,true);
  assert.equal(contractDesk.contract.funding.sourceStale,false);
  assert.equal(contractDesk.contract.funding.unavailable,false);
  assert.equal(contractDesk.contract.funding.receivedAt,'2026-09-26T13:39:05.811Z');
  // Availability is retained evidence, not a guarantee that a 5s target always
  // becomes visible within 5s. Preserve every clock without relaxing thresholds.
  for(const visibleDelay of [6090,11540]) {
    const delayed=structuredClone(oldCollection);
    delayed['binance-perp-premium'].state.last_success_received_at=new Date(contextNow-visibleDelay).toISOString();
    delayed['binance-perp-premium'].observations[0].observedAt=new Date(contextNow-visibleDelay).toISOString();
    // Summary's 5s collection flag must not override the desk's existing 10s
    // availability clock; this mirrors the real summary rather than a bare mock.
    delayed['binance-perp-premium'].collectionStale=true;
    delayed['binance-perp-premium'].sourceStale=visibleDelay>10000;
    delayed['binance-perp-basis'].state.last_success_received_at='2026-09-26T13:39:05.811Z';
    contractDesk=buildContextDesk(delayed,contextNow);
    assert.equal(contractDesk.contract.unavailable,false);
    assert.equal(contractDesk.contract.partial,true);
    assert.equal(contractDesk.quality.status,'warn');
    assert.equal(contractDesk.contract.premium.unavailable,false);
    assert.equal(contractDesk.contract.premium.collectionStale, visibleDelay>10000);
    assert.equal(contractDesk.contract.premium.sourceStale, visibleDelay>10000);
    for(const key of ['funding','basis']) {
      assert.equal(contractDesk.contract[key].unavailable,false);
      assert.equal(contractDesk.contract[key].collectionStale,true);
    }
    assert.equal(contractDesk.contract.funding.values.fundingRate,0.0001);
    assert.equal(contractDesk.contract.basis.values.basis,10);
  }
  const unknownSchedule=structuredClone(contractFixtures);delete unknownSchedule['binance-perp-funding-info'];
  contractDesk=buildContextDesk(unknownSchedule,contextNow);
  assert.equal(contractDesk.contract.funding.fundingIntervalHours,null);
  assert.equal(contractDesk.contract.funding.sourceStale,null);
  assert.equal(contractDesk.quality.status,'warn');
  unknownSchedule['binance-perp-funding'].observations.push({...unknownSchedule['binance-perp-funding'].observations[0],observedAt:'2026-09-26T00:00:00.001Z'});
  contractDesk=buildContextDesk(unknownSchedule,contextNow);
  assert.match(contractDesk.contract.funding.intervalBasis,/observed-settlement-spacing/);
  assert.equal(contractDesk.contract.funding.sourceStale,false);
  const stalePremium=structuredClone(contractFixtures);stalePremium['binance-perp-premium'].observations[0].observedAt='2026-09-26T14:00:00.000Z';
  contractDesk=buildContextDesk(stalePremium,contextNow);
  assert.equal(contractDesk.contract.unavailable,false);assert.equal(contractDesk.contract.premium.sourceStale,true);
  const bootstrapFunding=structuredClone(contractFixtures);bootstrapFunding['binance-perp-funding'].observations[0].ingestionMode='local-bootstrap';
  contractDesk=buildContextDesk(bootstrapFunding,contextNow);
  assert.equal(contractDesk.contract.funding.unavailable,true);assert.deepEqual(contractDesk.contract.funding.values,{});
  const settlementDue=structuredClone(contractFixtures),afterDue=Date.parse('2026-09-26T16:00:05.000Z');
  for(const ds of Object.values(settlementDue))ds.state.last_success_received_at=new Date(afterDue).toISOString();
  settlementDue['binance-perp-premium'].observations[0].observedAt=new Date(afterDue).toISOString();
  settlementDue['binance-perp-premium'].observations[0].values.nextFundingTime='2026-09-27T00:00:00.000Z';
  settlementDue['binance-perp-basis'].observations[0].observedAt='2026-09-26T15:00:00.000Z';
  contractDesk=buildContextDesk(settlementDue,afterDue);
  assert.equal(contractDesk.contract.funding.sourceStale,true);assert.equal(contractDesk.contract.unavailable,false);
  settlementDue['binance-perp-funding'].observations[0].observedAt='2026-09-26T16:00:00.001Z';
  assert.equal(buildContextDesk(settlementDue,afterDue).contract.funding.sourceStale,false);
  console.log('PASS context funding event clock, reported and unknown intervals, missed settlement, per-card staleness, stale receipt, and partial availability');
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

  assert.equal(binanceHostOk('fapi.binance.com'), true);
  assert.equal(binanceHostOk('fstream.binance.com'), true);
  assert.equal(binanceHostOk('data-api.binance.vision'), true);
  assert.equal(binanceHostOk('api.binance.com'), true);
  assert.equal(binanceHostOk('binance.com.evil'), false);
  assert.equal(binanceHostOk('notbinance.com'), false);
  assert.equal(binanceHostOk('fapi.binance.com.evil'), false);
  const fs = require('fs');
  const { DatabaseSync } = require('node:sqlite');
  const { klineOpenAt } = await import(pathToFileURL(path.join(root, 'cloudflare/kline-recovery.mjs')));
  const { persistDataset, readDataset, readDatasetSummary, observationKeyWalkSql } = await import(pathToFileURL(path.join(root, 'cloudflare/finance/dataset-store.mjs')));
  const { rawKlineHistoryStatements } = await import(pathToFileURL(path.join(root, 'cloudflare/finance/dataset-store.mjs')));
  function openDb() {
    const sqlite = new DatabaseSync(':memory:');
    for (const file of ['cloudflare/schema.sql', 'cloudflare/finance/dataset-schema.sql', 'cloudflare/finance/desk-history-migration.sql']) {
      sqlite.exec(fs.readFileSync(path.join(root, file), 'utf8'));
    }
    return { sqlite, prepare(sql) { return { sql, values: [], bind(...values) { this.values = values; return this; },
      async all() { return { results: sqlite.prepare(sql).all(...this.values) }; },
      async first() { return sqlite.prepare(sql).get(...this.values) || null; },
      async run() { const ran = sqlite.prepare(sql).run(...this.values); return { meta: { changes: Number(ran.changes) } }; } }; },
      async batch(statements) { sqlite.exec('BEGIN'); try { const results = statements.map((s) => ({ results: sqlite.prepare(s.sql).all(...s.values) })); sqlite.exec('COMMIT'); return results; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } } };
  }
  const RealDate = Date;
  let clock = Date.parse('2026-09-27T12:00:10.000Z');
  globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } static parse(v) { return RealDate.parse(v); } static UTC(...args) { return RealDate.UTC(...args); } };
  const step = 300000;
  const head = klineOpenAt('5m', clock);
  const desk = openDb();
  const putBar = (open, close, host, mode) => {
    const observed = new Date(open).toISOString();
    const received = new Date(open + 120000).toISOString();
    desk.sqlite.prepare(`INSERT INTO finance_dataset_observations
      (dataset_id,observation_key,observed_at,time_precision,received_at,stored_at,source_host,ingestion_mode,value_json)
      VALUES (?,?,?,?,?,?,?,?,?)`).run('binance-perp-klines-5m', String(open), observed, 'millisecond', received, received, host, mode,
      JSON.stringify({ open: close, high: close + 1, low: close - 1, close, baseVolume: 1, quoteVolume: 2, trades: 3, takerBuyBase: 0.2, takerBuyQuote: 1, closed: true, windowEnded: true, finality: 'exchange_closed', closureBasis: 'exchange-websocket-close-flag' }));
    desk.sqlite.prepare('INSERT INTO klines(symbol,interval,t,o,h,l,c,v) VALUES (?,?,?,?,?,?,?,?)').run('BTCUSDT', '5m', open, close, close + 1, close - 1, close + 500, 1);
  };
  for (let i = 30; i >= 1; i--) putBar(head - i * step, 100 + i, 'fapi.binance.com', 'cloud-readthrough');
  desk.sqlite.prepare(`UPDATE finance_dataset_observations SET source_host=? WHERE observation_key=?`).run('binance.com.evil', String(head - 8 * step));
  desk.sqlite.prepare(`UPDATE finance_dataset_observations SET source_host=? WHERE observation_key=?`).run('notbinance.com', String(head - 7 * step));
  desk.sqlite.prepare('INSERT INTO klines(symbol,interval,t,o,h,l,c,v) VALUES (?,?,?,?,?,?,?,?)').run('BTCUSDT', '5m', head, 110, 112, 109, 111, 4);
  desk.sqlite.prepare('INSERT INTO sync_status(symbol,interval,last_run,last_t,last_count,last_ok,last_error) VALUES (?,?,?,?,?,?,?)').run('BTCUSDT', '5m', clock - 1000, head, 1, 1, null);
  const readDesk = async (query) => {
    let batches = 0;
    const atomicDb = {
      prepare(sql) {
        const statement = desk.prepare(sql);
        statement.all = statement.first = statement.run = async () => { throw new Error('chart evidence read outside atomic batch'); };
        return statement;
      },
      async batch(statements) { batches++; return desk.batch(statements); },
    };
    const response = await handleDesk(new Request('http://desk.local/api/desk/chart?' + query), { DB: atomicDb });
    if (response.ok) assert.equal(batches, 1, 'revision, raw/canonical rows, predecessors and status share one transaction');
    return response;
  };
  const tail = await (await readDesk('interval=5m&tail=20')).json();
  assert.equal(tail.schemaVersion, '2026-09-27.1');
  assert.equal(tail.stateScope, 'current');
  assert.equal(tail.coverageScope, 'tail');
  assert.equal(tail.coverage.available, null);
  assert.equal(tail.coverage.returned, 20);
  assert.notEqual(tail.coverage.available, 20);
  assert.equal(tail.pricePathAvailable, true);
  assert.equal(tail.series.at(-1).c, 111);
  assert.equal(tail.series.at(-1).origin, 'raw-tape');
  assert.equal(tail.series.at(-1).sourceVerification, 'unverified');
  assert.equal(tail.series.at(-1).receivedAt, null);
  assert.equal(tail.series.at(-1).effectiveReceivedAt, null);
  assert.equal(tail.series.at(-1).sourceHost, null);
  assert.equal(tail.series.at(-1).closed, null);
  assert.equal(tail.researchWindow.reason, 'tail_sample');
  assert.equal(tail.researchWindow.eligible, false);
  assert.equal(tail.quality.status, 'warn');
  assert.equal(tail.returnedRange.to, tail.series.at(-1).t + step);
  const conflict = tail.series.find((bar) => bar.t === head - 15 * step);
  assert.equal(conflict.c, 115);
  assert.equal(conflict.origin, 'canonical');
  assert.notEqual(conflict.effectiveReceivedAt, conflict.observedAt);
  assert.equal(Date.parse(conflict.effectiveReceivedAt), head - 15 * step + 120000);
  const wide = await (await readDesk('interval=5m&from=' + (head - 30 * step) + '&to=' + (head + step))).json();
  assert.equal(wide.requestWindow.readIntent, 'window');
  assert.equal(wide.series.find((bar) => bar.t === head - 8 * step).sourceVerification, 'unverified');
  assert.equal(wide.series.find((bar) => bar.t === head - 7 * step).sourceVerification, 'unverified');
  assert.equal(wide.series.find((bar) => bar.t === head - 10 * step).sourceVerification, 'verified');
  assert.ok(!JSON.stringify(wide.series).includes(new Date(clock).toISOString()));
  assert.equal(wide.pricePathAvailable, true);
  assert.equal(wide.stateScope, 'current');
  console.log('PASS WB-01 fresh tail stays visible, conflicting raw values and lookalike hosts stay unverified');

  const gapDb = openDb();
  const putVerified = (database, open, close = 50) => database.sqlite.prepare(`INSERT INTO finance_dataset_observations
    (dataset_id,observation_key,observed_at,time_precision,received_at,stored_at,source_host,ingestion_mode,value_json)
    VALUES (?,?,?,?,?,?,?,?,?)`).run('binance-perp-klines-5m', String(open), new Date(open).toISOString(), 'millisecond', new Date(open + 1000).toISOString(), new Date(open + 1000).toISOString(), 'fapi.binance.com', 'cloud-readthrough',
    JSON.stringify({ open: close, high: close + 1, low: close - 1, close, baseVolume: 1, quoteVolume: 1, trades: 1, takerBuyBase: 0, takerBuyQuote: 0, closed: true, windowEnded: true, finality: 'exchange_closed', closureBasis: 'exchange-websocket-close-flag' }));
  for (let i = 0; i < 500; i++) if (i !== 250) putVerified(gapDb, head - (499 - i) * step, 40);
  gapDb.sqlite.prepare('INSERT INTO klines(symbol,interval,t,o,h,l,c,v) VALUES (?,?,?,?,?,?,?,?)').run('BTCUSDT', '5m', head, 1, 2, 0, 70, 1);
  gapDb.sqlite.prepare('INSERT INTO sync_status(symbol,interval,last_run,last_t,last_count,last_ok) VALUES (?,?,?,?,?,1)').run('BTCUSDT', '5m', clock - 500, head, 1);
  const gapped = await (await handleDesk(new Request('http://desk.local/api/desk/chart?interval=5m&from=' + (head - 499 * step) + '&to=' + (head + step)), { DB: gapDb })).json();
  assert.ok(gapped.coverage.inWindowGaps.length >= 1);
  assert.equal(gapped.researchWindow.eligible, false);
  assert.equal(gapped.researchWindow.reason, 'in_window_gap');
  assert.equal(gapped.pricePathAvailable, true);
  assert.equal(gapped.quality.status, 'warn');
  const solid = openDb();
  for (let i = 0; i < 500; i++) putVerified(solid, head - (499 - i) * step, 41);
  solid.sqlite.prepare('INSERT INTO klines(symbol,interval,t,o,h,l,c,v) VALUES (?,?,?,?,?,?,?,?)').run('BTCUSDT', '5m', head, 1, 2, 0, 71, 1);
  solid.sqlite.prepare('INSERT INTO sync_status(symbol,interval,last_run,last_t,last_count,last_ok) VALUES (?,?,?,?,?,1)').run('BTCUSDT', '5m', clock - 500, head, 1);
  const continuous = await (await handleDesk(new Request('http://desk.local/api/desk/chart?interval=5m&from=' + (head - 499 * step) + '&to=' + (head + step)), { DB: solid })).json();
  assert.equal(continuous.coverage.inWindowGaps.length, 0);
  assert.equal(continuous.researchWindow.reason, 'verified_history_insufficient');
  assert.equal(continuous.researchWindow.eligible, false);
  const outside = openDb();
  putVerified(outside, head, 80);
  outside.sqlite.prepare(`INSERT INTO finance_dataset_state(dataset_id,attempted_at,last_http_status,last_error,last_success_received_at) VALUES (?,?,200,?,?)`)
    .run('binance-perp-klines-5m', new Date(clock).toISOString(), 'dataset_history_gap_pending:' + JSON.stringify({ from: head - 80 * step, to: head - 40 * step, step }), new Date(clock).toISOString());
  const outsideBody = await (await handleDesk(new Request('http://desk.local/api/desk/chart?interval=5m&tail=20'), { DB: outside })).json();
  assert.equal(outsideBody.coverage.unresolvedGap.from, new Date(head - 80 * step).toISOString());
  assert.equal(outsideBody.pricePathAvailable, true);
  assert.equal(outsideBody.coverage.boundaryGap, null);
  const three = openDb();
  const d3 = 259200000;
  const d3Head = klineOpenAt('3d', clock);
  for (const open of [d3Head - 4 * d3, d3Head - 2 * d3, d3Head]) {
    three.sqlite.prepare('INSERT INTO klines(symbol,interval,t,o,h,l,c,v) VALUES (?,?,?,?,?,?,?,?)').run('BTCUSDT', '3d', open, 1, 2, 0, 3, 1);
  }
  const threeBody = await (await handleDesk(new Request('http://desk.local/api/desk/chart?interval=3d&from=' + (d3Head - 4 * d3) + '&to=' + (d3Head + d3)), { DB: three })).json();
  assert.ok(threeBody.series.length >= 2);
  assert.ok(threeBody.series.every((bar) => bar.origin === 'raw-tape' && bar.sourceVerification === 'unverified'));
  assert.ok(threeBody.coverage.inWindowGaps.length >= 1);
  const week = openDb();
  const monday = klineOpenAt('1w', clock);
  const weekStep = 604800000;
  for (const open of [monday - 2 * weekStep, monday]) {
    week.sqlite.prepare('INSERT INTO klines(symbol,interval,t,o,h,l,c,v) VALUES (?,?,?,?,?,?,?,?)').run('BTCUSDT', '1w', open, 1, 2, 0, 3, 1);
  }
  const weekBody = await (await handleDesk(new Request('http://desk.local/api/desk/chart?interval=1w&from=' + (monday - 2 * weekStep) + '&to=' + (monday + weekStep)), { DB: week })).json();
  assert.equal(weekBody.coverage.inWindowGaps.length, 1);
  const short = openDb();
  for (let i = 0; i < 600; i++) putVerified(short, head - (599 - i) * step, 60);
  const shortBody = await (await handleDesk(new Request('http://desk.local/api/desk/chart?interval=5m&from=' + (head - 599 * step) + '&to=' + (head + step)), { DB: short })).json();
  assert.equal(shortBody.researchWindow.needed, 864);
  assert.equal(shortBody.researchWindow.continuousVerifiedClosed, 600);
  assert.equal(shortBody.researchWindow.eligible, false);
  assert.equal(shortBody.researchWindow.reason, 'verified_history_insufficient');
  assert.equal(shortBody.quality.status, 'warn');
  console.log('PASS WB-02 interior gap, continuous control, outside gap, 3d, 1w and 600/864 boundary');

  assert.equal((await readDesk('interval=5m&symbol=ETHUSDT')).status, 400);
  assert.equal((await (await readDesk('interval=5m&symbol=ETHUSDT')).json()).error, 'unsupported_symbol');
  assert.equal((await readDesk('interval=2m')).status, 400);
  assert.equal((await readDesk('interval=5m&from=' + head)).status, 400);
  assert.equal((await (await readDesk('interval=5m&from=' + head + '&to=' + head)).json()).error, 'invalid_window');
  assert.equal((await (await readDesk('interval=5m&tail=1')).json()).error, 'invalid_tail');
  assert.equal((await (await readDesk('interval=5m&tail=201')).json()).error, 'invalid_tail');
  const bare = openDb();
  for (let i = 0; i < 30; i++) bare.sqlite.prepare('INSERT INTO klines(symbol,interval,t,o,h,l,c,v) VALUES (?,?,?,?,?,?,?,?)').run('BTCUSDT', '5m', head - i * step, 1, 2, 0, 3, 1);
  const firstFull = await (await handleDesk(new Request('http://desk.local/api/desk/chart?interval=5m&from=' + (head - 29 * step) + '&to=' + (head + step)), { DB: bare })).json();
  assert.equal(firstFull.historyRevision, 0);
  assert.equal(firstFull.headT, head);
  assert.equal(bare.sqlite.prepare('SELECT history_revision AS n FROM desk_history_state WHERE symbol=? AND interval=?').get('BTCUSDT', '5m').n, 0);
  console.log('PASS WB-03 first full read establishes revision 0 at the existing head');
  console.log('PASS WB-05 chart responses keep stateScope current');

  const positioningNow = Date.parse('2026-09-27T12:00:00.000Z');
  const card = (id, observedAt, values, extra = {}) => ({ ok: true, id, collectionStale: false, refreshSeconds: 60,
    state: { last_success_received_at: new Date(positioningNow).toISOString() },
    observations: [{ observedAt, receivedAt: new Date(positioningNow).toISOString(), effectiveReceivedAt: new Date(positioningNow - 1000).toISOString(), sourceHost: 'fapi.binance.com', ingestionMode: 'cloud-readthrough', values }], ...extra });
  const positioned = buildContextDesk({
    'binance-perp-premium': card('binance-perp-premium', new Date(positioningNow).toISOString(), { markPrice: 100, lastFundingRate: 0.0001, nextFundingTime: '2026-09-27T16:00:00.000Z' }),
    'binance-perp-funding': card('binance-perp-funding', '2026-09-27T08:00:00.001Z', { fundingRate: 0.0002, markPrice: 99 }),
    'binance-perp-funding-info': card('binance-perp-funding-info', new Date(positioningNow).toISOString(), { record: { fundingIntervalHours: 8 } }),
    'binance-perp-basis': card('binance-perp-basis', new Date(positioningNow).toISOString(), { basis: 3, basisRate: 0.01, annualizedBasisRate: null }),
    'binance-perp-oi': card('binance-perp-oi', new Date(positioningNow).toISOString(), { openInterest: 12.5 }),
    'binance-perp-oi-history': card('binance-perp-oi-history', new Date(positioningNow - 3600000).toISOString(), { sumOpenInterest: 10, sumOpenInterestValue: 1000000 }),
    'binance-perp-taker': card('binance-perp-taker', new Date(positioningNow - 3600000).toISOString(), { buyVol: 4, sellVol: 3, buySellRatio: 1.3 }),
    'binance-perp-accounts': card('binance-perp-accounts', new Date(positioningNow - 3600000).toISOString(), { longAccount: 0.6, shortAccount: 0.4, longShortRatio: 1.5 }),
  }, positioningNow);
  assert.equal(positioned.contract.positioning.oi.units.openInterest, 'BTC');
  assert.equal(positioned.contract.positioning.oi.values.openInterest, 12.5);
  assert.equal(positioned.contract.positioning.oi.unavailable, false);
  assert.equal(positioned.contract.positioning.oiHistory.units.sumOpenInterestValue, 'USDT');
  assert.equal(positioned.contract.positioning.oiHistory.period, '1h');
  assert.equal(positioned.contract.positioning.taker.units.buyVol, 'BTC');
  assert.equal(positioned.contract.positioning.accounts.sample, 'all-accounts');
  assert.equal(positioned.contract.positioning.topPositions.unavailable, true);
  assert.equal(positioned.contract.premium.values.markPrice, 100);
  const staleCollection = buildContextDesk({
    'binance-perp-premium': card('binance-perp-premium', new Date(positioningNow).toISOString(), { markPrice: 100, lastFundingRate: 0.0001, nextFundingTime: '2026-09-27T16:00:00.000Z' }),
    'binance-perp-oi': card('binance-perp-oi', new Date(positioningNow).toISOString(), { openInterest: 9 }, { state: { last_success_received_at: new Date(positioningNow - 3600000).toISOString() }, collectionStale: true }),
  }, positioningNow);
  assert.equal(staleCollection.contract.positioning.oi.collectionStale, true);
  assert.equal(staleCollection.contract.premium.unavailable, false);
  const sourceOld = buildContextDesk({
    'binance-perp-oi': card('binance-perp-oi', new Date(positioningNow - 120000).toISOString(), { openInterest: 8 }),
  }, positioningNow);
  assert.equal(sourceOld.contract.positioning.oi.sourceStale, true);
  assert.equal(sourceOld.contract.positioning.oi.collectionStale, false);
  console.log('PASS WB-06 positioning units, partial cards, and separate collection/source staleness');

  const summaryDb = openDb();
  const fundingId = 'binance-perp-funding';
  const fund = (time, rate, at) => persistDataset(summaryDb, fundingId, { ok: true, provider: 'binance-usdm', operation: 'funding', parameters: { symbol: 'BTCUSDT', limit: '500' }, source: { host: 'fapi.binance.com' }, requestedAt: at, receivedAt: at, data: [{ symbol: 'BTCUSDT', fundingTime: time, fundingRate: rate, markPrice: '100' }] });
  const t1 = head - 8 * 3600000, t2 = head;
  await fund(t1, '0.0001', new Date(head - 3600000).toISOString());
  await fund(t2, '0.0002', new Date(head - 3500000).toISOString());
  await fund(t1, '0.0003', new Date(head - 1000).toISOString());
  await fund(t2, '0.0002', new Date(head - 500).toISOString());
  const summary = await readDatasetSummary(summaryDb, fundingId, { knownAt: new Date(clock).toISOString() });
  const history = await readDataset(summaryDb, fundingId, { knownAt: new Date(clock).toISOString() });
  assert.equal(summary.observations.length, 2);
  assert.notEqual(summary.observations[0].key, summary.observations[1].key);
  assert.equal(summary.observations[0].key, history.observations[0].key);
  assert.equal(summary.observations[0].values.fundingRate, history.observations[0].values.fundingRate);
  assert.equal(summary.observations.find((row) => row.key === String(t1)).values.fundingRate, 0.0003);
  const macroId = 'fred-cpi';
  const macro = (rows, at) => persistDataset(summaryDb, macroId, { ok: true, provider: 'fred', operation: 'observations', parameters: { series_id: 'CPIAUCSL', limit: '1000' }, source: { host: 'api.stlouisfed.org' }, requestedAt: at, receivedAt: at, data: { observations: rows } });
  await macro([{ date: '2026-01-01', value: '5', realtime_start: '2026-09-01', realtime_end: '2026-09-01' }], '2026-09-01T00:00:00.000Z');
  await macro([{ date: '2026-02-01', value: '.', realtime_start: '2026-09-02', realtime_end: '2026-09-02' }], '2026-09-02T00:00:00.000Z');
  await macro([{ date: '2026-01-01', value: '9', realtime_start: '2026-09-03', realtime_end: '2026-09-03' }], '2026-09-03T00:00:00.000Z');
  const macroSummary = await readDatasetSummary(summaryDb, macroId, { knownAt: '2026-09-04T00:00:00.000Z' });
  const macroHistory = await readDataset(summaryDb, macroId, { knownAt: '2026-09-04T00:00:00.000Z' });
  assert.equal(macroSummary.observations[0].key, '2026-02-01');
  assert.equal(macroSummary.observations[0].values.value, null);
  assert.equal(macroSummary.observations[0].key, macroHistory.observations[0].key);
  assert.equal(macroSummary.observations[0].values.value, macroHistory.observations[0].values.value);
  assert.ok(!JSON.stringify(macroSummary.observations[0].values).includes('digest'));
  const early = await readDatasetSummary(summaryDb, fundingId, { knownAt: new Date(head - 2000).toISOString() });
  const earlyT1 = early.observations.find((row) => row.key === String(t1));
  assert.equal(earlyT1.values.fundingRate, 0.0001);
  const knownChart = await (await handleDesk(new Request('http://desk.local/api/desk/chart?interval=5m&tail=20&knownAt=' + new Date(head - 20 * step).toISOString()), { DB: desk })).json();
  assert.equal(knownChart.stateScope, 'current');
  assert.ok(knownChart.series.every((bar) => bar.origin !== 'canonical' || Date.parse(bar.effectiveReceivedAt) <= head - 20 * step));
  console.log('PASS WB-05 knownAt ignores later receipts; WB-07 summary matches the latest reference period');

  const small = openDb();
  const big = openDb();
  const seed = (database, count) => {
    const insert = database.sqlite.prepare(`INSERT INTO finance_dataset_observations
      (dataset_id,observation_key,observed_at,time_precision,received_at,stored_at,source_host,ingestion_mode,value_json)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    const kline = database.sqlite.prepare('INSERT INTO klines(symbol,interval,t,o,h,l,c,v) VALUES (?,?,?,?,?,?,?,?)');
    for (let i = 0; i < count; i++) {
      const open = head - i * step;
      insert.run('binance-perp-premium', String(open), new Date(open).toISOString(), 'millisecond', new Date(open).toISOString(), new Date(open).toISOString(), 'fapi.binance.com', 'cloud-readthrough', JSON.stringify({ markPrice: i }));
      kline.run('BTCUSDT', '5m', open, 1, 2, 0, 3, 1);
    }
  };
  seed(small, 800);
  seed(big, 8000);
  const planOf = (database) => database.sqlite.prepare('EXPLAIN QUERY PLAN ' + observationKeyWalkSql()).all('binance-perp-premium', new Date(clock).toISOString(), null, null, 21, 0).map((row) => row.detail).join('\n');
  const tapePlan = (database) => database.sqlite.prepare(`EXPLAIN QUERY PLAN SELECT t,o,h,l,c,v FROM klines WHERE symbol=?1 AND interval=?2 AND (?3 IS NULL OR t>=?3) AND (?4 IS NULL OR t<?4) ORDER BY t DESC LIMIT ?5`).all('BTCUSDT', '5m', null, null, 21).map((row) => row.detail).join('\n');
  const smallPlan = planOf(small), bigPlan = planOf(big);
  assert.equal(smallPlan, bigPlan);
  assert.ok(!/SCAN finance_dataset_observations|SCAN klines/.test(smallPlan + '\n' + tapePlan(small) + '\n' + tapePlan(big)));
  assert.ok(!observationKeyWalkSql().includes('COUNT('));
  assert.ok(!rawKlineHistoryStatements('BTCUSDT', '5m', [[head, 1, 2, 0, 1, 1]]).before.some((query) => query.sql.includes('COUNT(')));
  console.log('PASS bounded tail and summary plans stay on the observed_at index after a 10x history; D1 rows_read 待验; extra observed_at index is one secondary write per observation');
  globalThis.Date = RealDate;
  for (const item of [desk, gapDb, solid, outside, three, week, short, bare, summaryDb, small, big]) item.sqlite.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });
