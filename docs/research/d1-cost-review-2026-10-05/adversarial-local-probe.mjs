// Offline review evidence: actual collector/store/desk code, synthetic SQLite only.
// Run from the repository root with the bounded supervisor. No D1 billing claims.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
globalThis.fetch = async () => { throw new Error('network prohibited in offline probe'); };
const timeout = setTimeout(() => process.exit(124), 20000);
await import(pathToFileURL(path.join(root, 'cloudflare/binance-klines-worker.js')));
const { KlineLiveComponent } = await import(pathToFileURL(path.join(root, 'cloudflare/kline-live-collector.mjs')));
const { handleDesk } = await import(pathToFileURL(path.join(root, 'cloudflare/finance/desk.mjs')));
const { canonicalHistoryStatements, rawKlineHistoryStatements } = await import(pathToFileURL(path.join(root, 'cloudflare/finance/dataset-store.mjs')));

function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['cloudflare/finance/schema.sql', 'cloudflare/finance/dataset-schema.sql', 'cloudflare/schema.sql', 'cloudflare/finance/desk-history-migration.sql']) {
    sqlite.exec(fs.readFileSync(path.join(root, file), 'utf8'));
  }
  const db = { sqlite, failSql: null, events: [],
    prepare(sql) {
      return { sql, values: [], bind(...values) { this.values = values; return this; },
        async all() { return { results: sqlite.prepare(sql).all(...this.values) }; },
        async first() { return sqlite.prepare(sql).get(...this.values) || null; },
        async run() {
          const result = sqlite.prepare(sql).run(...this.values);
          db.events.push(sql.includes('INSERT INTO sync_status') ? 'sync_status_commit' : 'statement_commit');
          return { meta: { changes: Number(result.changes) } };
        } };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      const kind = statements.some(s => /INSERT INTO finance_dataset_observations/.test(s.sql)) ? 'canonical' : statements.some(s => /INSERT INTO klines /.test(s.sql)) ? 'raw' : 'read';
      try {
        const result = statements.map(s => {
          if (db.failSql && s.sql.includes(db.failSql)) { db.failSql = null; throw new Error('injected_constraint_boundary'); }
          return { results: sqlite.prepare(s.sql).all(...s.values) };
        });
        sqlite.exec('COMMIT'); db.events.push(kind + '_commit'); return result;
      } catch (error) { sqlite.exec('ROLLBACK'); db.events.push(kind + '_rollback'); throw error; }
    } };
  return db;
}

