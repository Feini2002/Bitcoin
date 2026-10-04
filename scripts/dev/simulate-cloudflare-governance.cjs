/* Offline, deterministic cost projection. Never connects to Cloudflare or reads credentials. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '../..');
const DAY = 86400, DAYS = 31, MILLION = 1e6;
const command = 'node scripts/run-bounded.cjs 30 node scripts/dev/simulate-cloudflare-governance.cjs';
// Integration checks exercise all replay/formula assertions without replacing
// the final report or recording fingerprints of another agent's work in progress.
const checkOnly = process.argv.includes('--check');
const outputBase = path.join(root, '.artifacts/plans/cloudflare-cost-simulation-2026-09-26');
const sources = {
  durableObjects: 'https://developers.cloudflare.com/durable-objects/platform/pricing/',
  d1: 'https://developers.cloudflare.com/d1/platform/pricing/',
  workers: 'https://developers.cloudflare.com/workers/platform/pricing/',
  r2: 'https://developers.cloudflare.com/r2/pricing/',
  queues: 'https://developers.cloudflare.com/queues/platform/pricing/',
};
// Root agent verified these billing DOM values in the user's already signed-in
// Chrome session. No account identity, session material or credentials are copied.
const currentBillingCycle = {
  periodStart: '2026-09-16', periodEndInclusive: '2026-10-15', periodDays: 30,
  observedThrough: '2026-09-26', displayedObservationDays: 11,
  verification: 'Signed-in Cloudflare billing page DOM read by root; Wrangler billing API returned 403, but billing period/usage are now verified via UI.',
  observedAdditionalUsageUsd: .15, dashboardPastRateProjectionUsdNotUsed: .41,
  rounding: 'Displayed 1.18M DO requests is rounded; model uses 1,000,000 + displayed 184.54k excess = 1,184,540. Other M/B/k display values are rounded, not exact meter exports.',
  accrued: { doRequests: 1184540, doDurationGBs: 163920, d1Writes: 10850000,
    d1Reads: 1120000000, workerCpuMs: 11150000, workerRequests: 79880,
    d1StorageGBMonth: .16, doSqliteGBMonth: 0, r2StorageGBMonth: 2.71,
    r2ClassA: 26600, r2ClassB: 63310, queueOperations: 13260 },
  unreportedDoSqliteRowsReserve: { writes: 1000000, reads: 1000000000 },
  reserveExplanation: 'DO SQLite accrued row counters were not supplied by the billing DOM reading; reserves are assumptions, not measured zero. Current reported SQL storage was zero.',
  remainingDays: [19, 20],
  remainingDaysBasis: '19 complete days, plus up to 0.5 day of the observation day. Round the conservative endpoint to 20 days; 11 observed display-days plus 20 intentionally overlaps a partial day.',
  analyticsDelay: 'Billing and Analytics can lag and round. The complete 13:15–13:35 UTC window corroborates the earlier governance deployment only, not these pending recovery/macro fixes; neither that 20-minute sample nor the earlier 1,642-write/5min sample is used as a stable daily rate.',
  otherProducts: 'R2 Standard storage/operations and Queue operations currently add $0. Continue only their observed rate in this projection; new traffic/storage classes are not capped.',
};
const shortWindowCorroboration = {
  source: '.artifacts/plans/cloudflare-window-1790430231931.json',
  observedAt: '2026-09-26T13:43:51.931Z', from: '2026-09-26T13:15:00Z', to: '2026-09-26T13:35:00Z',
  rowsWritten: 9799, rowsRead: 1841576, cleanupBurstRowsRead: 1734770,
  doDurationGBsPerFiveMinuteBucket: [38.400120192, 38.400037504, 38.400043264, 38.40005056],
  activeNamespacesReported: 1, legacyNamespaceUsageReported: 0,
  dailyWritesIfNaivelyExtrapolatedNotUsed: 705528,
  limitation: 'Four complete five-minute buckets from the previously deployed governance version. Consistent with one continuously active 128MB object in this window; does not validate the pending code, stable daily usage, no later old-object activity, or a final bill. Not an input to scenario pricing.',
};
const baseline = {
  utcDay: '2026-09-25', d1Writes: 2118682, d1Reads: 229003417,
  doDurationGBs: 22094.4167, inboundWebSocketMessages: 3157408, doInvocations: 19802,
  btcWorkerRequests: 2577, btcWorkerCpuMs: 130080.5,
  otherD1MonthWrites: 530000, yeswoodJobsCpuThroughSep26: 25959173,
  rollingInsightsNotSameUtcDay: {
    genericObservationInsert: { writes: 1167663, calls: 28361 },
    observationDelete: { writes: 552416, calls: 126300, readsApprox: 220900000 },
    klineInsert: { writes: 212010, calls: 70670 },
    syncStatus: { writes: 138856, calls: 69428 },
    liveObservation: { writes: 50019, calls: 49365 },
    liveState: { writes: 53231 }, genericState: { writes: 25738 }, health: { writes: 29210 },
  },
};
const round = (v, digits = 2) => Number(v.toFixed(digits));
function sqliteMeter() {
  const sqlite = new DatabaseSync(':memory:');
  const counts = {};
  function total() { return Number(sqlite.prepare('SELECT total_changes() AS n').get().n); }
  function execute(sql, args = []) {
    const match = sql.match(/^\s*(INSERT(?:\s+OR\s+\w+)?\s+INTO|UPDATE|DELETE\s+FROM)\s+(\w+)/i);
    const table = match?.[2];
    const before = table ? sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n : 0;
    const start = total();
    const results = sqlite.prepare(sql).all(...args);
    const changes = total() - start;
    if (table) {
      assert.ok(!/INSERT\s+OR\s+REPLACE/i.test(sql), 'REPLACE requires separate delete/index accounting');
      const after = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
      const inserted = Math.max(0, after - before), deleted = Math.max(0, before - after);
      const updated = changes - inserted - deleted;
      const indexes = sqlite.prepare(`PRAGMA index_list('${table}')`).all();
      const set = sql.match(/(?:DO\s+UPDATE|^\s*UPDATE\s+\w+)\s+SET\s+([\s\S]*?)(?:\s+WHERE\s|$)/i)?.[1] || '';
      const touchedIndexes = indexes.filter(index => sqlite.prepare(`PRAGMA index_info('${index.name}')`).all()
        .some(column => new RegExp(`(?:^|,)\\s*${column.name}\\s*=`, 'i').test(set))).length;
      const meter = counts[table] ||= { statements: 0, logicalChanges: 0, inserted: 0, updated: 0, deleted: 0, estimatedIndexWrites: 0, estimatedBillableWrites: 0 };
      meter.statements++; meter.logicalChanges += changes; meter.inserted += inserted; meter.deleted += deleted; meter.updated += updated;
      const indexWrites = (inserted + deleted) * indexes.length + updated * touchedIndexes;
      meter.estimatedIndexWrites += indexWrites; meter.estimatedBillableWrites += changes + indexWrites;
    }
    return { results, meta: { changes } };
  }
  const db = {
    sqlite, counts, execute,
    prepare(sql) { return { sql, values: [], bind(...values) { return { ...this, values }; },
      async all() { return execute(sql, this.values); }, async run() { return execute(sql, this.values); },
      async first() { return execute(sql, this.values).results[0] || null; } }; },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try { const out = statements.map(s => execute(s.sql, s.values)); sqlite.exec('COMMIT'); return out; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
    reset() { for (const key of Object.keys(counts)) delete counts[key]; },
    snapshot() {
      return { logicalChanges: Object.values(counts).reduce((s, c) => s + c.logicalChanges, 0),
        estimatedBillableWrites: Object.values(counts).reduce((s, c) => s + c.estimatedBillableWrites, 0),
        tables: structuredClone(counts) };
    },
  };
  return db;
}
function cadence(bodyMs, snapshotMs, minimumCycleMs) {
  let cycles = 0, snapshots = 0, next = 0, lastSnapshot = -Infinity;
  // Actual owner alarm is one second. Snapshot task has its own 5s due gate and
  // runs independently of forming K-line writes (three interval I/O lanes).
  for (let now = 0; now < DAY * 1000; now += 1000) {
    if (now - lastSnapshot >= snapshotMs) { snapshots++; lastSnapshot = now; }
    if (now >= next) {
      cycles++;
      next = now + Math.max(bodyMs + 1000, minimumCycleMs);
    }
  }
  return { cycles, snapshots, cycleSeconds: DAY / cycles, snapshotSeconds: DAY / snapshots, snapshotSchedule: 'independent-5s-due' };
}
function prices(usage) {
  const excess = (used, included, rate) => Math.max(0, used - included) / MILLION * rate;
  const rounded = (used, included, rate) => Math.ceil(Math.max(0, used - included) / MILLION) * rate;
  const costs = {
    workersSubscription: 5,
    d1Writes: excess(usage.d1Writes, 50e6, 1), d1Reads: excess(usage.d1Reads, 25e9, .001),
    d1Storage: Math.max(0, usage.d1StorageGBMonth - 5) * .75,
    doRequests: rounded(usage.doRequests, 1e6, .15), doDuration: rounded(usage.doDurationGBs, 400000, 12.5),
    doSqliteWrites: excess(usage.doSqliteWrites, 50e6, 1), doSqliteReads: excess(usage.doSqliteReads, 25e9, .001),
    doSqliteStorage: Math.max(0, usage.doSqliteGBMonth - 5) * .2,
    workerRequests: excess(usage.workerRequests, 10e6, .30), workerCpu: excess(usage.workerCpuMs, 30e6, .02),
    r2Storage: Math.ceil(Math.max(0, (usage.r2StorageGBMonth || 0) - 10)) * .015,
    r2ClassA: rounded(usage.r2ClassA || 0, 1e6, 4.5), r2ClassB: rounded(usage.r2ClassB || 0, 10e6, .36),
    queues: excess(usage.queueOperations || 0, 1e6, .40),
  };
  return { ...Object.fromEntries(Object.entries(costs).map(([k, v]) => [k, round(v, 4)])), total: round(Object.values(costs).reduce((s, v) => s + v, 0)) };
}
async function main() {
  // A fetch tripwire prevents accidental use of remote hooks in this offline program.
  global.fetch = async () => { throw Error('network_forbidden_in_cost_simulation'); };
  const load = file => import(pathToFileURL(path.join(root, file)));
  await load('cloudflare/binance-klines-worker.js');
  const live = await load('cloudflare/kline-live-collector.mjs');
  const store = await load('cloudflare/finance/dataset-store.mjs');
  const rawStore = await load('cloudflare/finance/store.mjs');
  const { FINANCE_DATASETS: definitions, datasetSupportsIncremental } = await load('cloudflare/finance/datasets.mjs');
  const scheduler = await load('cloudflare/finance/scheduler.mjs');
  const { FINANCE_PROVIDERS: providers } = await load('cloudflare/finance/registry.mjs');
  const { LiquidationRecovery } = await load('cloudflare/liquidation-recovery.mjs');
  const { KlineRecovery } = await load('cloudflare/kline-recovery.mjs');
  const RealDate = Date;
  let now = Date.parse('2026-09-26T00:00:00Z');
  global.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
  const db = sqliteMeter();
  for (const file of ['cloudflare/schema.sql', 'cloudflare/finance/schema.sql', 'cloudflare/finance/dataset-schema.sql']) db.sqlite.exec(fs.readFileSync(path.join(root, file), 'utf8'));
  const component = new live.KlineLiveComponent({}, { DB: db });
  const replay = {};
  const row = (time, n = 0) => [time, '100', '110', '90', String(101 + n), String(20 + n), time + 299999, '2000', '10', '5', '500'];
  async function cycle(n) {
    for (const interval of live.KLINE_LIVE_INTERVALS) await component.persistOne(interval, [row(1790380800000, n)], 'fstream.binance.com', 'cloud-ws', { closed: false, receivedAt: new Date(now).toISOString() });
  }
  await cycle(0); now += 1000; db.reset(); await cycle(1);
  replay.changedSevenKlines = db.snapshot();
  assert.equal(replay.changedSevenKlines.estimatedBillableWrites, 26);
  now += 1000; db.reset(); await cycle(1); replay.unchangedRawKlinesNewReceipt = db.snapshot();
  now += 1000; db.reset(); await component.persistOne('5m', [row(1790380800000, 2)], 'fstream.binance.com', 'cloud-ws', { closed: true, receivedAt: new Date(now).toISOString() });
  replay.confirmedClosedBar = db.snapshot(); assert.equal(replay.confirmedClosedBar.estimatedBillableWrites, 6);
  const hourlyClosed = Array.from({ length: 24 }, (_, i) => row(now - (24 - i) * 300000));
  const restMetadata = () => ({ receivedAt: new Date(now).toISOString(), requestStartedAt: new Date(now).toISOString() });
  db.reset(); await store.persistRestKlineBatch(db, '5m', hourlyClosed, 'fapi.binance.com', restMetadata());
  replay.hourlyRestClosed24 = db.snapshot();
  now += 3600000; db.reset(); await store.persistRestKlineBatch(db, '5m', hourlyClosed, 'fapi.binance.com', restMetadata());
  replay.hourlyRestClosed24NewReceipt = db.snapshot();
  assert.equal(replay.hourlyRestClosed24NewReceipt.estimatedBillableWrites, 24 * 3 + 1);
  const snapshots = {
    premium: ['binance-perp-premium', () => ({ symbol: 'BTCUSDT', time: now, markPrice: '100', indexPrice: '99', lastFundingRate: '.0001', nextFundingTime: now + 300000 })],
    oi: ['binance-perp-oi', () => ({ symbol: 'BTCUSDT', time: now, openInterest: '100' })],
    book: ['binance-perp-book', () => ({ T: now, lastUpdateId: now, bids: [['99', '1']], asks: [['101', '1']] })],
  };
  for (const [key, [id, data]] of Object.entries(snapshots)) {
    await store.persistLiveSnapshot(db, id, data(), 'fapi.binance.com');
    now += 1000; db.reset(); await store.persistLiveSnapshot(db, id, data(), 'fapi.binance.com'); replay[key] = db.snapshot();
    assert.equal(replay[key].estimatedBillableWrites, 4);
  }
  const fundingId = 'binance-perp-funding';
  const funding = Array.from({ length: 500 }, (_, i) => ({ symbol: 'BTCUSDT', fundingTime: now - (500 - i) * 3600000, fundingRate: '.0001', markPrice: '100' }));
  const fakeFetch = async target => {
    const u = new URL(target), start = u.searchParams.get('startTime');
    return Response.json(start === null ? funding.slice(-Number(u.searchParams.get('limit'))) : funding.filter(r => r.fundingTime >= Number(start)).slice(0, 500));
  };
  const env = { DB: db, FINANCE_D1_ENABLED: 'true' };
  await scheduler.refreshFinanceDataset(env, fundingId, { now, dependencies: { fetch: fakeFetch } });
  now += 300000; db.reset(); const tail = await scheduler.refreshFinanceDataset(env, fundingId, { now, dependencies: { fetch: fakeFetch } });
  replay.historyTailFirstCacheSlot = { ...db.snapshot(), mode: tail.mode, observationsWritten: tail.written };
  now += 300000; db.reset(); await scheduler.refreshFinanceDataset(env, fundingId, { now, dependencies: { fetch: fakeFetch } });
  replay.historyTailSteady = db.snapshot();
  assert.equal(replay.historyTailSteady.logicalChanges, 6);
  assert.equal(replay.historyTailSteady.estimatedBillableWrites, 12);
  now += 86400001; db.reset(); await scheduler.refreshFinanceDataset(env, fundingId, { now, forceFull: true, dependencies: { fetch: fakeFetch } });
  replay.historyFull500 = db.snapshot();
  const definition = definitions[fundingId];
  const envelope = { ok: true, provider: definition.provider, operation: definition.operation, parameters: definition.parameters,
    source: { host: 'fapi.binance.com' }, receivedAt: new Date(now).toISOString(), requestedAt: new Date(now).toISOString(), data: funding };
  db.reset(); await store.persistDataset(db, fundingId, envelope); await rawStore.persistFinanceSnapshot(db, rawStore.financeSnapshotKey(definition.provider, definition.operation, definition.parameters), envelope, envelope.receivedAt);
  replay.sameReceipt = db.snapshot(); assert.equal(replay.sameReceipt.estimatedBillableWrites, 0);
  db.reset(); await store.pruneDatasetObservations(db, fundingId, 2, 1000); replay.deleteObservations = db.snapshot();
  assert.equal(replay.deleteObservations.estimatedBillableWrites, replay.deleteObservations.logicalChanges * 3);
  const fredId = Object.keys(definitions).find(id => definitions[id].kind === 'fred');
  const fredDefinition = definitions[fredId];
  const fredEnvelope = (changed = false) => ({ provider: fredDefinition.provider, operation: fredDefinition.operation,
    parameters: fredDefinition.parameters, source: { host: 'api.stlouisfed.org' },
    requestedAt: new Date(now).toISOString(), receivedAt: new Date(now).toISOString(),
    data: { observations: Array.from({ length: 1000 }, (_, i) => ({ date: new RealDate(Date.UTC(2023, 0, 1) + i * DAY * 1000).toISOString().slice(0, 10),
      value: changed && i === 999 ? '101' : '100', realtime_start: new Date(now).toISOString().slice(0, 10), realtime_end: new Date(now).toISOString().slice(0, 10) })) } });
  await store.persistDataset(db, fredId, fredEnvelope());
  db.reset(); await store.persistDataset(db, fredId, fredEnvelope()); replay.fredSameReceipt = db.snapshot();
  assert.equal(replay.fredSameReceipt.estimatedBillableWrites, 0);
  now += DAY * 1000; db.reset(); await store.persistDataset(db, fredId, fredEnvelope()); replay.fredNewQueryWindow = db.snapshot();
  assert.equal(replay.fredNewQueryWindow.logicalChanges, 2);
  assert.equal(replay.fredNewQueryWindow.estimatedBillableWrites, 4);
  const macroReceiptBytes = Number(db.sqlite.prepare("SELECT LENGTH(CAST(value_json AS BLOB)) AS bytes FROM finance_dataset_observations WHERE dataset_id=? AND observation_key='@receipt' ORDER BY received_at DESC LIMIT 1").get(fredId).bytes);
  now += 3600000; db.reset(); await store.persistDataset(db, fredId, fredEnvelope(true)); replay.fredRealValueRevision = db.snapshot();
  assert.equal(replay.fredRealValueRevision.estimatedBillableWrites, 7);
  const local = sqliteMeter();
  const localStorage = { sql: { exec(sql, ...args) {
    if (/^\s*CREATE/i.test(sql)) { local.sqlite.exec(sql); return { toArray: () => [] }; }
    const r = local.execute(sql, args); return { toArray: () => r.results };
  } }, transactionSync(fn) { local.sqlite.exec('BEGIN'); try { fn(); local.sqlite.exec('COMMIT'); } catch (error) { local.sqlite.exec('ROLLBACK'); throw error; } } };
  const recovery = new LiquidationRecovery(localStorage);
  const buildBucket = prior => ({ n: (prior?.n || 0) + 1 });
  recovery.ingest('binance:0', 'event:1', 0, buildBucket); replay.liquidationFirstEvent = local.snapshot();
  local.reset(); recovery.ingest('binance:0', 'event:2', 0, buildBucket); replay.liquidationNextEvent = local.snapshot();
  local.reset(); recovery.ingest('binance:0', 'event:2', 0, buildBucket); replay.liquidationDuplicateEvent = local.snapshot();
  assert.equal(replay.liquidationNextEvent.estimatedBillableWrites, 4);
  assert.equal(replay.liquidationDuplicateEvent.estimatedBillableWrites, 0);
  local.reset(); recovery.seed('binance:0', bucket => bucket); replay.liquidationSeed = local.snapshot();
  assert.equal(replay.liquidationSeed.estimatedBillableWrites, 1);
  local.reset(); recovery.seed('binance:0', bucket => bucket); replay.liquidationSeedAlreadyLoaded = local.snapshot();
  assert.equal(replay.liquidationSeedAlreadyLoaded.estimatedBillableWrites, 0);
  local.reset(); recovery.acknowledge('binance:0', 3); replay.liquidationAcknowledge = local.snapshot();
  local.reset(); recovery.prune(1); replay.liquidationDelete = local.snapshot();
  local.reset(); const klineRecovery = new KlineRecovery(localStorage, live.KLINE_LIVE_INTERVALS);
  replay.klineRecoveryFirstStart = local.snapshot();
  local.reset(); for (const interval of live.KLINE_LIVE_INTERVALS) klineRecovery.initialize(interval, { maxT: 1790380800000, hasRows: true });
  replay.klineRecoveryInitialize = local.snapshot();
  local.reset(); const restartedRecovery = new KlineRecovery(localStorage, live.KLINE_LIVE_INTERVALS);
  replay.klineRecoveryRestart = local.snapshot();
  local.reset(); for (const interval of live.KLINE_LIVE_INTERVALS) restartedRecovery.endGap(interval);
  replay.klineRecoveryEndGaps = local.snapshot();
  local.reset(); for (const interval of live.KLINE_LIVE_INTERVALS) restartedRecovery.acknowledge(interval, restartedRecovery.rows.get(interval).generation, 1790381100000);
  replay.klineRecoveryAcknowledge = local.snapshot();
  local.reset(); for (const interval of live.KLINE_LIVE_INTERVALS) restartedRecovery.beginGap(interval, 1790381100000);
  replay.klineRecoveryBeginGaps = local.snapshot();
  assert.equal(replay.klineRecoveryFirstStart.estimatedBillableWrites, 14);
  for (const key of ['klineRecoveryInitialize', 'klineRecoveryRestart', 'klineRecoveryEndGaps', 'klineRecoveryAcknowledge', 'klineRecoveryBeginGaps']) assert.equal(replay[key].estimatedBillableWrites, 7, key);
  const fundingInfoId = 'binance-perp-funding-info', fundingInfoDefinition = definitions[fundingInfoId];
  const fundingInfoFixtureRows = store.datasetRetention(fundingInfoId).keep + 1;
  for (let i = 0; i < fundingInfoFixtureRows; i++) {
    const receivedAt = new Date(now - (fundingInfoFixtureRows - 1 - i) * DAY * 1000).toISOString();
    await store.persistDataset(db, fundingInfoId, { provider: fundingInfoDefinition.provider, operation: fundingInfoDefinition.operation,
      parameters: fundingInfoDefinition.parameters, source: { host: 'fapi.binance.com' }, receivedAt, requestedAt: receivedAt, data: [] });
  }
  const fundingInfoQueries = [];
  const fundingInfoReadDb = { prepare(sql) { return db.prepare(sql); }, async batch(statements) {
    fundingInfoQueries.push(...statements.map(s => ({ sql: s.sql, values: s.values })));
    return db.batch(statements);
  } };
  db.reset(); const fundingInfoRead = await store.readDataset(fundingInfoReadDb, fundingInfoId);
  replay.deskFundingInfoRead = { ...db.snapshot(), fixtureObservationRows: fundingInfoFixtureRows,
    statementsExecuted: fundingInfoQueries.length, returnedObservations: fundingInfoRead.observations.length,
    queryPlans: fundingInfoQueries.map(q => db.sqlite.prepare('EXPLAIN QUERY PLAN ' + q.sql).all(...q.values).map(row => row.detail)) };
  assert.equal(fundingInfoQueries.length, 3);
  assert.equal(replay.deskFundingInfoRead.estimatedBillableWrites, 0);
  assert.equal(fundingInfoRead.observations.length, fundingInfoFixtureRows);
  assert.ok(replay.deskFundingInfoRead.queryPlans.flat().some(detail => detail.includes('USING COVERING INDEX')));
  db.sqlite.close(); local.sqlite.close(); global.Date = RealDate;

  const history = Object.entries(definitions).filter(([id]) => datasetSupportsIncremental(id)).map(([id, d]) => ({
    id, fullAuditsPerDay: 86400000 / scheduler.DATASET_HISTORY_AUDIT_MS,
    tailRefreshesPerDay: id.startsWith('binance-perp-klines-') ? 0 : Math.max(0, DAY / (d.kind === 'klines' ? 1800 : d.refreshSeconds) - 1),
  }));
  const historyDaily = history.reduce((sum, d) => sum + d.fullAuditsPerDay * (replay.historyFull500.estimatedBillableWrites + 500 * 3)
    + d.tailRefreshesPerDay * (replay.historyTailSteady.estimatedBillableWrites + 2 * 3), 0);
  const historyRowsGeneratedDaily = history.reduce((sum, d) => sum + d.fullAuditsPerDay * 500 + d.tailRefreshesPerDay * 2, 0);
  const hourlyReconciliation = {
    intervals: live.KLINE_LIVE_INTERVALS.length,
    normalizedIntervals: live.KLINE_LIVE_INTERVALS.filter(interval => definitions[`binance-perp-klines-${interval}`]).length,
    passesPerDay: 24, closedBarsPerPass: 24,
    rawWriteAssumption: 'Conservative ceiling: all 24 closed rows per interval per hourly pass are treated as inserts with both raw-table indexes; unchanged UPSERTs actually write zero. The forming row is filtered before persistence.',
    normalizedWriteAssumption: 'Every hourly new receipt retains the 24 closed rows plus state for each configured normalized K-line dataset; 3d has raw storage only. Includes eventual normalized deletion in the write estimate.',
    checkpointAssumption: 'One object construction/restart per day normal, three per day fault; every restart resets seven checkpoints. Include seven one-time initialization writes and seven first-create index writes conservatively every day, plus an end-gap write per interval per restart. Fault scenarios add two true gap episodes per interval/day, each begin+end. These counts are scenario allowances, not measured restart rates.',
  };
  const hourlyNormalizedRowsDaily = hourlyReconciliation.normalizedIntervals * hourlyReconciliation.passesPerDay * hourlyReconciliation.closedBarsPerPass;
  const macroReceiptRowsDaily = Object.values(definitions).filter(d => ['fred', 'sofr'].includes(d.kind))
    .reduce((sum, d) => sum + DAY / Math.max(d.refreshSeconds, providers[d.provider].ttl), 0);
  // Use the measured 1000-key FRED receipt size for smaller SOFR receipts too,
  // plus 1KiB per row for row/index overhead; no deletion savings are assumed.
  const macroReceiptStorageGBMonth = macroReceiptRowsDaily * DAYS * (macroReceiptBytes + 1024) / 1e9 / 2;
  assert.equal(scheduler.DATASET_GAP_RETRY_MS, 30 * 60 * 1000);
  assert.equal(scheduler.DATASET_GAP_RETRY_MAX_MS, 6 * 60 * 60 * 1000);
  const gapRetryTimes = [];
  for (let at = 0, failures = 1; at < DAY * 1000; failures++) {
    gapRetryTimes.push(at);
    at += Math.min(scheduler.DATASET_GAP_RETRY_MAX_MS, scheduler.DATASET_GAP_RETRY_MS * 2 ** (failures - 1));
  }
  const gapRetryBudget = { firstDayAttempts: gapRetryTimes.length, firstDayHours: gapRetryTimes.map(ms => ms / 3600000),
    steadyAttemptsPerDay: DAY * 1000 / scheduler.DATASET_GAP_RETRY_MAX_MS };
  assert.equal(gapRetryBudget.firstDayAttempts, 7);
  assert.equal(gapRetryBudget.steadyAttemptsPerDay, 4);
  const deskFundingInfoReadBudget = {
    dataset: fundingInfoId, addedDatasetReadsPerContext: 1, sqlStatementsPerDatasetRead: fundingInfoQueries.length,
    retainedRowsNormal: store.datasetRetention(fundingInfoId).keep, fixtureRowsBeforePrune: fundingInfoFixtureRows,
    activeContextPages: 1, refreshSeconds: 15, requestsPerDay: DAY / 15,
    estimatedRowsReadPerRequest: 1000, estimatedAdditionalReadsPerDay: DAY / 15 * 1000,
    estimatedAdditionalReadsPer31Days: DAY / 15 * 1000 * DAYS,
    marginalUsdPer31DaysIfAlreadyAboveD1IncludedReads: DAY / 15 * 1000 * DAYS / MILLION * .001,
    evidence: 'desk context adds exactly one funding-info readDataset; real replay executes metadata, observations and COUNT queries with zero writes. 31-row fixture (keep30 plus one daily receipt) uses indexed outer selection and correlated indexed MAX lookups. Local SQLite query plans prove query structure, not Cloudflare billed rows.',
    assumption: 'One context page open 24h/day at the existing derivatives.js 15s timer, without cache savings. Reserve 1000 scanned rows per added dataset read, above the roughly 1+2*(31 outer rows+31 indexed per-key lookups) logical-row estimate. Index/table metering and larger backlogs must be calibrated with deployed D1 meta/Analytics. Additional users, manual refreshes, workers and retained rows may exceed this allowance; query-growth scenarios multiply it separately with all other reads. Adds no acquisition/upstream request or D1 write.',
  };
  assert.equal(deskFundingInfoReadBudget.estimatedAdditionalReadsPer31Days, 178560000);
  const assumptions = {
    period: 'Keep future complete 31-day scenarios separate from current Sep16–Oct15 (30-day) cycle. Wrangler billing API was 403, but signed-in browser DOM verified current cycle/usage. Current-cycle projections add 19 or conservatively 20 days of new architecture usage to reported accrued usage; no invoice/final-charge assertion.',
    sqlite: 'SQLite total_changes validates logical mutations only. Index writes are estimated from actual schema and SQL columns, calibrated by historical D1 Insights insert multipliers. Cloudflare meta/Analytics must validate billed rows after deployment.',
    cycle: 'Virtual 1-second owner alarm; KLINE_LIVE_MIN_CYCLE_MS imposes start-to-start 5s and completion-to-start >=1s. Seven-period writes use three concurrent I/O lanes. Premium follows K-line flush. OI/book snapshot task runs independently at its own 5s due gate: model 17,280 receipts/day EACH even when forming K-line cycle is 10s (slow snapshot I/O can reduce this rate; never infer lower cost from that). Pre-cutover 66.339s/33-read sample had 7 distinct 5m storedAt values, six gaps 10213/10947/10287/10350/8364/9309ms, mean 9911.67ms. Normal modeled 10s is a short-sample assumption, not post-fix measurement or long-term P95. All scenarios operate 24h/day.',
    index: 'Each row insert/delete adds all schema indexes (including auto primary-key index); update adds only indexes whose columns appear in SET. Unchanged indexed columns in nonkey UPSERT are excluded; Cloudflare validation outstanding.',
    cleanup: 'Premium/OI/book deletion is modeled as generated observations up to 24 hourly passes ×1000. An independent old-backlog scenario fills all THREE remaining deletion ceilings and includes those writes and retries in the total. It assumes enough old rows for the entire month; it is not a measured backlog. History cost conservatively includes eventual observation deletion, even though retained revisions may stay longer than this billing month.',
    history: '13 configured Binance historical datasets: full500 daily plus tail2 at current due intervals; perp klines live suppresses ordinary tails. Funding may return >2 actual settlements; fault scenario includes extra full recovery passes.',
    hourlyReconciliation: 'All seven raw periods reread the latest 24 closed bars hourly; six normalized periods preserve REST receipt evidence. Raw writes use the all-insert/index upper estimate, normalized writes are replayed, eventual deletion and retained receipt storage are included. New checkpoint rows and two DO RPCs per interval/hour are added separately; no reduction to liquidation sampling.',
    unmodeledD1: '150,000 writes/day reserved for footprint, derivatives, onchain, health, non-Binance value revisions, raw chunks and manual/background activity. Macro lightweight receipts/state are budgeted separately using the real replay. This explicit allowance is not measured new-code residual; combined all-path stress uses 5×. It includes 29,210 historical health writes/day. Close/rollover edge writes are separate.',
    macroReceipts: 'FRED new hourly receipts retain 1000-key receipt evidence plus state (4 indexed writes), not 1000 unchanged payloads. SOFR follows its longer provider cache TTL. All macro receipts use the replayed 1000-key FRED byte size plus 1KiB overhead and grow through the month without deletion credit. Genuine payload/vintage revisions, initial loads and raw cache remain in the explicit other-path allowance.',
    reads: 'Keep the entire observed 229,003,417 D1 reads/day (including 220.9m old prune scans), then ADD the new desk funding-info reserve of 5,760,000 reads/day explicitly. The added reserve assumes one 24h context page at 15s and 1000 scanned rows/readDataset; it is not a measured free query. 3x/5x WebSocket messages do not automatically multiply queries. Explicit query-growth scenarios multiply both components. SQLite replay does not measure Cloudflare rows scanned.',
    otherProjects: 'Other D1 write allowance 3,000,000/month against observed September-to-date 530,000; CPU projects yeswood-jobs observed 25,959,173 ms/26×31 plus 1,000,000 ms reserve. Combined all-path stress reserves at least 60,000,000 other CPU ms. Other Worker request reserve 1,000,000/month. These are assumptions, not future account caps.',
    storage: 'Account D1 measured approximately 514 MB on Sep26 (btc 53,923,840 bytes). Projected D1 adds all generated historical receipts INCLUDING extra fault catchups at 1KiB/row averaged over the month (ignores their deletions), explicit premium backlog growth, plus 0.25 GB-month other growth reserve. The old-backlog scenario adds a hypothetical initial backlog drained evenly over the month at 1KiB/row, on top of measured account storage; this may double-count existing rows conservatively. Ambiguous same-receipt retries do not create new observation identities. DO SQLite uses 0.1 GB-month allowance (30d/100k actual BTC events at 200B plus 17k buckets at 500B is ~30MB before internal/index overhead), not measured recovery storage. Other projects can grow.',
    closedBars: 'Closed confirmations run separately with 1s coordination. 7 intervals produce 415.48 closes/day; actual 5m close replay is 6 writes plus 3 eventual normalized deletion. Add raw/open normalized insertion index overhead and raw retention deletes separately. This conservatively treats 3d as if normalized too.',
    liquidation: '1,000 actual BTC liquidation events/day normal, 3×/5× stress; not all 3.157m WS frames. Two venues at most 576 closed 5m buckets/day. Actual event count unavailable; recoverable event, first-bucket index overhead, one persisted D1 baseline seed per bucket, acknowledge, and cleanup included. A repeated already-loaded seed writes zero rows in replay.',
    retry: 'Fault scenario conservatively replays 10% D1 write operations after ambiguous acknowledgments and adds two extra 500-row historical catchups per dataset/day, each with pending/CAS-clear dataset-state writes. Idempotence may lower actual duplicate writes.',
    persistentGapSensitivity: 'Independent persistent-gap scenario assumes seven extra successful 500-row attempts per dataset EVERY day for 31 days, plus 10% ambiguous writes and all three snapshot backlogs. This conservatively repeats the exponential-backoff first-day ceiling derived from the exported 30min base/6h cap (asserted in replay), instead of dropping to its four-attempt steady day; it does not assume that retries actually return 500 new rows, or replace current-tail collection.',
    do: 'One continuously resident 128MB (0.128GB) object, 86,400 alarm invocations and setAlarm writes/day, plus observed 19,802 daily invocations as a conservative extra reserve. Messages billed 20:1. D1 and DO SQLite allocations kept separate.',
  };
  assert.equal(live.KLINE_LIVE_MIN_CYCLE_MS, 5000, 'review model if the actual cycle floor changes');
  assert.equal(live.KLINE_LIVE_SNAPSHOT_MS, 5000, 'review independent snapshot rate if source gate changes');
  assert.equal(live.KLINE_LIVE_WRITE_CONCURRENCY, 3, 'review latency assumption if source concurrency changes');
  assert.equal(cadence(9000, live.KLINE_LIVE_SNAPSHOT_MS, live.KLINE_LIVE_MIN_CYCLE_MS).snapshots, 17280);
  function scenario(id, bodyMs, messagesMultiple, faultRate, otherMultiple, readMultiple = 1, minimumCycleMs = live.KLINE_LIVE_MIN_CYCLE_MS,
    { oldSnapshotBacklog = false, historyCatchupsPerDataset = faultRate ? 2 : 0 } = {}) {
    const clock = cadence(bodyMs, live.KLINE_LIVE_SNAPSHOT_MS, minimumCycleMs);
    const cleanupCap = 24 * 1000;
    const premiumDelete = Math.min(clock.cycles, cleanupCap) * 3;
    const snapshotDelete = Math.min(clock.snapshots, cleanupCap) * 3 * 2;
    const extraHistoryPassesPerDataset = historyCatchupsPerDataset;
    const extraHistoryRowsDaily = history.length * extraHistoryPassesPerDataset * 500;
    const extraHistory = history.length * extraHistoryPassesPerDataset * (replay.historyFull500.estimatedBillableWrites + 500 * 3);
    const oldBacklogRowsDeletedDaily = {
      premium: Math.max(0, cleanupCap - clock.cycles),
      oi: Math.max(0, cleanupCap - clock.snapshots),
      book: Math.max(0, cleanupCap - clock.snapshots),
    };
    const allOldBacklogRowsDaily = Object.values(oldBacklogRowsDeletedDaily).reduce((sum, rows) => sum + rows, 0);
    const closesPerDay = [300,900,3600,14400,86400,259200,604800].reduce((sum, seconds) => sum + DAY / seconds, 0);
    const components = {
      klineAndState: clock.cycles * replay.changedSevenKlines.estimatedBillableWrites,
      premiumInsertAndState: clock.cycles * replay.premium.estimatedBillableWrites,
      oiBookInsertAndState: clock.snapshots * (replay.oi.estimatedBillableWrites + replay.book.estimatedBillableWrites),
      snapshotCleanup: premiumDelete + snapshotDelete,
      snapshotOldBacklogCleanup: oldSnapshotBacklog ? allOldBacklogRowsDaily * 3 : 0,
      historyTailAuditAndEventualCleanup: historyDaily + extraHistory,
      historyGapStateTransitions: history.length * extraHistoryPassesPerDataset * 2,
      unmodeledOtherPathsAllowance: 150000 * otherMultiple,
      hourlyRawKlineReconcile: hourlyReconciliation.passesPerDay * hourlyReconciliation.intervals * (hourlyReconciliation.closedBarsPerPass * 3 + 2),
      hourlyNormalizedKlineReconcile: hourlyReconciliation.passesPerDay * hourlyReconciliation.normalizedIntervals * replay.hourlyRestClosed24NewReceipt.estimatedBillableWrites + hourlyNormalizedRowsDaily * 3,
      macroReceiptsAndState: macroReceiptRowsDaily * replay.fredNewQueryWindow.estimatedBillableWrites * otherMultiple,
      closedBarAndRolloverWithCleanup: closesPerDay * (replay.confirmedClosedBar.estimatedBillableWrites + 3 + 2 + 2 + 3),
    };
    const preRetry = Object.values(components).reduce((sum, v) => sum + v, 0);
    components.ambiguousRetryAllowance = preRetry * faultRate;
    const dailyWrites = preRetry + components.ambiguousRetryAllowance;
    const events = 1000 * messagesMultiple, buckets = 576;
    const restartCount = faultRate ? 3 : 1;
    const localWriteComponents = {
      alarms: DAY,
      events: events * replay.liquidationNextEvent.estimatedBillableWrites,
      firstBucketIndexOverhead: buckets * (replay.liquidationFirstEvent.estimatedBillableWrites - replay.liquidationNextEvent.estimatedBillableWrites),
      seed: buckets * replay.liquidationSeed.estimatedBillableWrites,
      acknowledge: buckets * replay.liquidationAcknowledge.estimatedBillableWrites,
      eventCleanup: Math.min(events, 24 * 500) * 3,
      bucketCleanup: buckets * 3,
      klineRecoveryRestarts: restartCount * replay.klineRecoveryRestart.estimatedBillableWrites,
      klineRecoveryInitializeAllowance: replay.klineRecoveryInitialize.estimatedBillableWrites,
      klineRecoveryFirstStartIndexAllowance: replay.klineRecoveryFirstStart.estimatedBillableWrites - replay.klineRecoveryRestart.estimatedBillableWrites,
      klineRecoveryRestartEndGaps: restartCount * replay.klineRecoveryEndGaps.estimatedBillableWrites,
      klineRecoveryHourlyAcknowledge: hourlyReconciliation.passesPerDay * replay.klineRecoveryAcknowledge.estimatedBillableWrites,
      klineRecoveryExtraGapEpisodes: faultRate ? 2 * (replay.klineRecoveryBeginGaps.estimatedBillableWrites + replay.klineRecoveryEndGaps.estimatedBillableWrites) : 0,
    };
    const localWrites = Object.values(localWriteComponents).reduce((sum, writes) => sum + writes, 0);
    const retainedPremiumRows = Math.max(0, clock.cycles - cleanupCap) * DAYS;
    const historicalRowsMonthly = (historyRowsGeneratedDaily + hourlyNormalizedRowsDaily + extraHistoryRowsDaily) * DAYS;
    const oldBacklogStorageGBMonth = oldSnapshotBacklog ? allOldBacklogRowsDaily * DAYS * 1024 / 1e9 / 2 : 0;
    const dailyReadComponents = { observedBaseline: baseline.d1Reads * readMultiple,
      addedDeskFundingInfo: deskFundingInfoReadBudget.estimatedAdditionalReadsPerDay * readMultiple };
    const usage = {
      d1Writes: Math.ceil(dailyWrites * DAYS + 3000000),
      d1Reads: Object.values(dailyReadComponents).reduce((sum, reads) => sum + reads, 0) * DAYS,
      d1StorageGBMonth: .514 + (retainedPremiumRows + historicalRowsMonthly) * 1024 / 1e9 / 2 + .25 + oldBacklogStorageGBMonth + macroReceiptStorageGBMonth * otherMultiple,
      doRequests: (baseline.inboundWebSocketMessages * messagesMultiple / 20 + DAY + baseline.doInvocations + hourlyReconciliation.intervals * hourlyReconciliation.passesPerDay * 2) * DAYS,
      doDurationGBs: .128 * DAY * DAYS,
      doSqliteWrites: localWrites * DAYS, doSqliteReads: (events * 2 + buckets * 31 * 1440 + DAY + restartCount * live.KLINE_LIVE_INTERVALS.length) * DAYS,
      doSqliteGBMonth: .1,
      workerRequests: baseline.btcWorkerRequests * DAYS * otherMultiple + 1e6,
      workerCpuMs: baseline.btcWorkerCpuMs * DAYS * otherMultiple + Math.max(baseline.yeswoodJobsCpuThroughSep26 / 26 * DAYS + 1e6, otherMultiple > 1 ? 60e6 : 0),
    };
    const cost = prices(usage);
    return { id, messagesMultiple, faultRate, otherPathMultiple: otherMultiple, readMultiple, minimumCycleMs, oldSnapshotBacklog, historyCatchupsPerDataset,
      cadence: clock, dailyD1Writes: round(dailyWrites), dailyWriteComponents: components, dailyDoSqliteWriteComponents: localWriteComponents, dailyReadComponents,
      storage: { historicalRowsMonthly, extraHistoryRowsDaily, extraHistoryRowsMonthly: extraHistoryRowsDaily * DAYS, oldBacklogStorageGBMonth,
        macroReceiptRowsDaily: macroReceiptRowsDaily * otherMultiple, macroReceiptBytes, macroReceiptStorageGBMonth: macroReceiptStorageGBMonth * otherMultiple },
      cleanup: { premiumRowsAdded: clock.cycles, premiumRowsDeletedCeiling: cleanupCap, premiumBacklogGrowthRowsPerDay: Math.max(0, clock.cycles - cleanupCap),
        oiRowsAdded: clock.snapshots, bookRowsAdded: clock.snapshots, eachSnapshotRowsDeletedCeiling: cleanupCap,
        oiBookBacklogGrowthRowsPerDay: Math.max(0, clock.snapshots - cleanupCap) * 2,
        oldBacklogRowsDeletedDaily, hypotheticalInitialOldBacklogRows: allOldBacklogRowsDaily * DAYS,
        extraMonthlyWritesIfAllThreeOldBacklogsUseFullCleanupCeiling: allOldBacklogRowsDaily * 3 * DAYS * (1 + faultRate),
        oldBacklogWritesIncludedInTotal: oldSnapshotBacklog },
      monthlyUsage: usage, monthlyCostUsd: cost, within10DollarProjection: cost.total <= 10,
      headroom: { d1IncludedWrites: Math.floor(50e6 - usage.d1Writes), doDurationGBs: round(400000 - usage.doDurationGBs),
        doSqliteIncludedWrites: 50e6 - usage.doSqliteWrites, workerCpuIncludedMs: Math.floor(30e6 - usage.workerCpuMs) } };
  }
  const scenarios = [scenario('normal_observed_10s', 9000, 1, 0, 1), scenario('fastest_network_guarded_5s', 0, 1, 0, 1),
    scenario('threefold_messages_guarded_5s', 0, 3, 0, 1), scenario('fivefold_messages_guarded_5s', 0, 5, 0, 1),
    scenario('fivefold_messages_retry_and_catchup_guarded_5s', 0, 5, .1, 1),
    scenario('fivefold_messages_retry_catchup_and_all_snapshot_backlogs', 0, 5, .1, 1, 1, live.KLINE_LIVE_MIN_CYCLE_MS, { oldSnapshotBacklog: true }),
    scenario('fivefold_messages_persistent_gap_retry_and_all_snapshot_backlogs', 0, 5, .1, 1, 1, live.KLINE_LIVE_MIN_CYCLE_MS,
      { oldSnapshotBacklog: true, historyCatchupsPerDataset: gapRetryBudget.firstDayAttempts }),
    scenario('fivefold_all_paths_and_queries_retry_guarded_5s', 0, 5, .1, 5, 5),
    scenario('counterexample_without_floor_fastest_1s', 0, 1, 0, 1, 1, 1000)];
  const faultScenario = scenarios.find(s => s.id === 'fivefold_messages_retry_and_catchup_guarded_5s');
  const backlogScenario = scenarios.find(s => s.oldSnapshotBacklog);
  const noFaultScenario = scenarios.find(s => s.id === 'fivefold_messages_guarded_5s');
  assert.equal(faultScenario.storage.extraHistoryRowsMonthly, 403000);
  assert.equal(round(faultScenario.monthlyUsage.d1StorageGBMonth - noFaultScenario.monthlyUsage.d1StorageGBMonth, 6), .206336);
  assert.equal(backlogScenario.monthlyUsage.d1Writes - faultScenario.monthlyUsage.d1Writes, 2062368);
  assert.equal(backlogScenario.dailyWriteComponents.snapshotOldBacklogCleanup, (24000 - 17280) * 3 * 3);
  assert.equal(faultScenario.dailyDoSqliteWriteComponents.seed, 576);
  assert.equal(faultScenario.monthlyUsage.d1Reads - baseline.d1Reads * DAYS, 178560000);
  assert.equal(scenarios.find(s => s.readMultiple === 5).dailyReadComponents.addedDeskFundingInfo, 28800000);
  const singleVariableSensitivities = [
    { id: 'other_background_writes_460k_per_day', label: '其他背景写入从 150k 增到 460k/日（含 10% 重试）',
      override: { d1Writes: faultScenario.monthlyUsage.d1Writes + (460000 - 150000) * DAYS * 1.1 } },
    { id: 'websocket_messages_6_1x', label: 'WS 从 5 倍增到 6.1 倍，仅改变消息请求费',
      override: { doRequests: faultScenario.monthlyUsage.doRequests + baseline.inboundWebSocketMessages * 1.1 / 20 * DAYS } },
    { id: 'additional_worker_cpu_42m_ms', label: '其他 Worker 额外增加 42m CPU ms（约 11.67 CPU 小时）',
      override: { workerCpuMs: faultScenario.monthlyUsage.workerCpuMs + 42e6 } },
    { id: 'd1_reads_3_65x', label: 'D1 扫描行数增至基线 3.65 倍',
      override: { d1Reads: faultScenario.monthlyUsage.d1Reads * 3.65 } },
  ].map(({ override, ...description }) => {
    const usage = { ...faultScenario.monthlyUsage, ...override }, cost = prices(usage);
    return { ...description, period: 'future_complete_31_days', baseScenario: faultScenario.id,
      changedUsage: override, monthlyCostUsd: cost, within10DollarProjection: cost.total <= 10 };
  });
  // Assert billable-unit boundaries independently of scenario totals.
  assert.equal(prices({ ...faultScenario.monthlyUsage, doDurationGBs: 400000 }).doDuration, 0);
  assert.equal(prices({ ...faultScenario.monthlyUsage, doDurationGBs: 400001 }).doDuration, 12.5);
  assert.equal(prices({ ...faultScenario.monthlyUsage, doRequests: 1000000 }).doRequests, 0);
  assert.equal(prices({ ...faultScenario.monthlyUsage, doRequests: 1000001 }).doRequests, .15);
  assert.equal(prices({ ...faultScenario.monthlyUsage, doRequests: 2000001 }).doRequests, .3);
  assert.ok(singleVariableSensitivities.every(s => !s.within10DollarProjection));
  const currentCycleProjections = scenarios.flatMap(s => currentBillingCycle.remainingDays.map(remainingDays => {
    const accrued = currentBillingCycle.accrued;
    const usage = {};
    for (const key of ['d1Writes','d1Reads','doRequests','doDurationGBs','workerRequests','workerCpuMs']) {
      usage[key] = accrued[key] + s.monthlyUsage[key] / DAYS * remainingDays;
    }
    usage.doSqliteWrites = currentBillingCycle.unreportedDoSqliteRowsReserve.writes + s.monthlyUsage.doSqliteWrites / DAYS * remainingDays;
    usage.doSqliteReads = currentBillingCycle.unreportedDoSqliteRowsReserve.reads + s.monthlyUsage.doSqliteReads / DAYS * remainingDays;
    // Accrued GB-month is already integrated; add only remaining-period occupancy.
    usage.d1StorageGBMonth = accrued.d1StorageGBMonth + s.monthlyUsage.d1StorageGBMonth * remainingDays / currentBillingCycle.periodDays;
    usage.doSqliteGBMonth = accrued.doSqliteGBMonth + s.monthlyUsage.doSqliteGBMonth * remainingDays / currentBillingCycle.periodDays;
    for (const key of ['r2StorageGBMonth','r2ClassA','r2ClassB','queueOperations']) {
      usage[key] = accrued[key] * (1 + remainingDays / currentBillingCycle.displayedObservationDays);
    }
    const cost = prices(usage);
    return { scenario: s.id, remainingDays, projectedWholeCycleUsage: usage, projectedWholeCycleCostUsd: cost,
      // The accrued $0.15 is included in whole-cycle rounded DO requests; never add it twice.
      projectedAdditionalUsageAboveBaseUsd: round(cost.total - 5),
      increaseFromDisplayedAdditionalUsageUsd: round(cost.total - 5 - currentBillingCycle.observedAdditionalUsageUsd),
      within10DollarProjection: cost.total <= 10,
      remainingIncludedDoDurationGBs: round(400000 - usage.doDurationGBs),
      remainingIncludedD1Writes: Math.floor(50e6 - usage.d1Writes),
    };
  }));
  const observedCost = prices({ ...currentBillingCycle.accrued, doSqliteWrites: 0, doSqliteReads: 0 });
  assert.equal(observedCost.total, 5.15, 'reported current usage should reconcile with known priced metrics');
  assert.equal(currentCycleProjections.find(s => s.scenario === 'fastest_network_guarded_5s' && s.remainingDays === 20).remainingIncludedDoDurationGBs, 14896);
  const durationRisk = {
    reportedRemainingGBs: 400000 - currentBillingCycle.accrued.doDurationGBs,
    oneObject19DaysGBs: .128 * DAY * 19, oneObject20DaysGBs: .128 * DAY * 20,
    remainingAfter20DaysGBs: 400000 - currentBillingCycle.accrued.doDurationGBs - .128 * DAY * 20,
    remainingAfter20DaysEquivalentAdditionalObjectHours: round((400000 - currentBillingCycle.accrued.doDurationGBs - .128 * DAY * 20) / .128 / 3600),
    extraCostOnFirstExcessGBsUsd: 12.5,
    limitation: 'Only 14,896 GB-s modeled headroom remains at the 20-day endpoint. Unreported/rounded usage, an unretired old object, overlap during restarts or another active DO can cross the 400k threshold and add at least $12.50. Existing reported usage is not an exact real-time remaining allowance.',
  };
  const currentCycleFault = currentCycleProjections.find(s => s.scenario === faultScenario.id && s.remainingDays === 20);
  const currentCycleDurationSensitivities = [32, 33].map(extraObjectHours => {
    const usage = { ...currentCycleFault.projectedWholeCycleUsage,
      doDurationGBs: currentCycleFault.projectedWholeCycleUsage.doDurationGBs + .128 * extraObjectHours * 3600 };
    const cost = prices(usage);
    return { period: 'current_Sep16_Oct15', baseScenario: currentCycleFault.scenario, remainingDays: 20,
      extraObjectHours, extraDurationGBs: .128 * extraObjectHours * 3600, durationGBs: usage.doDurationGBs,
      projectedWholeCycleCostUsd: cost, additionalDurationUsd: round(cost.doDuration - currentCycleFault.projectedWholeCycleCostUsd.doDuration),
      limitation: 'Duration-only sensitivity; does not assume a second object is running or price its extra requests/storage. Any such costs would be additional.' };
  });
  assert.equal(currentCycleDurationSensitivities[0].additionalDurationUsd, 0);
  assert.equal(currentCycleDurationSensitivities[1].additionalDurationUsd, 12.5);
  if (checkOnly) {
    console.log(JSON.stringify({ status: 'PASS', mode: 'check-only-no-artifacts-or-fingerprints', actualSqlReplayCases: Object.keys(replay).length,
      scenarios: scenarios.map(s => ({ id: s.id, dailyD1Writes: s.dailyD1Writes, usdPer31Days: s.monthlyCostUsd.total })),
      boundaryChecks: { extraCatchupRows: faultScenario.storage.extraHistoryRowsMonthly,
        deskFundingInfoReadBudget,
        oldBacklogAdditionalMonthlyWrites: backlogScenario.monthlyUsage.d1Writes - faultScenario.monthlyUsage.d1Writes,
        seedDailyWrites: faultScenario.dailyDoSqliteWriteComponents.seed,
        singleVariableSensitivities: singleVariableSensitivities.map(s => ({ id: s.id, usdPer31Days: s.monthlyCostUsd.total })),
        currentCycleDurationSensitivities: currentCycleDurationSensitivities.map(s => ({ extraObjectHours: s.extraObjectHours, wholeCycleUsd: s.projectedWholeCycleCostUsd.total })) } }, null, 2));
    return;
  }
  const fingerprints = Object.fromEntries(['scripts/dev/simulate-cloudflare-governance.cjs','cloudflare/binance-klines-worker.js','cloudflare/kline-live-collector.mjs','cloudflare/liquidation-recovery.mjs','cloudflare/kline-recovery.mjs',
    'cloudflare/finance/dataset-store.mjs','cloudflare/finance/datasets.mjs','cloudflare/finance/scheduler.mjs','cloudflare/finance/store.mjs',
    'cloudflare/finance/gateway.mjs','cloudflare/finance/registry.mjs','cloudflare/finance/desk.mjs','js/pages/derivatives.js',
    'cloudflare/schema.sql','cloudflare/finance/schema.sql','cloudflare/finance/dataset-schema.sql'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
  const result = { generatedAt: new Date().toISOString(), command, network: 'blocked by fetch tripwire', remoteWrites: false,
    officialPricingVerifiedOn: '2026-09-26', durableObjectsPricingUpdated: '2026-08-25', sources, baseline, assumptions, fingerprints, shortWindowCorroboration,
    replay, history, historyRowsGeneratedDaily, hourlyReconciliation, hourlyNormalizedRowsDaily, gapRetryBudget, deskFundingInfoReadBudget, scenarios, currentBillingCycle, currentCycleProjections, durationRisk,
    singleVariableSensitivities, currentCycleDurationSensitivities,
    sensitivity: { secondFullTimeDOExtraDurationUsd: 12.5, oneDoHoursBefore400kGBs: round(400000 / .128 / 3600),
      extraMillionD1WritesUsd: 1, extraGBMonthD1Above5Usd: .75, extraMillionDoMessagesRequestUnits: 50000,
      oneSecondCoreKlineWritesOnly: replay.changedSevenKlines.estimatedBillableWrites * DAY * DAYS,
      oneSecondCoreKlineD1ExcessUsdOnly: round(Math.max(0, replay.changedSevenKlines.estimatedBillableWrites * DAY * DAYS - 50e6) / MILLION) },
    verdict: 'Actual 5s minimum avoids dependence on slow networking. Normal and 3–5x WebSocket plus modeled catchup/backlog scenarios fit $5–10 under explicit allowances. Even one variable crossing a listed sensitivity threshold can exceed $10; this is not an all-traffic 5x guarantee, a hard account cap, billed-usage measurement or invoice forecast.' };
  fs.mkdirSync(path.dirname(outputBase), { recursive: true }); fs.writeFileSync(outputBase + '.json', JSON.stringify(result, null, 2) + '\n');
  const lines = ['# Cloudflare 成本治理：可重复离线模拟', '', `- 执行：\`${command}\`。生成时间：${result.generatedAt}。无网络、无凭据、无远程写入。`,
    '- 结论：当前代码 5 秒起始间隔下限不依赖网络慢；常态、3–5 倍 WS 消息和列明的故障补采/积压假设可落入 $5–10/月。单独一项达到下表敏感度条件也能超过 $10；不是所有流量同时五倍的保证，也不是账号硬封顶。',
    '- 口径：下表是未来完整 31 天，含 $5 基础费。真实账期已通过登录浏览器 DOM 核实为 2026-09-16 至 2026-10-15（30 天）；Wrangler 账单 API 403 不再表示账期未知。', '',
    '| 情景 | 循环/日 | D1 写/日 | D1 写/月 | 总额美元/月 | 预算判断 |', '| --- | ---: | ---: | ---: | ---: | --- |',
    ...scenarios.map(s => `| ${s.id} | ${s.cadence.cycles} | ${round(s.dailyD1Writes)} | ${s.monthlyUsage.d1Writes} | $${s.monthlyCostUsd.total.toFixed(2)} | ${s.within10DollarProjection ? '假设成立时满足' : '不满足'} |`), '',
    `- 故障补采新增 ${faultScenario.storage.extraHistoryRowsMonthly.toLocaleString('en-US')} 行/月已同步纳入 D1 存储；按 1 KiB/行和月均存储估算增加 0.206336 GB-month。首次强平桶 seed 增加 576 DO SQLite 写/日。三路旧积压清满情景实际加计 ${backlogScenario.cleanup.extraMonthlyWritesIfAllThreeOldBacklogsUseFullCleanupCeiling.toLocaleString('en-US')} 写/月（含重试），并增加假设积压的存储占用；积压数量未实测。`, '',
    '- 持续旧缺口另列极端情景：每个历史集每天额外 7 次、每次 500 行、连续 31 天，并叠加 10% 重试和三路旧积压。即使上游实际返回空页或失败，这里仍按完整有效数据写入估算；它保留正常 tail 采集，不能与普通每天 2 次补采情景混为一谈。', '',
    '- desk/context 新增 funding-info 读取已另加：一页全天打开、每 15 秒刷新、每次新增 readDataset 预留 1,000 扫描行，即 5.76m 读/日、178.56m 读/31 天。真实函数回放为 3 条 SQL、0 写；31 行 fixture 的索引计划不能冒充 Cloudflare rows_read。已超 D1 读额度时该增量约 $0.17856/月；本模型常态仍在额度内，多页面、手动请求和清理积压需要按实际用量调高。', '',
    '- 最终调度校准：7 周期最多 3 路并发，K 线起始间隔仍至少 5 秒；premium 跟随 K 线 flush。OI 与盘口已经独立按 5 秒到期，因此每项均按 **17,280 次/日**估写，10 秒 K 线情景也不减半。两项各自每小时 1,000 行的清理上限为 **24,000 行/日**，高于新增速率；完整 31 天及当前账期使用同一日速率。', '',
    '## 当前账期：已报告用量 + 新架构余期', '',
    '- 已登录 Cloudflare 账单 DOM 核验：观察 Sep16–Sep26 共 11 天，当前额外用量费 $0.15；DO requests 显示 1.18M，超额明细 184.54k（模型取 1,184,540）；DO duration 163.92k GB-s；D1 写 10.85M、读 1.12B；CPU 11.15M ms、Worker 请求 79.88k；D1 存储 0.16 GB-month，DO 存储显示 0。金额与简写计数存在取整。',
    '- R2 存储 2.71 GB-month，Class A 26.6k、Class B 63.31k，Queues 13.26k，目前均无额外费用；余期仅沿用这些产品的已观测速率，不假设其他项目不会增长。',
    '- 19 个完整日作为下端；加观察日最多约 0.5 日后向上取整至 20 日作为保守端。页面按过去 11 天推算的 $0.41 不用于新架构预测。已产生 $0.15 已包含在整账期 DO 请求计费中，不重复相加。', '',
    '| 情景 | 余期天数 | 整账期估计总额（含 $5） | 整账期额外用量费 | D1 写入余量 | DO 时长余量 GB-s |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...currentCycleProjections.map(s => `| ${s.scenario} | ${s.remainingDays} | $${s.projectedWholeCycleCostUsd.total.toFixed(2)} | $${s.projectedAdditionalUsageAboveBaseUsd.toFixed(2)} | ${s.remainingIncludedD1Writes} | ${s.remainingIncludedDoDurationGBs} |`), '',
    '- DO 已报告剩余额度 236,080 GB-s；单个 128 MB 对象再运行 20 天需 221,184 GB-s，只余 **14,896 GB-s**（约另一个同大小对象 32.33 小时）。迟报用量、旧实例未退役或其他 DO 可能越线，首次越线按计费单位取整至少加 **$12.50**；不能据此保证本期低于 $10。',
    '- 已完整读取旧治理版本 13:15–13:35 UTC 的 20 分钟旁证（13:43 查询）：D1 写 9,799、读 1,841,576，其中清理突发读 1,734,770；四个 DO 五分钟桶各约 38.400 GB-s，报告中只有当前一个 namespace 有用量，旧 namespace 为零。朴素外推会得到 705,528 写/日，但模型不采用该短窗日率，也不把它当作本轮尚未部署的恢复/宏观修复证据。',
    '- DO SQLite 已发生行计数未提供，模型另留 1m 写/1b 读假设余量，不能把存储显示 0 当成行数为 0。', '',
    '## 独立敏感度：不是已观测事实', '',
    `- 下表均以未来完整 31 天的 ${faultScenario.id}（$${faultScenario.monthlyCostUsd.total.toFixed(2)}）为起点，每次仅改变一项；不混入当前账期。`, '',
    '| 唯一改变项 | 完整 31 天总额 |', '| --- | ---: |',
    ...singleVariableSensitivities.map(s => `| ${s.label} | $${s.monthlyCostUsd.total.toFixed(2)} |`), '',
    '- 当前 Sep16–Oct15 账期的第二个 DO 时长风险另算：以剩余 20 日的五倍 WS＋故障补采情景为起点，仅增加另一实例的活跃时长；未假设实际存在该实例，额外请求/存储费尚未加入。', '',
    '| 另一 DO 额外活跃时长 | 当前整账期估算总额 | 仅时长增加费用 |', '| --- | ---: | ---: |',
    ...currentCycleDurationSensitivities.map(s => `| ${s.extraObjectHours} 小时 | $${s.projectedWholeCycleCostUsd.total.toFixed(2)} | $${s.additionalDurationUsd.toFixed(2)} |`), '',
    '## 真实函数回放', '',
    '| 路径 | SQLite 逻辑变更 | 含索引估算写 |', '| --- | ---: | ---: |',
    ...Object.entries(replay).map(([name, r]) => `| ${name} | ${r.logicalChanges} | ${r.estimatedBillableWrites} |`), '',
    '- 回放直接调用当前 Worker hooks、KlineLiveComponent.persistOne、finance scheduler/store、LiquidationRecovery，并在 node:sqlite 执行真实 SQL。SQLite changes 不含索引，不能冒充 Cloudflare rows_written；含索引列为依据 schema 与 SQL 推算，部署后需用 D1 meta/Analytics 校准。',
    '- 每秒仅 7 周期 K 线及状态已估算 26 写 × 86,400 × 31 = 69,638,400 写；即使排除 premium、OI、盘口、清理与其他项目，D1 超额已约 $19.64。',
    '- 无 5 秒门槛的反例：premium 1 秒一条时新增 86,400 观察/日，而每小时 1,000 删除仅 24,000/日，会增长约 62,400 行/日；当前最快 5 秒为 17,280/日，低于该清理吞吐上限。',
    '- 时效依据只有 66.339 秒线上采样（33 次读、7 个不同 storedAt，平均间隔 9.912 秒），不能当作长期 P95。模型全部按每天 24 小时连续运行，不假设休市或夜间停采。', '',
    '## 假设与局限', '', ...Object.entries(assumptions).map(([k, v]) => `- ${k}：${v}`), '',
    '- 源码 SHA-256、分路径日写入、各产品独立用量/费用和预算余量见同名 JSON。D1 含索引写、删除、raw snapshot、状态、故障重试；DO SQLite 包含真实强平事件恢复、去重、确认、删除和每秒 alarm。',
    '- premium/OI/book 旧 backlog 清满已列独立情景并计入写入、重试和假设存储。历史观察点保留全部修订时，低频周期的证据会保留很久；存储需用线上大小复核。',
    '- Workers CPU 已包含 yeswood-jobs 按 26 天比例投影和其他项目余量；其他项目增长、日志产品、付费模型、VPS 费、税、优惠与未识别产品不在上述总额保证内。', '',
    '## 官方价格依据（2026-09-26 核验）', '',
    `- [DO 定价](${sources.durableObjects})：时长超 400,000 GB-s 先向上取整至每百万单位再乘 $12.50；请求超 100 万按每百万单位向上取整，WS 消息 20:1。单实例 31 天为 342,835.2 GB-s。`,
    `- [D1 定价](${sources.d1})：50m 写、25b 读、5 GB，超额 $1/m 写、$0.001/m 读、$0.75/GB-month。索引与删除计写。`,
    `- [Workers 定价](${sources.workers})：$5 含 10m 请求与 30m CPU ms，超额 $0.30/m 请求、$0.02/m CPU ms。DO SQLite 另有独立配额。`, ''];
  lines.push(`- [R2 定价](${sources.r2})：Standard 含 10 GB-month、1m Class A、10m Class B；[Queues 定价](${sources.queues})含 1m operations。当前账期沿用已观测速率时两者额外费仍为零。`, '');
  fs.writeFileSync(outputBase + '.md', lines.join('\n'));
  console.log(JSON.stringify({ status: 'PASS', actualSqlReplayCases: Object.keys(replay).length,
    scenarios: scenarios.map(s => ({ id: s.id, d1WritesPerDay: s.dailyD1Writes, usdPer31Days: s.monthlyCostUsd.total, within10: s.within10DollarProjection })),
    currentCycle: currentCycleProjections.filter(s => ['fastest_network_guarded_5s','fivefold_messages_retry_and_catchup_guarded_5s'].includes(s.scenario))
      .map(s => ({ id: s.scenario, remainingDays: s.remainingDays, wholeCycleUsd: s.projectedWholeCycleCostUsd.total, doDurationHeadroom: s.remainingIncludedDoDurationGBs })),
    output: [path.relative(root, outputBase + '.json'), path.relative(root, outputBase + '.md')] }, null, 2));
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
