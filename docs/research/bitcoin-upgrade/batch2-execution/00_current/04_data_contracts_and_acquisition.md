# 04｜数据底座：从已接入API到可供四页与分析共同消费的事实

**当前代码基线：a6ef6c8；设计日期2026-09-17。** 本卷不要求替换全部旧表。最小目标是把已存在的规范数据变成可信、持续、带范围的数据产品，并让四页只通过同一语义读取。

## 1. 数据状态不得压成一个connected

为每个数据集登记以下独立状态：接口已登记；凭据是否配置；最近一次实际成功观察；历史覆盖；持续采集是否运行；当前消费者是否启用；允许用途是否确认。当前`datasetCatalog`已经明确未自动采集和未接前端，新的状态页应读取这些事实，不把32个目录条目画成32个实时绿灯。[C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1)

推荐将状态拆成`configuration、transport、content、coverage、freshness、usage`。有HTTP200但正文错误是内容失败；有旧数据但刷新失败是可读旧版本；合法空结果与结构错误不同；无强平事件不等于流失效。任何绿灯必须说明它证明的是哪一个维度。

## 2. 统一外壳，不抹平来源语义

建议核心结果外壳为：

```json
{
  "schema_version":"market-observation.v1-design",
  "dataset_id":"binance-perp-klines-5m",
  "instrument_id":"BINANCE:USDM:BTCUSDT:PERPETUAL",
  "observation_key":"example-window",
  "event_at":null,
  "window":{"start_at":"2026-09-16T00:00:00Z","end_at":"2026-09-16T00:05:00Z"},
  "received_at":"2026-09-16T00:05:02Z",
  "source_available_at":null,
  "capture_id":"synthetic-cap-1",
  "source_revision":null,
  "finality":{"status":"unknown","basis":"no-native-confirmation-in-input"},
  "quality":{"status":"qualified","reasons":["PUBLICATION_TIME_UNKNOWN"]},
  "values":{},
  "units":{},
  "native_fields":{},
  "example_only":true
}
```

这是拟议外壳，不是已有HTTP响应。应优先映射`finance_dataset_observations`的现有字段，并保留旧读取适配。`instrument_id`是设计名称，不假装交易所提供同名字段。来源对象ID、合约规格版本、价格类型、数量类型应根据实际数据填写，未知不猜。

价格与金额跨API使用十进制字符串时，内部是否用浮点、定点或十进制库要由所需精度决定。BTC本任务不需要高频交易引擎，但也不能依赖显示四舍五入后的值继续计算。极长ID避免转成失真的JS Number；价格格可以采用整数tick索引以减少边界误差。

## 3. 三种时间加两种历史模式

事件时间解释发生或统计窗口；接收时间解释本系统何时看到；发布可用时间解释来源何时允许外部取得。入库时间和解析时间另外记录，不能替代前三者。

