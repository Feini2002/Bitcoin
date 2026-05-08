/**
 * 舆情分析 · 对应前端 `#/news-analysis` / Worker `sentiment_analysis`。
 * 后续将与二次研判相关的 prompt / 递进逻辑迁入本目录子文件，
 * 并在此聚合导出供主 Worker 引用。
 */

export const YUQING_FENXI_PAGE = "sentiment_analysis";

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
