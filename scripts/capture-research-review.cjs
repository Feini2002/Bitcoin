'use strict';
const fs=require('node:fs');const path=require('node:path');const {chromium}=require('playwright');
const OUT=path.join(__dirname,'../.artifacts/redesign');let browser;
async function main(){
  fs.mkdirSync(OUT,{recursive:true});browser=await chromium.launch({headless:true});const records=[];
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
    const context=await browser.newContext({viewport,locale:'zh-CN',timezoneId:'Asia/Shanghai',reducedMotion:'reduce'});
    const page=await context.newPage();page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const origin=process.env.BITDESK_REVIEW_ORIGIN||'http://127.0.0.1:5173';
    await page.goto(origin+'/#/overview',{waitUntil:'domcontentloaded',timeout:20000});
    const routes=process.env.BITDESK_REVIEW_ROUTES ? process.env.BITDESK_REVIEW_ROUTES.split(',') : await page.evaluate(()=>Object.keys(ROUTES));
    const prefix=process.env.BITDESK_REVIEW_PREFIX||'page';
    for(const route of routes){
      let state='rendered';await page.evaluate(r=>location.hash='#/'+r,route);
      await page.waitForFunction(r=>resolveRoute()===r&&document.querySelector('#outlet')?.innerText.length>25,route);
      try{
        if(route==='overview')await page.waitForFunction(()=>!document.querySelector('#rd-home-feedback')?.textContent.includes('此处为读取时'),null,{timeout:20000});
        if(route==='news'||route==='news-analysis')await page.waitForFunction(()=>document.querySelector('#rd-feedback')?.textContent&&!document.querySelector('#rd-feedback').textContent.includes('正在读取'),null,{timeout:15000});
        if(route==='chart')await page.waitForFunction(()=>document.querySelector('#chart-research-evidence')?.textContent.includes('返回')||document.querySelector('#chart-research-evidence')?.textContent.includes('失败'),null,{timeout:15000});
        if(route==='orderflow')await page.waitForFunction(()=>!/准备|(?:^|\s)0 bars|读取超时/.test(document.querySelector('#of-status')?.textContent||'准备'),null,{timeout:40000});
        if(route==='heatmap')await page.waitForFunction(()=>!/等待|准备/.test(document.querySelector('#hm-status')?.textContent||'准备'),null,{timeout:15000});
        if(route==='derivatives')await page.waitForFunction(()=>document.querySelectorAll('#deriv-freq-groups .desk-clock-card').length>0||document.querySelector('#deriv-read-failure')?.hidden===false,null,{timeout:15000});
      }catch(_){state='read-wait-expired';}
      const demo=page.getByTestId('demo-preview');if(await demo.count())await demo.locator('summary').click();
      const file=prefix+'-'+route+'-'+viewport.width+'.png';await page.screenshot({path:path.join(OUT,file),fullPage:true,timeout:10000});
      if(route==='heatmap'&&await page.locator('.heatmap-venue-block').count()){
        await page.locator('.heatmap-venue-block').first().scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(OUT,prefix+'-heatmap-buckets-'+viewport.width+'.png'),fullPage:true,timeout:10000});
      }
      const facts=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth+1,text:document.querySelector('#outlet').innerText.slice(0,2200)}));
      records.push({route,width:viewport.width,state,...facts,errors:[...errors],file});errors.length=0;console.log(JSON.stringify({route,width:viewport.width,state,overflow:facts.overflow}));
    }
    await context.close();
  }
  fs.writeFileSync(path.join(OUT,(process.env.BITDESK_REVIEW_PREFIX||'page')+'-review.json'),JSON.stringify(records,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>browser?.close());
