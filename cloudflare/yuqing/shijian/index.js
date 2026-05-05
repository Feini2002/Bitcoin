/**
 * 事件一览 · 对应前端 `#/news` / Worker `daily_event`。
 * 后续将 Prompt、schema 约定、与各步纯函数从 `yuqing-worker.js` 迁入本目录子文件，
 * 并在此文件聚合 `export`，供主 Worker `import`。
 */

/** bundle 占位标识（健康检查可读） */
export const YUQING_SHIJIAN_PAGE = "daily_event";

/** 预留：稍后改为真实模块（勿删——用于避免空模块被_tree-shake 误清理） */
export function shijianModuleShell() {
  return "shijian";
}
