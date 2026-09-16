"use strict";

const fs = require("fs");
const path = require("path");

const workerPath = path.join(__dirname, "..", "cloudflare", "binance-klines-worker.js");
const blockPath = path.join(__dirname, "..", "cloudflare", "_patch_derivatives_sync_block.js");

let w = fs.readFileSync(workerPath, "utf8");
const blk = fs.readFileSync(blockPath, "utf8");

const START = "function resolveDerivativeSyncFlagGroups(groups) {";
const END = "\nasync function readDerivativesPayload(env, symbol, range) {";

const i0 = w.indexOf(START);
const i1 = w.indexOf(END);
if (i0 === -1 || i1 === -1 || i1 <= i0) {
  console.error("Markers not found or invalid ordering", i0, i1);
  process.exit(1);
}

w = `${w.slice(0, i0)}${blk}\n${w.slice(i1)}`;
fs.writeFileSync(workerPath, w);
console.log("Spliced sync block.");
