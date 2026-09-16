/* =======================================================
   页面：事件一览（双层日报 · daily_event）
   ======================================================= */

const DAILY_EVENT_KIND = "daily_event";
const DAILY_ARCHIVE_HISTORY_DAYS = 30;
const DAILY_PENDING_PREVIEW_KEY = "bitdesk.yuqing.daily_event.pending.preview";
const DAILY_PENDING_PREVIEW_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const DAILY_ARCHIVE_FILTERS = [
  { key: "all", label: "全部" },
  { key: "recent30", label: "近30天", days: 30 },
  { key: "recent7", label: "近七天", days: 7 },
];
let __yuqingDailyLoadAbort = null;
let __yuqingDailyScanAbort = null;
let __dailyScanPromise = null;
let __dailyScanTick = null;
let __dailyStreamRenderTimer = null;
let __dailyStreamRenderRaf = null;
let __dailyQuietRenderUntil = 0;
let __dailyModuleMotionSeq = 0;
let __dailyFirstStreamEventAt = 0;
let __dailyLastStreamEventAt = 0;
const __dailyModuleMotion = {};
const __dailyModuleMotionRendered = {};

const dailyEventState = {
  report: null,
  /** 流式生成过程中用于即时渲染的临时行（不入库，done 后清空） */
  streamPreviewRow: null,
  /** Worker token/delta 事件的前端缓冲，只在本轮流式生成期间展示 */
  streamModules: {},
  history: [],
  status: "正在加载云端日报…",
  source: "loading",
  loading: false,
  /** 报告库抽屉筛选：all | recent30 | recent7 */
  archiveFilter: "all",
  scanStartedAt: 0,
  scanStage: "",
  scanProgress: {},
};

const defaultDashboardSettings = {
  visibility: { dashboard: true, news: true, timeline: true, ai: true, githubTools: true, trends: true },
  scanCoverage: { dashboard: true, news: true, timeline: true, ai: true, githubTools: true, trends: true }
};
let __yuqingSettings = JSON.parse(JSON.stringify(defaultDashboardSettings));
let __yuqingSettingsSaving = false;

function normalizeDailyDashboardSettings(settings) {
  const src = settings && typeof settings === "object" ? settings : {};
  return {
    visibility: { ...defaultDashboardSettings.visibility, ...(src.visibility || {}) },
    scanCoverage: { ...defaultDashboardSettings.scanCoverage, ...(src.scanCoverage || {}) },
  };
}

function dailyEscapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseMarkdownInline(value) {
  let escaped = dailyEscapeHtml(value);
  // parse **bold**
  escaped = escaped.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  return escaped;
}

function dailyHashReportId() {
  try {
    const hash = String(location.hash || "");
    const q = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
    return new URLSearchParams(q).get("reportId") || "";
  } catch (_) {
    return "";
  }
}

function dailyIsEventsRoute() {
  const id = String(location.hash || "").replace(/^#\/?/, "").split("?")[0];
  return id === "news";
}

function dailyFormatTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** 日报生成时间（上海） */
function dailyFormatTriggeredSearchAt(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function dailySlotLabel(row) {
  const slot = String(row && row.slot ? row.slot : "");
  if (slot.startsWith("manual")) return "手动";
  if (slot === "00") return "凌晨版";
  if (slot === "08") return "早报";
  if (slot === "12") return "午报";
  if (slot === "20") return "晚报";
  return slot || "报告";
}

function dailyTriggerLabel(row) {
  const trigger = String(row && row.triggerType ? row.triggerType : "");
  if (trigger === "manual") return "实时扫描";
  return "定点触发";
}

/** 事件一览页头徽章：手动扫描 vs 定点扫描 */
function dailyHeaderScanBadge(row) {
  if (!row || typeof row !== "object") return "";
  const trigger = String(row.triggerType || "");
  const slot = String(row.slot || "");
  if (trigger === "manual" || slot.startsWith("manual")) return "手动扫描";
  return "定点扫描";
}

function dailyActiveReport() {
  return dailyEventState.streamPreviewRow || dailyEventState.report;
}

function dailyReportTimeMs(row) {
  const t = row && row.generatedAt ? Date.parse(row.generatedAt) : 0;
  return Number.isFinite(t) && t > 0 ? t : 0;
}

function dailyReportIsReady(row) {
  return String(row && row.status ? row.status : "ready") === "ready";
}

function dailyCloudReportShouldReplacePending(report, pending) {
  if (!pending) return true;
  if (!report) return false;
  const reportTime = dailyReportTimeMs(report);
  const pendingTime = dailyReportTimeMs(pending);
  if (dailyReportIsReady(report) && (report.id === pending.id || reportTime >= pendingTime)) return true;
  return reportTime > pendingTime + 1000;
}

function dailyCompactStreamModules(modules) {
  const out = {};
  Object.entries(modules || {}).forEach(([key, entry]) => {
    if (!entry || typeof entry !== "object") return;
    const text = String(entry.text || "");
    out[key] = {
      ...entry,
      text: text.length > 4000 ? text.slice(-4000) : text,
    };
  });
  return out;
}

function dailyReadPendingPreview() {
  try {
    const raw = localStorage.getItem(DAILY_PENDING_PREVIEW_KEY);
    if (!raw) return null;
    const box = JSON.parse(raw);
    const row = box && box.row && typeof box.row === "object" ? box.row : null;
    const savedAt = Number(box && box.savedAt) || 0;
    const rowTime = dailyReportTimeMs(row);
    const ageBase = Math.max(savedAt, rowTime);
    if (!row || row.kind !== DAILY_EVENT_KIND || dailyReportIsReady(row) || !ageBase || Date.now() - ageBase > DAILY_PENDING_PREVIEW_MAX_AGE_MS) {
      localStorage.removeItem(DAILY_PENDING_PREVIEW_KEY);
      return null;
    }
    return box;
  } catch (_) {
    try {
      localStorage.removeItem(DAILY_PENDING_PREVIEW_KEY);
    } catch (__) {}
    return null;
  }
}

function dailyWritePendingPreview() {
  const row = dailyEventState.streamPreviewRow;
  if (!row || dailyReportIsReady(row)) return;
  try {
    localStorage.setItem(
      DAILY_PENDING_PREVIEW_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        row,
        status: dailyEventState.status || "",
        scanStage: dailyEventState.scanStage || "",
        scanProgress: dailyEventState.scanProgress || {},
        streamModules: dailyCompactStreamModules(dailyEventState.streamModules),
      }),
    );
  } catch (_) {}
}

function dailyClearPendingPreview() {
  try {
    localStorage.removeItem(DAILY_PENDING_PREVIEW_KEY);
  } catch (_) {}
}

function dailyRestorePendingPreview() {
  const box = dailyReadPendingPreview();
  if (!box) return false;
  dailyEventState.streamPreviewRow = box.row;
  dailyEventState.report = box.row;
  dailyEventState.streamModules = box.streamModules || {};
  dailyEventState.scanProgress = box.scanProgress || {};
  dailyEventState.scanStage = box.scanStage || "刷新前的实时扫描";
  dailyEventState.status = box.status || "已恢复刷新前的事件日报生成预览，正在核对 D1 是否已有完整报告。";
  dailyEventState.source = "cloud";
  return true;
}

function dailyRenderSoon() {
  setTimeout(() => {
    renderYuqingDailyIntoDom({ skipViewTransition: true });
    renderYuqingDailyDrawersIntoDom();
  }, 0);
}

function dailyForceRenderReport(row) {
  const root = document.getElementById("daily-report-content");
  if (!root) return;
  root.innerHTML = `
    <div id="daily-report-header">${renderDailyReportHeader(row)}</div>
    <div id="daily-report-grid">${renderDailyReportGrid(row)}</div>
  `;
  const active = row || dailyActiveReport();
  __lastDailyRenderedId = active && (active.id || active.previewId) ? String(active.id || active.previewId) : "";
  __lastDailyRenderedLoading = !!dailyEventState.loading;
  bindYuqingDailyEvents();
}

function dailyClearScheduledStreamRender() {
  if (__dailyStreamRenderTimer) {
    clearTimeout(__dailyStreamRenderTimer);
    __dailyStreamRenderTimer = null;
  }
  if (__dailyStreamRenderRaf) {
    cancelAnimationFrame(__dailyStreamRenderRaf);
    __dailyStreamRenderRaf = null;
  }
}

function dailySuppressViewMotion(ms = 900) {
  __dailyQuietRenderUntil = Math.max(__dailyQuietRenderUntil, Date.now() + ms);
}

function dailyResetModuleMotion() {
  Object.keys(__dailyModuleMotion).forEach((key) => delete __dailyModuleMotion[key]);
  Object.keys(__dailyModuleMotionRendered).forEach((key) => delete __dailyModuleMotionRendered[key]);
}

function dailyMarkModuleMotion(module, phase) {
  const key = String(module || "").trim();
  if (!key) return;
  __dailyModuleMotionSeq += 1;
  __dailyModuleMotion[key] = { phase: phase || "filled", seq: __dailyModuleMotionSeq };
}

function dailyConsumeModuleMotionClass(module) {
  const key = String(module || "").trim();
  const motion = key ? __dailyModuleMotion[key] : null;
  if (!motion || __dailyModuleMotionRendered[key] === motion.seq) return "";
  __dailyModuleMotionRendered[key] = motion.seq;
  return motion.phase === "streaming" ? " daily-module-stream-started" : " daily-module-just-filled";
}

function dailyModuleVisualState(module, row) {
  if (!row || !row.report) return "empty";
  if (dailyModuleHasStructuredData(module, row)) return "ready";
  if (row.status === "streaming") {
    return dailyStreamEntriesForModule(module).length ? "streaming" : "waiting";
  }
  return "empty";
}

function dailyModuleStateClass(module, row) {
  const state = dailyModuleVisualState(module, row);
  return ` daily-module-state-${state}${dailyConsumeModuleMotionClass(module)}`;
}

function dailyModuleStateAttrs(module, row) {
  const key = dailyEscapeHtml(module);
  const state = dailyEscapeHtml(dailyModuleVisualState(module, row));
  return `data-daily-module="${key}" data-daily-module-state="${state}"`;
}

function dailyResetStreamBuffers() {
  dailyEventState.streamModules = {};
  dailyClearScheduledStreamRender();
  dailyResetModuleMotion();
}

function dailyScheduleStreamRender(delayMs = 160) {
  if (__dailyStreamRenderTimer || __dailyStreamRenderRaf) return;
  __dailyStreamRenderTimer = setTimeout(() => {
    __dailyStreamRenderTimer = null;
    __dailyStreamRenderRaf = requestAnimationFrame(() => {
      __dailyStreamRenderRaf = null;
      dailyWritePendingPreview();
      renderYuqingDailyIntoDom({ skipViewTransition: true });
    });
  }, delayMs);
}

function dailyEnsureStreamPreviewShell() {
  if (dailyEventState.streamPreviewRow) return dailyEventState.streamPreviewRow;
  const now = new Date().toISOString();
  dailyEventState.streamPreviewRow = {
    id: "",
    previewId: `stream-${Date.now().toString(36)}`,
    kind: DAILY_EVENT_KIND,
    reportDate: "",
    slot: "manual",
    triggerType: "manual",
    generatedAt: now,
    status: "streaming",
    sourceRefs: [],
    grounding: { quality: { factCount: 0, sourceCoverage: 0 } },
    marketSnapshot: {},
    report: {
      title: "事件日报",
      subtitle: "流式生成中…",
      marketTemperature: {
        score: 50,
        label: "生成中",
        summary: "等待信息温度模块…",
        regime: "",
        crossAsset: "",
        anomaly: "",
        suggestion: "",
      },
      macroTrend: "",
      topStory: null,
      topStories: [],
      dynamicBriefs: [],
      aiIntel: [],
      githubTools: [],
      trendRead: {
        title: "总编辑收束",
        summary: "",
        verdict: "",
        closingRead: [],
        searchFindings: [],
        watchline: [],
        uncertainty: "",
        strengthening: [],
        cracking: [],
        conclusion: "",
        methodology: { usesGoogleSearch: true, inputOnly: false, mode: "上游模块 + 外部搜索校准" },
      },
      sources: [],
      quality: { factCount: 0, sourceCoverage: 0, usedSearch: true, caveat: "" },
    },
    sourceErrors: [],
  };
  return dailyEventState.streamPreviewRow;
}

