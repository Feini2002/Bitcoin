/* =======================================================
   Liquidation heatmap page
   ======================================================= */

const HEATMAP_SYMBOL = "BTCUSDT";
const HEATMAP_STATE_KEY = "bitdesk.heatmap.settings";
const HEATMAP_STATE_VERSION = 2;
const HEATMAP_CLOUD_POLL_MS = 30_000;
const HEATMAP_CLOUD_STALE_MS = 2 * 60 * 1000;
let heatmapStream = null;
let heatmapRefreshTimer = null;
let heatmapCloudTimer = null;
let heatmapCloudStatus = null;
let heatmapCloudBuckets = null;
const HEATMAP_PRESSURE_POLL_MS = 60_000;
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
        <strong>${HEATMAP_SYMBOL} 永续</strong>
        <span>Cloud D1 强平 5m 桶 · Binance / Bybit 强平流 · 东八区时间轴 · 前台 1 秒刷新 · 云端约 12 秒轮询</span>
      </div>
      <div class="heatmap-status-actions">
        <span class="chip ok" id="hm-live-chip">实时爆仓流</span>
        <a class="owner-link heatmap-owner-link" href="#/agent-flow" title="查看 盘口流动性官 的分析">
          <span class="owner-dot" style="background:var(--agent-flow)">盘</span>
          <span>盘口流动性官</span>
          <span class="owner-arrow"><i class="ph ph-arrow-right"></i></span>
        </a>
        <a class="owner-link heatmap-owner-link" href="#/agent-risk" title="查看 风控官 的分析">
          <span class="owner-dot" style="background:var(--agent-risk)">控</span>
          <span>风控官</span>
          <span class="owner-arrow"><i class="ph ph-arrow-right"></i></span>
        </a>
      </div>
    </section>

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

    <div class="heatmap-kpis">
      <div class="heatmap-kpi">
        <span>当前窗口强平</span>
        <strong id="hm-kpi-window-total">--</strong>
        <em id="hm-kpi-window-note">${heatmapWindowLabel(state.window)} · 等待数据</em>
      </div>
      <div class="heatmap-kpi" title="多头仓位被强平的名义金额合计，按成交价格 × 数量计算。"><span>多头被强平</span><strong class="down" id="hm-kpi-long">--</strong></div>
      <div class="heatmap-kpi" title="空头仓位被强平的名义金额合计，按成交价格 × 数量计算。"><span>空头被强平</span><strong class="up" id="hm-kpi-short">--</strong></div>
      <div class="heatmap-kpi">
        <span>最大单笔 / 来源</span>
        <strong id="hm-kpi-max">--</strong>
        <em>活跃来源 <b id="hm-kpi-sources">--</b></em>
      </div>
    </div>
    <div class="heatmap-compat-kpis" aria-hidden="true">
      <span id="hm-kpi-5m">--</span>
      <span id="hm-kpi-15m">--</span>
    </div>

    <section class="heatmap-cloud-window">
      <div class="heatmap-cloud-head">
        <div>
          <div class="card-title">云端强平窗口</div>
        </div>
      </div>
      <div class="heatmap-cloud-grid">
        <div class="heatmap-cloud-card" title="该窗口内多头被强平金额 + 空头被强平金额。">
          <span>过去 5 分钟 · 强平名义金额</span>
          <strong id="hm-cloud-5m-total">--</strong>
          <em id="hm-cloud-5m-detail">多头被强平 -- · 空头被强平 -- · 0 笔事件</em>
        </div>
        <div class="heatmap-cloud-card" title="该窗口内多头被强平金额 + 空头被强平金额。">
          <span>过去 15 分钟 · 强平名义金额</span>
          <strong id="hm-cloud-15m-total">--</strong>
          <em id="hm-cloud-15m-detail">多头被强平 -- · 空头被强平 -- · 0 笔事件</em>
        </div>
        <div class="heatmap-cloud-card" title="该窗口内多头被强平金额 + 空头被强平金额。">
          <span>过去 1 小时 · 强平名义金额</span>
          <strong id="hm-cloud-1h-total">--</strong>
          <em id="hm-cloud-1h-detail">多头被强平 -- · 空头被强平 -- · 0 笔事件</em>
        </div>
        <div class="heatmap-cloud-card" title="该窗口内多头被强平金额 + 空头被强平金额。">
          <span>过去 1 天 · 强平名义金额</span>
          <strong id="hm-cloud-1d-total">--</strong>
          <em id="hm-cloud-1d-detail">多头被强平 -- · 空头被强平 -- · 0 笔事件</em>
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
            <div class="heatmap-panel-sub" id="hm-range-label">等待实时爆仓事件</div>
          </div>
          <div class="heatmap-legend">
            <span><i class="long"></i>多头被强平</span>
            <span><i class="short"></i>空头被强平</span>
          </div>
        </div>
        <div class="heatmap-buckets" id="hm-buckets">
          <div class="heatmap-empty">等待 Binance / Bybit 推送爆仓事件...</div>
        </div>
      </section>

      <aside class="heatmap-side-rail">
        <section class="heatmap-pressure" id="hm-pressure-section" aria-label="估算压力矩阵">
          <div class="heatmap-pressure-head">
            <div>
              <div class="card-title">估算压力矩阵</div>
              <div class="heatmap-panel-sub" id="hm-pressure-sub">结合 OI / Funding / 价格偏离与窗口内已发生强平；非「潜在清算池」口径。</div>
            </div>
            <span class="chip warn" id="hm-pressure-chip">加载中</span>
          </div>
          <div class="heatmap-pressure-summary" id="hm-pressure-summary"></div>
          <details class="heatmap-detail">
            <summary>查看情景因子</summary>
            <div class="heatmap-pressure-matrix" id="hm-pressure-matrix"></div>
            <div class="heatmap-pressure-warnings" id="hm-pressure-warnings"></div>
          </details>
          <div class="heatmap-pressure-footnote">仅供风险视角，不作为独立交易触发器；不输出精确清算簇金额。</div>
        </section>

        <section class="heatmap-health-card ok" id="hm-health-card" aria-label="来源健康摘要">
          <div class="card-title">来源健康</div>
          <strong id="hm-health-status">等待连接</strong>
          <span id="hm-health-note">Cloudflare / 本页实时流状态准备中</span>
          <div class="heatmap-health-grid">
            <em id="hm-health-market">心跳 --</em>
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

