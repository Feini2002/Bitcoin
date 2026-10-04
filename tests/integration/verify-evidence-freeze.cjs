'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const identity = require('../../js/content-identity.js');
const evidence = require('../../js/evidence-bundle.js');

(async () => {
  const {buildContextDesk,buildHeatmapDesk,buildOrderflowDesk,withContentRevision,handleDesk} = await import('../../cloudflare/finance/desk.mjs');
  const {readAggregateAsKnown} = await import('../../cloudflare/finance/aggregate-evidence.mjs');
  const now = Date.parse('2026-09-30T13:00:00Z');
  const iso = new Date(now).toISOString();
  for (const text of ['', 'abc', '比特币', 'x'.repeat(1000)]) assert.equal(identity.sha256(text), crypto.createHash('sha256').update(text).digest('hex'));
  assert.equal(identity.contentId({b:2,a:1}), identity.contentId({a:1,b:2}));
  const macro = value => buildContextDesk({'fred-dgs2': {ok:true,provider:'fred',collectionStale:false,
    observations:[{observedAt:'2026-09-29',timePrecision:'day',receivedAt:iso,sourceHost:'api.stlouisfed.org',values:{value}}]}}, now);
  assert.notEqual(macro(4).inputRevision, macro(5).inputRevision);
  const bucket = {symbol:'BTCUSDT',exchange:'binance',bucket_start:now-300000,long_notional:100,short_notional:2,long_count:1,short_count:1};
  assert.notEqual(buildHeatmapDesk([bucket],now).inputRevision,buildHeatmapDesk([{...bucket,long_notional:1000}],now).inputRevision);
  assert.equal(buildHeatmapDesk([bucket,{...bucket,exchange:'bybit'}],now).inputRevision,buildHeatmapDesk([{...bucket,exchange:'bybit'},bucket],now).inputRevision);
  const status = {last_ok:1,last_trade_time:now-1000,last_run:now-1000};
  const bar = {t:now-300000,o:1,h:2,l:1,c:2,buyVol:2,sellVol:1,delta:1,volume:3,levels:[{price:2,buyVol:2,sellVol:1}]};
  assert.notEqual(buildOrderflowDesk(status,[bar],now).inputRevision,buildOrderflowDesk(status,[{...bar,delta:10,volume:30}],now).inputRevision);
  assert.notEqual(buildOrderflowDesk(status,[bar],now).inputRevision,buildOrderflowDesk(status,[{...bar,levels:[{price:2,buyVol:20,sellVol:10}]}],now).inputRevision);
  const desk = withContentRevision({asOf:iso,values:{rate:1},receivedAt:iso,units:{rate:'percent'},quality:{status:'pass'},coverage:{gaps:[]}});
  assert.equal(desk.inputRevision,withContentRevision({...desk,asOf:new Date(now+1000).toISOString()}).inputRevision);
  for (const patch of [{receivedAt:new Date(now+1000).toISOString()},{units:{rate:'ratio'}},{quality:{status:'warn'}},{coverage:{gaps:[1]}},{values:{rate:null}}])
    assert.notEqual(desk.inputRevision,withContentRevision({...desk,...patch}).inputRevision);
  console.log('PASS content versions detect all three review counterexamples, units, receipts, corrections and quality; order and read clock stay stable');

  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync('cloudflare/schema.sql','utf8'));
  const migration = fs.readFileSync('cloudflare/finance/aggregate-evidence-migration.sql','utf8');
  sqlite.exec(migration); sqlite.exec(migration);
  sqlite.prepare('INSERT INTO liquidation_5m_buckets(symbol,exchange,bucket_start,long_notional,updated_at) VALUES(?,?,?,?,?)').run('BTCUSDT','binance',now-300000,100,now);
  sqlite.prepare('UPDATE liquidation_5m_buckets SET long_notional=1000').run();
  const journal = sqlite.prepare('SELECT * FROM desk_aggregate_versions ORDER BY id').all();
  assert.equal(journal.length,2);
  assert.equal(JSON.parse(journal[0].payload_json).long_notional,100);
  assert.equal(JSON.parse(journal[1].payload_json).long_notional,1000);
  assert.equal(journal[0].received_at,null);
  sqlite.prepare('UPDATE desk_aggregate_versions SET stored_at=? WHERE id=?').run('2026-09-30T12:59:00.000Z',journal[0].id);
  sqlite.prepare('UPDATE desk_aggregate_versions SET stored_at=? WHERE id=?').run('2026-09-30T13:01:00.000Z',journal[1].id);
  sqlite.prepare('UPDATE liquidation_5m_buckets SET updated_at=updated_at+1').run();
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM desk_aggregate_versions').get().n,2,'receipt-only aggregate writes must not multiply unchanged content');
  const db = {prepare(sql) { return {values:[],bind(...values){this.values=values;return this;},async all(){return {results:sqlite.prepare(sql).all(...this.values)};},async first(){return sqlite.prepare(sql).get(...this.values)||null;}};}};
  const frozen = await readAggregateAsKnown(db,'heatmap','BTCUSDT',{knownAt:iso,from:now-86400000,to:now});
  assert.equal(frozen.rows[0].long_notional,100);
  assert.equal(frozen.evidence.versions[0].storedAt,'2026-09-30T12:59:00.000Z');
  assert.equal(frozen.evidence.versions[0].committedAt,null);
  assert.equal(frozen.evidence.versions[0].commitAcknowledged,false);
  assert.equal(frozen.evidence.journal.knowledgeClock,'database-statement-time');
  const later = await readAggregateAsKnown(db,'heatmap','BTCUSDT',{knownAt:'2026-09-30T13:02:00.000Z'});
  assert.equal(later.rows[0].long_notional,1000);
  sqlite.prepare('DELETE FROM liquidation_5m_buckets').run();
  sqlite.prepare('UPDATE desk_aggregate_versions SET stored_at=? WHERE deleted=1').run('2026-09-30T13:03:00.000Z');
  assert.equal((await readAggregateAsKnown(db,'heatmap','BTCUSDT',{knownAt:'2026-09-30T13:04:00.000Z'})).rows.length,0);
  assert.equal((await readAggregateAsKnown(db,'heatmap','BTCUSDT',{knownAt:iso})).rows[0].long_notional,100);
  console.log('PASS additive journal preserves pre-correction cutoffs and deletion tombstones without fabricating network receipts');
  for (const scope of evidence.scopes) {
    const invalid = await handleDesk(new Request('http://test/api/desk/'+scope+'?knownAt=nonsense'),{DB:db});
    assert.equal(invalid.status,400);
    const future = await handleDesk(new Request('http://test/api/desk/'+scope+'?knownAt=2099-01-01T00:00:00Z'),{DB:db});
    assert.equal(future.status,400);
  }
  const records = evidence.scopes.map(name => ({name,url:'http://test/'+name,accessedAt:iso,ok:true,data:{scope:name,cutoff:{requested:iso,applied:true},quality:{status:'pass'},coverage:{truncated:false},researchWindow:{eligible:true},series:[bar]}}));
  const bundle = evidence.build({kind:'daily_event',asOf:iso,knowledgeCutoff:iso,resources:records,capturedAt:iso});
  assert.equal(bundle.transportComplete,true); assert.equal(bundle.cutoffComplete,true); assert.equal(bundle.analysisReady,false,'sampled liquidations do not imply all events complete');
  assert.deepEqual(evidence.validate(bundle),[]);
  records[0].data.series[0].c=999;
  assert.equal(bundle.entries.find(e=>e.name==='chart').data.series[0].c,2);
  const tampered=JSON.parse(JSON.stringify(bundle));tampered.entries[0].data.series[0].c=888;
  assert.ok(evidence.validate(tampered).includes('bundle_content_mismatch'));
  const oldApi=evidence.build({kind:'daily_event',asOf:iso,knowledgeCutoff:iso,resources:[{name:'chart',url:'http://test',accessedAt:iso,ok:true,data:{quality:{status:'pass'}}}]});
  assert.equal(oldApi.transportComplete,true);assert.equal(oldApi.cutoffComplete,false);assert.equal(oldApi.analysisReady,false);
  sqlite.close();
  console.log('PASS frozen package separates transport/cutoff/readiness, rejects tampering and excludes unsupported-cutoff reads');
})().catch(error=>{console.error(error);process.exitCode=1;});
