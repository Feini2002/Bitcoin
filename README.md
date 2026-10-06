# Bit 交易决策平台

个人比特币阅读与研究平台：先读首席中文日报，再按需查看五领域解读、同期图表和原始依据。数据层覆盖行情、盘口/足迹、已观察强平、衍生品、宏观与事件；本地Agent独立取证、综合与审核，解释变化、反证和缺口。前端采用原生JavaScript，事实API复用Cloudflare Workers/D1，当前云端按成本事故暂停策略管理。

当前架构先读 [Agent 主方案](docs/research/agent-team-product-plan-2026-10-02.md)，再读服从它的 [总架构 V2](docs/research/market-first-frontend-master-plan-2026-10-02.md)。实际版本、真实分析、截图和失败见 [实施与验收记录](docs/research/agent-team-implementation-2026-10-02.md)。本轮成果仅本地，自动研究初始关闭。

**换电脑先读 [2026-10-07开发状态与接续](docs/operations/development-handoff-2026-10-07.md) 和 [新电脑安装与私密配置恢复](docs/operations/new-computer.md)。** Git保存代码、文档、候选迁移SQL及当前云端恢复记录；凭据与本机研究历史默认离线迁移，远程D1没有随源码搬迁。[10月5日快照](docs/operations/development-handoff-2026-10-05.md)和[9月30日交接](docs/operations/development-handoff-2026-09-30.md)保留此前阶段。

## 文件去哪找

| 位置 | 内容 |
| --- | --- |
| `index.html`、`Bit交易决策平台.html` | 当前页面入口与旧书签跳转 |
| `assets/css/`、`assets/icons/` | 页面样式与图标 |
| `js/`、`cloudflare/` | 前端逻辑与云端 Worker / 数据迁移 |
| [tests/](tests/README.md) | 单元、集成、浏览器测试和固定样例 |
| [scripts/](scripts/README.md) | 构建、开发、研究、诊断、运维工具 |
| [docs/](docs/README.md) | 当前操作说明、架构、研究资料与历史参考 |
| `.local/migration/` | 仅本机保存的私密迁移包，Git 与 HTTP 均忽略 |
| `.local/agent-team/`、`.local/reader-content/` | 本机研究历史、引用证据、设置与中文阅读稿；默认不随Git迁移 |
| `dist/`、`.artifacts/`、`node_modules/` | 可再生构建、验收产物与依赖 |

现有 npm 命令、根目录启动器和页面 hash 保持不变。完整分层说明见[仓库布局](docs/architecture/repository-layout.md)。

## 当前状态（2026-10-07 北京时间）

- 四页 W1–W4 已实施；研究总览、事件一览、舆情分析和 AI 对话研究流程已改版发布。不要重新执行旧总计划。
- **云端保持成本事故暂停策略。** 本地恢复记录为paused，旧异常业务版已被阻止恢复；[D1成本本地修复](docs/research/d1-cost-repair-implementation-2026-10-06.md)尚未完成真实D1计费、生产迁移与24小时负载验收。运维前用`npm run cloud:status`核对控制面，换机不自动恢复或部署。
- 当前前端为**首席日报、深度解读、市场、往期**四主入口，设置独立。中文连续文章、同期图、来源阅读、消息精选/译读、完整本地概要筛选与日期/标题查询已接入；6份独立编辑稿和73条译文仅整理既有材料，自动编辑/翻译未启用。详见[中文日报实施](docs/research/consumer-daily-frontend-implementation-2026-10-05.md)。
- 行情慢读已完成两轮修复：减少 D1 查询和宏观写入扫描，主图优先、有界并发、取消过期请求、校验后复用历史窗口、失败退避和自动恢复。主图仍读取完整 6,000 根；没有用删历史或假数据提速。测量与限制见 [读取性能记录](docs/research/chart-read-performance-2026-09-30.md)。
- 旧云端模型执行继续退役、旧接口410；新本地开发版有独立Agent研究服务，全部模型步骤使用官方Codex CLI的ChatGPT登录额度。用户手动更新或在设置开启计划才执行，不填写模型API Key，不恢复旧云端任务队列。
- Agent保持`.27/P22`，新窗口/事件整队有真实通过；current-7五岗有限接受但新首席超时，修后新当前整队金融验收E未完成。10月7日累计源码完整构建通过246项语法、全量离线回归及73个运行文件，产物与源码一致；不能替代新模型研究、真人体验或生产验收。
- `npm run cloud:reads`只查询三个项目D1官方指标；开发开始/收尾及开发服务运行期间检查并汇报异常。10月7日开始检查为REVIEW：三个库近期及过去24小时无可核验活动记录，不能承诺零读取。见[检测说明](docs/research/cloud-read-detection-2026-10-05.md)和当前交接。
- 数据读到不等于全部新鲜或可分析：来源未知、历史缺口、宏观旧值、采集中断和各所覆盖限制继续显示。演示、规划模块仍保留标记。

