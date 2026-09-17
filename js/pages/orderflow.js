/* =======================================================
   Orderflow / Footprint page
   ======================================================= */

const ORDERFLOW_SYMBOL = "BTCUSDT";
const ORDERFLOW_STATE_KEY = "bitdesk.orderflow.settings";
let orderflowStream = null;
let orderflowCanvas = null;
let orderflowBars = [];
let orderflowMeta = null;
let orderflowCanvasMeta = null;
let orderflowStudyTab = "levels";
let orderflowTechnicalLevels = null;
let orderflowTechnicalStatus = "";
let orderflowKlineRequestId = 0;
const orderflowKlineLevelCache = new Map();

function defaultOrderflowState() {
  return {
    interval: "15m",
    tickSize: "auto",
    visibleBars: 32,
    loadBars: 240,
    showImbalance: true,
    showVpLevels: true,
  };
}

function readOrderflowState() {
  const d = defaultOrderflowState();
  try {
    const raw = localStorage.getItem(ORDERFLOW_STATE_KEY);
    if (!raw) return d;
    const p = JSON.parse(raw);
    const supported = typeof FootprintEngine !== "undefined" && FootprintEngine.SUPPORTED_INTERVALS
      ? FootprintEngine.SUPPORTED_INTERVALS
      : ["5m", "15m", "1h", "4h"];
    const legacyMaxBars = Number(p.maxBars);
    const visibleBars = [16, 24, 32, 48, 64].includes(Number(p.visibleBars))
      ? Number(p.visibleBars)
      : ([40, 80, 120].includes(legacyMaxBars) ? Math.min(48, legacyMaxBars) : d.visibleBars);
    const loadBars = [120, 240].includes(Number(p.loadBars)) ? Number(p.loadBars) : d.loadBars;
    return {
      interval: supported.includes(p.interval) ? p.interval : d.interval,
      tickSize: ["auto", "1", "5", "10", "25", "50", "100"].includes(String(p.tickSize)) ? String(p.tickSize) : d.tickSize,
      visibleBars,
      loadBars,
      showImbalance: p.showImbalance !== false,
      showVpLevels: p.showVpLevels !== false,
    };
  } catch (_) {
    return d;
  }
}

function writeOrderflowState(s) {
  try {
    localStorage.setItem(ORDERFLOW_STATE_KEY, JSON.stringify(s));
  } catch (_) {}
}

function fmtOfVol(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 100) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1);
  if (Math.abs(n) >= 1) return n.toFixed(2);
  return n.toFixed(3);
}

function fmtOfPrice(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return n >= 1000 ? n.toFixed(0) : n.toFixed(2);
}

