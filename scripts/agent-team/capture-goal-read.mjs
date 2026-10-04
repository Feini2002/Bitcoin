// Read the actual development app. Screenshots and behavior are separate evidence.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {chromium} from 'playwright';
const label=process.argv[2]||'baseline';assert.match(label,/^[a-z0-9-]{1,60}$/);
const directory=path.resolve('.artifacts/goal-20261003/read-'+label),origin='http://127.0.0.1:5173';
if(fs.existsSync(path.join(directory,'result.json')))throw Error('evidence_directory_already_used');fs.mkdirSync(directory,{recursive:true});
const deadline=Date.now()+240000,result={label,status:'RUNNING',pid:process.pid,startedAt:new Date().toISOString(),deadline:new Date(deadline).toISOString(),scope:'actual public data and saved accepted reports; no new model or remote writes',cases:[],responses:[],errors:[],blockedWrites:[]};
let browser,server,page,closing=false;
function save(){fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2));}
async function close(){if(closing)return;closing=true;await Promise.allSettled([browser?.close(),server?.close()]);}
const timer=setTimeout(()=>{result.status='FAIL';result.error='internal_deadline';save();void close();},240000);
try{
  server=await chromium.launchServer({headless:true});result.browserPid=server.process().pid;browser=await chromium.connect(server.wsEndpoint());
  const context=await browser.newContext({locale:'zh-CN',timezoneId:'Asia/Shanghai',reducedMotion:'reduce',serviceWorkers:'block'});page=await context.newPage();page.setDefaultTimeout(20000);
  page.on('pageerror',e=>result.errors.push(e.message));page.on('response',async r=>{const url=new URL(r.url());if(!url.pathname.startsWith('/api/desk/'))return;try{const text=await r.text(),body=JSON.parse(text);result.responses.push({url:r.url(),status:r.status(),receivedAt:new Date().toISOString(),scope:body.scope,datasetId:body.datasetId,instrumentId:body.instrumentId,rows:body.series?.length,hash:crypto.createHash('sha256').update(text).digest('hex'),coverage:body.coverage});}catch{}});
  await context.route('**/*',route=>{const q=route.request(),u=new URL(q.url());if(!['GET','HEAD'].includes(q.method())&&!(u.origin===origin&&u.pathname==='/api/local-agent-team/presence')){result.blockedWrites.push({url:u.href,method:q.method()});return route.fulfill({status:405,json:{error:'read_acceptance_forbids_writes'}});}return route.continue();});
  console.log(JSON.stringify({pid:process.pid,browserPid:result.browserPid,deadline:result.deadline,scope:result.scope}));
  for(const [device,viewport]of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
    await page.setViewportSize(viewport);
    for(const view of ['chart','orderflow','heatmap','leverage','macro']){
      if(Date.now()>=deadline)throw Error('internal_deadline');const row={device,view,status:'RUNNING',startedAt:new Date().toISOString()};result.cases.push(row);
      try{
        await page.goto(origin+'/#/market?view='+view,{waitUntil:'domcontentloaded',timeout:30000});
        if(view==='chart')await page.waitForFunction(()=>typeof chartOhlcv!=='undefined'&&chartOhlcv.length>0);
        if(view==='orderflow')await page.waitForFunction(()=>typeof orderflowCanvasMeta!=='undefined'&&orderflowCanvasMeta?.visibleBars>0);
        if(view==='heatmap')await page.locator('.heatmap-venue-block').first().waitFor({state:'visible'});
        if(view==='leverage')await page.locator('#deriv-contract-cards article').first().waitFor({state:'visible'});
        if(view==='macro')await page.locator('#deriv-freq-groups article').first().waitFor({state:'visible'});
        row.behavior=await page.evaluate(()=>({view:document.querySelector('[data-market-view]')?.dataset.marketView,heading:document.querySelector('#outlet h1')?.textContent,viewport:innerWidth,documentWidth:document.documentElement.scrollWidth,outletWidth:document.querySelector('#outlet')?.clientWidth,outletScrollWidth:document.querySelector('#outlet')?.scrollWidth}));
        assert.equal(row.behavior.view,view);assert.ok(row.behavior.documentWidth<=row.behavior.viewport+2&&row.behavior.outletScrollWidth<=row.behavior.outletWidth+2,'horizontal_overflow');
        await page.evaluate(()=>{document.querySelector('#outlet').scrollTop=0;});row.screenshot=path.join(directory,device+'-'+view+'.png');await page.screenshot({path:row.screenshot,fullPage:true,timeout:15000});
        const target={chart:'#chart-container',orderflow:'#of-footprint-canvas',heatmap:'.heatmap-venue-block',leverage:'#deriv-contract-cards',macro:'[data-deriv-card="fred-dgs10"]'}[view];await page.locator(target).first().scrollIntoViewIfNeeded();row.focusScreenshot=path.join(directory,device+'-'+view+'-focus.png');await page.screenshot({path:row.focusScreenshot,fullPage:false,timeout:15000});
        row.status='PASS';console.log('PASS '+device+' '+view);
      }catch(e){row.status='FAIL';row.error=e.message;try{row.screenshot=path.join(directory,device+'-'+view+'-FAIL.png');await page.screenshot({path:row.screenshot,fullPage:true});}catch{}console.error('FAIL '+device+' '+view+' '+e.message);}finally{row.completedAt=new Date().toISOString();save();}
    }
  }
  assert.deepEqual(result.errors,[],'runtime_errors');assert.deepEqual(result.blockedWrites,[],'unexpected writes');assert.ok(result.cases.every(r=>r.status==='PASS'),'reading_behavior_failed');result.status='PASS';
}catch(e){result.status='FAIL';result.error=e.message;process.exitCode=1;}
finally{clearTimeout(timer);await close();result.completedAt=new Date().toISOString();save();console.log(JSON.stringify({status:result.status,cases:result.cases.map(r=>({device:r.device,view:r.view,status:r.status,error:r.error})),error:result.error}));}