## 新电脑快速启动

1. 安装 Git 和 Node.js 24；首次克隆 `https://github.com/Feini2002/Bitcoin.git` 的`main`，已有仓库先检查未提交改动，再`git pull --ff-only`。
2. 执行 `npm ci --include=dev`，按锁文件安装；要运行构建和浏览器验收，再执行 `npm run setup:browser`。
3. 已有可用`.env`、出口记录和SSH私钥可保留，核对绝对路径；缺失时按私密包说明离线合并。不要整目录覆盖`.codex/`，不用旧SOURCE包覆盖Git源码。
4. 执行 `npm run dev:local`，或在 Windows 双击 `start-local-cloud.bat`。打开 `http://127.0.0.1:5173/#/boardroom`；首席是默认入口，旧图表等深链继续可读。端口5173占用时直接报告。
5. 运行 `npm run verify:dev` 与 `npm run build`；需要运维时在新电脑重新登录 GitHub / Cloudflare，不复制账号登录缓存。

本地启动网页与研究服务，事实仍读取既有云端API；模型运行由手动更新或用户已开启的节奏触发，初始OFF，仅开发页打开期间执行。服务有8小时运行截止，停止用Ctrl+C；启动不会部署、迁移D1或恢复云端。本地Worker/空D1联调见 [新电脑说明](docs/operations/new-computer.md)。

## 页面与研究方式

| 页面 | 用途 | 路由 |
| --- | --- | --- |
| 首席日报 | 中文文章、同期图、变化、反证与真实更新 | `#/boardroom` |
| 深度解读 | 五领域入口、本领域依据与精确旧版本 | `#/domains`、`#/agent-env` 等 |
| 市场 | 行情、订单流、强平、环境与消息入口 | `#/market` |
| 往期 | 完整本地概要筛选、日期/标题查询、当时原件与导出 | `#/records` |
| 指定窗口/事件研究 | 明确范围/所选原件交接到同一Agent服务 | `#/research?view=window` |
| 研究总览 | 市场读取快照、研究顺序、最近报告 | `#/overview` |
| 行情工作台 | 七周期 K 线、指标、结构位、多周期与显示证据 | `#/chart` |
| 订单流与足迹 | 主动成交、Delta 与价格档，保留覆盖和组成状态 | `#/orderflow` |
| 强平雷达 | Binance / Bybit 分所观察与压力矩阵 | `#/heatmap` |
| 环境背景 | 合约、杠杆和宏观数据，各项独立标示时间与来源 | `#/derivatives` |
| 事件一览 | 原始事实、冲突、BTC 传导、催化剂与来源 | `#/news` |
| 舆情分析 | 硬数据、叙事、市场验证、反证、情景与观察清单 | `#/news-analysis` |
| 设置 | 外观、来源与数据运维状态 | `#/settings` |

本地团队可从首席“现在更新”、市场选区或事件“研究这个事件”发起。各岗独立取证，首席综合、必要追问后审核；报告和原件保存本地，历史不足/失败仍可查。来源/覆盖有限就有限交付，不编造账户仓位或交易成绩。

原人工AI对话研究和报告导入仍可用：按 `js/research-protocol.js` 的模块顺序及 `scripts/research/prepare-research.cjs` 准备证据，只有明确要求保存到网站时用 `scripts/research/import-yuqing-report.cjs` 显式 `--remote` 创建新ID并读回。见 [AI研究工作流](docs/research/ai-research-workflow.md)。