function renderHeatmapKpis(snapshot) {
  const stats = snapshot.stats || {};
  const totalWindow = (Number(stats.longNotional) || 0) + (Number(stats.shortNotional) || 0);
  const state = currentHeatmapStateFromDom();
  setHmText("hm-kpi-5m", fmtHmMoney(stats.total5m));
  setHmText("hm-kpi-15m", fmtHmMoney(stats.total15m));
  setHmText("hm-kpi-window-total", fmtHmMoney(totalWindow));
  setHmText(
    "hm-kpi-window-note",
    `${heatmapWindowLabel(state.window)} · ${snapshot.aggregateSource === "d1" ? "D1 主链路" : "本页实时流"}`
  );
  setHmText("hm-kpi-long", fmtHmMoney(stats.longNotional));
  setHmText("hm-kpi-short", fmtHmMoney(stats.shortNotional));
  setHmText("hm-kpi-max", stats.maxEvent ? fmtHmMoney(stats.maxEvent.notional) : "--");
  setHmText("hm-kpi-sources", `${stats.activeSources || 0}/2`);
  renderHeatmapCloudWindows();
}

function renderHeatmapHealth(snapshot, displaySnapshot) {
  const card = document.getElementById("hm-health-card");
  const cloudPrimary = hmCloudAvailable();
  const cloudFresh = hmCloudIsFresh();
  const fresh = hmCloudFreshness();
  const sources = snapshot.sources || {};
  const anyRealtime = cloudPrimary ? cloudFresh : Object.values(sources).some((src) => src.status === "realtime");
  const cls = cloudPrimary
    ? (cloudFresh ? "ok" : "warn")
    : (anyRealtime ? "warn" : "off");
  if (card) card.className = `heatmap-health-card ${cls}`;
  if (cloudPrimary) {
    const rows = Number(displaySnapshot && displaySnapshot.cloudWindowRows) || 0;
    const eventCount = Number(displaySnapshot && displaySnapshot.cloudWindowEventCount) || 0;
    const latestEventAt = Number(fresh.latestEventAt) || 0;
    setHmText("hm-health-status", cloudFresh ? "Cloudflare 主链路在线" : "Cloudflare 主链路过期");
    setHmText("hm-health-note", cloudFresh ? "D1 聚合为主，本页实时流补充" : "市场心跳不新鲜，关注实时流兜底");
    setHmText(
      "hm-health-market",
      Number.isFinite(Number(fresh.latestMessageAgeMs)) ? `心跳 ${fmtHmAge(fresh.latestMessageAgeMs)}` : "心跳 --"
    );
    setHmText(
      "hm-health-event",
      latestEventAt ? `强平 ${fmtHmAge(Date.now() - latestEventAt)}` : "强平 --"
    );
    setHmText("hm-health-buckets", `窗口 ${rows} 桶 / ${eventCount} 笔`);
    return;
  }
  const realEvents = hmRealEvents(snapshot);
  const sourceCount = Object.values(sources).filter((src) => src.status === "realtime").length;
  setHmText("hm-health-status", anyRealtime ? "本页实时流兜底" : "等待实时连接");
  setHmText("hm-health-note", hmLatestRealLabel(snapshot));
  setHmText("hm-health-market", `实时源 ${sourceCount}/2`);
  setHmText("hm-health-event", realEvents.length ? `${realEvents.length} 笔缓存` : "强平 --");
  setHmText("hm-health-buckets", `缓存 ${snapshot.totalCached || 0} 笔`);
}

