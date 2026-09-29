/* 功能成熟度来自实现盘点，不表示远程服务在线。 */
const FEATURE_STATES = {
  connected: { label: "已接入", note: "已接入表示该页已实现数据或报告读取。当前状态以页内的数据来源、更新时间和错误提示为准，不代表服务在线或可交易。" },
  local: { label: "本地功能", note: "在浏览器中运行。" },
  demo: { label: "演示", note: "以下保留原型示例。价格、账户、结论、置信度和图形均为演示内容；尚未接入该功能的实际计算或分析，提交控件不可用。" },
  planned: { label: "PLANNED", note: "仅有规划与预留结构，尚未实现。" },
};
const FEATURE_STATE_BY_ROUTE = {
  overview: "local", settings: "connected",
  chart: "connected", orderflow: "connected", heatmap: "connected", derivatives: "connected",
  news: "connected", "news-analysis": "connected",
  boardroom: "demo", calc: "demo", "agent-chief": "demo", "agent-env": "demo",
  "agent-flow": "demo", "agent-deriv": "demo", "agent-risk": "demo",
  premarket: "planned", archive: "planned", templates: "planned", draft: "planned", positions: "planned",
  journal: "planned", "daily-review": "planned", perf: "planned", patterns: "planned",
  "data-vault": "planned", playbook: "planned",
};
const FEATURES = NAV.flatMap(group => group.items.map(item => ({
  ...item, group: group.group, state: FEATURE_STATE_BY_ROUTE[item.id],
})));
function featureInfo(id) {
  return FEATURE_STATES[FEATURE_STATE_BY_ROUTE[id]];
}
function renderFeatureNotice(id) {
  const info = featureInfo(id);
  if (!info || id === "chart" || FEATURE_STATE_BY_ROUTE[id] === "local") return "";
  if (FEATURE_STATE_BY_ROUTE[id] === "connected") return '<details class="feature-notice feature-notice--compact" data-testid="feature-notice"><summary>数据与使用说明</summary><div class="feature-notice-body"><span>' + info.note + '</span><a href="#/overview">研究总览</a></div></details>';
  return '<aside class="feature-notice" data-testid="feature-notice"><strong>' + info.label + '</strong><span>' + info.note + '</span><a href="#/overview">功能清单</a></aside>';
}
function renderDemoPreview(content) {
  return '<details class="demo-preview" data-testid="demo-preview"><summary>展开演示原型（非实时数据）</summary><div class="demo-preview-content">' + content + '</div></details>';
}
function disableDemoControls(root) {
  root.querySelectorAll('.demo-preview input, .demo-preview textarea, .demo-preview button, .demo-preview select').forEach(control => {
    control.disabled = true;
    control.title = "演示控件，尚未实现";
  });
  root.querySelectorAll('.demo-preview .tf-tab, .demo-preview .indicator-chips .chip').forEach(control => {
    control.setAttribute('aria-disabled', 'true');
    control.title = "演示控件，尚未实现";
  });
}
