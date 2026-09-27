# Cloudflare 费用治理后的正确性修复依据（2026-09-26）

- 问题：减少重复采集和写入后，如何保持断流恢复、收盘确认、历史连续性与 knownAt 回看语义。
- 查询日期：2026-09-26。适用对象：本仓库 BTC Worker、Cloudflare SQLite Durable Objects、D1 规范观察表，Wrangler 4.85.0；不是交易策略或其他项目的默认规则。
- 本轮用户已要求修复对抗审核发现的问题并完成上线收尾；以下记录区分官方事实、代码反例与实施决定。部署结果在本轮收尾记录中核对，不以本文代替验证。

## 来源与核验事实

- [Cloudflare DO 内存状态](https://developers.cloudflare.com/durable-objects/reference/in-memory-state/)：对象重建后内存不能作为恢复事实；缺口游标和确认代次必须有持久依据。
- [Cloudflare SQLite 存储 API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)：同步 SQL 可用于已有 SQLite 类；cursor 应在 await 前消费，事务使用 storage.transactionSync 等 API，不能用 SQL BEGIN 代替。
- [D1 batch 事务](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch)：批次内语句顺序执行，失败回滚整个批次。宏观前驱比较与后继恢复必须在这次事务内依据当前数据库决定，不能由较早的 JavaScript 查询决定哪些值可以省略；两个 Worker 的交错提交反例已纳入测试。
- [FRED realtime period](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html)：默认 realtime_start 与 realtime_end 为当日。[Observation 参数](https://fred.stlouisfed.org/docs/api/fred/series_observations.html)的 output_type 默认为 1，vintage_dates 默认不指定。默认查询日不能无条件解释为经济数值发生了新修订。
- [Wrangler 命令入口](https://developers.cloudflare.com/workers/wrangler/commands/)指向 Workers 部署命令；本仓库使用本地安装，保留既有配置和远程变量，不升级兼容日期或变更绑定。
- [DO 价格](https://developers.cloudflare.com/durable-objects/platform/pricing/)、[D1 价格](https://developers.cloudflare.com/d1/platform/pricing/)、[Workers 价格](https://developers.cloudflare.com/workers/platform/pricing/)用于费用模拟。模拟不等于硬预算开关，账号其他项目与现有账期使用量仍会影响账单。
- Binance 的旧 Kline 文档链接在本次查询时重定向至新版目录，但工具未获取参数正文；不据此声称新的分页上限。本轮保留项目已验证请求契约和来源，利用实际接口只读比较及现有离线测试验证有界回查。
- [Binance USD-M 市场数据](https://developers.binance.info/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data)：标记价格的 nextFundingTime 与 funding-info 的 fundingIntervalHours 用于核对结算时间，不能把已结算事件套用实时行情的固定年龄阈值。线上 14:03 UTC 核验到 fundingTime 为 08:00:00.001、nextFundingTime 为 16:00、实际报告间隔为 8 小时；这里的 8 小时来自该次来源记录，不是通用默认值。
- [Cloudflare 删除 Pages 部署 API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/delete/)：默认删除保留别名保护，force 参数允许强删部分原本受保护的非生产别名部署；本项目使用 force=false。安装的 Wrangler 4.85.0 实际代码在非交互确认缺失时取消删除但退出码为零，因此不能只依据 CLI 退出码报告清理完成。

## 原始资料摘录快照

- 2026-09-26，Cloudflare SQLite API：原文短摘录为 “Consume cursors synchronously”。上文其他内容为本地归纳。
- 同日，FRED realtime period：原文短摘录为 “On almost all URLs, the default real-time period is today.”
- 同日，FRED observation output_type：原文短摘录为 “integer, optional, default: 1”。查询语义不能当作真实发布日期。
- 2026-09-21 的仓库资料原件保持不变：[工作台方案](workbench-binance-data-plan-2026-09-16.md)、[云端库治理](cloud-d1-desk-governance-2026-09-21.md)。它们对独立收据与宏观去重的表述不同，本次以保留 knownAt 与真实修订的可观察行为为准，用轻量收据分离重复载荷。

## 当前代码反例与修复决定

- 断流后新尾部已写入、补缺前 DO 重建：仅从 MAX(t) 初始化会跳过旧缺口。持久保存最早未完成位置和代次；旧确认不得清除新断流。
- 收盘前发出的 REST 响应跨收盘边界返回：按响应时钟判闭合会覆盖 WS 最终值。固定请求时截止，并对写入顺序与期间更新作一致性保护。
- 尾页先入库后完整补采失败：最新点不能证明中间完整。缺口边界独立保留，只有实际覆盖验证成功才能清除。
- 批量回查不能丢掉已存在的交易所收盘证据；证据必须不晚于本次收据，避免向历史 knownAt 泄露未来信息。
- 图表优先读取的原始 K 线表需要有界闭合窗口核对，不能仅修规范表。已有差异用同源数据核对后修复，不清库、不替换交易所。
- FRED 默认查询窗口变化不再复制全部不变载荷；查询收据与真实值/修订分开。迟到写入按时序前驱和后继验证，A→B→A 及原先收据可见状态必须保留。
- 费用模型计入故障补采存储、三路积压删除、强平 seed 及本轮新增恢复/核对开销。保留当前频率和 32 个规范数据集。
- 最终线上检查发现旧合约组把所有卡共用 6 小时阈值：当已结算资金费年龄超过 6 小时，连实时标记价格也被隐藏。改为按卡保留可信数据，将采集过期、源数据过期与数据缺失分开；资金费结合来源报告周期和下一结算时间，未知周期不默认 8 小时。传入 now 统一决定时钟，增加跨结算、缺结算及短时采集延迟回归。
- 14:09 UTC 的状态读回确认 8 个 FRED 失败项目反复被选择，正常 funding/basis 仍停在 13:39 收据：只按最后成功时间排序会让失败源持续占满每轮 8 个名额。失败候选改用最近尝试时间公平排队；仍按原成功时间决定到期，保持原频率与每轮 8 个名额，不降低正常来源的采集频率。多轮故障、其他来源推进与恢复纳入实际调度回归。
- 发布日志曾重复报告相同旧部署已删除；核对 CLI 取消语义后，清理改为分页读取、按真实创建时间保留每环境最新 8 条及所有活跃别名/正式指针，删除前重新核对目标并使用 force=false，回查确认 ID 消失才报告已删除。此操作只涉及旧静态部署，不影响 D1 或行情历史。

## 关联代码与验证

- 采集：`cloudflare/kline-live-collector.mjs`、`cloudflare/binance-klines-worker.js`；DO 本地恢复状态与 Cron/手动补采路径共同核对。
- 历史：`cloudflare/finance/scheduler.mjs`、`dataset-store.mjs`、`datasets.mjs`；共享读侧、desk 与历史时点查询要保持一致。
- 合约时间与展示：`cloudflare/finance/desk.mjs`、`scripts/verify-desk-assembly.cjs`、`scripts/verify-cost-governance-ui.cjs`；可信陈旧数据不得变成缺失，也不得被标成实时。
- 模拟：`scripts/simulate-cloudflare-governance.cjs`；网络禁止的 SQLite 重放与明确的独立压力情景。
- Pages 运维：`scripts/prune-pages-deployments.cjs`；只读预览、别名保护、分页、失败退出与删除后回查共同验证。
- 验证：真实 SQLite 故障回归、`npm run build`、部署后的 `npm run verify:api`、7 周期 desk/两路强平/足迹/宏观读口，以及修复前后已收盘棒同源比对。
- 限制：短时行情接口成功和短样本写入间隔不证明长期稳定；费用模拟不能承诺固定账单。无需远程 schema 迁移，保留已部署版本作为代码回退点，不以回退代码撤销已经核实的数据修正。
