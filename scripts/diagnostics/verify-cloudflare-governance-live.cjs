// Read-only deployed API and rendered UI acceptance; no synthetic data on live checks.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium,expect}=require('playwright/test');
const api='https://btc.feiniwork.com';
const site='https://bitcoin.feiniwork.com';
const out=path.resolve(__dirname,'../../.artifacts/plans');
const apiOnly=process.argv.includes('--api-only');
let browser;
async function main(){
 const samples=[];
 async function get(p){const r=await fetch(api+p,{signal:AbortSignal.timeout(15000)});assert.equal(r.status,200,p);return r.json();}
 for(const interval of ['5m','15m','1h','4h','1d','3d','1w']){
  const d=await get('/api/desk/chart?interval='+interval+'&tail=20');
  assert.equal(d.pricePathAvailable,true,interval+' authority');assert(d.series.length>1,interval+' history');
  assert.equal(d.venue,'binance-usdm');
  samples.push({interval,rows:d.series.length,receivedAt:d.receivedAt,lastT:d.series.at(-1).t,price:d.series.at(-1).c,ageMs:Date.now()-Date.parse(d.storedAt)});
 }
 const [live,legacy,liq,context,footprint]=await Promise.all(['/api/d1/klines/live','/api/d1/collectors/legacy-kline/status','/api/d1/liquidations/status','/api/desk/context','/api/desk/orderflow'].map(get));
 assert.equal(live.collector.effectiveMinFlushMs,5000);
 assert.equal(legacy.collector.retired,true);assert.equal(legacy.collector.startedAt,0);
 assert.equal(footprint.quality.status,'pass');assert(footprint.series.length>0);
 assert.equal(context.contract.unavailable,false,'trusted contract observations remain visible independently of collection freshness');
 assert(context.contract.premium?.values?.markPrice>0,'context contains a trusted premium observation');
 for(const exchange of ['binance','bybit']) assert.equal(liq.collector.sources[exchange].status,'realtime',exchange+' source');
 const evidence={at:new Date().toISOString(),samples,liveCollector:live.collector,legacyCollector:legacy.collector,liquidationSources:liq.collector.sources,footprint:{rows:footprint.series.length,receivedAt:footprint.receivedAt,quality:footprint.quality},ui:[]};
 function save(){const file=path.join(out,'cloudflare-live-acceptance-'+Date.now()+'.json');fs.writeFileSync(file,JSON.stringify(evidence,null,2));console.log('Evidence: '+file);}
 if(apiOnly){evidence.ui=[{status:'NOT_RUN',reason:'--api-only; authenticated production UI is checked separately'}];save();console.log('PASS deployed API acceptance (UI excluded explicitly)');return;}
 const html=await (await fetch(site+'/',{signal:AbortSignal.timeout(15000)})).text();
 for(const asset of ['js/chart/mtf-tiles.js','js/pages/heatmap.js','js/pages/derivatives.js'])assert(html.includes(asset+'?v=20260926-cost1'),asset+' deployed cache version');
 console.log('PASS live APIs: seven periods, authoritative nonempty tape, footprint, context, both liquidation sources, retired namespace and Pages versions');
 browser=await chromium.launch({headless:true,...(process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY}}:{})});
 const ui=[];
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
  page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const [route,selector,expected] of [['chart','#chart-status',/D1|币安|Binance|根/],['heatmap','#hm-status',/desk 分所/],['derivatives','#deriv-status',/desk context/]]){
   await page.goto(site+'/#/'+route,{waitUntil:'domcontentloaded',timeout:25000});
   await expect(page.locator(selector)).toContainText(expected);
   assert((await page.locator('#outlet').innerText()).length>100);
   if(route==='chart')assert(await page.evaluate(()=>chartOhlcv.length)>0,'live chart rendered rows');
   ui.push({width,route,status:'PASS'});console.log('PASS production UI '+width+' '+route);
  }
  assert.deepEqual(errors,[],'relevant runtime errors');await page.close();
 }
 evidence.ui=ui;save();
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();});
