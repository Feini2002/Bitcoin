// Replay the same 60 tiny synthetic cases on Node's newer SQLite optimizer.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const prior = JSON.parse(fs.readFileSync(path.join(here, 'adversarial-equivalence-result.json'), 'utf8'));
const variants = JSON.parse(fs.readFileSync(path.join(here, 'remote-select-probe.json'), 'utf8')).results;
const queries = JSON.parse(fs.readFileSync(path.join(here, 'queries.json'), 'utf8'));
const schema = fs.readFileSync(path.join(root, 'cloudflare/finance/dataset-schema.sql'), 'utf8');
const end = Date.now() + 20000;
let version;
function trial(test, variant) {
  assert(Date.now() < end, 'internal deadline');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(schema); db.exec(queries.ddl);
    db.exec('CREATE TABLE klines(symbol TEXT,interval TEXT,t INTEGER,PRIMARY KEY(symbol,interval,t)); CREATE INDEX raw_tail ON klines(symbol,interval,t DESC)');
    version = db.prepare('SELECT sqlite_version() AS v').get().v;
    if (test.stateExists) db.prepare("INSERT INTO desk_history_state VALUES('BTCUSDT','5m',1700000900000,7)").run();
    for (const row of test.fixtureRows) {
      if (test.kind === 'canonical') {
        const [key, precision, receipt, dataset] = row;
        db.prepare("INSERT INTO finance_dataset_observations VALUES(?,?,NULL,?,?,?,'fixture.invalid','cloud-ws',NULL,'{}')")
          .run(dataset === 'target' ? 'binance-perp-klines-5m' : 'foreign', key, precision, receipt, receipt);
      } else db.prepare('INSERT INTO klines VALUES(?,?,?)').run(...row);
    }
    const rows = () => db.prepare('SELECT symbol,interval,head_t,history_revision FROM desk_history_state').all().map(r => [r.symbol, r.interval, r.head_t, r.history_revision]);
    db.exec('BEGIN');
    const query = variants.find(q => q.key === test.kind && q.variant === variant);
    db.prepare(query.sql).run(...queries[test.kind].params);
    const inside = rows();
    if (test.rollback) {
      assert.throws(() => db.prepare("INSERT INTO desk_history_state VALUES(NULL,'5m',1,0)").run(), /NOT NULL/);
      db.exec('ROLLBACK');
    } else db.exec('COMMIT');
    return { inside, after: rows() };
  } finally { db.close(); }
}
const results = prior.results.map(test => {
  const original = trial(test, 'original'), candidate = trial(test, 'candidate-case');
  assert.deepEqual(original, candidate);
  assert.deepEqual(candidate, { inside: test.inside, after: test.after });
  return { kind: test.kind, fixture: test.fixture, stateExists: test.stateExists, rollback: test.rollback, result: 'PASS' };
});
const report = { at: new Date().toISOString(), runtime: process.version, sqliteVersion: version, comparedWith: prior.sqliteVersion, cases: results.length, scope: 'Same synthetic fixtures and both SQL forms match older SQLite results. Single connection, not D1 concurrency, no billed row measurement.', results };
fs.writeFileSync(path.join(here, 'adversarial-cross-engine-result.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ result: 'PASS', cases: results.length, sqliteVersions: [prior.sqliteVersion, version], scope: report.scope }));
