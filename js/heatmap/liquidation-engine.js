/* =======================================================
   Liquidation engine: Binance + Bybit force liquidation tape
   ======================================================= */
(function (global) {
  "use strict";

  const DEFAULT_SYMBOL = "BTCUSDT";
  const DEFAULT_BUCKET_SIZE = 50;
  const DEFAULT_MAX_EVENTS = 50;
  const DEFAULT_CACHE_RETENTION_MS = 24 * 60 * 60 * 1000;
  const MAX_TEST_EVENTS = 20;
  const STORAGE_PREFIX = "bitdesk.heatmap.liquidations";
  const RECONNECT_MS = 3500;
  const BYBIT_PING_MS = 20_000;
  const BINANCE_STALE_MS = 90_000;
  const BYBIT_STALE_MS = 60_000;
  const WATCHDOG_MS = 10_000;
  const DIAGNOSTIC_LOG_LIMIT = 30;
  const HEARTBEAT_LOG_MS = 30_000;

  function toNumber(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function roundPriceToBucket(price, bucketSize) {
    const b = Math.max(1, Number(bucketSize) || DEFAULT_BUCKET_SIZE);
    return Math.round((Number(price) || 0) / b) * b;
  }

  function storageKey(symbol) {
    return `${STORAGE_PREFIX}.${String(symbol || DEFAULT_SYMBOL).toUpperCase()}`;
  }

  function isRealEvent(ev) {
    return !!ev && !ev.isTest;
  }

  function eventWithinRetention(ev, retentionMs, now) {
    if (!isRealEvent(ev)) return true;
    const ts = Number(ev.ts);
    if (!Number.isFinite(ts)) return false;
    return !retentionMs || ts >= now - retentionMs;
  }

  function nowStatus(exchange, patch) {
    return {
      exchange,
      status: "idle",
      lastEventAt: 0,
      lastMessageAt: 0,
      lastHeartbeatAt: 0,
      connectedAt: 0,
      messageCount: 0,
      heartbeatCount: 0,
      eventCount: 0,
      legacyEventCount: 0,
      lastLegacyEventAt: 0,
      ignoredCount: 0,
      parseErrorCount: 0,
      lastError: "",
      lastRawType: "",
      lastDiagnostic: "",
      lastDiagnosticAt: 0,
      reconnectCount: 0,
      reconnectAt: 0,
      ...patch,
    };
  }

  function normalizePositionSide(exchange, side) {
    const s = String(side || "");
    if (exchange === "binance") {
      if (s.toUpperCase() === "SELL") return "long";
      if (s.toUpperCase() === "BUY") return "short";
    }
    if (exchange === "bybit") {
      if (s === "Buy") return "long";
      if (s === "Sell") return "short";
    }
    return "unknown";
  }

  function normalizeBinance(msg) {
    if (!msg || msg.e !== "forceOrder" || !msg.o) return null;
    const o = msg.o;
    const symbol = String(o.s || msg.s || DEFAULT_SYMBOL).toUpperCase();
    const price = toNumber(o.ap, NaN) || toNumber(o.p, NaN);
    const qty = toNumber(o.z, NaN) || toNumber(o.l, NaN) || toNumber(o.q, NaN);
    if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) return null;
    const ts = toNumber(o.T, toNumber(msg.E, Date.now()));
    const rawSide = String(o.S || "");
    return {
      id: `binance:${symbol}:${ts}:${rawSide}:${price}:${qty}`,
      exchange: "binance",
      symbol,
      ts,
      positionSide: normalizePositionSide("binance", rawSide),
      rawSide,
      price,
      qty,
      notional: price * qty,
      bucketPrice: null,
      receivedAt: Date.now(),
      raw: msg,
    };
  }

  function normalizeBybitRow(row) {
    if (!row) return null;
    const symbol = String(row.s || DEFAULT_SYMBOL).toUpperCase();
    const price = toNumber(row.p, NaN);
    const qty = toNumber(row.v, NaN);
    if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) return null;
    const ts = toNumber(row.T, Date.now());
    const rawSide = String(row.S || "");
    return {
      id: `bybit:${symbol}:${ts}:${rawSide}:${price}:${qty}`,
      exchange: "bybit",
      symbol,
      ts,
      positionSide: normalizePositionSide("bybit", rawSide),
      rawSide,
      price,
      qty,
      notional: price * qty,
      bucketPrice: null,
      receivedAt: Date.now(),
      raw: row,
    };
  }

  function normalizeBybit(msg) {
    if (!msg || !/^allLiquidation\./.test(String(msg.topic || ""))) return [];
    const rows = Array.isArray(msg.data) ? msg.data : (msg.data ? [msg.data] : []);
    return rows.map(normalizeBybitRow).filter(Boolean);
  }

  function normalizeBybitLegacyRow(row) {
    if (!row) return null;
    const symbol = String(row.symbol || row.s || DEFAULT_SYMBOL).toUpperCase();
    const price = toNumber(row.price != null ? row.price : row.p, NaN);
    const qty = toNumber(row.size != null ? row.size : row.v, NaN);
    if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) return null;
    const ts = toNumber(row.updatedTime != null ? row.updatedTime : row.T, Date.now());
    const rawSide = String(row.side || row.S || "");
    return {
      id: `bybit:${symbol}:${ts}:${rawSide}:${price}:${qty}`,
      exchange: "bybit",
      symbol,
      ts,
      positionSide: normalizePositionSide("bybit", rawSide),
      rawSide,
      price,
      qty,
      notional: price * qty,
      bucketPrice: null,
      receivedAt: Date.now(),
      raw: row,
      rawTopic: "liquidation",
    };
  }

  function normalizeBybitLegacy(msg) {
    if (!msg || !/^liquidation\./.test(String(msg.topic || ""))) return [];
    const rows = Array.isArray(msg.data) ? msg.data : (msg.data ? [msg.data] : []);
    return rows.map(normalizeBybitLegacyRow).filter(Boolean);
  }

  function filterEvents(events, opts) {
    opts = opts || {};
    const minNotional = Math.max(0, Number(opts.minNotional) || 0);
    const windowMs = Number(opts.windowMs) || 0;
    const since = windowMs > 0 ? Date.now() - windowMs : 0;
    return (events || []).filter((ev) => {
      if (!ev || ev.notional < minNotional) return false;
      if (since && Number(ev.ts) < since) return false;
      return true;
    });
  }

  function aggregateByPrice(events, bucketSize) {
    const rows = new Map();
    for (const ev of events || []) {
      const bucketPrice = roundPriceToBucket(ev.price, bucketSize);
      if (!rows.has(bucketPrice)) {
        rows.set(bucketPrice, {
          price: bucketPrice,
          longNotional: 0,
          shortNotional: 0,
          totalNotional: 0,
          count: 0,
          latestTs: 0,
          exchanges: {},
        });
      }
      const row = rows.get(bucketPrice);
      const sideKey = ev.positionSide === "short" ? "shortNotional" : "longNotional";
      row[sideKey] += ev.notional;
      row.totalNotional += ev.notional;
      row.count += 1;
      row.latestTs = Math.max(row.latestTs, Number(ev.ts) || 0);
      if (!row.exchanges[ev.exchange]) {
        row.exchanges[ev.exchange] = { longNotional: 0, shortNotional: 0, count: 0 };
      }
      row.exchanges[ev.exchange][sideKey] += ev.notional;
      row.exchanges[ev.exchange].count += 1;
    }
    return [...rows.values()].sort((a, b) => b.price - a.price);
  }

  function buildStats(events, sourceStatus) {
    const now = Date.now();
    const five = events.filter((ev) => Number(ev.ts) >= now - 5 * 60 * 1000);
    const fifteen = events.filter((ev) => Number(ev.ts) >= now - 15 * 60 * 1000);
    const stats = {
      total5m: 0,
      total15m: 0,
      longNotional: 0,
      shortNotional: 0,
      maxEvent: null,
      activeSources: 0,
    };
    for (const ev of five) stats.total5m += ev.notional;
    for (const ev of fifteen) stats.total15m += ev.notional;
    for (const ev of events) {
      if (ev.positionSide === "short") stats.shortNotional += ev.notional;
      else stats.longNotional += ev.notional;
      if (!stats.maxEvent || ev.notional > stats.maxEvent.notional) stats.maxEvent = ev;
    }
    for (const st of Object.values(sourceStatus || {})) {
      if (st && (st.status === "realtime" || st.status === "connecting")) stats.activeSources += 1;
    }
    return stats;
  }

  class LiquidationStream {
    constructor(opts) {
      opts = opts || {};
      this.symbol = String(opts.symbol || DEFAULT_SYMBOL).toUpperCase();
      this.bucketSize = Number(opts.bucketSize) || DEFAULT_BUCKET_SIZE;
      this.maxEvents = Number(opts.maxEvents) || DEFAULT_MAX_EVENTS;
      this.cacheRetentionMs = Number(opts.cacheRetentionMs) || DEFAULT_CACHE_RETENTION_MS;
      this.onUpdate = typeof opts.onUpdate === "function" ? opts.onUpdate : function () {};
      this.onStatus = typeof opts.onStatus === "function" ? opts.onStatus : function () {};
      this.events = [];
      this.diagnostics = [];
      this.seenIds = new Set();
      this.seenQueue = [];
      this.sources = {
        binance: { ws: null, probeWs: null, reconnectTimer: null, probeReconnectTimer: null, pingTimer: null, status: nowStatus("binance") },
        bybit: { ws: null, reconnectTimer: null, pingTimer: null, status: nowStatus("bybit") },
      };
      this.closedByUser = false;
      this.watchdogTimer = null;
    }

    cacheKey() {
      return storageKey(this.symbol);
    }

    loadCache() {
      try {
        const raw = global.localStorage && global.localStorage.getItem(this.cacheKey());
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        const rows = Array.isArray(parsed && parsed.events) ? parsed.events : [];
        const now = Date.now();
        this.events = rows
          .filter((ev) => ev && ev.symbol === this.symbol && Number.isFinite(Number(ev.price)))
          .filter((ev) => isRealEvent(ev) && eventWithinRetention(ev, this.cacheRetentionMs, now))
          .slice(-this.maxEvents);
        this.resetSeen();
        for (const ev of this.events) this.rememberId(ev.id);
        return this.events;
      } catch (_) {
        return [];
      }
    }

    saveCache() {
      try {
        if (!global.localStorage) return;
        const now = Date.now();
        global.localStorage.setItem(
          this.cacheKey(),
          JSON.stringify({
            symbol: this.symbol,
            savedAt: now,
            retentionMs: this.cacheRetentionMs,
            events: this.events
              .filter((ev) => isRealEvent(ev) && eventWithinRetention(ev, this.cacheRetentionMs, now))
              .slice(-this.maxEvents),
          })
        );
      } catch (_) {}
    }

    resetSeen() {
      this.seenIds = new Set();
      this.seenQueue = [];
    }

    rememberId(id) {
      const key = String(id || "");
      if (!key) return false;
      if (this.seenIds.has(key)) return false;
      this.seenIds.add(key);
      this.seenQueue.push(key);
      while (this.seenQueue.length > this.maxEvents * 4) {
        const old = this.seenQueue.shift();
        this.seenIds.delete(old);
      }
      return true;
    }

    pruneEvents() {
      const now = Date.now();
      this.events = this.events.filter((ev) => eventWithinRetention(ev, this.cacheRetentionMs, now));
      let realCount = this.events.filter(isRealEvent).length;
      while (realCount > this.maxEvents) {
        const idx = this.events.findIndex(isRealEvent);
        if (idx < 0) break;
        this.events.splice(idx, 1);
        realCount -= 1;
      }
      let testCount = this.events.filter((ev) => ev && ev.isTest).length;
      while (testCount > MAX_TEST_EVENTS) {
        const idx = this.events.findIndex((ev) => ev && ev.isTest);
        if (idx < 0) break;
        this.events.splice(idx, 1);
        testCount -= 1;
      }
    }

    latestRealEvent() {
      return this.events
        .filter(isRealEvent)
        .slice()
        .sort((a, b) => Number(b.ts) - Number(a.ts))[0] || null;
    }

    sourceSnapshot() {
      return {
        binance: { ...this.sources.binance.status },
        bybit: { ...this.sources.bybit.status },
      };
    }

    diagnosticSnapshot() {
      return this.diagnostics.slice().sort((a, b) => Number(b.ts) - Number(a.ts));
    }

    pushDiagnostic(exchange, kind, detail, level) {
      const ts = Date.now();
      const entry = {
        ts,
        exchange,
        kind: String(kind || "info"),
        detail: String(detail || ""),
        level: level || "info",
      };
      this.diagnostics.push(entry);
      while (this.diagnostics.length > DIAGNOSTIC_LOG_LIMIT) this.diagnostics.shift();
      const source = this.sources[exchange];
      if (source) {
        source.status = {
          ...source.status,
          lastDiagnostic: `${entry.kind}: ${entry.detail}`,
          lastDiagnosticAt: ts,
        };
      }
      this.onStatus(this.sourceSnapshot());
    }

    setSourceStatus(exchange, patch) {
      const source = this.sources[exchange];
      if (!source) return;
      source.status = { ...source.status, ...patch };
      this.onStatus(this.sourceSnapshot());
      this.publish();
    }

    touchSourceMessage(exchange, patch) {
      const source = this.sources[exchange];
      if (!source) return;
      source.status = {
        ...source.status,
        status: "realtime",
        lastMessageAt: Date.now(),
        messageCount: (Number(source.status.messageCount) || 0) + 1,
        lastError: "",
        reconnectAt: 0,
        ...patch,
      };
      this.onStatus(this.sourceSnapshot());
    }

    touchSourceHeartbeat(exchange, rawType) {
      const source = this.sources[exchange];
      if (!source) return;
      const now = Date.now();
      const lastLog = Number(source.status.lastHeartbeatLogAt) || 0;
      source.status = {
        ...source.status,
        status: "realtime",
        lastHeartbeatAt: now,
        heartbeatCount: (Number(source.status.heartbeatCount) || 0) + 1,
        lastRawType: rawType || source.status.lastRawType || "",
        lastError: "",
        reconnectAt: 0,
      };
      if (!lastLog || now - lastLog >= HEARTBEAT_LOG_MS) {
        source.status.lastHeartbeatLogAt = now;
        this.pushDiagnostic(exchange, "heartbeat", rawType || "market heartbeat");
      } else {
        this.onStatus(this.sourceSnapshot());
      }
    }

    noteParseError(exchange, message) {
      const source = this.sources[exchange];
      if (!source) return;
      source.status = {
        ...source.status,
        parseErrorCount: (Number(source.status.parseErrorCount) || 0) + 1,
        lastError: String(message || "parse error").slice(0, 120),
      };
      this.pushDiagnostic(exchange, "parse-error", source.status.lastError, "warn");
    }

    ingest(event) {
      if (!event || event.symbol !== this.symbol || !this.rememberId(event.id)) return;
      event.bucketPrice = roundPriceToBucket(event.price, this.bucketSize);
      this.events.push(event);
      this.events.sort((a, b) => Number(a.ts) - Number(b.ts));
      this.pruneEvents();
      if (!event.isTest) {
        const source = this.sources[event.exchange];
        this.setSourceStatus(event.exchange, {
          status: "realtime",
          lastEventAt: Number(event.ts) || Date.now(),
          eventCount: (Number(source && source.status.eventCount) || 0) + 1,
          lastError: "",
          reconnectAt: 0,
        });
        this.saveCache();
      }
      this.publish();
    }

    ingestMany(events) {
      for (const ev of events || []) this.ingest(ev);
    }

    getSnapshot(opts) {
      const bucketSize = Number(opts && opts.bucketSize) || this.bucketSize;
      this.pruneEvents();
      const filtered = filterEvents(this.events, opts);
      const eventsDesc = filtered.slice().sort((a, b) => Number(b.ts) - Number(a.ts));
      const realEvents = this.events.filter(isRealEvent);
      const testEvents = this.events.filter((ev) => ev && ev.isTest);
      return {
        symbol: this.symbol,
        events: eventsDesc,
        buckets: aggregateByPrice(filtered, bucketSize),
        stats: buildStats(filtered, this.sourceSnapshot()),
        sources: this.sourceSnapshot(),
        diagnostics: this.diagnosticSnapshot(),
        totalCached: realEvents.length,
        testCount: testEvents.length,
        latestRealEvent: this.latestRealEvent(),
        cacheRetentionMs: this.cacheRetentionMs,
      };
    }

    publish() {
      this.onUpdate(this.getSnapshot({ bucketSize: this.bucketSize }));
    }

    start() {
      this.closedByUser = false;
      this.loadCache();
      this.publish();
      this.startWatchdog();
      this.connectBinance();
      this.connectBinanceProbe();
      this.connectBybit();
    }

    stop(markClosed) {
      this.closedByUser = markClosed !== false;
      this.saveCache();
      for (const exchange of Object.keys(this.sources)) {
        const source = this.sources[exchange];
        if (source.reconnectTimer) clearTimeout(source.reconnectTimer);
        if (source.pingTimer) clearInterval(source.pingTimer);
        if (source.probeReconnectTimer) clearTimeout(source.probeReconnectTimer);
        source.reconnectTimer = null;
        source.pingTimer = null;
        source.probeReconnectTimer = null;
        if (source.ws) {
          try {
            source.ws.onopen = source.ws.onmessage = source.ws.onerror = source.ws.onclose = null;
            source.ws.close();
          } catch (_) {}
          source.ws = null;
        }
        if (source.probeWs) {
          try {
            source.probeWs.onopen = source.probeWs.onmessage = source.probeWs.onerror = source.probeWs.onclose = null;
            source.probeWs.close();
          } catch (_) {}
          source.probeWs = null;
        }
        source.status = nowStatus(exchange, { status: "idle" });
      }
      this.stopWatchdog();
      this.onStatus(this.sourceSnapshot());
    }

    startWatchdog() {
      if (this.watchdogTimer) return;
      this.watchdogTimer = setInterval(() => this.checkStaleSources(), WATCHDOG_MS);
    }

    stopWatchdog() {
      if (this.watchdogTimer) clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }

    checkStaleSources() {
      if (this.closedByUser) return;
      const now = Date.now();
      this.checkOneSourceStale("binance", BINANCE_STALE_MS, now);
      this.checkOneSourceStale("bybit", BYBIT_STALE_MS, now);
    }

    checkOneSourceStale(exchange, staleMs, now) {
      const source = this.sources[exchange];
      if (!source || !source.ws || source.reconnectTimer) return;
      const st = source.status || {};
      const ready = typeof WebSocket !== "undefined" ? source.ws.readyState : 3;
      if (ready !== WebSocket.OPEN || st.status !== "realtime") return;
      const last = Number(st.lastHeartbeatAt || st.lastMessageAt || st.lastEventAt || st.connectedAt || 0);
      if (!last || now - last < staleMs) return;
      this.setSourceStatus(exchange, {
        status: "error",
        lastError: `WS stale: ${Math.round((now - last) / 1000)}s no message`,
      });
      try { source.ws.close(); } catch (_) {}
    }

    clearCache() {
      this.events = [];
      this.resetSeen();
      try {
        if (global.localStorage) global.localStorage.removeItem(this.cacheKey());
      } catch (_) {}
      this.publish();
    }

    scheduleReconnect(exchange, connectFn) {
      const source = this.sources[exchange];
      if (!source || this.closedByUser || source.reconnectTimer) return;
      const reconnectAt = Date.now() + RECONNECT_MS;
      this.setSourceStatus(exchange, {
        status: "reconnecting",
        reconnectAt,
        reconnectCount: (Number(source.status.reconnectCount) || 0) + 1,
      });
      source.reconnectTimer = setTimeout(() => {
        source.reconnectTimer = null;
        if (!this.closedByUser) connectFn.call(this);
      }, RECONNECT_MS);
    }

    scheduleProbeReconnect(exchange, connectFn) {
      const source = this.sources[exchange];
      if (!source || this.closedByUser || source.probeReconnectTimer) return;
      source.probeReconnectTimer = setTimeout(() => {
        source.probeReconnectTimer = null;
        if (!this.closedByUser) connectFn.call(this);
      }, RECONNECT_MS);
    }

    connectBinance() {
      if (typeof WebSocket === "undefined") {
        this.setSourceStatus("binance", { status: "unavailable", lastError: "WebSocket unavailable" });
        return;
      }
      const source = this.sources.binance;
      const url = "wss://fstream.binance.com/market/ws/!forceOrder@arr";
      this.setSourceStatus("binance", { status: "connecting", lastError: "" });
      try {
        source.ws = new WebSocket(url);
      } catch (e) {
        this.setSourceStatus("binance", { status: "error", lastError: e && e.message ? e.message : String(e) });
        this.scheduleReconnect("binance", this.connectBinance);
        return;
      }
      const ws = source.ws;
      ws.onopen = () => {
        if (ws !== source.ws) return;
        this.setSourceStatus("binance", { status: "realtime", connectedAt: Date.now(), lastError: "" });
        this.pushDiagnostic("binance", "open", "all-market forceOrder opened");
      };
      ws.onmessage = (ev) => {
        if (ws !== source.ws) return;
        try {
          const event = normalizeBinance(JSON.parse(ev.data));
          const patch = event && event.symbol !== this.symbol
            ? { ignoredCount: (Number(source.status.ignoredCount) || 0) + 1 }
            : {};
          this.touchSourceMessage("binance", patch);
          this.ingest(event);
        } catch (e) {
          this.noteParseError("binance", e && e.message ? e.message : String(e));
        }
      };
      ws.onerror = () => {
        if (ws !== source.ws) return;
        this.setSourceStatus("binance", { status: "error", lastError: "WS error" });
        try { ws.close(); } catch (_) {}
      };
      ws.onclose = () => {
        if (ws !== source.ws) return;
        source.ws = null;
        if (this.closedByUser) return;
        this.pushDiagnostic("binance", "close", "all-market forceOrder closed", "warn");
        this.scheduleReconnect("binance", this.connectBinance);
      };
    }

    connectBinanceProbe() {
      if (typeof WebSocket === "undefined") return;
      const source = this.sources.binance;
      const sym = this.symbol.toLowerCase();
      const url = `wss://fstream.binance.com/market/stream?streams=${sym}@aggTrade/${sym}@forceOrder`;
      try {
        source.probeWs = new WebSocket(url);
      } catch (e) {
        this.pushDiagnostic("binance", "probe-error", e && e.message ? e.message : String(e), "warn");
        this.scheduleProbeReconnect("binance", this.connectBinanceProbe);
        return;
      }
      const ws = source.probeWs;
      ws.onopen = () => {
        if (ws !== source.probeWs) return;
        this.pushDiagnostic("binance", "probe-open", "aggTrade + single forceOrder opened");
      };
      ws.onmessage = (ev) => {
        if (ws !== source.probeWs) return;
        try {
          const msg = JSON.parse(ev.data);
          const stream = String(msg.stream || "");
          const data = msg.data || msg;
          if (stream.endsWith("@aggTrade") || data.e === "aggTrade") {
            this.touchSourceHeartbeat("binance", "aggTrade");
            return;
          }
          if (stream.endsWith("@forceOrder") || data.e === "forceOrder") {
            this.touchSourceMessage("binance", { lastRawType: "single forceOrder" });
            this.ingest(normalizeBinance(data));
          }
        } catch (e) {
          this.noteParseError("binance", e && e.message ? e.message : String(e));
        }
      };
      ws.onerror = () => {
        if (ws !== source.probeWs) return;
        this.pushDiagnostic("binance", "probe-error", "aggTrade/forceOrder probe error", "warn");
        try { ws.close(); } catch (_) {}
      };
      ws.onclose = () => {
        if (ws !== source.probeWs) return;
        source.probeWs = null;
        if (this.closedByUser) return;
        this.pushDiagnostic("binance", "probe-close", "aggTrade/forceOrder probe closed", "warn");
        this.scheduleProbeReconnect("binance", this.connectBinanceProbe);
      };
    }

    connectBybit() {
      if (typeof WebSocket === "undefined") {
        this.setSourceStatus("bybit", { status: "unavailable", lastError: "WebSocket unavailable" });
        return;
      }
      const source = this.sources.bybit;
      const url = "wss://stream.bybit.com/v5/public/linear";
      this.setSourceStatus("bybit", { status: "connecting", lastError: "" });
      try {
        source.ws = new WebSocket(url);
      } catch (e) {
        this.setSourceStatus("bybit", { status: "error", lastError: e && e.message ? e.message : String(e) });
        this.scheduleReconnect("bybit", this.connectBybit);
        return;
      }
      const ws = source.ws;
      ws.onopen = () => {
        if (ws !== source.ws) return;
        this.setSourceStatus("bybit", { status: "realtime", connectedAt: Date.now(), lastError: "" });
        this.pushDiagnostic("bybit", "open", "public linear stream opened");
        try {
          ws.send(JSON.stringify({
            op: "subscribe",
            args: [`allLiquidation.${this.symbol}`, `liquidation.${this.symbol}`, `tickers.${this.symbol}`],
          }));
        } catch (_) {}
        source.pingTimer = setInterval(() => {
          if (ws !== source.ws || ws.readyState !== WebSocket.OPEN) return;
          try { ws.send(JSON.stringify({ op: "ping" })); } catch (_) {}
        }, BYBIT_PING_MS);
      };
      ws.onmessage = (ev) => {
        if (ws !== source.ws) return;
        try {
          const msg = JSON.parse(ev.data);
          const rawType = String(msg.topic || msg.op || msg.type || "");
          if (/^tickers\./.test(rawType)) {
            this.touchSourceHeartbeat("bybit", "ticker");
            return;
          }
          this.touchSourceMessage("bybit", { lastRawType: rawType || "control" });
          if (msg.op === "pong" || msg.ret_msg === "pong") {
            this.touchSourceHeartbeat("bybit", "pong");
            return;
          }
          const rows = normalizeBybit(msg);
          if (rows.length) this.ingestMany(rows);
          const legacyRows = normalizeBybitLegacy(msg);
          if (legacyRows.length) {
            this.setSourceStatus("bybit", {
              lastLegacyEventAt: Math.max(...legacyRows.map((row) => Number(row.ts) || 0)),
              legacyEventCount: (Number(source.status.legacyEventCount) || 0) + legacyRows.length,
            });
            this.ingestMany(legacyRows);
          }
        } catch (e) {
          this.noteParseError("bybit", e && e.message ? e.message : String(e));
        }
      };
      ws.onerror = () => {
        if (ws !== source.ws) return;
        this.setSourceStatus("bybit", { status: "error", lastError: "WS error" });
        try { ws.close(); } catch (_) {}
      };
      ws.onclose = () => {
        if (ws !== source.ws) return;
        if (source.pingTimer) clearInterval(source.pingTimer);
        source.pingTimer = null;
        source.ws = null;
        if (this.closedByUser) return;
        this.pushDiagnostic("bybit", "close", "public linear stream closed", "warn");
        this.scheduleReconnect("bybit", this.connectBybit);
      };
    }
  }

  global.LiquidationEngine = {
    DEFAULT_SYMBOL,
    DEFAULT_BUCKET_SIZE,
    DEFAULT_MAX_EVENTS,
    DEFAULT_CACHE_RETENTION_MS,
    storageKey,
    roundPriceToBucket,
    normalizeBinance,
    normalizeBybit,
    normalizeBybitLegacy,
    filterEvents,
    aggregateByPrice,
    buildStats,
    LiquidationStream,
  };
})(typeof window !== "undefined" ? window : globalThis);
