市场监测快照程序 · 现行说明与后续接入计划

本文是“把前面市场监测数据层几个已完成模块，压缩成 LLM / 员工 Agent 可读输入”的现行说明。

旧标题里的“5 个快照模块”来自早期规划。按当前系统状态，主线不是恢复旧的分散页面快照目录，而是维护 `cloudflare/snapshot/` 下已经落地的统一快照程序和独立快照 Worker。

## 1. 当前结论

已经落地：

- 统一快照主程序：`cloudflare/snapshot/marketSnapshotProgram.mjs`。
- 快照 Worker：`cloudflare/snapshot/market-snapshot-worker.mjs`。
- 独立 D1 schema：`cloudflare/snapshot/schema.sql`。
- Wrangler 配置：`cloudflare/snapshot/wrangler.snapshot.toml`。
- 本地验证脚本：`scripts/verify-market-snapshot-program.cjs`、`scripts/verify-market-snapshot-worker.cjs`。
- package 脚本：`npm run verify:market-snapshot`，且已并入 `npm test` / `npm run verify:all`。

仍未完成：

- 还没有真正接 LLM 调用。
- 前端“分析当前页 / 分析市场监测”按钮或会议室员工页尚未统一读取这个快照 Worker。
- 快照 Worker 是否已部署、远程 D1 是否已迁移，不能只从本地仓库判断；需要部署时再单独确认。
- `POST /api/ai/market-desk-snapshot` 只负责生成并写入快照和 Agent 输入，不负责生成最终员工发言。
- 现有 `btc` Worker 仍保留 `/api/ai/derivatives-snapshot`；快照 Worker 也提供同名衍生品快照路由，后续上线时必须明确域名与路由归属，避免前端或诊断脚本打到不同服务。

## 2. 现行作用边界

这套程序只做“数据压缩与输入契约”，不是交易建议引擎。

它负责：

- 从 D1 读取四个市场监测页面的关键数据。
- 生成单页 snapshot：行情、订单流、强平、衍生品。
- 生成总览 snapshot：`market-desk`。
- 生成员工输入：`env`、`flow`、`deriv`、`risk`、`chief`。
- 写入独立 snapshot D1，供后续 LLM、会议室或员工页读取。

它不负责：

- 直接输出买卖方向或仓位。
- 让 LLM 读取原始大数组。
- 替代现有页面的实时渲染逻辑。
- 替代 `cloudflare/binance-klines-worker.js` 里的行情采集、D1 同步和现有 API。

## 3. 目录职责

当前 `cloudflare/snapshot/` 目录保留这些文件：

- `marketSnapshotProgram.mjs`：核心确定性程序；生成四页快照、总快照、员工输入。
- `market-snapshot-worker.mjs`：HTTP 路由、写库、读取最新快照、读取最新员工输入。
- `chartStructureSnapshot.mjs`：行情结构算法支持，供 `marketSnapshotProgram.mjs` 使用。
- `schema.sql`：独立 snapshot D1 表结构。
- `wrangler.snapshot.toml`：独立 market-snapshot Worker 配置。
- 当前说明位于 `docs/architecture/market-snapshot.md`，不属于 Worker 运行文件。

不要恢复早期的四个分散子目录：

- `行情工作台/`
- `订单流与足迹图/`
- `强平雷达/`
- `衍生品面板/`

这些旧目录里的 `页面优化说明.md`、`xxxSnapshotCore.mjs`、`buildXxxAiSnapshot.cjs` 不再作为后续入口。

## 4. 已接入的四个页面

### 行情工作台

- 页面入口：`js/pages/chart.js`。
- 数据来源：`BTC_DB` 中的 K 线与行情相关表。
- 快照函数：`buildChartSnapshot(env, options)`。
- 输出重点：当前价格、多周期摘要、结构算法输入、结构启发式、LLM 可读摘要。
- 重要边界：保留 raw fact 与 derived heuristic 分层，避免 LLM 把窗口极值、结构判断和事实价格混写。

### 订单流与足迹图

- 页面入口：`js/pages/orderflow.js`。
- 数据来源：D1 足迹聚合与 K 线关键位。
- 快照函数：`buildOrderflowSnapshot(env, options)`。
- 输出重点：窗口 POC、VAH / VAL、买卖压力、dashboard 卡片、freshness。
- 重要边界：不得输出原始 `levels_json` 或大规模逐价位数组。

### 强平雷达

- 页面入口：`js/pages/heatmap.js`。
- 数据来源：D1 5m 强平桶、强平状态、压力矩阵相关输入。
- 快照函数：`buildHeatmapSnapshot(env, options)`。
- 输出重点：1h 等窗口强平规模、压力矩阵、真实强平与估算压力的区分。
- 重要边界：必须区分“已发生强平”和“估算压力”，不得暗示精确潜在清算池金额。