function mergeDailyStreamEvent(evt) {
  if (!evt || evt.type !== "partial") return false;
  const row = dailyEnsureStreamPreviewShell();
  const rep = row.report;
  const completed = [];
  const markIfFilled = (module, wasStructured) => {
    if (!wasStructured && dailyModuleHasStructuredData(module, row)) completed.push(module);
  };
  if (evt.module === "temperature" && evt.marketTemperature && typeof evt.marketTemperature === "object") {
    const was = dailyModuleHasStructuredData("temperature", row);
    Object.assign(rep.marketTemperature, evt.marketTemperature);
    markIfFilled("temperature", was);
  }
  if (evt.module === "topStories" && Array.isArray(evt.topStories)) {
    const was = dailyModuleHasStructuredData("topStories", row);
    rep.topStories = evt.topStories;
    rep.topStory = evt.topStories[0] || rep.topStory;
    markIfFilled("topStories", was);
  }
  if (evt.module === "dynamicBriefs" && Array.isArray(evt.dynamicBriefs)) {
    const was = dailyModuleHasStructuredData("dynamicBriefs", row);
    rep.dynamicBriefs = evt.dynamicBriefs;
    markIfFilled("dynamicBriefs", was);
  }
  if (evt.module === "digest") {
    if (evt.macroTrend) rep.macroTrend = String(evt.macroTrend);
    if (Array.isArray(evt.topStories)) {
      const was = dailyModuleHasStructuredData("topStories", row);
      rep.topStories = evt.topStories;
      rep.topStory = evt.topStories[0] || rep.topStory;
      markIfFilled("topStories", was);
    }
    if (Array.isArray(evt.dynamicBriefs)) {
      const was = dailyModuleHasStructuredData("dynamicBriefs", row);
      rep.dynamicBriefs = evt.dynamicBriefs;
      markIfFilled("dynamicBriefs", was);
    }
  }
  if (evt.module === "aiIntel" && Array.isArray(evt.aiIntel)) {
    const was = dailyModuleHasStructuredData("aiIntel", row);
    rep.aiIntel = evt.aiIntel;
    markIfFilled("aiIntel", was);
  }
  if (evt.module === "githubTools" && Array.isArray(evt.githubTools)) {
    const was = dailyModuleHasStructuredData("githubTools", row);
    rep.githubTools = evt.githubTools;
    markIfFilled("githubTools", was);
  }
  if (evt.module === "trends" && evt.trendRead && typeof evt.trendRead === "object") {
    const was = dailyModuleHasStructuredData("trends", row);
    rep.trendRead = evt.trendRead;
    markIfFilled("trends", was);
  }
  completed.forEach((module) => dailyMarkModuleMotion(module, "filled"));
  dailyMarkScanProgress(evt.module, "done");
  dailyWritePendingPreview();
  return completed.length > 0;
}

function dailyStreamModuleLabel(module, streamKey = "") {
  const key = String(streamKey || module || "").trim();
  if (key === "topStories.primary") return "今日头条 · 主线";
  if (key === "topStories.wire") return "今日头条 · 快讯";
  const m = String(module || "").trim();
  if (m === "temperature") return "当前信息温度";
  if (m === "topStories") return "今日头条";
  if (m === "dynamicBriefs") return "动态速览";
  if (m === "aiIntel") return "AI 情报站";
  if (m === "githubTools") return "GitHub 工具雷达";
  if (m === "trends") return "趋势线索";
  return m || "模型输出";
}

function dailyScanModuleLabels() {
  return {
    temperature: "温度",
    topStories: "头条",
    dynamicBriefs: "速览",
    aiIntel: "AI",
    githubTools: "GitHub",
    trends: "趋势",
  };
}

function dailyResetScanProgress() {
  const s = __yuqingSettings.scanCoverage || {};
  dailyEventState.scanProgress = {
    temperature: s.dashboard === false ? "skip" : "pending",
    topStories: s.news === false ? "skip" : "pending",
    dynamicBriefs: s.timeline === false ? "skip" : "pending",
    aiIntel: s.ai === false ? "skip" : "pending",
    githubTools: s.githubTools === false ? "skip" : "pending",
    trends: s.trends === false ? "skip" : "pending",
  };
}

function dailyMarkScanProgress(module, status) {
  const m = String(module || "").trim();
  const map = {
    dashboard: "temperature",
    news: "topStories",
    timeline: "dynamicBriefs",
    ai: "aiIntel",
  };
  const key = map[m] || m;
  if (!key || !dailyEventState.scanProgress || !(key in dailyEventState.scanProgress)) return;
  if (dailyEventState.scanProgress[key] === "done" && status !== "error") return;
  dailyEventState.scanProgress[key] = status;
}

function dailyScanElapsedLabel() {
  const start = Number(dailyEventState.scanStartedAt) || 0;
  if (!start) return "0s";
  const sec = Math.max(0, Math.floor((Date.now() - start) / 1000));
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`;
}

function dailyPendingScanLabels() {
  const labels = dailyScanModuleLabels();
  const progress = dailyEventState.scanProgress || {};
  return Object.keys(labels)
    .filter((key) => progress[key] === "pending" || progress[key] === "active")
    .map((key) => labels[key])
    .slice(0, 4);
}

function renderDailyScanStatusPanel() {
  if (!dailyEventState.loading) return "";
  const labels = dailyScanModuleLabels();
  const progress = dailyEventState.scanProgress || {};
  const steps = Object.keys(labels)
    .filter((key) => progress[key] !== "skip")
    .map((key) => {
      const state = progress[key] || "pending";
      const icon = state === "done" ? "ph-check-circle" : state === "active" ? "ph-spinner-gap spin" : "ph-circle";
      const text = state === "done" ? "完成" : state === "active" ? "进行中" : "等待";
      return `<span class="daily-scan-step is-${dailyEscapeHtml(state)}"><i class="ph ${icon}" aria-hidden="true"></i><b>${dailyEscapeHtml(labels[key])}</b><small>${text}</small></span>`;
    })
    .join("");
  const status = dailyEscapeHtml(dailyEventState.status || dailyEventState.scanStage || "扫描进行中…");
  return `
    <div class="daily-scan-status-panel" role="status" aria-live="polite">
      <div class="daily-scan-status-main">
        <span class="daily-scan-pulse" aria-hidden="true"></span>
        <div>
          <strong>${dailyEscapeHtml(dailyEventState.scanStage || "实时扫描进行中")}</strong>
          <p>${status}</p>
        </div>
      </div>
      <div class="daily-scan-status-meta">
        <span><i class="ph ph-timer" aria-hidden="true"></i>${dailyEscapeHtml(dailyScanElapsedLabel())}</span>
        <span><i class="ph ph-arrows-clockwise" aria-hidden="true"></i>切换页面后继续运行</span>
      </div>
      <div class="daily-scan-steps">${steps}</div>
    </div>`;
}

function mergeDailyStreamChunk(evt) {
  if (!evt || evt.type !== "chunk") return false;
  const module = String(evt.module || "misc").trim() || "misc";
  const streamKey = String(evt.streamKey || module).trim() || module;
  const delta = String(evt.delta || "");
  if (!delta) return false;
  dailyEnsureStreamPreviewShell();
  const hadModuleEntries = dailyStreamEntriesForModule(module).length > 0;
  const hadEntry = !!dailyEventState.streamModules[streamKey];
  const prev = dailyEventState.streamModules[streamKey] || {
    module,
    streamKey,
    label: dailyStreamModuleLabel(module, streamKey),
    text: "",
    updatedAt: 0,
  };
  dailyEventState.streamModules[streamKey] = {
    ...prev,
    module,
    streamKey,
    label: evt.label ? String(evt.label) : prev.label || dailyStreamModuleLabel(module, streamKey),
    text: `${prev.text || ""}${delta}`,
    updatedAt: Date.now(),
  };
  dailyMarkScanProgress(module, "active");
  if (!hadModuleEntries) dailyMarkModuleMotion(module, "streaming");
  dailyWritePendingPreview();
  return !hadEntry || !hadModuleEntries;
}

function dailyStreamEntriesForModule(module) {
  const m = String(module || "").trim();
  return Object.values(dailyEventState.streamModules || {})
    .filter((entry) => entry && entry.module === m && String(entry.text || "").trim())
    .sort((a, b) => String(a.streamKey || "").localeCompare(String(b.streamKey || "")));
}

function dailyCleanLiveStreamText(value) {
  let s = String(value || "")
    .replace(/```(?:json|markdown)?/gi, "")
    .replace(/```/g, "")
    .trim();
  if (s.length > 1200) s = `…${s.slice(-1200)}`;
  return s;
}

function dailyModuleHasStructuredData(module, row) {
  const report = row && row.report ? row.report : {};
  if (module === "temperature") {
    const temp = report.marketTemperature || {};
    return !!(temp.summary && temp.summary !== "等待信息温度模块…");
  }
  if (module === "topStories") {
    return Array.isArray(report.topStories) && report.topStories.length > 0;
  }
  if (module === "dynamicBriefs") {
    return Array.isArray(report.dynamicBriefs) && report.dynamicBriefs.length > 0;
  }
  if (module === "aiIntel") {
    return Array.isArray(report.aiIntel) && report.aiIntel.length > 0;
  }
  if (module === "githubTools") {
    return Array.isArray(report.githubTools) && report.githubTools.length > 0;
  }
  if (module === "trends") {
    const t = report.trendRead || {};
    return !!(
      t.summary ||
      t.verdict ||
      t.conclusion ||
      (Array.isArray(t.closingRead) && t.closingRead.length) ||
      (Array.isArray(t.searchFindings) && t.searchFindings.length) ||
      (Array.isArray(t.watchline) && t.watchline.length) ||
      (Array.isArray(t.worldNews) && t.worldNews.length) ||
      (Array.isArray(t.next72h) && t.next72h.length)
    );
  }
  return false;
}

function renderDailyLiveStreamCards(module, row) {
  if (!row || row.status !== "streaming" || dailyModuleHasStructuredData(module, row)) return "";
  const entries = dailyStreamEntriesForModule(module);
  const active = entries.length > 0;
  const labels = entries
    .map((entry) => entry.label || dailyStreamModuleLabel(module, entry.streamKey))
    .filter(Boolean)
    .slice(0, 2);
  const title = active ? "模块正在整理结果" : "等待模块开始输出";
  const detail = active
    ? `${labels.join(" / ") || dailyStreamModuleLabel(module)} 已在输出，完整结构化结果到齐后会整块落入本模块。`
    : "模块已进入本轮扫描队列，先保持稳定占位，避免内容逐字输出造成布局抖动。";
  return `<article class="daily-knowledge-card daily-stream-card daily-stream-card--stable ${active ? "is-active" : "is-waiting"}">
    <div class="daily-stream-card-head">
      <span>${active ? "生成中" : "排队中"}</span>
      <strong>${dailyEscapeHtml(title)}</strong>
    </div>
    <div class="daily-stream-status-line">
      <i class="daily-stream-status-dot" aria-hidden="true"></i>
      <p>${dailyEscapeHtml(detail)}</p>
    </div>
    <div class="daily-stream-skeleton" aria-hidden="true">
      <span></span><span></span><span></span>
    </div>
  </article>`;
}

function dailyCurrentReportId() {
  const row = dailyActiveReport();
  if (row && row.id) return String(row.id);
  if (row && row.previewId) return String(row.previewId);
  return "";
}

function dailyQuality(row) {
  if (!row || typeof row !== "object") return {};
  return row.quality || (row.report && row.report.quality) || (row.grounding && row.grounding.quality) || {};
}

function dailyRenderLink(ref) {
  const href = ref && (ref.href || ref.url);
  const label = ref && (ref.label || ref.source || ref.type);
  if (!href) return `<span>${dailyEscapeHtml(label || "来源")}</span>`;
  const external = /^https?:\/\//i.test(href);
  return `<a href="${dailyEscapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${dailyEscapeHtml(label || href)}</a>`;
}

function dailyAssetMoveLabel(item) {
  const raw = item && (item.asset || item.name || item.label || item.symbol || item.ticker || item.market);
  const s = String(raw || "").trim();
  if (!s) return "";
  const upper = s.toUpperCase();
  if (s.includes("比特币") || upper === "BTC" || upper === "BTCUSDT" || upper.includes("BITCOIN")) return "BTC";
  if (s.includes("黄金") || upper === "GOLD" || upper === "XAU" || upper === "XAUUSD" || upper === "GC=F") return "黄金";
  if (s.includes("纳指") || upper === "NASDAQ" || upper === "NDX" || upper === "QQQ" || upper === "NQ=F") return "纳指";
  if (s.includes("标普") || upper === "SPX" || upper === "SPY" || upper === "S&P 500" || upper === "ES=F") return "标普";
  if (s.includes("英伟达") || upper === "NVDA" || upper === "NVIDIA") return "英伟达";
  return s;
}

