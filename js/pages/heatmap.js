/* =======================================================
   Liquidation heatmap page
   ======================================================= */

const HEATMAP_SYMBOL = "BTCUSDT";
const HEATMAP_STATE_KEY = "bitdesk.heatmap.settings";
const HEATMAP_STATE_VERSION = 2;
const HEATMAP_CLOUD_POLL_MS = 5_000;
const HEATMAP_CLOUD_STALE_MS = 2 * 60 * 1000;
let heatmapStream = null;
let heatmapRefreshTimer = null;
let heatmapCloudTimer = null;
let heatmapCloudStatus = null;
let heatmapCloudBuckets = null;
const HEATMAP_PRESSURE_POLL_MS = 15_000;
let heatmapPressurePayload = null;
let heatmapPressureKlines = null;
let heatmapPressureStatus = { loading: false, derivError: "", klinesError: "", updatedAt: null };
let heatmapPressureTimer = null;
let heatmapPressureInFlight = false;
let heatmapAutoWindowPromoted = false;

function heatmapD1RangeForWindow(windowValue) {
  const w = String(windowValue || "24h");
  if (w === "all") return "30d";
  if (w === "24h") return "24h";
  return "7d";
}

function defaultHeatmapState() {
  return {
    bucketSize: 50,
    window: "24h",
    minNotional: 0,
  };
}

function readHeatmapState() {
  const d = defaultHeatmapState();
  try {
    const raw = localStorage.getItem(HEATMAP_STATE_KEY);
    if (!raw) return d;
    const parsed = JSON.parse(raw);
    const allowedWindows = ["5m", "15m", "60m", "24h", "all"];
    const savedWindow = allowedWindows.includes(parsed.window) ? parsed.window : d.window;
    const legacyDefaultWindow =
      parsed.version == null &&
      (parsed.window == null || parsed.window === "15m");
    return {
      bucketSize: [10, 25, 50, 100].includes(Number(parsed.bucketSize)) ? Number(parsed.bucketSize) : d.bucketSize,
      window: legacyDefaultWindow ? d.window : savedWindow,
      minNotional: Math.max(0, Number(parsed.minNotional) || 0),
    };
  } catch (_) {
    return d;
  }
}

function writeHeatmapState(state) {
  try {
    localStorage.setItem(HEATMAP_STATE_KEY, JSON.stringify({ ...state, version: HEATMAP_STATE_VERSION }));
  } catch (_) {}
}

