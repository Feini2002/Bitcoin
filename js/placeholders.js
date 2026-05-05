/* =======================================================
   轻占位页模板（数据层 / 其他）
   ======================================================= */
function pagePlaceholder(cfg) {
  const { title, sub, icon, future = [], dataKey } = cfg;
  const banner = dataKey ? renderDataLayerBanner(dataKey) : "";
  return html`
    <header class="page-header">
      <div>
        <h1 class="page-title">${title}</h1>
        <div class="page-sub">${sub}</div>
      </div>
      <span class="chip warn">未上岗 · 占位中</span>
    </header>
    ${banner}
    <div class="placeholder-hero">
      <div class="placeholder-icon"><i class="ph ${icon}"></i></div>
      <div>
        <h2>该模块暂未上岗</h2>
        <p>骨架已留好，后续接入数据源与业务逻辑即可直接上线。下面列出了该页规划中的内容：</p>
      </div>
    </div>
    <div class="future-list">
      ${future.map(f => `
        <div class="future-item">
          <h4>${f.title}</h4>
          <p>${f.desc}</p>
          <span class="coming">PLANNED</span>
        </div>
      `).join("")}
    </div>
    <div class="card" style="margin-top:var(--sp-5)">
      <div class="card-title">骨架屏预览</div>
      <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap: var(--sp-3);">
        <div class="skeleton skel-block"></div>
        <div class="skeleton skel-block"></div>
        <div class="skeleton skel-block"></div>
      </div>
      <div class="skeleton skel-line" style="width:80%; margin-top:var(--sp-3)"></div>
      <div class="skeleton skel-line" style="width:60%"></div>
      <div class="skeleton skel-line" style="width:72%"></div>
    </div>
  `;
}

