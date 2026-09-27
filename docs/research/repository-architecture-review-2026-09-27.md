# 仓库架构核对与治理记录

查询/核对日期：2026-09-27（北京时间）。当前开发入口为[四页数据工作台方案](repository-development-plan-2026-09-27.md)。本记录区分源码事实、本轮反例、复用的历史验收和未验证范围，不把计划文字当运行成果。

当前云端：2026-09-27 15:55 UTC 已暂停。维护版 `be22bb8a-0d6b-4ce6-be08-5ce2038fe95c`，正式恢复点 `696db73c-4f71-4bef-8a5b-ed0801aa632c`。下文收口复审里的 active 是当天早些时候的发布记录，不是现在的运行状态。

## 收口复审：恢复、迁移与生产抽验（2026-09-27）

四页方案的 R1–R3 已执行，不另开治理轮次。重新核实后的事实：

| 事项 | 结果 |
| --- | --- |
| 开关 | 实时分类为 active。`cloud:resume` 退出码 0；premium 入库从 18:36:44.963Z 到 18:38:50.026Z |
| 舆情 TLS | 自定义域握手被系统信任。证书 CN `feiniwork.com`，SAN 含 `yuqing.feiniwork.com`，签发者 Google Trust Services WE1。健康检查 `ok/d1Ready`。绑定未重建 |
| 权限缺口 | 同一 Wrangler 登录读 Worker 域名成功；区域 DNS 403/10000，证书包与 SSL 验证 403/9109。未据此假装读过 DNS 记录 |
| 迁移 | `desk-history-migration.sql` 加性执行成功。K 线仍为 BTCUSDT 的 5m 6056、15m 6018、1h 6004、4h 6000、1d 2576、3d 863、1w 369 根 |
| 发布 | BTC Worker `e8b990cc-2ee6-4416-ab48-69d2af2fe584`，Cron 仍每分钟。Pages `ef2a2a0c` 与生产别名均含 `20260927-release1`。清理删除 1 条并读回缺失，剩余 10 条且没有还可删项。舆情/快照未部署 |
| 页面 | 生产 Pages 上行情、订单流、强平、环境背景有实际数值、来源和缺口。环境背景导出含当时标记价、资金费、未平仓。自定义域需要 Access 登录 |
| 费用样本 | 15m 的 21 键 observed 索引游走：读 5989、写 0、3.2 毫秒。不是 6000 根默认窗或整月账单 |

本地发布前复跑：desk 装配、金融增量 26 项、迁移、工作台审查 9 项、证据 6 项，以及 `npm run build` 退出码 0、35 个 Pages 文件。这些通过不把单次生产读数变成长期稳定结论。

## 最新复审：四页实现后的加固（2026-09-27）

以下新记录覆盖旧审查中的“尚未开发/云端暂停”状态；后续章节保留首次治理依据。四页已有实现，不需要重新跑旧总计划。

| 发现与后果 | 最小修复 | 当前证据 |
| --- | --- | --- |
| 临时表被 workerd 拒绝，SQLite 替身测试未发现，可能导致新写入失败 | 辅助计数改普通小表；reset、差异计算、升版和写入同一事务 | 本地真实 D1 确认 TEMP 返回 SQLITE_AUTH；真实生产写入 SQL、幂等及中途失败回滚通过 |
| 迁移缺观察时间索引；仅看索引名也漏掉尾读随历史增长 | 迁移补索引；显式按观察时间 seek，有限键驱动 winner，避免错误索引和 JOIN 顺序；保留未知观察时间摘要 | 最终本地 D1 800/8000 行：旧键查询 rows_read 33,745/336,082；修后均736，完整组装+前驱均911；回归强制增长不超过64 |
| 主图在不同事务读取版本、raw、canonical 和状态，可能混读 | 单次 batch 读取版本、两种数据、前驱、缺口和同步状态 | desk 真实装配回归禁止成功请求在 batch 外读取 |
| 被拒绝的旧/同时间可变收据仍误增版本，引发无效 full | 升版差异复用 upsert 接纳条件 | 连续旧收据不升版，较新修正升一次；升版后插入失败整体回滚 |
| 宏观摘要未应用同值 receipt，时间和修订血缘落后于历史读取 | 摘要与完整读取复用有界 receipt 重建 | FRED/SOFR、knownAt、真实 vintage、未覆盖键回归通过 |
| 同周期子图共享版本确认，后一个子图可能漏修订；重读保留已删除棒 | 每个子图独立确认；修订范围替换，范围外新尾部保留 | 两个同周期子图、版本倒退、窗口删除及旧请求实际函数回归通过 |
| 图表 tail 更新后导出仍带初始版本/窗口；断流旧值看似健康 | 导出最新读取证据、已确认历史版本和实际显示窗口，主图/足迹失败显式 stale/failure | 9项实际函数审查回归；四页浏览器下载解析与已显示值一致 |
| 主图窄屏缺显式正常数据验收 | 实际图表库、固定正常行情，1440/390宽度检查 | verify:ui 48 PASS；正常图表有 canvas 且无横向溢出 |