function fmtOfTime(t) {
  if (!Number.isFinite(Number(t))) return "--";
  return new Date(Number(t)).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtOfPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtOfSigned(n) {
  const v = Number(n) || 0;
  return v > 0 ? `+${v}` : String(v);
}

function getOrderflowFreshness(latest) {
  if (
    typeof FootprintEngine !== "undefined" &&
    typeof FootprintEngine.normalizeOrderflowDataFreshness === "function"
  ) {
    const state = readOrderflowState();
    return FootprintEngine.normalizeOrderflowDataFreshness({
      ...(orderflowMeta || {}),
      interval: state.interval,
    }, latest || null, state.interval);
  }
  return {
    status: "unknown",
    label: "新鲜度待确认",
    tone: "",
    isDegraded: false,
    latestBarClosed: null,
  };
}

function getOrderflowDeltaBias(bar) {
  if (
    typeof FootprintEngine !== "undefined" &&
    typeof FootprintEngine.readModelDeltaBias === "function"
  ) {
    return FootprintEngine.readModelDeltaBias(bar);
  }
  const delta = Number(bar && bar.delta) || 0;
  const volume = (Number(bar && bar.volume) || 0) || (Number(bar && bar.buyVol) || 0) + (Number(bar && bar.sellVol) || 0);
  if (!volume || Math.abs(delta) / volume < 0.05 || delta === 0) {
    return { side: "neutral", tone: "", label: "主动成交接近均衡" };
  }
  return delta > 0
    ? { side: "buy", tone: "up", label: "买方主动成交相对占优" }
    : { side: "sell", tone: "down", label: "卖方主动成交相对占优" };
}

function orderflowStudyPanelHtml() {
  return `
    <section class="orderflow-study" id="of-study-window">
      <div class="orderflow-study-head">
        <div>
          <div class="card-title">订单流仪表盘</div>
          <div class="orderflow-study-sub" id="of-study-range">当前可视范围 · 等待足迹数据</div>
        </div>
        <div class="orderflow-study-badge">规则读数 · 无 LLM</div>
      </div>
      <div class="orderflow-study-body" id="of-study-body">
        <div class="orderflow-empty">等待当前可视足迹数据...</div>
      </div>
    </section>
  `;
}

function pageOrderflow() {
  const s = readOrderflowState();
  const supported = typeof FootprintEngine !== "undefined" && FootprintEngine.SUPPORTED_INTERVALS
    ? FootprintEngine.SUPPORTED_INTERVALS
    : ["5m", "15m", "1h", "4h"];
  const tfButtons = supported
    .map((tf) => `<button class="btn ${tf === s.interval ? "primary" : ""} of-tf-btn" data-of-tf="${tf}">${tf}</button>`)
    .join("");
  const tickOptions = ["auto", "1", "5", "10", "25", "50", "100"]
    .map((v) => `<option value="${v}" ${v === s.tickSize ? "selected" : ""}>${v === "auto" ? "Auto" : v + " USDT"}</option>`)
    .join("");
  const visibleOptions = [16, 24, 32, 48, 64]
    .map((v) => `<option value="${v}" ${v === s.visibleBars ? "selected" : ""}>${v} bars</option>`)
    .join("");
  const loadOptions = [120, 240]
    .map((v) => `<option value="${v}" ${v === s.loadBars ? "selected" : ""}>${v} bars</option>`)
    .join("");

  return html`
    <section class="orderflow-desk">
      <div class="orderflow-data-strip">
        <div class="orderflow-data-main">
          <span class="orderflow-feed-dot"></span>
          <strong>BTCUSDT 永续</strong>
          <span>Cloud D1 Footprint · Binance aggTrade 轮询快照 · 东八区时间轴 · 前台约 10 秒刷新</span>
        </div>
        <div class="orderflow-data-meta">
          <span class="chip ok" id="of-live-chip">D1 轮询快照</span>
          <a class="owner-link orderflow-owner-link" href="#/agent-flow" title="查看 盘口流动性官 的演示原型">
            <span class="owner-dot" style="background:var(--agent-flow)">盘</span>
            <span>盘口流动性官</span>
            <span class="owner-arrow"><i class="ph ph-arrow-right"></i></span>
          </a>
        </div>
      </div>

      <p class="muted" id="of-research-evidence"></p>

      <div class="orderflow-toolbar">
        <div class="orderflow-toolbar-primary">
          <div class="orderflow-tfs">${tfButtons}</div>
          <label class="orderflow-field">
            <span>窗口</span>
            <select id="of-visible-bars">${visibleOptions}</select>
          </label>
          <span class="orderflow-status" id="of-status">准备连接...</span>
        </div>
        <details class="orderflow-toolbar-advanced">
          <summary class="orderflow-toolbar-advanced-summary">高级显示设置</summary>
          <div class="orderflow-toolbar-advanced-body">
            <label class="orderflow-field">
              <span>价格档</span>
              <select id="of-tick-size">${tickOptions}</select>
            </label>
            <label class="orderflow-field">
              <span>加载</span>
              <select id="of-load-bars">${loadOptions}</select>
            </label>
            <label class="orderflow-check">
              <input type="checkbox" id="of-imbalance-toggle" ${s.showImbalance ? "checked" : ""} />
              失衡标记
            </label>
            <label class="orderflow-check">
              <input type="checkbox" id="of-vp-toggle" ${s.showVpLevels ? "checked" : ""} />
              价值区线
            </label>
            <button type="button" class="btn" id="of-clear-cache">
              <i class="ph ph-trash"></i>
              清空缓存
            </button>
          </div>
        </details>
      </div>

      <div class="orderflow-kpis orderflow-kpis--compact">
        <div class="orderflow-kpi"><span>最新 Bar 时间</span><strong id="of-kpi-time">--</strong></div>
        <div class="orderflow-kpi"><span>Delta</span><strong id="of-kpi-delta">--</strong></div>
        <div class="orderflow-kpi"><span>最新 Bar 档内 POC</span><strong id="of-kpi-poc">--</strong></div>
        <div class="orderflow-kpi"><span>失衡价位数</span><strong id="of-kpi-imb">--</strong></div>
      </div>

      <div class="orderflow-main-grid">
        <div class="orderflow-canvas-col">
          <div class="orderflow-canvas-wrap">
            <canvas id="of-footprint-canvas"></canvas>
            <div class="orderflow-tooltip" id="of-footprint-tip"></div>
          </div>
        </div>
        <aside class="orderflow-insight-rail" aria-label="足迹观察栏">
          <div class="orderflow-rail-section orderflow-rail-section--primary">
            <div class="orderflow-rail-title">盘中读数板</div>
            <div id="of-rail-insight" class="orderflow-rail-insight">
              <div class="orderflow-rail-placeholder">等待足迹数据...</div>
            </div>
          </div>
          <div class="orderflow-rail-section">
            <div class="orderflow-rail-title">最新 Bar 主动成交</div>
            <div class="orderflow-rail-split-kpi">
              <div class="orderflow-rail-split-cell">
                <span>主动买</span>
                <strong id="of-kpi-buy">--</strong>
              </div>
              <div class="orderflow-rail-split-cell">
                <span>主动卖</span>
                <strong id="of-kpi-sell">--</strong>
              </div>
            </div>
          </div>
          <div class="orderflow-rail-section orderflow-rail-section--dense">
            <div class="orderflow-rail-title">数据状态</div>
            <div class="orderflow-side-row"><span>交易对</span><strong>${ORDERFLOW_SYMBOL}</strong></div>
            <div class="orderflow-side-row"><span>周期</span><strong id="of-side-interval">${s.interval}</strong></div>
            <div class="orderflow-side-row"><span>已加载</span><strong id="of-side-bars">0</strong></div>
            <div class="orderflow-side-row"><span>D1 基础</span><strong id="of-side-base-bars">--</strong></div>
            <div class="orderflow-side-row"><span>新鲜度</span><strong id="of-side-freshness">--</strong></div>
            <div class="orderflow-side-row"><span>可视窗口</span><strong id="of-side-visible">${s.visibleBars}</strong></div>
            <div class="orderflow-side-row"><span>价格档</span><strong id="of-side-tick">${s.tickSize === "auto" ? "Auto" : s.tickSize}</strong></div>
          </div>
        </aside>
      </div>

      ${orderflowStudyPanelHtml()}
    </section>
  `;
}

function updateOrderflowStats(statusText) {
  const latest = orderflowBars.length ? orderflowBars[orderflowBars.length - 1] : null;
  const freshness = getOrderflowFreshness(latest);
  const statusEl = document.getElementById("of-status");
  const chip = document.getElementById("of-live-chip");
  if (statusEl) {
    const count = orderflowBars.length;
    statusEl.textContent = `${statusText || "Cloud D1 polling"} · ${count} bars`;
    statusEl.title = `主路径为 Cloud D1 轮询快照；${freshness.label}`;
  }
  if (chip) {
    const text = String(statusText || "");
    const failed = /failed|error|closed|not connected/i.test(text);
    const cloud = /Cloud D1|polling/i.test(text);
    chip.className = failed ? "chip warn" : "chip ok";
    if (freshness.isDegraded || failed) chip.className = "chip warn";
    chip.textContent = cloud ? freshness.label : "D1 轮询快照";
    chip.title = `${text || "订单流数据连接状态"}；无浏览器直连 WS 主路径`;
  }
  const evidenceEl = document.getElementById("of-research-evidence");
  if (evidenceEl && typeof BitContracts !== "undefined" && BitContracts.formatResearchEvidenceLines) {
    const state = readOrderflowState();
    evidenceEl.textContent = BitContracts.formatResearchEvidenceLines({
      instrumentId: "BINANCE:USDM:BTCUSDT:PERPETUAL",
      interval: state.interval,
      windowLabel: `可视 ${state.visibleBars} bars`,
      source: "d1-footprint",
      coverage: freshness && freshness.status === "unknown" ? "成交心跳未知，未用 barEnd 充数" : freshness.label,
    });
  }

  const set = (id, text, cls) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.classList.remove("up", "down");
    if (cls) el.classList.add(cls);
  };

  if (!latest) {
    set("of-kpi-time", "--");
    set("of-kpi-delta", "--");
    set("of-kpi-buy", "--");
    set("of-kpi-sell", "--");
    set("of-kpi-poc", "--");
    set("of-kpi-imb", "--");
  } else {
    const imbCount = (latest.levels || []).filter((row) => row.imbalance).length;
    const deltaBias = getOrderflowDeltaBias(latest);
    set("of-kpi-time", fmtOfTime(latest.t));
    set("of-kpi-delta", fmtOfVol(latest.delta), deltaBias.tone);
    set("of-kpi-buy", fmtOfVol(latest.buyVol), "up");
    set("of-kpi-sell", fmtOfVol(latest.sellVol), "down");
    set("of-kpi-poc", fmtOfPrice(latest.pocPrice));
    set("of-kpi-imb", String(imbCount));
  }

  const sideBars = document.getElementById("of-side-bars");
  if (sideBars) sideBars.textContent = String(orderflowBars.length);
  const sideBaseBars = document.getElementById("of-side-base-bars");
  if (sideBaseBars) {
    const n = orderflowMeta && Number(orderflowMeta.availableBaseBars);
    const max = orderflowMeta && Number(orderflowMeta.maxBaseBars);
    sideBaseBars.textContent = Number.isFinite(n) && n > 0
      ? `${n}${Number.isFinite(max) && max > 0 ? " / " + max : ""}`
      : "--";
  }
  const sideFreshness = document.getElementById("of-side-freshness");
  if (sideFreshness) sideFreshness.textContent = freshness.label;
  const sideVisible = document.getElementById("of-side-visible");
  if (sideVisible) {
    const visible = orderflowCanvasMeta && Number(orderflowCanvasMeta.visibleBars);
    sideVisible.textContent = Number.isFinite(visible) ? String(visible) : String(readOrderflowState().visibleBars);
  }
  const sideTick = document.getElementById("of-side-tick");
  if (sideTick) {
    const state = readOrderflowState();
    const effective = orderflowCanvasMeta && Number(orderflowCanvasMeta.effectiveTickSize);
    sideTick.textContent = state.tickSize === "auto" && Number.isFinite(effective)
      ? `Auto (${effective})`
      : (state.tickSize === "auto" ? "Auto" : state.tickSize);
  }
  updateOrderflowResearch();
}

