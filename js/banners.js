/* =======================================================
   层间横幅：数据层 / 分析层
   ======================================================= */
function renderDataLayerBanner(dataKey) {
  const owner = DATA_OWNER[dataKey];
  if (!owner) return "";
  const primary = owner.primary ? AGENT_MAP[owner.primary] : null;
  const related = (owner.related || []).map(id => AGENT_MAP[id]).filter(Boolean);
  const ownerChips = [primary, ...related].filter(Boolean).map(a => `
    <a class="owner-link" href="#/${agentRoute(a.id)}" title="查看 ${a.name} 的演示原型">
      <span class="owner-dot" style="background:${a.color}">${a.short}</span>
      <span>${a.name}</span>
      <span class="owner-arrow"><i class="ph ph-arrow-right"></i></span>
    </a>
  `).join("");
  return html`
    <div class="layer-banner">
      <div class="layer-banner-icon"><i class="ph ph-database"></i></div>
      <div class="layer-banner-body">
        <div class="layer-banner-title">
          数据层 · 原始数据终端
          <span class="tag">无 LLM</span>
        </div>
        <div class="layer-banner-sub">
          本页展示市场数据与派生指标，时效以实际响应为准。关联员工页面目前为演示原型：
        </div>
      </div>
      <div class="layer-banner-owners">${ownerChips || '<span style="font-size:var(--fz-xs); color:var(--muted);">暂无对应员工</span>'}</div>
    </div>
  `;
}

/** 舆情与事件页首屏紧凑状态条：展示文本日报与市场监测的上下文跳转。 */
function renderSentimentScaffoldStrip() {
  const crossLinks = [
    { href: "#/news", label: "事件一览" },
    { href: "#/chart", label: "行情工作台" },
    { href: "#/derivatives", label: "衍生品面板" },
    { href: "#/heatmap", label: "强平雷达" },
  ]
    .map(
      (x) => `
    <a class="owner-link chart-agent-link" href="${x.href}" title="在市场监测中打开原始数据">
      <span class="owner-dot" style="background:var(--surface-3); color:var(--muted);"><i class="ph ph-chart-line-up" style="margin-top:4px;"></i></span>
      <span>${x.label}</span>
      <span class="owner-arrow"><i class="ph ph-arrow-right"></i></span>
    </a>
  `
    )
    .join("");
  return html`
    <section class="sentiment-data-strip" aria-label="舆情层脚手架状态">
      <div class="chart-data-main">
        <span class="sentiment-feed-dot sentiment-feed-dot--mock" aria-hidden="true" title="D1 报告 + 市场上下文"></span>
        <div>
          <strong>舆情层 · 事件日报 + 市场上下文</strong>
          <span>D1 报告 · 东八区展示 · 增量搜索按需触发</span>
        </div>
      </div>
      <div class="chart-data-meta sentiment-strip-actions">
        ${crossLinks}
      </div>
    </section>
  `;
}

function renderOpinionLayerBanner(agentId) {
  const agent = AGENT_MAP[agentId];
  const data = AGENT_DATA[agentId] || { primary: [], related: [] };
  const jumpLinks = (data.primary || []).map(pid => `
    <a class="owner-link" href="#/${pid}" title="在市场监测中查看原始数据">
      <span class="owner-dot" style="background:var(--ok); color:#0b1220;"><i class="ph ph-chart-bar" style="margin-top:4px;"></i></span>
      <span>${DATA_PAGE_LABEL[pid] || pid}</span>
      <span class="owner-arrow"><i class="ph ph-arrow-right"></i></span>
    </a>
  `).join("");
  return html`
    <div class="layer-banner opinion">
      <div class="layer-banner-icon">${agent.short}</div>
      <div class="layer-banner-body">
        <div class="layer-banner-title">
          分析层 · ${agent.name}的观点工作台
          <span class="tag">LLM 分析 · 演示未接入</span>
        </div>
        <div class="layer-banner-sub">
          本页保留静态结论与图形示例，不代表实际模型输出。对应数据入口：
        </div>
      </div>
      <div class="layer-banner-owners">${jumpLinks || '<span style="font-size:var(--fz-xs); color:var(--muted);">综合四位专员</span>'}</div>
    </div>
  `;
}
