/**
 * Deterministic checks for js/heatmap/pressure-matrix.js (CJS + browser global).
 */
const assert = require("assert");
const path = require("path");

const Pressure = require(path.join(__dirname, "..", "js", "heatmap", "pressure-matrix.js"));
const { build } = Pressure;

const now = Date.UTC(2026, 4, 2, 12, 0, 0);
const hour = 60 * 60 * 1000;

function fundingSeries(v) {
  return [{ t: now - hour, value: v }];
}

function oiSeries(v0, v1) {
  return [
    { t: now - 25 * hour, value: v0 },
    { t: now - hour, value: v1 },
  ];
}

function klinesOk() {
  const rows = [];
  for (let i = 30; i >= 0; i -= 1) {
    rows.push({
      t: now - i * hour,
      o: 76000 + i,
      h: 76100 + i,
      l: 75900 + i,
      c: 76050 + i,
      v: 1000,
    });
  }
  return rows;
}

(() => {
  const liqRows = [
    {
      bucket_start: now - 10 * 60 * 1000,
      long_notional: 900_000,
      short_notional: 200_000,
      long_count: 3,
      short_count: 1,
      vwap_price: 76200,
      exchange: "bybit",
    },
  ];

  const downHeavy = build({
    symbol: "BTCUSDT",
    generatedAt: new Date(now).toISOString(),
    heatmapState: { bucketSize: 50, window: "15m", minNotional: 0 },
    liquidationRows: liqRows,
    aggregateSource: "d1",
    derivativesPayload: {
      priceChange24hPct: -1.2,
      series: {
        funding_binance: fundingSeries(0.00055),
        oi_binance: oiSeries(1000, 1040),
        basis_quarter: [{ t: now - hour, value: 6 }],
      },
      dataFreshness: { staleMs: 60 * 1000 },
    },
    klines1h: klinesOk(),
  });
  assert.ok(downHeavy.summary.primaryId === "down-long" || downHeavy.summary.primaryScore >= 40);
  assert.ok(downHeavy.rows.length === 4);

  const upHeavy = build({
    symbol: "BTCUSDT",
    generatedAt: new Date(now).toISOString(),
    heatmapState: { bucketSize: 50, window: "15m", minNotional: 0 },
    liquidationRows: [
      {
        bucket_start: now - 10 * 60 * 1000,
        long_notional: 100_000,
        short_notional: 800_000,
        long_count: 1,
        short_count: 4,
        vwap_price: 76200,
        exchange: "bybit",
      },
    ],
    aggregateSource: "d1",
    derivativesPayload: {
      priceChange24hPct: 1.5,
      series: {
        funding_binance: fundingSeries(-0.00058),
        oi_binance: oiSeries(1000, 1030),
        basis_quarter: [{ t: now - hour, value: -2 }],
      },
      dataFreshness: { staleMs: 60 * 1000 },
    },
    klines1h: klinesOk(),
  });
  assert.ok(upHeavy.rows.find((r) => r.id === "up-short").score >= 30);

  const delev = build({
    symbol: "BTCUSDT",
    generatedAt: new Date(now).toISOString(),
    heatmapState: { bucketSize: 50, window: "15m", minNotional: 0 },
    liquidationRows: [
      {
        bucket_start: now - 10 * 60 * 1000,
        long_notional: 300_000,
        short_notional: 300_000,
        long_count: 2,
        short_count: 2,
        vwap_price: 76200,
        exchange: "bybit",
      },
    ],
    aggregateSource: "d1",
    derivativesPayload: {
      priceChange24hPct: -0.2,
      series: {
        funding_binance: fundingSeries(0.0001),
        oi_binance: oiSeries(1000, 970),
      },
      dataFreshness: { staleMs: 60 * 1000 },
    },
    klines1h: klinesOk(),
  });
  assert.ok(delev.rows.find((r) => r.id === "delever").score >= 20);

  const sparse = build({
    symbol: "BTCUSDT",
    generatedAt: new Date(now).toISOString(),
    heatmapState: { bucketSize: 50, window: "60m", minNotional: 0 },
    liquidationRows: [],
    aggregateSource: "live",
    derivativesPayload: null,
    klines1h: [],
    derivativesError: "offline",
    klinesError: "offline",
  });
  assert.strictEqual(sparse.summary.primaryId, "watch");
  const json = JSON.stringify(sparse);
  assert.ok(!json.includes("liquidationPool"));
  assert.ok(!json.includes("Coinglass"));

  console.log("OK heatmap pressure matrix");
})();