function dailyAssetMoveValue(item, keys) {
  if (!item || typeof item !== "object") return null;
  const bags = [item, item.moves, item.change, item.changes, item.performance, item.returns].filter((x) => x && typeof x === "object");
  for (const bag of bags) {
    for (const key of keys) {
      if (bag[key] != null && bag[key] !== "") return bag[key];
    }
  }
  return null;
}

function dailyFormatAssetMoveValue(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const pct = value;
    return `${pct > 0 ? "+" : ""}${pct.toFixed(Math.abs(pct) >= 10 ? 1 : 2)}%`;
  }
  const s = String(value).trim();
  if (!s) return "";
  if (s.includes("%")) return s;
  const n = Number(s);
  if (Number.isFinite(n)) {
    const pct = n;
    return `${pct > 0 ? "+" : ""}${pct.toFixed(Math.abs(pct) >= 10 ? 1 : 2)}%`;
  }
  return s;
}

function dailyAssetMoveTone(value) {
  const s = String(value || "").trim();
  const n = Number(s.replace(/[%+,]/g, ""));
  if (Number.isFinite(n)) {
    if (n > 0) return "up";
    if (n < 0) return "down";
  }
  if (/跌|down|bear|负/i.test(s)) return "down";
  if (/涨|up|bull|正/i.test(s)) return "up";
  return "flat";
}

function dailyCollectAssetMoves(temp) {
  const arrays = [temp.assets, temp.assetMoves, temp.crossAssetMoves].filter(Array.isArray);
  if (!arrays.length) return [];
  const knownOrder = new Map([["BTC", 0], ["黄金", 1], ["纳指", 2], ["标普", 3], ["英伟达", 4]]);
  const merged = new Map();
  arrays.flat().forEach((raw) => {
    const item = raw && typeof raw === "object" ? raw : { asset: raw };
    const label = dailyAssetMoveLabel(item);
    if (!label) return;
    const prev = merged.get(label) || { label, move24h: "", move3d: "", move7d: "" };
    const move24h = dailyFormatAssetMoveValue(dailyAssetMoveValue(item, ["24h", "h24", "day", "daily", "change24h", "pct24h", "return24h", "perf24h"]));
    const move3d = dailyFormatAssetMoveValue(dailyAssetMoveValue(item, ["3d", "d3", "threeDay", "change3d", "pct3d", "return3d", "perf3d"]));
    const move7d = dailyFormatAssetMoveValue(dailyAssetMoveValue(item, ["7d", "d7", "week", "weekly", "change7d", "pct7d", "return7d", "perf7d"]));
    merged.set(label, {
      label,
      move24h: move24h || prev.move24h,
      move3d: move3d || prev.move3d,
      move7d: move7d || prev.move7d,
    });
  });
  return Array.from(merged.values())
    .filter((x) => x.move24h || x.move3d || x.move7d)
    .sort((a, b) => (knownOrder.get(a.label) ?? 99) - (knownOrder.get(b.label) ?? 99))
    .slice(0, 8);
}

function renderDailyAssetMoves(temp) {
  const moves = dailyCollectAssetMoves(temp);
  if (!moves.length) return "";
  const cell = (label, value) => {
    const text = value || "—";
    return `<span class="${dailyAssetMoveTone(text)}"><small>${label}</small><strong>${dailyEscapeHtml(text)}</strong></span>`;
  };
  return `
    <div class="daily-temperature-assets" aria-label="基础资产涨跌幅">
      ${moves.map((x) => `
        <article class="daily-temperature-asset-card">
          <b>${dailyEscapeHtml(x.label)}</b>
          <div>
            ${cell("24h", x.move24h)}
            ${cell("3d", x.move3d)}
            ${cell("7d", x.move7d)}
          </div>
        </article>
      `).join("")}
    </div>`;
}

function renderDailyTemperature(row) {
  const temp = row.report.marketTemperature || {};
  const n = Math.max(0, Math.min(100, Number(temp.score) || 0));
  const details = [
    temp.regime && temp.regime !== "信息中性" ? { label: "阅读环境", value: temp.regime, tone: "info" } : null,
    temp.crossAsset ? { label: "资产背景", value: temp.crossAsset, tone: "asset" } : null,
    temp.anomaly && temp.anomaly !== "无" ? { label: "噪音预警", value: temp.anomaly, tone: "warn" } : null,
    temp.suggestion ? { label: "建议", value: temp.suggestion, tone: "ok" } : null,
  ].filter(Boolean);
  const assetMovesHtml = renderDailyAssetMoves(temp);
  const liveHtml = renderDailyLiveStreamCards("temperature", row);
  return `
    <section class="news-panel span-12 daily-module-panel daily-module-temperature daily-brief-temperature${dailyModuleStateClass("temperature", row)}" ${dailyModuleStateAttrs("temperature", row)} style="view-transition-name: daily-temperature;" aria-label="当前信息温度">
      <div class="news-panel-head daily-module-head">
        <h3>当前信息温度</h3>
      </div>
      <div class="daily-temperature-body">
        <div class="daily-temperature-score" aria-label="当前信息温度 ${n} 分">
          <strong>${n}</strong>
          <span>/ 100</span>
        </div>
        <div class="daily-temperature-main">
          <p class="daily-temperature-summary">${dailyEscapeHtml(temp.summary || "当前信息温度中性，可正常阅读各类来源信息。")}</p>
          ${details.length ? `<div class="daily-temperature-meta">${details.map((x) => `<span class="daily-temp-meta-${dailyEscapeHtml(x.tone)}"><b>${dailyEscapeHtml(x.label)}</b>${dailyEscapeHtml(x.value)}</span>`).join("")}</div>` : ""}
          ${assetMovesHtml}
          ${liveHtml}
        </div>
      </div>
    </section>
  `;
}

function dailyTopStories(row) {
  const report = row && row.report ? row.report : {};
  const stories = Array.isArray(report.topStories) && report.topStories.length ? report.topStories : [report.topStory].filter(Boolean);
  return stories.length ? stories : [{}];
}

function dailyImpactDirectionMeta(direction) {
  const s = String(direction || "").trim().toLowerCase();
  if (s === "up" || s.includes("利多") || s.includes("bull")) return { cls: "up", label: "利多" };
  if (s === "down" || s.includes("利空") || s.includes("bear")) return { cls: "down", label: "利空" };
  return { cls: "shock", label: "震荡" };
}

function renderDailyTopStory(story, idx = 0) {
  const item = story && typeof story === "object" ? story : {};
  let structureHtml = "";
  if (Array.isArray(item.structure)) {
    structureHtml = item.structure.map((x) => `<span>${parseMarkdownInline(x)}</span>`).join("");
  } else if (item.structure && typeof item.structure === "object") {
    structureHtml = [
      item.structure.trigger ? `<span><strong>触发原因：</strong>${parseMarkdownInline(item.structure.trigger)}</span>` : "",
      item.structure.conflict ? `<span><strong>深层矛盾：</strong>${parseMarkdownInline(item.structure.conflict)}</span>` : "",
      item.structure.divergence ? `<span><strong>各方分歧：</strong>${parseMarkdownInline(item.structure.divergence)}</span>` : "",
    ].join("");
  } else if (item.structure) {
    structureHtml = `<span>${parseMarkdownInline(item.structure)}</span>`;
  }
  if (!structureHtml) structureHtml = `<span class="muted-text">等待事实池补充诱因、矛盾和预期差信息。</span>`;

  let impactsHtml = "";
  if (Array.isArray(item.impacts)) {
    impactsHtml = item.impacts.map((raw) => {
      const imp = raw && typeof raw === "object" ? raw : { asset: "传导", logic: raw };
      return `<span><strong>${dailyEscapeHtml(imp.asset || imp.scope || "情景")}：</strong>${parseMarkdownInline(imp.logic || imp.reason || "等待观察。")}</span>`;
    }).join("");
  } else if (Array.isArray(item.transmission)) {
    impactsHtml = item.transmission.map((x) => `<span>${parseMarkdownInline(x)}</span>`).join("");
  }
  if (!impactsHtml) impactsHtml = `<span class="muted-text">等待资产传导确认。</span>`;

  const watchHtml = item.nextWatch ? `<div class="daily-story-section daily-story-section--watch"><b>后续观察</b><span>${parseMarkdownInline(item.nextWatch)}</span></div>` : "";

  const sourceTag = item.sourceUrl
    ? `<a href="${dailyEscapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${dailyEscapeHtml(item.sourceName || "来源")}</a>`
    : item.sourceName
      ? `<span>${dailyEscapeHtml(item.sourceName)}</span>`
      : "";
  return `
    <article class="news-story daily-knowledge-card daily-top-story-card">
      <div class="news-story-body">
        <div class="daily-story-header">
          <div class="news-story-meta">
            <span class="news-story-category">${dailyEscapeHtml(item.category || "今日头条")}</span>
            <span>${dailyEscapeHtml(item.occurredAt || "近期")} · ${dailyEscapeHtml(item.duration || "正在持续")}</span>
            ${sourceTag}
          </div>
          <span class="daily-story-index">${String(idx + 1).padStart(2, "0")}</span>
        </div>
        <h3 class="daily-story-title">${parseMarkdownInline(item.title || "暂无头条")}</h3>
        <div class="daily-story-section daily-story-section--fact"><b>事实锁定</b><span>${parseMarkdownInline(item.fact || "等待事实池补充。")}</span></div>
        <div class="daily-story-matrix">
          <div class="daily-story-section daily-story-section--structure"><b>结构拆解</b><div class="daily-column-lines">${structureHtml}</div></div>
          <div class="daily-story-section daily-story-section--impact"><b>传导预判</b><div class="daily-column-lines">${impactsHtml}</div></div>
        </div>
        ${watchHtml}
      </div>
    </article>
  `;
}

function renderDailyTopStories(row) {
  const liveHtml = renderDailyLiveStreamCards("topStories", row);
  if (liveHtml) return liveHtml;
  return dailyTopStories(row).slice(0, 5).map((story, idx) => renderDailyTopStory(story, idx)).join("");
}

function renderDailyBriefs(row) {
  const report = row && row.report ? row.report : {};
  const briefs = Array.isArray(report.dynamicBriefs) ? report.dynamicBriefs : [];
  const liveHtml = renderDailyLiveStreamCards("dynamicBriefs", row);
  if (!briefs.length && liveHtml) return liveHtml;
  if (!briefs.length) {
    return renderDailyPlaceholderCard({
      category: "系统状态",
      title: "等待下一轮事实采集",
      fact: "暂未出现新的次级事件。",
      note: "等待下一轮采集刷新后，再判断是否出现新的主题扩散。",
    });
  }
  return briefs
    .map(
      (item, idx) => {
        const sourceTag = item.sourceUrl
          ? `<a href="${dailyEscapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${dailyEscapeHtml(item.sourceName || "来源")}</a>`
          : item.sourceName
            ? `<span>${dailyEscapeHtml(item.sourceName)}</span>`
            : "";
        const description = item.description || item.detail || "";
        const analysis = item.analysis || item.watch || "";
        const watch = item.watch && item.watch !== analysis ? item.watch : "";
        const timeStr = item.time ? `<span>${dailyEscapeHtml(item.time)}</span>` : "";
        return `
        <article class="news-story daily-knowledge-card daily-brief-story">
          <div class="news-story-body">
            <div class="daily-story-header">
              <div class="news-story-meta">
                <span class="news-story-category">${dailyEscapeHtml(item.category || "动态")}</span>
                ${timeStr}
                ${sourceTag}
              </div>
            </div>
            <h3>${parseMarkdownInline(item.title || "")}</h3>
            <p class="daily-brief-copy">${parseMarkdownInline(item.body || description || "等待下一轮事实采集。")}</p>
            ${analysis ? `<p class="daily-brief-copy muted"><b>判断</b>${parseMarkdownInline(analysis)}</p>` : ""}
            ${watch ? `<p class="daily-brief-copy watch"><b>观察</b>${parseMarkdownInline(watch)}</p>` : ""}
          </div>
        </article>
      `;
      },
    )
    .join("");
}

