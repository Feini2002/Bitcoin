/* =======================================================
   配置 —— AGENTS / NAV / 数据页映射
   ======================================================= */

/* K 线与衍生品等：经 Cloudflare Worker + D1（cloudflare/binance-klines-worker.js）。
 * 舆情日报：独立 Worker（默认 yuqing.feiniwork.com）。
 * 仅需要换到另一条已上线的 Worker HTTPS 域名时：在本脚本先前注入 window.BIT_DATA_API_BASE / BIT_YUQING_API_BASE，避免改默认常量。 */

const BIT_KLINE_DEFAULT_CLOUD = "https://btc.feiniwork.com";
const BIT_YUQING_DEFAULT_CLOUD = "https://yuqing.feiniwork.com";

if (typeof window !== "undefined" && window.BIT_DATA_API_BASE != null && String(window.BIT_DATA_API_BASE) !== "") {
  window._BIT_KLINE_BASE_PRESET = true;
}
if (typeof window !== "undefined" && window.BIT_YUQING_API_BASE != null && String(window.BIT_YUQING_API_BASE) !== "") {
  window._BIT_YUQING_BASE_PRESET = true;
}

/** 当前应请求的 K 线 Worker 根 URL（与已部署 Worker 一致）。 */
function getBitDataApiBase() {
  return BIT_KLINE_DEFAULT_CLOUD;
}

/**
 * @returns {string} 舆情日报 Worker（与 btc 行情 Worker 分离）
 */
function getYuqingApiBase() {
  if (
    typeof window !== "undefined" &&
    window.BIT_YUQING_API_BASE != null &&
    String(window.BIT_YUQING_API_BASE) !== ""
  ) {
    return String(window.BIT_YUQING_API_BASE).replace(/\/$/, "");
  }
  return BIT_YUQING_DEFAULT_CLOUD;
}

if (typeof window !== "undefined") {
  window.getBitDataApiBase = getBitDataApiBase;
  window.getYuqingApiBase = getYuqingApiBase;
  if (window.BIT_DATA_API_BASE == null) {
    window.BIT_DATA_API_BASE = getBitDataApiBase();
  }
  if (window.BIT_YUQING_API_BASE == null) {
    window.BIT_YUQING_API_BASE = getYuqingApiBase();
  }
}

const AGENTS = [
  { id: "chief", name: "首席策略官", short: "策", color: "var(--agent-chief)",
    role: "交叉验证四位专员结论，给出今日唯一指引",
    kpis: ["综合结论", "置信度", "今日主策略", "反对票数", "二层共识", "风险预算"],
    status: "online" },
  { id: "env", name: "环境评估员", short: "环", color: "var(--agent-env)",
    role: "多周期K线 / ATR / 布林带 / DVOL / VIX · MOVE",
    kpis: ["ATR", "ATR%位", "BB宽度", "DVOL", "期限结构", "主周期"],
    status: "online" },
  { id: "flow", name: "盘口流动性官", short: "盘", color: "var(--agent-flow)",
    role: "足迹图 / 成交量分布(POC·VAH·VAL) / Imbalance / SFP / 强平雷达",
    kpis: ["POC", "VAH", "VAL", "最近SFP", "Imbalance", "清算池"],
    status: "online" },
  { id: "deriv", name: "衍生品情报官", short: "衍", color: "var(--agent-deriv)",
    role: "资金费率 / OI / 主动买卖量 / 基差 / Top Trader",
    kpis: ["BTC Funding", "OI变化", "主动买卖量", "基差年化", "Top Trader", "多空比"],
    status: "online" },
  { id: "risk", name: "风控官", short: "控", color: "var(--agent-risk)",
    role: "账户余额 / 持仓 / 单笔风险 / 回撤 / 黑天鹅预警",
    kpis: ["账户余额", "当前风险", "本日PnL", "最大回撤", "可开仓", "风控评分"],
    status: "online" },
];
const AGENT_MAP = Object.fromEntries(AGENTS.map(a => [a.id, a]));

/* 员工 <-> 市场监测数据页 的双向映射 */
const AGENT_DATA = {
  chief: { primary: [],                    related: ["boardroom"] },
  env:   { primary: ["chart"],             related: ["derivatives"] },
  flow:  { primary: ["orderflow","heatmap"], related: ["chart"] },
  deriv: { primary: ["derivatives"],       related: [] },
  risk:  { primary: ["positions"],         related: [] },
};
const DATA_OWNER = {
  chart:       { primary: "env",   related: ["flow"] },
  orderflow:   { primary: "flow",  related: [] },
  heatmap:     { primary: "flow",  related: ["risk"] },
  derivatives: { primary: "deriv", related: ["env"] },
};
const DATA_PAGE_LABEL = {
  chart: "行情工作台",
  orderflow: "订单流与足迹图",
  heatmap: "强平雷达",
  derivatives: "衍生品面板",
  positions: "当前持仓",
  boardroom: "会议室",
};

const NAV = [
  { group: "核心", items: [
    { id: "overview", label: "概览 Dashboard", icon: "ph-squares-four" },
    { id: "premarket", label: "盘前简报", icon: "ph-clock" },
  ]},
  { group: "市场监测", sub: "数据层 · 无 LLM", items: [
    { id: "chart", label: "行情工作台", icon: "ph-chart-line-up" },
    { id: "orderflow", label: "订单流与足迹图", icon: "ph-list-numbers" },
    { id: "heatmap", label: "强平雷达", icon: "ph-crosshair" },
    { id: "derivatives", label: "衍生品面板", icon: "ph-wave-sine" },
  ]},
  { group: "舆情与事件", items: [
    { id: "news", label: "事件一览", icon: "ph-newspaper-clipping" },
    { id: "news-analysis", label: "舆情分析", icon: "ph-chart-donut" },
  ]},
  { group: "智囊团", sub: "分析层 · 员工观点", items: [
    { id: "boardroom", label: "会议室", icon: "ph-users-three", badge: "默认" },
    { id: "agent-chief", label: "首席策略官", agentId: "chief" },
    { id: "agent-env", label: "环境评估员", agentId: "env" },
    { id: "agent-flow", label: "盘口流动性官", agentId: "flow" },
    { id: "agent-deriv", label: "衍生品情报官", agentId: "deriv" },
    { id: "agent-risk", label: "风控官", agentId: "risk" },
    { id: "archive", label: "发言历史库", icon: "ph-archive" },
  ]},
  { group: "交易执行", items: [
    { id: "calc", label: "仓位与风险计算器", icon: "ph-calculator" },
    { id: "templates", label: "策略模板库", icon: "ph-files" },
    { id: "draft", label: "订单草稿台", icon: "ph-pencil-simple" },
    { id: "positions", label: "当前持仓", icon: "ph-briefcase" },
  ]},
  { group: "复盘系统", items: [
    { id: "journal", label: "交易日志", icon: "ph-book-open" },
    { id: "daily-review", label: "每日复盘", icon: "ph-arrow-counter-clockwise" },
    { id: "perf", label: "绩效统计", icon: "ph-trend-up" },
    { id: "patterns", label: "错误模式", icon: "ph-warning" },
  ]},
  { group: "系统", items: [
    { id: "data-vault", label: "数据池", icon: "ph-database" },
    { id: "playbook", label: "知识库 Playbook", icon: "ph-book-bookmark" },
    { id: "settings", label: "设置", icon: "ph-gear" },
  ]},
];

const agentRoute = (id) => `agent-${id}`;
