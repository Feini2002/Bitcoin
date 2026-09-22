# 云端库治理与空桌装配（2026-09-21）

查询日期：2026-09-21（北京时间）。对象：Cloudflare `btc` / `yuqing` / `bitdesk_snapshots` 三库，以及四个市场页装配。本文是本轮实施依据，不是采购或删除远程数据的指令。

**出口状态**：下文「18 项币安规范集停在 local-bootstrap」「frontendConnected=false / 主带仍缺」是**当日上午**装配快照。傍晚东京 A1 后 desk `pricePathAvailable` 已真，目录代码后来也把 `frontendConnected` 打开。连通读 [接线现状](binance-egress-vps-cutover-2026-09-21.md)；混源禁则仍以本文为准。

## 问题

如何在不冒充币安权威的前提下，治理三套叠写的 D1，并把已有官方观察装配到前端？四路对抗审查（宏观利率、永续微观结构、买方数据平台、交易台展示）要求：做完后是研究缓存，不是可交易权威带。

## 适用版本与核验

- 规范目录 `2026-09-16.1`，通道目录 `2026-09-16.3`。
- 线上 `GET /api/finance/datasets`：`automaticCollection=false`、`frontendConnected=false`；13 项宏观/广度/稳定币/费用为当日云端成功；18 项币安规范集停在 09-16 `local-bootstrap`。
- 对照：[工作台方案](workbench-binance-data-plan-2026-09-16.md)、[限额停采](finance-daily-quota-skip-2026-09-21.md)、卷 04/06/08。

## 核验事实

- 物理三库：`btc`（`de758bb8-...`）、`yuqing`（`e89cfebb-...`）、`bitdesk_snapshots`（`ab01fdd7-...`）。
- `klines` 主键无 venue；`KLINE_ALTERNATE_FAILOVER` 原默认开启；`funding_binance`/`oi_binance` 可写入 Bybit。
- `binance-perp-top-positions` 打官方持仓比接口，却映射 `longAccount`。
- 浏览器行情 WS 在 `OPEN` 即标「实时」；压力矩阵用 `%/8h` 与跨所强平打分。
- FRED 每次全窗插入会形成无界修订日志；规范读法已分 `collectionStale`/`sourceStale`，装配层原先未举起。

## 推断与本轮处理

- 分析路径关闭 K 线 Bybit/OKX failover 默认；停止 Bybit 写入 `funding_binance`/`oi_binance`。
- P1 对 FRED/SOFR/稳定币/广度/费用单写单读；FRED/SOFR 仅在数值或 vintage 变化时插入新收据。
- `/api/desk/{chart|orderflow|heatmap|context}` 为页面与快照唯一分析出口；失败禁止回落 `/api/d1`。
- 主图只认合格币安 P1；过期 bootstrap 与缺失同等处置。浏览器无业务帧不得标实时、不得改价。
- 默认不渲染压力矩阵与拥挤/占优芯片。强平分所。宏观分频，禁止 DXY 与流动性残差。
- `frontendConnected` 本轮保持 false：快照 Worker 为独立部署，且币安主带仍缺。
- 远程 D1 不加列、不 DROP。足迹表无 venue，装配层写明隐式币安采集并在失败时视为缺失。

## 对抗审查加固（同日）

空桌首轮上线后仍会被专业用户误读的活路径：

- 遗留 `/api/d1/analysis-snapshot` 仍读 P5 klines；快照 Worker 合约页仍把 P5 资金费率写成 crowded；强平 llmBrief 跨所合计。
- 舆情仍拉 `/api/ai/derivatives-snapshot`，并把 HTTP 200 当成可交易快照；无 byExchange 时把强平加总。
- 足迹页控件可点、芯片可绿、localStorage 可先画；主图证据在停机前默认 BINANCE 产品 ID。
- 热力页健康文案写「实时流兜底」，时间窗卡片看起来像跨所合计雷达。

加固：分析遗留接口改成 omitted stub；快照分所、禁读 P5 合约组；舆情只吃 desk 且 `marketSnapshotOk` 要求价格路径；足迹未确认全屏停机且不连 WS；热力时间窗按所拆开。

## 限制

- 无 ALFRED / 发布日历时宏观只允许最新修订水平，不允许发布日反应。
- 本轮治理当时不修币安 CF 出口、不买代理、不恢复限额源日采。同日傍晚已另授权东京出口接线，见 [接线现状](binance-egress-vps-cutover-2026-09-21.md)。
- 已存舆情报告不重跑。

## 关联代码与验证

- 装配：`cloudflare/finance/desk.mjs`，Worker `GET /api/desk/*`
- 写入：`cloudflare/finance/dataset-store.mjs`、`datasets.mjs`、`cloudflare/binance-klines-worker.js`
- 页面：`js/pages/chart.js`、`orderflow.js`、`heatmap.js`、`derivatives.js`、`js/features.js`、`js/config.js`
- 验证：`node scripts/verify-desk-assembly.cjs`、`npm run verify:finance`、`npm run lint`、`npm run build`
