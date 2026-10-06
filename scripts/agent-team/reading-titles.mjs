import fs from 'node:fs';
import path from 'node:path';
// Optional small, local reader catalog. No history bodies or disk writes on a query.
export function readingTitleIndex(store){
 if(!store.directory)return {entries:{},state:'not_prepared'};
 try{const value=JSON.parse(fs.readFileSync(path.resolve(store.directory,'../reader-content/catalog.json'),'utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_title_catalog');return {entries:value,state:'ready'};}catch(error){return {entries:{},state:error.code==='ENOENT'?'not_prepared':'unavailable'};}
}
export function titleFor(row,titles){const entry=titles[row.id];return entry?.reportId&&entry.reportId===row.accepted?.chief&&typeof entry.title==='string'?entry.title:null;}
