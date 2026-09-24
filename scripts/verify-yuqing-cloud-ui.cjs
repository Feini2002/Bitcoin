// Run via run-bounded.cjs. Local Vite + fixed API fixtures; no live API writes.
const fs=require('node:fs'),path=require('node:path');
const {chromium,expect}=require('playwright/test');
const ROOT=path.join(__dirname,'..'),OUT=path.join(ROOT,'.artifacts','cloud-only');
let browser,server,page;const results=[];
const NOW='2026-09-16T02:00:00.000Z';
function report(kind){return {id:'fixture-'+kind,kind,reportDate:'2026-09-16',slot:kind==='daily_event'?'08':'09',triggerType:'manual',generatedAt:NOW,status:'ready',sourceRefs:[],grounding:{generator:'codex_cli_bridge'},marketSnapshot:{},sourceErrors:[],report:{title:kind==='daily_event'?'云端日报验收':'云端分析验收',marketTemperature:{score:50,label:'中性'},topStories:[],dynamicBriefs:[],aiIntel:[],githubTools:[],trendRead:{summary:'固定测试报告'},marketState:{},riskRadar:[],opportunities:[]}}}
async function main(){
 fs.mkdirSync(OUT,{recursive:true});
 const {createServer}=await import('vite');server=await createServer({configFile:path.join(ROOT,'vite.config.mjs'),server:{open:false,host:'127.0.0.1',port:5189,strictPort:true}});await server.listen();const origin='http://127.0.0.1:'+server.httpServer.address().port;
 browser=await chromium.launch({headless:true,...(process.env.BITDESK_TEST_BROWSER ? {channel:process.env.BITDESK_TEST_BROWSER} : {})});console.log(JSON.stringify({pid:process.pid,origin,browser:browser.version()}));
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  const context=await browser.newContext({viewport,deviceScaleFactor:1,locale:'zh-CN',timezoneId:'Asia/Shanghai',colorScheme:'light',reducedMotion:'reduce'});context.setDefaultTimeout(8000);
  let modelPuts=0,generations=0,streams=0;const forbidden=[],errors=[];
  await context.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());if(req.url().startsWith(origin+'/'))return route.continue();
   if(/execution-channels|\/codex\//.test(url.pathname))forbidden.push(url.pathname);
   if(req.resourceType()==='script')return route.fulfill({contentType:'text/javascript',body:''});
   let body={ok:true,d1Ready:true};
   if(url.pathname.endsWith('/settings/model-channels')||url.pathname.endsWith('/reports/generate')||url.pathname.endsWith('/reports/generate-stream')){forbidden.push(url.pathname);return route.fulfill({status:410,contentType:'application/json',body:JSON.stringify({ok:false})});
   }else if(url.pathname.endsWith('/reports/latest')||url.pathname.endsWith('/reports/item')){body.report=report(url.searchParams.get('kind')||'daily_event');if(body.report.kind==='sentiment_analysis'&&generations){body.report.id='generated-analysis';body.report.report.title='本轮云端分析验收'}
   }else if(url.pathname.endsWith('/reports/history')){const row=report(url.searchParams.get('kind')||'daily_event');body.items=[{...row,title:row.report.title}];
   }else if(url.pathname.includes('/settings/')){body.settings={};
   }else if(url.pathname.includes('/api/d1/status')){body={...body,supportedIntervals:[],counts:[]};}
   return route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
  });
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});await page.clock.install({time:new Date(NOW)});
  await page.goto(origin+'/index.html#/settings');await expect(page.getByRole('heading',{name:'K 线与云端 D1',exact:true})).toBeVisible();await expect(page.locator('#settings-model-panel')).toHaveCount(0);await expect(page.locator('#settings-schedule-panel')).toHaveCount(0);await page.screenshot({path:path.join(OUT,'settings-'+viewport.width+'.png'),fullPage:true});results.push({id:'UI-RETIRE-01',viewport,status:'PASS'});
  await page.goto(origin+'/index.html#/news');await expect(page.locator('#daily-report-content')).toBeVisible();await expect(page.locator('#daily-scan-preview')).toHaveCount(0);await page.getByRole('button',{name:'历史报告与费用',exact:false}).first().click();await expect(page.locator('#daily-archive-drawer')).toBeVisible();results.push({id:'UI-RETIRE-02',viewport,status:'PASS'});
  await page.goto(origin+'/index.html#/news-analysis');await expect(page.locator('#news-generate-preview')).toHaveCount(0);await page.getByRole('button',{name:'历史报告与费用',exact:false}).first().click();await expect(page.getByText('云端分析验收',{exact:true}).last()).toBeVisible();results.push({id:'UI-RETIRE-03',viewport,status:'PASS'});
  expect(modelPuts+generations+streams).toBe(0);
  expect(forbidden).toEqual([]);expect(errors).toEqual([]);await expect(page.locator('vite-error-overlay')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  console.log('PASS cloud UI '+viewport.width);await context.close();
 }
}
main().catch(async error=>{console.error('FAIL',error);results.push({status:'FAIL',error:String(error)});if(page&&!page.isClosed())await page.screenshot({path:path.join(OUT,'failure.png'),fullPage:true}).catch(()=>{});process.exitCode=1}).finally(async()=>{if(browser)await browser.close();if(server)await server.close();fs.writeFileSync(path.join(OUT,'results.json'),JSON.stringify(results,null,2));console.log('UI results '+JSON.stringify(results))});
