/**
 * 自检：直连 fapi 与已部署 Worker 上的 D1 K 线是否可读。
 * 用法：node scripts/diagnose-klines.cjs
 * Worker 基址：`BITDESK_KLINE_API_BASE`（默认 https://btc.feiniwork.com，与 js/config.js 一致）。
 */
const https = require("https");
const http = require("http");

const PING = "https://fapi.binance.com/fapi/v1/ping";
const FAPI_KLINES = "https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=2";

const DEFAULT_WORKER = "https://btc.feiniwork.com";

function get(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https:") ? https : http;
    lib
      .get(url, { headers: { "User-Agent": "BitDesk-diagnose/1" } }, (r) => {
        const chunks = [];
        r.on("data", (c) => chunks.push(c));
        r.on("end", () => {
          resolve({
            status: r.statusCode,
            headers: r.headers,
            body: Buffer.concat(chunks).toString("utf8").slice(0, 1200),
          });
        });
      })
      .on("error", reject);
  });
}

async function main() {
  console.log("[diagnose] 1) 直连 fapi /ping");
  try {
    const a = await get(PING);
    console.log(`  status: ${a.status} (2xx=直连可用); body head: ${a.body.slice(0, 80)}`);
  } catch (e) {
    console.log("  error:", e.message);
  }

  console.log("\n[diagnose] 2) 直连 fapi klines(2 条)");
  try {
    const b = await get(FAPI_KLINES);
    console.log(`  status: ${b.status}`);
  } catch (e) {
    console.log("  error:", e.message);
  }

  const base = (process.env.BITDESK_KLINE_API_BASE || DEFAULT_WORKER).trim().replace(/\/$/, "");
  const workerKlines = `${base}/api/d1/klines?symbol=BTCUSDT&interval=15m&limit=2&sync=0`;
  console.log(`\n[diagnose] 3) Worker D1 K 线 ${workerKlines}`);
  try {
    const c = await get(workerKlines);
    let n = 0;
    let latestT = null;
    let lastSync = null;
    let autoSync = c.headers["x-d1-auto-sync"];
    try {
      const body = JSON.parse(c.body);
      if (Array.isArray(body)) {
        n = body.length;
      } else {
        n = Array.isArray(body.klines) ? body.klines.length : 0;
        latestT = body.latestT || null;
        lastSync = body.lastSync && body.lastSync.last_run ? body.lastSync.last_run : null;
      }
    } catch (_) {}
    console.log(`  status: ${c.status}  条数: ${n}`);
    if (latestT) console.log(`  latestT: ${latestT} (${new Date(Number(latestT)).toISOString()})`);
    if (lastSync) console.log(`  lastSync: ${lastSync}`);
    if (autoSync != null) console.log(`  X-D1-Auto-Sync: ${autoSync}`);
    if (c.status === 502) {
      console.log("  → 502：云端未返回可用 K 线，请核对 Worker/D1 与同步任务。");
    }
  } catch (e) {
    console.log("  error (检查网络或可改 BITDESK_KLINE_API_BASE):", e.message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
