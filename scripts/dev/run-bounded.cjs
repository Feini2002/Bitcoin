// 本地验证/部署启动器：记录父子 PID，硬截止时停止本次进程树。
const { spawn } = require('node:child_process');
const path = require('node:path');
const [secondsText, command, ...args] = process.argv.slice(2);
const seconds = Number(secondsText);
if (!command || !Number.isFinite(seconds) || seconds <= 0) throw Error('Usage: node scripts/run-bounded.cjs seconds node|npm args...');
const executable = command === 'node' || command === 'npm' ? process.execPath : command;
const childArgs = command === 'npm' ? [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), ...args] : args;
async function main(){
  const {ProcessTree,PROCESS_OBSERVE_INTERVAL_MS}=await import('./process-tree.mjs');
  const child=spawn(executable,childArgs,{stdio:'inherit',windowsHide:true,detached:process.platform!=='win32'}),tree=new ProcessTree(child.pid);
  console.log(JSON.stringify({supervisorPid:process.pid,childPid:child.pid,deadline:new Date(Date.now()+seconds*1000).toISOString(),command,args}));
  let stopping=false,finished=false,probe,timer,cleanupPromise;
  function observationError(error){console.error(JSON.stringify({event:'process_observation_failed',childPid:child.pid,details:error.observation||{code:error.code??null,killed:error.killed??null,signal:error.signal??null}}));console.error(error.message);}
  async function cleanup(){cleanupPromise??=Promise.race([tree.terminate(),new Promise((_,reject)=>setTimeout(()=>reject(Error('cleanup_uncertain')),15000).unref())]);await cleanupPromise;}
  async function end(code,signal){if(finished)return;finished=true;clearInterval(probe);clearTimeout(timer);try{await tree.capture();const remaining=await tree.live();if(remaining.length){console.error('remaining exact descendants '+JSON.stringify(remaining));await cleanup();if(!stopping)code=1;}}
    catch(error){console.error('cleanup_uncertain childPid='+child.pid+' '+error.message);process.exitCode=125;return;}console.log(JSON.stringify({childPid:child.pid,code,signal,stopped:stopping,cleanup:'confirmed'}));process.exitCode=stopping?124:(code??1);}
  async function stop(reason){if(stopping)return;stopping=true;clearInterval(probe);console.error('STOP '+reason+' childPid='+child.pid);try{await cleanup();await end(124,null);}catch(error){clearInterval(probe);clearTimeout(timer);try{child.kill();}catch{}console.error('cleanup_uncertain childPid='+child.pid+' '+error.message);process.exitCode=125;}}
  timer=setTimeout(()=>void stop('hard deadline'),seconds*1000);probe=setInterval(()=>{void tree.capture().catch(error=>{observationError(error);void stop('process observation failed');});},PROCESS_OBSERVE_INTERVAL_MS);probe.unref();
  process.on('SIGINT',()=>void stop('SIGINT'));process.on('SIGTERM',()=>void stop('SIGTERM'));
  child.on('error',error=>{console.error(error.message);void end(1,null);});child.on('exit',(code,signal)=>void end(code,signal));
  try{await tree.capture();console.log(JSON.stringify({childPid:child.pid,tracked:[...tree.records.values()]}));}catch(error){observationError(error);await stop('initial process observation failed');}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