/* 统一的员工页模板（分析层） */
function pageAgentPlaceholder(agentId) {
  const a = AGENT_MAP[agentId];
  const view = AGENT_VIEWS[agentId];
  if (!view) return "";
  const dataPages = (AGENT_DATA[agentId] || {}).primary || [];

  const evidenceBlock = view.subordinates
    ? `
      <div class="evidence-card">
        <div class="evidence-head">
          <span class="evidence-label">证据链 · 下属共识</span>
          <span class="evidence-title">四位专员的今日结论（点击卡片深入其工作台）</span>
        </div>
        <div style="padding:var(--sp-4);">
          <div class="subordinate-grid">
            ${["env","flow","deriv","risk"].map(id => {
              const sub = AGENT_MAP[id];
              const sv = AGENT_VIEWS[id] || { stance: "（即时）", oneliner: "查看深度页获取完整结论", confidence: 0 };
              const subStance = id === "env" ? "趋势扩张 · 偏多" : sv.stance;
              const subText = id === "env"
                ? "4H 进入扩张初期，BB 口径 2.1→4.6%，DVOL 同步抬升。"
                : sv.oneliner;
              const subConf = id === "env" ? 72 : sv.confidence;
              const stanceCls = /多|买|B\+|A-|扩张/.test(subStance) ? "bull"
                : /空|卖|C|D/.test(subStance) ? "bear" : "neutral";
              return `
                <a class="sub-card" href="#/${agentRoute(id)}">
                  <div class="sub-card-head">
                    <span class="sub-card-dot" style="background:${sub.color}">${sub.short}</span>
                    <span class="sub-card-name">${sub.name}</span>
                    <span class="sub-card-stance ${stanceCls}">${subStance}</span>
                  </div>
                  <div class="sub-card-text">${subText}</div>
                  <div class="sub-card-foot">
                    <span>置信 ${subConf}%</span>
                    <span class="arrow">查看深度页 <i class="ph ph-arrow-right"></i></span>
                  </div>
                </a>
              `;
            }).join("")}
          </div>
        </div>
      </div>
    `
    : `
      <div class="evidence-card">
        <div class="evidence-head">
          <span class="evidence-label">证据快照</span>
          <span class="evidence-title">${a.name}正在引用的数据片段（完整版见右侧跳转）</span>
          <span class="spacer"></span>
          <span class="chip ok" style="cursor:default;">◆ 数据来自市场监测</span>
        </div>
        <div class="evidence-body">
          <div class="evidence-thumb">
            <div class="evidence-thumb-head">
              <span>${view.kpis[0]?.label || "关键指标"} · 近 24 点</span>
              <span style="color:${view.stanceColor}">${view.kpis[0]?.value || ""}</span>
            </div>
            <div class="evidence-thumb-value">${view.kpis[1]?.value || ""}</div>
            ${renderSparkline(agentId.charCodeAt(0) * 997 + 13, a.color)}
          </div>
          <div class="evidence-side">
            <div class="evidence-note">
              上图仅为 <strong>${a.name}</strong> 的证据切片，完整可交互工作台（多指标等）在市场监测层：
            </div>
            <div style="display:flex; flex-direction:column; gap:var(--sp-2);">
              ${dataPages.length ? dataPages.map(pid => `
                <a class="jump-btn" href="#/${pid}">
                  <div class="jb-main">
                    <span class="jb-hint">打开完整工作台</span>
                    <span class="jb-label">${DATA_PAGE_LABEL[pid] || pid} <i class="ph ph-arrow-right"></i></span>
                  </div>
                </a>
              `).join("") : `<span style="font-size:var(--fz-xs); color:var(--muted);">本员工暂无对应的数据页（由账户/事件驱动）</span>`}
            </div>
          </div>
        </div>
      </div>
    `;

  return html`
    <header class="page-header">
      <div>
        <h1 class="page-title">${a.name}</h1>
        <div class="page-sub">${a.role}</div>
      </div>
      <span class="chip" style="background:rgba(16,185,129,0.12); color:var(--ok); border-color:rgba(16,185,129,0.3);">● 员工在线</span>
    </header>

    ${renderOpinionLayerBanner(agentId)}

    <div class="agent-workspace">

      <div class="conclusion-card" style="padding: var(--sp-5);">
        <div class="confidence-ring">
          <svg viewBox="0 0 64 64">
            <circle class="ring-bg" cx="32" cy="32" r="26"/>
            <circle class="ring-fg" cx="32" cy="32" r="26"
              stroke-dasharray="163.36" stroke-dashoffset="${163.36 * (1 - view.confidence / 100)}"/>
          </svg>
          <div class="ring-label">${view.confidence}%</div>
        </div>
        <div class="conclusion-label">当前结论 · ${new Date().toLocaleString("zh-CN", {hour12:false, month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit"})}</div>
        <div class="conclusion-tag"><span class="tag-badge" style="background:${view.stanceColor}; box-shadow:0 0 10px ${view.stanceColor};"></span>${view.stance}</div>
        <div class="conclusion-reason">${view.oneliner}</div>
      </div>

      <div class="kpi-grid-6">
        ${view.kpis.map(k => `
          <div class="kpi">
            <span class="kpi-label">${k.label}</span>
            <span class="kpi-value">${k.value}</span>
            <span class="kpi-delta ${k.good ? "up" : ""}">${k.delta || ""}</span>
          </div>
        `).join("")}
      </div>

      ${evidenceBlock}

      <div class="bubble">
        <div class="bubble-head">
          <span class="name">${a.name}</span>
          <span>· 刚刚</span>
        </div>
        <div class="bubble-body">
          ${view.reasoning.map(r => `<p>${r}</p>`).join("")}
        </div>
        <div class="suggestions">
          ${view.suggestions.map(s => `<span class="chip ${s.type}">${s.label}</span>`).join("")}
        </div>
      </div>

      <div class="history-feed">
        <div class="card-title">历史发言 <span style="color:var(--muted-2)">近 20 条</span></div>
        ${view.history.map(([t, s, full]) => `
          <div class="history-item">
            <span class="history-time">${t}</span>
            <span class="history-summary">${s}</span>
            <div class="history-full">${full}</div>
          </div>
        `).join("")}
      </div>

      <div class="ask-box">
        <textarea placeholder="追问${a.name}（回车发送，Shift+回车换行）" id="askInput"></textarea>
        <button class="btn primary" id="askSend">发送</button>
      </div>
    </div>
  `;
}

/* =======================================================
   各占位页的内容清单
   ======================================================= */
