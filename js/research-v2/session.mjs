import {VERSION,identity,clone,assert} from './contract.mjs';
import {validateSnapshot} from './snapshot.mjs';
import {createRun,createTask,receiveOutput} from './workflow.mjs';
export function exportSession(run){const content={schema:'bitdesk.research.session.v2',run:clone(run)};return {...content,contentHash:identity.contentId(content)};}
export function restoreSession(input){
  assert(input?.schema==='bitdesk.research.session.v2'&&input.run?.schema===VERSION,'wrong_session_version');
  const {contentHash,...content}=input;assert(identity.contentId(content)===contentHash,'session_hash_mismatch');
  const original=input.run;validateSnapshot(original.snapshot);
  const replay=createRun(original.snapshot,{mode:original.mode,runId:original.runId,promptVersion:original.promptVersion||VERSION});
  for(const old of original.tasks){
    const task=createTask(replay,old.role);assert(task.taskId===old.taskId&&task.promptHash===old.promptHash&&task.inputHash===old.inputHash&&task.prompt===old.prompt&&identity.contentId(old.input)===task.inputHash,'task_restore_mismatch');
    if(old.receipt){assert(identity.contentId(old.receipt.output)===old.receipt.outputHash,'output_restore_mismatch');receiveOutput(replay,task.taskId,old.receipt.output,old.receipt.provenance);}
  }
  if(!['failed','cancelled'].includes(original.status))assert(replay.status===original.status,'stage_restore_mismatch');
  // Hashes establish consistency only. Provenance assertions are not independent provider verification.
  const restored=clone(original);
  restored.tasks=restored.tasks.map((old,i)=>({...old,input:clone(replay.tasks[i].input),prompt:replay.tasks[i].prompt}));
  return restored;
}
