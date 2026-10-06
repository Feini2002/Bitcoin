import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {processSnapshot} from '../dev/process-tree.mjs';
import {hash} from './tools.mjs';
import {queryHistory} from './history-query.mjs';
import {DEFAULT_CONFIG,validateConfig,CONDITION_VERSION,conditionTiming} from '../../js/agent-team/contract.mjs';
export class TeamStore {
  constructor(directory,{snapshot=processSnapshot,clock=()=>Date.now()}={}){this.directory=path.resolve(directory);this.instanceId=crypto.randomUUID();this.pid=process.pid;this.owned=false;this.snapshot=snapshot;this.clock=clock;}
  file(name){if(!/^[a-zA-Z0-9_.-]+$/.test(name))throw Error('invalid_storage_name');return path.join(this.directory,name);}
  read(name,fallback=null){const file=this.file(name);if(!fs.existsSync(file))return fallback;try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Object.assign(Error('corrupt_local_record:'+name),{code:'TEAM_STORAGE'});}}
  write(name,value){let temp;try{if(!this.owned)throw Error('store_not_owned');const file=this.file(name);temp=file+'.'+this.instanceId+'.'+crypto.randomUUID()+'.tmp';const text=JSON.stringify(value);if(Buffer.byteLength(text)>12*1024*1024)throw Error('local_record_too_large');
    const fd=fs.openSync(temp,'wx');try{fs.writeFileSync(fd,text);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    // Actual large-record replacement hit EPERM beyond 100ms. Bound retries to 1s;
    // keep the old committed file intact on persistent failure.
    for(let attempt=0;;attempt++){try{fs.renameSync(temp,file);break;}catch(error){if(process.platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(error.code)||attempt>=20)throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);}}
  }catch(error){if(temp&&fs.existsSync(temp))try{fs.unlinkSync(temp);}catch{}error.storageCode=error.code;error.code='TEAM_STORAGE';throw error;}}
  async acquire(){
    this.recoveryDeadline=Date.now()+20000;fs.mkdirSync(this.directory,{recursive:true});const transition=this.file('owner-transition.json');
    const born=process.platform==='win32'?(await this.snapshot()).find(x=>x.pid===this.pid)?.born:new Date().toISOString();if(!born)throw Error('owner_identity_unavailable');this.identity={instanceId:this.instanceId,pid:this.pid,born};
    await this.claimIdentityFile('owner-transition.json',this.identity);
    try{return await this.acquireExclusive();}finally{const guard=this.read('owner-transition.json');if(guard?.instanceId===this.instanceId)fs.unlinkSync(transition);}
  }
  async identityDead(identity){if(Date.now()>this.recoveryDeadline)throw Error('owner_recovery_deadline');if(!identity||!Number.isInteger(identity.pid)||identity.pid<=0||!Number.isFinite(Date.parse(identity.born))||!/^[-a-f0-9]{36}$/.test(identity.instanceId||''))throw Error('owner_identity_requires_manual_diagnosis');
    if(process.platform==='win32'){const rows=await this.snapshot();if(Date.now()>this.recoveryDeadline)throw Error('owner_recovery_deadline');const row=rows.find(x=>x.pid===identity.pid);if(!row)return true;if(!Number.isFinite(Date.parse(row.born)))throw Error('owner_identity_unavailable');return row.born!==identity.born;}
    try{process.kill(identity.pid,0);return false;}catch(error){if(error.code==='ESRCH')return true;throw error;}
  }
  async claimIdentityFile(name,identity,depth=0){if(depth>4)throw Error('owner_recovery_depth_requires_diagnosis');
    for(let attempt=0;attempt<4;attempt++){try{fs.writeFileSync(this.file(name),JSON.stringify(identity),{flag:'wx'});return;}catch(error){if(error.code!=='EEXIST')throw error;}
      const old=this.read(name);if(!await this.identityDead(old))throw Error('owner_transition_in_progress_or_interrupted');
      // A ticket belongs to exactly one dead generation. Every remover must
      // acquire it; a crashed remover is recovered by the same bounded protocol.
      const ticket='owner-recovery-'+old.instanceId+'.json',ticketIdentity={...this.identity,instanceId:crypto.randomUUID()};await this.claimIdentityFile(ticket,ticketIdentity,depth+1);
      try{const current=this.read(name);if(current?.instanceId!==old.instanceId)continue;if(current.pid!==old.pid||current.born!==old.born)throw Error('owner_identity_changed');if(!await this.identityDead(current))throw Error('owner_transition_in_progress_or_interrupted');
        const checked=this.read(name);if(checked?.instanceId===old.instanceId&&checked.pid===old.pid&&checked.born===old.born)fs.unlinkSync(this.file(name));
      }finally{
        // This operation has finished or abandoned its removal attempt. Keep
        // the old guard on uncertainty, but do not leave a live recovery ticket
        // that prevents this same process from retrying after a transient error.
        const ownTicket=this.read(ticket);if(ownTicket?.instanceId===ticketIdentity.instanceId&&ownTicket.pid===ticketIdentity.pid&&ownTicket.born===ticketIdentity.born)fs.unlinkSync(this.file(ticket));
      }
    }throw Error('owner_transition_contention');
  }
  async acquireExclusive(){const file=this.file('owner.json');const owner=this.read('owner.json');
    if(owner){if(process.platform==='win32'){const rows=await this.snapshot();if(rows.some(x=>x.pid===owner.pid&&x.born===owner.born))throw Error('another_development_instance_owns_team');}
      else {try{process.kill(owner.pid,0);throw Error('another_development_instance_owns_team');}catch(error){if(error.code!=='ESRCH')throw error;}}
      // A dead service may have recorded live model descendants: never silently take over.
      const old=this.read('journal.json',{runs:[]});const rows=process.platform==='win32'?await this.snapshot():[];
      for(const run of [...old.runs,...old.authChecks||[]]){for(const launch of run.launches||[])if(launch.cleanup!=='confirmed'&&(!Number.isFinite(Date.parse(launch.born))||!run.processes?.some(p=>p.pid===launch.pid&&p.born===launch.born)))throw Error('previous_process_identity_unconfirmed:'+launch.pid);for(const p of run.processes||[])if(rows.some(x=>x.pid===p.pid&&x.born===p.born))throw Error('previous_process_cleanup_required:'+p.pid);}
      fs.unlinkSync(file);
    }
    const born=this.identity.born;
    fs.writeFileSync(file,JSON.stringify({instanceId:this.instanceId,pid:this.pid,born}),{flag:'wx'});this.owned=true;
    this.config=this.read('config.json',structuredClone(DEFAULT_CONFIG));validateConfig(this.config);
    this.journal=this.read('journal.json',{runs:[],paused:null});
    for(const row of this.journal.runs)if(!row.callTimes&&row.calls){const saved=this.read('run-'+row.id+'.json');const times=(saved?.trace||[]).filter(t=>t.promptHash&&t.startedAt).map(t=>Date.parse(t.startedAt));if(times.length===row.calls&&times.every(Number.isFinite))row.callTimes=times;}
    for(const row of this.journal.runs)this.recoverRunState(row);
    this.heads={};this.contextHeads={};this.runIndex=this.read('runs-index.json',{version:1,pages:[],count:0});this.conditions=this.read('conditions-index.json',{version:CONDITION_VERSION,pending:{}});
    // Accepted commit IDs are authoritative; rebuild derived pointers after a crash.
    const archivedRows=this.indexRows(),archivedIds=new Set(archivedRows.map(row=>row.id));this.journal.runs=this.journal.runs.filter(row=>!archivedIds.has(row.id));this.journal.archivedCallTimes=archivedRows.flatMap(row=>row.callTimes||[]).filter(at=>at>=this.clock()-72*3600000);
    // Recover the archive/index-before-journal cut without losing idempotency.
    for(const row of archivedRows)if(/^[a-f0-9-]{36}$/.test(row.requestId||'')&&!fs.existsSync(this.file('request-'+row.requestId+'.json')))this.write('request-'+row.requestId+'.json',row);
    for(const row of [...archivedRows,...this.journal.runs])for(const {role,id}of row.commits||Object.entries(row.accepted||{}).map(([role,id])=>({role,id}))){const record=this.read('report-'+id+'.json');if(!record||record.hash!==hash(record.payload))throw Error('invalid_committed_report:'+id);const contextId=row.contextId||row.task?.contextId||'current';this.contextHeads[contextId]??={};this.contextHeads[contextId][role]=id;if(contextId==='current')this.heads[role]=id;this.registerConditions(record.payload,false);}
    this.write('conditions-index.json',this.conditions);
    this.write('journal.json',this.journal);this.write('heads.json',this.heads);this.write('config.json',this.config);return this;
  }
  recoverRunState(row){
    if(row.terminal&&row.terminal!=='interrupted')return;
    const file='run-'+row.id+'.json',saved=this.read(file);
    const invalid=message=>Object.assign(Error(message+':'+row.id),{code:'TEAM_STORAGE'});
    if(!saved){
      // A crash between the initial journal and run write has no model work.
      // Preserve that index without manufacturing an original report bundle.
      if(row.calls||(row.commits||[]).length||Object.keys(row.accepted||{}).length)throw invalid('missing_interrupted_run');
      row.terminal='interrupted';row.endedAt??=new Date(this.clock()).toISOString();row.reason??='development_interrupted_before_original';return;
    }
    if(!saved.row||saved.row.id!==row.id)throw invalid('invalid_interrupted_run_identity');
    if(saved.row.terminal&&saved.row.terminal!=='interrupted'){
      // Final persistence precedes the journal. Do not downgrade a saved end.
      if(!Number.isFinite(Date.parse(saved.row.endedAt)))throw invalid('invalid_saved_run_end');
      row.terminal=saved.row.terminal;row.endedAt=saved.row.endedAt;
      if(saved.row.reason===undefined)delete row.reason;else row.reason=saved.row.reason;
    }else{
      row.terminal='interrupted';row.endedAt??=saved.row.endedAt||new Date(this.clock()).toISOString();row.reason??=saved.row.reason||'development_process_interrupted';
    }
    if(row.terminal==='cleanup_uncertain')this.journal.paused='cleanup_uncertain';
    else if(row.terminal==='storage_failed'&&this.journal.paused!=='cleanup_uncertain')this.journal.paused='storage_failed';
    // Keep raw evidence, reports, unfinished intents and audit output intact.
    // Run first, journal last makes recovery itself restartable at one time.
    if(JSON.stringify(saved.row)!==JSON.stringify(row))this.write(file,{...saved,row:structuredClone(row)});
  }
  saveConfig(next){validateConfig(next);if(next.version!==this.config.version)throw Error('config_version_conflict');const saved={...next,version:next.version+1};this.write('config.json',saved);this.config=saved;return saved;}
  async recoverCleanup(){
    const owner=this.read('owner.json');if(!this.owned||owner?.instanceId!==this.instanceId||owner.pid!==this.pid||owner.born!==this.identity?.born)throw Error('cleanup_recovery_not_owned');
    if(!this.journal.paused)return {status:'clear'};
    if(this.journal.paused!=='cleanup_uncertain')throw Error('cleanup_recovery_not_applicable');
    const resolved=new Set(this.journal.cleanupRecoveries?.flatMap(item=>item.resolvedIds)||[]),records=[...this.journal.runs,...this.journal.authChecks||[]],unresolved=records.filter(row=>row.terminal==='cleanup_uncertain'&&!resolved.has(row.id));
    if(!unresolved.length)throw Error('cleanup_inventory_unavailable');
    for(const row of unresolved){if(!Array.isArray(row.processes)||!row.processes.length)throw Error('cleanup_inventory_unavailable:'+row.id);
      const original=this.read('run-'+row.id+'.json');if(this.journal.runs.includes(row)&&(!original||original.row?.id!==row.id))throw Error('cleanup_original_unavailable:'+row.id);
      if(!original&&!row.launches?.length)throw Error('cleanup_inventory_incomplete:'+row.id);
      for(const attempt of original?.trace||[])if((attempt.cleanup==='uncertain'||attempt.error==='cleanup_uncertain'||attempt.status==='intent')&&!attempt.executions?.some(execution=>execution.cleanup!=='confirmed'))throw Error('cleanup_inventory_incomplete:'+row.id);
      for(const execution of [...row.launches||[],...(original?.trace||[]).flatMap(attempt=>attempt.executions||[])])if(execution.cleanup!=='confirmed'&&(!Number.isFinite(Date.parse(execution.born))||!row.processes.some(p=>p.pid===execution.pid&&p.born===execution.born)))throw Error('cleanup_inventory_incomplete:'+row.id);
    }
    const identities=[...new Map(records.flatMap(row=>row.processes||[]).map(p=>[p.pid+':'+p.born,p])).values()];
    if(identities.some(p=>!Number.isSafeInteger(p.pid)||p.pid<=0||!Number.isFinite(Date.parse(p.born))))throw Error('cleanup_identity_unavailable');
    const rows=await this.snapshot(),checkedAt=new Date(this.clock()).toISOString(),checked=identities.map(p=>{const live=rows.find(x=>x.pid===p.pid);if(live&&!Number.isFinite(Date.parse(live.born)))throw Error('cleanup_identity_unavailable:'+p.pid);return {...p,live:!!live&&live.born===p.born,observedBorn:live?.born||null};});
    const remaining=checked.find(p=>p.live);if(remaining)throw Error('previous_process_cleanup_required:'+remaining.pid);
    const audit={schemaVersion:'bitdesk.cleanup-recovery.v1',id:crypto.randomUUID(),status:'verification-complete',checkedAt,owner:{...this.identity},resolvedIds:unresolved.map(row=>row.id),identities:checked,processesTerminated:0,originalFailuresPreserved:true};
    const file='cleanup-recovery-'+audit.id+'.json';this.write(file,audit);
    const journal={...this.journal,paused:null,cleanupRecoveries:[...(this.journal.cleanupRecoveries||[]),{id:audit.id,file,checkedAt,resolvedIds:audit.resolvedIds}]};this.write('journal.json',journal);this.journal=journal;
    return {status:'clear',audit};
  }
  indexRows(){return (this.runIndex?.pages||[]).flatMap(page=>this.read(page.file,{rows:[]}).rows);}
  archiveJournal(){
    this.runIndex??=this.read('runs-index.json',{version:1,pages:[],count:0});const large=Buffer.byteLength(JSON.stringify(this.journal))>4*1024*1024;if(this.journal.runs.length<=250&&!large)return;
    const older=this.journal.runs.filter(row=>row.terminal&&!['cleanup_uncertain','storage_failed'].includes(row.terminal)&&(!row.calls||Array.isArray(row.callTimes)&&row.callTimes.length===row.calls)).slice(0,Math.max(0,this.journal.runs.length-(large?40:200)));if(!older.length)return;
    const indexed=new Set(this.indexRows().map(row=>row.id)),fresh=older.filter(row=>!indexed.has(row.id));
    for(let start=0;start<fresh.length;start+=200){const rows=fresh.slice(start,start+200).map(row=>this.summary(row)),file='history-'+String(this.runIndex.pages.length+1).padStart(8,'0')+'.json';this.write(file,{version:1,rows});this.runIndex.pages.push({file,count:rows.length});this.runIndex.count+=rows.length;}
    this.write('runs-index.json',this.runIndex);for(const row of older)if(row.requestId&&/^[a-f0-9-]{36}$/.test(row.requestId))this.write('request-'+row.requestId+'.json',this.summary(row));
    // Preserve exact daily debit times when completed rows leave the hot journal.
    this.journal.archivedCallTimes??=[];for(const row of older)if(!indexed.has(row.id))this.journal.archivedCallTimes.push(...(row.callTimes||[]));
    this.journal.archivedCallTimes=this.journal.archivedCallTimes.filter(at=>at>=this.clock()-72*3600000);
    const ids=new Set(older.map(row=>row.id));this.journal.runs=this.journal.runs.filter(row=>!ids.has(row.id));
  }
  saveJournal(){this.archiveJournal();this.write('journal.json',this.journal);}
  findRequest(requestId){return this.journal.runs.find(row=>row.requestId===requestId)||(/^[a-f0-9-]{36}$/.test(requestId||'')?this.read('request-'+requestId+'.json'):null);}
  accepted(role,contextId='current'){const id=contextId==='current'?this.heads[role]:this.contextHeads?.[contextId]?.[role];return id?this.read('report-'+id+'.json')?.payload:null;}
  commit(row,role,payload){const at=this.clock();for(const c of payload.report.conditions||[])if(c.kind==='deterministic'&&c.from<at)throw Error('condition_starts_before_registration:'+c.from+':'+new Date(at).toISOString());const id=crypto.randomUUID(),record={payload:{...payload,id,registeredAt:new Date(at).toISOString(),registrationBasis:'service-recorded'}};record.payload.conditionLedger=this.reportConditions(record.payload);record.hash=hash(record.payload);this.write('report-'+id+'.json',record);
    const oldAccepted={...row.accepted},oldCommits=[...(row.commits||[])];row.accepted??={};row.commits??=[];row.commits.push({role,id});row.accepted[role]=id;
    try{this.saveJournal();}catch(error){row.accepted=oldAccepted;row.commits=oldCommits;throw error;}const contextId=row.task?.contextId||row.contextId||'current';this.contextHeads??={};this.contextHeads[contextId]??={};this.contextHeads[contextId][role]=id;if(contextId==='current')this.heads[role]=id;this.write('heads.json',this.heads);this.write('context-heads.json',this.contextHeads);this.registerConditions(record.payload);return record.payload;}
  conditionFile(id){return 'condition-'+crypto.createHash('sha256').update(id).digest('hex')+'.json';}
  registerConditions(payload,save=true){this.conditions??={version:CONDITION_VERSION,pending:{}};for(const condition of payload.conditionLedger||[]){if(condition.kind!=='deterministic')continue;const old=this.read(this.conditionFile(condition.id));if(!old||!['triggered','expired'].includes(old.state)&&!old.supersededByReportId)this.conditions.pending[condition.id]=condition;
      if(condition.revisesConditionId){const superseded=this.conditions.pending[condition.revisesConditionId]||this.read(this.conditionFile(condition.revisesConditionId));if(superseded){if(save)this.write(this.conditionFile(condition.revisesConditionId),{...superseded,supersededByReportId:payload.id,active:false});delete this.conditions.pending[condition.revisesConditionId];}}
    }if(save)this.write('conditions-index.json',this.conditions);}
  pendingConditions(contextId){return Object.values(this.conditions?.pending||{}).filter(c=>c.contextId===contextId);}
  saveConditionCheck(check){if(check.kind!=='deterministic')return;this.write(this.conditionFile(check.id),check);if(['triggered','expired'].includes(check.state))delete this.conditions.pending[check.id];this.write('conditions-index.json',this.conditions);}
  summary({id,requestId,requestHash,question,asOf,startedAt,endedAt,terminal,status,reason,calls,callTimes,accepted,commits,source,task,contextId,taskMode,observation}){return {id,requestId,requestHash,question:question||'',asOf,startedAt,endedAt,status:terminal||status||'running',terminal:terminal||status||null,reason,calls,callTimes,accepted,commits,source,contextId:task?.contextId||contextId||'current',taskMode:task?.taskMode||taskMode||'current',observation:task?.observation??observation??null};}
  history(options){return this.historyPage(options||{limit:100}).runs;}
  queryHistory(options){return queryHistory(this,options);}
  historyPage({offset=0,limit=100,contextId=null}={}){if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200||contextId!==null&&!/^(current|task:[a-f0-9-]{36})$/.test(contextId))throw Error('invalid_history_page');
    let rows=this.journal.runs.slice().reverse().map(row=>this.summary(row));const ids=new Set(rows.map(row=>row.id));let total=rows.length;
    // Read only enough index pages for the requested slice unless filtering a context.
    for(const page of (this.runIndex?.pages||[]).slice().reverse()){const needs=contextId!==null||rows.length<offset+limit; if(needs){const extra=this.read(page.file,{rows:[]}).rows.slice().reverse().filter(row=>!ids.has(row.id));rows.push(...extra);extra.forEach(row=>ids.add(row.id));}total+=page.count;}
    if(contextId!==null){rows=rows.filter(row=>row.contextId===contextId);total=rows.length;}
    const runs=rows.slice(offset,offset+limit);return {version:1,runs,total,offset,limit,nextOffset:offset+runs.length<total?offset+runs.length:null};}
  reportConditions(payload){const explicit=payload.report.conditions||[];return [...explicit.map(c=>({...c,id:payload.id+':'+c.id})),...(payload.report.nextChecks||[]).map((text,index)=>({id:payload.id+':manual:'+index,text,kind:'manual',from:Date.parse(payload.asOf),to:null,deadline:null,revisesConditionId:null,criterion:null}))].map(c=>{const row={...c,version:CONDITION_VERSION,parentReportId:payload.id,parentCycleId:payload.cycleId,role:payload.role,contextId:payload.task?.contextId||'current',createdAt:payload.generatedAt,registeredAt:payload.registeredAt??null,registrationBasis:payload.registrationBasis??'unknown',state:'unknown',evidenceIds:[],reason:c.kind==='manual'?'自然语言建议尚未核查':'尚未取得检查证据'};return {...row,...conditionTiming(row)};});}
  release(){if(!this.owned)return;const owner=this.read('owner.json');if(owner?.instanceId===this.instanceId){fs.unlinkSync(this.file('owner.json'));this.owned=false;}}
}
