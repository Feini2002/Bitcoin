/* =======================================================
   页面：事件一览（双层日报 · daily_event）
   ======================================================= */

const DAILY_EVENT_KIND = "daily_event";
const DAILY_EVENT_FORCE_MOCK = true;
let __yuqingDailyClock = null;
let __yuqingDailyAbort = null;

const dailyEventState = {
  report: null,
  history: [],
  status: "Mock 契约预览：事件一览暂不读取云端日报",
  source: "mock",
  loading: false,
};

const DAILY_EVENT_MOCK_REPORT = {
  id: "mock-daily-contract-20260505-08",
  kind: DAILY_EVENT_KIND,
  reportDate: "2026-05-05",
  slot: "08",
  triggerType: "mock_contract",
  generatedAt: "2026-05-05T00:35:00Z",
  status: "mock",
  sourceRefs: [
    { type: "mock_contract", label: "Mock Flash JSON" },
    { type: "mock_contract", label: "Mock 今日头条 + 动态速览" },
    { type: "mock_contract", label: "Mock AI 情报站" },
    { type: "mock_contract", label: "Mock 趋势研判" },
    { type: "route", label: "舆情分析（二次研判入口）", href: "#/news-analysis", route: "news-analysis" },
  ],
  quality: { factCount: 28, sourceCoverage: 86, usedSearch: true, caveat: "前端 mock 契约样本，仅用于定稿展示格式；不代表真实新闻、搜索结果或交易建议。" },
  report: {
    title: "赛博前哨站",
    subtitle: "daily_event mock preview",
    marketTemperature: {
      score: 50,
      label: "结构分化",
      regime: "结构分化",
      summary: "中性（50）：风险情绪需要结合数据源与后续 LLM 研判；本页只展示事实底座格式。",
      crossAsset: "AI 权重叙事仍强，美元与黄金也有支撑，BTC 需要资金流继续确认。",
      anomaly: "风险资产与避险资产同时获得关注，说明事件驱动还没有给出单边答案。",
      suggestion: "只先阅读事实与观察点，把交易含义交给舆情分析页做二次拆解。",
    },
    topStory: {
      category: "地缘政治",
      title: "[持续追踪] 能源通道安全与停火谈判进入同一观察窗口",
      fact: "模拟事实：多方围绕海运安全、能源供应与地区停火条件密集接触，原油、航运与避险资产的风险溢价重新被市场关注。",
      structure: [
        "直接触发原因：模拟消息显示能源通道安全议题与地区停火谈判在同一时间窗发酵。",
        "深层结构性矛盾：供应稳定、地缘安全承诺与国内政治压力之间仍难一次性达成平衡。",
        "声明与行动差异：公开表态偏向降温，但市场更关注实际护航、制裁与供应链保险成本。",
      ],
      transmission: [
        "高概率情景：谈判继续但未失控升级，油价风险溢价维持，风险资产以震荡消化为主。",
        "中概率情景：出现局部摩擦或制裁升级，美元、黄金和能源链条短线获得防御买盘。",
        "低概率情景：停火与通道安全同时取得明确进展，风险偏好修复但需要资金流二次确认。",
      ],
      sourceName: "Mock",
      sourceUrl: "",
    },
    dynamicBriefs: [
      {
        category: "宏观经济",
        title: "美国通胀预期回落但服务项粘性仍未消失",
        body: "模拟事件：市场重新上调降息概率，但服务通胀与薪资数据让政策路径保持弹性。",
        watch: "48-72h 观察点：美债拍卖、联储官员讲话与美元指数是否共同确认风险偏好修复。",
        sourceName: "Mock Search",
        sourceUrl: "",
      },
      {
        category: "政策监管",
        title: "稳定币与交易平台披露规则进入新一轮意见窗口",
        body: "模拟事件：监管讨论从单点执法转向储备披露、客户资产隔离与跨境服务边界。",
        watch: "48-72h 观察点：若出现明确执行时间表，则加密市场会先交易合规成本而非长期利好。",
        sourceName: "Mock Search",
        sourceUrl: "",
      },
      {
        category: "科技产业",
        title: "AI 应用从模型参数竞赛转向企业级工作流落地",
        body: "模拟事件：产品更新更强调后台自动化、数据连接、权限治理与 Agent 编排。",
        watch: "48-72h 观察点：云厂商是否继续上修 AI 资本开支，决定纳指权重链条叙事强度。",
        sourceName: "Mock Search",
        sourceUrl: "",
      },
      {
        category: "加密市场",
        title: "BTC 在资金流、美元与风险偏好之间保持高位拉扯",
        body: "模拟事件：BTC 仍是风险偏好和美元流动性的混合表达，ETF 资金流决定短线弹性。",
        watch: "48-72h 观察点：看现货 ETF 净流入是否连续，以及 BTC 与纳指相关性是否重新抬升。",
        sourceName: "Mock Search",
        sourceUrl: "",
      },
      {
        category: "企业动态",
        title: "大型科技公司继续把 AI 功能打包进办公与云服务",
        body: "模拟事件：企业公告更强调 AI 功能的权限、审计、数据连接与可计费工作流。",
        watch: "48-72h 观察点：若客户案例与价格体系更清晰，AI 叙事会从演示热度转向收入验证。",
        sourceName: "Mock Search",
        sourceUrl: "",
      },
    ],
    aiIntel: [
      {
        title: "企业 AI 从聊天界面转向常驻型 Agent",
        date: "2026/05/05",
        what: "模拟更新：产品开始强调跨应用后台执行、自动检索、会议纪要与邮件处理。",
        use: "对普通用户的意义是把 AI 当作持续执行的工作助手，而不是一次性问答窗口。",
        attention: "高",
        sourceName: "Mock",
        sourceUrl: "",
      },
      {
        title: "开源模型工具链把本地部署门槛继续压低",
        date: "2026/05/05",
        what: "模拟更新：量化、检索增强、低成本推理与本地知识库模板进一步打包。",
        use: "个人和小团队更容易把私有资料接入 AI，不必每次从零搭建工程链路。",
        attention: "中",
        sourceName: "Mock",
        sourceUrl: "",
      },
      {
        title: "多模态 AI 更贴近日常内容生产流程",
        date: "2026/05/05",
        what: "模拟更新：图像、语音、表格和网页内容能在同一工作流里被识别、改写与整理。",
        use: "适合做日报、素材归档、会议复盘和投研笔记的半自动处理。",
        attention: "中",
        sourceName: "Mock",
        sourceUrl: "",
      },
    ],
    trendRead: {
      strengthening: [
        "AI 叙事正在从模型能力展示转向企业工作流落地，若云厂商 CAPEX 继续上修，纳指权重链条会保持叙事支撑。",
        "宏观宽松预期有修复迹象，但服务通胀和美元方向仍会决定风险偏好能否扩散。",
        "加密市场的交易弹性仍依赖 ETF 资金流连续性，单日上涨不足以确认趋势延续。",
      ],
      cracking: [
        "风险资产与避险资产同时被买入，说明市场仍在对地缘和政策不确定性做双向准备。",
        "AI 权重股叙事强，但若指数广度不足，风险偏好修复会更像结构行情而非全面扩散。",
      ],
      conclusion: "48-72h 观察清单：看能源通道谈判是否降温；看美元与美债是否确认宽松交易；看 BTC ETF 净流入能否连续配合价格突破。",
    },
    sources: [
      { name: "Mock Search Pack", type: "模拟搜索结果", reliability: "样本", count: 12 },
      { name: "Mock Official Calendar", type: "模拟官方日历", reliability: "样本", count: 5 },
      { name: "Mock Company Updates", type: "模拟企业公告", reliability: "样本", count: 6 },
      { name: "Mock Market Context", type: "模拟跨资产背景", reliability: "样本", count: 5 },
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

function dailyTriggerLabel(row) {
  const trigger = String(row && row.triggerType ? row.triggerType : "");
  if (trigger.includes("mock")) return "Mock预览";
  if (trigger === "manual") return "手动搜索";
  return "定点触发";
}

function dailyActiveReport() {
  return dailyEventState.report || DAILY_EVENT_MOCK_REPORT;
}

function dailyQuality(row) {
  return row.quality || (row.report && row.report.quality) || (row.grounding && row.grounding.quality) || {};
}

function dailySourceStatusText() {
  if (dailyEventState.source === "cloud") return "云端 D1 报告已接入";
  if (dailyEventState.source === "mock") return dailyEventState.status || "Mock 契约预览：未读取云端日报";
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
        <div class="news-story-watch daily-story-contract-line"><b>事实锁定</b><span>${dailyEscapeHtml(story.fact || "")}</span></div>
        <div class="news-story-watch daily-story-contract-line"><b>结构拆解</b><div class="daily-column-lines">${structure}</div></div>
        <div class="news-story-impact">
          <b>传导预判</b>
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
            <div class="news-story-watch daily-story-contract-line"><b>事件</b><span>${dailyEscapeHtml(item.body || "")}</span></div>
            <div class="news-story-watch"><b>48-72h</b><span>${dailyEscapeHtml(item.watch || "")}</span></div>
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
          <span>发布日期：${dailyEscapeHtml(item.date || "近72小时")}</span>
          <p><strong>新了什么：</strong>${dailyEscapeHtml(item.what || "")}</p>
          <p><strong>对我有什么用：</strong>${dailyEscapeHtml(item.use || "")}</p>
          <div class="news-source-inline">来源：${item.sourceUrl ? `<a href="${dailyEscapeHtml(item.sourceUrl)}" target="_blank" rel="noopener noreferrer">${dailyEscapeHtml(item.sourceName || "来源")}</a>` : dailyEscapeHtml(item.sourceName || "Mock")}</div>
        </div>
        <strong>${dailyEscapeHtml(item.attention || "")}关注</strong>
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
    block("正在强化的信号", t.strengthening, "ok"),
    block("正在裂变的信号", t.cracking, "warn"),
    block("48-72h 观察结论", [t.conclusion], "info"),
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
        <small>${dailyEscapeHtml(dailyTriggerLabel(item))}</small>
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
        <span class="chip ${dailyEventState.source === "cloud" ? "ok" : "warn"}">${dailyEventState.source === "cloud" ? "D1 Live" : "Mock Preview"}</span>
        <div class="daily-clock-pill"><i class="ph ph-clock"></i><span id="daily-clock">--</span></div>
        <button type="button" class="btn primary" id="daily-scan-preview" ${dailyEventState.loading || DAILY_EVENT_FORCE_MOCK ? "disabled" : ""}>
          <i class="ph ph-rocket-launch"></i><span>${DAILY_EVENT_FORCE_MOCK ? "Mock定稿中" : dailyEventState.loading ? "扫描中" : "重新实时扫描"}</span>
        </button>
        <button type="button" class="btn primary" id="daily-open-archive">
          <i class="ph ph-clock-counter-clockwise"></i><span>7日报告库</span>
        </button>
      </div>
    </div>

    <div class="news-phase-strip">
      <span><i class="ph ph-database"></i> ${dailyEscapeHtml(dailySourceStatusText())}</span>
      <span><i class="ph ph-clock"></i> 00 / 08 / 12 / 20 · Asia/Shanghai</span>
      <span><i class="ph ph-fingerprint"></i> ${dailyEscapeHtml(dailyTriggerLabel(r))}</span>
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
  if (DAILY_EVENT_FORCE_MOCK) {
    dailyEventState.report = DAILY_EVENT_MOCK_REPORT;
    dailyEventState.history = [DAILY_EVENT_MOCK_REPORT];
    dailyEventState.source = "mock";
    dailyEventState.status = "Mock 契约预览：前端只映射模拟 daily_event 报告，未请求云端 D1";
    renderYuqingDailyIntoDom();
    return;
  }
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
  if (DAILY_EVENT_FORCE_MOCK) {
    dailyEventState.report = DAILY_EVENT_MOCK_REPORT;
    dailyEventState.history = [DAILY_EVENT_MOCK_REPORT];
    dailyEventState.source = "mock";
    dailyEventState.status = "Mock 契约预览中：手动扫描已暂停，避免混入云端真实数据";
    renderYuqingDailyIntoDom();
    return;
  }
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
