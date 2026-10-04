// Local server acceptance; only synthetic configuration values are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, expect } = require('playwright/test');
let server, browser;
const fixtures=[];
async function main() {
  process.env.BIT_DATA_API_BASE = 'https://fixture.invalid/btc';
  process.env.BIT_YUQING_API_BASE = 'https://fixture.invalid/yuqing';
  const root = path.resolve(__dirname,'../..');
  const privateFixtures = [`.env.verify-${process.pid}`,`.local/private-verify-${process.pid}.txt`,`.local/migration/BitDesk-PRIVATE-verify-${process.pid}.zip`];
  for (const name of privateFixtures) {
    const fixturePath = path.resolve(root,name);
    fs.mkdirSync(path.dirname(fixturePath),{recursive:true});
    fs.writeFileSync(fixturePath,'BITDESK_TEST_SENTINEL=synthetic-value\n',{flag:'wx'});
    fixtures.push(fixturePath);
  }
  const { createServer } = await import('vite');
  server = await createServer({ server: { host:'127.0.0.1', port:0, open:false } });
  await server.listen();
  const origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  const html = await (await fetch(origin)).text();
  assert(!html.includes('GEMINI_API_KEY'));
  assert(html.includes('js/app.js'));
  for (const [asset,type] of [['assets/css/styles.css','text/css'],['assets/css/desk-ui.css','text/css'],['assets/icons/btc.svg','image/svg+xml']]) {
    const response = await fetch(origin + '/' + asset,{headers:{Accept:type}});
    assert.equal(response.status,200,`${asset} must load`);
    assert(response.headers.get('content-type')?.includes(type),`${asset} has the wrong content type`);
    await response.body?.cancel();
  }
  console.log('PASS DEV-01 local HTML contains application assets and public config only');
  for (const name of privateFixtures) {
    for (const url of [origin + '/' + name,origin + '/@fs/' + path.resolve(root,name).replace(/\\/g,'/')]) {
      const blocked = await fetch(url);
      assert([403,404].includes(blocked.status),`${name} must not be served (HTTP ${blocked.status})`);
      await blocked.body?.cancel();
    }
  }
  // Existing private files are checked with HEAD; their contents are never read.
  for (const name of ['.env','.codex/ssh/bitdesk_egress_ed25519','.local/migration/BitDesk-PRIVATE-2026-09-30.zip']) {
    if (!fs.existsSync(path.resolve(root,name))) continue;
    const blocked = await fetch(origin + '/' + name,{method:'HEAD'});
    assert([403,404].includes(blocked.status),`${name} must not be served (HTTP ${blocked.status})`);
  }
  console.log('PASS DEV-02 local environment, private records and migration archives are not served');
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
  await expect(page.getByRole('heading',{name:'研究总览',exact:true})).toBeVisible();
  assert.deepEqual(await page.evaluate(()=>[window.getBitDataApiBase(),window.getYuqingApiBase()]),[process.env.BIT_DATA_API_BASE,process.env.BIT_YUQING_API_BASE]);
  assert.equal(await page.locator('vite-error-overlay').count(),0);
  assert.deepEqual(errors,[]);
  console.log('PASS DEV-03 browser uses both configured API origins without runtime errors');
  console.log('Local development: 3 PASS / 0 FAIL; Chromium '+browser.version());
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{try {await browser?.close();await server?.close();} finally {for(const fixture of fixtures)fs.unlinkSync(fixture);}});
