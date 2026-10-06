// Read only saved analysis; writes a rebuildable local reader title index, never report originals.
import fs from 'node:fs';
import path from 'node:path';
import {hash} from './agent-team/tools.mjs';
import {plainText} from '../js/agent-team/reading-content.mjs';
const root=path.resolve('.local/agent-team'),dest=path.resolve('.local/reader-content'),catalog={};
if(!fs.existsSync(root))throw Error('本机尚无保存研究');
const deadline=Date.now()+20000;
for(const file of fs.readdirSync(root).filter(n=>/^report-[a-f0-9-]{36}\.json$/.test(n))){if(Date.now()>deadline)throw Error('reader_catalog_deadline');const saved=JSON.parse(fs.readFileSync(path.join(root,file),'utf8')),r=saved.payload;if(r?.role!=='chief'||saved.hash!==hash(r))continue;let title=plainText(r.report.summary.split(/[。！？]/)[0]);try{const edition=JSON.parse(fs.readFileSync(path.join(dest,r.id+'.json'),'utf8'));if(edition.sourceHash===saved.hash&&edition.reportId===r.id)title=edition.title;}catch{}catalog[r.cycleId]={reportId:r.id,title};}
fs.mkdirSync(dest,{recursive:true});const temp=path.join(dest,'catalog.tmp');fs.writeFileSync(temp,JSON.stringify(catalog,null,2));fs.renameSync(temp,path.join(dest,'catalog.json'));console.log(JSON.stringify({catalogEntries:Object.keys(catalog).length,originalsChanged:false}));