function summarizeCloudBuckets(windowMs) {
  const rows = heatmapCloudBuckets && Array.isArray(heatmapCloudBuckets.buckets) ? heatmapCloudBuckets.buckets : [];
  const since = Date.now() - windowMs;
  const out = { longNotional: 0, shortNotional: 0, longCount: 0, shortCount: 0, buckets: 0, latest: 0 };
  for (const row of rows) {
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
  const rows = hmCloudRows();
  const windowMs = heatmapWindowMs(windowValue);
  if (windowMs > 0) return summarizeCloudBuckets(windowMs);
  const out = { longNotional: 0, shortNotional: 0, longCount: 0, shortCount: 0, buckets: 0, latest: 0 };
  for (const row of rows) {
    const t = Number(row.bucket_start);
    if (!Number.isFinite(t)) continue;
    out.longNotional += Number(row.long_notional) || 0;
    out.shortNotional += Number(row.short_notional) || 0;
    out.longCount += Number(row.long_count) || 0;
    out.shortCount += Number(row.short_count) || 0;
    out.buckets += 1;
    out.latest = Math.max(out.latest, t);
  }
  return out;
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
      note.textContent = `Cloudflare 主链路 · 当前 ${heatmapWindowLabel(state.window)} · D1 最新 5m 桶 ${fmtHmTime(latest)}${msgAge}${eventAge}`;
    }
  }
  [
    ["5m", summarizeCloudBuckets(5 * 60 * 1000)],
    ["15m", summarizeCloudBuckets(15 * 60 * 1000)],
    ["1h", summarizeCloudBuckets(60 * 60 * 1000)],
    ["1d", summarizeCloudBuckets(24 * 60 * 60 * 1000)],
  ].forEach(([id, s]) => {
    const total = s.longNotional + s.shortNotional;
    setHmText(`hm-cloud-${id}-total`, fmtHmMoney(total));
    setHmText(
      `hm-cloud-${id}-detail`,
      `多头被强平 ${fmtHmMoney(s.longNotional)} · 空头被强平 ${fmtHmMoney(s.shortNotional)} · ${s.longCount + s.shortCount} 笔事件`
    );
  });
}