旧报告保留历史时点和格式，旧云端自动/手动/流式生成接口仍410。规划演示、计算器、交易执行和复盘中的预留不属于实盘交易能力，新本地团队能力以两份当前架构文档为准。

## 架构与线上入口

| 层级 | 入口 / 主要文件 | 职责 |
| --- | --- | --- |
| 静态前端 | [正式网站](https://bitcoin.feiniwork.com/)、`index.html`、`assets/css/desk-ui.css`、`js/pages/` | 页面、图表、报告阅读；自定义域名有 Access 登录 |
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
| 指标与足迹 | `node tests/unit/verify-indicator-math.cjs`、`npm run verify:footprint` | 固定数据 |
| 线上 API 探测 | `npm run verify:api` | 真实只读网络请求 |
| 真实读取性能 | `node scripts/diagnostics/verify-read-performance.cjs` | 真实 API，耗时只是本次样本 |
| 云端开关状态 | `npm run cloud:status` | 只读核对远程状态 |
| 云端异常读取 | `npm run cloud:reads` | 官方Analytics与本地SQL形态；缺失/异常不当作零用量 |
| 检测器回归 | `npm run verify:cloud-reads` | 离线，不证明真实云端正常 |
| 中文阅读与历史 | `npm run verify:consumer-reading-ui`、`npm run verify:structure-ui` | 保存材料/明确夹具，不运行模型 |
| D1本地规模对照 | `npm run verify:d1-cost:cross` | 双SQLite引擎，VM步数不是D1计费Rows Read |

AI 执行长任务使用 `node scripts/run-bounded.cjs 180 npm run build` 等有界入口，每次观察不超过 30 秒。`build:pages` 只组装产物，不能代替 `build` 的完整验证。脚本副作用见 [脚本索引](scripts/README.md)。

## 发布、备份与私密文件

- 本次换机备份只提交源码，不部署。成本事故暂停优先于普通发布规则，未明确开启不能部署业务Worker或恢复采集。后续获准发布时先`npm run build`，Pages只使用`dist/pages/`；业务恢复须经过精确候选、迁移和成本验收。
- 修改被 `index.html` 引用的运行时资源时提升对应 `?v=`；生产验收核对实际文件。自定义域名要求登录时保留该边界，不以匿名跳转宣称页面故障。
- 暂停/恢复只使用 [固定开关](docs/research/cloudflare-pause-resume-2026-09-27.md)。`cloud-control-state.json` 随 Git 保存恢复记录；它不是实时状态或最新部署版本清单。
- GitHub 只在用户明确要求时 commit/push；源码备份不是 D1 数据备份。远程迁移、写表与清理遵守精确授权，不因换电脑自动执行。
- `.env`、出口机本地记录、SSH 私钥、私密 ZIP、`.wrangler/`、`.artifacts/`、依赖和构建目录不进入 Git。`.codex/skills/bit-trading-desk/` 是有意保留的项目规则例外。
- 私密迁移包仅供离线拷贝；新电脑登录 GitHub、Cloudflare、Codex。包中没有浏览器 Cookie、OAuth 缓存、云端 Secrets 导出或 D1/DO 数据。

## 文档入口

- [当前开发状态与接下来做什么](docs/operations/development-handoff-2026-10-07.md)
- [中文日报实施](docs/research/consumer-daily-frontend-implementation-2026-10-05.md)、[D1成本本地修复](docs/research/d1-cost-repair-implementation-2026-10-06.md)、[云端读取检测](docs/research/cloud-read-detection-2026-10-05.md)
- [四页工作台当前方案](docs/research/repository-development-plan-2026-09-27.md)、[架构核对](docs/research/repository-architecture-review-2026-09-27.md)
- [研究工作台改版记录](docs/research/product-redesign-2026-09-29.md)、[AI 研究流程](docs/research/ai-research-workflow.md)
- [数据恢复与采集验收](docs/research/workbench-recovery-2026-09-29.md)、[读取性能修复](docs/research/chart-read-performance-2026-09-30.md)
- [功能资料路由](docs/research/bitcoin-upgrade/QUICK_ROUTER.md)、[完整文档索引](docs/README.md)、[GitHub 备份](docs/operations/github-backup.md)

本项目辅助个人研究，不自动下单。页面展示与研究报告不构成投资建议，数据覆盖和时效以实际证据为准。
