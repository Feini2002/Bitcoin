const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const { buildPages } = require("./build-pages.cjs");
const PROJECT_NAME = process.env.BIT_PAGES_PROJECT || "bit-trading-desk";
const BRANCH = process.env.BIT_PAGES_BRANCH || "main";

function runWranglerDeploy(distDir) {
  const args = ["wrangler", "pages", "deploy", distDir, "--project-name", PROJECT_NAME, "--branch", BRANCH, "--commit-dirty=true"];
  if (process.platform !== "win32") {
    return spawnSync("npx", args, { cwd: ROOT, stdio: "inherit" });
  }
  const npxCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npx-cli.js");
  if (fs.existsSync(npxCli)) {
    return spawnSync(process.execPath, [npxCli, ...args], { cwd: ROOT, stdio: "inherit" });
  }
  return spawnSync("npx.cmd", args, { cwd: ROOT, stdio: "inherit", shell: true });
}

function main() {
  const artifact = buildPages();
  console.log("Deploying Pages artifact: " + artifact.files.length + " files from " + artifact.output);
  const result = runWranglerDeploy(artifact.output);
  if (result.error) throw result.error;
  process.exitCode = result.status == null ? 1 : result.status;
}

main();
