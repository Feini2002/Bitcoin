// Finite, public-data acquisition. No local API keys are read and no daemon is started.
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
const {isDeepStrictEqual}=require('node:util');
const args=process.argv.slice(2);
const option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
const mode=option('--mode')||'cloud',origin=option('--origin')||'https://btc.feiniwork.com';
const selected=option('--dataset');
const dir=path.resolve(__dirname,'../.artifacts/finance-datasets');
const sqlValue=value=>value===null?'NULL':typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
(async()=>{
  if(!['cloud','local-bootstrap'].includes(mode))throw Error('mode must be cloud or local-bootstrap');
  const {FINANCE_DATASETS:D,datasetRequest}=await import(pathToFileURL(path.resolve(__dirname,'../cloudflare/finance/datasets.mjs')));
  const {datasetWriteQueries}=await import(pathToFileURL(path.resolve(__dirname,'../cloudflare/finance/dataset-store.mjs')));
  const {handleFinance}=await import(pathToFileURL(path.resolve(__dirname,'../cloudflare/finance/gateway.mjs')));
  const {FINANCE_PROVIDERS:P}=await import(pathToFileURL(path.resolve(__dirname,'../cloudflare/finance/registry.mjs')));
  const ids=Object.keys(D).filter(id=>(!selected||id===selected)&&(mode!=='local-bootstrap'||
    (selected?!P[D[id].provider].secret&&!P[D[id].provider].setting:D[id].provider.startsWith('binance-'))));
  if(!ids.length)throw Error('no matching datasets');
  fs.mkdirSync(dir,{recursive:true});
  const results=[],statements=[];let next=0;
  console.log(JSON.stringify({pid:process.pid,mode,total:ids.length,concurrency:2,remoteWrites:mode==='cloud'}));
  async function run(){while(next<ids.length){
    const id=ids[next++],start=Date.now();let result={id,provider:D[id].provider,mode};
    try{
      if(mode==='cloud'){
        const response=await fetch(`${origin}/api/finance/datasets/${id}/refresh`,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(25000)});
        const body=await response.json();
        result={...result,status:response.ok&&body.ok?'PASS':'FAIL',http:response.status,error:body.error||null,diagnosis:body.diagnosis||null,upstreamStatus:body.upstreamStatus||null};
        if(result.status==='PASS'){
          const saved=await fetch(`${origin}/api/finance/datasets/${id}`,{redirect:'manual',signal:AbortSignal.timeout(20000)});
          const read=await saved.json();
          result.rows=body.observations.length;result.receivedAt=body.state.last_success_received_at;
          result.readback=saved.ok&&read.ok&&isDeepStrictEqual(body.observations,read.observations)&&body.storage.persisted===true?'PASS':'FAIL';
          if(result.readback!=='PASS'){result.status='FAIL';result.error='dataset_readback_mismatch';}
        }
      }else{
        const response=await handleFinance(datasetRequest(id),{}, {},{cache:null});
        const body=await response.json();
        result={...result,status:response.ok&&body.ok?'PREPARED':'FAIL',http:response.status,error:body.error||null,diagnosis:body.diagnosis||null,upstreamStatus:body.upstreamStatus||null};
        if(result.status==='PREPARED'){
          const {queries,normalized}=datasetWriteQueries(id,body,'local-bootstrap');
          const sql=queries.map(q=>q.sql.replace(/\?(\d+)/g,(_,n)=>sqlValue(q.params[Number(n)-1]))+';');
          if(sql.some(s=>Buffer.byteLength(s)>99000))throw Error('dataset_sql_statement_too_large');
          statements.push(...sql);result.rows=normalized.rows.length;result.receivedAt=normalized.receivedAt;
          result.sourceHost=normalized.sourceHost;
        }
      }
    }catch(error){result={...result,status:'FAIL',error:/^dataset_/.test(error.message)?error.message:'collection_network_or_timeout'};}
    result.elapsedMs=Date.now()-start;results.push(result);console.log(JSON.stringify(result));
    fs.writeFileSync(path.join(dir,mode+'-progress.json'),JSON.stringify({checkedAt:new Date().toISOString(),total:ids.length,completed:results.length,results},null,2));
  }}
  await Promise.all([run(),run()]);
  const report={checkedAt:new Date().toISOString(),mode,origin:mode==='cloud'?origin:null,pass:results.filter(r=>r.status==='PASS').length,
    prepared:results.filter(r=>r.status==='PREPARED').length,fail:results.filter(r=>r.status==='FAIL').length,results};
  const file=path.join(dir,mode+(selected?'-'+selected:'')+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2));
  if(mode==='local-bootstrap'){
    const sqlFile=path.join(dir,'binance-bootstrap'+(selected?'-'+selected:'')+'.sql');
    fs.writeFileSync(sqlFile,'-- Public Binance samples. Source remains Binance; acquisition mode is local-bootstrap.\n'+statements.join('\n'));
    console.log(JSON.stringify({preparedSql:sqlFile,statements:statements.length,remoteApplied:false}));
  }
  console.log(JSON.stringify({report:file,pass:report.pass,prepared:report.prepared,fail:report.fail}));
  if(report.fail)process.exitCode=1;
})().catch(error=>{console.error(error.message);process.exitCode=1;});