function renderHeatmapBuckets(snapshot) {
  const wrap = document.getElementById("hm-buckets");
  const label = document.getElementById("hm-range-label");
  if (!wrap) return;
  const rows = (snapshot.buckets || [])
    .slice()
    .sort((a, b) => b.totalNotional - a.totalNotional)
    .slice(0, 40)
    .sort((a, b) => b.price - a.price);
  if (label) {
    const realInWindow = hmRealEvents(snapshot).length;
    const state = currentHeatmapStateFromDom();
    const aggregateText = snapshot.aggregateSource === "d1"
      ? `D1 聚合 ${snapshot.cloudWindowRows || 0} 个 5m 桶 / ${snapshot.cloudWindowEventCount || 0} 笔`
      : `窗口内真实 ${realInWindow} 笔`;
    const day = hmCloudAvailable() ? summarizeCloudWindowValue("24h") : null;
    const dayEvents = day ? (Number(day.longCount) || 0) + (Number(day.shortCount) || 0) : 0;
    const historyHint =
      hmCloudAvailable() &&
      state.window !== "24h" &&
      state.window !== "all" &&
      dayEvents > Number(snapshot.cloudWindowEventCount || 0)
        ? ` · 24小时 ${dayEvents} 笔`
        : "";
    label.textContent = rows.length
      ? `${rows.length} 个价位桶 · 当前 ${heatmapWindowLabel(state.window)} · ${aggregateText}${historyHint}`
      : `窗口内暂无真实事件`;
  }
  if (!rows.length) {
    const state = currentHeatmapStateFromDom();
    const day = hmCloudAvailable() ? summarizeCloudWindowValue("24h") : null;
    const dayEvents = day ? (Number(day.longCount) || 0) + (Number(day.shortCount) || 0) : 0;
    const hint = dayEvents && state.window !== "24h" && state.window !== "all"
      ? `当前 ${heatmapWindowLabel(state.window)} 暂无符合条件的强平；24小时 D1 仍有 ${dayEvents} 笔。`
      : "等待符合当前过滤条件的爆仓事件...";
    wrap.innerHTML = `<div class="heatmap-empty">${hint}</div>`;
    return;
  }
  const maxSide = Math.max(
    1,
    ...rows.map((row) => Math.max(Number(row.longNotional) || 0, Number(row.shortNotional) || 0))
  );
  wrap.innerHTML = rows.map((row) => {
    const longPct = Math.max(2, Math.round((row.longNotional / maxSide) * 100));
    const shortPct = Math.max(2, Math.round((row.shortNotional / maxSide) * 100));
    const binance = row.exchanges.binance || { longNotional: 0, shortNotional: 0, count: 0 };
    const bybit = row.exchanges.bybit || { longNotional: 0, shortNotional: 0, count: 0 };
    const title = [
      `价位 ${fmtHmPrice(row.price)}`,
      `多头被强平 ${fmtHmMoney(row.longNotional)}`,
      `空头被强平 ${fmtHmMoney(row.shortNotional)}`,
      `Binance ${fmtHmMoney(binance.longNotional + binance.shortNotional)} / ${binance.count}笔`,
      `Bybit ${fmtHmMoney(bybit.longNotional + bybit.shortNotional)} / ${bybit.count}笔`,
    ].join(" | ");
    return `
      <div class="heatmap-price-row" title="${title}">
        <div class="heatmap-bar-cell left">
          <span class="heatmap-bar long" style="width:${longPct}%"></span>
          <em>${row.longNotional ? fmtHmMoney(row.longNotional) : ""}</em>
        </div>
        <div class="heatmap-price">${fmtHmPrice(row.price)}</div>
        <div class="heatmap-bar-cell right">
          <span class="heatmap-bar short" style="width:${shortPct}%"></span>
          <em>${row.shortNotional ? fmtHmMoney(row.shortNotional) : ""}</em>
        </div>
      </div>
    `;
  }).join("");
}

