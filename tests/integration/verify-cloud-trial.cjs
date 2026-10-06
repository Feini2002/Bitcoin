const assert=require('node:assert/strict'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../..');
(async()=>{
  const {cloudTrialExpired}=await import(pathToFileURL(path.join(root,'cloudflare/cloud-trial.mjs')));
  const {default:worker,LiquidationCollector}=await import(pathToFileURL(path.join(root,'cloudflare/binance-klines-worker.js')));
  const {persistKlineCommit}=await import(pathToFileURL(path.join(root,'cloudflare/finance/kline-commit.mjs')));
  const realNow=Date.now,realFetch=global.fetch;
  let now=Date.parse('2026-10-06T00:00:00Z'),network=0,writes=0,closes=0;
  Date.now=()=>now;global.fetch=()=>{network++;throw Error('network forbidden');};
  const env={BTC_TRIAL_END_AT:'2026-10-06T00:00:10Z',DB:{prepare(){writes++;throw Error('D1 forbidden');}}};
  const local=new DatabaseSync(':memory:');let alarm=now+1000;
  const state={waitUntil(){throw Error('expired trial must not launch work');},storage:{
    sql:{exec(q,...args){const rows=local.prepare(q).all(...args);return {toArray:()=>rows};}},
    transactionSync(fn){return fn();},getAlarm:async()=>alarm,setAlarm:async t=>{alarm=t;},deleteAlarm:async()=>{alarm=null;},
  }};
  try {
    assert.equal(cloudTrialExpired(env),false);assert.equal(cloudTrialExpired({}),false);
    const collector=new LiquidationCollector(state,env);
    for(const key of ['binanceWs','binanceProbeWs','bybitWs']) collector[key]={close(){closes++;}};
    collector.kline.ws={close(){closes++;}};
    now+=10000;
    assert.equal((await worker.fetch(new Request('https://test/api/d1/klines'),env,{})).status,503);
    await worker.scheduled({},env,{waitUntil(){throw Error('Cron task started after deadline');}});
    await collector.alarm();assert.equal(alarm,null);assert.equal(closes,4);
    assert.equal(collector.kline.stopped,true);
    collector.scheduleReconnect('binance');await collector.connectBinance();await collector.connectBybit();
    collector.kline.tick();await collector.kline.connect();
    assert.equal((await collector.fetch(new Request('https://test/wake'))).status,503);
    await assert.rejects(persistKlineCommit(env,'BTCUSDT','5m',[],'fapi.binance.com'),/cloud_trial_expired/);
    const restarted=new LiquidationCollector(state,env);await restarted.ensureStarted();
    assert.equal(restarted.trialStopped,true);assert.equal(alarm,null);
    assert.equal(cloudTrialExpired({BTC_TRIAL_END_AT:'invalid'}),true);
    assert.equal(network,0);assert.equal(writes,0);
    console.log('PASS absolute expiry stops Worker API/Cron, closes all four sockets, deletes alarm and blocks retries/writes after restart; no network/D1 calls');
  } finally {Date.now=realNow;global.fetch=realFetch;local.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
