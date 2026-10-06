const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../..');
function database() {
  const sqlite=new DatabaseSync(':memory:');
  for(const f of ['cloudflare/schema.sql','cloudflare/finance/dataset-schema.sql','cloudflare/finance/desk-history-migration.sql']) sqlite.exec(fs.readFileSync(path.join(root,f),'utf8'));
  const db={sqlite,batches:[],beforeBatch:null,
    prepare(sql){return {sql,params:[],bind(...params){this.params=params;return this;},
      async all(){return {results:sqlite.prepare(sql).all(...this.params)};}};},
    async batch(qs){
      await db.beforeBatch?.(qs); db.batches.push(qs);
      sqlite.exec('BEGIN');
      try {
        const out=qs.map(q=>{const before=Number(sqlite.prepare('SELECT total_changes() n').get().n);
          const results=sqlite.prepare(q.sql).all(...q.params);
          return {results,meta:{changes:Number(sqlite.prepare('SELECT total_changes() n').get().n)-before}};});
        sqlite.exec('COMMIT');return out;
      }catch(error){sqlite.exec('ROLLBACK');throw error;}
    }};
  return db;
}
module.exports=(async()=>{
  const load=f=>import(pathToFileURL(path.join(root,'cloudflare/finance',f)));
  const {persistKlineCommit:commit}=await load('kline-commit.mjs');
  const {readDataset,readDatasetSummary,prepareBoundedObservations,deskHistoryKey,canonicalHistoryStatements,historyBaselineStatement}=await load('dataset-store.mjs');
  const {summarizeD1Results}=await load('d1-cost.mjs');
  const base=Date.now()-86400000, step=300000, t=Math.floor(base/step)*step;
  const iso=n=>new Date(n).toISOString();
  const bar=(time=t,c=100)=>[time,100,120,90,c,2,time+step-1,200,4,1,100];
  const fresh=()=>database();
  const ws=(db,row,at,closed=false,more={})=>commit({DB:db},'BTCUSDT','5m',[row],'fstream.binance.com','cloud-ws',{receivedAt:iso(at),closed,...more});
  const rest=(db,rows,start,at,more={})=>commit({DB:db},'BTCUSDT','5m',rows,'fapi.binance.com','cloud-readthrough',{
    restBatch:true,requestStartedAt:iso(start),receivedAt:iso(at),...more});
  const raw=db=>db.sqlite.prepare("SELECT c FROM klines WHERE interval='5m' AND t=?").get(t)?.c;
  const canonical=async db=>(await readDataset(db,'binance-perp-klines-5m')).observations.find(r=>r.key===String(t))?.values.close;
  const revision=db=>db.sqlite.prepare("SELECT history_revision n FROM desk_history_state WHERE interval='5m'").get()?.n;
  let db=fresh(), cost=[];
  await ws(db,bar(),t+1,false,{onCost:r=>cost.push(r)});
  assert.equal(raw(db),100); assert.equal(await canonical(db),100);
  assert.equal(db.sqlite.prepare('SELECT last_ok n FROM sync_status').get().n,1);
  assert.equal(db.batches.filter(qs=>qs.some(q=>q.sql.includes('INSERT INTO klines'))).length,1);
  assert.ok(cost.every(c=>c.rowsRead===null),'SQLite logical changes must never masquerade as D1 billable reads');
  console.log('PASS ATOMIC-1 one transaction commits both representations and success; missing D1 metadata is UNKNOWN');

  // A real database constraint fires after the canonical write, before success.
  db.sqlite.exec(`CREATE TRIGGER reject_raw BEFORE UPDATE ON klines WHEN NEW.c=106 BEGIN SELECT RAISE(ABORT,'injected raw constraint'); END`);
  const rev=revision(db);
  await assert.rejects(ws(db,bar(t,106),t+2),/injected raw constraint/);
  assert.equal(raw(db),100);assert.equal(await canonical(db),100);assert.equal(revision(db),rev);
  assert.equal(db.sqlite.prepare('SELECT last_ok n FROM sync_status').get().n,0);
  assert.equal(db.sqlite.prepare('SELECT last_error e FROM finance_dataset_state').get().e,'kline_commit_failed');
  db.sqlite.prepare('UPDATE finance_dataset_state SET last_success_received_at=?').run(iso(Date.now()));
  assert.equal((await readDataset(db,'binance-perp-klines-5m')).collectionStale,true,'fresh prior success cannot hide commit failure');
  assert.equal((await readDatasetSummary(db,'binance-perp-klines-5m')).collectionStale,true);
  db.sqlite.exec('DROP TRIGGER reject_raw');
  await ws(db,bar(t,106),t+2);assert.equal(raw(db),106);assert.equal(await canonical(db),106);
  assert.equal(db.sqlite.prepare('SELECT last_ok n FROM sync_status').get().n,1,'retry keeps the original receipt timestamp');
  console.log('PASS ATOMIC-2 mid-transaction constraint rolls back data/head/revision and invalidates the previous fresh success; retry converges');
  db.sqlite.close();

  db=fresh();
  await ws(db,bar(t,118),t+step+100,true);
  await rest(db,[bar(t,101)],t+step+50,t+step+200);
  assert.equal(raw(db),118);assert.equal(await canonical(db),118);
  assert.equal(db.sqlite.prepare('SELECT last_success_received_at t FROM finance_dataset_state').get().t,iso(t+step+100));
  assert.equal(db.sqlite.prepare('SELECT last_run t FROM sync_status').get().t,t+step+100,'superseded REST must not refresh collection success');
  const stale=db.sqlite.prepare('SELECT value_json FROM finance_dataset_observations WHERE received_at=?').get(iso(t+step+200));
  assert.equal(JSON.parse(stale.value_json).supersededByWs,true);
  const bounded=prepareBoundedObservations(db,'binance-perp-klines-5m',{limit:20});
  assert.equal(bounded.parse(await bounded.statement.all()).observations[0].values.close,118);
  await rest(db,[bar(t,101)],t+step+50,t+step+200);
  await ws(db,bar(t,102),t+step+1,false);
  assert.equal(raw(db),118);assert.equal(await canonical(db),118);
  await rest(db,[bar(t,119)],t+step+300,t+step+400);
  assert.equal(raw(db),119);assert.equal(await canonical(db),119);
  assert.equal((await readDataset(db,'binance-perp-klines-5m',{knownAt:iso(t+step+150)})).observations[0].values.close,118);
  console.log('PASS ATOMIC-3 late REST evidence retained but excluded from raw/current/knownAt winners; later valid REST can revise');
  db.sqlite.close();

  db=fresh();
  await rest(db,[bar(t,101)],t+step+150,t+step+200);
  await ws(db,bar(t,102),t+step+100,true);
  await rest(db,[bar(t,101)],t+step+150,t+step+200);
  assert.equal(raw(db),101);assert.equal(await canonical(db),101);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM finance_dataset_observations').get().n,2);
  db.sqlite.close();

  db=fresh();
  const settled=await Promise.allSettled([ws(db,bar(t,101),t+step+1,true),ws(db,bar(t,102),t+step+1,true)]);
  assert.equal(settled.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(settled.filter(r=>r.status==='rejected').length,1);
  assert.equal(raw(db),await canonical(db));
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM finance_dataset_observations').get().n,1);
  console.log('PASS ATOMIC-4 competing preflights cannot silently accept conflicting immutable identities');
  db.sqlite.close();

  db=fresh();
  const many=Array.from({length:501},(_,i)=>bar(t-(501-i)*step,101));
  db.sqlite.exec(`CREATE TRIGGER reject_second_chunk BEFORE INSERT ON klines WHEN NEW.t=${many[500][0]} BEGIN SELECT RAISE(ABORT,'second chunk failed'); END`);
  await assert.rejects(rest(db,many,t+1,t+2),/second chunk failed/);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM klines').get().n,500);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM finance_dataset_observations').get().n,500);
  assert.equal(db.sqlite.prepare('SELECT last_ok n FROM sync_status').get().n,0);
  db.sqlite.exec('DROP TRIGGER reject_second_chunk');
  await rest(db,many,t+1,t+2);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM klines').get().n,501);
  assert.equal(db.sqlite.prepare('SELECT last_ok n FROM sync_status').get().n,1);
  assert.ok(db.batches.every(qs=>qs.length<=40));
  assert.ok(db.batches.flat().every(q=>q.params.length<=100 && Buffer.byteLength(q.sql)<=100000));
  console.log('PASS ATOMIC-5 second chunk failure preserves completed chunks with explicit incomplete state; restart/replay completes coverage within SQL limits');
  db.sqlite.close();

  for(const id of ['binance-spot-klines-1h','binance-perp-funding','fed-walcl','binance-perp-premium']) {
    assert.equal(deskHistoryKey(id),null);assert.deepEqual(canonicalHistoryStatements(id,[{}],'fixture','local-bootstrap'),{before:[],after:[]});
  }
  assert.ok(deskHistoryKey('binance-perp-klines-1h'));
  db=fresh();db.sqlite.prepare('INSERT INTO klines VALUES (?,?,?,?,?,?,?,?)').run('BTCUSDT','5m',t,100,110,90,100,1);
  const baseline=historyBaselineStatement('BTCUSDT','5m','binance-perp-klines-5m');
  await db.batch([db.prepare(baseline.sql).bind(...baseline.params)]);
  db.sqlite.prepare('UPDATE desk_history_state SET history_revision=7').run();
  await db.batch([db.prepare(baseline.sql).bind(...baseline.params)]);
  assert.equal(revision(db),7);assert.equal(db.sqlite.prepare('SELECT head_t n FROM desk_history_state').get().n,t);
  db.sqlite.prepare('UPDATE desk_history_state SET head_t=?').run(t+10000000);
  const repair=fs.readFileSync(path.join(root,'cloudflare/finance/kline-history-head-repair.sql'),'utf8');
  db.sqlite.exec(repair);assert.equal(revision(db),8);assert.equal(db.sqlite.prepare('SELECT head_t n FROM desk_history_state').get().n,t);
  db.sqlite.exec(repair);assert.equal(revision(db),8,'derived repair is idempotent and never resets revision');
  assert.deepEqual(summarizeD1Results([{meta:{rows_read:1,rows_written:2,changes:1}},{meta:{rows_read:3,rows_written:4,changes:2}}],2),{statements:2,rowsRead:4,rowsWritten:6,changes:3});
  console.log('PASS ATOMIC-6 spot/macro/non-chart data never maintain perp cache state; historical baseline keeps prior revision; statement costs sum exactly');
  db.sqlite.close();
})().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
