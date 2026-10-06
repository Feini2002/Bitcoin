// No production database queries. Default is a local, reviewable plan.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {CloudControl,makeApi}=require('../operations/cloud-control.cjs');
const {officialAuth,ROOT}=require('./cloud-read-check.cjs');
const LIMITS={rowsRead:10000000,rowsWritten:100000,requestReadReserve:250000,requestWriteReserve:40000};
const MATRIX=[[10,1],[100,1],[1000,1],[20,1],[20,10],[20,100]];
const plan={scope:'new disposable D1 database, synthetic data only; no Worker upload, production SQL or resume',
  matrix:MATRIX,budget:LIMITS,deadlineSeconds:300,cleanup:'delete only the database created by this run',
  evidence:'per-statement D1 rows_read/rows_written/changes; Worker-binding rollback and 24-hour live DO validation remain separate'};
async function run(args=process.argv.slice(2)) {
  if(args.length===0 || (args.length===1 && args[0]==='--plan')) {console.log(JSON.stringify(plan,null,2));return;}
  assert.deepEqual(args,['--run'],'Use --plan or explicitly authorized --run');
  const state=JSON.parse(fs.readFileSync(path.join(ROOT,'cloudflare/cloud-control-state.json'),'utf8'));
  const api=makeApi(officialAuth()),control=new CloudControl({state,api});
  assert.equal(control.classify(await control.snapshot()),'paused','BTC must remain paused');
  const productionIds=new Set(Object.values(state.restore.workers).flatMap(w=>w.bindings.filter(b=>b.type==='d1').map(b=>b.id)));
  const base=`/accounts/${state.accountId}/d1/database`;
  const name='btc-cost-test-'+Date.now()+'-'+crypto.randomBytes(4).toString('hex');
  const dir=path.join(ROOT,'.artifacts/d1-cost-repair');fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,name+'.json');
  const report={name,createdAt:new Date().toISOString(),databaseId:null,plan,rowsRead:0,rowsWritten:0,changes:0,requests:0,unknownCost:false,stages:[],cleanup:'pending'};
  const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n');save();
  const deadline=Date.now()+240000;
  let id,stage='schema';
  try {
    const created=await api(base,'POST',{name});id=created.uuid;
    assert.ok(typeof id==='string' && !productionIds.has(id),'test ID must differ from every production binding');
    report.databaseId=id;save();
    const db={prepare(sql){return {sql,params:[],bind(...params){this.params=params;return this;},
      async all(){return (await db.batch([this]))[0];}};},
      async batch(queries){
        assert.ok(Date.now()<deadline,'validation deadline; cleanup still has reserved time');
        assert.ok(!report.unknownCost,'unknown cost stops further SQL');
        assert.ok(report.rowsRead+LIMITS.requestReadReserve<=LIMITS.rowsRead,'read budget reserve exhausted');
        assert.ok(report.rowsWritten+LIMITS.requestWriteReserve<=LIMITS.rowsWritten,'write budget reserve exhausted');
        let results;
        try {results=await api(`${base}/${id}/query`,'POST',{batch:queries.map(q=>({sql:q.sql,params:q.params}))});}
        catch(error){report.unknownCost=true;report.unknownReservation={rowsRead:LIMITS.requestReadReserve,rowsWritten:LIMITS.requestWriteReserve};save();throw error;}
        assert.ok(Array.isArray(results) && results.length===queries.length,'D1 statement metadata count mismatch');
        const metrics=results.map(r=>r.meta);
        if(metrics.some(m=>!['rows_read','rows_written','changes'].every(k=>Number.isFinite(m?.[k]) && m[k]>=0))) {
          report.unknownCost=true;save();throw Error('missing D1 metadata; no zero-cost assumption');
        }
        const sum=k=>metrics.reduce((n,m)=>n+m[k],0);
        const read=sum('rows_read'),write=sum('rows_written');
        report.rowsRead+=read;report.rowsWritten+=write;report.changes+=sum('changes');report.requests++;
        report.stages.push({stage,statements:metrics.map(m=>({rowsRead:m.rows_read,rowsWritten:m.rows_written,changes:m.changes}))});save();
        assert.ok(read<=LIMITS.requestReadReserve && write<=LIMITS.requestWriteReserve,'per-request reservation exceeded; stop');
        return results;
      }};
    for(const f of ['cloudflare/schema.sql','cloudflare/finance/dataset-schema.sql','cloudflare/finance/desk-history-migration.sql']) {
      const sql=fs.readFileSync(path.join(ROOT,f),'utf8');
      const statements=sql.split(';').map(s=>s.replace(/^\s*--.*$/gm,'').trim()).filter(Boolean);
      await db.batch(statements.map(s=>db.prepare(s)));
    }
    const originals=JSON.parse(fs.readFileSync(path.join(ROOT,'docs/research/d1-cost-review-2026-10-05/queries.json'),'utf8'));
    const {runCostCase}=await import(pathToFileURL(path.join(ROOT,'tests/fixtures/d1-cost-cases.mjs')));
    report.cases=[];
    for(const [H,V] of MATRIX) {
      stage=`H${H}-V${V}`;
      const result=await runCostCase(db,{H,V,originals});
      report.cases.push({H,V,init:result.samples.map(s=>({name:s.name,version:s.version,meta:s.meta})),costs:result.costs});save();
      assert.ok(result.samples.filter(s=>s.version==='new').every(s=>s.meta.rows_read<=8),'warm init >8 rows');
      console.log(JSON.stringify({stage,totalRowsRead:report.rowsRead,totalRowsWritten:report.rowsWritten}));
    }
    const sums=report.cases.map(c=>c.costs.reduce((n,m)=>n+m.rowsRead,0));
    for(const values of [sums.slice(0,3),sums.slice(3)]) assert.ok(Math.max(...values)-Math.min(...values)<=Math.max(32,Math.min(...values)*0.1),'complete operation cost scales with H/V');
    report.status='PASS_COST_MATRIX';
    // Failed D1 requests may omit their consumed cost. Do not invent zero or
    // spend more after UNKNOWN; Worker-binding rollback stays a separate gate.
  } catch(error) {report.status='REVIEW';report.error=error.message;process.exitCode=2;}
  finally {
    if(id && !productionIds.has(id)) {
      try {const existing=await api(`${base}/${id}`);assert.equal(existing.name,name);
        await api(`${base}/${id}`,'DELETE');report.cleanup='deleted_created_database';}
      catch(error){report.cleanup='REVIEW';report.cleanupError=error.message;process.exitCode=2;}
    } else report.cleanup='REVIEW_CREATION_OUTCOME';
    report.finishedAt=new Date().toISOString();save();
    console.log(JSON.stringify({status:report.status,rowsRead:report.rowsRead,rowsWritten:report.rowsWritten,unknownCost:report.unknownCost,cleanup:report.cleanup,reportFile:file}));
  }
}
module.exports={run,plan};
if(require.main===module)run().catch(e=>{console.error(e.message);process.exitCode=1;});
