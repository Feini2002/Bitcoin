const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { chromium, expect } = require('playwright/test');
const root = path.resolve(__dirname, '..');
let browser, server;
async function main() {
  const {buildHeatmapDesk, buildContextDesk} = await import(pathToFileURL(path.join(root, 'cloudflare/finance/desk.mjs')));
  const now = Date.now();
  const fixtures = {
    heatmap: buildHeatmapDesk(['binance','bybit'].map(exchange => ({exchange, symbol:'BTCUSDT', bucket_start:now-300000, long_notional:15000, short_notional:5000, long_count:1, short_count:1, max_notional:15000, min_price:84000, max_price:84100})), now),
    context: buildContextDesk({}, now),
    retainedContext: buildContextDesk({'binance-perp-premium':{ok:true,collectionStale:true,sourceStale:true,
      state:{last_success_received_at:new Date(now-12000).toISOString()},
      observations:[{observedAt:new Date(now-12000).toISOString(),receivedAt:new Date(now-12000).toISOString(),
        sourceHost:'fstream.binance.com',ingestionMode:'cloud-ws',values:{markPrice:84000,nextFundingTime:new Date(now+3600000).toISOString()}}]}},now),
  };
  server = http.createServer((req,res) => {
    const pathname = new URL(req.url,'http://local').pathname;
    const file = path.resolve(root, '.'+(pathname==='/'?'/index.html':decodeURIComponent(pathname)));
    if (!file.startsWith(root+path.sep) || !/\.(?:html|css|js|svg|png|ico)$/.test(file)) {res.writeHead(404).end();return;}
    fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'image/svg+xml');res.end(data);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true});
  console.log(JSON.stringify({pid:process.pid,origin,browser:browser.version(),deadline:'run-bounded supervisor'}));
  for (const width of [1440,390]) {
    const page=await browser.newPage({viewport:{width,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.fulfill({contentType:route.request().resourceType()==='script'?'text/javascript':'application/json',body:route.request().resourceType()==='script'?'':'{}'}));
    await page.clock.install({time:now});
    await page.goto(origin+'/#/overview');
    await page.evaluate(fixtures=>{
      window.__testHidden=false;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__testHidden});
      window.__calls={}; window.__hold=false; window.__release=null;
      DataEngine.fetchDesk=async(scope)=>{window.__calls[scope]=(window.__calls[scope]||0)+1;if(window.__hold)await new Promise(resolve=>window.__release=resolve);return fixtures[scope];};
    },fixtures);
    for(const [route,scope,status] of [['heatmap','heatmap','#hm-status'],['derivatives','context','#deriv-status']]) {
      await page.evaluate(route=>location.hash='#/'+route,route);
      await expect(page.locator(status)).toContainText(route==='heatmap'?'desk 分所':'仅宏观背景');
      assert((await page.locator('#outlet').innerText()).length>100);
      const initial=await page.evaluate(scope=>window.__calls[scope],scope);
      await page.evaluate(()=>{window.__testHidden=true;document.dispatchEvent(new Event('visibilitychange'));});
      await page.clock.runFor(31000);
      assert.equal(await page.evaluate(scope=>window.__calls[scope],scope),initial,'hidden must not poll');
      await page.evaluate(()=>{window.__testHidden=false;document.dispatchEvent(new Event('visibilitychange'));});
      await expect.poll(()=>page.evaluate(scope=>window.__calls[scope],scope)).toBe(initial+1);
      await page.evaluate(()=>{window.__hold=true;document.dispatchEvent(new Event('visibilitychange'));});
      const held=await page.evaluate(scope=>window.__calls[scope],scope);
      await page.clock.runFor(31000);
      assert.equal(await page.evaluate(scope=>window.__calls[scope],scope),held,'slow request must not overlap');
      await page.evaluate(()=>{window.__hold=false;window.__release?.();});
      await expect(page.locator(status)).toContainText(route==='heatmap'?'desk 分所':'仅宏观背景');
      await page.evaluate(()=>location.hash='#/overview');
      await expect(page.getByRole('heading',{name:'功能清单',exact:true})).toBeVisible();
      const disposed=await page.evaluate(scope=>window.__calls[scope],scope);
      await page.clock.runFor(31000);
      await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
      assert.equal(await page.evaluate(scope=>window.__calls[scope],scope),disposed,'disposed page must not resume');
      console.log(`PASS ${width} ${route}: render, hidden pause, immediate resume, single request, disposal`);
    }
    await page.evaluate(context=>{DataEngine.fetchDesk=async()=>context;location.hash='#/derivatives';},fixtures.retainedContext);
    await expect(page.locator('#deriv-status')).toContainText('desk context 已返回');
    assert.equal(await page.evaluate(()=>derivativesPayload.contract.premium.values.markPrice),84000);
    assert.equal(await page.evaluate(()=>derivativesPayload.contract.premium.collectionStale),true);
    assert((await page.locator('#outlet').innerText()).length>100);
    console.log(`PASS ${width} derivatives: trusted stale observation remains available with explicit stale metadata`);
    assert.deepEqual(errors,[]);
    await page.close();
  }
  // Same production tile logic; deterministic market payloads and series recorder.
  const page=await browser.newPage();
  await page.goto(origin+'/#/overview');
  const result=await page.evaluate(async()=>{
    const calls=[];let phase=0;let rendered=[];
    const rows=(a,b)=>Array.from({length:b-a+1},(_,j)=>({t:(a+j)*300000,o:1,h:2,l:0,c:1}));
    DataEngine.fetchDesk=async(_scope,params)=>{calls.push(params);return {pricePathAvailable:true,series:phase===0?rows(1,100):phase===1?rows(82,101):params.tail?rows(200,219):rows(120,219)};};
    MtfTiles._open=true;MtfTiles._createTileAt=()=>{};MtfTiles.syncTimeFromMain=()=>{};MtfTiles._getSymbol=()=> 'BTCUSDT';MtfTiles._getMainInterval=()=> '15m';MtfTiles._tfs=['5m'];
    MtfTiles._tiles=[{series:{setData:data=>rendered=data},loadGen:0}];
    await MtfTiles._loadTile(0);const initial=rendered.length;
    phase=1;await MtfTiles._loadTile(0);const tail={length:rendered.length,first:rendered[0].time,last:rendered.at(-1).time};
    phase=2;await MtfTiles._loadTile(0);
    return {calls,initial,tail,gapRefill:rendered.length,gapStart:rendered[0].time};
  });
  assert.equal(result.initial,100);assert.equal(result.calls[1].tail,20);assert.equal(result.tail.length,101);assert.equal(result.tail.first,300);assert.equal(result.tail.last,30300);
  assert.equal(result.calls.length,4);assert.equal(result.calls[3].tail,undefined);  assert.equal(result.gapStart,36000);
  console.log('PASS MTF: first full load, tail merge preserves history, gap triggers full recovery');
  await page.close();
  await verifyChartWorkbench(browser, origin);
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));});

