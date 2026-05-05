/**
 * Compatibility wrapper.
 * The old per-page derivatives snapshot folder was removed; unified snapshot
 * checks now live in verify-market-snapshot-program.cjs.
 */
const { spawnSync } = require("child_process");
const path = require("path");

const child = spawnSync(process.execPath, [path.join(__dirname, "verify-market-snapshot-program.cjs")], {
  stdio: "inherit",
});
process.exitCode = child.status || 0;
