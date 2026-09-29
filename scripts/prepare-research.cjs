#!/usr/bin/env node
'use strict';
// Read-only evidence bundle. No collection, synchronization, model or database writes.
const fs=require('node:fs');
const path=require('node:path');
const protocol=require('../js/research-protocol.js');
async function main(){
  const args=process.argv.slice(2);
  if(args.includes('--help')){console.log('node scripts/prepare-research.cjs --kind=daily_event|sentiment_analysis [--out=<directory>]');return;}
  if(args.some(a=>!a.startsWith('--kind=')&&!a.startsWith('--out=')))throw Error('Unknown argument');
  const kind=args.find(a=>a.startsWith('--kind='))?.slice(7)||'daily_event';
  if(!Object.hasOwn(protocol.modules,kind))throw Error('Unsupported report kind');
  const directory=path.resolve(args.find(a=>a.startsWith('--out='))?.slice(6)||path.join(__dirname,'../.artifacts/research',new Date().toISOString().replace(/[:.]/g,'-')));
  fs.mkdirSync(directory,{recursive:true});
  const closedBoundary=Math.floor(Date.now()/900000)*900000;
  const endpoints=[
    ['chart','https://btc.feiniwork.com/api/desk/chart?symbol=BTCUSDT&interval=15m&from='+(closedBoundary-864*900000)+'&to='+closedBoundary],
    ['orderflow','https://btc.feiniwork.com/api/desk/orderflow?symbol=BTCUSDT&interval=5m'],
    ['heatmap','https://btc.feiniwork.com/api/desk/heatmap?symbol=BTCUSDT&range=24h'],
    ['context','https://btc.feiniwork.com/api/desk/context?symbol=BTCUSDT'],
    ['events','https://yuqing.feiniwork.com/api/yuqing/reports/latest?kind=daily_event'],
    ['analysis','https://yuqing.feiniwork.com/api/yuqing/reports/latest?kind=sentiment_analysis']
  ];
  const deadline=AbortSignal.timeout(25000);
  const records=await Promise.all(endpoints.map(async([name,url])=>{
    const accessedAt=new Date().toISOString();
    try{const response=await fetch(url,{signal:deadline,headers:{Accept:'application/json'}});if(!response.ok)throw Error('HTTP '+response.status);const data=await response.json();const file=name+'.json';fs.writeFileSync(path.join(directory,file),JSON.stringify({url,accessedAt,data},null,2));console.log('READ '+name+' -> '+file);return {name,url,accessedAt,file,ok:true};}
    catch(e){console.log('UNAVAILABLE '+name+' '+e.message);return {name,url,accessedAt,ok:false,error:e.message};}
  }));
  const manifest={kind,capturedAt:new Date().toISOString(),records,notice:'Read responses are not quality approval. Inspect source time, collectionStale, sourceStale, quality, coverage, gaps and per-source errors. Partial/unavailable evidence cannot support missing claims.'};
  fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2));
  fs.writeFileSync(path.join(directory,'research-instructions.txt'),protocol.prompt(kind));
  console.log(JSON.stringify({directory,available:records.filter(r=>r.ok).length,total:records.length,complete:records.every(r=>r.ok)}));
  if(!records.some(r=>r.ok))process.exitCode=1;
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
