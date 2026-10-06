import fs from 'node:fs';
import path from 'node:path';
import {hash} from './tools.mjs';
import {eventReading} from './event-reading.mjs';
const identity=/^[a-f0-9-]{36}$/;
const time=value=>typeof value==='number'?value:Date.parse(value);
function sourceLabel(receipt){const name=receipt.request?.dataset||receipt.request?.tool||'';return /klines/.test(name)?'价格与成交记录':/book/.test(name)?'当时盘口':/taker|footprint/.test(name)?'主动成交记录':/oi/.test(name)?'未平仓量记录':/funding/.test(name)?'资金费率记录':/positions|accounts/.test(name)?'账户与持仓比例':/premium|basis/.test(name)?'永续合约定价':/^fred-/.test(name)?'宏观数据记录':/article/.test(name)?'报道原文':/events|selected-material/.test(name)?'事件材料':'保存的来源资料';}
export const readerDirectory=store=>path.resolve(store.directory,'../reader-content');
export function validateEdition(edition,record,sourceHash){
 if(edition?.reportId!==record.id||edition.sourceHash!==sourceHash)throw Error('reading_source_mismatch');
 const strings=x=>Array.isArray(x)&&x.every(v=>typeof v==='string'&&v.trim());
 if(typeof edition.title!=='string'||!edition.title.trim()||typeof edition.lead!=='string'||!strings(edition.highlights)||!strings(edition.risks)||!strings(edition.watch)||!Array.isArray(edition.sections)||!edition.sections.length)throw Error('invalid_reading_edition');
 const claims=new Set(record.report.claims.map(x=>x.id));
 if(edition.sections.some(s=>typeof s.heading!=='string'||!strings(s.paragraphs)||!Array.isArray(s.claimIds)||s.claimIds.some(id=>!claims.has(id))))throw Error('invalid_reading_claim');
 return edition;
}
function readFile(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
export function eventTranslation(store,item){const rows=readFile(path.join(readerDirectory(store),'news.json'))||{};const entry=rows[hash({title:item.title,summary:item.summary||''})];return entry&&typeof entry.title==='string'&&/\p{Script=Han}/u.test(entry.title)?entry:null;}
export function translatedEvents(store,value){return {...value,items:value.items.map(item=>({...item,translation:eventTranslation(store,item)}))};}
export function readingContent(store,id){
 if(!identity.test(id))throw Error('invalid_report');const saved=store.read('report-'+id+'.json');if(!saved||saved.hash!==hash(saved.payload))throw Error('invalid_report');const record=saved.payload;
 let edition=null,editionState='missing';try{const candidate=readFile(path.join(readerDirectory(store),id+'.json'));if(candidate){edition=validateEdition(candidate,record,saved.hash);editionState='ready';}}catch{editionState='unavailable';}
 const run=store.read('run-'+record.cycleId+'.json'),claims=new Set((record.report.claims||[]).flatMap(c=>c.evidenceIds||[]));
 const receipt=run?.receipts?.find(r=>claims.has(r.id)&&!r.historicalBaseline&&/^binance-perp-klines-15m$/.test(r.request?.dataset)&&Object.keys(r.data?.observations||{}).length>1);
 let chart=null;if(receipt){const points=Object.values(receipt.data.observations).map(x=>({time:time(x.observedAt),value:x.values?.close})).filter(x=>Number.isFinite(x.time)&&Number.isFinite(x.value)).sort((a,b)=>a.time-b.time);chart={receiptId:receipt.id,label:'币安 BTC 永续 · 15分钟',stepMs:15*60*1000,points,complete:receipt.coverage?.completeWindow===true,sampled:points.length<(receipt.coverage?.returnedRows||points.length)};}
 let news=[];if(run){const events=eventReading(run);news=events.items.map(n=>({...n,translation:eventTranslation(store,n)})).filter(n=>n.translation?.featured&&Number.isFinite(time(n.publishedAt))&&time(n.publishedAt)<=time(record.asOf)).slice(0,3).map(n=>({id:n.id,translation:n.translation,receiptId:n.receiptId,publishedAt:n.publishedAt,publisher:(()=>{try{return new URL(n.url).hostname;}catch{return '来源见原件';}})()}));}
 const sourceLabels=Object.fromEntries((run?.receipts||[]).filter(r=>claims.has(r.id)).map(r=>[r.id,sourceLabel(r)]));
 return {reportId:id,edition,editionState,chart,news,sourceLabels};
}
