const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({ console, URL, URLSearchParams, Map, Set, Date, Math, AbortController,
  DOMException, TypeError, SyntaxError, setTimeout, clearTimeout });
vm.runInContext(fs.readFileSync(path.join(root, 'js/data-engine.js'), 'utf8') + '\nglobalThis.engine=DataEngine;', context);
const engine = context.engine;
const payload = { schemaVersion:'test', pricePathAvailable:true, coverageScope:'window',
  historyRevision:1, instrumentId:'BINANCE:USDM:BTCUSDT:PERPETUAL', series:[{t:0,c:1},{t:300000,c:2}] };
const reply = data => new Response(JSON.stringify(data), { headers:{'Content-Type':'application/json'} });
const turn = () => new Promise(setImmediate);

(async () => {
  let calls=0, release, transport;
  engine.workerFetch = (_url, opts) => { calls++; transport=opts.signal; return new Promise(resolve=>{release=resolve;}); };
  const a=new AbortController(), b=new AbortController();
  const first=engine.fetchDesk('chart',{interval:'5m',signal:a.signal}).catch(e=>e);
  const second=engine.fetchDesk('chart',{interval:'5m',signal:b.signal});
  await turn(); assert.equal(calls,1);
  a.abort(); assert.equal((await first).name,'AbortError'); assert.equal(transport.aborted,false);
  release(reply(payload)); assert.equal((await second).series.length,2);
  assert(engine.peekChartWindow('BTCUSDT','5m'));
  engine.workerFetch=async()=>{calls++;return reply(payload);};
  assert.equal((await engine.fetchDesk('chart',{interval:'5m'})).series.length,2); assert.equal(calls,2);
  console.log('PASS exact-request sharing, independent cancellation, explicit fresh reads, complete-window cache');

  engine.workerFetch=(_url,{signal})=>new Promise((_resolve,reject)=>{transport=signal;signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')));});
  const c=new AbortController();const orphan=engine.fetchDesk('context',{signal:c.signal}).catch(e=>e);
  await turn(); c.abort(); assert.equal((await orphan).name,'AbortError');assert(transport.aborted);
  await turn();assert.equal(engine._deskReads.size,0);
  console.log('PASS leaving the last reader aborts transport and releases registry');

  const starts=[], releases=new Map();
  engine.workerFetch=(url,{signal})=>new Promise((resolve,reject)=>{
    const key=new URL(url).searchParams.get('interval')||'context';starts.push(key);releases.set(key,resolve);
    signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true});
  });
  const queuedAbort=new AbortController();
  const bg1=engine.fetchDesk('chart',{interval:'1d',priority:'background'});
  const abandoned=engine.fetchDesk('chart',{interval:'3d',priority:'background',signal:queuedAbort.signal}).catch(e=>e);
  const bg2=engine.fetchDesk('chart',{interval:'1w',priority:'background'});
  const foreground=engine.fetchDesk('context');
  await turn();assert.deepEqual(starts,['1d','context'],'background reserves room for the active page');
  queuedAbort.abort();assert.equal((await abandoned).name,'AbortError');
  const promoted=engine.fetchDesk('chart',{interval:'1w'});
  releases.get('context')(reply(payload));await foreground;await turn();
  assert.deepEqual(starts,['1d','context','1w'],'a main chart joining a queued tile promotes the shared request');
  releases.get('1w')(reply(payload));await Promise.all([bg2,promoted]);
  releases.get('1d')(reply(payload));await bg1;await turn();
  assert.equal(engine._deskActive,0);assert.equal(engine._deskBackgroundActive,0);assert.equal(engine._deskQueue.length,0);
  console.log('PASS foreground reserved capacity, background serialization, queued cancellation and request promotion');

  calls=0;engine.workerFetch=(_url,{signal})=>{calls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}));};
  const blockerCtrl=new AbortController();
  const blocker=engine.fetchDesk('chart',{interval:'1d',priority:'background',signal:blockerCtrl.signal}).catch(e=>e);
  await turn();context.setTimeout=(fn,ms)=>setTimeout(fn,ms===12000?5:ms);
  await assert.rejects(()=>engine.fetchDesk('chart',{interval:'1w',priority:'background'}),/读取繁忙/);
  context.setTimeout=setTimeout;blockerCtrl.abort();await blocker;await turn();
  assert.equal(calls,1);assert.equal(engine._deskQueue.length,0);assert.equal(engine._deskReads.size,0);
  console.log('PASS queue deadline removes expired work without sending a late server request');

  calls=0;engine.workerFetch=async()=>{calls++;return calls===1?new Response('{}',{status:503}):reply(payload);};
  await engine.fetchDesk('heatmap');assert.equal(calls,2);
  calls=0;engine.workerFetch=async()=>{calls++;return new Response('{}',{status:403});};
  await assert.rejects(()=>engine.fetchDesk('orderflow'),/403/);assert.equal(calls,1);
  console.log('PASS transient 503 retries once; denied access is not retried');
  context.setTimeout=(fn,ms)=>setTimeout(fn,ms===12000?5:ms===400?1:ms);
  calls=0;engine.workerFetch=(_url,{signal})=>{calls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError')),{once:true}));};
  await assert.rejects(()=>engine.fetchDesk('context'),/读取超时/);assert.equal(calls,2);assert.equal(engine._deskReads.size,0);
  context.setTimeout=setTimeout;
  console.log('PASS stalled responses abort at the deadline, retry once, then release all readers');

  context.DataEngine=engine;context.CHART_D1_POLL_LIMIT=20;
  context.deskRevision=d=>d.historyRevision;
  context.responseStale=()=>false;
  const source=fs.readFileSync(path.join(root,'js/pages/chart.js'),'utf8');
  vm.runInContext(source.match(/async function readChartSwitchWindow\([^]*?\n}/)[0],context);
  let mode='same', reads=[];
  context.readChartD1Klines=async(_s,_i,_n,opts)=>{
    reads.push(opts);
    if(!opts.tail)return {desk:payload,rows:payload.series};
    const rows=mode==='gap'?[{t:900000,c:3}]:payload.series;
    return {desk:{...payload,coverageScope:'tail',historyRevision:mode==='revision'?2:1},rows};
  };
  const reused=await context.readChartSwitchWindow('BTCUSDT','5m',false);
  assert(reused.freshTail);assert.equal(reads.length,1);
  for(const next of ['revision','gap']){mode=next;reads=[];const full=await context.readChartSwitchWindow('BTCUSDT','5m',false);assert(!full.freshTail);assert.equal(reads.length,2);}
  reads=[];await context.readChartSwitchWindow('BTCUSDT','5m',true);assert.equal(reads.length,1);assert(!reads[0].tail);
  console.log('PASS switch validates fresh tail; revision change, gap and explicit sync force full history');

  let clock=1000,pollCalls=0,pollFails=true,denied=false;
  const pollContext=vm.createContext({console:{warn(){}},Date:{now:()=>clock},AbortController,
    lwChart:{},candleSeries:{},document:{hidden:false},CHART_SYMBOL:'BTCUSDT',currentInterval:'4h',
    chartD1PollInFlight:false,chartPollNextAttemptAt:0,chartPollFailures:0,chartLoadGen:1,chartD1PollGen:1,
    CHART_D1_POLL_LIMIT:20,lastRenderedCount:6000,chartPageStillCurrent:()=>true,
    readChartD1Klines:async()=>{pollCalls++;if(pollFails){const e=Error('fixture');if(denied)e.status=403;throw e;}return {};},
    acceptChartTail(){},refreshMtfAfterMainLoad(){},renderChartEvidence(){},setChartStatusLine(){},publishChartEvidence(){}});
  vm.runInContext(source.match(/function queueD1Poll\([^]*?\n}/)[0],pollContext);
  pollContext.queueD1Poll();await turn();assert.equal(pollContext.chartPollNextAttemptAt,3000);
  clock=2000;pollContext.queueD1Poll();await turn();assert.equal(pollCalls,1);
  clock=3000;pollContext.queueD1Poll();await turn();assert.equal(pollContext.chartPollNextAttemptAt,7000);
  clock=7000;pollFails=false;pollContext.queueD1Poll();await turn();assert.equal(pollContext.chartPollFailures,0);
  assert.equal(pollContext.chartPollNextAttemptAt,0);
  denied=true;pollFails=true;pollContext.queueD1Poll();await turn();assert.equal(pollContext.chartPollNextAttemptAt,Infinity);
  const stoppedCalls=pollCalls;clock=100000;pollContext.queueD1Poll();await turn();assert.equal(pollCalls,stoppedCalls);
  console.log('PASS failed polling backs off, success restores normal cadence, access errors stop automatic requests');

  let historyRelease,current=true;
  const newReadState={inFlight:true,again:true,failures:0,nextAttemptAt:0,converged:false};
  const historyContext=vm.createContext({chartHistoryReread:{...newReadState,inFlight:false},
    chartOhlcv:[{t:0},{t:300000}],chartPageStillCurrent:()=>current,getIntervalStepMs:()=>300000,
    readChartD1Klines:()=>new Promise(resolve=>{historyRelease=resolve;})});
  vm.runInContext(source.match(/async function runChartHistoryReread\([^]*?\n}/)[0],historyContext);
  const oldRead=historyContext.runChartHistoryReread('BTCUSDT','5m',1);
  current=false;historyContext.chartHistoryReread=newReadState;historyRelease({});await oldRead;
  assert.equal(newReadState.inFlight,true);assert.equal(newReadState.again,true);
  console.log('PASS late completion from the old period cannot release a new history read');

  // Many receipts of one candle used to make NOT EXISTS winner selection quadratic.
  const {DatabaseSync}=require('node:sqlite');
  const {prepareBoundedObservations}=await import(require('node:url').pathToFileURL(path.join(root,'cloudflare/finance/dataset-store.mjs')));
  const db=new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(root,'cloudflare/finance/dataset-schema.sql'),'utf8'));
  const insert=db.prepare('INSERT INTO finance_dataset_observations VALUES (?,?,?,?,?,?,?,?,?,?)');
  const base=Date.UTC(2026,8,20), id='binance-perp-klines-4h';
  for(let key=0;key<40;key++) for(let version=0;version<100;version++) {
    const open=base+key*14400000, observed=new Date(open).toISOString(), received=new Date(open+version*1000+1).toISOString();
    insert.run(id,String(open),observed,'millisecond',received,received,'fapi.binance.com','cloud-readthrough',null,JSON.stringify({closed:version===50,close:version}));
  }
  let visits=0;
  db.function('measured_json_extract',(json,key)=>{visits++;return JSON.parse(json)[key.slice(2)]===true?1:0;});
  const prepared=prepareBoundedObservations({prepare(sql){return{bind(...values){return{sql,values};}};}},id,{limit:20});
  const winners=db.prepare(prepared.statement.sql.replaceAll('json_extract(', 'measured_json_extract(')).all(...prepared.statement.values);
  assert.equal(winners.length,22);assert(winners.every(row=>JSON.parse(row.value_json).close===50),'closed receipt wins over a later provisional update');
  assert(visits<5000,`winner comparison must be linear in candidate receipts; saw ${visits}`);
  db.close();
  console.log(`PASS 4,000 receipts: closed-winner correctness, only ${visits} version comparisons for tail + predecessor`);

  // Exercise the real Worker boundary: failed D1 must retain CORS and an HTTP status.
  const worker=(await import(require('node:url').pathToFileURL(path.join(root,'cloudflare/binance-klines-worker.js')))).default;
  const response=await worker.fetch(new Request('https://example/api/desk/chart',{headers:{Origin:'http://127.0.0.1:5173'}}),{
    ACCESS_ALLOWED_ORIGINS:'http://127.0.0.1:5173', DB:{prepare(){throw Error('fixture db failure');}},
  },{});
  assert.equal(response.status,503);assert.equal(response.headers.get('Access-Control-Allow-Origin'),'http://127.0.0.1:5173');
  assert.equal((await response.json()).retryable,true);
  console.log('PASS Worker assembly exceptions return retryable 503 with permitted-origin CORS');
})().catch(e=>{console.error(e);process.exitCode=1;});
