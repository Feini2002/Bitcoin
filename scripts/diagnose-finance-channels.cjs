// Public-data probes. With storage enabled, gateway reads cache successful payloads in D1.
// Reports contain metadata only; no API credentials or source payloads are written here.
const fs=require('node:fs'),path=require('node:path');
const {isDeepStrictEqual}=require('node:util');
const {pathToFileURL}=require('node:url');
const args=process.argv.slice(2);
const originIndex=args.indexOf('--origin');
const origin=originIndex>=0?args[originIndex+1]:null;
const all=args.includes('--all');
const selectedIndex=args.indexOf('--provider');
const selected=selectedIndex>=0?args[selectedIndex+1]:null;
const operationIndex=args.indexOf('--operation');
const selectedOperation=operationIndex>=0?args[operationIndex+1]:null;
const verifyD1=args.includes('--d1');
(async()=>{
  const {FINANCE_PROVIDERS:P}=await import(pathToFileURL(path.resolve(__dirname,'../cloudflare/finance/registry.mjs')));
  const {handleFinance}=await import(pathToFileURL(path.resolve(__dirname,'../cloudflare/finance/gateway.mjs')));
  const jobs=Object.entries(P).filter(([id])=>!selected||id===selected);
  if(!jobs.length || (selectedOperation && (!selected || !P[selected]?.operations[selectedOperation]))) throw Error('unknown provider or operation');
  if(verifyD1 && !origin)throw Error('--d1 requires --origin');
  const results=[];let next=0;
  async function run(){
    while(next<jobs.length){
      const [id,p]=jobs[next++];
      for(const name of (selectedOperation?[selectedOperation]:all?Object.keys(p.operations):[Object.keys(p.operations)[0]])){
        const start=Date.now();
        let item={provider:id,operation:name};
        if(!origin && (p.secret||p.setting))item={...item,status:'PENDING',reason:p.secret?'missing-free-key':'missing-contact-setting'};
        else try{
          const url=(origin||'https://local-probe.invalid')+'/api/finance/'+id+'/'+name;
          const response=origin?await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(18000)}):await handleFinance(new Request(url),{}, {},{cache:null});
          let body;try{body=await response.json();}catch(_){body={error:'non_json_gateway_or_access_login'};}
          const pending=response.status===503&&/^missing_/.test(body.error||'');
          item={...item,status:response.ok&&body.ok?'PASS':pending?'PENDING':'FAIL',http:response.status,error:body.error||null,diagnosis:body.diagnosis||null,upstreamStatus:body.upstreamStatus||null,receivedAt:body.receivedAt||null,cache:body.cache?.hit||false};
          if(verifyD1 && item.status==='PASS') {
            const savedResponse=await fetch(origin+'/api/finance/stored/'+id+'/'+name,{redirect:'manual',signal:AbortSignal.timeout(18000)});
            const saved=await savedResponse.json();
            item.d1=savedResponse.ok && saved.ok && body.storage?.persisted===true && saved.storage?.persisted===true
              && saved.receivedAt===body.receivedAt && saved.storage.storedAt===body.storage.storedAt
              && isDeepStrictEqual(saved.parameters,body.parameters) && isDeepStrictEqual(saved.data,body.data) ? 'PASS':'FAIL';
            item.storedAt=saved.storage?.storedAt||null;
            if(item.d1!=='PASS'){item.status='FAIL';item.error='d1_readback_mismatch';}
          }
        }catch(_){item={...item,status:'FAIL',error:'probe_network_or_timeout'};}
        item.elapsedMs=Date.now()-start;results.push(item);console.log(JSON.stringify(item));
      }
    }
  }
  console.log(JSON.stringify({pid:process.pid,mode:origin?'cloudflare-gateway':'local-direct',origin,providers:jobs.length,all,concurrency:3}));
  await Promise.all([run(),run(),run()]);
  const summary={checkedAt:new Date().toISOString(),origin,all,verifyD1,pass:results.filter(x=>x.status==='PASS').length,pending:results.filter(x=>x.status==='PENDING').length,fail:results.filter(x=>x.status==='FAIL').length,results};
  const dir=path.resolve(__dirname,'../.artifacts/finance-channels');fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,(origin?'cloudflare':'local')+(verifyD1?'-d1':'')+(selected?'-'+selected:'')+(selectedOperation?'-'+selectedOperation:'')+'.json');fs.writeFileSync(file,JSON.stringify(summary,null,2));
  console.log(JSON.stringify({report:file,pass:summary.pass,pending:summary.pending,fail:summary.fail}));
  if(summary.fail)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
