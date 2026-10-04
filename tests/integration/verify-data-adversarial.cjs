'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const evidence=require('../../js/evidence-bundle.js');
const root=path.resolve(__dirname,'../..');
let passed=0;
const pass=name=>console.log(`PASS DATA-ADVERSARIAL-${++passed} ${name}`);

function database() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync(path.join(root,'cloudflare/finance/schema.sql'),'utf8'));
  const db={sqlite,prepare(sql){return {sql,values:[],bind(...values){this.values=values;return this;},async run(){return sqlite.prepare(sql).run(...this.values);}};},
    async batch(statements){sqlite.exec('BEGIN');try{const result=statements.map(s=>({results:sqlite.prepare(s.sql).all(...s.values)}));sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
  return db;
}

(async()=>{
  const {buildOrderflowDesk,withContentRevision}=await import('../../cloudflare/finance/desk.mjs');
  const {normalizeDataset,FINANCE_DATASETS}=await import('../../cloudflare/finance/datasets.mjs');
  const {optionCoverage}=await import('../../cloudflare/finance/options-coverage.mjs');
  const {FINANCE_VERSION}=await import('../../cloudflare/finance/registry.mjs');
  const {handleFinance}=await import('../../cloudflare/finance/gateway.mjs');
  const {financeSnapshotKey,financeChannelKey,persistFinanceSnapshot,persistFinanceFailure}=await import('../../cloudflare/finance/store.mjs');
  const now=Date.parse('2026-09-30T12:00:00Z'),iso=new Date(now).toISOString(),prior=new Date(now-1000).toISOString();
  const card=values=>({values,referencePeriod:prior,receivedAt:prior,sourceHost:'fapi.binance.com',unavailable:false,sourceStale:false,collectionStale:false});
  const context={scope:'context',asOf:iso,cutoff:{requested:iso,applied:true},quality:{status:'pass'},coverage:{truncated:false},
    contract:{premium:card({markPrice:83800,indexPrice:83801,lastFundingRate:0}),funding:card({fundingRate:0}),basis:card({basis:1,basisRate:0}),
      positioning:{oi:{unavailable:true}}},groups:{dailyRates:{cards:[]}},options:{BTC:{quality:{status:'fail'}},USDC:{quality:{status:'fail'}}}};
  const resource=data=>({name:'context',url:'https://fixture.test/api/desk/context',accessedAt:iso,ok:true,data});
  const build=(data,requirements=null,asOf=iso)=>evidence.build({kind:'fixture-only',asOf,knowledgeCutoff:iso,resources:[resource(data)],requirements});
  const incomplete=build(context),entry=incomplete.entries[0];
  assert.equal(incomplete.transportComplete,true);assert.equal(entry.ready,false);assert.equal(entry.reason,'context_capabilities_incomplete');
  assert.equal(entry.capabilities['context.contract.premium'].ready,true);
  assert.equal(entry.capabilities['context.positioning.oi'].ready,false);
  for(const id of ['fred-dgs2','fred-dgs10','fred-real10y','fred-breakeven10y','nyfed-sofr']) assert.equal(entry.capabilities['context.reference.'+id].ready,false);
  assert.equal(entry.capabilities['context.options.BTC.summary'].ready,false);
  const bounded=build(context,{capabilities:['context.contract.premium'],roles:{observer:['context.contract.premium']}});
  assert.equal(bounded.analysisReady,true);assert.equal(bounded.roleReadiness.observer.ready,true);
  const roleMissing=build(context,{capabilities:['context.contract.premium'],roles:{derivatives:['context.positioning.oi']}});
  assert.equal(roleMissing.analysisReady,false);assert.equal(roleMissing.roleReadiness.derivatives.ready,false);
  assert.notEqual(bounded.contentId,roleMissing.contentId);assert.deepEqual(evidence.validate(roleMissing),[]);
  const unknown=structuredClone(context);unknown.contract.premium.sourceStale=null;
  assert.equal(build(unknown,bounded.requirements).analysisReady,false);
  for(const missing of [null,false,'',0/0]) {
    const bad=structuredClone(context);bad.contract.premium.values.markPrice=missing;
    assert.equal(build(bad,bounded.requirements).analysisReady,false);
  }
  assert.equal(build(context,bounded.requirements,new Date(now-60000).toISOString()).analysisReady,false,'independent event cutoff must not silently reuse later asOf');
  const unknownCapability=build(context,{capabilities:['context.latest.nonexistent']});assert.equal(unknownCapability.analysisReady,false);
  pass('transport/top-level pass cannot hide macro/OI/options gaps; declared role and task capabilities bind readiness and hash');

  const bar={t:now-300000,o:1,h:2,l:1,c:2,buyVol:2,sellVol:1,delta:1,volume:3,levels:[{price:2,buyVol:2,sellVol:1}]};
  const status={last_ok:1,last_trade_time:now-1000,last_run:now-1000};
  const current=buildOrderflowDesk(status,[bar],now);assert.equal(current.quality.status,'pass');assert.equal(current.historicalEligibility.eligible,false);
  assert.equal(current.receivedAt,null,'collector attempt is not a network receipt');assert.equal(current.collectorAttemptAt,prior);
  for(const patch of [{last_trade_time:now+60000},{last_run:now+60000},{receivedAt:new Date(now+60000).toISOString()}]) {
    const result=buildOrderflowDesk({...status,...patch},[bar],now);
    assert.equal(result.quality.status,'fail');assert.equal(result.series.length,0);
    for(const key of ['observedAt','receivedAt','collectorAttemptAt']) if(result[key])assert.ok(Date.parse(result[key])<=now);
  }
  for(const patch of [{t:now+60000},{receivedAt:new Date(now+60000).toISOString()},{updated_at:now+60000}]) {
    const result=buildOrderflowDesk(status,[{...bar,...patch}],now);assert.equal(result.quality.status,'fail');assert.equal(result.series.length,0);
  }
  pass('future footprint event, receipt, attempt and row clocks are excluded; aggregate history stays explicitly ineligible for raw replay');

  for(const key of ['generatedAt','readAt','inputRevision','inputRevisionMethod','sourceLagSeconds']) {
    const first=withContentRevision({asOf:iso,source:{values:{[key]:'source-a'}}});
    const corrected=withContentRevision({asOf:iso,source:{values:{[key]:'source-b'}}});
    assert.notEqual(first.inputRevision,corrected.inputRevision,'native '+key+' must participate in hash');
  }
  const envelope=withContentRevision({asOf:iso,generatedAt:iso,readAt:iso,values:{rate:1}});
  assert.equal(envelope.inputRevision,withContentRevision({...envelope,asOf:prior,generatedAt:prior,readAt:prior}).inputRevision);
  pass('only desk envelope read clocks are omitted; identically named native version/time fields remain content-sensitive');

  const request=new Request('https://fixture.test/api/finance/nyfed/sofr?count=5');
  let calls=0;
  const receiptNow=Date.now(),receipt=new Date(receiptNow).toISOString();
  const native={refRates:[{effectiveDate:'2026-09-29',percentRate:3.88}]};
  const cached={ok:true,version:FINANCE_VERSION,provider:'nyfed',operation:'sofr',parameters:{count:'5'},receivedAt:receipt,data:native,cache:{ttlSeconds:21600}};
  const upstream=async()=>{calls++;return Response.json(native);};
  for(const patch of [{receivedAt:new Date(receiptNow-7200000).toISOString()},{version:'2026-09-16.3'},
    {receivedAt:new Date(receiptNow+3600000).toISOString()},{parameters:{count:'30'}},{ok:false}]) {
    const before=calls;
    const response=await handleFinance(request,{}, {},{cache:{match:async()=>Response.json({...cached,...patch})},fetch:upstream});
    const body=await response.json();assert.equal(response.status,200);assert.equal(calls,before+1);assert.equal(body.cache.hit,false);
  }
  const before=calls;
  const fresh=await (await handleFinance(request,{}, {},{cache:{match:async()=>Response.json(cached)},fetch:upstream})).json();
  assert.equal(calls,before);assert.equal(fresh.cache.hit,true);assert.equal(fresh.cache.ttlSeconds,3600);
  assert.deepEqual(fresh.data,native);
  pass('legacy SOFR edge payloads respect receipt age, version, parameters and success; fresh matching edge avoids upstream calls');

  const instrument={instrument_name:'BTC-2OCT26-84000-C',kind:'option',base_currency:'BTC',settlement_currency:'BTC',expiration_timestamp:now+86400000,strike:84000,option_type:'call',is_active:true};
  const usdc={...instrument,instrument_name:'BTC_USDC-2OCT26-84000-C',settlement_currency:'USDC'};
  const quote={instrument_name:instrument.instrument_name,creation_timestamp:now,mark_iv:50,open_interest:1};
  const source=(id,rows)=>({provider:'deribit',operation:FINANCE_DATASETS[id].operation,parameters:FINANCE_DATASETS[id].parameters,
    receivedAt:iso,requestedAt:iso,data:{result:rows},source:{host:'www.deribit.com'}});
  const normalized=(id,rows)=>normalizeDataset(id,source(id,rows));
  assert.throws(()=>normalized('deribit-btc-options',[{...quote,instrument_name:usdc.instrument_name}]),/instrument_group_mismatch/);
  assert.throws(()=>normalized('deribit-usdc-btc-options',[quote]),/instrument_group_mismatch/);
  assert.throws(()=>normalized('deribit-btc-option-instruments',[{...instrument,settlement_currency:'USDC'}]),/settlement_mismatch/);
  assert.throws(()=>normalized('deribit-btc-option-instruments',[{...instrument,base_currency:'ETH'}]),/underlying_mismatch/);
  assert.throws(()=>normalized('deribit-btc-option-instruments',[{...instrument,kind:'future'}]),/kind_mismatch/);
  assert.throws(()=>normalized('deribit-btc-options',[{...quote,settlementCurrency:'USDC'}]),/settlement_mismatch/);
  assert.equal(normalized('deribit-usdc-btc-option-instruments',[usdc]).rows[0].values.settlementCurrency,'USDC');
  assert.equal(normalized('deribit-btc-options',[quote]).rows[0].values.settlementCurrency,'BTC');
  assert.equal(normalized('deribit-usdc-btc-options',[{...quote,instrument_name:usdc.instrument_name},{...quote,instrument_name:'ETH_USDC-2OCT26-3000-C'}]).rows.length,1);
  const snapshot=rows=>({ok:true,coverage:{truncated:false},observations:rows.map(values=>({values,receivedAt:iso}))});
  const invalidCoverage=optionCoverage(snapshot([instrument]),snapshot([{...quote,instrument_name:usdc.instrument_name,settlementCurrency:'BTC'}]),'BTC',now);
  assert.equal(invalidCoverage.summaryUniverseCovered,false);assert.equal(invalidCoverage.quality.status,'fail');assert.equal(invalidCoverage.invalidCount,1);
  const validCoverage=optionCoverage(snapshot([instrument]),snapshot([quote]),'BTC',now);assert.equal(validCoverage.summaryUniverseCovered,true);
  pass('BTC/USDC name namespaces, base, kind, settlement and metadata reconcile without relabeling foreign options or trusting legacy bad rows');

  const parameters=offset=>({instrument_name:'BTC-PERPETUAL',start_timestamp:String(receiptNow-86400000+offset),end_timestamp:String(receiptNow+offset)});
  const keys=[0,3600000,7200000].map(offset=>financeSnapshotKey('deribit','funding-history',parameters(offset)));
  assert.equal(new Set(keys).size,1);assert.equal(new Set([0,3600000,7200000].map(offset=>financeChannelKey('deribit','funding-history',parameters(offset)))).size,3);
  const db=database();
  for(const [index,offset] of [0,3600000,7200000].entries()) await persistFinanceSnapshot(db,keys[index],{ok:true,provider:'deribit',operation:'funding-history',parameters:parameters(offset),receivedAt:new Date(receiptNow+index).toISOString(),data:{result:[]}},receipt);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM finance_channel_state').get().n,1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(DISTINCT snapshot_id) AS n FROM finance_snapshot_chunks').get().n,1);
  db.sqlite.close();
  pass('rolling Deribit snake_case windows use one bounded history slot while retaining exact request identity');

  const quotaDb=database(),env={DB:quotaDb,FINANCE_D1_ENABLED:'true'};
  const fundingRequest=offset=>new Request('https://fixture.test/api/finance/deribit/funding-history?'+new URLSearchParams(parameters(offset)));
  let quotaCalls=0;
  const limited=async()=>{quotaCalls++;return new Response('limited',{status:429,headers:{'Retry-After':'120'}});};
  assert.equal((await handleFinance(fundingRequest(0),env,{}, {fetch:limited})).status,429);
  const blocked=await handleFinance(fundingRequest(3600000),env,{}, {fetch:limited});
  assert.equal(blocked.status,429);assert.equal((await blocked.json()).cooldownScope,'provider-operation');assert.equal(quotaCalls,1);
  assert.equal(quotaDb.sqlite.prepare('SELECT COUNT(*) AS n FROM finance_channel_state').get().n,1);
  quotaDb.sqlite.prepare('DELETE FROM finance_channel_state').run();
  const legacyKey=financeChannelKey('deribit','funding-history',parameters(0));
  await persistFinanceFailure(quotaDb,legacyKey,'deribit','funding-history',parameters(0),{error:'upstream_rate_limited',upstreamStatus:429},429,receipt,new Date(receiptNow+120000).toISOString());
  assert.equal((await handleFinance(fundingRequest(7200000),env,{}, {fetch:limited})).status,429);assert.equal(quotaCalls,1);
  const other=await handleFinance(new Request('https://fixture.test/api/finance/deribit/ticker?instrument_name=BTC-PERPETUAL'),env,{},
    {fetch:async()=>{quotaCalls++;return Response.json({result:{instrument_name:'BTC-PERPETUAL'}});}});
  assert.equal(other.status,200);assert.equal(quotaCalls,2,'other operation is not blocked by a funding-history quota');
  quotaDb.sqlite.close();
  pass('provider/operation cooldown blocks changed windows and legacy keys without blocking unrelated operations');
  console.log(`Data adversarial: ${passed} PASS, 0 FAIL (synthetic/offline SQLite fixtures; no upstream network)`);
})().catch(error=>{console.error(error);process.exitCode=1;});
