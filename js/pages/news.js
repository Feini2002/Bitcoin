/* =======================================================
   页面：舆情分析（双层日报 · sentiment_analysis）
   ======================================================= */

const SENTIMENT_ANALYSIS_KIND = "sentiment_analysis";
let __yuqingAnalysisClock = null;
let __yuqingAnalysisAbort = null;

const analysisState = {
  report: null,
  history: [],
  status: "正在读取云端舆情分析...",
  source: "loading",
  loading: false,
};

const ANALYSIS_MOCK_REPORT = {
  id: "mock-analysis-20260505-09",
  kind: SENTIMENT_ANALYSIS_KIND,
  reportDate: "2026-05-05",
  slot: "09",
  triggerType: "scheduled_mock",
  generatedAt: "2026-05-05T01:30:00Z",
  status: "mock",
  sourceRefs: [
    { type: "daily_event", label: "上游事件日报", href: "#/news?reportId=mock-daily-20260505-08" },
    { type: "market", label: "行情工作台", href: "#/chart", route: "chart" },
    { type: "market", label: "衍生品面板", href: "#/derivatives", route: "derivatives" },
    { type: "market", label: "强平雷达", href: "#/heatmap", route: "heatmap" },
  ],
  quality: { factCount: 22, sourceCoverage: 78, marketSnapshotOk: true, usedSearch: false, caveat: "本地样本，仅用于云端不可用时预览。" },
  report: {
    title: "BTC 核心跨资产情报日报",
    upstreamDaily: {
      id: "mock-daily-20260505-08",
      title: "赛博前哨站",
      generatedAt: "2026-05-05T00:35:00Z",
      slot: "08",
      href: "#/news?reportId=mock-daily-20260505-08",
    },
    marketState: {
      regime: "风险偏好修复但脆弱",
      score: 58,
      bias: "中性偏多",
      confidence: 72,
      summary: "事件日报主题与市场快照显示 BTC 维持高位震荡，下一段方向更依赖美元、美债和 ETF 资金流确认。",
      keyAssets: [
        { name: "BTC", change: "+3.44%", stance: "震荡偏强", driver: "ETF 流入与高位筹码承接尚可" },
        { name: "ETH", change: "+1.86%", stance: "跟随修复", driver: "相对 BTC 强度仍不足" },
        { name: "衍生品", change: "", stance: "待确认", driver: "费率与 OI 未给出单边拥挤信号" },
      ],
    },
    riskRadar: [
      {
        level: "mid",
        title: "宏观数据窗口临近",
        window: "48h",
        trigger: "核心 CPI 或初请显著偏离预期",
        assets: ["BTC", "纳指", "美元", "美债"],
        response: "降低追涨仓位，等待第一根高波动 K 线收敛后再评估。",
      },
      {
        level: "mid",
        title: "ETF 流入与价格背离",
        window: "72h",
        trigger: "价格新高但净流入连续走弱",
        assets: ["BTC", "ETH"],
        response: "把突破视为待确认，不把单根放量阳线当作趋势延续。",
      },
    ],
    opportunityScanner: [
      {
        label: "顺势确认",
        direction: "BTC 上破确认",
        setup: "BTC 站稳关键区间上沿，ETF 净流入扩大，费率未过热。",
        invalidation: "上破后 4H 收回区间内，且美债收益率继续上行。",
        priority: 84,
      },
      {
        label: "等待复核",
        direction: "不追第一反应",
        setup: "事件发生后等待高波动 K 线收敛，再观察资金流确认。",
        invalidation: "上游日报事件被官方来源否认或热度迅速消退。",
        priority: 66,
      },
    ],
    eventCalendar: [
      {
        id: "mock-cpi",
        title: "美国 CPI / 核心 CPI",
        startsAtUtc: "2026-05-06T12:30:00Z",
        precision: "time",
        displayTimezone: "Asia/Shanghai",
        sourceType: "official_calendar",
        sourceName: "BLS",
        sourceUrl: "https://www.bls.gov/cpi/",
        confidence: 0.92,
        impactScore: 95,
        assets: ["BTC", "纳指", "美元", "美债"],
        why: "决定市场是否继续交易降息推迟。",
      },
    ],
    aiIntel: [
      {
        title: "AI CAPEX 叙事仍支撑纳指权重股",
        relevance: "对 BTC 的影响是风险偏好传导，不是直接基本面。",
        watch: "云厂商资本开支指引、NVDA 供应链订单、AI 软件商业化收入。",
        confidence: 0.7,
      },
    ],
    trendRead: {
      strengthening: ["风险偏好没有消失，但更依赖宏观数据确认。"],
      fracturing: ["AI 权重股强势与指数广度不足之间存在分歧。"],
      checklist: ["CPI 后 2 年期美债是否继续上行。", "BTC ETF 净流入是否配合价格突破。", "纳指上涨是否扩散到更多行业。"],
    },
    incrementalSearch: {
      used: false,
      reasons: [],
      excludedSourceIds: ["mock-daily-20260505-08"],
    },
  },
};

function analysisEscapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function analysisHashReportId() {
  try {
    const hash = String(location.hash || "");
    const q = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
    return new URLSearchParams(q).get("reportId") || "";
  } catch (_) {
    return "";
  }
}

function analysisFormatTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function analysisSlotLabel(row) {
  const slot = String(row && row.slot ? row.slot : "");
  if (slot.startsWith("manual")) return "手动";
  if (slot === "09") return "早间二次分析";
  if (slot === "14") return "午后复核";
  if (slot === "22") return "夜间复核";
  return slot || "分析";
}

function activeAnalysisReport() {
  return analysisState.report || ANALYSIS_MOCK_REPORT;
}

function analysisQuality(row) {
  return row.quality || (row.report && row.report.quality) || (row.grounding && row.grounding.quality) || {};
}

function analysisSourceStatusText() {
  if (analysisState.source === "cloud") return "云端 D1 舆情分析已接入";
  if (analysisState.source === "error") return `云端不可用，使用本地样本：${analysisState.status}`;
  if (analysisState.source === "loading") return "正在读取云端 D1 舆情分析...";
  return analysisState.status || "本地样本";
}

function pctText(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  return `${Math.round(n)}%`;
}

function scoreClass(score) {
  const n = Number(score) || 0;
  if (n >= 80) return "danger";
  if (n >= 65) return "warn";
  if (n >= 50) return "ok";
  return "muted";
}

function riskClass(level) {
  const s = String(level || "").toLowerCase();
  if (s === "high") return "danger";
  if (s === "mid" || s === "medium") return "warn";
  return "ok";
}

function riskLabel(level) {
  const s = String(level || "").toLowerCase();
  if (s === "high") return "高";
  if (s === "mid" || s === "medium") return "中";
  return "低";
}

function renderMiniBars(value) {
  const n = Math.max(0, Math.min(100, Number(value) || 0));
  return `<span class="news-score-bar"><span style="width:${n}%"></span></span>`;
}

function analysisRenderLink(ref) {
  const href = ref && (ref.href || ref.url);
  const label = ref && (ref.label || ref.source || ref.type);
  if (!href) return `<span>${analysisEscapeHtml(label || "来源")}</span>`;
  const external = /^https?:\/\//i.test(href);
  return `<a href="${analysisEscapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${analysisEscapeHtml(label || href)}</a>`;
}

function renderAnalysisRefs(row) {
  const refs = row.sourceRefs || [];
  if (!refs.length) return "";
  return `<div class="news-ref-row">${refs.slice(0, 10).map((ref) => analysisRenderLink(ref)).join("")}</div>`;
}

