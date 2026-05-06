/* =======================================================
   页面：事件一览（双层日报 · daily_event）
   ======================================================= */

const DAILY_EVENT_KIND = "daily_event";
let __yuqingDailyClock = null;
let __yuqingDailyAbort = null;
let __dailyScanTick = null;

const dailyEventState = {
  report: null,
  /** 流式生成过程中用于即时渲染的临时行（不入库，done 后清空） */
  streamPreviewRow: null,
  history: [],
  status: "正在加载云端日报…",
  source: "loading",
  loading: false,
  /** 报告库抽屉筛选：all | scheduled | manual（实时扫描） */
  archiveFilter: "all",
};

function dailyEscapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

/** 本页日报「触发检索」的完整时间（上海） */
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
  if (trigger === "manual") return "手动搜索";
  return "定点触发";
}

function dailyActiveReport() {
  return dailyEventState.streamPreviewRow || dailyEventState.report;
}

function dailyEnsureStreamPreviewShell() {
  if (dailyEventState.streamPreviewRow) return dailyEventState.streamPreviewRow;
  const now = new Date().toISOString();
  dailyEventState.streamPreviewRow = {
    id: "",
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
      trendRead: { strengthening: [], cracking: [], conclusion: "" },
      sources: [],
      quality: { factCount: 0, sourceCoverage: 0, usedSearch: true, caveat: "" },
    },
    sourceErrors: [],
  };
  return dailyEventState.streamPreviewRow;
}

function mergeDailyStreamEvent(evt) {
  if (!evt || evt.type !== "partial") return;
  const row = dailyEnsureStreamPreviewShell();
  const rep = row.report;
  if (evt.module === "temperature" && evt.marketTemperature && typeof evt.marketTemperature === "object") {
    Object.assign(rep.marketTemperature, evt.marketTemperature);
  }
  if (evt.module === "topStories" && Array.isArray(evt.topStories)) {
    rep.topStories = evt.topStories;
    rep.topStory = evt.topStories[0] || rep.topStory;
  }
  if (evt.module === "dynamicBriefs" && Array.isArray(evt.dynamicBriefs)) {
    rep.dynamicBriefs = evt.dynamicBriefs;
  }
  if (evt.module === "digest") {
    if (evt.macroTrend) rep.macroTrend = String(evt.macroTrend);
    if (Array.isArray(evt.topStories)) {
      rep.topStories = evt.topStories;
      rep.topStory = evt.topStories[0] || rep.topStory;
    }
    if (Array.isArray(evt.dynamicBriefs)) rep.dynamicBriefs = evt.dynamicBriefs;
  }
  if (evt.module === "aiIntel" && Array.isArray(evt.aiIntel)) {
    rep.aiIntel = evt.aiIntel;
  }
  if (evt.module === "trends" && evt.trendRead && typeof evt.trendRead === "object") {
    rep.trendRead = evt.trendRead;
  }
}

function dailyCurrentReportId() {
  const row = dailyEventState.report;
  return row && row.id ? String(row.id) : "";
}

function dailyQuality(row) {
  if (!row || typeof row !== "object") return {};
  return row.quality || (row.report && row.report.quality) || (row.grounding && row.grounding.quality) || {};
}

function dailySourceStatusText() {
  if (dailyEventState.streamPreviewRow) return `流式预览：${dailyEventState.status || "生成中"}`;
  if (dailyEventState.source === "cloud") return "云端 D1 报告已接入";
  if (dailyEventState.source === "error") return `数据源切换中：${dailyEventState.status}`;
  if (dailyEventState.source === "loading") return "正在读取云端 D1 报告...";
  return dailyEventState.status || "待机";
}

function dailyRenderLink(ref) {
  const href = ref && (ref.href || ref.url);
  const label = ref && (ref.label || ref.source || ref.type);
  if (!href) return `<span>${dailyEscapeHtml(label || "来源")}</span>`;
  const external = /^https?:\/\//i.test(href);
  return `<a href="${dailyEscapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${dailyEscapeHtml(label || href)}</a>`;
}

