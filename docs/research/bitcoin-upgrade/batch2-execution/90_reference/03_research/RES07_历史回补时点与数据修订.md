> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# RES07｜历史回补时点与数据修订

研究日期：2026-09-16。本卷是独立基础研究，不要求匹配当前仓库；“建议/迁移启示”是本研究的推论，不是项目官方承诺。未运行候选代码。


## 1. 历史数据库不是过去可见信息的同义词

研究至少区分四种时间：市场事件发生、来源发布、系统收到、数据后来修订。今天下载的历史文件可能已经修正，不能证明过去系统收到同样内容。Binance归档说明允许后续替换；ALFRED提供历史版本机制；Glassnode说明实体聚类等会改变历史。[EXT064｜Binance 公开归档README](https://raw.githubusercontent.com/binance/binance-public-data/master/README.md) [EXT069｜FRED/ALFRED Real-Time Periods](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html) [EXT062｜Glassnode Point-in-Time 指标](https://docs.glassnode.com/data/point-in-time-metrics)

建议每个研究任务明确模式：`system_observed`只用当时真实接收记录；`publicly_available`用可证明发布时间和对应版本重建；`retrospective_latest`允许最终修订数据但不能宣传当时可用。模式不可仅靠改一个标签互转。

## 2. 回补的可得性分类

OHLCV、聚合成交、原生成交、L2增量、OI统计、清算快照与期权截面是不同数据集。今天可查的接口不保证任意过去范围。Tardis等服务按交易所/symbol/channel声明覆盖，采购必须查看具体窗口而不是只看起始年份。[EXT126｜Tardis Deribit历史覆盖](https://docs.tardis.dev/historical-data-details/deribit)

回补计划先生成缺口清单，区分可从同源补回、可用另一来源但不可等同、只有低粒度历史、永久缺失。不能通过补零把所有缺口变成可计算；对比例指标还要检查分母覆盖，跨窗口累积指标遇缺口必须有重置或partial规则。

## 3. 分区与版本建议

保存采集批次ID、来源资源、请求参数、时间范围、行数、最早/最晚事件、校验和、解析器版本和coverage状态。上游同名文件变更产生新摄取版本，不覆盖已被报告引用的版本。manifest可记录“预期文件到齐”，但不能仅凭文件存在判定每笔市场事件完整。

增量游标负责推进新记录；旧记录更正需要回看窗口、修订feed或周期性指纹审计。dlt提供游标机制，却不能自动发现任意历史修订。[EXT084｜dlt 增量游标文档](https://dlthub.com/docs/general-usage/incremental/cursor)

## 4. 重放结果的两种稳定性

固定输入、规则和参数应该在规定精度内稳定；选择新版本输入后，允许得到不同结果。正确做法是差异归因：源数据更正、单位规则修正、方法升级或追加历史。错误做法是为了“不可变”拒绝更正，或为了“最新”静默改写旧结论。

源撤回或权利变化时，旧报告可能只能保留允许的元数据与不可恢复标记；审计一致性不能成为违反删除义务的理由。权利删除、研究版本和可重放等级需要分别表达。

## 5. 最小测试集

测试跨午夜、时区与夏令时、统计期末、微秒/毫秒、相同时间不同事件、边界重复、迟到、更正、来源回退以及缺一个交易所。以一个市场一个日期运行即可发现大量语义错误，无需先收集多年历史。

对账对象必须同口径：成交汇总与K线量不一致时先查时间边界、聚合、来源和特殊成交范围，不立即把差异都归为漏包。无法判断时保留原因候选，而不是“自动修复”成看似一致。


## 证据与进一步核验

[EXT064｜Binance 公开归档README](https://raw.githubusercontent.com/binance/binance-public-data/master/README.md) [EXT069｜FRED/ALFRED Real-Time Periods](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html) [EXT062｜Glassnode Point-in-Time 指标](https://docs.glassnode.com/data/point-in-time-metrics) [EXT084｜dlt 增量游标文档](https://dlthub.com/docs/general-usage/incremental/cursor) [EXT126｜Tardis Deribit历史覆盖](https://docs.tardis.dev/historical-data-details/deribit)

