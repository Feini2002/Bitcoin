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

const analysisModuleRegistry = [
  { key: "riskRegime", label: "资金风险温度", hint: "Risk-On / Risk-Off 资金面状态", planned: false },
  { key: "hardDataMatrix", label: "硬数据校验矩阵", hint: "价格、衍生品、强平、宏观代理", planned: false },
  { key: "narrativeValidation", label: "叙事定价验证", hint: "只验证可被资金跟随的事件", planned: false },
  { key: "catalystCalendar", label: "精准催化剂时间轴", hint: "只渲染确定 timestamp", planned: true },
  { key: "riskThresholds", label: "风险传导阈值", hint: "触发、确认、失效分层", planned: false },
  { key: "agentContext", label: "Agent 结构化输出", hint: "下游员工可读枚举", planned: false },
  { key: "distortionAudit", label: "抗失真审计", hint: "记录事实池、搜索和降级依据", planned: false },
  { key: "techPremium", label: "科技叙事溢价复核", hint: "AI / 工具 / 科技新闻复核", planned: true },
];

const analysisSearchScopes = [
  { key: "factFill", label: "事实补齐搜索", hint: "补足事实池缺口" },
  { key: "narrativePricing", label: "叙事定价验证搜索", hint: "后续绑定 narrative_id", planned: true },
  { key: "aiTech", label: "AI / 科技线索搜索", hint: "科技叙事补充来源" },
  { key: "macroEvents", label: "宏观事件搜索", hint: "后续接结构化宏观源", planned: true },
];

function analysisBoolMap(items, src, fallback = true) {
  const box = src && typeof src === "object" ? src : {};
  const out = {};
  for (const item of items) out[item.key] = Object.prototype.hasOwnProperty.call(box, item.key) ? !!box[item.key] : !!fallback;
  return out;
}

function defaultAnalysisSettings() {
  return {
    version: 1,
    visibility: analysisBoolMap(analysisModuleRegistry, null, true),
    analysisCoverage: analysisBoolMap(analysisModuleRegistry, null, true),
    searchCoverage: analysisBoolMap(analysisSearchScopes, null, true),
    updatedAt: null,
  };
}

function normalizeAnalysisSettings(settings) {
  const src = settings && typeof settings === "object" ? settings : {};
  const d = defaultAnalysisSettings();
  return {
    version: 1,
    visibility: analysisBoolMap(analysisModuleRegistry, src.visibility || d.visibility, true),
    analysisCoverage: analysisBoolMap(analysisModuleRegistry, src.analysisCoverage || src.scanCoverage || d.analysisCoverage, true),
    searchCoverage: analysisBoolMap(analysisSearchScopes, src.searchCoverage || d.searchCoverage, true),
    updatedAt: src.updatedAt || src.updated_at || null,
  };
}

let __yuqingAnalysisSettings = defaultAnalysisSettings();
let __yuqingAnalysisSettingsSaving = false;

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
  return analysisState.report;
}

function analysisCurrentReportId() {
  const row = analysisState.report;
  return row && row.id ? String(row.id) : "";
}

function analysisQuality(row) {
  if (!row || typeof row !== "object") return {};
  return row.quality || (row.report && row.report.quality) || (row.grounding && row.grounding.quality) || {};
}

function analysisSourceStatusText() {
  if (analysisState.source === "cloud") return "云端 D1 舆情分析已接入";
  if (analysisState.source === "error") return `读取失败：${analysisState.status}`;
  if (analysisState.source === "loading") return "正在读取云端 D1 舆情分析...";
  return analysisState.status || "待机";
}

function analysisLiveDotClass() {
  if (analysisState.source === "cloud") return "";
  if (analysisState.source === "loading") return "idle";
  return "mock";
}

function analysisStatusChipMarkup() {
  if (analysisState.source === "cloud") return `<span class="chip ok">D1 已载入</span>`;
  if (analysisState.source === "loading") return `<span class="chip">载入中…</span>`;
  return `<span class="chip warn">暂无云端报告</span>`;
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

function analysisArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function analysisReportBody(row) {
  return row && row.report && typeof row.report === "object" ? row.report : {};
}

function analysisMarketSnapshot(row) {
  return row && row.marketSnapshot && typeof row.marketSnapshot === "object" ? row.marketSnapshot : {};
}

function analysisMarketEndpoint(row, key) {
  const snap = analysisMarketSnapshot(row);
  const data = snap && snap.data && typeof snap.data === "object" ? snap.data : {};
  return data[key] && typeof data[key] === "object" ? data[key] : {};
}

function analysisSourceErrors(row) {
  return analysisArray(row && row.sourceErrors);
}

function analysisCompactNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
}

function analysisBriefText(value, fallback = "--") {
  if (value == null || value === "") return fallback;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((x) => analysisBriefText(x, "")).filter(Boolean).slice(0, 4).join(" / ") || fallback;
  if (typeof value === "object") {
    const direct = value.summary || value.status || value.message || value.label || value.text;
    if (direct) return analysisBriefText(direct, fallback);
    const keys = Object.keys(value).slice(0, 4);
    return keys.length ? keys.join(" / ") : fallback;
  }
  return fallback;
}

