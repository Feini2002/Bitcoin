// Uses a completed real CLI session and real native reports. Never starts a model or writes remotely.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium,expect:baseExpect}=require('playwright/test');
const expect=baseExpect.configure({timeout:25000});
const ROOT=path.resolve(__dirname,'../..'),OUT=path.join(ROOT,'.artifacts/acceptance-20261002/final-research-ui-round4');
const runId='76780cf7-dc2e-4a81-9874-770c90c957f1',origin='http://127.0.0.1:5173';
const sessionFile=path.join(ROOT,'.artifacts/acceptance-20261002/real-cli-complete/session.json');
const original=JSON.parse(fs.readFileSync(sessionFile));
const captured=JSON.parse(fs.readFileSync(path.join(ROOT,'.artifacts/acceptance-20261002/real-input-v4/snapshot.json')));
const nativeDir=path.join(ROOT,'.artifacts/acceptance-20261002/formal-reports');
const receipt={schema:'bitdesk.local-research-ui.v1',startedAt:new Date().toISOString(),pid:process.pid,deadline:new Date(Date.now()+210000).toISOString(),runId,cases:[],screenshots:[],runtime:[],blockedWrites:[],status:'RUNNING'};
let server,browser,watchdog;
function save(){fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(receipt,null,2));}
async function cleanup(){await Promise.allSettled([browser?.close(),server?.close()]);}
async function shot(page,name,selector){if(selector)await page.locator(selector).first().scrollIntoViewIfNeeded();const file=path.join(OUT,name+'.png');await page.screenshot({path:file,fullPage:false,timeout:15000});receipt.screenshots.push(file);return file;}
async function download(page,selector,name){const pending=page.waitForEvent('download',{timeout:15000});await page.locator(selector).click();const d=await pending,file=path.join(OUT,name+'.json');await d.saveAs(file);return JSON.parse(fs.readFileSync(file));}
async function check(name,action){const test={name,startedAt:new Date().toISOString(),status:'RUNNING'};receipt.cases.push(test);try{test.evidence=await action();test.status='PASS';console.log('PASS '+name);}catch(error){test.status='FAIL';test.error=error.stack;throw error;}finally{test.completedAt=new Date().toISOString();save();}}
async function main(){
  save();watchdog=setTimeout(async()=>{receipt.status='FAIL';receipt.error='internal 210-second deadline';save();const force=setTimeout(()=>{server?.kill();process.exit(1);},5000);await cleanup();clearTimeout(force);process.exit(1);},210000);
  assert.equal(original.run.status,'complete');assert.equal(original.run.mode,'codex_cli');
  server=await chromium.launchServer({headless:true});receipt.browserPid=server.process().pid;browser=await chromium.connect(server.wsEndpoint());save();
  console.log(JSON.stringify({pid:process.pid,browserPid:receipt.browserPid,deadline:receipt.deadline,origin}));
  const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai',acceptDownloads:true,serviceWorkers:'block'});
  await context.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    if(!['GET','HEAD'].includes(request.method())){receipt.blockedWrites.push({url:url.href,method:request.method()});return route.fulfill({status:405,json:{error:'Final acceptance does not execute models or writes'}});}
    if(url.origin===origin)return route.continue();
    if(url.pathname.startsWith('/api/yuqing/reports/')){const scope=url.searchParams.get('kind')==='sentiment_analysis'?'analysis':'events',artifact=captured.artifacts.find(a=>a.scope===scope);return route.fulfill({status:200,contentType:'application/json',body:artifact.body});}
    if(url.hostname==='unpkg.com'&&url.pathname.includes('lightweight-charts'))return route.fulfill({status:200,contentType:'text/javascript',body:fs.readFileSync(path.join(ROOT,'.artifacts/pages-artifact/lightweight-charts-4.1.3.js'),'utf8')});
    if(url.hostname==='unpkg.com')return route.fulfill({status:200,contentType:'text/javascript',body:''});
    return route.abort();
  });
  const page=await context.newPage();page.setDefaultTimeout(25000);page.on('pageerror',e=>receipt.runtime.push(e.message));
  await check('real-cli-history-open',async()=>{
    await page.goto(origin+'/index.html#/boardroom',{waitUntil:'domcontentloaded',timeout:20000});await expect(page.locator('#team-provider')).toContainText('登录可用');
    await page.locator('[data-run="'+runId+'"]').click();await expect(page.locator('#team-progress')).toHaveAttribute('data-status','complete');
    await expect(page.locator('#team-result-review')).toContainText('综合语义审核已接收');await expect(page.locator('#team-result')).toContainText(original.run.tasks.find(t=>t.stage==='synthesis').receipt.output.summary);
    await expect(page.locator('#team-retry')).toBeDisabled();await shot(page,'completed-cli-conclusion','#team-result-clock');
    for(const task of original.run.tasks){await page.locator('[data-role="'+task.role+'"]').click();await expect(page.locator('#team-detail')).toContainText(task.receipt.output.summary);await expect(page.locator('#team-detail')).toContainText(task.receipt.provenance.threadId);}
    return {accepted:original.run.tasks.length,auth:'ChatGPT',synthesisReview:'real independent accept',qualification:'Model review is not source/PIT/forecast-skill verification.'};
  });
  await check('real-cli-export-reload-restore',async()=>{
    const exported=await download(page,'#team-export','complete-original');assert.deepEqual(exported,original);await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('#team-import').setInputFiles(path.join(OUT,'complete-original.json'));await expect(page.locator('#team-progress')).toHaveAttribute('data-status','complete');
    assert.deepEqual(await download(page,'#team-export','complete-restored'),original);await shot(page,'complete-restored','#team-result-clock');
    return {unchanged:true,sha256:crypto.createHash('sha256').update(JSON.stringify(exported)).digest('hex')};
  });
  for(const [kind,route,file]of [['daily_event','news','daily-event-20261002.json'],['sentiment_analysis','news-analysis','sentiment-20261002.json']]){
    const native=JSON.parse(fs.readFileSync(path.join(nativeDir,file)));
    await check('formal-'+kind+'-local-save-reopen',async()=>{
      await page.goto(origin+'/index.html#/'+route,{waitUntil:'domcontentloaded'});await expect(page.locator('[data-action="preview"]')).toBeVisible();
      await page.locator('[data-action="preview"]').click();
      if(kind==='daily_event')await page.locator('#rd-file').setInputFiles(path.join(nativeDir,file));
      else {await page.getByLabel('报告 JSON 内容').fill('{}');await page.locator('[data-action="preview-json"]').click();await expect(page.locator('#rd-preview-errors')).toContainText('kind');await expect(page.locator('#rd-dialog')).toBeVisible();await page.getByLabel('报告 JSON 内容').fill(JSON.stringify(native));await page.locator('[data-action="preview-json"]').click();}
      await expect(page.locator('#rd-feedback')).toContainText('本地预览');
      await expect(page.locator('#rd-content')).toContainText(native.report.title);assert.deepEqual(await download(page,'[data-action="export"]',kind+'-preview'),native);
      await page.locator('[data-action="save-local"]').click();await expect(page.locator('#rd-feedback')).toContainText('已保存到本地研究记录');
      await expect(page.locator('#rd-report-select option:checked')).toContainText('本地');const localId=await page.locator('#rd-report-select').inputValue();assert.match(localId,/^local:sha256:[a-f0-9]{64}$/);
      await page.reload({waitUntil:'domcontentloaded'});await expect(page.locator('#rd-feedback')).toContainText('已载入本地研究记录');
      assert.deepEqual(await download(page,'[data-action="export"]',kind+'-reopened'),native);await expect(page.locator('#rd-content')).toContainText(native.report.limitations[0]);
      await expect(page.locator('[data-action="save-local"]')).toBeDisabled();await shot(page,kind+'-saved','#rd-content');await shot(page,kind+'-conditions','#rd-watch');
      return {reportId:native.id,parent:native.report.parentReportId,localId,unchanged:true,generatedAt:native.generatedAt,asOf:native.report.asOf,source:'actual codex_native report from frozen material; browser local storage only'};
    });
  }
  await check('formal-sentiment-local-parent-navigation',async()=>{
    const daily=JSON.parse(fs.readFileSync(path.join(nativeDir,'daily-event-20261002.json')));
    await expect(page.locator('.rd-parent a')).toContainText(daily.id);await expect(page.locator('.rd-parent a')).toHaveAttribute('href',/#\/news\?reportId=local%3Asha256%3A[a-f0-9]{64}$/);
    await page.locator('.rd-parent a').click();await expect(page.locator('#rd-feedback')).toContainText('已载入本地研究记录');assert.deepEqual(await download(page,'[data-action="export"]','local-parent-original'),daily);
    return {parentReportId:daily.id,localNavigation:true,originalUnchanged:true};
  });
  await check('synthetic-same-id-revision-rejected-original-preserved',async()=>{
    const daily=JSON.parse(fs.readFileSync(path.join(nativeDir,'daily-event-20261002.json'))),edited=structuredClone(daily);edited.report.title+=' [synthetic conflict fixture]';
    const before=await page.evaluate(()=>localStorage.getItem('bitdesk-local-reports-daily_event'));
    await page.locator('[data-action="preview"]').click();await page.getByLabel('报告 JSON 内容').fill(JSON.stringify(edited));await page.locator('[data-action="preview-json"]').click();await expect(page.locator('#rd-feedback')).toContainText('本地预览');
    await page.locator('[data-action="save-local"]').click();await expect(page.locator('#rd-feedback')).toContainText('请使用新报告ID保存修订');
    assert.equal(await page.evaluate(()=>localStorage.getItem('bitdesk-local-reports-daily_event')),before);assert.deepEqual(await download(page,'[data-action="export"]','synthetic-conflict-preview-retained'),edited);
    return {input:'synthetic negative fixture, not a new native report',originalId:daily.id,storedBytesUnchanged:true,previewRetained:true};
  });
  await check('synthetic-existing-parent-ambiguity-no-automatic-version',async()=>{
    const daily=JSON.parse(fs.readFileSync(path.join(nativeDir,'daily-event-20261002.json'))),key='bitdesk-local-reports-daily_event';
    const before=await page.evaluate(key=>localStorage.getItem(key),key);
    try{
      await page.evaluate(({daily,key})=>{const edited=structuredClone(daily);edited.report.title+=' [synthetic legacy ambiguity fixture]';const records=JSON.parse(localStorage.getItem(key));records.unshift({id:'local:'+BitContentIdentity.contentId(edited),savedAt:new Date().toISOString(),row:edited});localStorage.setItem(key,JSON.stringify(records));},{daily,key});
      const sentimentLocalId=receipt.cases.find(x=>x.name==='formal-sentiment_analysis-local-save-reopen').evidence.localId;
      await page.goto(origin+'/index.html#/news-analysis?reportId='+encodeURIComponent(sentimentLocalId),{waitUntil:'domcontentloaded'});await expect(page.locator('.rd-parent')).toContainText('多个同ID版本，无法唯一关联');await expect(page.locator('.rd-parent a')).toHaveAttribute('href','#/news');
      await shot(page,'synthetic-local-parent-ambiguity','.rd-parent');
      return {input:'synthetic valid-hash legacy conflict in isolated test context only',automaticVersion:false,explicitSelection:true};
    }finally{await page.evaluate(({key,before})=>localStorage.setItem(key,before),{key,before});}
  });
  assert.equal(receipt.blockedWrites.length,0);assert.equal(receipt.runtime.length,0);receipt.status='PASS';receipt.completedAt=new Date().toISOString();receipt.scope='Actual loopback service/real CLI receipts and native formal reports; remote report bodies replayed from actual capture. External icons excluded. No new model calls or remote writes.';save();console.log(JSON.stringify({status:receipt.status,cases:receipt.cases.length,report:path.join(OUT,'report.json')}));
}
main().catch(error=>{receipt.status='FAIL';receipt.error=error.stack;receipt.completedAt=new Date().toISOString();save();console.error(error.stack);process.exitCode=1;}).finally(async()=>{clearTimeout(watchdog);await cleanup();});
