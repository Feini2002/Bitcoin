const assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
let passed=0;
function pass(name){passed++;console.log('PASS FIN-'+String(passed).padStart(2,'0')+' '+name);}
(async()=>{
  const {FINANCE_PROVIDERS:P}=await import(pathToFileURL(path.resolve(__dirname,'../cloudflare/finance/registry.mjs')));
  const {financeCatalog,buildFinanceRequest,handleFinance}=await import(pathToFileURL(path.resolve(__dirname,'../cloudflare/finance/gateway.mjs')));
  const fixtureEnv={FINANCE_SEC_USER_AGENT:'BitDesk test contact@example.com'};
  for(const p of Object.values(P))if(p.secret)fixtureEnv[p.secret]='fixture-secret-do-not-use';
  let count=0;
  for(const [id,p] of Object.entries(P))for(const [name,o] of Object.entries(p.operations)){
    const built=buildFinanceRequest(id,name,new URLSearchParams(),fixtureEnv);
    assert.equal(built.url.protocol,'https:');
    assert.equal(built.url.origin,o.base||p.base);
    assert.equal(built.init.redirect,'manual');
    assert.ok(!/[{}]/.test(built.url.pathname));
    assert.ok(['GET','POST'].includes(built.init.method));
    if(built.init.method==='POST'){assert.equal(id,'hyperliquid');assert.equal(built.url.pathname,'/info');}
    count++;
  }
  pass(`all ${Object.keys(P).length} providers / ${count} operations build bounded public-data requests`);
  const proxied=buildFinanceRequest('binance-usdm','klines',new URLSearchParams(),{...fixtureEnv,BINANCE_FAPI_ORIGIN:'https://proxy.example.com'});
  assert.equal(proxied.url.origin,'https://proxy.example.com');
  pass('usdm channels can use BINANCE_FAPI_ORIGIN without changing the recorded venue host later');
  const catalog=financeCatalog(fixtureEnv);
  assert.ok(!JSON.stringify(catalog).includes('fixture-secret-do-not-use'));
  assert.ok(catalog.providers.every(p=>p.configuration.endsWith('not-probed')));
  assert.equal(catalog.automaticCollection,true);pass('catalog exposes capabilities, never secrets or fabricated health');
  const request=(path,method='GET')=>new Request('https://fixture.test/api/finance/'+path,{method});
  const noFetch=()=>{throw Error('unexpected upstream call');};
  for(const suffix of ['binance-spot/ticker?url=https://evil.test','binance-spot/klines?limit=501','binance-spot/ticker?symbol=BTCUSDT&symbol=ETHUSDT','coinbase/product?product=..','fred/observations?realtime_start=2026-02-30']){
    assert.equal((await handleFinance(request(suffix),fixtureEnv,{}, {fetch:noFetch,cache:null})).status,400);
  }
  pass('invalid, duplicate, oversized and unregistered parameters cause zero upstream calls');
  assert.equal((await handleFinance(request('binance-spot/order'),{}, {},{fetch:noFetch,cache:null})).status,404);
  assert.equal((await handleFinance(request('binance-spot/ticker','POST'),{}, {},{fetch:noFetch,cache:null})).status,405);
  pass('account/trading/POST proxy actions are not exposed');
  for(const [id,p] of Object.entries(P))if(p.secret||p.setting){
    const r=await handleFinance(request(id+'/'+Object.keys(p.operations)[0]),{}, {},{fetch:noFetch,cache:null});
    assert.equal(r.status,503);
  }
  pass('missing free keys/contact configuration fail before making requests');
  const seen=[];
  let response=await handleFinance(request('fred/observations'),fixtureEnv,{}, {cache:null,fetch:async(url,init)=>{seen.push({url,init});return Response.json({observations:[{date:'2026-09-01',value:'4.0'}]});}});
  const data=await response.json();
  assert.equal(new URL(seen[0].url).searchParams.get('api_key'),fixtureEnv.FREE_FRED_API_KEY);
  assert.equal(data.normalized,false);assert.ok(data.receivedAt);assert.equal(data.data.observations[0].value,'4.0');
  assert.ok(!JSON.stringify(data).includes(fixtureEnv.FREE_FRED_API_KEY));pass('key injected server-side; source times, strings and raw units retained');
  let calls=0;
  response=await handleFinance(request('binance-usdm/ticker'),{}, {},{cache:null,fetch:async()=>{calls++;return new Response('restricted',{status:451});}});
  assert.equal(response.status,502);assert.equal((await response.json()).error,'upstream_access_restricted');assert.equal(calls,1);pass('regional restriction reported with no cross-venue fallback or retry');
  response=await handleFinance(request('coinpaprika/ticker'),{}, {},{cache:null,fetch:async()=>new Response('limited',{status:429,headers:{'Retry-After':'60'}})});
  assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'60');pass('upstream quota exhaustion preserved');
  response=await handleFinance(request('coinpaprika/ticker'),{}, {},{cache:null,fetch:async()=>new Response('quota',{status:402})});
  assert.equal(response.status,429);assert.equal((await response.json()).upstreamStatus,402);
  for(const [id,payload] of [['bybit',{retCode:10006}],['okx',{code:'50011'}],['kraken',{error:['quota']}],['alphavantage',{Information:'premium needed'}],['coinmarketcap',{status:{error_code:1008}}],['bls',{status:'REQUEST_FAILED'}]]){
    const name=Object.keys(P[id].operations)[0];
    const r=await handleFinance(request(id+'/'+name),fixtureEnv,{}, {cache:null,fetch:async()=>Response.json(payload)});
    assert.equal(r.status,502);
  }
  pass('HTTP 200 provider error payloads are not reported as successful data');
  for(const body of ['<html>login</html>',''])assert.equal((await handleFinance(request('coinpaprika/ticker'),{}, {},{cache:null,fetch:async()=>new Response(body)})).status,502);
  pass('HTML challenges, login pages and empty JSON rejected');
  response=await handleFinance(request('fred/observations'),fixtureEnv,{}, {cache:null,fetch:async()=>Response.json({echo:fixtureEnv.FREE_FRED_API_KEY})});
  assert.equal((await response.json()).error,'upstream_sensitive_echo');pass('even unexpected upstream credential echo is not returned');
  response=await handleFinance(request('alphavantage/daily'),fixtureEnv,{}, {cache:null,fetch:async()=>Response.json({Information:`API key ${fixtureEnv.FREE_ALPHAVANTAGE_API_KEY}: rate limit is 25 requests per day.`})});
  assert.equal(response.status,429);
  const quotaBody=await response.text();
  assert.equal(JSON.parse(quotaBody).error,'upstream_rate_limited');
  assert.ok(!quotaBody.includes(fixtureEnv.FREE_ALPHAVANTAGE_API_KEY));
  response=await handleFinance(request('alphavantage/daily'),fixtureEnv,{}, {cache:null,fetch:async()=>Response.json({'Time Series (Daily)':{'2026-09-15':{'4. close':'123'}},echo:fixtureEnv.FREE_ALPHAVANTAGE_API_KEY})});
  assert.equal((await response.json()).error,'upstream_sensitive_echo');
  pass('Alpha Vantage quota notices remain diagnosable without disclosing echoed credentials');
  response=await handleFinance(request('hyperliquid/book'),{}, {},{cache:null,fetch:async(url,init)=>{assert.deepEqual(JSON.parse(init.body),{type:'l2Book',coin:'BTC'});return Response.json({coin:'BTC',levels:[[],[]]});}});
  assert.equal(response.status,200);pass('Hyperliquid POST is fixed to read-only info type');
  response=await handleFinance(request('fed/policy'),{}, {},{cache:null,fetch:async()=>new Response('<rss><channel><title>Policy</title></channel></rss>')});
  assert.equal((await response.json()).format,'text');pass('RSS returned as labeled native text, not invented JSON observations');
  response=await handleFinance(request('coinpaprika/ticker'),{}, {},{cache:null,fetch:async()=>new Response('x',{headers:{'content-length':String(5*1024*1024)}})});
  assert.equal((await response.json()).error,'upstream_response_too_large');pass('oversized response stops before buffering');
  response=await handleFinance(request('coinpaprika/ticker'),{}, {},{cache:null,timeoutMs:10,fetch:async(_u,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('abort'))))});
  assert.equal(response.status,504);pass('timeout cancels upstream request');
  let stored;const promises=[];calls=0;
  const cache={match:async()=>stored?.clone(),put:async(_key,value)=>{stored=value;}};
  const deps={cache,fetch:async()=>{calls++;return Response.json({id:'btc-bitcoin',price:'123'});}};
  const first=await (await handleFinance(request('coinpaprika/ticker'),{}, {waitUntil:p=>promises.push(p)},deps)).json();
  await Promise.all(promises);
  const second=await (await handleFinance(request('coinpaprika/ticker'),{}, {},deps)).json();
  assert.equal(calls,1);assert.equal(second.cache.hit,true);assert.equal(second.receivedAt,first.receivedAt);pass('cached response retains original receipt time, saves an upstream call');
  const worker=(await import(pathToFileURL(path.resolve(__dirname,'../cloudflare/binance-klines-worker.js')))).default;
  const routed=await worker.fetch(request('catalog'),{},{});
  assert.equal((await routed.json()).providers.length,Object.keys(P).length);
  assert.equal(routed.headers.get('Access-Control-Allow-Origin'),'https://bitcoin.feiniwork.com');
  const denied=await worker.fetch(request('catalog'),{ACCESS_JWT_REQUIRED:'true',ACCESS_TEAM_DOMAIN:'example.cloudflareaccess.com',ACCESS_AUD:'fixture'},{});
  assert.equal(denied.status,401);pass('real Worker route uses existing Access/CORS and does not need D1');
  console.log(`Finance channels: ${passed} PASS, 0 FAIL; ${count} operation contracts`);
})().catch(e=>{console.error('FAIL finance channels',e);process.exitCode=1;});
