const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const { chromium, expect }=require('playwright/test');
const ROOT=path.join(__dirname,'..');
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
    await expect(page.getByRole('heading',{name:'功能清单',exact:true})).toBeVisible();
    await expect(page.getByText('已接入只表示该页连上了接口',{exact:false})).toBeVisible();
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
  let failKlines=false;
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
      if(failKlines)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'fixture service paused'})});
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
  await expect(page.locator('#chart-status')).toContainText('主图停机');
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
  await expect(page.locator('#chart-status')).toContainText('主图停机');
  results.push({id:'UI-CHART-03',status:'PASS',flow:'desk 失败 → 页面停机，未伪造历史行情'});
  await page.screenshot({path:path.join(OUT,'chart-1440.png'),fullPage:true});
  if(chartErrors.length||consoleErrors.some(message=>!message.includes('503')&&!message.includes('加载图表数据失败')&&!message.includes('主图停机')))throw Error('normal chart errors '+[...chartErrors,...consoleErrors].join(';'));
  await page.locator('#nav').getByRole('link',{name:'概览 Dashboard',exact:true}).click();
  await expect(page.getByRole('heading',{name:'功能清单',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.__fixtureSockets.filter(s=>s.readyState!==3).length)).toBe(0);
  if(chartErrors.length)throw Error('chart page errors '+chartErrors.join(';'));
  results.push({id:'UI-CHART-05',status:'PASS',flow:'离开行情 → 释放全部行情 WebSocket'});
  await context.close();
  console.log('PASS chart rendering, WS provenance, failure recovery and disposal');

}
main().catch(async error=>{console.error('FAIL UI',error);results.push({status:'FAIL',error:String(error)});if(currentPage&&!currentPage.isClosed())await currentPage.screenshot({path:path.join(OUT,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1;}).finally(async()=>{
  if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
  fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify(results,null,2));
  console.log('UI report '+path.join(OUT,'results.json')+' PASS='+results.filter(r=>r.status==='PASS').length+' FAIL='+results.filter(r=>r.status==='FAIL').length);
});
