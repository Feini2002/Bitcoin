const fs=require('node:fs');const path=require('node:path');const http=require('node:http');const {chromium,expect}=require('playwright/test');const {report}=require('../fixtures/research-test-fixtures.cjs');
const ROOT=path.join(__dirname,'../..'),OUT=path.join(ROOT,'.artifacts/redesign');let browser,server;
async function main(){
 fs.mkdirSync(OUT,{recursive:true});
 server=http.createServer((req,res)=>{const file=path.resolve(ROOT,'.'+new URL(req.url,'http://local').pathname.replace(/^\/$/,'/index.html'));if(!file.startsWith(ROOT+path.sep)){res.writeHead(404);res.end();return;}fs.readFile(file,(e,data)=>{if(e){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.svg':'image/svg+xml'})[path.extname(file)]||'text/plain');res.end(data);});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true});let count=0;console.log(JSON.stringify({pid:process.pid,origin,deadline:'120 seconds via run-bounded'}));
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  const context=await browser.newContext({viewport,locale:'zh-CN',timezoneId:'Asia/Shanghai',reducedMotion:'reduce'});const errors=[];
  let mode='ready';
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin===origin)return route.continue();if(u.pathname.startsWith('/api/yuqing/reports/')){const kind=u.searchParams.get('kind')||(/sentiment/.test(u.searchParams.get('id'))?'sentiment_analysis':'daily_event');let row=report(kind);if(u.pathname.endsWith('/history'))return route.fulfill({json:{items:[{id:row.id,generatedAt:row.generatedAt,title:row.report.title}]}});if(u.searchParams.get('id')==='missing'||mode==='fail')return route.fulfill({status:503,json:{error:'fixture unavailable'}});if(mode==='empty')row=null;if(mode==='legacy')row={...row,report:{title:'历史保留样本',body:'原文未删除'}};if(mode==='unsafe')row.report.events[0].title='<img src=x onerror="window.__xss=1">';return route.fulfill({json:{report:row}});}return route.fulfill({contentType:route.request().resourceType()==='script'?'text/javascript':'application/json',body:route.request().resourceType()==='script'?'':'{}'});});
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  for(const kind of ['daily_event','sentiment_analysis']){
   await page.goto(origin+'/#/'+(kind==='daily_event'?'news':'news-analysis'),{waitUntil:'domcontentloaded'});
   if(kind==='daily_event')await page.locator('.rd-saved-history>summary').click();await expect(page.locator('#rd-content')).toContainText('验收样本');await expect(page.locator('#rd-feedback')).toContainText('已载入');
   if(kind==='daily_event'){await page.locator('#rd-status-filter').selectOption('unverified');await expect(page.locator('#rd-event-list .rd-event')).toHaveCount(1);await page.locator('#rd-search').fill('不存在');await expect(page.locator('#rd-event-list')).toContainText('没有匹配');await page.locator('#rd-search').fill('');await page.locator('#rd-status-filter').selectOption('all');await expect(page.locator('#rd-event-list .rd-event')).toHaveCount(2);}
   else {await expect(page.locator('#rd-narratives')).toContainText('最强反证');await expect(page.locator('#rd-scenarios')).toContainText('失效');}
   const download=page.waitForEvent('download');await page.getByRole('button',{name:'导出此报告',exact:true}).click();const file=await download;const save=path.join(OUT,'export-'+kind+'-'+viewport.width+'.json');await file.saveAs(save);if(JSON.parse(fs.readFileSync(save)).id!==report(kind).id)throw Error('export identity mismatch');
   await page.getByRole('button',{name:'补充研究资料',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.locator('#rd-focus').fill('验证我的研究问题');await page.getByRole('button',{name:'复制完整研究指令',exact:true}).click();await expect(page.locator('#rd-prompt')).toHaveValue(/验证我的研究问题/);await expect(page.locator('#rd-prompt')).toHaveValue(/不配置或索取模型 API Key/);await page.getByRole('button',{name:'关闭对话框'}).click();
   await page.locator('[data-module]').first().click();await page.getByRole('button',{name:'复制模块指令',exact:true}).click();await expect(page.locator('#rd-prompt')).toHaveValue(/单模块复核/);await page.keyboard.press('Escape');
   await page.getByRole('button',{name:'预览报告文件'}).click();await page.locator('#rd-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{}')});await expect(page.locator('#rd-preview-errors')).toContainText('kind');
   if(kind==='daily_event')await page.locator('.rd-saved-history').evaluate(el=>{el.open=false;});await page.locator('#rd-file').setInputFiles({name:'valid.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(report(kind)))});await expect(page.locator('#rd-feedback')).toContainText('文件已打开');await expect(page.locator('#rd-content')).toBeVisible();if(kind==='daily_event')await expect(page.locator('.rd-saved-history')).toHaveAttribute('open');
   const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1||document.querySelector('#outlet').scrollWidth>document.querySelector('#outlet').clientWidth+1);if(overflow)throw Error('overflow '+kind+' '+viewport.width);
   await page.screenshot({path:path.join(OUT,'after-'+kind+'-'+viewport.width+'.png'),fullPage:true});
   await page.evaluate(()=>setTheme('dark'));await page.screenshot({path:path.join(OUT,'after-'+kind+'-dark-'+viewport.width+'.png'),fullPage:true});await page.evaluate(()=>setTheme('light'));
   await page.locator('[data-source]').first().click();
   await expect(page.locator('#rd-sources article').first()).toBeFocused();
   await page.screenshot({path:path.join(OUT,'after-'+kind+'-sources-'+viewport.width+'.png'),fullPage:true});
   if(kind==='sentiment_analysis'){
    await page.locator('#rd-scenarios').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(OUT,'after-scenarios-'+viewport.width+'.png'),fullPage:true});
   }
   console.log('PASS research UI '+kind+' '+viewport.width);count++;
  }
  for(const state of ['empty','fail','legacy','unsafe']){mode=state;await page.goto(origin+'/?case='+state+'#/news');await expect(page.locator('#rd-feedback')).not.toContainText('正在读取');if(state==='empty')await expect(page.locator('#rd-content')).toContainText('还没有这份研究');if(state==='fail')await expect(page.locator('#rd-content')).toContainText('无法读取');if(state==='legacy'){await page.locator('.rd-saved-history>summary').click();await expect(page.locator('#rd-content')).toContainText('历史保留样本');await expect(page.getByRole('link',{name:'打开旧版报告与历史管理 ↗'})).toHaveAttribute('href',/legacy=1/);}if(state==='unsafe'){await expect(page.locator('#rd-content')).toContainText('<img src=x');if(await page.evaluate(()=>window.__xss))throw Error('HTML executed');}}
  mode='ready';await page.goto(origin+'/#/news?reportId=missing');await expect(page.locator('#rd-feedback')).toContainText('未用其他版本替代');
  await page.evaluate(()=>{location.hash='#/news';location.hash='#/news-analysis';location.hash='#/overview';});await expect(page.getByRole('heading',{name:'今日',exact:true})).toBeVisible();await expect(page.locator('[data-research-kind]')).toHaveCount(0);
  await page.screenshot({path:path.join(OUT,'home-fixture-'+viewport.width+'.png'),fullPage:true});
  if(errors.length)throw Error(errors.join(';'));await context.close();
 }
 console.log('PASS '+count+' desktop/mobile research flows');
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close();server?.close();});
