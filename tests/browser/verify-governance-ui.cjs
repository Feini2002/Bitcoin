const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const { chromium, expect }=require('playwright/test');
const ROOT=path.join(__dirname,'../..');
const OUT=path.join(ROOT,'.artifacts',process.env.BITDESK_UI_ROOT ? 'pages-artifact' : 'governance');
const ASSET_ROOT=path.resolve(ROOT,process.env.BITDESK_UI_ROOT || '.');
const NOW=Date.UTC(2026,8,15,12);
const results=[];
let browser, server, currentPage;
const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'};
async function main(){
  fs.mkdirSync(OUT,{recursive:true});
  server=http.createServer((req,res)=>{
    const rel=decodeURIComponent(new URL(req.url,'http://local').pathname);
    const file=path.resolve(ASSET_ROOT,'.'+(rel==='/'?'/index.html':rel));
    if(!file.startsWith(ASSET_ROOT+path.sep)){res.writeHead(404);res.end();return;}
    fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',mime[path.extname(file)]||'text/plain');res.end(data);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch({headless:true,...(process.env.BITDESK_TEST_BROWSER ? {channel:process.env.BITDESK_TEST_BROWSER} : {})});
  console.log(JSON.stringify({pid:process.pid,origin,browser:browser.version(),deadline:'external run-bounded watchdog'}));
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
    const context=await browser.newContext({viewport,deviceScaleFactor:1,locale:'zh-CN',timezoneId:'Asia/Shanghai',colorScheme:'light',reducedMotion:'reduce'});
    context.setDefaultTimeout(8000);
    const errors=[];
    await context.route('**/*',async route=>{
      if(route.request().url().startsWith(origin+'/')) return route.continue();
      // 演示/规划流程不使用外部行情库；所有外部流量固定响应，禁止真实业务副作用。
      return route.fulfill({status:200,contentType:route.request().resourceType()==='script'?'text/javascript':'application/json',body:route.request().resourceType()==='script'?'':'{}'});
    });
    const page=await context.newPage();currentPage=page;
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.clock.install({time:NOW});
    await page.goto(origin+'/#/overview');
    await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important}'});
    await expect(page.getByRole('heading',{name:'研究总览',exact:true})).toBeVisible();
    await page.getByText('查看功能清单、规划与演示',{exact:true}).click();
    await expect(page.getByText('已接入只表示该页连上了接口',{exact:false})).toBeVisible();
    for(const id of ['chart','orderflow','heatmap','derivatives']){
      const card=page.locator('.feature-card[href="#/'+id+'"]');
      await expect(card).toBeVisible();
      await expect(card.locator('.chip')).toHaveText('已接入');
      await expect(card).toContainText('页内的数据来源、更新时间和错误提示');
    }
    await expect(page.locator('#outlet')).not.toContainText('主源未恢复');
    results.push({id:'UI-MATURITY',viewport,status:'PASS',flow:'功能清单 → 四个市场页已接入 → 运行状态指向页内数据证据'});
    await expect(page.getByText('谨慎做多 · 试仓 30%',{exact:true})).not.toBeVisible();
    if(viewport.width<681)await page.getByRole('button',{name:'导航',exact:true}).click();
    const planning=page.getByRole('button',{name:'规划与演示',exact:false});
    await planning.click();await expect(planning).toHaveAttribute('aria-expanded','true');
    await page.reload();await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important}'});if(viewport.width<681)await page.getByRole('button',{name:'导航',exact:true}).click();await expect(page.getByRole('button',{name:'规划与演示',exact:false})).toHaveAttribute('aria-expanded','true');
    const features=await page.evaluate(()=>FEATURES.map(x=>({id:x.id,state:x.state,label:x.label})));
    if(viewport.width<681)await page.getByRole('button',{name:'导航',exact:true}).click();
    await page.screenshot({path:path.join(OUT,'overview-'+viewport.width+'.png'),fullPage:true});
    results.push({id:'UI-01',viewport,status:'PASS',flow:'概览 → 展开规划导航并刷新 → 状态持久化、示例默认隐藏'});
    for(const feature of features.filter(x=>['demo','planned'].includes(x.state))){
      if(viewport.width<681)await page.getByRole('button',{name:'导航',exact:true}).click();
      await page.locator('#nav').getByRole('link',{name:feature.label,exact:false}).click();
      await expect(page).toHaveURL(new RegExp('#/'+feature.id+'$'));
      await expect(page.getByTestId('feature-notice')).toContainText(feature.state==='demo'?'演示':'PLANNED');
      if(feature.state==='demo'){
        await expect(page.getByTestId('demo-preview')).not.toHaveAttribute('open','');
        await page.getByText('展开演示原型（非实时数据）',{exact:true}).click();
        await expect(page.getByTestId('demo-preview')).toHaveAttribute('open','');
        const controls=page.getByTestId('demo-preview').locator('input,textarea,button,select');
        for(const control of await controls.all())await expect(control).toBeDisabled();
        await expect(page.getByText('● 员工在线',{exact:true})).toHaveCount(0);
      }else{
        await expect(page.getByRole('heading',{name:'该模块暂未上岗'})).toBeVisible();
      }
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
      if(overflow)throw Error('horizontal overflow '+feature.id+' '+viewport.width);
      results.push({id:'UI-'+feature.id,viewport,status:'PASS'});
      console.log('PASS '+viewport.width+' '+feature.id);
    }
    await page.screenshot({path:path.join(OUT,'last-route-'+viewport.width+'.png'),fullPage:true});
    if(errors.length)throw Error('browser errors '+errors.join(';'));
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
    await context.close();
    console.log('PASS viewport '+viewport.width+' flows='+results.filter(r=>r.viewport.width===viewport.width).length);
  }
  // 使用实际图表库与固定行情响应，验证数据加载、周期切换、来源与失败恢复。
  const libraryPath=path.join(OUT,'lightweight-charts-4.1.3.js');
  const sharedLibrary=path.join(ROOT,'.artifacts','governance','lightweight-charts-4.1.3.js');
  if(!fs.existsSync(libraryPath)&&fs.existsSync(sharedLibrary))fs.copyFileSync(sharedLibrary,libraryPath);
  if(!fs.existsSync(libraryPath)){
    const response=await fetch('https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js',{signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('chart library download '+response.status);
    fs.writeFileSync(libraryPath,await response.text());
  }
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai',colorScheme:'light',deviceScaleFactor:1,reducedMotion:'reduce'});
  context.setDefaultTimeout(8000);
  let failKlines=false, recoveredKlines=false;
  const recoveryReads=[];
  await context.addInitScript(()=>{
    window.__fixtureSockets=[];
    class FixtureSocket extends EventTarget {
      static CONNECTING=0;static OPEN=1;static CLOSING=2;static CLOSED=3;
      constructor(url){super();this.url=url;this.readyState=1;window.__fixtureSockets.push(this);}
      close(){this.readyState=3;}
      send(){}
    }
    window.WebSocket=FixtureSocket;
  });
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin===origin)return route.continue();
    if(url.href.includes('lightweight-charts'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(libraryPath,'utf8')});
    if(route.request().resourceType()==='script')return route.fulfill({contentType:'text/javascript',body:''});
    if(url.pathname==='/api/desk/chart' || url.pathname.startsWith('/api/desk/')){
      recoveryReads.push({interval:url.searchParams.get('interval'),tail:url.searchParams.get('tail')});
      if(failKlines)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'fixture service paused'})});
      if(recoveredKlines)return route.fulfill({contentType:'application/json',body:JSON.stringify(makeChartDesk(NOW,{interval:url.searchParams.get('interval')||'15m',bars:40,revision:1,scope:url.searchParams.get('tail')?'tail':'window',verified:false,eligible:false}))});
      return route.fulfill({contentType:'application/json',body:JSON.stringify({
        schemaVersion:'2026-09-21.1', asKnownMode:'system_observed', scope:'chart',
        pricePathAvailable:false, tradingNarrative:false, series:[], coverage:{available:0,returned:0,truncated:false,needed:480},
        gap:{reason:'stale_bootstrap'}, quality:{status:'fail',reason:'stale_bootstrap'},
        collectionStale:true, sourceStale:true, instrumentId:null, venue:null
      })});
    }
    if(url.pathname==='/api/d1/klines'){
      if(failKlines)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'fixture service paused'})});
      return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'analysis path must use /api/desk'})});
    }
    return route.fulfill({contentType:'application/json',body:JSON.stringify({price:'64408',ok:true})});
  });
  const page=await context.newPage();currentPage=page;
  const chartErrors=[];page.on('pageerror',e=>chartErrors.push(e.message));
  const consoleErrors=[];page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  await page.clock.install({time:NOW});
  await page.goto(origin+'/#/chart');
  await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important}'});
  await expect(page.locator('#chart-status')).toContainText('行情读取失败');
  await expect(page.locator('#chart-empty-desk')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>chartOhlcv.length)).toBe(0);
  await expect(page.locator('#breadcrumb')).toContainText('行情工作台');
  await expect(page.locator('#chart-primary-title')).toContainText('—');
  await expect(page.locator('#outlet').getByRole('link',{name:'环境评估员',exact:false})).toHaveCount(0);
  const socketUrls=await page.evaluate(()=>window.__fixtureSockets.map(socket=>socket.url));
  if(socketUrls.some(url=>url.includes('@kline_')||url.includes('@aggTrade')))throw Error('halted desk must not open live market sockets');
  results.push({id:'UI-CHART-HALT',status:'PASS',flow:'主源缺失 → 全屏停机 → 不把 WS 当实时、不画 P5 混源'});
  failKlines=true;
  await page.reload();
  await expect(page.locator('#chart-status')).toContainText('行情读取失败');
  await expect(page.locator('#chart-empty-desk')).toBeVisible();
  await expect(page.locator('#chart-empty-desk')).toContainText('503');
  await expect.poll(()=>page.evaluate(()=>chartOhlcv.length)).toBe(0);
  results.push({id:'UI-CHART-03',status:'PASS',flow:'desk 失败 → 页面停机，未伪造历史行情'});
  await page.screenshot({path:path.join(OUT,'chart-1440.png'),fullPage:true});
  await expect(page.getByRole('button',{name:'4h',exact:true})).toBeEnabled();
  await expect(page.locator('#chart-read-retry')).toBeEnabled();
  failKlines=false;recoveredKlines=true;
  await page.clock.runFor(3500);
  await expect.poll(()=>page.evaluate(()=>chartOhlcv.length)).toBe(40);
  await expect(page.locator('#chart-empty-desk')).toBeHidden();
  results.push({id:'UI-CHART-AUTO-RECOVERY',status:'PASS',flow:'首次读取503 → 周期仍可操作 → 自动重读成功 → 恢复真实历史窗口'});
  await page.getByRole('button',{name:'5m',exact:true}).click();
  await expect(page.locator('#chart-research-evidence')).toContainText(' · 5m · ');
  const full15=recoveryReads.filter(r=>r.interval==='15m'&&!r.tail).length;
  const warmStart=recoveryReads.length;
  await page.getByRole('button',{name:'15m',exact:true}).click();
  await expect(page.locator('#chart-research-evidence')).toContainText(' · 15m · ');
  await expect.poll(()=>page.evaluate(()=>chartOhlcv.length)).toBe(40);
  if(recoveryReads.filter(r=>r.interval==='15m'&&!r.tail).length!==full15 || !recoveryReads.slice(warmStart).some(r=>r.interval==='15m'&&r.tail==='20'))throw Error('warm switch must validate tail and retain full history without downloading it again');
  results.push({id:'UI-CHART-WARM-SWITCH',status:'PASS',flow:'15m→5m→15m → 只读取新尾部验证版本，保留40根完整窗口'});
  if(chartErrors.length||consoleErrors.some(message=>!message.includes('503')&&!message.includes('加载图表数据失败')&&!message.includes('主图停机')))throw Error('normal chart errors '+[...chartErrors,...consoleErrors].join(';'));
  await page.locator('#nav').getByRole('link',{name:'研究总览',exact:true}).click();
  await expect(page.getByRole('heading',{name:'研究总览',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.__fixtureSockets.filter(s=>s.readyState!==3).length)).toBe(0);
  if(chartErrors.length)throw Error('chart page errors '+chartErrors.join(';'));
  results.push({id:'UI-CHART-05',status:'PASS',flow:'离开行情 → 释放全部行情 WebSocket'});
  await context.close();
  console.log('PASS chart rendering, WS provenance, failure recovery and disposal');
  await verifyChartWorkbench(browser, origin);
  await verifyChartPresentation(browser, origin, libraryPath);
}