### 衍生品面板

- 页面入口：`js/pages/derivatives.js`。
- 数据来源：`derivative_timeseries`、同步状态、来源健康、现有衍生品快照逻辑。
- 快照函数：`buildDerivativesSnapshot(env, options)`。
- 输出重点：衍生品六项矩阵、Funding、OI、Taker、基差、来源健康、同步提示。
- 重要边界：现有 `btc` Worker 也有 `/api/ai/derivatives-snapshot`，后续如果快照 Worker 对外上线，必须避免路由语义冲突。

## 5. 现行输出契约

`marketSnapshotProgram.mjs` 已导出：

- `buildChartSnapshot(env, options)`
- `buildOrderflowSnapshot(env, options)`
- `buildHeatmapSnapshot(env, options)`
- `buildDerivativesSnapshot(env, options)`
- `buildMarketDeskSnapshot(env, options)`
- `buildAgentInputs(deskSnapshot, options)`

`buildMarketDeskSnapshot()` 当前输出重点：

- `scope`：`market-desk`。
- `snapshotVersion`：当前程序版本，如 `market-desk-1.1.0`。
- `pages`：四页快照。
- `agentInputs`：员工输入。
- `dataFreshness`：整体数据新鲜度。
- `notableConflicts`：市场页面之间的冲突。
- `llmBrief`：短中文摘要，供 LLM 快速理解。

员工输入当前包含 5 类：

- `env`：环境评估员，主要看行情工作台，关联衍生品。
- `flow`：盘口流动性官，主要看订单流、强平，关联行情。
- `deriv`：衍生品情报官，主要看衍生品面板。
- `risk`：风控观察，当前聚焦强平雷达。
- `chief`：首席策略官，读取四页总览。

所有员工输入都必须保留 `llmDataContract`，并遵守“只读浓缩事实、状态、证据、冲突、新鲜度，不读原始大数组”的规则。

## 6. 快照 Worker 路由

当前 `market-snapshot-worker.mjs` 已提供：

- `GET /api/ai/health`
- `GET /api/ai/chart-snapshot`
- `GET /api/ai/orderflow-snapshot`
- `GET /api/ai/heatmap-snapshot`
- `GET /api/ai/derivatives-snapshot`
- `GET /api/ai/market-desk-snapshot`
- `POST /api/ai/market-desk-snapshot`
- `GET /api/ai/snapshot/latest?scope=market-desk`
- `GET /api/ai/agent-input/latest?agent=env`
- `GET /api/ai/snapshot-run?runId=...`

读写边界：

- GET 单页或总览快照只生成预览，不写 snapshot D1。
- POST `market-desk-snapshot` 会生成总快照，写入 `snapshot_runs`、`market_snapshots`、`agent_snapshot_inputs`。
- POST 必须带 `X-Bitdesk-Snapshot-Token`，对应 Worker Secret `SNAPSHOT_WRITE_TOKEN`。
- Worker 依赖两个 D1 binding：`BTC_DB` 和 `SNAPSHOT_DB`。

## 7. D1 存储边界

`schema.sql` 当前定义三类表：

- `snapshot_runs`：一次快照运行的索引、状态、页面范围、员工范围。
- `market_snapshots`：单页和 `market-desk` 快照 payload。
- `agent_snapshot_inputs`：给各员工读取的压缩输入。

当前保留策略：

- Worker 会清理 30 天前的旧记录。
- Worker 会把 run 总数控制在最近约 500 条。

后续若要让会议室或员工页长期回看，需要先决定保留期、索引和前端查询方式，不要直接无限写入。

## 8. 当前验证

本地最小验证：

- `npm run verify:market-snapshot`

该命令会覆盖：

- 单页快照函数能生成。
- `market-desk` 能一次生成四页结果。
- 5 类 `agentInputs` 能按页面范围分发。
- 输出不包含 `levels_json`。
- Worker health 能识别两个 D1 binding。
- GET 预览不写库。
- POST 写入 run、5 个 snapshots、5 个 agent inputs。
- latest / run 查询能读回。

涉及市场监测快照时，通常还需要按范围补：

- 通用语法：`npm run lint`。
- 影响全量部署前总闸：`npm run build`。
- 若改行情、衍生品、强平或足迹数据源，按项目规则补对应 `verify:*`。

不要把实时网络成功当作稳定结论。Binance、Bybit、Cloudflare、D1、宏观旁路都可能随时间变化。

