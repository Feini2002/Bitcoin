/**
 * Cloudflare Pages：删除超出保留数量的旧部署。
 * 假定 wrangler pages deployment list --json 按「从新到旧」排序（与控制台一致）。
 *
 * 环境变量：
 *   BIT_PAGES_PROJECT — 默认 bit-trading-desk
 *   BIT_PAGES_KEEP    — 每个 environment（production / preview）各保留条数，默认 5
 *
 * 参数：--dry-run 只打印将要删除的 Id，不调用 delete。
 */
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PROJECT = String(process.env.BIT_PAGES_PROJECT || "bit-trading-desk").trim() || "bit-trading-desk";
const KEEP = Math.max(1, Math.min(50, parseInt(String(process.env.BIT_PAGES_KEEP || "5"), 10) || 5));
const DRY = process.argv.includes("--dry-run");

function wrangler(args) {
  return spawnSync("npx", ["wrangler", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    shell: process.platform === "win32",
    env: process.env,
  });
}

function listDeployments(environment) {
  const res = wrangler([
    "pages",
    "deployment",
    "list",
    `--project-name=${PROJECT}`,
    `--environment=${environment}`,
    "--json",
  ]);
  const stdout = (res.stdout || "").trim();
  const stderr = (res.stderr || "").trim();
  if (res.status !== 0) {
    console.error(`wrangler pages deployment list (${environment}) exit ${res.status}`);
    if (stderr) console.error(stderr);
    if (stdout) console.error(stdout.slice(0, 800));
    return null;
  }
  try {
    const data = JSON.parse(stdout);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error(`Invalid JSON from wrangler list (${environment}): ${e.message}`);
    console.error(stdout.slice(0, 600));
    return null;
  }
}

function deleteDeployment(id) {
  const res = wrangler(["pages", "deployment", "delete", id, `--project-name=${PROJECT}`]);
  const stderr = (res.stderr || "").trim();
  if (res.status !== 0 && stderr) console.error(stderr);
  return res.status === 0;
}

function pruneEnv(environment) {
  const rows = listDeployments(environment);
  if (rows === null) {
    process.exitCode = 1;
    return;
  }
  const victims = rows.slice(KEEP);
  if (!victims.length) {
    console.log(`pages prune [${PROJECT}/${environment}]: ${rows.length} deployment(s), keep=${KEEP}, delete=0`);
    return;
  }
  console.log(
    `pages prune [${PROJECT}/${environment}]: total=${rows.length}, keep=${KEEP}, delete=${victims.length}${DRY ? " (dry-run)" : ""}`,
  );
  for (const row of victims) {
    const id = row.Id || row.id;
    if (!id) continue;
    const depUrl = row.Deployment || "";
    if (DRY) {
      console.log(`  would delete ${id} ${depUrl}`);
      continue;
    }
    if (deleteDeployment(id)) console.log(`  deleted ${id}`);
    else console.warn(`  skip/fail ${id} ${depUrl}`);
  }
}

function main() {
  pruneEnv("production");
  pruneEnv("preview");
}

main();