const chartCaseResults=[];

function chartStep(interval){
  return { '5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000,'3d':259200000,'1w':604800000 }[interval] || 900000;
}
function makeChartDesk(now, opts){
  const interval=opts.interval;
  const step=chartStep(interval);
  const bars=opts.bars;
  const end=now-step;
  const start=end-(bars-1)*step;
  const series=[];
  for(let i=0;i<bars;i++){
    const closeOf=opts.closeOf && Object.prototype.hasOwnProperty.call(opts.closeOf, i) ? opts.closeOf[i] : null;
    const close=i===bars-1 && opts.lastClose!=null ? opts.lastClose : (closeOf!=null ? closeOf : 1000+i);
    const t=start+i*step;
    series.push({
      t, o:close-1, h:close+1, l:close-2, c:close, v:1,
      closed:true, finality:'exchange_confirmed', origin:'canonical',
      sourceVerification:opts.verified ? 'verified' : 'unverified',
      effectiveReceivedAt:new Date(t+1000).toISOString(),
    });
  }
  const scope=opts.scope || 'window';
  const slice=scope==='tail' ? series.slice(-Math.min(20, series.length)) : series;
  if(opts.tailClose!=null && slice.length){
    const last=slice[slice.length-1];
    slice[slice.length-1]={...last, c:opts.tailClose, h:opts.tailClose+1, l:opts.tailClose-2, o:opts.tailClose-1};
  }
  const from=slice[0].t;
  const to=slice[slice.length-1].t+step;
  return {
    schemaVersion:'2026-09-27.1', instrumentId:opts.instrumentId || 'BINANCE:USDM:BTCUSDT:PERPETUAL', venue:'BINANCE',
    pricePathAvailable:opts.pricePath!==false, coverageScope:scope,
    requestWindow:scope==='window' ? {from, to} : null, returnedRange:{from, to},
    historyRevision:opts.revision, headT:slice[slice.length-1].t, stateScope:'current',
    researchWindow:{needed:480, continuousVerifiedClosed:opts.verified?slice.length:0, eligible:opts.eligible===true, reason:opts.eligible?'ok':'unverified'},
    coverage:{available:scope==='tail'?null:slice.length, returned:slice.length, verified:opts.verified?slice.length:0, inWindowGaps:opts.gaps||0, boundaryGap:false, unresolvedGap:false, truncated:false},
    inputRevision:`fixture-${opts.revision}-${interval}-${scope}-${slice.length}-${slice[slice.length-1].c}`,
    series:slice, gap:opts.gap||null, quality:{status:'pass'},
  };
}
async function releaseHeld(item, response){
  try { await item.route.fulfill(response); } catch (_) {}
  if (typeof item.resolve === 'function') item.resolve();
}
async function waitFor(fn){
  const start=Date.now();
  while(Date.now()-start<4000){
    if(fn()) return;
    await new Promise(resolve=>setTimeout(resolve, 40));
  }
  throw Error('timed out waiting for chart fixture');
}
async function verifyChartWorkbench(browser, origin){
  const NOW=Date.UTC(2026,8,15,12);
  const calls=[];
  const pending=[];
  let hold=false;
  const state={revision:1, verified:false, eligible:false};
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai'});
  context.setDefaultTimeout(8000);
  await context.addInitScript(()=>{
    localStorage.setItem('bitdesk.workbench.chartInterval','15m');
    localStorage.setItem('bitdesk.workbench.mtf', JSON.stringify({open:false, tfs:['1h','4h','1d','1w']}));
    window.__fixtureSockets=[];
    class FixtureSocket extends EventTarget {
      static CONNECTING=0; static OPEN=1; static CLOSING=2; static CLOSED=3;
      constructor(url){super(); this.url=url; this.readyState=1; window.__fixtureSockets.push(this);}
      close(){this.readyState=3;} send(){}
    }
    window.WebSocket=FixtureSocket;
    function createChart(){
      const logical={current:null}; const spacing={value:6}; const scroll={value:0};
      const timeScale={
        scrollPosition:()=>scroll.value,
        scrollToPosition(position){scroll.value=position;},
        options:()=>({barSpacing:spacing.value}),
        applyOptions(opts){if(opts && Number.isFinite(opts.barSpacing)) spacing.value=opts.barSpacing;},
        getVisibleLogicalRange:()=>logical.current ? {from:logical.current.from, to:logical.current.to} : null,
        setVisibleLogicalRange(range){logical.current={from:range.from, to:range.to};},
        getVisibleRange:()=>({from:0,to:1}), setVisibleRange(){},
        subscribeVisibleLogicalRangeChange(){}, unsubscribeVisibleLogicalRangeChange(){},
        subscribeVisibleTimeRangeChange(){}, unsubscribeVisibleTimeRangeChange(){},
      };
      const chart={
        applyOptions(){}, remove(){}, priceScale:()=>({applyOptions(){}}), timeScale:()=>timeScale,
        addCandlestickSeries:()=>({setData(){logical.current={from:0,to:10};}, update(){}, createPriceLine(){return {};}, applyOptions(){}}),
        addLineSeries:()=>({setData(){}, applyOptions(){}, createPriceLine(){return {};}}),
        addHistogramSeries:()=>({setData(){}, applyOptions(){}}),
      };
      if(!window.__chartMock) window.__chartMock=chart;
      return chart;
    }
    window.LightweightCharts={createChart, CrosshairMode:{Normal:0}, LineStyle:{Solid:0,Dotted:1,Dashed:2}, TickMarkType:{Year:0,Month:1,DayOfMonth:2,Time:3,TimeWithSeconds:4}};
  });
  await context.route('**/*', async route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin) return route.continue();
    if(url.href.includes('lightweight-charts') || url.href.includes('phosphor')) return route.fulfill({contentType:'text/javascript', body:''});
    if(url.pathname==='/api/desk/chart'){
      const record={interval:url.searchParams.get('interval'), tail:url.searchParams.get('tail'), from:url.searchParams.get('from'), to:url.searchParams.get('to'), symbol:url.searchParams.get('symbol'), knownAt:url.searchParams.get('knownAt')};
      calls.push(record);
      if(hold){await new Promise(resolve=>pending.push({record, route, resolve})); return;}
      const interval=record.interval||'15m';
      const revision=interval==='15m' ? state.revision : 1;
      const instrumentId=['4h','1d','1w','3d'].includes(interval) ? 'HIGHER-SHOULD-NOT-STICK' : 'BINANCE:USDM:BTCUSDT:PERPETUAL';
      const preset=interval==='1h' ? {bars:24, lastClose:4100} : interval==='15m' ? {bars:40, lastClose:1500} : {bars:8, lastClose:8800};
      const body=makeChartDesk(NOW, {interval, revision, scope:record.tail?'tail':'window', verified:state.verified, eligible:state.eligible, instrumentId, ...preset, tailClose:record.tail?state.tailClose:null, closeOf:record.from?state.closeOf:null});
      return route.fulfill({contentType:'application/json', body:JSON.stringify(body)});
    }
    return route.fulfill({contentType:'application/json', body:JSON.stringify({price:'64000', ok:true})});
  });
  const page=await context.newPage();
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.clock.install({time:NOW});
  await page.goto(origin+'/#/chart');
  await expect(page.locator('#chart-research-evidence')).toContainText('已加载 40 根');
  await expect(page.locator('#chart-research-evidence')).toContainText('BINANCE:USDM:BTCUSDT:PERPETUAL');
  await expect(page.locator('#chart-research-evidence')).toContainText('15m');
  await expect(page.locator('#chart-research-evidence')).toContainText('未核实 40 根');
  await expect(page.locator('#chart-research-evidence')).toContainText('研究窗口不合格');
  await expect(page.locator('#chart-research-evidence')).toContainText('价格路径可用');
  await expect(page.locator('#chart-keylevel-status')).toContainText('不输出已确认信号');
  await expect(page.locator('#chart-primary-title')).toContainText('BTCUSDT');
  if(calls[0].symbol!=='BTCUSDT' || calls[0].from || calls[0].to || calls[0].knownAt || calls[0].tail) throw Error('WB-03 initial full sent unexpected query '+JSON.stringify(calls[0]));
  const opened=await page.evaluate(()=>({len:chartOhlcv.length, first:chartOhlcv[0].c, last:chartOhlcv.at(-1).c}));
  if(opened.len!==40 || opened.first!==1000 || opened.last!==1500) throw Error('WB-03 initial window '+JSON.stringify(opened));
  hold=true;
  state.tailClose=2222;
  await page.clock.runFor(1000);
  await waitFor(()=>pending.some(item=>item.record.tail==='20' && !item.record.from));
  const tail=pending.splice(pending.findIndex(item=>item.record.tail==='20'),1)[0];
  await releaseHeld(tail, {contentType:'application/json', body:JSON.stringify(makeChartDesk(NOW,{interval:'15m', bars:40, revision:1, scope:'tail', tailClose:2222, verified:false, eligible:false}))});
  await expect.poll(()=>page.evaluate(()=>chartOhlcv.length)).toBe(40);
  const tailed=await page.evaluate(()=>({len:chartOhlcv.length, first:chartOhlcv[0].c, last:chartOhlcv.at(-1).c}));
  if(tailed.len!==40 || tailed.first!==1000 || tailed.last!==2222) throw Error('WB-03 tail replaced history '+JSON.stringify(tailed));
  await expect(page.locator('#chart-research-evidence')).toContainText('已加载 40 根');
  await expect(page.locator('#chart-research-evidence')).toContainText('本次返回 20 根');
  await expect(page.locator('#chart-research-evidence')).toContainText('尾部返回不是全历史总数');
  if(calls.some(call=>call.from)) throw Error('WB-03 same revision tail requested a full window');
  state.revision=2;
  await page.clock.runFor(1000);
  await waitFor(()=>pending.some(item=>item.record.tail==='20'));
  const bumped=pending.splice(pending.findIndex(item=>item.record.tail==='20'),1)[0];
  await releaseHeld(bumped, {contentType:'application/json', body:JSON.stringify(makeChartDesk(NOW,{interval:'15m', bars:40, revision:2, scope:'tail', tailClose:2222, verified:false, eligible:false}))});
  await waitFor(()=>pending.some(item=>item.record.from));
  const stale=pending.splice(pending.findIndex(item=>item.record.from),1)[0];
  const loaded=await page.evaluate(()=>({from:String(chartOhlcv[0].t), to:String(chartOhlcv.at(-1).t+900000)}));
  if(stale.record.from!==loaded.from || stale.record.to!==loaded.to || stale.record.symbol!=='BTCUSDT') throw Error('WB-03 reread window '+JSON.stringify(stale.record));
  await releaseHeld(stale, {contentType:'application/json', body:JSON.stringify(makeChartDesk(NOW,{interval:'15m', bars:40, revision:1, scope:'window', closeOf:{0:111}, lastClose:111, verified:false, eligible:false}))});
  await waitFor(()=>pending.some(item=>item.record.from));
  const fresh=pending.splice(pending.findIndex(item=>item.record.from),1)[0];
  await releaseHeld(fresh, {contentType:'application/json', body:JSON.stringify(makeChartDesk(NOW,{interval:'15m', bars:40, revision:2, scope:'window', closeOf:{0:777}, lastClose:1500, verified:false, eligible:false}))});
  await expect.poll(()=>page.evaluate(()=>chartOhlcv[0].c)).toBe(777);
  const revised=await page.evaluate(()=>({len:chartOhlcv.length, confirmed:DataEngine.readDeskHistory('BTCUSDT','15m').confirmedRevision, pending:DataEngine.readDeskHistory('BTCUSDT','15m').pendingRevision}));
  if(revised.len!==40 || revised.confirmed!==2 || revised.pending!=null) throw Error('WB-03 revision commit '+JSON.stringify(revised));
  const fulls=calls.filter(call=>call.from).length;
  await page.clock.runFor(1000);
  await waitFor(()=>pending.some(item=>item.record.tail==='20'));
  const duplicate=pending.splice(pending.findIndex(item=>item.record.tail==='20'),1)[0];
  await releaseHeld(duplicate, {contentType:'application/json', body:JSON.stringify(makeChartDesk(NOW,{interval:'15m', bars:40, revision:2, scope:'tail', tailClose:1500, verified:false, eligible:false}))});
  await page.clock.runFor(300);
  if(calls.filter(call=>call.from).length!==fulls) throw Error('WB-03 duplicate revision retried full');
  state.revision=3;
  await page.clock.runFor(1000);
  await waitFor(()=>pending.some(item=>item.record.tail==='20'));
  const failingTail=pending.splice(pending.findIndex(item=>item.record.tail==='20'),1)[0];
  await releaseHeld(failingTail, {contentType:'application/json', body:JSON.stringify(makeChartDesk(NOW,{interval:'15m', bars:40, revision:3, scope:'tail', tailClose:1500, verified:false, eligible:false}))});
  await waitFor(()=>pending.some(item=>item.record.from));
  const failedFull=pending.splice(pending.findIndex(item=>item.record.from),1)[0];
  await releaseHeld(failedFull, {status:503, contentType:'application/json', body:JSON.stringify({error:'full failed'})});
  await expect(page.locator('#chart-research-evidence')).toContainText('未把失败画成已核实空历史');
  const afterFail=calls.filter(call=>call.from).length;
  const kept=await page.evaluate(()=>({len:chartOhlcv.length, confirmed:DataEngine.readDeskHistory('BTCUSDT','15m').confirmedRevision, pending:DataEngine.readDeskHistory('BTCUSDT','15m').pendingRevision}));
  if(kept.len!==40 || kept.confirmed!==2 || kept.pending!==3) throw Error('WB-03 failed reread consumed revision '+JSON.stringify(kept));
  await page.clock.runFor(2000);
  if(calls.filter(call=>call.from).length!==afterFail) throw Error('WB-03 retried full inside backoff');
  hold=false;
  while(pending.length){
    const item=pending.shift();
    const interval=item.record.interval||'15m';
    await releaseHeld(item, {contentType:'application/json', body:JSON.stringify(makeChartDesk(NOW,{interval, bars:interval==='15m'?40:24, revision:interval==='15m'?2:1, scope:item.record.from?'window':(item.record.tail?'tail':'window'), lastClose:interval==='15m'?1500:4100, verified:false, eligible:false}))});
  }
  await page.locator('#mtf-toggle').click();
  await expect(page.locator('#mtf-hint-0')).toContainText('1h');
  await expect(page.locator('#mtf-hint-0')).toContainText('已加载');
  await expect(page.locator('#chart-research-evidence')).toContainText('15m');
  await expect(page.locator('#chart-research-evidence')).toContainText('已加载 40 根');
  await expect(page.locator('#chart-research-evidence')).not.toContainText('HIGHER-SHOULD-NOT-STICK');
  if(await page.locator('#mtf-toggle').isChecked()) await page.locator('#mtf-toggle').click();
  hold=true;
  state.revision=2;
  await page.locator('.tf-btn[data-tf="5m"]').click();
  await page.locator('.tf-btn[data-tf="15m"]').click();
  await page.locator('.tf-btn[data-tf="1h"]').click();
  await waitFor(()=>pending.some(item=>item.record.interval==='1h' && !item.record.tail && !item.record.from));
  const hour=pending.splice(pending.findIndex(item=>item.record.interval==='1h' && !item.record.tail && !item.record.from),1)[0];
  await releaseHeld(hour, {contentType:'application/json', body:JSON.stringify(makeChartDesk(NOW,{interval:'1h', bars:24, revision:1, lastClose:4100, verified:false, eligible:false}))});
  await expect.poll(()=>page.evaluate(()=>chartOhlcv.at(-1).c)).toBe(4100);
  for(const item of pending.splice(0)){
    const body=makeChartDesk(NOW,{interval:item.record.interval||'5m', bars:item.record.interval==='15m'?18:12, revision:1, lastClose:item.record.interval==='15m'?3200:2100, verified:false, eligible:false});
    await releaseHeld(item, {contentType:'application/json', body:JSON.stringify(body)});
  }
  await page.waitForTimeout(100);
  const raced=await page.evaluate(()=>({len:chartOhlcv.length, last:chartOhlcv.at(-1).c, id:CHART_PRODUCT.id, evidence:document.getElementById('chart-research-evidence').textContent}));
  const racedInterval=(raced.evidence || '').split(' · ')[1];
  if(raced.len!==24 || raced.last!==4100 || raced.id!=='BINANCE:USDM:BTCUSDT:PERPETUAL' || racedInterval!=='1h') throw Error('WB-09 reverse response overwrote 1h '+JSON.stringify(raced));
  const beforeHigher=raced.evidence;
  const higherPromise=page.evaluate(()=>loadHigherChartStructure({currentPrice:chartOhlcv.at(-1).c}, chartStructureRequestId, 14));
  await waitFor(()=>pending.some(item=>item.record.interval==='4h'));
  const higher=pending.splice(pending.findIndex(item=>item.record.interval==='4h'),1)[0];
  await releaseHeld(higher, {contentType:'application/json', body:JSON.stringify(makeChartDesk(NOW,{interval:'4h', bars:8, revision:1, lastClose:8800, instrumentId:'HIGHER-SHOULD-NOT-STICK', verified:false, eligible:false}))});
  await higherPromise;
  await page.evaluate(()=>renderChartEvidence(CHART_SYMBOL, currentInterval));
  const afterHigher=await page.locator('#chart-research-evidence').innerText();
  if(afterHigher!==beforeHigher || afterHigher.includes('HIGHER-SHOULD-NOT-STICK')) throw Error('WB-09 higher timeframe wrote main evidence');
  hold=false;
  const beforeLeave=calls.length;
  await page.locator('#nav').getByRole('link',{name:'概览 Dashboard', exact:true}).click();
  await expect(page.getByRole('heading',{name:'功能清单', exact:true})).toBeVisible();
  const surviving=await page.evaluate(()=>DataEngine.readDeskHistory('BTCUSDT','15m').confirmedRevision);
  if(surviving!==2) throw Error('WB-10 lost confirmed revision on leave '+surviving);
  if(JSON.stringify(await page.evaluate(()=>Object.entries(localStorage).map(([key,value])=>key+':'+value))).includes('historyRevision')) throw Error('WB-10 persisted history revision');
  await page.clock.runFor(3000);
  if(calls.length!==beforeLeave) throw Error('WB-10 chart kept requesting after leave '+(calls.length-beforeLeave));
  await expect.poll(()=>page.evaluate(()=>window.__fixtureSockets.filter(socket=>socket.readyState!==3).length)).toBe(0);
  hold=false;
  await page.evaluate(()=>{location.hash='#/chart';});
  await expect(page.locator('#chart-research-evidence')).toContainText('BINANCE:USDM:BTCUSDT:PERPETUAL');
  await expect.poll(()=>page.evaluate(()=>chartOhlcv.length)).toBeGreaterThan(0);
  const returned=await page.evaluate(()=>({interval:currentInterval, id:CHART_PRODUCT.id, len:chartOhlcv.length}));
  if(returned.interval!=='1h' || returned.id!=='BINANCE:USDM:BTCUSDT:PERPETUAL' || returned.len<1) throw Error('WB-10 return identity '+JSON.stringify(returned));
  const hiddenAt=calls.length;
  await page.evaluate(()=>{
    window.__testHidden=true;
    Object.defineProperty(document,'hidden',{configurable:true, get:()=>window.__testHidden});
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(3000);
  if(calls.length!==hiddenAt) throw Error('WB-11 hidden chart kept polling '+(calls.length-hiddenAt));
  await page.evaluate(()=>{window.__testHidden=false; document.dispatchEvent(new Event('visibilitychange'));});
  await expect.poll(()=>calls.length).toBeGreaterThan(hiddenAt);
  const resumed=calls.length;
  if(resumed-hiddenAt>3) throw Error('WB-11 resume burst '+ (resumed-hiddenAt));
  hold=false;
  state.failTail=true;
  await context.unroute('**/*');
  await context.route('**/*', async route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin) return route.continue();
    if(url.pathname==='/api/desk/chart'){
      calls.push({interval:url.searchParams.get('interval'), tail:url.searchParams.get('tail'), from:url.searchParams.get('from'), fail:true});
      return route.fulfill({status:503, contentType:'application/json', body:JSON.stringify({error:'offline'})});
    }
    return route.fulfill({contentType:'application/json', body:JSON.stringify({price:'64000', ok:true})});
  });
  const beforeOutage=await page.evaluate(()=>chartOhlcv.length);
  await page.clock.runFor(1000);
  await expect(page.locator('#chart-research-evidence')).toContainText('未把失败画成已核实空历史');
  if(await page.evaluate(()=>chartOhlcv.length)!==beforeOutage) throw Error('WB-11 outage cleared history');
  await context.unroute('**/*');
  await context.route('**/*', async route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin) return route.continue();
    if(url.pathname==='/api/desk/chart'){
      calls.push({interval:url.searchParams.get('interval'), tail:url.searchParams.get('tail'), from:url.searchParams.get('from')});
      const interval=url.searchParams.get('interval')||'1h';
      const body=makeChartDesk(NOW,{interval, bars:interval==='1h'?24:40, revision:1, scope:url.searchParams.get('tail')?'tail':'window', lastClose:4100, verified:false, eligible:false});
      return route.fulfill({contentType:'application/json', body:JSON.stringify(body)});
    }
    return route.fulfill({contentType:'application/json', body:JSON.stringify({price:'64000', ok:true})});
  });
  await page.evaluate(()=>{
    const chart=window.__chartMock;
    chart.timeScale().setVisibleLogicalRange({from:3, to:9});
    window.__savedRange=chart.timeScale().getVisibleLogicalRange();
  });
  await page.clock.runFor(1000);
  const range=await page.evaluate(()=>{
    const now=window.__chartMock.timeScale().getVisibleLogicalRange();
    return {now, saved:window.__savedRange, len:chartOhlcv.length};
  });
  if(!range.now || range.now.from!==range.saved.from || range.now.to!==range.saved.to || range.len<1) throw Error('WB-11 viewport lost '+JSON.stringify(range));
  if(errors.length) throw Error('chart workbench errors '+errors.join(';'));
  chartCaseResults.push({id:'WB-03', status:'PASS', flow:'全窗后 20 根尾部不缩小历史；修订重读一次，失败不每秒重试，旧版本不覆盖'});
  chartCaseResults.push({id:'WB-09', status:'PASS', flow:'5m→15m→1h 逆序与上级周期不覆盖当前产品、窗口和证据'});
  chartCaseResults.push({id:'WB-10', status:'PASS', flow:'离开行情再返回，数据非空、身份正确、旧请求停止'});
  chartCaseResults.push({id:'WB-11', status:'PASS', flow:'隐藏停止轮询，断网不画成空历史，拖动后尾部刷新保持视口'});
  console.log('PASS WB-03 WB-09 WB-10 WB-11 chart view, request count and viewport');
  await context.close();
}