function renderDailyTemperature(row) {
  const temp = row.report.marketTemperature || {};
  const n = Math.max(0, Math.min(100, Number(temp.score) || 0));
  const details = [
    temp.regime ? `市场状态：${temp.regime}` : "",
    temp.crossAsset ? `跨资产：${temp.crossAsset}` : "",
    temp.anomaly ? `异动：${temp.anomaly}` : "",
    temp.suggestion ? `行动建议：${temp.suggestion}` : "",
  ].filter(Boolean);
  return `
    <section class="news-panel span-12 daily-brief-temperature">
      <div class="news-panel-head">
        <div>
          <span class="news-section-kicker">今日信息温度</span>
          <h3>${dailyEscapeHtml(temp.label || "信息温度待确认")}</h3>
        </div>
        <i class="ph ph-thermometer-simple"></i>
      </div>
      <div class="daily-temperature-body">
        <div class="daily-temperature-score">
          <strong>${n}</strong>
          <span>只作阅读背景</span>
        </div>
        <div>
          <p>${dailyEscapeHtml(temp.summary || "详细交易含义交给舆情分析页做二次研判。")}</p>
          ${details.length ? `<div class="daily-temperature-meta">${details.map((x) => `<span>${dailyEscapeHtml(x)}</span>`).join("")}</div>` : ""}
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
    structureHtml = item.structure.map((x) => `<span>${dailyEscapeHtml(x)}</span>`).join("");
  } else if (item.structure && typeof item.structure === "object") {
    structureHtml = [
      item.structure.trigger ? `<span>${dailyEscapeHtml(item.structure.trigger)}</span>` : "",
      item.structure.conflict ? `<span>${dailyEscapeHtml(item.structure.conflict)}</span>` : "",
      item.structure.divergence ? `<span>${dailyEscapeHtml(item.structure.divergence)}</span>` : "",
    ].join("");
  } else if (item.structure) {
    structureHtml = `<span>${dailyEscapeHtml(item.structure)}</span>`;
  }
  if (!structureHtml) structureHtml = `<span class="muted-text">等待事实池补充诱因、矛盾和预期差信息。</span>`;

  let impactsHtml = "";
  if (Array.isArray(item.impacts)) {
    impactsHtml = item.impacts.map((raw) => {
      const imp = raw && typeof raw === "object" ? raw : { asset: "资产", direction: "shock", logic: raw };
      const meta = dailyImpactDirectionMeta(imp.direction);
      return `<div class="daily-impact-row"><span class="daily-impact-badge ${meta.cls}">[${dailyEscapeHtml(imp.asset || "资产")}] ${meta.label}</span><span class="daily-impact-logic">${dailyEscapeHtml(imp.logic || imp.reason || "等待价格和资金流确认。")}</span></div>`;
    }).join("");
  } else if (Array.isArray(item.transmission)) {
    impactsHtml = item.transmission.map((x) => `<span>${dailyEscapeHtml(x)}</span>`).join("");
  }
  if (!impactsHtml) impactsHtml = `<span class="muted-text">等待资产传导确认。</span>`;

  const watchHtml = item.nextWatch ? `<div class="news-story-watch daily-story-contract-line"><b>后续观察</b><span>${dailyEscapeHtml(item.nextWatch)}</span></div>` : "";

  const sourceTag = item.sourceUrl
    ? `<a href="${dailyEscapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${dailyEscapeHtml(item.sourceName || "来源")}</a>`
    : item.sourceName
      ? `<span>${dailyEscapeHtml(item.sourceName)}</span>`
      : "";
  return `
    <article class="news-story">
      <div class="news-story-rank">${idx + 1}</div>
      <div class="news-story-body">
        <div class="news-story-meta">
          <span>${dailyEscapeHtml(item.category || "今日头条")}</span>
          ${sourceTag}
        </div>
        <h3>${dailyEscapeHtml(item.title || "暂无头条")}</h3>
        <div class="news-story-watch daily-story-contract-line"><b>事实锁定</b><span>${dailyEscapeHtml(item.fact || "等待事实池补充。")}</span></div>
        <div class="news-story-watch daily-story-contract-line"><b>结构拆解</b><div class="daily-column-lines">${structureHtml}</div></div>
        <div class="news-story-impact">
          <b>传导预判</b>
          <div class="daily-column-lines">${impactsHtml}</div>
        </div>
        ${watchHtml}
      </div>
    </article>
  `;
}