function renderDailyAi(row) {
  const report = row && row.report ? row.report : {};
  const items = Array.isArray(report.aiIntel) ? report.aiIntel : [];
  const liveHtml = renderDailyLiveStreamCards("aiIntel", row);
  if (!items.length && liveHtml) return liveHtml;
  if (!items.length) {
    return renderDailyPlaceholderCard({
      category: "AI 情报站",
      title: "等待高价值科技情报",
      fact: "本轮暂未提取到值得单独保留的 AI 发布、工具或叙事变化。",
      note: "实时扫描完成后，若有 S/A 级信息会补充到这里。",
      extraClass: "daily-ai-placeholder",
    });
  }
  return items
    .map(
      (item) => {
        const fact = item.coreFact || item.what || "";
        const value = item.actionableValue || item.use || "";
        const scenario = item.applicationScenario || item.scenario || "";
        const rating = item.rating || item.attention || "";
        const source = item.sourceUrl
          ? `<a href="${dailyEscapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${dailyEscapeHtml(item.sourceName || "来源")}</a>`
          : item.sourceName
            ? dailyEscapeHtml(item.sourceName)
            : "";
        return `<div class="daily-ai-card">
        <div>
          <h4>${parseMarkdownInline(item.title || "")}</h4>
          <span class="daily-ai-date">发布日期：${dailyEscapeHtml(item.date || "近72小时")}${rating ? ` · ${dailyEscapeHtml(rating)}` : ""}</span>
          <p><strong>核心突破：</strong>${parseMarkdownInline(fact || "等待下一轮实时检索补齐。")}</p>
          <p><strong>落地价值：</strong>${parseMarkdownInline(value || "等待下一轮实时检索补齐。")}</p>
          ${scenario ? `<p><strong>应用场景：</strong>${parseMarkdownInline(scenario)}</p>` : ""}
          ${source ? `<div class="news-source-inline">来源：${source}</div>` : ""}
        </div>
      </div>`;
      },
    )
    .join("");
}

function renderDailyGithubTools(row) {
  const report = row && row.report ? row.report : {};
  const tools = Array.isArray(report.githubTools) ? report.githubTools : [];
  const liveHtml = renderDailyLiveStreamCards("githubTools", row);
  if (!tools.length && liveHtml) return liveHtml;
  if (!tools.length) {
    return renderDailyPlaceholderCard({
      category: "GitHub 工具雷达",
      title: "等待工具雷达结果",
      fact: "GitHub 工具雷达暂无结果。请确认本模块在扫描范围中已开启，并等待 Worker 完成本轮 Gemini + Google Search 检索。",
      note: "这里会保留适合 Vibecoding 新人的 skill、plugin、MCP 或工具仓库。",
      extraClass: "daily-github-placeholder",
    });
  }
  return tools
    .map((item) => {
      const source = item.sourceUrl
        ? `<a href="${dailyEscapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${dailyEscapeHtml(item.sourceName || item.repo || "GitHub")}</a>`
        : item.sourceName
          ? dailyEscapeHtml(item.sourceName)
          : "";
      const rating = item.rating || item.fit || "";
      return `<div class="daily-ai-card">
        <div>
          <h4>${parseMarkdownInline(item.title || "GitHub AI 工具")}</h4>
          <span class="daily-ai-date">发布日期：${dailyEscapeHtml(item.date || "近14天")}${rating ? ` · ${dailyEscapeHtml(rating)}` : ""}</span>
          <p><strong>为什么适合我：</strong>${parseMarkdownInline(item.whyUseful || "")}</p>
          <p><strong>第一步：</strong>${parseMarkdownInline(item.howToUse || "")}</p>
          ${source ? `<div class="news-source-inline">来源：${source}</div>` : ""}
        </div>
      </div>`;
    })
    .join("");
}

function renderDailyPlaceholderCard(options = {}) {
  const category = options.category || "模块状态";
  const title = options.title || "等待下一轮更新";
  const fact = options.fact || "当前模块暂未返回可展示内容。";
  const note = options.note || "模块保持预留，后续数据到达后会自动填充。";
  const extraClass = options.extraClass || "";
  return `
    <article class="news-story daily-knowledge-card daily-placeholder-card ${dailyEscapeHtml(extraClass)}">
      <div class="news-story-body">
        <div class="daily-story-header">
          <div class="news-story-meta">
            <span class="news-story-category">${dailyEscapeHtml(category)}</span>
            <span>预留卡片</span>
          </div>
        </div>
        <h3>${dailyEscapeHtml(title)}</h3>
        <div class="daily-story-section daily-story-section--fact"><b>当前状态</b><span>${dailyEscapeHtml(fact)}</span></div>
        <div class="daily-story-section daily-story-section--watch"><b>后续观察</b><span>${dailyEscapeHtml(note)}</span></div>
      </div>
    </article>`;
}

function cleanTrendText(value) {
  return String(value == null ? "" : value).trim();
}

function dailyTrendList(value) {
  if (Array.isArray(value)) return value.filter((x) => x != null && x !== "");
  if (value == null || value === "") return [];
  return [value];
}

function dailyTrendEntryField(item, keys, fallback = "") {
  if (!item || typeof item !== "object") return cleanTrendText(item || fallback);
  for (const key of keys) {
    if (item[key] != null && item[key] !== "") return cleanTrendText(item[key]);
  }
  return cleanTrendText(fallback);
}

function renderDailyTrendEvidence(item) {
  if (!item || typeof item !== "object") return "";
  const evidence = dailyTrendList(item.evidence || item.inputEvidence || item.modules || item.from)
    .map((x) => cleanTrendText(x))
    .filter(Boolean)
    .slice(0, 3);
  return evidence.length ? `<span class="muted-text">依据：${evidence.map(dailyEscapeHtml).join(" / ")}</span>` : "";
}

function renderDailyTrendRows(rows, fallbackText) {
  const items = dailyTrendList(rows);
  if (!items.length) return `<p class="muted-text">${dailyEscapeHtml(fallbackText)}</p>`;
  return items
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return `<p>${parseMarkdownInline(item)}</p>`;
      }
      const title = dailyTrendEntryField(item, ["title", "signal", "checkpoint", "label", "topic", "name"]);
      const body = dailyTrendEntryField(item, ["synthesis", "body", "summary", "why", "logic", "tension", "action", "signal"], fallbackText);
      const watch = dailyTrendEntryField(item, ["watch", "nextWatch", "sourceHint", "verify", "next"]);
      const evidence = renderDailyTrendEvidence(item);
      const meta = [evidence, watch ? `<span class="muted-text">观察：${parseMarkdownInline(watch)}</span>` : ""].filter(Boolean).join("<br>");
      return `<p>${title ? `<strong>${dailyEscapeHtml(title)}：</strong>` : ""}${parseMarkdownInline(body)}${meta ? `<br>${meta}` : ""}</p>`;
    })
    .join("");
}

function renderDailyTrendBlock(title, rows, cls, fallbackText) {
  return `<div class="news-trend-block ${cls}">
    <h4>${dailyEscapeHtml(title)}</h4>
    ${renderDailyTrendRows(rows, fallbackText)}
  </div>`;
}

function renderDailyTrendSearchFindings(items) {
  const rows = dailyTrendList(items).filter((item) => item && typeof item === "object" && !Array.isArray(item)).slice(0, 4);
  if (!rows.length) return "";
  return `<div class="daily-trend-close-section">
    <h5>外部校准</h5>
    <div class="daily-trend-finding-list">
      ${rows
        .map((item) => {
          const title = dailyTrendEntryField(item, ["title", "topic", "label"], "校准点");
          const finding = dailyTrendEntryField(item, ["finding", "summary", "body", "evidence", "fact"], "外部来源仍待补强。");
          const relation = dailyTrendEntryField(item, ["relation", "why", "linkToDaily", "meaning"]);
          const sourceName = dailyTrendEntryField(item, ["sourceName", "source", "publisher"], "来源");
          const sourceUrl = dailyTrendEntryField(item, ["sourceUrl", "url", "href"]);
          const source = dailyRenderLink({ label: sourceName, href: sourceUrl });
          return `<div class="daily-trend-finding">
            <strong>${dailyEscapeHtml(title)}</strong>
            <p>${parseMarkdownInline(finding)}</p>
            <span>${source}${relation ? ` · ${dailyEscapeHtml(relation)}` : ""}</span>
          </div>`;
        })
        .join("")}
    </div>
  </div>`;
}

function renderDailyTrendWatchline(items) {
  const rows = dailyTrendList(items).slice(0, 5);
  if (!rows.length) return "";
  return `<div class="daily-trend-close-section">
    <h5>接下来读</h5>
    <ul class="daily-trend-watchline">
      ${rows
        .map((item, idx) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return `<li><span>${String(idx + 1).padStart(2, "0")}</span><p>${parseMarkdownInline(item)}</p></li>`;
          }
          const title = dailyTrendEntryField(item, ["title", "topic", "label"], "继续阅读");
          const why = dailyTrendEntryField(item, ["why", "reason", "watch", "body", "synthesis", "next"], "等待权威来源补充。");
          const sourceHint = dailyTrendEntryField(item, ["sourceHint", "source", "where", "verify"]);
          return `<li>
            <span>${String(idx + 1).padStart(2, "0")}</span>
            <p><strong>${dailyEscapeHtml(title)}：</strong>${parseMarkdownInline(why)}${sourceHint ? `<br><em>${dailyEscapeHtml(sourceHint)}</em>` : ""}</p>
          </li>`;
        })
        .join("")}
    </ul>
  </div>`;
}

function renderDailyTrend(row) {
  const report = row && row.report ? row.report : {};
  const liveHtml = renderDailyLiveStreamCards("trends", row);
  if (liveHtml) return liveHtml;
  const t = report.trendRead || {};
  const macroTrend = report.macroTrend || "";
  const hasClosingTrend = !!(
    t.verdict ||
    t.closingRead ||
    t.searchFindings ||
    t.watchline ||
    t.uncertainty ||
    (t.methodology && t.methodology.promptVersion === "daily-trend-search-v1")
  );
  if (hasClosingTrend) {
    const method = t.methodology && typeof t.methodology === "object" ? t.methodology : {};
    const mode = method.mode || "上游模块 + 外部搜索校准";
    const searchLine = method.usesGoogleSearch === false ? "未记录额外检索" : "已做外部检索校准";
    const verdict = t.verdict || t.summary || macroTrend || "本轮日报仍需更多外部来源校准，先按已确认事实保守阅读。";
    const paragraphs = dailyTrendList(t.closingRead || t.editorialRead || t.narrative || [])
      .map((x) => cleanTrendText(typeof x === "object" ? x.text || x.body || x.summary || x.synthesis : x))
      .filter(Boolean)
      .slice(0, 4);
    const body = paragraphs.length ? paragraphs : [verdict];
    return `<article class="news-trend-block daily-trend-brief">
      <div class="daily-trend-brief-head">
        <h4>${dailyEscapeHtml(t.title || "总编辑收束")}</h4>
        <span>${dailyEscapeHtml(searchLine)}</span>
      </div>
      <p class="daily-trend-verdict">${parseMarkdownInline(verdict)}</p>
      <div class="daily-trend-paragraphs">
        ${body.map((p) => `<p>${parseMarkdownInline(p)}</p>`).join("")}
      </div>
      ${renderDailyTrendSearchFindings(t.searchFindings || t.externalChecks || t.verifications)}
      ${t.uncertainty ? `<div class="daily-trend-uncertainty"><b>仍需留白</b><span>${parseMarkdownInline(t.uncertainty)}</span></div>` : ""}
      ${renderDailyTrendWatchline(t.watchline || t.nextRead || t.readNext)}
      <div class="daily-trend-method">方法：${dailyEscapeHtml(mode)}。</div>
    </article>`;
  }
  const hasStructuredTrend = !!(
    t.summary ||
    t.worldNews ||
    t.techPulse ||
    t.financeBackdrop ||
    t.contradictions ||
    t.next72h ||
    (t.methodology && typeof t.methodology === "object")
  );
  if (hasStructuredTrend) {
    const method = t.methodology && typeof t.methodology === "object" ? t.methodology : {};
    const methodLine = method.mix || "重度世界新闻 + 中度科技 + 轻量金融背景";
    const searchLine = method.usesGoogleSearch === true ? "趋势线索已使用外部校准" : "未记录外部校准，仅展示旧版合成结果";
    const summary = t.summary || macroTrend || "本轮日报尚未形成足够清晰的合成主线。";
    return [
      `<div class="news-trend-block info" style="grid-column: 1 / -1;">
        <h4>${dailyEscapeHtml(t.title || "日报线索合成")}</h4>
        <p>${parseMarkdownInline(summary)}<br><span class="muted-text">方法：${dailyEscapeHtml(methodLine)}；${dailyEscapeHtml(searchLine)}。</span></p>
      </div>`,
      renderDailyTrendBlock("世界新闻主线", t.worldNews, "ok", "等待今日头条与动态速览形成更明确的世界新闻主线。"),
      renderDailyTrendBlock("科技扩散脉冲", t.techPulse, "info", "等待 AI 情报站或 GitHub 工具雷达提供可落地的科技线索。"),
      renderDailyTrendBlock("轻量金融背景", t.financeBackdrop, "info", "金融信息只作为阅读背景，不输出交易方向。"),
      renderDailyTrendBlock("叙事裂缝", t.contradictions, "warn", "暂无明显叙事裂缝；继续等待来源互相印证。"),
      renderDailyTrendBlock("0-72小时观察清单", dailyTrendList(t.next72h).length ? t.next72h : [t.conclusion], "info", "继续跟踪权威来源、主流媒体、产品发布或政策细节。"),
    ].join("");
  }
  const strengthening = macroTrend
    ? [macroTrend, ...(t.strengthening || []).filter((x) => x !== macroTrend).slice(0, 1)]
    : t.strengthening;
  return [
    renderDailyTrendBlock("正在强化的信号", strengthening, "ok", "最近72小时内的候选信息会在这里汇总，优先观察哪些主题正在连续出现。"),
    renderDailyTrendBlock("正在裂变的信号", t.cracking, "warn", "若事实密度不足，先降低分歧判断权重，等待更多来源确认。"),
    renderDailyTrendBlock("0-72小时观察结论", t.conclusion ? [t.conclusion] : [], "info", "24-72小时观察：跟踪高价值事件是否获得官方口径与主流来源共同确认。"),
  ].join("");
}

