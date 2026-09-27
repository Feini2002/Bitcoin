const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'cloudflare/finance/desk-history-migration.sql'), 'utf8');
// Frozen pre-W1 schema, deliberately independent of current schema files.
const legacySchema = `
CREATE TABLE klines (symbol TEXT NOT NULL, interval TEXT NOT NULL, t INTEGER NOT NULL,
  o REAL NOT NULL, h REAL NOT NULL, l REAL NOT NULL, c REAL NOT NULL, v REAL NOT NULL,
  PRIMARY KEY(symbol, interval, t));
CREATE INDEX idx_klines_sym_iv_t ON klines(symbol, interval, t DESC);
CREATE TABLE finance_dataset_observations (
  dataset_id TEXT NOT NULL, observation_key TEXT NOT NULL, observed_at TEXT,
  time_precision TEXT NOT NULL, received_at TEXT NOT NULL, stored_at TEXT NOT NULL,
  source_host TEXT NOT NULL, ingestion_mode TEXT NOT NULL, source_revision_json TEXT,
  value_json TEXT NOT NULL, PRIMARY KEY(dataset_id, observation_key, received_at));
CREATE INDEX idx_finance_dataset_receipt ON finance_dataset_observations(dataset_id, received_at DESC);
CREATE TABLE finance_dataset_state (dataset_id TEXT PRIMARY KEY, attempted_at TEXT NOT NULL,
  last_http_status INTEGER NOT NULL, last_error TEXT, last_success_received_at TEXT,
  last_success_stored_at TEXT, last_ingestion_mode TEXT, row_count INTEGER NOT NULL DEFAULT 0);`;

function localSqlite() {
  const sqlite = new DatabaseSync(':memory:');
  const db = { prepare(sql) {
    return { values: [], bind(...values) { this.values = values; return this; },
      async all() { return { results: sqlite.prepare(sql).all(...this.values) }; },
      async run() { const result = sqlite.prepare(sql).run(...this.values); return { meta: { changes: Number(result.changes) } }; }
    };
  }, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.all()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }, close() { sqlite.close(); } };
  return db;
}
async function statements(db, sql) {
  return db.batch(sql.replace(/^\s*--.*$/gm, '').split(';').map(part => part.trim()).filter(Boolean).map(part => db.prepare(part)));
}
async function rows(db, sql, ...params) { return (await db.prepare(sql).bind(...params).all()).results; }
const plain = value => JSON.parse(JSON.stringify(value));

