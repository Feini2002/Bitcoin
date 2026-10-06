# D1 事故复盘：证据登记与官方资料摘录

查询日期：2026-10-05，北京时间。主结论、修订和执行边界以[复盘修复方案](../d1-cost-postmortem-repair-plan-2026-10-05.md)为准。本目录是可携带证据，不是执行远程 SQL 的指令。

## 现场原件

| 文件 | 采集方式与内容 | 限制 |
| --- | --- | --- |
| [dashboard-observed.json](dashboard-observed.json) | 已登录官方控制台；10月3日、4日GMT+8图表和查询表格逐字段转录 | B/M/k是界面约数；不是API整数导出；不含绑定参数 |
| [queries.json](queries.json) | 从当前实际 dataset-store 模块导出原SQL与公开合成参数 | 不是生产数据导出，不含认证信息 |
| [remote-schema.json](remote-schema.json) | 暂停库的schema、31条派生状态和原INSERT的EXPLAIN | 全为只读；版本函数被平台拒绝，未绕过；拒绝信息移除了账号路径 |
| [remote-select-probe.json](remote-select-probe.json) | 原/候选INSERT仅EXPLAIN；其SELECT部分实际只读执行，保留每条meta | 两类查询，5m暖态各一次；没有执行INSERT，不能替代完整D1事务验收 |
| [probe-sqlite-result.json](probe-sqlite-result.json) | SQLite 3.50.4内存合成数据，800/8,000/80,000行，原SQL冷/暖态 | VM步骤不是D1计费行；包含否定“所有引擎必然热扫描”的反证 |
| [equivalence-result.json](equivalence-result.json) | 两类原/候选SQL的12项合成等价和回滚检查 | 单连接SQLite，未覆盖真实D1并发 |
| [research-output-counts.json](research-output-counts.json) | 本机报告generatedAt与run endedAt分别转GMT+8计数，只保存汇总 | 包含真实开发验收，不等于独立观点数、生产效率或收益 |
| [adversarial-local-result.json](adversarial-local-result.json) | 当前真实采集方法、持久化SQL、图表接口在合成SQLite下故障注入；6项检查含4项反例 | 2项运行故障反例、2项方案预算/百分比反例；PASS表示反例被证实，不表示业务缺陷修复 |
| [adversarial-equivalence-result.json](adversarial-equivalence-result.json) | SQLite3.50.4的60项原/候选SQL对照，含精确合成输入与真实NOT NULL失败回滚 | 单连接；日期/前缀保持旧SQL行为，不是认可错误时间口径 |
| [adversarial-cross-engine-result.json](adversarial-cross-engine-result.json) | 同一60项在Node24.18.0/SQLite3.53.1复核，与旧引擎结果逐项相同 | 不是120项独立场景；不代替D1并发和计费验收 |
| [adversarial-sqlite-plans.json](adversarial-sqlite-plans.json) | 本机SQLite3.53.1原/候选INSERT字节码；原SQL快照与当前源码匹配 | 原canonical重现26→67→9历史循环，CASE先退出；不能据此鉴定线上版本 |

本轮执行监督日志位于本机 `.artifacts/d1-cost-review-2026-10-05/`及工具会话；成功和失败任务均已确认退出。初次workerd启动access violation，不能把该测试写为PASS。本目录不复制凭据、环境文件、用户报告正文或浏览器登录态。

## 官方资料摘录快照

以下保留短原文和核验要点；不是整站镜像。其余方案判断来自本项目源码、实测和复盘推理。