function renderDailySources(row) {
  const sources = row.report.sources || [];
  if (!sources.length) return `<p class="muted-text">暂无来源列表。</p>`;
  return sources
    .map(
      (src) => `<div class="news-source-row">
        <div>
          <strong>${dailyEscapeHtml(src.name || "Unknown")}</strong>
          <span>${dailyEscapeHtml(src.type || "fact_pool")}${src.count ? ` · ${Number(src.count)}条` : ""}</span>
        </div>
        <em>${dailyEscapeHtml(src.reliability || "中")}</em>
      </div>`,
    )
    .join("");
}

function renderDailyRefs(row) {
  const refs = row.sourceRefs || [];
  if (!refs.length) return "";
  return `<div class="news-ref-row">${refs.slice(0, 8).map((ref) => dailyRenderLink(ref)).join("")}</div>`;
}

function dailyArchiveFilteredHistory() {
  const raw = dailyEventState.history.length ? dailyEventState.history : [];
  const mode = dailyEventState.archiveFilter || "all";
  if (mode === "all") return raw;
  const filter = DAILY_ARCHIVE_FILTERS.find((x) => x.key === mode);
  if (filter && filter.days) {
    const cutoff = Date.now() - filter.days * 86400000;
    return raw.filter((item) => {
      const ts = Date.parse(item.generatedAt || item.reportDate || "");
      return Number.isFinite(ts) && ts >= cutoff;
    });
  }
  return raw.filter((item) => {
    const t = String(item.triggerType || "").toLowerCase();
    if (mode === "manual") return t === "manual";
    if (mode === "scheduled") return t !== "manual";
    const searchCost = dailyArchiveSearchCostCny(item);
    if (mode === "costed") return searchCost != null && searchCost > 0;
    if (mode === "free") return searchCost == null || searchCost <= 0;
    return true;
  });
}

function dailyArchiveCostEstimate(item) {
  if (!item || typeof item !== "object") return null;
  if (item.costEstimate && typeof item.costEstimate === "object") return item.costEstimate;
  if (item.grounding && item.grounding.costEstimate && typeof item.grounding.costEstimate === "object") return item.grounding.costEstimate;
  if (item.report && item.report.costEstimate && typeof item.report.costEstimate === "object") return item.report.costEstimate;
  return null;
}

function dailyArchiveCostNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function dailyArchiveSearchCostCny(item) {
  const est = dailyArchiveCostEstimate(item);
  if (!est) return null;
  return dailyArchiveCostNumber(est.searchCny ?? est.searchCostCny ?? est.searchCost?.cny ?? est.search?.costCny);
}

function dailyArchiveTotalCostCny(item) {
  const est = dailyArchiveCostEstimate(item);
  if (!est) return null;
  return dailyArchiveCostNumber(est.totalCny ?? est.totalCostCny ?? est.costCny ?? est.total?.cny ?? est.total?.costCny);
}

function dailyFormatCostCny(value) {
  const n = dailyArchiveCostNumber(value);
  if (n == null) return "待记录";
  if (n === 0) return "¥0.0000";
  if (n < 0.01) return `¥${n.toFixed(4)}`;
  return `¥${n.toFixed(2)}`;
}

function renderDailyArchiveCostLine(item) {
  const est = dailyArchiveCostEstimate(item);
  if (!est) return `<span class="news-archive-cost is-missing"><i class="ph ph-receipt"></i>费用待记录</span>`;
  const searchCny = dailyArchiveSearchCostCny(item);
  const totalCny = dailyArchiveTotalCostCny(item);
  const billable = Number(est.billableSearchUnits || est.searchBillableUnits || 0);
  const queries = Number(est.searchQueryCount || est.searchQueries || est.search?.queryCount || 0);
  const unitText = billable > 0 || queries > 0 ? ` · ${Math.max(billable, queries)}次` : "";
  return `<span class="news-archive-cost"><i class="ph ph-magnifying-glass"></i>搜索 ${dailyFormatCostCny(searchCny)}${unitText}</span><span class="news-archive-cost is-total"><i class="ph ph-currency-cny"></i>总计 ${dailyFormatCostCny(totalCny)}</span>`;
}

function renderDailyArchiveCostSummary() {
  const rows = dailyEventState.history || [];
  const filtered = dailyArchiveFilteredHistory();
  const sum = (items, pick) => items.reduce((acc, item) => acc + (dailyArchiveCostNumber(pick(item)) || 0), 0);
  const searchTotal = sum(rows, dailyArchiveSearchCostCny);
  const filteredSearch = sum(filtered, dailyArchiveSearchCostCny);
  const totalCost = sum(rows, dailyArchiveTotalCostCny);
  const searchUnits = rows.reduce((acc, item) => {
    const est = dailyArchiveCostEstimate(item);
    return acc + (Number(est && (est.billableSearchUnits || est.searchBillableUnits || est.searchQueryCount || est.searchQueries || est.search?.queryCount)) || 0);
  }, 0);
  return `
    <div class="daily-archive-cost-summary">
      <div>
        <span>${DAILY_ARCHIVE_HISTORY_DAYS}日搜索费</span>
        <strong>${dailyFormatCostCny(searchTotal)}</strong>
      </div>
      <div>
        <span>当前筛选</span>
        <strong>${dailyFormatCostCny(filteredSearch)}</strong>
      </div>
      <div>
        <span>综合估算</span>
        <strong>${dailyFormatCostCny(totalCost)}</strong>
      </div>
      <div>
        <span>搜索计费次</span>
        <strong>${dailyEscapeHtml(String(searchUnits))}</strong>
      </div>
    </div>`;
}

function renderDailyArchiveList() {
  const items = dailyArchiveFilteredHistory();
  if (!items.length) {
    return `<p class="daily-archive-empty muted-text">该时间范围下暂无记录，可切换到「全部」或改天再试。</p>`;
  }
  let lastDate = "";
  const curId = dailyCurrentReportId();
  return items
    .map((item) => {
      const date = item.reportDate || "";
      const dateHead = date && date !== lastDate ? `<div class="news-archive-date">${dailyEscapeHtml(date)}</div>` : "";
      lastDate = date || lastDate;
      const active = !!item.id && item.id === curId;
      const title = item.title || (item.report && (item.report.title || item.report.topStory?.title)) || "日报";
      const deleteBtn = item.id
        ? `<button type="button" class="news-archive-delete" data-report-id="${dailyEscapeHtml(item.id)}" title="从云端 D1 删除此条" aria-label="删除此条存档"><i class="ph ph-trash"></i></button>`
        : "";
      return `${dateHead}<div class="news-archive-row">
        <button type="button" class="news-archive-item ${active ? "active" : ""}" data-report-id="${dailyEscapeHtml(item.id)}">
          <span class="news-archive-slot">${dailyEscapeHtml(dailySlotLabel(item))}</span>
          <strong>${dailyEscapeHtml(title)}</strong>
          <span class="news-archive-meta">
            <em>${dailyEscapeHtml(dailyFormatTime(item.generatedAt))}</em>
            <small>${dailyEscapeHtml(dailyTriggerLabel(item))}</small>
          </span>
          <span class="news-archive-cost-row">${renderDailyArchiveCostLine(item)}</span>
      </button>${deleteBtn}</div>`;
    })
    .join("");
}

function renderDailyArchiveFilters() {
  const cur = dailyEventState.archiveFilter || "all";
  const mk = (key, label) =>
    `<button type="button" class="daily-archive-filter ${cur === key ? "active" : ""}" data-archive-filter="${dailyEscapeHtml(key)}" role="tab" aria-selected="${cur === key ? "true" : "false"}">${dailyEscapeHtml(label)}</button>`;
  return `<div class="daily-archive-filters" role="tablist">${DAILY_ARCHIVE_FILTERS.map((item) => mk(item.key, item.label)).join("")}</div>`;
}

function renderDailyArchiveChrome() {
  return `
    <div class="news-archive-backdrop daily-drawer-backdrop" id="daily-archive-backdrop" hidden></div>
    <aside class="news-archive-drawer daily-drawer daily-archive-drawer" id="daily-archive-drawer" aria-hidden="true">
      <div class="news-archive-head">
        <div>
          <h3>历史报告与费用</h3>
        </div>
        <button type="button" class="btn daily-drawer-close" id="daily-close-archive" title="关闭报告库">
          <i class="ph ph-x"></i><span>关闭</span>
        </button>
      </div>
      ${renderDailyArchiveFilters()}
      ${renderDailyArchiveCostSummary()}
      <div class="news-archive-list">${renderDailyArchiveList()}</div>
    </aside>`;
}

function renderDailySettingsChrome() {
  const v = __yuqingSettings.visibility;
  const s = __yuqingSettings.scanCoverage;
  
  const mkToggle = (key, label, checked, type) => {
    const hint = type === "scan" ? "纳入实时扫描" : "本页显示";
    return `
      <label class="daily-setting-row ${checked ? "is-on" : "is-off"}">
        <span class="daily-setting-copy">
          <strong>${dailyEscapeHtml(label)}</strong>
          <small>${dailyEscapeHtml(hint)}</small>
        </span>
        <div class="toggle-switch">
          <input type="checkbox" class="daily-setting-cb" data-key="${key}" data-type="${type}" ${checked ? "checked" : ""} aria-label="${dailyEscapeHtml(label)}">
          <span class="slider"></span>
        </div>
      </label>
    `;
  };

  return `
    <div class="news-archive-backdrop daily-drawer-backdrop" id="daily-settings-backdrop" hidden></div>
    <aside class="news-archive-drawer daily-drawer daily-settings-drawer" id="daily-settings-drawer" aria-hidden="true">
      <div class="news-archive-head">
        <div>
          <h3>事件一览设置</h3>
        </div>
        <button type="button" class="btn daily-drawer-close" id="daily-close-settings" title="关闭设置">
          <i class="ph ph-x"></i><span>关闭</span>
        </button>
      </div>
      <div class="daily-settings-body">
        <section class="daily-settings-section">
          <div class="daily-settings-section-head">
            <h4>仪表盘可见度</h4>
            <p>只影响当前页面，不改变后台生成内容。</p>
          </div>
          <div class="daily-settings-group">
            ${mkToggle("dashboard", "信息温度", v.dashboard, "visibility")}
            ${mkToggle("news", "今日头条", v.news, "visibility")}
            ${mkToggle("timeline", "动态速览", v.timeline, "visibility")}
            ${mkToggle("ai", "AI 情报站", v.ai, "visibility")}
            ${mkToggle("githubTools", "GitHub 工具雷达", v.githubTools, "visibility")}
            ${mkToggle("trends", "趋势线索", v.trends, "visibility")}
          </div>
        </section>

        <section class="daily-settings-section">
          <div class="daily-settings-section-head">
            <h4>实时扫描覆盖</h4>
            <p>决定点击「实时扫描」时 Worker 与模型会跑哪些模块；趋势线索会等上游完成后再做外部搜索校准。</p>
          </div>
          <div class="daily-settings-group">
            ${mkToggle("dashboard", "信息温度", s.dashboard, "scan")}
            ${mkToggle("news", "今日头条", s.news, "scan")}
            ${mkToggle("timeline", "动态速览", s.timeline, "scan")}
            ${mkToggle("ai", "AI 情报站", s.ai, "scan")}
            ${mkToggle("githubTools", "GitHub 工具雷达", s.githubTools, "scan")}
            ${mkToggle("trends", "趋势线索（外部校准）", s.trends, "scan")}
          </div>
        </section>

        <div class="daily-settings-actions">
          <button type="button" class="btn primary" id="daily-save-settings" ${__yuqingSettingsSaving ? "disabled" : ""}>
            ${__yuqingSettingsSaving ? '<i class="ph ph-spinner-gap spin"></i><span>保存中</span>' : '<i class="ph ph-floppy-disk"></i><span>保存并应用</span>'}
          </button>
        </div>
      </div>
    </aside>`;
}

