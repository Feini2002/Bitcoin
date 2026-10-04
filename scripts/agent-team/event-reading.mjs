import '../../js/content-identity.js';
export function eventMaterial(run,receiptId,index){
  const receipt=run?.receipts?.find(r=>r.id===receiptId&&!r.historicalBaseline&&r.request?.tool==='events'),event=receipt?.data?.items?.[index];
  if(!receipt?.ok||!receipt.usable||!Number.isSafeInteger(index)||index<0||!event)throw Error('discovered_event_unavailable');
  const article=run.receipts.findLast(r=>!r.historicalBaseline&&r.request?.tool==='article'&&r.request.articleId===event.id);
  return {kind:'discovered_event',title:event.title,event:structuredClone(event),asOf:run.row.asOf,sourceRunId:run.row.id,sourceReceiptId:receiptId,article:article?{ok:article.ok,quality:article.quality,error:article.error||null,receiptId:article.id,content:article.data?.article||null}:null};
}
export function eventReading(run,{accepted=null,chief=null}={}){
  if(!run)return {state:'not_researched',cycleId:null,asOf:null,items:[],sources:[],analyst:accepted,chief};
  const receipts=run.receipts.filter(r=>!r.historicalBaseline&&r.request?.tool==='events'),seen=new Set(),items=[];
  for(const receipt of receipts.slice().reverse())for(const [index,event]of (receipt.data?.items||[]).entries()){
    if(seen.has(event.id))continue;seen.add(event.id);const content=eventMaterial(run,receipt.id,index),article=content.article;
    items.push({id:event.id,title:event.title,summary:String(event.summary||'').slice(0,2500),url:event.url||null,publishedAt:event.publishedAt||null,occurredAt:event.occurredAt||null,scope:event.scope||'报道材料，事实尚需核对',sourceType:event.sourceType||null,receiptId:receipt.id,article:article?{ok:article.ok,quality:article.quality,error:article.error,receiptId:article.receiptId,characters:article.content?.text?.length||0}:null,materialRef:{source:'discovered-event',id:run.row.id+':'+receipt.id+':'+index,contentHash:globalThis.BitContentIdentity.contentId(content),version:receipt.id}});
  }
  const state=items.length?'materials_found':!receipts.length?'not_acquired':receipts.every(r=>!r.ok||!r.usable)?'sources_unavailable':'no_materials_found';
  return {state,cycleId:run.row.id,asOf:run.row.asOf,runStatus:run.row.terminal||'running',items,sources:receipts.map(r=>({receiptId:r.id,ok:r.ok,usable:r.usable,quality:r.quality,error:r.error||null,coverage:r.coverage,sourceChain:r.sourceChain})),analyst:accepted,chief};
}
