/**
 * Syntax smoke check for project JavaScript/CJS files.
 * Keeps the command dependency-free and avoids node_modules / old references.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", ".git", "旧参考文件", ".wrangler"]);
const TARGET_EXT = new Set([".js", ".cjs"]);

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (!SKIP_DIRS.has(ent.name)) walk(path.join(dir, ent.name), out);
      continue;
    }
    if (ent.isFile() && TARGET_EXT.has(path.extname(ent.name))) {
      out.push(path.join(dir, ent.name));
    }
  }
  return out;
}

const files = walk(ROOT).sort();
let failed = 0;

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const relNorm = rel.replace(/\\/g, "/");
  if (relNorm === "舆情/日报/worker/index.js") {
    console.log(`SKIP syntax ${rel} (standalone ES module scaffold)`);
    continue;
  }
  if (relNorm === "快照程序分析/market-snapshot-worker.js") {
    console.log(`SKIP syntax ${rel} (standalone ES module worker; covered by verify:market-snapshot)`);
    continue;
  }
  let src = fs.readFileSync(file, "utf8");
  if (rel.replace(/\\/g, "/") === "cloudflare/binance-klines-worker.js") {
    src = src
      .replace(/\bexport\s+class\s+LiquidationCollector\b/, "class LiquidationCollector")
      .replace(/\bexport\s+const\s+__footprintTestHooks\s*=/, "const __footprintTestHooks =")
      .replace(/\bexport\s+default\s*\{/, "const __workerDefault = {");
  }
  if (relNorm === "cloudflare/yuqing/yuqing-worker.js") {
    let ys = src;
    let prev = "";
    while (prev !== ys) {
      prev = ys;
      ys = ys.replace(/^\s*import\s+[\s\S]*?from\s+["'][^"']+["']\s*;?\s*/m, "");
    }
    src = ys;
    src = src.replace(/\bexport\s+default\s*\{/, "const __yuqingWorkerDefault = {");
  }
  if (
    relNorm === "cloudflare/yuqing/yuqing-facts.js" ||
    relNorm.startsWith("cloudflare/yuqing/shijian/") ||
    relNorm.startsWith("cloudflare/yuqing/fenxi/")
  ) {
    let prev = "";
    while (prev !== src) {
      prev = src;
      src = src.replace(/^\s*import\s+[\s\S]*?from\s+["'][^"']+["']\s*;?\s*/m, "");
      src = src.replace(/^\s*export\s+\{[\s\S]*?\}\s+from\s+["'][^"']+["']\s*;?\s*/m, "");
    }
    src = src.replace(/^\s*export\s+/gm, "");
  }
  try {
    new vm.Script(src, { filename: rel });
    console.log(`OK syntax ${rel}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL syntax ${rel}`);
    console.error(err && err.message ? err.message : err);
  }
}

console.log(failed ? `\n${failed} syntax check(s) failed` : `\nAll ${files.length} syntax checks passed`);
process.exitCode = failed ? 1 : 0;