function renderDailyReportHeader(r) {
  const badge = r ? dailyHeaderScanBadge(r) : "";
  const badgeHtml =
    badge !== ""
      ? `<div class="daily-report-meta daily-report-meta--title"><span>${dailyEscapeHtml(badge)}</span></div>`
      : "";
  const scanStatusHtml = renderDailyScanStatusPanel();
  const scanButtonClass = dailyEventState.loading ? "btn primary is-scanning" : "btn primary";
  return `
    <div class="news-command daily-event-command" style="view-transition-name: daily-command-bar;">
      <div class="news-command-main daily-command-main">
        <div class="daily-report-trigger">
          <div class="daily-report-trigger-title-row">
            <span class="daily-report-trigger-label">世界情报收集</span>
            ${badgeHtml}
          </div>
          <div class="daily-report-trigger-row">
            <i class="ph ph-clock" aria-hidden="true"></i>
            <strong>${dailyEscapeHtml(dailyFormatTriggeredSearchAt(r && r.generatedAt ? r.generatedAt : null))}</strong>
          </div>
        </div>
      </div>
      <div class="news-command-actions">
        <button type="button" class="${scanButtonClass}" id="daily-scan-preview" ${dailyEventState.loading ? "disabled" : ""} title="单次请求 Worker：NDJSON 流式返回，模块就绪即显示；温度/头条/速览/AI 并行检索（头条可双路），趋势最后归纳；完成后写入 D1（约 1～5 分钟）">
          <i class="ph ${dailyEventState.loading ? "ph-spinner-gap spin" : "ph-rocket-launch"}"></i><span>${dailyEventState.loading ? "扫描中" : "实时扫描"}</span>
        </button>
        <button type="button" class="btn primary" id="daily-open-archive">
          <i class="ph ph-clock-counter-clockwise"></i><span>历史报告与费用</span>
        </button>
        <button type="button" class="btn secondary" id="daily-open-settings" title="配置仪表盘模块可见度与实时扫描覆盖范围">
          <i class="ph ph-gear"></i><span>设置</span>
        </button>
      </div>
    </div>
    ${scanStatusHtml}`;
}

function dailyPanelClass(span, name, extra = "", moduleKey = name, row = dailyActiveReport()) {
  return `news-panel span-${span} daily-module-panel daily-module-${name}${extra ? ` ${extra}` : ""}${moduleKey ? dailyModuleStateClass(moduleKey, row) : ""}`;
}

function renderDailyReportGrid(r) {
  if (!r || !r.report) {
    const st = dailyEscapeHtml(dailyEventState.status || "暂无云端事件日报");
    return `
    <div class="daily-event-empty daily-dashboard-grid-empty">
      <p class="muted-text">${st}</p>
      <p class="muted-text">可用「实时扫描」写入一条至 D1，或打开 7 日报告库从历史记录中选择。</p>
    </div>`;
  }

  const v = __yuqingSettings.visibility;
  let html = `<div class="news-intel-grid daily-dashboard-grid" style="view-transition-name: daily-grid;">`;
  
  if (v.dashboard) {
    html += `\n${renderDailyTemperature(r)}`;
  }
  
  const showNews = v.news;
  const showTimeline = v.timeline;
  
  if (showNews) {
    html += `
      <section class="${dailyPanelClass(showTimeline ? 7 : 12, "news", showTimeline ? "daily-balanced-panel" : "daily-expanded-panel", "topStories", r)}" ${dailyModuleStateAttrs("topStories", r)} style="view-transition-name: daily-news;">
        <div class="news-panel-head daily-module-head">
          <div>
            <span class="news-section-kicker">今日头条</span>
            <h3>高价值事件拆解</h3>
            <p class="daily-module-subtitle">把单条事件拆成事实、结构与资产传导，而不是只看标题。</p>
          </div>
        </div>
        <div class="news-story-list">${renderDailyTopStories(r)}</div>
      </section>`;
  }
  
  if (showTimeline) {
    html += `
      <section class="${dailyPanelClass(showNews ? 5 : 12, "timeline", showNews ? "daily-balanced-panel daily-timeline-panel" : "daily-expanded-panel daily-timeline-panel", "dynamicBriefs", r)}" ${dailyModuleStateAttrs("dynamicBriefs", r)} style="view-transition-name: daily-timeline;">
        <div class="news-panel-head daily-module-head">
          <div>
            <span class="news-section-kicker">动态速览</span>
            <h3>政治、经济、AI 与市场</h3>
            <p class="daily-module-subtitle">用于快速发现新变量，不等同于交易方向。</p>
          </div>
        </div>
        <div class="news-story-list compact">${renderDailyBriefs(r)}</div>
      </section>`;
  }
  
  if (v.ai) {
    html += `
      <section class="${dailyPanelClass(12, "ai", "", "aiIntel", r)}" ${dailyModuleStateAttrs("aiIntel", r)} style="view-transition-name: daily-ai;">
        <div class="news-panel-head daily-module-head">
          <div>
            <span class="news-section-kicker">AI 情报站</span>
            <h3>科技叙事与日常信息</h3>
            <p class="daily-module-subtitle">保留可落地的突破、工具、发布与观察价值。</p>
          </div>
        </div>
        <div class="news-ai-list">${renderDailyAi(r)}</div>
      </section>`;
  }

  if (v.githubTools) {
    html += `
      <section class="${dailyPanelClass(12, "github-tools", "", "githubTools", r)}" ${dailyModuleStateAttrs("githubTools", r)} style="view-transition-name: daily-github-tools;">
        <div class="news-panel-head daily-module-head">
          <div>
            <span class="news-section-kicker">GitHub 工具雷达</span>
            <h3>适合 Vibecoding 新人的 skill / plugin / MCP</h3>
            <p class="daily-module-subtitle">把工具发现整理成能马上试用的行动卡片。</p>
          </div>
        </div>
        <div class="daily-github-grid">${renderDailyGithubTools(r)}</div>
      </section>`;
  }
  
  if (v.trends) {
    html += `
      <section class="${dailyPanelClass(12, "trends", "", "trends", r)}" ${dailyModuleStateAttrs("trends", r)} style="view-transition-name: daily-trends;">
        <div class="news-panel-head daily-module-head">
          <div>
            <span class="news-section-kicker">趋势线索 · 外部校准收束</span>
            <h3>总编辑收束</h3>
            <p class="daily-module-subtitle">把上游线索放进最新外部来源里校准，收成一段可继续追踪的判断。</p>
          </div>
        </div>
        <div class="news-trend-grid">${renderDailyTrend(r)}</div>
      </section>`;
  }
  
  if (!v.dashboard && !showNews && !showTimeline && !v.ai && !v.githubTools && !v.trends) {
    html += `
      <div class="daily-event-empty span-12" style="margin-top: 40px;">
        <p class="muted-text">所有模块均已隐藏</p>
        <p class="muted-text">请在右上角「设置」中打开仪表盘模块可见度。</p>
      </div>`;
  }
  
  html += `\n</div>`;
  return html;
}

function renderYuqingDailyReport(row) {
  const r = row !== undefined && row !== null ? row : dailyActiveReport();
  return renderDailyReportHeader(r) + renderDailyReportGrid(r);
}

let __lastDailyRenderedId = null;
let __lastDailyRenderedLoading = null;

/** 文档级 VT 会与 fixed 侧栏叠层冲突；元素级 VT 的快照挂在 scope 元素上，侧栏不受影响（Chrome 147+）。 */
function isDailyYuqingDrawerOpen() {
  const settings = document.getElementById("daily-settings-drawer");
  const archive = document.getElementById("daily-archive-drawer");
  return !!(
    (settings && settings.classList.contains("open")) ||
    (archive && archive.classList.contains("open"))
  );
}

/**
 * 元素级 View Transition：必须用 { callback }（或部分实现的 update），不能像 document 那样直接传函数。
 * @returns {boolean} 是否已成功启动（浏览器不支持则 false，走降级）
 */
function tryDailyGridScopedViewTransition(gridEl, gridInnerCallback) {
  if (!gridEl || typeof gridEl.startViewTransition !== "function") return false;
  const run = (opts) => {
    let didUpdate = false;
    const wrapped = () => {
      didUpdate = true;
      return gridInnerCallback();
    };
    try {
      if (opts === "direct") {
        gridEl.startViewTransition(wrapped);
      } else {
        gridEl.startViewTransition({ [opts]: wrapped });
      }
      return didUpdate;
    } catch (_) {
      return false;
    }
  };
  if (run("update")) return true;
  if (run("callback")) return true;
  return run("direct");
}

function renderYuqingDailyIntoDom(options = {}) {
  const root = document.getElementById("daily-report-content");
  if (!root) return;
  
  const header = document.getElementById("daily-report-header");
  const grid = document.getElementById("daily-report-grid");
  const report = dailyActiveReport();
  const reportId = dailyCurrentReportId();
  const isLoading = !!dailyEventState.loading;
  const streamMode = isLoading || !!(report && report.status === "streaming");
  root.classList.toggle("is-streaming", streamMode);

  // 仅重绘 Grid：优先 #daily-report-grid 元素级 VT（命名组仍参与形变；快照不盖住 fixed 侧栏）。
  const gridOnlyRefresh =
    !!header &&
    !!grid &&
    !!String(header.innerHTML || "").trim() &&
    reportId === __lastDailyRenderedId &&
    isLoading === __lastDailyRenderedLoading;
  const isFirstPaint = !String(header && header.innerHTML ? header.innerHTML : "").trim() && !String(grid && grid.innerHTML ? grid.innerHTML : "").trim();
  const skipViewTransition = streamMode || options.skipViewTransition === true || isFirstPaint || Date.now() < __dailyQuietRenderUntil;

  const updateDom = () => {
    if (header && grid) {
      if (isLoading || reportId !== __lastDailyRenderedId || isLoading !== __lastDailyRenderedLoading || !header.innerHTML.trim()) {
        header.innerHTML = renderDailyReportHeader(report);
        __lastDailyRenderedId = reportId;
        __lastDailyRenderedLoading = isLoading;
      }
      grid.innerHTML = renderDailyReportGrid(report);
    } else {
      root.innerHTML = renderYuqingDailyReport(report);
    }
    bindYuqingDailyEvents();
  };

  const drawerOpen = isDailyYuqingDrawerOpen();

  const gridInnerOnly = () => {
    grid.innerHTML = renderDailyReportGrid(report);
    bindYuqingDailyEvents();
  };

  if (skipViewTransition) {
    updateDom();
    return;
  }

  // 仅刷网格：只要有元素级 VT 就用（侧栏开/关都行）；否则抽屉未开可走文档级 VT，抽屉开着只能同步 DOM 以免盖住侧栏。
  if (gridOnlyRefresh && grid) {
    if (tryDailyGridScopedViewTransition(grid, gridInnerOnly)) return;

    if (typeof document.startViewTransition === "function" && !drawerOpen) {
      const rootEl = document.documentElement;
      const origName = rootEl.style.viewTransitionName;
      rootEl.style.viewTransitionName = "none";
      const transition = document.startViewTransition(updateDom);
      transition.finished.finally(() => {
        rootEl.style.viewTransitionName = origName;
      });
      return;
    }

    updateDom();
    return;
  }

  if (typeof document.startViewTransition === "function" && !drawerOpen) {
    document.startViewTransition(updateDom);
  } else {
    updateDom();
  }
}

