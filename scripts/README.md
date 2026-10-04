# 脚本用途

优先通过 package.json 的稳定命令调用。2026-09-30 按职责归类实现文件，npm 命令保持不变。

| 目录 | 职责 | 常用入口 |
| --- | --- | --- |
| `build/` | 语法检查、组装网站白名单资源 | `npm run lint`、`npm run build:pages` |
| `dev/` | 有界启动、差异查看、离线费用模拟 | `npm run diff:summary`、`npm run simulate:cloudflare` |
| `research/` | 查询资料、准备证据、校验及显式导入报告 | `research-context.cjs`、`prepare-research.cjs`、`import-yuqing-report.cjs` |
| `diagnostics/` | 线上读回、性能测量及专项诊断 | `npm run diagnose`、`npm run verify:api` |
| `operations/` | 发布、云端开关、专项采集 | `npm run cloud:status` 等；执行前核对授权与副作用 |
| [../tests/](../tests/README.md) | 离线与浏览器验收、固定样例 | `npm run build`、`npm run verify:ui` |

根目录仅留 `research-context.cjs` 与 `run-bounded.cjs` 两个兼容入口，分别转入 `research/`、`dev/` 实现，已有命令和资料查询方式仍可直接使用。诊断目录不等于只读：包含快照写入等专项工具，下面继续逐项标明副作用。

当前开发从[交接记录](../docs/operations/development-handoff-2026-09-30.md)与[四页工作台方案](../docs/research/repository-development-plan-2026-09-27.md)开始；`npm run build` 已包含研究路由、研究协议、共享读取、Pages 清理离线回归和云端开关模拟，不执行生产删除或暂停/恢复。生产开关仍用 `cloud:status` / `cloud:pause` / `cloud:resume`，遵从[开关说明](../docs/research/cloudflare-pause-resume-2026-09-27.md)。

| 用途 | 入口 | 副作用 |
| --- | --- | --- |
| 按功能/文件查询研究资料 | node scripts/research-context.cjs 问题；--file ID；--find 关键词 | 只读，输出有数量上限；不自动调用图工具、测试或网络 |
| 刷新/核对研究资料目录 | node scripts/research-context.cjs --refresh / --check | refresh只写FILE_CATALOG.json；check只读，不执行资料包内容 |

资料目录覆盖本地核验记录、第一批归档与第二批执行包，按「批次＋权威等级」标注：本地核验 > 第一批设计 > 备选参考 > 仅追溯；`90_reference` 与第一批重复，只存指针不重复编目。查询输出直接显示等级，冲突时据此取舍。

| 用途 | 入口 | 副作用 |
| --- | --- | --- |
| 离线完整验证 + 网站产物 | npm run build | 仅本地 dist/pages/ |
| 网站资产构建 | npm run build:pages | 重建可再生 dist/pages/ |
| 发布边界验证 | npm run verify:pages | 本地固定样例与发布产物 |
| 指标/快照/足迹/舆情 | npm test、verify:footprint、verify:market-snapshot、verify:yuqing | 固定测试数据，不调用真实模型 |
| 浏览器治理验收 | npm run verify:ui | Chrome、短时本地 HTTP 服务、.artifacts/ |
| 静态壳 | npm run verify:shell | 只读本地 |
| 行情服务探测 | npm run verify:api | 线上 GET |
| 免费金融通道契约 | npm run verify:finance | 离线固定数据，不消耗 API 额度 |
| 免费金融通道实测 | npm run diagnose:finance；追加 -- --origin https://btc.feiniwork.com --all --d1 | 按需联网并保存 D1，独立读回核对；有限次数，脱敏结果写 .artifacts/finance-channels/ |
| 规范数据集首次采集 | node scripts/collect-finance-datasets.cjs --mode cloud；可加 --dataset ID | 有限的32项免费数据集，CF按需采集并存D1；无新增Cron |
| 公共数据本机首次样本 | node scripts/collect-finance-datasets.cjs --mode local-bootstrap | 默认18项Binance，只生成带来源/采集位置的本地SQL，不自行远程导入；明确选择单项时仅允许无Key公共来源 |
| 规范数据集线上读回 | node scripts/verify-finance-datasets-live.cjs | 只读Worker/D1，核对32项来源/覆盖及已生成首次样本的逐字段一致性 |
| 行情/衍生品诊断 | diagnose-klines.cjs、diagnose-derivatives-sync.cjs、baseline-derivatives-prod.cjs | 联网；按脚本实际路径判断写入范围 |
| 快照远程诊断 | diagnose-market-snapshot-cloud.cjs | 包含 POST 写快照，不能当纯只读检查运行 |
| 研究证据准备 | prepare-research.cjs --kind=daily_event 或 --kind=sentiment_analysis | 有界读取现有四页与报告，原始证据写 .artifacts/research/；不调用模型或导入报告 |
| 研究协议与界面 | npm run verify:research；npm run verify:research-ui | 离线校验、固定数据 Chromium，不生成真实研究 |
| 报告导入 | import-yuqing-report.cjs | 默认只校验；显式 --local/--remote 才写入新 ID，远程须有明确授权 |
| 读取与多周期回归 | verify-desk-read.cjs；npm run verify:cost-ui | 离线固定数据与浏览器，不增加采集 |
| 真实读取测量 | verify-read-performance.cjs，可追加站点根 URL | 真实页面/API 只读，保存本地测量样本，不是稳定性保证 |
| Pages 发布/清理 | deploy-pages-safe.cjs、prune-pages-deployments.cjs | 上传网站、清理历史部署 |
| 有界启动 | run-bounded.cjs | 记录父子 PID，按指定秒数停止本次进程树 |
| 新电脑开发验收 | npm run verify:dev | 本地 Vite 和 Chromium，固定 API 地址，无远程写入 |
| 专项市场采集 | collect-market-local.cjs | 远程 D1 写入，不随开发启动；使用锁定版本 Wrangler 内部接口 |
| 差异摘要 | diff-summary.cjs | 仅按需，不作为默认收尾步骤 |

本地长任务示例：node scripts/run-bounded.cjs 180 npm run build。调用方每轮观察不超过 30 秒，实际成果仍须验收。

已退役的重复快照包装器统一使用 npm run verify:market-snapshot；旧 npm run verify:chart-snapshot 别名继续可用。一次性拼接脚本保留在 docs/reference/archive/maintenance/，不再是可执行维护入口。
