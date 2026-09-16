// Local server acceptance; only synthetic configuration values are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, expect } = require('playwright/test');
let server, browser;
let fixture;
async function main() {
  process.env.BIT_DATA_API_BASE = 'https://fixture.invalid/btc';
  process.env.BIT_YUQING_API_BASE = 'https://fixture.invalid/yuqing';
  const fixturePath = path.resolve(__dirname,'..',`.env.verify-${process.pid}`);
  fs.writeFileSync(fixturePath,'BITDESK_TEST_SENTINEL=synthetic-value\n',{flag:'wx'});
  fixture = fixturePath;
  const { createServer } = await import('vite');
  server = await createServer({ server: { host:'127.0.0.1', port:0, open:false } });
  await server.listen();
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  const html = await (await fetch(origin)).text();
  assert(!html.includes('GEMINI_API_KEY'));
  assert(html.includes('js/app.js'));
  console.log('PASS DEV-01 local HTML contains application assets and public config only');
  for (const name of [path.basename(fixture), ...(fs.existsSync(path.resolve(__dirname,'..','.env')) ? ['.env'] : [])]) {
    const blocked = await fetch(origin + '/' + name);
    assert([403,404].includes(blocked.status));
    await blocked.body?.cancel();
  }
  console.log('PASS DEV-02 local environment file is not served');
  browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{width:1440,height:1000}, locale:'zh-CN', timezoneId:'Asia/Shanghai' });
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',e=>{if(e.type()==='error') errors.push(e.text());});
  await page.route('**/*', route => route.request().url().startsWith(origin + '/')
    ? route.continue()
    : route.fulfill({status:200,contentType:route.request().resourceType()==='script'?'text/javascript':'application/json',body:route.request().resourceType()==='script'?'':'{}'}));
  await page.goto(origin + '/index.html#/overview');
  await expect(page).toHaveTitle('Bit 交易决策平台');
  await expect(page.getByRole('heading',{name:'功能清单',exact:true})).toBeVisible();
  assert.deepEqual(await page.evaluate(()=>[window.getBitDataApiBase(),window.getYuqingApiBase()]),[process.env.BIT_DATA_API_BASE,process.env.BIT_YUQING_API_BASE]);
  assert.equal(await page.locator('vite-error-overlay').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS DEV-03 browser uses both configured API origins without runtime errors');
  console.log('Local development: 3 PASS / 0 FAIL; Chromium '+browser.version());
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{try {await browser?.close();await server?.close();} finally {if(fixture)fs.unlinkSync(fixture);}});
