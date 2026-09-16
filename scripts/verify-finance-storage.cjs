const assert = require('node:assert/strict');
const fs = require('node:fs');
const {DatabaseSync} = require('node:sqlite');
const {pathToFileURL} = require('node:url');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
let passed = 0;
const pass = name => console.log(`PASS FIN-D1-${++passed} ${name}`);

// Execute the production SQL against real SQLite, with D1's atomic batch contract.
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync(path.join(root, 'cloudflare/finance/schema.sql'), 'utf8'));
  const db = {
    sqlite, failBatch:false,
    prepare(sql) {
      const statement = {sql, values:[], bind(...values) {this.values = values; return this;},
        async run() {sqlite.prepare(sql).run(...this.values); return {success:true};}};
      return statement;
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((item, index) => {
          if (db.failBatch && index === 1) throw Error('fixture failed batch');
          return {success:true, results:sqlite.prepare(item.sql).all(...item.values)};
        });
        sqlite.exec('COMMIT');
        return results;
      } catch(error) {sqlite.exec('ROLLBACK'); throw error;}
    },
  };
  return db;
}

(async () => {
  const gateway = await import(pathToFileURL(path.join(root, 'cloudflare/finance/gateway.mjs')));
  const store = await import(pathToFileURL(path.join(root, 'cloudflare/finance/store.mjs')));
  const db = database();
  const env = {DB:db, FINANCE_D1_ENABLED:'true'};
  const request = suffix => new Request('https://fixture.test/api/finance/'+suffix);
  let calls = 0;
  const payload = {id:'btc-bitcoin', price:'123.4500', observed_at:1700000000, unicode:'市场🪙'.repeat(100000)};
  const deps = {cache:null, fetch:async () => {calls++; return Response.json(payload);}};
  let response = await gateway.handleFinance(request('coinpaprika/ticker'),env,{},deps);
  assert.equal(response.status,200);
  const first = await response.json();
  assert.equal(first.storage.persisted,true);
  assert.deepEqual(first.data,payload);
  const row = db.sqlite.prepare('SELECT * FROM finance_channel_state').get();
  assert.ok(row.chunk_count > 1);
  assert.ok(db.sqlite.prepare('SELECT MAX(length(CAST(content AS BLOB))) AS n FROM finance_snapshot_chunks').get().n < 2000000);
  pass('large Unicode source payload is stored in bounded rows and read back losslessly');

  const noFetch = () => {throw Error('unexpected fetch');};
  const cached = await (await gateway.handleFinance(request('coinpaprika/ticker'),env,{}, {fetch:noFetch})).json();
  const read = await (await gateway.handleFinance(request('stored/coinpaprika/ticker'),{...env,FREE_COINPAPRIKA_API_KEY:undefined},{},{fetch:noFetch})).json();
  assert.deepEqual(read.data, first.data);
  assert.equal(cached.receivedAt,first.receivedAt);
  assert.equal(read.storage.storedAt,first.storage.storedAt);
  assert.equal(cached.cache.hit,true);
  assert.equal(calls,1);
  pass('fresh D1 cache and independent stored endpoint make zero upstream calls');

  const failedPayload = {error:'upstream_rate_limited'};
  const attempted = new Date(Date.now()+1000).toISOString();
  await store.persistFinanceFailure(db,row.channel_key,'coinpaprika','ticker',first.parameters,failedPayload,429,attempted,new Date(Date.now()+60000).toISOString());
  const preserved = await (await gateway.handleFinance(request('stored/coinpaprika/ticker'),env,{}, {fetch:noFetch})).json();
  assert.deepEqual(preserved.data,payload);
  assert.equal(preserved.storage.latestHttpStatus,429);
  pass('failure records health without replacing last successful native data');

  db.sqlite.prepare("UPDATE finance_channel_state SET received_at = '2000-01-01T00:00:00.000Z'").run();
  response = await gateway.handleFinance(request('coinpaprika/ticker'),env,{}, {fetch:noFetch});
  assert.equal(response.status,429);
  assert.equal((await response.json()).cooldown,true);
  pass('persisted cooldown prevents another quota-consuming upstream call');

  db.sqlite.prepare('UPDATE finance_channel_state SET retry_at = NULL').run();
  db.failBatch = true;
  const before = db.sqlite.prepare('SELECT COUNT(*) AS n FROM finance_snapshot_chunks').get().n;
  await assert.rejects(store.persistFinanceSnapshot(db,row.channel_key,{...first,receivedAt:attempted},attempted));
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM finance_snapshot_chunks').get().n,before);
  db.failBatch = false;
  assert.deepEqual((await store.readFinanceSnapshot(db,row.channel_key)).envelope.data,payload);
  pass('a partial batch failure rolls back chunks and preserves the prior snapshot');

  await store.persistFinanceSnapshot(db,row.channel_key,{...first,receivedAt:attempted},attempted);
  await store.persistFinanceSnapshot(db,row.channel_key,{...first,receivedAt:'2001-01-01T00:00:00.000Z',data:{older:true}},attempted);
  const winner = await store.readFinanceSnapshot(db,row.channel_key);
  assert.equal(winner.envelope.receivedAt,attempted);
  assert.deepEqual(winner.envelope.data,payload);
  assert.equal(db.sqlite.prepare('SELECT COUNT(DISTINCT snapshot_id) AS n FROM finance_snapshot_chunks').get().n,1);
  pass('late older response cannot overwrite a newer snapshot or leak unused chunks');

  response = await gateway.handleFinance(request('coinpaprika/ticker?unknown=1'),env,{}, {fetch:noFetch});
  assert.equal(response.status,400);
  response = await gateway.handleFinance(request('coinpaprika/ticker'),{FINANCE_D1_ENABLED:'true'}, {},{fetch:noFetch});
  assert.equal(response.status,503);
  pass('invalid requests and missing storage fail before network calls');

  const failing = database();
  const failedEnv = {DB:failing,FINANCE_D1_ENABLED:'true'};
  response = await gateway.handleFinance(request('coinpaprika/ticker'),failedEnv,{}, {fetch:async () => {failing.failBatch = true; return Response.json({price:1});}});
  assert.equal(response.status,503);
  assert.equal((await response.json()).error,'finance_storage_write_failed');
  pass('successful upstream with failed D1 write never claims persistence');

  const quotaDb = database();
  const quotaEnv = {DB:quotaDb,FINANCE_D1_ENABLED:'true'};
  response = await gateway.handleFinance(request('coinpaprika/ticker'),quotaEnv,{}, {fetch:async () => new Response('limited',{status:429,headers:{'Retry-After':new Date(Date.now()+120000).toUTCString()}})});
  assert.equal(response.status,429);
  assert.ok(Number(response.headers.get('Retry-After'))>100);
  const stats = await (await gateway.handleFinance(request('status'),quotaEnv,{}, {fetch:noFetch})).json();
  assert.equal(stats.channels,1); assert.equal(stats.stored,0); assert.equal(stats.entries[0].last_error,'upstream_rate_limited');
  pass('HTTP-date Retry-After persists; status distinguishes attempted and stored channels');
  for (const item of [db,failing,quotaDb]) item.sqlite.close();
  console.log(`Finance D1: ${passed} PASS, 0 FAIL`);
})().catch(error => {console.error(error); process.exitCode=1;});
