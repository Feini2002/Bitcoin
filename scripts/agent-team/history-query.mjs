import crypto from 'node:crypto';
import {readingTitleIndex,titleFor} from './reading-titles.mjs';

const validDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const time=value=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&value.trim()?Date.parse(value):NaN;
export const historyDay=value=>Number.isFinite(time(value))?new Date(time(value)+8*3600000).toISOString().slice(0,10):'unknown';

// Snapshot only small index summaries. No report bodies, receipt scans or disk writes.
// A snapshot prevents completion/new-run changes from moving a record between pages.
export function queryHistory(store,{offset=0,limit=50,q='',type='all',from='',to='',dateBasis='completed',snapshot=null}={}){
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>200||typeof q!=='string'||q.length>2000||!['all','current','window','narrative'].includes(type)||!['completed','cutoff'].includes(dateBasis)||from&&!validDay(from)||to&&!validDay(to)||from&&to&&from>to)throw Error('invalid_history_query');
  q=q.trim();const query={q,type,from,to,dateBasis},key=JSON.stringify(query),now=store.clock();store.historyQueries??=new Map();
  for(const [id,value]of store.historyQueries)if(value.expiresAt<=now)store.historyQueries.delete(id);
  let frozen=snapshot?store.historyQueries.get(snapshot):null;
  if(snapshot&&(!frozen||frozen.key!==key))throw Error('history_query_expired');
  if(!frozen){
    const index=new Map(store.journal.runs.map(row=>[row.id,store.summary(row)]));
    for(const page of store.runIndex?.pages||[]){const entry=store.read(page.file);if(!Array.isArray(entry?.rows)||entry.rows.length!==page.count)throw Error('history_index_incomplete');for(const row of entry.rows)if(!index.has(row.id))index.set(row.id,row);}
    const titleIndex=readingTitleIndex(store);if(q&&titleIndex.state==='unavailable')throw Error('reading_title_index_unavailable');
    const rows=[...index.values()].map(row=>({...row,readingTitle:titleFor(row,titleIndex.entries)})),date=row=>dateBasis==='cutoff'?row.asOf:row.endedAt;
    const matches=rows.filter(row=>{const day=historyDay(date(row));return (type==='all'||(row.taskMode||row.task?.taskMode||'current')===type)&&[row.readingTitle,row.question].filter(Boolean).join(' ').toLocaleLowerCase().includes(q.toLocaleLowerCase())&&(!from||day!=='unknown'&&day>=from)&&(!to||day!=='unknown'&&day<=to);});
    matches.sort((a,b)=>{const ta=time(date(a)),tb=time(date(b));return (Number.isFinite(tb)?tb:-Infinity)-(Number.isFinite(ta)?ta:-Infinity)||String(b.id).localeCompare(String(a.id));});
    const dateCounts={};for(const row of matches){const day=historyDay(date(row));dateCounts[day]=(dateCounts[day]||0)+1;}
    snapshot=crypto.randomUUID();frozen={key,query,rows:structuredClone(matches),dateCounts,indexedCount:rows.length,titleCoverage:{state:titleIndex.state,count:rows.filter(r=>r.readingTitle).length},at:new Date(now).toISOString(),expiresAt:now+30*60000};
    if(store.historyQueries.size>=16)store.historyQueries.delete(store.historyQueries.keys().next().value);store.historyQueries.set(snapshot,frozen);
  }
  const runs=frozen.rows.slice(offset,offset+limit),days=[...new Set(runs.map(row=>historyDay(dateBasis==='cutoff'?row.asOf:row.endedAt)))];
  return {version:2,runs,total:frozen.rows.length,offset,limit,nextOffset:offset+runs.length<frozen.rows.length?offset+runs.length:null,snapshot,query:frozen.query,dateCounts:Object.fromEntries(days.map(day=>[day,frozen.dateCounts[day]])),coverage:{source:'local-agent-team',scope:'all-local-index',complete:true,indexedCount:frozen.indexedCount,snapshotAt:frozen.at,titleCoverage:frozen.titleCoverage,dateBasis,timezone:'Asia/Shanghai',searchFields:['readingTitle','question'],reportBodiesSearched:false}};
}
