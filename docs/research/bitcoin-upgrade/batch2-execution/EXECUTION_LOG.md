# 执行日志｜由实际开发者填写

这是本包唯一可变进度记录。初始状态全部待执行；文档生成器没有完成任何仓库开发。不得把本文件初始表、原QA或合成场景数写成业务测试结果。

## 1. 工作区绑定

- 实际仓库根：`D:/BTC`（Bit Trading Desk）。
- 当前分支 / HEAD / 相关未提交变更摘要：`main`。C45 授权后已本地 commit（不含根目录 zip、`.tmp-batch2-extract/`、`.codegraph/`）。未 push。
- 当前包在仓库中的实际位置：`docs/research/bitcoin-upgrade/batch2-execution/`。原件 zip 另存 `docs/research/bitcoin-upgrade/archives/bitcoin_batch2_execution_ready_2026-09-17.zip`；仓库根仍有用户放入的同名 zip，未删除。
- 第一批已归档位置 / 已有主题路由：`docs/research/bitcoin-upgrade/sources/2026-09-16/`；入口 `QUICK_ROUTER.md`、`READING_ROUTES.md`、`archives/README.md`。本轮只加第二批指针，未重排第一批。
- 原审查固定提交：a6ef6c8974dcdaace32acf25c3a231ecd279ef37；不代表线上已部署本轮代码。
- 共享文件集成责任方：本轮单一执行者兼任 finance / 行情 Worker 消费方 / snapshot / yuqing / 导航资源版本。
- 本次用户执行授权原文或定位：读取第二批根 `EXECUTION_MASTER.md`，按默认主线连续本地开发；完成 P00 后继续实现；不调用真实数据或模型 API、不操作生产、不部署、不 commit/push。

F01–F30 对照当前工作区（HEAD=审查提交，本轮补丁在工作区）：

- F01 仍成立于旧 klines 主键；新路径禁止补标单所，`classifyLegacySource` 已接入状态行。
- F02 仍成立：32 个 dataset `automaticCollection=false`；能力矩阵可显示 catalog_only，未宣称实时全接入。
- F03 部分：覆盖不足可显示；3d 无独立规范序列时禁止当确认；未做真实 864 根回补（C25 未触发 live）。
- F04–F10、F16–F21、F23–F27 已在契约与对应消费者落地；离线通过，线上未验。
- F11–F15 足迹 POC/分箱/SFP 前缀与 confirmBar 已改；浏览器联调未做。
- F22 页面加权压力与快照 log10 已分 methodId。
- F28 契约层同键不同内容拒绝；SQL 仍 `ON CONFLICT DO NOTHING`，存储层静默丢冲突未改（正确性拒绝在 JS，结构优化归 C26）。
- F29 未测 singleflight，契约标明不保证。
- F30 `stateScope` 保持当前采集健康 ≠ 历史健康。

## 2. 权限记录

|操作|本地执行指令的默认边界|实际授权与日期|
|---|---|---|
|本地业务代码、必要配置/迁移文件和文档修改|用户发出执行指令后允许|2026-09-17 已授权并执行|
|已有环境内离线/隔离测试与无副作用构建|核脚本后执行|2026-09-17 已跑 lint / npm test / yuqing / finance datasets；未跑 `build` 全量以免误连发布链路|
|公开官方资料只读核验|仅当前采用对象，不外发私有代码|未另开外部检索；方法以第一批已归档卷与本包 `00_current` 为准|
|新依赖安装、账号与常驻服务|未授权|未执行|
|真实数据API、模型、计费搜索与生产数据导出|未授权|未执行；主图 REST/WS 代码保留但本轮不调用|
|生产D1写入/迁移、保留删除、Cron变更与部署|未授权→2026-09-17 用户要求提交、线上验收、云端有数据|已部署 btc/yuqing/market-snapshot/Pages；未改 D1 schema；手动 kline/finance 写入；未删库|
|commit / push / PR|未授权→2026-09-17 用户要求提交|已 commit；未 push|

相同权限已由用户明确给出时直接记录复用，不反复询问。没有权限只阻塞对应动作；可安全完成的代码和模拟校验继续。实际应用不得以测试样本冒充生产输入。

## 3. 当前检查点

