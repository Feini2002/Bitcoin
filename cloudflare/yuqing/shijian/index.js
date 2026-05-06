/**
 * 事件一览 · 对应前端 `#/news` / Worker `daily_event`。
 * 本目录按页面内容块拆分 prompt 与 schema，主 Worker 只负责路由、D1 与调度。
 */

export { buildDailyTemperature, buildDailyTemperaturePrompt } from "./temperature.js";
export {
  buildDailyTopStoriesPrompt,
  buildDailyTopStoriesWirePrompt,
  dailyThemeFromStoriesAndBriefs,
  mergeTopStoryCandidatesForDaily,
  normalizeDailyTopStoryItems,
  renderDailyTopStoriesMarkdown,
} from "./top-stories.js";
export { buildDailyBriefsPrompt, normalizeDailyBriefItems, renderDailyBriefsMarkdown } from "./dynamic-briefs.js";
export { buildDailyAiIntelPrompt, normalizeDailyAiIntelItems, renderDailyAiIntelMarkdownForTrends } from "./ai-intel.js";
export { buildDailyTrendCluesPrompt, buildTrendReadFromDailyEventInputs } from "./trend-clues.js";

/** bundle 标识（健康检查可读） */
export const YUQING_SHIJIAN_PAGE = "daily_event";

export function shijianModuleShell() {
  return "shijian:stream+parallel-headlines";
}