function renderYuqingDailyDrawersIntoDom() {
  const shell = document.getElementById("daily-drawers-shell");
  if (!shell) return;

  const archiveDrawer = document.getElementById("daily-archive-drawer");
  const settingsDrawer = document.getElementById("daily-settings-drawer");

  // 如果容器还没初始化，或者内容完全缺失，则进行全量初次渲染
  if (!archiveDrawer || !settingsDrawer) {
    shell.innerHTML = `
      ${renderDailyArchiveChrome()}
      ${renderDailySettingsChrome()}
    `;
  } else {
    // 增量更新：仅刷新内容区域，不触碰 drawer 容器本身，以保留 open 类名和动画状态
    const archiveList = archiveDrawer.querySelector(".news-archive-list");
    if (archiveList) {
      archiveList.innerHTML = renderDailyArchiveList();
    }
    const filterContainer = archiveDrawer.querySelector(".daily-archive-filters");
    if (filterContainer) {
      filterContainer.outerHTML = renderDailyArchiveFilters();
    }
    const costSummary = archiveDrawer.querySelector(".daily-archive-cost-summary");
    if (costSummary) {
      costSummary.outerHTML = renderDailyArchiveCostSummary();
    }
    
    // 设置侧边栏通常不怎么变，若有实时预览逻辑也在 bind 里处理了
  }

  bindYuqingDailyEvents();
}

async function loadDailyHistory() {
  if (typeof DataEngine === "undefined" || typeof DataEngine.fetchYuqingReportHistory !== "function") return;
  try {
    const data = await DataEngine.fetchYuqingReportHistory(DAILY_EVENT_KIND, DAILY_ARCHIVE_HISTORY_DAYS, { signal: __yuqingDailyLoadAbort?.signal });
    if (data && Array.isArray(data.items)) dailyEventState.history = data.items;
  } catch (_) {}
}

async function deleteDailyArchiveEntry(id) {
  const rid = String(id || "").trim();
  if (!rid) return;
  if (typeof DataEngine === "undefined" || typeof DataEngine.deleteYuqingReportItem !== "function") {
    dailyEventState.status = "DataEngine 不支持删除";
    renderYuqingDailyIntoDom();
    return;
  }
  const ok =
    typeof confirmYuqingArchiveDelete === "function"
      ? await confirmYuqingArchiveDelete()
      : window.confirm("确定删除此条回档？云端 D1 中的对应记录将一并删除且不可恢复。");
  if (!ok) return;
  try {
    await DataEngine.deleteYuqingReportItem(rid);
    dailyEventState.history = (dailyEventState.history || []).filter((x) => x && x.id !== rid);
    const activeId = dailyCurrentReportId();
    const hashId = dailyHashReportId();
    if (activeId === rid || hashId === rid) {
      try {
        history.replaceState(null, "", "#/news");
      } catch (_) {}
      await loadDailyReport("");
    } else {
      renderYuqingDailyIntoDom();
      renderYuqingDailyDrawersIntoDom();
    }
    dailyEventState.status = "已删除所选回档";
  } catch (e) {
    dailyEventState.status = e && e.message ? e.message : String(e);
    renderYuqingDailyIntoDom();
  }
}

async function loadDailyReport(reportId = "", options = {}) {
  if (dailyEventState.loading && !(options && options.force === true)) {
    renderYuqingDailyIntoDom({ skipViewTransition: true });
    renderYuqingDailyDrawersIntoDom();
    return;
  }
  if (typeof DataEngine === "undefined") {
    dailyEventState.source = "error";
    dailyEventState.status = "DataEngine 不可用";
    renderYuqingDailyIntoDom({ skipViewTransition: options.skipViewTransition === true });
    return;
  }
  const preservePending = !reportId && options && options.preservePending === true && dailyEventState.streamPreviewRow;
  const pendingBefore = preservePending ? dailyEventState.streamPreviewRow : null;
  if (!preservePending) {
    dailyEventState.streamPreviewRow = null;
    dailyResetStreamBuffers();
  }
  if (__yuqingDailyLoadAbort) __yuqingDailyLoadAbort.abort();
  __yuqingDailyLoadAbort = new AbortController();
  const loadSignal = __yuqingDailyLoadAbort.signal;
  dailyEventState.source = "loading";
  dailyEventState.status = preservePending ? "正在核对 D1 是否已有完整事件日报..." : "正在读取云端 D1 报告...";
  renderYuqingDailyIntoDom({ skipViewTransition: options.skipViewTransition === true });
  try {
    const data = reportId
      ? await DataEngine.fetchYuqingReportItem(reportId, { signal: loadSignal })
      : await DataEngine.fetchYuqingReportLatest(DAILY_EVENT_KIND, { signal: loadSignal });
    const report = data && data.report;
    if (report && dailyCloudReportShouldReplacePending(report, pendingBefore)) {
      dailyEventState.report = report;
      dailyEventState.streamPreviewRow = null;
      dailyEventState.source = "cloud";
      dailyEventState.status = "云端 D1 报告已加载";
      if (dailyReportIsReady(report)) dailyClearPendingPreview();
    } else if (pendingBefore) {
      dailyEventState.streamPreviewRow = pendingBefore;
      dailyEventState.report = pendingBefore;
      dailyEventState.source = "cloud";
      dailyEventState.status = report
        ? "D1 最新记录仍是同一轮未完成扫描，保留刷新前的本地预览。"
        : "D1 暂无新事件日报，保留刷新前的本地预览。";
      dailyWritePendingPreview();
      dailyForceRenderReport(pendingBefore);
      renderYuqingDailyIntoDom({ skipViewTransition: true });
      dailyRenderSoon();
    } else {
      dailyEventState.report = null;
      dailyEventState.source = "error";
      dailyEventState.status = data && data.d1Ready === false ? "D1 未绑定或迁移未执行" : "暂无云端日报";
    }
  } catch (e) {
    if (loadSignal.aborted) return;
    if (pendingBefore) {
      dailyEventState.streamPreviewRow = pendingBefore;
      dailyEventState.report = pendingBefore;
      dailyEventState.source = "cloud";
      dailyEventState.status = "D1 核对失败，已保留刷新前的本地预览。";
      dailyWritePendingPreview();
      dailyForceRenderReport(pendingBefore);
      renderYuqingDailyIntoDom({ skipViewTransition: true });
      dailyRenderSoon();
    } else {
      dailyEventState.report = null;
      dailyEventState.source = "error";
      dailyEventState.status = e && e.message ? e.message : String(e);
    }
  }
  await loadDailyHistory();
  renderYuqingDailyIntoDom({ skipViewTransition: options.skipViewTransition === true });
  renderYuqingDailyDrawersIntoDom();
}

async function generateDailyReport() {
  if (__dailyScanPromise || dailyEventState.loading) return __dailyScanPromise;
  if (typeof DataEngine === "undefined") return;
  const canStream = typeof DataEngine.streamYuqingDailyEventReport === "function";
  const canGen = typeof DataEngine.generateYuqingStructuredReport === "function";
  if (!canStream && !canGen) return;
  if (__yuqingDailyLoadAbort) {
    __yuqingDailyLoadAbort.abort();
    __yuqingDailyLoadAbort = null;
  }
  __yuqingDailyScanAbort = new AbortController();
  const scanSignal = __yuqingDailyScanAbort.signal;
  const reportIdBefore = dailyCurrentReportId();
  const tScanStart = Date.now();
  if (__dailyScanTick) {
    clearInterval(__dailyScanTick);
    __dailyScanTick = null;
  }
  dailyEventState.streamPreviewRow = null;
  dailyResetStreamBuffers();
  dailyResetScanProgress();
  dailyEnsureStreamPreviewShell();
  __dailyFirstStreamEventAt = 0;
  __dailyLastStreamEventAt = Date.now();
  dailyEventState.loading = true;
  dailyEventState.scanStartedAt = tScanStart;
  dailyEventState.scanStage = canStream ? "实时扫描已启动" : "云端扫描已启动";
  dailyEventState.status = canStream
    ? "正在连接流式通道：切换到其他页面不会中断，本页回来后会继续显示进度。"
    : "正在触发单次全流程日报：切换到其他页面不会中断，完成后会自动回填本页。";
  renderYuqingDailyIntoDom({ skipViewTransition: true });
  dailyWritePendingPreview();
  __dailyScanTick = setInterval(() => {
    if (!dailyEventState.loading) return;
    const sec = Math.floor((Date.now() - tScanStart) / 1000);
    const silentSec = Math.floor((Date.now() - (__dailyLastStreamEventAt || tScanStart)) / 1000);
    const pendingNames = dailyPendingScanLabels();
    dailyEventState.scanStage = canStream ? "实时扫描运行中" : "云端扫描运行中";
    if (canStream && !__dailyFirstStreamEventAt && sec >= 35) {
      dailyEventState.scanStage = "等待 Worker 首包";
      dailyEventState.status = `已等待 ${sec}s，仍未收到流式首包；如果继续无响应，会自动转入 D1 回读兜底。`;
    } else if (canStream && __dailyFirstStreamEventAt && silentSec >= 45) {
      dailyEventState.scanStage = "等待新进度";
      dailyEventState.status = `已有 ${silentSec}s 没有新模块输出，仍在等待 ${pendingNames.join("、") || "剩余模块"}；超时后会自动回读 D1。`;
    } else {
      dailyEventState.status = canStream
        ? `流式生成中（已等待 ${sec}s）… ${pendingNames.length ? `等待 ${pendingNames.join("、")}。` : "趋势线索会等上游模块完成后再做外部搜索校准。"}`
        : `云端分析进行中（已等待 ${sec}s）… 完成后会自动刷新；若超过约 3 分钟仍无结果，多为上游检索偏慢或网络中断。`;
    }
    renderYuqingDailyIntoDom({ skipViewTransition: true });
  }, 8000);
  const s = __yuqingSettings.scanCoverage;
  // 上游模块先完成个性化检索；趋势线索再追加一次外部校准收束。
  const payload = { 
    mode: "deep", 
    forceSearch: true, 
    trendsUseSearch: true,
    dualHeadlineLanes: true,
    modules: {
      dashboard: !!s.dashboard,
      news: !!s.news,
      timeline: !!s.timeline,
      ai: !!s.ai,
      githubTools: !!s.githubTools,
      trends: !!s.trends
    }
  };
  
  __dailyScanPromise = (async () => {
  try {
    let data = null;
    if (canStream) {
      data = await DataEngine.streamYuqingDailyEventReport(payload, {
        timeoutMs: 900_000,
        signal: scanSignal,
        firstEventTimeoutMs: 45_000,
        idleTimeoutMs: 90_000,
        onEvent: async (evt) => {
          __dailyLastStreamEventAt = Date.now();
          if (!__dailyFirstStreamEventAt) __dailyFirstStreamEventAt = __dailyLastStreamEventAt;
          if (evt.type === "start") {
            if (evt.report && typeof evt.report === "object") {
              dailyEventState.streamPreviewRow = evt.report;
            }
            dailyEventState.scanStage = "流式通道已建立";
            dailyEventState.status = "流式通道已建立，等待各模块…";
            dailyWritePendingPreview();
            renderYuqingDailyIntoDom({ skipViewTransition: true });
            return;
          }
          if (evt.type === "chunk") {
            const visualChanged = mergeDailyStreamChunk(evt);
            dailyEventState.scanStage = "模块正在输出";
            dailyEventState.source = "cloud";
            dailyEventState.status = `正在输出：${dailyStreamModuleLabel(evt.module, evt.streamKey)}`;
            dailyWritePendingPreview();
            if (visualChanged) dailyScheduleStreamRender();
            return;
          }
          if (evt.type === "partial") {
            mergeDailyStreamEvent(evt);
            dailyEventState.scanStage = "模块结果已更新";
            dailyEventState.source = "cloud";
            dailyEventState.status = `已更新：${evt.module || "模块"}`;
            dailyWritePendingPreview();
            renderYuqingDailyIntoDom({ skipViewTransition: true });
          }
        },
      });
    } else {
      data = await DataEngine.generateYuqingStructuredReport(DAILY_EVENT_KIND, payload, { timeoutMs: 480_000, signal: scanSignal });
    }
    dailyEventState.streamPreviewRow = null;
    if (data && data.report) {
      dailyClearPendingPreview();
      Object.keys(dailyEventState.scanProgress || {}).forEach((key) => {
        if (dailyEventState.scanProgress[key] !== "skip") dailyEventState.scanProgress[key] = "done";
      });
      dailyEventState.report = data.report;
      dailyEventState.source = "cloud";
      dailyEventState.scanStage = "实时扫描已完成";
      dailyEventState.status = canStream
        ? "流式扫描已完成，已写入 D1（趋势线索已追加外部搜索校准）。"
        : "单次扫描已完成，已写入 D1 并拉回本条（趋势线索已基于上游模块和外部搜索收束）。";
      if (dailyIsEventsRoute()) {
        try {
          history.replaceState(null, "", `#/news?reportId=${encodeURIComponent(data.report.id)}`);
        } catch (_) {}
      }
      await loadDailyHistory();
      dailyEventState.archiveFilter = "recent7";
    }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    const maybeTimeout = /超时|AbortError|aborted|network/i.test(msg);
    if (!maybeTimeout) {
      dailyEventState.streamPreviewRow = null;
      dailyClearPendingPreview();
    }
    if (maybeTimeout) {
      dailyEventState.scanStage = "正在回读 D1";
      dailyEventState.status = "请求中断或超时，正在尝试从 D1 读取最新一条事件日报…";
      dailyEventState.source = "loading";
      renderYuqingDailyIntoDom({ skipViewTransition: true });
      try {
        await loadDailyReport("", { force: true, preservePending: true });
        const row = dailyEventState.report;
        const pendingRow = dailyEventState.streamPreviewRow;
        if (pendingRow && !dailyReportIsReady(pendingRow)) {
          dailyEventState.source = "cloud";
          dailyEventState.status =
            "浏览器等待已结束，D1 暂未返回完整新日报：已保留本轮实时扫描预览。完整报告生成后会以同一条记录覆盖。";
        } else if (row && row.id && row.id !== reportIdBefore && row.report) {
          dailyEventState.source = "cloud";
          dailyEventState.status =
            "浏览器等待已结束，但云端可能已生成新报告：已从 D1 拉回最新一条。若内容不完整或仍是旧版，请稍后再点「实时扫描」。";
        } else {
          dailyEventState.source = "error";
          dailyEventState.status = msg;
        }
      } catch (_) {
        dailyEventState.source = "error";
        dailyEventState.status = msg;
      }
    } else {
      dailyEventState.source = "error";
      dailyEventState.scanStage = "实时扫描失败";
      dailyEventState.status = msg;
    }
  } finally {
    if (__dailyScanTick) {
      clearInterval(__dailyScanTick);
      __dailyScanTick = null;
    }
    dailyEventState.loading = false;
    dailyEventState.scanStartedAt = 0;
    __dailyFirstStreamEventAt = 0;
    __dailyLastStreamEventAt = 0;
    __yuqingDailyScanAbort = null;
    __dailyScanPromise = null;
    dailyClearScheduledStreamRender();
    renderYuqingDailyIntoDom({ skipViewTransition: true });
    renderYuqingDailyDrawersIntoDom();
  }
  })();
  return __dailyScanPromise;
}