const PLACEHOLDERS = {
  premarket: {
    title: "盘前简报",
    sub: "每日开盘前的 Checklist，由五位员工在晨会后自动生成",
    icon: "ph-clock",
    future: [
      { title: "关键价位", desc: "主要支撑 / 阻力 / 流动性池 / 前日高低" },
      { title: "波动率状态", desc: "今日处于 扩张 / 震荡 / 极端 哪一种，及主周期" },
      { title: "衍生品拥挤度", desc: "资金费率、OI 变化、多空比是否有极端信号" },
      { title: "风控预算", desc: "今日总风险上限、单笔上限、当前仓位占用" },
      { title: "宏观日历", desc: "今日待公布的关键数据与讲话" },
      { title: "首席策略指引", desc: "今日唯一交易倾向与执行条件" },
    ],
  },
  archive: {
    title: "发言历史库",
    sub: "所有 Agent 历史发言全文检索 + 按员工/时间筛选",
    icon: "ph-archive",
    future: [
      { title: "全文搜索", desc: "关键词搜索所有发言" },
      { title: "按员工筛选", desc: "只看某位员工的历史观点" },
      { title: "按结论准确性", desc: "对比发言当时与后续市场走势" },
      { title: "导出", desc: "导出为 Markdown 供自己复盘" },
    ],
  },
  templates: {
    title: "策略模板库",
    sub: "SFP · 动量跟踪 · 成交量分布区间 三大典型执行策略",
    icon: "ph-files",
    future: [
      { title: "SFP 假突破", desc: "流动性猎取进场模板 + 入场止损条件" },
      { title: "动量趋势跟踪", desc: "突破后以 ATR 移动止盈" },
      { title: "VP 区间交易", desc: "在价值区上下沿低吸高抛" },
      { title: "自定义模板", desc: "保存你自己的策略配方" },
    ],
  },
  draft: {
    title: "订单草稿台",
    sub: "编排订单参数，一键推送到交易所（本轮只做 UI）",
    icon: "ph-pencil-simple",
    future: [
      { title: "订单编辑", desc: "方向 / 价格 / 数量 / 止损止盈" },
      { title: "模板套用", desc: "从策略模板库一键填充" },
      { title: "预检查", desc: "由风控官做参数审核" },
      { title: "推送到交易所", desc: "（需接入私有 API Key）" },
    ],
  },
  positions: {
    title: "当前持仓",
    sub: "持仓 PnL / 保证金 / 清算价 / 风控评估",
    icon: "ph-briefcase",
    future: [
      { title: "持仓列表", desc: "所有开仓标的与方向" },
      { title: "实时 PnL", desc: "未实现盈亏 / 已实现盈亏" },
      { title: "保证金利用率", desc: "余量 + 警戒线" },
      { title: "强平价", desc: "距离当前价的缓冲" },
    ],
  },
  journal: {
    title: "交易日志",
    sub: "每笔交易打标签：情绪 / 策略 / 结果",
    icon: "ph-book-open",
    future: [
      { title: "交易记录", desc: "时间 / 方向 / 盈亏 / 截图" },
      { title: "标签系统", desc: "情绪 / 策略 / 错误类型" },
      { title: "附图", desc: "进场/出场时的图表截图" },
      { title: "检索", desc: "按标签/盈亏查找历史" },
    ],
  },
  "daily-review": {
    title: "每日复盘",
    sub: "模板化复盘问卷 —— 今日执行是否符合策略？",
    icon: "ph-arrow-counter-clockwise",
    future: [
      { title: "复盘问卷", desc: "5~10 个关键问题" },
      { title: "员工点评", desc: "四位专员回溯发言 vs 行情" },
      { title: "情绪日记", desc: "记录今日情绪偏差" },
      { title: "明日待办", desc: "生成明日 checklist" },
    ],
  },
  perf: {
    title: "绩效统计",
    sub: "胜率 / 盈亏比 / 期望值 / 夏普",
    icon: "ph-trend-up",
    future: [
      { title: "核心指标", desc: "胜率 / 盈亏比 / 期望 / 最大回撤" },
      { title: "权益曲线", desc: "账户净值历史图" },
      { title: "按策略细分", desc: "哪个策略效果好、哪个差" },
      { title: "按时段细分", desc: "一天中/一周内的高低绩效时段" },
    ],
  },
  patterns: {
    title: "错误模式",
    sub: "高频失误自动归类 —— 你最常犯的交易错误是什么",
    icon: "ph-warning",
    future: [
      { title: "追高/追空", desc: "情绪驱动的非计划进场" },
      { title: "过早止盈", desc: "行情未结束就离场" },
      { title: "违背止损", desc: "移动/取消止损" },
      { title: "过度交易", desc: "单日交易次数异常" },
    ],
  },
  "data-vault": {
    title: "数据池",
    sub: "浏览器侧离线缓存占位：历史快照 / API 状态 / 数据回填（PLANNED）",    icon: "ph-database",
    future: [
      { title: "已缓存数据", desc: "品种 × 周期 × 起止时间" },
      { title: "API 状态", desc: "Binance / Deribit / FRED 等上次成功时间" },
      { title: "数据回填", desc: "手动补齐历史数据缺口" },
      { title: "占用空间", desc: "浏览器存储占用概览" },
    ],
  },
  playbook: {
    title: "知识库 · Playbook",
    sub: "个人交易纪律 / 策略手册 / 心智模型",
    icon: "ph-book-bookmark",
    future: [
      { title: "交易纪律", desc: "写给自己的铁律（风险 / 仓位 / 情绪）" },
      { title: "策略卡片", desc: "每个策略的入场 / 出场 / 风控说明" },
      { title: "学习笔记", desc: "读书 / 研报 / 经验积累" },
      { title: "AI 检索", desc: "AI 按场景推荐应用哪条纪律或策略" },
    ],
  },
};

const SETTINGS_FUTURE = [
  { title: "API Keys", desc: "Binance · Deribit · FRED · CoinGlass · OpenAI 等" },
  { title: "Agent 配置", desc: "重命名 / 改头像色 / 启用禁用" },
  { title: "快捷键", desc: "切页 / 调出追问框 / 召集会议" },
  { title: "数据与备份", desc: "导入导出浏览器离线缓存" },
];
