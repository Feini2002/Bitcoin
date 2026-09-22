/** USDⓈ-M live tape: Binance WS first, REST as backup. Writes D1 only. */

import { parseOriginOnly, toWebSocketUrl, openEgressWebSocket } from "./finance/egress.mjs";

export const KLINE_LIVE_INTERVALS = ["5m", "15m", "1h", "4h", "1d", "3d", "1w"];
export const KLINE_LIVE_SYMBOL = "BTCUSDT";
export const KLINE_LIVE_ALARM_MS = 1000;
export const KLINE_LIVE_REST_MS = 2000;
export const KLINE_LIVE_WS_STALE_MS = 3000;
export const KLINE_LIVE_RECONNECT_MS = 3500;
export const KLINE_LIVE_SNAPSHOT_MS = 5000;
export const KLINE_LIVE_RESTRICTED_COOL_MS = 15 * 60 * 1000;
/** USDⓈ-M 2026-04-23 起组合流必须走 /market/stream；旧 /stream 已下线。 */
export const KLINE_LIVE_COMBINED_BASE = "wss://fstream.binance.com/market/stream";

let hooks = {
  persistKlines: async () => ({ inserted: 0 }),
  updateSyncStatus: async () => {},
  persistLiveKlineBar: null,
  persistLiveSnapshot: null,
  fetchKlinesFromBinance: async () => ({ ok: false }),
  fetchBinanceFapiJson: async () => ({ ok: false }),
};

export function bindKlineLiveHooks(next) {
  hooks = { ...hooks, ...(next || {}) };
}

export function klineArrayFromWsK(k) {
  return [
    Number(k && k.t),
    String(k && k.o),
    String(k && k.h),
    String(k && k.l),
    String(k && k.c),
    String(k && k.v != null ? k.v : "0"),
    Number(k && k.T) || (Number(k && k.t) + 1),
    String(k && k.q != null ? k.q : "0"),
    String(k && k.n != null ? k.n : "0"),
    String(k && k.V != null ? k.V : "0"),
    String(k && k.Q != null ? k.Q : "0"),
  ];
}

export function markPriceToPremium(msg, symbol = KLINE_LIVE_SYMBOL) {
  return {
    symbol,
    markPrice: msg && msg.p,
    indexPrice: msg && msg.i,
    estimatedSettlePrice: msg && msg.P,
    lastFundingRate: msg && msg.r,
    interestRate: null,
    nextFundingTime: Number(msg && msg.T) || null,
    time: Number(msg && (msg.E || msg.T)) || Date.now(),
  };
}

export function canonicalBinanceHost(host, fallback = "fapi.binance.com") {
  const h = String(host || "");
  if (/(?:^|\.)binance\.com$/i.test(h) || /binance\.com/i.test(h)) return h;
  return fallback;
}

