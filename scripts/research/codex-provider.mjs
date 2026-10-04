import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {ProcessTree,PROCESS_OBSERVE_INTERVAL_MS} from '../dev/process-tree.mjs';
import {outputSchemaForTask,validateOutput} from '../../js/research-v2/contract.mjs';
import {buildSynthesisReview,REVIEW_SCHEMA,validateSynthesisReview} from '../../js/research-v2/synthesis-review.mjs';
function cliPath(){
  const candidates=[path.resolve('node_modules/@openai/codex/bin/codex.js'),path.join(process.env.APPDATA||'','npm/node_modules/@openai/codex/bin/codex.js')];
  const found=candidates.find(file=>fs.existsSync(file));if(!found)throw Error('Codex CLI 未安装；请安装官方 @openai/codex 后用 ChatGPT 登录');return found;
}
function childEnvironment(){return Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|HOME|CODEX_HOME|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY|LANG|TERM)$/i.test(key)));}
export function launch(args,{cwd,signal,timeoutMs=180000,onEvent=()=>{},spawnProcess=spawn,treeFactory=pid=>new ProcessTree(pid)}={}){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(Error('研究已取消'));return;}
    const launchId=crypto.randomUUID(),startedAt=new Date().toISOString(),deadline=new Date(Date.now()+timeoutMs).toISOString(),child=spawnProcess(process.execPath,[cliPath(),...args],{cwd,env:childEnvironment(),windowsHide:true,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});
    const tree=treeFactory(child.pid);let stdout='',stderr='',pending='',failed=null,stopped=false,settled=false,cleaning=null,closeSeen=false,code=null;
    const emit=event=>{if(settled)return;try{onEvent(event);}catch(error){failed??=error;void cancel();}};
    const settle=()=>{if(settled)return;settled=true;clearTimeout(timer);clearTimeout(cleanupTimer);clearInterval(probe);signal?.removeEventListener('abort',abort);
      try{onEvent({event:'process_finished',launchId,pid:child.pid,startedAt,deadline,processes:[...tree.records.values()],code,stopped,cleanup:failed?.message==='cleanup_uncertain'?'uncertain':'confirmed'});}catch(error){failed??=error;}
      if(failed){failed.cleanup=failed.message==='cleanup_uncertain'?'uncertain':'confirmed';reject(failed);}else resolve({code,stdout,stderr});};
    let finishing=false;
    const finish=async()=>{if(settled||finishing)return;finishing=true;ensureCleanupDeadline();if(cleaning)await cleaning;try{await tree.capture();if((await tree.live()).length){await tree.terminate();if(!failed)failed=Error('模型退出时仍有后代进程');}}catch{failed=Error('cleanup_uncertain');}settle();};
    let cleanupTimer;
    const ensureCleanupDeadline=()=>{if(!cleanupTimer)cleanupTimer=setTimeout(()=>{failed=Error('cleanup_uncertain');settle();},15000);};
    const cancel=()=>{if(cleaning)return cleaning;stopped=true;cleaning=tree.terminate().catch(()=>{failed=Error('cleanup_uncertain');try{child.kill();}catch{}});
      ensureCleanupDeadline();void cleaning.then(()=>finish());return cleaning;};
    const timer=setTimeout(()=>{failed=Object.assign(Error('Codex 任务达到内部截止'),{code:'CODEX_PROCESS_DEADLINE'});cancel();},timeoutMs);
    const abort=()=>{failed=Error('研究已取消');cancel();};signal?.addEventListener('abort',abort,{once:true});
    let inventory='';const probe=setInterval(()=>{if(settled)return;void tree.capture().then(()=>{const signature=JSON.stringify([...tree.records.values()]);if(signature!==inventory){inventory=signature;emit({event:'process_inventory',launchId,pid:child.pid,processes:[...tree.records.values()]});}}).catch(()=>{if(settled)return;failed=Error('cleanup_uncertain');void cancel();});},PROCESS_OBSERVE_INTERVAL_MS);probe.unref?.();
    child.stdout.on('data',chunk=>{if(settled)return;stdout+=chunk;pending+=chunk;if(stdout.length>2*1024*1024){failed=Error('Codex 输出超过上限');cancel();return;}
      const lines=pending.split('\n');pending=lines.pop();for(const line of lines){let event;try{event=JSON.parse(line);}catch{continue;}emit(event);}});
    child.stderr.on('data',chunk=>{if(settled)return;stderr+=chunk;if(stderr.length>128*1024){failed=Error('Codex 错误输出超过上限');cancel();}});
    child.on('error',error=>{if(settled)return;failed??=error;void finish();});
    child.stdin.on('error',error=>{if(settled)return;if(error.code!=='EPIPE'){failed=error;cancel();}});
    child.on('exit',value=>{if(settled)return;code=value;if(!closeSeen)void tree.capture().then(async()=>{if(settled)return;if((await tree.live()).length){failed??=Error('模型父进程退出但后代仍存活');await cancel();}}).catch(()=>{if(settled)return;failed=Error('cleanup_uncertain');void cancel();});});
    child.on('close',value=>{if(settled)return;closeSeen=true;code=value;void finish();});
    emit({event:'process_spawned',launchId,pid:child.pid,startedAt,deadline});
    if(!stopped&&!settled)void tree.capture().then(()=>{if(settled)return;emit({event:'process_started',launchId,pid:child.pid,startedAt,processes:[...tree.records.values()],deadline});if(signal?.aborted)abort();}).catch(()=>{if(settled)return;failed=Error('cleanup_uncertain');void cancel();});
    if(!stopped&&!settled&&args.at(-1)==='-')child.stdin.end(args.prompt||'');else child.stdin.end();
  });
}
export async function authStatus({signal,timeoutMs=15000,onEvent=()=>{}}={}){
  try{const result=await launch(['login','status'],{signal,timeoutMs,onEvent:event=>{if(event.event)onEvent({...event,phase:'auth'});}});const combined=result.stdout+'\n'+result.stderr;
    const auth=result.code===0&&/ChatGPT/i.test(combined)?'chatgpt':/API key/i.test(combined)?'api_key':/not logged in/i.test(combined)?'not_logged_in':'unavailable';
    return {available:auth==='chatgpt',auth,message:auth==='chatgpt'?'ChatGPT 登录可用':auth==='unavailable'?'官方 CLI 状态查询失败，请检查本地访问权限':'请运行 codex login 并用 ChatGPT 登录；研究只使用套餐额度'};
  }catch(error){if(error.message==='cleanup_uncertain'||error.code==='TEAM_STORAGE'||signal?.aborted)throw error;return {available:false,auth:'unavailable',message:error.message};}
}
export function publicExecutionFailure(event){
  if(!['turn.failed','error'].includes(event.type))return null;
  const error=event.error,message=typeof error==='string'?error:error?.message||event.message;
  const code=error?.code||event.code;
  return {type:event.type,code:typeof code==='string'&&/^[a-z0-9_-]{1,80}$/i.test(code)?code:null,
    message:typeof message==='string'?message.replace(/https?:\/\/[^\s]+/gi,'〔连接地址〕').replace(/[A-Z]:\\[^\s]+/gi,'〔本地路径〕').replace(/(?:bearer\s+|(?:token|api[_-]?key|authorization)\s*[:=]\s*)[^\s;,]+/gi,'〔连接信息〕').slice(0,300):null};
}
export async function runStructured(prompt,schemaValue,{signal,onEvent=()=>{},timeoutMs=480000,authCheck=authStatus,execute=launch}={}){
  const deadline=Date.now()+timeoutMs;
  const auth=await authCheck({signal,onEvent,timeoutMs:Math.min(15000,timeoutMs)});if(signal?.aborted)throw Error('研究已取消');if(!auth.available)throw Error(auth.message);
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bitdesk-codex-'));
  const schema=path.join(directory,'schema.json'),output=path.join(directory,'result.json');fs.writeFileSync(schema,JSON.stringify(schemaValue));
  const args=['exec','--ignore-user-config','--ephemeral','--skip-git-repo-check','--sandbox','read-only',
    '--disable','shell_tool','--disable','apps','--disable','browser_use','--disable','computer_use','--disable','code_mode_host','--disable','unified_exec','--disable','view_image','--disable','multi_agent','--disable','plugins','--disable','hooks','--disable','workspace_dependencies',
    '-c','forced_login_method="chatgpt"','-c','web_search="disabled"','-c','model_reasoning_effort="xhigh"','--json','--output-schema',schema,'--output-last-message',output,'-'];
  args.prompt=prompt;
  let threadId=null,completed=false,usage=null,model=null,toolCalls=0,failure=null;
  try{
    const remaining=deadline-Date.now();if(remaining<=0)throw Error('Codex 任务达到内部截止');
    const result=await execute(args,{cwd:directory,signal,timeoutMs:remaining,onEvent:event=>{
      if(event.type==='thread.started')threadId=event.thread_id;
      if(event.type==='turn.completed'){completed=true;usage=event.usage||null;}
      if(event.model)model=event.model;
      if(event.item&&['command_execution','mcp_tool_call','web_search','tool_call'].includes(event.item.type))toolCalls++;
      // Persist safe progress only; CLI stderr/auth contents are not application data.
      const diagnostic=publicExecutionFailure(event);if(diagnostic){failure=diagnostic;onEvent({type:event.type,diagnostic});}
      else if(event.event||event.type==='thread.started'||event.type==='turn.completed')onEvent(event);
      else if(event.item&&['item.started','item.updated','item.completed'].includes(event.type))onEvent({type:event.type,itemType:event.item.type,itemId:event.item.id});
    }});
    if(result.code!==0||!completed||!fs.existsSync(output))throw Object.assign(Error('Codex 模型执行失败（exit '+result.code+'）；未取得完整结果'),{code:'CODEX_EXECUTION_FAILED',providerDiagnostic:{...(failure||{type:null,code:null,message:null}),exitCode:result.code,completed,outputPresent:fs.existsSync(output)}});
    if(toolCalls)throw Error('source_isolation_tool_call_detected');
    const data=JSON.parse(fs.readFileSync(output,'utf8'));
    return {output:data,provenance:{mode:'codex_cli',auth:'chatgpt',completed:true,threadId,model,usage,toolCalls,cli:'official @openai/codex',modelSelection:'CLI runtime default; no model override'}};
  }catch(error){if(error.code==='CODEX_PROCESS_DEADLINE')error.phase='model';throw error;
  }finally{
    // Delete only the exact temporary files this call created; never credentials.
    for(const file of [schema,output])if(fs.existsSync(file))fs.unlinkSync(file);
    if(fs.existsSync(directory)&&fs.readdirSync(directory).length===0)fs.rmdirSync(directory);
  }
}
export async function runCodexTask(task,options={}){
  const result=await runStructured(task.prompt,outputSchemaForTask(task),options);
  options.onEvent?.({event:'provider_candidate',output:result.output,provenance:result.provenance});
  try{validateOutput(task,result.output);}catch(error){options.onEvent?.({event:'validation_rejected',reason:error.message});throw error;}
  if(task.stage==='synthesis'){
    const review=buildSynthesisReview(task,result.output);
    options.onEvent?.({event:'synthesis_candidate',output:result.output,outputHash:review.input.outputHash,auditId:review.auditId,promptHash:review.promptHash});
    const checked=await runStructured(review.prompt,REVIEW_SCHEMA,{...options,onEvent:event=>options.onEvent?.({...event,purpose:'synthesis_semantic_review',auditId:review.auditId})});
    validateSynthesisReview(task,result.output,review,checked.output);
    const receipt={version:review.version,auditId:review.auditId,promptHash:review.promptHash,input:review.input,output:checked.output,provenance:checked.provenance};
    options.onEvent?.({event:'synthesis_audit',receipt});
    if(checked.output.verdict!=='accept')throw Error('综合语义审核未通过：'+checked.output.issues.map(x=>x.location+' '+x.reason).join('；'));
    result.provenance.semanticAudit=receipt;
  }
  return result;
}
