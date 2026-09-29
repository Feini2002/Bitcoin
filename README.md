# Bit 交易决策平台

个人比特币研究工作台：原生 JavaScript 前端、Cloudflare Pages、Workers 与 D1。四页基础数据提供行情、订单流与足迹、分所强平、衍生品与宏观背景；事件和舆情页承接由 AI 对话完成、有来源和反证的研究报告。

**换电脑先读 [开发交接记录](docs/operations/development-handoff-2026-09-30.md) 和 [新电脑安装与私密配置恢复](docs/operations/new-computer.md)。** Git 保存代码、文档和迁移 SQL；本地凭据单独离线迁移，业务历史仍在原 Cloudflare D1 中。

## 当前状态（2026-09-30 北京时间）

- 四页 W1–W4 已实施；研究总览、事件一览、舆情分析和 AI 对话研究流程已改版发布。不要重新执行旧总计划。
- 云端已恢复；最近一次开关核对为 active。README 的状态是记录，不是实时监控，运维前执行 `npm run cloud:status`。换电脑不需要重新部署或恢复云端。
- 行情慢读已完成两轮修复：减少 D1 查询和宏观写入扫描，主图优先、有界并发、取消过期请求、校验后复用历史窗口、失败退避和自动恢复。主图仍读取完整 6,000 根；没有用删历史或假数据提速。测量与限制见 [读取性能记录](docs/research/chart-read-performance-2026-09-30.md)。
- 网站模型执行已退役。用户在 Codex 等 AI 对话中主动发起分析，网站无需模型 Key；只有明确要求保存到网站时，才通过 CLI 导入新报告并读回验证。
- 数据读到不等于全部新鲜或可分析：来源未知、历史缺口、宏观旧值、采集中断和各所覆盖限制继续显示。演示、规划模块仍保留标记。

## 新电脑快速启动

1. 安装 Git 和 Node.js 24，克隆 `https://github.com/Feini2002/Bitcoin.git` 的 `main`，进入仓库目录。
2. 执行 `npm ci --include=dev`，按锁文件安装；要运行构建和浏览器验收，再执行 `npm run setup:browser`。
3. 按私密包说明，把 `project/` 下的 `.env` 和 `.codex/` 私密文件放回新仓库对应位置，修正其中旧电脑的绝对路径。不要把旧 SOURCE 包覆盖到新克隆上。
4. 执行 `npm run dev:local`，或在 Windows 双击 `start-local-cloud.bat`。打开 `http://127.0.0.1:5173/#/chart`，端口以终端实际输出为准。
5. 运行 `npm run verify:dev` 与 `npm run build`；需要运维时在新电脑重新登录 GitHub / Cloudflare，不复制账号登录缓存。

本地启动只启动网页与热更新，默认仍读取云端 API；不会自动部署、迁移 D1、恢复云端或运行模型。停止服务用 Ctrl+C。本地 Worker / 空 D1 联调是另一条可选流程，见 [新电脑说明](docs/operations/new-computer.md)。

## 页面与研究方式

| 页面 | 用途 | 路由 |
| --- | --- | --- |
| 研究总览 | 市场读取快照、研究顺序、最近报告 | `#/overview` |
| 行情工作台 | 七周期 K 线、指标、结构位、多周期与显示证据 | `#/chart` |
| 订单流与足迹 | 主动成交、Delta 与价格档，保留覆盖和组成状态 | `#/orderflow` |
| 强平雷达 | Binance / Bybit 分所观察与压力矩阵 | `#/heatmap` |
| 环境背景 | 合约、杠杆和宏观数据，各项独立标示时间与来源 | `#/derivatives` |
| 事件一览 | 原始事实、冲突、BTC 传导、催化剂与来源 | `#/news` |
| 舆情分析 | 硬数据、叙事、市场验证、反证、情景与观察清单 | `#/news-analysis` |
| 设置 | 外观、来源与数据运维状态 | `#/settings` |

在事件或舆情页点击“准备 AI 分析”，复制完整指令到拥有仓库的 AI 对话。研究按 `js/research-protocol.js` 的模块顺序进行，使用 `scripts/prepare-research.cjs` 准备市场证据。报告可先本地预览；保存通过 `scripts/import-yuqing-report.cjs` 显式 `--remote` 写入新 ID，禁止覆盖旧报告。完整操作见 [AI 研究工作流](docs/research/ai-research-workflow.md)。

旧报告保留历史格式，不冒充当前分析；自动、手动和流式模型生成接口仍返回 410。员工、会议室、计算器、交易执行和复盘中的规划/演示，不属于已完成的实盘交易能力。

## 架构与线上入口