function renderAssetMatrix(report) {
  const rows = (report.marketState && report.marketState.keyAssets) || [];
  return rows
    .map((row) => {
      const ch = String(row.change || "");
      const up = ch.trim().startsWith("+");
      const down = ch.trim().startsWith("-");
      return `<div class="news-asset-cell">
        <div class="news-asset-top">
          <strong>${analysisEscapeHtml(row.name)}</strong>
          <span class="${up ? "up" : down ? "down" : ""}">${analysisEscapeHtml(ch || "--")}</span>
        </div>
        <div class="news-asset-stance">${analysisEscapeHtml(row.stance)}</div>
        <p>${analysisEscapeHtml(row.driver)}</p>
      </div>`;
    })
    .join("");
}

function renderRiskRadar(report) {
  return (report.riskRadar || [])
    .map((risk) => {
      const cls = riskClass(risk.level);
      return `<div class="news-risk-card ${cls}">
        <div class="news-risk-head">
          <span>${riskLabel(risk.level)}风险</span>
          <strong>${analysisEscapeHtml(risk.window)}</strong>
        </div>
        <h4>${analysisEscapeHtml(risk.title)}</h4>
        <p>${analysisEscapeHtml(risk.trigger)}</p>
        <div class="news-tag-row">${(risk.assets || []).map((x) => `<span>${analysisEscapeHtml(x)}</span>`).join("")}</div>
        <div class="news-risk-response">${analysisEscapeHtml(risk.response)}</div>
      </div>`;
    })
    .join("");
}

function renderOpportunities(report) {
  return (report.opportunityScanner || [])
    .map(
      (item) => `<div class="news-op-card">
        <div class="news-op-score ${scoreClass(item.priority)}">${Number(item.priority) || 0}</div>
        <div>
          <div class="news-op-label">${analysisEscapeHtml(item.label)}</div>
          <h4>${analysisEscapeHtml(item.direction)}</h4>
          <p><strong>触发</strong>${analysisEscapeHtml(item.setup)}</p>
          <p><strong>失效</strong>${analysisEscapeHtml(item.invalidation)}</p>
        </div>
      </div>`,
    )
    .join("");
}

function formatCalendarCountdown(event) {
  if (!event || event.precision !== "time") return "日期级";
  const d = new Date(event.startsAtUtc);
  if (Number.isNaN(d.getTime())) return "待核实";
  const delta = d.getTime() - Date.now();
  if (delta <= 0) return "已进入窗口";
  const day = Math.floor(delta / 86400000);
  const hour = Math.floor((delta % 86400000) / 3600000);
  const minute = Math.floor((delta % 3600000) / 60000);
  if (day > 0) return `${day}天 ${hour}h`;
  if (hour > 0) return `${hour}h ${minute}m`;
  return `${Math.max(1, minute)}m`;
}

