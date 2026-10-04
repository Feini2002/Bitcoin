/**
 * Compact diff summary for Codex final reports.
 * Works best inside a git repo; exits cleanly when the folder is not one.
 */
const { spawnSync } = require("child_process");

function git(args) {
  return spawnSync("git", args, { encoding: "utf8" });
}

const root = git(["rev-parse", "--show-toplevel"]);
if (root.status !== 0) {
  console.log("No git repository detected here; use a manual file list in the final summary.");
  process.exit(0);
}

const status = git(["status", "--short"]);
const stat = git(["diff", "--stat"]);
const names = git(["diff", "--name-status"]);

console.log("## git status --short");
console.log((status.stdout || "(clean)").trim());
console.log("\n## git diff --stat");
console.log((stat.stdout || "(no unstaged diff)").trim());
console.log("\n## git diff --name-status");
console.log((names.stdout || "(no unstaged diff)").trim());