| 层级 | 入口 / 主要文件 | 职责 |
| --- | --- | --- |
| 静态前端 | [正式网站](https://bitcoin.feiniwork.com/)、`index.html`、`desk-ui.css`、`js/pages/` | 页面、图表、报告阅读；自定义域名有 Access 登录 |
| 共享读取层 | `js/data-engine.js` | desk 请求调度、共享、取消及历史窗口校验 |
| 行情 Worker | [BTC API](https://btc.feiniwork.com)、`cloudflare/binance-klines-worker.js`、`cloudflare/finance/` | 采集、D1、四页 `/api/desk/*` 与证据 |
| 历史报告 Worker | [Yuqing API](https://yuqing.feiniwork.com)、`cloudflare/yuqing/` | 报告和事实读取，保留模型退役契约 |
| 独立快照 | `cloudflare/snapshot/` | [快照契约与存储](docs/architecture/market-snapshot.md) |
| 研究协议 | `js/research-protocol.js`、`js/research-desk.js` | 模块提示词、结构校验、报告呈现 |
| 发布产物 | `config/pages-assets.json` → `dist/pages/` | 只发布白名单前端文件 |

默认 API 地址由 `js/config.js` 提供。可用 `.env` 中公开的 `BIT_DATA_API_BASE` / `BIT_YUQING_API_BASE` 覆盖；只有这两个地址被注入本地页面。真实密钥不能使用 `VITE_` 前缀或放进浏览器配置。

## 开发与验证

先读 `AGENTS.md`，再用 `node scripts/research-context.cjs "当前问题"` 定位现有研究与代码。研究资料是参考，不自动构成执行旧计划的指令。

| 场景 | 命令 | 范围 |
| --- | --- | --- |
| 语法 | `npm run lint` | 本地 |
| 完整回归与产物 | `npm run build` | 离线回归、Chromium、生成 `dist/pages/` |
| 新电脑开发入口 | `npm run verify:dev` | 本地服务、API 注入和 `.env` 隔离 |
| 四页交互 | `npm run verify:ui` | 固定数据的桌面/移动流程 |
| 研究页面 | `npm run verify:research-ui` | 事件/舆情、预览/导出/复制与历史兼容 |
| 多周期与请求成本 | `npm run verify:cost-ui` | 固定数据下缓存、取消和交互 |
| 指标与足迹 | `node scripts/verify-indicator-math.cjs`、`npm run verify:footprint` | 固定数据 |
| 线上 API 探测 | `npm run verify:api` | 真实只读网络请求 |
| 真实读取性能 | `node scripts/verify-read-performance.cjs` | 真实 API，耗时只是本次样本 |
| 云端开关状态 | `npm run cloud:status` | 只读核对远程状态 |

AI 执行长任务使用 `node scripts/run-bounded.cjs 180 npm run build` 等有界入口，每次观察不超过 30 秒。`build:pages` 只组装产物，不能代替 `build` 的完整验证。脚本副作用见 [脚本索引](scripts/README.md)。

## 发布、备份与私密文件

- 按 `AGENTS.md` 发布受影响面；先 `npm run build`，Pages 使用 `npm run deploy:pages`，同时改 Worker 时先 Worker 后 Pages。发布脚本会按既定数量保留历史部署。
- 修改被 `index.html` 引用的运行时资源时提升对应 `?v=`；生产验收核对实际文件。自定义域名要求登录时保留该边界，不以匿名跳转宣称页面故障。
- 暂停/恢复只使用 [固定开关](docs/research/cloudflare-pause-resume-2026-09-27.md)。`cloud-control-state.json` 随 Git 保存恢复记录；它不是实时状态或最新部署版本清单。
- GitHub 只在用户明确要求时 commit/push；源码备份不是 D1 数据备份。远程迁移、写表与清理遵守精确授权，不因换电脑自动执行。
- `.env`、出口机本地记录、SSH 私钥、私密 ZIP、`.wrangler/`、`.artifacts/`、依赖和构建目录不进入 Git。`.codex/skills/bit-trading-desk/` 是有意保留的项目规则例外。
- 私密迁移包仅供离线拷贝；新电脑登录 GitHub、Cloudflare、Codex。包中没有浏览器 Cookie、OAuth 缓存、云端 Secrets 导出或 D1/DO 数据。

## 文档入口

- [开发交接与接下来做什么](docs/operations/development-handoff-2026-09-30.md)
- [四页工作台当前方案](docs/research/repository-development-plan-2026-09-27.md)、[架构核对](docs/research/repository-architecture-review-2026-09-27.md)
- [研究工作台改版记录](docs/research/product-redesign-2026-09-29.md)、[AI 研究流程](docs/research/ai-research-workflow.md)
- [数据恢复与采集验收](docs/research/workbench-recovery-2026-09-29.md)、[读取性能修复](docs/research/chart-read-performance-2026-09-30.md)
- [功能资料路由](docs/research/bitcoin-upgrade/QUICK_ROUTER.md)、[完整文档索引](docs/README.md)、[GitHub 备份](docs/operations/github-backup.md)

本项目辅助个人研究，不自动下单。页面展示与研究报告不构成投资建议，数据覆盖和时效以实际证据为准。