function renderCalendar(report) {
  const rows = [...(report.eventCalendar || [])].sort((a, b) => Number(b.impactScore || 0) - Number(a.impactScore || 0));
  if (!rows.length) return `<p class="muted-text">本轮没有提取到高优先级事件日历。</p>`;
  return rows
    .map((event) => {
      const precise = event.precision === "time";
      const d = new Date(event.startsAtUtc);
      const time = Number.isNaN(d.getTime())
        ? "--"
        : precise
          ? d.toLocaleString("zh-CN", { timeZone: event.displayTimezone || "Asia/Shanghai", hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
          : `${d.toLocaleDateString("zh-CN", { timeZone: event.displayTimezone || "Asia/Shanghai", month: "2-digit", day: "2-digit" })} 日期级`;
      const trust = Math.round(Number(event.confidence || 0) * 100);
      const url = event.sourceUrl
        ? `<a href="${analysisEscapeHtml(event.sourceUrl)}" target="_blank" rel="noopener noreferrer">${analysisEscapeHtml(event.sourceName)}</a>`
        : `<span>${analysisEscapeHtml(event.sourceName)}</span>`;
      return `<div class="news-calendar-row">
        <div class="news-calendar-time">
          <strong>${analysisEscapeHtml(time)}</strong>
          <span>${analysisEscapeHtml(formatCalendarCountdown(event))}</span>
        </div>
        <div class="news-calendar-main">
          <h4>${analysisEscapeHtml(event.title)}</h4>
          <p>${analysisEscapeHtml(event.why)}</p>
          <div class="news-tag-row">${(event.assets || []).map((x) => `<span>${analysisEscapeHtml(x)}</span>`).join("")}</div>
        </div>
        <div class="news-calendar-score">
          <strong>${Number(event.impactScore) || 0}</strong>
          <span>置信 ${trust}%</span>
          ${url}
        </div>
      </div>`;
    })
    .join("");
}

function renderAiIntel(report) {
  return (report.aiIntel || [])
    .map(
      (item) => `<div class="news-ai-row">
        <div class="news-ai-icon"><i class="ph ph-sparkle"></i></div>
        <div>
          <h4>${analysisEscapeHtml(item.title)}</h4>
          <p>${analysisEscapeHtml(item.relevance)}</p>
          <span>${analysisEscapeHtml(item.watch)}</span>
        </div>
        <strong>${pctText(Number(item.confidence || 0) * 100)}</strong>
      </div>`,
    )
    .join("");
}

function renderTrendRead(report) {
  const t = report.trendRead || {};
  const block = (title, rows, cls) => `<div class="news-trend-block ${cls}">
    <h4>${analysisEscapeHtml(title)}</h4>
    ${(rows || []).map((x) => `<p>${analysisEscapeHtml(x)}</p>`).join("")}
  </div>`;
  return [
    block("正在强化", t.strengthening, "ok"),
    block("正在裂变", t.fracturing, "warn"),
    block("48-72h 清单", t.checklist, "info"),
  ].join("");
}

function renderIncremental(report) {
  const inc = report.incrementalSearch || {};
  const reasons = inc.reasons || [];
  return `
    <div class="news-incremental-card ${inc.used ? "active" : ""}">
      <strong>${inc.used ? "已触发按需增量搜索" : "未触发额外搜索"}</strong>
      <span>${reasons.length ? reasons.map(analysisEscapeHtml).join(" · ") : "事件日报 + 市场监测 + 事实池覆盖暂时够用"}</span>
      <em>已排除上游重复项 ${Array.isArray(inc.excludedSourceIds) ? inc.excludedSourceIds.length : 0} 条</em>
    </div>
  `;
}

function renderReportArchive(reportRow) {
  const items = analysisState.history.length ? analysisState.history : [ANALYSIS_MOCK_REPORT];
  let lastDate = "";
  return items
    .map((item) => {
      const date = item.reportDate || "";
      const dateHead = date && date !== lastDate ? `<div class="news-archive-date">${analysisEscapeHtml(date)}</div>` : "";
      lastDate = date || lastDate;
      const active = reportRow.id === item.id;
      const title = item.title || (item.report && item.report.title) || "舆情分析";
      return `${dateHead}<button type="button" class="news-archive-item ${active ? "active" : ""}" data-report-id="${analysisEscapeHtml(item.id)}">
        <span>${analysisEscapeHtml(analysisSlotLabel(item))}</span>
        <strong>${analysisEscapeHtml(title)}</strong>
        <em>${analysisEscapeHtml(analysisFormatTime(item.generatedAt))}</em>
        <small>${analysisEscapeHtml(item.triggerType === "manual" ? "手动分析" : "定点触发")}</small>
      </button>`;
    })
    .join("");
}

function renderYuqingReport(row) {
  const r = row || activeAnalysisReport();
  const report = r.report || {};
  const state = report.marketState || {};
  const q = analysisQuality(r);
  const upstream = report.upstreamDaily;
  return `
    <div class="news-command">
      <div class="news-command-main">
        <span class="news-live-dot ${analysisState.source === "cloud" ? "" : "mock"}"></span>
        <div>
          <h1>${analysisEscapeHtml(report.title || "舆情分析")}</h1>
          <p>${analysisEscapeHtml(analysisFormatTime(r.generatedAt))} · ${analysisEscapeHtml(analysisSlotLabel(r))}</p>
        </div>
      </div>
      <div class="news-command-actions">
        <span class="chip ${analysisState.source === "cloud" ? "ok" : "warn"}">${analysisState.source === "cloud" ? "D1 Live" : "Mock Fallback"}</span>
        <button type="button" class="btn" id="news-generate-preview" ${analysisState.loading ? "disabled" : ""}>
          <i class="ph ph-arrows-clockwise"></i><span>${analysisState.loading ? "分析中" : "手动二次分析"}</span>
        </button>
        <button type="button" class="btn primary" id="news-open-archive">
          <i class="ph ph-clock-counter-clockwise"></i><span>7日报告库</span>
        </button>
      </div>
    </div>

    <div class="news-phase-strip">
      <span><i class="ph ph-database"></i> ${analysisEscapeHtml(analysisSourceStatusText())}</span>
      <span><i class="ph ph-newspaper-clipping"></i> ${upstream ? `<a href="${analysisEscapeHtml(upstream.href || "#/news")}">上游日报 ${analysisEscapeHtml(upstream.slot || "")}</a>` : "上游日报缺失"}</span>
      <span><i class="ph ph-calendar-check"></i> 09 / 14 / 22 · Asia/Shanghai</span>
      <span><i class="ph ph-list-checks"></i> 事实 ${Number(q.factCount || 0)} · 覆盖 ${Number(q.sourceCoverage || 0)}%</span>
    </div>

    ${renderAnalysisRefs(r)}

    <div class="news-intel-grid">
      <section class="news-hero-card news-panel span-8">
        <div class="news-hero-copy">
          <div class="news-section-kicker">二次市场状态</div>
          <h2>${analysisEscapeHtml(state.regime || "待确认")}</h2>
          <p>${analysisEscapeHtml(state.summary || "")}</p>
          <div class="news-hero-meta">
            <span>方向 <strong>${analysisEscapeHtml(state.bias || "--")}</strong></span>
            <span>置信 <strong>${pctText(state.confidence)}</strong></span>
            <span>增量搜索 <strong>${report.incrementalSearch?.used ? "已触发" : "未触发"}</strong></span>
          </div>
        </div>
        <div class="news-sentiment-gauge">
          <svg viewBox="0 0 160 96" aria-hidden="true">
            <path d="M20 82 A60 60 0 0 1 140 82" pathLength="100" class="news-gauge-bg"/>
            <path d="M20 82 A60 60 0 0 1 140 82" pathLength="100" class="news-gauge-fg" style="stroke-dasharray:${Math.max(0, Math.min(100, Number(state.score) || 0))} 100"/>
          </svg>
          <strong>${Number(state.score) || 0}</strong>
          <span>${analysisEscapeHtml(state.bias || "")}</span>
        </div>
      </section>

      <section class="news-panel span-4">
        <div class="news-panel-head">
          <div>
            <span class="news-section-kicker">市场监测叠加</span>
            <h3>BTC 核心上下文</h3>
          </div>
          <i class="ph ph-chart-line-up"></i>
        </div>
        <div class="news-asset-grid">${renderAssetMatrix(report)}</div>
      </section>

      <section class="news-panel span-5">
        <div class="news-panel-head">
          <div>
            <span class="news-section-kicker">风险雷达</span>
            <h3>未来 48-72h</h3>
          </div>
          <i class="ph ph-warning-diamond"></i>
        </div>
        <div class="news-risk-grid">${renderRiskRadar(report)}</div>
      </section>

      <section class="news-panel span-7">
        <div class="news-panel-head">
          <div>
            <span class="news-section-kicker">机会扫描</span>
            <h3>只列条件，不直接下单</h3>
          </div>
          <i class="ph ph-crosshair"></i>
        </div>
        <div class="news-op-list">${renderOpportunities(report)}</div>
      </section>

      <section class="news-panel span-7">
        <div class="news-panel-head">
          <div>
            <span class="news-section-kicker">关键日历</span>
            <h3>精确时间才显示倒计时</h3>
          </div>
          <i class="ph ph-calendar-dots"></i>
        </div>
        <div class="news-calendar-list" id="news-calendar-list">${renderCalendar(report)}</div>
      </section>

      <section class="news-panel span-5">
        <div class="news-panel-head">
          <div>
            <span class="news-section-kicker">去重与增量</span>
            <h3>日报之外的新信息</h3>
          </div>
          <i class="ph ph-funnel"></i>
        </div>
        ${renderIncremental(report)}
      </section>

      <section class="news-panel span-6">
        <div class="news-panel-head">
          <div>
            <span class="news-section-kicker">AI 情报</span>
            <h3>科技叙事对风险偏好的传导</h3>
          </div>
          <i class="ph ph-brain"></i>
        </div>
        <div class="news-ai-list">${renderAiIntel(report)}</div>
      </section>

      <section class="news-panel span-6">
        <div class="news-panel-head">
          <div>
            <span class="news-section-kicker">趋势研判</span>
            <h3>信号强化与裂变</h3>
          </div>
          <i class="ph ph-wave-sine"></i>
        </div>
        <div class="news-trend-grid">${renderTrendRead(report)}</div>
      </section>
    </div>

    <div class="news-archive-backdrop" id="news-archive-backdrop" hidden></div>
    <aside class="news-archive-drawer" id="news-archive-drawer" aria-hidden="true">
      <div class="news-archive-head">
        <div>
          <span class="news-section-kicker">最近 7 天</span>
          <h3>舆情分析回档</h3>
        </div>
        <button type="button" class="btn" id="news-close-archive" title="关闭报告库">
          <i class="ph ph-x"></i><span>关闭</span>
        </button>
      </div>
      <div class="news-archive-list">${renderReportArchive(r)}</div>
    </aside>
  `;
}

function renderNewsIntoDom() {
  const root = document.getElementById("news-intel-content");
  if (!root) return;
  root.innerHTML = renderYuqingReport(activeAnalysisReport());
  bindNewsInnerEvents();
}

function openNewsArchive() {
  const drawer = document.getElementById("news-archive-drawer");
  const backdrop = document.getElementById("news-archive-backdrop");
  if (drawer) {
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
  }
  if (backdrop) backdrop.hidden = false;
}

function closeNewsArchive() {
  const drawer = document.getElementById("news-archive-drawer");
  const backdrop = document.getElementById("news-archive-backdrop");
  if (drawer) {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
  }
  if (backdrop) backdrop.hidden = true;
}

async function loadAnalysisHistory() {
  if (typeof DataEngine === "undefined" || typeof DataEngine.fetchYuqingReportHistory !== "function") return;
  try {
    const data = await DataEngine.fetchYuqingReportHistory(SENTIMENT_ANALYSIS_KIND, 7, { signal: __yuqingAnalysisAbort?.signal });
    if (data && Array.isArray(data.items) && data.items.length) analysisState.history = data.items;
  } catch (_) {}
}

async function loadAnalysisReport(reportId = "") {
  if (typeof DataEngine === "undefined") {
    analysisState.source = "error";
    analysisState.status = "DataEngine 不可用";
    renderNewsIntoDom();
    return;
  }
  if (__yuqingAnalysisAbort) __yuqingAnalysisAbort.abort();
  __yuqingAnalysisAbort = new AbortController();
  analysisState.source = "loading";
  analysisState.status = "正在读取云端 D1 舆情分析...";
  renderNewsIntoDom();
  try {
    const data = reportId
      ? await DataEngine.fetchYuqingReportItem(reportId, { signal: __yuqingAnalysisAbort.signal })
      : await DataEngine.fetchYuqingReportLatest(SENTIMENT_ANALYSIS_KIND, { signal: __yuqingAnalysisAbort.signal });
    const report = data && data.report;
    if (report) {
      analysisState.report = report;
      analysisState.source = "cloud";
      analysisState.status = "云端 D1 舆情分析已加载";
    } else {
      analysisState.report = ANALYSIS_MOCK_REPORT;
      analysisState.source = "error";
      analysisState.status = data && data.d1Ready === false ? "D1 未绑定或迁移未执行" : "暂无云端舆情分析";
    }
  } catch (e) {
    analysisState.report = ANALYSIS_MOCK_REPORT;
    analysisState.source = "error";
    analysisState.status = e && e.message ? e.message : String(e);
  }
  await loadAnalysisHistory();
  renderNewsIntoDom();
}

async function generateAnalysisReport() {
  if (typeof DataEngine === "undefined" || typeof DataEngine.generateYuqingStructuredReport !== "function") return;
  analysisState.loading = true;
  analysisState.status = "正在触发二次舆情分析...";
  renderNewsIntoDom();
  try {
    const data = await DataEngine.generateYuqingStructuredReport(SENTIMENT_ANALYSIS_KIND, { mode: "deep" }, { timeoutMs: 190_000 });
    if (data && data.report) {
      analysisState.report = data.report;
      analysisState.source = "cloud";
      analysisState.status = "手动分析已写入 D1";
      try {
        history.replaceState(null, "", `#/news-analysis?reportId=${encodeURIComponent(data.report.id)}`);
      } catch (_) {}
    }
    await loadAnalysisHistory();
  } catch (e) {
    analysisState.source = "error";
    analysisState.status = e && e.message ? e.message : String(e);
  } finally {
    analysisState.loading = false;
    renderNewsIntoDom();
  }
}

