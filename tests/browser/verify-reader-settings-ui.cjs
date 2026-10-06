// All config writes below are intercepted fixtures; the local service stays OFF.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium,expect}=require('playwright/test');
const origin=process.env.BITDESK_AGENT_UI_ORIGIN||'http://127.0.0.1:5173',out=path.resolve('.artifacts/reader-settings-ui/run-'+new Date().toISOString().replace(/[:.]/g,'-'));
fs.mkdirSync(out,{recursive:true});const result={source:'fixture settings writes; real service state checked before/after',pid:process.pid,cases:[],errors:[],unexpectedWrites:[]};let server,browser,context,release;
const save=()=>fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)),close=async()=>{release?.();await context?.close();await browser?.close();await server?.close();};
const timer=setTimeout(()=>{result.status='FAIL';result.error='120s internal deadline';save();void close();},120000);
const get=async p=>{const r=await fetch(origin+'/api/local-agent-team/'+p,{signal:AbortSignal.timeout(10000)});assert(r.ok);return r.json();};
const pass=id=>{result.cases.push({id,status:'PASS'});save();console.log('PASS '+id);};
(async()=>{
 const before=await get('status');assert.equal(before.config.enabled,false);assert.equal(before.active,null);server=await chromium.launchServer({headless:true});browser=await chromium.connect(server.wsEndpoint());result.browserPid=server.process().pid;console.log(JSON.stringify({pid:process.pid,browserPid:result.browserPid,out}));
 for(const width of [1440,390]){
  context=await browser.newContext({viewport:{width,height:width===390?844:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai',reducedMotion:'reduce'});await context.addInitScript(()=>localStorage.setItem('bit-theme','light'));
  let stored=structuredClone(before.config),mode='success',posted=0;
  await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());
   if(u.pathname==='/api/local-agent-team/config'){
    if(req.method()==='GET')return route.fulfill({json:{config:stored}});
    posted++;const draft=req.postDataJSON();assert.equal(draft.enabled,false,'fixture never requests automatic ON');
    if(mode==='pending')await new Promise(resolve=>release=resolve);
    if(mode==='fail')return route.fulfill({status:503,json:{error:'fixture_save_failed'}});
    if(mode==='conflict')return route.fulfill({status:409,json:{error:'config_version_conflict'}});
    stored={...draft,version:stored.version+1};return route.fulfill({json:{config:stored}});
   }
   if(!['GET','HEAD','OPTIONS'].includes(req.method())&&u.pathname!='/api/local-agent-team/presence'){result.unexpectedWrites.push(u.pathname);return route.fulfill({status:405,json:{error:'blocked'}});}
   return route.continue();
  });
  const p=await context.newPage();p.setDefaultTimeout(9000);p.on('pageerror',e=>result.errors.push(e.message));await p.goto(origin+'/#/settings');
  const field=p.locator('[name=intervalMinutes]'),state=p.locator('#at-settings-saved'),submit=p.getByRole('button',{name:'保存研究设置',exact:true});await expect(state).toContainText('自动研究关闭');await expect(state).toContainText('北京时间');await expect(p.locator('[name=timezone]')).not.toBeVisible();await expect(p.locator('#at-preview details')).not.toHaveAttribute('open','');
  await p.screenshot({path:path.join(out,'settings-'+width+'.png'),animations:'disabled'});await p.locator('#at-preview summary').click();await expect(p.locator('#at-preview')).toContainText('没有排队');await expect(p.locator('#at-preview details')).toHaveAttribute('open','');
  const original=Number(await field.inputValue());await field.fill(String(original+1));await expect(state).toContainText('有未保存修改');await expect(p.locator('#at-preview details')).toHaveAttribute('open','');await p.locator('#at-settings-discard').click();await expect(field).toHaveValue(String(original));assert.equal(posted,0);pass('closed-summary-preview-and-draft-discard-'+width);
  await field.fill(String(original+2));mode='pending';await submit.click();await expect(submit).toBeDisabled();await expect(state).toContainText('每隔 '+original+' 分钟');release();release=null;await expect(state).toContainText('每隔 '+(original+2)+' 分钟');await expect(p.locator('#at-settings-feedback')).toContainText('已保存');pass('saving-confirmed-only-after-reply-'+width);
  mode='fail';await field.fill(String(original+3));await submit.click();await expect(p.locator('#at-settings-feedback')).toContainText('fixture_save_failed');await expect(state).toContainText('有未保存修改');assert.equal(stored.intervalMinutes,original+2);pass('failed-save-keeps-draft-and-saved-state-'+width);
  mode='conflict';await submit.click();await expect(p.locator('#at-settings-feedback')).toContainText('另一页面已修改设置');stored={...stored,version:stored.version+1,intervalMinutes:original+4};await p.locator('#at-config-retry').click();await expect(field).toHaveValue(String(original+4));await expect(state).toContainText('没有未保存修改');pass('conflict-reload-explicitly-reconciles-'+width);
  const overflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2);assert.equal(overflow,false);await context.close();context=null;
 }
 const after=await get('status');assert.deepEqual(after.config,before.config);assert.equal(after.active,null);assert.equal(after.chief.id,before.chief.id);assert.deepEqual(result.errors,[]);assert.deepEqual(result.unexpectedWrites,[]);result.status='PASS';
})().catch(e=>{result.status='FAIL';result.error=e.stack;process.exitCode=1;}).finally(async()=>{clearTimeout(timer);await close();save();console.log(JSON.stringify(result));});