async function verify(db, backend) {
  const { observationKeyWalkSql, prepareBoundedObservations, rawKlineHistoryStatements, canonicalHistoryStatements } = await import(pathToFileURL(path.join(root, 'cloudflare/finance/dataset-store.mjs')));
  await statements(db, legacySchema);
  assert.deepEqual(await rows(db, "SELECT name FROM sqlite_master WHERE name IN ('desk_history_state','_desk_hist_bump','idx_finance_dataset_observed')"), []);
  await db.prepare("INSERT INTO klines VALUES('BTCUSDT','5m',1000,10,12,9,11,42)").run();
  await db.prepare("INSERT INTO finance_dataset_state VALUES('legacy','2026-09-01',200,NULL,'2026-09-01','2026-09-01','cloud-readthrough',2)").run();
  const datasetId = count => count === 800 ? 'binance-perp-klines-5m' : 'binance-perp-klines-15m';
  for (const count of [800, 8000]) {
    await db.prepare(`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<?1)
      INSERT INTO finance_dataset_observations SELECT ?2, CAST(x AS TEXT),
        strftime('%Y-%m-%dT%H:%M:%fZ', 1700000000+x*300, 'unixepoch'), 'event',
        '2026-09-01T00:00:00.000Z','2026-09-01T00:00:00.000Z','fixture.invalid','cloud-readthrough',NULL,
        json_object('value',x) FROM n`).bind(count, datasetId(count)).run();
  }
  // Preserve both revisions of one observation and a receipt-only observation.
  await db.prepare(`INSERT INTO finance_dataset_observations SELECT dataset_id,observation_key,observed_at,
    time_precision,'2026-09-02T00:00:00.000Z',stored_at,source_host,ingestion_mode,source_revision_json,'{"value":999}'
    FROM finance_dataset_observations WHERE dataset_id='binance-perp-klines-5m' AND observation_key='1'`).run();
  await db.prepare("INSERT INTO finance_dataset_observations VALUES('legacy', 'receipt', NULL, 'receipt', '2026-09-01', '2026-09-01', 'fixture.invalid', 'cloud-readthrough', NULL, '{}')").run();
  const snapshot = async () => plain(await Promise.all([
    rows(db, 'SELECT * FROM klines ORDER BY symbol,interval,t'),
    rows(db, 'SELECT * FROM finance_dataset_state ORDER BY dataset_id'),
    rows(db, 'SELECT * FROM finance_dataset_observations ORDER BY dataset_id,observation_key,received_at'),
  ]));
  const before = await snapshot();
  const params = count => [datasetId(count), '2026-09-27T00:00:00.000Z', null, null, 21, 0];
  const oldIndexes = await rows(db, "PRAGMA index_list('finance_dataset_observations')");
  assert(!oldIndexes.some(row => row.name === 'idx_finance_dataset_observed'));
  await statements(db, migration);
  assert.deepEqual(await snapshot(), before, 'migration must retain legacy observations, all revisions, receipt-only rows, raw bars and state');
  await db.prepare("INSERT INTO desk_history_state VALUES('BTCUSDT','5m',1000,7)").run();
  await db.prepare("INSERT INTO _desk_hist_bump VALUES('BTCUSDT','5m',1)").run();
  await statements(db, migration);
  assert.deepEqual(await snapshot(), before, 'reapplying migration must retain legacy data');
  assert.equal((await rows(db, "SELECT history_revision FROM desk_history_state WHERE symbol='BTCUSDT'"))[0].history_revision, 7);
  assert.equal((await rows(db, "SELECT bump FROM _desk_hist_bump WHERE symbol='BTCUSDT'"))[0].bump, 1);
  const index = await rows(db, "PRAGMA index_xinfo('idx_finance_dataset_observed')");
  assert.deepEqual(index.filter(row => row.key === 1).map(row => [row.name, row.desc]), [['dataset_id',0],['observed_at',1],['observation_key',0]]);
  console.log(`PASS DESK-MIGRATION ${backend}: old schema upgrade, exact data preservation and idempotence`);
  const readCosts = [];
  const boundedReadCosts = [];
  for (const count of [800, 8000]) {
    const plan = await rows(db, `EXPLAIN QUERY PLAN ${observationKeyWalkSql()}`, ...params(count));
    assert(plan.some(row => /SEARCH .*USING INDEX idx_finance_dataset_observed/.test(row.detail)), 'tail key walk must seek the migrated index');
    assert(!plan.some(row => /SCAN finance_dataset_observations/.test(row.detail)), 'tail key walk must not scan the observation table');
    const tailResult = await db.prepare(observationKeyWalkSql()).bind(...params(count)).all();
    const tail = tailResult.results;
    assert.equal(tail.length, 21);
    assert.equal(tail[0].observation_key, String(count));
    assert.equal(tail.at(-1).observation_key, String(count - 20));
    console.log(`PASS DESK-MIGRATION ${backend}: ${count} rows -> 21 newest keys using migrated observed index`);
    if (Number.isFinite(tailResult.meta?.rows_read)) {
      readCosts.push(tailResult.meta.rows_read);
      console.log(JSON.stringify({ backend, fixtureRows:count, tailKeys:tail.length, rowsRead:tailResult.meta.rows_read }));
    }
    const prepared = prepareBoundedObservations(db, datasetId(count), { limit:20, knownAt:params(count)[1], historical:false, predecessor:true });
    const boundedResult = await prepared.statement.all();
    const parsed = prepared.parse(boundedResult);
    assert.equal(parsed.observations.length, 20);
    assert.equal(parsed.observations[0].key, String(count));
    assert.equal(parsed.observations.at(-1).key, String(count - 19));
    assert.equal(parsed.predecessor.key, String(count - 20));
    assert.equal(parsed.truncated, true);
    if (Number.isFinite(boundedResult.meta?.rows_read)) {
      boundedReadCosts.push(boundedResult.meta.rows_read);
      console.log(JSON.stringify({ backend, query:'prepareBoundedObservations', fixtureRows:count, observations:parsed.observations.length, rowsRead:boundedResult.meta.rows_read }));
    }
  }
  // Three writes execute; the fourth fails a real NOT NULL constraint.
  // Verify rollback covers already-written history, helper and legacy bar state.
  await assert.rejects(db.batch([
    db.prepare("UPDATE desk_history_state SET history_revision=99 WHERE symbol='BTCUSDT'"),
    db.prepare("UPDATE _desk_hist_bump SET bump=0 WHERE symbol='BTCUSDT'"),
    db.prepare("UPDATE klines SET c=99 WHERE symbol='BTCUSDT'"),
    db.prepare("INSERT INTO klines VALUES(NULL,'5m',2000,1,1,1,1,1)"),
  ]), /NOT NULL|constraint/i);
  assert.equal((await rows(db, 'SELECT history_revision FROM desk_history_state'))[0].history_revision, 7);
  assert.equal((await rows(db, 'SELECT bump FROM _desk_hist_bump'))[0].bump, 1);
  assert.deepEqual(await snapshot(), before);
  console.log(`PASS DESK-MIGRATION ${backend}: failure after three executed writes rolls back revision, helper and bar`);
  await db.prepare("UPDATE desk_history_state SET head_t=10000000 WHERE symbol='BTCUSDT'").run();
  const applyQueries = queries => db.batch(queries.map(query => db.prepare(query.sql).bind(...query.params)));
  const change = rawKlineHistoryStatements('BTCUSDT', '5m', [[1000,10,12,9,12,42]]);
  const write = { sql: "UPDATE klines SET c=12 WHERE symbol='BTCUSDT'", params: [] };
  assert(![...change.before, ...change.after].some(query => /CREATE\s+TEMP(?:ORARY)?\s+TABLE/i.test(query.sql)), 'runtime statements must not reintroduce D1-forbidden TEMP tables');
  await applyQueries([...change.before, write, ...change.after]);
  assert.equal((await rows(db, "SELECT history_revision FROM desk_history_state WHERE symbol='BTCUSDT' AND interval='5m'"))[0].history_revision, 8);
  await applyQueries([...change.before, write, ...change.after]);
  assert.equal((await rows(db, "SELECT history_revision FROM desk_history_state WHERE symbol='BTCUSDT' AND interval='5m'"))[0].history_revision, 8, 'reused persistent helper must reset and not bump identical data');
  const canonical = canonicalHistoryStatements('binance-perp-funding', [{ key:'1700000000000', observedAt:'2023-11-14T22:13:20.000Z', values:{ fundingRate:0.0001 } }], 'fixture.invalid', 'cloud-readthrough');
  assert(canonical.before.length > 0, 'canonical fixture must resolve a real dataset');
  await applyQueries([...canonical.before, ...canonical.after]);
  console.log(`PASS DESK-MIGRATION ${backend}: actual raw/canonical history SQL executes; persistent helper resets between identical batches`);
  if (readCosts.length === 2) {
    // Same 21 requested keys and one version per key: 10x older history must
    // not produce a scan. Allow a small fixed difference for index traversal.
    assert(readCosts[1] <= readCosts[0] + 64,
      `tail read cost scales with history: 800=${readCosts[0]}, 8000=${readCosts[1]} (allowed increase:64)`);
    console.log(`PASS DESK-MIGRATION ${backend}: fixed 21-key tail read cost remains bounded across 10x history`);
  }
  if (boundedReadCosts.length === 2) {
    assert(boundedReadCosts[1] <= boundedReadCosts[0] + 64,
      `bounded observation cost scales with history: 800=${boundedReadCosts[0]}, 8000=${boundedReadCosts[1]} (allowed increase:64)`);
    console.log(`PASS DESK-MIGRATION ${backend}: actual observation assembly and predecessor read cost remains bounded across 10x history`);
  }
}

