const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '../..');
function state(local = new DatabaseSync(':memory:')) {
  return { local, waitUntil() {}, storage: {
    sql: { exec(q, ...args) { const rows = local.prepare(q).all(...args); return { toArray: () => rows }; } },
    transactionSync(fn) { local.exec('BEGIN'); try { const result = fn(); local.exec('COMMIT'); return result; } catch (e) { local.exec('ROLLBACK'); throw e; } },
  } };
}
module.exports = (async () => {
  const worker = await import(pathToFileURL(path.join(root, 'cloudflare/binance-klines-worker.js')));
  const live = await import(pathToFileURL(path.join(root, 'cloudflare/kline-live-collector.mjs')));
  const h = worker.__footprintTestHooks;
  const realNow = Date.now, realFetch = global.fetch;
  const step = 300000, open = Math.floor(realNow() / step) * step;
  let now = open + 1000, failBatch = false, failNormalized = false, holdBatch = null;
  Date.now = () => now;
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(root, 'cloudflare/schema.sql'), 'utf8'));
  const DB = {
    prepare(query) { return { query, args: [], bind(...args) { return { ...this, args }; },
      async first() { return db.prepare(this.query).get(...this.args) || null; },
      async all() { return { results: db.prepare(this.query).all(...this.args) }; },
      async run() { return { success: true, meta: db.prepare(this.query).run(...this.args) }; },
    }; },
    async batch(stmts) {
      if (holdBatch) await holdBatch;
      if (failBatch) throw new Error('injected D1 write failure');
      return stmts.map(s => ({ success: true, meta: db.prepare(s.query).run(...s.args) }));
    },
  };
  const env = { DB, BINANCE_FAPI_ORIGIN: 'https://test.invalid' };
  const row = (t, c = 101) => [t, '100', '120', '90', String(c), '2', t + step - 1, '200', '4', '1', '100'];
  const msg = (t, c, E, x = false) => ({ e: 'kline', E, k: { i: '5m', t, T: t + step - 1, o: '100', h: '120', l: '90', c: String(c), v: '2', q: '200', n: 4, V: '1', Q: '100', x } });
  const receipts = [];
  live.bindKlineLiveHooks({ persistKlines: h.persistKlines, readKlineCursor: h.d1QueryLatestMeta,
    updateSyncStatus: async () => {}, persistLiveKlineBar: null,
    persistRestKlineBatch: async (_db, interval, rows, host, options) => {
      if (failNormalized) throw new Error('injected normalized write failure');
      receipts.push({ interval, rows, host, options });
    },
  });
  try {
    await h.persistKlines(env, 'BTCUSDT', '5m', [row(open - 3 * step)]);
    const firstState = state();
    let c = new live.KlineLiveComponent(firstState, env);
    await c.captureRecoveryCursors();
    const firstGeneration = c.recoveryGeneration['5m'];
    await c.persistOne('5m', [row(open)], 'test', 'test');
    c = new live.KlineLiveComponent(state(firstState.local), env);
    await c.captureRecoveryCursors();
    assert.equal(c.recoveryFromT['5m'], open - 3 * step);
    assert.ok(c.recoveryGeneration['5m'] > firstGeneration);
    assert.equal(c.confirmReconciled('5m', firstGeneration, open), false);
    const request = { interval: '5m', sourceHost: 'fapi.binance.com', requestStartedAt: now, receivedAt: new Date(now).toISOString(), generation: c.recoveryGeneration['5m'], requestSequence: 1 };
    let result = await c.applyReconciliation({ ...request, rows: [row(open - 3 * step), row(open - step)] });
    assert.equal(result.reconciled, false, 'a returned page with an internal hole is not coverage');
    assert.equal(c.needsReconcile.has('5m'), true);
    failBatch = true;
    await assert.rejects(c.applyReconciliation({ ...request, rows: [row(open - 3 * step), row(open - 2 * step), row(open - step)] }), /D1 write failure/);
    assert.equal(c.needsReconcile.has('5m'), true);
    failBatch = false;
    failNormalized = true;
    await assert.rejects(c.applyReconciliation({ ...request, rows: [row(open - 3 * step), row(open - 2 * step), row(open - step)] }), /normalized write failure/);
    assert.equal(c.needsReconcile.has('5m'), true);
    failNormalized = false;
    result = await c.applyReconciliation({ ...request, rows: [row(open - 3 * step), row(open - 2 * step), row(open - step)] });
    assert.equal(result.reconciled, true);
    assert.equal(c.recoveryFromT['5m'], open);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM klines WHERE t>=? AND t<?').get(open - 3 * step, open).n, 3);
    const checkpointGeneration = c.recoveryGeneration['5m'];
    const historyBeforeGap = db.prepare('SELECT history_revision AS n FROM desk_history_state WHERE symbol=? AND interval=?').get('BTCUSDT','5m');
    c.markGap('5m');
    assert.equal(c.needsReconcile.has('5m'), true, 'ongoing outage after a checkpoint creates a new recovery obligation');
    assert.equal(c.recoveryGeneration['5m'], checkpointGeneration + 1);
    assert.equal(db.prepare('SELECT history_revision AS n FROM desk_history_state WHERE symbol=? AND interval=?').get('BTCUSDT','5m').n, historyBeforeGap.n, 'WB-04 recovery generation is not historyRevision');
    console.log('PASS durable earliest cursor survives restart; old boot receipt and incomplete/failed coverage cannot acknowledge');

    c.receive(msg(open, 102, now), now);
    c.markGap('5m');
    const oldGeneration = c.recoveryGeneration['5m'];
    c.markGap('5m'); assert.equal(c.recoveryGeneration['5m'], oldGeneration, 'polling one outage is one episode');
    c.receive(msg(open, 103, now + 1), now + 1);
    c.markGap('5m');
    assert.equal(c.recoveryGeneration['5m'], oldGeneration + 1);
    assert.equal(c.recoveryFromT['5m'], open);
    assert.equal(c.confirmReconciled('5m', oldGeneration, open), false);
    assert.equal((await c.applyReconciliation({ ...request, generation: oldGeneration, rows: [row(open - step, 1)] })).skipped, 'stale_recovery_generation');
    assert.equal(db.prepare('SELECT c FROM klines WHERE t=?').get(open - step).c, 101);
    console.log('PASS each new outage advances generation, repeated stale polls do not; stale responses cannot mutate raw history');

    now = open + step + 1000;
    c.receive(msg(open, 118, now, true), now);
    let nextRequest = { ...request, requestStartedAt: now - 1000, generation: c.recoveryGeneration['5m'], rows: [row(open, 118)] };
    assert.equal((await c.applyReconciliation(nextRequest)).reconciled, false);
    await c.flushAll('closed');
    nextRequest = { ...nextRequest, requestStartedAt: now + 1, receivedAt: new Date(now + 1).toISOString() };
    assert.equal((await c.applyReconciliation(nextRequest)).reconciled, true);
    console.log('PASS a newer WS row defers acknowledgement conservatively and the next reconciliation converges');

    // Fixed request cutoff plus the real collector endpoint: pre-close REST never overwrites the WS final.
    const collector = new worker.LiquidationCollector(state(), env);
    env.LIQUIDATION_COLLECTOR = { idFromName: x => x, get: () => ({ fetch: (url, init) => collector.fetch(new Request(url, init)) }) };
    await collector.kline.captureRecoveryCursors();
    now = open + step - 1000;
    let requestedStart = null;
    global.fetch = async target => {
      const url = new URL(target);
      requestedStart = Number(url.searchParams.get('startTime'));
      const captured = row(open, 105);
      now = open + step + 1;
      collector.kline.receive(msg(open, 120, now, true), now);
      await collector.kline.flushAll('closed');
      return Response.json([row(open - step), captured]);
    };
    result = await h.syncKlinesOne(env, 'BTCUSDT', '5m');
    assert.equal(result.ok, true);
    assert.equal(db.prepare('SELECT c FROM klines WHERE t=?').get(open).c, 120);
    assert.ok(requestedStart <= open - 24 * step);
    console.log('PASS actual sync/DO route keeps WS final across delayed REST close boundary and requests 24 closed bars');

    // A queued old WS forming snapshot may not undo a post-close REST correction.
    now = open + 2 * step + 1000;
    collector.kline.receive(msg(open + step, 106, now - 2000, false), now - 2000);
    const generation = collector.kline.recoveryGeneration['5m'];
    await collector.kline.applyReconciliation({ interval: '5m', rows: [row(open, 120), row(open + step, 119)], sourceHost: 'fapi.binance.com', requestStartedAt: now,
      receivedAt: new Date(now).toISOString(), generation, requestSequence: 1 });
    await collector.kline.flushAll('test');
    assert.equal(db.prepare('SELECT c FROM klines WHERE t=?').get(open + step).c, 119);
    assert.equal(collector.kline.pending.has(`5m:${open + step}`), false);
    assert.ok(receipts.every(x => x.rows.every(r => Number(r[6]) < Date.parse(x.options.requestStartedAt))));
    console.log('PASS serialized REST correction discards superseded queued forming writes; all bulk receipts prove request-after-close');

    // Old closed history is corrected by the bounded hourly window, while forming stays live-owned.
    const old = open - 9 * step;
    await h.persistKlines(env, 'BTCUSDT', '5m', [row(old, 77)]);
    global.fetch = async () => Response.json(Array.from({ length: 25 }, (_, i) => row(open + 2 * step - (24 - i) * step, 110)));
    result = await h.syncKlinesOne(env, 'BTCUSDT', '5m');
    assert.equal(result.ok, true);
    assert.equal(db.prepare('SELECT c FROM klines WHERE t=?').get(old).c, 110);
    assert.equal(db.prepare('SELECT c FROM klines WHERE t=?').get(open + 2 * step), undefined);
    console.log('PASS bounded raw history reconciliation corrects old closed values and excludes current forming bar');

    let release, entered;
    const waiting = new Promise(resolve => { release = resolve; });
    const began = new Promise(resolve => { entered = resolve; });
    let fetchCount = 0;
    global.fetch = async () => {
      const count = ++fetchCount;
      if (count === 1) { entered(); await waiting; }
      return Response.json(Array.from({ length: 25 }, (_, i) => row(open + 2 * step - (24 - i) * step, count === 1 ? 108 : 117)));
    };
    const olderResponse = h.syncKlinesOne(env, 'BTCUSDT', '5m');
    await began;
    // Deliberately keep Date.now identical for both real worker requests.
    assert.equal((await h.syncKlinesOne(env, 'BTCUSDT', '5m')).ok, true);
    release(); await olderResponse;
    assert.equal(db.prepare('SELECT c FROM klines WHERE t=?').get(old).c, 117);
    console.log('PASS actual worker same-millisecond concurrent REST responses cannot roll back a newer completed reconciliation');

    const { klineOpenAt, KLINE_STEPS } = await import(pathToFileURL(path.join(root, 'cloudflare/kline-recovery.mjs')));
    assert.equal(new Date(klineOpenAt('1w', Date.parse('2026-09-27T23:59:59Z'))).toISOString(), '2026-09-21T00:00:00.000Z');
    assert.equal(klineOpenAt('3d', open) % KLINE_STEPS['3d'], 86400000);
    console.log('PASS weekly Monday boundary and Binance 3d one-day offset');
  } finally { Date.now = realNow; global.fetch = realFetch; db.close(); }
})();
if (require.main === module) module.exports.catch(error => { console.error(error); process.exitCode = 1; });