function bindNewsInnerEvents() {
  const gen = document.getElementById("news-generate-preview");
  if (gen && !gen.dataset.bound) {
    gen.dataset.bound = "1";
    gen.addEventListener("click", generateAnalysisReport);
  }
  const open = document.getElementById("news-open-archive");
  if (open && !open.dataset.bound) {
    open.dataset.bound = "1";
    open.addEventListener("click", openNewsArchive);
  }
  const close = document.getElementById("news-close-archive");
  if (close && !close.dataset.bound) {
    close.dataset.bound = "1";
    close.addEventListener("click", closeNewsArchive);
  }
  const backdrop = document.getElementById("news-archive-backdrop");
  if (backdrop && !backdrop.dataset.bound) {
    backdrop.dataset.bound = "1";
    backdrop.addEventListener("click", closeNewsArchive);
  }
  document.querySelectorAll(".news-archive-item").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-report-id") || "";
      closeNewsArchive();
      if (id && id !== ANALYSIS_MOCK_REPORT.id) {
        try {
          history.replaceState(null, "", `#/news-analysis?reportId=${encodeURIComponent(id)}`);
        } catch (_) {}
        await loadAnalysisReport(id);
      }
    });
  });
}

function pageNews() {
  return html`
    <div class="news-intel-shell" id="news-scaffold-root">
      ${typeof renderSentimentScaffoldStrip === "function" ? renderSentimentScaffoldStrip() : ""}
      <div id="news-intel-content">${renderYuqingReport(activeAnalysisReport())}</div>
    </div>
  `;
}

function initNews() {
  disposeNews();
  bindNewsInnerEvents();
  __yuqingAnalysisClock = setInterval(() => {
    const cal = document.getElementById("news-calendar-list");
    if (cal) cal.innerHTML = renderCalendar(activeAnalysisReport().report || {});
  }, 30_000);
  loadAnalysisReport(analysisHashReportId());
}

function disposeNews() {
  if (__yuqingAnalysisClock) {
    clearInterval(__yuqingAnalysisClock);
    __yuqingAnalysisClock = null;
  }
  if (__yuqingAnalysisAbort) {
    __yuqingAnalysisAbort.abort();
    __yuqingAnalysisAbort = null;
  }
}

if (typeof window !== "undefined") {
  window.__bitDeskDisposeNews = disposeNews;
}
