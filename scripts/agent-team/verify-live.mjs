import fs from 'node:fs';
import {chromium} from 'playwright';
const origin='http://127.0.0.1:5173',directory='.artifacts/agent-team-live';fs.mkdirSync(directory,{recursive:true});
const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),56*60000);let browser,page,runId,last='';
async function get(tail){const response=await fetch(origin+'/api/local-agent-team/'+tail,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])});const data=await response.json();if(!response.ok||data.error)throw Error(data.error||'request_failed');return data;}
async function post(tail,data){const response=await fetch(origin+'/api/local-agent-team/'+tail,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(20000)});const value=await response.json();if(!response.ok||value.error)throw Error(value.error||'request_failed');return value;}
try{
  browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai'});page.on('pageerror',e=>console.log(JSON.stringify({phase:'page-error',error:e.message})));
  await page.goto(origin+'/#/boardroom',{waitUntil:'domcontentloaded',timeout:20000});
  for(let attempt=0;attempt<30;attempt++){if((await get('status')).presence==='present')break;await new Promise(r=>setTimeout(r,500));}
  const before=await get('status');if(before.active)throw Error('existing_research_in_progress');if(before.paused)throw Error('team_paused:'+before.paused);
  await page.locator('#at-question').fill('请解释本轮BTC市场相较各岗位上一轮有哪些变化。有哪些有证据的候选解释、反证和数据缺口？不要给交易指令，也不要把缺失材料补成事实。');
  await page.locator('#at-update').click();
  for(let attempt=0;attempt<20;attempt++){const s=await get('status');if(s.active){runId=s.active.id;break;}if(s.history[0]?.id!==before.history[0]?.id){runId=s.history[0]?.id;break;}await new Promise(r=>setTimeout(r,500));}
  if(!runId)throw Error('no_run_started');console.log(JSON.stringify({phase:'started',pid:process.pid,runId,deadline:new Date(Date.now()+55*60000).toISOString()}));
  while(!controller.signal.aborted){const state=await get('status'),row=state.history.find(r=>r.id===runId);const progress={phase:state.active?.stage||row?.status,runId,calls:state.active?.calls??row?.calls,roles:Object.fromEntries(Object.entries(state.active?.roles||state.lastAttempt?.roles||{}).map(([r,v])=>[r,{status:v.status,error:v.error}]))};const text=JSON.stringify(progress);if(text!==last){console.log(text);last=text;}
    if(row?.status&&row.status!=='running'){
      const run=await get('runs/'+runId);fs.writeFileSync(directory+'/run-'+runId+'.json',JSON.stringify(run,null,2));fs.writeFileSync(directory+'/status.json',JSON.stringify(state,null,2));
      await page.locator('#at-state').waitFor({state:'visible',timeout:10000});await new Promise(r=>setTimeout(r,3100));await page.evaluate(()=>document.querySelector('#outlet').scrollTop=0);await page.screenshot({path:directory+'/chief-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:directory+'/chief-mobile.png',fullPage:true});
      const result={status:['complete','limited'].includes(row.status)&&state.chief?.cycleId===runId?'PASS':'FAIL',runId,terminal:row.status,reason:row.reason,calls:row.calls,accepted:Object.keys(row.accepted||{}),scope:'actual public data + official Codex CLI ChatGPT subscription'};fs.writeFileSync(directory+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(result.status!=='PASS')process.exitCode=1;break;
    }
    await new Promise(r=>setTimeout(r,5000));
  }
  if(controller.signal.aborted)throw Error('live_acceptance_deadline');
}catch(error){console.error(error.message);process.exitCode=1;if(runId)await post('cancel',{}).catch(()=>{});}
finally{clearTimeout(timer);await browser?.close();}
