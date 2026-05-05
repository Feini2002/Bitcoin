/* =======================================================
   页面：事件一览（双层日报 · daily_event）
   ======================================================= */

const DAILY_EVENT_KIND = "daily_event";
const DAILY_EVENT_FORCE_MOCK = false;
let __yuqingDailyClock = null;
let __yuqingDailyAbort = null;

const dailyEventState = {
  report: null,
  history: [],
  status: "信息已更新",
  source: "mock",
  loading: false,
  /** 报告库抽屉筛选：all | scheduled | manual（实时扫描） */
  archiveFilter: "all",
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
    { type: "search_pack", label: "全球要闻搜索" },
    { type: "official_calendar", label: "官方日历与政策公告" },
    { type: "company_updates", label: "企业与科技更新" },
    { type: "market_context", label: "跨资产市场背景" },
    { type: "route", label: "舆情分析（二次研判入口）", href: "#/news-analysis", route: "news-analysis" },
  ],
  quality: { factCount: 36, sourceCoverage: 88, usedSearch: true, caveat: "覆盖率按来源数量、事实密度与可追溯程度估算。" },
  report: {
    title: "事件日报",
    subtitle: "日常新闻早午晚报",
    marketTemperature: {
      score: 50,
      label: "结构分化",
      regime: "结构分化",
      summary: "中性（50）：风险偏好与防御买盘同时存在，宏观宽松、AI 权重叙事和地缘风险正在拉扯同一批资金。",
      crossAsset: "AI 权重叙事仍强，美元与黄金也有支撑，BTC 需要资金流继续确认。",
      anomaly: "风险资产与避险资产同时获得关注，说明事件驱动还没有给出单边答案。",
      suggestion: "先看事件是否继续被官方口径、资金流和价格结构共同确认，再进入二次研判。",
    },
    topStory: {
      category: "地缘政治",
      title: "[持续追踪] 能源通道安全与停火谈判进入同一观察窗口",
      fact: "多方围绕海运安全、能源供应与地区停火条件密集接触，原油、航运与避险资产的风险溢价重新被市场关注。",
      structure: {
        trigger: "直接触发原因：能源通道安全议题与地区停火谈判在同一时间窗发酵。",
        conflict: "深层结构性矛盾：供应稳定、地缘安全承诺与国内政治压力之间仍难一次性达成平衡。",
        divergence: "声明与行动差异：公开表态偏向降温，但市场更关注实际护航、制裁与供应链保险成本。"
      },
      impacts: [
        { asset: "原油", direction: "up", logic: "谈判继续但未失控升级，油价风险溢价维持。" },
        { asset: "BTC", direction: "shock", logic: "风险偏好受抑，短线需要资金流二次确认。" }
      ],
      nextWatch: "出现局部摩擦或制裁升级，美元、黄金和能源链条短线获得防御买盘。",
      sourceName: "全球要闻",
      sourceUrl: "",
    },
    topStories: [
      {
        category: "地缘政治",
        title: "[持续追踪] 能源通道安全与停火谈判进入同一观察窗口",
        fact: "多方围绕海运安全、能源供应与地区停火条件密集接触，原油、航运与避险资产的风险溢价重新被市场关注。",
        structure: {
          trigger: "直接触发原因：能源通道安全议题与地区停火谈判在同一时间窗发酵。",
          conflict: "深层结构性矛盾：供应稳定、地缘安全承诺与国内政治压力之间仍难一次性达成平衡。",
          divergence: "声明与行动差异：公开表态偏向降温，但市场更关注实际护航、制裁与供应链保险成本。"
        },
        impacts: [
          { asset: "原油", direction: "up", logic: "谈判继续但未失控升级，油价风险溢价维持。" },
          { asset: "BTC", direction: "shock", logic: "风险偏好受抑，短线需要资金流二次确认。" }
        ],
        nextWatch: "出现局部摩擦或制裁升级，美元、黄金和能源链条短线获得防御买盘。",
        sourceName: "全球要闻",
        sourceUrl: "",
      },
      {
        category: "宏观经济",
        title: "美国通胀预期回落，但服务项粘性仍压住降息交易",
        fact: "通胀预期回落带动降息交易修复，但服务通胀和薪资韧性让市场不敢把宽松路径一次性定满。",
        structure: {
          trigger: "直接触发原因：通胀预期与利率期货重新指向更友好的政策窗口。",
          conflict: "深层结构性矛盾：商品通胀降温快于服务项，居民薪资与企业定价仍在延缓政策转向。",
          divergence: "声明与行动差异：市场提前交易降息，央行官员仍强调数据依赖，美元和美债没有完全同步松动。"
        },
        impacts: [
          { asset: "纳指", direction: "up", logic: "宽松交易温和延续，成长股获得估值支撑。" },
          { asset: "美元", direction: "down", logic: "降息预期重燃，美元指数面临下行压力。" }
        ],
        nextWatch: "美债拍卖或官员讲话偏鹰，美元反弹会压制风险资产弹性。",
        sourceName: "宏观日历",
        sourceUrl: "",
      },
      {
        category: "科技产业",
        title: "AI 资本开支与企业级 Agent 落地继续牵引科技权重",
        fact: "大型科技公司把 AI 功能从演示能力推进到云服务、办公流程和企业权限系统，市场继续给算力与软件链条定价。",
        structure: {
          trigger: "直接触发原因：云厂商与软件平台持续发布企业级 AI 工作流、数据连接和自动化执行能力。",
          conflict: "深层结构性矛盾：资本开支仍在抬升，但收入兑现、客户留存和单位推理成本需要持续验证。",
          divergence: "声明与行动差异：公司口径强调效率提升，投资者更关注订单、毛利率和真实付费转化。"
        },
        impacts: [
          { asset: "AI链条", direction: "up", logic: "纳指权重继续获得叙事支撑，但指数广度不足会限制全面风险偏好。" },
          { asset: "SaaS", direction: "shock", logic: "软件公司若客户案例和定价体系快速清晰，AI 叙事从概念热度转向收入验证。" }
        ],
        nextWatch: "CAPEX 上修伴随利润率压力，AI 链条内部会出现分化。",
        sourceName: "科技产业",
        sourceUrl: "",
      },
    ],
    dynamicBriefs: [
      {
        category: "宏观经济",
        title: "美国通胀预期回落但服务项粘性仍未消失",
        body: "市场重新上调降息概率。",
        description: "服务通胀与薪资数据仍让政策路径保持弹性，美元和美债没有完全确认宽松交易。",
        analysis: "若官员讲话与债券需求共同转鸽，风险偏好会扩散；若美元反弹，BTC 和高贝塔科技股会先承压。",
        sourceName: "宏观日历",
        sourceUrl: "",
      },
      {
        category: "政策监管",
        title: "稳定币与交易平台披露规则进入新一轮意见窗口",
        body: "监管讨论从单点执法转向储备披露、客户资产隔离与跨境服务边界。",
        description: "市场关注规则是否会提高交易平台运营成本，以及稳定币发行方的储备透明度要求。",
        analysis: "短线更容易先交易合规成本，中期才会重新评估头部机构受益空间。",
        sourceName: "政策跟踪",
        sourceUrl: "",
      },
      {
        category: "科技产业",
        title: "AI 应用从模型参数竞赛转向企业级工作流落地",
        body: "产品更新更强调后台自动化、数据连接、权限治理与 Agent 编排。",
        description: "投资者开始从模型能力演示转向客户部署、续费和可计费工作流。",
        analysis: "AI 叙事仍能支撑科技权重，但若指数广度不跟，行情会更偏结构性。",
        sourceName: "科技产业",
        sourceUrl: "",
      },
      {
        category: "加密市场",
        title: "BTC 在资金流、美元与风险偏好之间保持高位拉扯",
        body: "BTC 仍是风险偏好和美元流动性的混合表达。",
        description: "现货 ETF 资金流决定短线弹性，美元方向和纳指权重表现决定外部环境。",
        analysis: "只有资金流、纳指和链上活跃度同时改善，价格突破才更容易获得持续性。",
        sourceName: "加密市场",
        sourceUrl: "",
      },
      {
        category: "企业动态",
        title: "大型科技公司继续把 AI 功能打包进办公与云服务",
        body: "企业公告更强调 AI 功能的权限、审计、数据连接与可计费工作流。",
        description: "办公软件、云平台和数据服务正在把 AI 从插件变成默认能力。",
        analysis: "市场会继续盯客户案例和定价体系，收入验证越清晰，叙事越不容易降温。",
        sourceName: "企业更新",
        sourceUrl: "",
      },
    ],
    aiIntel: [
      {
        title: "企业 AI 从聊天界面转向常驻型 Agent",
        date: "2026/05/05",
        what: "产品开始强调跨应用后台执行、自动检索、会议纪要与邮件处理。",
        use: "对普通用户的意义是把 AI 当作持续执行的工作助手，而不是一次性问答窗口。",
        attention: "高",
        sourceName: "科技更新",
        sourceUrl: "",
      },
      {
        title: "开源模型工具链把本地部署门槛继续压低",
        date: "2026/05/05",
        what: "量化、检索增强、低成本推理与本地知识库模板进一步打包。",
        use: "个人和小团队更容易把私有资料接入 AI，不必每次从零搭建工程链路。",
        attention: "中",
        sourceName: "开源生态",
        sourceUrl: "",
      },
      {
        title: "多模态 AI 更贴近日常内容生产流程",
        date: "2026/05/05",
        what: "图像、语音、表格和网页内容能在同一工作流里被识别、改写与整理。",
        use: "适合做日报、素材归档、会议复盘和投研笔记的半自动处理。",
        attention: "中",
        sourceName: "产品更新",
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
      conclusion: "0-72小时观察清单：看能源通道谈判是否降温；看美元与美债是否确认宽松交易；看 BTC ETF 净流入能否连续配合价格突破。",
    },
    sources: [
      { name: "Search Pack", type: "搜索结果", reliability: "中高", count: 12 },
      { name: "Official Calendar", type: "官方日历", reliability: "高", count: 5 },
      { name: "Company Updates", type: "企业公告", reliability: "中高", count: 6 },
      { name: "Market Context", type: "跨资产背景", reliability: "中", count: 5 },
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
  if (trigger.includes("mock")) return "定时生成";
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
  if (dailyEventState.source === "mock") return dailyEventState.status || "信息已更新";
  if (dailyEventState.source === "error") return `数据源切换中：${dailyEventState.status}`;
  if (dailyEventState.source === "loading") return "正在读取云端 D1 报告...";
  return dailyEventState.status || "信息已更新";
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

function renderDailySlotTabs(row) {
  const current = dailySlotLabel(row);
  return ["早报", "午报", "晚报"]
    .map((label) => `<span class="daily-slot-tab ${current === label ? "active" : ""}">${dailyEscapeHtml(label)}</span>`)
    .join("");
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
  const raw = dailyEventState.history.length ? dailyEventState.history : [DAILY_EVENT_MOCK_REPORT];
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

function renderDailyArchiveFilters() {
  const cur = dailyEventState.archiveFilter || "all";
  const mk = (key, label) =>
    `<button type="button" class="daily-archive-filter ${cur === key ? "active" : ""}" data-archive-filter="${dailyEscapeHtml(key)}" role="tab" aria-selected="${cur === key ? "true" : "false"}">${dailyEscapeHtml(label)}</button>`;
  return `<div class="daily-archive-filters" role="tablist">${mk("all", "全部")}${mk("scheduled", "定点班次")}${mk("manual", "实时扫描")}</div>`;
}

function renderYuqingDailyReport(row) {
  const r = row || dailyActiveReport();
  const q = dailyQuality(r);
  const temp = r.report.marketTemperature || {};
  return `
    <div class="news-command daily-event-command">
      <div class="news-command-main daily-command-main">
        <div class="daily-slot-tabs">${renderDailySlotTabs(r)}</div>
        <div class="daily-report-meta">
          <span><i class="ph ph-calendar-dots"></i>${dailyEscapeHtml(r.reportDate || "")}</span>
          <span><i class="ph ph-clock"></i>${dailyEscapeHtml(dailyFormatTime(r.generatedAt))}</span>
          <span><i class="ph ph-list-checks"></i>事件 ${Number(q.factCount || 0)} · 覆盖 ${Number(q.sourceCoverage || 0)}%</span>
        </div>
      </div>
      <div class="news-command-actions">
        <div class="daily-clock-pill"><i class="ph ph-clock"></i><span id="daily-clock">--</span></div>
        <button type="button" class="btn primary" id="daily-scan-preview" ${dailyEventState.loading || DAILY_EVENT_FORCE_MOCK ? "disabled" : ""} title="即时调用 Gemini 检索并写入报告库（可在右侧抽屉「实时扫描」中回看）">
          <i class="ph ph-rocket-launch"></i><span>${dailyEventState.loading ? "扫描中" : "实时扫描"}</span>
        </button>
        <button type="button" class="btn primary" id="daily-open-archive">
          <i class="ph ph-clock-counter-clockwise"></i><span>7日报告库</span>
        </button>
      </div>
    </div>

    <div class="news-phase-strip">
      <span><i class="ph ph-pulse"></i>${dailyEscapeHtml(temp.regime || "结构分化")}</span>
      <span><i class="ph ph-clock"></i>早报 / 午报 / 晚报 · Asia/Shanghai</span>
      <span><i class="ph ph-compass"></i>0-72小时观察</span>
      <span><i class="ph ph-fingerprint"></i>${dailyEscapeHtml(dailyTriggerLabel(r))}</span>
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

    <div class="news-archive-backdrop" id="daily-archive-backdrop" hidden></div>
    <aside class="news-archive-drawer" id="daily-archive-drawer" aria-hidden="true">
      <div class="news-archive-head">
        <div>
          <span class="news-section-kicker">最近 7 天</span>
          <h3>事件日报回档</h3>
          <p class="daily-archive-sub">定点早报 / 午报 / 晚报与「实时扫描」都会写入此列表，可按类型筛选。</p>
        </div>
        <button type="button" class="btn" id="daily-close-archive" title="关闭报告库">
          <i class="ph ph-x"></i><span>关闭</span>
        </button>
      </div>
      ${renderDailyArchiveFilters()}
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
    dailyEventState.status = "信息已更新";
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
    dailyEventState.status = "信息已更新";
    renderYuqingDailyIntoDom();
    return;
  }
  if (typeof DataEngine === "undefined" || typeof DataEngine.generateYuqingStructuredReport !== "function") return;
  dailyEventState.loading = true;
  dailyEventState.status = "正在触发手动搜索与日报分析...";
  renderYuqingDailyIntoDom();
  let openArchiveAfter = false;
  try {
    const data = await DataEngine.generateYuqingStructuredReport(DAILY_EVENT_KIND, { mode: "deep", forceSearch: true }, { timeoutMs: 190_000 });
    if (data && data.report) {
      dailyEventState.report = data.report;
      dailyEventState.source = "cloud";
      dailyEventState.status = "手动搜索已写入 D1";
      try {
        history.replaceState(null, "", `#/news?reportId=${encodeURIComponent(data.report.id)}`);
      } catch (_) {}
      await loadDailyHistory();
      dailyEventState.archiveFilter = "manual";
      openArchiveAfter = true;
    }
  } catch (e) {
    dailyEventState.source = "error";
    dailyEventState.status = e && e.message ? e.message : String(e);
  } finally {
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
