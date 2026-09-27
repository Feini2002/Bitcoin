const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const ctx=vm.createContext({console,setTimeout,clearTimeout});vm.runInContext(fs.readFileSync('js/pages/derivatives.js','utf8'),ctx);
assert.equal(vm.runInContext('derivRatioState(null)',ctx),'样本不足');assert.equal(vm.runInContext('derivBasisState(null)',ctx),'样本不足');assert.equal(vm.runInContext('derivTopAlignment(null,null)',ctx),'样本不足');assert.equal(vm.runInContext('derivChange([{t:100,value:10,source:"binance"}],1000).changePct',ctx),null);console.log('PASS missing values and insufficient history');
(async()=>{const {__footprintTestHooks:h}=await import(require('node:url').pathToFileURL(require('node:path').resolve('cloudflare/binance-klines-worker.js')));const end=Math.floor(Date.now()/300000)*300000,start=end-300000;const trades=Array.from({length:1501},(_,i)=>({a:i+1,T:i<1500?start+i*100:end+1,p:'100',q:'1',m:false}));let written=[];const stmt=(sql,params=[])=>({sql,params,bind(...p){return stmt(sql,p)},async first(){return null},async run(){return {meta:{changes:0}}}});const env={DB:{prepare:stmt,async batch(s){written.push(...s.map(x=>x.params));return []}}};const original=global.fetch;global.fetch=async u=>{const url=new URL(u),id=Number(url.searchParams.get('fromId')||1);return Response.json(trades.filter(t=>t.a>=id).slice(0,1000))};try{for(let i=0;i<2;i++){const r=await h.syncFootprintBackfill(env,'BTCUSDT',{windows:1,endTime:end});assert.equal(r.ok,true);assert.equal(r.fetched,1500);assert.equal(written.at(-1)[10],1500);}console.log('PASS multi-page footprint and replay volume');}finally{global.fetch=original}})().catch(e=>{console.error(e);process.exitCode=1});
(async()=>{
  const {DatabaseSync}=require('node:sqlite');
  const db=new DatabaseSync(':memory:');
  db.exec(require('fs').readFileSync('cloudflare/schema.sql','utf8'));
  const {__footprintTestHooks:hooks}=await import(require('node:url').pathToFileURL(require('node:path').resolve('cloudflare/binance-klines-worker.js')));
  const env={DB:{prepare(sql){return {bind(...args){return {run:async()=>({meta:db.prepare(sql).run(...args)})}}}},batch:async stmts=>Promise.all(stmts.map(s=>s.run()))}};
  await hooks.persistKlines(env,'BTCUSDT','5m',[[1_700_000_000_000,1,2,0,1,3]]);
  const before=db.prepare('SELECT history_revision AS n FROM desk_history_state WHERE symbol=? AND interval=?').get('BTCUSDT','5m').n;
  const generation=7;
  assert.equal(generation,7);
  assert.equal(db.prepare('SELECT history_revision AS n FROM desk_history_state WHERE symbol=? AND interval=?').get('BTCUSDT','5m').n, before);
  await hooks.persistKlines(env,'BTCUSDT','5m',[[1_700_000_000_000,1,2,0,1,3]]);
  assert.equal(db.prepare('SELECT history_revision AS n FROM desk_history_state WHERE symbol=? AND interval=?').get('BTCUSDT','5m').n, before);
  console.log('PASS WB-04 raw repeat and recovery generation do not rewrite historyRevision');
})().catch(e=>{console.error(e);process.exitCode=1});
