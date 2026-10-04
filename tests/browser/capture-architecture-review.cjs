'use strict';
// UI acceptance replays captured public responses in an isolated browser.
// No production mutations, personal browser profile or model requests.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../..'),requireTools=createRequire(path.join(process.env.BIT_QA_TOOL_ROOT||root,'package.json'));
const {chromium,expect}=requireTools('playwright/test');let server,browser;
async function main(){
  const fixtures=path.resolve(process.env.BIT_QA_FIXTURES||'');if(!fs.existsSync(path.join(fixtures,'manifest.json')))throw Error('BIT_QA_FIXTURES must point to captured public responses');
  const manifest=JSON.parse(fs.readFileSync(path.join(fixtures,'manifest.json'),'utf8'));
  const read=name=>JSON.parse(fs.readFileSync(path.join(fixtures,name+'.json'),'utf8'));
  const snapshotTime=Math.max(...manifest.results.filter(r=>r.ok).map(r=>Date.parse(r.receivedAt)));
  const samples=Object.fromEntries(['chart','orderflow','heatmap','context','datasets','status','events','analysis'].map(name=>[name,read(name)]));
  const {createServer}=await import(pathToFileURL(requireTools.resolve('vite')).href);
  server=await createServer({configFile:false,root,server:{host:'127.0.0.1',port:0,open:false,hmr:false,fs:{deny:['.env','.env.*','**/.codex/**','**/.git/**','**/.local/**']}},
    plugins:[{name:'qa-public-config',transformIndexHtml:{order:'post',handler(html){return html
      .replace(/<script\b[^>]*src="\/@vite\/client"[^>]*><\/script>/g,'')
      .replace('<head>','<head><script>window.BIT_DATA_API_BASE="https://fixture.invalid/data";window.BIT_YUQING_API_BASE="https://fixture.invalid/news";</script>');}}}]});
  await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await chromium.launch({headless:true});
  const directory=path.join(root,'.artifacts/architecture-review',process.env.BIT_QA_LABEL||'baseline');fs.mkdirSync(directory,{recursive:true});
  const results=[];
  for(const [device,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
    const context=await browser.newContext({viewport,deviceScaleFactor:1,locale:'zh-CN',timezoneId:'Asia/Shanghai',reducedMotion:'reduce'});
    const page=await context.newPage(),errors=[],diagnostics=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')diagnostics.push(message.text());});
    page.on('requestfailed',request=>diagnostics.push(request.url()+': '+request.failure()?.errorText));
    await page.clock.install({time:new Date(snapshotTime)});
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin===origin||url.hostname==='unpkg.com')return route.continue();
      if(route.request().method()!=='GET')return route.fulfill({status:405,contentType:'application/json',body:'{"error":"QA_read_only"}'});
      let data;
      const scope=/\/api\/desk\/(chart|orderflow|heatmap|context)$/.exec(url.pathname)?.[1];
      if(scope)data=JSON.parse(JSON.stringify(samples[scope]));
      else if(url.pathname.endsWith('/api/finance/datasets'))data=samples.datasets;
      else if(url.pathname.endsWith('/api/d1/status'))data=samples.status;
      else if(url.pathname.endsWith('/api/yuqing/reports/latest'))data=samples[url.searchParams.get('kind')==='daily_event'?'events':'analysis'];
      else if(url.pathname.endsWith('/api/yuqing/reports'))data={ok:true,reports:[samples.events.report,samples.analysis.report].filter(Boolean)};
      else if(url.pathname.endsWith('/api/d1/klines'))data={ok:true,klines:samples.chart.series.map(r=>[r.t,r.o,r.h,r.l,r.c,r.v])};
      else if(url.pathname.endsWith('/api/d1/liquidations/status'))data={ok:true,sources:[]};
      else data={ok:true};
      if(scope==='chart'){
        const interval=url.searchParams.get('interval')||'15m';data.interval=interval;
        data.requestWindow={...data.requestWindow,interval,readIntent:url.searchParams.has('tail')?'tail':'window',tail:Number(url.searchParams.get('tail'))||null,
          from:url.searchParams.has('from')?Number(url.searchParams.get('from')):null,to:url.searchParams.has('to')?Number(url.searchParams.get('to')):null};
        data.coverageScope=data.requestWindow.readIntent;
        if(interval!=='15m'){data.series=[];data.pricePathAvailable=false;data.quality={status:'fail',reason:'QA_fixture_interval_not_captured'};data.gap={reason:'QA_fixture_interval_not_captured'};}
      }
      // Mirror credentialed browser CORS: the application includes its existing
      // Access session. A wildcard origin makes even an HTTP 200 unreadable.
      return route.fulfill({status:200,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Credentials':'true'},contentType:'application/json',body:JSON.stringify(data)});
    });
    if(context.routeWebSocket)await context.routeWebSocket('**',socket=>socket.close());
    const requestedRoutes=(process.env.BIT_QA_ROUTES||'').split(',').filter(Boolean);
    for(const [route,title] of [['overview','研究总览'],['chart','行情工作台'],['orderflow','订单流与足迹'],['heatmap','强平雷达'],['derivatives','环境背景']].filter(([route])=>!requestedRoutes.length||requestedRoutes.includes(route))){
      const start=errors.length,diagnosticStart=diagnostics.length;let failure=null;
      try{
        await page.goto(origin+'/index.html#/'+route,{waitUntil:'domcontentloaded'});
        await expect(page.getByRole('heading',{name:title,exact:true}).first()).toBeVisible({timeout:20000});
        if(route==='overview')await expect(page.locator('#home-chart .rd-market-value')).toContainText('USDT');
        if(route==='chart')await expect.poll(()=>page.evaluate(()=>chartOhlcv.length)).toBeGreaterThan(0);
        if(route==='orderflow'){
          await expect(page.locator('#of-status')).toContainText('desk (');
          const displayInterval=await page.evaluate(()=>readOrderflowState().interval);
          const step={'5m':300000,'15m':900000,'1h':3600000,'4h':14400000}[displayInterval];
          assert.ok(step,'Supported display aggregation interval');
          const expected=new Set(samples.orderflow.series.map(bar=>Math.floor(Number(bar.t)/step))).size;
          await expect(page.locator('#of-status')).toContainText(expected+' bars');
          await page.locator('[data-of-tf="5m"]').click();
          await expect(page.locator('#of-status')).toContainText(samples.orderflow.series.length+' bars');
          const sourceTotals=samples.orderflow.series.reduce((sum,bar)=>({buy:sum.buy+Number(bar.buyVol??bar.buy_vol??0),sell:sum.sell+Number(bar.sellVol??bar.sell_vol??0)}),{buy:0,sell:0});
          const shownTotals=await page.evaluate(()=>orderflowBars.reduce((sum,bar)=>({buy:sum.buy+Number(bar.buyVol||0),sell:sum.sell+Number(bar.sellVol||0)}),{buy:0,sell:0}));
          assert.ok(Math.abs(sourceTotals.buy-shownTotals.buy)<1e-8,'5m displayed buy volume equals captured source');
          assert.ok(Math.abs(sourceTotals.sell-shownTotals.sell)<1e-8,'5m displayed sell volume equals captured source');
          await page.locator('[data-of-tf="'+displayInterval+'"]').click();
          await expect(page.locator('#of-status')).toContainText(expected+' bars');
        }
        if(route==='derivatives'){
          await expect(page.locator('#deriv-contract-cards article')).toHaveCount(3);
          await expect(page.locator('#deriv-status')).toContainText('desk context 已返回');
          await expect(page.locator('#deriv-read-failure')).toBeHidden();
          await expect(page.locator('#deriv-freq-groups article').first()).toBeVisible();
        }
        if(route==='heatmap'){
          await expect(page.locator('#hm-status')).toContainText('desk 分所');
          await expect(page.locator('#hm-venue-kpis')).toContainText('Binance');
          await expect(page.locator('#hm-cloud-window-count')).not.toHaveText('0 个 5m 桶');
        }
        assert.equal(await page.locator('vite-error-overlay').count(),0);
        const width=await page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:innerWidth}));
        if(width.document>width.viewport+2)throw Error('Horizontal overflow '+JSON.stringify(width));
        if(route==='overview'&&device==='mobile'){const toggle=page.locator('#mobile-nav-toggle');await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','true');await toggle.click();await expect(toggle).toHaveAttribute('aria-expanded','false');}
      }catch(error){failure=error.message;}
      const file=device+'-'+route+'.png';await page.screenshot({path:path.join(directory,file),fullPage:true,animations:'disabled'});
      const relevantErrors=errors.slice(start);results.push({device,route,outcome:failure||relevantErrors.length?'FAIL':'PASS',failure,errors:relevantErrors,diagnostics:diagnostics.slice(diagnosticStart),screenshot:file});
    }
    await context.close();
  }
  const report={mode:'captured-source-replay',snapshotTime:new Date(snapshotTime).toISOString(),browser:browser.version(),results,
    limitations:['Only the captured 15m chart interval is supplied; other intervals deliberately show unavailable.', 'Screenshots verify local presentation, not live production service availability.']};
  fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,pass:results.filter(r=>r.outcome==='PASS').length,fail:results.filter(r=>r.outcome==='FAIL').length,results}));
  if(results.some(r=>r.outcome==='FAIL'))process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();await server?.close();});
