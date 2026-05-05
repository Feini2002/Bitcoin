/**
 * Verify Cloudflare Worker footprint constants and pure merge/rebin behavior.
 */
const fs = require("fs");
const path = require("path");

let failed = 0;
function assert(name, cond, detail) {
  if (!cond) {
    failed++;
    console.error("FAIL:", name, detail || "");
  } else {
    console.log("OK:", name);
  }
}

(async () => {
  const file = path.join(__dirname, "..", "cloudflare", "binance-klines-worker.js");
  let src = fs.readFileSync(file, "utf8");
  src = src.replace(/export default\s*\{/, "const __workerDefault = {");
  const mod = await import(`data:text/javascript;base64,${Buffer.from(src, "utf8").toString("base64")}`);
  const hooks = mod.__footprintTestHooks;

  assert("exports footprint test hooks", !!hooks);
  assert("base interval stays 5m", hooks.FOOTPRINT_BASE_INTERVAL === "5m");
  assert("cloud footprint cap is practical 30d depth", hooks.FOOTPRINT_MAX_BARS === 8640);
  assert("API read limit supports loaded history", hooks.FOOTPRINT_API_MAX_LIMIT === 240);
  assert("manual backfill is bounded", hooks.FOOTPRINT_BACKFILL_MAX_WINDOWS === 40);
  assert("auto tick resolves to base server tick", hooks.resolveFootprintTickSize("auto") === 10);
  assert("explicit tick is honored", hooks.resolveFootprintTickSize("50") === 50);

  const t0 = Date.UTC(2026, 3, 28, 8, 0, 0);
  const row = (offsetMin, o, h, l, c, levels) => ({
    t: t0 + offsetMin * 60 * 1000,
    o,
    h,
    l,
    c,
    levels_json: JSON.stringify(levels),
    last_trade_id: offsetMin,
  });
  const rows = [
    row(0, 10000, 10010, 9990, 10002, [{ price: 10000, buyVol: 1, sellVol: 2 }]),
    row(5, 10002, 10020, 10000, 10018, [{ price: 10010, buyVol: 3, sellVol: 1 }]),
    row(10, 10018, 10030, 10010, 10020, [{ price: 10020, buyVol: 2, sellVol: 2 }]),
    row(15, 10020, 10040, 10015, 10035, [{ price: 10040, buyVol: 5, sellVol: 1 }]),
  ];
  const merged = hooks.mergeFootprintRows(rows, "15m", "10");
  const first = merged[0];

  assert("15m merge produces two buckets", merged.length === 2, JSON.stringify(merged));
  assert("first bucket aggregates three 5m rows", first.levels.length === 3, JSON.stringify(first.levels));
  assert("merged OHLC keeps first open", first.o === 10000, `got ${first.o}`);
  assert("merged OHLC keeps last close", first.c === 10020, `got ${first.c}`);
  assert("merged volume sums buy side", first.buyVol === 6, `got ${first.buyVol}`);
  assert("merged volume sums sell side", first.sellVol === 5, `got ${first.sellVol}`);
  assert("POC recomputes after merge", first.pocPrice === 10010 || first.pocPrice === 10020, `got ${first.pocPrice}`);

  console.log(failed ? `\n${failed} check(s) failed` : "\nAll worker footprint checks passed");
  process.exitCode = failed ? 1 : 0;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
