/**
 * 静态前端壳自检（不拉起任何本地 HTTP 服务）。
 * - 校验 index.html / js/app.js / styles.css 存在且入口 HTML 引用主脚本。
 * - 可选：`BITDESK_SMOKE_ORIGIN=https://你的 Worker 根` 时对 `${ORIGIN}/api/d1/status` 发 GET，
 *   验证线上行情 Worker 可读（离线或未设变量则跳过）。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function assertShellFile(rel, checker) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) throw new Error(`missing ${rel}`);
  const detail = checker ? checker(fs.readFileSync(p, "utf8")) : "";
  console.log(`OK shell ${rel}${detail ? ` — ${detail}` : ""}`);
}

async function optionalWorkerProbe(originRaw) {
  const base = String(originRaw).trim().replace(/\/$/, "");
  const url = `${base}/api/d1/status`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12_000);
  let res;
  try {
    res = await fetch(url, { cache: "no-store", signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  console.log(`OK remote ${url} — HTTP ${res.status}`);
}

async function main() {
  assertShellFile("index.html", (html) => {
    if (!html.includes("js/app.js")) throw new Error("index.html does not reference js/app.js");
    return "references js/app.js";
  });
  assertShellFile("js/app.js", () => "present");
  assertShellFile("styles.css", () => "present");

  const origin = (process.env.BITDESK_SMOKE_ORIGIN || "").trim();
  if (!origin) {
    console.log("SKIP remote Worker probe (set BITDESK_SMOKE_ORIGIN to hit /api/d1/status)");
    return;
  }
  await optionalWorkerProbe(origin);
}

main().catch((err) => {
  console.error("FAIL smoke shell:", err && err.message ? err.message : err);
  process.exitCode = 1;
});
