/* =======================================================
   行情工作台
   - 初始历史数据走 Worker /api/d1/klines（Cloudflare D1 缓存，币安源）
   - 浏览器每 60s 只读 D1；写库由已部署 Worker Cron 维护，设置页的运维按钮才会触发 /api/d1/sync。
   - 实时 K 线由 Binance WebSocket（当前周期的 kline stream）补齐 OHLC。
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
const CHART_D1_POLL_MS = 60 * 1000;
const CHART_WORKBENCH_TF_KEY = "bitdesk.workbench.chartInterval";
/** 横向平移/缩放：按「交易对|周期」存 scrollPosition + barSpacing（localStorage） */
const CHART_VIEWPORT_KEY = "bitdesk.workbench.chartViewport";
/** 不允许视口停在最后一根 K 线右侧的未来空白区；0 = 最新 K 线贴近右边界 */
const CHART_MIN_RIGHT_SCROLL_POSITION = 0;
/** 图表时间统一按中国东八区展示（与浏览器本地时区无关） */
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
/** false = fstream U本位 aggTrade；true = 现货 stream aggTrade（防火长城/线路不通时切换） */
let chartHeadlineUseSpotWs = false;
let chartHeadlineWsStallTimer = null;
/** 当前 headline WS 会话内是否收到过 aggTrade（与 REST 兜底无关） */
let chartHeadlineAggSinceOpen = false;
let chartD1PollTimer = null;
let chartD1PollInFlight = false;
let chartD1PollGen = 0;
let chartVisibilityRefreshHandler = null;
let chartFocusRefreshHandler = null;
let chartLastWsStatusAt = 0;
/** 行情工作台固定为 BTC U 本位永续；产品范围不包含多标的切换 */
const CHART_SYMBOL = "BTCUSDT";
let currentInterval = readPersistedInterval();
let chartLoadGen = 0;
let chartViewportRangeHandler = null;
let viewportPersistTimer = null;

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
    ? `${rc.sampleBars || 0}/${rc.windowBars || "--"} 根 · ${rc.sampleState || ""} · 置信 ${Number.isFinite(Number(rc.confidence)) ? Number(rc.confidence).toFixed(2) : "--"} · 位置 ${rangePos}`
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
        axisLabelVisible: true,
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
  const useHigher = (higherAnalysis) => {
    if (requestId !== chartStructureRequestId || higherInterval !== resolveChartHigherIntervalForPage(currentInterval)) return;
    const higherContext =
      typeof IndicatorMath !== "undefined" && typeof IndicatorMath.buildChartHigherContext === "function"
        ? IndicatorMath.buildChartHigherContext(baseAnalysis, higherAnalysis)
        : chartHigherPendingContext(higherInterval);
    const merged = { ...baseAnalysis, higherContext };
    updateChartKeyLevelPanel(merged);
    drawChartStructurePriceLines(merged);
  };
  if (cached && Date.now() - cached.ts < CHART_HIGHER_STRUCTURE_CACHE_MS) {
    useHigher(cached.analysis);
    return;
  }
  if (typeof DataEngine === "undefined" || typeof DataEngine.fetchKlinesFromD1 !== "function") {
    useHigher(null);
    return;
  }
  let pending = chartHigherStructureInFlight.get(cacheKey);
  if (!pending) {
    pending = DataEngine.fetchKlinesFromD1(CHART_SYMBOL, higherInterval, 2000, { sync: "0" })
      .then((rows) => computeChartStructureFromRows(rows, higherInterval, atrPeriod))
      .then((analysis) => {
        chartHigherStructureCache.set(cacheKey, { ts: Date.now(), analysis });
        return analysis;
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
  if (!candleSeries || typeof IndicatorMath === "undefined") {
    updateChartKeyLevelPanel(null);
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
  if (!Array.isArray(klines) || klines.length === 0) {
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
          <label title="VWAP 按 UTC 自然日重置"><input type="checkbox" data-ind="vwap" ${s.vwap.on ? "checked" : ""} />VWAP</label>
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

function chartAgentLinkHtml(agent) {
  if (!agent) return "";
  return `
    <a class="owner-link chart-agent-link" href="#/${agentRoute(agent.id)}" title="查看 ${agent.name}">
      <span class="owner-dot" style="background:${agent.color}">${agent.short}</span>
      <span>${agent.name}</span>
      <span class="owner-arrow"><i class="ph ph-arrow-right"></i></span>
    </a>
  `;
}

function chartDataStatusStripHtml() {
  const owner = DATA_OWNER.chart || {};
  const primary = owner.primary ? AGENT_MAP[owner.primary] : null;
  const related = (owner.related || []).map((id) => AGENT_MAP[id]).filter(Boolean);
  const ownerChips = [primary, ...related].filter(Boolean).map(chartAgentLinkHtml).join("");
  return html`
    <section class="chart-data-strip" aria-label="行情数据状态">
      <div class="chart-data-main">
        <span class="chart-feed-dot" aria-hidden="true"></span>
        <div>
          <strong>BTCUSDT 永续</strong>
          <span>Cloud D1 K线 · Worker Cron 写库 · Binance WS 实时跳动 · 东八区</span>
        </div>
      </div>
      <div class="chart-data-owners">${ownerChips}</div>
    </section>
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
  const s = String(wantUpper || CHART_SYMBOL).toUpperCase();
  if (String(inner.s || "").toUpperCase() !== s) return false;
  const p = parseFloat(inner.p);
  if (!Number.isFinite(p)) return false;
  chartHeadlineLastWsMsgAt = Date.now();
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
  if (typeof document !== "undefined" && document.hidden) return;
  if (Date.now() - chartHeadlineLastWsMsgAt < CHART_HEADLINE_REST_PAUSE_AFTER_WS_MS) return;

  const want = CHART_SYMBOL;
  const restUrls = [
    `https://fapi.binance.com/fapi/v1/ticker/price?symbol=${encodeURIComponent(want)}`,
    `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(want)}`,
  ];
  for (const u of restUrls) {
    try {
      const r = await fetch(u, { cache: "no-store", mode: "cors" });
      if (!r.ok) continue;
      const j = await r.json();
      const p = parseFloat(j.price);
      if (Number.isFinite(p)) {
        applyChartPrimaryHeadline(want, p);
        return;
      }
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
        { cache: "no-store", mode: "cors" },
      );
      if (!r.ok) return;
      const j = await r.json();
      const p = parseFloat(j.price);
      if (Number.isFinite(p)) applyChartPrimaryHeadline(want, p);
    } catch (_) {}
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
    <div class="chart-desk">
      ${chartDataStatusStripHtml()}

      <div class="chart-toolbar">
        <div class="chart-tf-group" aria-label="周期切换">
          ${tfButtons}
        </div>
        <div class="chart-action-cluster">
          <span class="chart-live-status" id="chart-status"></span>
          <button type="button" class="btn chart-sync-btn" id="chart-cloud-sync" data-manual-hint="只重新读取当前周期的 Cloudflare D1；需要写库请到设置页点「立即同步 D1」。"
            title="只重新读取当前周期的 Cloudflare D1；需要写库请到设置页点「立即同步 D1」。">
            <i class="ph ph-arrow-clockwise"></i>
            <span>重读D1</span>
          </button>
        </div>
      </div>

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
  chartHeadlineUseSpotWs = false;
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

  startChartAggTradeWs(CHART_SYMBOL);
  startChartHeadlineRestPoll();

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

  const syncBtn = document.getElementById("chart-cloud-sync");
  if (syncBtn && !syncBtn.dataset.bound) {
    syncBtn.dataset.bound = "1";
    syncBtn.addEventListener("click", async () => {
      syncBtn.disabled = true;
      const statusEl = document.getElementById("chart-status");
      if (statusEl) statusEl.textContent = `正在重新读取 D1（${currentInterval}）…`;
      try {
        await loadChartData(CHART_SYMBOL, currentInterval);
      } catch (e) {
        if (statusEl) statusEl.textContent = "刷新失败: " + (e && e.message ? e.message : e);
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
    case WebSocket.OPEN: return "实时";
    case WebSocket.CLOSING: return "WS 关闭中";
    case WebSocket.CLOSED: return "行情 WS 已断";
    default: return "WS ?";
  }
}

function setChartStatusLine(symbol, interval, nBars) {
  const statusEl = document.getElementById("chart-status");
  if (!statusEl) return;
  const meta = (typeof window !== "undefined" && window.__LAST_KLINES_META) || null;
  const backend = (typeof window !== "undefined" && window.__LAST_KLINES_BACKEND) || "";
  const intervalMs =
    typeof DataEngine !== "undefined" && typeof DataEngine.getIntervalMs === "function"
      ? DataEngine.getIntervalMs(interval)
      : 5 * 60 * 1000;

  let d1TimeHint = "未知";
  if (meta && Number.isFinite(meta.staleMs)) {
    const st = meta.staleMs;
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
    const withinBar = Number.isFinite(intervalMs) && intervalMs > 0 && st >= 0 && st <= intervalMs;
    d1TimeHint = withinBar ? `末根开盘 ${human}（本根未收盘）` : `末根开盘 ${human}`;
  }

  const wsShort = chartWsStateShort();
  const src = (typeof window !== "undefined" && window.__LAST_KLINES_DATA_SOURCE) === "d1" ? "D1" : "接口";
  const lastSync = meta && meta.lastSync;
  const lastSyncText = typeof lastSync === "string"
    ? lastSync
    : (lastSync && lastSync.last_run) ? String(lastSync.last_run) : "";
  const parts = [
    `${symbol} · ${interval}`,
    `${src} ${d1TimeHint}`,
    wsShort,
    `D1 只读轮询 ${Math.round(CHART_D1_POLL_MS / 1000)}s`,
    backend ? `${backend} Worker` : "",
  ].filter(Boolean);
  const summaryLine = parts.join(" · ");
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
    `浏览器只读 D1 自动刷新间隔: ${Math.round(CHART_D1_POLL_MS / 1000)} 秒；写库由 Worker Cron 或设置页手动同步负责。`,
    "图表页不会调用 /api/d1/sync；按钮只重读当前周期 D1 缓存。",
    "说明：时间差 = 当前时间 − D1 最后一根 K 的开盘时间（币安字段 t）。进行中 K 线该差值常在 0～一个周期内；若远大于周期，才可能是 D1/Cron 落后。",
    "历史 K 来自币安 U 本位永续，经 Worker 落 D1；图表实时更新为浏览器直连币安 WS。",
  ].filter(Boolean);

  const syncBtn = document.getElementById("chart-cloud-sync");
  if (syncBtn) {
    const manual =
      (syncBtn.dataset && syncBtn.dataset.manualHint) ||
      "只重新读取 Cloudflare D1；需要写库请到设置页点「立即同步 D1」。";
    syncBtn.title = [manual, summaryLine, detailBits.join("\n")].filter(Boolean).join("\n\n");
  }
}

function chartWsStateText() {
  if (!chartWs) return "未连接";
  switch (chartWs.readyState) {
    case WebSocket.CONNECTING: return "连接中";
    case WebSocket.OPEN: return "已连接(实时)";
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
 * 主图标题现价：Binance aggTrade WS（fstream U 本位 ↔ spot 自动切换）+ REST 轮询兜底（chartPollHeadlinePriceRest）。
 * 与 kline_{interval} 并行，切换周期时无需重连本条流。
 */
function startChartAggTradeWs(symbol) {
  closeChartAggTradeWs();
  if (typeof WebSocket === "undefined") return;

  const want = String(symbol || CHART_SYMBOL).toUpperCase();
  const streamSym = want.toLowerCase();
  const url = chartHeadlineUseSpotWs
    ? `wss://stream.binance.com:9443/ws/${streamSym}@aggTrade`
    : `wss://fstream.binance.com/ws/${streamSym}@aggTrade`;
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
      chartHeadlineUseSpotWs = !chartHeadlineUseSpotWs;
      console.warn("[chart] headline aggTrade 长期无成交包，切换 WS 线路 spot=", chartHeadlineUseSpotWs);
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

  const stream = `${symbol.toLowerCase()}@kline_${interval}`;
  const url = `wss://fstream.binance.com/ws/${stream}`;
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
    const row = {
      t,
      o,
      h,
      l,
      c,
      v: Number.isFinite(vol) ? vol : 0,
    };
    const idx = chartOhlcv.findIndex((r) => r.t === t);
    if (idx >= 0) chartOhlcv[idx] = row;
    else if (!chartOhlcv.length || t > chartOhlcv[chartOhlcv.length - 1].t) chartOhlcv.push(row);
    lastRenderedCount = chartOhlcv.length;
    scheduleIndicatorsRefresh();
    if (typeof window !== "undefined") {
      if (!window.__LAST_KLINES_META) {
        window.__LAST_KLINES_META = {
          symbol,
          interval,
          count: chartOhlcv.length,
          latestT: t,
          lastSync: null,
          staleMs: Date.now() - t,
        };
      } else {
        window.__LAST_KLINES_META.count = chartOhlcv.length;
        window.__LAST_KLINES_META.latestT = t;
        window.__LAST_KLINES_META.staleMs = Date.now() - t;
      }
    }
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

function refreshMtfAfterMainLoad() {
  if (typeof MtfTiles === "undefined") return;
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

function mergeD1RowsWithLiveRows(d1Rows) {
  const incoming = normalizeKlineRows(d1Rows);
  if (!incoming.length) return [];
  const lastD1T = incoming[incoming.length - 1].t;
  const byTime = new Map();
  incoming.forEach((row) => byTime.set(row.t, row));
  const iv = currentInterval;
  for (const row of chartOhlcv) {
    if (!row || !Number.isFinite(row.t) || row.t <= lastD1T) continue;
    if (!klineOpenMatchesActiveInterval(row.t, iv)) continue;
    byTime.set(row.t, row);
  }
  return Array.from(byTime.values()).sort((a, b) => a.t - b.t);
}

function setChartDataFromRows(rows) {
  chartOhlcv = rows;
  const chartData = chartOhlcv.map(d => ({
    time: d.t / 1000,
    open: d.o,
    high: d.h,
    low: d.l,
    close: d.c,
  }));
  if (candleSeries) candleSeries.setData(chartData);
  lastRenderedCount = chartData.length;
  clampChartRightBlank();
  applyIndicatorsFromOhlcv(chartOhlcv);
  applyChartKeyLevelsFromOhlcv(chartOhlcv);
  return chartData.length;
}

function clearChartD1Polling() {
  chartD1PollGen += 1;
  chartD1PollInFlight = false;
  if (chartD1PollTimer) {
    clearInterval(chartD1PollTimer);
    chartD1PollTimer = null;
  }
  if (chartVisibilityRefreshHandler) {
    try { document.removeEventListener("visibilitychange", chartVisibilityRefreshHandler); } catch (_) {}
    chartVisibilityRefreshHandler = null;
  }
  if (chartFocusRefreshHandler) {
    try { window.removeEventListener("focus", chartFocusRefreshHandler); } catch (_) {}
    chartFocusRefreshHandler = null;
  }
}

function queueD1Poll(reason) {
  if (!lwChart || !candleSeries) return;
  if (chartD1PollInFlight) return;
  if (typeof document !== "undefined" && document.hidden && reason !== "focus") return;
  const symbol = CHART_SYMBOL;
  const interval = currentInterval;
  const myGen = chartD1PollGen;
  chartD1PollInFlight = true;

  DataEngine.fetchKlinesFromD1(symbol, interval, 2000, { sync: "0" })
    .then(async (raw) => {
      if (myGen !== chartD1PollGen || symbol !== CHART_SYMBOL || interval !== currentInterval) return;
      if (!Array.isArray(raw) || raw.length === 0) return;
      const merged = mergeD1RowsWithLiveRows(raw);
      const count = setChartDataFromRows(merged);
      setChartStatusLine(symbol, interval, count);
      refreshMtfAfterMainLoad();
    })
    .catch((e) => {
      console.warn(`[chart] 自动读取 D1 失败 (${reason || "timer"})`, e);
      if (myGen !== chartD1PollGen) return;
      setChartStatusLine(symbol, interval, lastRenderedCount);
    })
    .finally(() => {
      if (myGen === chartD1PollGen) chartD1PollInFlight = false;
    });
}

function startChartD1Polling() {
  clearChartD1Polling();
  chartD1PollGen += 1;
  chartD1PollTimer = setInterval(() => queueD1Poll("timer"), CHART_D1_POLL_MS);
  chartVisibilityRefreshHandler = () => {
    if (document.hidden) return;
    queueD1Poll("visible");
  };
  chartFocusRefreshHandler = () => queueD1Poll("focus");
  try { document.addEventListener("visibilitychange", chartVisibilityRefreshHandler); } catch (_) {}
  try { window.addEventListener("focus", chartFocusRefreshHandler); } catch (_) {}
}

async function loadChartData(symbol, interval) {
  const myGen = ++chartLoadGen;
  const statusEl = document.getElementById("chart-status");
  if (statusEl) statusEl.textContent = `加载 ${symbol} ${interval} 数据…`;
  closeChartWs();
  clearChartD1Polling();

  chartOhlcv = [];
  lastRenderedCount = 0;
  if (candleSeries) {
    try {
      candleSeries.setData([]);
    } catch (_) {}
  }
  applyIndicatorsFromOhlcv([]);
  applyChartKeyLevelsFromOhlcv([]);

  if (typeof window !== "undefined") {
    window.__LAST_KLINES_META = null;
    window.__LAST_KLINES_DATA_SOURCE = "";
  }
  startChartWs(symbol, interval);

  try {
    const rawData = await DataEngine.fetchKlinesFromD1(symbol, interval, 2000, { sync: "0" });
    if (myGen !== chartLoadGen) return;

    if (!Array.isArray(rawData) || rawData.length === 0) {
      if (statusEl) {
        const base = typeof getBitDataApiBase === "function"
          ? getBitDataApiBase()
          : (typeof window !== "undefined" && window.BIT_DATA_API_BASE) ? String(window.BIT_DATA_API_BASE) : "";
        statusEl.textContent =
          `D1 暂无 ${interval} 数据，页面会自动重读；若持续为空，请访问 ${base || "https://btc.feiniwork.com"}/api/d1/status 查看状态，或到设置页触发「立即同步 D1」`;
      }
      if (candleSeries) candleSeries.setData([]);
      chartOhlcv = [];
      applyIndicatorsFromOhlcv(chartOhlcv);
      applyChartKeyLevelsFromOhlcv(chartOhlcv);
      lastRenderedCount = 0;
      startChartD1Polling();
      refreshMtfAfterMainLoad();
      return;
    }

    const count = setChartDataFromRows(mergeD1RowsWithLiveRows(rawData));

    writePersistedInterval(interval);
    restoreChartViewport(symbol, interval, myGen);
    setChartStatusLine(symbol, interval, count);
    startChartD1Polling();
    refreshMtfAfterMainLoad();
  } catch (e) {
    if (myGen !== chartLoadGen) return;
    console.error("加载图表数据失败:", e);
    if (statusEl) statusEl.textContent = "加载失败: " + (e && e.message ? e.message : e);
    startChartD1Polling();
  }
}
