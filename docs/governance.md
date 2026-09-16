# 仓库治理记录

日期：2026-09-16。依据当前工作区源码与本地验证；不把历史索引或静态测试当作生产可用证据。

## 范围与状态

本轮以现有功能为边界收敛产品承诺、修复具体正确性问题、建立可复现验证。保留全部 PLANNED 和演示原型，不建设新的会议室 Agent、计算器公式或交易执行能力。

当前工作区原本已有舆情 Worker、bridge、设置、事件、报告页面、暂停配置和发布脚本等未提交改动。本轮保留这些改动；它们不应被归为本轮新增成果。执行期间又检测到并发工作退役 CLI bridge、将 LLM 改为云端单通道，并将两个 Worker 的 workers_dev/Cron 恢复启用；本轮不覆盖这些变化，也不独立部署它们。

## 功能清单（26 个路由）

| 路由 | 实现状态 | 数据/依赖与验证边界 |
| --- | --- | --- |
| overview | 本地功能 | 功能清单；旧概览保留为折叠演示 |
| chart | 已接入 | DataEngine → btc Worker/D1；浏览器 WS；固定数据图表验收通过，远程服务另验 |
| orderflow | 已接入 | footprint engine/canvas → btc Worker/D1；聚合与 Worker 离线回归 |
| heatmap | 已接入 | liquidation engine/pressure matrix → btc Worker/D1；离线回归 |
| derivatives | 已接入 | DataEngine → btc Worker/D1；离线回归 |
| news | 已接入 | events 页面 → yuqing Worker → 报告/D1；报告结构与函数回归，未实际调用模型 |
| news-analysis | 已接入 | news 页面 → yuqing Worker → 报告/D1；同上 |
| settings | 已接入 | 主题、云端模型、运维接口；未进行生产写操作 |
| boardroom | 演示 | 固定会议发言；召集与追问未实现 |
| agent-chief | 演示 | agent-views 固定结论；输入快照存在不等于已接入 Agent 执行 |
| agent-env | 演示 | 固定种子图形、固定指标与结论 |
| agent-flow | 演示 | 静态视图；关联 orderflow/heatmap |
| agent-deriv | 演示 | 静态视图；关联 derivatives |
| agent-risk | 演示 | 静态视图；无实际账户风险分析 |
| calc | 演示 | 固定结果，不会按输入计算；README 已校正 |
| premarket | PLANNED | 盘前简报规划 |
| archive | PLANNED | Agent 历史库；不同于已有舆情报告历史 |
| templates | PLANNED | 策略模板 |
| draft | PLANNED | 订单草稿 |
| positions | PLANNED | 持仓 |
| journal | PLANNED | 交易日志 |
| daily-review | PLANNED | 每日复盘 |
| perf | PLANNED | 绩效 |
| patterns | PLANNED | 错误模式 |
| data-vault | PLANNED | 数据池页面；不同于后端已有 D1 |
| playbook | PLANNED | 知识库 |

状态的唯一前端定义为 js/features.js；导航与概览复用该定义。已接入表示实现存在，不代表服务在线。整体功能完成度不能由路由数量或测试文件数量推断。

## 已修复问题与关联范围

1. 原型冒充实时：概览、员工、会议室、计算器、导航、横幅及行情/订单流/强平/衍生品的关联入口一起调整。演示默认折叠、明确标注，未实现的表单控件禁用，静态结论不再生成当前时间。规划内容保留。
2. 移动导航不可达：原 CSS 在小屏隐藏全部侧栏，新增导航按钮、展开/关闭、Escape 收起及选择后收起；桌面保持原分组习惯。
3. 快速切页：取消尚未执行的旧挂载，只释放实际挂载页面；hash 查询参数在初始加载与切换时一致解析。
4. API 覆盖无效：getBitDataApiBase 现在遵从已声明的 BIT_DATA_API_BASE，使数据读取及相关状态地址保持一致。
5. 数据来源串扰：DataEngine 将每次 K 线的元数据交给对应消费者；主图按当前页面代次、品种和周期接收，多周期面板不再覆盖主图，WS 数据不再冒充 D1 同步时间。主图状态展示基于 D1 最后开盘时间动态计算。
6. 请求生命周期：K 线取消信号贯穿响应体解析；切页和换周期取消旧主图请求，30 秒截止覆盖响应体。无效数值明确报错，不生成零价格蜡烛。
7. 验证：build 只执行离线回归和静态壳，verify:api 保留真实网络探测；移除总验证中重复快照执行。新增治理失效路径回归、浏览器脚本、有界启动器。Fibonacci 固定合成样本只证明计算可运行，去掉统计优势/交易胜率声明。

