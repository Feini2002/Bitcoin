const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{pathToFileURL}=require('node:url'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
(async()=>{
  const {runCostCase}=await import(pathToFileURL(path.join(root,'tests/fixtures/d1-cost-cases.mjs')));
  const schema=['cloudflare/schema.sql','cloudflare/finance/dataset-schema.sql','cloudflare/finance/desk-history-migration.sql'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n');
  const originals=JSON.parse(fs.readFileSync(path.join(root,'docs/research/d1-cost-review-2026-10-05/queries.json'),'utf8'));
  const results=[], manifest={schema,cases:[]};
  for(const [H,V] of [[800,1],[8000,1],[80000,1],[20,1],[20,10],[20,100]]) {
    const sqlite=new DatabaseSync(':memory:');sqlite.exec(schema);
    const db={batches:[],prepare(sql){return {sql,params:[],bind(...params){this.params=params;return this;}};},
      async batch(queries){db.batches.push(queries.map(({sql,params})=>({sql,params})));sqlite.exec('BEGIN');
        try {const output=queries.map(q=>({results:sqlite.prepare(q.sql).all(...q.params)}));sqlite.exec('COMMIT');return output;}
        catch(e){sqlite.exec('ROLLBACK');throw e;}}};
    const r=await runCostCase(db,{H,V,originals});
    assert.equal(sqlite.prepare("SELECT c FROM klines WHERE t=?").get(1791200000000).c,101);
    const projection=r.batches.flat().find(q=>q.sql.includes('INSERT INTO klines'));
    const plan=sqlite.prepare('EXPLAIN QUERY PLAN '+projection.sql).all(...projection.params).map(r=>r.detail);
    assert.ok(plan.some(line=>line.includes('idx_finance_kline_winner')),JSON.stringify(plan));
    assert.ok(!plan.some(line=>/TEMP B-TREE FOR ORDER BY/.test(line)),JSON.stringify(plan));
    const init=r.samples.filter(s=>s.version==='new').map(s=>({name:s.name,rowsRead:null}));
    manifest.cases.push({H,V,batches:db.batches});
    results.push({H,V,engine:sqlite.prepare('SELECT sqlite_version() v').get().v,init,winnerIndex:true,rowsRead:null});
    sqlite.close();console.log(`PASS SCALE H=${H} V=${V}: data + indexed winner; D1 rows_read UNKNOWN`);
  }
  const dir=path.join(root,'.artifacts/d1-cost-repair');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'scale-manifest.json'),JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir,'scale-results-node.json'),JSON.stringify(results,null,2)+'\n');
  if(!process.argv.includes('--cross-engine')) {
    console.log('PASS Node SQLite scale/data/index regression; REVIEW D1 billing and optional Python VM measurement are separate');return;
  }
  const output=execFileSync('python',[path.join(root,'tests/integration/verify-d1-cost-scale.py'),path.join(dir,'scale-manifest.json')],{encoding:'utf8',timeout:30000,maxBuffer:128*1024,windowsHide:true});
  const python=JSON.parse(output);fs.writeFileSync(path.join(dir,'scale-results-cross-engine.json'),JSON.stringify({node:results,python},null,2)+'\n');
  console.log(JSON.stringify(python));
  const h=python.cases.slice(0,3).map(r=>r.commitVmSteps),v=python.cases.slice(3).map(r=>r.commitVmSteps);
  assert.ok(Math.max(...h)-Math.min(...h)<=Math.max(100,Math.min(...h)*0.1),'local VM work grows with H');
  assert.ok(Math.max(...v)-Math.min(...v)<=Math.max(100,Math.min(...v)*0.1),'local VM work grows with V');
  console.log('PASS local VM scaling; REVIEW actual D1 per-statement cost and 24-hour workload still require isolated cloud validation');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
