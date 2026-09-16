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
    await expect(page.getByText('已接入表示功能已连接数据或报告接口',{exact:false})).toBeVisible();
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
    if(url.pathname==='/api/d1/klines'){
      if(failKlines)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'fixture service paused'})});
      const interval=url.searchParams.get('interval');
      const step={'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000,'3d':259200000,'1w':604800000}[interval]||300000;
      const latestT=Math.floor(NOW/step)*step;
      const klines=Array.from({length:200},(_,n)=>({t:latestT-(199-n)*step,o:64000+n*2,h:64020+n*2,l:63980+n*2,c:64010+n*2,v:100+n}));
      return route.fulfill({contentType:'application/json',headers:{'X-Data-Source':'cloudflare-d1','Access-Control-Expose-Headers':'X-Data-Source'},body:JSON.stringify({symbol:'BTCUSDT',interval,latestT,count:klines.length,klines})});
    }
    return route.fulfill({contentType:'application/json',body:JSON.stringify({price:'64408',ok:true})});
  });
  const page=await context.newPage();currentPage=page;
  const chartErrors=[];page.on('pageerror',e=>chartErrors.push(e.message));
  const consoleErrors=[];page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  await page.clock.install({time:NOW});
  await page.goto(origin+'/#/chart');
  await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important}'});
  await expect(page.locator('#chart-status')).toContainText('D1 末根开盘');
  await expect.poll(()=>page.evaluate(()=>chartOhlcv.length)).toBe(200);
  await expect(page.locator('#breadcrumb')).toContainText('行情工作台');
  await expect(page.getByTestId('feature-notice')).toHaveCount(0);
  await expect(page.getByRole('region',{name:'行情数据状态'})).toHaveCount(0);
  await expect(page.locator('#outlet').getByRole('link',{name:'环境评估员',exact:false})).toHaveCount(0);
  await expect(page.locator('#outlet').getByRole('link',{name:'盘口流动性官',exact:false})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'同步D1',exact:true})).toBeVisible();
  await expect(page.locator('#chart-container canvas').first()).toBeVisible();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  const socketUrls=await page.evaluate(()=>window.__fixtureSockets.map(socket=>socket.url));
  if(!socketUrls.some(url=>url.includes('/market/ws/btcusdt@aggTrade'))||!socketUrls.some(url=>url.includes('/market/ws/btcusdt@kline_')))throw Error('migrated futures streams missing');
  if(socketUrls.some(url=>url.includes('fstream.binance.com/ws/')||url.includes('stream.binance.com:9443')))throw Error('legacy or spot stream used by futures chart');
  results.push({id:'UI-BINANCE-WS-01',status:'PASS',flow:'行情启动 → 新market成交与K线订阅 → 不使用旧地址或现货推送'});
  results.push({id:'UI-CHART-CLEAN-DESKTOP',status:'PASS',flow:'行情 → 首屏 → 两条噪音横幅移除，图表、周期和动态状态保留'});
  await page.getByRole('button',{name:'15m',exact:true}).click();
  await expect(page.locator('#chart-status')).toContainText('BTCUSDT · 15m');
  await expect.poll(()=>page.evaluate(()=>chartD1Meta.interval)).toBe('15m');
  results.push({id:'UI-CHART-01',status:'PASS',flow:'行情 → 切换周期 → 主图与 D1 元数据一致'});
  const d1Before=await page.evaluate(()=>chartD1Meta.latestT);
  await page.evaluate(()=>{
    const socket=window.__fixtureSockets.findLast(x=>x.url.includes('kline_15m')&&x.readyState===1);
    if(!socket)throw Error('fixture socket absent');
    socket.onmessage({data:JSON.stringify({k:{t:chartD1Meta.latestT+900000,o:'64408',h:'64430',l:'64400',c:'64420',v:'2'}})});
  });
  await expect.poll(()=>page.evaluate(()=>chartOhlcv.length)).toBe(201);
  if(await page.evaluate(()=>chartD1Meta.latestT)!==d1Before)throw Error('WS overwrote D1 timestamp');
  await page.screenshot({path:path.join(OUT,'chart-1440.png'),fullPage:true});
  if(chartErrors.length||consoleErrors.length)throw Error('normal chart errors '+[...chartErrors,...consoleErrors].join(';'));
  results.push({id:'UI-CHART-02',status:'PASS',flow:'WS 新 K 线 → 图表增长 → D1 时效不被改写'});
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByTestId('feature-notice')).toHaveCount(0);
  await expect(page.getByRole('region',{name:'行情数据状态'})).toHaveCount(0);
  await page.getByRole('button',{name:'5m',exact:true}).click();
  await expect(page.locator('#chart-status')).toContainText('BTCUSDT · 5m');
  await expect.poll(()=>page.evaluate(()=>chartD1Meta.interval)).toBe('5m');
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('chart mobile horizontal overflow');
  await page.screenshot({path:path.join(OUT,'chart-390.png'),fullPage:true});
  results.push({id:'UI-CHART-CLEAN-MOBILE',status:'PASS',flow:'390×844 行情 → 切换5m → 周期状态一致、无横向溢出'});
  await page.setViewportSize({width:1440,height:1000});
  failKlines=true;
  await page.getByRole('button',{name:'1h',exact:true}).click();
  await expect(page.locator('#chart-status')).toContainText('加载失败:');
  await expect(page.locator('#chart-status')).toContainText('503');
  if(consoleErrors.some(message=>!message.includes('503')&&!message.includes('加载图表数据失败')))throw Error('unexpected failure console '+consoleErrors.join(';'));
  results.push({id:'UI-CHART-03',status:'PASS',flow:'服务 503 → 页面显示失败，未伪造历史行情'});
  failKlines=false;
  await page.getByRole('button',{name:'4h',exact:true}).click();
  await expect(page.locator('#chart-status')).toContainText('BTCUSDT · 4h');
  await expect.poll(()=>page.evaluate(()=>chartD1Meta && chartD1Meta.interval)).toBe('4h');
  results.push({id:'UI-CHART-04',status:'PASS',flow:'服务恢复 → 切换周期 → 重新显示行情'});
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
