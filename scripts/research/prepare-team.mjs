import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import '../../js/evidence-bundle.js';
import {createSnapshot} from '../../js/research-v2/snapshot.mjs';
export async function prepareTeam({question,origin='https://btc.feiniwork.com',newsOrigin='https://yuqing.feiniwork.com',knownAt=new Date().toISOString(),signal,materials=[]}){
  if(!Number.isFinite(Date.parse(knownAt))||Date.parse(knownAt)>Date.now()+1000)throw Error('invalid_knowledge_cutoff');
  for(const base of [origin,newsOrigin]){const url=new URL(base);if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw Error('invalid_evidence_origin');}
  const records=[],artifacts=[];
  const endpoints=['chart','orderflow','heatmap','context'].map(scope=>[scope,origin+'/api/desk/'+scope]);
  endpoints.push(['events',newsOrigin+'/api/yuqing/reports/latest?kind=daily_event'],['analysis',newsOrigin+'/api/yuqing/reports/latest?kind=sentiment_analysis']);
  // Transport reads are independent; all analysis consumes this one frozen package.
  const results=await Promise.all(endpoints.map(async([name,base])=>{
    const url=new URL(base);if(['chart','orderflow','heatmap','context'].includes(name)){
      url.searchParams.set('symbol','BTCUSDT');url.searchParams.set('knownAt',knownAt);
      if(name==='chart')url.searchParams.set('interval','15m');if(name==='orderflow')url.searchParams.set('interval','5m');
    }
    const accessedAt=new Date().toISOString();
    try{
      const deadline=AbortSignal.timeout(25000);const combined=signal?AbortSignal.any([signal,deadline]):deadline;
      const response=await fetch(url,{signal:combined,headers:{Accept:'application/json'}});if(!response.ok){await response.body?.cancel();throw Error('HTTP '+response.status);}
      const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.byteLength>4*1024*1024)throw Error('evidence_body_too_large');
      const body=new TextDecoder('utf-8',{fatal:true}).decode(bytes),data=JSON.parse(body),receivedAt=new Date().toISOString();
      return {record:{name,url:url.href,accessedAt:receivedAt,data,ok:true},artifact:{scope:name,url:url.href,receivedAt,status:200,body}};
    }catch(error){if(signal?.aborted)throw error;return {record:{name,url:url.href,accessedAt,ok:false,error:error.message}};}
  }));
  for(const result of results){records.push(result.record);if(result.artifact)artifacts.push(result.artifact);}
  const bundle=globalThis.BitEvidenceBundle.build({kind:'team_research',asOf:knownAt,knowledgeCutoff:knownAt,resources:records,capturedAt:new Date().toISOString()});
  return createSnapshot({bundle,artifacts,question,materials});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);
  if(args.includes('--help'))console.log('node scripts/research/prepare-team.mjs --question=<question> --out=<new-directory> [--origin=<local-or-cloud>] [--news-origin=<origin>] [--known-at=<ISO>]');
  else {
    const values=Object.fromEntries(args.map(a=>{const match=/^--(question|out|origin|news-origin|known-at)=(.*)$/.exec(a);if(!match)throw Error('unknown_argument');return [match[1],match[2]];}));
    if(!values.out||!values.question)throw Error('question_and_new_output_required');
    const snapshot=await prepareTeam({question:values.question,origin:values.origin,newsOrigin:values['news-origin'],knownAt:values['known-at']});
    const directory=path.resolve(values.out);fs.mkdirSync(path.dirname(directory),{recursive:true});fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory,'snapshot.json'),JSON.stringify(snapshot,null,2),{flag:'wx'});
    console.log(JSON.stringify({directory,snapshotId:snapshot.snapshotId,observations:snapshot.observations.length,scopes:snapshot.bundle.entries.map(({name,transportOk,schemaVersion,reason})=>({name,transportOk,schemaVersion,reason})),analysisReady:snapshot.bundle.analysisReady}));
  }
}
