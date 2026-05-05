/* =======================================================
   页面：事件一览（双层日报 · daily_event）
   ======================================================= */

const DAILY_EVENT_KIND = "daily_event";
let __yuqingDailyClock = null;
let __yuqingDailyAbort = null;

const dailyEventState = {
  report: null,
  history: [],
  status: "正在读取云端日报...",
  source: "loading",
  loading: false,
};

const DAILY_EVENT_MOCK_REPORT = {
  id: "mock-daily-20260505-08",
  kind: DAILY_EVENT_KIND,
  reportDate: "2026-05-05",
  slot: "08",
  triggerType: "scheduled_mock",
  generatedAt: "2026-05-05T00:35:00Z",
  status: "mock",
  sourceRefs: [
    { type: "route", label: "舆情分析", href: "#/news-analysis", route: "news-analysis" },
    { type: "fact", label: "Reuters", source: "Reuters", url: "" },
    { type: "fact", label: "Federal Reserve", source: "Federal Reserve", url: "https://www.federalreserve.gov/newsevents/calendar.htm" },
  ],
  quality: { factCount: 18, sourceCoverage: 74, usedSearch: false, caveat: "本地样本，仅用于云端不可用时预览。" },
  report: {
    title: "赛博前哨站",
    subtitle: "日常新闻早报",
    marketTemperature: {
      score: 34,
      label: "信息温度偏冷",
      summary: "宏观事件与科技叙事同时升温，但交易结论留给舆情分析页做二次拆解。",
    },
    topStory: {
      category: "地缘政治",
      title: "美国与中东围绕能源通道的新一轮谈判进入关键窗口",
      fact: "多方围绕海运安全、能源供应与地区停火条件展开接触，原油与航运风险溢价重新进入市场视野。",
      structure: ["能源通道安全与地区停火谈判同步推进。", "各方安全承诺和供应稳定的利益排序不同。", "事件一览只记录信息结构，不直接下交易结论。"],
      transmission: ["若谈判延续但无失控升级，油价风险溢价维持。", "若出现制裁或冲突升级，风险资产短线承压。"],
      sourceName: "Mock",
      sourceUrl: "",
    },
    dynamicBriefs: [
      {
        category: "宏观经济",
        title: "美国通胀预期降温但服务项仍偏粘",
        body: "市场对年内降息的定价有所修复，但核心服务和薪资数据仍让政策路径保持弹性。",
        watch: "未来 48 小时关注美债拍卖、联储官员讲话与美元指数是否继续回落。",
        sourceName: "Mock",
        sourceUrl: "",
      },
      {
        category: "科技产业",
        title: "AI 应用公司继续从模型能力转向企业级工作流",
        body: "新的 AI 产品更新更强调后台自动化、数据连接与 Agent 编排。",
        watch: "若云厂商继续上调 AI 资本开支预期，纳指与 NVDA 链条仍会获得叙事支撑。",
        sourceName: "Mock",
        sourceUrl: "",
      },
      {
        category: "加密市场",
        title: "比特币围绕资金流与监管预期震荡",
        body: "BTC 仍是风险偏好和美元流动性的混合表达，ETF 资金流决定短线弹性。",
        watch: "观察现货 ETF 净流入是否连续，以及 BTC 与纳指相关性是否重新抬升。",
        sourceName: "Mock",
        sourceUrl: "",
      },
    ],
    aiIntel: [
      {
        title: "企业 AI 从聊天界面转向常驻型 Agent",
        date: "2026/05/05",
        what: "近期产品更新更强调跨应用后台执行、自动检索、会议与邮件处理。",
        use: "这说明 AI 叙事正在从用户增长转向企业效率和工作流替代。",
        attention: "高",
        sourceName: "Mock",
        sourceUrl: "",
      },
    ],
    trendRead: {
      strengthening: ["AI 应用正在从演示产品进入后台自动化。", "黄金与美元同时偏强说明市场仍在给地缘和政策不确定性定价。"],
      cracking: ["加密资产资金流尚未形成连续性。"],
      conclusion: "今天适合把日报当作信息底座：先判断哪些事件有持续性，再交给舆情分析页做交易影响拆解。",
    },
    sources: [
      { name: "Reuters", type: "国际通讯社", reliability: "高", count: 4 },
      { name: "Federal Reserve", type: "官方来源", reliability: "高", count: 2 },
      { name: "Company Blogs", type: "企业公告", reliability: "中高", count: 3 },
    ],
  },
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

function dailySlotLabel(row) {
  const slot = String(row && row.slot ? row.slot : "");
  if (slot.startsWith("manual")) return "手动";
  if (slot === "00") return "凌晨版";
  if (slot === "08") return "早报";
  if (slot === "12") return "午报";
  if (slot === "20") return "晚报";
  return slot || "报告";
}

function dailyActiveReport() {
  return dailyEventState.report || DAILY_EVENT_MOCK_REPORT;
}

function dailyQuality(row) {
  return row.quality || (row.report && row.report.quality) || (row.grounding && row.grounding.quality) || {};
}

function dailySourceStatusText() {
  if (dailyEventState.source === "cloud") return "云端 D1 报告已接入";
  if (dailyEventState.source === "error") return `云端不可用，使用本地样本：${dailyEventState.status}`;
  if (dailyEventState.source === "loading") return "正在读取云端 D1 报告...";
  return dailyEventState.status || "本地样本";
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
        <p>${dailyEscapeHtml(temp.summary || "详细交易含义交给舆情分析页做二次研判。")}</p>
      </div>
    </section>
  `;
}

function renderDailyTopStory(row) {
  const story = row.report.topStory || {};
  const structure = (story.structure || []).map((x) => `<span>${dailyEscapeHtml(x)}</span>`).join("");
  const transmission = (story.transmission || []).map((x) => `<span>${dailyEscapeHtml(x)}</span>`).join("");
  return `
    <article class="news-story">
      <div class="news-story-rank">1</div>
      <div class="news-story-body">
        <div class="news-story-meta">
          <span>${dailyEscapeHtml(story.category || "今日头条")}</span>
          ${story.sourceUrl ? `<a href="${dailyEscapeHtml(story.sourceUrl)}" target="_blank" rel="noopener noreferrer">${dailyEscapeHtml(story.sourceName || "来源")}</a>` : `<span>${dailyEscapeHtml(story.sourceName || "D1")}</span>`}
        </div>
        <h3>${dailyEscapeHtml(story.title || "暂无头条")}</h3>
        <p class="news-story-thesis">${dailyEscapeHtml(story.fact || "")}</p>
        <div class="news-story-facts">${structure}</div>
        <div class="news-story-impact">
          <b>后续观察</b>
          <div class="daily-column-lines">${transmission}</div>
        </div>
      </div>
    </article>
  `;
}

function renderDailyBriefs(row) {
  return (row.report.dynamicBriefs || [])
    .map(
      (item, idx) => `
        <article class="news-story">
          <div class="news-story-rank muted">${idx + 2}</div>
          <div class="news-story-body">
            <div class="news-story-meta">
              <span>${dailyEscapeHtml(item.category || "动态")}</span>
              ${item.sourceUrl ? `<a href="${dailyEscapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${dailyEscapeHtml(item.sourceName || "来源")}</a>` : `<span>${dailyEscapeHtml(item.sourceName || "D1")}</span>`}
            </div>
            <h3>${dailyEscapeHtml(item.title || "")}</h3>
            <p class="news-story-thesis">${dailyEscapeHtml(item.body || "")}</p>
            <div class="news-story-watch"><b>观察点</b><span>${dailyEscapeHtml(item.watch || "")}</span></div>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderDailyAi(row) {
  return (row.report.aiIntel || [])
    .map(
      (item) => `<div class="news-ai-row">
        <div class="news-ai-icon"><i class="ph ph-sparkle"></i></div>
        <div>
          <h4>${dailyEscapeHtml(item.title || "")}</h4>
          <p><strong>新了什么：</strong>${dailyEscapeHtml(item.what || "")}</p>
          <p><strong>对我有什么用：</strong>${dailyEscapeHtml(item.use || "")}</p>
          <div class="news-source-inline">${item.sourceUrl ? `<a href="${dailyEscapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${dailyEscapeHtml(item.sourceName || "来源")}</a>` : dailyEscapeHtml(item.sourceName || item.date || "")}</div>
        </div>
        <strong>${dailyEscapeHtml(item.attention || "")}</strong>
      </div>`,
    )
    .join("");
}

function renderDailyTrend(row) {
  const t = row.report.trendRead || {};
  const block = (title, rows, cls) => `<div class="news-trend-block ${cls}">
    <h4>${dailyEscapeHtml(title)}</h4>
    ${(rows || []).map((x) => `<p>${dailyEscapeHtml(x)}</p>`).join("")}
  </div>`;
  return [
    block("正在强化", t.strengthening, "ok"),
    block("正在裂变", t.cracking, "warn"),
    block("总结", [t.conclusion], "info"),
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

function renderDailyArchiveList() {
  const items = dailyEventState.history.length ? dailyEventState.history : [DAILY_EVENT_MOCK_REPORT];
  let lastDate = "";
  return items
    .map((item) => {
      const date = item.reportDate || "";
      const dateHead = date && date !== lastDate ? `<div class="news-archive-date">${dailyEscapeHtml(date)}</div>` : "";
      lastDate = date || lastDate;
      const active = dailyActiveReport().id === item.id;
      const title = item.title || (item.report && (item.report.title || item.report.topStory?.title)) || "日报";
      return `${dateHead}<button type="button" class="news-archive-item ${active ? "active" : ""}" data-report-id="${dailyEscapeHtml(item.id)}">
        <span>${dailyEscapeHtml(dailySlotLabel(item))}</span>
        <strong>${dailyEscapeHtml(title)}</strong>
        <em>${dailyEscapeHtml(dailyFormatTime(item.generatedAt))}</em>
        <small>${dailyEscapeHtml(item.triggerType === "manual" ? "手动搜索" : "定点触发")}</small>
      </button>`;
    })
    .join("");
}

function renderYuqingDailyReport(row) {
  const r = row || dailyActiveReport();
  const q = dailyQuality(r);
  return `
    <div class="news-command">
      <div class="news-command-main">
        <span class="news-live-dot ${dailyEventState.source === "cloud" ? "" : "mock"}"></span>
        <div>
          <h1>${dailyEscapeHtml(r.report.title || "事件一览")}</h1>
          <p>${dailyEscapeHtml(dailySlotLabel(r))} · ${dailyEscapeHtml(r.reportDate || "")} · ${dailyEscapeHtml(dailyFormatTime(r.generatedAt))}</p>
        </div>
      </div>
      <div class="news-command-actions">
        <span class="chip ${dailyEventState.source === "cloud" ? "ok" : "warn"}">${dailyEventState.source === "cloud" ? "D1 Live" : "Mock Fallback"}</span>
        <div class="daily-clock-pill"><i class="ph ph-clock"></i><span id="daily-clock">--</span></div>
        <button type="button" class="btn primary" id="daily-scan-preview" ${dailyEventState.loading ? "disabled" : ""}>
          <i class="ph ph-rocket-launch"></i><span>${dailyEventState.loading ? "扫描中" : "重新实时扫描"}</span>
        </button>
        <button type="button" class="btn primary" id="daily-open-archive">
          <i class="ph ph-clock-counter-clockwise"></i><span>7日报告库</span>
        </button>
      </div>
    </div>

    <div class="news-phase-strip">
      <span><i class="ph ph-database"></i> ${dailyEscapeHtml(dailySourceStatusText())}</span>
      <span><i class="ph ph-clock"></i> 00 / 08 / 12 / 20 · Asia/Shanghai</span>
      <span><i class="ph ph-fingerprint"></i> ${dailyEscapeHtml(r.triggerType === "manual" ? "手动搜索" : "定点触发")}</span>
      <span><i class="ph ph-list-checks"></i> 事实 ${Number(q.factCount || 0)} · 覆盖 ${Number(q.sourceCoverage || 0)}%</span>
    </div>

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
        <div class="news-story-list">${renderDailyTopStory(r)}</div>
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

      <section class="news-panel span-12">
        <div class="news-panel-head">
          <div>
            <span class="news-section-kicker">来源可信度</span>
            <h3>本轮信息来源与跳转</h3>
          </div>
          <i class="ph ph-seal-check"></i>
        </div>
        ${renderDailyRefs(r)}
        <div class="news-quality-row">
          <div>
            <span>覆盖度</span>
            <strong>${Number(q.sourceCoverage || 0)}%</strong>
            <em>${dailyEscapeHtml(q.caveat || "信息底座，不构成交易建议。")}</em>
          </div>
          <div class="news-source-list">${renderDailySources(r)}</div>
        </div>
      </section>
    </div>

    <div class="news-archive-backdrop" id="daily-archive-backdrop" hidden></div>
    <aside class="news-archive-drawer" id="daily-archive-drawer" aria-hidden="true">
      <div class="news-archive-head">
        <div>
          <span class="news-section-kicker">最近 7 天</span>
          <h3>事件日报回档</h3>
        </div>
        <button type="button" class="btn" id="daily-close-archive" title="关闭报告库">
          <i class="ph ph-x"></i><span>关闭</span>
        </button>
      </div>
      <div class="news-archive-list">${renderDailyArchiveList()}</div>
    </aside>
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

async function loadDailyReport(reportId = "") {
  if (typeof DataEngine === "undefined") {
    dailyEventState.source = "error";
    dailyEventState.status = "DataEngine 不可用";
    renderYuqingDailyIntoDom();
    return;
  }
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
      dailyEventState.report = DAILY_EVENT_MOCK_REPORT;
      dailyEventState.source = "error";
      dailyEventState.status = data && data.d1Ready === false ? "D1 未绑定或迁移未执行" : "暂无云端日报";
    }
  } catch (e) {
    dailyEventState.report = DAILY_EVENT_MOCK_REPORT;
    dailyEventState.source = "error";
    dailyEventState.status = e && e.message ? e.message : String(e);
  }
  await loadDailyHistory();
  renderYuqingDailyIntoDom();
}

async function generateDailyReport() {
  if (typeof DataEngine === "undefined" || typeof DataEngine.generateYuqingStructuredReport !== "function") return;
  dailyEventState.loading = true;
  dailyEventState.status = "正在触发手动搜索与日报分析...";
  renderYuqingDailyIntoDom();
  try {
    const data = await DataEngine.generateYuqingStructuredReport(DAILY_EVENT_KIND, { mode: "deep", forceSearch: true }, { timeoutMs: 190_000 });
    if (data && data.report) {
      dailyEventState.report = data.report;
      dailyEventState.source = "cloud";
      dailyEventState.status = "手动搜索已写入 D1";
      try {
        history.replaceState(null, "", `#/news?reportId=${encodeURIComponent(data.report.id)}`);
      } catch (_) {}
    }
    await loadDailyHistory();
  } catch (e) {
    dailyEventState.source = "error";
    dailyEventState.status = e && e.message ? e.message : String(e);
  } finally {
    dailyEventState.loading = false;
    renderYuqingDailyIntoDom();
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
    open.addEventListener("click", openDailyArchive);
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
  document.querySelectorAll(".news-archive-item").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-report-id") || "";
      closeDailyArchive();
      if (id && id !== DAILY_EVENT_MOCK_REPORT.id) {
        try {
          history.replaceState(null, "", `#/news?reportId=${encodeURIComponent(id)}`);
        } catch (_) {}
        await loadDailyReport(id);
      }
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
