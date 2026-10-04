const assert=require('node:assert/strict');
async function main(){
  const {createProcessSnapshot,ProcessTree,PROCESS_OBSERVE_INTERVAL_MS}=await import('../../scripts/dev/process-tree.mjs');
  const born='2026-10-04T00:00:00.000Z',later='2026-10-04T00:00:01.000Z';
  const serialized=pid=>({stdout:JSON.stringify([{ProcessId:pid,ParentProcessId:0,Born:born}])});
  const timeout=()=>Object.assign(Error('synthetic metadata timeout'),{killed:true,signal:'SIGTERM'});
  let passes=0;const pass=name=>{passes++;console.log('PASS PO-'+String(passes).padStart(2,'0')+' '+name);};
  assert.equal(PROCESS_OBSERVE_INTERVAL_MS,4000);
  let release,calls=0;const inputs=[],gate=new Promise(resolve=>release=resolve);
  const shared=createProcessSnapshot({platform:'win32',execute:async(...args)=>{inputs.push(args);calls++;if(calls===1)await gate;return serialized(calls);}});
  const twenty=Array.from({length:20},()=>shared());await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);release();
  const tables=await Promise.all(twenty);for(const table of tables)assert.deepEqual(table,[{pid:1,parent:0,born}]);
  assert.deepEqual(await shared(),[{pid:2,parent:0,born}]);assert.equal(calls,2);
  for(const [exe,args,options]of inputs){assert.equal(exe,'powershell.exe');assert(args[3].includes('-Property ProcessId,ParentProcessId,CreationDate'));assert(!/CommandLine|Environment/.test(args[3]));assert.equal(options.timeout,5000);assert.equal(options.windowsHide,true);assert.equal(options.maxBuffer,2*1024*1024);}
  pass('20 concurrent observations share one query; next observation is fresh, sparse and bounded');
  calls=0;const retried=createProcessSnapshot({platform:'win32',execute:async()=>{if(++calls===1)throw timeout();return serialized(40);}});
  assert.deepEqual(await retried(),[{pid:40,parent:0,born}]);assert.equal(calls,2);pass('one exact timeout metadata failure gets one fresh successful query');
  calls=0;const failed=createProcessSnapshot({platform:'win32',execute:async()=>{if(++calls<=2)throw timeout();return serialized(41);}});
  await assert.rejects(failed(),error=>{assert.equal(error.observation.attempts,2);assert.equal(error.observation.kind,'timeout');assert.equal(error.observation.code,null);assert.equal(error.observation.killed,true);assert.equal(error.observation.signal,'SIGTERM');assert(Number.isFinite(error.observation.elapsedMs));return true;});
  assert.equal(calls,2);assert.deepEqual(await failed(),[{pid:41,parent:0,born}]);assert.equal(calls,3);pass('double timeout rejects after two queries and failed in-flight state is discarded');
  for(const [name,error]of [
    ['permission',Object.assign(Error('synthetic access denied'),{code:'EACCES',killed:false})],
    ['nonzero exit',Object.assign(Error('synthetic exit'),{code:1,killed:false,signal:null})],
    ['output limit',Object.assign(Error('synthetic output limit'),{code:'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',killed:true,signal:'SIGTERM'})],
    ['unconfirmed kill',Object.assign(Error('synthetic signal only'),{killed:false,signal:'SIGTERM'})]
  ]){let count=0;const snapshot=createProcessSnapshot({platform:'win32',execute:async()=>{count++;throw error;}});await assert.rejects(snapshot(),got=>{assert.strictEqual(got,error);assert.equal(got.observation.attempts,1);assert.equal(got.observation.kind,'failed');return true;});assert.equal(count,1);pass(name+' failure is not retried');}
  calls=0;const damaged=createProcessSnapshot({platform:'win32',execute:async()=>{calls++;return {stdout:'{broken'};}});await assert.rejects(damaged(),error=>error instanceof SyntaxError&&error.observation.attempts===1);assert.equal(calls,1);pass('damaged observation output fails closed without a retry');
  let fail=false;calls=0;const noCache=createProcessSnapshot({platform:'win32',execute:async()=>{calls++;if(fail)throw Object.assign(Error('denied after success'),{code:1});return serialized(50);}});await noCache();fail=true;await assert.rejects(noCache(),/denied after success/);assert.equal(calls,2);pass('later failure never falls back to an earlier completed identity table');
  let stops=0;const unknown=new ProcessTree(60,{snapshot:async()=>[{pid:60,parent:0}],stop:async()=>{stops++;}});await assert.rejects(unknown.capture(),/process_identity_unavailable:60/);assert.equal(unknown.uncertain,true);assert.equal(unknown.records.size,0);assert.equal(stops,0);pass('present root without birth refuses identity and performs no stop');
  let phase=0;const stopped=[],oldRoot={pid:70,parent:0,born},oldChild={pid:71,parent:70,born},reusedChild={pid:71,parent:99,born:later};
  const tree=new ProcessTree(70,{snapshot:async()=>{phase++;return phase<=2?[oldRoot,oldChild]:phase<=4?[oldRoot,reusedChild]:[reusedChild];},stop:async row=>{stopped.push(row);}});
  await tree.capture();await tree.terminate();assert.deepEqual(stopped,[oldRoot]);assert.equal(tree.records.get(71).born,born);assert(!stopped.some(row=>row.pid===71));pass('PID reused between live inventory and fresh stop is never stopped');
  let executions=0;const portable=createProcessSnapshot({platform:'linux',execute:async()=>{executions++;throw Error('must not execute');}});assert.deepEqual(await portable(),[]);assert.equal(executions,0);pass('non-Windows metadata branch has no execution side effect');
  console.log(JSON.stringify({status:'PASS',groups:passes,pid:process.pid,actualModelCalls:0,actualAuthCalls:0,actualProcessStops:0}));
}
const hard=setTimeout(()=>{console.error('FAIL process observation internal deadline');process.exit(124);},20000);
main().then(()=>clearTimeout(hard),error=>{clearTimeout(hard);console.error(error.stack||error);process.exitCode=1;});