const now = Date.now();
const open = Math.floor(now / 300000) * 300000;
const bar = close => [open, '100', '105', '95', String(close), '20', open + 299999, '2000', 12, '10', '1000', '0'];
const receipt = age => new Date(now - age).toISOString();
const cases = [];
try {
  const db = database();
  const collector = new KlineLiveComponent(null, { DB: db }, { recoveryEnabled: false });
  await collector.persistOne('5m', [bar(100)], 'fstream.binance.com', 'cloud-ws', { closed: false, receivedAt: receipt(10000) });
  const before = { revision: db.sqlite.prepare('SELECT history_revision FROM desk_history_state').get().history_revision, writes: collector.writeCount };
  db.events = [];
  db.failSql = 'INSERT INTO finance_dataset_observations';
  await assert.rejects(collector.persistOne('5m', [bar(101)], 'fstream.binance.com', 'cloud-ws', { closed: false, receivedAt: receipt(5000) }), /injected_constraint_boundary/);
  const raw = db.sqlite.prepare('SELECT c FROM klines').get().c;
  const canonical = JSON.parse(db.sqlite.prepare('SELECT value_json FROM finance_dataset_observations').get().value_json).close;
  const sync = db.sqlite.prepare('SELECT last_ok,last_t FROM sync_status').get();
  assert.equal(raw, 101); assert.equal(canonical, 100); assert.equal(sync.last_ok, 1);
  assert.equal(collector.writeCount, before.writes);
  cases.push({ id: 'canonical_failure_after_raw_commit', outcome: 'COUNTEREXAMPLE_CONFIRMED', events: [...db.events], rawClose: raw, canonicalClose: canonical, syncLastOk: sync.last_ok, collectorSuccessCountAdvanced: false });

  const desk = await (await handleDesk(new Request('https://offline.invalid/api/desk/chart?interval=5m&tail=20'), { DB: db })).json();
  assert.equal(desk.series.at(-1).c, 100);
  assert.equal(desk.collectionStale, false);
  cases.push({ id: 'desk_reads_old_canonical_after_partial_commit', outcome: 'COUNTEREXAMPLE_CONFIRMED', displayedClose: desk.series.at(-1).c, collectionStale: desk.collectionStale, scope: 'synthetic injected failure; not a historical production occurrence' });

  await collector.persistOne('5m', [bar(101)], 'fstream.binance.com', 'cloud-ws', { closed: false, receivedAt: receipt(5000) });
  assert.equal(JSON.parse(db.sqlite.prepare('SELECT value_json FROM finance_dataset_observations').get().value_json).close, 101);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM finance_dataset_observations').get().n, 1);
  cases.push({ id: 'retry_same_mutable_receipt', outcome: 'PASS', rawClose: 101, canonicalClose: 101, canonicalRows: 1 });

  db.events = []; db.failSql = 'INSERT INTO klines ';
  await assert.rejects(collector.persistOne('5m', [bar(102)], 'fstream.binance.com', 'cloud-ws', { closed: false, receivedAt: receipt(2000) }), /injected_constraint_boundary/);
  assert.deepEqual(db.events, ['raw_rollback']);
  assert.equal(db.sqlite.prepare('SELECT c FROM klines').get().c, 101);
  cases.push({ id: 'raw_batch_failure', outcome: 'PASS', events: [...db.events], canonicalAttempted: false });
  const snapshotQueries = JSON.parse(fs.readFileSync(path.join(here, 'queries.json'), 'utf8'));
  assert.equal(canonicalHistoryStatements('binance-perp-klines-5m', [{ key: String(open), observedAt: new Date(open).toISOString(), values: {} }], 'fstream.binance.com', 'cloud-ws').after[0].sql, snapshotQueries.canonical.sql);
  assert.equal(rawKlineHistoryStatements('BTCUSDT', '5m', [bar(101)]).after[0].sql, snapshotQueries.raw.sql);
  const sqliteVersion = db.sqlite.prepare('SELECT sqlite_version() AS v').get().v;
  const sqlVariants = JSON.parse(fs.readFileSync(path.join(here, 'remote-select-probe.json'), 'utf8')).results;
  const plans = sqlVariants.filter(q => ['original', 'candidate-case'].includes(q.variant)).map(q => ({
    kind: q.key, variant: q.variant,
    bytecode: db.sqlite.prepare('EXPLAIN ' + q.sql).all(...snapshotQueries[q.key].params),
  }));
  fs.writeFileSync(path.join(here, 'adversarial-sqlite-plans.json'), JSON.stringify({ sqliteVersion, scope: 'Local EXPLAIN only; source SQL snapshot matched current repository; no VM-step or D1-row measurement.', plans }, null, 2) + '\n');
  db.sqlite.close();

  // v4 had independent size and version axes but one very small remote write budget.
  const fixtureMinimumRows = 80000 * 100;
  assert(fixtureMinimumRows > 100000);
  cases.push({ id: 'v4_fixture_budget', outcome: 'COUNTEREXAMPLE_CONFIRMED', logicalObservationRows: fixtureMinimumRows, v4WholeRunWrittenRowLimit: 100000, lowerBoundFactorBeforeIndexes: fixtureMinimumRows / 100000 });
  const profile = { oldTargetRead: 50, oldOtherRead: 50, targetReduction: 0.99 };
  const wholeReduction = profile.oldTargetRead * profile.targetReduction / (profile.oldTargetRead + profile.oldOtherRead);
  assert(wholeReduction < 0.8);
  cases.push({ id: 'v4_universal_80_percent_gate', outcome: 'COUNTEREXAMPLE_CONFIRMED', profile, wholeReduction });
  const report = { at: new Date().toISOString(), runtime: process.version, sqliteVersion, sourceSqlSnapshotCheck: 'PASS', scope: 'Actual repository collector, persistence SQL and chart assembly with a synthetic single-connection SQLite adapter; no network, remote writes or D1 cost measurement; injected failures are local only.', cases };
  fs.writeFileSync(path.join(here, 'adversarial-local-result.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ result: 'PASS', cases: cases.length, counterexamples: cases.filter(c => c.outcome === 'COUNTEREXAMPLE_CONFIRMED').length, scope: report.scope }));
} finally { clearTimeout(timeout); }