function openDailyArchive() {
  const drawer = document.getElementById("daily-archive-drawer");
  const backdrop = document.getElementById("daily-archive-backdrop");
  if (drawer) {
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
  }
  if (backdrop) backdrop.hidden = false;
}

function closeDailyArchive() {
  const drawer = document.getElementById("daily-archive-drawer");
  const backdrop = document.getElementById("daily-archive-backdrop");
  if (drawer) {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
  }
  if (backdrop) backdrop.hidden = true;
}

function openDailySettings() {
  const drawer = document.getElementById("daily-settings-drawer");
  const backdrop = document.getElementById("daily-settings-backdrop");
  if (drawer) {
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
  }
  if (backdrop) backdrop.hidden = false;
}

function closeDailySettings() {
  const drawer = document.getElementById("daily-settings-drawer");
  const backdrop = document.getElementById("daily-settings-backdrop");
  if (drawer) {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
  }
  if (backdrop) backdrop.hidden = true;
}

async function saveDailySettings() {
  if (typeof DataEngine === "undefined" || typeof DataEngine.updateYuqingEventDashboardSettings !== "function") return;
  
  const drawer = document.getElementById("daily-settings-drawer");
  if (!drawer) return;
  
  const v = { dashboard: true, news: true, timeline: true, ai: true, githubTools: true, trends: true };
  const s = { dashboard: true, news: true, timeline: true, ai: true, githubTools: true, trends: true };
  
  drawer.querySelectorAll('.daily-setting-cb[data-type="visibility"]').forEach(cb => {
    v[cb.getAttribute("data-key")] = cb.checked;
  });
  drawer.querySelectorAll('.daily-setting-cb[data-type="scan"]').forEach(cb => {
    s[cb.getAttribute("data-key")] = cb.checked;
  });
  
  __yuqingSettings.visibility = v;
  __yuqingSettings.scanCoverage = s;
  __yuqingSettingsSaving = true;
  
  // 仅刷新报告内容和状态，不重新渲染整个 drawer 以保持开启状态
  renderYuqingDailyIntoDom();
  
  try {
    await DataEngine.updateYuqingEventDashboardSettings(__yuqingSettings);
    // closeDailySettings(); // 响应用户：推出逻辑应该由我点击关闭才推出
  } catch (e) {
    alert("保存云端设置失败：" + (e.message || String(e)));
  } finally {
    __yuqingSettingsSaving = false;
    renderYuqingDailyIntoDom();
    // 这里如果需要刷新按钮状态，可以局部刷新，但不要 close
  }
}

function bindYuqingDailyEvents() {
  const scan = document.getElementById("daily-scan-preview");
  if (scan && !scan.dataset.bound) {
    scan.dataset.bound = "1";
    scan.addEventListener("click", generateDailyReport);
  }
  const open = document.getElementById("daily-open-archive");
  if (open && !open.dataset.bound) {
    open.dataset.bound = "1";
    open.addEventListener("click", () => {
      dailyEventState.archiveFilter = "all";
      // 确保内容更新到最新（如过滤器状态），但不触发背景重绘
      renderYuqingDailyDrawersIntoDom();
      openDailyArchive();
    });
  }
  const close = document.getElementById("daily-close-archive");
  if (close && !close.dataset.bound) {
    close.dataset.bound = "1";
    close.addEventListener("click", closeDailyArchive);
  }
  const backdrop = document.getElementById("daily-archive-backdrop");
  if (backdrop && !backdrop.dataset.bound) {
    backdrop.dataset.bound = "1";
    backdrop.addEventListener("click", closeDailyArchive);
  }
  document.querySelectorAll(".daily-archive-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      dailyEventState.archiveFilter = btn.getAttribute("data-archive-filter") || "all";
      // 仅刷新 Drawers，不刷新背景 Report，防止抖动
      renderYuqingDailyDrawersIntoDom();
      openDailyArchive();
    });
  });

  const openSet = document.getElementById("daily-open-settings");
  if (openSet && !openSet.dataset.bound) {
    openSet.dataset.bound = "1";
    openSet.addEventListener("click", openDailySettings);
  }
  const closeSet = document.getElementById("daily-close-settings");
  if (closeSet && !closeSet.dataset.bound) {
    closeSet.dataset.bound = "1";
    closeSet.addEventListener("click", closeDailySettings);
  }
  const setBackdrop = document.getElementById("daily-settings-backdrop");
  if (setBackdrop && !setBackdrop.dataset.bound) {
    setBackdrop.dataset.bound = "1";
    setBackdrop.addEventListener("click", closeDailySettings);
  }
  const saveBtn = document.getElementById("daily-save-settings");
  if (saveBtn && !saveBtn.dataset.bound) {
    saveBtn.dataset.bound = "1";
    saveBtn.addEventListener("click", saveDailySettings);
  }

  // 模块可见度实时预览：监听 checkbox 变化
  document.querySelectorAll('.daily-setting-cb[data-type="visibility"]').forEach(cb => {
    if (cb.dataset.boundLive) return;
    cb.dataset.boundLive = "1";
    cb.addEventListener("change", () => {
      const key = cb.getAttribute("data-key");
      if (__yuqingSettings.visibility) {
        __yuqingSettings.visibility[key] = cb.checked;
        cb.closest(".daily-setting-row")?.classList.toggle("is-on", cb.checked);
        cb.closest(".daily-setting-row")?.classList.toggle("is-off", !cb.checked);
        // 实时刷新页面布局。由于 Drawers 已分离出 root，这里刷新 root 不会影响 Drawer 的开启状态
        renderYuqingDailyIntoDom();
      }
    });
  });
  // 扫描覆盖范围同步（不涉及 UI 刷新，仅同步内存状态）
  document.querySelectorAll('.daily-setting-cb[data-type="scan"]').forEach(cb => {
    if (cb.dataset.boundLive) return;
    cb.dataset.boundLive = "1";
    cb.addEventListener("change", () => {
      const key = cb.getAttribute("data-key");
      if (__yuqingSettings.scanCoverage) {
        __yuqingSettings.scanCoverage[key] = cb.checked;
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
      closeDailyArchive();
      if (id) {
        try {
          history.replaceState(null, "", `#/news?reportId=${encodeURIComponent(id)}`);
        } catch (_) {}
        await loadDailyReport(id);
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
      await deleteDailyArchiveEntry(id);
    });
  });
}

function pageYuqingEvents() {
  return html`
    <div class="news-intel-shell daily-workbench-shell">
      <div id="daily-report-content" class="daily-report-content">
        <div id="daily-report-header"></div>
        <div id="daily-report-grid"></div>
      </div>
      <div id="daily-drawers-shell"></div>
    </div>
  `;
}

function initYuqingEvents() {
  disposeYuqingEvents();
  dailySuppressViewMotion(1200);
  renderYuqingDailyIntoDom({ skipViewTransition: true });
  renderYuqingDailyDrawersIntoDom();

  // 异步加载云端设置，不阻塞主报告拉取
  if (typeof DataEngine !== "undefined" && typeof DataEngine.fetchYuqingEventDashboardSettings === "function") {
    DataEngine.fetchYuqingEventDashboardSettings().then(data => {
      if (data && data.settings) {
        __yuqingSettings = normalizeDailyDashboardSettings(data.settings);
        renderYuqingDailyIntoDom({ skipViewTransition: true });
        renderYuqingDailyDrawersIntoDom();
      }
    }).catch(() => {
      console.warn("无法拉取云端事件一览设置，使用默认配置。");
    });
  }

  const hashId = dailyHashReportId();
  const restoredPending = !dailyEventState.loading && !hashId ? dailyRestorePendingPreview() : false;
  if (restoredPending) {
    dailyForceRenderReport(dailyEventState.streamPreviewRow);
    renderYuqingDailyIntoDom({ skipViewTransition: true });
    renderYuqingDailyDrawersIntoDom();
    dailyRenderSoon();
  }

  if (dailyEventState.loading) {
    renderYuqingDailyIntoDom({ skipViewTransition: true });
    renderYuqingDailyDrawersIntoDom();
  } else {
    loadDailyReport(hashId, { preservePending: restoredPending || (!hashId && !!dailyEventState.streamPreviewRow), skipViewTransition: true });
  }
}

function disposeYuqingEvents() {
  __lastDailyRenderedId = null;
  __lastDailyRenderedLoading = null;
  if (__yuqingDailyLoadAbort) {
    __yuqingDailyLoadAbort.abort();
    __yuqingDailyLoadAbort = null;
  }
  dailyClearScheduledStreamRender();
  if (!dailyEventState.loading) {
    if (__dailyScanTick) {
      clearInterval(__dailyScanTick);
      __dailyScanTick = null;
    }
    dailyResetStreamBuffers();
    dailyEventState.streamPreviewRow = null;
    dailyEventState.scanStartedAt = 0;
  }
}

if (typeof window !== "undefined") {
  window.__bitDeskDisposeYuqingEvents = disposeYuqingEvents;
}
