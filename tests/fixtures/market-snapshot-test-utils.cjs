const assert = require("assert");

const MS_MIN = 60 * 1000;
const MS_HOUR = 60 * MS_MIN;

function createRows(now = Date.now()) {
  const symbol = "BTCUSDT";
  const klines = [];
  for (const interval of ["5m", "15m", "1h", "4h", "1d"]) {
    const step =
      interval === "5m" ? 5 * MS_MIN :
      interval === "15m" ? 15 * MS_MIN :
      interval === "1h" ? MS_HOUR :
      interval === "4h" ? 4 * MS_HOUR :
      24 * MS_HOUR;
    for (let i = 0; i < 80; i += 1) {
      const t = now - (79 - i) * step;
      const base = 64000 + i * 12 + (interval === "1d" ? i * 25 : 0);
      klines.push({
        symbol,
        interval,
        t,
        o: base - 10,
        h: base + 45,
        l: base - 55,
        c: base + 8,
        v: 100 + i,
      });
    }
  }

  const footprint = [];
  for (let i = 0; i < 96; i += 1) {
    const t = now - (95 - i) * 5 * MS_MIN;
    const buy = 80 + i;
    const sell = 55 + Math.floor(i / 2);
    footprint.push({
      symbol,
      interval: "5m",
      t,
      o: 64200 + i,
      h: 64230 + i,
      l: 64180 + i,
      c: 64210 + i,
      buy_vol: buy,
      sell_vol: sell,
      delta: buy - sell,
      volume: buy + sell,
      poc_price: 64200 + i,
      updated_at: t + 1000,
    });
  }

  const liquidations = [];
  for (let i = 0; i < 120; i += 1) {
    const t = now - (119 - i) * 5 * MS_MIN;
    for (const exchange of ["binance", "bybit"]) {
      liquidations.push({
        symbol,
        exchange,
        bucket_start: t,
        long_notional: 10000 + i * 200,
        short_notional: 7000 + i * 120,
        long_count: 2 + (i % 4),
        short_count: 1 + (i % 3),
        max_notional: 4000 + i * 90,
        max_side: i % 2 ? "long" : "short",
        min_price: 63900 + i,
        max_price: 64100 + i,
        vwap_price: 64000 + i,
        updated_at: t + 2000,
      });
    }
  }

  const derivative_timeseries = [];
  const metrics = {
    funding_binance: 0.00012,
    oi_binance: 900000,
    long_short: 1.08,
    taker_buy_sell: 1.14,
    basis_perp: 3.2,
    basis_quarter: 5.8,
    top_account_long_short: 1.12,
    top_position_long_short: 1.18,
    vix: 16.5,
    vix3m: 18.2,
    move: 102,
  };
  for (const [metric, latestValue] of Object.entries(metrics)) {
    for (let i = 0; i < 36; i += 1) {
      const t = now - (35 - i) * MS_HOUR;
      derivative_timeseries.push({
        symbol,
        metric,
        t,
        value: latestValue * (1 + (i - 35) * 0.001),
        source: metric.includes("vix") || metric === "move" ? "yahoo" : "binance",
        extra_json: "{}",
      });
    }
  }

  return {
    klines,
    footprint_bars: footprint,
    liquidation_5m_buckets: liquidations,
    derivative_timeseries,
    derivative_source_health: [
      {
        source: "binance-fapi",
        last_run: new Date(now).toISOString(),
        last_ok: 1,
        last_error_kind: "",
        last_error: "",
        cooldown_until_ms: 0,
        consecutive_failures: 0,
        last_success_at_ms: now,
        extra_json: "{}",
      },
    ],
    derivative_metric_health: Object.keys(metrics).map((metric) => ({
      symbol,
      metric,
      last_attempt_at_ms: now - MS_MIN,
      last_success_at_ms: now - MS_MIN,
      next_allowed_at_ms: 0,
      consecutive_failures: 0,
      last_error_kind: "",
      last_error: "",
      extra_json: "{}",
    })),
  };
}

class Prepared {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }
  bind(...args) {
    this.args = args;
    return this;
  }
  async all() {
    return { results: this.db.select(this.sql, this.args) };
  }
  async first() {
    return this.db.select(this.sql, this.args)[0] || null;
  }
  async run() {
    return this.db.run(this.sql, this.args);
  }
}

