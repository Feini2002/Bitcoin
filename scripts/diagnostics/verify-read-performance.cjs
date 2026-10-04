// Live acceptance; no API mocks. Run with scripts/run-bounded.cjs (90 seconds).
// Argument: local or deployed site root. Timing samples are observations, not SLAs.
const { chromium, expect } = require('playwright/test');
const fs = require('node:fs');
const path = require('node:path');
let browser;
(async () => {
  const origin = process.argv[2] || 'http://127.0.0.1:5173/';
  const out = path.resolve('.artifacts/read-performance');
  fs.mkdirSync(out, { recursive: true });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  await page.addInitScript(() => {
    localStorage.setItem('bitdesk.workbench.chartInterval', '4h');
    localStorage.setItem('bitdesk.workbench.mtf', JSON.stringify({open:true,tfs:['1h','4h','1d','1w']}));
  });
  const requests=[], errors=[], results=[];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/desk/')) return;
    requests.push({ request, started:Date.now(), path:url.pathname+url.search });
  });
  page.on('requestfinished', request => {
    const row=requests.find(row=>row.request===request);if(row)row.ms=Date.now()-row.started;
  });
  page.on('requestfailed', request => {
    const row=requests.find(row=>row.request===request);if(row){row.ms=Date.now()-row.started;row.error=request.failure()?.errorText;}
  });
  const chartReady = interval => page.waitForFunction(tf =>
    typeof chartCommittedIdentity !== 'undefined' && chartCommittedIdentity?.interval === tf
    && chartOhlcv.length === 6000 && !document.querySelector('.chart-desk.halted'), interval, { timeout:25000 });
  const tilesReady = () => page.waitForFunction(() => [0,1,2,3].every(i =>
    /已加载 [1-9]\d* 根/.test(document.getElementById('mtf-hint-'+i)?.textContent || '')
    && !/加载中|失败/.test(document.getElementById('mtf-hint-'+i)?.textContent || '')), null, {timeout:25000});
  let at=Date.now();await page.goto(new URL('#/chart',origin).href);await chartReady('4h');
  results.push({action:'cold 4h',ms:Date.now()-at});await tilesReady();
  results.push({action:'all initial tiles ready',ms:Date.now()-at});
  await page.locator('#nav a[href="#/settings"]').click();
  await expect(page.locator('#chart-container')).toHaveCount(0);
  const beforeReturn=requests.length;
  at=Date.now();await page.locator('#nav a[href="#/chart"]').click();await chartReady('4h');
  results.push({action:'return 4h',ms:Date.now()-at});await tilesReady();
  results.push({action:'all returned tiles ready',ms:Date.now()-at,
    fullWindows:requests.slice(beforeReturn).filter(row=>row.path.startsWith('/api/desk/chart?')&&!/[?&](tail|from)=/.test(row.path)).length});
  for (const interval of ['15m','5m','4h']) {
    at=Date.now();await page.getByRole('button',{name:interval,exact:true}).click();await chartReady(interval);
    results.push({action:'switch '+interval,ms:Date.now()-at});
  }
  await page.screenshot({path:path.join(out,'chart.png')});
  if(errors.length)throw Error(errors.join(';'));
  const report={at:new Date().toISOString(),origin,results,errors,requests:requests.map(({request,...row})=>row)};
  fs.writeFileSync(path.join(out,'live.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({result:'PASS',...report,requests:undefined},null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(async()=>browser?.close());