export function klineLiveCombinedStreamUrl(symbol = KLINE_LIVE_SYMBOL, origin) {
  const streams = KLINE_LIVE_INTERVALS
    .map((iv) => `${String(symbol).toLowerCase()}@kline_${iv}`)
    .concat(`${String(symbol).toLowerCase()}@markPrice@1s`)
    .join("/");
  const query = `?streams=${streams}`;
  if (origin) return toWebSocketUrl(origin, `/market/stream${query}`);
  return `${KLINE_LIVE_COMBINED_BASE}${query}`;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export class KlineLiveCollector {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.symbol = KLINE_LIVE_SYMBOL;
    this.ws = null;
    this.startedAt = 0;
    this.lastMessageAt = 0;
    this.lastWriteAt = 0;
    this.lastRestAt = 0;
    this.lastSnapshotAt = 0;
    this.lastRestrictedAt = 0;
    this.messageCount = 0;
    this.writeCount = 0;
    this.restCount = 0;
    this.snapshotCount = 0;
    this.reconnectCount = 0;
    this.lastError = "";
    this.status = "idle";
    this.sourceHost = "fstream.binance.com";
    this.pending = new Map();
    this.pendingPremium = null;
    this.writeChain = Promise.resolve();
    this.connecting = false;
    this.reconnectTimer = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/wake" || url.pathname === "/status") {
      await this.ensureStarted();
      await this.flushAll("wake");
      return json({ ok: true, collector: this.snapshot() });
    }
    return json({ ok: false, error: "collector path not found" }, 404);
  }

  async alarm() {
    await this.ensureStarted();
    await this.flushAll("alarm");
    const last = this.lastMessageAt || 0;
    if (!last || Date.now() - last > KLINE_LIVE_WS_STALE_MS) await this.restFallback("stale");
    await this.snapshotRest();
    await this.scheduleAlarm();
  }

  async ensureStarted() {
    if (!this.startedAt) this.startedAt = Date.now();
    if (!this.ws && !this.connecting && !this.reconnectTimer) await this.connect();
    await this.scheduleAlarm();
  }

  async scheduleAlarm() {
    if (this.state && this.state.storage && typeof this.state.storage.setAlarm === "function") {
      await this.state.storage.setAlarm(Date.now() + KLINE_LIVE_ALARM_MS);
    }
  }

  runExclusive(fn) {
    const next = this.writeChain.then(fn, fn);
    this.writeChain = next.catch(() => {});
    return next;
  }

  async connect() {
    if (this.ws || this.connecting) return;
    if (typeof WebSocket === "undefined") {
      this.status = "unavailable";
      this.lastError = "WebSocket unavailable";
      return;
    }
    const origin = parseOriginOnly(this.env && this.env.BINANCE_FSTREAM_ORIGIN);
    const url = klineLiveCombinedStreamUrl(this.symbol, origin);
    this.status = "connecting";
    this.connecting = true;
    let ws;
    try {
      ws = await openEgressWebSocket(this.env, url);
      this.ws = ws;
    } catch (e) {
      this.connecting = false;
      this.ws = null;
      this.status = "error";
      this.lastError = e && e.message ? e.message : String(e);
      this.scheduleReconnect();
      return;
    }
    const attach = () => {
      if (ws !== this.ws) return;
      this.connecting = false;
      this.status = "realtime";
      this.lastError = "";
      this.reconnectCount = 0;
    };
    if (origin) attach();
    ws.onopen = attach;
    ws.onmessage = (ev) => {
      if (ws !== this.ws) return;
      try {
        const msg = JSON.parse(ev.data);
        const data = msg.data || msg;
        if (data && data.e === "markPriceUpdate") {
          this.lastMessageAt = Date.now();
          this.messageCount += 1;
          this.status = "realtime";
          this.sourceHost = "fstream.binance.com";
          this.pendingPremium = data;
          return;
        }
        const k = data && data.k;
        if (!k || data.e !== "kline") return;
        this.lastMessageAt = Date.now();
        this.messageCount += 1;
        this.status = "realtime";
        this.sourceHost = "fstream.binance.com";
        const interval = String(k.i || "");
        if (!KLINE_LIVE_INTERVALS.includes(interval)) return;
        this.pending.set(interval, klineArrayFromWsK(k));
      } catch (e) {
        this.lastError = (e && e.message ? e.message : String(e)).slice(0, 160);
      }
    };
    ws.onerror = () => {
      if (ws !== this.ws) return;
      this.status = "error";
      this.lastError = "WS error";
      try { ws.close(); } catch (_) {}
    };
    ws.onclose = () => {
      if (ws !== this.ws) return;
      this.connecting = false;
      this.ws = null;
      this.status = "reconnecting";
      this.scheduleReconnect();
    };
  }

  scheduleReconnect() {
    if (this.reconnectTimer || this.ws || this.connecting) return;
    this.reconnectCount += 1;
    const delay = Math.min(30000, KLINE_LIVE_RECONNECT_MS * Math.min(8, Math.max(1, this.reconnectCount)));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.ws && !this.connecting) void this.connect();
    }, delay);
  }

  async persistOne(interval, klines, sourceHost, ingestionMode) {
    const rows = Array.isArray(klines) ? klines : [klines];
    if (!rows.length || !this.env || !this.env.DB) return;
    await hooks.persistKlines(this.env, this.symbol, interval, rows, { skipPrune: true });
    const latestT = Number(rows[rows.length - 1][0]);
    await hooks.updateSyncStatus(this.env, this.symbol, interval, {
      ok: true,
      inserted: rows.length,
      latestT,
    });
    if (typeof hooks.persistLiveKlineBar === "function") {
      try {
        await hooks.persistLiveKlineBar(this.env.DB, interval, rows[rows.length - 1], sourceHost, ingestionMode);
      } catch (_) {}
    }
    this.writeCount += 1;
    this.lastWriteAt = Date.now();
  }

  async flushAll(reason) {
    return this.runExclusive(() => this.flushPending(reason));
  }

  async flushPending(_reason) {
    const batch = [...this.pending.entries()];
    this.pending.clear();
    const premium = this.pendingPremium;
    this.pendingPremium = null;
    for (const [interval, kline] of batch) {
      await this.persistOne(interval, [kline], this.sourceHost, "cloud-ws");
    }
    if (premium && typeof hooks.persistLiveSnapshot === "function" && this.env && this.env.DB) {
      try {
        await hooks.persistLiveSnapshot(
          this.env.DB,
          "binance-perp-premium",
          markPriceToPremium(premium, this.symbol),
          this.sourceHost,
          "cloud-ws"
        );
        this.snapshotCount += 1;
        this.lastWriteAt = Date.now();
      } catch (err) {
        this.lastError = (err && err.message ? err.message : String(err)).slice(0, 160);
      }
    }
  }

  restrictedCooling() {
    return this.lastRestrictedAt && Date.now() - this.lastRestrictedAt < KLINE_LIVE_RESTRICTED_COOL_MS;
  }

  markRestricted(got) {
    const status = Number(got && (got.status || got.httpStatus)) || 0;
    const error = `${(got && got.error) || ""} ${(got && got.errorKind) || ""}`;
    if (status === 403 || status === 451 || /restricted|forbidden|cloudfront|blacklisted|location/i.test(error)) {
      this.lastRestrictedAt = Date.now();
      return true;
    }
    return false;
  }

  async restFallback(reason) {
    if (this.restrictedCooling()) return;
    if (Date.now() - this.lastRestAt < KLINE_LIVE_REST_MS) return;
    this.lastRestAt = Date.now();
    for (const interval of KLINE_LIVE_INTERVALS) {
      const got = await hooks.fetchKlinesFromBinance(this.env, {
        symbol: this.symbol,
        interval,
        limit: 2,
      });
      if (!got.ok || !Array.isArray(got.klines) || !got.klines.length) {
        this.lastError = `${reason}:${interval}:${got.error || "empty"}`.slice(0, 160);
        this.markRestricted(got);
        if (this.restrictedCooling()) return;
        continue;
      }
      this.sourceHost = canonicalBinanceHost(got.host, "fapi.binance.com");
      await this.persistOne(interval, got.klines, this.sourceHost, "cloud-readthrough");
      this.restCount += 1;
    }
  }

  async snapshotRest() {
    if (this.restrictedCooling()) return;
    if (Date.now() - this.lastSnapshotAt < KLINE_LIVE_SNAPSHOT_MS) return;
    if (typeof hooks.fetchBinanceFapiJson !== "function" || typeof hooks.persistLiveSnapshot !== "function") return;
    if (!this.env || !this.env.DB) return;
    this.lastSnapshotAt = Date.now();
    const jobs = [
      ["binance-perp-oi", "/fapi/v1/openInterest", { symbol: this.symbol }],
      ["binance-perp-book", "/fapi/v1/depth", { symbol: this.symbol, limit: "20" }],
    ];
    if (!this.pendingPremium && Date.now() - this.lastMessageAt > KLINE_LIVE_WS_STALE_MS) {
      jobs.unshift(["binance-perp-premium", "/fapi/v1/premiumIndex", { symbol: this.symbol }]);
    }
    for (const [id, path, params] of jobs) {
      const got = await hooks.fetchBinanceFapiJson(this.env, path, params, "LiveTape");
      if (got && got.skipped) continue;
      if (!got.ok) {
        this.lastError = `snapshot:${id}:${got.error || "empty"}`.slice(0, 160);
        this.markRestricted(got);
        if (this.restrictedCooling()) return;
        continue;
      }
      try {
        await hooks.persistLiveSnapshot(
          this.env.DB,
          id,
          got.data,
          canonicalBinanceHost(got.host, "fapi.binance.com"),
          "cloud-readthrough"
        );
        this.snapshotCount += 1;
        this.lastWriteAt = Date.now();
      } catch (err) {
        this.lastError = (err && err.message ? err.message : String(err)).slice(0, 160);
      }
    }
  }

  snapshot() {
    return {
      symbol: this.symbol,
      status: this.status,
      startedAt: this.startedAt,
      lastMessageAt: this.lastMessageAt,
      lastWriteAt: this.lastWriteAt,
      lastRestAt: this.lastRestAt,
      lastSnapshotAt: this.lastSnapshotAt,
      messageCount: this.messageCount,
      writeCount: this.writeCount,
      restCount: this.restCount,
      snapshotCount: this.snapshotCount,
      reconnectCount: this.reconnectCount,
      lastError: this.lastError,
      sourceHost: this.sourceHost,
      pending: this.pending.size,
      restrictedCooling: this.restrictedCooling(),
      connecting: this.connecting,
    };
  }
}
