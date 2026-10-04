import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec = promisify(execFile);
export const PROCESS_OBSERVE_INTERVAL_MS=4000;
// Process metadata only: never query command lines or environments.
export function createProcessSnapshot({execute=exec,platform=process.platform}={}){
  let pending=null;
  return function snapshot(){
    if(platform!=='win32')return Promise.resolve([]);
    if(pending)return pending;
    // Share only the current query, never an earlier completed identity table.
    pending=Promise.resolve().then(async()=>{
      const began=performance.now(),script="Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate | Select-Object ProcessId,ParentProcessId,@{Name='Born';Expression={$_.CreationDate.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress";
      for(let attempt=0;attempt<2;attempt++){
        try{const {stdout}=await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{timeout:5000,windowsHide:true,maxBuffer:2*1024*1024});
          const rows=JSON.parse(stdout||'[]');return (Array.isArray(rows)?rows:[rows]).map(x=>({pid:x.ProcessId,parent:x.ParentProcessId,born:x.Born}));
        }catch(error){
          // execFile has settled its child/stdio before rejecting a timed out
          // query. Retry metadata once, not denied access, corrupt output or
          // an output limit; the owned workload never receives a stale table.
          const timeout=error.killed===true&&error.code==null&&error.signal==='SIGTERM';
          error.observation={attempts:attempt+1,elapsedMs:Math.round(performance.now()-began),kind:timeout?'timeout':'failed',code:error.code??null,killed:error.killed??null,signal:error.signal??null};
          if(!timeout||attempt===1)throw error;
        }
      }
    }).finally(()=>{pending=null;});return pending;
  };
}
export const processSnapshot=createProcessSnapshot();
export class ProcessTree {
  constructor(pid,{snapshot=processSnapshot,stop=null}={}){this.pid=pid;this.records=new Map();this.snapshot=snapshot;this.stop=stop;this.uncertain=false;this.pending=null;}
  async capture(){
    if(process.platform!=='win32'&&!this.stop)return;
    if(this.pending)return this.pending;
    this.pending=(async()=>{const rows=await this.snapshot();const root=rows.find(x=>x.pid===this.pid);
      if(root&&!Number.isFinite(Date.parse(root.born)))throw Error('process_identity_unavailable:'+this.pid);
      if(root&&!this.records.has(root.pid))this.records.set(root.pid,root);
      const parents=new Set([...this.records.values()].filter(old=>rows.some(x=>x.pid===old.pid&&x.born===old.born)).map(x=>x.pid));
      let changed=true;while(changed){changed=false;for(const row of rows){const parent=this.records.get(row.parent);if(parents.has(row.parent)&&!parents.has(row.pid)&&parent&&Number.isFinite(Date.parse(row.born))&&Date.parse(row.born)>=Date.parse(parent.born)&&!this.records.has(row.pid)){parents.add(row.pid);this.records.set(row.pid,row);changed=true;}}}
      return rows;
    })();try{return await this.pending;}catch(error){this.uncertain=true;throw error;}finally{this.pending=null;}
  }
  async live(){const rows=await this.capture();return (rows||[]).filter(row=>this.records.get(row.pid)?.born===row.born);}
  async terminate(){
    if(process.platform!=='win32'&&!this.stop){try{process.kill(-this.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}return;}
    const live=await this.live();
    for(const row of live.reverse()){
      const fresh=(await this.snapshot()).find(x=>x.pid===row.pid);
      if(!fresh||fresh.born!==row.born)continue;
      if(this.stop)await this.stop(row);
      else await exec('taskkill',['/PID',String(row.pid),'/T','/F'],{timeout:10000,windowsHide:true,maxBuffer:65536}).catch(async error=>{const now=await this.snapshot();if(now.some(x=>x.pid===row.pid&&x.born===row.born))throw error;});
    }
    if((await this.live()).length)throw Error('cleanup_uncertain');
  }
}