function hmSourceLabel(exchange) {
  if (exchange === "cloudflare") return "Cloudflare";
  return exchange === "bybit" ? "Bybit" : "Binance";
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
  const status = payload.loading ? "查询中" : (ok ? "主链路在线" : "主链路过期");
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
    const cloudTotal = cloudRows.reduce((sum, row) => sum + hmCloudRowTotal(row), 0);
    const liveTotal = hmRealEvents(snapshot).reduce((sum, ev) => sum + (Number(ev.notional) || 0), 0);
    const eventCount = cloudRows.reduce((sum, row) => sum + (Number(row.long_count) || 0) + (Number(row.short_count) || 0), 0);
    extras.push({
      ts: Date.now(),
      exchange: "cloudflare",
      kind: "primary",
      detail: `Cloudflare 主链路 ${cloudRows.length} 桶 / ${eventCount} 笔 / ${fmtHmMoney(cloudTotal)}；本页实时补充 ${hmRealEvents(snapshot).length} 笔 / ${fmtHmMoney(liveTotal)}`,
      level: hmCloudIsFresh() ? "info" : "warn",
    });
  }
  const allRows = extras.concat(rows).slice(0, 10);
  if (!allRows.length) {
    wrap.innerHTML = `<div class="heatmap-diagnostic-empty">等待实时源诊断信号...</div>`;
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

function renderHeatmapPressureMatrix(displaySnapshot) {
  const sub = document.getElementById("hm-pressure-sub");
  const chip = document.getElementById("hm-pressure-chip");
  const summaryEl = document.getElementById("hm-pressure-summary");
  const matrixEl = document.getElementById("hm-pressure-matrix");
  const warnEl = document.getElementById("hm-pressure-warnings");
  if (!summaryEl || !matrixEl || !warnEl) return;

  if (typeof HeatmapPressureMatrix === "undefined" || typeof HeatmapPressureMatrix.build !== "function") {
    if (sub) sub.textContent = "压力模块脚本未加载。";
    if (chip) {
      chip.className = "chip danger";
      chip.textContent = "不可用";
    }
    summaryEl.innerHTML = `<div class="heatmap-pressure-empty">HeatmapPressureMatrix 未定义</div>`;
    matrixEl.innerHTML = "";
    warnEl.innerHTML = "";
    return;
  }

  if (heatmapPressureStatus.loading && !heatmapPressurePayload && !heatmapPressureKlines) {
    if (sub) sub.textContent = "正在拉取衍生品与 1h K 线…";
    if (chip) {
      chip.className = "chip warn";
      chip.textContent = "加载中";
    }
    summaryEl.innerHTML = `<div class="heatmap-pressure-empty">等待 OI / Funding / K 线…</div>`;
    matrixEl.innerHTML = "";
    warnEl.innerHTML = "";
    return;
  }

  const state = currentHeatmapStateFromDom();
  const liqRows = heatmapPressureLiquidationInput(displaySnapshot, state);
  const aggregateSource = displaySnapshot.aggregateSource === "d1" ? "d1" : "live";
  const pressure = HeatmapPressureMatrix.build({
    symbol: HEATMAP_SYMBOL,
    generatedAt: new Date().toISOString(),
    heatmapState: state,
    liquidationRows: liqRows,
    derivativesPayload: heatmapPressurePayload,
    klines1h: heatmapPressureKlines,
    aggregateSource,
    derivativesError: heatmapPressureStatus.derivError || "",
    klinesError: heatmapPressureStatus.klinesError || "",
  });

  const s = pressure.summary;
  if (sub) {
    const updated = heatmapPressureStatus.updatedAt ? fmtHmTime(heatmapPressureStatus.updatedAt) : "--";
    sub.textContent = `主情景 ${s.primaryLabel} · 矩阵数据 ${updated} · 强平样本 ${aggregateSource === "d1" ? "D1" : "本页缓存"}`;
  }
  if (chip) {
    const conf = s.confidence;
    chip.className = conf >= 50 ? "chip ok" : (conf >= 30 ? "chip warn" : "chip danger");
    chip.textContent = `置信 ${conf}%`;
  }

  summaryEl.innerHTML = `
    <div class="heatmap-pressure-summary-grid">
      <div><span>主情景</span><strong>${hmEsc(s.primaryLabel)}</strong></div>
      <div><span>情景分</span><strong>${s.primaryScore}</strong></div>
      <div><span>置信度</span><strong>${s.confidence}%</strong></div>
      <div><span>输入覆盖</span><strong>${s.dataCompleteness}%</strong></div>
    </div>
  `;

  const maxScore = Math.max(1, ...pressure.rows.map((r) => r.score));
  matrixEl.innerHTML = pressure.rows.map((row) => {
    const pct = Math.max(8, Math.round((row.score / maxScore) * 100));
    const factors = (row.factors || []).slice(0, 5).map((f) =>
      `<li><em>+${Math.round(Number(f.contribution) || 0)}</em> ${hmEsc(f.label)}：${hmEsc(f.detail)}</li>`
    ).join("");
    return `
      <div class="heatmap-pressure-row" data-id="${hmEsc(row.id)}">
        <div class="heatmap-pressure-row-top">
          <strong>${hmEsc(row.label)}</strong>
          <span>${row.score}</span>
        </div>
        <div class="heatmap-pressure-bar-track">
          <span class="heatmap-pressure-bar" style="width:${pct}%"></span>
        </div>
        ${factors ? `<ul class="heatmap-pressure-factors">${factors}</ul>` : ""}
      </div>
    `;
  }).join("");

  if (pressure.warnings.length) {
    warnEl.innerHTML = `<div class="heatmap-pressure-warn-title">提示</div><ul>${pressure.warnings.map((w) => `<li>${hmEsc(w)}</li>`).join("")}</ul>`;
  } else {
    warnEl.innerHTML = "";
  }
}

async function refreshHeatmapPressureInputs(force) {
  if (typeof DataEngine === "undefined") return;
  if (heatmapPressureInFlight && !force) return;
  heatmapPressureInFlight = true;
  heatmapPressureStatus = {
    ...heatmapPressureStatus,
    loading: true,
    derivError: heatmapPressureStatus.derivError || "",
    klinesError: heatmapPressureStatus.klinesError || "",
  };
  refreshHeatmapView();
  const derivP = DataEngine.fetchDerivatives(HEATMAP_SYMBOL, "30d", { sync: "0" }).then(
    (data) => ({ ok: true, data }),
    (e) => ({ ok: false, error: e && e.message ? e.message : String(e) })
  );
  const kP = DataEngine.fetchKlinesFromD1(HEATMAP_SYMBOL, "1h", 200, { sync: "0" }).then(
    (data) => ({ ok: true, data }),
    (e) => ({ ok: false, error: e && e.message ? e.message : String(e) })
  );
  const [dr, kr] = await Promise.all([derivP, kP]);
  heatmapPressurePayload = dr.ok ? dr.data : heatmapPressurePayload;
  heatmapPressureKlines = kr.ok ? kr.data : heatmapPressureKlines;
  heatmapPressureStatus = {
    loading: false,
    derivError: dr.ok ? "" : String(dr.error || "").slice(0, 200),
    klinesError: kr.ok ? "" : String(kr.error || "").slice(0, 200),
    updatedAt: Date.now(),
  };
  heatmapPressureInFlight = false;
  refreshHeatmapView();
}

function refreshHeatmapView(statusText) {
  const snapshot = heatmapSnapshot();
  const displaySnapshot = hmDisplaySnapshot(snapshot);
  renderHeatmapKpis(displaySnapshot);
  renderHeatmapBuckets(displaySnapshot);
  renderHeatmapPressureMatrix(displaySnapshot);
  renderHeatmapHealth(snapshot, displaySnapshot);
  renderHeatmapSources(snapshot);
  renderHeatmapDiagnostics(snapshot);
  const chip = document.getElementById("hm-live-chip");
  const cloudPrimary = hmCloudAvailable();
  const cloudFresh = hmCloudIsFresh();
  const anyRealtime = cloudPrimary ? cloudFresh : Object.values(snapshot.sources || {}).some((src) => src.status === "realtime");
  if (chip) {
    chip.className = anyRealtime ? "chip ok" : "chip warn";
    chip.textContent = cloudPrimary ? (cloudFresh ? "Cloudflare 主链路" : "主链路过期") : (anyRealtime ? "本页实时流" : "等待连接");
  }
  if (statusText) {
    setHmText("hm-status", statusText);
  } else if (cloudPrimary) {
    const fresh = hmCloudFreshness();
    const latestEventAt = Number(fresh.latestEventAt) || 0;
    const latestMessageAge = Number(fresh.latestMessageAgeMs);
    const rows = hmFilteredCloudRows(currentHeatmapStateFromDom());
    const events = rows.reduce((sum, row) => sum + (Number(row.long_count) || 0) + (Number(row.short_count) || 0), 0);
    const healthText = cloudFresh ? "检测正常" : "主链路无新鲜心跳";
    const eventText = latestEventAt ? `最新强平 ${fmtHmTime(latestEventAt)}` : "等待首笔强平";
    const idleText = rows.length ? `${events} 笔强平` : "当前窗口暂无强平";
    const heartbeatText = Number.isFinite(latestMessageAge) ? `心跳 ${fmtHmAge(latestMessageAge)}` : "心跳 --";
    setHmText("hm-status", `${healthText} · ${idleText} · ${eventText} · ${heartbeatText}`);
  } else {
    setHmText("hm-status", `Cloudflare 暂不可用，降级为本页实时流 · ${hmLatestRealLabel(snapshot)}`);
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
    const data = wake && typeof DataEngine.wakeLiquidationCollector === "function"
      ? await DataEngine.wakeLiquidationCollector()
      : await DataEngine.fetchLiquidationStatus();
    heatmapCloudStatus = { ok: true, ...(data || {}) };
    if (typeof DataEngine.fetchLiquidationBuckets === "function") {
      const state = currentHeatmapStateFromDom();
      heatmapCloudBuckets = await DataEngine.fetchLiquidationBuckets(HEATMAP_SYMBOL, heatmapD1RangeForWindow(state.window), { includeActive: true });
      maybePromoteHeatmapWindowForCloudHistory();
    }
  } catch (e) {
    heatmapCloudStatus = {
      ok: false,
      error: e && e.message ? e.message : String(e),
    };
    heatmapCloudBuckets = {
      error: e && e.message ? e.message : String(e),
      buckets: [],
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
  if (typeof LiquidationEngine === "undefined") {
    bindHeatmapControls();
    refreshHeatmapPressureInputs(true);
    heatmapPressureTimer = setInterval(() => refreshHeatmapPressureInputs(false), HEATMAP_PRESSURE_POLL_MS);
    refreshHeatmapView("LiquidationEngine 未加载");
    return;
  }
  const state = readHeatmapState();
  heatmapPressurePayload = null;
  heatmapPressureKlines = null;
  heatmapAutoWindowPromoted = false;
  heatmapPressureStatus = { loading: false, derivError: "", klinesError: "", updatedAt: null };
  heatmapPressureInFlight = false;
  if (heatmapPressureTimer) {
    clearInterval(heatmapPressureTimer);
    heatmapPressureTimer = null;
  }
  heatmapStream = new LiquidationEngine.LiquidationStream({
    symbol: HEATMAP_SYMBOL,
    bucketSize: state.bucketSize,
    maxEvents: LiquidationEngine.DEFAULT_MAX_EVENTS,
    cacheRetentionMs: LiquidationEngine.DEFAULT_CACHE_RETENTION_MS,
    onUpdate: () => refreshHeatmapView(),
    onStatus: () => refreshHeatmapView(),
  });
  bindHeatmapControls();
  heatmapStream.start();
  heatmapRefreshTimer = setInterval(() => refreshHeatmapView(), 1000);
  startHeatmapCloudPolling();
  refreshHeatmapPressureInputs(true);
  heatmapPressureTimer = setInterval(() => refreshHeatmapPressureInputs(false), HEATMAP_PRESSURE_POLL_MS);
  window.__bitDeskHeatmapDebugIngest = (event) => {
    if (!heatmapStream) return;
    const now = Date.now();
    heatmapStream.ingest({
      id: event && event.id ? String(event.id) : `debug:${now}:${Math.random()}`,
      exchange: event && event.exchange ? String(event.exchange) : "binance",
      symbol: HEATMAP_SYMBOL,
      ts: Number(event && event.ts) || now,
      positionSide: event && event.positionSide === "short" ? "short" : "long",
      rawSide: event && event.rawSide ? String(event.rawSide) : "DEBUG",
      price: Number(event && event.price) || 65000,
      qty: Number(event && event.qty) || 0.25,
      notional: (Number(event && event.notional) || 0) || ((Number(event && event.price) || 65000) * (Number(event && event.qty) || 0.25)),
      bucketPrice: null,
      receivedAt: now,
      raw: event || {},
      isTest: !!(event && event.isTest),
    });
  };
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
