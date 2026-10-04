const fs=require('node:fs'),Module=require('node:module'),path=require('node:path');const {pathToFileURL}=require('node:url');
const cli=require.resolve('wrangler');const mod=new Module(cli,module);mod.filename=cli;mod.paths=Module._nodeModulePaths(path.dirname(cli));mod._compile(fs.readFileSync(cli,'utf8')+'\nmodule.exports.marketQuery=async function(body){init_cfetch();return fetchResult({},"/accounts/5c7e14191f8b616a07f03f767ec48bb8/d1/database/de758bb8-c7f5-41c7-a6ea-32c0ddf74d57/query",{method:"POST",body:JSON.stringify(body),headers:{"Content-Type":"application/json"}},undefined,AbortSignal.timeout(20000));};',cli);
let queries=0;const quote=v=>v==null?'NULL':typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
async function query(sql,params=[]){const result=await mod.exports.marketQuery({sql,params});queries++;console.log('D1',queries,sql.trim().split(/\s+/)[0],result.length);return result;}
function stmt(sql,params=[]){return {sql,params,bind(...p){return stmt(sql,p)},async all(){return (await query(sql,params))[0]},async first(){return (await this.all()).results?.[0]||null},async run(){return (await query(sql,params))[0]}}}
const env={DB:{prepare:stmt,async batch(stmts){return query(stmts.map(s=>s.sql.replace(/\?(\d+)/g,(_,n)=>quote(s.params[Number(n)-1]))).join(';\n'))}}};
// Public market data only. Uses the existing Wrangler login; no credentials are copied.
const watch=process.argv.includes('--watch');
const deadline=Date.now()+8*60*60*1000;
const statusFile=path.resolve('.artifacts/market-collector-status.json');
fs.mkdirSync(path.dirname(statusFile),{recursive:true});
let stopped=false,lastDerivatives=0;
process.on('SIGINT',()=>{stopped=true});process.on('SIGTERM',()=>{stopped=true});
const status={pid:process.pid,startedAt:new Date().toISOString(),deadline:new Date(deadline).toISOString(),state:'starting'};
function save(){fs.writeFileSync(statusFile,JSON.stringify(status,null,2));}
(async()=>{const {__footprintTestHooks:h}=await import(pathToFileURL(path.resolve('cloudflare/binance-klines-worker.js')));
 do {
  try {
   status.state='footprint';save();const fp=await h.syncFootprintOne(env,'BTCUSDT');
   status.footprint={ok:fp.ok,fetched:fp.fetched,written:fp.written,latestTime:fp.lastTradeTime,error:fp.error||null};
   console.log('FOOTPRINT',JSON.stringify(status.footprint));save();
   if(Date.now()-lastDerivatives>=15*60*1000){status.state='derivatives';save();const d=await h.syncDerivativesOne(env,'BTCUSDT',{groups:'core',force:true,interaction:'manual_blocking'});status.derivatives={ok:d.ok,written:d.written,errors:d.errors||[]};lastDerivatives=Date.now();console.log('DERIVATIVES',JSON.stringify(status.derivatives));}
   status.state='waiting';status.lastCycleAt=new Date().toISOString();status.error=null;save();
  } catch(error){status.state='error';status.error=error.message;save();console.error(error.message);if(!watch)process.exitCode=1;}
  if(watch&&!stopped&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,30000));
 } while(watch&&!stopped&&Date.now()<deadline);
 status.state='stopped';save();
})().catch(error=>{console.error(error.message);process.exitCode=1});
