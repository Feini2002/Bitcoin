> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# 卷 04｜行情、来源回退、足迹与强平的数据契约和迁移

本卷是拟实施规格。现有文件只按事实报告列明，新增表/字段/接口均为提议；必须先核查实际schema与消费者。目标是让当前已有数据产生可信分析，不先建设全市场原始事件湖。

本卷示例使用部分业务别名，正式API以卷10和contracts为准：price_kind→price_type，quantity_kind→quantity_type，value/value_kind→notional/notional_method，id_quality→identity_confidence；executed_size只有在来源定义为单次执行量时映射incremental_execution，否则保持legacy_unknown。示例中的example_only不进入正式市场记录。

## 1. 数据产品分层与最小持久单元

| 层 | 保存对象 | 主要用途 | 第一阶段是否需要 |
|---|---|---|---|
| source observation | 获准来源响应或足够重算的规范化输入、来源、时间、单位 | 解释本次观察来自哪里 | 选定报告输入需要，不要求所有tick |
| normalized market | K线、足迹桶、资金费/OI、强平观测、规格 | 权威数值分析 | 复用当前D1，逐链升级 |
| research snapshot | 本次选用的数据范围、哈希、方法、质量、来源覆盖 | 封存研究上下文 | 必须，先支持一份brief |
| derived metric | 输入版本＋方法版本＋结果 | 页面/报告共用 | 必须，禁止相同权威指标多份逻辑漂移 |
| research artifact | 解释、反证、观点、预警和结果 | 长期复盘 | 获准最小证据保留，不包含任意媒体全文 |

原始交易所事件是否长期保存由研究问题、费用和权利决定。没有原始逐笔的旧足迹仍可作为“已有价格档聚合”输入，不伪装成逐笔回放。当前桶和历史范围详见事实报告。[R06｜仓库事实报告§3 A1-A3，L62-90](../inputs/repository_facts.md) [R08｜仓库事实报告§4 B1-B2，L104-118](../inputs/repository_facts.md)

## 2. 通用时间语义

### 2.1 时间字段

所有输入至少区分：

- `event_time`：来源认为事件发生的时间，包含原始单位和时区声明。
- `source_published_at`：低频数据正式发布的时间；没有可靠证据则null。
- `received_at`：本系统接收到响应/消息的UTC时间。
- `stored_at`：持久化完成时间，不用于假装信息可更早获得。
- `period_start` / `period_end`：指标所描述窗口；统一内部左闭右开。
- `capture_started_at` / `capture_sealed_at`：本次跨源收集范围，不宣称外部接口原子一致。
- `as_known_mode`：`system_observed`、`publicly_available`或`retrospective_latest`，不能混写。

