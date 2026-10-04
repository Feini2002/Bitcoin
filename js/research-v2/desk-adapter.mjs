import '../evidence-bundle.js';
import {createSnapshot} from './snapshot.mjs';
export const AGENT_TASK_VERSION='bitdesk.agent-task.v1';
export function agentObservation(selection){
  const view=({leverage:'derivatives'})[selection?.origin]||selection?.origin||'chart';
  const timeframe=view==='orderflow'?selection.orderflowInterval:selection.chartInterval;
  if(!Number.isSafeInteger(selection?.from)||!Number.isSafeInteger(selection?.to)||selection.from>selection.to)throw Error('请先选择明确的起止时间；没有恢复原选区时不会代用默认窗口。');
  if(!['5m','15m','1h','4h','1d','3d','1w'].includes(timeframe))throw Error('这个阅读周期暂不支持团队研究，请保留原资料或选择支持的周期。');
  return {exchange:'binance',symbol:selection.symbol||'BTCUSDT',product:selection.product||'perpetual',view,timeframe,from:selection.from,to:selection.to,...(view==='heatmap'?{liquidationRange:selection.liquidationRange}: {})};
}
export function agentTaskRequest(selection,question,{requestId=crypto.randomUUID()}={}){
  const material=selection?.material,body={requestId,question:String(question||'').trim(),taskMode:material?'narrative':'window',clientObservedAt:selection?.clientObservedAt||new Date().toISOString()};
  if(!material||Number.isSafeInteger(selection.from)&&Number.isSafeInteger(selection.to))body.observation=agentObservation(selection);
  if(material?.kind==='discovered_event'){if(material.materialRef?.source!=='discovered-event')throw Error('所选报道缺少原件位置，请重新打开事件材料。');body.materialRefs=[structuredClone(material.materialRef)];body.providedMaterials=[];}else if(material){
    if(!material.originalReport||!material.event||!material.reportContentId)throw Error('所选事件缺少完整原报告，请重新打开原件；不会替换为最新报告。');
    if(globalThis.BitContentIdentity?.contentId(material.originalReport)!==material.reportContentId)throw Error('所选事件的原报告版本已变化，请重新核对原件。');
    const entryId=material.kind==='legacy_report_event'?material.entryId:material.event.id;
    if(typeof entryId!=='string'||!entryId)throw Error('所选条目缺少可核对的身份，请重新打开原件。');
    body.providedMaterials=[{source:'provided-event',id:entryId,contentHash:globalThis.BitContentIdentity.contentId(material),content:material,parentReportId:String(material.reportId)}];
    body.materialRefs=[];
  }
  if(new TextEncoder().encode(JSON.stringify(body)).byteLength>64*1024)throw Error('原资料超过单次研究的64KiB上限。请导出保存；本次未截断、未开始研究。');
  return body;
}
export function taskCapabilityIssue(capabilities,body){
  if(capabilities?.version!==AGENT_TASK_VERSION)return '研究服务尚未确认支持指定问题。可以准备和导出资料，连接支持此任务的服务后再开始。';
  if(capabilities.executable===false||capabilities.canExecute===false)return '当前连接只提供记录阅读，暂时不能开始研究。';
  if(capabilities.taskModes&&!capabilities.taskModes.includes(body.taskMode))return '当前研究服务不支持这类问题，原资料仍可导出。';
  if(capabilities.materialSources&&[...(body.materialRefs||[]),...(body.providedMaterials||[])].some(m=>!capabilities.materialSources.includes(m.source)))return '当前研究服务不能读取所选原件类型。原资料仍可导出，未改用其他来源。';
  const o=body.observation;
  if(o&&capabilities.timeframes&&!capabilities.timeframes.includes(o.timeframe))return '当前研究服务不支持所选周期，未改用其他周期。';
  if(o?.view==='orderflow'&&capabilities.orderflowTimeframes&&!capabilities.orderflowTimeframes.includes(o.timeframe))return '成交足迹研究支持5m、15m、1h和4h阅读周期，未改用其他周期。';
  if(o&&capabilities.views&&!capabilities.views.includes(o.view))return '当前研究服务不支持所选资料范围，未改用其他视图。';
  if(o&&capabilities.products&&!capabilities.products.includes(o.product))return '当前研究服务不支持所选市场身份，未改用其他产品。';
  if(o&&capabilities.limits?.windowHours&&(o.to-o.from+1)>capabilities.limits.windowHours*3600000)return `所选范围超过服务支持的${capabilities.limits.windowHours/24}天上限。请缩小范围，原资料仍可导出。`;
  return '';
}
export function acceptedTaskMatches(request,response){
  const task=response?.task;
  if(!response?.id||!task?.contextId||task.taskMode!==request.taskMode)return false;
  if(request.observation&&globalThis.BitContentIdentity?.canonical(task.observation)!==globalThis.BitContentIdentity?.canonical(request.observation))return false;
  for(const field of ['materialRefs','providedMaterials'])if(request[field]?.length){
    if(request[field].length!==task[field]?.length)return false;
    if(request[field].some((x,i)=>x.id!==task[field][i].id||x.source!==task[field][i].source||x.contentHash!==task[field][i].contentHash))return false;
  }
  return true;
}
export async function captureDesk(engine,question,{signal,knownAt=new Date().toISOString(),materials=[],selection}={}){
  const requested=selection?JSON.parse(JSON.stringify(selection)):null;
  const range=requested&&Number.isFinite(requested.from)&&Number.isFinite(requested.to)&&requested.from<=requested.to?{from:requested.from,to:requested.to}:{};
  const interval=['5m','15m','1h','4h','1d','3d','1w'].includes(requested?.chartInterval)?requested.chartInterval:'15m';
  const attachments=[...materials];
  if(requested)attachments.push({title:'所选观察范围',kind:'observation_selection',url:globalThis.location?.href||'https://bitcoin.feiniwork.com/#/market',accessedAt:knownAt,selection:{...requested,material:undefined},note:'观察范围不是历史公开可得时间证明。模型价格与成交视图最多采用最近96根原生栏，完整返回保存在原始资料中。'});
  if(requested?.material)attachments.push(requested.material);
  const records=[],artifacts=[];
  for(const name of ['chart','orderflow','heatmap','context']){
    if(signal?.aborted)throw new DOMException('研究已取消','AbortError');
    try{
      const data=await engine.fetchDesk(name,{symbol:'BTCUSDT',interval:name==='chart'?interval:name==='orderflow'?'5m':undefined,...(['chart','orderflow'].includes(name)?range:{}),range:name==='heatmap'?(requested?.liquidationRange||'24h'):undefined,knownAt,signal});
      const artifact=engine.readDeskArtifact(data);if(!artifact)throw Error('same_response_raw_bytes_missing');
      const body=new TextDecoder('utf-8',{fatal:true}).decode(artifact.bytes);
      records.push({name,url:artifact.url,accessedAt:artifact.receivedAt,data,ok:true});
      artifacts.push({scope:name,url:artifact.url,receivedAt:artifact.receivedAt,status:200,body});
    }catch(error){if(signal?.aborted)throw error;records.push({name,url:engine.apiBase()+'/api/desk/'+name,accessedAt:new Date().toISOString(),ok:false,error:error.message});}
  }
  const bundle=globalThis.BitEvidenceBundle.build({kind:'team_research',asOf:knownAt,knowledgeCutoff:knownAt,resources:records,capturedAt:new Date().toISOString()});
  return createSnapshot({bundle,artifacts,question,materials:attachments});
}
