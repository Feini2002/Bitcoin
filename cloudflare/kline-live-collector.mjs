/** USDⓈ-M live tape: Binance WS first, REST as backup. Writes D1 only. */

import { parseOriginOnly, toWebSocketUrl, openEgressWebSocket, marketTransportProvenance } from "./finance/egress.mjs";
import { KlineRecovery, KLINE_STEPS, klineOpenAt } from "./kline-recovery.mjs";
import { cloudTrialExpired } from './cloud-trial.mjs';

export const KLINE_LIVE_INTERVALS = ["5m", "15m", "1h", "4h", "1d", "3d", "1w"];
export const KLINE_LIVE_SYMBOL = "BTCUSDT";
export const KLINE_LIVE_ALARM_MS = 1000;
// Measured pre-cutover writes were ~9.9s apart; prevent faster networking from
// multiplying D1 writes while improving that observed freshness with a 5s floor.
export const KLINE_LIVE_MIN_CYCLE_MS = 5000;
export const KLINE_LIVE_WRITE_CONCURRENCY = 3;
export const KLINE_LIVE_REST_MS = 2000;
export const KLINE_LIVE_WS_STALE_MS = 3000;
export const KLINE_LIVE_RECONNECT_MS = 3500;
export const KLINE_LIVE_SNAPSHOT_MS = 5000;
export const KLINE_LIVE_RESTRICTED_COOL_MS = 15 * 60 * 1000;
/** USDⓈ-M 2026-04-23 起组合流必须走 /market/stream；旧 /stream 已下线。 */
export const KLINE_LIVE_COMBINED_BASE = "wss://fstream.binance.com/market/stream";

