# RES20｜存储计算与部署路线

研究日期：2026-09-16。本卷是独立基础研究，不要求匹配当前仓库；“建议/迁移启示”是本研究的推论，不是项目官方承诺。未运行候选代码。


## 1. 按访问模式而非数据名选存储

市场原始事件是高写入/可回放资料，报告与观点是较低量版本对象，用户设置是事务配置，长历史研究是批扫描。它们不一定都需要不同数据库，但应分别测量，不因都属于BTC就强行一个库，也不为每种表新建服务。

DuckDB适合嵌入式/批分析模式，Polars适合列式变换，D1有其容量和执行边界以及读副本能力。选择要用具体任务，不采用未经复现的厂商性能图。[EXT105｜DuckDB 并发文档](https://duckdb.org/docs/current/connect/concurrency.html) [EXT106｜Polars 当前仓库](https://github.com/pola-rs/polars) [EXT119｜Cloudflare D1 限制](https://developers.cloudflare.com/d1/platform/limits/) [EXT120｜Cloudflare D1 读副本](https://developers.cloudflare.com/d1/best-practices/read-replication/)

## 2. 三条完整路线

A是现有部署内的模块化演进：少量来源、定时分析、结果预计算与API；优点是新增运维少。B是一个采集或批计算服务输出文件/结果，由原网站消费；适合长期流或原生数值依赖，新增职责边界明确。C是传统后端为主体，数据、任务和API统一；只有规模、团队或现有跨边界复杂度证明有益才选择。

这三条并非按“低级到高级”排序。单人低频研究的最佳长期路线可能一直是A或B；传统后端也可以是模块化单体，不是必须Kafka/Kubernetes。

## 3. 文件底座的好处与代价

Parquet/JSON批次与manifest便于迁移和重算，但小文件数量、schema演进、分区裁剪、对象读取与权利清理都需设计。原始与标准层可采用不同保留期；恢复不是无限期保存一切。

一个受控写入/生成进程、可重建缓存和只读批研究是易理解的起点。DuckDB还有其他并发模式，应按官方对应版本核验；不能以旧认知一概宣称不支持，也不能把实验模式当稳定生产保证。

## 4. Cloudflare的实际判断

D1读副本可改善某些读路径，却不意味着每个查询都在同一个固定研究版本；Sessions提供的读一致性不是跨来源原子快照。出站WebSocket不能直接套用Durable Objects休眠成本模型。长任务CPU、墙钟、持久保留和触发方式分别核。[EXT120｜Cloudflare D1 读副本](https://developers.cloudflare.com/d1/best-practices/read-replication/) [EXT121｜Durable Objects WebSocket](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) [EXT122｜Cloudflare Workflows 限制](https://developers.cloudflare.com/workflows/reference/limits/)

本轮不重新给出未经需求量测的月成本。估算先记录平均/峰值事件量、字节、保留、查询扫描、模型工具次数和缓存命中，再套当时实际合同/官方单价。研发和日常运行预算分开，避免一次大回补吞掉整月额度。

## 5. 迁移验收

新旧路径使用同一数据窗口对照结果，切换一个能力而非整站。页面和导出用同一版本；旧报告ID、来源回退标记与权限保持可解释。失败能退回旧读路径，但不能恢复已经认定误导的语义。

性能验收必须包含冷缓存、重启恢复、失败重试和典型峰值，不只热内存单次查询。没有数据量、费用和使用负载时，架构推荐只能有前提，不能承诺迁库必要或稳定性提升。


## 证据与进一步核验

[EXT105｜DuckDB 并发文档](https://duckdb.org/docs/current/connect/concurrency.html) [EXT106｜Polars 当前仓库](https://github.com/pola-rs/polars) [EXT119｜Cloudflare D1 限制](https://developers.cloudflare.com/d1/platform/limits/) [EXT120｜Cloudflare D1 读副本](https://developers.cloudflare.com/d1/best-practices/read-replication/) [EXT121｜Durable Objects WebSocket](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) [EXT122｜Cloudflare Workflows 限制](https://developers.cloudflare.com/workflows/reference/limits/)

