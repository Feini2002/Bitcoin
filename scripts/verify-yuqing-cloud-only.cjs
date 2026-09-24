const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
let source = fs.readFileSync(path.join(__dirname, "..", "cloudflare/yuqing/yuqing-worker.js"), "utf8");
source = source.replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "").replace("export default {", "globalThis.worker = {");
const row = {id:"historical",kind:"daily_event",report_date:"2026-05-22",slot:"08",trigger_type:"manual",generated_at:"2026-05-22T00:00:00Z",status:"ready",report_json:'{"title":"历史报告"}',grounding_json:'{"generator":"historical"}',source_refs_json:"[]",source_errors_json:"[]",market_snapshot_json:"{}"};
const db = {prepare(){return {bind(){return this},async first(){return row},async all(){return {results:[row]}},async run(){return {meta:{changes:1}}}}}};
const ctx = {console,Date,Intl,URL,URLSearchParams,TextEncoder,Response,Request,ReadableStream,setTimeout,clearTimeout,crypto:require("node:crypto").webcrypto,accessCorsHeaders:()=>({}),accessServiceHeaders:()=>({}),requireCloudflareAccess:async()=>null,d1Bound:e=>!!e.YUQING_DB,pruneOldItems:async()=>{}};
vm.createContext(ctx);vm.runInContext(source,ctx);ctx.checkRateLimit=async()=>null;
const env={YUQING_DB:db};
async function request(route,method="GET",body){return ctx.worker.fetch(new Request("https://fixture.test"+route,{method,...(body?{headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{})}),env,{waitUntil(){}})}
(async()=>{
  for (const route of ["/api/yuqing/reports/generate","/api/yuqing/reports/generate-stream","/api/yuqing/llm/test","/api/yuqing/settings/model-channels"]) {
    for (const method of ["GET","POST","PUT"]) assert.equal((await request(route,method,method==="GET"?null:{})).status,410,route+" "+method);
  }
  for (const route of ["/api/yuqing/reports/latest?kind=daily_event","/api/yuqing/reports/item?id=historical"]) {
    const res=await request(route);assert.equal(res.status,200,route);const data=await res.json();assert.equal(data.report.report.title,"历史报告");
  }
  const history=await(await request("/api/yuqing/reports/history?kind=daily_event")).json();assert(history.items.some(item=>item.id==="historical"));
  const health=await(await request("/api/yuqing/health")).json();assert.equal(health.automaticReports,false);assert.equal(health.llm.enabled,false);
  console.log("PASS retired report generation; historical reports remain readable");
})().catch(error=>{console.error(error);process.exitCode=1});