function renderDailyTopStories(row) {
  return dailyTopStories(row).slice(0, 5).map((story, idx) => renderDailyTopStory(story, idx)).join("");
}

function renderDailyBriefs(row) {
  const report = row && row.report ? row.report : {};
  const briefs = Array.isArray(report.dynamicBriefs) ? report.dynamicBriefs : [];
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
        return `
        <article class="news-story">
          <div class="news-story-rank muted">${idx + 1}</div>
          <div class="news-story-body">
            <div class="news-story-meta">
              <span>${dailyEscapeHtml(item.category || "动态")}</span>
              ${sourceTag}
            </div>
            <h3>${dailyEscapeHtml(item.title || "")}</h3>
            <div class="news-story-watch daily-story-contract-line"><b>事件</b><span>${dailyEscapeHtml(item.body || "")}</span></div>
            ${description ? `<div class="news-story-watch daily-story-contract-line"><b>描述</b><span>${dailyEscapeHtml(description)}</span></div>` : ""}
            ${analysis ? `<div class="news-story-watch"><b>简析</b><span>${dailyEscapeHtml(analysis)}</span></div>` : ""}
          </div>
        </article>
      `;
      },
    )
    .join("");
}

function renderDailyAi(row) {
  return (row.report.aiIntel || [])
    .map(
      (item) => {
        const source = item.sourceUrl
          ? `<a href="${dailyEscapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${dailyEscapeHtml(item.sourceName || "来源")}</a>`
          : item.sourceName
            ? dailyEscapeHtml(item.sourceName)
            : "";
        return `<div class="news-ai-row">
        <div class="news-ai-icon"><i class="ph ph-sparkle"></i></div>
        <div>
          <h4>${dailyEscapeHtml(item.title || "")}</h4>
          <span>发布日期：${dailyEscapeHtml(item.date || "近72小时")}</span>
          <p><strong>新了什么：</strong>${dailyEscapeHtml(item.what || "")}</p>
          <p><strong>对我有什么用：</strong>${dailyEscapeHtml(item.use || "")}</p>
          ${source ? `<div class="news-source-inline">来源：${source}</div>` : ""}
        </div>
        <strong>${dailyEscapeHtml(item.attention || "")}关注</strong>
      </div>`;
      },
    )
    .join("");
}