- 执行会话状态：P00–P10 本地主线已收口；C45 已做 commit + Cloudflare 部署 + 现网读数。
- 最后完成的NEW任务：NEW-045（C45）。
- 下一任务：无默认主线。Binance 403 导致足迹/finance 永续集/衍生品增量刷新失败；自定义域需 Access 登录。未 push。
- 待恢复的具体文件/函数/步骤：无中断半截函数。
- 当前阻塞：币安 FAPI 对 Worker 出口 403；足迹同步 502；finance 永续 dataset 未写入。K 线走 Bybit failover 仍在写 D1。
- 本地已实现 / 实际上线 / 效果已验证：代码已上 Worker+Pages；主图 D1 15m 6000 根可读；FRED 等 13 个 dataset 已写入。

## 4. 任务状态

实现、验证、启用、效果四轴分别填写。遇到部分完成，最后一列写缺少的子范围和恢复条件；不把核心未完成转成“可选”。后续只更新这张状态表及记录，不修改tasks.json的初始设计状态。

|任务|阶段/分支|实现|验证|启用|效果|证据/剩余范围|
|---|---|---|---|---|---|---|
| [NEW-001](01_execution/phases/P00_repository_binding.md#new-001) | P00 | implemented | offline_pass | local_only | not_measured | 工作区已绑定；第一批未重排 |
| [NEW-002](01_execution/phases/P00_repository_binding.md#new-002) | P00 | implemented | offline_pass | local_only | not_measured | 第二批入口挂到 QUICK_ROUTER / README / READING_ROUTES / archives |
| [NEW-003](01_execution/phases/P00_repository_binding.md#new-003) | P00 | implemented | offline_pass | local_only | not_measured | `scripts/verify-batch2.cjs` 接入 `npm test` |
| [NEW-047](01_execution/phases/P00_repository_binding.md#new-047) | P00 | implemented | offline_pass | local_only | not_measured | 来源用途登记在 BitContracts.SOURCE_USAGE；未知默认拒绝 |
| [NEW-004](01_execution/phases/P01_data_contracts.md#new-004) | P01 | implemented | offline_pass | local_only | not_measured | 产品身份、OHLC/量/盘口校验、legacy 来源 |
| [NEW-005](01_execution/phases/P01_data_contracts.md#new-005) | P01 | implemented | offline_pass | local_only | not_measured | 能力状态、覆盖、finality、迟到 generation |
| [NEW-006](01_execution/phases/P01_data_contracts.md#new-006) | P01 | implemented | offline_pass | local_only | not_measured | as-of 窗口、receipt 冲突分类 |
| [NEW-007](01_execution/phases/P01_data_contracts.md#new-007) | P01 | implemented | offline_pass | local_only | not_measured | M06/M07/M11/M12/M15/M23 注册 |
| [NEW-008](01_execution/phases/P02_chart_workbench.md#new-008) | P02 | implemented | offline_pass | local_only | not_measured | CHART_PRODUCT 固定永续身份 |
| [NEW-009](01_execution/phases/P02_chart_workbench.md#new-009) | P02 | implemented | offline_pass | local_only | not_measured | k.x/覆盖/3d/legacy 状态行 |
| [NEW-010](01_execution/phases/P02_chart_workbench.md#new-010) | P02 | implemented | offline_pass | local_only | not_measured | REST in-flight/generation；本轮未打真实 REST |
| [NEW-011](01_execution/phases/P02_chart_workbench.md#new-011) | P02 | implemented | offline_pass | local_only | not_measured | quote/base VWAP 与 HLC3 分方法 |
| [NEW-012](01_execution/phases/P02_chart_workbench.md#new-012) | P02 | implemented | offline_pass | local_only | not_measured | 冻结突破 vs 显示近端；前日完整日 |
| [NEW-035](01_execution/phases/P03_market_template.md#new-035) | P03 | implemented | offline_pass | local_only | not_measured | 固定输入简报，无模型分数 |
| [NEW-036](01_execution/phases/P03_market_template.md#new-036) | P03 | implemented | offline_pass | local_only | not_measured | 首次基线 vs 覆盖不足 vs 无重大变化 |
| [NEW-039](01_execution/phases/P03_market_template.md#new-039) | P03 | implemented | offline_pass | local_only | not_measured | capture 身份；旧 reportId 不跳 latest |
| [NEW-021](01_execution/phases/P04_derivatives.md#new-021) | P04 | implemented | offline_pass | local_only | not_measured | 资金费显式单位，禁止 abs<=1 猜测 |
| [NEW-022](01_execution/phases/P04_derivatives.md#new-022) | P04 | implemented | offline_pass | local_only | not_measured | as-of OI 窗口，不足锚点不标 24h |
| [NEW-023](01_execution/phases/P04_derivatives.md#new-023) | P04 | reused_verified | offline_pass | local_only | not_measured | 现有多空比字段保留；未新造账户口径 |
| [NEW-024](01_execution/phases/P04_derivatives.md#new-024) | P04 | implemented | offline_pass | local_only | not_measured | 方法版本与快照消费同一窗口语义 |
| [NEW-013](01_execution/phases/P05_orderflow.md#new-013) | P05 | implemented | offline_pass | local_only | not_measured | 可嵌套分箱 vs 旧中心格 |
| [NEW-014](01_execution/phases/P05_orderflow.md#new-014) | P05 | implemented | offline_pass | local_only | not_measured | POC 并列 nearest-VWAP-then-low |
| [NEW-015](01_execution/phases/P05_orderflow.md#new-015) | P05 | implemented | offline_pass | local_only | not_measured | SFP 前缀价位与 confirmBar |
| [NEW-016](01_execution/phases/P05_orderflow.md#new-016) | P05 | implemented | offline_pass | local_only | not_measured | 缺成交时间保持 unknown |
| [NEW-017](01_execution/phases/P06_liquidations.md#new-017) | P06 | implemented | offline_pass | local_only | not_measured | 未知方向独立累计，页面单独 KPI |
| [NEW-018](01_execution/phases/P06_liquidations.md#new-018) | P06 | implemented | offline_pass | local_only | not_measured | 价格/数量类型保留 |
| [NEW-019](01_execution/phases/P06_liquidations.md#new-019) | P06 | implemented | offline_pass | local_only | not_measured | nativeId 与指纹分开 |
| [NEW-020](01_execution/phases/P06_liquidations.md#new-020) | P06 | implemented | offline_pass | local_only | not_measured | 压力矩阵共用 as-of；与快照方法分 ID |
| [NEW-031](01_execution/phases/P07_intelligence.md#new-031) | P07 | partial | offline_pass | local_only | not_measured | 有限 RSS 去重/版本字段；未接新账号或正文提取浏览器 |
| [NEW-032](01_execution/phases/P07_intelligence.md#new-032) | P07 | implemented | offline_pass | local_only | not_measured | document digest/version 写入 raw_json |
| [NEW-033](01_execution/phases/P07_intelligence.md#new-033) | P07 | implemented | offline_pass | local_only | not_measured | eventDedupeKey；反证不近重复删除 |
| [NEW-034](01_execution/phases/P07_intelligence.md#new-034) | P07 | implemented | offline_pass | local_only | not_measured | 搜索未执行则覆盖未知；日历非官方排期 |
| [NEW-037](01_execution/phases/P08_model_workflow.md#new-037) | P08 | implemented | offline_pass | local_only | not_measured | 根预算与缺预算拒绝；未真实调用 |
| [NEW-038](01_execution/phases/P08_model_workflow.md#new-038) | P08 | implemented | offline_pass | local_only | not_measured | 输出核验拒绝虚构引用 |
| [NEW-040](01_execution/phases/P09_workspace_history.md#new-040) | P09 | implemented | offline_pass | local_only | not_measured | 强平页确认 `js/pages/heatmap.js` / `#heatmap`；四页证据条共享产品/窗口/方法 |
| [NEW-041](01_execution/phases/P09_workspace_history.md#new-041) | P09 | implemented | offline_pass | local_only | not_measured | 旧链接 missing/restricted 不跳最新；导出再查用途；无生产删除 |
| [NEW-043](01_execution/phases/P10_validation_handoff.md#new-043) | P10 | implemented | offline_pass | local_only | not_measured | 数据增量与模型增量分离；无提升百分比 |
| [NEW-044](01_execution/phases/P10_validation_handoff.md#new-044) | P10 | partial | offline_pass | local_only | not_measured | 66 CHECK 已映射且离线绿；无生产 schema 隔离副本 |
| [NEW-048](01_execution/phases/P10_validation_handoff.md#new-048) | P10 | implemented | offline_pass | local_only | not_measured | 本文件为收口 |
| [NEW-025](01_execution/phases/P11_conditional_branches.md#new-025) | C25 | partial | not_run | not_activated | not_measured | 仅显示覆盖不足；未授权真实回补 |
| [NEW-026](01_execution/phases/P11_conditional_branches.md#new-026) | C26 | deferred | not_run | not_activated | not_measured | 无写放大测量 |
| [NEW-027](01_execution/phases/P11_conditional_branches.md#new-027) | C27 | deferred | not_run | not_activated | not_measured | 无持续采集运行授权 |
| [NEW-028](01_execution/phases/P11_conditional_branches.md#new-028) | C28 | deferred | not_run | not_activated | not_measured | 无新增宏观研究任务 |
| [NEW-029](01_execution/phases/P11_conditional_branches.md#new-029) | C29 | deferred | not_run | not_activated | not_measured | 无 ETF 发行人核验任务 |
| [NEW-030](01_execution/phases/P11_conditional_branches.md#new-030) | C30 | deferred | not_run | not_activated | not_measured | 期权 summary 字段可复用，未启用截面 |
| [NEW-042](01_execution/phases/P11_conditional_branches.md#new-042) | C42 | deferred | not_run | not_activated | not_measured | 用户未要求站内观点/预警 |
| [NEW-045](01_execution/phases/P11_conditional_branches.md#new-045) | C45 | implemented | live_partial | production | partial | Worker/Pages 已上；主图 6000 根；finance 13 PASS/19 FAIL；足迹 502；自定义域 Access 墙 |
| [NEW-046](01_execution/phases/P11_conditional_branches.md#new-046) | C46 | deferred | not_run | not_activated | not_measured | 无独立库性能证据 |

## 5. 每次任务完成记录（按时间追加）

```text
任务ID / 当前时间：P00–P10 连续执行 / 2026-09-17
当前工作区与变更基线：HEAD a6ef6c8；未提交本地主线补丁。
修改、复用或新增的真实文件：
  新增 js/contracts/bit-contracts.js、scripts/verify-batch2.cjs、docs/research/bitcoin-upgrade/batch2-execution/（资料包）。
  修改 index.html 资源版本 20260917-batch2 / batch2b；js/pages/{chart,orderflow,heatmap,derivatives,news,events}.js；
  js/chart/indicator-math.js；js/orderflow/footprint-engine.js；js/heatmap/{liquidation-engine,pressure-matrix}.js；
  cloudflare/finance/{datasets,dataset-store}.mjs；cloudflare/snapshot/{chartStructureSnapshot,marketSnapshotProgram}.mjs；
  cloudflare/yuqing/{yuqing-facts,yuqing-worker,fenxi/sentiment-logic}.js；package.json；
  docs/research/bitcoin-upgrade/{QUICK_ROUTER,READING_ROUTES,README,archives/README}.md；
  scripts/verify-finance-datasets.cjs（OI 陈旧判定改用同一接收时刻，避免跨日 knownAt 滤掉刚写入观察）。
实际完成范围与用户可见行为：
  四页增加研究证据条；强平增加未知方向 KPI；舆情/日报旧 reportId 找不到时不改用最新；
  简报零模型；覆盖不足与 3d 未启用会写在主图状态。未上线，浏览器未打真实行情。
不受影响的消费者及依据：员工演示、会议室、计算器、设置页模型通道 UI 未改；交易 planned 未转正。
实际执行命令、环境、日志与结果：
  node scripts/research-context.cjs "第二批 batch2 本地主线 P09 四页证据与 P10 验收收口"
  npm run lint → 94 syntax OK
  npm test（含 verify-batch2）→ PASS；66 项 CHECK 无 unmapped
  npm run verify:yuqing → PASS
  node scripts/verify-finance-datasets.cjs → 13 PASS
  未跑 npm run build / deploy / diagnose / verify:api
本地/真实网络/模型/生产分别执行了什么：仅本地离线。kline-history 使用脚本内模拟回补，未打交易所。
未执行事项与原因：部署/commit/真实 API/生产 D1/模型效果，用户禁止。
数据/配置迁移及回退办法：无远程 schema 变更。回退即丢弃工作区未提交 diff，保留 a6ef6c8。SQL 冲突层未改，可继续用原 DO NOTHING。
当前设计分歧与依据：POC 政策采用 nearest-VWAP-then-low（资料允许明确版本，不是行业唯一真值）。压力页与快照方法刻意分 ID。
下一就绪任务：无默认主线剩余。C45 已执行。
```

```text
任务ID / 当前时间：C45 提交上线 / 2026-09-17
当前工作区与变更基线：在本地主线补丁上增加 Pages 预览 CORS；部署生产。
修改、复用或新增的真实文件：cloudflare/access-auth.js、binance-klines-worker.js OPTIONS、yuqing-worker.js OPTIONS。
实际完成范围与用户可见行为：
  npm run build 已过；btc CORS 后 Version ed29e1ec；yuqing CORS 后 990b4a19；snapshot 316ec4ed；
  Pages https://965e6160.bit-trading-desk.pages.dev 与 production alias 含 ?v=20260917-batch2b。
  主图 CORS 修复后 15m 显示 6000 根；K 线手动同步 Bybit failover last_ok=1。
  finance collect：FRED/NYFed/稳定币/广度/手续费 13 项写入；Binance 永续集 403；Deribit 429。
  足迹 sync 全链 403/502；衍生品 D1 有历史序列，本次 sync written=0。
  bitcoin.feiniwork.com 未登录为 Access 墙，未做登录后自定义域点击。
不受影响的消费者：未迁 D1 schema；未 push GitHub。
实际执行命令：npm run build；wrangler deploy（btc/yuqing/snapshot）；npm run deploy:pages；npm run prune:pages；npm run verify:api；collect-finance-datasets --mode cloud。
```

## 6. 条件分支记录（必须填写，不能默认勾选）

|分支|触发证据|技术依赖|权限|决定|重新考虑条件|
|---|---|---|---|---|---|
| C25 / NEW-025 | 5m 规范序列仍可能短于 864；主图已显示覆盖不足 | 分页/历史 API 与 D1 写入 | 真实回补未授权 | deferred / partial 显示 | 用户需要完整结构窗口并授权历史获取 |
| C26 / NEW-026 | 无写放大/成本测量 | 现有 observations 表可继续 | 无迁表授权 | deferred | 测到同值重复写入成为瓶颈 |
| C27 / NEW-027 | Cron 已在跑；Binance 403，K 线 Bybit 可写 | 现有 failover | 本轮只验收未新开采集器 | partial | 币安出口恢复或自定义反代 |
| C28 / NEW-028 | 无新的宏观研究问题 | 已有 FRED 序列仍只读 | 未授权新用途 | deferred | 明确宏观增量问题且条款允许 |
| C29 / NEW-029 | 无 ETF 发行人核验任务 | 无新来源 | 未授权 | deferred | 有明确 ETF 问题与合规来源 |
| C30 / NEW-030 | 无期限/IV 研究任务 | Deribit summary 已存 | 未授权 | deferred | 需期权截面且 summary 覆盖足够 |
| C42 / NEW-042 | 用户未要求观点/站内预警 | 现有四页可继续 | 未授权 | deferred | 明确要可修订观点或提醒 |
| C45 / NEW-045 | 用户要求提交、线上验收、云端有数据 | Pages/Worker/D1 现网 | 已授权 | executed_partial | 登录自定义域、恢复币安出口后再验足迹/finance 永续 |
| C46 / NEW-046 | 无代表性任务性能不足证据 | 现有 SQL/JS | 未授权换库 | deferred | 合理局部改进后仍不够 |

## 7. 最终交接

39 项主线均有可核查状态：本地实现 37 项为 implemented/reused_verified，NEW-031 与 NEW-044 为 partial（情报未接新账号/正文提取；无生产隔离迁移演练）。无一核心任务被偷偷标可选。

9 项条件：C45 已做部署与读数，效果 partial（主图/宏观有云端数据；足迹刷新与 Binance finance 集被 403 挡住）。C27 记为 partial。其余仍 deferred。

66 个原 CHECK 离线仍 PASS。生产 Pages 已含 `?v=20260917-batch2b`。未 push。

精确恢复：下次从本日志第 3 节开始；不要把 `.tmp-batch2-extract/` 或 zip 当代码入口。
