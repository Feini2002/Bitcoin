/* Synthetic legacy report UI replay: real app, no model/remote writes. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,expect}=require('playwright/test');
const origin='http://127.0.0.1:5173',out=path.resolve('.artifacts/legacy-event-ui/run-'+new Date().toISOString().replace(/[:.]/g,'-'));
const item={id:17,title:'合成历史条目：待复核',fact:'此内容仅为接口和身份测试，不能作为市场事实。',occurredAt:'2026-09-23',sourceUrl:'https://example.com/source'};
const row={id:'synthetic-legacy-report',kind:'daily_event',generatedAt:'2026-09-23T04:00:00.000Z',report:{title:'合成旧格式日报',topStories:[item,{title:'另一条目',fact:'不得替换所选条目'}],sources:[]}};
let browser,server;const result={status:'RUNNING',pid:process.pid,scope:'synthetic UI replay only',cases:[]};
async function main(){
 fs.mkdirSync(out,{recursive:true});server=await chromium.launchServer({headless:true});result.browserPid=server.process().pid;browser=await chromium.connect(server.wsEndpoint());console.log(JSON.stringify({pid:process.pid,browserPid:result.browserPid,deadline:'external 120s process-tree supervisor'}));
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:900},locale:'zh-CN'}),page=await context.newPage(),errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  await context.route('**/*',route=>{const r=route.request(),u=new URL(r.url());if(r.method()!=='GET'&&!(u.origin===origin&&u.pathname==='/api/local-agent-team/presence')){writes.push(u.href);return route.abort();}if(u.pathname.startsWith('/api/yuqing/reports/'))return route.fulfill({json:u.pathname.endsWith('/history')?{items:[{id:row.id,title:row.report.title,generatedAt:row.generatedAt}]}:{report:row}});return route.continue();});
  await page.goto(origin+'/#/news',{waitUntil:'domcontentloaded'});await expect(page.locator('[data-study-legacy]')).toHaveCount(2);await page.locator('.rd-saved-history>summary').click();await expect(page.locator('#rd-content')).toContainText('历史原文 · 待复核');await page.locator('[data-study-legacy="topStories:0"]').click();
  const selection=await page.evaluate(async()=>{const {agentTaskRequest}=await import('/js/research-v2/desk-adapter.mjs');const s=UserWorkspace.read(),body=agentTaskRequest(s,'复核所选历史条目');return {material:s.material,body,hash:BitContentIdentity.contentId(s.material.originalReport)};});
  assert.deepEqual(selection.material.event,item);assert.deepEqual(selection.material.originalReport,row);assert.equal(selection.body.taskMode,'narrative');assert.equal(selection.body.providedMaterials[0].id,'legacy:topStories:0');assert.equal(selection.material.reportAsOf,null);assert.equal(selection.material.publicAvailableAt,null);assert.equal(selection.material.reportContentId,selection.hash);assert.equal(selection.body.providedMaterials[0].parentReportId,row.id);
  const large=await page.evaluate(async()=>{const {agentTaskRequest}=await import('/js/research-v2/desk-adapter.mjs'),s=UserWorkspace.read();s.material.originalReport.report.extra='x'.repeat(70000);s.material.reportContentId=BitContentIdentity.contentId(s.material.originalReport);try{agentTaskRequest(s,'核查');return 'unexpected';}catch(e){return e.message;}});assert.match(large,/64KiB/);assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  await expect(page.locator('#at-task-question')).toBeVisible();await page.screenshot({path:path.join(out,'legacy-task-'+width+'.png'),fullPage:true});result.cases.push({width,status:'PASS',identity:'exact original item/report; no synthetic asOf; oversize rejected'});await context.close();
 }
 result.status='PASS';console.log('PASS legacy-event-ui exact selection, report identity, unknown clocks, oversize and no writes');
}
main().catch(e=>{result.status='FAIL';result.error=e.stack;console.error(e.stack);process.exitCode=1;}).finally(async()=>{await browser?.close();await server?.close();result.completedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));});
