const fs=require('node:fs');const path=require('node:path');const {chromium,expect}=require('playwright/test');
let browser;
async function main(){
  browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/index.html#/boardroom',{waitUntil:'domcontentloaded',timeout:20000});
  await expect(page.getByRole('heading',{name:'研究室',exact:true})).toBeVisible({timeout:15000});
  await expect(page.locator('#team-provider')).toContainText('登录可用',{timeout:20000});
  await page.locator('#team-import').setInputFiles(path.resolve(process.argv[2]||'.artifacts/acceptance-20261002/real-input-v2/session.json'));
  await expect(page.locator('#team-feedback')).toContainText('已打开固定研究记录',{timeout:20000});
  await page.screenshot({path:path.resolve('.artifacts/acceptance-20261002/live-research-before.png'),fullPage:true});
  await page.locator('#team-run').click();
  await expect(page.locator('#team-feedback')).toContainText('Codex 研究已启动',{timeout:30000});
  const run=await page.evaluate(async()=>{const data=await(await fetch('/api/local-research/status')).json();return data.activeRunId;});
  if(!run)throw Error('missing_active_run');
  const receipt={at:new Date().toISOString(),runId:run,entry:'boardroom',actions:['open local research room','verify ChatGPT auth','import frozen real input','start Codex research'],errors,screenshot:'live-research-started.png'};
  await page.screenshot({path:path.resolve('.artifacts/acceptance-20261002/live-research-started.png'),fullPage:true});
  fs.writeFileSync('.artifacts/acceptance-20261002/live-research-start.json',JSON.stringify(receipt,null,2));
  fs.writeFileSync('.artifacts/acceptance-20261002/live-start-'+run+'.json',JSON.stringify(receipt,null,2));
  if(errors.length)throw Error(errors.join('; '));console.log(JSON.stringify(receipt));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{await browser?.close();});
