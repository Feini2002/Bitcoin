import '../content-identity.js';
import '../research-protocol.js';
export const VERSION='bitdesk.agent-team.2026-10-05.27';
export const TASK_VERSION='bitdesk.agent-task.v1';
export const CONDITION_VERSION='bitdesk.agent-conditions.v1';
const CONDITION_FIELD_UNITS={open:'USDT/BTC',high:'USDT/BTC',low:'USDT/BTC',close:'USDT/BTC',baseVolume:'BTC',quoteVolume:'USDT',takerBuyBase:'BTC',takerBuyQuote:'USDT',trades:'count'};
export const TASK_CAPABILITIES={version:TASK_VERSION,executable:true,taskModes:['current','window','narrative'],products:['perpetual','spot'],views:['chart','orderflow','derivatives','macro','events','heatmap'],timeframes:['5m','15m','1h','4h','1d','3d','1w'],orderflowTimeframes:['5m','15m','1h','4h'],materialSources:['agent-report','legacy-report','stored-event','discovered-event','provided-event','provided-report'],historyFormats:['agent-team','research.v1','legacy-research'],limits:{bodyBytes:65536,questionChars:2000,materialRefs:8,providedMaterials:2,windowHours:2160,modelRows:200,footprintNativeRows:240},conditions:{version:CONDITION_VERSION,deterministic:'closed Binance kline threshold; complete range required for negative/expiry',manual:'unknown until explicit research; no invented natural-language matching'}};
const exact=(value,keys,error)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw Error(error);};
const clockValue=value=>Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000;
const contentHash=value=>globalThis.BitContentIdentity.contentId(value);
export function conditionTiming(c={}){const recorded=typeof c.registeredAt==='string'&&Number.isFinite(Date.parse(c.registeredAt)),generated=typeof c.createdAt==='string'&&Number.isFinite(Date.parse(c.createdAt)),registeredAt=recorded?c.registeredAt:null,timingReferenceAt=registeredAt||(generated?c.createdAt:null),registrationBasis=recorded&&c.registrationBasis==='service-recorded'?'service-recorded':generated?'legacy-report-generated-at':'unknown',at=Date.parse(timingReferenceAt),valid=Number.isFinite(at)&&Number.isSafeInteger(c.from)&&Number.isSafeInteger(c.to),registrationWindowRelation=!valid?'unknown':at<=c.from?'before_window':at<=c.to?'during_window':'after_window',forwardRegistered=registrationBasis==='service-recorded'&&registrationWindowRelation==='before_window';return {registeredAt,timingReferenceAt,registrationBasis,registrationWindowRelation,timingQualification:!valid?'unknown':registrationWindowRelation==='during_window'?'during_window':registrationWindowRelation==='after_window'?'retrospective':forwardRegistered?'forward':'unknown',forwardRegistered};}
export function normalizeTaskRequest(input={}){
  exact(input,['requestId','question','taskMode','observation','materialRefs','providedMaterials','clientObservedAt'],'invalid_run_request');
  if(!/^[a-f0-9-]{36}$/.test(input.requestId||''))throw Error('invalid_request_id');
  const taskMode=input.taskMode||'current',question=input.question??'';
  if(!TASK_CAPABILITIES.taskModes.includes(taskMode)||typeof question!=='string'||question.length>2000)throw Error('invalid_task_or_question');
  const observation=input.observation??null;
  if(observation){exact(observation,['exchange','symbol','product','view','timeframe','from','to','liquidationRange'],'invalid_observation_fields');
    if(observation.exchange!=='binance'||observation.symbol!=='BTCUSDT'||!TASK_CAPABILITIES.products.includes(observation.product)||!TASK_CAPABILITIES.views.includes(observation.view)||!TASK_CAPABILITIES.timeframes.includes(observation.timeframe))throw Error('unsupported_observation');
    if(observation.product==='spot'&&(observation.view!=='chart'||observation.timeframe!=='1h'))throw Error('unsupported_spot_range');
    if(observation.view==='orderflow'&&!TASK_CAPABILITIES.orderflowTimeframes.includes(observation.timeframe))throw Error('unsupported_orderflow_timeframe');
    if(!clockValue(observation.from)||!clockValue(observation.to)||observation.from>observation.to||observation.to-observation.from>2160*3600000)throw Error('invalid_observation_window');
    if(observation.liquidationRange!==undefined&&!['1h','4h','24h','7d','30d'].includes(observation.liquidationRange))throw Error('unsupported_liquidation_range');
  }
  if(taskMode==='current'&&observation)throw Error('current_observation_not_allowed');
  if(taskMode==='window'&&!observation)throw Error('window_observation_required');
  const materialRefs=input.materialRefs??[],providedMaterials=input.providedMaterials??[];
  if(!Array.isArray(materialRefs)||materialRefs.length>8||!Array.isArray(providedMaterials)||providedMaterials.length>2)throw Error('material_limit');
  for(const m of [...materialRefs,...providedMaterials]){
    const provided=providedMaterials.includes(m);exact(m,provided?['source','id','contentHash','content','parentReportId']:['source','id','contentHash','version'],'invalid_material_fields');
    if(!(provided?['provided-event','provided-report']:['agent-report','legacy-report','stored-event','discovered-event']).includes(m.source)||typeof m.id!=='string'||!m.id||m.id.length>200||!/^sha256:[a-f0-9]{64}$/.test(m.contentHash||''))throw Error('invalid_material_identity');
    if(m.version!==undefined&&(typeof m.version!=='string'||m.version.length>200))throw Error('invalid_material_version');
    if(provided){if(contentHash(m.content)!==m.contentHash)throw Error('provided_material_hash_mismatch');validateProvidedMaterial(m);}
  }
  if(new Set([...materialRefs,...providedMaterials].map(m=>m.source+':'+m.id)).size!==materialRefs.length+providedMaterials.length)throw Error('duplicate_material');
  if(taskMode==='narrative'&&!materialRefs.length&&!providedMaterials.length)throw Error('narrative_material_required');
  if(input.clientObservedAt!==undefined&&(!clockValue(input.clientObservedAt)&&!(typeof input.clientObservedAt==='string'&&Number.isFinite(Date.parse(input.clientObservedAt)))))throw Error('invalid_client_observed_at');
  const request={requestId:input.requestId,question,taskMode,observation:observation?structuredClone(observation):null,materialRefs:structuredClone(materialRefs),providedMaterials:structuredClone(providedMaterials),clientObservedAt:input.clientObservedAt??null};
  if(new TextEncoder().encode(globalThis.BitContentIdentity.canonical(request)).length>65536)throw Error('request_too_large');return request;
}
export function validateProvidedMaterial(m){
  const c=m.content,report=m.source==='provided-event'?c?.originalReport:c;
  if(m.parentReportId!==undefined&&m.parentReportId!==null&&(typeof m.parentReportId!=='string'||m.parentReportId.length>200))throw Error('invalid_parent_report');
  if(m.source==='provided-event'&&c?.kind==='legacy_report_event'){
    exact(c,['kind','entryId','legacyGroup','legacyIndex','title','url','accessedAt','publicAvailableAt','event','reportId','reportKind','reportAsOf','reportContentId','originalReport'],'invalid_provided_event');
    const groups={daily_event:['topStories','dynamicBriefs','aiIntel','githubTools'],sentiment_analysis:['riskRadar','opportunityScanner','eventCalendar']},body=report?.report,entries=body?.[c.legacyGroup];
    if(!groups[report?.kind]?.includes(c.legacyGroup)||!Number.isSafeInteger(c.legacyIndex)||c.legacyIndex<0||!Array.isArray(entries)||!entries[c.legacyIndex]||typeof entries[c.legacyIndex]!=='object'||Array.isArray(entries[c.legacyIndex])||typeof report.id!=='string'||!report.id||!Number.isFinite(Date.parse(report.generatedAt))||!body||body.schemaVersion!==undefined||report.schemaVersion!==undefined)throw Error('invalid_legacy_event_parent');
    if(m.id!==c.entryId||c.entryId!==`legacy:${c.legacyGroup}:${c.legacyIndex}`||m.parentReportId!==c.reportId||![report.id,'local:'+contentHash(report)].includes(c.reportId)||c.reportKind!==report.kind||c.reportAsOf!==null||c.reportContentId!==contentHash(report)||!Number.isFinite(Date.parse(c.accessedAt))||c.publicAvailableAt!==null)throw Error('provided_event_identity_mismatch');
    if(contentHash(entries[c.legacyIndex])!==contentHash(c.event))throw Error('provided_event_not_in_parent');return true;
  }
  const errors=globalThis.ResearchProtocol.validate(report);if(errors.length)throw Error('provided_report_schema:'+errors[0]);
  if(m.source==='provided-event'){
    exact(c,['kind','title','url','accessedAt','publicAvailableAt','event','reportId','reportKind','reportAsOf','reportContentId','originalReport'],'invalid_provided_event');
    if(c.kind!=='report_event'||m.id!==c.event?.id||m.parentReportId!==c.reportId||c.reportKind!==report.kind||c.reportAsOf!==report.report.asOf||c.reportContentId!==contentHash(report)||typeof c.reportId!=='string'||!c.reportId||!Number.isFinite(Date.parse(c.accessedAt))||c.publicAvailableAt!==null&& !Number.isFinite(Date.parse(c.publicAvailableAt)))throw Error('provided_event_identity_mismatch');
    const original=[...report.report.events,...report.report.catalysts].find(e=>e.id===m.id);if(!original||contentHash(original)!==contentHash(c.event))throw Error('provided_event_not_in_parent');
  }else if(report.id&&report.id!==m.id||m.source==='provided-report'&&m.parentReportId!==undefined&&m.parentReportId!==(report.report.parentReportId??null))throw Error('provided_report_identity_mismatch');
  return true;
}
export const ROLES={
  env:{name:'环境评估员',area:'行情结构、成交、波动与多周期变化',datasets:['binance-perp-klines-15m','binance-perp-klines-1h','binance-perp-klines-4h','binance-spot-klines-1h']},
  flow:{name:'盘口流动性官',area:'可见盘口深度、价差与成交响应',datasets:['binance-perp-book','binance-perp-taker','binance-perp-klines-15m']},
  deriv:{name:'衍生品情报官',area:'持仓、费率、基差与杠杆变化',datasets:['binance-perp-oi','binance-perp-oi-history','binance-perp-funding','binance-perp-premium','binance-perp-basis','binance-perp-top-positions','binance-perp-accounts']},
  macro:{name:'宏观研究员',area:'利率、美元与宏观发布条件',datasets:['fred-dgs2','fred-dgs10','fred-real10y','fred-dollar','fred-fed-assets','fred-rrp','fred-tga']},
  events:{name:'事件与舆情研究员',area:'原文、事件真实性、传播与市场验证',datasets:[]},
};
const str={type:'string',maxLength:4000}, arr=(items,maxItems=12)=>({type:'array',items,maxItems});
const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const REPORT_SCHEMA=obj({status:{type:'string',enum:['sufficient','limited','insufficient']},summary:str,changes:arr(str),claims:arr(obj({id:str,text:str,kind:{type:'string',enum:['fact','inference','hypothesis']},scope:{type:'string',enum:['current','history','comparison']},baselineReportIds:arr(str),evidenceIds:arr(str),numbers:arr(obj({evidenceId:str,path:str,value:{type:'number'},unit:str}),32)})),counterevidence:arr(str),nextChecks:arr(str),viewChange:obj({action:{type:'string',enum:['initial','maintain','revise','withdraw','insufficient']},reason:str,previousReportId:{anyOf:[str,{type:'null'}]}})});
// Additive: saved legacy reports remain valid and are never rewritten.
export const CONDITION_SCHEMA=obj({id:{type:'string',maxLength:200},text:str,kind:{type:'string',enum:['deterministic','manual']},from:{type:'integer',minimum:0,maximum:8640000000000000},to:{type:'integer',minimum:0,maximum:8640000000000000},deadline:{type:'integer',minimum:0,maximum:8640000000000000},revisesConditionId:{anyOf:[{type:'string',maxLength:200},{type:'null'}]},criterion:{anyOf:[obj({dataset:str,field:{type:'string',enum:['open','high','low','close','baseVolume','quoteVolume','takerBuyBase','takerBuyQuote','trades']},operator:{type:'string',enum:['gt','gte','lt','lte','eq']},value:{type:'number'},unit:str,evidenceId:str,path:str}),{type:'null'}]}});
REPORT_SCHEMA.properties.conditions=arr(CONDITION_SCHEMA);
REPORT_SCHEMA.properties.researchProgress=arr(obj({todoId:str,state:{type:'string',enum:['completed','unresolved','capability_bound']},reason:str,evidenceIds:arr(str)}));
export function roleDatasets(role){return [...new Set([...ROLES[role].datasets,...TASK_CAPABILITIES.timeframes.map(t=>'binance-perp-klines-'+t)])];}
export function modelSchema(schema){const copy=structuredClone(schema);const visit=s=>{if(s.properties){s.required=Object.keys(s.properties);Object.values(s.properties).forEach(visit);}if(s.items)visit(s.items);s.anyOf?.forEach(visit);};visit(copy);return copy;}
export function decisionSchema(role,finalOnly=false){return modelSchema(obj({kind:{type:'string',enum:finalOnly?['final','insufficient']:['tools','final','insufficient']},reason:str,tools:{type:'array',maxItems:2,items:obj({tool:{type:'string',enum:role==='events'?['events','article','market']:role==='flow'?['dataset','market','footprint','liquidations']:['dataset','market']},dataset:{type:'string',enum:['',...roleDatasets(role)]},limit:{type:'integer',minimum:1,maximum:200},windowHours:{type:'integer',minimum:1,maximum:2160},articleId:str})},report:{anyOf:[REPORT_SCHEMA,{type:'null'}]}}));}
export const CHIEF_SCHEMA=obj({...REPORT_SCHEMA.properties,disagreements:arr(str),dispositions:arr(obj({role:{type:'string',enum:Object.keys(ROLES)},treatment:{type:'string',enum:['adopt','reject','uncertain','missing']},reason:str})),clarifications:{type:'array',maxItems:1,items:obj({role:{type:'string',enum:Object.keys(ROLES)},question:str})}});
CHIEF_SCHEMA.required=CHIEF_SCHEMA.required.filter(key=>!['conditions','researchProgress'].includes(key));
export const REVIEW_SCHEMA=obj({verdict:{type:'string',enum:['accept','revise']},issues:arr(str)});
export function validateSchema(value,schema,location='$'){
  if(schema.anyOf){if(schema.anyOf.some(s=>{try{validateSchema(value,s,location);return true;}catch{return false;}}))return;throw Error('schema_union:'+location);}
  if(schema.enum&&!schema.enum.includes(value))throw Error('schema_enum:'+location);
  if(schema.type==='null'){if(value!==null)throw Error('schema_null:'+location);return;}
  if(schema.type==='object'){
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('schema_object:'+location);
    for(const key of schema.required||[])if(!Object.hasOwn(value,key))throw Error('schema_required:'+location+'.'+key);
    for(const key of Object.keys(value)){if(!schema.properties[key])throw Error('schema_extra:'+location+'.'+key);validateSchema(value[key],schema.properties[key],location+'.'+key);}return;
  }
  if(schema.type==='array'){if(!Array.isArray(value)||value.length>(schema.maxItems??Infinity)||value.length<(schema.minItems??0))throw Error('schema_array:'+location);value.forEach((x,i)=>validateSchema(x,schema.items,location+'['+i+']'));return;}
  if(schema.type==='string'&&(typeof value!=='string'||value.length>(schema.maxLength??Infinity)))throw Error('schema_string:'+location);
  if(['number','integer'].includes(schema.type)&&(typeof value!=='number'||!Number.isFinite(value)||(schema.type==='integer'&&!Number.isInteger(value))||value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity)))throw Error('schema_number:'+location);
}
export function fieldAt(data,key){if(!/^[\w.]+$/.test(key))throw Error('invalid_numeric_path');return key.split('.').reduce((v,k)=>v?.[k],data);}
const UTC_TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
function timestampValue(value){if(typeof value!=='string'||!UTC_TIME.test(value))return null;const at=Date.parse(value);return Number.isFinite(at)&&new Date(at).toISOString().slice(0,19)===value.slice(0,19)?at:null;}
function printedUtcTime(value){
  // Actual RSS and Chinese UTC spellings identify a clock, never certify when
  // an article became public. Unknown zones and invalid calendars stay unknown.
  const rss=/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat), (\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) (?:\+0000|GMT)$/.exec(value),cn=/^(\d{4})年(\d{1,2})月(\d{1,2})日(\d{2}):(\d{2})(?::(\d{2}))?(?:（UTC）|\(UTC\))$/.exec(value);
  if(!rss&&!cn)return null;
  const year=rss?rss[4]:cn[1],month=rss?['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(rss[3])+1:Number(cn[2]),day=rss?rss[2]:cn[3],hour=rss?rss[5]:cn[4],minute=rss?rss[6]:cn[5],second=rss?rss[7]:cn[6]||'00',pad=v=>String(v).padStart(2,'0');
  const at=timestampValue(year+'-'+pad(month)+'-'+pad(day)+'T'+pad(hour)+':'+pad(minute)+':'+pad(second)+'Z');
  return at!==null&&(!rss||['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(at).getUTCDay()]===rss[1])?at:null;
}
function calendarDay(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;const at=Date.parse(value+'T00:00:00Z');return Number.isFinite(at)&&new Date(at).toISOString().slice(0,10)===value?value:null;}
function hasUnreferencedDigits(text,receipts,numbers=[]){
  // Only registered clock fields of this claim's cited receipts can support a
  // temporal identifier. This never supplies a market value or changes text.
  const times=new Set(),days=new Set(),add=value=>{const at=typeof value==='number'&&clockValue(value)?value:timestampValue(value);if(at!==null){times.add(at);days.add(new Date(at).toISOString().slice(0,10));}const day=calendarDay(value);if(day)days.add(day);};
  for(const r of receipts){
    for(const key of ['asOf','requestedAt','receivedAt'])add(r[key]);
    for(const key of ['asOf','observedAt','publicAvailableAt','marketWindowEnd'])add(r.sourceClock?.[key]);
    for(const storedRow of Object.values(r.data?.observations||{}).filter(Boolean)){
      const row={...r.data?.rowDefaults,...storedRow};
      for(const key of ['observedAt','receivedAt','effectiveReceivedAt','publicAvailableAt','publishedAt'])add(row[key]);
      for(const key of ['openTime','closeTime'])add(row.values?.[key]);
      // A returned FRED version is a calendar identifier, not a publication
      // clock. Recognizing its literal date never qualifies public availability.
      if(/^fred-/.test(r.request?.dataset||''))for(const key of ['realtimeStart','realtimeEnd']){const day=calendarDay(row.sourceRevision?.[key]);if(day)days.add(day);}
    }
    for(const w of [...r.data?.analysis?.windows||[],...r.data?.analysis?.comparisons||[]])for(const key of ['from','to','volumeBaselineFrom','volumeBaselineTo'])add(w[key]);
    if(['selected-material','events'].includes(r.request?.tool)){
      for(const item of Array.isArray(r.data?.items)?r.data.items:[])for(const key of ['occurredAt','publishedAt','publicAvailableAt'])add(item[key]);
      if(r.request.tool==='selected-material')for(const key of ['asOf','publicAvailableAt'])add(r.data?.material?.[key]);
    }
  }
  let remainder=text.replace(/(?<![\w.+-])(?:(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat), \d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} (?:\+0000|GMT)|\d{4}年\d{1,2}月\d{1,2}日\d{2}:\d{2}(?::\d{2})?(?:（UTC）|\(UTC\)))(?![\w+-])/g,token=>{const at=printedUtcTime(token);return at!==null&&times.has(at)?'〔引用时标〕':token;}).replace(/(?<![\w.+-])\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z(?![\w+-])/g,token=>{const at=timestampValue(token);return at!==null&&times.has(at)?'〔引用时标〕':token;}).replace(/(?<![\w.+-])\d{4}-\d{2}-\d{2}(?![\w+-])/g,token=>calendarDay(token)&&days.has(token)?'〔引用日期〕':token);
  // Series names and the cited dataset's native candle cadence are identities,
  // not quantities. Every other printed quantity needs its own declaration.
  remainder=remainder.replace(/\b(?:DGS2|DGS10|DFII10|T10YIE)\b/g,'〔系列〕');
  for(const r of receipts){const cadences=new Set([/-(5m|15m|1h|4h|1d|3d|1w)$/.exec(r.request?.dataset||'')?.[1],r.data?.aggregation?.sourceInterval,r.data?.aggregation?.displayInterval]);for(const cadence of cadences)if(/^(5m|15m|1h|4h|1d|3d|1w)$/.test(cadence||'')){const label={m:'分钟',h:'小时',d:'天',w:'周'}[cadence.at(-1)],count=cadence.slice(0,-1);remainder=remainder.replace(new RegExp('(?<![\\w.])'+count+'(?:'+cadence.at(-1)+'\\b|'+label+')','g'),'〔原生周期〕');}}
  remainder=remainder.replace(/−/g,'-').replace(/(?<![\w.])[-+]?\d+(?:,\d{3})*(?:\.\d+)?(?:[eE][-+]?\d+)?(?:[kKmMbB])?(?![\w.])/g,(token,offset,all)=>{const suffix=/[kKmMbB]$/.test(token)?token.at(-1).toLowerCase():null,multiplier=suffix?{k:1e3,m:1e6,b:1e9}[suffix]:1,plain=(suffix?token.slice(0,-1):token).replace(/,/g,''),downward=!/^[-+]/.test(plain)&&/(?:下降|下跌|降低|减少|回落|下行|缩减|下调)(?:约|了|近|大约)?\s*$/.test(all.slice(Math.max(0,offset-12),offset)),value=Number(plain)*multiplier*(downward?-1:1),decimals=plain.split('.')[1]?.split(/[eE]/)[0]?.length||0,exponent=Number(/[eE]([-+]?\d+)$/.exec(plain)?.[1]||0),rounding=.500001*10**(exponent-decimals)*multiplier,percentage=/^\s*%/.test(all.slice(offset+token.length));const supported=numbers.some(n=>{const expected=percentage&&/decimal|fraction/.test(n.unit)?n.value*100:n.value;return Math.abs(expected-value)<=Math.max(1e-9,rounding);});return supported?'〔引用量值〕':token;});
  return /\d/.test(remainder)?[...new Set(remainder.match(/[-+]?\d+(?:\.\d+)?/g)||[])].slice(0,24):null;
}
// New model candidates require complete printed quantities. Historical reading
// retains its original contract and does not rewrite or invalidate saved copies.
export function validateReport(report,receipts,schema=REPORT_SCHEMA,{completeNumericText=false}={}){
  validateSchema(report,schema);const registry=new Map();for(const r of receipts){const old=registry.get(r.id);if(old&&(old.contentHash!==r.contentHash||old.rawHash!==r.rawHash||old.asOf!==r.asOf))throw Error('conflicting_evidence_identity:'+r.id);if(!old||r.historicalBaseline)registry.set(r.id,r);}
  const ids=new Set();for(const claim of report.claims){if(ids.has(claim.id))throw Error('duplicate_claim');ids.add(claim.id);
    if(!claim.evidenceIds.length)throw Error('claim_without_evidence');
    for(const id of claim.evidenceIds){const r=registry.get(id);if(!r?.ok||!r.usable)throw Error('unknown_or_unusable_evidence:'+id);}
    const sources=claim.evidenceIds.map(id=>registry.get(id)),historical=sources.filter(r=>r.historicalBaseline),current=sources.filter(r=>!r.historicalBaseline);
    if(claim.scope==='current'&&(!current.length||historical.length||claim.baselineReportIds.length))throw Error('current_claim_uses_history');
    if(claim.scope==='history'&&(!historical.length||current.length))throw Error('history_claim_uses_current');
    if(claim.scope==='comparison'&&(!historical.length||!current.length))throw Error('comparison_requires_both_cycles');
    if(claim.scope!=='current'&&(!claim.baselineReportIds.length||historical.some(r=>!r.baselineReportIds?.some(id=>claim.baselineReportIds.includes(id)))||claim.baselineReportIds.some(id=>!historical.some(r=>r.baselineReportIds?.includes(id)))))throw Error('claim_baseline_mismatch');
    for(const n of claim.numbers){const r=registry.get(n.evidenceId);const v=fieldAt(r?.data,n.path);const unit=r?.numericUnits?.[n.path];if(!claim.evidenceIds.includes(n.evidenceId)||v===null||v===''||!Number.isFinite(Number(v))||Math.abs(Number(v)-n.value)>Math.max(1e-9,Math.abs(n.value)*1e-8)||unit!==n.unit)throw Object.assign(Error('numeric_evidence_mismatch:'+n.path),{validationDetails:{claimId:claim.id,evidenceId:n.evidenceId,path:n.path,declared:{value:n.value,unit:n.unit},expected:{value:v!==null&&v!==''&&Number.isFinite(Number(v))?Number(v):null,valueType:typeof v,unit:unit??null,dataset:r?.request?.dataset??null,historicalBaseline:!!r?.historicalBaseline,asOf:r?.asOf??null},inClaimEvidenceIds:claim.evidenceIds.includes(n.evidenceId),instruction:'原数字四元组不匹配；按提供的原回执重交或撤回该主张。Node不改值、不猜替代来源。'}});}
    const missing=(!claim.numbers.length||completeNumericText)&&hasUnreferencedDigits(claim.text,sources,claim.numbers);if(missing)throw Object.assign(Error('numeric_claim_requires_reference'),{validationDetails:{claimId:claim.id,unreferencedNumbers:missing,instruction:'正文仍有未登记引用的量值或未知时标；逐项补上真实数字四元组，或删除不支持的内容。'}});
  }
  if(!report.claims.length&&report.status==='sufficient')throw Error('empty_sufficient_report');
  if(report.status==='insufficient'&&report.claims.length)throw Error('insufficient_has_claims');
  const conditionIds=new Set();for(const c of report.conditions||[]){if(!c.id||conditionIds.has(c.id))throw Error('duplicate_condition');conditionIds.add(c.id);
    if(!clockValue(c.from)||!clockValue(c.to)||!clockValue(c.deadline)||c.from>c.to||c.to>c.deadline||c.to-c.from>2160*3600000)throw Error('invalid_condition_window');
    if(c.kind==='manual'&&c.criterion!==null||c.kind==='deterministic'&&!c.criterion)throw Error('invalid_condition_kind');
    if(c.criterion){const q=c.criterion,r=registry.get(q.evidenceId),value=fieldAt(r?.data,q.path);if(!/^binance-(perp-klines-(5m|15m|1h|4h|1d|3d|1w)|spot-klines-1h)$/.test(q.dataset)||!r?.ok||!r.usable||r.historicalBaseline||!Number.isFinite(value)||Math.abs(value-q.value)>Math.max(1e-9,Math.abs(q.value)*1e-8)||r.numericUnits?.[q.path]!==q.unit)throw Error('condition_threshold_without_evidence');if(CONDITION_FIELD_UNITS[q.field]!==q.unit)throw Error('condition_target_unit');}
  }
  const progressIds=new Set();for(const p of report.researchProgress||[]){if(progressIds.has(p.todoId))throw Error('duplicate_research_progress');progressIds.add(p.todoId);if(p.state==='completed'&&!p.evidenceIds.length)throw Error('research_completion_without_evidence');
    const sources=p.evidenceIds.map(id=>registry.get(id));if(sources.some(r=>!r?.ok||!r.usable)||p.state==='completed'&&!sources.some(r=>!r.historicalBaseline))throw Error('research_progress_without_current_evidence');
    for(const r of sources.filter(r=>r.historicalBaseline))if(!report.claims.some(c=>c.scope==='comparison'&&c.evidenceIds.includes(r.id)))throw Error('research_progress_baseline_mismatch');
  }
  return report;
}
export const DEFAULT_CONFIG={version:1,enabled:false,mode:'interval',intervalMinutes:60,dailyTimes:['09:00','18:00'],timezone:'Asia/Shanghai',windowHours:24,maxCalls:20,dailyCalls:100};
export function validateConfig(c){const fields=Object.keys(DEFAULT_CONFIG);if(!c||Object.keys(c).some(k=>!fields.includes(k)))throw Error('invalid_config_fields');
  if(!Number.isInteger(c.version)||c.version<1||typeof c.enabled!=='boolean'||!['interval','daily'].includes(c.mode))throw Error('invalid_config');
  for(const [k,min,max]of [['intervalMinutes',1,1440],['windowHours',1,2160],['maxCalls',7,20],['dailyCalls',7,500]])if(!Number.isInteger(c[k])||c[k]<min||c[k]>max)throw Error('invalid_config_'+k);
  if(!Array.isArray(c.dailyTimes)||!c.dailyTimes.length||c.dailyTimes.length>12||new Set(c.dailyTimes).size!==c.dailyTimes.length||c.dailyTimes.some(t=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))throw Error('invalid_daily_times');
  try{new Intl.DateTimeFormat('en',{timeZone:c.timezone}).format();}catch{throw Error('invalid_timezone');}return c;
}