let hooks = {
  persistKlineCommit: async () => { throw new Error('atomic kline writer unavailable'); },
  persistKlines: async () => ({ inserted: 0 }),
  updateSyncStatus: async () => {},
  persistLiveKlineBar: null,
  persistLiveSnapshot: null,
  fetchKlinesFromBinance: async () => ({ ok: false }),
  fetchBinanceFapiJson: async () => ({ ok: false }),
  readKlineCursor: null,
  persistRestKlineBatch: null,
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
  const h = String(host || "").trim();
  if (/(?:^|\.)binance\.com$/i.test(h)) return h;
  return h || fallback;
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

export class KlineLiveComponent {
  constructor(state, env, { recoveryEnabled = true } = {}) {
    this.state = state;
    this.env = env;
    this.symbol = KLINE_LIVE_SYMBOL;
    this.ws = null;
    this.startedAt = 0;
    this.lastMessageAt = 0;
    this.lastPremiumMessageAt = 0;
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
    this.lastPremiumSignature = "";
    this.writeChain = Promise.resolve();
    this.connecting = false;
    this.reconnectTimer = null;
    this.stopped = false;
    this.lastFlushAttemptAt = 0;
    this.lastKlineMessageAt = {};
    this.lastKlineWriteAt = {};
    this.latestMessages = new Map();
    this.sequence = 0;
    this.tasks = new Map();
    this.nextCycleAt = 0;
    this.needsReconcile = new Set(KLINE_LIVE_INTERVALS);
    this.recoveryGeneration = {};
    this.closedThrough = {};
    this.recoveryFromT = {};
    this.recoveryFull = new Set();
    this.lastPersistedOpenAt = {};
    this.cursorTask = null;
    this.recovery = recoveryEnabled && state?.storage?.sql ? new KlineRecovery(state.storage, KLINE_LIVE_INTERVALS) : null;
    this.gapOpen = new Set(KLINE_LIVE_INTERVALS);
    if (this.recovery) for (const row of this.recovery.rows.values()) this.restoreRecovery(row);
    this.restAppliedAt = {};
    this.reconcileSequence = {};
    this.appliedReconcileSequence = {};
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/wake" || url.pathname === "/status") {
      await this.ensureStarted();
      return json({ ok: true, collector: this.snapshot() });
    }
    return json({ ok: false, error: "collector path not found" }, 404);
  }

  startTask(name, fn) {
    if (this.stopped || this.tasks.has(name)) return;
    const task = Promise.resolve().then(fn).catch(error => {
      this.lastError = String(error?.message || error).slice(0, 160);
    }).finally(() => this.tasks.delete(name));
    this.tasks.set(name, task);
    if (typeof this.state?.waitUntil === "function") this.state.waitUntil(task);
  }

  tick(now = Date.now()) {
    if(this.stopExpiredTrial(now)) return;
    if (this.stopped) return;
    this.startTask("connect", () => this.ensureStarted());
    // OI/book due times are independent of the seven-period D1 flush. This task
    // never overlaps itself, and snapshotRest retains its explicit 5s gate.
    this.startTask("snapshot", () => this.snapshotRest());
    if ([...this.pending.values()].some(entry => entry.closed)) this.startTask("closed", async () => {
      await this.captureRecoveryCursors();
      await this.flushAll("closed");
    });
    // Keep the explicit start-to-start floor even when independent interval I/O
    // finishes faster; shared alarms must not multiply forming-bar writes.
    if (now >= this.nextCycleAt && !this.tasks.has("cycle")) {
      this.lastFlushAttemptAt = now;
      this.startTask("cycle", async () => {
        try {
          await this.captureRecoveryCursors();
          await this.flushAll("alarm");
          if (KLINE_LIVE_INTERVALS.some(iv => !this.lastKlineMessageAt[iv] || Date.now() - this.lastKlineMessageAt[iv] > KLINE_LIVE_WS_STALE_MS)) {
            await this.restFallback("stale");
          }
        } finally {
          this.nextCycleAt = Math.max(now + KLINE_LIVE_MIN_CYCLE_MS, Date.now() + KLINE_LIVE_ALARM_MS);
        }
      });
    }
  }

  async ensureStarted() {
    if(this.stopExpiredTrial()) return;
    if (this.stopped) return;
    if (!this.startedAt) this.startedAt = Date.now();
    if (!this.ws && !this.connecting && !this.reconnectTimer) await this.connect();
  }

  runExclusive(fn) {
    const next = this.writeChain.then(fn, fn);
    this.writeChain = next.catch(() => {});
    return next;
  }

  async connect() {
    if(this.stopExpiredTrial()) return;
    if (this.stopped || this.ws || this.connecting) return;
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
      if (this.stopExpiredTrial() || this.stopped) { try { ws.close(); } catch (_) {} return; }
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
        this.receive(msg.data || msg);
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
    if(this.stopExpiredTrial()) return;
    if (this.stopped || this.reconnectTimer || this.ws || this.connecting) return;
    this.reconnectCount += 1;
    const delay = Math.min(30000, KLINE_LIVE_RECONNECT_MS * Math.min(8, Math.max(1, this.reconnectCount)));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped && !this.ws && !this.connecting) void this.connect();
    }, delay);
  }

  receive(data, now = Date.now()) {
    if(this.stopExpiredTrial()) return;
    if (this.stopped) return;
    const k = data?.k;
    if (data?.e !== "markPriceUpdate" && (!k || data.e !== "kline" || !KLINE_LIVE_INTERVALS.includes(k.i))) return;
    this.lastMessageAt = now;
    this.messageCount += 1;
    this.status = "realtime";
    this.sourceHost = "fstream.binance.com";
    if (data.e === "markPriceUpdate") {
      this.lastPremiumMessageAt = now;
      const signature = JSON.stringify(data);
      if (signature === this.lastPremiumSignature) return;
      // The exchange timestamp remains part of identity even when price is unchanged.
      if (!this.pendingPremium || Number(data.E) >= Number(this.pendingPremium.data.E)) {
        this.pendingPremium = { data, version: ++this.sequence, receivedAt: new Date(now).toISOString() };
        this.lastPremiumSignature = signature;
      }
      return;
    }
    const interval = String(k.i);
    if (this.lastKlineMessageAt[interval] && now - this.lastKlineMessageAt[interval] > KLINE_LIVE_WS_STALE_MS) this.markGap(interval);
    if (this.recovery) this.restoreRecovery(this.recovery.endGap(interval));
    else this.gapOpen.delete(interval);
    this.lastKlineMessageAt[interval] = now;
    const row = klineArrayFromWsK(k);
    const key = `${interval}:${row[0]}`;
    const old = this.latestMessages.get(key);
    const eventAt = Number(data.E) || now;
    const closed = k.x === true;
    if (!closed && Number(this.closedThrough[interval] || 0) >= row[0]) return;
    if (old && (old.closed && !closed || eventAt < old.eventAt)) return;
    const signature = JSON.stringify([row, closed]);
    if (old?.signature === signature) return;
    const entry = { interval, row, closed, eventAt, signature, receivedAt: new Date(now).toISOString(), version: ++this.sequence };
    this.latestMessages.set(key, entry);
    this.pending.set(key, entry);
    if (closed) this.closedThrough[interval] = Math.max(this.closedThrough[interval] || 0, row[0]);
    // Keep current and recent closed identities only; D1 and REST own historical recovery.
    for (const [oldKey, value] of this.latestMessages) {
      if (value.interval === interval && value.row[0] < row[0] && !this.pending.has(oldKey)) this.latestMessages.delete(oldKey);
    }
  }

  markGap(interval) {
    if (this.recovery) { this.restoreRecovery(this.recovery.beginGap(interval, this.lastPersistedOpenAt[interval])); return; }
    if (!this.gapOpen.has(interval) || !this.needsReconcile.has(interval)) {
      this.recoveryGeneration[interval] = (this.recoveryGeneration[interval] || 0) + 1;
      const from = this.lastPersistedOpenAt[interval] || 0;
      this.recoveryFromT[interval] = this.needsReconcile.has(interval) && this.recoveryFromT[interval] ? Math.min(this.recoveryFromT[interval], from || Infinity) : from;
    }
    this.gapOpen.add(interval);
    this.needsReconcile.add(interval);
  }

  restoreRecovery(row) {
    const interval = row.interval;
    this.recoveryFromT[interval] = row.from_t;
    this.recoveryGeneration[interval] = row.generation;
    (row.needed ? this.needsReconcile.add : this.needsReconcile.delete).call(this.needsReconcile, interval);
    (row.full ? this.recoveryFull.add : this.recoveryFull.delete).call(this.recoveryFull, interval);
    (row.gap_open ? this.gapOpen.add : this.gapOpen.delete).call(this.gapOpen, interval);
  }

  confirmReconciled(interval, generation, coveredThrough) {
    if (!Number.isFinite(coveredThrough) || coveredThrough < (this.recoveryFromT[interval] || 0)) return false;
    if (KLINE_LIVE_INTERVALS.includes(interval) && Number(generation) === (this.recoveryGeneration[interval] || 0)) {
      if (this.recovery && !this.recovery.acknowledge(interval, generation, coveredThrough)) return false;
      this.needsReconcile.delete(interval);
      this.recoveryFull.delete(interval);
      this.recoveryFromT[interval] = coveredThrough;
      return true;
    }
    return false;
  }

  async captureRecoveryCursors() {
    if (this.cursorTask) return this.cursorTask;
    this.cursorTask = (async () => {
      if (typeof hooks.readKlineCursor !== "function") return;
      await Promise.all(KLINE_LIVE_INTERVALS.map(async interval => {
        const meta = await hooks.readKlineCursor(this.env, this.symbol, interval);
        if (this.recovery) this.restoreRecovery(this.recovery.initialize(interval, meta));
        else this.recoveryFromT[interval] = Number(meta.maxT) || 0;
        this.lastPersistedOpenAt[interval] = Number(meta.maxT) || 0;
        if (!meta.hasRows) this.recoveryFull.add(interval);
      }));
    })().catch(error => { this.cursorTask = null; throw error; });
    return this.cursorTask;
  }

  async persistOne(interval, klines, sourceHost, ingestionMode, metadata) {
    if(this.stopExpiredTrial()) throw new Error('cloud_trial_expired');
    const rows = Array.isArray(klines) ? klines : [klines];
    if (!rows.length || !this.env || !this.env.DB) throw new Error("live tape D1 binding missing");
    await hooks.persistKlineCommit(this.env, this.symbol, interval, rows, sourceHost, ingestionMode, metadata);
    const latestT = Number(rows[rows.length - 1][0]);
    this.writeCount += 1;
    this.lastWriteAt = Date.now();
    this.lastKlineWriteAt[interval] = this.lastWriteAt;
    this.lastPersistedOpenAt[interval] = Math.max(this.lastPersistedOpenAt[interval] || 0, latestT);
  }

  async flushAll(reason) {
    return this.runExclusive(() => this.flushPending(reason));
  }

  async flushPending(reason) {
    const batch = [...this.pending.entries()].filter(([, entry]) => reason !== "closed" || entry.closed);
    const premium = reason === "closed" ? null : this.pendingPremium;
    const byInterval = new Map();
    for (const item of batch) {
      const interval = item[1].interval;
      if (!byInterval.has(interval)) byInterval.set(interval, []);
      byInterval.get(interval).push(item);
    }
    const groups = [...byInterval.values()];
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(KLINE_LIVE_WRITE_CONCURRENCY, groups.length) }, async () => {
      while (next < groups.length) {
        const entries = groups[next++].sort((a, b) => Number(a[1].row[0]) - Number(b[1].row[0]));
        // A single interval stays sequential (old close before next forming bar).
        // flushAll's queue also excludes a simultaneous closed/REST write cycle.
        for (const [key, captured] of entries) {
          const entry = this.pending.get(key) || captured;
          try {
            await this.persistOne(entry.interval, [entry.row], "fstream.binance.com", "cloud-ws", {
              closed: entry.closed, receivedAt: entry.receivedAt,
            });
            if (this.pending.get(key)?.version === entry.version) this.pending.delete(key);
          } catch (error) {
            this.lastError = String(error?.message || error).slice(0, 160);
          }
        }
      }
    }));
    if (premium && typeof hooks.persistLiveSnapshot === "function" && this.env && this.env.DB) {
      try {
        await hooks.persistLiveSnapshot(
          this.env.DB,
          "binance-perp-premium",
          markPriceToPremium(premium.data, this.symbol),
          this.sourceHost,
          "cloud-ws",
          { receivedAt: premium.receivedAt }
        );
        this.snapshotCount += 1;
        this.lastWriteAt = Date.now();
        if (this.pendingPremium?.version === premium.version) this.pendingPremium = null;
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
    if(this.stopExpiredTrial()) return;
    if (this.restrictedCooling()) return;
    if (Date.now() - this.lastRestAt < KLINE_LIVE_REST_MS) return;
    this.lastRestAt = Date.now();
    for (const interval of KLINE_LIVE_INTERVALS) {
      if (this.lastKlineMessageAt[interval] && Date.now() - this.lastKlineMessageAt[interval] <= KLINE_LIVE_WS_STALE_MS) continue;
      this.markGap(interval);
      const messageAtStart = this.lastKlineMessageAt[interval] || 0;
      const requestStartedAt = Date.now();
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
      this.sourceHost = marketTransportProvenance(this.env, { transportHost: got.host, venue: "binance-usdm" }).providerHost;
      await this.runExclusive(async () => {
        // A slow response may not overwrite WS state received while it was in flight.
        if (this.stopped || (this.lastKlineMessageAt[interval] || 0) !== messageAtStart) return;
        const rows = got.klines.filter(row => Number(row[0]) + KLINE_STEPS[interval] <= requestStartedAt || Number(row[0]) === klineOpenAt(interval, Date.now()));
        if (!rows.length) return;
        await this.persistOne(interval, rows, this.sourceHost, "cloud-readthrough", {
          closed:null, receivedAt:new Date().toISOString(), requestStartedAt:new Date(requestStartedAt).toISOString(),
        });
        for (const row of rows) {
          const key = `${interval}:${row[0]}`;
          if ((this.pending.get(key)?.eventAt || Infinity) <= requestStartedAt) this.pending.delete(key);
        }
      });
      this.restCount += 1;
    }
  }

  async snapshotRest() {
    if(this.stopExpiredTrial()) return;
    if (this.restrictedCooling()) return;
    if (Date.now() - this.lastSnapshotAt < KLINE_LIVE_SNAPSHOT_MS) return;
    if (typeof hooks.fetchBinanceFapiJson !== "function" || typeof hooks.persistLiveSnapshot !== "function") return;
    if (!this.env || !this.env.DB) return;
    this.lastSnapshotAt = Date.now();
    const jobs = [
      ["binance-perp-oi", "/fapi/v1/openInterest", { symbol: this.symbol }],
      ["binance-perp-book", "/fapi/v1/depth", { symbol: this.symbol, limit: "20" }],
    ];
    if (!this.lastPremiumMessageAt || Date.now() - this.lastPremiumMessageAt > KLINE_LIVE_WS_STALE_MS) {
      jobs.unshift(["binance-perp-premium", "/fapi/v1/premiumIndex", { symbol: this.symbol }]);
    }
    const results = await Promise.allSettled(jobs.map(async ([id, path, params]) => {
      const got = await hooks.fetchBinanceFapiJson(this.env, path, params, "LiveTape");
      if(this.stopExpiredTrial()) return;
      if (got && got.skipped) return;
      if (!got.ok) {
        this.lastError = `snapshot:${id}:${got.error || "empty"}`.slice(0, 160);
        this.markRestricted(got);
        if (this.restrictedCooling()) return;
        return;
      }
      try {
        await hooks.persistLiveSnapshot(
          this.env.DB,
          id,
          got.data,
          marketTransportProvenance(this.env, { transportHost: got.host, venue: "binance-usdm" }).providerHost,
          "cloud-readthrough",
          { receivedAt: new Date().toISOString() }
        );
        this.snapshotCount += 1;
        this.lastWriteAt = Date.now();
      } catch (err) {
        this.lastError = (err && err.message ? err.message : String(err)).slice(0, 160);
      }
    }));
    const failure = results.find(result => result.status === "rejected");
    if (failure) this.lastError = String(failure.reason?.message || failure.reason).slice(0, 160);
  }

  snapshot() {
    return {
      symbol: this.symbol,
      status: this.status,
      startedAt: this.startedAt,
      lastMessageAt: this.lastMessageAt,
      lastPremiumMessageAt: this.lastPremiumMessageAt,
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
      intervalHealth: Object.fromEntries(KLINE_LIVE_INTERVALS.map(interval => [interval, {
        lastMessageAt: this.lastKlineMessageAt[interval] || 0,
        lastWriteAt: this.lastKlineWriteAt[interval] || 0,
        needsReconcile: this.needsReconcile.has(interval),
        recoveryGeneration: this.recoveryGeneration[interval] || 0,
        recoveryFromT: this.recoveryFromT[interval] || 0,
        recoveryFull: this.recoveryFull.has(interval),
      }])),
      writeCadenceMs: KLINE_LIVE_ALARM_MS,
      effectiveMinFlushMs: KLINE_LIVE_MIN_CYCLE_MS,
      writeConcurrency: KLINE_LIVE_WRITE_CONCURRENCY,
      snapshotCadenceMs: KLINE_LIVE_SNAPSHOT_MS,
    };
  }
  async reconciliationContext(interval) {
    if (!KLINE_LIVE_INTERVALS.includes(interval)) throw new Error('unsupported interval');
    await this.captureRecoveryCursors();
    const requestSequence = (this.reconcileSequence[interval] || 0) + 1;
    this.reconcileSequence[interval] = requestSequence;
    return { health: this.snapshot().intervalHealth[interval], requestSequence };
  }

  async applyReconciliation({ interval, rows, sourceHost, transportHost = null, requestStartedAt, receivedAt, generation, requestSequence, historyExhausted = false }) {
    if(this.stopExpiredTrial()) throw new Error('cloud_trial_expired');
    if (!KLINE_LIVE_INTERVALS.includes(interval) || !Array.isArray(rows) || rows.length > 6000 || !Number.isFinite(requestStartedAt) || !Number.isInteger(requestSequence) || requestSequence < 1) throw new Error('invalid kline reconciliation');
    await this.captureRecoveryCursors();
    return this.runExclusive(async () => {
      if (Number(generation) !== this.recoveryGeneration[interval]) return { inserted: 0, reconciled: false, skipped: 'stale_recovery_generation' };
      if (requestSequence < Number(this.appliedReconcileSequence[interval] || 0)) return { inserted: 0, reconciled: false, skipped: 'older_rest_response' };
      if (requestStartedAt < Number(this.restAppliedAt[interval] || 0)) return { inserted: 0, reconciled: false, skipped: 'older_rest_response' };
      const step = KLINE_STEPS[interval];
      const end = klineOpenAt(interval, requestStartedAt);
      const closed = rows.filter(row => Number(row[0]) + step <= requestStartedAt)
        .sort((a, b) => Number(a[0]) - Number(b[0]));
      // REST is allowed to revise a previously closed bar, but never a bar which
      // closed after this request started. Drop queued pre-close WS snapshots too.
      const accepted = closed.filter(row => {
        const latest = this.latestMessages.get(`${interval}:${row[0]}`);
        return !latest || latest.eventAt <= requestStartedAt;
      });
      if (accepted.length) {
        const persisted = await hooks.persistKlineCommit(this.env, this.symbol, interval, accepted, sourceHost, 'cloud-readthrough', {
          restBatch:true, receivedAt, requestStartedAt:new Date(requestStartedAt).toISOString(), transportHost,
        });
        if (persisted?.inserted !== accepted.length) throw new Error('kline coverage contains unwritten rows');
        for (const row of accepted) {
          const key = `${interval}:${row[0]}`;
          const pending = this.pending.get(key);
          if (pending && pending.eventAt <= requestStartedAt) this.pending.delete(key);
          this.closedThrough[interval] = Math.max(this.closedThrough[interval] || 0, Number(row[0]));
        }
      }
      this.restAppliedAt[interval] = requestStartedAt;
      this.appliedReconcileSequence[interval] = requestSequence;
      let from = this.recoveryFromT[interval] || 0;
      // The public contract retains at most 6000 bars; listing start can be newer.
      from = Math.max(from, end - 5999 * step);
      if (this.recoveryFull.has(interval) && historyExhausted && closed.length) from = Math.max(from, Number(closed[0][0]));
      const available = new Set(accepted.map(row => Number(row[0])));
      let complete = from > 0 && from <= end;
      for (let t = from; complete && t < end; t += step) if (!available.has(t)) complete = false;
      const reconciled = complete && this.confirmReconciled(interval, generation, end);
      return { inserted: accepted.length, reconciled, coveredThrough: complete ? end : null };
    });
  }

  stopExpiredTrial(now=Date.now()) {
    if(!cloudTrialExpired(this.env,now)) return false;
    this.stopped=true;this.status='trial_expired';
    if(this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer=null;
    const ws=this.ws;this.ws=null;this.connecting=false;
    if(ws) {try {ws.close(1000,'cost trial expired');}catch{}}
    return true;
  }
}

/** Compatibility namespace only. Every legacy entry is terminal and never reconnects. */
export class KlineLiveCollector extends KlineLiveComponent {
  constructor(state, env) {
    super(state, env, { recoveryEnabled: false });
    this.stopped = true;
    this.status = "retired";
    this.retiredAt = 0;
    this.retirement = null;
  }

  async retire() {
    if (this.retirement) return this.retirement;
    this.retirement = (async () => {
      this.stopped = true;
      this.status = "retired";
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      const ws = this.ws;
      this.ws = null;
      this.connecting = false;
      if (ws) { try { ws.close(1000, "merged into LiquidationCollector"); } catch (_) {} }
      const prior = await this.state.storage.get("retired");
      this.retiredAt = prior?.retiredAt || Date.now();
      await this.state.storage.put("retired", { retiredAt: this.retiredAt, successor: "LIQUIDATION_COLLECTOR/BTCUSDT" });
      await this.state.storage.deleteAlarm();
    })().catch(error => { this.retirement = null; throw error; });
    return this.retirement;
  }

  async ensureStarted() { await this.retire(); }
  async alarm() { await this.retire(); }
  async fetch(request) {
    if (!["/wake", "/status", "/retire"].includes(new URL(request.url).pathname)) return json({ ok: false, error: "collector path not found" }, 404);
    await this.retire();
    return json({ ok: true, collector: { ...this.snapshot(), retired: true, retiredAt: this.retiredAt, successor: "LIQUIDATION_COLLECTOR/BTCUSDT" } });
  }
}
