# 研究主题与现有仓库对应表

[返回总纲](README.md) · [按问题查原文](READING_ROUTES.md)

具体症状先用[功能定位入口](QUICK_ROUTER.md)或 `node scripts/research-context.cjs "问题"`；本页保留跨模块总览。K线专项表与CodeGraph使用边界见功能定位入口。

定位日期：2026-09-21。本轮只核对现有文件、路由注册、功能标签与相关入口；下表列出未来修改时要追踪的关联链路，不是完整功能审计或上线证明。旧调查中的行号可能过期，优先按文件职责定位。

## 页面入口与状态

页面路由来自 [js/app.js](../../../js/app.js)，成熟度来自 [js/features.js](../../../js/features.js)。本次没有修改这两个文件。

| 页面/路由 | 当前实现入口 | 源码标签 |
| --- | --- | --- |
| 事件一览 `news` | [js/pages/events.js](../../../js/pages/events.js) | connected |
| 舆情分析 `news-analysis` | [js/pages/news.js](../../../js/pages/news.js) | connected |
| 行情 `chart` | [js/pages/chart.js](../../../js/pages/chart.js) | connected |
| 足迹 `orderflow` | [js/pages/orderflow.js](../../../js/pages/orderflow.js) | connected |
| 强平 `heatmap` | [js/pages/heatmap.js](../../../js/pages/heatmap.js) | connected |
| 衍生品 `derivatives` | [js/pages/derivatives.js](../../../js/pages/derivatives.js) | connected |
| 设置 `settings` | [js/pages/settings.js](../../../js/pages/settings.js) | connected |
| 概览 `overview` | [js/pages/overview.js](../../../js/pages/overview.js) | local |
| 会议室、五个员工、计算器 | [会议室](../../../js/pages/boardroom.js)、[员工视图](../../../js/agent-views.js)、[环境员工](../../../js/pages/env-agent.js)、[计算器](../../../js/pages/calc.js) | demo |
| 盘前、员工历史、策略模板、订单草稿、持仓、复盘、数据池、知识库等11个入口 | [占位定义](../../../js/placeholders.js)与路由注册 | planned |

`connected` 只说明有接入代码。事件一览和舆情分析的路由名与文件名容易混淆，查日报用 events.js，查二次分析用 news.js。研究方案中的新能力不会改变这些当前标签。

## 关联链路

<a id="analysis"></a>

### 舆情分析、分数与简报

- 入口：[news.js](../../../js/pages/news.js) → [共享请求层](../../../js/data-engine.js) → [舆情Worker](../../../cloudflare/yuqing/yuqing-worker.js) → [分析模块](../../../cloudflare/yuqing/fenxi/index.js)、[分析逻辑](../../../cloudflare/yuqing/fenxi/sentiment-logic.js)。
- 关联：事件日报、市场上下文、事实池、报告存储与历史、导出/模型消费者。若处理FNG缺失，还要查[信息温度](../../../cloudflare/yuqing/shijian/temperature.js)。本轮局部阅读确认其缺失回退及固定分数代码仍在，尚未修正。
- 对应资料：卷05、卷07；F-01/F-03；已有离线入口 `npm run verify:yuqing`，页面改动再选相关UI验收。

<a id="events"></a>

### 事件日报与信息降噪

- 入口：[events.js](../../../js/pages/events.js) → 共享请求层 → 舆情Worker → [日报模块索引](../../../cloudflare/yuqing/shijian/index.js)。
- 关联：[头条](../../../cloudflare/yuqing/shijian/top-stories.js)、[动态速览](../../../cloudflare/yuqing/shijian/dynamic-briefs.js)、[趋势线索](../../../cloudflare/yuqing/shijian/trend-clues.js)、[AI情报](../../../cloudflare/yuqing/shijian/ai-intel.js)、[工具雷达](../../../cloudflare/yuqing/shijian/github-tools.js)、二次分析对日报的消费、历史和设置。
- 对应资料：卷03/07、采集手册；修改栏目时一并核对它是否进入模型上下文与历史读取。已有离线入口 `npm run verify:yuqing`。

<a id="collection"></a>

### 事实池、来源与内容版本

- 现有定位：[yuqing-facts.js](../../../cloudflare/yuqing/yuqing-facts.js)、舆情Worker、[现有迁移](../../../cloudflare/migrations/yuqing/)、共享请求层与日报/分析页面。
- 关联：抓取结果、事件时间、来源引用、失败状态、报告使用的材料、检索与保留。来源试点要先看现有事实池是否已提供同等能力。
- 对应资料：06_collection_design、RES02～05/19/25、F-04～F-06；拟议采集Schema仍在资料包中，没有建立第二事实池或新增采集器。

<a id="market"></a>

### 行情、足迹、强平、衍生品与快照

