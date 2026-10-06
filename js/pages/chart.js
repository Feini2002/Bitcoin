// 主图请求元数据与多周期面板、WebSocket 分离。读取函数只返回数据，不写主图身份。
let chartD1Meta = null;
let chartDeskPayload = null;
let chartLatestDesk = null;
let chartWindowGapCount = null;
let chartCommittedIdentity = null;
let chartReadAbort = null;
let chartPollAbort = null;
let chartPollFailures = 0;
let chartPollNextAttemptAt = 0;
let chartHistoryReread = { inFlight: false, again: false, failures: 0, nextAttemptAt: 0, converged: false };
const CHART_HISTORY_REREAD_BASE_MS = 5000;
const CHART_HISTORY_REREAD_MAX_MS = 60000;
let chartRecoveryTimer = null;
let chartRecoveryHandler = null;
let chartRecoveryFailures = 0;
function clearChartRecovery() {
  clearTimeout(chartRecoveryTimer);
  chartRecoveryTimer = null;
  if (chartRecoveryHandler) document.removeEventListener("visibilitychange", chartRecoveryHandler);
  chartRecoveryHandler = null;
}
function scheduleChartRecovery(symbol, interval, gen) {
  clearChartRecovery();
  const delay = Math.min(60000, 3000 * Math.pow(2, Math.min(5, chartRecoveryFailures++)));
  const arm = () => {
    clearTimeout(chartRecoveryTimer);
    if (document.hidden || !chartPageStillCurrent(gen, symbol, interval)) return;
    chartRecoveryTimer = setTimeout(() => {
      if (!document.hidden && chartPageStillCurrent(gen, symbol, interval)) {
        void loadChartData(symbol, interval, { recovery: true, skipAutoSync: true });
      }
    }, delay);
  };
  chartRecoveryHandler = arm;
  document.addEventListener("visibilitychange", arm);
  arm();
  const status = document.getElementById("chart-status");
  if (status) status.textContent += ' · ' + Math.round(delay / 1000) + ' 秒后自动重试';
}

function chartReadSignal(extra) {
  const ctrl = new AbortController();
  const unsubs = [];
  const link = (signal) => {
    if (!signal || typeof signal.addEventListener !== "function") return;
    if (signal.aborted) {
      ctrl.abort();
      return;
    }
    const onAbort = () => ctrl.abort();
    signal.addEventListener("abort", onAbort);
    unsubs.push(() => signal.removeEventListener("abort", onAbort));
  };
  link(chartReadAbort && chartReadAbort.signal);
  link(extra);
  return { ctrl, release() { unsubs.forEach((fn) => fn()); } };
}

async function readChartD1Klines(symbol, interval, limit, opts = {}) {
  if (typeof DataEngine === "undefined" || typeof DataEngine.fetchDesk !== "function") {
    throw new Error("desk 装配层不可用");
  }
  const linked = chartReadSignal(opts.signal);
  try {
    const desk = await DataEngine.fetchDesk("chart", {
      symbol,
      interval,
      tail: opts.tail,
      from: opts.from,
      to: opts.to,
      knownAt: opts.knownAt,
      fresh: opts.fresh,
      priority: opts.priority,
      signal: linked.ctrl.signal,
    });
    const series = desk && desk.pricePathAvailable === true && Array.isArray(desk.series) ? desk.series : [];
    const cap = Number(limit);
    const rows = Number.isFinite(cap) && cap > 0 ? series.slice(-cap) : series.slice();
    return { desk, rows, symbol, interval };
  } finally {
    linked.release();
  }
}

async function readChartSwitchWindow(symbol, interval, forceFull, opts = {}) {
  const cached = !forceFull && typeof DataEngine.peekChartWindow === 'function'
    ? DataEngine.peekChartWindow(symbol, interval) : null;
  if (cached && cached.historyRevision != null && cached.series?.length) {
    const tail = await readChartD1Klines(symbol, interval, CHART_D1_POLL_LIMIT, { tail: CHART_D1_POLL_LIMIT, fresh: true, priority: opts.priority });
    const desk = tail.desk;
    const last = Number(cached.series[cached.series.length - 1].t);
    // Only a fresh, matching, overlapping tail can validate the retained history.
    if (desk.pricePathAvailable === true && desk.coverageScope === 'tail' && desk.historyRevision != null
        && deskRevision(desk) === deskRevision(cached) && desk.instrumentId === cached.instrumentId
        && tail.rows.length && Number(tail.rows[0].t) <= last && Number(tail.rows[tail.rows.length - 1].t) >= last
        && !responseStale(symbol, interval, deskRevision(desk), 'full')) {
      return { desk: cached, rows: cached.series, symbol, interval, freshTail: tail };
    }
  }
  return readChartD1Klines(symbol, interval, 6000, { fresh: true, priority: opts.priority });
}
/* =======================================================
   行情工作台
   - 初始历史走 /api/desk/chart（live tape 新鲜时读 klines 表）。
   - 浏览器每 1s 只读 desk 尾部；打开后若当前周期明显落后会触发一次当前周期同步。
   - 云端 Durable Object 订阅币安 K 线流，约 1 秒合并写入 D1；Cron 每分钟全周期 REST 备份。
   - 浏览器另连 Binance WebSocket（当前周期 kline stream）补齐未收盘 OHLC。
   - 主图标题栏「最新价」独立推送：优先 Binance aggTrade WebSocket（U 本位/现货线路自动切换 + 解析组合流包装），
     网络/CORS 受阻时用币安公开 REST 最新价与 Worker「BIT_DATA_API_BASE」上的 /api/binance/ticker/price 轮询兜底（非 D1、非 K 线序列）。
   ======================================================= */

const CHART_SUPPORTED_TF = ["5m", "15m", "1h", "4h", "1d", "3d", "1w"];
const CHART_WS_RECONNECT_MS = 3000;
/** 标题现价：REST 轮询间隔；WS 新鲜时暂停轮询以免打架 */
const CHART_HEADLINE_REST_MS = 1000;
const CHART_HEADLINE_REST_PAUSE_AFTER_WS_MS = 2000;
/** 已连接但长时间收不到 aggTrade 时切换 spot/futures 线路 */
const CHART_HEADLINE_WS_STALL_SWITCH_MS = 7000;
const CHART_D1_POLL_MS = 1000;
const CHART_D1_POLL_LIMIT = 20;
const CHART_D1_SYNC_TIMEOUT_MS = 90 * 1000;
const CHART_D1_AUTO_SYNC_STALE_BARS = 2;
const CHART_D1_AUTO_SYNC_COOLDOWN_MS = 5 * 60 * 1000;
const CHART_WORKBENCH_TF_KEY = "bitdesk.workbench.chartInterval";
/** 横向平移/缩放：按「交易对|周期」存 scrollPosition + barSpacing（localStorage） */
const CHART_VIEWPORT_KEY = "bitdesk.workbench.chartViewport";
/** 不允许视口停在最后一根 K 线右侧的未来空白区；0 = 最新 K 线贴近右边界 */
const CHART_MIN_RIGHT_SCROLL_POSITION = 0;
/** 图表时间统一按中国东八区展示（与操作系统时区设定无关） */
const CHINA_TZ = "Asia/Shanghai";

function viewportStorageKey(symbol, interval) {
  return `${symbol}|${interval}`;
}

function readViewportState(symbol, interval) {
  try {
    const raw = localStorage.getItem(CHART_VIEWPORT_KEY);
    if (!raw) return null;
    const all = JSON.parse(raw);
    const row = all[viewportStorageKey(symbol, interval)];
    if (!row || typeof row !== "object") return null;
    const { scrollPosition, barSpacing } = row;
    if (typeof scrollPosition !== "number" || typeof barSpacing !== "number") return null;
    if (!Number.isFinite(scrollPosition) || !Number.isFinite(barSpacing)) return null;
    return { scrollPosition, barSpacing };
  } catch (_) {
    return null;
  }
}

function writeViewportState(symbol, interval, state) {
  if (!symbol || !interval || !state) return;
  try {
    const raw = localStorage.getItem(CHART_VIEWPORT_KEY);
    const all = raw ? JSON.parse(raw) : {};
    all[viewportStorageKey(symbol, interval)] = {
      scrollPosition: Math.max(CHART_MIN_RIGHT_SCROLL_POSITION, state.scrollPosition),
      barSpacing: state.barSpacing,
    };
    localStorage.setItem(CHART_VIEWPORT_KEY, JSON.stringify(all));
  } catch (_) {}
}

function clampChartRightBlank() {
  if (!lwChart) return;
  try {
    const ts = lwChart.timeScale();
    const scrollPosition = ts.scrollPosition();
    if (Number.isFinite(scrollPosition) && scrollPosition < CHART_MIN_RIGHT_SCROLL_POSITION) {
      ts.scrollToPosition(CHART_MIN_RIGHT_SCROLL_POSITION, false);
    }
  } catch (_) {}
}

function readPersistedInterval() {
  try {
    const v = localStorage.getItem(CHART_WORKBENCH_TF_KEY);
    if (v && CHART_SUPPORTED_TF.includes(v)) return v;
  } catch (_) {}
  return "15m";
}

function writePersistedInterval(tf) {
  if (!tf || !CHART_SUPPORTED_TF.includes(tf)) return;
  try {
    localStorage.setItem(CHART_WORKBENCH_TF_KEY, tf);
  } catch (_) {}
}

function utcSecondsFromChartTime(time) {
  if (typeof time === "number" && Number.isFinite(time)) return time;
  if (time && typeof time === "object" && "year" in time && "month" in time && "day" in time) {
    const y = time.year;
    const m = time.month;
    const d = time.day;
    return Date.UTC(y, m - 1, d) / 1000;
  }
  return NaN;
}