function getOrderflowVisibleStudyBars() {
  if (orderflowCanvasMeta && Array.isArray(orderflowCanvasMeta.visibleBarsData)) {
    return orderflowCanvasMeta.visibleBarsData;
  }
  const state = readOrderflowState();
  const end = orderflowBars.length;
  const raw = orderflowBars.slice(Math.max(0, end - state.visibleBars), end);
  if (typeof FootprintEngine !== "undefined" && typeof FootprintEngine.rebinDisplayBars === "function") {
    const effective = orderflowCanvasMeta && Number(orderflowCanvasMeta.effectiveTickSize);
    const tick = Number.isFinite(effective) ? String(effective) : state.tickSize;
    return FootprintEngine.rebinDisplayBars(raw, tick).bars;
  }
  return raw;
}

function getOrderflowReadModel(bars) {
  if (typeof FootprintEngine === "undefined" || typeof FootprintEngine.buildOrderflowReadModel !== "function") {
    return null;
  }
  const effective = orderflowCanvasMeta && Number(orderflowCanvasMeta.effectiveTickSize);
  const state = readOrderflowState();
  return FootprintEngine.buildOrderflowReadModel(bars, {
    effectiveTickSize: Number.isFinite(effective) ? effective : undefined,
    technicalLevels: orderflowTechnicalLevels,
    interval: state.interval,
    dataFreshness: {
      ...(orderflowMeta || {}),
      interval: state.interval,
    },
  });
}

function renderOrderflowMetric(label, value, cls) {
  return `
    <div class="orderflow-study-metric">
      <span>${label}</span>
      <strong class="${cls || ""}">${value}</strong>
    </div>
  `;
}

function ofSideText(side) {
  return side === "buy" ? "买方" : (side === "sell" ? "卖方" : "无明显方向");
}

function describeImbalance(analysis) {
  const total = Number(analysis.buyCount || 0) + Number(analysis.sellCount || 0);
  if (!total) {
    return "当前窗口没有达到阈值的买卖失衡价位，可以先把价位失衡读数看作相对均衡。";
  }
  const net = Number(analysis.netCount) || 0;
  const abs = Math.abs(net);
  const bias = abs <= 2
    ? "买卖阈值失衡价位接近，暂时没有明显单边价位聚集。"
    : `${net > 0 ? "买方" : "卖方"}阈值失衡价位更多，表示当前窗口的失衡事件更偏向${net > 0 ? "买方" : "卖方"}。`;
  const run = analysis.longestRun && analysis.longestRun.count >= 2
    ? `最长连续段是${ofSideText(analysis.longestRun.side)}连续 ${analysis.longestRun.count} 根，说明那一段阈值失衡价位更集中地偏向一侧。`
    : "没有形成连续多根的同向失衡，单个阈值失衡价位需要结合位置看。";
  return `${bias}${run}`;
}

function describeVolumeProfile(profile, bars) {
  if (!profile || !profile.levels || !profile.levels.length) {
    return "当前窗口还没有足够的成交分布数据。";
  }
  const latest = bars && bars.length ? Number(bars[bars.length - 1].close) : NaN;
  let location = "当前价格位置暂时无法判断。";
  if (Number.isFinite(latest) && Number.isFinite(profile.vah) && Number.isFinite(profile.val)) {
    const span = Math.max(1, Number(profile.vah) - Number(profile.val));
    if (latest > Number(profile.vah)) {
      location = "当前价格位于主要成交区上方。";
    } else if (latest < Number(profile.val)) {
      location = "当前价格位于主要成交区下方。";
    } else if (latest >= Number(profile.vah) - span * 0.25) {
      location = "当前价格靠近主要成交区上沿，这里常被用来观察压力是否出现。";
    } else if (latest <= Number(profile.val) + span * 0.25) {
      location = "当前价格靠近主要成交区下沿，这里常被用来观察支撑是否出现。";
    } else {
      location = "当前价格在主要成交区中部，说明它仍在密集成交区内来回交换。";
    }
  }
  return `当前可视窗口成交分布 POC 是 ${fmtOfPrice(profile.pocPrice)}，主要成交区间是 ${fmtOfPrice(profile.val)} - ${fmtOfPrice(profile.vah)}。${location}`;
}

function renderOrderflowImbalanceStudy(bars, model) {
  if (typeof FootprintEngine === "undefined" || typeof FootprintEngine.analyzeImbalance !== "function") {
    return `<div class="orderflow-empty">买卖失衡计算函数不可用。</div>`;
  }
  if (!bars.length) return `<div class="orderflow-empty">等待当前可视足迹数据...</div>`;
  const analysis = model && model.imbalance ? model.imbalance : FootprintEngine.analyzeImbalance(bars);
  const topRows = analysis.topPrices.length
    ? analysis.topPrices.map((row) => {
        const side = row.netCount >= 0 ? "buy" : "sell";
        return `
          <div class="orderflow-study-row">
            <span>${fmtOfPrice(row.price)}</span>
            <strong class="${side === "buy" ? "up" : "down"}">${fmtOfSigned(row.netCount)}</strong>
            <em>买 ${row.buyCount} / 卖 ${row.sellCount}</em>
          </div>
        `;
      }).join("")
    : `<div class="orderflow-empty small">当前窗口没有达到阈值的失衡价位。</div>`;
  const latest = analysis.latest;
  const latestText = latest
    ? `${ofSideText(latest.side)} · ${fmtOfPrice(latest.price)} · ${fmtOfTime(latest.t)}`
    : "--";
  const runText = analysis.longestRun && analysis.longestRun.count
    ? `${ofSideText(analysis.longestRun.side)}连续 ${analysis.longestRun.count} 根`
    : "--";
  return `
    <div class="orderflow-study-grid">
      <div class="orderflow-study-card">
        <div class="orderflow-study-explain">${describeImbalance(analysis)}</div>
        <div class="orderflow-study-metrics">
          ${renderOrderflowMetric("买方失衡", analysis.buyCount, "up")}
          ${renderOrderflowMetric("卖方失衡", analysis.sellCount, "down")}
          ${renderOrderflowMetric("净失衡", fmtOfSigned(analysis.netCount), analysis.netCount >= 0 ? "up" : "down")}
          ${renderOrderflowMetric("连续失衡", runText)}
        </div>
        <div class="orderflow-study-fact">
          <span>最近一个失衡点</span>
          <strong>${latestText}</strong>
        </div>
      </div>
      <div class="orderflow-study-card">
        <div class="orderflow-study-title">最需要留意的失衡价位</div>
        <div class="orderflow-study-list">${topRows}</div>
      </div>
    </div>
  `;
}

