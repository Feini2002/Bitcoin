// Read-only live acceptance against D1; optional public bootstrap SQL is the expected fixture.
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {pathToFileURL}=require('node:url');
const {isDeepStrictEqual}=require('node:util');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'.artifacts/finance-datasets');
(async()=>{
  const {FINANCE_DATASETS:D}=await import(pathToFileURL(path.join(root,'cloudflare/finance/datasets.mjs')));
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync(path.join(root,'cloudflare/finance/dataset-schema.sql'),'utf8'));
  for(const name of fs.readdirSync(dir).filter(f=>/^binance-bootstrap.*\.sql$/.test(f)))sqlite.exec(fs.readFileSync(path.join(dir,name),'utf8'));
  const results=[];
  for(const [id,definition] of Object.entries(D)){
    let result={id};
    try{
      const response=await fetch('https://btc.feiniwork.com/api/finance/datasets/'+id,{signal:AbortSignal.timeout(18000)});
      const data=await response.json();
      result={id,http:response.status,status:data.ok&&response.ok?'PASS':'MISSING',rows:data.observations?.length||0,
        available:data.coverage?.available||0,sourceStale:data.sourceStale??null,collectionStale:data.collectionStale??null,
        latestError:data.state?.last_error||data.error||null,mode:data.state?.last_ingestion_mode||null};
      if(result.status==='PASS'){
        if(data.provider!==definition.provider||data.operation!==definition.operation||data.coverage.truncated)throw Error('source_or_coverage_mismatch');
        result.sources=[...new Set(data.observations.map(r=>r.sourceHost))];
        result.firstObservation=data.observations.at(-1)?.observedAt||null;
        result.lastObservation=data.observations[0]?.observedAt||null;
        const expected=sqlite.prepare('SELECT * FROM finance_dataset_observations WHERE dataset_id=?').all(id);
        if(expected.length){
          const byKey=new Map(data.observations.map(r=>[r.key,r]));
          for(const e of expected){const actual=byKey.get(e.observation_key);if(!actual||actual.receivedAt!==e.received_at||actual.sourceHost!==e.source_host||actual.ingestionMode!==e.ingestion_mode||!isDeepStrictEqual(actual.values,JSON.parse(e.value_json)))throw Error('bootstrap_readback_mismatch');}
          result.bootstrapComparison='PASS';
        }
      }
    }catch(e){result={...result,status:'FAIL',error:['source_or_coverage_mismatch','bootstrap_readback_mismatch'].includes(e.message)?e.message:'read_network_or_timeout'};}
    results.push(result);console.log(JSON.stringify(result));
  }
  sqlite.close();
  const report={checkedAt:new Date().toISOString(),pass:results.filter(r=>r.status==='PASS').length,missing:results.filter(r=>r.status==='MISSING').length,fail:results.filter(r=>r.status==='FAIL').length,rows:results.reduce((n,r)=>n+r.rows,0),results};
  const file=path.join(dir,'acceptance.json');fs.writeFileSync(file,JSON.stringify(report,null,2));
  console.log(JSON.stringify({report:file,pass:report.pass,missing:report.missing,fail:report.fail,rows:report.rows}));
  if(report.missing||report.fail)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