// Ephemeral, local D1 only: no Wrangler account/configuration or persistent state.
async function main() {
  if (!process.argv.includes('--workerd') && !process.argv.includes('--probe-temp')) {
    const db = localSqlite();
    try { await verify(db, 'node:sqlite'); } finally { db.close(); }
    console.log('REVIEW real D1 runtime requires the separate --workerd run; SQLite PASS is not D1 compatibility evidence.');
    return;
  }
  const { Miniflare } = require('miniflare');
  console.log(JSON.stringify({ test: 'desk-migration', pid: process.pid, storage: 'ephemeral-local-D1' }));
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("local migration test"); } };',
    compatibilityDate: '2024-12-01',
    d1Databases: { DB: 'desk-migration-local-test' },
    d1Persist: false,
  });
  const deadline = setTimeout(() => {
    console.error('FAIL migration test internal deadline (22 seconds)');
    process.exitCode = 1;
    void mf.dispose();
  }, 22000);
  try {
    const db = await mf.getD1Database('DB');
    let tempError = null;
    try { await db.prepare('CREATE TEMP TABLE _desk_temp_compatibility_probe (id INTEGER)').run(); }
    catch (error) { tempError = error.message; }
    console.log(JSON.stringify({ test: 'D1_TEMP_TABLE', supported: tempError === null, error: tempError }));
    if (process.argv.includes('--probe-temp')) return;
    await verify(db, 'local-D1/workerd');
  } finally {
    clearTimeout(deadline);
    await mf.dispose();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