function renderDailyTrend(row) {
  const report = row && row.report ? row.report : {};
  const t = report.trendRead || {};
  const macroTrend = report.macroTrend || "";
  const strengthening = macroTrend
    ? [macroTrend, ...(t.strengthening || []).filter((x) => x !== macroTrend).slice(0, 1)]
    : t.strengthening;
  const block = (title, rows, cls) => `<div class="news-trend-block ${cls}">
    <h4>${dailyEscapeHtml(title)}</h4>
    ${(rows || []).map((x) => `<p>${dailyEscapeHtml(x)}</p>`).join("")}
  </div>`;
  return [
    block("正在强化的信号", strengthening, "ok"),
    block("正在裂变的信号", t.cracking, "warn"),
    block("0-72小时观察结论", [t.conclusion], "info"),
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
  return raw.filter((item) => {
    const t = String(item.triggerType || "").toLowerCase();
    if (mode === "manual") return t === "manual";
    if (mode === "scheduled") return t !== "manual";
    return true;
  });
}

function renderDailyArchiveList() {
  const items = dailyArchiveFilteredHistory();
  if (!items.length) {
    return `<p class="daily-archive-empty muted-text">该分类下暂无记录，可切换到「全部」或改天再试。</p>`;
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
        <span>${dailyEscapeHtml(dailySlotLabel(item))}</span>
        <strong>${dailyEscapeHtml(title)}</strong>
        <em>${dailyEscapeHtml(dailyFormatTime(item.generatedAt))}</em>
        <small>${dailyEscapeHtml(dailyTriggerLabel(item))}</small>
      </button>${deleteBtn}</div>`;
    })
    .join("");
}

function renderDailyArchiveFilters() {
  const cur = dailyEventState.archiveFilter || "all";
  const mk = (key, label) =>
    `<button type="button" class="daily-archive-filter ${cur === key ? "active" : ""}" data-archive-filter="${dailyEscapeHtml(key)}" role="tab" aria-selected="${cur === key ? "true" : "false"}">${dailyEscapeHtml(label)}</button>`;
  return `<div class="daily-archive-filters" role="tablist">${mk("all", "全部")}${mk("scheduled", "定点班次")}${mk("manual", "实时扫描")}</div>`;
}

function renderDailyArchiveChrome() {
  return `
    <div class="news-archive-backdrop" id="daily-archive-backdrop" hidden></div>
    <aside class="news-archive-drawer" id="daily-archive-drawer" aria-hidden="true">
      <div class="news-archive-head">
        <div>
          <span class="news-section-kicker">最近 7 天</span>
          <h3>事件日报回档</h3>
          <p class="daily-archive-sub">定点班次（北京时间 00 / 08 / 12 / 20）与「实时扫描」都会写入此列表，切换报告请用 7 日报告库。</p>
        </div>
        <button type="button" class="btn" id="daily-close-archive" title="关闭报告库">
          <i class="ph ph-x"></i><span>关闭</span>
        </button>
      </div>
      ${renderDailyArchiveFilters()}
      <div class="news-archive-list">${renderDailyArchiveList()}</div>
    </aside>`;
}

function renderYuqingDailyReport(row) {
  const chrome = renderDailyArchiveChrome();
  const r = row !== undefined && row !== null ? row : dailyActiveReport();

  const commandShell = `
    <div class="news-command daily-event-command">
      <div class="news-command-main daily-command-main">
        <div class="daily-report-trigger">
          <span class="daily-report-trigger-label">本页日报触发检索</span>
          <div class="daily-report-trigger-row">
            <i class="ph ph-clock" aria-hidden="true"></i>
            <strong>${dailyEscapeHtml(dailyFormatTriggeredSearchAt(r && r.generatedAt ? r.generatedAt : null))}</strong>
            <span class="daily-report-trigger-tz">Asia/Shanghai</span>
          </div>
        </div>
        <div class="daily-report-meta">
          <span title="报表归属日期"><i class="ph ph-calendar-dots"></i>${dailyEscapeHtml((r && r.reportDate) || "—")}</span>
          <span><i class="ph ph-list-checks"></i>事件 ${Number(dailyQuality(r || {}).factCount || 0)} · 覆盖 ${Number(dailyQuality(r || {}).sourceCoverage || 0)}%</span>
        </div>
      </div>
      <div class="news-command-actions">
        <div class="daily-clock-pill"><i class="ph ph-clock"></i><span id="daily-clock">--</span></div>
        <button type="button" class="btn primary" id="daily-scan-preview" ${dailyEventState.loading ? "disabled" : ""} title="单次请求 Worker：NDJSON 流式返回，模块就绪即显示；温度/头条/速览/AI 并行检索（头条可双路），趋势最后归纳；完成后写入 D1（约 1～5 分钟）">
          <i class="ph ph-rocket-launch"></i><span>${dailyEventState.loading ? "扫描中" : "实时扫描"}</span>
        </button>
        <button type="button" class="btn primary" id="daily-open-archive">
          <i class="ph ph-clock-counter-clockwise"></i><span>7日报告库</span>
        </button>
      </div>
    </div>`;

  if (!r || !r.report) {
    const st = dailyEscapeHtml(dailyEventState.status || "暂无云端事件日报");
    return `${commandShell}
    <div class="daily-event-empty">
      <p class="muted-text">${st}</p>
      <p class="muted-text">可用「实时扫描」写入一条至 D1，或打开 7 日报告库从历史记录中选择。</p>
    </div>
    ${chrome}`;
  }

  const q = dailyQuality(r);
  return `${commandShell}

    <div class="news-intel-grid">
      ${renderDailyTemperature(r)}

      <section class="news-panel span-7">
        <div class="news-panel-head">
          <div>
            <span class="news-section-kicker">今日头条</span>
            <h3>高价值事件拆解</h3>
          </div>
          <i class="ph ph-newspaper"></i>
        </div>
        <div class="news-story-list">${renderDailyTopStories(r)}</div>
      </section>

      <section class="news-panel span-5">
        <div class="news-panel-head">
          <div>
            <span class="news-section-kicker">动态速览</span>
            <h3>政治、经济、AI 与市场</h3>
          </div>
          <i class="ph ph-lightning"></i>
        </div>
        <div class="news-story-list compact">${renderDailyBriefs(r)}</div>
      </section>

      <section class="news-panel span-6">
        <div class="news-panel-head">
          <div>
            <span class="news-section-kicker">趋势线索</span>
            <h3>正在强化与裂变的信号</h3>
          </div>
          <i class="ph ph-wave-sine"></i>
        </div>
        <div class="news-trend-grid">${renderDailyTrend(r)}</div>
      </section>

      <section class="news-panel span-6">
        <div class="news-panel-head">
          <div>
            <span class="news-section-kicker">AI 情报站</span>
            <h3>科技叙事与日常信息</h3>
          </div>
          <i class="ph ph-brain"></i>
        </div>
        <div class="news-ai-list">${renderDailyAi(r)}</div>
      </section>
    </div>
    ${chrome}
  `;
}

function refreshYuqingDailyClock() {
  const el = document.getElementById("daily-clock");
  if (!el) return;
  el.textContent = new Date().toLocaleTimeString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function renderYuqingDailyIntoDom() {
  const root = document.getElementById("daily-report-content");
  if (!root) return;
  root.innerHTML = renderYuqingDailyReport(dailyActiveReport());
  bindYuqingDailyEvents();
  refreshYuqingDailyClock();
}

async function loadDailyHistory() {
  if (typeof DataEngine === "undefined" || typeof DataEngine.fetchYuqingReportHistory !== "function") return;
  try {
    const data = await DataEngine.fetchYuqingReportHistory(DAILY_EVENT_KIND, 7, { signal: __yuqingDailyAbort?.signal });
    if (data && Array.isArray(data.items) && data.items.length) dailyEventState.history = data.items;
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
    }
    dailyEventState.status = "已删除所选回档";
  } catch (e) {
    dailyEventState.status = e && e.message ? e.message : String(e);
    renderYuqingDailyIntoDom();
  }
}

async function loadDailyReport(reportId = "") {
  if (typeof DataEngine === "undefined") {
    dailyEventState.source = "error";
    dailyEventState.status = "DataEngine 不可用";
    renderYuqingDailyIntoDom();
    return;
  }
  dailyEventState.streamPreviewRow = null;
  if (__yuqingDailyAbort) __yuqingDailyAbort.abort();
  __yuqingDailyAbort = new AbortController();
  dailyEventState.source = "loading";
  dailyEventState.status = "正在读取云端 D1 报告...";
  renderYuqingDailyIntoDom();
  try {
    const data = reportId
      ? await DataEngine.fetchYuqingReportItem(reportId, { signal: __yuqingDailyAbort.signal })
      : await DataEngine.fetchYuqingReportLatest(DAILY_EVENT_KIND, { signal: __yuqingDailyAbort.signal });
    const report = data && data.report;
    if (report) {
      dailyEventState.report = report;
      dailyEventState.source = "cloud";
      dailyEventState.status = "云端 D1 报告已加载";
    } else {
      dailyEventState.report = null;
      dailyEventState.source = "error";
      dailyEventState.status = data && data.d1Ready === false ? "D1 未绑定或迁移未执行" : "暂无云端日报";
    }
  } catch (e) {
    dailyEventState.report = null;
    dailyEventState.source = "error";
    dailyEventState.status = e && e.message ? e.message : String(e);
  }
  await loadDailyHistory();
  renderYuqingDailyIntoDom();
}

async function generateDailyReport() {
  if (typeof DataEngine === "undefined") return;
  const canStream = typeof DataEngine.streamYuqingDailyEventReport === "function";
  const canGen = typeof DataEngine.generateYuqingStructuredReport === "function";
  if (!canStream && !canGen) return;
  if (__yuqingDailyAbort) __yuqingDailyAbort.abort();
  __yuqingDailyAbort = new AbortController();
  const scanSignal = __yuqingDailyAbort.signal;
  const reportIdBefore = dailyCurrentReportId();
  const tScanStart = Date.now();
  if (__dailyScanTick) {
    clearInterval(__dailyScanTick);
    __dailyScanTick = null;
  }
  dailyEventState.streamPreviewRow = null;
  dailyEventState.loading = true;
  dailyEventState.status = canStream
    ? "已连接流式通道：各模块检索完成后将逐段显示，全部完成后写入 D1。请勿关闭页面…"
    : "正在触发单次全流程日报（信息温度、头条、速览、AI 情报并发检索 → 趋势归纳 → 写入 D1）。首次约 1～4 分钟，请勿关闭页面…";
  renderYuqingDailyIntoDom();
  __dailyScanTick = setInterval(() => {
    if (!dailyEventState.loading) return;
    const sec = Math.floor((Date.now() - tScanStart) / 1000);
    dailyEventState.status = canStream
      ? `流式生成中（已等待 ${sec}s）… 若长时间停在某一模块，多为该路 Gemini 检索偏慢。`
      : `云端分析进行中（已等待 ${sec}s）… 完成后会自动刷新；若超过约 3 分钟仍无结果，多为 Gemini 检索偏慢或网络中断。`;
    renderYuqingDailyIntoDom();
  }, 8000);
  let openArchiveAfter = false;
  const payload = { mode: "deep", forceSearch: true, dualHeadlineLanes: true };
  try {
    let data = null;
    if (canStream) {
      data = await DataEngine.streamYuqingDailyEventReport(payload, {
        timeoutMs: 480_000,
        signal: scanSignal,
        onEvent: async (evt) => {
          if (evt.type === "start") {
            dailyEventState.status = "流式通道已建立，等待各模块…";
            renderYuqingDailyIntoDom();
            return;
          }
          if (evt.type === "partial") {
            mergeDailyStreamEvent(evt);
            dailyEventState.source = "cloud";
            dailyEventState.status = `已更新：${evt.module || "模块"}`;
            renderYuqingDailyIntoDom();
          }
        },
      });
    } else {
      data = await DataEngine.generateYuqingStructuredReport(DAILY_EVENT_KIND, payload, { timeoutMs: 480_000, signal: scanSignal });
    }
    dailyEventState.streamPreviewRow = null;
    if (data && data.report) {
      dailyEventState.report = data.report;
      dailyEventState.source = "cloud";
      dailyEventState.status = canStream
        ? "流式扫描已完成，已写入 D1（头条为双路检索合并，可在 Worker 请求体关闭 dualHeadlineLanes 以省检索）。"
        : "单次扫描已完成，已写入 D1 并拉回本条（趋势基于温度+头条+速览+AI 情报归纳）。";
      try {
        history.replaceState(null, "", `#/news?reportId=${encodeURIComponent(data.report.id)}`);
      } catch (_) {}
      await loadDailyHistory();
      dailyEventState.archiveFilter = "manual";
      openArchiveAfter = true;
    }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    dailyEventState.streamPreviewRow = null;
    const maybeTimeout = /超时|AbortError|aborted|network/i.test(msg);
    if (maybeTimeout) {
      dailyEventState.status = "请求中断或超时，正在尝试从 D1 读取最新一条事件日报…";
      dailyEventState.source = "loading";
      renderYuqingDailyIntoDom();
      try {
        await loadDailyReport("");
        const row = dailyEventState.report;
        if (row && row.id && row.id !== reportIdBefore && row.report) {
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
      dailyEventState.status = msg;
    }
  } finally {
    if (__dailyScanTick) {
      clearInterval(__dailyScanTick);
      __dailyScanTick = null;
    }
    dailyEventState.loading = false;
    renderYuqingDailyIntoDom();
    if (openArchiveAfter) openDailyArchive();
  }
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
      renderYuqingDailyIntoDom();
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
      renderYuqingDailyIntoDom();
      openDailyArchive();
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
    <div class="news-intel-shell">
      <div id="daily-report-content">${renderYuqingDailyReport(dailyActiveReport())}</div>
    </div>
  `;
}

function initYuqingEvents() {
  disposeYuqingEvents();
  bindYuqingDailyEvents();
  refreshYuqingDailyClock();
  __yuqingDailyClock = setInterval(refreshYuqingDailyClock, 1000);
  loadDailyReport(dailyHashReportId());
}

function disposeYuqingEvents() {
  if (__yuqingDailyClock) {
    clearInterval(__yuqingDailyClock);
    __yuqingDailyClock = null;
  }
  if (__yuqingDailyAbort) {
    __yuqingDailyAbort.abort();
    __yuqingDailyAbort = null;
  }
}

if (typeof window !== "undefined") {
  window.__bitDeskDisposeYuqingEvents = disposeYuqingEvents;
}
