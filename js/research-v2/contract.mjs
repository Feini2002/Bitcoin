import '../content-identity.js';
export const identity = globalThis.BitContentIdentity;
export const VERSION = 'bitdesk.research.v2.2026-10-02.1';
export const ROLES = Object.freeze({
  structure: {name:'结构与成交', scopes:['chart','orderflow','heatmap']},
  derivatives: {name:'衍生品与波动率', scopes:['context']},
  macro: {name:'宏观与资金', scopes:['context']},
  events: {name:'事件与叙事', scopes:['events','analysis','materials']},
  challenger: {name:'反证审查', scopes:[]},
  synthesis: {name:'综合研究', scopes:[]},
});
export const FIRST_ROLES = ['structure','derivatives','macro','events'];
export const clone = value => JSON.parse(JSON.stringify(value));
export function freeze(value) { if(value && typeof value==='object' && !Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value; }
export function assert(condition, reason) { if(!condition) throw Error(reason); }
export const text = {type:'string'};
export const texts = {type:'array',items:text};
const object = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const array = properties => ({type:'array',items:object(properties)});
export const OUTPUT_SCHEMA = object({
  taskId:text,runId:text,snapshotId:text,role:{enum:Object.keys(ROLES)},stage:{enum:['first','challenge','response','synthesis']},
  summary:text,confidence:{enum:['low','medium','high']},probability:{type:['number','null'],minimum:0,maximum:1},
  probabilityStatus:{enum:['not_provided','raw_uncalibrated']},
  decision:{type:['string','null'],enum:['observe','conditional','insufficient',null]},
  claims:array({id:text,text,kind:{enum:['observation','inference','hypothesis']},evidenceRefs:texts,reasoning:text,counterEvidence:text}),
  challenges:array({id:text,targetRole:{enum:FIRST_ROLES},claimId:text,reason:text,evidenceRefs:texts}),
  responses:array({challengeId:text,disposition:{enum:['concede','revise','maintain']},explanation:text,replacementText:{type:['string','null']},evidenceRefs:texts}),
  scenarios:array({name:text,trigger:text,confirmation:text,invalidation:text,implication:text,evidenceRefs:texts}),
  dispositions:array({claimId:text,role:{enum:FIRST_ROLES},decision:{enum:['retain','revise','reject','unresolved']},reason:text,evidenceRefs:texts}),
  limitations:texts,nextObservations:texts,
});
export function outputSchemaForTask(task){
  const schema=clone(OUTPUT_SCHEMA),properties=schema.properties;
  for(const key of ['taskId','runId','snapshotId','role','stage'])properties[key]={type:'string',enum:[task[key]]};
  properties.probability={type:'null'};properties.probabilityStatus={type:'string',enum:['not_provided']};
  properties.decision=task.stage==='synthesis'?{type:'string',enum:['observe','conditional','insufficient']}:{type:'null'};
  if(!task.input.snapshot.analysisReady)properties.confidence={type:'string',enum:['low','medium']};
  const refs=[...new Set(task.input.observations.map(o=>o.id))];
  for(const key of ['claims','challenges','responses','scenarios','dispositions']){
    properties[key].maxItems=100;
    const evidence=properties[key].items.properties.evidenceRefs;
    if(refs.length)evidence.items={type:'string',enum:refs};else evidence.maxItems=0;
  }
  const enabled={first:['claims'],challenge:['challenges'],response:['responses'],synthesis:['claims','scenarios','dispositions']}[task.stage];
  assert(enabled,'unsupported_stage');
  for(const key of ['claims','challenges','responses','scenarios','dispositions'])if(!enabled.includes(key))properties[key].maxItems=0;
  if(task.stage==='first')properties.claims.minItems=1;
  if(task.stage==='response'){
    const assigned=task.input.dependencies.filter(d=>d.role==='challenger').flatMap(d=>d.output.challenges);
    properties.responses.minItems=assigned.length;properties.responses.maxItems=assigned.length;
    if(assigned.length)properties.responses.items.properties.challengeId={type:'string',enum:assigned.map(c=>c.id)};
  }
  if(task.stage==='synthesis'){
    properties.scenarios.minItems=2;properties.nextObservations.minItems=1;
    const claims=task.input.dependencies.filter(d=>d.stage==='first').flatMap(d=>d.output.claims);
    properties.dispositions.minItems=claims.length;properties.dispositions.maxItems=claims.length;
    if(claims.length)properties.dispositions.items.properties.claimId={type:'string',enum:claims.map(c=>c.id)};
  }
  return schema;
}
function schemaCheck(value,schema,path='output') {
  if(schema.enum) assert(schema.enum.includes(value),'invalid_enum:'+path);
  if(schema.type){const actual=value===null?'null':Array.isArray(value)?'array':typeof value;
    assert((Array.isArray(schema.type)?schema.type:[schema.type]).includes(actual),'invalid_type:'+path);
    if(actual==='number')assert(Number.isFinite(value)&&(schema.minimum==null||value>=schema.minimum)&&(schema.maximum==null||value<=schema.maximum),'invalid_number:'+path);
  }
  if(schema.properties){assert(value && typeof value==='object'&&!Array.isArray(value),'invalid_object:'+path);
    for(const key of schema.required)assert(Object.hasOwn(value,key),'missing_field:'+path+'.'+key);
    for(const key of Object.keys(value))assert(Object.hasOwn(schema.properties,key),'unknown_field:'+path+'.'+key);
    for(const [key,sub]of Object.entries(schema.properties))schemaCheck(value[key],sub,path+'.'+key);
  }
  if(schema.items){assert(value.length<=100,'too_many_items:'+path);value.forEach((item,i)=>schemaCheck(item,schema.items,path+'['+i+']'));}
  if(typeof value==='string')assert(value.length<=20000,'text_too_large:'+path);
}
export function validateOutput(task, output) {
  schemaCheck(output,OUTPUT_SCHEMA);
  for(const key of ['taskId','runId','snapshotId','role','stage'])assert(output[key]===task[key],'wrong_'+key);
  assert(output.summary.trim()&&output.limitations.length,'missing_summary_or_limitations');
  assert((output.probability===null)===(output.probabilityStatus==='not_provided'),'probability_label_mismatch');
  assert(output.probability===null,'probability_requires_registered_outcome');
  if(!task.input.snapshot.analysisReady)assert(output.confidence!=='high','incomplete_evidence_high_confidence');
  const valid=new Set(task.input.observations.map(o=>o.id));
  for(const group of ['claims','challenges','responses','scenarios','dispositions'])for(const item of output[group]){
    assert(item.evidenceRefs.every(ref=>valid.has(ref)),'invalid_evidence_reference');
    if(group==='claims')assert(item.evidenceRefs.length>0,'claim_without_evidence');
  }
  const unique=items=>new Set(items.map(x=>x.id)).size===items.length;
  assert(unique(output.claims)&&unique(output.challenges),'duplicate_claim_or_challenge');
  if(task.stage==='first')assert(FIRST_ROLES.includes(output.role)&&output.claims.length>0&&!output.challenges.length&&!output.responses.length&&!output.dispositions.length&&!output.scenarios.length&&output.decision===null,'first_stage_violation');
  if(task.stage==='challenge'){
    assert(!output.claims.length&&!output.responses.length&&!output.dispositions.length&&!output.scenarios.length&&output.decision===null,'challenge_stage_violation');
    const claims=task.input.dependencies.flatMap(d=>d.output.claims.map(c=>({role:d.role,...c})));
    for(const item of output.challenges)assert(claims.some(c=>c.role===item.targetRole&&c.id===item.claimId),'challenge_wrong_claim');
  }
  if(task.stage==='response'){
    assert(!output.claims.length&&!output.challenges.length&&!output.dispositions.length&&!output.scenarios.length&&output.decision===null,'response_stage_violation');
    const assigned=task.input.dependencies.filter(d=>d.role==='challenger').flatMap(d=>d.output.challenges);
    assert(output.responses.length===assigned.length&&new Set(output.responses.map(x=>x.challengeId)).size===assigned.length,'response_coverage_mismatch');
    for(const item of output.responses){assert(assigned.some(c=>c.id===item.challengeId&&c.targetRole===task.role),'response_wrong_challenge');assert(item.disposition!=='revise'||item.replacementText?.trim(),'revision_missing_text');}
  }
  if(task.stage==='synthesis'){
    assert(output.decision!==null&&!output.challenges.length&&!output.responses.length&&output.scenarios.length>0&&output.nextObservations.length>0,'synthesis_incomplete');
    const claims=task.input.dependencies.filter(d=>d.stage==='first').flatMap(d=>d.output.claims.map(c=>({role:d.role,...c})));
    assert(output.dispositions.length===claims.length,'synthesis_claim_coverage');
    assert(new Set(output.dispositions.map(x=>x.role+':'+x.claimId)).size===claims.length,'duplicate_disposition');
    const ledger=effectiveClaims(task.input.dependencies);
    for(const claim of output.claims)assert(!ledger.some(c=>['withdrawn','revised'].includes(c.state)&&claim.text===c.originalText),'obsolete_claim_reintroduced');
    for(const item of output.dispositions){
      const effective=ledger.find(c=>c.role===item.role&&c.claimId===item.claimId);
      assert(effective,'disposition_wrong_claim');
      if(effective.state==='withdrawn')assert(item.decision==='reject','withdrawn_claim_retained');
      if(effective.state==='unresolved')assert(item.decision==='unresolved'||item.decision==='reject','unresolved_challenge_erased');
      if(effective.state==='revised'){
        assert(['revise','reject','unresolved'].includes(item.decision),'old_revision_retained');
        if(item.decision==='revise')assert(item.reason.includes(effective.effectiveText),'revision_text_not_bound');
      }
      if(effective.challenges.length)assert(item.reason.trim().length>0,'missing_challenge_disposition_reason');
    }
    if(!task.input.snapshot.analysisReady)assert(output.confidence!=='high','incomplete_evidence_high_confidence');
  }
  return true;
}
export function effectiveClaims(dependencies){
  const challenge=dependencies.find(d=>d.stage==='challenge')?.output.challenges||[];
  return dependencies.filter(d=>d.stage==='first').flatMap(d=>d.output.claims.map(claim=>{
    const assigned=challenge.filter(c=>c.targetRole===d.role&&c.claimId===claim.id);
    const responses=dependencies.filter(r=>r.stage==='response'&&r.role===d.role).flatMap(r=>r.output.responses).filter(r=>assigned.some(c=>c.id===r.challengeId));
    const withdrawn=responses.some(r=>r.disposition==='concede');
    const revisions=[...new Set(responses.filter(r=>r.disposition==='revise').map(r=>r.replacementText))];
    const unresolved=assigned.some(c=>!responses.some(r=>r.challengeId===c.id)||responses.some(r=>r.challengeId===c.id&&r.disposition==='maintain'))||revisions.length>1;
    const state=withdrawn?'withdrawn':unresolved?'unresolved':revisions.length?'revised':'unchallenged';
    const value={role:d.role,claimId:claim.id,originalText:claim.text,effectiveText:withdrawn?null:revisions.length===1?revisions[0]:claim.text,state,challenges:clone(assigned),responses:clone(responses)};
    return {...value,effectiveClaimHash:identity.contentId(value)};
  }));
}
