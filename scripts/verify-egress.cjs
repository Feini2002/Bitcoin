const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, "../cloudflare/finance/egress.mjs")).href);
  assert.equal(mod.parseOriginOnly("https://proxy.example.com/fapi"), "https://proxy.example.com");
  assert.equal(mod.parseOriginBase("https://proxy.example.com/x/spot/"), "https://proxy.example.com/x/spot");
  assert.equal(
    mod.joinEgress("https://proxy.example.com/x/spot", "/api/v3/klines?symbol=BTCUSDT"),
    "https://proxy.example.com/x/spot/api/v3/klines?symbol=BTCUSDT"
  );
  assert.equal(
    mod.remapProviderBase("binance-usdm", { BINANCE_FAPI_ORIGIN: "https://proxy.example.com" }, "https://fapi.binance.com"),
    "https://proxy.example.com"
  );
  assert.equal(
    mod.remapProviderBase("binance-spot", { BINANCE_SPOT_ORIGIN: "https://proxy.example.com/x/spot" }, "https://data-api.binance.vision"),
    "https://proxy.example.com/x/spot"
  );
  assert.equal(mod.envelopeHost("binance-usdm", "proxy.example.com"), "fapi.binance.com");
  const headers = mod.egressRequestHeaders(
    { EGRESS_PROXY_SECRET: "s", BINANCE_FAPI_ORIGIN: "https://proxy.example.com" },
    "https://proxy.example.com/fapi/v1/ping",
    { Accept: "application/json" }
  );
  assert.equal(headers[mod.EGRESS_SECRET_HEADER], "s");
  assert.equal(headers.Accept, "application/json");
  const plain = mod.egressRequestHeaders(
    { EGRESS_PROXY_SECRET: "s", BINANCE_FAPI_ORIGIN: "https://proxy.example.com" },
    "https://api.stlouisfed.org/fred"
  );
  assert.equal(plain[mod.EGRESS_SECRET_HEADER], undefined);
  assert.equal(
    mod.toWebSocketUrl("https://proxy.example.com", "/market/stream?streams=btcusdt@kline_5m"),
    "wss://proxy.example.com/market/stream?streams=btcusdt@kline_5m"
  );
  assert.equal(
    mod.toWebSocketUrl("https://proxy.example.com/x/bybit-stream", "/v5/public/linear"),
    "wss://proxy.example.com/x/bybit-stream/v5/public/linear"
  );
  assert.equal(
    mod.joinEgress("https://proxy.example.com/x/bybit", "/v5/market/tickers?category=linear"),
    "https://proxy.example.com/x/bybit/v5/market/tickers?category=linear"
  );
  console.log("PASS egress origin join, envelope host, and secret header targeting");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
