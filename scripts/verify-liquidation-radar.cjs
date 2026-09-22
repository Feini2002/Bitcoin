/**
 * Verify liquidation radar parsing, aggregation, active buckets, and freshness.
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
  src = src.replace(/^\s*import\s+[\s\S]*?from\s+["'][^"']+["']\s*;?\s*/gm, "");
  src = src.replace(/\bexport\s*\{\s*KlineLiveCollector\s*\}\s*;?/, "");
  src = src.replace(/\bbindKlineLiveHooks\s*\([\s\S]*?\);\s*/, "");
  src = src.replace(/export default\s*\{/, "const __workerDefault = {");
  const mod = await import(`data:text/javascript;base64,${Buffer.from(src, "utf8").toString("base64")}`);
  const hooks = mod.__footprintTestHooks;

  assert("exports liquidation hooks", !!hooks);

  const originalWebSocket = globalThis.WebSocket;
  const sockets = [];
  globalThis.WebSocket = class { constructor(url) { this.url = url; sockets.push(this); } close() {} };
  try {
    const collector = Object.create(mod.LiquidationCollector.prototype);
    collector.symbol = "BTCUSDT";
    collector.sources = { binance: collector.emptySource("binance") };
    collector.connectBinance();
    collector.connectBinanceProbe();
    assert("collector subscribes migrated market liquidation stream", sockets[0].url === "wss://fstream.binance.com/market/ws/!forceOrder@arr");
    assert("collector probe subscribes migrated combined stream", sockets[1].url === "wss://fstream.binance.com/market/stream?streams=btcusdt@aggTrade/btcusdt@forceOrder");
    sockets[1].onopen();
    assert("probe open is not a market heartbeat", !collector.sources.binance.lastMarketMessageAt && !collector.sources.binance.heartbeatCount);
    sockets[1].onmessage({ data: JSON.stringify({ stream: "btcusdt@aggTrade", data: { e: "aggTrade", s: "BTCUSDT" } }) });
    assert("actual trade advances market heartbeat", collector.sources.binance.lastMarketMessageAt > 0 && collector.sources.binance.heartbeatCount === 1);
  } finally { globalThis.WebSocket = originalWebSocket; }

  const t0 = Date.UTC(2026, 3, 30, 8, 0, 21);
  const bucketStart = hooks.liquidationBucketStart(t0);
  assert("liquidation bucket floors to 5m", bucketStart === Date.UTC(2026, 3, 30, 8, 0, 0), bucketStart);

  const binance = hooks.normalizeBinanceLiquidation({
    e: "forceOrder",
    E: t0,
    o: { s: "BTCUSDT", S: "SELL", ap: "75000", z: "0.2", T: t0 },
  });
  assert("binance forceOrder parses", !!binance);
  assert("binance SELL maps to long liquidation", binance.side === "long", binance.side);
  assert("binance notional computes price times qty", binance.notional === 15000, binance.notional);

  const bybitRows = hooks.normalizeBybitLiquidation({
    topic: "allLiquidation.BTCUSDT",
    data: [{ T: t0 + 1000, s: "BTCUSDT", S: "Sell", v: "0.1", p: "76000" }],
  });
  assert("bybit allLiquidation parses", bybitRows.length === 1, JSON.stringify(bybitRows));
  assert("bybit Sell maps to short liquidation", bybitRows[0].side === "short", bybitRows[0].side);

  const legacyRows = hooks.normalizeBybitLegacyLiquidation({
    topic: "liquidation.BTCUSDT",
    data: { updatedTime: t0 + 2000, symbol: "BTCUSDT", side: "Buy", size: "0.3", price: "74000" },
  });
  assert("bybit legacy liquidation parses", legacyRows.length === 1, JSON.stringify(legacyRows));
  assert("bybit legacy Buy maps to long liquidation", legacyRows[0].side === "long", legacyRows[0].side);

  const bucket = hooks.emptyLiquidationBucket("BTCUSDT", "bybit", bucketStart);
  for (const ev of [bybitRows[0], legacyRows[0]]) hooks.addLiquidationToBucket(bucket, ev);
  const serialized = hooks.serializeLiquidationBucket(bucket);
  assert("bucket aggregates long count", serialized.long_count === 1, serialized.long_count);
  assert("bucket aggregates short count", serialized.short_count === 1, serialized.short_count);
  assert("bucket tracks max notional", serialized.max_notional === 22200, serialized.max_notional);
  assert("bucket computes vwap", Math.round(serialized.vwap_price) === 74500, serialized.vwap_price);

  const active = hooks.serializeActiveLiquidationBucket(bucket);
  assert("active bucket is flagged", active.is_active === true);

  const now = t0 + 20_000;
  const fresh = hooks.liquidationFreshness([active], {
    bybit: { status: "realtime", lastMarketMessageAt: now - 10_000, lastEventAt: t0 + 2000 },
    binance: { status: "reconnecting", lastMarketMessageAt: 0, lastEventAt: 0 },
  }, now);
  assert("freshness accepts market heartbeat without new liquidation", fresh.ok === true, JSON.stringify(fresh));
  assert("freshness exposes active source count", fresh.activeSources === 1, fresh.activeSources);

  const stale = hooks.liquidationFreshness([active], {
    bybit: { status: "realtime", lastMarketMessageAt: now - 10 * 60_000, lastEventAt: 0 },
  }, now);
  assert("freshness marks stale market heartbeat as not ok", stale.ok === false, JSON.stringify(stale));

  const transportOnly = hooks.liquidationFreshness([active], {
    bybit: { status: "realtime", lastTransportAt: now - 10_000, lastHeartbeatAt: 0, lastMarketMessageAt: 0, lastEventAt: 0 },
  }, now);
  assert("freshness rejects transport-only pong", transportOnly.ok === false, JSON.stringify(transportOnly));

  console.log(failed ? `\n${failed} liquidation check(s) failed` : "\nAll liquidation radar checks passed");
  process.exitCode = failed ? 1 : 0;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
