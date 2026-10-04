#!/usr/bin/env node
'use strict';
// Read-only evidence bundle. No collection, synchronization, model or database writes.
const fs=require('node:fs');
const path=require('node:path');
const protocol=require('../../js/research-protocol.js');
const evidence=require('../../js/evidence-bundle.js');
async function main(){
  const args=process.argv.slice(2);
  if(args.includes('--help')){console.log('node scripts/research/prepare-research.cjs --kind=daily_event|sentiment_analysis [--out=<new-directory>] [--known-at=<ISO-time>]');return;}
  if(args.some(a=>!a.startsWith('--kind=')&&!a.startsWith('--out=')&&!a.startsWith('--known-at=')))throw Error('Unknown argument');
  const kind=args.find(a=>a.startsWith('--kind='))?.slice(7)||'daily_event';
  if(!Object.hasOwn(protocol.modules,kind))throw Error('Unsupported report kind');
  const directory=path.resolve(args.find(a=>a.startsWith('--out='))?.slice(6)||path.join(__dirname,'../../.artifacts/research',new Date().toISOString().replace(/[:.]/g,'-')));
  const knowledgeCutoff=args.find(a=>a.startsWith('--known-at='))?.slice(11)||new Date().toISOString();
  if(!Number.isFinite(Date.parse(knowledgeCutoff))||Date.parse(knowledgeCutoff)>Date.now())throw Error('Invalid/future knowledge cutoff');
  // Explicit output directories must be new: never overwrite a frozen package.
  fs.mkdirSync(path.dirname(directory),{recursive:true});
  fs.mkdirSync(directory);
  const closedBoundary=Math.floor(Date.parse(knowledgeCutoff)/900000)*900000;
  const endpoints=[
    ['chart','https://btc.feiniwork.com/api/desk/chart?symbol=BTCUSDT&interval=15m&from='+(closedBoundary-864*900000)+'&to='+closedBoundary],
    ['orderflow','https://btc.feiniwork.com/api/desk/orderflow?symbol=BTCUSDT&interval=5m'],
    ['heatmap','https://btc.feiniwork.com/api/desk/heatmap?symbol=BTCUSDT&range=24h'],
    ['context','https://btc.feiniwork.com/api/desk/context?symbol=BTCUSDT'],
    ['events','https://yuqing.feiniwork.com/api/yuqing/reports/latest?kind=daily_event'],
    ['analysis','https://yuqing.feiniwork.com/api/yuqing/reports/latest?kind=sentiment_analysis']
  ];
  const deadline=AbortSignal.timeout(25000);
  const records=await Promise.all(endpoints.map(async([name,baseUrl])=>{
    const requestUrl=new URL(baseUrl);
    if(evidence.scopes.includes(name))requestUrl.searchParams.set('knownAt',new Date(knowledgeCutoff).toISOString());
    const url=requestUrl.href;
    const accessedAt=new Date().toISOString();
    try{const response=await fetch(url,{signal:deadline,headers:{Accept:'application/json'}});if(!response.ok)throw Error('HTTP '+response.status);const data=await response.json();console.log('READ '+name);return {name,url,accessedAt,data,ok:true};}
    catch(e){console.log('UNAVAILABLE '+name+' '+e.message);return {name,url,accessedAt,ok:false,error:e.message};}
  }));
  const bundle=evidence.build({kind,asOf:knowledgeCutoff,knowledgeCutoff,resources:records,capturedAt:new Date().toISOString()});
  if(evidence.validate(bundle).length)throw Error('Evidence integrity failure');
  fs.writeFileSync(path.join(directory,'evidence-bundle.json'),JSON.stringify(bundle,null,2),{flag:'wx'});
  fs.writeFileSync(path.join(directory,'research-instructions.txt'),protocol.prompt(kind)+'\n共享证据包：'+bundle.contentId+'\n所有角色必须先核对 knowledgeCutoff、cutoffComplete、analysisReady 与逐源缺口。',{flag:'wx'});
  console.log(JSON.stringify({directory,available:records.filter(r=>r.ok).length,total:records.length,contentId:bundle.contentId,
    transportComplete:bundle.transportComplete,cutoffComplete:bundle.cutoffComplete,analysisReady:bundle.analysisReady}));
  if(!records.some(r=>r.ok))process.exitCode=1;
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main};