交易所字段的开盘时间、消息时间、期末OI时间、结算时间先保留原语义，再映射。不同接口可能毫秒或微秒，解码由来源版本契约决定，不单纯看数字位数。数值应与请求窗口、允许时钟差和单位做一致性检查；超出合理范围先隔离，而不是自动除以1000直到看起来像日期。[S002｜Binance 现货 WebSocket 协议](https://raw.githubusercontent.com/binance/binance-spot-api-docs/master/web-socket-streams.md) [S003｜Binance public-data README](https://raw.githubusercontent.com/binance/binance-public-data/master/README.md) [S005｜Binance USDⓈ-M REST 市场数据](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data)

### 2.2 “当时可见”的两个模式

`system_observed`要求received_at不晚于选定观测截止点，适合重放本系统真实收到的证据。旧数据没有received_at时不能回填为event_time。

`publicly_available`要求可信发布时点不晚于研究截止点，同时历史vintage正确；系统后来获取但能证明当时已公开的数据可以用于该模式，但须标为事后重建。若数据后来修订而无vintage，不能声称得到当时值。

`retrospective_latest`明确使用当前最新历史数据，适合某些描述/复算，不适合证明当时模型可知。页面、导出与报告必须带模式；基线评估不能混用三种模式。

### 2.3 未完成窗口

实时K线和当前5m桶可以显示为provisional，不默认进入已确认变化判断。完成状态不是仅由本地时钟超过period_end推断，还考虑来源更新/回补/确认标记。提前预览可以保留，但预警须声明使用provisional还是finalized，并区别“盘中触及”和“收盘确认”。

## 3. 数字、精度与单位

wire格式中价格、数量、名义金额及长ID建议使用十进制字符串。核心计算可以选已有正确的定点/decimal实现；若采用BigInt定标，必须按有效合约规格取得tick/lot，JSON输出仍为字符串。JS Number只用于在误差容差明确时的派生统计，不能直接决定去重ID或无解释地累加百万条小数。

`unit`不只写USD：例如`BTC`、`USDT`、`USD_notional`、`contract_count`、`rate_per_settlement`、`annualized_decimal`、`iv_percentage_points`。值0.05可能是5%、0.05%、5个基点，必须用scale与单位确定，禁止依赖前端乘100的习惯。

换算包含`valuation_price`、`valuation_time`、`valuation_source`与`conversion_method`。USDT价格按1美元近似仅在显式模式下允许，并标`assumed_peg`；脱锚时不可无标记合并。金额变化既可能来自数量也可能来自估值价格，解释时分开。

### 3.1 拟议Instrument规格

```json
{
  "instrument_id": "binance:spot:BTC:USDT",
  "venue": "binance",
  "market_type": "spot",
  "native_symbol": "BTCUSDT",
  "base_asset": "BTC",
  "quote_asset": "USDT",
  "settlement_asset": null,
  "contract_kind": null,
  "contract_multiplier": null,
  "price_tick": "0.01",
  "quantity_step": "0.00001",
  "effective_from": "2026-09-16T00:00:00Z",
  "effective_to": null,
  "spec_source_id": "example-only",
  "spec_version": "spec.example.1"
}
```

上例为人工演示，tick/lot不是本轮查询到的真实交易所规格，不得照填生产。现货、线性永续、反向永续、交割合约和期权分别有不同必填字段。期权增加expiry/strike/option_type、exercise/settlement定义，且instrument_id不依赖展示名称。

规格修改产生有效期新版本。历史计算按事件时间匹配规格；找不到适用版本则`spec_unknown`，不默用今天的乘数。下架/到期产品保留只读元数据，避免幸存者偏差。

## 4. 来源回退：保持服务可用，但不创造虚假连续性

### 4.1 现状与问题范围

报告记录K线获取可回退到Bybit/OKX，源信息未逐行保存在当前持久表。衍生品槽名含binance却可能装Bybit回退数据，但有元数据。这里的升级目标是明确来源和可比边界，不是声称回退本身不应该存在。[R07｜仓库事实报告§3 A4-A5，L92-102](../inputs/repository_facts.md)

### 4.2 两层ID

`instrument_id`代表真实市场，永远包含交易所与产品。`display_series_id`代表用户选择，例如“BTC主行情”，它引用一个版本化`source_selection_policy`，可有回退。二者不能混为一个主键。

同一时间Binance和BybitK线各自存为各自instrument。展示策略可选其中一个，但保留`selected_venue`和`selection_reason`。在来源切换处返回`segment_id`，跨段收益、均线、波动和历史预测默认不连算；需要混合序列研究时使用明确的 composite method，并单独验证价格差异/交易时段，不称原生单所指标。

### 4.3 回退状态机

```text
PRIMARY_HEALTHY
  ├─短暂失败 → PRIMARY_RETRYING（旧值标stale，不假实时）
  ├─超过有限预算 → FALLBACK_AVAILABLE（显示来源变化）
  └─无可用替代 → UNAVAILABLE
FALLBACK_AVAILABLE
  ├─主源恢复且检查通过 → PRIMARY_RECOVERED（新分段/记录）
  └─回退也失败 → UNAVAILABLE
```

切回不覆盖已封存报告。新研究可选择主源回补形成新的dataset revision；旧run继续指向原输入，UI可提示有新重算版本。回补的主源历史不是当时系统实际读到的历史，as_known_mode须保留区别。

### 4.4 旧数据迁移

旧行先导出或保留只读兼容访问；新增provenance_sidecar或规范化v2表。没有可信同时间日志的行标`legacy_unknown`。如果确有同步日志证明某段来源，记录推导来源和批次，不把推导伪装成原始逐行观测。

旧table不立即DROP，也不在巨大表上一次无界回填。按稳定范围/游标小批迁移，记录checkpoint、行数、输入校验和与异常。未来新写只采用一个owner，避免两套采集器同写旧新表而无法归因。

### 4.5 验收

固定样本包含主源成功、429、延迟、回退价格有偏差、主源恢复、同一旧时间回补。前端来源标识、API、导出和模型输入必须一致；混合数据不算纯单所研究；旧报告不被回补改写。失败时保留旧读路径及显著来源限制，不伪造来源以通过测试。

## 5. 足迹与CVD：保留真实聚合来源，补全可解释性

### 5.1 当前实现应保留的部分

`footprint-engine.js`基于Binance aggTrade、m=false主动买量，D1有5m价格档、最后成交ID与同步状态，已存在买卖量和恢复回归。不要重复实现一套用K线涨跌猜主动量的“升级”。[R08｜仓库事实报告§4 B1-B2，L104-118](../inputs/repository_facts.md)

### 5.2 TradeObservation契约

必须包含instrument、原生channel、source_trade_id/agg_id、聚合描述、source_event_time、received_at、price、base_qty、quote_notional（可选）、aggressor_side、side_derivation、原始字段版本、ingestion_batch_id和quality_flags。

Binance不同市场aggTrade规则不完全相同；合约接口q/nq及RPI范围保留为`volume_scope`。聚合记录条数不等于原始成交笔数，不能直接用records_count计算“每笔平均单量”并命名大户成交。现货trade与aggTrade不能同范围相加。[S002｜Binance 现货 WebSocket 协议](https://raw.githubusercontent.com/binance/binance-spot-api-docs/master/web-socket-streams.md) [S004｜Binance USDⓈ-M 市场流](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market)

### 5.3 PriceBucket方法

配置`bucket_size`、`anchor`、`bucket_rule=floor`、`quote_unit`。对价格p，桶下界为 `anchor + floor((p-anchor)/bucket_size)*bucket_size`，按精确小数或定点处理。边界价格恰好等于下一桶起点时归下一桶，避免前后端浮点造成不一致。

5m基础窗口内部统一`[start,end)`；事件恰好在end归下一窗口。按aggressor聚合买量/卖量及可用名义量；未知方向单独计`unknown_qty`，不平均分到买卖。footprint total守恒为buy+sell+unknown，未知非零时不能称全部主动量已分类。

重新聚合时间只能合并完整基础桶，切到非对齐窗口时必须说明边界近似或读取更细数据；不把30秒查询从5m桶线性分配为“真实成交”。价格桶只能精确合并兼容细桶，不能无依据细分已有粗桶。

### 5.4 POC/Value Area/失衡

POC按明确volume_scope最大桶选取；并列规则固定，例如选靠近窗口VWAP再选较低价格，不能随对象遍历顺序变化。Value Area比例若采用0.70是方法约定，不是预测有效性的证明；算法起点、向相邻桶扩展和并列顺序必须固定并写method_version。数据不完整时附范围限制。

买卖失衡可定义 `buy_qty / max(sell_qty, epsilon)`，但epsilon不能制造无限比值“极端信号”。零对手量时独立标`one_sided_observation`，同时展示绝对量与桶覆盖。失衡阈值用于描述筛选，需与成交总量和历史分布对照；不直接推导“大户吸筹”。

### 5.5 CVD

`delta_t = buy_base_qty_t - sell_base_qty_t`，`CVD(t) = sum(delta from declared_anchor to t)`。同时给anchor、source_scope和gap_mask；跨缺口可选择中断或继续但明确未知，不将缺口当0。聚合至不同时间尺度后，同一完整总区间的delta总和应一致。

CVD背离必须声明确认规则和可用时间。例如两个价格摆点若需右侧k根才能确认，信号可用时间为第二摆点后k根闭合，不能回填到摆点那根声称实时知道。第一版可以只展示价格与CVD共同窗口，不自动生成背离信号，以减少不必要预测层。

### 5.6 去重和恢复

具有可靠唯一agg_id的来源按instrument+channel+id去重，连接重建重放不重复累计。ID连续性是否保证由具体协议决定，不能一概把所有跳号当丢包。没有可靠ID的事件不制造保证，记录transport/session/batch元数据和可疑重复。

最后ID与桶提交必须具有明确一致性：仅当桶写入成功才能推进已提交水位；并发任务用租约/版本防止旧任务回写新状态。故障后允许从先前安全水位重放，依靠可靠ID去重。数据库失败时不能继续对外声称桶已完成。

## 6. 清算：方向、价格、数量、完整性四项独立

### 6.1 新normalized对象

```json
{
  "venue": "bybit",
  "instrument_id": "bybit:linear-perpetual:BTC:USDT",
  "source_channel": "allLiquidation",
  "liquidated_position_side": "long",
  "execution_side": null,
  "price": "100000.00",
  "price_kind": "bankruptcy",
  "quantity": "0.20",
  "quantity_kind": "executed_size",
  "value": "20000.0000",
  "value_kind": "bankruptcy_valued_size",
  "source_event_id": null,
  "id_quality": "no_native_unique_id",
  "coverage_kind": "source_documented_all_stream_local_coverage_unproven",
  "example_only": true
}
```

数值为合成样本。实际事件时间和收到时间必须另带，不得遗漏。`execution_side`没有直接来源时可以为null，不能从持仓方向反推后冒称交易所提供。

### 6.2 现有方向不盲目改

报告中的Binance SELL→多头强平、Bybit Sell→空头强平是按不同字段语义实现并有测试。应保留这些样本，新增price_kind和qty_kind测试。Bybit文档p为破产价，Binance存在平均执行价/订单价以及累计/单次数量字段；来源间的notional不是天然同一种观察。[R08｜仓库事实报告§4 B1-B2，L104-118](../inputs/repository_facts.md) [S004｜Binance USDⓈ-M 市场流](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market) [S006｜Bybit allLiquidation 文档源码](https://raw.githubusercontent.com/bybit-exchange/docs/master/docs/v5/websocket/public/all-liquidation.mdx)

### 6.3 Binance字段选择策略

`ap`有效且数量是相应累计执行量时，可以给出`average_execution_valued_cumulative`观测；若使用订单价p与订单量q，必须标`order_valued_requested_size`，不能称已成交金额。`l`和`z`分别按协议的last/cumulative语义处理，不能仅按“哪个非空就用哪个”混入同一总量。

如果需要统计增量执行量，应按可靠订单身份维护累计z的正差，并处理reset/重复；当公共流没有足够唯一身份时，不能假装可准确恢复每笔增量。第一版更安全的是保留源观测规模和价格类型，以来源限定的事件强度展示，不承诺完整执行总和。

### 6.4 无唯一ID情况下的重复

相同payload哈希不一定代表同一市场事件：两次不同事件可能相同时间/价格/规模。只能对已知重复交付的transport batch/message进行幂等，或将payload重复标为suspected_duplicate等待规则。不能全局按payload去重后宣称无损完整。

处理设计保存`transport_message_id`（本系统接收层）、`source_event_id`（如有）、`fingerprint`与`dedup_reason`。缺可靠source ID时事件总额带去重策略限制；不在报告里用精确个位数美元暗示完全准确。

### 6.5 5m桶与展示

桶按venue、instrument、position_side、price_kind、quantity_kind、value_kind聚合；可比较项目再提供合计。不同value_kind同时存在时页面分行，默认不合成“全网真实强平金额”。缺口、连接状态和来源采样说明单独显示。

旧桶缺priceType，标`legacy_semantics_unknown`并使用旧图形只读兼容。不得用新口径回写旧合计，造成历史看似改善。若保留原始payload可以重算，创建新dataset版本而不是覆盖。

### 6.6 研究用途边界

可见清算事件能作为杠杆压力观察，不证明全部交易者净损失；清算热力图的预估杠杆分布则是另一类模型输出。供应商热力图可在将来独立估计层引入，但其方法和授权需要核验，不与本系统观测事件合并为同一事实。[S071｜CoinGlass清算热力图](https://docs.coinglass.com/reference/liquidation-aggregate-heatmap)

## 7. 衍生品序列与规格

### 7.1 资金费率

一条observation保存instrument、venue、observed_at、settlement_at、interval_seconds、rate_decimal、rate_status（predicted/realized）及来源。相邻结算间隔可以变化，不能假设所有所永远8小时。跨所展示先以实际结算率和间隔并排，再按明确方法计算简单年化或复合年化，不能混同。

简单年化 `rate * seconds_per_year / interval_seconds` 只是一种描述尺度；高频波动的预测费率不适合当未来长期回报。未来区间尚未结束时，用“当前预测资金费”而非“已付资金费”。

### 7.2 OI

保存native_oi、native_unit、contract_spec_version、valuation_basis和time。币量、合约张数、美元名义值可有多个派生字段，但原值不丢。OI是未平仓存量，每份合约多空对应；增长不等于“资金净流入多头”，也不单独判方向。

比较ΔOI时确保同venue/instrument、规格和估值口径。美元OI增长可能只是价格上涨；同时展示原始数量和固定/当前价估值，解释分开。Binance统计端点历史窗口和期末时间限制见官方文档，不能凭今天API存在补齐所有过去。[S005｜Binance USDⓈ-M REST 市场数据](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data)

### 7.3 多空比与Top Trader

明确是账户比例、持仓比例、某类用户样本还是全市场，保留口径。它与真实净头寸、机构仓位、独立投资者数量不是同义词。跨来源若定义不同，不计算简单平均。研究界面默认降低此类样本指标的权重，只有独立增量验证通过再参与提示。

### 7.4 基差

永续价格溢价、交割合约期限基差分开。定义 `basis=(F-S)/S`；到期期货可定义简单年化 `basis / T_years`，T>0且较接近到期时注意数值爆炸。S/F必须时间近似同步、报价/结算和估值口径可比。默认缺一个有效价格就返回null，不用上周现货价搭当天期货。

## 8. 数据质量是原因集合，不是另一个神秘分数

建议质量对象包含：freshness、coverage、temporal_consistency、unit_consistency、source_identity、revision_status、comparison_eligibility、rights_eligibility。每维枚举pass/warn/fail/unknown并附reason code，不平均成87分。

`freshness=pass`只是未超过该来源预期更新节奏；证券收盘旧值如果符合session状态，可能是“最近可用收盘”，但不是实时价。覆盖完整需要能解释分母；没有可靠总事件数时，不能自造99.9%完整率，只报告已知缺口、最后成功和观测状态。

指标发布门按用途不同：绘图可显示stale值加标识；自动预警可能必须fresh且finalized；历史研究要求来源/时点可比。不要用一个全局ok布尔同时决定所有功能。

## 9. 数据流、API和消费者责任

```text
来源适配 → 原始语义保留 → 规范化记录/桶
 → 每源quality与watermark
 → capture输入清单
 → 共享权威计算
 → dataset/method/run标识
 → API响应与缓存
 → 页面、导出、报告、观点、预警
```

所有消费者必须通过同一可声明版本的指标输出；图表临时本地计算可保留做交互预览，但标provisional并在与权威结果不一致时显示来源，不给LLM当正式证据。权威计算不意味着所有算法集中到一个巨大文件，而是每项方法有一个owner和一组黄金样本。

API失败返回结构化错误，例如SOURCE_STALE、UNIT_MISMATCH、LEGACY_PROVENANCE_UNKNOWN、WINDOW_NOT_COVERED；HTTP200也可携带partial数据，但不能省略quality。无数据正常返回空集合+reason，避免前端把空响应缓存为“零成交”。详情见卷10。

## 10. 资源和成本假设

保留当前可用桶用于在线交互，研究run仅封存使用范围。高频原文采用有限批次对象而非每条事件一个R2对象。文件分区不宜过细：按来源/市场/日期或任务自然边界，实际大小靠样本测量。

历史研究如需Parquet，先导出允许使用的副本，保持method/data ID；不要让浏览器直接扫描所有R2文件。DuckDB是按需分析候选，是否长期服务化由查询实验决定。[S059｜DuckDB LICENSE](https://raw.githubusercontent.com/duckdb/duckdb/main/LICENSE) [S060｜DuckDB并发](https://duckdb.org/docs/current/connect/concurrency.html)

未知项包括事件率、对象操作数、D1扫描和生产磁盘；本卷不报每月成本。预算估算分别记录原始输入、规范化、报告/视图快照和备份的日增长，避免只算一个压缩后文件而漏掉多份副本。

## 11. 迁移步骤与回退

1. 添加新字段/sidecar与读取适配，不改旧表语义；先写来源与质量，不改变算法结果。
2. 将新采集写入规范化v2目标并保留旧读兼容；同一数据事实只有一个写入owner，双写必须由同一事务/补偿账本管理，而非两采集器竞争。
3. 用固定样本验证来源/单位/窗口，再做有限影子输出；差异归因为新语义或实现错误。
4. 让首页/报告从新的指标API读取；旧路由保留旧版显示标签，避免有些页面已迁移而LLM仍用旧固定分数。
5. 历史原文够用时可离线重算新版本；不够时保持legacy，不填造来源与priceType。
6. 切换失败仅回退读取指针/feature flag，保留新写数据与错误样本；不删除新表或破坏旧数据。

来源权限未明的新增数据禁用相关能力，但不影响已有获准来源的业务闭环。实施授权范围和数据库变更审批属于后续部署任务，而不是用户使用产品时的繁琐审批流程。

## 12. 验收矩阵

| 场景 | 输入变化 | 必须观察到 | 禁止出现 |
|---|---|---|---|
| 时间单位 | 毫秒/微秒契约不匹配 | 隔离并标TIME_UNIT_MISMATCH | 自动修到像日期就发布 |
| 来源回退 | Binance失败、Bybit有效 | 新来源段、显示/导出/LLM一致 | 当成同一Binance历史连续计算 |
| 修订 | 较早K线改值、末时间不变 | 内容哈希和dataset版本变化 | 指纹不变导致旧缓存复用 |
| agg重放 | 相同可靠ID重复 | 桶总量不变、水位一致 | 重复累加 |
| 部分未知方向 | 有数量无side | unknown_qty且CVD不完整 | 自动各分一半 |
| price bucket边界 | 恰落桶界或窗口end | 按固定左闭右开归属 | 浏览器/Worker不同桶 |
| 清算价格 | bankruptcy与avg_execution混合 | 分开度量和说明 | 直接合计真实成交美元 |
| 清算累计量 | 同订单累计增加 | 可识别时只计delta；不可识别标限制 | 每个累计快照都当新增成交 |
| OI换口径 | 张数/币量/美元不同 | 规格转换或拒绝比较 | 以字段名相同直接相加 |
| 旧数据 | 没source/priceType | legacy_unknown | 按猜测补成确定事实 |
| 预览K线 | 尚未闭合 | provisional | 等同已确认信号 |
| 本地故障 | 数据写入失败 | 不推进提交水位 | 已对外标complete但数据没落库 |

上述通过条件针对设计规格，不是本轮运行结果。固定样本和预期对象随包提供；开发者需结合真实协议样本与现有回归在隔离环境执行。