- 页面与计算：[chart.js](../../../js/pages/chart.js)、[chart/](../../../js/chart/)、[orderflow/](../../../js/orderflow/)、[heatmap/](../../../js/heatmap/)、[derivatives.js](../../../js/pages/derivatives.js) → [共享请求层](../../../js/data-engine.js)。
- 后端：[行情Worker](../../../cloudflare/binance-klines-worker.js)、[K线 live collector](../../../cloudflare/kline-live-collector.mjs)、[行情schema](../../../cloudflare/schema.sql)；独立快照在 [cloudflare/snapshot/](../../../cloudflare/snapshot/)，其[快照程序](../../../cloudflare/snapshot/marketSnapshotProgram.mjs)与[结构计算](../../../cloudflare/snapshot/chartStructureSnapshot.mjs)需一起定位。刷新频率见 [LOCAL-CADENCE](../data-refresh-cadence-2026-09-21.md)。币安出口**运行现状**见 [LOCAL-EGRESSCUTOVER](../binance-egress-vps-cutover-2026-09-21.md)；接线约束见 [LOCAL-EGRESSADV](../binance-egress-plan-adversarial-2026-09-21.md)；SSH 路标见 [LOCAL-EGRESSVPS](../binance-egress-vps-local-2026-09-21.md)。直连仍 403 的归因见 [LOCAL-EGRESSFIX](../binance-egress-workable-fixes-2026-09-21.md)。
- 关联：来源/周期/时间、前端缓存和计算、Worker聚合、D1、快照导出、员工及舆情输入。独立快照程序与行情Worker的摘要路径不能仅凭名称视为同一条链路。
- 对应资料：卷04/10、RES06～09、F-02；已有验证 `npm test`、`npm run verify:footprint`、`npm run verify:derivatives`、`npm run verify:market-snapshot`，按影响面选取。

<a id="evidence"></a>

### 输入、报告存储与历史恢复

- 定位：舆情Worker、[舆情迁移目录](../../../cloudflare/migrations/yuqing/)、[快照Worker](../../../cloudflare/snapshot/market-snapshot-worker.mjs)、[快照schema](../../../cloudflare/snapshot/schema.sql)、事件/分析页的reportId读取。
- 关联：生成时实际输入、流式预览与最终结果、历史链接、旧格式读取、来源引用、保留和导出。人工报告导入入口为 [import-yuqing-report.cjs](../../../scripts/import-yuqing-report.cjs)，本轮未调用。
- 对应资料：卷10/12、终审契约迁移、F-02/F-03/F-06。包内 `research_schema.proposed.sql` 是参考草案，不是本仓库迁移记录。

<a id="llm"></a>

### 云端模型、提示词与设置

- 定位：[settings.js](../../../js/pages/settings.js)、共享请求层、舆情Worker、shijian/fenxi模块及其提示词、[现有云端专用回归](../../../scripts/verify-yuqing-cloud-only.cjs)。
- 关联：模型设置、实际上下文、来源、流式反馈、失败与重试、费用记录、D1结果及历史展示。当前网站分析使用云端Worker；资料包的Codex提示词不会恢复已退役的本机CLI通道。
- 对应资料：卷07、RES16/17、F-07；真实模型效果与费用需在未来相应任务中实测，不由合成样例证明。

<a id="workspace"></a>

### 工作区、共享状态、观点与预警

- 定位：[app.js](../../../js/app.js)、[nav.js](../../../js/nav.js)、[config.js](../../../js/config.js)、[features.js](../../../js/features.js)、图表与订单流页面状态、事件/分析历史链接。
- 关联：路由与卸载、跨页面品种/窗口、图表视口、报告证据、旧链接、占位模块。员工演示、复盘和知识库占位不能算作完整研究工作区已实现。
- 对应资料：卷08、RES14/18、F-03；未来UI修改复用 `npm run verify:ui`，并按真实流程补受影响验收，不改变其他PLANNED状态。

<a id="extensions"></a>

### 宏观、ETF、期权与链上等条件扩展

- 先查：行情Worker、衍生品页、事实池、快照与舆情上下文；[仓库事实报告](repository-baseline/bitcoin_research_repository_response_2026-09-16.md)记录了当时未确认的采集链路。
- 状态边界：本轮没有完成这些专题的实现盘点；旧文案、schema占位或角色描述不能证明当前已有数据采集。后续决定某一项时再确认数据来源、历史可得性及实际使用场景。
- 对应资料：卷06、RES10～12；这些扩展不是每份市场简报的共同前置。

<a id="runtime"></a>

### 运行、存储与发布

- 定位：[行情配置](../../../cloudflare/wrangler.toml)、[舆情配置](../../../cloudflare/wrangler.yuqing.toml)、[独立快照配置](../../../cloudflare/snapshot/wrangler.snapshot.toml)、[出口 Caddy](../../../cloudflare/egress/Caddyfile)、[Pages资产清单](../../../config/pages-assets.json)、[构建器](../../../scripts/build-pages.cjs)。
- 关联：调度生命周期、存储和保留、迁移兼容、前端资源版本、部署面、回退；币安出站现经东京反代，运行现状以 [接线现状](../binance-egress-vps-cutover-2026-09-21.md) 为准。
- 对应资料：卷09/10/12、RES20/21；现有说明见[仓库布局](../../architecture/repository-layout.md)、[脚本索引](../../../scripts/README.md)。

<a id="validation"></a>

## 验证入口与证据边界

下表是后续开发的现有命令导航，**不是本轮已执行的测试清单**。准确命令以 [package.json](../../../package.json) 为准。

| 影响范围 | 已有入口 |
| --- | --- |
| 通用JS语法 | `npm run lint` |
| 指标、快照、足迹、回补和恢复 | `npm test`；也可按模块选择对应verify脚本 |
| 舆情报告与云端模型流程 | `npm run verify:yuqing` |
| 功能标签、导航治理 | `npm run verify:governance` |
| Chromium页面行为与布局 | `npm run verify:ui` |
| 静态壳与发布资产 | `npm run verify:shell`、`npm run verify:pages` |
| 全量离线验证与发布产物 | `npm run build` |
| 线上行情接口 | `npm run verify:api`，涉及真实网络，不能当离线测试 |

包内参考SQL、Schema、Python脚本和合成fixtures均原地保留。其作者记录的检查结果与本仓库实际验证分别使用；本轮仅做资料归档核对、文档链接检查及仓库语法检查，未运行包内脚本、浏览器回归或完整构建。
