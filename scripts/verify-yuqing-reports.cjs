const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const worker = read("cloudflare/yuqing/yuqing-worker.js");
const marketWorker = read("cloudflare/binance-klines-worker.js");
const wrangler = read("cloudflare/wrangler.yuqing.toml");
const data = read("js/data-engine.js");
const settings = read("js/pages/settings.js");
const events = read("js/pages/events.js");
const news = read("js/pages/news.js");
const example = read(".env.example");
assert.match(wrangler, /crons\s*=\s*\[\s*\]/);
for (const source of [worker, marketWorker, wrangler, data, settings, events, news, example]) {
  assert.doesNotMatch(source, /GEMINI_API_KEY|GOOGLE_API_KEY|generativelanguage\.googleapis\.com|gemini-[0-9]/i);
}
assert.doesNotMatch(worker, /scheduled\s*\(/);
assert.doesNotMatch(worker, /fetch\s*\([^)]*gemini/i);
for (const route of ["/api/yuqing/reports/latest", "/api/yuqing/reports/history", "/api/yuqing/reports/item"]) assert(worker.includes(route));
for (const route of ["/api/yuqing/reports/generate", "/api/yuqing/reports/generate-stream", "/api/yuqing/settings/model-channels", "/api/yuqing/llm/test"]) assert(worker.includes(route));
assert(worker.includes("模型报告生成已退役") && worker.includes("}, 410)"));
assert(data.includes("fetchYuqingReportHistory") && data.includes("fetchYuqingReportItem"));
assert(!data.includes("generateYuqingStructuredReport") && !data.includes("fetchYuqingModelSettings"));
assert(!events.includes('id="daily-scan-preview"') && !news.includes('id="news-generate-preview"'));
assert(!settings.includes("settings-model-panel"));
console.log("PASS yuqing Gemini runtime retired; report history preserved");
