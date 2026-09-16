# Bit 交易决策平台（数据监测分模块）

面向个人期货交易台的 **静态 Web 控制台 + Cloudflare Workers + D1**。系统把行情、订单流、强平热力、衍生品、舆情日报和员工 Agent 的结构化输入收拢到同一套导航里，目标是把“看盘、研判、复盘、自动化报告”放进一个可验证、可部署、可回档的工作区。

## 治理状态

功能清单见前端概览和 [治理记录](docs/governance.md)。已接入只表示代码链路存在，不代表远程服务持续在线。2026-06-15 的暂停记录属于历史状态；当前本地 Wrangler 配置声明启用，2026-09-16 行情状态接口探测返回 HTTP 200。Cron、域名和入口的当前状态仍须操作前实时核对；普通治理不会主动改变启停状态或执行远程 D1 迁移。

`npm run build` 执行离线回归和静态壳检查；`npm run verify:api` 单独验证线上行情服务，停机或网络失败应如实记录。`npm run verify:ui` 执行固定数据的 Chromium 桌面与移动验收。

## 线上入口

| 入口 | 用途 |
| --- | --- |
| <https://bitcoin.feiniwork.com/> | Cloudflare Pages 自定义域名前端 |
| <https://btc.feiniwork.com> | 行情 / D1 / 快照 Worker 默认 API 根域 |
| <https://yuqing.feiniwork.com> | 舆情日报、舆情分析与云端模型设置 Worker |

前端也支持通过 `window.BIT_DATA_API_BASE`、`window.BIT_YUQING_API_BASE` 覆盖默认 API 根域，便于本地或备用环境联调。

## 一图看懂

```mermaid
flowchart LR
  user["交易员 / 浏览器"] --> pages["Cloudflare Pages<br/>静态前端"]
  pages --> dataEngine["DataEngine<br/>统一请求层"]

  dataEngine --> btcWorker["btc Worker<br/>行情、足迹、强平、衍生品、快照"]
  dataEngine --> yuqingWorker["yuqing Worker<br/>事件日报、舆情分析、LLM 路由"]

  btcWorker --> btcD1[("D1: btc<br/>K线 / 足迹 / 强平 / 衍生品 / 快照")]
  yuqingWorker --> yuqingD1[("D1: yuqing<br/>报告 / 设置")]

  btcWorker --> marketApis["Binance / Bybit / OKX / Yahoo 类 / FRED"]
  yuqingWorker --> facts["CoinGecko / Finnhub / FNG / Google Search"]
  yuqingWorker --> gemini["Gemini Worker 通道"]
```

## 文件导航

- [按功能定位代码与研究资料](docs/research/bitcoin-upgrade/QUICK_ROUTER.md)：支持K线/指标等17条路由、文件摘要和CodeGraph定位，日常修改优先从这里开始。
- [系统升级资料总纲](docs/research/bitcoin-upgrade/README.md)：本轮收口记录、免费通道与D1交付、币安连接限制及下一轮工作台改版起点；原始研究包仍作为参考。
- [完整文档索引](docs/README.md)
- [仓库布局与文件治理](docs/architecture/repository-layout.md)
- [脚本用途与副作用](scripts/README.md)
- 独立快照 Worker：`cloudflare/snapshot/`；[说明](docs/architecture/market-snapshot.md)。
- 历史资料：`docs/reference/archive/`；网站生成产物：`dist/pages/`；本地验收证据：`.artifacts/`。

## 当前系统分层

| 层级 | 说明 | 主要文件 |
| --- | --- | --- |
| 前端壳 | Hash 路由、导航、主题、设置页、各业务页。通过明确资产清单生成 dist/pages/，Cloudflare Pages 仅托管该产物。 | `index.html`、`styles.css`、`js/app.js`、`js/pages/*` |
| 行情数据层 | K 线、足迹图、强平、衍生品、市场快照与员工输入快照。 | `cloudflare/binance-klines-worker.js`、`cloudflare/schema.sql`、`js/data-engine.js` |
| 舆情与 LLM 层 | 事件一览、舆情分析、日报历史、成本估算、云端模型设置。 | `cloudflare/yuqing/yuqing-worker.js`、`cloudflare/yuqing/shijian/*`、`cloudflare/yuqing/fenxi/*` |
| 校验与部署 | 语法、指标数学、足迹聚合、快照契约、Worker API、舆情报告、Cloudflare Pages 清理。 | `scripts/verify-*.cjs`、`scripts/smoke-api.cjs`、`scripts/prune-pages-deployments.cjs` |

## LLM 执行方式

网站内置分析统一由云端 Worker 调用 Gemini，读取模块模型设置并把结果写入 D1。前端负责生成请求、流式展示与历史查询，不再派发本机 CLI 任务。

Codex 对话用于人工发起的开发、研究和分析，不依赖本地网页服务。确需把人工报告显示到网站时，可复用 `scripts/import-yuqing-report.cjs` 导入符合报告契约的 JSON；远程写入须有当前任务明确授权。内置连通性样例不代表正式日报。

历史 Bridge 迁移保留为数据库演进记录；旧任务表与执行设置不再被运行代码读取，不要求远程删表或迁移。历史报告继续通过原报告接口读取。

## 功能地图

| 导航区域 | 当前能力 |
| --- | --- |
| 市场监测 | 行情工作台、多周期结构、指标数学、订单流与足迹图、强平雷达、热力压力矩阵、衍生品面板。 |
| 舆情与事件 | 事件日报、实时扫描、GitHub 工具雷达、趋势线索、舆情二次分析、报告历史、成本估算。 |
| 智囊团 | 首席策略官、环境评估员、盘口流动性官、衍生品情报官、风控官的页面和输入契约逐步接入。 |
| 交易执行 | 仓位与风险计算器为固定结果演示，尚未接入公式；策略模板库、订单草稿台、当前持仓为预留扩展区。 |
| 复盘系统 | 交易日志、每日复盘、绩效统计、错误模式为预留区，后续会接入员工观点和历史归因。 |
| 系统 | 设置页、主题、D1 运维、Cloudflare 定点说明、云端分析设置、路线图占位。 |