class FakeSourceD1 {
  constructor(rows) {
    this.rows = rows;
  }
  prepare(sql) {
    return new Prepared(this, sql);
  }
  select(sql, args) {
    const s = sql.toLowerCase();
    if (s.includes("select 1")) return [{ ok: 1 }];
    if (s.includes("from klines")) {
      const [symbol, interval, limit] = args;
      return this.rows.klines
        .filter((row) => row.symbol === symbol && row.interval === interval)
        .sort((a, b) => b.t - a.t)
        .slice(0, Number(limit) || 1000);
    }
    if (s.includes("from footprint_bars")) {
      const [symbol, limit] = args;
      return this.rows.footprint_bars
        .filter((row) => row.symbol === symbol)
        .sort((a, b) => b.t - a.t)
        .slice(0, Number(limit) || 1000);
    }
    if (s.includes("from liquidation_5m_buckets")) {
      const [symbol, limit] = args;
      return this.rows.liquidation_5m_buckets
        .filter((row) => row.symbol === symbol)
        .sort((a, b) => b.bucket_start - a.bucket_start)
        .slice(0, Number(limit) || 1000);
    }
    if (s.includes("from derivative_timeseries")) {
      const [symbol, since] = args;
      return this.rows.derivative_timeseries
        .filter((row) => row.symbol === symbol && row.t >= Number(since || 0))
        .sort((a, b) => String(a.metric).localeCompare(String(b.metric)) || a.t - b.t);
    }
    if (s.includes("from derivative_source_health")) {
      return this.rows.derivative_source_health.slice();
    }
    if (s.includes("from derivative_metric_health")) {
      const [symbol] = args;
      return this.rows.derivative_metric_health.filter((row) => row.symbol === symbol);
    }
    return [];
  }
  run() {
    return { success: true, meta: { changes: 0 } };
  }
}

class FakeSnapshotD1 {
  constructor() {
    this.snapshot_runs = [];
    this.market_snapshots = [];
    this.agent_snapshot_inputs = [];
  }
  prepare(sql) {
    return new Prepared(this, sql);
  }
  select(sql, args) {
    const s = sql.toLowerCase();
    if (s.includes("select 1")) return [{ ok: 1 }];
    if (s.includes("from snapshot_runs where run_id")) {
      return this.snapshot_runs.filter((row) => row.run_id === args[0]);
    }
    if (s.includes("from snapshot_runs order by")) {
      return this.snapshot_runs
        .slice()
        .sort((a, b) => b.generated_at_ms - a.generated_at_ms)
        .slice(500);
    }
    if (s.includes("from market_snapshots where scope")) {
      return this.market_snapshots
        .filter((row) => row.scope === args[0])
        .sort((a, b) => b.generated_at_ms - a.generated_at_ms)
        .slice(0, 1);
    }
    if (s.includes("from market_snapshots where run_id")) {
      return this.market_snapshots
        .filter((row) => row.run_id === args[0])
        .sort((a, b) => String(a.scope).localeCompare(String(b.scope)));
    }
    if (s.includes("from agent_snapshot_inputs where agent_id")) {
      return this.agent_snapshot_inputs
        .filter((row) => row.agent_id === args[0])
        .sort((a, b) => b.generated_at_ms - a.generated_at_ms)
        .slice(0, 1);
    }
    if (s.includes("from agent_snapshot_inputs where run_id")) {
      return this.agent_snapshot_inputs
        .filter((row) => row.run_id === args[0])
        .sort((a, b) => String(a.agent_id).localeCompare(String(b.agent_id)));
    }
    return [];
  }
  run(sql, args) {
    const s = sql.toLowerCase();
    if (s.startsWith("insert or replace into snapshot_runs")) {
      const row = {
        run_id: args[0],
        symbol: args[1],
        profile: args[2],
        status: args[3],
        started_at_ms: args[4],
        ended_at_ms: args[5],
        generated_at_ms: args[6],
        page_scopes_json: args[7],
        agent_ids_json: args[8],
        error_json: args[9],
        extra_json: args[10],
      };
      this.snapshot_runs = this.snapshot_runs.filter((x) => x.run_id !== row.run_id);
      this.snapshot_runs.push(row);
    } else if (s.startsWith("insert or replace into market_snapshots")) {
      const row = {
        run_id: args[0],
        scope: args[1],
        symbol: args[2],
        snapshot_version: args[3],
        generated_at_ms: args[4],
        payload_json: args[5],
        data_freshness_json: args[6],
        llm_brief: args[7],
        source_fingerprint: args[8],
        created_at_ms: args[9],
      };
      this.market_snapshots = this.market_snapshots.filter((x) => !(x.run_id === row.run_id && x.scope === row.scope));
      this.market_snapshots.push(row);
    } else if (s.startsWith("insert or replace into agent_snapshot_inputs")) {
      const row = {
        run_id: args[0],
        agent_id: args[1],
        symbol: args[2],
        generated_at_ms: args[3],
        source_pages_json: args[4],
        input_json: args[5],
        data_freshness_json: args[6],
        created_at_ms: args[7],
      };
      this.agent_snapshot_inputs = this.agent_snapshot_inputs.filter((x) => !(x.run_id === row.run_id && x.agent_id === row.agent_id));
      this.agent_snapshot_inputs.push(row);
    } else if (s.startsWith("delete from")) {
      // Retention cleanup is not material for local route tests.
    }
    return { success: true, meta: { changes: 1 } };
  }
}

function assertOk(condition, message, detail) {
  assert.ok(condition, `${message}${detail ? `: ${detail}` : ""}`);
  console.log(`OK ${message}`);
}

module.exports = {
  FakeSnapshotD1,
  FakeSourceD1,
  assertOk,
  createRows,
};
