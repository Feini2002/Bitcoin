/**
 * 舆情分析 · 对应前端 `#/news-analysis` / Worker `sentiment_analysis`。
 * 后续将与二次研判相关的 prompt / 递进逻辑迁入本目录子文件，
 * 并在此聚合导出供主 Worker 引用。
 */

export const YUQING_FENXI_PAGE = "sentiment_analysis";
export const YUQING_FENXI_SETTING_KEY = "sentiment_analysis_dashboard";

export const YUQING_FENXI_MODULES = [
  { key: "riskRegime", label: "资金风险温度", workerField: "riskRegime", core: true, planned: false },
  { key: "hardDataMatrix", label: "硬数据校验矩阵", workerField: "hardDataMatrix", core: true, planned: false },
  { key: "narrativeValidation", label: "叙事定价验证", workerField: "narrativeValidation", core: false, planned: false },
  { key: "catalystCalendar", label: "精准催化剂时间轴", workerField: "catalystCalendar", core: false, planned: true },
  { key: "riskThresholds", label: "风险传导阈值", workerField: "riskThresholds", core: false, planned: false },
  { key: "agentContext", label: "Agent 结构化输出", workerField: "agentContext", core: false, planned: false },
  { key: "distortionAudit", label: "抗失真审计", workerField: "distortionAudit", core: false, planned: false },
  { key: "techPremium", label: "科技叙事溢价复核", workerField: "techPremium", core: false, planned: true },
];

export const YUQING_FENXI_SEARCH_SCOPES = [
  { key: "factFill", label: "事实补齐搜索", planned: false },
  { key: "narrativePricing", label: "叙事定价验证搜索", planned: true },
  { key: "aiTech", label: "AI / 科技线索搜索", planned: false },
  { key: "macroEvents", label: "宏观事件搜索", planned: true },
];

function boolMap(keys, source, fallback = true) {
  const src = source && typeof source === "object" ? source : {};
  const out = {};
  for (const key of keys) out[key] = Object.prototype.hasOwnProperty.call(src, key) ? !!src[key] : !!fallback;
  return out;
}

export function defaultFenxiDashboardSettings() {
  const modules = YUQING_FENXI_MODULES.map((m) => m.key);
  const scopes = YUQING_FENXI_SEARCH_SCOPES.map((m) => m.key);
  return {
    version: 1,
    visibility: boolMap(modules, null, true),
    analysisCoverage: boolMap(modules, null, true),
    searchCoverage: boolMap(scopes, null, true),
    updatedAt: null,
  };
}

export function normalizeFenxiDashboardSettings(settings) {
  const defaults = defaultFenxiDashboardSettings();
  const src = settings && typeof settings === "object" ? settings : {};
  return {
    version: 1,
    visibility: boolMap(Object.keys(defaults.visibility), src.visibility, true),
    analysisCoverage: boolMap(Object.keys(defaults.analysisCoverage), src.analysisCoverage || src.scanCoverage, true),
    searchCoverage: boolMap(Object.keys(defaults.searchCoverage), src.searchCoverage, true),
    updatedAt: src.updatedAt || src.updated_at || null,
  };
}

export function fenxiSettingsSnapshot(settings) {
  const normalized = normalizeFenxiDashboardSettings(settings);
  return {
    version: normalized.version,
    visibility: { ...normalized.visibility },
    analysisCoverage: { ...normalized.analysisCoverage },
    searchCoverage: { ...normalized.searchCoverage },
    moduleKeys: YUQING_FENXI_MODULES.map((m) => m.key),
    searchScopeKeys: YUQING_FENXI_SEARCH_SCOPES.map((m) => m.key),
    updatedAt: normalized.updatedAt || null,
  };
}

export {
  calendarFromFacts,
  marketStateFromLegacy,
  opportunitiesFromInputs,
  riskRadarFromInputs,
  trendReadForSentiment,
} from "./sentiment-logic.js";

export function fenxiModuleShell() {
  return "fenxi";
}
