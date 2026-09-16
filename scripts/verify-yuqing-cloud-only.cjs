// Cloud-only report API regression; all external/model/storage operations use fixtures.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const ROOT=path.join(__dirname,'..');
let source=fs.readFileSync(path.join(ROOT,'cloudflare/yuqing/yuqing-worker.js'),'utf8');
source=source.replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm,'').replace('export default {','globalThis.worker = {');
const savedRows=[],reads=[],writes=[],calls=[];
const settings={model_channels:{assignments:{'daily_event.trends':'gemini-3.1-pro-preview'},codex:{modules:{'daily_event.trends':{model:'gpt-5.5'}}}},execution_channels:{assignments:{daily_event:'codex_cli',sentiment_analysis:'codex_cli'}}};
const historical={id:'historical',kind:'daily_event',report_date:'2026-05-22',slot:'08',trigger_type:'manual',generated_at:'2026-05-22T00:00:00Z',status:'ready',report_json:'{"title":"历史报告"}',grounding_json:'{"generator":"codex_cli_bridge"}',source_refs_json:'[]',source_errors_json:'[]',market_snapshot_json:'{}'};
const db={prepare(sql){assert(!sql.includes('yuqing_codex_tasks'),'retired queue accessed');return {bind(){return this},async first(){return historical},async all(){return {results:[historical]}},async run(){return {meta:{changes:1}}}}}};
const env={YUQING_DB:db};
const ctx={console,Date,Intl,URL,URLSearchParams,TextEncoder,Response,Request,ReadableStream,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto,
 accessCorsHeaders:()=>({}),accessServiceHeaders:()=>({}),requireCloudflareAccess:async()=>null,d1Bound:e=>!!e.YUQING_DB,pruneOldItems:async()=>{}};
vm.createContext(ctx);vm.runInContext(source,ctx);
ctx.checkRateLimit=async()=>null;
ctx.getYuqingSettings=async(_db,key)=>{reads.push(key);return settings[key]||null};
ctx.putYuqingSettings=async(_db,key,value)=>{writes.push(key);settings[key]=value};
ctx.insertYuqingReport=async(_db,row)=>{savedRows.push(row)};
ctx.pruneYuqingReports=async()=>{};
ctx.buildDailyEventReport=async(_env,opts)=>{calls.push(opts);opts.__streamSink?.({type:'partial',module:'temperature',data:{score:50}});return {id:opts.reportId||'daily',kind:'daily_event',status:'ready',report:{title:'云端日报'}}};
ctx.buildSentimentAnalysisReport=async(_env,opts)=>{calls.push(opts);return {id:'analysis',kind:'sentiment_analysis',status:'ready',report:{title:'云端分析'}}};
async function request(route,method='GET',body){return ctx.worker.fetch(new Request('https://fixture.test'+route,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}),env,{waitUntil(){}})}
async function main(){
 for(const kind of ['daily_event','sentiment_analysis']){
  const res=await request('/api/yuqing/reports/generate','POST',{kind});assert.equal(res.status,200);const data=await res.json();assert.equal(data.report.kind,kind);assert(!data.task);assert(savedRows.some(r=>r.kind===kind));console.log('PASS API-01 generate '+kind+' ignores old execution choice');
 }
 const res=await request('/api/yuqing/reports/generate-stream','POST',{kind:'daily_event'});assert.equal(res.status,200);
 const events=(await res.text()).trim().split('\n').map(JSON.parse);assert.deepEqual(events.map(e=>e.type),['start','partial','done']);assert.equal(events[2].report.status,'ready');assert(savedRows.some(r=>r.status==='streaming'));console.log('PASS API-02 cloud stream persists preview and result');
 ctx.buildDailyEventReport=async()=>{throw Error('fixture model unavailable')};
 const failure=await request('/api/yuqing/reports/generate-stream','POST',{kind:'daily_event'});const failedEvents=(await failure.text()).trim().split('\n').map(JSON.parse);assert.equal(failedEvents.at(-1).type,'error');assert.equal(savedRows.at(-1).status,'error');console.log('PASS API-03 failed cloud stream persists error');
 for(const route of ['/api/yuqing/reports/latest?kind=daily_event','/api/yuqing/reports/item?id=historical']){const data=await(await request(route)).json();assert.equal(data.report.report.title,'历史报告');assert.equal(data.report.grounding.generator,'codex_cli_bridge')}
 const history=await(await request('/api/yuqing/reports/history?kind=daily_event')).json();assert(history.items.some(r=>r.id==='historical'));console.log('PASS API-04 historical reports remain readable');
 const before=await(await request('/api/yuqing/settings/model-channels')).json();assert.equal(before.effective['daily_event.trends'],'gemini-3.1-pro-preview');assert(!before.settings.codex);
 const after=await(await request('/api/yuqing/settings/model-channels','PUT',{assignments:{'daily_event.trends':'gemini-3-flash-preview'}})).json();assert.equal(after.effective['daily_event.trends'],'gemini-3-flash-preview');assert.equal(writes.at(-1),'model_channels');assert(!reads.includes('execution_channels'));console.log('PASS API-05 model settings preserve cloud assignment and do not read retired settings');
 for(const route of ['/api/yuqing/codex/tasks','/api/yuqing/codex/bridge-task','/api/yuqing/settings/execution-channels'])for(const method of ['GET','POST','PUT'])assert.equal((await request(route,method,method==='GET'?null:{})).status,404);
 ctx.requireCloudflareAccess=async()=>new Response('denied',{status:403});assert.equal((await request('/api/yuqing/codex/bridge-task')).status,403);console.log('PASS API-06 removed endpoints and no bridge Access bypass');
}
main().catch(error=>{console.error(error);process.exitCode=1});