async function verifyChartPresentation(browser, origin, libraryPath) {
  const context = await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN'});
  context.setDefaultTimeout(8000);
  await context.addInitScript(() => {
    localStorage.setItem('bitdesk.workbench.chartInterval','15m');
    localStorage.setItem('bitdesk.workbench.mtf',JSON.stringify({open:false,tfs:['1h','4h','1d','1w']}));
    window.WebSocket = class extends EventTarget { static OPEN=1; constructor(){super();this.readyState=1;} close(){this.readyState=3;} send(){} };
  });
  await context.route('**/*', async route => {
    const url=new URL(route.request().url());
    if(url.origin===origin)return route.continue();
    if(url.href.includes('lightweight-charts'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(libraryPath,'utf8')});
    if(route.request().resourceType()==='script')return route.fulfill({contentType:'text/javascript',body:''});
    if(url.pathname==='/api/desk/chart')return route.fulfill({contentType:'application/json',body:JSON.stringify(makeChartDesk(NOW,{interval:url.searchParams.get('interval')||'15m',bars:40,revision:1,verified:true,scope:url.searchParams.has('tail')?'tail':'window'}))});
    return route.fulfill({contentType:'application/json',body:'{}'});
  });
  const page=await context.newPage();currentPage=page;
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.clock.install({time:NOW});
  await page.goto(origin+'/#/chart');
  await expect.poll(()=>page.evaluate(()=>chartOhlcv.length)).toBe(40);
  await expect(page.locator('#chart-container canvas').first()).toBeVisible();
  for(const width of [1440,390]) {
    await page.setViewportSize({width,height:844});
    await page.clock.runFor(100);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    if(overflow>1)throw Error('WB-12 real chart horizontal overflow '+width+': '+overflow);
    await page.screenshot({path:path.join(OUT,'chart-normal-'+width+'.png'),fullPage:true});
  }
  const [download]=await Promise.all([page.waitForEvent('download'),page.locator('[data-workbench-export]').click()]);
  const evidence=JSON.parse(fs.readFileSync(await download.path(),'utf8'));
  const displayed=await page.evaluate(()=>chartOhlcv.map(row=>({t:row.t,c:row.c})));
  const exported=evidence.pages.chart.series;
  if(!exported||exported.length!==displayed.length||exported.some((row,i)=>row.t!==displayed[i].t||row.c!==displayed[i].c))throw Error('WB-13 chart download differs from displayed rows');
  if(errors.length)throw Error(errors.join('; '));
  results.push({id:'WB-12/13',status:'PASS',flow:'真实图表1440/390无横溢出，下载逐条匹配已显示数据'});
  console.log('PASS WB-12/13 real chart widths and displayed download');
  await context.close();
}

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
  await page.clock.runFor(500);
  await waitFor(()=>pending.some(item=>item.record.from));
  const retryFull=pending.splice(pending.findIndex(item=>item.record.from),1)[0];
  await releaseHeld(retryFull, {status:503, contentType:'application/json', body:JSON.stringify({error:'full retry failed'})});
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
  await page.evaluate(()=>DataEngine._chartWindows.clear()); // This scenario exercises cold reads arriving out of order.
  await page.locator('.tf-btn[data-tf="5m"]').click();
  await page.locator('.tf-btn[data-tf="15m"]').click();
  await page.locator('.tf-btn[data-tf="1h"]').click();
  await waitFor(()=>pending.some(item=>item.record.interval==='1h' && !item.record.tail && !item.record.from));
  const hour=pending.splice(pending.findIndex(item=>item.record.interval==='1h' && !item.record.tail && !item.record.from),1)[0];
  await releaseHeld(hour, {contentType:'application/json', body:JSON.stringify(makeChartDesk(NOW,{interval:'1h', bars:24, revision:1, lastClose:4100, verified:false, eligible:false}))});
  await expect.poll(()=>page.evaluate(()=>chartOhlcv.at(-1)?.c)).toBe(4100);
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
  // Use a non-fetching destination to isolate disposal; the research overview now reads its own snapshot.
  await page.evaluate(()=>{location.hash='#/archive';});
  await expect(page.getByRole('heading',{name:'发言历史库', exact:true})).toBeVisible();
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
  results.push({id:'WB-03', status:'PASS', flow:'全窗后 20 根尾部不缩小历史；修订重读一次，失败不每秒重试，旧版本不覆盖'});
  results.push({id:'WB-09', status:'PASS', flow:'5m→15m→1h 逆序与上级周期不覆盖当前产品、窗口和证据'});
  results.push({id:'WB-10', status:'PASS', flow:'离开行情再返回，数据非空、身份正确、旧请求停止'});
  results.push({id:'WB-11', status:'PASS', flow:'隐藏停止轮询，断网不画成空历史，拖动后尾部刷新保持视口'});
  console.log('PASS WB-03 WB-09 WB-10 WB-11 chart view, request count and viewport');
  await context.close();
}
main().catch(async error=>{console.error('FAIL UI',error);results.push({status:'FAIL',error:String(error)});if(currentPage&&!currentPage.isClosed())await currentPage.screenshot({path:path.join(OUT,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
  fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify(results,null,2));
  console.log('UI report '+path.join(OUT,'results.json')+' PASS='+results.filter(r=>r.status==='PASS').length+' FAIL='+results.filter(r=>r.status==='FAIL').length);
});