| 官方页面 | 原文短摘录 | 2026-10-05核验要点 |
| --- | --- | --- |
| [D1 Pricing](https://developers.cloudflare.com/d1/platform/pricing/) | “Rows read measure how many rows a query reads (scans)” | Paid每账期包含250亿读取行，超额$0.001/百万行；写行含修改和索引成本；账号账期共用，查询自身可计费 |
| [D1 Metrics and analytics](https://developers.cloudflare.com/d1/observability/metrics-analytics/) | “Bound parameters are not captured” | 平台有每语句实际行计数与SQL归组；31天指标保留，绑定值无法用于事后精确归因 |
| [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) | “Batched statements are SQL transactions.” | 官方描述失败会终止或回滚整个序列；本项目仍需真实约束失败验证bar/head/revision一并回滚 |
| [SQLite CASE](https://www.sqlite.org/lang_expr.html#the_case_expression) | “Both forms of the CASE expression use lazy, or short-circuit, evaluation.” | 候选依赖显式CASE分支短路，不能以AND条件书写顺序替代 |
| [SQLite EXPLAIN QUERY PLAN](https://www.sqlite.org/eqp.html) | 不作逐字引用 | 计划用于解释访问方式，实际读取量另行测量；不要仅匹配SEARCH字样验收 |
| [SQLite optimizer overview](https://www.sqlite.org/optoverview.html) | 不作逐字引用 | 优化器可改变实现路径；本地和线上必须分别核验；不据此猜测线上版本 |
| [Workers deployment management](https://developers.cloudflare.com/workers/versions-and-deployments/deployment-management/) | “Upload a version without deploying” | 版本上传可与部署分开；触发器另行管理；仅最近100个上传版本可部署；DO类生命周期改变不支持独立版本上传。查询日2026-10-05，适用本项目已有ES Module Worker，实际命令及配置还须在实施时核对 |
| [Gradual deployments with Durable Objects](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/with-durable-objects/) | “only one version of each Durable Object can run at a time” | 按DO实例分配版本；结合本项目固定BTCUSDT实例，推断百分比分流不能按比例压低该实例后台采集量。后半句是项目推断，不冒充原文结论 |
| [Version URLs](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/) | “existing configuration and resources” | 未部署版本的URL仍使用其绑定资源；不是隔离测试环境。必须保持生产预览关闭，不借候选URL探测生产D1/DO |

## 对照结果的可解释边界

- 原规范暖态只读查询扫描28,907行，候选1行；原raw扫描6,007行，候选1行。四条都返回空结果、0写行、changed_db=false。
- 原INSERT远程EXPLAIN显示“状态存在则跳至历史索引Next”，候选显示在历史循环之前退出。它支持主因机制，不是整天新版本已运行的证据。
- 先前Python所带SQLite3.50.4的原SQL在暖态短路；本次Node所带3.53.1已重现线上关键计划形态。反证限制到准确版本，不能笼统宣称“本机SQLite正常”。两套本机证据都不是D1计费计数。
- 第一次结构并行读取因被禁止的版本函数使总Promise提前失败；退出清理后，第二次逐项保留结果明确了仅版本函数拒绝，其余schema/状态/EXPLAIN成功。没有要求用户重登，也未尝试绕过函数限制。
- R5–R6未新增生产D1查询。成功与回滚均为内存数据库；故障由适配器在canonical语句前抛出，本地事务ROLLBACK真实执行；另60项回滚使用实际NOT NULL约束。没有把人为注入失败当成线上发生过的事故。

## R5–R6本地重现

在仓库根目录依次运行，均由有界监督器30秒硬收口，每轮观察不超过30秒。脚本只读当前业务源码并写本目录合成结果，不启动Worker服务、网络采集、模型或远程SQL；结果文件会更新到重现时的时间及本机引擎版本。实现修复后探针可能不再满足旧缺陷断言，应另存修后结果而非覆盖此次事故快照。

1. `node scripts/run-bounded.cjs 30 node docs/research/d1-cost-review-2026-10-05/adversarial-local-probe.mjs`：运行[编排与图表探针](adversarial-local-probe.mjs)，核对源码SQL快照及执行计划。本次最终进程26680，退出0，cleanup confirmed。
2. `node scripts/run-bounded.cjs 30 python docs/research/d1-cost-review-2026-10-05/adversarial-equivalence.py`：生成[60项输入和旧引擎结果](adversarial-equivalence.py)。本次最终进程31148，退出0，cleanup confirmed。
3. `node scripts/run-bounded.cjs 30 node docs/research/d1-cost-review-2026-10-05/adversarial-cross-engine.mjs`：在[新版引擎重放相同输入](adversarial-cross-engine.mjs)。本次进程30976，退出0，cleanup confirmed。

上述脚本是复盘材料，不接入生产构建或调度，不修改业务实现。旧式模块格式警告不影响本次离线结果，不为消除警告改变全仓package类型。

v6文档收尾检查：本地30个链接、11份JSON、7项发现及6轮记录一致；`node scripts/research-context.cjs --check`通过331个文件、25条路由、42个查询样例；`npm run lint`通过233项语法检查；本次相关路径`git diff --check`通过。以上是文档/语法证据，业务修复和真实D1并发验收仍未完成。检查命令退出0且监督器确认清理。