function chinaDateTimeFull(utcSeconds) {
  const s = new Date(utcSeconds * 1000).toLocaleString("sv-SE", {
    timeZone: CHINA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  return s.replace("T", " ").replace(",", "");
}

function chinaTickMarkLabel(utcSeconds, tickMarkType) {
  const d = new Date(utcSeconds * 1000);
  const TM = typeof LightweightCharts !== "undefined" && LightweightCharts.TickMarkType
    ? LightweightCharts.TickMarkType
    : { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 };

  switch (tickMarkType) {
    case TM.Year:
      return new Intl.DateTimeFormat("zh-CN", {
        timeZone: CHINA_TZ,
        year: "numeric",
      }).format(d);
    case TM.Month:
      return new Intl.DateTimeFormat("zh-CN", {
        timeZone: CHINA_TZ,
        year: "numeric",
        month: "numeric",
      }).format(d);
    case TM.DayOfMonth:
      return new Intl.DateTimeFormat("zh-CN", {
        timeZone: CHINA_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);
    case TM.TimeWithSeconds:
      return new Intl.DateTimeFormat("zh-CN", {
        timeZone: CHINA_TZ,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(d);
    case TM.Time:
    default:
      return new Intl.DateTimeFormat("zh-CN", {
        timeZone: CHINA_TZ,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(d);
  }
}

let lwChart = null;
let candleSeries = null;
let chartResizeObserver = null;
let chartWs = null;
let chartWsSymbol = null;
let chartWsInterval = null;
let chartWsReconnectTimer = null;
/** 主图标题现价：aggTrade WS + REST 兜底（均独立于 K 线/D1） */
let chartAggWs = null;
let chartAggWsReconnectTimer = null;
let chartHeadlinePollTimer = null;
let chartHeadlineLastWsMsgAt = 0;
let chartHeadlineLastMarketTime = 0;
let chartHeadlineRestInFlight = false;
let chartHeadlineRestGen = 0;
let chartHeadlineWsStallTimer = null;
/** 当前 headline WS 会话内是否收到过 aggTrade（与 REST 兜底无关） */
let chartHeadlineAggSinceOpen = false;
let chartD1PollTimer = null;
let chartD1PollInFlight = false;
let chartD1PollGen = 0;
let chartD1AutoSyncLastAt = 0;
let chartVisibilityRefreshHandler = null;
let chartFocusRefreshHandler = null;
let chartLastWsStatusAt = 0;
/** 行情工作台固定为 BTC U 本位永续；产品范围不包含多标的切换 */
const CHART_SYMBOL = "BTCUSDT";
const CHART_PRODUCT = {
  venue: "BINANCE",
  market: "USDM",
  symbol: "BTCUSDT",
  contractType: "PERPETUAL",
  id: "unconfirmed",
};
const CHART_NATIVE_DATASETS = ["5m", "15m", "1h", "4h", "1d", "1w"];
let currentInterval = readPersistedInterval();
let chartLoadGen = 0;
let chartViewportRangeHandler = null;
let viewportPersistTimer = null;

function chartPricePathOpen() {
  return !!(chartDeskPayload && chartDeskPayload.pricePathAvailable === true && Array.isArray(chartOhlcv) && chartOhlcv.length);
}

function setChartDeskHalt(halted, reason, loading = false) {
  const desk = document.querySelector(".chart-desk");
  const overlay = document.getElementById("chart-empty-desk");
  if (desk) desk.classList.toggle("halted", !!halted);
  if (overlay) {
    overlay.hidden = !halted;
    const title = overlay.querySelector('strong');
    if (title) title.textContent = loading ? '正在读取行情' : '行情暂时读取失败';
    const reasonEl = overlay.querySelector(".desk-halt-reason");
    if (reasonEl) reasonEl.textContent = reason || "币安主源未恢复，主图不可当作行情使用。";
  }
  document.querySelectorAll(".chart-sync-btn, #mtf-toggle, .chart-indicator-panel input, .chart-indicator-panel select, .chart-indicator-panel button").forEach((el) => {
    if (el) el.disabled = !!halted;
  });
  window.__bitDeskChartPricePathAvailable = !halted;
}

/** 当前图表 OHLCV（毫秒 t），供指标与 WS 增量共用 */
let chartOhlcv = [];
let seriesEma = null;
let seriesBbU = null;
let seriesBbM = null;
let seriesBbL = null;
let seriesVwap = null;
let seriesAtr = null;
let chartKeyPriceLines = [];
let indRefreshTimer = null;
let chartStructureRequestId = 0;
const CHART_HIGHER_STRUCTURE_CACHE_MS = 60 * 1000;
const chartHigherStructureCache = new Map();
const chartHigherStructureInFlight = new Map();

const CHART_INDICATORS_KEY = "bitdesk.workbench.indicators";

function defaultIndicatorSettings() {
  return {
    ema: { on: true, period: 20 },
    bb: { on: true, period: 20, mult: 2 },
    atr: { on: false, period: 14 },
    vwap: { on: true },
    rsi: { on: true, period: 14 },
    macd: { on: true, fast: 12, slow: 26, signal: 9 },
    fib: true
  };
}

function readIndicatorSettings() {
  const d = defaultIndicatorSettings();
  try {
    const raw = localStorage.getItem(CHART_INDICATORS_KEY);
    if (!raw) return d;
    const p = JSON.parse(raw);
    return {
      ema: { ...d.ema, ...(p.ema || {}) },
      bb: { ...d.bb, ...(p.bb || {}) },
      atr: { ...d.atr, ...(p.atr || {}) },
      vwap: { ...d.vwap, ...(p.vwap || {}) },
      rsi: { ...d.rsi, ...(p.rsi || {}) },
      macd: { ...d.macd, ...(p.macd || {}) },
      fib: typeof p.fib === "boolean" ? p.fib : p.fib && typeof p.fib.on === "boolean" ? p.fib.on : d.fib
    };
  } catch (_) {
    return d;
  }
}

function writeIndicatorSettings(s) {
  try {
    localStorage.setItem(CHART_INDICATORS_KEY, JSON.stringify(s));
  } catch (_) {}
}

function removeOverlaySeries(ref) {
  if (!ref || !lwChart) return null;
  try {
    lwChart.removeSeries(ref);
  } catch (_) {}
  return null;
}

function disposeIndicatorOverlays() {
  seriesEma = removeOverlaySeries(seriesEma);
  seriesBbU = removeOverlaySeries(seriesBbU);
  seriesBbM = removeOverlaySeries(seriesBbM);
  seriesBbL = removeOverlaySeries(seriesBbL);
  seriesVwap = removeOverlaySeries(seriesVwap);
  seriesAtr = removeOverlaySeries(seriesAtr);
}

function fmtChartLevelPrice(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "--";
  return n >= 1000 ? n.toFixed(0) : n.toFixed(2);
}

function clearChartKeyPriceLines() {
  if (candleSeries) {
    for (const line of chartKeyPriceLines) {
      try { candleSeries.removePriceLine(line); } catch (_) {}
    }
  }
  chartKeyPriceLines = [];
}

function escChartText(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function chartLevelEvidence(row) {
  if (!row) return "";
  const parts = [];
  if (Number.isFinite(Number(row.score))) parts.push(`评分 ${Number(row.score).toFixed(2)}`);
  if (Number.isFinite(Number(row.touches))) parts.push(`${Number(row.touches)} 次触碰`);
  if (Number.isFinite(Number(row.ageBars))) parts.push(`距今 ${Number(row.ageBars)} 根`);
  if (Array.isArray(row.sources) && row.sources.length) parts.push(row.sources.join(" / "));
  if (Array.isArray(row.evidence) && row.evidence.length) {
    const extra = row.evidence
      .filter((item) => !String(item).includes("次触碰") && !String(item).includes("距今"))
      .slice(0, 2);
    if (extra.length) parts.push(extra.join(" / "));
  }
  return parts.join(" · ");
}

function chartFmtLevel(row) {
  return row && Number.isFinite(Number(row.price)) ? fmtChartLevelPrice(row.price) : "--";
}

function renderChartKeyLevelRows(levels, side) {
  if (!levels || !levels.length) {
    return `<div class="chart-key-empty">暂无${side === "resistance" ? "上方压力" : "下方支撑"}候选</div>`;
  }
  const cls = side === "resistance" ? "down" : "up";
  return levels.slice(0, 3).map((row) => {
    const sources = Array.isArray(row.sources) && row.sources.length
      ? row.sources.join(" / ")
      : (row.label || "结构位");
    return `
      <div class="chart-key-row">
        <strong class="${cls}">${fmtChartLevelPrice(row.price)}</strong>
        <span>${escChartText(row.label || (side === "resistance" ? "压力候选" : "支撑候选"))}</span>
        <em>${escChartText(chartLevelEvidence(row) || `${Number(row.touches) || 1} 次 · ${sources}`)}</em>
      </div>
    `;
  }).join("");
}

function chartHigherIntervalFallback(interval) {
  const map = { "5m": "15m", "15m": "1h", "1h": "4h", "4h": "1d", "1d": "3d", "3d": "1w", "1w": null };
  return Object.prototype.hasOwnProperty.call(map, interval) ? map[interval] : null;
}

function resolveChartHigherIntervalForPage(interval) {
  if (
    typeof IndicatorMath !== "undefined" &&
    typeof IndicatorMath.resolveChartHigherInterval === "function"
  ) {
    return IndicatorMath.resolveChartHigherInterval(interval);
  }
  return chartHigherIntervalFallback(String(interval || "").toLowerCase());
}

function chartHigherPendingContext(interval) {
  return {
    interval,
    state: interval ? "上级周期加载中" : "无上级周期",
    alignment: interval ? "加载中" : "中性",
    note: interval ? `正在读取上级 ${interval} K 线。` : "当前已是最高观察周期。",
    rangeContext: null,
  };
}

function updateChartKeyLevelPanel(analysis) {
  const body = document.getElementById("chart-keylevel-body");
  const status = document.getElementById("chart-keylevel-status");
  if (!body) return;
  if (analysis && analysis.confirmationSuppressed) {
    const price = Number(analysis.currentPrice);
    if (status) {
      status.textContent = Number.isFinite(price)
        ? `当前 ${fmtChartLevelPrice(price)} · 不输出已确认信号`
        : "不输出已确认信号";
    }
    body.innerHTML = `<div class="chart-key-empty">研究窗口未合格，或该方法窗口跨缺口、未核实、缺少窗口定义。最新价仍可显示，不输出已确认结构。</div>`;
    return;
  }
  if (!analysis || !Number.isFinite(Number(analysis.currentPrice))) {
    if (status) status.textContent = "等待足够 K 线";
    body.innerHTML = `<div class="chart-key-empty">等待足够 K 线后计算关键价位。</div>`;
    return;
  }
  const rc = analysis.rangeContext;
  const rcOk = rc && Number.isFinite(rc.upper) && Number.isFinite(rc.lower);
  const rangeState = rc && rc.state ? rc.state : "--";
  const rangeText = rcOk ? `${fmtChartLevelPrice(rc.lower)} - ${fmtChartLevelPrice(rc.upper)}` : "--";
  const rangePos = rc && Number.isFinite(Number(rc.positionPct)) ? `${Number(rc.positionPct).toFixed(0)}%` : "--";
  const rangeNote = rc
    ? `${rc.sampleBars || 0}/${rc.windowBars || "--"} 根 · ${rc.sampleState || ""} · 规则分 ${Number.isFinite(Number(rc.confidence)) ? Number(rc.confidence).toFixed(2) : "--"}（非概率） · 位置 ${rangePos}`
    : "";
  const near = analysis.nearContext || {};
  const pressure = near.resistance || (analysis.resistance && analysis.resistance[0]) || null;
  const support = near.support || (analysis.support && analysis.support[0]) || null;
  const breakout = near.breakout || (rc && rc.breakout) || analysis.breakout || null;
  const breakdown = near.breakdown || (rc && rc.breakdown) || analysis.breakdown || null;
  const breakoutText = rcOk && rc.breakout
    ? `${fmtChartLevelPrice(rc.upper)} → ${fmtChartLevelPrice(rc.breakout.price)}`
    : "--";
  const supportText = support
    ? `${chartFmtLevel(support)}（跌破 ${breakdown ? fmtChartLevelPrice(breakdown.price) : "--"}）`
    : "--";
  const pressureText = pressure
    ? `${chartFmtLevel(pressure)} → ${breakout ? fmtChartLevelPrice(breakout.price) : "--"}`
    : "--";
  const extreme = analysis.extremeContext || {};
  const extremeHigh = chartFmtLevel(extreme.recentHigh);
  const extremeLow = chartFmtLevel(extreme.recentLow);
  const prevText = extreme.previousHigh || extreme.previousLow
    ? `前日 ${chartFmtLevel(extreme.previousLow)} - ${chartFmtLevel(extreme.previousHigh)}`
    : "前日高低暂无";
  const higher = analysis.higherContext || null;
  const higherTitle = higher && higher.interval ? `上级 ${higher.interval}` : "上级周期";
  const higherMain = higher ? `${higher.alignment || "--"} · ${higher.state || "--"}` : "等待上级周期";
  const higherNote = higher ? higher.note || "" : "上级周期尚未完成读取。";
  const evidence = rc && Array.isArray(rc.evidence) ? rc.evidence.join(" · ") : "";
  if (status) {
    status.textContent = `周期 ${rangeState} · 近端 ${near.state || analysis.state || "--"} · 当前 ${fmtChartLevelPrice(analysis.currentPrice)} · ATR ${fmtChartLevelPrice(analysis.atr)}`;
  }
  
  // 添加 Fib 摘要
  let fibHtml = "";
  if (analysis.fibonacci && analysis.fibonacci.levels && analysis.fibonacci.levels.length > 0) {
    const meta = analysis.fibonacci.meta;
    let biasText = meta.bias === "upward" ? "向上偏斜" : meta.bias === "downward" ? "向下偏斜" : "中性偏斜";
    let closestLevel = null;
    let minDistance = Infinity;
    const cp = Number(analysis.currentPrice);
    for (const level of analysis.fibonacci.levels) {
      const dist = Math.abs(cp - level.price);
      if (dist < minDistance) {
        minDistance = dist;
        closestLevel = level;
      }
    }
    const closestText = closestLevel ? ` | 临近: Fib ${closestLevel.ratio} (${fmtChartLevelPrice(closestLevel.price)})` : "";
    
    fibHtml = `
    <div class="chart-key-section-hint">Fibonacci</div>
    <div class="chart-key-near">
      <div style="grid-column: 1 / -1;">
        <span>锚点与偏斜</span>
        <strong>Leg: ${meta.leg} · ${biasText}</strong>
        <em>${closestText}</em>
      </div>
    </div>
    `;
  }

  body.innerHTML = `
    <div class="chart-key-focus">
      <div>
        <span>当前状态</span>
        <strong>${escChartText(rangeState)}</strong>
        <em>${escChartText(rangeNote)}</em>
      </div>
      <div>
        <span>结构区间（启发式）</span>
        <strong>${rangeText}</strong>
        <em>${escChartText(evidence || "摆动高低点聚类得到，非盈亏统计意义；孤立极端点在「近极端」单独提示。")}</em>
      </div>
      <div>
        <span>上破观察价</span>
        <strong class="down">${breakoutText}</strong>
        <em>收盘价越过结构上沿再加 ATR 缓冲的规则化名，非开仓建议；刺穿影线不算确认。</em>
      </div>
    </div>
    <div class="chart-key-section-hint">最近支撑 / 压力</div>
    <div class="chart-key-near">
      <div>
        <span>最近压力</span>
        <strong class="down">${pressureText}</strong>
        <em>${escChartText(chartLevelEvidence(pressure) || "暂无上方压力候选")}</em>
      </div>
      <div>
        <span>最近支撑</span>
        <strong class="up">${supportText}</strong>
        <em>${escChartText(chartLevelEvidence(support) || "暂无下方支撑候选")}</em>
      </div>
      <div>
        <span>近端状态</span>
        <strong>${escChartText(near.state || analysis.state || "--")}</strong>
        <em>缓冲 ${fmtChartLevelPrice(analysis.buffer)} USDT</em>
      </div>
    </div>
    <div class="chart-key-section-hint">近极端与上级过滤</div>
    <div class="chart-key-near">
      <div>
        <span>近极端高点</span>
        <strong class="down">${extremeHigh}</strong>
        <em>孤立长影线只在这里提示，不直接决定主区间。</em>
      </div>
      <div>
        <span>近极端低点</span>
        <strong class="up">${extremeLow}</strong>
        <em>${escChartText(prevText)}</em>
      </div>
      <div>
        <span>${escChartText(higherTitle)}</span>
        <strong>${escChartText(higherMain)}</strong>
        <em>${escChartText(higherNote)}</em>
      </div>
    </div>
    ${fibHtml}
    <details class="chart-key-more">
      <summary>更多候选（近端） <span>近端缓冲 ${fmtChartLevelPrice(analysis.buffer)} USDT</span></summary>
      <div class="chart-key-grid">
        <div>
          <div class="chart-key-title">上方压力</div>
          ${renderChartKeyLevelRows(analysis.resistance, "resistance")}
        </div>
        <div>
          <div class="chart-key-title">下方支撑</div>
          ${renderChartKeyLevelRows(analysis.support, "support")}
        </div>
      </div>
    </details>
  `;
}

function chartReferenceAxisLabelsVisible() {
  const host = document.getElementById("chart-container");
  return !host || host.getBoundingClientRect().width >= 600;
}

function syncChartReferenceAxisLabels() {
  const visible = chartReferenceAxisLabelsVisible();
  for (const line of chartKeyPriceLines) line.applyOptions({ axisLabelVisible: visible });
}

function drawChartStructurePriceLines(analysis) {
  clearChartKeyPriceLines();
  if (!analysis || !Number.isFinite(Number(analysis.currentPrice)) || !candleSeries) return;
  const style = typeof LightweightCharts !== "undefined" && LightweightCharts.LineStyle
    ? LightweightCharts.LineStyle.Dashed
    : 2;
  const add = (price, title, color) => {
    if (!Number.isFinite(Number(price))) return;
    try {
      chartKeyPriceLines.push(candleSeries.createPriceLine({
        price: Number(price),
        color,
        lineWidth: 1,
        lineStyle: style,
        axisLabelVisible: chartReferenceAxisLabelsVisible(),
        title,
      }));
    } catch (e) {
      console.warn("[chart] 关键价位线创建失败", e);
    }
  };
  const rc = analysis.rangeContext;
  if (rc && Number.isFinite(Number(rc.upper))) add(rc.upper, "结构上沿（启发式）", "rgba(167,139,250,0.95)");
  if (rc && Number.isFinite(Number(rc.lower))) add(rc.lower, "结构下沿（启发式）", "rgba(45,212,191,0.9)");
  if (rc && rc.breakout && Number.isFinite(Number(rc.breakout.price))) {
    add(rc.breakout.price, "上破观察价", "rgba(249,115,22,0.9)");
  }
  const support = analysis.nearContext && analysis.nearContext.support ? analysis.nearContext.support : null;
  if (support) add(support.price, "近端支撑（候选）", "rgba(16,185,129,0.85)");

  // 画 Fib 临近线
  const enableFib = document.getElementById("chart-indicator-fib") ? document.getElementById("chart-indicator-fib").checked : false;
  if (enableFib && analysis.fibonacci && analysis.fibonacci.levels) {
    // 找出距离当前价最近的 2 条线
    const cp = Number(analysis.currentPrice);
    const sortedLevels = [...analysis.fibonacci.levels].sort((a, b) => {
      return Math.abs(cp - a.price) - Math.abs(cp - b.price);
    });
    const nearestFibs = sortedLevels.slice(0, 2);
    for (const level of nearestFibs) {
      const isRet = level.role === "retracement";
      add(level.price, `Fib ${level.ratio} ${isRet ? "回撤" : "扩展"}`, "rgba(245,158,11,0.6)");
    }
  }

  const hc = analysis.higherContext;
  const hrc = hc && hc.rangeContext ? hc.rangeContext : null;
  const nearDist = Math.max(Number(analysis.atr) || 0, Number(analysis.buffer) || 0) * 1.5;
  if (hrc && Number.isFinite(nearDist) && nearDist > 0) {
    if (Number.isFinite(Number(hrc.upper)) && Math.abs(Number(hrc.upper) - Number(analysis.currentPrice)) <= nearDist) {
      add(hrc.upper, `上级${hc.interval}上沿`, "rgba(148,163,184,0.62)");
    }
    if (Number.isFinite(Number(hrc.lower)) && Math.abs(Number(hrc.lower) - Number(analysis.currentPrice)) <= nearDist) {
      add(hrc.lower, `上级${hc.interval}下沿`, "rgba(148,163,184,0.62)");
    }
  }
}

function computeChartStructureFromRows(klines, interval, atrPeriod) {
  if (
    typeof IndicatorMath !== "undefined" &&
    typeof IndicatorMath.computeChartStructureLevels === "function"
  ) {
    return IndicatorMath.computeChartStructureLevels(klines, {
      interval,
      atrPeriod: Number.isFinite(atrPeriod) ? atrPeriod : 14,
      limit: 6,
    });
  }
  if (
    typeof IndicatorMath !== "undefined" &&
    typeof IndicatorMath.computeKeyLevels === "function"
  ) {
    const legacy = IndicatorMath.computeKeyLevels(klines, {
      lookbackBars: 180,
      limit: 5,
      interval,
      atrPeriod: Number.isFinite(atrPeriod) ? atrPeriod : 14,
    });
    if (legacy) {
      legacy.interval = interval;
      legacy.nearContext = {
        resistance: legacy.resistance && legacy.resistance[0] ? legacy.resistance[0] : null,
        support: legacy.support && legacy.support[0] ? legacy.support[0] : null,
        breakout: legacy.breakout || null,
        breakdown: legacy.breakdown || null,
        state: legacy.state || "",
      };
      legacy.extremeContext = legacy.extremeContext || {};
      legacy.higherContext = null;
    }
    return legacy;
  }
  return null;
}

async function loadHigherChartStructure(baseAnalysis, requestId, atrPeriod) {
  const higherInterval = resolveChartHigherIntervalForPage(currentInterval);
  if (!baseAnalysis || !higherInterval) {
    const merged = {
      ...(baseAnalysis || {}),
      higherContext: chartHigherPendingContext(null),
    };
    if (requestId === chartStructureRequestId) {
      updateChartKeyLevelPanel(merged);
      drawChartStructurePriceLines(merged);
    }
    return;
  }
  const cacheKey = `${CHART_SYMBOL}|${higherInterval}|${atrPeriod || 14}`;
  const cached = chartHigherStructureCache.get(cacheKey);
  const useHigher = (pack) => {
    if (requestId !== chartStructureRequestId || higherInterval !== resolveChartHigherIntervalForPage(currentInterval)) return;
    if (baseAnalysis && baseAnalysis.confirmationSuppressed) {
      updateChartKeyLevelPanel(baseAnalysis);
      return;
    }
    const allowed = !!(pack && chartConfirmationAllowed(pack.desk, pack.rows, higherInterval));
    const higherContext = allowed && typeof IndicatorMath !== "undefined" && typeof IndicatorMath.buildChartHigherContext === "function"
      ? IndicatorMath.buildChartHigherContext(baseAnalysis, pack.analysis)
      : {
          interval: higherInterval,
          state: "不输出已确认信号",
          alignment: "未确认",
          note: "上级周期未形成连续已核实已收盘窗口，不输出已确认结构。",
          rangeContext: null,
        };
    const merged = { ...baseAnalysis, higherContext };
    updateChartKeyLevelPanel(merged);
    if (allowed) drawChartStructurePriceLines(merged);
  };
  if (cached && Date.now() - cached.ts < CHART_HIGHER_STRUCTURE_CACHE_MS) {
    useHigher(cached.pack);
    return;
  }
  if (typeof DataEngine === "undefined" || typeof DataEngine.fetchDesk !== "function") {
    useHigher(null);
    return;
  }
  let pending = chartHigherStructureInFlight.get(cacheKey);
  if (!pending) {
    pending = readChartSwitchWindow(CHART_SYMBOL, higherInterval, false, { priority: 'background' })
      .then((read) => {
        const rows = read.freshTail
          ? mergeDeskRows(read.rows, read.freshTail.rows, read.freshTail.desk.returnedRange || null)
          : read.rows;
        const pack = {
          analysis: computeChartStructureFromRows(rows, higherInterval, atrPeriod),
          desk: read.desk,
          rows,
          interval: higherInterval,
        };
        chartHigherStructureCache.set(cacheKey, { ts: Date.now(), pack });
        return pack;
      })
      .finally(() => {
        chartHigherStructureInFlight.delete(cacheKey);
      });
    chartHigherStructureInFlight.set(cacheKey, pending);
  }
  try {
    useHigher(await pending);
  } catch (e) {
    if (requestId !== chartStructureRequestId) return;
    const merged = {
      ...baseAnalysis,
      higherContext: {
        interval: higherInterval,
        state: "上级周期不可用",
        alignment: "不可用",
        note: `读取上级 ${higherInterval} 失败，先按当前周期观察。`,
        rangeContext: null,
      },
    };
    updateChartKeyLevelPanel(merged);
    drawChartStructurePriceLines(merged);
  }
}

function applyChartKeyLevelsFromOhlcv(klines) {
  const requestId = ++chartStructureRequestId;
  clearChartKeyPriceLines();
  const halt = !(chartDeskPayload && chartDeskPayload.pricePathAvailable === true);
  const price = Array.isArray(klines) && klines.length ? Number(klines[klines.length - 1].c) : NaN;
  if (halt || !candleSeries || typeof IndicatorMath === "undefined" || !Array.isArray(klines) || klines.length === 0) {
    updateChartKeyLevelPanel(null);
    return;
  }
  if (!chartConfirmationAllowed(chartDeskPayload, klines, currentInterval)) {
    updateChartKeyLevelPanel({
      currentPrice: Number.isFinite(price) ? price : null,
      confirmationSuppressed: true,
    });
    return;
  }
  const ind = typeof readIndicatorSettings === "function" ? readIndicatorSettings() : null;
  const atrPeriod = ind && ind.atr ? Number(ind.atr.period) : 14;
  const analysis = computeChartStructureFromRows(klines, currentInterval, atrPeriod);
  if (!analysis || !Number.isFinite(Number(analysis.currentPrice))) {
    updateChartKeyLevelPanel(null);
    return;
  }
  analysis.higherContext = chartHigherPendingContext(resolveChartHigherIntervalForPage(currentInterval));
  updateChartKeyLevelPanel(analysis);
  drawChartStructurePriceLines(analysis);
  loadHigherChartStructure(analysis, requestId, Number.isFinite(atrPeriod) ? atrPeriod : 14);
}

function updateSubchartDomVisibility(s) {
  const rsiW = document.getElementById("chart-pane-rsi-wrap");
  const macdW = document.getElementById("chart-pane-macd-wrap");
  if (rsiW) rsiW.style.display = s.rsi.on ? "block" : "none";
  if (macdW) macdW.style.display = s.macd.on ? "block" : "none";
}

function applyIndicatorsFromOhlcv(klines) {
  if (!lwChart || typeof IndicatorMath === "undefined") return;
  if (!(chartDeskPayload && chartDeskPayload.pricePathAvailable === true) || !Array.isArray(klines) || klines.length === 0) {
    disposeIndicatorOverlays();
    if (typeof IndicatorPanes !== "undefined") {
      if (typeof IndicatorPanes.setTimelineData === "function") {
        IndicatorPanes.setTimelineData([]);
      }
      IndicatorPanes.setRsiData([]);
      IndicatorPanes.setMacdData([], [], []);
    }
    return;
  }

  const s = readIndicatorSettings();
  updateSubchartDomVisibility(s);

  const opts = {
    emaPeriod: Number(s.ema.period) || 20,
    bbPeriod: Number(s.bb.period) || 20,
    bbMult: Number(s.bb.mult) != null ? Number(s.bb.mult) : 2,
    atrPeriod: Number(s.atr.period) || 14,
    rsiPeriod: Number(s.rsi.period) || 14,
    macdFast: Number(s.macd.fast) || 12,
    macdSlow: Number(s.macd.slow) || 26,
    macdSignal: Number(s.macd.signal) || 9,
  };

  const c = IndicatorMath.computeAll(klines, opts);

  if (s.ema.on) {
    if (!seriesEma) {
      seriesEma = lwChart.addLineSeries({
        color: "#e879f9",
        lineWidth: 1,
        title: "EMA",
        priceLineVisible: false,
        lastValueVisible: true,
      });
    }
    seriesEma.setData(c.ema);
  } else {
    seriesEma = removeOverlaySeries(seriesEma);
  }

  if (s.bb.on) {
    if (!seriesBbU) {
      const bbLineOpts = {
        priceLineVisible: false,
        lastValueVisible: false,
        lineWidth: 1,
      };
      seriesBbU = lwChart.addLineSeries({ ...bbLineOpts, color: "rgba(96,165,250,0.85)" });
      seriesBbM = lwChart.addLineSeries({ ...bbLineOpts, color: "rgba(148,163,184,0.55)" });
      seriesBbL = lwChart.addLineSeries({ ...bbLineOpts, color: "rgba(96,165,250,0.85)" });
    }
    seriesBbU.setData(c.bbUpper);
    seriesBbM.setData(c.bbMiddle);
    seriesBbL.setData(c.bbLower);
  } else {
    seriesBbU = removeOverlaySeries(seriesBbU);
    seriesBbM = removeOverlaySeries(seriesBbM);
    seriesBbL = removeOverlaySeries(seriesBbL);
  }

  if (s.vwap.on) {
    if (!seriesVwap) {
      const ls = typeof LightweightCharts !== "undefined" && LightweightCharts.LineStyle
        ? LightweightCharts.LineStyle.Dotted
        : 1;
      seriesVwap = lwChart.addLineSeries({
        color: "#fbbf24",
        lineWidth: 1,
        lineStyle: ls,
        title: "VWAP",
        priceLineVisible: false,
        lastValueVisible: true,
      });
    }
    seriesVwap.setData(c.vwap);
  } else {
    seriesVwap = removeOverlaySeries(seriesVwap);
  }

  if (s.atr.on) {
    if (!seriesAtr) {
      /** ATR 为波动点数（约几十～几百），与 BTC 价格同轴会拖垮主图 autoScale；独立价格刻度 */
      seriesAtr = lwChart.addLineSeries({
        color: "#94a3b8",
        lineWidth: 1,
        title: "ATR",
        priceScaleId: "atr",
        lastValueVisible: true,
        priceLineVisible: false,
      });
      try {
        lwChart.priceScale("atr").applyOptions({
          borderColor: "rgba(197, 203, 206, 0.25)",
        });
      } catch (_) {}
    }
    seriesAtr.setData(c.atr);
  } else {
    seriesAtr = removeOverlaySeries(seriesAtr);
  }

  if (typeof IndicatorPanes !== "undefined") {
    if (typeof IndicatorPanes.setTimelineData === "function") {
      IndicatorPanes.setTimelineData(klines.map((row) => ({ time: row.t / 1000 })));
    }
    if (s.rsi.on) {
      const rsiEl = document.getElementById("chart-pane-rsi");
      if (rsiEl) IndicatorPanes.ensureRsi(rsiEl);
      IndicatorPanes.setRsiData(c.rsi);
    } else {
      IndicatorPanes.destroyRsi();
    }

    if (s.macd.on) {
      const macdEl = document.getElementById("chart-pane-macd");
      if (macdEl) IndicatorPanes.ensureMacd(macdEl);
      IndicatorPanes.setMacdData(c.macdLine, c.macdSignal, c.macdHist);
    } else {
      IndicatorPanes.destroyMacd();
    }

    IndicatorPanes.syncNow();
  }
}

function scheduleIndicatorsRefresh() {
  if (indRefreshTimer != null) clearTimeout(indRefreshTimer);
  indRefreshTimer = setTimeout(() => {
    indRefreshTimer = null;
    if (chartOhlcv.length) {
      applyIndicatorsFromOhlcv(chartOhlcv);
      applyChartKeyLevelsFromOhlcv(chartOhlcv);
    }
  }, 120);
}

function collectIndicatorSettingsFromDom() {
  const q = (name) => document.querySelector(`[data-ind="${name}"]`);
  const n = (name) => {
    const el = document.querySelector(`[data-ind-param="${name}"]`);
    return el ? Number(el.value) : NaN;
  };
  const on = (name) => !!(q(name) && q(name).checked);
  const d = defaultIndicatorSettings();
  return {
    ema: { on: on("ema"), period: n("emaPeriod") || d.ema.period },
    bb: {
      on: on("bb"),
      period: n("bbPeriod") || d.bb.period,
      mult: n("bbMult") || d.bb.mult,
    },
    atr: { on: on("atr"), period: n("atrPeriod") || d.atr.period },
    vwap: { on: on("vwap") },
    rsi: { on: on("rsi"), period: n("rsiPeriod") || d.rsi.period },
    macd: {
      on: on("macd"),
      fast: n("macdFast") || d.macd.fast,
      slow: n("macdSlow") || d.macd.slow,
      signal: n("macdSignal") || d.macd.signal,
    },
    fib: document.getElementById("chart-indicator-fib") ? document.getElementById("chart-indicator-fib").checked : d.fib
  };
}

function bindIndicatorControls() {
  const panel = document.getElementById("chart-indicator-panel");
  if (!panel || panel.dataset.bound) return;
  panel.dataset.bound = "1";
  const onChange = () => {
    const s = collectIndicatorSettingsFromDom();
    writeIndicatorSettings(s);
    updateSubchartDomVisibility(s);
    applyIndicatorsFromOhlcv(chartOhlcv);
    applyChartKeyLevelsFromOhlcv(chartOhlcv);
  };
  panel.addEventListener("change", onChange);
  panel.addEventListener("input", (e) => {
    if (e.target && e.target.getAttribute("data-ind-param")) onChange();
  });
}

function schedulePersistViewport() {
  if (viewportPersistTimer != null) clearTimeout(viewportPersistTimer);
  viewportPersistTimer = setTimeout(() => {
    viewportPersistTimer = null;
    persistViewportNow();
  }, 400);
}

function persistViewportNow() {
  if (!lwChart || !candleSeries) return;
  try {
    const ts = lwChart.timeScale();
    const scrollPosition = ts.scrollPosition();
    const barSpacing = ts.options().barSpacing;
    if (!Number.isFinite(scrollPosition) || !Number.isFinite(barSpacing)) return;
    writeViewportState(CHART_SYMBOL, currentInterval, {
      scrollPosition: Math.max(CHART_MIN_RIGHT_SCROLL_POSITION, scrollPosition),
      barSpacing,
    });
  } catch (_) {}
}

function restoreChartViewport(symbol, interval, gen) {
  const saved = readViewportState(symbol, interval);
  if (!saved || !lwChart) return;
  const apply = () => {
    if (gen !== chartLoadGen || !lwChart) return;
    try {
      const ts = lwChart.timeScale();
      ts.applyOptions({ barSpacing: saved.barSpacing });
      ts.scrollToPosition(Math.max(CHART_MIN_RIGHT_SCROLL_POSITION, saved.scrollPosition), false);
    } catch (e) {
      console.warn("[chart] 恢复视口失败", e);
    }
    if (typeof MtfTiles !== "undefined" && MtfTiles.syncTimeFromMain) {
      try {
        MtfTiles.syncTimeFromMain();
      } catch (_) {}
    }
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(apply);
  });
}

function ensureChartViewportUnloadFlush() {
  if (ensureChartViewportUnloadFlush.done) return;
  ensureChartViewportUnloadFlush.done = true;
  window.addEventListener("beforeunload", () => {
    try {
      persistViewportNow();
    } catch (_) {}
  });
}

function chartIndicatorPanelHtml() {
  const s = readIndicatorSettings();
  const num = (param, val, min, max) =>
    `<input class="chart-control-input" type="number" data-ind-param="${param}" value="${val}" min="${min}" max="${max}" />`;

  return html`
    <div id="chart-indicator-panel" class="chart-indicator-panel chart-indicator-panel--inline">
      <div class="chart-indicator-controls" aria-label="指标设置">
        <span class="chart-indicator-label"><i class="ph ph-sliders-horizontal"></i> 指标</span>
        <span class="chart-ind-control">
          <label><input type="checkbox" data-ind="ema" ${s.ema.on ? "checked" : ""} />EMA</label>
          ${num("emaPeriod", s.ema.period, 2, 500)}
        </span>
        <span class="chart-ind-control">
          <label><input type="checkbox" data-ind="bb" ${s.bb.on ? "checked" : ""} />布林</label>
          ${num("bbPeriod", s.bb.period, 2, 500)}
          <span class="chart-control-sep">x</span>
          ${num("bbMult", s.bb.mult, 0.5, 10)}
        </span>
        <span class="chart-ind-control">
          <label><input type="checkbox" data-ind="atr" ${s.atr.on ? "checked" : ""} />ATR</label>
          ${num("atrPeriod", s.atr.period, 2, 200)}
        </span>
        <span class="chart-ind-control chart-ind-control--single">
          <label title="有成交额时用 quote/base VWAP（M06）；否则显示 HLC3 近似（M07），二者不同名"><input type="checkbox" data-ind="vwap" ${s.vwap.on ? "checked" : ""} />VWAP</label>
        </span>
        <span class="chart-ind-control chart-ind-control--single">
          <label title="斐波那契回撤/扩展（基于启发式结构区间）"><input type="checkbox" id="chart-indicator-fib" data-ind="fib" ${s.fib ? "checked" : ""} />Fib</label>
        </span>
        <span class="chart-ind-control">
          <label><input type="checkbox" data-ind="rsi" ${s.rsi.on ? "checked" : ""} />RSI</label>
          ${num("rsiPeriod", s.rsi.period, 2, 100)}
        </span>
        <span class="chart-ind-control">
          <label><input type="checkbox" data-ind="macd" ${s.macd.on ? "checked" : ""} />MACD</label>
          ${num("macdFast", s.macd.fast, 2, 100)}
          ${num("macdSlow", s.macd.slow, 2, 100)}
          ${num("macdSignal", s.macd.signal, 2, 100)}
        </span>
      </div>
    </div>
  `;
}

function chartKeyLevelPanelHtml() {
  return html`
    <details id="chart-keylevel-panel" class="chart-keylevel-panel" open>
      <summary>
        <span>结构价位</span>
        <em id="chart-keylevel-status">等待行情</em>
      </summary>
      <div id="chart-keylevel-body" class="chart-keylevel-body">
        <div class="chart-key-empty">等待行情样本后更新关键价位。</div>
      </div>
    </details>
  `;
}

function formatChartHeadlinePrice(price) {
  if (!Number.isFinite(price)) return null;
  return price.toFixed(2);
}

function applyChartPrimaryHeadline(symbol, price) {
  const el = document.getElementById("chart-primary-title");
  if (!el) return;
  const s = String(symbol || CHART_SYMBOL).toUpperCase();
  if (!(chartDeskPayload && chartDeskPayload.pricePathAvailable === true)) {
    el.textContent = `${s} —`;
    return;
  }
  const txt = formatChartHeadlinePrice(price);
  el.textContent = txt ? `${s} ${txt}` : `${s} —`;
}

/** Binance 单路 WS 或 stream 组合包均可 */
function chartExtractAggTradePayload(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const inner =
    parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data) ? parsed.data : parsed;
  if (!inner || inner.e !== "aggTrade") return null;
  return inner;
}

function chartTouchHeadlineFromAgg(inner, wantUpper) {
  if (!(chartDeskPayload && chartDeskPayload.pricePathAvailable === true)) return false;
  const s = String(wantUpper || CHART_SYMBOL).toUpperCase();
  if (String(inner.s || "").toUpperCase() !== s) return false;
  const p = parseFloat(inner.p);
  if (!Number.isFinite(p)) return false;
  chartHeadlineLastWsMsgAt = Date.now();
  if (Number.isFinite(Number(inner.T))) chartHeadlineLastMarketTime = Number(inner.T);
  applyChartPrimaryHeadline(s, p);
  return true;
}

function stopChartHeadlineRestPoll() {
  if (chartHeadlinePollTimer) {
    clearInterval(chartHeadlinePollTimer);
    chartHeadlinePollTimer = null;
  }
}

async function chartPollHeadlinePriceRest() {
  if (!(chartDeskPayload && chartDeskPayload.pricePathAvailable === true)) return;
  if (typeof document !== "undefined" && document.hidden) return;
  if (Date.now() - chartHeadlineLastWsMsgAt < CHART_HEADLINE_REST_PAUSE_AFTER_WS_MS) return;
  if (chartHeadlineRestInFlight) return;
  const want = CHART_SYMBOL;
  const gen = ++chartHeadlineRestGen;
  const startedMarketTime = chartHeadlineLastMarketTime;
  const startedWsAt = chartHeadlineLastWsMsgAt;
  chartHeadlineRestInFlight = true;
  const accept = (price, marketTime) => {
    if (gen !== chartHeadlineRestGen) return false;
    if (chartHeadlineLastWsMsgAt > startedWsAt) return false;
    if (Number.isFinite(marketTime) && Number.isFinite(startedMarketTime) && marketTime < startedMarketTime) return false;
    applyChartPrimaryHeadline(want, price);
    if (Number.isFinite(marketTime)) chartHeadlineLastMarketTime = marketTime;
    return true;
  };
  try {
    const restUrls = [
      `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${encodeURIComponent(want)}`,
    ];
    for (const u of restUrls) {
      try {
        const r = await fetch(u, { cache: "no-store", mode: "cors" });
        if (!r.ok) continue;
        const j = await r.json();
        const p = parseFloat(j.price);
        if (Number.isFinite(p) && accept(p, Number(j.time))) return;
      } catch (_) {}
    }
    const tickerProxyBase =
      typeof getBitDataApiBase === "function"
        ? String(getBitDataApiBase()).replace(/\/$/, "")
        : typeof window !== "undefined" && window.BIT_DATA_API_BASE
          ? String(window.BIT_DATA_API_BASE).replace(/\/$/, "")
          : "";
    if (tickerProxyBase) {
      try {
        const r = await fetch(
          `${tickerProxyBase}/api/binance/ticker/price?symbol=${encodeURIComponent(want)}`,
          { cache: "no-store", mode: "cors", credentials: "include" },
        );
        if (!r.ok || r.headers.get("X-Data-Source") !== "binance-fapi-ticker-price") return;
        const j = await r.json();
        const p = parseFloat(j.price);
        if (Number.isFinite(p)) accept(p, Number(j.time));
      } catch (_) {}
    }
  } finally {
    chartHeadlineRestInFlight = false;
  }
}

function startChartHeadlineRestPoll() {
  stopChartHeadlineRestPoll();
  void chartPollHeadlinePriceRest();
  chartHeadlinePollTimer = setInterval(() => void chartPollHeadlinePriceRest(), CHART_HEADLINE_REST_MS);
}

function pageChart() {
  currentInterval = readPersistedInterval();

  const tfButtons = CHART_SUPPORTED_TF.map(tf =>
    `<button class="btn ${tf === currentInterval ? 'primary' : ''} tf-btn" data-tf="${tf}">${tf}</button>`
  ).join("");

  const mtfOptions = CHART_SUPPORTED_TF.map((tf) => `<option value="${tf}">${tf}</option>`).join("");
  const mtfGridInner = [0, 1, 2, 3].map((i) => `
        <div class="mtf-tile" data-idx="${i}">
          <div class="mtf-tile-head">
            <span class="mtf-tile-lbl">子图 ${i + 1}</span>
            <select class="mtf-tf-select" id="mtf-select-${i}">${mtfOptions}</select>
          </div>
          <div class="mtf-tile-body">
            <div class="mtf-tile-wrap" id="mtf-tile-${i}"></div>
          </div>
          <p class="mtf-tile-note" id="mtf-hint-${i}"></p>
        </div>`).join("");

  return html`
    <header class="rd-page-head rd-data-head"><div><div class="rd-eyebrow">MARKET STRUCTURE</div><h1>价格与结构</h1><p>BTCUSDT 永续 · 价格路径、指标与多周期结构。</p></div><a class="btn" href="#/news-analysis">带着证据分析 ↗</a></header>
    <div class="chart-desk">
      <div class="chart-toolbar">
        <div class="chart-tf-group" aria-label="周期切换">
          ${tfButtons}
        </div>
        <div class="chart-action-cluster">
          <span class="chart-live-status" id="chart-status"></span>
          <button type="button" class="btn" data-workbench-export>导出已显示证据</button>
        </div>
      </div>

      <p class="muted" id="chart-research-evidence"></p>

      <section class="chart-primary-panel">
        <div class="chart-primary-head">
          <div class="chart-primary-heading">
            <span>主图</span>
            <strong id="chart-primary-title">BTCUSDT —</strong>
          </div>
          ${chartIndicatorPanelHtml()}
        </div>
        <div id="chart-stack" class="chart-stack">
          <div id="chart-main-wrap" class="chart-main-wrap">
      <div id="chart-empty-desk" class="desk-halt-overlay" hidden>
        <div class="desk-halt-card">
          <strong>行情暂时读取失败</strong>
          <p class="desk-halt-reason">币安主源未恢复，主图不可当作行情使用。</p>
          <p>读取恢复前，暂不据此判断当前走势。</p>
          <button type="button" class="btn" id="chart-read-retry">重新读取行情</button>
        </div>
      </div>

            <div id="chart-container" class="chart-container"></div>
          </div>
          <div id="indicator-subcharts" class="indicator-subcharts">
            <div id="chart-pane-rsi-wrap" class="chart-pane-wrap">
              <div id="chart-pane-rsi" class="chart-pane-surface"></div>
            </div>
            <div id="chart-pane-macd-wrap" class="chart-pane-wrap">
              <div id="chart-pane-macd" class="chart-pane-surface"></div>
            </div>
          </div>
        </div>
      </section>

      <div class="chart-dashboard-grid">
        ${chartKeyLevelPanelHtml()}
      </div>

      <div class="mtf-panel" id="mtf-panel">
        <div class="mtf-head">
          <label class="mtf-toggle-wrap"><input type="checkbox" id="mtf-toggle" />
            多周期联动 <span class="mtf-hint-line">2×2 · 跟随主图可见区间</span></label>
        </div>
        <div class="mtf-grid" id="mtf-grid">
          ${mtfGridInner}
        </div>
      </div>
    </div>
  `;
}

function disposeChartPage() {
  clearChartRecovery();
  if (chartReadAbort) chartReadAbort.abort();
  if (chartPollAbort) chartPollAbort.abort();
  chartPollAbort = null;
  window.__bitDeskSetChartVisible = null;
  chartHistoryReread.inFlight = false;
  chartHistoryReread.again = false;
  chartHistoryReread.converged = false;
  chartD1Meta = null;
  chartDeskPayload = null;
  chartLatestDesk = null;
  chartWindowGapCount = null;
  chartCommittedIdentity = null;
  window.__bitDeskChartPricePathAvailable = false;
  if (lwChart && candleSeries) {
    try {
      persistViewportNow();
    } catch (_) {}
  }
  if (typeof MtfTiles !== "undefined" && MtfTiles.dispose) {
    try {
      MtfTiles.dispose();
    } catch (_) {}
  }
  if (indRefreshTimer != null) {
    clearTimeout(indRefreshTimer);
    indRefreshTimer = null;
  }
  if (viewportPersistTimer != null) {
    clearTimeout(viewportPersistTimer);
    viewportPersistTimer = null;
  }
  if (lwChart && chartViewportRangeHandler) {
    try {
      lwChart.timeScale().unsubscribeVisibleLogicalRangeChange(chartViewportRangeHandler);
    } catch (_) {}
  }
  chartViewportRangeHandler = null;

  if (typeof IndicatorPanes !== "undefined") {
    IndicatorPanes.dispose();
  }
  disposeIndicatorOverlays();
  clearChartKeyPriceLines();
  chartStructureRequestId += 1;
  chartOhlcv = [];

  chartLoadGen += 1;
  closeChartWs();
  closeChartAggTradeWs();
  stopChartHeadlineRestPoll();
  chartHeadlineLastWsMsgAt = 0;
  chartHeadlineAggSinceOpen = false;
  clearChartD1Polling();
  if (chartResizeObserver) {
    try { chartResizeObserver.disconnect(); } catch (_) {}
    chartResizeObserver = null;
  }
  if (lwChart) {
    try { lwChart.remove(); } catch (_) {}
    lwChart = null;
  }
  candleSeries = null;
  seriesEma = null;
  seriesBbU = null;
  seriesBbM = null;
  seriesBbL = null;
  seriesVwap = null;
  seriesAtr = null;
  chartKeyPriceLines = [];
}
window.__bitDeskDisposeChart = disposeChartPage;

function initChart() {
  const container = document.getElementById("chart-container");
  if (!container) return;

  disposeChartPage();

  const chartOptions = {
    layout: {
      textColor: '#d1d5db',
      background: { type: 'solid', color: 'transparent' },
    },
    grid: {
      vertLines: { color: 'rgba(42, 46, 57, 0.5)' },
      horzLines: { color: 'rgba(42, 46, 57, 0.5)' },
    },
    localization: {
      locale: "zh-CN",
      timeFormatter: (time) => {
        const sec = utcSecondsFromChartTime(time);
        if (!Number.isFinite(sec)) return "";
        return chinaDateTimeFull(sec);
      },
    },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    rightPriceScale: { borderColor: 'rgba(197, 203, 206, 0.2)' },
    timeScale: {
      borderColor: 'rgba(197, 203, 206, 0.2)',
      timeVisible: true,
      secondsVisible: false,
      tickMarkMaxCharacterLength: 20,
      tickMarkFormatter: (time, tickMarkType) => {
        const sec = utcSecondsFromChartTime(time);
        if (!Number.isFinite(sec)) return null;
        return chinaTickMarkLabel(sec, tickMarkType);
      },
    },
  };

  lwChart = LightweightCharts.createChart(container, chartOptions);

  candleSeries = lwChart.addCandlestickSeries({
    upColor: '#10b981',
    downColor: '#ef4444',
    borderDownColor: '#ef4444',
    borderUpColor: '#10b981',
    wickDownColor: '#ef4444',
    wickUpColor: '#10b981',
    /** 仅保留最后一根收盘价参考线；叠加指标已全部关闭 priceLine，避免满屏横虚线 */
    priceLineVisible: true,
    priceLineWidth: 1,
    priceLineColor: 'rgba(251,191,36,0.55)',
    priceLineStyle: typeof LightweightCharts !== "undefined" && LightweightCharts.LineStyle
      ? LightweightCharts.LineStyle.Dotted
      : 1,
  });

  chartResizeObserver = new ResizeObserver(entries => {
    if (entries.length === 0 || entries[0].target !== container) return;
    const newRect = entries[0].contentRect;
    lwChart.applyOptions({ height: newRect.height, width: newRect.width });
    syncChartReferenceAxisLabels();
  });
  chartResizeObserver.observe(container);

  ensureChartViewportUnloadFlush();
  chartViewportRangeHandler = () => {
    schedulePersistViewport();
    if (typeof IndicatorPanes !== "undefined") {
      try {
        IndicatorPanes.syncNow();
      } catch (_) {}
    }
    if (typeof MtfTiles !== "undefined" && MtfTiles.syncTimeFromMain) {
      try {
        MtfTiles.syncTimeFromMain();
      } catch (_) {}
    }
  };
  lwChart.timeScale().subscribeVisibleLogicalRangeChange(chartViewportRangeHandler);

  if (typeof IndicatorPanes !== "undefined") {
    IndicatorPanes.bindMain(lwChart);
  }
  if (typeof MtfTiles !== "undefined") {
    MtfTiles.configure({
      mainChart: lwChart,
      getMainInterval: () => currentInterval,
      getMainOhlcv: () => chartOhlcv,
      getSymbol: () => CHART_SYMBOL,
      supportedTfs: CHART_SUPPORTED_TF,
    });
    MtfTiles.initFromDom();
  }
  updateSubchartDomVisibility(readIndicatorSettings());
  bindIndicatorControls();

  const toolbar = document.querySelector(".chart-toolbar");
  if (toolbar && !toolbar.dataset.tfDelegate) {
    toolbar.dataset.tfDelegate = "1";
    toolbar.addEventListener("click", (e) => {
      const tf = e.target.closest(".tf-btn");
      if (!tf) return;
      const next = tf.getAttribute("data-tf");
      if (!next || next === currentInterval) return;
      document.querySelectorAll(".tf-btn").forEach(b => b.classList.remove("primary"));
      tf.classList.add("primary");
      currentInterval = next;
      writePersistedInterval(next);
      loadChartData(CHART_SYMBOL, currentInterval);
    });
  }

  const retryBtn = document.getElementById("chart-read-retry");
  if (retryBtn) retryBtn.onclick = () => void loadChartData(CHART_SYMBOL, currentInterval, { skipAutoSync: true });
  const syncBtn = document.getElementById("chart-cloud-sync");
  if (syncBtn && !syncBtn.dataset.bound) {
    syncBtn.dataset.bound = "1";
    syncBtn.addEventListener("click", async () => {
      syncBtn.disabled = true;
      const statusEl = document.getElementById("chart-status");
      const interval = currentInterval;
      if (statusEl) statusEl.textContent = `正在同步 D1（${interval}）…`;
      try {
        await triggerChartD1Sync(CHART_SYMBOL, interval, "manual");
        if (interval === currentInterval) {
          await loadChartData(CHART_SYMBOL, interval, { skipAutoSync: true, forceFull: true });
        }
      } catch (e) {
        if (statusEl) statusEl.textContent = "同步失败: " + (e && e.message ? e.message : e);
      } finally {
        syncBtn.disabled = false;
      }
    });
  }

  loadChartData(CHART_SYMBOL, currentInterval);
}

function chartWsStateShort() {
  if (!chartWs) return "行情 WS 未连";
  switch (chartWs.readyState) {
    case WebSocket.CONNECTING: return "WS 连接中";
    case WebSocket.OPEN: return chartPricePathOpen() ? "WS OPEN（已有确认帧）" : "WS OPEN";
    case WebSocket.CLOSING: return "WS 关闭中";
    case WebSocket.CLOSED: return "行情 WS 已断";
    default: return "WS ?";
  }
}

function setChartStatusLine(symbol, interval, nBars) {
  const statusEl = document.getElementById("chart-status");
  if (!statusEl) return;
  const meta = chartD1Meta;
  const backend = (chartD1Meta && chartD1Meta.backend) || "";
  const intervalMs =
    typeof DataEngine !== "undefined" && typeof DataEngine.getIntervalMs === "function"
      ? DataEngine.getIntervalMs(interval)
      : 5 * 60 * 1000;

  let d1TimeHint = "未知";
  if (meta && Number.isFinite(meta.latestT) && meta.latestT > 0) {
    const st = Date.now() - meta.latestT;
    const human =
      st < 60_000
        ? `约 ${Math.round(st / 1000)} 秒`
        : st < 3600_000
          ? `约 ${Math.round(st / 60_000)} 分钟`
          : `约 ${Math.round(st / 3600_000)} 小时`;
    /**
     * D1 / 接口里的 latestT 是币安 K 线「开盘时间」毫秒戳。
     * 最后一根往往是进行中的 K：Date.now() - openTime 会在 0～一个周期之间波动，
     * 与是否刚点「同步」无关；同步只保证库里已有这根 K，不会改变它的开盘时刻。
     */
    const lastRow = chartOhlcv.length ? chartOhlcv[chartOhlcv.length - 1] : null;
    const latestRow = lastRow && lastRow.t === meta.latestT ? lastRow : null;
    const finality = latestRow ? String(latestRow.finality || "") : "";
    const declaredClosed = latestRow && (latestRow.closed === true || (latestRow.closed !== false && (finality === "closed" || finality === "exchange_confirmed")));
    const declaredForming = latestRow && (latestRow.closed === false || (latestRow.closed !== true && finality === "forming"));
    const withinBar = Number.isFinite(intervalMs) && intervalMs > 0 && st >= 0 && st < intervalMs;
    const barState = declaredClosed
      ? (barIsVerifiedClosed(latestRow) ? "（已确认收盘）" : "（来源标记已收盘，来源未核实）")
      : declaredForming || withinBar ? "（本根未收盘）" : "";
    d1TimeHint = `末根开盘 ${human}${barState}`;
  }

  const wsShort = chartWsStateShort();
  const src = meta && meta.source === "d1" ? "D1" : "接口";
  const lastSync = meta && meta.lastSync;
  const lastSyncText = typeof lastSync === "string"
    ? lastSync
    : (lastSync && lastSync.last_run) ? String(lastSync.last_run) : "";
  const productLine = chartDeskPayload && chartDeskPayload.pricePathAvailable === true && chartDeskPayload.instrumentId
    ? String(chartDeskPayload.instrumentId)
    : "产品 ID 未确认";
  const requiredBars = interval === "5m" ? 864 : interval === "15m" ? 480 : null;
  const coverage = requiredBars && typeof BitContracts !== "undefined" && BitContracts.coverageForWindow
    ? BitContracts.coverageForWindow(nBars, requiredBars)
    : null;
  const threeD = CHART_NATIVE_DATASETS.indexOf(interval) < 0 ? `${interval} 无独立规范序列，确认信号未启用` : "";
  const legacy = meta && !meta.venue ? "旧K线来源未标 venue，不得补标单所" : "";
  const parts = [
    `${symbol} · ${interval}`,
    productLine,
    `${src} ${d1TimeHint}`,
    wsShort,
    coverage && coverage.ok === false ? `覆盖 ${coverage.available}/${coverage.required}` : "",
    threeD,
    legacy,
    `D1 只读轮询 ${Math.round(CHART_D1_POLL_MS / 1000)}s`,
    backend ? `${backend} Worker` : "",
  ].filter(Boolean);
  const summaryLine = `${symbol} 永续 · ${interval} · ${d1TimeHint}${chartDeskPayload?.pricePathAvailable ? "" : " · 价格路径暂不可用"}`;
  statusEl.textContent = summaryLine;
  statusEl.title = summaryLine;

  const base = typeof getBitDataApiBase === "function"
    ? getBitDataApiBase()
    : (typeof window !== "undefined" && window.BIT_DATA_API_BASE) ? String(window.BIT_DATA_API_BASE) : "";
  const detailBits = [
    base ? `K 线 API: ${base}` : "",
    `${nBars} 根`,
    lastSyncText ? `上次写入 D1: ${lastSyncText}` : "",
    lastSync && lastSync.last_ok === 0 && lastSync.last_error ? `上次同步错误: ${lastSync.last_error}` : "",
    `WS 详情: ${chartWsStateText()}`,
    `浏览器只读 desk 自动刷新间隔: ${Math.round(CHART_D1_POLL_MS / 1000)} 秒；云端 K 线 live collector 按秒写入，打开后若当前周期明显落后会触发一次当前周期同步。`,
    "右上角按钮会调用 /api/d1/sync 同步当前周期，然后重读 D1 缓存；设置页仍用于全周期手动同步。",
    "说明：时间差 = 当前时间 − D1 最后一根 K 的开盘时间（币安字段 t）。进行中 K 线该差值常在 0～一个周期内；若远大于周期，才可能是 D1/Cron 落后。",
    "历史 K 来自币安 U 本位永续，经 Worker 落 D1；图表实时更新为浏览器直连币安 WS。",
  ].filter(Boolean);

  const syncBtn = document.getElementById("chart-cloud-sync");
  if (syncBtn) {
    const manual =
      (syncBtn.dataset && syncBtn.dataset.manualHint) ||
      "触发 Worker 同步当前周期 D1，然后重新读取 Cloudflare D1。";
    syncBtn.title = [manual, summaryLine, detailBits.join("\n")].filter(Boolean).join("\n\n");
  }
}

function chartWsStateText() {
  if (!chartWs) return "未连接";
  switch (chartWs.readyState) {
    case WebSocket.CONNECTING: return "连接中";
    case WebSocket.OPEN: return chartPricePathOpen() ? "已连接（有市场帧）" : "已连接（无确认帧）";
    case WebSocket.CLOSING: return "关闭中";
    case WebSocket.CLOSED: return "已断开";
    default: return "?";
  }
}

function closeChartWs() {
  if (chartWsReconnectTimer) {
    clearTimeout(chartWsReconnectTimer);
    chartWsReconnectTimer = null;
  }
  if (chartWs) {
    try {
      chartWs.onopen = chartWs.onmessage = chartWs.onerror = chartWs.onclose = null;
      chartWs.close();
    } catch (_) {}
    chartWs = null;
  }
  chartWsSymbol = null;
  chartWsInterval = null;
}

function closeChartAggTradeWs() {
  if (chartHeadlineWsStallTimer) {
    clearTimeout(chartHeadlineWsStallTimer);
    chartHeadlineWsStallTimer = null;
  }
  if (chartAggWsReconnectTimer) {
    clearTimeout(chartAggWsReconnectTimer);
    chartAggWsReconnectTimer = null;
  }
  if (chartAggWs) {
    try {
      chartAggWs.onopen = chartAggWs.onmessage = chartAggWs.onerror = chartAggWs.onclose = null;
      chartAggWs.close();
    } catch (_) {}
    chartAggWs = null;
  }
}

/**
 * 主图标题现价：Binance U本位 aggTrade WS + REST 轮询兜底（chartPollHeadlinePriceRest）。
 * 与 kline_{interval} 并行，切换周期时无需重连本条流。
 */
function startChartAggTradeWs(symbol) {
  closeChartAggTradeWs();
  if (typeof WebSocket === "undefined") return;
  if (!(chartDeskPayload && chartDeskPayload.pricePathAvailable === true)) return;

  const want = String(symbol || CHART_SYMBOL).toUpperCase();
  const streamSym = want.toLowerCase();
  const url = `wss://fstream.binance.com/market/ws/${streamSym}@aggTrade`;
  let ws;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    console.warn("[chart] aggTrade WebSocket 创建失败", e);
    return;
  }
  chartAggWs = ws;

  ws.onopen = () => {
    if (ws !== chartAggWs) return;
    chartHeadlineAggSinceOpen = false;
    const opened = ws;
    chartHeadlineWsStallTimer = setTimeout(() => {
      chartHeadlineWsStallTimer = null;
      if (opened !== chartAggWs) return;
      if (chartHeadlineAggSinceOpen) return;
      console.warn("[chart] U本位 aggTrade 长期无成交包，重新连接");
      closeChartAggTradeWs();
      startChartAggTradeWs(CHART_SYMBOL);
    }, CHART_HEADLINE_WS_STALL_SWITCH_MS);
  };

  ws.onmessage = (ev) => {
    if (ws !== chartAggWs) return;
    let raw = null;
    try {
      raw = JSON.parse(ev.data);
    } catch (_) {
      return;
    }
    const inner = chartExtractAggTradePayload(raw);
    if (!inner) return;
    if (chartTouchHeadlineFromAgg(inner, want)) {
      chartHeadlineAggSinceOpen = true;
      if (chartHeadlineWsStallTimer) {
        clearTimeout(chartHeadlineWsStallTimer);
        chartHeadlineWsStallTimer = null;
      }
    }
  };

  ws.onerror = (err) => {
    console.warn("[chart] aggTrade WebSocket 错误", err);
  };

  ws.onclose = () => {
    if (ws !== chartAggWs) return;
    if (chartAggWsReconnectTimer) return;
    chartAggWsReconnectTimer = setTimeout(() => {
      chartAggWsReconnectTimer = null;
      if (lwChart && candleSeries) startChartAggTradeWs(CHART_SYMBOL);
    }, CHART_WS_RECONNECT_MS);
  };
}

function startChartWs(symbol, interval) {
  closeChartWs();
  if (typeof WebSocket === "undefined") return;
  if (!(chartDeskPayload && chartDeskPayload.pricePathAvailable === true)) return;

  const stream = `${symbol.toLowerCase()}@kline_${interval}`;
  const url = `wss://fstream.binance.com/market/ws/${stream}`;
  let ws;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    console.warn("[chart] 创建 WebSocket 失败", e);
    return;
  }
  chartWs = ws;
  chartWsSymbol = symbol;
  chartWsInterval = interval;

  ws.onopen = () => {
    if (symbol !== CHART_SYMBOL || interval !== currentInterval) return;
    setChartStatusLine(symbol, interval, lastRenderedCount);
  };

  ws.onmessage = (ev) => {
    if (ws !== chartWs) return;
    if (symbol !== CHART_SYMBOL || interval !== currentInterval) return;
    if (!candleSeries) return;
    let msg = null;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    const k = msg && msg.k;
    if (!k) return;
    if (!(chartDeskPayload && chartDeskPayload.pricePathAvailable === true)) return;
    const t = Number(k.t);
    const o = parseFloat(k.o);
    const h = parseFloat(k.h);
    const l = parseFloat(k.l);
    const c = parseFloat(k.c);
    if (!Number.isFinite(t) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) return;
    try {
      candleSeries.update({ time: t / 1000, open: o, high: h, low: l, close: c });
      clampChartRightBlank();
    } catch (e) {
      console.warn("[chart] candleSeries.update 失败", e);
    }
    const vol = parseFloat(k.v);
    const quote = parseFloat(k.q);
    const takerBase = parseFloat(k.V);
    const takerQuote = parseFloat(k.Q);
    const row = {
      t,
      o,
      h,
      l,
      c,
      v: Number.isFinite(vol) ? vol : 0,
      q: Number.isFinite(quote) ? quote : null,
      V: Number.isFinite(takerBase) ? takerBase : null,
      Q: Number.isFinite(takerQuote) ? takerQuote : null,
      x: k.x === true,
      eventTime: Number(msg.E) || Number(k.T) || t,
      finality: k.x === true ? "exchange_confirmed" : "forming",
    };
    const idx = chartOhlcv.findIndex((r) => r.t === t);
    if (idx >= 0) chartOhlcv[idx] = row;
    else if (!chartOhlcv.length || t > chartOhlcv[chartOhlcv.length - 1].t) chartOhlcv.push(row);
    if (chartOhlcv.length > 6000) setChartDataFromRows(chartOhlcv);
    lastRenderedCount = chartOhlcv.length;
    scheduleIndicatorsRefresh();
    // WebSocket 更新只代表实时序列，不证明 D1 已同步。
    const now = Date.now();
    if (now - chartLastWsStatusAt > 1000) {
      chartLastWsStatusAt = now;
      setChartStatusLine(symbol, interval, lastRenderedCount);
    }
  };

  ws.onerror = (err) => {
    console.warn(`[chart] WebSocket 错误 ${symbol} ${interval}`, err);
  };

  ws.onclose = (ev) => {
    if (ws !== chartWs) return;
    if (symbol !== CHART_SYMBOL || interval !== currentInterval) return;
    if (chartWsReconnectTimer) return;
    chartWsReconnectTimer = setTimeout(() => {
      chartWsReconnectTimer = null;
      if (symbol === CHART_SYMBOL && interval === currentInterval) {
        startChartWs(symbol, interval);
      }
    }, CHART_WS_RECONNECT_MS);
  };
}

let lastRenderedCount = 0;

let lastMtfReloadAt = 0;
function refreshMtfAfterMainLoad(force = false) {
  if (typeof MtfTiles === "undefined") return;
  if (typeof document !== "undefined" && document.hidden) return;
  if (!force && Date.now() - lastMtfReloadAt < 15_000) return;
  lastMtfReloadAt = Date.now();
  try {
    MtfTiles.reloadAllTileData();
    MtfTiles.syncTimeFromMain();
  } catch (_) {}
}

function getIntervalStepMs(interval) {
  return typeof DataEngine !== "undefined" && typeof DataEngine.getIntervalMs === "function"
    ? DataEngine.getIntervalMs(interval)
    : 5 * 60 * 1000;
}

function chartPageStillCurrent(gen, symbol, interval) {
  if (gen !== chartLoadGen) return false;
  if (symbol !== CHART_SYMBOL || interval !== currentInterval) return false;
  return !!document.getElementById("chart-container");
}

function deskRevision(desk) {
  const revision = Number(desk && desk.historyRevision);
  return Number.isFinite(revision) ? revision : null;
}

function responseStale(symbol, interval, revision, mode) {
  if (revision == null || typeof DataEngine === "undefined" || typeof DataEngine.readDeskHistory !== "function") return false;
  const history = DataEngine.readDeskHistory(symbol, interval);
  if (history.confirmedRevision != null && revision < history.confirmedRevision) return true;
  if (mode !== "tail" && history.pendingRevision != null && revision < history.pendingRevision) return true;
  return false;
}

function chartMethodWindowBars(interval) {
  if (!CHART_SUPPORTED_TF.includes(String(interval || ""))) return null;
  if (typeof IndicatorMath === "undefined" || typeof IndicatorMath.resolveRangeIntervalConfig !== "function") return null;
  const cfg = IndicatorMath.resolveRangeIntervalConfig(interval);
  const bars = Number(cfg && cfg.windowBars);
  return Number.isFinite(bars) && bars > 0 ? bars : null;
}

function barIsVerifiedClosed(row) {
  if (!row || row.sourceVerification !== "verified") return false;
  if (row.closed === true) return true;
  if (row.closed === false) return false;
  const finality = String(row.finality || "");
  return finality === "closed" || finality === "exchange_confirmed";
}

function continuousVerifiedClosedCount(rows, interval) {
  const step = getIntervalStepMs(interval);
  if (!Array.isArray(rows) || !rows.length || !step) return 0;
  let end = rows.length - 1;
  while (end >= 0 && !barIsVerifiedClosed(rows[end])) end -= 1;
  let count = 0;
  for (let i = end; i >= 0; i -= 1) {
    if (!barIsVerifiedClosed(rows[i])) break;
    if (i < end && Number(rows[i + 1].t) - Number(rows[i].t) !== step) break;
    count += 1;
  }
  return count;
}

function countReportedGaps(gaps) {
  if (Array.isArray(gaps)) return gaps.length;
  const count = Number(gaps);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function chartConfirmationAllowed(desk, rows, interval) {
  const need = chartMethodWindowBars(interval);
  if (need == null) return false;
  if (continuousVerifiedClosedCount(rows, interval) >= need) return true;
  const research = desk && desk.researchWindow;
  const coverage = desk && desk.coverage;
  const serverGaps = countReportedGaps(coverage && coverage.inWindowGaps);
  if (!(research && research.eligible === true && serverGaps === 0 && Array.isArray(rows) && rows.length >= need)) return false;
  if (countSeriesGaps(rows, interval) > 0) return false;
  if (rows.some((row) => row && row.sourceVerification === "unverified")) return false;
  return true;
}

function countSeriesGaps(rows, interval) {
  const step = getIntervalStepMs(interval);
  if (!step || !Array.isArray(rows) || rows.length < 2) return 0;
  let gaps = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const delta = Number(rows[i].t) - Number(rows[i - 1].t);
    if (delta > step) gaps += Math.max(1, Math.round(delta / step) - 1);
  }
  return gaps;
}

function countVerification(rows) {
  let verified = 0;
  let unverified = 0;
  (rows || []).forEach((row) => {
    if (row && row.sourceVerification === "verified") verified += 1;
    else unverified += 1;
  });
  return { verified, unverified };
}

function renderChartEvidence(symbol, interval, extra) {
  const el = document.getElementById("chart-research-evidence");
  if (!el) return;
  const loaded = Array.isArray(chartOhlcv) ? chartOhlcv.length : 0;
  if (extra && extra.failure) {
    el.textContent = [
      symbol,
      interval,
      "读取失败",
      String(extra.failure),
      "未把失败画成已核实空历史",
      loaded ? `仍显示已加载 ${loaded} 根` : "当前没有已提交窗口",
    ].join(" · ");
    return;
  }
  const committed = chartDeskPayload;
  const latest = chartLatestDesk || committed;
  const product = committed && committed.instrumentId
    ? String(committed.instrumentId)
    : (CHART_PRODUCT.id || "未确认");
  const counts = countVerification(chartOhlcv);
  const range = latest && latest.returnedRange;
  const rangeText = range && Number.isFinite(Number(range.from)) && Number.isFinite(Number(range.to))
    ? `返回范围 ${Number(range.from)}–${Number(range.to)}`
    : "返回范围未知";
  const scope = latest && latest.coverageScope === "tail" ? "本次尾部" : "窗口";
  const returned = latest && latest.coverage && latest.coverage.returned != null
    ? `本次返回 ${latest.coverage.returned} 根`
    : "";
  const gaps = chartWindowGapCount != null ? chartWindowGapCount : countSeriesGaps(chartOhlcv, interval);
  const price = committed && committed.pricePathAvailable === true ? "价格路径可用" : "价格路径不可用";
  const research = committed && committed.researchWindow;
  const researchText = research && research.eligible === true
    ? "研究窗口合格"
    : research && research.eligible === false
      ? `研究窗口不合格${research.reason ? "：" + research.reason : ""}`
      : "研究窗口未知";
  el.textContent = [
    product,
    interval,
    scope,
    rangeText,
    returned,
    `已核实 ${counts.verified} 根`,
    `未核实 ${counts.unverified} 根`,
    `窗内缺口 ${gaps}`,
    price,
    researchText,
    `已加载 ${loaded} 根`,
    latest && latest.coverageScope === "tail" ? "尾部返回不是全历史总数" : "",
  ].filter(Boolean).join(" · ");
}

function rememberChartMeta(symbol, interval, desk, rows) {
  const latest = rows.length ? Number(rows[rows.length - 1].t) : 0;
  chartD1Meta = {
    symbol,
    interval,
    count: rows.length,
    latestT: latest,
    lastSync: desk.storedAt || desk.receivedAt || null,
    source: "desk",
    venue: desk.venue || null,
    backend: typeof getBitDataApiBase === "function" ? new URL(getBitDataApiBase()).host : "",
    receivedAt: Date.now(),
    pricePathAvailable: desk.pricePathAvailable === true,
    gap: desk.gap || null,
    instrumentId: desk.instrumentId || null,
  };
}

function maybeConfirmChartHistory(symbol, interval, revision) {
  if (revision == null || typeof DataEngine === "undefined" || typeof DataEngine.confirmDeskHistory !== "function") return;
  const history = DataEngine.readDeskHistory(symbol, interval);
  if (history.pendingRevision != null && revision < history.pendingRevision) {
    scheduleChartHistoryReread(symbol, interval);
    return;
  }
  DataEngine.confirmDeskHistory(symbol, interval, revision);
  chartHistoryReread.failures = 0;
  chartHistoryReread.nextAttemptAt = 0;
}

function scheduleChartHistoryReread(symbol, interval) {
  if (typeof DataEngine === "undefined" || typeof DataEngine.readDeskHistory !== "function") return;
  const history = DataEngine.readDeskHistory(symbol, interval);
  if (history.pendingRevision == null) return;
  if (history.confirmedRevision != null && history.pendingRevision <= history.confirmedRevision) return;
  if (!chartPageStillCurrent(chartLoadGen, symbol, interval)) return;
  if (chartHistoryReread.inFlight) {
    chartHistoryReread.again = true;
    return;
  }
  if (chartHistoryReread.nextAttemptAt && Date.now() < chartHistoryReread.nextAttemptAt) return;
  void runChartHistoryReread(symbol, interval, chartLoadGen);
}

async function runChartHistoryReread(symbol, interval, gen) {
  if (chartHistoryReread.inFlight) {
    chartHistoryReread.again = true;
    return;
  }
  if (!chartOhlcv.length || !chartPageStillCurrent(gen, symbol, interval)) return;
  const from = chartOhlcv[0].t;
  const step = getIntervalStepMs(interval);
  const to = chartOhlcv[chartOhlcv.length - 1].t + (step > 0 ? step : 1);
  chartHistoryReread.inFlight = true;
  chartHistoryReread.again = false;
  try {
    const read = await readChartD1Klines(symbol, interval, 6000, { from, to, sync: "0" });
    if (!chartPageStillCurrent(gen, symbol, interval)) return;
    const revision = deskRevision(read.desk);
    const pending = DataEngine.readDeskHistory(symbol, interval).pendingRevision;
    if (responseStale(symbol, interval, revision, "reread") || (pending != null && revision != null && revision < pending)) {
      chartHistoryReread.again = true;
      return;
    }
    if (!(read.desk && read.desk.pricePathAvailable === true) || !read.rows.length) {
      throw new Error("完整窗口没有可提交的价格路径");
    }
    if (!applyCommittedDesk(read, { mode: "reread", symbol, interval, preserveViewport: true })) return;
    const latestPending = DataEngine.readDeskHistory(symbol, interval).pendingRevision;
    if (revision != null && (latestPending == null || revision >= latestPending)) {
      maybeConfirmChartHistory(symbol, interval, revision);
    } else {
      chartHistoryReread.again = true;
    }
  } catch (error) {
    if (error && error.name === "AbortError") return;
    if (!chartPageStillCurrent(gen, symbol, interval)) return;
    chartHistoryReread.failures += 1;
    const delay = Math.min(
      CHART_HISTORY_REREAD_MAX_MS,
      CHART_HISTORY_REREAD_BASE_MS * Math.pow(2, Math.max(0, chartHistoryReread.failures - 1)),
    );
    chartHistoryReread.nextAttemptAt = Date.now() + delay;
    if (chartPageStillCurrent(gen, symbol, interval)) {
      renderChartEvidence(symbol, interval, { failure: error && error.message ? error.message : "历史窗口重读失败" });
    }
  } finally {
    // An aborted old period can settle after a new period has started its own
    // history read. Only the current owner may release that read's state.
    if (chartPageStillCurrent(gen, symbol, interval)) {
      const again = chartHistoryReread.again === true && chartHistoryReread.converged !== true;
      chartHistoryReread.inFlight = false;
      chartHistoryReread.again = false;
      if (again) {
        chartHistoryReread.converged = true;
        chartHistoryReread.nextAttemptAt = 0;
        void runChartHistoryReread(symbol, interval, gen);
      } else {
        chartHistoryReread.converged = false;
      }
    }
  }
}

function normalizeKlineRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((d) => ({
      t: Number(d.t),
      o: parseFloat(d.o),
      h: parseFloat(d.h),
      l: parseFloat(d.l),
      c: parseFloat(d.c),
      v: Number(d.v) || 0,
      q: d.q == null && d.quoteVolume == null ? null : Number(d.q != null ? d.q : d.quoteVolume),
      V: d.V == null && d.takerBuyBase == null ? null : Number(d.V != null ? d.V : d.takerBuyBase),
      x: d.x === true,
      venue: d.venue || null,
      source: d.source || (d.venue ? d.venue : null),
      origin: d.origin === "canonical" || d.origin === "raw-tape" ? d.origin : null,
      sourceVerification: d.sourceVerification === "verified" || d.sourceVerification === "unverified" ? d.sourceVerification : null,
      effectiveReceivedAt: d.effectiveReceivedAt == null ? null : d.effectiveReceivedAt,
      closed: d.closed === true ? true : d.closed === false ? false : null,
      finality: d.finality || (d.x === true ? "exchange_confirmed" : d.x === false ? "forming" : "unknown"),
    }))
    .filter((d) =>
      Number.isFinite(d.t) &&
      Number.isFinite(d.o) &&
      Number.isFinite(d.h) &&
      Number.isFinite(d.l) &&
      Number.isFinite(d.c)
    )
    .sort((a, b) => a.t - b.t);
}

/**
 * 与当前周期合并时，只接受「开盘时间」落在该周期栅格上的 K（与 DataEngine.getIntervalMs + floor 一致）。
 * 用于丢弃切换周期后残留的低周期 WS 行，避免末尾出现 5m/15m 混在 15m/1h 等主图上的情况。
 * 3d / 1w 的币安对齐与简单 floor 不一致，仍以切换周期时的内存清空与同档 WS 为准，此处放行。
 */
function klineOpenMatchesActiveInterval(tMs, interval) {
  if (!Number.isFinite(tMs) || interval == null) return false;
  const iv = String(interval);
  if (iv === "3d" || iv === "1w") return true;
  const step =
    typeof DataEngine !== "undefined" && typeof DataEngine.getIntervalMs === "function"
      ? DataEngine.getIntervalMs(iv)
      : 0;
  if (!step || step <= 0) return true;
  return Math.floor(Number(tMs) / step) * step === Number(tMs);
}

function mergeDeskRows(existing, incoming, range) {
  const incomingRows = normalizeKlineRows(incoming);
  const byTime = new Map();
  const hasRange = range && Number.isFinite(Number(range.from)) && Number.isFinite(Number(range.to));
  const from = hasRange ? Number(range.from) : NaN;
  const to = hasRange ? Number(range.to) : NaN;
  normalizeKlineRows(existing).forEach((row) => {
    if (hasRange && row.t >= from && row.t < to) return;
    byTime.set(row.t, row);
  });
  incomingRows.forEach((row) => {
    if (hasRange && (row.t < from || row.t >= to)) return;
    byTime.set(row.t, row);
  });
  // A bounded response replaces its whole range, including removed trailing bars.
  // Rows outside that range (including a newer live tail) were retained above.
  return Array.from(byTime.values()).sort((a, b) => a.t - b.t).slice(-6000);
}

function commitChartSeries(rows, opts) {
  let logical = null;
  let barSpacing = null;
  const preserve = !!(opts && opts.preserveViewport);
  if (preserve && lwChart) {
    try {
      const ts = lwChart.timeScale();
      logical = ts.getVisibleLogicalRange();
      barSpacing = ts.options().barSpacing;
    } catch (_) {}
  }
  chartOhlcv = rows.slice(-6000);
  const chartData = chartOhlcv.map((d) => ({
    time: d.t / 1000,
    open: d.o,
    high: d.h,
    low: d.l,
    close: d.c,
  }));
  if (candleSeries) candleSeries.setData(chartData);
  lastRenderedCount = chartData.length;
  if (preserve && lwChart && logical && Number.isFinite(Number(logical.from)) && Number.isFinite(Number(logical.to))) {
    try {
      const ts = lwChart.timeScale();
      if (Number.isFinite(barSpacing)) ts.applyOptions({ barSpacing });
      ts.setVisibleLogicalRange(logical);
    } catch (_) {}
  }
  clampChartRightBlank();
  try { applyIndicatorsFromOhlcv(chartOhlcv); } catch (error) { console.warn("[chart] 指标绘制失败", error); }
  try { applyChartKeyLevelsFromOhlcv(chartOhlcv); } catch (error) { console.warn("[chart] 结构绘制失败", error); }
  return chartData.length;
}

function setChartDataFromRows(rows) {
  return commitChartSeries(normalizeKlineRows(rows), { preserveViewport: true });
}

function applyCommittedDesk(read, ctx) {
  const desk = read && read.desk ? read.desk : {};
  const revision = deskRevision(desk);
  if (responseStale(ctx.symbol, ctx.interval, revision, ctx.mode)) return false;
  const same = !!(chartCommittedIdentity
    && chartCommittedIdentity.symbol === ctx.symbol
    && chartCommittedIdentity.interval === ctx.interval);
  if (ctx.mode === "tail") {
    if (!same || !chartOhlcv.length || !read.rows.length || desk.pricePathAvailable !== true) return false;
    const rows = mergeDeskRows(chartOhlcv, read.rows, desk.returnedRange || null);
    chartLatestDesk = desk;
    commitChartSeries(rows, { preserveViewport: true });
    const last = chartOhlcv[chartOhlcv.length - 1];
    if (last) applyChartPrimaryHeadline(ctx.symbol, last.c);
    renderChartEvidence(ctx.symbol, ctx.interval);
    setChartStatusLine(ctx.symbol, ctx.interval, chartOhlcv.length);
    publishChartEvidence(null);
    return true;
  }
  if (desk.pricePathAvailable !== true || !read.rows.length) return false;
  const rows = ctx.mode === "reread" && same
    ? mergeDeskRows(chartOhlcv, read.rows, desk.returnedRange || null)
    : normalizeKlineRows(read.rows).slice(-6000);
  chartDeskPayload = desk;
  chartLatestDesk = desk;
  chartWindowGapCount = desk.coverage && desk.coverageScope !== "tail" && desk.coverage.inWindowGaps != null
    ? countReportedGaps(desk.coverage.inWindowGaps)
    : countSeriesGaps(rows, ctx.interval);
  window.__bitDeskChartPricePathAvailable = true;
  if (desk.instrumentId) {
    CHART_PRODUCT.id = String(desk.instrumentId);
    CHART_PRODUCT.venue = desk.venue || CHART_PRODUCT.venue;
  }
  chartCommittedIdentity = { symbol: ctx.symbol, interval: ctx.interval };
  rememberChartMeta(ctx.symbol, ctx.interval, desk, rows);
  commitChartSeries(rows, { preserveViewport: !!(ctx.preserveViewport && same) });
  const last = chartOhlcv[chartOhlcv.length - 1];
  if (last) applyChartPrimaryHeadline(ctx.symbol, last.c);
  setChartDeskHalt(false, "");
  renderChartEvidence(ctx.symbol, ctx.interval);
  setChartStatusLine(ctx.symbol, ctx.interval, chartOhlcv.length);
  publishChartEvidence(null);
  return true;
}

function publishChartEvidence(failure) {
  if (typeof WorkbenchEvidence === "undefined") return;
  const desk = chartLatestDesk || chartDeskPayload || {};
  const committed = chartDeskPayload || desk;
  const rows = chartOhlcv || [];
  const step = getIntervalStepMs(currentInterval);
  const displayedWindow = rows.length ? {
    from: Number(rows[0].t),
    to: Number(rows[rows.length - 1].t) + (step > 0 ? step : 1),
  } : null;
  if (failure && !chartOhlcv.length) {
    WorkbenchEvidence.commitFailure("chart", { at: new Date().toISOString(), message: String(failure) });
    return;
  }
  WorkbenchEvidence.commitDisplayed("chart", {
    sourceId: "binance-usdm-klines",
    displayedAt: new Date().toISOString(),
    readAt: desk.asOf || null,
    asOf: desk.asOf || null,
    parameters: { symbol: CHART_SYMBOL, interval: currentInterval },
    contentRevision: desk.inputRevision || null,
    historyRevision: desk.historyRevision == null ? null : desk.historyRevision,
    committedHistoryRevision: committed.historyRevision == null ? null : committed.historyRevision,
    window: displayedWindow,
    latestReadWindow: desk.returnedRange || null,
    coverageWindow: committed.returnedRange || null,
    gaps: committed.coverage ? committed.coverage.inWindowGaps || [] : [],
    units: desk.units || { price: "USDT/BTC" },
    researchWindow: committed.researchWindow || null,
    pricePathAvailable: desk.pricePathAvailable === true,
    series: (chartOhlcv || []).map((row) => ({
      t: row.t, o: row.o, h: row.h, l: row.l, c: row.c, v: row.v,
      sourceVerification: row.sourceVerification || "unverified",
      origin: row.origin || "raw-tape",
      closed: row.closed == null ? null : row.closed,
      finality: row.finality || null,
    })),
    stale: !!failure,
    failure: failure ? { at: new Date().toISOString(), message: String(failure) } : null,
  });
}

function paintChartFailure(symbol, interval, message, gen) {
  if (!chartPageStillCurrent(gen, symbol, interval)) return;
  const same = !!(chartCommittedIdentity
    && chartCommittedIdentity.symbol === symbol
    && chartCommittedIdentity.interval === interval
    && chartOhlcv.length);
  if (!same) {
    chartOhlcv = [];
    lastRenderedCount = 0;
    if (candleSeries) {
      try { candleSeries.setData([]); } catch (_) {}
    }
    chartDeskPayload = null;
    chartLatestDesk = null;
    chartWindowGapCount = null;
    chartCommittedIdentity = null;
    window.__bitDeskChartPricePathAvailable = false;
    CHART_PRODUCT.id = "unconfirmed";
    setChartDeskHalt(true, message);
    applyChartPrimaryHeadline(symbol, NaN);
    applyIndicatorsFromOhlcv([]);
    applyChartKeyLevelsFromOhlcv([]);
  }
  const statusEl = document.getElementById("chart-status");
  if (statusEl) {
    statusEl.textContent = same
      ? `读取失败 · 仍显示已加载 ${chartOhlcv.length} 根`
      : `行情读取失败: ${message}`;
  }
  renderChartEvidence(symbol, interval, { failure: message });
  publishChartEvidence(message);
  closeChartWs();
  closeChartAggTradeWs();
  stopChartHeadlineRestPoll();
}

function clearChartD1Polling() {
  chartD1PollGen += 1;
  chartD1PollInFlight = false;
  chartPollFailures = 0;
  chartPollNextAttemptAt = 0;
  if (chartD1PollTimer) {
    clearInterval(chartD1PollTimer);
    chartD1PollTimer = null;
  }
  if (chartPollAbort) {
    chartPollAbort.abort();
    chartPollAbort = null;
  }
  window.__bitDeskSetChartVisible = null;
  if (chartVisibilityRefreshHandler) {
    try { document.removeEventListener("visibilitychange", chartVisibilityRefreshHandler); } catch (_) {}
    chartVisibilityRefreshHandler = null;
  }
  if (chartFocusRefreshHandler) {
    try { window.removeEventListener("focus", chartFocusRefreshHandler); } catch (_) {}
    chartFocusRefreshHandler = null;
  }
}

function pauseChartLiveReads() {
  if (typeof MtfTiles !== 'undefined' && MtfTiles.cancelReads) MtfTiles.cancelReads();
  const active = !!(chartD1PollTimer || chartD1PollInFlight || chartPollAbort || chartHeadlinePollTimer);
  if (chartD1PollTimer) {
    clearInterval(chartD1PollTimer);
    chartD1PollTimer = null;
  }
  stopChartHeadlineRestPoll();
  if (!active) return;
  chartD1PollGen += 1;
  chartD1PollInFlight = false;
  if (chartPollAbort) {
    chartPollAbort.abort();
    chartPollAbort = null;
  }
}

function resumeChartLiveReads() {
  if (!lwChart || !candleSeries) return;
  if (typeof document !== "undefined" && document.hidden) return;
  chartPollNextAttemptAt = 0;
  if (!chartD1PollTimer) {
    chartD1PollTimer = setInterval(() => queueD1Poll("timer"), CHART_D1_POLL_MS);
  }
  queueD1Poll("visible");
  if (chartPricePathOpen() && !chartHeadlinePollTimer) startChartHeadlineRestPoll();
}

function queueD1Poll() {
  if (!lwChart || !candleSeries) return;
  if (chartD1PollInFlight) return;
  if (Date.now() < chartPollNextAttemptAt) return;
  if (typeof document !== "undefined" && document.hidden) return;
  const symbol = CHART_SYMBOL;
  const interval = currentInterval;
  const loadGen = chartLoadGen;
  const myGen = chartD1PollGen;
  if (!chartPageStillCurrent(loadGen, symbol, interval)) return;
  chartPollAbort = new AbortController();
  const signal = chartPollAbort.signal;
  chartD1PollInFlight = true;
  readChartD1Klines(symbol, interval, CHART_D1_POLL_LIMIT, { sync: "0", tail: CHART_D1_POLL_LIMIT, signal })
    .then((read) => {
      if (myGen !== chartD1PollGen || !chartPageStillCurrent(loadGen, symbol, interval)) return;
      chartPollFailures = 0;
      chartPollNextAttemptAt = 0;
      acceptChartTail(read, loadGen, symbol, interval);
      refreshMtfAfterMainLoad();
    })
    .catch((error) => {
      if (error && error.name === "AbortError") return;
      console.warn("[chart] 自动读取 D1 失败", error);
      if (myGen !== chartD1PollGen || !chartPageStillCurrent(loadGen, symbol, interval)) return;
      const delay = Math.min(30000, 2000 * Math.pow(2, Math.min(4, chartPollFailures++)));
      const denied = [400, 401, 403, 404].includes(error && error.status);
      chartPollNextAttemptAt = denied ? Infinity : Date.now() + delay;
      const message = (error && error.message ? error.message : "尾部读取失败")
        + (denied ? ' · 请检查访问设置后重新读取' : ` · 保留历史，${delay / 1000} 秒后重试`);
      renderChartEvidence(symbol, interval, { failure: message });
      setChartStatusLine(symbol, interval, lastRenderedCount);
      publishChartEvidence(message);
    })
    .finally(() => {
      if (myGen === chartD1PollGen) chartD1PollInFlight = false;
    });
}

function acceptChartTail(read, gen, symbol, interval) {
  if (!chartPageStillCurrent(gen, symbol, interval)) return;
  const revision = deskRevision(read && read.desk);
  if (responseStale(symbol, interval, revision, "tail")) return;
  if (!applyCommittedDesk(read, { mode: "tail", symbol, interval, preserveViewport: true })) return;
  if (revision == null || typeof DataEngine === "undefined" || typeof DataEngine.noteDeskHistoryPending !== "function") return;
  const note = DataEngine.noteDeskHistoryPending(symbol, interval, revision);
  if (note.pendingRevision != null && (note.confirmedRevision == null || note.pendingRevision > note.confirmedRevision)) {
    scheduleChartHistoryReread(symbol, interval);
  }
}

function startChartD1Polling() {
  clearChartD1Polling();
  chartD1PollGen += 1;
  window.__bitDeskSetChartVisible = (visible) => {
    if (!document.getElementById("chart-container")) return;
    if (visible) resumeChartLiveReads();
    else pauseChartLiveReads();
  };
  chartVisibilityRefreshHandler = () => {
    if (document.hidden) pauseChartLiveReads();
    else resumeChartLiveReads();
  };
  chartFocusRefreshHandler = () => {
    if (document.hidden) return;
    queueD1Poll();
  };
  try { document.addEventListener("visibilitychange", chartVisibilityRefreshHandler); } catch (_) {}
  try { window.addEventListener("focus", chartFocusRefreshHandler); } catch (_) {}
  if (typeof document !== "undefined" && document.hidden) return;
  chartD1PollTimer = setInterval(() => queueD1Poll(), CHART_D1_POLL_MS);
}

function shouldAutoSyncChartD1(interval, rows) {
  if (typeof document !== "undefined" && document.hidden) return false;
  if (Date.now() - chartD1AutoSyncLastAt < CHART_D1_AUTO_SYNC_COOLDOWN_MS) return false;
  if (!Array.isArray(rows) || rows.length === 0) return true;
  const meta = chartD1Meta;
  const staleMs = meta && meta.latestT > 0 ? Date.now() - meta.latestT : NaN;
  const step = getIntervalStepMs(interval);
  if (!Number.isFinite(staleMs) || !Number.isFinite(step) || step <= 0) return false;
  const grace = Math.max(step * CHART_D1_AUTO_SYNC_STALE_BARS, step + 2 * 60 * 1000);
  return staleMs > grace;
}

async function triggerChartD1Sync(symbol, interval, reason) {
  if (typeof DataEngine === "undefined" || typeof DataEngine.triggerCloudSync !== "function") {
    throw new Error("数据引擎未加载，无法触发 D1 同步");
  }
  const statusEl = document.getElementById("chart-status");
  if (statusEl) {
    const label = reason === "auto" ? "检测到 D1 落后，正在自动同步" : "正在同步";
    statusEl.textContent = `${label} ${symbol} ${interval} D1…`;
  }
  return DataEngine.triggerCloudSync(symbol, interval, true, { timeoutMs: CHART_D1_SYNC_TIMEOUT_MS });
}

async function maybeAutoSyncChartD1AfterRead(symbol, interval, loadGen) {
  if (!chartPageStillCurrent(loadGen, symbol, interval)) return;
  if (!shouldAutoSyncChartD1(interval, chartOhlcv)) return;
  chartD1AutoSyncLastAt = Date.now();
  try {
    await triggerChartD1Sync(symbol, interval, "auto");
    if (!chartPageStillCurrent(loadGen, symbol, interval)) return;
    const read = await readChartD1Klines(symbol, interval, 6000, { sync: "0" });
    if (!chartPageStillCurrent(loadGen, symbol, interval)) return;
    if (responseStale(symbol, interval, deskRevision(read.desk), "full")) return;
    if (!applyCommittedDesk(read, { mode: "full", symbol, interval, preserveViewport: true })) {
      renderChartEvidence(symbol, interval, { failure: "同步后没有可提交窗口" });
      return;
    }
    maybeConfirmChartHistory(symbol, interval, deskRevision(read.desk));
    refreshMtfAfterMainLoad();
  } catch (error) {
    if (error && error.name === "AbortError") return;
    console.warn("[chart] 自动同步 D1 失败", error);
    if (chartPageStillCurrent(loadGen, symbol, interval)) {
      renderChartEvidence(symbol, interval, { failure: error && error.message ? error.message : "自动同步失败" });
      setChartStatusLine(symbol, interval, lastRenderedCount);
    }
  }
}

async function loadChartData(symbol, interval, opts = {}) {
  clearChartRecovery();
  if (!opts.recovery) chartRecoveryFailures = 0;
  const myGen = ++chartLoadGen;
  lastMtfReloadAt = 0;
  chartHistoryReread.inFlight = false;
  chartHistoryReread.again = false;
  chartHistoryReread.converged = false;
  if (chartReadAbort) chartReadAbort.abort();
  chartReadAbort = new AbortController();
  const statusEl = document.getElementById("chart-status");
  if (statusEl) statusEl.textContent = `加载 ${symbol} ${interval} 数据…`;
  closeChartWs();
  closeChartAggTradeWs();
  stopChartHeadlineRestPoll();
  clearChartD1Polling();
  if (typeof MtfTiles !== 'undefined' && MtfTiles.cancelReads) MtfTiles.cancelReads();
  // Never label the previous period's candles as the newly selected period.
  if (chartCommittedIdentity && chartCommittedIdentity.interval !== interval) {
    paintChartFailure(symbol, interval, '正在读取所选周期…', myGen);
  }
  if (!chartPricePathOpen()) setChartDeskHalt(true, `正在读取 ${interval}，可随时切换周期。`, true);
  const retry = document.getElementById('chart-read-retry');
  if (retry) retry.disabled = true;
  if (statusEl) statusEl.textContent = `加载 ${symbol} ${interval} 数据…`;
  try {
    const read = await readChartSwitchWindow(symbol, interval, opts.forceFull);
    if (!chartPageStillCurrent(myGen, symbol, interval)) return;
    const desk = read.desk || {};
    const revision = deskRevision(desk);
    if (responseStale(symbol, interval, revision, "full")) throw new Error("历史版本更新中，等待重读");
    const gapReason = desk.gap && desk.gap.reason ? String(desk.gap.reason) : "missing";
    if (desk.pricePathAvailable !== true || !read.rows.length) {
      paintChartFailure(symbol, interval, desk.pricePathAvailable !== true ? gapReason : `desk 无合格 ${interval} 序列`, myGen);
      scheduleChartRecovery(symbol, interval, myGen);
      return;
    }
    if (!applyCommittedDesk(read, { mode: "full", symbol, interval, preserveViewport: false })) return;
    maybeConfirmChartHistory(symbol, interval, revision);
    if (read.freshTail) acceptChartTail(read.freshTail, myGen, symbol, interval);
    chartRecoveryFailures = 0;
    writePersistedInterval(interval);
    restoreChartViewport(symbol, interval, myGen);
    startChartWs(symbol, interval);
    startChartAggTradeWs(symbol);
    startChartD1Polling();
    if ((typeof document === "undefined" || !document.hidden) && chartPricePathOpen()) startChartHeadlineRestPoll();
    refreshMtfAfterMainLoad(true);
    if (!opts.skipAutoSync) void maybeAutoSyncChartD1AfterRead(symbol, interval, myGen);
  } catch (error) {
    if (error && error.name === "AbortError") return;
    if (!chartPageStillCurrent(myGen, symbol, interval)) return;
    console.error("加载图表数据失败:", error);
    paintChartFailure(symbol, interval, error && error.message ? error.message : "desk 读取失败", myGen);
    if (![400, 401, 403, 404].includes(error && error.status)) scheduleChartRecovery(symbol, interval, myGen);
  } finally {
    if (chartPageStillCurrent(myGen, symbol, interval) && retry) retry.disabled = false;
  }
}