## 数据及分析关系

历史行情/D1 → 页面原始序列与指标 → marketSnapshotProgram → 四页市场快照 → 五类员工输入。
当前并发修改后的链路：事件/舆情页面 → Gemini Worker → yuqing_reports → 页面与历史。CLI bridge 退役由另一项工作实施，不是本轮治理新增。

本轮未改变 Worker API、快照/员工输入 schema、D1 表结构或模型执行配置。已有快照验证覆盖事实/启发式分层、页面与员工输入关系、存取、只读预览；舆情验证包含部分源码契约检查，不能据此声称真实模型运行或线上写入成功。

## 验收

- node scripts/run-bounded.cjs 180 npm run build：语法、指标、市场快照、足迹、强平、衍生品、舆情报告、Fibonacci 合成样本、治理回归。
- node scripts/run-bounded.cjs 120 npm run verify:ui：Chrome 152.0.7977.84 / Windows，1440×1000 和 390×844，比例 1，zh-CN，Asia/Shanghai，固定时间、行情、主题和动画。
- UI-01 与各路由：概览 → 展开规划导航 → 刷新保留分组；演示/规划入口 → 明确状态、原型可见性、禁用控件、无页面横向溢出。
- UI-CHART-01..05：真实 4.1.3 图表库 + 固定行情，周期切换、200 根历史显示、WS 新 K 线、D1 元数据不被改写、503 可见错误、恢复加载、离开页面释放 WS。
- 行为与视觉分开：结果文件 .artifacts/governance/results.json；代表截图保存在同目录。没有自动更新视觉基线。首次环境失败为缺少 Playwright 浏览器，随后使用已安装 Chrome；移动导航失败修复后复测。最终结果不掩盖这些失败记录。
- 外部行情 API、真实 LLM 调用、远程 D1 写入、其他浏览器和完整历史回放未通过本轮浏览器用例验证。生产探测/部署结果单独记录，不混入离线 PASS。

## 发布与恢复

静态版本为 20260916-govern1。按项目约定运行 build 后发布 Pages bit-trading-desk/main，并核验自定义域名版本及受影响 hash。保留生产/预览各最新 8 条部署；需要回退时使用发布前记录的生产 deployment。

本轮没有恢复 btc/yuqing；但另一个并发任务已修改本地配置为启用状态，不能再将整个工作区称为暂停态。远程状态仍需另行核验。远程 D1 操作：无。Worker 发布：本轮不改 Worker，不发布原有未提交 Worker 修改。Git commit/push：无。

## 后续建设边界

先以真实恢复后的数据验收补齐线上证据，再按实际使用价值选择一个未实现模块。每个新 Agent 需独立输入、任务类型、模型执行、输出、存储与历史闭环，执行路线遵从届时用户确认的契约；不把目前演示直接改成在线。

## 并发发布说明

本轮发现工作区在验证期间发生其他任务的持续修改。用户已明确选择：本轮完成本地治理，由另一项工作统一发布。本轮不执行 Pages 或 Worker 部署。

## 本轮最终证据

- 最终 npm run build 通过；日志：.artifacts/governance/build.log。治理定向回归 10 PASS / 0 FAIL。
- Chrome 152.0.7977.84 浏览器验收：43 PASS / 0 FAIL，覆盖上述两个 viewport 和主图流程。移动代表截图已人工语义审阅：导航可达，内容清晰，无首屏遮挡；无视觉基线比较。
- npm run verify:api 通过：2026-09-16 本次请求 btc.feiniwork.com/api/d1/status 返回 HTTP 200，仅证明当时连通。
- 本轮没有执行部署、远程 D1 写入或 Git 提交。并发任务已改变 Worker/LLM 发布面，用户已确认由另一项工作统一发布；不把本地验收当作生产验收。