function renderOrderflowVpStudy(bars, model) {
  if (typeof FootprintEngine === "undefined" || typeof FootprintEngine.buildVolumeProfile !== "function") {
    return `<div class="orderflow-empty">成交分布计算函数不可用。</div>`;
  }
  const profile = model && model.volumeProfile
    ? model.volumeProfile
    : orderflowCanvasMeta && orderflowCanvasMeta.volumeProfile
    ? orderflowCanvasMeta.volumeProfile
    : FootprintEngine.buildVolumeProfile(bars);
  if (!bars.length || !profile || !profile.levels.length) {
    return `<div class="orderflow-empty">等待当前可视足迹数据...</div>`;
  }
  const maxTotal = profile.topLevels.reduce((m, row) => Math.max(m, Number(row.total) || 0), 0);
  const rows = profile.topLevels.map((row) => {
    const pct = maxTotal > 0 ? Math.max(2, Math.round((row.total / maxTotal) * 100)) : 0;
    return `
      <div class="orderflow-vp-row">
        <span>${fmtOfPrice(row.price)}</span>
        <div class="orderflow-vp-bar"><i style="width:${pct}%"></i></div>
        <strong>${fmtOfVol(row.total)}</strong>
      </div>
    `;
  }).join("");
  const buyShare = profile.totalVolume > 0 ? profile.buyVol / profile.totalVolume : 0;
  const sellShare = profile.totalVolume > 0 ? profile.sellVol / profile.totalVolume : 0;
  return `
    <div class="orderflow-study-grid">
      <div class="orderflow-study-card">
        <div class="orderflow-study-explain">${describeVolumeProfile(profile, bars)}</div>
        <div class="orderflow-study-metrics">
          ${renderOrderflowMetric("窗口成交分布 POC", fmtOfPrice(profile.pocPrice))}
          ${renderOrderflowMetric("价值区上沿 VAH", fmtOfPrice(profile.vah))}
          ${renderOrderflowMetric("价值区下沿 VAL", fmtOfPrice(profile.val))}
          ${renderOrderflowMetric("主要成交覆盖", fmtOfPct(profile.coverage))}
        </div>
        <div class="orderflow-study-fact">
          <span>当前窗口总成交</span>
          <strong>${fmtOfVol(profile.totalVolume)} · 买方 ${fmtOfPct(buyShare)} / 卖方 ${fmtOfPct(sellShare)}</strong>
        </div>
      </div>
      <div class="orderflow-study-card">
        <div class="orderflow-study-title">窗口内成交最多的价位</div>
        <div class="orderflow-vp-list">${rows}</div>
      </div>
    </div>
  `;
}

function addOrderflowLevel(list, level, mergeDistance) {
  if (!level || !Number.isFinite(Number(level.price))) return;
  const dist = Math.max(1e-8, Number(mergeDistance) || 0);
  const found = list.find((row) => Math.abs(Number(row.price) - Number(level.price)) <= dist);
  if (!found) {
    list.push({
      ...level,
      price: Number(level.price),
      score: Number(level.score) || 1,
      sources: level.source ? [level.source] : [],
    });
    return;
  }
  found.score += Number(level.score) || 1;
  if (level.source && found.sources.indexOf(level.source) < 0) found.sources.push(level.source);
  found.label = found.label || level.label;
}

function analyzeOrderflowKeyLevels(bars) {
  const model = getOrderflowReadModel(bars);
  if (model && model.keyLevels) return model.keyLevels;
  if (!bars || !bars.length || typeof FootprintEngine === "undefined") return null;
  const latest = Number(bars[bars.length - 1].close);
  if (!Number.isFinite(latest)) return null;
  const profile = FootprintEngine.buildVolumeProfile(bars);
  const imbalance = FootprintEngine.analyzeImbalance(bars);
  const span = profile && Number.isFinite(Number(profile.vah)) && Number.isFinite(Number(profile.val))
    ? Math.max(1, Number(profile.vah) - Number(profile.val))
    : Math.max(1, latest * 0.004);
  const buffer = Math.max(span * 0.08, latest * 0.0015);
  const mergeDistance = Math.max(span * 0.05, latest * 0.0008);
  const resistance = [];
  const support = [];
  const route = (price, base) => {
    const target = Number(price) >= latest ? resistance : support;
    addOrderflowLevel(target, { ...base, price }, mergeDistance);
  };

  if (profile && profile.levels && profile.levels.length) {
    route(profile.vah, { label: "价值区上沿", source: "VAH", score: 3 });
    route(profile.val, { label: "价值区下沿", source: "VAL", score: 3 });
    route(profile.pocPrice, { label: "成交最集中", source: "POC", score: 2.5 });
    for (const row of profile.topLevels || []) {
      route(row.price, {
        label: "高成交节点",
        source: `VP ${fmtOfVol(row.total)}`,
        score: 1.2 + (Number(row.total) || 0) / Math.max(1, Number(profile.totalVolume) || 1),
      });
    }
  }

  for (const row of (imbalance && imbalance.topPrices) || []) {
    const net = Number(row.netCount) || 0;
    const side = net >= 0 ? "买方失衡" : "卖方失衡";
    route(row.price, {
      label: side,
      source: `失衡 ${fmtOfSigned(net)}`,
      score: 1.8 + Math.abs(net) * 0.2,
    });
  }

  const sortNear = (a, b) => Math.abs(a.price - latest) - Math.abs(b.price - latest) || b.score - a.score;
  resistance.sort(sortNear);
  support.sort(sortNear);
  const nearestResistance = resistance[0] || null;
  const nearestSupport = support[0] || null;
  const breakout = nearestResistance ? { base: nearestResistance.price, price: nearestResistance.price + buffer, buffer } : null;
  const breakdown = nearestSupport ? { base: nearestSupport.price, price: nearestSupport.price - buffer, buffer } : null;
  let state = "仍在主要成交区内";
  if (breakout && latest >= breakout.price) state = "越过上破观察价";
  else if (nearestResistance && latest >= nearestResistance.price) state = "进入上方压力测试区";
  else if (breakdown && latest <= breakdown.price) state = "跌破下破观察价";
  else if (nearestSupport && latest <= nearestSupport.price) state = "进入下方支撑测试区";
  else if (profile && Number.isFinite(Number(profile.vah)) && latest > Number(profile.vah)) state = "价格站在价值区上方";
  else if (profile && Number.isFinite(Number(profile.val)) && latest < Number(profile.val)) state = "价格站在价值区下方";

  return {
    latest,
    profile,
    imbalance,
    resistance: resistance.slice(0, 5),
    support: support.slice(0, 5),
    breakout,
    breakdown,
    buffer,
    state,
  };
}

function renderOrderflowLevelRows(levels, side, latest) {
  if (!levels || !levels.length) {
    return `<div class="orderflow-empty small">暂无${side === "resistance" ? "上方压力" : "下方支撑"}候选。</div>`;
  }
  const cls = side === "resistance" ? "down" : "up";
  return levels.map((row) => {
    const pct = Number.isFinite(latest) && latest > 0 ? ((row.price / latest - 1) * 100) : 0;
    const sources = Array.isArray(row.sources) && row.sources.length ? row.sources.join(" / ") : row.label;
    return `
      <div class="orderflow-study-row orderflow-level-row">
        <span>${fmtOfPrice(row.price)}</span>
        <strong class="${cls}">${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%</strong>
        <em>${row.label || "关键价位"} · ${sources}</em>
      </div>
    `;
  }).join("");
}