最终验证：`node scripts/run-bounded.cjs 180 npm run build`退出0，生成35项运行资源的dist/pages；`verify:ui`48 PASS，`verify:cost-ui`、四页下载与显示回归通过；增量26 PASS，新增审查9 PASS；生产旧版`verify:api`通过。单次成功不是长期稳定证据。

测试入口：`verify-finance-incremental.cjs`、`verify-desk-assembly.cjs`、新增 `verify-desk-migration.cjs` 与 `verify-workbench-review.cjs`、扩展 `verify-governance-ui.cjs`/`verify-derivatives-presentation.cjs`。本地 D1 使用 `node scripts/run-bounded.cjs 30 node scripts/verify-desk-migration.cjs --workerd`；隔离、无生产数据。成本样本固定每键版本密度；historical knownAt过滤未来收据、同键版本数增长仍可能增加读取，不能把736/911称为任意输入硬上限或生产账单保证。

云端执行：2026-09-26 17:58 UTC 的第一次 `cloud:resume` 曾停在 resuming，因为当时舆情自定义域 TLS 未通过。该段只保留当时观察。随后的证书、健康检查、入库和发布以上方收口复审为准，不再把 resuming 或“尚未发布”当作当前状态。

外部核验（2026-09-27）：[workerd SQLite 授权源码](https://github.com/cloudflare/workerd/blob/main/src/workerd/util/sqlite.c%2B%2B)拒绝 TEMP；[Cloudflare 自定义域说明](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)说明自动证书；[证书状态](https://developers.cloudflare.com/ssl/reference/certificate-statuses/)和[DCV 排错](https://developers.cloudflare.com/ssl/edge-certificates/changing-dcv-method/troubleshooting/)仅作为下一步诊断依据，未据此推定本账号状态。原始工具输出、固定测试与采样见 `.artifacts/workbench-review-20260927/`、`.artifacts/cloud-control/`，复现不依赖产物中的实时数据。

## 1. 首次治理结论与当时边界

继续使用现有 Pages + Workers + D1 + 单常驻采集器 + 东京出口。费用与调度治理已经完成了一轮，并有源码对应的模拟和生产采样证据；未发现需要迁库、换平台或全面重构的依据。当前最有价值的下一步是把现有数据正确地贯通到四页展示和证据输出。

本轮接手 HEAD 为 `5ff2e2b7e02740fee0d4640354ee7b3812e03197`，工作区已有 42 项改动/未跟踪项（含其他任务与本地归档）。这些不是本轮新增成果。基线文件指纹保存在 `.artifacts/architecture-governance/baseline.json`；未 reset、clean、覆盖已有改动或自动提交。

同时运行的另一对话正在交付云端开关；该任务的文件、恢复记录和验证由原任务维护，本轮复用其完成证据。云端当前主动暂停，不是新故障；本轮没有唤醒采集、发布业务 Worker、执行远程 SQL 写入或改变费用配置。后续恢复按[固定开关说明](cloudflare-pause-resume-2026-09-27.md)，不手动改 Cron 或重新启用旧日报。

## 2. 当前职责与真实数据流

| 层 | 当前职责 | 已确认边界 |
| --- | --- | --- |
| 东京出口 | 为现有交易所 REST/WS 提供可达路径 | 已有迁移，不能继续沿用 09-17 的 403 阻塞结论 |
| BTC Worker + 采集 DO | 行情、强平、足迹、金融集增量采集与恢复 | 一个常驻对象；旧 Kline 对象保留兼容/迁移但退役 |
| BTC D1 | 原始表、规范观察、采集状态 | 当前 tail 健康与完整历史来源/连续性不是同一个事实 |
| `/api/desk` | 四页的分析装配入口 | chart/orderflow/heatmap/context；正常/缺失/源陈旧/采集陈旧应沿链路传播 |
| 页面与 DataEngine | 展示、缓存、当前窗口与请求生命周期 | 已有大量真实能力，仍有未消费字段与固定状态文案 |
| 独立 snapshot Worker + D1 | 旧快照/员工输入与历史 | 图表/合约分支有意省略，尚未与当前 desk 贯通，不能声称完整可用 |
| yuqing Worker + D1 | 事实、事件和历史报告读取 | 自动、手动与流式模型生成已退役；历史表及报告保留 |
| Pages | 静态资产托管 | 仅发布 `dist/pages/`；研究材料和本地证据不进入线上资产 |

当前部署恢复目标包含三个 D1（btc、yuqing、bitdesk_snapshots）和两个 DO 命名空间。保留迁移史和已有数据；本轮没有发现必须通过清库/删表才能解决的事项。

## 3. 复用 Cloudflare 治理的证据

读取 `.artifacts/plans/cloudflare-governance-final-2026-09-26.md` 及对应模拟/采样记录；核对费用模型记录的 16 个源码 SHA-256 与当前文件，均一致。结论只适用于这些计费路径，不覆盖后续新功能或全账户其他项目。

- 费用治理当时的 BTC 正式版本是 `93dc9cff-7279-4773-b7c0-d4a094212eca`。2026-09-27 收口后，当前正式版本以 `cloudflare/cloud-control-state.json` 和上方收口复审为准；维护版本仍不可与正式版本混淆。
- 已实现：普通 K 线批次至少 5 秒起始间隔、OI/盘口独立节奏、持久化恢复游标与代次、REST/WS 写入顺序、宏观轻量收据/修订去重、失败源公平调度、Pages 真正删除后的回查。
- 历史最终验收记录：41 根闭合棒同源 OHLCV 比较无差异；66.287 秒内 33 次读取可用；7 周期、足迹和两路强平有当时的读回。上述是短样本，不能推广到全部历史与长期稳定。
- 当时仍有 7 个 FRED 系列返回上游 520；调度修复保证它们不会挤占正常行情。当前暂停，未重新宣称这些来源全部恢复。
- 既有模拟：未来完整 31 天常态约 $6.32，列明的缺口/重试压力约 $9.60，所有路径同时放大 5 倍约 $33.72（含 Workers 基础费，未含 VPS、税费、模型和其他项目）。它是参数化估算，告警不是账单硬封顶。
- 原详细日志位于 `.artifacts/`，被 Git 忽略。此处保留可携带结论与限制；需要重验时运行已纳入仓库的模拟/回归脚本，不能把另一电脑不存在的日志当作已看到的证据。

官方文档于本轮核对，仅记录影响架构决定的边界：

| 官方事实 | 对本项目的含义 | 原始来源 |
| --- | --- | --- |
| D1 查询按扫描/写入行计费，索引有读写取舍 | 不能用 SQL 次数代替 rows_read/rows_written；新 desk 读取需要有界查询和实测 | [D1 定价](https://developers.cloudflare.com/d1/platform/pricing/) |
| D1 单库付费上限 10 GB、单库单线程，查询最长 30 秒；付费每次 Worker 调用查询上限 1000 | 先测实际库大小、查询/索引与并发，不因理论上限立即迁库 | [D1 限制](https://developers.cloudflare.com/d1/platform/limits/) |
| 每分钟 Cron 的 CPU 限制为 30 秒，wall time 上限 15 分钟 | 不能把低频 Cron 的 15 分钟 CPU 上限套到分钟任务；保留每轮最多 8 个到期集及有界补采 | [Workers 限制](https://developers.cloudflare.com/workers/platform/limits/) |
| DO 付费包含 400,000 GB-s/月；超额计费单位向上取整，WS 入站消息以 20:1 换算请求 | 一个额外常驻对象可能跨费用台阶；最新模型已单列持续对象与压力场景 | [DO 定价](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| 外连 WebSocket 不支持通过 hibernation 休眠 | 当前交易所采集器不能套用服务端休眠示例来承诺零常驻费用 | [DO WebSocket](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) |

来源原文仅保存短摘录：“Rows read”、“Rows written”、“10 GB”、“Single-threaded”、“outgoing WebSocket connections”。上表其余为本地归纳和适用推断；官方限制会变化，后续实施涉及数值时重新核验。

## 4. 本轮发现及处理

| ID / 优先级 | 事实与可复现触发 | 决定 |
| --- | --- | --- |
| F1 / P1 | `readLiveKlineTape` 用最新 sync_status 判断全窗；`buildChartDeskFromTape` 给每根历史统一 sourceHost/receivedAt/storedAt。旧 klines 无逐棒来源/收据字段 | W1 先解决来源与时间证明，不推断线上所有旧历史已混源，也不将旧数据静默补标 |
| F2 / P1 | 规范读口输出 coverage.incomplete/unresolvedGap；装配只按根数判断。新鲜 15m 的 500 根中有一处 30min 间隔仍可得到 quality=pass、gap=null；live tape 还会覆盖部分 warn | W1 一起贯通缺口、尾部与研究窗口语义，禁止只改一个警告却仍输出确认指标 |
| F3 / P2 | `renderContextDesk` 没有消费已有 `desk.contract`；正常响应后“合约状态空”与静态空卡仍保留 | W2 使用现有 premium/funding/basis 数据，不新增采集链 |
| F4 / P2 | `FEATURE_STATE_BY_ROUTE` 写死四页 halted，即使数据链可用也称“主源未恢复” | 本轮局部修复功能成熟度；在线状态由页内实际数据反馈，不新增请求 |
| F5 / 范围差异 | 旧 snapshot 图表/合约恒空，旧模型入口返回 410 | 有意停用/退役，保留；W4 导出当前 desk 事实，不偷改成启用旧模型 |
| F6 / 交接缺陷 | 旧 EXECUTION_MASTER 仍自称唯一入口，文档/导航把已部署与退役工作写成未实施/待启用 | 本轮更新入口、历史标识、规则与查询路由；原始研究快照不改 |
| F7 / 查询边界 | context 对 17 个数据集复用历史读取，离线入口探针产生 61 条 SQL、17 次最多 1000 条观察读取；卡片主要使用最新值 | W2 设计卡片摘要读取并量测真实 rows_read；不是超预算证据，单改 LIMIT 也不能消除完整计数/候选扫描 |

F1/F2 由内存调用当前真实装配函数复现，不是纯文本推断；F3/F4 由 VM 调用当前前端函数复现。没有用真实市场样本证明线上所有窗口都出现同样问题。完整业务修复安排到 W1/W2，以确保采集、存储、页面、缓存、指标和导出共同验收。

## 5. 旧 39 项主线与 9 项条件任务的归并

旧编号保留在 [EXECUTION_LOG](bitcoin-upgrade/batch2-execution/EXECUTION_LOG.md)。其“37 implemented/reused_verified + 2 partial”反映 09-17 的代码/离线状态，后续变更以本次源码和当前方案为准。

| 旧阶段/编号 | 当前分类 | 新主线关系 |
| --- | --- | --- |
| P00：001/002/003/047 | 已有基础、测试与用途契约，复用 | G0/G2 更新当前入口；不重做全部调查 |
| P01：004–007 | 基础契约/纯方法存在，端到端仍有 F1/F2 | W1 检验真实消费链 |
| P02：008–012 | 已有图表与计算；旧消费前提被 desk 改写 | W1/W3 补来源、覆盖与交互证据 |
| P03：035/036/039 | 模板、capture 与旧报告兼容保留 | 不等于当前市场新简报已闭环；W4 仅证据导出 |
| P04：021–024 | 单位/窗口算法存在，页面有 F3 | W2 接上实际数据 |
| P05：013–016 | 足迹分箱/POC/SFP等纯计算复用 | W2/W3 验证实际覆盖与页面状态 |
| P06：017–020 | 强平分所/方向语义复用；压力叙事受限 | 不自动恢复旧评分，W2/W3 验证 |
| P07：031–034 | 有限情报/版本/去重已有；031原本partial | 扩正文/账号暂缓，当前四页不依赖 |
| P08：037/038 | 模型生成真实运行已退役 | 不再排成待启用任务；继续验证410 |
| P09：040/041 | 旧证据/历史能力保留，统一出口有缺口 | W4 明确当前证据与旧快照边界 |
| P10：043/044/048 | 旧离线收口；效果/隔离迁移不是已证明 | 按 W1–W4 实际改动补验，不要求无迁移也做生产迁移 |
| C25/C26/C27 | 历史覆盖需重验；增量优化与东京出口已有后续实现 | W1 核对，费用治理和VPS迁移不重做 |
| C28/C30 | 宏观分频与期权摘要已有；不等于深度研究完整 | 当前展示已采到的背景，扩建按需求 |
| C45 | 旧部署/403的partial已被后续部署覆盖 | 当前是主动暂停；新版本另做恢复/发布验收 |
| C29/C42/C46 | ETF深度、观点提醒、独立数据库仍为条件项 | 无当前触发条件，维持暂缓 |

计算器、员工和会议室原型不属于必须补齐的旧主线。任务数、资料数和测试文件数都不能换算成产品完成率。

## 6. 验证与交付记录

- `node scripts/run-bounded.cjs 180 npm run build`：PASS，生成 34 个 Pages 资产。日志 `.artifacts/architecture-governance/build.log`，监督 PID 5048 / 子 PID 4472，正常终态且退出码 0。包括已有数学、快照、足迹/恢复、金融/desk、模型退役、15 项云端开关模拟；新纳入研究路由检查与 Pages 清理模拟，不访问生产删除入口。
- `node scripts/run-bounded.cjs 120 npm run verify:ui`：PASS，Chromium 147.0.7727.15，1440×1000 / 390×844，43 项通过、0 失败。`.artifacts/architecture-governance/ui.log` 与 `.artifacts/governance/results.json`；四页成熟度、演示/规划、导航、图表503停机/空行情、恢复与离页清理有实际断言。移动概览截图已检查，标签清晰且无横向溢出。固定数据与拦截网络，不是生产页面验收。
- 定向治理回归为 12 PASS，包含四页成熟度不随运行状态伪变，以及 desk 503 不回退旧分析接口；旧模型退役与第二批契约检查也通过。不以这些 PASS 覆盖 F1–F3 的反例。
- 父任务独立复现 F1/F2/F3：`.artifacts/architecture-governance/reproduce-findings.cjs` 与 `findings.json`。真实函数＋合成输入，无网络：1000天旧棒被赋当前收据、500根中间缺棒仍质量通过、有效合约数值未渲染均确认。它们是下一阶段要修的反例，不列成已修复或成功业务验收。
- 新入口可通过 `node scripts/research-context.cjs "四页工作台当前计划"` 和 `--file LOCAL-NEXT` 定位；旧日志标记仅追溯。目录刷新在普通沙箱写入 EPERM 后，经精确授权提升运行成功；未改变文件权限或用其他通道绕过限制。
- 本轮修改的三个静态入口资源已提升至 `20260927-governance1`；本地构建产物可供后续发布。云端保持暂停，本轮未发布这些新资产或业务 Worker。
- 交付检查：研究目录 306 份、18 条路由、24 个查询场景通过；16 份本轮/并发更新文档的相对文件链接无断链；三个受影响 JS 与 `dist/pages/` 字节一致且入口版本正确。`git diff --check` 通过。记录在 `.artifacts/architecture-governance/delivery-check.json`；其中并发开关文件不算本轮新增实现。

CodeGraph 工具明确当前路径未发现 `.codegraph/`，文件系统亦核对不存在；本轮回退 `rg` 和定向源码，未重建索引。仓库规则已改为条件使用索引，避免把旧电脑的索引状态当作当前事实。

未验证范围：本轮不改变暂停状态，因此不重新测线上持续采集、生产页面登录后行为、真实历史全量来源、整月账单或生产迁移。它们按新方案中的具体受影响行为验收，不包装成已完成。

## 7. 开工前收尾复核（2026-09-27）

用户追加要求确保方案可直接开发并检查错误。主任务与两路只读审查核对现有数据/页面实现后，修订同一开发方案，不再另建竞争计划。本次只改方案、审查记录和导航目录；W1–W4 的业务代码仍待实施。

| 已确认的方案缺口或源码事实 | 收口决定 |
| --- | --- |
| `readDataset` 只有通用 limit/knownAt，规范分支仍先取历史再切 tail，且有完整 COUNT | W1 明确 window/tail、SQL 边界、返回范围和实际扫描验收，不用缩小 JSON 冒充省读 |
| live 规范行的 received_at 可是开盘时间；desk 丢失 effectiveReceivedAt。当前 inputRevision 只看最新开盘与原因，同棒值变仍不变 | W1 保留实际收据；整条值与证据共同选择；tail 内容版本与持久历史版本分开 |
| 原始表不能发现 tail 外修订；现有 DO generation 是恢复任务代次，不是内容版本 | W1b 默认新增每产品/周期一行的小表，原子写入版本；不提高普通写入频率，迁移/费用仍须随实现验证 |
| 没有 3d 规范集；1w 有周一起点；规范保留 600 键但 5m 需求为 864 根 | 首版 3d 保留未核实，1w 复用真实对齐；不足明确显示，不静默扩保留或降研究条件 |
| 宏观最后接收不一定是最新参考期；资金费最后两条收据未必是两个结算事件 | W2 按数据类型摘要并保留修订/缺值/结算语义；明确接入已有 OI、主动量和样本数据，17→22 集新增读量计入验收 |
| 主图回调有代次检查，但 await 后仍无条件写全局，上级周期也调用它 | W3 增加当前/辅助周期、tail/full 交错返回测试；提交视图前统一验证身份 |
| 没有共享证据 store；主图最后 payload 只是 tail，足迹元数据不完整，其他页离页会清输入 | W4 明确新模块 owner、有界内存、页面提交已显示状态、未访问/失败/陈旧及用途限制；不为导出多拉四页 |
| 旧计划把构建列在部署之后，脚本会重建 Pages 且包含部署清理 | 改为先验收/固定指纹，再恢复、增量迁移、Worker、Pages、生产验证；记录恢复点和清理保留边界 |

十五个 WB 编号已映射到现有回归脚本及拟新增的证据导出测试。新增文件/表均明确标为拟新增；它们不是现有能力，也不是当前已通过的验收。第一步固定反例，随后有界读写、前端消费、交互、导出依次落地。没有发现必须先迁平台或再做泛化全仓重构才能开工的阻塞；W4 的来源用途核验和真实 D1 费用/生产行为仍是对应阶段的验收工作。

补充官方核验：2026-09-27 查询 Cloudflare D1 Workers Binding API（项目 Wrangler 4.85.0，约束以服务端文档为准）。[D1 batch 文档](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)确认顺序执行与整批失败回滚；[返回对象](https://developers.cloudflare.com/d1/worker-api/return-object/)提供 rows_read/rows_written 等元数据。因此建议将数据变更与历史版本放在同批，费用测量读取实际 meta；这是本地设计建议，不是官方对本仓库实现的背书。保留原文短摘录：“Batched statements are SQL transactions”、“rolls back the entire sequence”、“rows_read”、“rows_written”。本次未运行远程 SQL。

收尾复核结果：33 个已存在代码/测试路径、2 个明确声明的拟新增文件、8 个 npm 命令、15 个验收编号、两份交付文档的 5 个相对链接均通过机械检查，快照 Worker 路径错误已改正。主任务以固定输入调用当前真实函数，独立复现“同棒修正版本不变”“实际收据丢失”“辅助周期覆盖主图 payload”三项问题；前轮 F1/F2/F3 亦重新复现，F3 输入已改用真实 `premium.values` 结构。这些结果证实后续修复用例可达，不是声称问题已修复。

记录为 `.artifacts/architecture-governance/closeout-check.json` 与 `findings.json`。两个探针各有 30 秒内部上限，正常退出，无网络/远程写入；`git diff --check` 通过。本次未改运行代码，因此复用第 6 节构建及 43 项 UI 证据；文档导航另按更新后的目录刷新检查。两路子审查已结束，未启动后台服务或遗留派生进程。