function analysisSignedPct(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "--";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(Math.abs(n) >= 10 ? 1 : 2)}%`;
}

function analysisStatusTone(ok, planned = false) {
  if (planned) return "planned";
  if (ok === true) return "ok";
  if (ok === false) return "warn";
  return "pending";
}

function analysisStatusLabel(tone) {
  if (tone === "ok") return "已接入";
  if (tone === "warn") return "有缺口";
  if (tone === "planned") return "PLANNED";
  return "待验证";
}

function analysisRegimeMeta(row) {
  const report = analysisReportBody(row);
  const state = report.marketState || {};
  const q = analysisQuality(row);
  const hasReport = !!(row && row.report);
  const marketOk = q.marketSnapshotOk === true || analysisMarketSnapshot(row).ok === true;
  const rawScore = Number(state.score);
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : null;
  let code = "PENDING";
  if (hasReport) {
    if (!marketOk) code = "DATA_GAP";
    else if (score != null && score >= 66) code = "RISK_ON";
    else if (score != null && score <= 42) code = "RISK_OFF";
    else code = "RISK_NEUTRAL";
  }
  const labels = {
    PENDING: "等待报告",
    DATA_GAP: "数据缺口",
    RISK_ON: "Risk-On 确认中",
    RISK_OFF: "Risk-Off 警戒",
    RISK_NEUTRAL: "中性验证",
  };
  return {
    code,
    label: labels[code] || code,
    score,
    confidence: state.confidence,
    bias: state.bias || labels[code] || "待确认",
    summary:
      state.summary ||
      (hasReport
        ? "已读取事件日报与市场快照，等待硬数据矩阵给出资金跟随确认。"
        : "这里不再复刻第一页的信息温度；只展示资金面、风险偏好和可被下游 Agent 读取的结构化状态。"),
    marketOk,
  };
}

function analysisHardDataRows(row) {
  const hasReport = !!(row && row.report);
  const klines = analysisMarketEndpoint(row, "klines");
  const derivatives = analysisMarketEndpoint(row, "derivatives");
  const liquidations = analysisMarketEndpoint(row, "liquidations");
  const derivSnapshot = analysisMarketEndpoint(row, "derivativesSnapshot");
  const kData = klines.data || {};
  const dData = derivatives.data || {};
  const lData = liquidations.data || {};
  const sData = derivSnapshot.data || {};
  return [
    {
      key: "price_action",
      label: "BTC 1h 价格行为",
      value: klines.ok ? analysisSignedPct(kData.changePct) : "--",
      sub: klines.ok ? `${Number(kData.count) || "--"} 根K线 · 最新 ${analysisEscapeHtml(kData.latestT || kData.lastSync || "--")}` : "等待 /api/d1/klines",
      tone: hasReport ? analysisStatusTone(!!klines.ok) : "pending",
      route: "#/chart",
    },
    {
      key: "derivatives",
      label: "资金费率 / OI / 基差",
      value: derivatives.ok ? "快照可用" : "--",
      sub: derivatives.ok ? analysisEscapeHtml(analysisBriefText(dData.sourceHealthSummary || dData.generatedAt, "衍生品矩阵已读取")) : "等待 /api/d1/derivatives",
      tone: hasReport ? analysisStatusTone(!!derivatives.ok) : "pending",
      route: "#/derivatives",
    },
    {
      key: "liquidations",
      label: "强平与清算分布",
      value: liquidations.ok ? `L ${analysisCompactNumber(lData.totalLongNotional)} / S ${analysisCompactNumber(lData.totalShortNotional)}` : "--",
      sub: liquidations.ok ? `${Number(lData.count) || 0} 条 · ${analysisEscapeHtml(lData.latestEventAt || "等待最新事件")}` : "等待 /api/d1/liquidations",
      tone: hasReport ? analysisStatusTone(!!liquidations.ok) : "pending",
      route: "#/heatmap",
    },
    {
      key: "deriv_snapshot",
      label: "衍生品 AI 快照",
      value: derivSnapshot.ok ? analysisEscapeHtml(sData.profile || "brief") : "--",
      sub: derivSnapshot.ok ? analysisEscapeHtml(analysisBriefText(sData.summary || sData.generatedAt, "摘要已生成")) : "等待 /api/ai/derivatives-snapshot",
      tone: hasReport ? analysisStatusTone(!!derivSnapshot.ok) : "pending",
      route: "#/derivatives",
    },
    {
      key: "macro_calendar",
      label: "宏观日历 timestamp",
      value: "结构化时间",
      sub: "只接受外部 API / 硬编码日历传入的 startsAtUtc；不允许 LLM 编造日期。",
      tone: "planned",
      route: "#/news-analysis",
    },
    {
      key: "vol_yield",
      label: "VIX / 美债收益率差",
      value: "待接入",
      sub: "后续接入宏观代理源后再参与 Risk-On / Risk-Off 分层。",
      tone: "planned",
      route: "#/news-analysis",
    },
  ];
}

function renderAnalysisRiskTemperature(row) {
  const meta = analysisRegimeMeta(row);
  const rows = analysisHardDataRows(row).slice(0, 4);
  return `
    <section class="news-panel span-12 daily-module-panel daily-module-temperature analysis-risk-module" aria-label="资金风险温度">
      <div class="news-panel-head daily-module-head">
        <div>
          <span class="news-section-kicker">资金风险温度</span>
          <h3>Risk-On / Risk-Off 资金面状态</h3>
          <p class="daily-module-subtitle">顶部 Gauge 只看真实市场切片与风险偏好，不再复用事件页的信息热度。</p>
        </div>
      </div>
      <div class="daily-temperature-body analysis-risk-body">
        <div class="daily-temperature-score analysis-risk-score" aria-label="资金风险温度 ${meta.score == null ? "待验证" : `${meta.score} 分`}">
          <strong>${meta.score == null ? "--" : meta.score}</strong>
          <span>/ 100</span>
        </div>
        <div class="daily-temperature-main">
          <p class="daily-temperature-summary">${analysisEscapeHtml(meta.summary)}</p>
          <div class="daily-temperature-meta analysis-risk-meta">
            <span class="daily-temp-meta-info"><b>macro_regime</b>${analysisEscapeHtml(meta.code)}</span>
            <span class="${meta.marketOk ? "daily-temp-meta-ok" : "daily-temp-meta-warn"}"><b>market_snapshot_ok</b>${meta.marketOk ? "true" : "false"}</span>
            <span><b>状态</b>${analysisEscapeHtml(meta.label)}</span>
            <span><b>置信</b>${pctText(meta.confidence)}</span>
          </div>
          <div class="analysis-anchor-grid">
            ${rows
              .map(
                (item) => `<a class="analysis-anchor-card ${analysisEscapeHtml(item.tone)}" href="${analysisEscapeHtml(item.route)}">
                  <span>${analysisEscapeHtml(analysisStatusLabel(item.tone))}</span>
                  <b>${analysisEscapeHtml(item.label)}</b>
                  <strong>${item.value}</strong>
                </a>`,
              )
              .join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderAnalysisHardDataMatrix(row) {
  const rows = analysisHardDataRows(row);
  return `
    <div class="analysis-harddata-grid">
      ${rows
        .map(
          (item) => `<a class="analysis-harddata-card ${analysisEscapeHtml(item.tone)}" href="${analysisEscapeHtml(item.route)}">
            <div>
              <span>${analysisEscapeHtml(analysisStatusLabel(item.tone))}</span>
              <h4>${analysisEscapeHtml(item.label)}</h4>
            </div>
            <strong>${item.value}</strong>
            <p>${item.sub}</p>
          </a>`,
        )
        .join("")}
    </div>
  `;
}

function analysisNarrativeItems(row) {
  const report = analysisReportBody(row);
  const hasReport = !!(row && row.report);
  const q = analysisQuality(row);
  const upstream = report.upstreamDaily || {};
  const risks = analysisArray(report.riskRadar);
  const opportunities = analysisArray(report.opportunityScanner);
  if (!hasReport) {
    return [
      {
        category: "叙事验证",
        title: "等待上游事件进入二次定价验证",
        fact: "事件一览生成后，本页只把可被价格、资金费率、OI、强平或宏观代理确认的叙事继续向下游传递。",
        pricing: "待接入市场快照。",
        downgrade: "没有硬数据时输出：仅见事件，未见资金跟随确认。",
        watch: "等待手动二次分析或 09 / 14 / 22 定点任务。",
        status: "待验证",
      },
    ];
  }
  const items = [];
  if (upstream.title || upstream.id) {
    items.push({
      category: "上游日报",
      title: upstream.title || "事件一览日报",
      fact: upstream.generatedAt ? `引用事件日报 ${analysisFormatTime(upstream.generatedAt)}。` : "已引用上游事件日报。",
      pricing: q.marketSnapshotOk ? "市场快照已接入，可继续判断资金是否跟随。" : "市场快照缺口存在，不能升级为交易确认。",
      downgrade: q.marketSnapshotOk ? "若价格与资金项背离，结论仍需降级。" : "仅见事件，未见资金跟随确认。",
      watch: "观察同一叙事是否被价格、资金费率/OI 与清算分布共同确认。",
      status: q.marketSnapshotOk ? "可复核" : "降级",
    });
  }
  risks.slice(0, 2).forEach((risk) => {
    items.push({
      category: `${riskLabel(risk.level)}风险`,
      title: risk.title || "风险事件",
      fact: risk.trigger || "等待风险触发条件。",
      pricing: analysisArray(risk.assets).length ? `关联资产：${analysisArray(risk.assets).join(" / ")}` : "等待资产映射。",
      downgrade: "除非硬数据同向，否则不把风险叙事升级为方向判断。",
      watch: risk.response || "等待下一轮复核。",
      status: risk.window || "48-72h",
    });
  });
  opportunities.slice(0, 1).forEach((item) => {
    items.push({
      category: item.label || "条件队列",
      title: item.direction || "等待交易条件",
      fact: item.setup || "等待触发条件。",
      pricing: `优先级 ${Number(item.priority) || 0}，只作为条件队列，不直接下单。`,
      downgrade: item.invalidation || "价格反应与叙事背离即降级。",
      watch: "等待市场结构复核。",
      status: "条件",
    });
  });
  return items.length ? items.slice(0, 4) : analysisNarrativeItems(null);
}

function renderAnalysisNarrativeValidation(row) {
  return analysisNarrativeItems(row)
    .map(
      (item, idx) => `<article class="news-story daily-knowledge-card analysis-validation-card">
        <div class="news-story-body">
          <div class="daily-story-header">
            <div class="news-story-meta">
              <span class="news-story-category">${analysisEscapeHtml(item.category)}</span>
              <span>${analysisEscapeHtml(item.status)}</span>
            </div>
            <span class="daily-story-index">${String(idx + 1).padStart(2, "0")}</span>
          </div>
          <h3 class="daily-story-title">${analysisEscapeHtml(item.title)}</h3>
          <div class="daily-story-section daily-story-section--fact"><b>事件事实</b><span>${analysisEscapeHtml(item.fact)}</span></div>
          <div class="daily-story-matrix">
            <div class="daily-story-section"><b>定价证据</b><span>${analysisEscapeHtml(item.pricing)}</span></div>
            <div class="daily-story-section"><b>结论降级</b><span>${analysisEscapeHtml(item.downgrade)}</span></div>
          </div>
          <div class="daily-story-section daily-story-section--watch"><b>后续证据</b><span>${analysisEscapeHtml(item.watch)}</span></div>
        </div>
      </article>`,
    )
    .join("");
}

function analysisCalendarRows(row) {
  const rows = analysisArray(analysisReportBody(row).eventCalendar);
  if (rows.length) return rows.slice(0, 6);
  return [
    {
      title: "等待结构化财经日历",
      startsAtUtc: "",
      precision: "planned",
      sourceName: "PLANNED",
      confidence: 0,
      impactScore: 0,
      assets: ["CPI", "FOMC", "代币解锁"],
      why: "本模块只渲染确定 timestamp；没有外部结构化时间时保持空框架。",
    },
  ];
}

function renderAnalysisCalendar(row) {
  return analysisCalendarRows(row)
    .map((event) => {
      const precise = event.precision === "time";
      const d = new Date(event.startsAtUtc);
      const hasTime = event.startsAtUtc && !Number.isNaN(d.getTime());
      const time = hasTime
        ? precise
          ? d.toLocaleString("zh-CN", { timeZone: event.displayTimezone || "Asia/Shanghai", hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
          : `${d.toLocaleDateString("zh-CN", { timeZone: event.displayTimezone || "Asia/Shanghai", month: "2-digit", day: "2-digit" })} 日期级`
        : "--";
      const trust = Math.round(Number(event.confidence || 0) * 100);
      const countdown = hasTime ? formatCalendarCountdown(event) : "不编造";
      return `<div class="news-calendar-row analysis-calendar-row">
        <div class="news-calendar-time">
          <strong>${analysisEscapeHtml(time)}</strong>
          <span>${analysisEscapeHtml(countdown)}</span>
        </div>
        <div class="news-calendar-main">
          <h4>${analysisEscapeHtml(event.title || "待确认催化剂")}</h4>
          <p>${analysisEscapeHtml(event.why || "等待确定性时间节点与影响面。")}</p>
          <div class="news-tag-row">${analysisArray(event.assets).map((x) => `<span>${analysisEscapeHtml(x)}</span>`).join("")}</div>
        </div>
        <div class="news-calendar-score">
          <strong>${Number(event.impactScore) || "--"}</strong>
          <span>置信 ${trust}%</span>
          <span>${analysisEscapeHtml(event.sourceName || "来源待定")}</span>
        </div>
      </div>`;
    })
    .join("");
}

function renderAnalysisRiskThresholds(row) {
  const report = analysisReportBody(row);
  const risks = analysisArray(report.riskRadar);
  const ops = analysisArray(report.opportunityScanner);
  const rows = [
    ...risks.map((risk) => ({
      tone: riskClass(risk.level),
      label: `${riskLabel(risk.level)}风险 · ${risk.window || "当前"}`,
      title: risk.title || "风险阈值",
      body: risk.trigger || "等待触发条件。",
      foot: risk.response || "等待后续响应规则。",
    })),
    ...ops.map((op) => ({
      tone: scoreClass(op.priority),
      label: op.label || "条件队列",
      title: op.direction || "机会条件",
      body: op.setup || "等待触发条件。",
      foot: op.invalidation || "等待失效条件。",
    })),
  ];
  const safeRows = rows.length
    ? rows.slice(0, 4)
    : [
        {
          tone: "pending",
          label: "待验证",
          title: "等待风险传导阈值",
          body: "这里会把事件触发、资金确认和失效条件分开呈现。",
          foot: "没有硬数据确认时不输出交易方向。",
        },
      ];
  return safeRows
    .map(
      (item) => `<div class="news-risk-card analysis-threshold-card ${analysisEscapeHtml(item.tone)}">
        <div class="news-risk-head"><span>${analysisEscapeHtml(item.label)}</span><strong>条件</strong></div>
        <h4>${analysisEscapeHtml(item.title)}</h4>
        <p>${analysisEscapeHtml(item.body)}</p>
        <div class="news-risk-response">${analysisEscapeHtml(item.foot)}</div>
      </div>`,
    )
    .join("");
}

function analysisAgentFlags(row) {
  const report = analysisReportBody(row);
  const meta = analysisRegimeMeta(row);
  const q = analysisQuality(row);
  const inc = report.incrementalSearch || {};
  const sourceErrors = analysisSourceErrors(row);
  const preciseCatalysts = analysisArray(report.eventCalendar).filter((x) => x && x.precision === "time" && x.startsAtUtc).length;
  const hasReport = !!(row && row.report);
  return [
    { key: "macro_regime", value: meta.code, tone: meta.code === "DATA_GAP" ? "warn" : meta.code === "PENDING" ? "pending" : "ok" },
    { key: "verified_catalyst", value: preciseCatalysts > 0 ? "true" : hasReport ? "false" : "pending", tone: preciseCatalysts > 0 ? "ok" : "pending" },
    { key: "data_divergence", value: sourceErrors.length ? "true" : hasReport ? "false" : "pending", tone: sourceErrors.length ? "warn" : hasReport ? "ok" : "pending" },
    { key: "market_snapshot_ok", value: q.marketSnapshotOk === true ? "true" : hasReport ? "false" : "pending", tone: hasReport ? (q.marketSnapshotOk ? "ok" : "warn") : "pending" },
    { key: "incremental_search_used", value: inc.used === true ? "true" : hasReport ? "false" : "pending", tone: inc.used ? "warn" : "pending" },
    { key: "llm_downgrade_required", value: q.marketSnapshotOk ? "false" : hasReport ? "true" : "pending", tone: hasReport ? (q.marketSnapshotOk ? "ok" : "warn") : "pending" },
  ];
}

function renderAnalysisAgentContext(row) {
  return `<div class="analysis-agent-grid">
    ${analysisAgentFlags(row)
      .map(
        (flag) => `<div class="analysis-agent-flag ${analysisEscapeHtml(flag.tone)}">
          <span>${analysisEscapeHtml(flag.key)}</span>
          <strong>${analysisEscapeHtml(flag.value)}</strong>
        </div>`,
      )
      .join("")}
  </div>`;
}

function renderAnalysisAudit(row) {
  const report = analysisReportBody(row);
  const q = analysisQuality(row);
  const inc = report.incrementalSearch || {};
  const sourceErrors = analysisSourceErrors(row);
  const upstream = report.upstreamDaily;
  const checks = [
    { label: "上游日报", value: upstream ? upstream.id || upstream.title || "已引用" : "待引用" },
    { label: "事实池条数", value: row && row.report ? String(q.factCount || 0) : "待读取" },
    { label: "源覆盖", value: row && row.report ? pctText(q.sourceCoverage) : "待读取" },
    { label: "增量搜索", value: inc.used ? `已触发：${analysisArray(inc.reasons).join(" / ") || "手动或缺口触发"}` : row && row.report ? "未触发" : "待判断" },
    { label: "错误源", value: sourceErrors.length ? sourceErrors.map((x) => x.source || x.message).join(" / ") : row && row.report ? "无显式错误" : "待检测" },
  ];
  return `<div class="analysis-audit-list">
    ${checks.map((x) => `<div><span>${analysisEscapeHtml(x.label)}</span><strong>${analysisEscapeHtml(x.value)}</strong></div>`).join("")}
    <p>${analysisEscapeHtml((q && q.caveat) || "本页是二次舆情研判，不构成投资建议。")}</p>
  </div>`;
}

function renderAnalysisAiPremium(row) {
  const items = analysisArray(analysisReportBody(row).aiIntel);
  const safeItems = items.length
    ? items.slice(0, 4)
    : [
        {
          title: "等待科技叙事进入资金面复核",
          relevance: "AI/科技新闻只有在风险偏好或资金流出现同向变化时，才提升为市场变量。",
          watch: "等待事件一览 AI 情报站和市场快照同时可用。",
          confidence: 0,
        },
      ];
  return safeItems
    .map(
      (item) => `<article class="daily-ai-card analysis-ai-card">
        <h4>${analysisEscapeHtml(item.title || "科技叙事")}</h4>
        <span class="daily-ai-date">置信：${pctText(Number(item.confidence || 0) * 100)}</span>
        <p><strong>叙事</strong>${analysisEscapeHtml(item.relevance || "等待叙事摘要。")}</p>
        <p><strong>验证点</strong>${analysisEscapeHtml(item.watch || "等待资金面确认。")}</p>
      </article>`,
    )
    .join("");
}

function renderReportArchive() {
  const items = analysisState.history.length ? analysisState.history : [];
  const curId = analysisCurrentReportId();
  if (!items.length) {
    return `<p class="daily-archive-empty muted-text">暂无历史记录。可先执行一次「手动二次分析」或等待定点任务。</p>`;
  }
  let lastDate = "";
  return items
    .map((item) => {
      const date = item.reportDate || "";
      const dateHead = date && date !== lastDate ? `<div class="news-archive-date">${analysisEscapeHtml(date)}</div>` : "";
      lastDate = date || lastDate;
      const active = !!item.id && item.id === curId;
      const title = item.title || (item.report && item.report.title) || "舆情分析";
      const deleteBtn = item.id
        ? `<button type="button" class="news-archive-delete" data-report-id="${analysisEscapeHtml(item.id)}" title="从云端 D1 删除此条" aria-label="删除此条存档"><i class="ph ph-trash"></i></button>`
        : "";
      return `${dateHead}<div class="news-archive-row">
        <button type="button" class="news-archive-item ${active ? "active" : ""}" data-report-id="${analysisEscapeHtml(item.id)}">
        <span>${analysisEscapeHtml(analysisSlotLabel(item))}</span>
        <strong>${analysisEscapeHtml(title)}</strong>
        <em>${analysisEscapeHtml(analysisFormatTime(item.generatedAt))}</em>
        <small>${analysisEscapeHtml(item.triggerType === "manual" ? "手动分析" : "定点触发")}</small>
      </button>${deleteBtn}</div>`;
    })
    .join("");
}

function renderNewsArchiveChrome() {
  return `
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
      <div class="news-archive-list">${renderReportArchive()}</div>
    </aside>
  `;
}

function renderAnalysisSettingsChrome() {
  const settings = normalizeAnalysisSettings(__yuqingAnalysisSettings);
  const mkToggle = (item, checked, type) => {
    const hint = type === "visibility"
      ? "本页显示"
      : type === "analysis"
        ? "纳入二次分析"
        : "纳入搜索覆盖";
    return `
      <label class="daily-setting-row ${checked ? "is-on" : "is-off"}">
        <span>
          <strong>${analysisEscapeHtml(item.label)}${item.planned ? ' <em class="scaffold-planned-tag">PLANNED</em>' : ""}</strong>
          <small>${analysisEscapeHtml(hint)} · ${analysisEscapeHtml(item.hint || "")}</small>
        </span>
        <input type="checkbox" class="daily-setting-cb analysis-setting-cb" data-type="${analysisEscapeHtml(type)}" data-key="${analysisEscapeHtml(item.key)}" ${checked ? "checked" : ""} />
      </label>`;
  };

  return `
    <div class="news-archive-backdrop daily-drawer-backdrop" id="analysis-settings-backdrop" hidden></div>
    <aside class="news-archive-drawer daily-drawer daily-settings-drawer" id="analysis-settings-drawer" aria-hidden="true">
      <div class="news-archive-head">
        <div>
          <span class="news-section-kicker">Phase 0.5</span>
          <h3>舆情分析设置</h3>
        </div>
        <button type="button" class="btn daily-drawer-close" id="analysis-close-settings" title="关闭设置">
          <i class="ph ph-x"></i><span>关闭</span>
        </button>
      </div>
      <div class="daily-settings-body">
        <section class="daily-settings-section">
          <div class="daily-settings-section-head">
            <h4>仪表盘可见度</h4>
            <p>只影响当前页面显示，不改变云端生成内容。</p>
          </div>
          <div class="daily-settings-group">
            ${analysisModuleRegistry.map((item) => mkToggle(item, settings.visibility[item.key], "visibility")).join("")}
          </div>
        </section>

        <section class="daily-settings-section">
          <div class="daily-settings-section-head">
            <h4>二次分析覆盖</h4>
            <p>决定手动二次分析或定点任务时 Worker 会纳入哪些模块。</p>
          </div>
          <div class="daily-settings-group">
            ${analysisModuleRegistry.map((item) => mkToggle(item, settings.analysisCoverage[item.key], "analysis")).join("")}
          </div>
        </section>

        <section class="daily-settings-section">
          <div class="daily-settings-section-head">
            <h4>搜索覆盖范围</h4>
            <p>只控制增量搜索与定向验证搜索；行情、衍生品和强平数据不走搜索开关。</p>
          </div>
          <div class="daily-settings-group">
            ${analysisSearchScopes.map((item) => mkToggle(item, settings.searchCoverage[item.key], "search")).join("")}
          </div>
        </section>

        <div class="daily-settings-actions">
          <button type="button" class="btn primary" id="analysis-save-settings" ${__yuqingAnalysisSettingsSaving ? "disabled" : ""}>
            ${__yuqingAnalysisSettingsSaving ? '<i class="ph ph-spinner-gap spin"></i><span>保存中</span>' : '<i class="ph ph-floppy-disk"></i><span>保存并应用</span>'}
          </button>
        </div>
      </div>
    </aside>`;
}

function renderNewsDrawersChrome() {
  return `${renderNewsArchiveChrome()}${renderAnalysisSettingsChrome()}`;
}

function renderYuqingReport(row) {
  const r = row !== undefined && row !== null ? row : activeAnalysisReport();
  const report = analysisReportBody(r);
  const meta = analysisRegimeMeta(r);
  const upstream = report.upstreamDaily;
  const visibility = normalizeAnalysisSettings(__yuqingAnalysisSettings).visibility;
  const titleText = analysisEscapeHtml((r && r.report && r.report.title) || "资金面舆情验证器");
  const subLine = r && r.generatedAt ? `${analysisFormatTime(r.generatedAt)} · ${analysisSlotLabel(r)}` : "等待云端 D1 舆情分析";
  const statusText = analysisEscapeHtml(analysisSourceStatusText());
  const upstreamLabel = upstream
    ? `<a href="${analysisEscapeHtml(upstream.href || "#/news")}">上游日报 ${analysisEscapeHtml(upstream.slot || "")}</a>`
    : `<a href="#/news">上游日报待选择</a>`;

  const commandShell = `
    <div class="news-command daily-event-command analysis-command">
      <div class="news-command-main daily-command-main">
        <span class="news-live-dot ${analysisLiveDotClass()}"></span>
        <div class="daily-report-trigger">
          <div class="daily-report-trigger-title-row">
            <span class="daily-report-trigger-label">${titleText}</span>
            <div class="daily-report-meta daily-report-meta--title">
              ${analysisStatusChipMarkup()}
            </div>
          </div>
          <div class="daily-report-trigger-row">
            <i class="ph ph-clock" aria-hidden="true"></i>
            <strong>${analysisEscapeHtml(subLine)}</strong>
            <span class="daily-report-trigger-tz">Asia/Shanghai</span>
          </div>
          <p>世界新闻与真实金融数据的交叉验证器：只把可被资金面确认的叙事传给下游 Agent。</p>
        </div>
      </div>
      <div class="news-command-actions">
        <button type="button" class="btn" id="news-generate-preview" ${analysisState.loading ? "disabled" : ""} title="触发 sentiment_analysis 二次研判并写入 D1">
          <i class="ph ph-arrows-clockwise"></i><span>${analysisState.loading ? "分析中" : "手动二次分析"}</span>
        </button>
        <button type="button" class="btn secondary" id="analysis-open-settings" title="配置舆情分析模块可见度、二次分析覆盖与搜索范围">
          <i class="ph ph-gear"></i><span>设置</span>
        </button>
        <button type="button" class="btn primary" id="news-open-archive" title="打开最近 7 天舆情分析回档">
          <i class="ph ph-clock-counter-clockwise"></i><span>7日报告库</span>
        </button>
      </div>
    </div>`;

  return `${commandShell}

    <div class="news-phase-strip analysis-phase-strip">
      <span><i class="ph ph-database"></i> ${statusText}</span>
      <span><i class="ph ph-newspaper-clipping"></i> ${upstreamLabel}</span>
      <span><i class="ph ph-chart-line-up"></i> macro_regime=${analysisEscapeHtml(meta.code)}</span>
      <span><i class="ph ph-calendar-check"></i> 09 / 14 / 22 · 定点二次分析</span>
    </div>

    <div class="news-intel-grid daily-dashboard-grid analysis-dashboard-grid">
      ${visibility.riskRegime ? renderAnalysisRiskTemperature(r) : ""}

      ${visibility.narrativeValidation ? `<section class="news-panel span-7 daily-module-panel daily-module-news daily-balanced-panel analysis-module-validation">
        <div class="news-panel-head daily-module-head">
          <div>
            <span class="news-section-kicker">叙事定价验证</span>
            <h3>只验证可被资金跟随的事件</h3>
            <p class="daily-module-subtitle">把上游日报拆成事件事实、定价证据、降级规则和后续验证点。</p>
          </div>
        </div>
        <div class="news-story-list">${renderAnalysisNarrativeValidation(r)}</div>
      </section>` : ""}

      ${visibility.hardDataMatrix ? `<section class="news-panel span-5 daily-module-panel daily-module-harddata analysis-module-harddata">
        <div class="news-panel-head daily-module-head">
          <div>
            <span class="news-section-kicker">硬数据校验矩阵</span>
            <h3>价格、衍生品、强平、宏观代理</h3>
            <p class="daily-module-subtitle">每个来源必须说明接入状态，未接入的指标保留 PLANNED。</p>
          </div>
        </div>
        ${renderAnalysisHardDataMatrix(r)}
      </section>` : ""}

      ${visibility.catalystCalendar ? `<section class="news-panel span-7 daily-module-panel daily-module-calendar analysis-module-calendar">
        <div class="news-panel-head daily-module-head">
          <div>
            <span class="news-section-kicker">精准催化剂时间轴</span>
            <h3>只渲染确定 timestamp</h3>
            <p class="daily-module-subtitle">LLM 只解释影响面，不参与日期计算；没有来源时显示空框架。</p>
          </div>
          <i class="ph ph-calendar-dots"></i>
        </div>
        <div class="news-calendar-list" id="news-calendar-list">${renderAnalysisCalendar(r)}</div>
      </section>` : ""}

      ${visibility.riskThresholds ? `<section class="news-panel span-5 daily-module-panel daily-module-threshold analysis-module-threshold">
        <div class="news-panel-head daily-module-head">
          <div>
            <span class="news-section-kicker">风险传导阈值</span>
            <h3>触发、确认、失效分层</h3>
            <p class="daily-module-subtitle">输出条件队列，不直接替代交易执行。</p>
          </div>
          <i class="ph ph-warning-diamond"></i>
        </div>
        <div class="news-risk-grid">${renderAnalysisRiskThresholds(r)}</div>
      </section>` : ""}

      ${visibility.agentContext ? `<section class="news-panel span-6 daily-module-panel daily-module-agent analysis-module-agent">
        <div class="news-panel-head daily-module-head">
          <div>
            <span class="news-section-kicker">Agent 结构化输出</span>
            <h3>下游员工可直接读取的枚举</h3>
            <p class="daily-module-subtitle">用布尔值、枚举和数据缺口标识，供订单流、策略与风控模块调阈值。</p>
          </div>
          <i class="ph ph-brackets-curly"></i>
        </div>
        ${renderAnalysisAgentContext(r)}
      </section>` : ""}

      ${visibility.distortionAudit ? `<section class="news-panel span-6 daily-module-panel daily-module-audit analysis-module-audit">
        <div class="news-panel-head daily-module-head">
          <div>
            <span class="news-section-kicker">抗失真审计</span>
            <h3>阻断 LLM 分析 LLM</h3>
            <p class="daily-module-subtitle">记录事实池、增量搜索、错误源和结论降级依据。</p>
          </div>
          <i class="ph ph-funnel"></i>
        </div>
        ${renderAnalysisAudit(r)}
      </section>` : ""}

      ${visibility.techPremium ? `<section class="news-panel span-12 daily-module-panel daily-module-ai analysis-module-ai">
        <div class="news-panel-head daily-module-head">
          <div>
            <span class="news-section-kicker">科技叙事溢价复核</span>
            <h3>AI / 工具 / 科技新闻如何进入风险偏好</h3>
            <p class="daily-module-subtitle">保留科技叙事，但必须经过资金面与风险偏好二次筛选。</p>
          </div>
          <i class="ph ph-brain"></i>
        </div>
        <div class="news-ai-list">${renderAnalysisAiPremium(r)}</div>
      </section>` : ""}
    </div>
  `;
}

function renderNewsDrawersIntoDom() {
  const root = document.getElementById("news-drawers-root");
  if (!root) return;
  root.innerHTML = renderNewsDrawersChrome();
  bindNewsInnerEvents();
}

function renderNewsIntoDom(options = {}) {
  const root = document.getElementById("news-intel-content");
  if (!root) return;
  root.innerHTML = renderYuqingReport(activeAnalysisReport());
  if (!options.skipDrawers) renderNewsDrawersIntoDom();
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

function openAnalysisSettings() {
  const drawer = document.getElementById("analysis-settings-drawer");
  const backdrop = document.getElementById("analysis-settings-backdrop");
  if (drawer) {
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
  }
  if (backdrop) backdrop.hidden = false;
}

function closeAnalysisSettings() {
  const drawer = document.getElementById("analysis-settings-drawer");
  const backdrop = document.getElementById("analysis-settings-backdrop");
  if (drawer) {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
  }
  if (backdrop) backdrop.hidden = true;
}

async function loadAnalysisSettings() {
  if (typeof DataEngine === "undefined" || typeof DataEngine.fetchYuqingSentimentAnalysisSettings !== "function") return;
  try {
    const data = await DataEngine.fetchYuqingSentimentAnalysisSettings();
    if (data && data.settings) {
      __yuqingAnalysisSettings = normalizeAnalysisSettings(data.settings);
      renderNewsIntoDom();
    }
  } catch (_) {
    console.warn("无法拉取云端舆情分析设置，使用默认配置。");
  }
}

async function saveAnalysisSettings() {
  if (typeof DataEngine === "undefined" || typeof DataEngine.updateYuqingSentimentAnalysisSettings !== "function") return;
  const drawer = document.getElementById("analysis-settings-drawer");
  if (!drawer) return;
  const next = normalizeAnalysisSettings(__yuqingAnalysisSettings);
  drawer.querySelectorAll('.analysis-setting-cb[data-type="visibility"]').forEach((cb) => {
    next.visibility[cb.getAttribute("data-key")] = cb.checked;
  });
  drawer.querySelectorAll('.analysis-setting-cb[data-type="analysis"]').forEach((cb) => {
    next.analysisCoverage[cb.getAttribute("data-key")] = cb.checked;
  });
  drawer.querySelectorAll('.analysis-setting-cb[data-type="search"]').forEach((cb) => {
    next.searchCoverage[cb.getAttribute("data-key")] = cb.checked;
  });
  __yuqingAnalysisSettings = next;
  __yuqingAnalysisSettingsSaving = true;
  renderNewsIntoDom();
  openAnalysisSettings();
  try {
    const data = await DataEngine.updateYuqingSentimentAnalysisSettings(__yuqingAnalysisSettings);
    if (data && data.settings) __yuqingAnalysisSettings = normalizeAnalysisSettings(data.settings);
  } catch (e) {
    alert("保存舆情分析设置失败：" + (e.message || String(e)));
  } finally {
    __yuqingAnalysisSettingsSaving = false;
    renderNewsIntoDom();
    openAnalysisSettings();
  }
}

async function loadAnalysisHistory() {
  if (typeof DataEngine === "undefined" || typeof DataEngine.fetchYuqingReportHistory !== "function") return;
  try {
    const data = await DataEngine.fetchYuqingReportHistory(SENTIMENT_ANALYSIS_KIND, 7, { signal: __yuqingAnalysisAbort?.signal });
    if (data && Array.isArray(data.items) && data.items.length) analysisState.history = data.items;
  } catch (_) {}
}

async function deleteAnalysisArchiveEntry(id) {
  const rid = String(id || "").trim();
  if (!rid) return;
  if (typeof DataEngine === "undefined" || typeof DataEngine.deleteYuqingReportItem !== "function") {
    analysisState.status = "DataEngine 不支持删除";
    renderNewsIntoDom();
    return;
  }
  const ok =
    typeof confirmYuqingArchiveDelete === "function"
      ? await confirmYuqingArchiveDelete()
      : window.confirm("确定删除此条回档？云端 D1 中的对应记录将一并删除且不可恢复。");
  if (!ok) return;
  try {
    await DataEngine.deleteYuqingReportItem(rid);
    analysisState.history = (analysisState.history || []).filter((x) => x && x.id !== rid);
    const cur = activeAnalysisReport();
    const activeId = cur && cur.id;
    const hashId = analysisHashReportId();
    if (activeId === rid || hashId === rid) {
      try {
        history.replaceState(null, "", "#/news-analysis");
      } catch (_) {}
      await loadAnalysisReport("");
    } else {
      renderNewsIntoDom();
    }
    analysisState.status = "已删除所选回档";
  } catch (e) {
    analysisState.status = e && e.message ? e.message : String(e);
    renderNewsIntoDom();
  }
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
      analysisState.report = null;
      analysisState.source = "error";
      analysisState.status = data && data.d1Ready === false ? "D1 未绑定或迁移未执行" : "暂无云端舆情分析";
    }
  } catch (e) {
    analysisState.report = null;
    analysisState.source = "error";
    analysisState.status = e && e.message ? e.message : String(e);
  }
  await loadAnalysisHistory();
  renderNewsIntoDom();
}

function updateAnalysisCodexTaskStatus(evt) {
  const task = evt && evt.task && typeof evt.task === "object" ? evt.task : {};
  const raw = String((evt && (evt.status || evt.phase)) || task.status || "").toLowerCase();
  const label = task.id ? `（${String(task.id).slice(0, 10)}）` : "";
  if (["queued", "pending", "created", "submitted"].includes(raw)) {
    analysisState.status = `Codex CLI 任务已排队${label}，等待本地 bridge 接收...`;
  } else if (["running", "processing", "executing", "started", "in_progress"].includes(raw)) {
    analysisState.status = `Codex CLI 正在本地执行${label}，完成后会自动读取落库报告...`;
  } else if (["writing", "persisting", "saving"].includes(raw)) {
    analysisState.status = `Codex CLI 已生成内容${label}，正在写入 D1...`;
  } else if (["completed", "complete", "succeeded", "success", "done"].includes(raw)) {
    analysisState.status = `Codex CLI 任务完成${label}，D1 落库完成。`;
  } else {
    analysisState.status = `Codex CLI 任务等待中${label}...`;
  }
  analysisState.source = "loading";
  renderNewsIntoDom();
}

async function generateAnalysisReport() {
  if (typeof DataEngine === "undefined" || typeof DataEngine.generateYuqingStructuredReport !== "function") return;
  analysisState.loading = true;
  analysisState.status = "正在触发二次舆情分析...";
  renderNewsIntoDom();
  try {
    const settings = normalizeAnalysisSettings(__yuqingAnalysisSettings);
    const data = await DataEngine.generateYuqingStructuredReport(
      SENTIMENT_ANALYSIS_KIND,
      {
        mode: "deep",
        forceSearch: Object.values(settings.searchCoverage || {}).some(Boolean),
        analysisSettings: settings,
        modules: {
          dashboard: settings.analysisCoverage.riskRegime || settings.analysisCoverage.hardDataMatrix || settings.analysisCoverage.agentContext,
          news: settings.analysisCoverage.narrativeValidation || settings.analysisCoverage.riskThresholds,
          timeline: settings.analysisCoverage.catalystCalendar,
          ai: settings.analysisCoverage.techPremium,
          trends: settings.analysisCoverage.distortionAudit || settings.analysisCoverage.narrativeValidation,
        },
      },
      { timeoutMs: 190_000, taskTimeoutMs: 600_000, onTaskStatus: updateAnalysisCodexTaskStatus }
    );
    if (data && data.report) {
      analysisState.report = data.report;
      analysisState.source = "cloud";
      analysisState.status = data.task && data.task.id ? "Codex CLI 分析已落库完成" : "手动分析已写入 D1";
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
  const openSettings = document.getElementById("analysis-open-settings");
  if (openSettings && !openSettings.dataset.bound) {
    openSettings.dataset.bound = "1";
    openSettings.addEventListener("click", openAnalysisSettings);
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
  const closeSettings = document.getElementById("analysis-close-settings");
  if (closeSettings && !closeSettings.dataset.bound) {
    closeSettings.dataset.bound = "1";
    closeSettings.addEventListener("click", closeAnalysisSettings);
  }
  const settingsBackdrop = document.getElementById("analysis-settings-backdrop");
  if (settingsBackdrop && !settingsBackdrop.dataset.bound) {
    settingsBackdrop.dataset.bound = "1";
    settingsBackdrop.addEventListener("click", closeAnalysisSettings);
  }
  const saveSettings = document.getElementById("analysis-save-settings");
  if (saveSettings && !saveSettings.dataset.bound) {
    saveSettings.dataset.bound = "1";
    saveSettings.addEventListener("click", saveAnalysisSettings);
  }
  document.querySelectorAll('.analysis-setting-cb[data-type="visibility"]').forEach((cb) => {
    if (cb.dataset.boundLive) return;
    cb.dataset.boundLive = "1";
    cb.addEventListener("change", () => {
      const key = cb.getAttribute("data-key");
      if (__yuqingAnalysisSettings.visibility && key) {
        __yuqingAnalysisSettings.visibility[key] = cb.checked;
        cb.closest(".daily-setting-row")?.classList.toggle("is-on", cb.checked);
        cb.closest(".daily-setting-row")?.classList.toggle("is-off", !cb.checked);
        renderNewsIntoDom({ skipDrawers: true });
      }
    });
  });
  document.querySelectorAll('.analysis-setting-cb[data-type="analysis"], .analysis-setting-cb[data-type="search"]').forEach((cb) => {
    if (cb.dataset.boundSetting) return;
    cb.dataset.boundSetting = "1";
    cb.addEventListener("change", () => {
      const key = cb.getAttribute("data-key");
      const type = cb.getAttribute("data-type");
      const target = type === "search" ? __yuqingAnalysisSettings.searchCoverage : __yuqingAnalysisSettings.analysisCoverage;
      if (target && key) {
        target[key] = cb.checked;
        cb.closest(".daily-setting-row")?.classList.toggle("is-on", cb.checked);
        cb.closest(".daily-setting-row")?.classList.toggle("is-off", !cb.checked);
      }
    });
  });
  document.querySelectorAll(".news-archive-item").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-report-id") || "";
      closeNewsArchive();
      if (id) {
        try {
          history.replaceState(null, "", `#/news-analysis?reportId=${encodeURIComponent(id)}`);
        } catch (_) {}
        await loadAnalysisReport(id);
      }
    });
  });
  document.querySelectorAll(".news-archive-delete").forEach((del) => {
    if (del.dataset.boundDel) return;
    del.dataset.boundDel = "1";
    del.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
      const id = del.getAttribute("data-report-id") || "";
      await deleteAnalysisArchiveEntry(id);
    });
  });
}

function pageNews() {
  return html`
    <div class="news-intel-shell daily-workbench-shell analysis-workbench-shell" id="news-scaffold-root">
      <div id="news-intel-content">${renderYuqingReport(activeAnalysisReport())}</div>
      <div id="news-drawers-root">${renderNewsDrawersChrome()}</div>
    </div>
  `;
}

function initNews() {
  disposeNews();
  bindNewsInnerEvents();
  __yuqingAnalysisClock = setInterval(() => {
    const cal = document.getElementById("news-calendar-list");
    if (cal) cal.innerHTML = renderAnalysisCalendar(activeAnalysisReport());
  }, 30_000);
  loadAnalysisSettings();
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
