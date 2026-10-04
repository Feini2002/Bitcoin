import {VERSION,FIRST_ROLES,ROLES,identity,clone,assert,validateOutput,effectiveClaims} from './contract.mjs';
import {validateSnapshot} from './snapshot.mjs';
import {buildPrompt,PROMPT_VERSION,PROMPT_VERSIONS} from './prompts.mjs';
import {validateSynthesisReview,buildSynthesisReview} from './synthesis-review.mjs';
export function createRun(snapshot,{mode='codex_cli',runId=crypto.randomUUID(),promptVersion=PROMPT_VERSION}={}){
  validateSnapshot(snapshot);assert(['codex_cli','codex_native','manual','mock','replay'].includes(mode),'unsupported_mode');
  assert(PROMPT_VERSIONS.includes(promptVersion),'unsupported_prompt_version');
  return {schema:VERSION,promptVersion,runId,mode,status:'first',createdAt:new Date().toISOString(),completedAt:null,snapshot:clone(snapshot),tasks:[],audit:[],failure:null};
}
export function pendingRoles(run){
  const done=role=>run.tasks.some(t=>t.stage===run.status&&t.role===role&&t.receipt);
  if(run.status==='first')return FIRST_ROLES.filter(r=>!done(r));
  if(run.status==='challenge')return done('challenger')?[]:['challenger'];
  if(run.status==='response'){const challenged=[...new Set(run.tasks.find(t=>t.stage==='challenge').receipt.output.challenges.map(c=>c.targetRole))];return challenged.filter(r=>!done(r));}
  if(run.status==='synthesis')return done('synthesis')?[]:['synthesis'];return [];
}
function dependencies(run,role){
  const all=run.tasks.filter(t=>t.receipt).map(t=>({role:t.role,stage:t.stage,output:clone(t.receipt.output)}));
  if(run.status==='first')return [];
  if(run.status==='challenge')return all.filter(t=>t.stage==='first');
  if(run.status==='response')return all.filter(t=>t.stage==='first'&&t.role===role||t.stage==='challenge').map(t=>t.stage==='challenge'?{...t,output:{...t.output,challenges:t.output.challenges.filter(c=>c.targetRole===role)}}:t);
  return all;
}
export function createTask(run,role){
  assert(!['cancelled','failed','complete'].includes(run.status),'run_not_active');
  assert(pendingRoles(run).includes(role),'role_not_pending');
  const existing=run.tasks.find(t=>t.stage===run.status&&t.role===role);if(existing)return clone(existing);
  const scopes=ROLES[role].scopes;
  const observations=run.status==='first'?run.snapshot.observations.filter(o=>scopes.includes(o.scope)):run.snapshot.observations;
  const input={question:run.snapshot.question,snapshot:{snapshotId:run.snapshot.snapshotId,asOf:run.snapshot.bundle.asOf,knowledgeCutoff:run.snapshot.bundle.knowledgeCutoff,capturedAt:run.snapshot.capturedAt,atomicSnapshot:false,analysisReady:run.snapshot.bundle.analysisReady,
    capabilities:run.snapshot.bundle.capabilityReadiness,limitations:run.snapshot.bundle.limitations,entries:run.snapshot.bundle.entries.map(({name,transportOk,reason,quality,coverage,cutoffApplied,asOfApplied,schemaVersion})=>({name,transportOk,reason,quality,coverage,cutoffApplied,asOfApplied,schemaVersion}))},observations:clone(observations),dependencies:dependencies(run,role)};
  if(run.status==='synthesis'){
    input.effectiveClaims=effectiveClaims(input.dependencies);
    input.synthesisContract='逐条依据 effectiveClaims：withdrawn 只能 reject；unresolved 只能 unresolved 或 reject；revised 不得 retain，选 revise 时 reason 必须逐字包含 effectiveText。同一主张多个不一致修订保留 unresolved。未预注册预测命题，本轮 probability 必须 null，probabilityStatus 必须 not_provided。';
  }
  const base={runId:run.runId,snapshotId:run.snapshot.snapshotId,role,stage:run.status,mode:run.mode,input,inputHash:identity.contentId(input)};
  const task={...base,taskId:identity.contentId(base),createdAt:new Date().toISOString(),receipt:null};
  Object.assign(task,buildPrompt(task,{version:run.promptVersion||VERSION}));run.tasks.push(task);run.audit.push({at:task.createdAt,event:'task_created',taskId:task.taskId,role,stage:task.stage,promptHash:task.promptHash,inputHash:task.inputHash});return clone(task);
}
export function receiveOutput(run,taskId,output,provenance){
  assert(!['cancelled','failed','complete'].includes(run.status),'run_not_active');
  const task=run.tasks.find(t=>t.taskId===taskId);assert(task&&task.stage===run.status,'wrong_or_late_task');assert(!task.receipt,'duplicate_receipt');
  assert(provenance?.mode===run.mode,'wrong_output_mode');
  if(run.mode==='codex_cli')assert(provenance.auth==='chatgpt'&&provenance.completed===true&&provenance.threadId,'unverified_codex_completion');
  if(run.mode==='codex_native')assert(provenance.agentId&&provenance.completed===true,'missing_native_agent_receipt');
  validateOutput(task,output);
  if(task.stage==='synthesis'&&run.mode==='codex_cli'&&run.promptVersion!==VERSION){
    const review=provenance.semanticAudit;
    assert(review?.provenance?.auth==='chatgpt'&&review.provenance.completed===true&&review.provenance.threadId,'missing_synthesis_semantic_review');
    const rebuilt=buildSynthesisReview(task,output,review.input?.requestedAt);
    assert(review.version===rebuilt.version&&review.auditId===rebuilt.auditId&&identity.contentId(review.input)===identity.contentId(rebuilt.input),'synthesis_audit_input_mismatch');
    assert(rebuilt.promptHash===review.promptHash,'synthesis_audit_prompt_mismatch');
    validateSynthesisReview(task,output,rebuilt,review.output);assert(review.output.verdict==='accept','synthesis_semantic_review_rejected');
  }
  task.receipt={receivedAt:new Date().toISOString(),output:clone(output),outputHash:identity.contentId(output),provenance:clone(provenance)};
  run.audit.push({at:task.receipt.receivedAt,event:'output_received',taskId,role:task.role,stage:task.stage,outputHash:task.receipt.outputHash,provenance:clone(provenance)});
  if(!pendingRoles(run).length){
    run.status={first:'challenge',challenge:'response',response:'synthesis',synthesis:'complete'}[run.status];
    if(run.status==='response'&&!pendingRoles(run).length)run.status='synthesis';
    if(run.status==='complete')run.completedAt=new Date().toISOString();
    run.audit.push({at:new Date().toISOString(),event:'stage_changed',status:run.status});
  }
  return task.receipt;
}
export function cancelRun(run,reason='user_cancelled'){
  if(run.status==='complete')return;run.status='cancelled';run.failure=reason;run.audit.push({at:new Date().toISOString(),event:'cancelled',reason});
}
export function failRun(run,error){run.status='failed';run.failure=String(error?.message||error);run.audit.push({at:new Date().toISOString(),event:'failed',reason:run.failure});}
export function resumeFailedRun(run){
  assert(run.status==='failed','only_failed_run_can_resume');
  assert(!run.tasks.some(t=>t.stage==='synthesis'&&t.receipt),'completed_run_cannot_resume');
  const received=(role,stage)=>run.tasks.some(t=>t.role===role&&t.stage===stage&&t.receipt);
  let stage='first';
  if(FIRST_ROLES.every(role=>received(role,'first'))){
    stage='challenge';const challenge=run.tasks.find(t=>t.stage==='challenge'&&t.receipt);
    if(challenge){const assigned=[...new Set(challenge.receipt.output.challenges.map(c=>c.targetRole))];stage=assigned.some(role=>!received(role,'response'))?'response':'synthesis';}
  }
  const previousFailure=run.failure;run.status=stage;run.failure=null;run.completedAt=null;
  run.audit.push({at:new Date().toISOString(),event:'resumed',stage,previousFailure,policy:'Reuse sealed inputs and accepted receipts; only unfinished tasks are retried.'});return run;
}
