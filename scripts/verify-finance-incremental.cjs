const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
let passed = 0;
const pass = message => console.log(`PASS FIN-INC-${++passed} ${message}`);
function database() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of ['schema.sql','dataset-schema.sql']) sqlite.exec(fs.readFileSync(path.join(root,'cloudflare/finance',file),'utf8'));
  sqlite.exec(fs.readFileSync(path.join(root,'cloudflare/schema.sql'),'utf8'));
  sqlite.exec(fs.readFileSync(path.join(root,'cloudflare/finance/desk-history-migration.sql'),'utf8'));
  const db = {sqlite,writeStatements:0,failNext:false,failSql:null,
    changes:()=>Number(sqlite.prepare('SELECT total_changes() AS n').get().n),
    prepare(sql) { return {sql,values:[],bind(...values){this.values=values;return this;},
      async all(){return {results:sqlite.prepare(sql).all(...this.values)};},
      async first(){return sqlite.prepare(sql).get(...this.values)||null;},
      async run(){db.writeStatements++;const r=sqlite.prepare(sql).run(...this.values);return {meta:{changes:Number(r.changes)}};}};},
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results=statements.map(s=>{
          if (/^\s*(INSERT|UPDATE|DELETE)/.test(s.sql)) {
            db.writeStatements++;
            if(db.failNext||(db.failSql&&s.sql.includes(db.failSql))){db.failNext=false;db.failSql=null;throw Error('injected write failure');}
          }
          return {results:sqlite.prepare(s.sql).all(...s.values)};
        });
        sqlite.exec('COMMIT');return results;
      } catch(error) {sqlite.exec('ROLLBACK');throw error;}
    },
  };return db;
}
(async()=>{
  const load=file=>import(pathToFileURL(path.join(root,'cloudflare/finance',file)));
  const {FINANCE_DATASETS:D,normalizeDataset,datasetRequest,datasetSupportsIncremental}=await load('datasets.mjs');
  const {persistDataset,readDataset,readDatasetSummary,prepareBoundedObservations,pruneExpiredDatasets,pruneDatasetObservations,persistLiveKlineBar,persistLiveSnapshot,persistRestKlineBatch,datasetFailure}=await load('dataset-store.mjs');
  const {handleFinance,buildFinanceRequest}=await load('gateway.mjs');
  const {financeChannelKey,financeSnapshotKey,persistFinanceSnapshot}=await load('store.mjs');
  const {refreshFinanceDataset,syncFinanceDatasetsIfDue}=await load('scheduler.mjs');
  const RealDate=Date;
  let now=Date.parse('2026-09-26T00:00:00.000Z');
  globalThis.Date=class extends RealDate {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
  const envelope=(id,data,at=now,parameters=D[id].parameters)=>({ok:true,provider:D[id].provider,operation:D[id].operation,parameters,
    source:{host:'fapi.binance.com'},requestedAt:new Date(at).toISOString(),receivedAt:new Date(at).toISOString(),data});
  const funding=(time,rate='0.0001')=>({symbol:'BTCUSDT',fundingTime:time,fundingRate:rate,markPrice:'100000'});
  const id='binance-perp-funding',base=now;
  const full=Array.from({length:500},(_,i)=>funding(base-(500-i)*3600000));
  const db=database();
  await persistDataset(db,id,envelope(id,full));
  for(let i=1;i<=260;i++) await persistDataset(db,id,envelope(id,full.slice(-2),base+i*300000,{...D[id].parameters,limit:'2'}));
  assert.equal((await readDataset(db,id,{knownAt:new Date(base+260*300000).toISOString()})).coverage.available,500);
  const firstRevision=base+261*300000;
  await persistDataset(db,id,envelope(id,[funding(full[10].fundingTime,'0.0002')],firstRevision));
  await pruneExpiredDatasets(db,firstRevision,{ids:[id]});
  assert.equal(db.sqlite.prepare('SELECT COUNT(DISTINCT observation_key) AS n FROM finance_dataset_observations').get().n,500);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS n FROM finance_dataset_observations').get().n,1021);
  const oldKey=String(full[10].fundingTime);
  assert.equal((await readDataset(db,id,{knownAt:new Date(firstRevision-1).toISOString()})).observations.find(r=>r.key===oldKey).values.fundingRate,0.0001);
  assert.equal((await readDataset(db,id,{knownAt:new Date(firstRevision).toISOString()})).observations.find(r=>r.key===oldKey).values.fundingRate,0.0002);
  pass('500 observations survive 260 tail receipts and scheduled pruning, including an older-point revision');

  const cached=envelope(id,full.slice(-2),base+260*300000,{...D[id].parameters,limit:'2'});
  const changes=db.changes(),statements=db.writeStatements;
  assert.equal(await persistDataset(db,id,cached),0);
  assert.equal(db.changes(),changes);assert.equal(db.writeStatements,statements);
  await assert.rejects(persistDataset(db,id,{...cached,data:[funding(full.at(-1).fundingTime,'0.9')]}),/identity_content_conflict/);
  await persistDataset(db,id,envelope(id,[funding(full.at(-1).fundingTime,'0.001')],base+1000));
  assert.equal((await readDataset(db,id,{knownAt:new Date(base+260*300000).toISOString()})).observations[0].values.fundingRate,0.0001);
  pass('cached receipts issue zero writes, conflicting identity is rejected and late arrivals do not overwrite later evidence');

  for(const parameters of [{...D[id].parameters,symbol:'ETHUSDT'},{...D[id].parameters,limit:'0'},{...D[id].parameters,startTime:'9007199254740992'},{...D[id].parameters,startTime:'2',endTime:'1'}]) {
    assert.throws(()=>normalizeDataset(id,envelope(id,full,now,parameters)),/parameter_mismatch/);
  }
  assert.throws(()=>datasetRequest(id,undefined,{symbol:'ETHUSDT'}),/parameter_mismatch/);
  const point=full.at(-1);
  normalizeDataset(id,envelope(id,[point],now,{...D[id].parameters,startTime:String(point.fundingTime),endTime:String(point.fundingTime)}));
  assert.throws(()=>normalizeDataset(id,envelope(id,[point],now,{...D[id].parameters,startTime:String(point.fundingTime+1)})),/window_mismatch/);
  assert.throws(()=>buildFinanceRequest('binance-usdm','funding',new URLSearchParams({startTime:'2',endTime:'1'})),/invalid_parameter/);
  pass('window boundaries are inclusive and identity, bounds and reversed-time validation remain strict');

  const cacheDb=database(),env={DB:cacheDb,FINANCE_D1_ENABLED:'true'};
  const native=(start)=>new Request('https://fixture.test/api/finance/binance-usdm/funding?symbol=BTCUSDT&limit=500'+(start===undefined?'':`&startTime=${start}`));
  const nativeFetch=async(url)=>Response.json([funding(Number(new URL(url).searchParams.get('startTime')) || base)]);
  await handleFinance(native(),env,{}, {fetch:nativeFetch});
  for(let i=0;i<60;i++){now++;const response=await handleFinance(native(base+i),env,{}, {fetch:nativeFetch});assert.equal((await response.json()).data[0].fundingTime,base+i);}
  assert.equal(cacheDb.sqlite.prepare('SELECT COUNT(*) AS n FROM finance_channel_state').get().n,2);
  assert.equal(new Set(Array.from({length:60},(_,i)=>financeSnapshotKey('binance-usdm','funding',{...D[id].parameters,startTime:String(base+i)}))).size,1);
  const current=await (await handleFinance(native(),env,{}, {fetch:()=>{throw Error('cache missed');}})).json();
  assert.equal(current.data[0].fundingTime,base);
  const rawChanges=cacheDb.changes(),rawStatements=cacheDb.writeStatements;
  await persistFinanceSnapshot(cacheDb,financeSnapshotKey('binance-usdm','funding',current.parameters),current,new Date().toISOString());
  assert.equal(cacheDb.changes(),rawChanges);assert.equal(cacheDb.writeStatements,rawStatements);
  pass('60 cursor windows use one historical slot, exact parameters gate reuse, current snapshot and repeated raw receipt stay intact');

  const scheduleDb=database(),scheduleEnv={DB:scheduleDb,FINANCE_D1_ENABLED:'true'};
  now=base;
  let data=full.slice(),seen=[];
  const fetchData=async(url)=>{
    const u=new URL(url);seen.push(u);
    const start=u.searchParams.get('startTime');
    const selected=start===null ? data.slice(-Number(u.searchParams.get('limit'))) : data.filter(r=>r.fundingTime>=Number(start)).slice(0,500);
    return Response.json(selected);
  };
  let result=await refreshFinanceDataset(scheduleEnv,id,{now,dependencies:{fetch:fetchData}});
  assert.equal(result.mode,'full');assert.equal(result.written,500);
  now+=300000;const beforeTail=scheduleDb.changes();
  result=await refreshFinanceDataset(scheduleEnv,id,{now,dependencies:{fetch:fetchData}});
  assert.equal(result.mode,'tail');assert.equal(result.written,2);
  assert.equal(seen.at(-1).searchParams.get('startTime'),String(full.at(-2).fundingTime));
  const tailSqlChanges=scheduleDb.changes()-beforeTail;
  now+=300000;data.push(funding(base+120000));
  result=await refreshFinanceDataset(scheduleEnv,id,{now,dependencies:{fetch:fetchData}});
  assert.equal(result.written,3); // actual irregular settlement, not an 8h cursor
  now=base+86400001;data[20]=funding(data[20].fundingTime,'0.003');
  result=await refreshFinanceDataset(scheduleEnv,id,{now,dependencies:{fetch:fetchData}});
  assert.equal(result.mode,'full');assert.equal(result.written,500);
  assert.equal((await readDataset(scheduleDb,id)).observations.find(r=>r.key===String(data[20].fundingTime)).values.fundingRate,0.003);
  pass('funding uses real settlement overlap, preserves an irregular new settlement and audits older revisions daily');

  const hourlyId='binance-perp-oi-history',hourDb=database(),hourEnv={DB:hourDb,FINANCE_D1_ENABLED:'true'};
  const hourPoint=(time)=>({symbol:'BTCUSDT',timestamp:time,sumOpenInterest:'10',sumOpenInterestValue:'100'});
  now=base;let hours=Array.from({length:500},(_,i)=>hourPoint(base-(499-i)*3600000));
  const hourFetch=async(url)=>{const p=new URL(url).searchParams;return Response.json(hours.filter(row=>(!p.has('startTime') || row.timestamp>=Number(p.get('startTime'))) && (!p.has('endTime') || row.timestamp<=Number(p.get('endTime')))).slice(-Number(p.get('limit'))).reverse());};
  await refreshFinanceDataset(hourEnv,hourlyId,{now,dependencies:{fetch:hourFetch}});
  now+=4*3600000;hours.push(...[1,2,3,4].map(i=>hourPoint(base+i*3600000)));
  result=await refreshFinanceDataset(hourEnv,hourlyId,{now,dependencies:{fetch:hourFetch}});
  assert.equal(result.mode,'gap-full');assert.equal(result.requests,2);assert.equal(result.uncoveredGap,false);
  for(let i=1;i<=4;i++) assert.ok((await readDataset(hourDb,hourlyId)).observations.some(r=>r.key===String(base+i*3600000)));
  await pruneDatasetObservations(hourDb,hourlyId,500);
  assert.equal((await readDataset(hourDb,hourlyId)).coverage.available,500);
  pass('descending tail response detects missing intervals and fills them before distinct-point retention');

  const gapDb=database(),gapEnv={DB:gapDb,FINANCE_D1_ENABLED:'true'};
  now=base;let gapRows=[hourPoint(base)];let failGap=false;
  const gapFetch=async raw=>{const p=new URL(raw).searchParams;if(p.has('startTime') && failGap)return new Response('{}',{status:500});
    return Response.json(gapRows.filter(row=>(!p.has('startTime') || row.timestamp>=Number(p.get('startTime'))) && (!p.has('endTime') || row.timestamp<=Number(p.get('endTime')))).slice(-Number(p.get('limit'))));};
  await refreshFinanceDataset(gapEnv,hourlyId,{now,dependencies:{fetch:gapFetch}});
  now+=4*3600000;gapRows=[0,1,2,3,4].map(i=>hourPoint(base+i*3600000));failGap=true;
  assert.equal((await refreshFinanceDataset(gapEnv,hourlyId,{now,dependencies:{fetch:gapFetch}})).ok,false);
  let gapState=(await readDataset(gapDb,hourlyId)).state;
  assert.match(gapState.last_error,/^dataset_history_gap_pending:/);
  await persistDataset(gapDb,hourlyId,envelope(hourlyId,gapRows.slice(-2),now+1000,{...D[hourlyId].parameters,limit:'2'}));
  await datasetFailure(gapDb,hourlyId,502,'different_transient_failure');
  assert.equal((await readDataset(gapDb,hourlyId)).state.last_error,gapState.last_error);
  now+=1800000;failGap=false;
  assert.equal((await refreshFinanceDataset(gapEnv,hourlyId,{now,dependencies:{fetch:gapFetch}})).mode,'gap-recovery');
  assert.equal((await readDataset(gapDb,hourlyId)).coverage.available,5);
  assert.equal((await readDataset(gapDb,hourlyId)).state.last_error,null);
  pass('failed recovery retains its checkpoint across unrelated success/failure until SQL verifies the missing interval');
  // Permanent empty historical pages are cooled, while current acquisition continues.
  now+=4*3600000;gapRows.push(...[5,6,7,8].map(i=>hourPoint(base+i*3600000)));failGap=true;
  await refreshFinanceDataset(gapEnv,hourlyId,{now,dependencies:{fetch:gapFetch}});
  now+=1800001;
  let historyCalls=0,tailCalls=0;
  const emptyGapFetch=async raw=>{const p=new URL(raw).searchParams;if(p.has('startTime')){historyCalls++;return Response.json([]);}tailCalls++;return Response.json(gapRows.slice(-2));};
  let partial=await refreshFinanceDataset(gapEnv,hourlyId,{now,dependencies:{fetch:emptyGapFetch}});
  assert.equal(partial.requests,2);assert.equal(partial.uncoveredGap,true);assert.equal(historyCalls,1);assert.equal(tailCalls,1);
  now+=60000;gapRows.push(hourPoint(base+9*3600000));
  partial=await refreshFinanceDataset(gapEnv,hourlyId,{now,dependencies:{fetch:emptyGapFetch}});
  assert.equal(historyCalls,1);assert.equal(tailCalls,2);assert.equal(partial.requests,1);
  assert.equal((await readDataset(gapDb,hourlyId)).observations[0].key,String(base+9*3600000));
  assert.equal((await readDataset(gapDb,hourlyId)).coverage.incomplete,true);
  assert.equal((await readDataset(gapDb,hourlyId)).collectionStale,false);
  const oldGap=JSON.parse((await readDataset(gapDb,hourlyId)).state.last_error.split('dataset_history_gap_pending:')[1]);
  now=oldGap.retryAt+1;gapRows.push(...[10,11,12,13].map(i=>hourPoint(base+i*3600000)));
  const raceFetch=async raw=>{const p=new URL(raw).searchParams;if(!p.has('startTime'))return Response.json(gapRows.slice(-2));
    await refreshFinanceDataset(gapEnv,hourlyId,{now,skipGap:true,dependencies:{fetch:async()=>Response.json(gapRows.slice(-2))}});
    return Response.json(gapRows.filter(row=>row.timestamp>=Number(p.get('startTime')) && row.timestamp<=Number(p.get('endTime'))));};
  await refreshFinanceDataset(gapEnv,hourlyId,{now,dependencies:{fetch:raceFetch}});
  const mergedGap=JSON.parse((await readDataset(gapDb,hourlyId)).state.last_error.split('dataset_history_gap_pending:')[1]);
  assert.equal(mergedGap.from,oldGap.from);assert.ok(mergedGap.to>oldGap.to);assert.notEqual(mergedGap.token,oldGap.token);
  const sparseDb=database(),sparseEnv={DB:sparseDb,FINANCE_D1_ENABLED:'true'};
  await persistDataset(sparseDb,hourlyId,envelope(hourlyId,[hourPoint(base),hourPoint(base+4*3600000)]));
  sparseDb.sqlite.prepare('UPDATE finance_dataset_state SET last_error=? WHERE dataset_id=?').run('dataset_history_gap_pending:'+JSON.stringify({from:base+3600000,to:base+3*3600000,step:3600000,token:'sparse'}),hourlyId);
  const sparseFetch=async raw=>Response.json(new URL(raw).searchParams.has('startTime') ? [hourPoint(base+2*3600000),hourPoint(base+3*3600000)] : [hourPoint(base+4*3600000)]);
  await refreshFinanceDataset(sparseEnv,hourlyId,{now,dependencies:{fetch:sparseFetch}});
  let sparse=JSON.parse((await readDataset(sparseDb,hourlyId)).state.last_error.split('dataset_history_gap_pending:')[1]);
  assert.equal(sparse.failures,1);now=sparse.retryAt+1;
  await refreshFinanceDataset(sparseEnv,hourlyId,{now,dependencies:{fetch:sparseFetch}});
  sparse=JSON.parse((await readDataset(sparseDb,hourlyId)).state.last_error.split('dataset_history_gap_pending:')[1]);
  assert.equal(sparse.failures,2);assert.equal(sparse.retryAt-now,3600000);
  pass('permanently missing history retries at most every 30 minutes without suppressing the current tail');

  const live=database(),barTime=base-300000;
  const bar=close=>[barTime,'100','110','90',String(close),'20',barTime+299999,'2000',10,'12','1200'];
  await persistLiveKlineBar(live,'5m',bar(104),'fstream.binance.com','cloud-ws',{closed:false,receivedAt:new Date(base).toISOString()});
  await persistLiveKlineBar(live,'5m',bar(105),'fstream.binance.com','cloud-ws',{closed:true,receivedAt:new Date(base+1000).toISOString()});
  await persistLiveKlineBar(live,'5m',bar(101),'fstream.binance.com','cloud-ws',{closed:false,receivedAt:new Date(base-1000).toISOString()});
  const latest=(await readDataset(live,'binance-perp-klines-5m',{knownAt:new Date(base+2000).toISOString()})).observations[0];
  assert.equal(latest.values.close,105);assert.equal(latest.values.closed,true);assert.equal(latest.values.finality,'exchange_closed');
  assert.equal(live.sqlite.prepare('SELECT COUNT(*) AS n FROM finance_dataset_observations').get().n,2);
  await assert.rejects(persistLiveKlineBar(live,'5m',bar(109),'fstream.binance.com','cloud-ws',{closed:true,receivedAt:new Date(base+1000).toISOString()}),/identity_content_conflict/);
  live.failNext=true;
  await assert.rejects(persistLiveKlineBar(live,'5m',bar(106),'fstream.binance.com','cloud-ws',{closed:true,receivedAt:new Date(base+3000).toISOString()}),/injected/);
  pass('explicit exchange close has immutable receipt evidence, late mutable updates cannot replace it and failure propagates');

  now=base+4000;
  await persistLiveKlineBar(live,'5m',bar(107),'fapi.binance.com','cloud-readthrough',{closed:null,receivedAt:new Date(now).toISOString()});
  const afterRest=(await readDataset(live,'binance-perp-klines-5m')).observations[0];
  assert.equal(afterRest.values.close,107);assert.equal(afterRest.values.closed,true);assert.equal(afterRest.values.finality,'exchange_closed');
  assert.equal((await readDataset(live,'binance-perp-klines-5m',{knownAt:new Date(base+2000).toISOString()})).observations[0].values.close,105);
  const unconfirmed=[base,'100','110','90','108','20',base+299999,'2000',10,'12','1200'];
  await persistLiveKlineBar(live,'5m',unconfirmed,'fapi.binance.com','cloud-readthrough',{closed:null,receivedAt:new Date(base+5000).toISOString()});
  assert.equal((await readDataset(live,'binance-perp-klines-5m',{knownAt:new Date(base+6000).toISOString()})).observations[0].values.closed,null);
  await persistLiveKlineBar(live,'5m',unconfirmed,'fstream.binance.com','cloud-ws',{closed:true,receivedAt:new Date(base+10000).toISOString()});
  await persistLiveKlineBar(live,'5m',unconfirmed,'fapi.binance.com','cloud-readthrough',{closed:null,receivedAt:new Date(base+7000).toISOString()});
  assert.equal((await readDataset(live,'binance-perp-klines-5m',{knownAt:new Date(base+8000).toISOString()})).observations[0].values.closed,null);
  pass('REST preserves an already confirmed close, but neither elapsed time nor a future close receipt confirms an unknown bar');
  now=base+20000;
  await persistRestKlineBatch(live,'5m',[bar(108)],'fapi.binance.com',{receivedAt:new Date(now).toISOString(),requestStartedAt:new Date(now-1).toISOString()});
  assert.equal((await readDataset(live,'binance-perp-klines-5m')).observations.find(row=>row.key===String(barTime)).values.finality,'exchange_closed');
  await persistRestKlineBatch(live,'3d',[bar(108)],'fapi.binance.com',{receivedAt:new Date(now).toISOString(),requestStartedAt:new Date(now-1).toISOString()});
  assert.equal((await readDataset(live,'binance-perp-klines-3d')).observations.some(row=>row.key===String(bar(108)[0])), true);
  await assert.rejects(persistRestKlineBatch(live,'5m',[unconfirmed],'fapi.binance.com',{receivedAt:new Date(now).toISOString(),requestStartedAt:new Date(now).toISOString()}),/invalid_closed_rest_batch/);
  pass('bulk REST retains prior exchange close, rejects a request-crossing bar, and stores an official closed 3d bar');
  const crossingDb=database(),crossingId='binance-perp-klines-5m';
  const crossingBar=value=>[base-300000,'100','130','90',String(value),'20',base-1,'2000',10,'12','1200'];
  await persistLiveKlineBar(crossingDb,'5m',crossingBar(100),'fstream.binance.com','cloud-ws',{closed:false,receivedAt:new Date(base-3).toISOString()});
  await persistLiveKlineBar(crossingDb,'5m',crossingBar(120),'fstream.binance.com','cloud-ws',{closed:true,receivedAt:new Date(base+1).toISOString()});
  now=base+2;
  await persistDataset(crossingDb,crossingId,{...envelope(crossingId,[crossingBar(101)]),requestedAt:new Date(base-2).toISOString()});
  assert.equal((await readDataset(crossingDb,crossingId)).observations[0].values.close,120);
  assert.equal((await readDataset(crossingDb,crossingId)).observations[0].values.finality,'exchange_closed');
  assert.equal((await readDataset(crossingDb,crossingId,{knownAt:new Date(base).toISOString()})).observations[0].values.close,100);
  const crossingReceipt=JSON.parse(crossingDb.sqlite.prepare('SELECT value_json FROM finance_dataset_observations WHERE dataset_id=? AND received_at=?').get(crossingId,new Date(base+2).toISOString()).value_json);
  assert.equal(crossingReceipt.closed,false);assert.notEqual(crossingReceipt.finality,'exchange_closed');
  pass('a REST response requested before close cannot inherit proof or displace the later exchange-final price');

  const premiumDb=database();
  const premium={symbol:'BTCUSDT',time:base,markPrice:'100',indexPrice:'99',lastFundingRate:'0.0001',interestRate:'0',nextFundingTime:base+3600000};
  const receiptAt=new Date(base).toISOString();
  await assert.rejects(async()=>{await persistLiveSnapshot(premiumDb,'binance-perp-premium',premium,'fstream.binance.com','cloud-ws',{receivedAt:receiptAt});throw Error('lost reply after commit');},/lost reply/);
  now=base+5000;const committedChanges=premiumDb.changes(),committedStatements=premiumDb.writeStatements;
  assert.equal(await persistLiveSnapshot(premiumDb,'binance-perp-premium',premium,'fstream.binance.com','cloud-ws',{receivedAt:receiptAt}),0);
  assert.equal(premiumDb.changes(),committedChanges);assert.equal(premiumDb.writeStatements,committedStatements);
  await persistLiveSnapshot(premiumDb,'binance-perp-premium',premium,'fstream.binance.com','cloud-ws',{receivedAt:new Date(now).toISOString()});
  const premiumReceipts=premiumDb.sqlite.prepare('SELECT received_at FROM finance_dataset_observations ORDER BY received_at').all().map(row=>row.received_at);
  assert.deepEqual(premiumReceipts,[receiptAt,new Date(now).toISOString()]);
  pass('premium lost acknowledgement reuses its real receipt without writes; a genuinely new equal-valued receipt stays distinct');

  const currentDb=database(),currentId='binance-perp-klines-1h';
  const currentBar=close=>[base,'100','110','90',String(close),'20',base+3599999,'2000',10,'12','1200'];
  now=base+1000;
  await persistLiveKlineBar(currentDb,'1h',currentBar(104),'fstream.binance.com','cloud-ws',{closed:false,receivedAt:new Date(now).toISOString()});
  now=base+2000;await persistDataset(currentDb,currentId,envelope(currentId,[currentBar(105)]));
  now=base+3000;
  await persistLiveKlineBar(currentDb,'1h',currentBar(106),'fstream.binance.com','cloud-ws',{closed:false,receivedAt:new Date(now).toISOString()});
  const currentRead=await readDataset(currentDb,currentId);
  assert.equal(currentRead.observations[0].values.close,106);assert.equal(currentRead.readIntent,'current');
  assert.equal((await readDataset(currentDb,currentId,{knownAt:new Date(base+2000).toISOString()})).observations[0].values.close,105);
  assert.equal((await readDataset(currentDb,currentId,{knownAt:new Date(base+1000).toISOString()})).observations.length,0);
  const getDataset=suffix=>handleFinance(new Request('https://fixture.test/api/finance/datasets/'+currentId+suffix),{DB:currentDb,FINANCE_D1_ENABLED:'true'});
  assert.equal((await (await getDataset('')).json()).observations[0].values.close,106);
  assert.equal((await (await getDataset('?known_at='+new Date(base+2000).toISOString())).json()).observations[0].values.close,105);
  const {buildChartDesk}=await load('desk.mjs');
  assert.equal(buildChartDesk(currentRead,'1h',now).series.at(-1).c,106);
  pass('daily audit cannot freeze newer forming WS; explicit historical read excludes overwritten future live state and current desk stays populated');

  const optionDb=database();
  for(let n=0;n<10;n++) await persistDataset(optionDb,'deribit-btc-options',envelope('deribit-btc-options',{result:[1,2,3].map(k=>({instrument_name:`BTC-TEST-${k}-C`,creation_timestamp:base,open_interest:k}))},base+n*1000));
  await pruneExpiredDatasets(optionDb,base+10000,{ids:['deribit-btc-options']});
  const counts=optionDb.sqlite.prepare('SELECT received_at,COUNT(*) AS n FROM finance_dataset_observations GROUP BY received_at').all();
  assert.equal(counts.length,9);assert.ok(counts.every(row=>row.n===3));
  await pruneExpiredDatasets(optionDb,base+10000,{ids:['deribit-btc-options']});
  assert.equal(optionDb.sqlite.prepare('SELECT COUNT(DISTINCT received_at) AS n FROM finance_dataset_observations').get().n,8);
  pass('bounded options cleanup removes complete obsolete snapshots and preserves eight latest snapshots');

  const macroDb=database(),macroId='fred-cpi';
  const macroData=(value='100',date=new Date(now).toISOString().slice(0,10))=>({observations:[{date:'2026-01-01',value,realtime_start:date,realtime_end:date}]});
  now=base;await persistDataset(macroDb,macroId,envelope(macroId,macroData()));
  now=base+2000;await persistDataset(macroDb,macroId,{...envelope(macroId,macroData()),source:{host:'api.stlouisfed.org'}},'cloud-readthrough');
  now=base+1000;await persistDataset(macroDb,macroId,{...envelope(macroId,macroData('200')),source:{host:'bootstrap.fixture'}},'local-bootstrap');
  assert.equal((await readDataset(macroDb,macroId,{knownAt:new Date(base+1500).toISOString()})).observations[0].values.value,200);
  assert.equal((await readDataset(macroDb,macroId,{knownAt:new Date(base+2500).toISOString()})).observations[0].values.value,100);
  const restored=macroDb.sqlite.prepare("SELECT source_host,ingestion_mode FROM finance_dataset_observations WHERE dataset_id=? AND observation_key='2026-01-01' AND received_at=?").get(macroId,new Date(base+2000).toISOString());
  assert.equal(restored.source_host,'api.stlouisfed.org');assert.equal(restored.ingestion_mode,'cloud-readthrough');
  now=base+86400000;await persistDataset(macroDb,macroId,envelope(macroId,macroData()));
  const latestMacro=await readDataset(macroDb,macroId);
  assert.equal(latestMacro.coverage.available,1);assert.equal(latestMacro.coverage.returned,1);assert.equal(latestMacro.state.row_count,1);
  assert.equal(latestMacro.observations[0].sourceRevision.realtimeStart,new Date(now).toISOString().slice(0,10));
  assert.equal(macroDb.sqlite.prepare("SELECT COUNT(*) AS n FROM finance_dataset_observations WHERE time_precision<>'receipt'").get().n,3);
  const beforeReplay=macroDb.changes();await persistDataset(macroDb,macroId,envelope(macroId,macroData()));assert.equal(macroDb.changes(),beforeReplay);
  now+=1000;await persistDataset(macroDb,macroId,envelope(macroId,macroData('100','2026-01-15')));
  assert.equal((await readDataset(macroDb,macroId)).observations[0].sourceRevision.realtimeStart,'2026-01-15');
  assert.equal(macroDb.sqlite.prepare("SELECT COUNT(*) AS n FROM finance_dataset_observations WHERE time_precision<>'receipt'").get().n,4);
  const lateEqualDb=database();now=base;await persistDataset(lateEqualDb,macroId,envelope(macroId,macroData('100')));
  now=base+2000;await persistDataset(lateEqualDb,macroId,envelope(macroId,macroData('200')));
  now=base+1000;await persistDataset(lateEqualDb,macroId,envelope(macroId,macroData('200')));
  assert.equal((await readDataset(lateEqualDb,macroId,{knownAt:new Date(base+1500).toISOString()})).observations[0].values.value,200);
  const midnightDb=database();
  const rootWindowData=day=>({realtime_start:day,realtime_end:day,observations:[{date:'2026-01-01',value:'100',realtime_start:day,realtime_end:day}]});
  now=base;await persistDataset(midnightDb,macroId,envelope(macroId,rootWindowData('2026-09-25')));
  now=base+86400000;await persistDataset(midnightDb,macroId,envelope(macroId,rootWindowData('2026-09-26')));
  assert.equal(midnightDb.sqlite.prepare("SELECT COUNT(*) AS n FROM finance_dataset_observations WHERE time_precision<>'receipt'").get().n,1);
  assert.equal((await readDataset(midnightDb,macroId)).observations[0].sourceRevision.realtimeStart,'2026-09-26');
  pass('macro query windows use lightweight receipts, late A-B-A restores its successor, genuine vintage and knownAt remain intact');
  for (const [fixture,cutoff] of [[macroDb,base+1500],[macroDb,base+2500],[macroDb,base+86401000],
    [midnightDb,base],[midnightDb,base+86400000]]) {
    const options={knownAt:new Date(cutoff).toISOString()};
    assert.deepEqual((await readDatasetSummary(fixture,macroId,options)).observations,
      (await readDataset(fixture,macroId,{...options,limit:1})).observations);
  }
  const sofrDb=database(),sofrId='nyfed-sofr';
  const sofrData={refRates:[{effectiveDate:'2026-09-25',percentRate:4.5}]};
  now=base;await persistDataset(sofrDb,sofrId,envelope(sofrId,sofrData));
  now=base+86400000;await persistDataset(sofrDb,sofrId,{...envelope(sofrId,sofrData),source:{host:'markets.newyorkfed.org'}},'cloud-readthrough');
  const sofrSummary=await readDatasetSummary(sofrDb,sofrId);
  assert.deepEqual(sofrSummary.observations,(await readDataset(sofrDb,sofrId,{limit:1})).observations);
  assert.equal(sofrSummary.observations[0].receivedAt,new Date(now).toISOString());
  assert.equal(sofrSummary.observations[0].sourceHost,'markets.newyorkfed.org');
  now+=1000;await persistDataset(sofrDb,sofrId,envelope(sofrId,{refRates:[{effectiveDate:'2026-09-24',percentRate:4.4}]}));
  assert.deepEqual((await readDatasetSummary(sofrDb,sofrId)).observations,(await readDataset(sofrDb,sofrId,{limit:1})).observations);
  assert.notEqual((await readDatasetSummary(sofrDb,sofrId)).observations[0].receivedAt,new Date(now).toISOString());
  sofrDb.sqlite.close();
  pass('macro summary reconstructs lightweight FRED/SOFR receipts, knownAt, query windows and genuine vintages only for receipt keys');
  for(const reversed of [false,true]) {
    const concurrentDb=database();now=base;
    await persistDataset(concurrentDb,macroId,envelope(macroId,macroData('100')));
    const execute=concurrentDb.batch.bind(concurrentDb),pending=[];
    concurrentDb.batch=statements=>new Promise((resolve,reject)=>{
      pending.push({statements,resolve,reject});
      if(pending.length===2) {
        concurrentDb.batch=execute;
        pending.sort((a,b)=>(reversed?-1:1)*a.statements.at(-1).values[1].localeCompare(b.statements.at(-1).values[1]));
        (async()=>{for(const item of pending){try{item.resolve(await execute(item.statements));}catch(error){item.reject(error);}}})();
      }
    });
    const writes=await Promise.all([
      persistDataset(concurrentDb,macroId,envelope(macroId,macroData('200'),base+1000)),
      persistDataset(concurrentDb,macroId,envelope(macroId,macroData('100'),base+2000)),
    ]);
    assert.equal(writes.reduce((sum,n)=>sum+n,0),2);
    assert.equal((await readDataset(concurrentDb,macroId,{knownAt:new Date(base+1500).toISOString()})).observations[0].values.value,200);
    assert.equal((await readDataset(concurrentDb,macroId,{knownAt:new Date(base+2500).toISOString()})).observations[0].values.value,100);
  }
  now=base+2*86400000;
  await persistDataset(midnightDb,macroId,envelope(macroId,{observations:[{date:'2026-02-01',value:'100'}]}));
  await pruneDatasetObservations(midnightDb,macroId,1);
  assert.equal((await readDataset(midnightDb,macroId)).coverage.available,1);
  assert.equal(midnightDb.sqlite.prepare("SELECT COUNT(*) AS n FROM finance_dataset_observations WHERE time_precision='receipt'").get().n,1);
  pass('concurrent macro preflights preserve both commit orders and receipt cleanup follows retained observation dates');

  const logicalWrites=[];
  for (const historyId of Object.keys(D).filter(datasetSupportsIncremental)) {
    const definition=D[historyId],testDb=database(),testEnv={DB:testDb,FINANCE_D1_ENABLED:'true'};
    const step={'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000,'3d':259200000,'1w':604800000}[definition.parameters.interval || definition.parameters.period] || 3600000;
    const make=time=>definition.kind==='klines' ? [time,'100','110','90','105','20',time+step-1,'2000',10,'12','1200']
      : definition.kind==='funding' ? funding(time)
      : {timestamp:time,sumOpenInterest:'10',sumOpenInterestValue:'100',buyVol:'12',sellVol:'10',buySellRatio:'1.2',
          longAccount:'0.6',shortAccount:'0.4',longPosition:'0.6',shortPosition:'0.4',longShortRatio:'1.5',basis:'1',basisRate:'0.0001',annualizedBasisRate:'',indexPrice:'100',futuresPrice:'101'};
    const observations=Array.from({length:500},(_,i)=>make(base-(499-i)*step));
    const fixtures=async url=>{const u=new URL(url);const start=Number(u.searchParams.get('startTime'));
      return Response.json(start ? observations.filter(r=>(r.fundingTime || r.timestamp || r[0])>=start).slice(0,500) : observations.slice(-Number(u.searchParams.get('limit'))));};
    now=base;
    await refreshFinanceDataset(testEnv,historyId,{now,dependencies:{fetch:fixtures}});
    now+=Math.max(definition.refreshSeconds,60)*1000;
    await refreshFinanceDataset(testEnv,historyId,{now,dependencies:{fetch:fixtures}});
    now+=Math.max(definition.refreshSeconds,60)*1000;
    const before=testDb.changes();
    result=await refreshFinanceDataset(testEnv,historyId,{now,dependencies:{fetch:fixtures}});
    assert.equal(result.written,2,historyId);
    assert.equal(testDb.changes()-before,6,historyId);
    now=base+86400001;const beforeAudit=testDb.changes();
    await refreshFinanceDataset(testEnv,historyId,{now,dependencies:{fetch:fixtures}});
    assert.equal(testDb.changes()-beforeAudit,504,historyId);
    logicalWrites.push({id:historyId,steadyRows:6,auditRows:504});
    testDb.sqlite.close();
  }
  pass('all 13 Binance historical datasets measure six logical rows per steady tail and 504 per full audit');

  const fairnessDb=database(),fairnessEnv={DB:fairnessDb,FINANCE_D1_ENABLED:'true',FREE_FRED_API_KEY:'fixture-only'};
  const failingIds=Object.keys(D).filter(key=>D[key].kind==='fred').slice(0,8);
  const healthyIds=['binance-perp-funding','binance-perp-basis','btc-fees'];
  const targetIds=new Set([...failingIds,...healthyIds]),oldReceipt=new Date(base-1800000).toISOString();
  now=base;
  for(const [key,definition] of Object.entries(D)) {
    const received=new Date(targetIds.has(key) ? base-7200000 : base).toISOString();
    fairnessDb.sqlite.prepare('INSERT INTO finance_dataset_state(dataset_id,attempted_at,last_http_status,last_error,last_success_received_at) VALUES(?,?,?,?,?)')
      .run(key,received,failingIds.includes(key)?502:200,failingIds.includes(key)?'upstream_http_error':null,received);
    if(datasetSupportsIncremental(key)) {
      const url=new URL(datasetRequest(key).url),built=buildFinanceRequest(definition.provider,definition.operation,url.searchParams,{},true);
      assert.equal(financeChannelKey(definition.provider,definition.operation,definition.parameters),financeSnapshotKey(definition.provider,definition.operation,built.values),key);
      fairnessDb.sqlite.prepare('INSERT INTO finance_channel_state(channel_key,provider,operation,parameters_json,attempted_at,last_http_status,received_at) VALUES(?,?,?,?,?,200,?)')
        .run(financeChannelKey(definition.provider,definition.operation,definition.parameters),definition.provider,definition.operation,JSON.stringify(definition.parameters),oldReceipt,oldReceipt);
      if(!healthyIds.includes(key)) fairnessDb.sqlite.prepare("INSERT INTO finance_dataset_observations(dataset_id,observation_key,observed_at,time_precision,received_at,stored_at,source_host,ingestion_mode,value_json) VALUES(?,'fixture',?,'millisecond',?,?,'fapi.binance.com','cloud-readthrough','{}')")
        .run(key,oldReceipt,oldReceipt,oldReceipt);
    }
  }
  await persistDataset(fairnessDb,'binance-perp-funding',envelope('binance-perp-funding',[funding(base-8*3600000)],base-1800000));
  await persistDataset(fairnessDb,'binance-perp-basis',envelope('binance-perp-basis',[{timestamp:base-3600000,basis:'1',basisRate:'0.0001'}],base-1800000));
  const originalFetch=globalThis.fetch,updates=Object.fromEntries(healthyIds.map(key=>[key,[]]));let fredFails=true;
  globalThis.fetch=async raw=>{
    const url=new URL(raw);
    if(url.hostname==='api.stlouisfed.org')return fredFails ? new Response('{}',{status:503}) : Response.json({observations:[{date:'2026-09-25',value:'100'}]});
    if(url.pathname.endsWith('/fundingRate'))return Response.json([funding(base-8*3600000)]);
    if(url.pathname.endsWith('/basis'))return Response.json([{timestamp:base,basis:'1',basisRate:'0.0001'}]);
    if(url.hostname==='mempool.space')return Response.json({fastestFee:2,halfHourFee:1,hourFee:1,minimumFee:1});
    throw Error('unexpected scheduler fixture request '+url.hostname+url.pathname);
  };
  try {
    for(let tick=0;tick<22;tick++) {
      now=base+tick*60000;
      if(tick===12)fredFails=false;
      // Other collectors maintain their ordinary current receipts during this outage.
      for(const key of Object.keys(D).filter(key=>!targetIds.has(key))) fairnessDb.sqlite.prepare('UPDATE finance_dataset_state SET attempted_at=?,last_success_received_at=? WHERE dataset_id=?')
        .run(new Date(now).toISOString(),new Date(now).toISOString(),key);
      const cycle=await syncFinanceDatasetsIfDue(fairnessEnv,now);
      assert.ok(cycle.attempted<=8);assert.equal(cycle.ok,true);
      if(tick===0){
        const fredAttempts=cycle.results.filter(item=>failingIds.includes(item.id));
        assert.ok(fredAttempts.length>=1 && fredAttempts.length<=1);
        assert.ok(fredAttempts.every(item=>!item.ok));
      }
      for(const item of cycle.results.filter(item=>healthyIds.includes(item.id))) {assert.equal(item.ok,true,item.id);updates[item.id].push(tick);}
      if(tick>=1)assert.ok(cycle.results.some(item=>item.id==='btc-fees'&&item.ok),'fees retain their 60-second cadence at tick '+tick);
    }
    assert.deepEqual(updates['binance-perp-funding'],[0,5,10,15,20]);assert.deepEqual(updates['binance-perp-basis'],[0,5,10,15,20]);
    for(const key of failingIds) {
      const state=fairnessDb.sqlite.prepare('SELECT * FROM finance_dataset_state WHERE dataset_id=?').get(key);
      assert.equal(state.last_error,null,key);assert.ok(Date.parse(state.last_success_received_at)>=base+12*60000,key);
    }
    now+=60000;
    const recoveredCycle=await syncFinanceDatasetsIfDue(fairnessEnv,now);
    assert.ok(recoveredCycle.results.every(item=>!failingIds.includes(item.id)),'recovered FRED sources return to their normal hourly interval');
  } finally {globalThis.fetch=originalFetch;fairnessDb.sqlite.close();}
  pass('eight persistent FRED failures relinquish queue priority; funding/basis and fees keep cadence and recovered sources resume normal refresh');

  const revDb=database();
  const revStep=300000, revHead=base-base%revStep;
  for(let i=0;i<40;i++) revDb.sqlite.prepare('INSERT INTO klines(symbol,interval,t,o,h,l,c,v) VALUES (?,?,?,?,?,?,?,?)').run('BTCUSDT','5m',revHead-i*revStep,1,2,0,1,1);
  const {handleDesk}=await import(pathToFileURL(path.join(root,'cloudflare/finance/desk.mjs')));
  const {__footprintTestHooks:klineHooks}=await import(pathToFileURL(path.join(root,'cloudflare/binance-klines-worker.js')));
  const fullDesk=await (await handleDesk(new Request('http://desk.local/api/desk/chart?interval=5m&from='+(revHead-39*revStep)+'&to='+(revHead+revStep)),{DB:revDb})).json();
  assert.equal(fullDesk.historyRevision,0);assert.equal(fullDesk.headT,revHead);
  const revision=()=>revDb.sqlite.prepare('SELECT history_revision AS n, head_t AS t FROM desk_history_state WHERE symbol=? AND interval=?').get('BTCUSDT','5m');
  await klineHooks.persistKlines({DB:revDb},'BTCUSDT','5m',[[revHead-30*revStep,1,2,0,9,1]]);
  assert.equal(revision().n,1);assert.equal(revision().t,revHead);
  await klineHooks.persistKlines({DB:revDb},'BTCUSDT','5m',[[revHead-30*revStep,1,2,0,9,1]]);
  assert.equal(revision().n,1);
  revDb.failNext=true;
  await assert.rejects(klineHooks.persistKlines({DB:revDb},'BTCUSDT','5m',[[revHead-30*revStep,1,2,0,8,1]]));
  assert.equal(revision().n,1);assert.equal(revDb.sqlite.prepare('SELECT c FROM klines WHERE t=?').get(revHead-30*revStep).c,9);
  await klineHooks.persistKlines({DB:revDb},'BTCUSDT','5m',[[revHead,1,2,0,4,1]]);
  assert.equal(revision().n,1);assert.equal(revision().t,revHead);
  await klineHooks.persistKlines({DB:revDb},'BTCUSDT','5m',[[revHead-20*revStep,1,2,0,7,1]]);
  assert.equal(revision().n,2);assert.equal(revision().t,revHead);
  const canonicalOld=[revHead-30*revStep,'1','8','0','6','1',revHead-30*revStep+revStep-1,'2',1,'0','0'];
  await persistDataset(revDb,'binance-perp-klines-5m',{...envelope('binance-perp-klines-5m',[canonicalOld],revHead+1000),requestedAt:new Date(revHead+1000).toISOString()});
  assert.equal(revision().n,3);
  const beforeRepeat=revision().n;
  assert.equal(await persistDataset(revDb,'binance-perp-klines-5m',{...envelope('binance-perp-klines-5m',[canonicalOld],revHead+1000),requestedAt:new Date(revHead+1000).toISOString()}),0);
  assert.equal(revision().n,beforeRepeat);
  pass('WB-03 old patch, repeat, failed batch, tail refresh and the 21st bar share one history revision');
  pass('WB-04 identical canonical receipt does not bump historyRevision and a failed raw batch keeps the prior close');
  const mutableOld=[...canonicalOld];mutableOld[0]=revHead-31*revStep;mutableOld[6]=mutableOld[0]+revStep-1;
  const mutableOptions={receivedAt:new Date(revHead+3000).toISOString(),closed:false};
  await persistLiveKlineBar(revDb,'5m',mutableOld,'fstream.binance.com','cloud-ws',mutableOptions);
  const acceptedRevision=revision().n;
  const rejectedOld=[...mutableOld];rejectedOld[4]='3';
  for (const at of [revHead+2000,revHead+2000,revHead+3000]) {
    await persistLiveKlineBar(revDb,'5m',rejectedOld,'delayed.fixture','cloud-ws',{receivedAt:new Date(at).toISOString(),closed:false});
    assert.equal(revision().n,acceptedRevision,'rejected stale/equal mutable receipt must not invalidate history');
    const stored=revDb.sqlite.prepare('SELECT value_json,source_host FROM finance_dataset_observations WHERE dataset_id=? AND observation_key=?').get('binance-perp-klines-5m',String(mutableOld[0]));
    assert.equal(JSON.parse(stored.value_json).close,6);assert.equal(stored.source_host,'fstream.binance.com');
  }
  const beforeRollbackScratch=revDb.sqlite.prepare('SELECT bump FROM _desk_hist_bump WHERE symbol=? AND interval=?').get('BTCUSDT','5m').bump;
  revDb.failSql='INSERT INTO finance_dataset_observations';
  await assert.rejects(persistLiveKlineBar(revDb,'5m',rejectedOld,'fstream.binance.com','cloud-ws',{receivedAt:new Date(revHead+4000).toISOString(),closed:false}),/injected write failure/);
  assert.equal(revision().n,acceptedRevision,'failure after revision increment must roll it back');
  assert.equal(revDb.sqlite.prepare('SELECT bump FROM _desk_hist_bump WHERE symbol=? AND interval=?').get('BTCUSDT','5m').bump,beforeRollbackScratch);
  assert.equal(JSON.parse(revDb.sqlite.prepare('SELECT value_json FROM finance_dataset_observations WHERE dataset_id=? AND observation_key=?').get('binance-perp-klines-5m',String(mutableOld[0])).value_json).close,6);
  assert.equal(revDb.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='_desk_hist_bump'").get().n,1);
  assert.equal(revDb.sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_temp_master WHERE type='table' AND name='_desk_hist_bump'").get().n,0);
  await persistLiveKlineBar(revDb,'5m',rejectedOld,'fstream.binance.com','cloud-ws',{receivedAt:new Date(revHead+4000).toISOString(),closed:false});
  assert.equal(revision().n,acceptedRevision+1,'a newer accepted old-bar correction still invalidates history');
  pass('WB-05 stale/equal mutable batches and mid-batch failure preserve data/revision/persistent scratch; retry bumps once');
  const preparedWindow=prepareBoundedObservations(db,id,{limit:2,fromMs:full[10].fundingTime,toMs:full[15].fundingTime,
    knownAt:new Date(firstRevision).toISOString(),historical:true});
  const atomicResults=await db.batch([preparedWindow.statement,db.prepare('SELECT COUNT(*) AS n FROM desk_history_state')]);
  const boundedWindow=preparedWindow.parse(atomicResults[0]);
  assert.deepEqual(boundedWindow.observations.map(row=>row.key),[String(full[14].fundingTime),String(full[13].fundingTime)]);
  assert.equal(boundedWindow.predecessor.key,String(full[9].fundingTime));assert.equal(boundedWindow.truncated,true);
  assert.equal(atomicResults[0].results.length,4,'only cap+1 in-range winners and one predecessor are returned');
  const preparedTail=prepareBoundedObservations(db,id,{limit:2,knownAt:new Date(firstRevision).toISOString(),historical:true});
  const boundedTail=preparedTail.parse(await preparedTail.statement.all());
  assert.equal(boundedTail.predecessor.key,String(full.at(-3).fundingTime));assert.equal(boundedTail.truncated,true);
  for (const cutoff of [firstRevision-1,firstRevision]) {
    const atRevision=prepareBoundedObservations(db,id,{limit:1,fromMs:full[10].fundingTime,toMs:full[11].fundingTime,
      knownAt:new Date(cutoff).toISOString(),historical:true,predecessor:false});
    const selected=atRevision.parse(await atRevision.statement.all());
    assert.equal(selected.observations[0].values.fundingRate,cutoff<firstRevision?0.0001:0.0002);
    assert.equal(selected.predecessor,null);assert.equal(selected.truncated,false);
  }
  const emptyPrepared=prepareBoundedObservations(db,id,{limit:2,fromMs:base+1,toMs:base+2,
    knownAt:new Date(firstRevision).toISOString(),historical:true});
  const emptyWindow=emptyPrepared.parse(await emptyPrepared.statement.all());
  assert.equal(emptyWindow.observations.length,0);assert.equal(emptyWindow.predecessor.key,String(full.at(-1).fundingTime));
  pass('WB-06 single-statement bounded snapshot keeps cap+1, explicit/tail/empty-window predecessor and knownAt winners inside the caller batch');
  const boundedPlan=db.sqlite.prepare('EXPLAIN QUERY PLAN '+preparedTail.statement.sql).all(...preparedTail.statement.values).map(row=>row.detail);
  assert(!boundedPlan.some(detail=>detail.includes('idx_finance_dataset_receipt')),'bounded reads must not sort the whole receipt range to find each observation key');
  assert(boundedPlan.some(detail=>/SEARCH o .*\(dataset_id=\? AND observation_key=\?/.test(detail)),
    'winner selection must probe the primary key for each selected key, not scan the dataset first');
  pass('WB-07 bounded assembly avoids the receipt-index sort and drives winners from selected keys; real rows_read is checked by desk-migration --workerd');
  const untimedDb=database();
  for (const [untimedId,data] of [
    ['btc-fees',{fastestFee:4,halfHourFee:3,hourFee:2,minimumFee:1}],
    ['stablecoin-supply',{peggedAssets:[{id:'1',symbol:'USDT',circulating:{peggedUSD:10},price:1},{id:'2',symbol:'USDC',circulating:{peggedUSD:9},price:1}]}],
  ]) {
    await persistDataset(untimedDb,untimedId,envelope(untimedId,data,base));
    await persistDataset(untimedDb,untimedId,envelope(untimedId,data,base+1000));
    for (const cutoff of [base,base+1000]) {
      const options={knownAt:new Date(cutoff).toISOString()};
      const summary=await readDatasetSummary(untimedDb,untimedId,options);
      assert.equal(summary.observations.length,1);
      assert.equal(summary.observations[0].observedAt,null);
      assert.deepEqual(summary.observations,(await readDataset(untimedDb,untimedId,{...options,limit:1})).observations);
    }
    const ranged=prepareBoundedObservations(untimedDb,untimedId,{fromMs:base,toMs:base+2000,knownAt:new Date(base+2000).toISOString()});
    assert.equal(ranged.parse(await ranged.statement.all()).observations.length,0);
  }
  untimedDb.sqlite.close();
  pass('WB-08 observed-index seeks retain unknown-source-time fee/stablecoin summaries and historical receipt bounds');
  const disabled=await syncFinanceDatasetsIfDue({},now);assert.equal(disabled.reason,'storage_disabled');
  assert.equal(Object.keys(D).length,33);
  console.log(JSON.stringify({measurement:'real SQLite logical changed rows; excludes D1 index amplification',logicalWrites,fundingTailFirstSlotRows:tailSqlChanges,
    expectedSteadyTailRows:6,formula:'2 observations + 1 dataset state + 1 raw chunk insert + 1 raw state + 1 previous chunk delete',
    priorFullRows:504,normalHistoryRows:6,fullAuditRows:504,receiptReplayRows:0,retention:'separate scheduled batches; <=1000 rows/dataset pass, options whole snapshot'}));
  for(const item of [db,cacheDb,scheduleDb,hourDb,live,premiumDb,currentDb,optionDb]) item.sqlite.close();
  globalThis.Date=RealDate;
  console.log(`Finance incremental: ${passed} PASS, 0 FAIL`);
})().catch(error=>{console.error(error);process.exitCode=1;});
