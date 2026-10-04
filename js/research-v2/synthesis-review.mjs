import {identity,assert} from './contract.mjs';
export const REVIEW_VERSION='bitdesk.research.synthesis-review.2026-10-02.1';
const object=properties=>({type:'object',additionalProperties:false,properties,required:Object.keys(properties)});
const string={type:'string'};
export const REVIEW_SCHEMA=object({auditId:string,taskId:string,outputHash:string,verdict:{type:'string',enum:['accept','reject']},summary:string,
  basis:{type:'array',items:object({role:string,claimId:string,effectiveClaimHash:string,disposition:string})},
  issues:{type:'array',items:object({location:string,claimId:{type:['string','null']},reason:string,evidenceRefs:{type:'array',items:string}})}});
export function buildSynthesisReview(task,output,requestedAt=new Date().toISOString()){
  const input={version:REVIEW_VERSION,taskId:task.taskId,outputHash:identity.contentId(output),requestedAt,
    input:task.input,candidate:output};
  const auditId=identity.contentId(input);
  const prompt=['你是综合研究的独立语义审查角色，仅使用下方封存输入，不使用工具/联网/文件/额外模型。输出严格JSON。',
    '逐条重建effectiveClaims和dispositions，以role/claimId/effectiveClaimHash返回全部basis。withdrawn不得作为支持；revised必须使用effectiveText；unresolved不得写成已确认。检查candidate全部claims、summary、scenarios、nextObservations是否通过同义改写重新引入被撤回/修订的旧判断；不要只比较字符串。',
    '核对引用原值、产品、单位、观察/推断、因果、最强反证、缺覆盖与实际requestedAt。相对冻结参考的未来窗口不等于现在未来；没有后续数据只能说未核验，不能断言未触发。无依据方向/行动、错单位、抹去分歧、错误时间结论都reject并给精确位置。小措辞不影响事实的限制不制造问题。审查一致不代表独立市场证据、PIT或已验证胜率。',
    '身份逐字返回 '+JSON.stringify({auditId,taskId:task.taskId,outputHash:input.outputHash}),
    'verdict accept必须issues为空；reject至少一条。basis必须完整一一对应effectiveClaims，无重复。',
    'INPUT '+JSON.stringify(input),'OUTPUT_SCHEMA '+JSON.stringify(REVIEW_SCHEMA)].join('\n\n');
  return {auditId,input,prompt,promptHash:identity.sha256(prompt),version:REVIEW_VERSION};
}
export function validateSynthesisReview(task,output,review,audit){
  assert(audit?.auditId===review.auditId&&audit.taskId===task.taskId&&audit.outputHash===identity.contentId(output),'synthesis_audit_identity_mismatch');
  assert(['accept','reject'].includes(audit.verdict)&&typeof audit.summary==='string'&&audit.summary.trim()&&Array.isArray(audit.basis)&&Array.isArray(audit.issues),'invalid_synthesis_audit');
  const ledger=task.input.effectiveClaims||[],seen=new Set();
  assert(audit.basis.length===ledger.length,'synthesis_audit_incomplete_basis');
  for(const basis of audit.basis){const key=basis.role+':'+basis.claimId,claim=ledger.find(c=>c.role===basis.role&&c.claimId===basis.claimId),disposition=output.dispositions.find(d=>d.role===basis.role&&d.claimId===basis.claimId);
    assert(claim&&!seen.has(key)&&basis.effectiveClaimHash===claim.effectiveClaimHash&&basis.disposition===disposition?.decision,'synthesis_audit_basis_mismatch');seen.add(key);}
  const refs=new Set(task.input.observations.map(o=>o.id));
  for(const issue of audit.issues)assert(typeof issue.location==='string'&&issue.location&&typeof issue.reason==='string'&&issue.reason&&Array.isArray(issue.evidenceRefs)&&issue.evidenceRefs.every(r=>refs.has(r)),'invalid_synthesis_audit_issue');
  assert(audit.verdict==='accept'?audit.issues.length===0:audit.issues.length>0,'synthesis_audit_verdict_mismatch');
  return audit;
}