`system_observed`使用真实received_at过滤；`publicly_available_reconstruction`需要可信发布与当时版本；`retrospective_latest`允许使用最新版复盘，但不得当作实时回测。当前known_at属于第一种接收过滤，bootstrap只能证明导入时已知，不能证明2024年系统已知。[C06｜cloudflare/finance/dataset-store.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/dataset-store.mjs#L1) [E15｜FRED/ALFRED实时区间](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html)

观察窗口建议左闭右开。Binance不同端点的timestamp可能指期初或期末，适配器必须按官方方法注册成窗口而不是让所有消费者猜。OI历史的期末值与taker、basis的期初标签不应直接按相同毫秒进行JOIN。窗口整体完成与来源原生确认分别记录。[E02｜Binance USDⓈ-M REST市场数据](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data)

## 4. K线与状态的保真

标准K线保留OHLC、基础币量、报价币量、成交笔数、主动买入基础币量与报价币量、开闭时间、来源确认标记及其依据。已存在这些字段的新数据集可以直接作为迁移来源。不得只为兼容旧`t/o/h/l/c/v`而永远丢掉新增字段。[C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1) [C05｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L77)

最低验证包括：价格正数；high不低于open/close/low，low不高于open/close/high；量非负；笔数为非负整数；已知主动买入量在总量范围内；时间长度符合产品周期；重复主键内容不同有明确修订路径。成交额与基础量换算检查应允许来源统计和精度差异，不能硬要求OHLC近似均价等于真实VWAP。

原生WS的`x=true`是一个确认依据；REST请求发出于计划收盘以后，只能说明采集时机，不等价于收到该原生标记。最终性枚举建议至少区分`forming、time_elapsed_only、exchange_confirmed、unknown`；具体产品允许哪种状态参与研究由方法合同决定，不能要求所有REST永远不能使用，也不能都称交易所已确认。

## 5. 当前D1存储怎样演进

保留旧行情表服务兼容读取，新规范表先形成明确source/receipt链。不要让新研究重新写入来源不明的旧主键。若页面需要高效连续K线，可增加由规范表生成的投影，而不是再建立另一个独立采集真值。

现有按`dataset_id、observation_key、received_at`保存每次接收版本是有价值的，但每小时重取500条会重复保存大量未变化历史。优化应采用两层：接收批次记录保存“此时确实返回了哪些对象”，内容版本保存变化的载荷；批次与版本关系保留A→B→A。只按数值去重并覆盖接收时间会损失历史可见性，不采用。[C06｜cloudflare/finance/dataset-store.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/dataset-store.mjs#L1)

同一幂等键的内容摘要不同应返回冲突或隔离，不静默DO NOTHING。重试相同摘要可以返回已有结果。现有DO NOTHING只处理数据库主键重复，不能自动等同完整业务幂等。

本版不提供立即运行的生产ALTER脚本。实施者应先确认实际远程schema、数据量、索引和依赖，再决定追加列、侧表还是新投影；不能因为参考DDL存在就覆盖现有数据。

## 6. 采集与回补的最小状态机

建议逻辑阶段：`idle→scheduled→fetching→validating→persisted→available`。失败分别记录`access_restricted、rate_limited、transport_failed、invalid_payload、semantic_rejected、partial、cancelled`。这些可以是现有日志字段，不要求新调度平台。

游标只在必要产物持久化后推进。分页回补必须有范围、最大页数、已完成区间、重叠去重和停止理由。有限500点初始化不自动变成长期覆盖；对官方仅近30天/一个月的系列，错过的历史应记录永久缺口或选择授权历史，不由当前值插补。[E02｜Binance USDⓈ-M REST市场数据](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data)

新窗口迟到与旧窗口修订是两种任务：前者靠短回看窗口，后者需要来源变更机制或周期性受限复核。回补任务不能阻塞实时读取；页面显示当前可用数据和补齐状态，不假装所有历史整齐连续。

## 7. 持续币安采集的部署决策

仓库记录了本机与Cloudflare出口表现不同，并记录云端持续行情尚未恢复；这是历史测量，当前连通性未知。正式实施先做有限、只读且获准的连通性验证，分别记录REST状态、WS握手、有效市场消息、断线恢复和实际数据间隔，不只测TCP连上。[C02｜docs/research/bitcoin-upgrade/README.md（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/docs/research/bitcoin-upgrade/README.md#L1) [C03｜docs/research/workbench-binance-data-plan-2026-09-16.md（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/docs/research/workbench-binance-data-plan-2026-09-16.md#L1)

若Cloudflare不能持续取得要求的币安产品，可选：在合法可达且有维护责任的独立进程采集，通过认证的批次接口写入；采用合适授权的数据商；或用户明确选择另一个研究主市场。浏览器显示可用不等于云端采集可用，个人电脑偶尔在线也不等于常驻基础设施。

独立采集器最小必须有：产品白名单、状态持久化、有限重试、批次大小、幂等键、凭据隔离、断线与恢复记录、预算和停止机制。上传API接受已注册来源，不允许任意SQL或任意dataset冒写；服务端接收时间与采集端观察时间分开，防止采集机伪造历史known_at。

## 8. 频率与历史不是统一数字

| 类型 | 建议调度思路 | 必须保存的覆盖信息 |
|---|---|---|
| 交易/盘口 | 仅研究需要时持续；断线按协议恢复 | 序列、深度、消息时间、缺口及不能回补范围 |
| K线 | 活跃窗口更新，完成窗口复核，历史分段回补 | 预期窗口、完成状态、来源切换与修订 |
| OI/taker/ratio | 按端点实际统计频率，不将重复当前值造为新历史 | 期初/期末、实际步长、缺锚点 |
| 资金费 | 预测快照与实际结算分别调度 | funding_at、interval_hours、状态、规则版本 |
| 合约规格 | 低频获取并按变化登记，重要状态变化触发复核 | 有效区间、tick/lot、乘数、到期、交易状态 |
| 宏观/ETF | 发布日程、到齐状态和修订优先 | observation date、release、vintage、component completeness |
| 期权摘要 | 有限截面，先测整链取得耗时与截断 | snapshot_id、逐合约时间、返回总量、缺期限 |

本表是设计原则，不是已批准的Cron配置。实际刷新与保留数值由源限额、数据量和用户任务测量确定。

## 9. 质量门槛不能用一个百分数代替

方法输入声明必需数据族、最小样本、最大锚点误差、是否允许形成中窗口、允许来源和版本模式。质量返回逐项原因，例如`gap_in_window、wrong_product、stale_current_interval、unknown_price_type、truncated_snapshot`。只影响依赖该输入的计算，不让某个宏观源失败关闭所有价格页面。

覆盖有分母才能给比例。期权返回1000/1400可以报告截面返回比例，但不因此认为未返的400是随机缺失；交易所不保证全部清算事件时，不能生成“清算完整率99%”。HTTP检查成功率与市场事件覆盖率必须分列。

## 10. 页面、快照、模型与导出共同验收

每个消费者必须能显示来源、产品、窗口、方法与状态，至少在详情里完整可读。切换周期应创建新的选择身份，迟到请求不得覆盖新选择；缓存键不能只用BTCUSDT。模型只接收本次允许且封存的输入，不从另一个latest补相似字段。CSV/Markdown导出必须携带相同元数据，不能只导漂亮数值。

验收以一段合成/获准样本为起点：同源完整、混源、时间错位、缺失、迟到、修订、同幂等键冲突、旧receipt重放及source权限变化。记录哪些路径真实运行，哪些仍是设计。已有测试应追加边界，不因文档修订删除它们或以字符串匹配代替数值断言。
