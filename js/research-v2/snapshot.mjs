import '../evidence-bundle.js';
import {identity,clone,freeze,assert} from './contract.mjs';
const evidence=globalThis.BitEvidenceBundle;
export function extractObservations(bundle, materials=[],registryVersion=1) {
  const observations=[];
  const add=(entry,path,value)=>observations.push({id:entry.name+':'+path,scope:entry.name,path,value:clone(value),
    sourceUrl:entry.url,receivedAt:entry.accessedAt,quality:entry.quality,ready:entry.ready===true,
    representation:Object.hasOwn(value,'_omittedFields')?'selected_fields_from_raw_artifact':'raw_json_value',
    readinessReason:entry.reason,sourceClocks:registryVersion>=2?[]:entry.sources.filter(s=>path.startsWith(s.location)||s.location.startsWith(path)).slice(0,8)});
  for(const entry of bundle.entries){
    if(!entry.transportOk||!entry.data)continue;
    const data=entry.data;
    if(['chart','orderflow'].includes(entry.name)){
      const series=data.series||[];
      if(registryVersion===3){const keys=['t','o','h','l','c','v','volume','buyVol','sellVol','delta','pocPrice','closed','sourceVerification','sourceId'];add(entry,'/seriesWindow',{startIndex:Math.max(0,series.length-96),rows:series.slice(-96).map(bar=>Object.fromEntries(keys.filter(k=>Object.hasOwn(bar,k)).map(k=>[k,bar[k]]))),_omittedFields:['Selected price/volume fields from last96 native rows; all remaining fields and levels retained in raw artifact.']});}
      else series.slice(-96).forEach((bar,i)=>{
        const {levels,...fields}=bar;
        const compact=Object.fromEntries(['t','o','h','l','c','v','volume','buyVol','sellVol','delta','pocPrice','closed','sourceVerification','sourceId'].filter(k=>Object.hasOwn(bar,k)).map(k=>[k,bar[k]]));
        add(entry,'/series/'+(series.length-Math.min(96,series.length)+i),registryVersion===2?{...compact,_omittedFields:['Selected price/volume fields; all other fields and levels remain in the unchanged raw artifact.']}:levels?{...fields,_omittedFields:['levels; full price-level observations remain in the raw artifact']}:bar);
      });
      for(const key of ['instrumentId','venue','interval','coverage','quality','gap','researchWindow','dataSource','asOf','inputRevision'])if(data[key]!=null)add(entry,'/'+key,data[key]);
    }else if(entry.name==='context'){
      function walk(value,location){if(!value||typeof value!=='object')return;
        if(Object.hasOwn(value,'values')){add(entry,location,value);return;}
        for(const [key,item]of Object.entries(value)){if(key==='series'||key==='observations')continue;walk(item,location+'/'+key);}
      }
      walk(data.contract,'/contract');walk(data.groups,'/groups');walk(data.comparison,'/comparison');
      for(const [key,value]of Object.entries(data.options||{})){
        const {smiles,...metadata}=value;add(entry,'/options/'+key,metadata);
        for(const [i,smile]of (smiles||[]).slice(0,3).entries())add(entry,'/options/'+key+'/smiles/'+i,smile);
      }
      if(data.externalCoverage)add(entry,'/externalCoverage',data.externalCoverage);
    }else if(entry.name==='heatmap'){
      for(const key of ['venues','coverage','quality','summary','limitations','dataSource'])if(data[key]!=null)add(entry,'/'+key,data[key]);
      if(registryVersion>=2)for(const [venue,group]of Object.entries(data.byExchange||{})){
        const {buckets,...totals}=group;add(entry,'/byExchange/'+venue,{...totals,buckets:(buckets||[]).slice(-96),_omittedFields:['Only last96 native buckets in model view; full response retained.']});
      }
    }else add(entry,'/report',data.report||data);
    if(registryVersion>=2){const start=Math.max(0,(data.series||[]).length-96);const clocks=registryVersion===3?entry.sources.filter(s=>!s.location.startsWith('/series/')||Number(s.location.split('/')[2])>=start):entry.sources;add(entry,'/sourceClocks',clocks.map(({location,observedAt,referencePeriod,publicAvailableAt,receivedAt,sourceHost,units,finality})=>({location,observedAt,referencePeriod,publicAvailableAt,receivedAt,sourceHost,units,...(registryVersion===3?{finality}:{})})));}
  }
  for(const [i,material]of materials.entries())observations.push({id:'materials:'+i,scope:'materials',path:'/'+i,value:clone(material),sourceUrl:material.url,receivedAt:material.accessedAt,ready:false,readinessReason:'external_material_publication_cutoff_not_established',sourceClocks:[]});
  assert(observations.length<=1500,'too_many_observations');return observations;
}
export function createSnapshot({bundle,artifacts,question,materials=[]}){
  assert(typeof question==='string'&&question.trim().length>=4&&question.length<=4000,'invalid_research_question');
  assert(evidence.validate(bundle).length===0,'invalid_evidence_bundle');
  const bodies=artifacts.map(a=>({scope:a.scope,url:a.url,receivedAt:a.receivedAt,status:a.status,body:a.body,bodyEncoding:'UTF-8 decoded response body; not HTTP wire bytes',bodySha256:identity.sha256(a.body),bytes:new TextEncoder().encode(a.body).length}));
  assert(bodies.reduce((n,a)=>n+a.bytes,0)<=12*1024*1024,'snapshot_too_large');
  assert(new Set(bodies.map(a=>a.scope)).size===bodies.length,'duplicate_raw_scope');
  const snapshot={schema:'bitdesk.research.snapshot.v2',registryVersion:3,capturedAt:new Date().toISOString(),question:question.trim(),bundle:clone(bundle),artifacts:bodies,materials:clone(materials),observations:extractObservations(bundle,materials,3)};
  snapshot.snapshotId=identity.contentId(snapshot);validateSnapshot(snapshot);return freeze(snapshot);
}
export function validateSnapshot(snapshot){
  assert(snapshot?.schema==='bitdesk.research.snapshot.v2','wrong_snapshot_schema');
  const {snapshotId,...content}=snapshot;assert(identity.contentId(content)===snapshotId,'snapshot_hash_mismatch');
  assert(evidence.validate(snapshot.bundle).length===0,'bundle_hash_mismatch');
  const rebuilt=evidence.build({kind:snapshot.bundle.kind,asOf:snapshot.bundle.asOf,knowledgeCutoff:snapshot.bundle.knowledgeCutoff,
    capturedAt:snapshot.bundle.capturedAt,requirements:snapshot.bundle.requirements,
    resources:snapshot.bundle.entries.map(e=>({name:e.name,url:e.url,accessedAt:e.accessedAt,data:e.data,ok:e.transportOk,error:e.error}))});
  assert(rebuilt.contentId===snapshot.bundle.contentId,'derived_readiness_mismatch');
  assert(!snapshot.registryVersion||[2,3].includes(snapshot.registryVersion),'unknown_observation_registry');
  assert(identity.contentId(snapshot.observations)===identity.contentId(extractObservations(snapshot.bundle,snapshot.materials,snapshot.registryVersion||1)),'observation_registry_mismatch');
  assert(new Set(snapshot.artifacts.map(a=>a.scope)).size===snapshot.artifacts.length,'duplicate_artifact');
  for(const artifact of snapshot.artifacts){assert(identity.sha256(artifact.body)===artifact.bodySha256,'artifact_hash_mismatch');assert(new TextEncoder().encode(artifact.body).length===artifact.bytes,'artifact_bytes_mismatch');}
  for(const entry of snapshot.bundle.entries.filter(e=>e.transportOk)){
    const artifact=snapshot.artifacts.find(a=>a.scope===entry.name);assert(artifact&&artifact.status===200&&artifact.url===entry.url,'missing_raw_artifact:'+entry.name);
    assert(identity.contentId(JSON.parse(artifact.body))===entry.contentHash,'raw_payload_mismatch:'+entry.name);
  }
  return true;
}