保留 `PLANNED`、占位 UI 和预留结构是本项目约定。未完成模块只在对应功能完整可用后再移除占位。

## 数据与报告流

```mermaid
sequenceDiagram
  participant UI as 浏览器设置/业务页
  participant DE as DataEngine
  participant Y as yuqing Worker
  participant D1 as Cloudflare D1
  participant G as Gemini API

  UI->>DE: 生成事件日报/舆情分析
  DE->>Y: POST /api/yuqing/reports/generate
  Y->>D1: 读取 model_channels
  Y->>G: Gemini + Search grounding
  Y->>D1: 写入 yuqing_reports
  Y-->>DE: 返回报告（事件扫描支持流式输出）
  DE-->>UI: 渲染报告、历史与成本信息
```

## 本地开发

新电脑先安装 Node.js 24 和 Git，在仓库根目录执行 `npm ci --include=dev`。依赖版本由 package-lock.json 固定；密钥单独拷贝根目录 `.env`，不要覆盖已有文件。完整步骤见 [新电脑开发与敏感配置迁移](docs/operations/new-computer.md)。

Windows 双击唯一启动器 `start-local-cloud.bat`。它仅启动本地网页，自动打开浏览器并监听文件刷新；API/D1 仍由云端 Worker 提供，不会部署或恢复暂停的云端服务。关闭窗口或按 Ctrl+C 停止本地服务。

```bash
npm ci --include=dev
npm run dev:local
```

常用入口：

- `http://127.0.0.1:5173/index.html#chart`
- `http://127.0.0.1:5173/index.html#news`
- `http://127.0.0.1:5173/index.html#news-analysis`
- `http://127.0.0.1:5173/index.html#settings`

若 5173 被占用，Vite 会提示其他端口；也可以手动传 `-- --host 127.0.0.1 --port 5188`。

## 验证矩阵

| 场景 | 命令 |
| --- | --- |
| 通用语法检查 | `npm run lint` |
| 部署前总闸 | `npm run build` |
| 指标数学 | `node scripts/verify-indicator-math.cjs` |
| 足迹图 / 订单流 / 强平 | `npm run verify:footprint` |
| 行情 Worker 与静态壳探活 | `npm run verify:api` |
| 衍生品 Worker | `npm run verify:derivatives` |
| 舆情报告与云端模型契约 | `npm run verify:yuqing` |
| Fibonacci 统计验证 | `npm run verify:fib` |

`npm run build` 先执行 `verify:all`，再按 `config/pages-assets.json` 生成 `dist/pages/`。`npm run build:pages` 仅生成静态产物，`npm run verify:pages` 验证发布范围。

## Cloudflare 部署

当前仓库规则：**完成仓库改动并验证通过后，默认部署受影响的 Cloudflare 面**；GitHub 仍只在用户明确指令下 commit/push。

| 影响面 | 部署动作 |
| --- | --- |
| 前端、静态资源、规则/文档、脚本、共享逻辑 | `npm run deploy:pages` |
| 行情 Worker | 在 `cloudflare/` 下部署默认 Worker |
| 舆情 Worker | 在 `cloudflare/` 下部署 `wrangler.yuqing.toml` 对应 Worker |
| 同时影响 Pages 与 Worker | 先 Worker，后 Pages |
| D1 schema / 远程迁移 | 仅在用户明确要求时执行远程 D1 命令 |

前端、样式、页面入口或关键 JS 改动后，必须同步提升 `index.html` 中对应资源的 `?v=`，避免自定义域名和边缘缓存继续加载旧资源。

## GitHub 工作流

- 默认分支：`main`
- 远端：`origin` -> `https://github.com/Feini2002/Bitcoin.git`
- 默认不自动 commit / push / 开 PR；只有用户明确要求时执行。
- 推送前先确认工作区范围，避免把 `.env`、本地日志、临时截图等文件提交。
- 本仓库的 GitHub 备份说明见 `docs/operations/github-backup.md`。

## 安全边界

- `.env`、`.codex-bridge.env`、`.wrangler/`、`.codex/`、`.codex-bridge/`、`node_modules/` 不应进入仓库。
- 发布脚本只复制资产清单中的前端资源；后端代码、SQL、开发文档、本地凭据和日志不进入 Pages 产物。
- D1 远程 schema 迁移、远程写表、删除、`git reset` 等高风险操作必须显式确认。
- 网络实时数据不等于稳定测试结论；交易所、Worker、Binance、Bybit、Cloudflare 状态都可能随时间变化。

## 重要文件速查

| 文件 | 作用 |
| --- | --- |
| `AGENTS.md` | Codex 在本仓库工作时必须遵守的主规则 |
| `js/data-engine.js` | 前端到 Worker 的统一数据层 |
| `js/pages/settings.js` | 设置页、D1 运维、云端分析设置 |
| `cloudflare/binance-klines-worker.js` | 行情、足迹、强平、衍生品和快照 Worker |
| `cloudflare/yuqing/yuqing-worker.js` | 舆情日报、云端 LLM 与报告存储 Worker |
| `start-local-cloud.bat` | 唯一本地网页启动器 |
| `scripts/verify-yuqing-reports.cjs` | 舆情报告与云端模型契约校验 |

## 声明

本项目为私有交易决策辅助系统。页面展示、报告和模型输出均不构成投资建议；第三方行情源、交易所接口和模型服务受各自服务条款约束。