function describeOrderflowKeyLevels(analysis) {
  if (!analysis) return "当前窗口还没有足够的订单流数据。";
  const res = analysis.resistance[0];
  const sup = analysis.support[0];
  const resText = res ? `上方最近压力在 ${fmtOfPrice(res.price)}` : "上方暂未形成明确压力";
  const supText = sup ? `下方最近支撑在 ${fmtOfPrice(sup.price)}` : "下方暂未形成明确支撑";
  const confirm = analysis.breakout
    ? `若价格站上 ${fmtOfPrice(analysis.breakout.price)}，表示越过带缓冲的上破观察价。`
    : "";
  return `${analysis.state}。${resText}，${supText}。这些是可视窗口内的规则阈值。${confirm}`;
}

function renderOrderflowLevelsStudy(bars, model) {
  const analysis = model && model.keyLevels ? model.keyLevels : analyzeOrderflowKeyLevels(bars);
  if (!analysis) {
    return `<div class="orderflow-empty">等待当前可视足迹数据...</div>`;
  }
  return `
    <div class="orderflow-study-grid">
      <div class="orderflow-study-card">
        <div class="orderflow-study-explain">${describeOrderflowKeyLevels(analysis)}</div>
        <div class="orderflow-study-metrics">
          ${renderOrderflowMetric("当前价格", fmtOfPrice(analysis.latest))}
          ${renderOrderflowMetric("上破观察价", analysis.breakout ? fmtOfPrice(analysis.breakout.price) : "--", "down")}
          ${renderOrderflowMetric("下破观察价", analysis.breakdown ? fmtOfPrice(analysis.breakdown.price) : "--", "up")}
          ${renderOrderflowMetric("订单流缓冲", fmtOfPrice(analysis.buffer))}
        </div>
        <div class="orderflow-study-fact">
          <span>判定来源</span>
          <strong>VAH / VAL / POC + 高成交节点 + 买卖失衡密集价</strong>
        </div>
      </div>
      <div class="orderflow-study-card">
        <div class="orderflow-study-title">压力与支撑候选</div>
        <div class="orderflow-level-groups">
          <div>
            <div class="orderflow-level-label down">上方压力</div>
            <div class="orderflow-study-list">${renderOrderflowLevelRows(analysis.resistance, "resistance", analysis.latest)}</div>
          </div>
          <div>
            <div class="orderflow-level-label up">下方支撑</div>
            <div class="orderflow-study-list">${renderOrderflowLevelRows(analysis.support, "support", analysis.latest)}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function normalizeOrderflowTechnicalLevels(analysis) {
  if (!analysis) return null;
  return {
    support: Array.isArray(analysis.support) ? analysis.support : [],
    resistance: Array.isArray(analysis.resistance) ? analysis.resistance : [],
    state: analysis.state || "",
    atr: analysis.atr,
    buffer: analysis.buffer,
  };
}

function computeOrderflowTechnicalLevelsFromKlines(klines, interval) {
  if (typeof IndicatorMath === "undefined") return null;
  if (typeof IndicatorMath.computeChartStructureLevels === "function") {
    return IndicatorMath.computeChartStructureLevels(klines, {
      interval,
      limit: 6,
      atrPeriod: 14,
    });
  }
  if (typeof IndicatorMath.computeKeyLevels === "function") {
    return IndicatorMath.computeKeyLevels(klines, {
      lookbackBars: 180,
      limit: 6,
      interval,
    });
  }
  return null;
}

async function refreshOrderflowTechnicalLevels(state) {
  const s = state || readOrderflowState();
  const interval = s.interval || "15m";
  const cacheKey = `${ORDERFLOW_SYMBOL}.${interval}`;
  const cached = orderflowKlineLevelCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 60_000) {
    orderflowTechnicalLevels = cached.levels;
    orderflowTechnicalStatus = cached.status;
    updateOrderflowResearch();
    return;
  }
  if (
    typeof DataEngine === "undefined" ||
    typeof DataEngine.fetchKlinesFromD1 !== "function" ||
    typeof IndicatorMath === "undefined" ||
    (
      typeof IndicatorMath.computeChartStructureLevels !== "function" &&
      typeof IndicatorMath.computeKeyLevels !== "function"
    )
  ) {
    orderflowTechnicalLevels = null;
    orderflowTechnicalStatus = "K线关键位不可用，使用足迹关键位";
    updateOrderflowResearch();
    return;
  }
  const reqId = ++orderflowKlineRequestId;
  orderflowTechnicalStatus = "K线关键位加载中...";
  updateOrderflowResearch();
  try {
    const klines = await DataEngine.fetchKlinesFromD1(ORDERFLOW_SYMBOL, interval, 500, { sync: "0" });
    if (reqId !== orderflowKlineRequestId) return;
    const levels = normalizeOrderflowTechnicalLevels(computeOrderflowTechnicalLevelsFromKlines(klines, interval));
    orderflowTechnicalLevels = levels;
    orderflowTechnicalStatus = levels ? `K线关键位已加载 · ${interval}` : "K线关键位样本不足";
    orderflowKlineLevelCache.set(cacheKey, { ts: Date.now(), levels, status: orderflowTechnicalStatus });
  } catch (e) {
    if (reqId !== orderflowKlineRequestId) return;
    orderflowTechnicalLevels = null;
    orderflowTechnicalStatus = `K线关键位不可用，使用足迹关键位${e && e.message ? " · " + String(e.message).slice(0, 80) : ""}`;
  }
  updateOrderflowResearch();
}

function sfpStatusText(status) {
  if (status === "confirmed") return "规则收回已满足";
  if (status === "forming") return "候选形成中";
  if (status === "expired") return "候选已失效";
  return "暂无";
}

function sfpDirectionText(direction) {
  if (direction === "bullish") return "多头 SFP";
  if (direction === "bearish") return "空头 SFP";
  return "无方向";
}

function sfpDirectionClass(direction) {
  return direction === "bullish" ? "up" : (direction === "bearish" ? "down" : "");
}

function describeSfpAnalysis(analysis) {
  if (!analysis || analysis.status === "none") {
    return "当前可视窗口没有识别到有效的扫流动性后收回结构。可以继续观察关键位附近是否出现快速下探/上探后重新收回。";
  }
  const dir = analysis.direction === "bullish" ? "下方流动性" : "上方流动性";
  const back = analysis.direction === "bullish" ? "重新站回关键位上方" : "重新跌回关键位下方";
  return `${sfpDirectionText(analysis.direction)}${sfpStatusText(analysis.status)}：价格扫过 ${fmtOfPrice(analysis.level)} 附近的${dir}后，${back}。当前结构分 ${analysis.score}/100，证据来自关键位重合度与足迹主动成交读数。`;
}

function renderSfpEvidenceRows(evidence) {
  const rows = Array.isArray(evidence) ? evidence : [];
  if (!rows.length) return `<div class="orderflow-empty small">暂无证据链。</div>`;
  return rows.map((row) => `
    <div class="orderflow-sfp-evidence-row">
      <span class="orderflow-sfp-dot ${row.state || "warn"}"></span>
      <strong>${row.label || "--"}</strong>
      <em>${row.detail || "--"}</em>
    </div>
  `).join("");
}

function renderSfpCandidateRows(candidates) {
  const rows = Array.isArray(candidates) ? candidates : [];
  if (!rows.length) return `<div class="orderflow-empty small">最近没有 SFP 候选。</div>`;
  return rows.map((row) => {
    const cls = sfpDirectionClass(row.direction);
    const time = row.confirmBar ? row.confirmBar.t : (row.sweepBar ? row.sweepBar.t : null);
    return `
      <div class="orderflow-study-row orderflow-sfp-candidate">
        <span>${fmtOfPrice(row.level)}</span>
        <strong class="${cls}">${row.score || 0}</strong>
        <em>${sfpDirectionText(row.direction)} · ${sfpStatusText(row.status)} · ${fmtOfTime(time)}</em>
      </div>
    `;
  }).join("");
}

function renderOrderflowSfpStudy(bars, model) {
  if (typeof FootprintEngine === "undefined" || typeof FootprintEngine.analyzeSfp !== "function") {
    return `<div class="orderflow-empty">SFP 计算函数不可用。</div>`;
  }
  if (!bars.length) return `<div class="orderflow-empty">等待当前可视足迹数据...</div>`;
  const effective = orderflowCanvasMeta && Number(orderflowCanvasMeta.effectiveTickSize);
  const analysis = model && model.sfp ? model.sfp : FootprintEngine.analyzeSfp(bars, {
    effectiveTickSize: Number.isFinite(effective) ? effective : undefined,
    technicalLevels: orderflowTechnicalLevels,
  });
  const display = model && model.sfpDisplay ? model.sfpDisplay : null;
  const viewAnalysis = analysis && display ? { ...analysis, status: display.status } : analysis;
  if (!analysis || analysis.status === "none") {
    return `
      <div class="orderflow-study-grid">
        <div class="orderflow-study-card">
          <div class="orderflow-study-explain">${describeSfpAnalysis(viewAnalysis)}</div>
          <div class="orderflow-study-metrics">
            ${renderOrderflowMetric("SFP 状态", sfpStatusText("none"))}
            ${renderOrderflowMetric("K线关键位", orderflowTechnicalLevels ? "已合并" : "足迹回退")}
            ${renderOrderflowMetric("价格档", Number.isFinite(effective) ? fmtOfPrice(effective) : "--")}
            ${renderOrderflowMetric("候选数量", analysis && analysis.candidates ? analysis.candidates.length : 0)}
          </div>
          <div class="orderflow-study-fact">
            <span>关键位来源</span>
            <strong>${orderflowTechnicalStatus || "足迹 VP / POC / VAH / VAL / Imbalance"}</strong>
          </div>
        </div>
        <div class="orderflow-study-card">
          <div class="orderflow-study-title">最近候选</div>
          <div class="orderflow-study-list">${renderSfpCandidateRows(analysis && analysis.candidates)}</div>
        </div>
      </div>
    `;
  }
  const cls = sfpDirectionClass(analysis.direction);
  return `
    <div class="orderflow-study-grid">
      <div class="orderflow-study-card">
        <div class="orderflow-study-explain">${describeSfpAnalysis(viewAnalysis)}</div>
        <div class="orderflow-study-metrics">
          ${renderOrderflowMetric("SFP 状态", display && display.statusText ? display.statusText : sfpStatusText(analysis.status), cls)}
          ${renderOrderflowMetric("方向", sfpDirectionText(analysis.direction), cls)}
          ${renderOrderflowMetric("关键位", fmtOfPrice(analysis.level))}
          ${renderOrderflowMetric("结构分", `${analysis.score}/100`, analysis.score >= 75 ? "up" : "")}
          ${renderOrderflowMetric("扫位价格", fmtOfPrice(analysis.sweepPrice), cls)}
          ${renderOrderflowMetric("收回价格", fmtOfPrice(analysis.reclaimPrice))}
          ${renderOrderflowMetric("失效价", fmtOfPrice(analysis.invalidationPrice), "down")}
          ${renderOrderflowMetric("候选数量", analysis.candidates ? analysis.candidates.length : 0)}
        </div>
        <div class="orderflow-study-fact">
          <span>${display && display.reason ? "降级原因" : "关键位来源"}</span>
          <strong>${display && display.reason ? display.reason : ((analysis.levelSources || []).join(" / ") || analysis.levelLabel || "订单流关键位") + " · " + (orderflowTechnicalStatus || "足迹关键位")}</strong>
        </div>
      </div>
      <div class="orderflow-study-card">
        <div class="orderflow-study-title">证据链</div>
        <div class="orderflow-sfp-evidence">${renderSfpEvidenceRows(analysis.evidence)}</div>
        <div class="orderflow-study-title orderflow-sfp-list-title">最近候选</div>
        <div class="orderflow-study-list">${renderSfpCandidateRows(analysis.candidates)}</div>
      </div>
    </div>
  `;
}

function renderOrderflowRailInsight(bars, model) {
  if (!bars || !bars.length) {
    return '<div class="orderflow-rail-placeholder">等待当前可视足迹数据...</div>';
  }
  if (typeof FootprintEngine === "undefined") {
    return '<div class="orderflow-rail-placeholder">FootprintEngine 不可用</div>';
  }
  const dashboard = model && model.dashboard ? model.dashboard : null;
  if (dashboard && dashboard.cards) {
    const card = (key) => dashboard.cards[key] || {};
    const levels = card("levels");
    const volume = card("volumeProfile");
    const imbalance = card("imbalance");
    const sfp = card("sfp");
    return `
      <div class="orderflow-rail-cards">
        <div class="orderflow-rail-card orderflow-rail-card--primary">
          <span class="orderflow-rail-card-label">当前窗口判断</span>
          <strong>${dashboard.primary || "等待当前窗口读数"}</strong>
          ${dashboard.latest ? `<span class="orderflow-rail-card-sub">${dashboard.latest}</span>` : ""}
        </div>
        <div class="orderflow-rail-card">
          <span class="orderflow-rail-card-label">关键位观察</span>
          <strong class="${levels.tone || ""}">${levels.status || "--"}</strong>
          <span class="orderflow-rail-card-sub">${levels.summary || "--"}</span>
        </div>
        <div class="orderflow-rail-card">
          <span class="orderflow-rail-card-label">成交结构</span>
          <strong>${volume.badge || volume.status || "--"}</strong>
          <span class="orderflow-rail-card-sub">${volume.summary || "--"}</span>
        </div>
        <div class="orderflow-rail-card">
          <span class="orderflow-rail-card-label">买卖失衡</span>
          <strong class="${imbalance.tone || ""}">${imbalance.status || "--"}</strong>
          <span class="orderflow-rail-card-sub">${imbalance.summary || "--"}</span>
        </div>
        <div class="orderflow-rail-card ${sfp.status && sfp.status !== "无信号" ? "orderflow-rail-card--signal" : ""}">
          <span class="orderflow-rail-card-label">SFP</span>
          <strong class="${sfp.tone || ""}">${sfp.status || "--"}</strong>
          <span class="orderflow-rail-card-sub">${sfp.summary || "--"}</span>
        </div>
      </div>
    `;
  }
  const profile = model && model.volumeProfile ? model.volumeProfile : typeof FootprintEngine.buildVolumeProfile === "function"
    ? FootprintEngine.buildVolumeProfile(bars)
    : null;
  const imb = model && model.imbalance ? model.imbalance : typeof FootprintEngine.analyzeImbalance === "function"
    ? FootprintEngine.analyzeImbalance(bars)
    : null;
  const keyLevels = model && model.keyLevels ? model.keyLevels : analyzeOrderflowKeyLevels(bars);
  const effective = orderflowCanvasMeta && Number(orderflowCanvasMeta.effectiveTickSize);
  const sfp = model && model.sfp ? model.sfp : typeof FootprintEngine.analyzeSfp === "function"
    ? FootprintEngine.analyzeSfp(bars, {
      effectiveTickSize: Number.isFinite(effective) ? effective : undefined,
      technicalLevels: orderflowTechnicalLevels,
    })
    : null;

  const pocVal = profile && Number.isFinite(Number(profile.pocPrice))
    ? fmtOfPrice(profile.pocPrice)
    : "--";
  const vaLine = profile && Number.isFinite(Number(profile.vah)) && Number.isFinite(Number(profile.val))
    ? `${fmtOfPrice(profile.val)} – ${fmtOfPrice(profile.vah)}`
    : "--";

  let imbMain = "可视窗口无阈值失衡";
  let imbSub = "";
  if (imb) {
    const total = Number(imb.buyCount || 0) + Number(imb.sellCount || 0);
    if (total > 0) {
      imbMain = `买 ${imb.buyCount} / 卖 ${imb.sellCount} · 净 ${fmtOfSigned(imb.netCount)}`;
    }
    if (imb.latest) {
      imbSub = `最近 ${ofSideText(imb.latest.side)} @ ${fmtOfPrice(imb.latest.price)}`;
    }
  }

  const levelsText = keyLevels ? describeOrderflowKeyLevels(keyLevels) : "关键位数据不足";
  const levelsShort = levelsText.length > 140 ? levelsText.slice(0, 137) + "…" : levelsText;

  let sfpMain = "未识别有效 SFP";
  if (sfp && sfp.status !== "none") {
    sfpMain = `${sfpDirectionText(sfp.direction)} · ${sfpStatusText(sfp.status)} · ${fmtOfPrice(sfp.level)}`;
  }

  return `
    <div class="orderflow-rail-cards">
      <div class="orderflow-rail-card orderflow-rail-card--primary">
        <span class="orderflow-rail-card-label">当前窗口判断</span>
        <strong>${model && model.summary ? model.summary.primary : levelsShort}</strong>
        ${model && model.summary && model.summary.latest ? `<span class="orderflow-rail-card-sub">${model.summary.latest}</span>` : ""}
      </div>
      <div class="orderflow-rail-card">
        <span class="orderflow-rail-card-label">成交结构</span>
        <strong>POC ${pocVal}</strong>
        <span class="orderflow-rail-card-sub">VA ${vaLine}</span>
      </div>
      <div class="orderflow-rail-card">
        <span class="orderflow-rail-card-label">买卖失衡</span>
        <strong>${imbMain}</strong>
        ${imbSub ? `<span class="orderflow-rail-card-sub">${imbSub}</span>` : ""}
      </div>
      <div class="orderflow-rail-card">
        <span class="orderflow-rail-card-label">关键位观察</span>
        <p class="orderflow-rail-card-text">${levelsShort}</p>
      </div>
      <div class="orderflow-rail-card">
        <span class="orderflow-rail-card-label">SFP</span>
        <strong>${sfpMain}</strong>
      </div>
    </div>
  `;
}

function renderOrderflowStudyBlock(title, bodyHtml) {
  return `
    <section class="orderflow-study-block">
      <div class="orderflow-study-block-title">${title}</div>
      ${bodyHtml}
    </section>
  `;
}

function renderOrderflowDashboardMetrics(metrics) {
  const rows = Array.isArray(metrics) ? metrics : [];
  if (!rows.length) return "";
  return `
    <div class="orderflow-study-card-metrics">
      ${rows.slice(0, 4).map((row) => `
        <div class="orderflow-study-card-metric">
          <span>${row.label || "--"}</span>
          <strong class="${row.tone || ""}">${row.value || "--"}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function renderOrderflowDashboardCard(key, card) {
  const active = key === orderflowStudyTab;
  const signal = key === "sfp" && card && card.status && card.status !== "无信号";
  return `
    <section class="orderflow-study-dash-card ${active ? "active" : ""} ${signal ? "has-signal" : ""}">
      <button type="button" class="orderflow-study-card-toggle" data-of-study-tab="${key}" aria-expanded="${active ? "true" : "false"}">
        <span>
          <em>${card && card.title ? card.title : key}</em>
          <strong class="${card && card.tone ? card.tone : ""}">${card && card.status ? card.status : "--"}</strong>
        </span>
        <b>${card && card.badge ? card.badge : "展开"}</b>
      </button>
      <p class="orderflow-study-card-summary">${card && card.summary ? card.summary : "等待当前窗口读数。"}</p>
      ${renderOrderflowDashboardMetrics(card && card.metrics)}
    </section>
  `;
}

function renderOrderflowStudyDashboard(bars, model) {
  if (!bars.length) return `<div class="orderflow-empty">等待当前可视足迹数据...</div>`;
  const warnings = model && Array.isArray(model.warnings) && model.warnings.length
    ? `<div class="orderflow-study-warnings">${model.warnings.map((row) => `<span>${row}</span>`).join("")}</div>`
    : "";
  const dashboard = model && model.dashboard ? model.dashboard : null;
  if (dashboard && dashboard.cards) {
    const details = {
      imbalance: renderOrderflowImbalanceStudy(bars, model),
      volumeProfile: renderOrderflowVpStudy(bars, model),
      levels: renderOrderflowLevelsStudy(bars, model),
      sfp: renderOrderflowSfpStudy(bars, model),
    };
    return `
      ${warnings}
      <div class="orderflow-study-dash-grid">
        ${["levels", "imbalance", "volumeProfile", "sfp"].map((key) =>
          renderOrderflowDashboardCard(key, dashboard.cards[key] || {})
        ).join("")}
      </div>
      <div class="orderflow-study-detail-panel">
        ${details[orderflowStudyTab] || details.levels}
      </div>
    `;
  }
  return `
    ${warnings}
    <div class="orderflow-study-stack">
      ${renderOrderflowStudyBlock("买卖失衡", renderOrderflowImbalanceStudy(bars, model))}
      ${renderOrderflowStudyBlock("成交分布", renderOrderflowVpStudy(bars, model))}
      ${renderOrderflowStudyBlock("关键位观察", renderOrderflowLevelsStudy(bars, model))}
      ${renderOrderflowStudyBlock("SFP 假突破", renderOrderflowSfpStudy(bars, model))}
    </div>
  `;
}

function updateOrderflowResearch() {
  const body = document.getElementById("of-study-body");
  const range = document.getElementById("of-study-range");
  const bars = getOrderflowVisibleStudyBars();
  const model = getOrderflowReadModel(bars);
  const rail = document.getElementById("of-rail-insight");
  if (rail) {
    rail.innerHTML = renderOrderflowRailInsight(bars, model);
  }
  if (!body || !range) return;
  const state = readOrderflowState();
  const effective = orderflowCanvasMeta && Number(orderflowCanvasMeta.effectiveTickSize);
  const tickText = state.tickSize === "auto" && Number.isFinite(effective)
    ? `Auto (${effective})`
    : (state.tickSize === "auto" ? "Auto" : state.tickSize);
  const first = bars.length ? bars[0] : null;
  const last = bars.length ? bars[bars.length - 1] : null;
  range.textContent = bars.length
    ? `${state.interval} · ${bars.length} 根可视K线 · 价格档 ${tickText} · ${fmtOfTime(first.t)} - ${fmtOfTime(last.t)}`
    : `${state.interval} · 0 根可视K线 · 价格档 ${tickText}`;
  body.innerHTML = renderOrderflowStudyDashboard(bars, model);
}

function setOrderflowStudyTab(tab, scroll) {
  orderflowStudyTab = ["imbalance", "volumeProfile", "vp", "levels", "sfp"].includes(tab) ? (tab === "vp" ? "volumeProfile" : tab) : "levels";
  document.querySelectorAll("[data-of-study-tab]").forEach((btn) => {
    btn.classList.toggle("active", btn.getAttribute("data-of-study-tab") === orderflowStudyTab);
  });
  updateOrderflowResearch();
  if (scroll) {
    const panel = document.getElementById("of-study-window");
    if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function currentOrderflowStateFromDom() {
  const current = readOrderflowState();
  const activeTf = document.querySelector(".of-tf-btn.primary");
  const tick = document.getElementById("of-tick-size");
  const visible = document.getElementById("of-visible-bars");
  const load = document.getElementById("of-load-bars");
  const imb = document.getElementById("of-imbalance-toggle");
  const vp = document.getElementById("of-vp-toggle");
  return {
    interval: activeTf ? activeTf.getAttribute("data-of-tf") : current.interval,
    tickSize: tick ? tick.value : current.tickSize,
    visibleBars: visible ? Number(visible.value) || current.visibleBars : current.visibleBars,
    loadBars: load ? Number(load.value) || current.loadBars : current.loadBars,
    showImbalance: imb ? !!imb.checked : current.showImbalance,
    showVpLevels: vp ? !!vp.checked : current.showVpLevels,
  };
}

function applyOrderflowState(next) {
  const oldInterval = orderflowStream ? orderflowStream.interval : null;
  const oldTickSize = orderflowStream ? orderflowStream.tickSize : null;
  const oldLoadBars = orderflowStream ? orderflowStream.maxBars : null;
  const intervalChanged = next.interval !== oldInterval;
  writeOrderflowState(next);
  if (orderflowCanvas) {
    orderflowCanvas.setOptions({
      maxBars: next.visibleBars,
      showImbalance: next.showImbalance,
      showVpLevels: next.showVpLevels,
      tickSize: next.tickSize,
    });
  }
  if (orderflowStream && (next.interval !== oldInterval || next.tickSize !== oldTickSize || next.loadBars !== oldLoadBars)) {
    orderflowStream.setOptions({
      symbol: ORDERFLOW_SYMBOL,
      interval: next.interval,
      tickSize: next.tickSize,
      maxBars: next.loadBars,
    });
  }
  const sideInterval = document.getElementById("of-side-interval");
  if (sideInterval) sideInterval.textContent = next.interval;
  updateOrderflowStats(orderflowStream ? orderflowStream.statusText() : "Cloud D1 polling");
  if (intervalChanged) refreshOrderflowTechnicalLevels(next);
}

function bindOrderflowControls() {
  const toolbar = document.querySelector(".orderflow-toolbar");
  if (!toolbar || toolbar.dataset.bound) return;
  toolbar.dataset.bound = "1";

  toolbar.addEventListener("click", (e) => {
    const btn = e.target.closest(".of-tf-btn");
    if (!btn) return;
    const nextTf = btn.getAttribute("data-of-tf");
    if (!nextTf) return;
    document.querySelectorAll(".of-tf-btn").forEach((node) => node.classList.remove("primary"));
    btn.classList.add("primary");
    applyOrderflowState({ ...currentOrderflowStateFromDom(), interval: nextTf });
  });

  const tick = document.getElementById("of-tick-size");
  const visible = document.getElementById("of-visible-bars");
  const load = document.getElementById("of-load-bars");
  const imb = document.getElementById("of-imbalance-toggle");
  const vp = document.getElementById("of-vp-toggle");
  const clear = document.getElementById("of-clear-cache");
  const onChange = () => applyOrderflowState(currentOrderflowStateFromDom());
  if (tick) tick.addEventListener("change", onChange);
  if (visible) visible.addEventListener("change", onChange);
  if (load) load.addEventListener("change", onChange);
  if (imb) imb.addEventListener("change", onChange);
  if (vp) vp.addEventListener("change", onChange);
  if (clear) {
    clear.addEventListener("click", () => {
      if (orderflowStream) orderflowStream.clearCache();
      orderflowBars = [];
      orderflowMeta = null;
      orderflowCanvasMeta = null;
      if (orderflowCanvas) orderflowCanvas.setData(orderflowBars);
      updateOrderflowStats("Cache cleared");
    });
  }

  const study = document.getElementById("of-study-window");
  if (study && !study.dataset.bound) {
    study.dataset.bound = "1";
    study.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-of-study-tab]");
      if (!btn || !study.contains(btn)) return;
      setOrderflowStudyTab(btn.getAttribute("data-of-study-tab"), false);
    });
  }
  document.querySelectorAll("[data-of-study-jump]").forEach((node) => {
    const jump = () => setOrderflowStudyTab(node.getAttribute("data-of-study-jump"), true);
    node.addEventListener("click", jump);
    node.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        jump();
      }
    });
  });
}

function initOrderflow() {
  disposeOrderflow();
  const canvas = document.getElementById("of-footprint-canvas");
  const tooltip = document.getElementById("of-footprint-tip");
  if (!canvas || typeof FootprintEngine === "undefined" || typeof FootprintCanvas === "undefined") return;
  const state = readOrderflowState();

  orderflowCanvas = new FootprintCanvas(canvas, {
    maxBars: state.visibleBars,
    showImbalance: state.showImbalance,
    showVpLevels: state.showVpLevels,
    tickSize: state.tickSize,
    tooltipEl: tooltip,
    onRenderMeta: (meta) => {
      orderflowCanvasMeta = meta || null;
      updateOrderflowStats(orderflowStream ? orderflowStream.statusText() : "Cloud D1 polling");
    },
  });
  orderflowStream = new FootprintEngine.FootprintStream({
    symbol: ORDERFLOW_SYMBOL,
    interval: state.interval,
    tickSize: state.tickSize,
    maxBars: state.loadBars || FootprintEngine.DEFAULT_LOAD_BARS || FootprintEngine.MAX_CACHE_BARS,
    onBars: (bars, meta) => {
      orderflowBars = Array.isArray(bars) ? bars : [];
      if (meta) orderflowMeta = meta;
      if (orderflowCanvas) orderflowCanvas.setData(orderflowBars);
      updateOrderflowStats(orderflowStream ? orderflowStream.statusText() : "Cloud D1 polling");
    },
    onStatus: (text) => updateOrderflowStats(text),
  });
  bindOrderflowControls();
  setOrderflowStudyTab(orderflowStudyTab, false);
  orderflowStream.start();
  refreshOrderflowTechnicalLevels(state);
}

function disposeOrderflow() {
  if (orderflowStream) {
    try {
      orderflowStream.stop(true);
    } catch (_) {}
    orderflowStream = null;
  }
  if (orderflowCanvas) {
    try {
      orderflowCanvas.destroy();
    } catch (_) {}
    orderflowCanvas = null;
  }
  orderflowBars = [];
  orderflowMeta = null;
  orderflowCanvasMeta = null;
  orderflowTechnicalLevels = null;
  orderflowTechnicalStatus = "";
  orderflowKlineRequestId++;
}

window.__bitDeskDisposeOrderflow = disposeOrderflow;
