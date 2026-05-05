/**
 * 前端静态壳自检：校验仓库入口文件齐备；并对已部署行情 Worker 发 HTTPS GET（默认根 URL 与 js/config.js 一致）。
 * - 校验 index.html / js/app.js / styles.css 存在且入口 HTML 引用主脚本。
 * - `BITDESK_SMOKE_ORIGIN` 仅用于覆盖 Worker 根 URL（须为线上 HTTPS）；未设置时默认 `https://btc.feiniwork.com`。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DEFAULT_SMOKE_ORIGIN = "https://btc.feiniwork.com";

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

  const raw = process.env.BITDESK_SMOKE_ORIGIN;
  const origin = (raw != null && String(raw).trim() !== "" ? String(raw).trim() : DEFAULT_SMOKE_ORIGIN).replace(
    /\/$/,
    "",
  );
  await optionalWorkerProbe(origin);
}

main().catch((err) => {
  console.error("FAIL smoke shell:", err && err.message ? err.message : err);
  process.exitCode = 1;
});
