/** Real SQLite recovery + deterministic transport/acknowledgement fault injection. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
const sql = new DatabaseSync(':memory:');
sql.exec(fs.readFileSync(path.join(root, 'cloudflare/schema.sql'), 'utf8'));
let failure = '', beforeBatch = null;
const DB = {
  prepare(query) {
    return { query, values: [], bind(...values) { return { ...this, values }; },
      async first() { return sql.prepare(this.query).get(...this.values) || null; },
      async all() { return { results: sql.prepare(this.query).all(...this.values) }; },
      async run() { return { success: true, meta: sql.prepare(this.query).run(...this.values) }; } };
  },
  async batch(statements) {
    if (failure === 'before') throw new Error('D1 unavailable');
    if (beforeBatch) await beforeBatch();
    sql.exec('BEGIN');
    try {
      const rows = statements.map(s => ({ success: true, meta: sql.prepare(s.query).run(...s.values) }));
      sql.exec('COMMIT');
      if (failure === 'after') throw new Error('response lost after commit');
      return rows;
    } catch (error) {
      if (sql.isTransaction) sql.exec('ROLLBACK');
      throw error;
    }
  },
};
function state(existing) {
  const local = existing || new DatabaseSync(':memory:');
  const tasks = [];
  const alarms = [];
  let alarmAt = null;
  const kv = new Map();
  return { local, tasks, alarms, waitUntil(p) { tasks.push(p); },
    storage: {
      sql: { exec(query, ...args) { const rows = local.prepare(query).all(...args); return { toArray: () => rows }; } },
      transactionSync(fn) { local.exec('BEGIN'); try { const out = fn(); local.exec('COMMIT'); return out; } catch (e) { local.exec('ROLLBACK'); throw e; } },
      async setAlarm(at) { alarmAt = at; alarms.push(at); }, async getAlarm() { return alarmAt; }, async deleteAlarm() { alarmAt = null; },
      async get(k) { return kv.get(k); }, async put(k, v) { kv.set(k, v); },
    },
    async drain() { while (tasks.length) await Promise.all(tasks.splice(0)); },
  };
}
const event = (ts, qty = 1, exchange = 'binance') => ({ exchange, symbol: 'BTCUSDT', ts, side: 'long', price: 100, qty, notional: 100 * qty });
const gate = () => { let release; const promise = new Promise(r => { release = r; }); return { promise, release }; };
const progress = () => new Promise(r => setImmediate(r));

(async () => {
  const worker = await import(pathToFileURL(path.join(root, 'cloudflare/binance-klines-worker.js')));
  const live = await import(pathToFileURL(path.join(root, 'cloudflare/kline-live-collector.mjs')));
  const { LiquidationCollector, __footprintTestHooks: hooks } = worker;
  const now = Date.now(), open = hooks.liquidationBucketStart(now), closedAt = open + 300001;
  sql.prepare(`INSERT INTO footprint_bars(symbol,interval,t,o,h,l,c,updated_at) VALUES ('BTCUSDT','5m',?,100,100,100,100,?)`).run(open, now);
  sql.prepare(`INSERT INTO footprint_sync_status(symbol,last_run,last_trade_id,last_trade_time) VALUES ('BTCUSDT',?,100,?)`).run(now, now);
  const originalFetch = globalThis.fetch;
  let upstreamFails = true;
  const trade = id => ({ a: id, T: open + 1000, p: '100', q: '1', m: false });
  globalThis.fetch = async input => {
    const fromId = Number(new URL(String(input)).searchParams.get('fromId'));
    if (fromId === 101) return Response.json(Array.from({ length: 1000 }, (_, i) => trade(i + 101)));
    return upstreamFails ? new Response('rate limited', { status: 429 }) : Response.json([]);
  };
  try {
    const fpEnv = { DB, BINANCE_FAPI_ORIGIN: 'https://egress.test' };
    const failedPage = await hooks.syncFootprintOne(fpEnv, 'BTCUSDT');
    assert.equal(failedPage.ok, false);
    assert.equal(sql.prepare('SELECT last_trade_id id FROM footprint_sync_status').get().id, 100);
    assert.equal(sql.prepare('SELECT volume FROM footprint_bars').get().volume, 0);
    upstreamFails = false; failure = 'before';
    await assert.rejects(hooks.syncFootprintOne(fpEnv, 'BTCUSDT'), /unavailable/);
    assert.equal(sql.prepare('SELECT last_trade_id id FROM footprint_sync_status').get().id, 100);
    failure = 'after';
    await assert.rejects(hooks.syncFootprintOne(fpEnv, 'BTCUSDT'), /response lost/);
    assert.equal(sql.prepare('SELECT volume FROM footprint_bars').get().volume, 1000);
    failure = ''; await hooks.syncFootprintOne(fpEnv, 'BTCUSDT');
    assert.equal(sql.prepare('SELECT volume FROM footprint_bars').get().volume, 1000);
    assert.equal(sql.prepare('SELECT last_trade_id id FROM footprint_sync_status').get().id, 1100);
    console.log('PASS footprint later-page failure/write failure retain cursor; committed-but-lost response replay does not double quantities');
  } finally { globalThis.fetch = originalFetch; failure = ''; }
  const st = state();
  let collector = new LiquidationCollector(st, { DB });
  let staleCloses = 0;
  const socket = { readyState: WebSocket.OPEN, close() { staleCloses++; } };
  collector.sources.bybit = { ...collector.emptySource('bybit'),
    lastMarketMessageAt: now - 600000, lastEventAt: now - 600000, lastHeartbeatAt: now };
  collector.checkOneStale('bybit', socket, 90000);
  assert.equal(staleCloses, 0, 'quiet liquidation feed with fresh ticker heartbeat stays connected');
  collector.sources.bybit.lastHeartbeatAt = now - 600000;
  collector.checkOneStale('bybit', socket, 90000);
  assert.equal(staleCloses, 1, 'a genuinely silent connection is still recycled');
  console.log('PASS liquidation liveness uses newest timestamp; quiet events do not cause reconnect loops');
  collector.ingest(event(open + 10));
  collector.ingest(event(open + 10));
  await st.drain();
  assert.equal(collector.buckets.size, 1);
  assert.equal([...collector.buckets.values()][0].longCount, 1);
  failure = 'before';
  await assert.rejects(collector.flushClosedBuckets(closedAt), /unavailable/);
  assert.equal(collector.buckets.size, 1);
  collector = new LiquidationCollector(state(st.local), { DB });
  collector.ingest(event(open + 10));
  assert.equal([...collector.buckets.values()][0].longCount, 1);
  failure = 'after';
  await assert.rejects(collector.flushClosedBuckets(closedAt), /response lost/);
  assert.equal(sql.prepare('SELECT long_count n FROM liquidation_5m_buckets').get().n, 1);
  collector = new LiquidationCollector(state(st.local), { DB });
  failure = '';
  await collector.flushClosedBuckets(closedAt);
  assert.equal(sql.prepare('SELECT long_count n FROM liquidation_5m_buckets').get().n, 1);
  assert.equal(collector.buckets.size, 0);
  console.log('PASS liquidation failure, durable restart, duplicate replay, committed-but-lost response');

  collector.ingest(event(open + 20, 2));
  await collector.state.drain();
  const block = gate(); let entered = false;
  beforeBatch = () => { entered = true; return block.promise; };
  const flushing = collector.flushClosedBuckets(closedAt);
  while (!entered) await progress();
  collector.ingest(event(open + 30, 3));
  block.release(); await flushing; beforeBatch = null;
  assert.equal([...collector.buckets.values()][0].longCount, 3);
  await collector.flushClosedBuckets(closedAt);
  let row = sql.prepare('SELECT long_count n,long_notional value FROM liquidation_5m_buckets').get();
  assert.equal(row.n, 3); assert.equal(row.value, 600);
  collector = new LiquidationCollector(state(st.local), { DB });
  collector.ingest(event(open + 40, 4)); await collector.state.drain();
  await collector.flushClosedBuckets(closedAt);
  row = sql.prepare('SELECT long_count n,long_notional value FROM liquidation_5m_buckets').get();
  assert.equal(row.n, 4); assert.equal(row.value, 1000);
  console.log('PASS late event uses full confirmed bucket; old acknowledgement preserves newer version');

  const cutoffState = state();
  const cutover = new LiquidationCollector(cutoffState, { DB });
  cutover.ingest(event(open + 50, 5)); await cutoffState.drain();
  await cutover.flushClosedBuckets(closedAt);
  row = sql.prepare('SELECT long_count n,long_notional value FROM liquidation_5m_buckets').get();
  assert.equal(row.n, 5); assert.equal(row.value, 1500);
  const writesBeforeHeartbeats = cutoffState.local.prepare('SELECT COUNT(*) n FROM liquidation_recovery_events').get().n;
  for (let i = 0; i < 10000; i++) cutover.touchHeartbeat('binance', 'aggTrade');
  assert.equal(cutoffState.local.prepare('SELECT COUNT(*) n FROM liquidation_recovery_events').get().n, writesBeforeHeartbeats);
  console.log('PASS cutover seeds existing D1 aggregate once; ordinary market heartbeats never enter recovery');

  const shared = new LiquidationCollector(state(), { DB });
  shared.connectBinance = shared.connectBinanceProbe = shared.connectBybit = async () => {};
  shared.kline.ensureStarted = async () => {};
  shared.kline.flushAll = async () => {};
  shared.kline.snapshotRest = async () => {};
  const slow = gate(); shared.kline.restFallback = () => slow.promise;
  await Promise.all([shared.fetch(new Request('https://do/wake')), shared.fetch(new Request('https://do/kline/status'))]);
  await shared.alarm();
  assert.ok(await shared.state.storage.getAlarm() <= Date.now() + 1100);
  shared.ingest(event(open + 60));
  assert.equal(shared.buckets.size, 1);
  assert.equal(shared.kline.tasks.has('cycle'), true);
  slow.release(); await shared.state.drain();
  console.log('PASS one earliest alarm; concurrent status/wake share cycle; slow kline REST does not block liquidation receipt');

  const persisted = [], metadata = []; let failLive = true, blockWrite = null;
  live.bindKlineLiveHooks({
    readKlineCursor: null,
    persistKlines: async (_env, _symbol, interval, rows) => { if (blockWrite) await blockWrite.promise; persisted.push(...rows.map(row => ({ interval, row }))); },
    updateSyncStatus: async () => {},
    persistLiveKlineBar: async (_db, _interval, _row, _host, _mode, meta) => { if (failLive) throw Error('normalized write failed'); metadata.push(meta); },
    persistLiveSnapshot: async () => {},
  });
  const component = new live.KlineLiveComponent(state(), { DB: {} });
  const msg = (t, c, closed, E = t + 100) => ({ e: 'kline', E, k: { i: '5m', t, T: t + 299999, o: '100', h: '120', l: '90', c: String(c), v: '2', q: '200', n: 4, V: '1', Q: '100', x: closed } });
  component.receive(msg(open, 101, true)); component.receive(msg(open + 300000, 102, false));
  await component.flushAll('test'); assert.equal(component.pending.size, 2);
  failLive = false; await component.flushAll('retry');
  assert.equal(component.pending.size, 0); assert.equal(metadata[0].closed, true); assert.equal(metadata[1].closed, false);
  component.receive(msg(open, 99, false, open + 400000)); assert.equal(component.pending.size, 0);
  component.receive(msg(open + 300000, 103, false, open + 400001));
  blockWrite = gate(); const writing = component.flushAll('inflight'); await progress();
  component.receive(msg(open + 300000, 104, false, open + 400002));
  blockWrite.release(); await writing; blockWrite = null;
  assert.equal(component.pending.size, 1); await component.flushAll('newer');
  assert.equal(persisted.at(-1).row[4], '104');
  console.log('PASS kline close survives new bar, partial write failure retries, stale forming rejected, in-flight newer version retained');

  const receipts = []; let loseSnapshotResponse = true;
  live.bindKlineLiveHooks({ persistLiveSnapshot: async (_db, _id, _data, _host, _mode, options) => {
    receipts.push(options.receivedAt);
    if (loseSnapshotResponse) throw Error('premium response lost');
  } });
  component.receive({ e: 'markPriceUpdate', E: now, p: '100', i: '100' }, now);
  await component.flushAll('premium'); assert.ok(component.pendingPremium);
  loseSnapshotResponse = false; await component.flushAll('premium retry');
  assert.equal(component.pendingPremium, null);
  assert.equal(receipts[0], new Date(now).toISOString()); assert.equal(receipts[1], receipts[0]);
  console.log('PASS premium lost acknowledgement reuses actual receipt timestamp');

  live.bindKlineLiveHooks({ readKlineCursor: async () => ({ hasRows: true, maxT: open - 900000 }) });
  const restarting = new live.KlineLiveComponent(state(), { DB: {} });
  await restarting.captureRecoveryCursors();
  restarting.receive(msg(open, 101, false)); await restarting.flushAll('after restart');
  assert.equal(restarting.snapshot().intervalHealth['5m'].recoveryFromT, open - 900000);
  assert.equal(restarting.snapshot().intervalHealth['5m'].needsReconcile, true);
  const restartGeneration = restarting.snapshot().intervalHealth['5m'].recoveryGeneration;
  restarting.confirmReconciled('5m', restartGeneration, open);
  restarting.receive(msg(open, 102, false, open + 100000), Date.now() + 10000);
  assert.equal(restarting.snapshot().intervalHealth['5m'].recoveryFromT, open);
  assert.equal(restarting.snapshot().intervalHealth['5m'].recoveryGeneration, restartGeneration + 1);
  restarting.confirmReconciled('5m', restartGeneration, open);
  assert.equal(restarting.snapshot().intervalHealth['5m'].needsReconcile, true);
  live.bindKlineLiveHooks({ readKlineCursor: null });
  console.log('PASS restart captures old D1 cursor before live overwrite; stale reconcile acknowledgement cannot hide a newer gap');

  const cadence = new live.KlineLiveComponent(state(), { DB: {} });
  let cycleWrites = 0; const pacing = gate();
  cadence.ensureStarted = async () => {};
  cadence.flushAll = async () => { cycleWrites++; await pacing.promise; };
  cadence.restFallback = async () => {};
  cadence.snapshotRest = async () => {};
  cadence.tick(); await progress();
  for (let i = 1; i < 20; i++) cadence.tick(Date.now() + i * 1000);
  assert.equal(cycleWrites, 1);
  pacing.release(); await cadence.state.drain();
  cadence.tick(cadence.nextCycleAt - 1); await progress(); assert.equal(cycleWrites, 1);
  assert.ok(cadence.nextCycleAt >= cadence.lastFlushAttemptAt + 5000);
  assert.equal(cadence.snapshot().effectiveMinFlushMs, 5000);
  console.log('PASS fast shared alarms do not overlap an in-flight write cycle or bypass its 5s start floor');

  const concurrent = new live.KlineLiveComponent(state(), { DB: {} });
  const waitingWrites = [], activeIntervals = new Set(), writeLog = [];
  let activeWrites = 0, maximumWrites = 0, fail15m = true;
  live.bindKlineLiveHooks({
    persistKlines: async (_env, _symbol, interval) => {
      assert.equal(activeIntervals.has(interval), false, 'same interval must have only one writer');
      activeIntervals.add(interval); activeWrites++; maximumWrites = Math.max(maximumWrites, activeWrites);
      const wait = gate(); waitingWrites.push(wait); await wait.promise;
      activeIntervals.delete(interval); activeWrites--;
      if (interval === '15m' && fail15m) { fail15m = false; throw Error('one period failed'); }
    },
    persistLiveKlineBar: async (_db, interval, row, _host, _mode, meta) => writeLog.push({ interval, t: row[0], closed: meta.closed }),
    persistLiveSnapshot: async () => {},
  });
  for (const interval of live.KLINE_LIVE_INTERVALS) {
    const payload = msg(open, 101, false); payload.k.i = interval; concurrent.receive(payload);
  }
  let normalDone = false, closeDone = false;
  const normal = concurrent.flushAll('normal').then(() => { normalDone = true; }); await progress();
  assert.equal(activeWrites, 3);
  concurrent.receive(msg(open, 102, true, open + 300000));
  concurrent.receive(msg(open + 300000, 103, false, open + 300001));
  const urgent = concurrent.flushAll('closed').then(() => { closeDone = true; });
  concurrent.receive(msg(open, 99, false, open + 300002));
  assert.equal(concurrent.pending.get(`5m:${open}`).closed, true);
  for (let round = 0; round < 20 && (!normalDone || !closeDone); round++) {
    waitingWrites.splice(0).forEach(wait => wait.release()); await progress();
  }
  await Promise.all([normal, urgent]);
  assert.equal(maximumWrites, 3);
  assert.deepEqual(writeLog.filter(w => w.interval === '5m').map(w => w.closed), [false, true]);
  assert.equal(concurrent.pending.has(`5m:${open}`), false);
  assert.equal(concurrent.pending.has(`5m:${open + 300000}`), true);
  assert.equal(concurrent.pending.has(`15m:${open}`), true);
  let retryDone = false;
  const retry = concurrent.flushAll('retry').then(() => { retryDone = true; });
  for (let round = 0; round < 20 && !retryDone; round++) {
    waitingWrites.splice(0).forEach(wait => wait.release()); await progress();
  }
  await retry;
  assert.deepEqual(writeLog.filter(w => w.interval === '5m').map(w => w.closed), [false, true, false]);
  assert.equal(concurrent.pending.size, 0);
  console.log('PASS three-period concurrency bound; same-period close/forming stay ordered; failed period retries and close never clears new bar');

  const realNow = Date.now;
  let fakeNow = now, oiFetches = 0, bookFetches = 0;
  const slowWrite = gate(), slowBook = gate();
  Date.now = () => fakeNow;
  try {
    const independent = new live.KlineLiveComponent(state(), { DB: {} });
    independent.ensureStarted = async () => {};
    independent.flushAll = () => slowWrite.promise;
    independent.restFallback = async () => {};
    independent.lastPremiumMessageAt = fakeNow;
    live.bindKlineLiveHooks({ fetchBinanceFapiJson: async (_env, endpoint) => {
      if (endpoint.includes('openInterest')) { oiFetches++; throw Error('OI transient fetch failure'); }
      if (endpoint.includes('depth')) { bookFetches++; await slowBook.promise; }
      return { ok: true, data: {}, host: 'fapi.binance.com' };
    } });
    independent.tick(fakeNow); await progress();
    assert.equal(oiFetches, 1); assert.equal(bookFetches, 1);
    assert.equal(independent.tasks.has('cycle'), true);
    assert.equal(independent.tasks.has('snapshot'), true);
    fakeNow += 6000; independent.lastPremiumMessageAt = fakeNow; independent.tick(fakeNow); await progress();
    assert.equal(bookFetches, 1, 'failed OI may not release snapshot guard while book is still in flight');
    slowBook.release(); await independent.tasks.get('snapshot');
    fakeNow += 1000; independent.lastPremiumMessageAt = fakeNow; independent.tick(fakeNow); await progress();
    assert.equal(bookFetches, 2, 'snapshot can refresh while seven-period write cycle is still blocked');
    assert.equal(independent.tasks.has('cycle'), true);
    slowWrite.release(); await independent.state.drain();
  } finally { Date.now = realNow; slowWrite.release(); slowBook.release(); }
  console.log('PASS OI/book run independently of blocked kline writes, concurrent fetches start together, errors never permit overlapping snapshot jobs');

  let premiumFallbacks = 0;
  live.bindKlineLiveHooks({ fetchBinanceFapiJson: async (_env, endpoint) => {
    if (endpoint.includes('premiumIndex')) premiumFallbacks++;
    return { ok: true, data: {}, host: 'fapi.binance.com' };
  } });
  const partial = new live.KlineLiveComponent(state(), { DB: {} });
  partial.receive(msg(open, 101, false));
  await partial.snapshotRest();
  assert.equal(premiumFallbacks, 1); assert.equal(partial.lastPremiumMessageAt, 0);
  partial.receive({ e: 'markPriceUpdate', E: Date.now(), p: '100', i: '100' });
  partial.lastSnapshotAt = 0;
  await partial.snapshotRest();
  assert.equal(premiumFallbacks, 1); assert.ok(partial.snapshot().lastPremiumMessageAt > 0);
  console.log('PASS healthy kline traffic cannot mask a missing premium substream');

  const retiredState = state();
  const legacy = new live.KlineLiveCollector(retiredState, { DB });
  let closedSocket = 0; legacy.ws = { close() { closedSocket++; } };
  legacy.reconnectTimer = setTimeout(() => { throw Error('retired reconnect revived'); }, 100);
  const retired = await legacy.fetch(new Request('https://old/retire', { method: 'POST' }));
  assert.equal((await retired.json()).collector.retired, true);
  assert.equal(closedSocket, 1); assert.equal(await retiredState.storage.getAlarm(), null);
  const restartedLegacy = new live.KlineLiveCollector(retiredState, { DB });
  await restartedLegacy.fetch(new Request('https://old/wake')); await restartedLegacy.alarm();
  assert.equal(restartedLegacy.status, 'retired'); assert.equal(restartedLegacy.startedAt, 0);
  assert.equal(await retiredState.storage.getAlarm(), null);
  assert.ok((await retiredState.storage.get('retired')).retiredAt > 0);
  console.log('PASS retired socket/timer/alarm stop; legacy wake/status/restart never reconnect');

  const healthy = { intervalHealth: Object.fromEntries(live.KLINE_LIVE_INTERVALS.map(iv => [iv, { lastMessageAt: now, lastWriteAt: now, needsReconcile: false }])) };
  const minute = new Date(now); minute.setUTCMinutes(17);
  Object.values(healthy.intervalHealth).forEach(h => { h.lastMessageAt = minute.getTime(); h.lastWriteAt = minute.getTime(); });
  assert.deepEqual(hooks.intervalsDueAt(minute, healthy), []);
  healthy.intervalHealth['5m'].needsReconcile = true;
  assert.deepEqual(hooks.intervalsDueAt(minute, healthy), ['5m']);
  minute.setUTCMinutes(0); assert.equal(hooks.intervalsDueAt(minute, healthy).length, 7);
  console.log('PASS Cron checks per-interval health and startup/gap reconciliation; hourly safety window retained');
  console.log('PASS collector governance: all scenarios');
  await require('./verify-kline-recovery.cjs');
})().catch(error => { console.error(error); process.exitCode = 1; });