## 9. 后续真正未完成计划

### 阶段 1：确认部署与远程 D1

目标：

- 确认 `market-snapshot` Worker 是否需要独立部署。
- 确认 `SNAPSHOT_DB` 是否已远程创建并应用 `schema.sql`。
- 确认 `BTC_DB` binding 是否指向现有行情 D1。
- 设置 `SNAPSHOT_WRITE_TOKEN`。

验证：

- 本地跑 `npm run verify:market-snapshot`。
- 部署后用 `scripts/diagnose-market-snapshot-cloud.cjs` 探测远程 health、GET preview、POST write、latest、run lookup。

边界：

- 默认不部署、不执行远程 D1。
- 只有用户明确要求部署或同步 D1 时才执行。

### 阶段 2：前端读取最新快照

目标：

- 在会议室或员工页接入 `GET /api/ai/agent-input/latest?agent=...`。
- 或在市场监测入口接入 `GET /api/ai/snapshot/latest?scope=market-desk`。
- 页面只展示快照摘要、数据新鲜度、冲突、缺口，不展示原始大 payload。

关联文件：

- `js/agent-views.js`
- `js/pages/boardroom.js`
- `js/data-engine.js`
- `js/config.js`
- `index.html`，若新增前端资源版本需要同步提升 `?v=`
- `styles.css`，若新增 UI

验收：

- 没有快照时显示空状态和生成提示。
- 快照过期时明确显示 stale / missing。
- 不影响现有市场监测页面。

### 阶段 3：接 LLM 生成员工发言

目标：

- Worker 读取 `agent_snapshot_inputs`。
- 按员工角色选择输入。
- 调 LLM 生成结构化发言或晨会摘要。
- 写入新的结果表或现有会议室可读的数据源。

建议新增表前先写迁移计划：

- `agent_briefings`
- `agent_messages`
- `ai_runs`

边界：

- LLM 输入只能使用 `agentInputs` 和 `llmBrief` 这类压缩结构。
- 不允许把原始 K 线、足迹 levels、强平逐笔、完整衍生品序列直接喂给 LLM。
- 员工发言必须带数据新鲜度、缺口、冲突和降级原因。
- 不输出直接交易指令；只输出观察、风险、确认条件和需要人工复核的点。

### 阶段 4：接实时点击和后台定时

实时点击：

1. 用户点击“分析当前页”或“分析市场监测”。
2. 前端请求快照 Worker 生成或读取 snapshot。
3. Worker 选取对应 `agentInputs`。
4. LLM 生成结构化结论。
5. 前端展示结果，并保留快照 runId 方便复盘。

后台定时：

1. Cloudflare Cron 触发快照 Worker。
2. Worker 生成 `market-desk` brief 快照。
3. Worker 按员工生成晨会 / 巡检输入。
4. LLM 结果写入 D1。
5. 前端会议室或员工页读取最新结果。

注意：

- Cloudflare Cron 使用 UTC。若要北京时间晨会，必须在 Worker 中显式转换业务时间，或使用对应 UTC Cron。
- 定时 LLM 成本要单独记录，不能和舆情 Yuqing Worker 的 LLM 成本混在一起。

### 阶段 5：路由归属收束

目标：

- 明确 `btc` Worker 与 `market-snapshot` Worker 的 `/api/ai/derivatives-snapshot` 关系。
- 决定前端和诊断脚本默认读取哪个域名。
- 必要时保留兼容转发，避免历史入口断链。

建议：

- `btc` Worker 保留行情与衍生品原始服务职责。
- `market-snapshot` Worker 作为 LLM 输入聚合服务。
- 前端如果需要“员工输入 / 市场总快照”，优先走 `market-snapshot` Worker。
- 前端如果只需要现有衍生品 brief，继续用 `btc` Worker，直到统一迁移完成。

## 10. 不要做的事

- 不要恢复旧四个页面快照子目录。
- 不要让 LLM 直接读取原始大数组。
- 不要用 snapshot Worker 替代现有市场页面数据流。
- 不要在没有部署指令时执行 Wrangler deploy 或远程 D1 迁移。
- 不要把快照 Worker 的成功当成行情源稳定性的长期证明。
- 不要把 `market-desk` 总结直接变成交易执行建议。

## 11. 修订记录

- 2026-05-12：按当前实现重写为“现行说明 + 剩余接入计划”；确认统一快照程序、快照 Worker、D1 schema 和验证脚本已经落地，后续重点转为部署确认、前端读取、LLM 员工发言和路由归属收束。
- 早期版本：用于规划从四个市场监测页面旧快照核心迁移到统一快照程序。