function fmtHmMoney(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function fmtHmPrice(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return n >= 1000 ? n.toFixed(0) : n.toFixed(2);
}

function fmtHmTime(t) {
  if (!Number.isFinite(Number(t))) return "--";
  return new Date(Number(t)).toLocaleTimeString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtHmAge(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return "--";
  if (n < 60_000) return `${Math.round(n / 1000)}秒前`;
  if (n < 60 * 60_000) return `${Math.round(n / 60_000)}分钟前`;
  return `${Math.round(n / (60 * 60_000))}小时前`;
}

function heatmapWindowMs(windowValue) {
  if (windowValue === "5m") return 5 * 60 * 1000;
  if (windowValue === "15m") return 15 * 60 * 1000;
  if (windowValue === "60m") return 60 * 60 * 1000;
  if (windowValue === "24h") return 24 * 60 * 60 * 1000;
  return 0;
}

function heatmapWindowLabel(windowValue) {
  if (windowValue === "5m") return "5 分钟";
  if (windowValue === "15m") return "15 分钟";
  if (windowValue === "60m") return "60 分钟";
  if (windowValue === "24h") return "24 小时";
  return "30天 D1";
}

function currentHeatmapStateFromDom() {
  const current = readHeatmapState();
  const bucket = document.getElementById("hm-bucket-size");
  const win = document.getElementById("hm-window");
  const min = document.getElementById("hm-min-notional");
  return {
    bucketSize: bucket ? Number(bucket.value) || current.bucketSize : current.bucketSize,
    window: win ? win.value : current.window,
    minNotional: min ? Math.max(0, Number(min.value) || 0) : current.minNotional,
  };
}

function heatmapSnapshot() {
  const state = currentHeatmapStateFromDom();
  if (!heatmapStream || typeof heatmapStream.getSnapshot !== "function") {
    return {
      symbol: HEATMAP_SYMBOL,
      events: [],
      buckets: [],
      stats: { total5m: 0, total15m: 0, longNotional: 0, shortNotional: 0, maxEvent: null, activeSources: 0 },
      sources: {},
      totalCached: 0,
      testCount: 0,
      latestRealEvent: null,
      diagnostics: [],
    };
  }
  return heatmapStream.getSnapshot({
    bucketSize: state.bucketSize,
    windowMs: heatmapWindowMs(state.window),
    minNotional: state.minNotional,
  });
}

function pageHeatmap() {
  const state = readHeatmapState();
  const bucketOptions = [10, 25, 50, 100]
    .map((v) => `<option value="${v}" ${v === state.bucketSize ? "selected" : ""}>${v} USDT</option>`)
    .join("");
  const windowOptions = [
    ["5m", "5 分钟"],
    ["15m", "15 分钟"],
    ["60m", "60 分钟"],
    ["24h", "24 小时"],
    ["all", "30天 D1"],
  ].map(([v, label]) => `<option value="${v}" ${v === state.window ? "selected" : ""}>${label}</option>`).join("");

  return html`
    <section class="heatmap-status-strip" aria-label="强平雷达状态">
      <div class="heatmap-status-main">
        <span class="heatmap-feed-dot" aria-hidden="true"></span>
        <strong>${HEATMAP_SYMBOL} 已实现强平</strong>
        <span>desk 分所桶 · 禁止跨所合计 · 未知来源不得写成 Binance</span>
      </div>
      <div class="heatmap-status-actions">
        <span class="chip warn" id="hm-live-chip">分所已实现强平</span>
        <a class="owner-link heatmap-owner-link" href="#/agent-flow" title="查看 盘口流动性官 的演示原型">
          <span class="owner-dot" style="background:var(--agent-flow)">盘</span>
          <span>盘口流动性官</span>
          <span class="owner-arrow"><i class="ph ph-arrow-right"></i></span>
        </a>
        <a class="owner-link heatmap-owner-link" href="#/agent-risk" title="查看 风控官 的演示原型">
          <span class="owner-dot" style="background:var(--agent-risk)">控</span>
          <span>风控官</span>
          <span class="owner-arrow"><i class="ph ph-arrow-right"></i></span>
        </a>
      </div>
    </section>

    <p class="muted" id="hm-research-evidence"></p>

    <div class="heatmap-toolbar">
      <label class="heatmap-field">
        <span>交易对</span>
        <strong>${HEATMAP_SYMBOL}</strong>
      </label>
      <label class="heatmap-field">
        <span>价位桶</span>
        <select id="hm-bucket-size">${bucketOptions}</select>
      </label>
      <label class="heatmap-field">
        <span>窗口</span>
        <select id="hm-window">${windowOptions}</select>
      </label>
      <label class="heatmap-field">
        <span>最小金额</span>
        <input type="number" min="0" step="1000" id="hm-min-notional" value="${state.minNotional}" />
      </label>
      <span class="heatmap-status" id="hm-status">准备连接...</span>
    </div>

    <div class="heatmap-kpis" id="hm-venue-kpis">
      <div class="heatmap-kpi">
        <span>Bybit 已实现强平</span>
        <strong id="hm-kpi-bybit">--</strong>
        <em id="hm-kpi-bybit-note">分所名义金额，不可与币安比笔数</em>
      </div>
      <div class="heatmap-kpi">
        <span>Binance 已实现强平</span>
        <strong id="hm-kpi-binance">--</strong>
        <em id="hm-kpi-binance-note">仅当 desk 标了 binance</em>
      </div>
      <div class="heatmap-kpi">
        <span>未知来源</span>
        <strong id="hm-kpi-unknown-ex">--</strong>
        <em>不得默认写成 Binance</em>
      </div>
    </div>
    <div class="heatmap-compat-kpis" aria-hidden="true">
      <span id="hm-kpi-5m">--</span>
      <span id="hm-kpi-15m">--</span>
    </div>

    <section class="heatmap-cloud-window">
      <div class="heatmap-cloud-head">
        <div>
          <div class="card-title">分所时间窗（禁止跨所合计）</div>
        </div>
      </div>
      <div class="heatmap-cloud-grid">
        <div class="heatmap-cloud-card">
          <span>Bybit · 过去 1 小时</span>
          <strong id="hm-cloud-bybit-1h">--</strong>
          <em id="hm-cloud-bybit-1h-detail">仅 Bybit 已实现强平</em>
        </div>
        <div class="heatmap-cloud-card">
          <span>Bybit · 过去 1 天</span>
          <strong id="hm-cloud-bybit-1d">--</strong>
          <em id="hm-cloud-bybit-1d-detail">仅 Bybit 已实现强平</em>
        </div>
        <div class="heatmap-cloud-card">
          <span>Binance · 过去 1 小时</span>
          <strong id="hm-cloud-binance-1h">--</strong>
          <em id="hm-cloud-binance-1h-detail">仅 desk 标注 binance 的桶</em>
        </div>
        <div class="heatmap-cloud-card">
          <span>Binance · 过去 1 天</span>
          <strong id="hm-cloud-binance-1d">--</strong>
          <em id="hm-cloud-binance-1d-detail">仅 desk 标注 binance 的桶</em>
        </div>
      </div>
      <details class="heatmap-detail heatmap-cloud-detail">
        <summary>云端桶与口径详情</summary>
        <div class="heatmap-cloud-meta">
          <span id="hm-cloud-window-count">0 个 5m 桶</span>
          <em id="hm-cloud-window-note">等待 Cloudflare Collector 写入 5m 聚合桶</em>
        </div>
        <div class="heatmap-cloud-help">金额 = 已发生强平的名义金额（价格 × 数量，USDT 本位约等于 USD）；多/空 = 被强平的仓位方向；笔 = 交易所推送事件数。</div>
      </details>
    </section>

    <div class="heatmap-layout heatmap-dashboard-layout">
      <section class="heatmap-panel">
        <div class="heatmap-panel-head">
          <div>
            <div class="card-title">强平价位聚合</div>
            <div class="heatmap-panel-sub" id="hm-range-label">等待 desk 分所桶</div>
          </div>
          <div class="heatmap-legend">
            <span><i class="long"></i>多头被强平</span>
            <span><i class="short"></i>空头被强平</span>
          </div>
        </div>
        <div class="heatmap-buckets" id="hm-buckets">
          <div class="heatmap-empty">等待 desk 分所强平桶...</div>
        </div>
      </section>

      <aside class="heatmap-side-rail">
        <section class="heatmap-health-card warn" id="hm-health-card" aria-label="分所说明">
          <div class="card-title">分所说明</div>
          <strong id="hm-health-status">压力矩阵本轮不上屏</strong>
          <span id="hm-health-note">只展示已发生、已标注交易所的名义金额。禁止合计，禁止把未知来源写成 Binance。</span>
          <div class="heatmap-health-grid">
            <em id="hm-health-market">asKnownMode=system_observed</em>
            <em id="hm-health-event">强平 --</em>
            <em id="hm-health-buckets">窗口 --</em>
          </div>
        </section>

        <details class="heatmap-detail heatmap-source-detail">
          <summary>来源诊断</summary>
          <div class="heatmap-source-grid heatmap-source-strip" id="hm-sources"></div>
          <div class="heatmap-diagnostics" id="hm-diagnostics"></div>
        </details>
      </aside>
    </div>
  `;
}

function setHmText(id, text) {
  const node = document.getElementById(id);
  if (node) node.textContent = text;
}

function hmEsc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hmRealEvents(snapshot) {
  return (snapshot && Array.isArray(snapshot.events) ? snapshot.events : []).filter((ev) => ev && !ev.isTest);
}

function hmLatestRealLabel(snapshot) {
  const ev = snapshot && snapshot.latestRealEvent;
  if (!ev || !Number.isFinite(Number(ev.ts))) return "等待真实强平推送";
  const ageMs = Math.max(0, Date.now() - Number(ev.ts));
  const min = Math.floor(ageMs / 60000);
  if (min < 1) return `最近真实事件 ${fmtHmTime(ev.ts)}`;
  if (min < 60) return `最近真实事件 ${min} 分钟前`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `最近真实事件 ${hours} 小时前`;
  return `最近真实事件 ${Math.floor(hours / 24)} 天前`;
}

function hmDeskByExchange() {
  return heatmapCloudBuckets && heatmapCloudBuckets.byExchange && typeof heatmapCloudBuckets.byExchange === "object"
    ? heatmapCloudBuckets.byExchange
    : null;
}

function hmVenueNotional(ex) {
  const g = hmDeskByExchange() && hmDeskByExchange()[ex];
  if (!g) return 0;
  return (Number(g.longNotional) || 0) + (Number(g.shortNotional) || 0);
}

function renderHeatmapKpis(snapshot) {
  const by = heatmapCloudBuckets && heatmapCloudBuckets.byExchange ? heatmapCloudBuckets.byExchange : {};
  const bybit = by.bybit || { longNotional: 0, shortNotional: 0, buckets: [] };
  const binance = by.binance || { longNotional: 0, shortNotional: 0, buckets: [] };
  const unknown = by.unknown || { longNotional: 0, shortNotional: 0, buckets: [] };
  const bybitTotal = (Number(bybit.longNotional) || 0) + (Number(bybit.shortNotional) || 0);
  const binanceTotal = (Number(binance.longNotional) || 0) + (Number(binance.shortNotional) || 0);
  const unknownTotal = (Number(unknown.longNotional) || 0) + (Number(unknown.shortNotional) || 0);
  setHmText("hm-kpi-bybit", fmtHmMoney(bybitTotal));
  setHmText("hm-kpi-binance", fmtHmMoney(binanceTotal));
  setHmText("hm-kpi-unknown-ex", fmtHmMoney(unknownTotal));
  setHmText("hm-kpi-bybit-note", `多 ${fmtHmMoney(bybit.longNotional)} · 空 ${fmtHmMoney(bybit.shortNotional)}`);
  setHmText("hm-kpi-binance-note", `多 ${fmtHmMoney(binance.longNotional)} · 空 ${fmtHmMoney(binance.shortNotional)}`);
  const evidenceEl = document.getElementById("hm-research-evidence");
  if (evidenceEl) {
    evidenceEl.textContent = "分所已实现强平；禁止跨所合计；未知来源不得写成 Binance。";
  }
  renderHeatmapCloudWindows();
}

function renderHeatmapHealth(snapshot, displaySnapshot) {
  const card = document.getElementById("hm-health-card");
  if (card) card.className = "heatmap-health-card warn";
  const rows = Number(displaySnapshot && displaySnapshot.cloudWindowRows) || 0;
  const by = hmDeskByExchange() || {};
  const venues = Object.keys(by).filter((ex) => by[ex] && ((by[ex].buckets && by[ex].buckets.length) || by[ex].longNotional || by[ex].shortNotional));
  setHmText("hm-health-status", "压力矩阵本轮不上屏");
  setHmText("hm-health-note", "只展示已发生、已标注交易所的名义金额。禁止合计，禁止把未知来源写成 Binance。浏览器推送不是权威路径。");
  setHmText("hm-health-market", venues.length ? `desk 分所 ${venues.join(" / ")}` : "等待 desk 分所桶");
  setHmText("hm-health-event", snapshot && snapshot.error ? String(snapshot.error).slice(0, 80) : "不以浏览器连接充当在线");
  setHmText("hm-health-buckets", rows ? `${rows} 个 5m 桶` : "窗口 --");
}

function summarizeCloudBucketsForExchange(exchange, windowMs) {
  const rows = heatmapCloudBuckets && Array.isArray(heatmapCloudBuckets.buckets) ? heatmapCloudBuckets.buckets : [];
  const since = Date.now() - windowMs;
  const want = String(exchange || "").toLowerCase();
  const out = { longNotional: 0, shortNotional: 0, longCount: 0, shortCount: 0, buckets: 0, latest: 0 };
  for (const row of rows) {
    const ex = String(row.exchange || "").toLowerCase();
    if (ex !== want) continue;
    const t = Number(row.bucket_start);
    if (!Number.isFinite(t) || t < since) continue;
    out.longNotional += Number(row.long_notional) || 0;
    out.shortNotional += Number(row.short_notional) || 0;
    out.longCount += Number(row.long_count) || 0;
    out.shortCount += Number(row.short_count) || 0;
    out.buckets += 1;
    out.latest = Math.max(out.latest, t);
  }
  return out;
}

function summarizeCloudWindowValue(windowValue) {
  const windowMs = heatmapWindowMs(windowValue);
  if (windowMs > 0) return summarizeCloudBucketsForExchange("bybit", windowMs);
  return summarizeCloudBucketsForExchange("bybit", 30 * 24 * 60 * 60 * 1000);
}

function maybePromoteHeatmapWindowForCloudHistory() {
  if (heatmapAutoWindowPromoted || !hmCloudAvailable()) return;
  const win = document.getElementById("hm-window");
  if (!win || !["5m", "15m"].includes(String(win.value))) return;
  const currentRows = hmFilteredCloudRows(currentHeatmapStateFromDom());
  const day = summarizeCloudWindowValue("24h");
  const dayEvents = (Number(day.longCount) || 0) + (Number(day.shortCount) || 0);
  const dayTotal = (Number(day.longNotional) || 0) + (Number(day.shortNotional) || 0);
  if (currentRows.length <= 4 && (dayEvents >= 25 || dayTotal >= 1_000_000)) {
    win.value = "24h";
    writeHeatmapState(currentHeatmapStateFromDom());
    heatmapAutoWindowPromoted = true;
  }
}

function hmCloudAvailable() {
  return !!(heatmapCloudBuckets && !heatmapCloudBuckets.error && Array.isArray(heatmapCloudBuckets.buckets));
}

function hmCloudRows() {
  return heatmapCloudBuckets && Array.isArray(heatmapCloudBuckets.buckets) ? heatmapCloudBuckets.buckets : [];
}

function hmCloudFreshness() {
  if (heatmapCloudBuckets && heatmapCloudBuckets.freshness) return heatmapCloudBuckets.freshness;
  const collector = heatmapCloudStatus && heatmapCloudStatus.collector ? heatmapCloudStatus.collector : {};
  const sources = collector.sources || {};
  const generatedAt = Date.now();
  const sourceRows = Object.values(sources);
  const latestMessageAt = sourceRows.reduce((m, src) => Math.max(
    m,
    Number(src && src.lastMarketMessageAt) || 0,
    Number(src && src.lastEventAt) || 0
  ), 0);
  const latestEventAt = sourceRows.reduce((m, src) => Math.max(m, Number(src && src.lastEventAt) || 0), 0);
  const latestBucketStart = hmCloudRows().reduce((m, row) => Math.max(m, Number(row && row.bucket_start) || 0), 0);
  const latestPersistedEventAt = hmCloudRows().reduce((m, row) => Math.max(
    m,
    Number(row && row.updated_at) || 0,
    Number(row && row.bucket_start) || 0
  ), 0);
  const activeSources = sourceRows.filter((src) => {
    const last = Math.max(Number(src && src.lastMarketMessageAt) || 0, Number(src && src.lastEventAt) || 0);
    return src && src.status === "realtime" && last > 0 && generatedAt - last <= HEATMAP_CLOUD_STALE_MS;
  }).length;
  return {
    generatedAt,
    latestMessageAt,
    latestEventAt: Math.max(latestEventAt, latestPersistedEventAt),
    latestBucketStart,
    latestMessageAgeMs: latestMessageAt ? generatedAt - latestMessageAt : null,
    latestEventAgeMs: latestEventAt ? generatedAt - latestEventAt : null,
    latestBucketAgeMs: latestBucketStart ? generatedAt - latestBucketStart : null,
    activeSources,
    ok: activeSources > 0,
  };
}

function hmCloudSources() {
  if (heatmapCloudBuckets && heatmapCloudBuckets.sources) return heatmapCloudBuckets.sources;
  return heatmapCloudStatus && heatmapCloudStatus.collector && heatmapCloudStatus.collector.sources
    ? heatmapCloudStatus.collector.sources
    : {};
}

function hmCloudActiveSources() {
  const fresh = hmCloudFreshness();
  if (Number.isFinite(Number(fresh.activeSources))) return Number(fresh.activeSources);
  return Object.values(hmCloudSources()).filter((src) => src && src.status === "realtime").length;
}

function hmCloudIsFresh() {
  const fresh = hmCloudFreshness();
  const age = Number(fresh.latestMessageAgeMs);
  return !!fresh.ok || (Number.isFinite(age) && age <= HEATMAP_CLOUD_STALE_MS);
}

function hmCloudRowTotal(row) {
  return (Number(row && row.long_notional) || 0) + (Number(row && row.short_notional) || 0);
}

function hmCloudRowPrice(row) {
  const vwap = Number(row && row.vwap_price);
  if (Number.isFinite(vwap) && vwap > 0) return vwap;
  const min = Number(row && row.min_price);
  const max = Number(row && row.max_price);
  if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > 0) return (min + max) / 2;
  if (Number.isFinite(max) && max > 0) return max;
  if (Number.isFinite(min) && min > 0) return min;
  return NaN;
}

function hmFilteredCloudRows(state) {
  const rows = hmCloudRows();
  const windowMs = heatmapWindowMs(state.window);
  const since = windowMs > 0 ? Date.now() - windowMs : 0;
  const minNotional = Math.max(0, Number(state.minNotional) || 0);
  return rows.filter((row) => {
    const t = Number(row && row.bucket_start);
    if (!Number.isFinite(t) || (since && t < since)) return false;
    if (hmCloudRowTotal(row) < minNotional) return false;
    return Number.isFinite(hmCloudRowPrice(row));
  });
}

function hmCloudAggregateByPrice(rows, bucketSize) {
  const out = new Map();
  const rounder = typeof LiquidationEngine !== "undefined" && typeof LiquidationEngine.roundPriceToBucket === "function"
    ? LiquidationEngine.roundPriceToBucket
    : (price, size) => Math.round((Number(price) || 0) / (Number(size) || 1)) * (Number(size) || 1);
  for (const row of rows || []) {
    const price = rounder(hmCloudRowPrice(row), bucketSize);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (!out.has(price)) {
      out.set(price, {
        price,
        longNotional: 0,
        shortNotional: 0,
        totalNotional: 0,
        count: 0,
        latestTs: 0,
        exchanges: {},
      });
    }
    const item = out.get(price);
    const exchange = String(row.exchange || "d1").toLowerCase();
    const longNotional = Number(row.long_notional) || 0;
    const shortNotional = Number(row.short_notional) || 0;
    const longCount = Number(row.long_count) || 0;
    const shortCount = Number(row.short_count) || 0;
    item.longNotional += longNotional;
    item.shortNotional += shortNotional;
    item.totalNotional += longNotional + shortNotional;
    item.count += longCount + shortCount;
    item.latestTs = Math.max(item.latestTs, Number(row.bucket_start) || 0);
    if (!item.exchanges[exchange]) item.exchanges[exchange] = { longNotional: 0, shortNotional: 0, count: 0 };
    item.exchanges[exchange].longNotional += longNotional;
    item.exchanges[exchange].shortNotional += shortNotional;
    item.exchanges[exchange].count += longCount + shortCount;
  }
  return [...out.values()].sort((a, b) => b.price - a.price);
}

function hmCloudStats(rows, sourceStats) {
  const now = Date.now();
  const stats = {
    total5m: 0,
    total15m: 0,
    longNotional: 0,
    shortNotional: 0,
    maxEvent: null,
    activeSources: sourceStats && Number(sourceStats.activeSources) ? Number(sourceStats.activeSources) : 0,
  };
  for (const row of rows || []) {
    const t = Number(row.bucket_start) || 0;
    const longNotional = Number(row.long_notional) || 0;
    const shortNotional = Number(row.short_notional) || 0;
    const total = longNotional + shortNotional;
    if (t >= now - 5 * 60 * 1000) stats.total5m += total;
    if (t >= now - 15 * 60 * 1000) stats.total15m += total;
    stats.longNotional += longNotional;
    stats.shortNotional += shortNotional;
    const maxNotional = Number(row.max_notional) || 0;
    if (maxNotional > 0 && (!stats.maxEvent || maxNotional > stats.maxEvent.notional)) {
      stats.maxEvent = { notional: maxNotional, positionSide: row.max_side || "", ts: t };
    }
  }
  return stats;
}

function hmDisplaySnapshot(snapshot) {
  const state = currentHeatmapStateFromDom();
  if (!hmCloudAvailable()) return { ...snapshot, aggregateSource: "live" };
  const cloudRows = hmFilteredCloudRows(state);
  const cloudBuckets = hmCloudAggregateByPrice(cloudRows, state.bucketSize);
  return {
    ...snapshot,
    buckets: cloudBuckets,
    stats: hmCloudStats(cloudRows, { activeSources: hmCloudActiveSources() }),
    aggregateSource: "d1",
    cloudWindowRows: cloudRows.length,
    cloudWindowEventCount: cloudRows.reduce((sum, row) => sum + (Number(row.long_count) || 0) + (Number(row.short_count) || 0), 0),
  };
}

function renderHeatmapCloudWindows() {
  const note = document.getElementById("hm-cloud-window-note");
  const count = document.getElementById("hm-cloud-window-count");
  const rows = hmCloudRows();
  const latest = rows.reduce((m, row) => Math.max(m, Number(row.bucket_start) || 0), 0);
  const activeCount = Number(heatmapCloudBuckets && heatmapCloudBuckets.activeCount) || rows.filter((row) => row && row.is_active).length;
  if (count) count.textContent = `${rows.length} 个 5m 桶${activeCount ? ` · ${activeCount} 个活跃桶` : ""}`;
  if (note) {
    if (heatmapCloudBuckets && heatmapCloudBuckets.error) {
      note.textContent = `D1 聚合读取失败：${heatmapCloudBuckets.error}`;
    } else if (!rows.length) {
      note.textContent = hmCloudIsFresh()
        ? "Cloudflare Collector 在线，当前窗口暂无已记录强平"
        : "D1 暂无强平聚合桶；等待 Collector 收到真实强平";
    } else {
      const fresh = hmCloudFreshness();
      const msgAge = Number.isFinite(Number(fresh.latestMessageAgeMs)) ? ` · 心跳 ${fmtHmAge(fresh.latestMessageAgeMs)}` : "";
      const eventAge = Number.isFinite(Number(fresh.latestEventAgeMs)) ? ` · 最新强平 ${fmtHmAge(fresh.latestEventAgeMs)}` : "";
      const state = currentHeatmapStateFromDom();
      note.textContent = `desk 分所桶 · 当前 ${heatmapWindowLabel(state.window)} · 最新 5m 桶 ${fmtHmTime(latest)}${msgAge}${eventAge}`;
    }
  }
  [
    ["bybit", "1h", 60 * 60 * 1000],
    ["bybit", "1d", 24 * 60 * 60 * 1000],
    ["binance", "1h", 60 * 60 * 1000],
    ["binance", "1d", 24 * 60 * 60 * 1000],
  ].forEach(([ex, id, ms]) => {
    const s = summarizeCloudBucketsForExchange(ex, ms);
    const total = (Number(s.longNotional) || 0) + (Number(s.shortNotional) || 0);
    setHmText(`hm-cloud-${ex}-${id}`, fmtHmMoney(total));
    setHmText(
      `hm-cloud-${ex}-${id}-detail`,
      `多 ${fmtHmMoney(s.longNotional)} · 空 ${fmtHmMoney(s.shortNotional)} · ${s.buckets} 桶`
    );
  });
}

function renderHeatmapBuckets(snapshot) {
  const wrap = document.getElementById("hm-buckets");
  const label = document.getElementById("hm-range-label");
  if (!wrap) return;
  const by = hmDeskByExchange();
  if (!by) {
    if (label) label.textContent = "等待 desk 分所桶";
    wrap.innerHTML = `<div class="heatmap-empty">主画布空：尚无 desk 分所强平。</div>`;
    return;
  }
  const venues = ["bybit", "binance", "unknown"].filter((ex) => by[ex] && ((by[ex].buckets && by[ex].buckets.length) || by[ex].longNotional || by[ex].shortNotional));
  if (label) label.textContent = venues.length ? `分所：${venues.join(" / ")}` : "desk 无分所桶";
  if (!venues.length) {
    wrap.innerHTML = `<div class="heatmap-empty">当前窗口无已标注交易所的已实现强平。</div>`;
    return;
  }
  wrap.innerHTML = venues.map((ex) => {
    const g = by[ex];
    const title = ex === "unknown" ? "未知来源（不得写成 Binance）" : ex;
    return `<div class="heatmap-venue-block"><h3>${hmEsc(title)}</h3>
      <p>多 ${fmtHmMoney(g.longNotional)} · 空 ${fmtHmMoney(g.shortNotional)} · ${Array.isArray(g.buckets) ? g.buckets.length : 0} 个 5m 桶</p></div>`;
  }).join("");
}

function hmSourceLabel(exchange) {
  if (exchange === "cloudflare") return "Cloudflare";
  if (exchange === "bybit") return "Bybit";
  if (exchange === "binance") return "Binance";
  return "未知来源";
}

function hmStatusText(status) {
  const s = String(status || "idle");
  if (s === "realtime") return "已连接";
  if (s === "connecting") return "连接中";
  if (s === "reconnecting") return "重连等待";
  if (s === "error") return "错误";
  if (s === "unavailable") return "不可用";
  return "未连接";
}

function hmSourceActivityNote(exchange, src) {
  if (!src) return "等待连接";
  if (src.lastError) return src.lastError;
  if (src.reconnectAt) return `预计 ${fmtHmTime(src.reconnectAt)} 重连`;
  if (src.lastEventAt) return "收到 BTCUSDT 真实强平推送";
  if (src.lastMessageAt) {
    if (exchange === "binance") {
      return `全市场强平流活跃，已过滤其它交易对 ${Number(src.ignoredCount) || 0} 笔`;
    }
    return "订阅/心跳正常，等待 BTCUSDT 真实爆仓事件";
  }
  if (src.status === "realtime") return "WebSocket 已打开，等待首条消息";
  return "已订阅公共 WebSocket，等待真实爆仓事件";
}

function hmSourceCounts(src) {
  const msg = Number(src && src.messageCount) || 0;
  const hb = Number(src && src.heartbeatCount) || 0;
  const events = Number(src && src.eventCount) || 0;
  const legacy = Number(src && src.legacyEventCount) || 0;
  const errors = Number(src && src.parseErrorCount) || 0;
  return `消息 ${msg} · 心跳 ${hb} · 事件 ${events}${legacy ? ` · 旧 ${legacy}` : ""}${errors ? ` · 错 ${errors}` : ""}`;
}

function hmCloudCollectorCard() {
  const payload = heatmapCloudStatus || { loading: true };
  const collector = payload.collector || {};
  const sources = Object.keys(collector.sources || {}).length ? collector.sources : hmCloudSources();
  const latestMsg = Math.max(
    Number(sources.binance && sources.binance.lastMarketMessageAt) || 0,
    Number(sources.binance && sources.binance.lastEventAt) || 0,
    Number(sources.bybit && sources.bybit.lastMarketMessageAt) || 0,
    Number(sources.bybit && sources.bybit.lastEventAt) || 0
  );
  const latestEvent = Math.max(
    Number(sources.binance && sources.binance.lastEventAt) || 0,
    Number(sources.bybit && sources.bybit.lastEventAt) || 0
  );
  const fresh = hmCloudFreshness();
  const ok = (!!payload.ok || hmCloudAvailable()) && !payload.error && hmCloudIsFresh();
  const cls = payload.loading ? "warn" : (ok ? "ok" : "off");
  const status = payload.loading ? "查询中" : (ok ? "desk 分所可读" : "desk 过期或缺失");
  const note = payload.error
    ? String(payload.error).slice(0, 120)
    : (ok
      ? `D1 ${Number(heatmapCloudBuckets && heatmapCloudBuckets.closedCount) || 0} 桶，活跃桶 ${Number(collector.activeBuckets || (heatmapCloudBuckets && heatmapCloudBuckets.activeCount)) || 0}`
      : `Collector 无新鲜市场数据${Number.isFinite(Number(fresh.latestMessageAgeMs)) ? `：${fmtHmAge(fresh.latestMessageAgeMs)}` : ""}`);
  return `
    <div class="heatmap-source-status ${cls}" title="${note}">
      <strong>Cloudflare</strong>
      <span>${status}</span>
      <em>市场 ${latestMsg ? fmtHmTime(latestMsg) : "--"}</em>
      <em>强平 ${latestEvent ? fmtHmTime(latestEvent) : "--"}</em>
      <em>活跃 ${Number(collector.activeBuckets || (heatmapCloudBuckets && heatmapCloudBuckets.activeCount)) || 0} 桶</em>
    </div>
  `;
}

function renderHeatmapSources(snapshot) {
  const wrap = document.getElementById("hm-sources");
  if (!wrap) return;
  const sources = snapshot.sources || {};
  const exchangeCards = ["binance", "bybit"].map((exchange) => {
    const src = sources[exchange] || { status: "idle", lastEventAt: 0, lastError: "" };
    const cls = src.status === "realtime" ? "ok" : (src.status === "connecting" || src.status === "reconnecting" ? "warn" : "off");
    const last = src.lastEventAt ? fmtHmTime(src.lastEventAt) : "--";
    const heartbeatLast = src.lastHeartbeatAt ? fmtHmTime(src.lastHeartbeatAt) : "--";
    const note = hmSourceActivityNote(exchange, src);
    return `
      <div class="heatmap-source-status ${cls}" title="${note}">
        <strong>${hmSourceLabel(exchange)}</strong>
        <span>${hmStatusText(src.status)}</span>
        <em>心跳 ${heartbeatLast}</em>
        <em>强平 ${last}</em>
        <em>${hmSourceCounts(src)}</em>
      </div>
    `;
  }).join("");
  wrap.innerHTML = exchangeCards + hmCloudCollectorCard();
}

function renderHeatmapDiagnostics(snapshot) {
  const wrap = document.getElementById("hm-diagnostics");
  if (!wrap) return;
  const rows = Array.isArray(snapshot && snapshot.diagnostics) ? snapshot.diagnostics.slice(0, 10) : [];
  const extras = [];
  if (hmCloudAvailable()) {
    const state = currentHeatmapStateFromDom();
    const cloudRows = hmFilteredCloudRows(state);
    extras.push({
      ts: Date.now(),
      exchange: "cloudflare",
      kind: "desk",
      detail: `desk 分所桶 ${cloudRows.length} 个；禁止跨所合计；浏览器推送不是权威路径`,
      level: hmCloudIsFresh() ? "info" : "warn",
    });
  }
  const allRows = extras.concat(rows).slice(0, 10);
  if (!allRows.length) {
    wrap.innerHTML = `<div class="heatmap-diagnostic-empty">等待 desk 分所诊断...</div>`;
    return;
  }
  wrap.innerHTML = allRows.map((row) => {
    const level = row.level === "warn" ? " warn" : "";
    return `
      <div class="heatmap-diagnostic-row${level}">
        <span>${fmtHmTime(row.ts)}</span>
        <strong>${hmEsc(hmSourceLabel(row.exchange))}</strong>
        <em>${hmEsc(row.kind)}</em>
        <b>${hmEsc(row.detail)}</b>
      </div>
    `;
  }).join("");
}

function hmLiveBucketsToLiquidationRows(buckets, state) {
  const windowMs = heatmapWindowMs(state.window);
  const since = windowMs > 0 ? Date.now() - windowMs : 0;
  return (buckets || [])
    .filter((b) => !since || (Number(b.latestTs) || 0) >= since)
    .map((b) => ({
      bucket_start: Number(b.latestTs) || Date.now(),
      long_notional: Number(b.longNotional) || 0,
      short_notional: Number(b.shortNotional) || 0,
      long_count: 0,
      short_count: Number(b.count) || 0,
      vwap_price: Number(b.price),
      min_price: Number(b.price),
      max_price: Number(b.price),
      exchange: "live",
    }));
}

function heatmapPressureLiquidationInput(displaySnapshot, state) {
  if (hmCloudAvailable()) return hmFilteredCloudRows(state);
  return hmLiveBucketsToLiquidationRows(displaySnapshot.buckets || [], state);
}

function renderHeatmapPressureMatrix(_displaySnapshot) {
  return;
}

async function refreshHeatmapPressureInputs(_force) {
  return;
}

function refreshHeatmapView(statusText) {
  const snapshot = heatmapSnapshot();
  const displaySnapshot = hmDisplaySnapshot(snapshot);
  renderHeatmapKpis(displaySnapshot);
  renderHeatmapBuckets(displaySnapshot);
  renderHeatmapHealth(snapshot, displaySnapshot);
  renderHeatmapSources(snapshot);
  renderHeatmapDiagnostics(snapshot);
  const chip = document.getElementById("hm-live-chip");
  if (chip) {
    chip.className = hmDeskByExchange() ? "chip warn" : "chip";
    chip.textContent = hmDeskByExchange() ? "分所已实现强平" : "等待 desk";
  }
  if (statusText) {
    setHmText("hm-status", statusText);
  } else if (hmDeskByExchange()) {
    const keys = Object.keys(hmDeskByExchange());
    setHmText("hm-status", keys.length ? `desk 分所：${keys.join(" / ")}` : "desk 无强平桶");
  } else {
    setHmText("hm-status", "等待 /api/desk/heatmap");
  }
}

function applyHeatmapState() {
  const state = currentHeatmapStateFromDom();
  writeHeatmapState(state);
  if (heatmapStream) heatmapStream.bucketSize = state.bucketSize;
  refreshHeatmapView();
}

function bindHeatmapControls() {
  const toolbar = document.querySelector(".heatmap-toolbar");
  if (!toolbar || toolbar.dataset.bound) return;
  toolbar.dataset.bound = "1";
  const bucket = document.getElementById("hm-bucket-size");
  const win = document.getElementById("hm-window");
  const min = document.getElementById("hm-min-notional");
  const onChange = () => applyHeatmapState();
  if (bucket) bucket.addEventListener("change", onChange);
  if (win) win.addEventListener("change", onChange);
  if (min) min.addEventListener("input", onChange);
}

async function refreshHeatmapCloudStatus(wake) {
  if (typeof DataEngine === "undefined") return;
  if (!heatmapCloudStatus) heatmapCloudStatus = { loading: true };
  refreshHeatmapView();
  try {
    if (typeof DataEngine.fetchDesk !== "function") throw new Error("desk 装配层不可用");
    const state = currentHeatmapStateFromDom();
    const desk = await DataEngine.fetchDesk("heatmap", {
      symbol: HEATMAP_SYMBOL,
      range: heatmapD1RangeForWindow(state.window),
    });
    heatmapCloudStatus = { ok: true, desk: true, asKnownMode: desk.asKnownMode };
    const buckets = [];
    const byExchange = desk.byExchange || {};
    Object.keys(byExchange).forEach((ex) => {
      const g = byExchange[ex] || {};
      (g.buckets || []).forEach((row) => buckets.push({ ...row, exchange: g.exchange || ex }));
    });
    heatmapCloudBuckets = {
      ...desk,
      buckets,
      byExchange,
      combinedTotalsForbidden: true,
    };
  } catch (e) {
    heatmapCloudStatus = {
      ok: false,
      error: e && e.message ? e.message : String(e),
    };
    heatmapCloudBuckets = {
      error: e && e.message ? e.message : String(e),
      buckets: [],
      byExchange: {},
    };
  }
  refreshHeatmapView();
}

function startHeatmapCloudPolling() {
  if (heatmapCloudTimer) clearInterval(heatmapCloudTimer);
  refreshHeatmapCloudStatus(false);
  heatmapCloudTimer = setInterval(() => refreshHeatmapCloudStatus(false), HEATMAP_CLOUD_POLL_MS);
}

function initHeatmap() {
  disposeHeatmap();
  bindHeatmapControls();
  heatmapStream = null;
  heatmapPressurePayload = null;
  heatmapPressureKlines = null;
  if (heatmapPressureTimer) {
    clearInterval(heatmapPressureTimer);
    heatmapPressureTimer = null;
  }
  startHeatmapCloudPolling();
  heatmapRefreshTimer = setInterval(() => refreshHeatmapView(), 5_000);
}

function disposeHeatmap() {
  if (heatmapRefreshTimer) {
    clearInterval(heatmapRefreshTimer);
    heatmapRefreshTimer = null;
  }
  if (heatmapCloudTimer) {
    clearInterval(heatmapCloudTimer);
    heatmapCloudTimer = null;
  }
  heatmapCloudStatus = null;
  heatmapCloudBuckets = null;
  if (heatmapPressureTimer) {
    clearInterval(heatmapPressureTimer);
    heatmapPressureTimer = null;
  }
  heatmapPressurePayload = null;
  heatmapPressureKlines = null;
  heatmapPressureStatus = { loading: false, derivError: "", klinesError: "", updatedAt: null };
  heatmapPressureInFlight = false;
  if (heatmapStream) {
    try {
      heatmapStream.stop(true);
    } catch (_) {}
    heatmapStream = null;
  }
  try {
    delete window.__bitDeskHeatmapDebugIngest;
  } catch (_) {
    window.__bitDeskHeatmapDebugIngest = undefined;
  }
}

window.__bitDeskDisposeHeatmap = disposeHeatmap;
