const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');

(async () => {
  const { __footprintTestHooks: hooks } = await import(pathToFileURL(path.join(root, 'cloudflare/binance-klines-worker.js')));
  const due = hooks.intervalsDueAt(new Date('2026-09-21T00:07:00.000Z'));
  assert.deepEqual(due, ['5m', '15m', '1h', '4h', '1d', '3d', '1w']);
  console.log('PASS cadence cron syncs every interval each minute');

  const { klineArrayFromWsK, canonicalBinanceHost, markPriceToPremium, klineLiveCombinedStreamUrl } = await import(pathToFileURL(path.join(root, 'cloudflare/kline-live-collector.mjs')));
  const row = klineArrayFromWsK({ t: 1000, T: 1999, o: '1', h: '2', l: '0.5', c: '1.5', v: '3', q: '4', n: 9, V: '1', Q: '2' });
  assert.equal(row[0], 1000);
  assert.equal(row[4], '1.5');
  assert.equal(canonicalBinanceHost('proxy.example.com'), 'fapi.binance.com');
  assert.equal(canonicalBinanceHost('fstream.binance.com'), 'fstream.binance.com');
  const premium = markPriceToPremium({ e: 'markPriceUpdate', E: 2000, p: '100', i: '99', r: '0.0001', T: 3000 });
  assert.equal(premium.markPrice, '100');
  assert.equal(premium.time, 2000);
  console.log('PASS live kline WS payload and canonical host');

  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE klines(symbol TEXT,interval TEXT,t INTEGER,o REAL,h REAL,l REAL,c REAL,v REAL,PRIMARY KEY(symbol,interval,t))');
  const env = {
    DB: {
      prepare(sql) {
        return {
          bind(...args) {
            return { run: async () => ({ meta: sqlite.prepare(sql).run(...args) }) };
          },
        };
      },
      batch: async (stmts) => Promise.all(stmts.map((s) => s.run())),
    },
  };
  await hooks.persistKlines(env, 'BTCUSDT', '5m', [[0, 1, 2, 0, 1, 3], [300000, 1, 2, 0, 1, 3]], { skipPrune: true });
  await hooks.persistKlines(env, 'BTCUSDT', '5m', Array.from({ length: 6005 }, (_, i) => [i * 600000, 1, 2, 0, 1, 3]), { skipPrune: true });
  assert.ok(sqlite.prepare('SELECT COUNT(*) AS n FROM klines').get().n > 6000);
  await hooks.pruneKlinesCap(env, 'BTCUSDT', '5m');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM klines').get().n, 6000);
  console.log('PASS skipPrune keeps extra live writes until cron prune');
  const preserve = hooks.shouldPreserveLiveTapeStatus({ lastOk: true, lastRun: Date.now() - 1000, maxT: Date.now() }, '5m');
  assert.equal(preserve.liveFresh, true);
  assert.equal(preserve.preserve, true);
  const poisoned = hooks.shouldPreserveLiveTapeStatus({ lastOk: true, lastRun: Date.now() - 120000, maxT: 1 }, '5m');
  assert.equal(poisoned.liveFresh, false);
  assert.equal(poisoned.preserve, false);
  console.log('PASS live tape status is preserved only while writes are fresh');
  const liveUrl = klineLiveCombinedStreamUrl('BTCUSDT');
  assert.match(liveUrl, /^wss:\/\/fstream\.binance\.com\/market\/stream\?streams=/);
  assert.match(liveUrl, /btcusdt@kline_5m/);
  assert.match(liveUrl, /btcusdt@markPrice@1s/);
  assert.equal(liveUrl.includes('fstream.binance.com/stream?'), false);
  console.log('PASS live collector uses USD-M market combined stream');

  const { persistLiveKlineBar, persistLiveSnapshot, pruneExpiredDatasets, datasetRetention } = await import(pathToFileURL(path.join(root, 'cloudflare/finance/dataset-store.mjs')));
  const { FINANCE_DATASETS } = await import(pathToFileURL(path.join(root, 'cloudflare/finance/datasets.mjs')));
  sqlite.exec(fs.readFileSync(path.join(root, 'cloudflare/finance/dataset-schema.sql'), 'utf8'));
  const dsdb = {
    sqlite,
    prepare(sql) {
      return {
        sql,
        values: [],
        bind(...values) { this.values = values; return this; },
        async run() { sqlite.prepare(sql).run(...this.values); return { success: true }; },
        async all() { return { results: sqlite.prepare(sql).all(...this.values) }; },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((s) => ({ results: sqlite.prepare(s.sql).all(...s.values) }));
        sqlite.exec('COMMIT');
        return results;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };
  const open = Date.parse('2026-09-21T01:00:00.000Z');
  const kline = [open, '100', '110', '90', '105', '1', open + 299999, '200', 4, '0.4', '80'];
  await persistLiveKlineBar(dsdb, '5m', kline, 'fstream.binance.com', 'cloud-ws');
  const updated = [open, '100', '120', '90', '118', '2', open + 299999, '400', 8, '0.8', '160'];
  await persistLiveKlineBar(dsdb, '5m', updated, 'fstream.binance.com', 'cloud-ws');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM finance_dataset_observations').get().n, 1);
  const stored = JSON.parse(sqlite.prepare('SELECT value_json FROM finance_dataset_observations').get().value_json);
  assert.equal(stored.close, 118);
  assert.equal(FINANCE_DATASETS['binance-perp-klines-5m'].refreshSeconds, 15);
  console.log('PASS live kline observation upserts in place');

  await persistLiveSnapshot(dsdb, 'binance-perp-premium', {
    symbol: 'BTCUSDT', markPrice: '100', indexPrice: '99', lastFundingRate: '0.0001', interestRate: '0',
    nextFundingTime: open + 8 * 3600000, time: open,
  }, 'fstream.binance.com', 'cloud-ws');
  await persistLiveSnapshot(dsdb, 'binance-perp-premium', {
    symbol: 'BTCUSDT', markPrice: '101', indexPrice: '99', lastFundingRate: '0.0001', interestRate: '0',
    nextFundingTime: open + 8 * 3600000, time: open + 1000,
  }, 'fstream.binance.com', 'cloud-ws');
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM finance_dataset_observations WHERE dataset_id='binance-perp-premium'").get().n, 2);
  assert.equal(FINANCE_DATASETS['binance-perp-premium'].refreshSeconds, 5);
  assert.equal(FINANCE_DATASETS['binance-perp-oi'].refreshSeconds, 5);
  console.log('PASS live premium snapshots insert independently');

  assert.equal(datasetRetention('binance-perp-klines-5m').keep, 600);
  assert.equal(datasetRetention('btc-fees').maxAgeMs, 7 * 86400000);
  sqlite.exec(`INSERT INTO finance_dataset_observations
    (dataset_id, observation_key, observed_at, time_precision, received_at, stored_at, source_host, ingestion_mode, value_json)
    VALUES ('btc-fees','old',NULL,'unknown','2026-08-01T00:00:00.000Z','2026-08-01T00:00:00.000Z','mempool.space','cloud-readthrough','{"fastestFee":1}')`);
  sqlite.exec(`INSERT INTO finance_dataset_observations
    (dataset_id, observation_key, observed_at, time_precision, received_at, stored_at, source_host, ingestion_mode, value_json)
    VALUES ('btc-fees','fresh',NULL,'unknown','2026-09-21T00:00:00.000Z','2026-09-21T00:00:00.000Z','mempool.space','cloud-readthrough','{"fastestFee":2}')`);
  await pruneExpiredDatasets(dsdb, Date.parse('2026-09-21T12:00:00.000Z'));
  const feeKeys = sqlite.prepare("SELECT observation_key AS k FROM finance_dataset_observations WHERE dataset_id='btc-fees' ORDER BY k").all().map((row) => row.k);
  assert.deepEqual(feeKeys, ['fresh']);
  console.log('PASS expired dataset receipts are hard-deleted');

  const { datasetDueForCollection, DATASET_AUTO_SKIP, pickDatasetsToRefresh } = await import(pathToFileURL(path.join(root, 'cloudflare/finance/scheduler.mjs')));
  assert.equal(DATASET_AUTO_SKIP.has('deribit-btc-options'), false);
  assert.equal(datasetDueForCollection('deribit-btc-options', FINANCE_DATASETS['deribit-btc-options'], null).due, true);
  assert.equal(FINANCE_DATASETS['deribit-btc-options'].refreshSeconds, 21600);
  const picked = pickDatasetsToRefresh([
    { id: 'a', provider: 'binance-usdm', age: 8 },
    { id: 'b', provider: 'binance-usdm', age: 7 },
    { id: 'c', provider: 'binance-spot', age: 6 },
    { id: 'd', provider: 'binance-usdm', age: 5 },
    { id: 'e', provider: 'binance-usdm', age: 4 },
    { id: 'f', provider: 'binance-usdm', age: 3 },
    { id: 'g', provider: 'binance-usdm', age: 2 },
    { id: 'h', provider: 'binance-usdm', age: 1 },
    { id: 'sofr', provider: 'nyfed', age: 0 },
  ], 8);
  assert.equal(picked.some((item) => item.id === 'sofr'), true);
  assert.equal(picked.length, 8);
  assert.equal(datasetDueForCollection('btc-fees', FINANCE_DATASETS['btc-fees'], null).due, true);
  const recent = { last_success_received_at: new Date().toISOString(), attempted_at: new Date().toISOString() };
  assert.equal(datasetDueForCollection('btc-fees', FINANCE_DATASETS['btc-fees'], recent).due, false);
  const klineRecent = { last_success_received_at: new Date().toISOString(), attempted_at: new Date().toISOString() };
  assert.equal(datasetDueForCollection('binance-perp-klines-5m', FINANCE_DATASETS['binance-perp-klines-5m'], klineRecent).due, false);
  console.log('PASS scheduler keeps a context slot and does not full-refresh live klines every tick');

  const { buildChartDeskFromTape, DESK_SCHEMA_VERSION } = await import(pathToFileURL(path.join(root, 'cloudflare/finance/desk.mjs')));
  const now = Date.parse('2026-09-21T01:00:10.000Z');
  const tape = {
    authoritative: true,
    lastRun: now - 1000,
    sourceHost: 'fapi.binance.com',
    ingestionMode: 'cloud-ws',
    rows: [{ t: open, o: 100, h: 110, l: 90, c: 105, v: 1 }],
  };
  const desk = buildChartDeskFromTape(tape, '5m', now);
  assert.equal(desk.schemaVersion, DESK_SCHEMA_VERSION);
  assert.equal(desk.pricePathAvailable, true);
  assert.equal(desk.series.length, 1);
  assert.equal(desk.venue, 'binance-usdm');
  console.log('PASS desk live tape authorizes chart series');

  const { datasetCatalog } = await import(pathToFileURL(path.join(root, 'cloudflare/finance/datasets.mjs')));
  const catalog = datasetCatalog();
  assert.equal(catalog.automaticCollection, true);
  assert.equal(catalog.frontendConnected, true);
  console.log('PASS dataset catalog marks automatic collection');

  const wrangler = fs.readFileSync(path.join(root, 'cloudflare/wrangler.toml'), 'utf8');
  assert.match(wrangler, /KLINE_LIVE_COLLECTOR/);
  assert.match(wrangler, /KlineLiveCollector/);
  console.log('PASS wrangler binds kline live collector');
})().catch((error) => { console.error(error); process.exitCode = 1; });
