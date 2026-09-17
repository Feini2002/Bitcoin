# 07｜强平雷达：观测事件、价格类型与风险条件重设计

**当前源码：`js/heatmap/liquidation-engine.js`、`pressure-matrix.js`与独立快照。** 本页已明确区分估算压力和潜在清算池，不应被整体当作伪造热力图。需要解决的是观测范围、未知分类、金额口径、窗口和跨层规则一致性。[C24｜js/heatmap/liquidation-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/heatmap/liquidation-engine.js#L1) [C25｜js/heatmap/pressure-matrix.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/heatmap/pressure-matrix.js#L1) [C26｜js/heatmap/pressure-matrix.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/heatmap/pressure-matrix.js#L260)

## 1. 三个面板，不混成一张颜色图

第一部分是“观测到的清算事件与时间聚合”，说明来源和采样。第二部分是“过去事件出现在哪些价格区域”，只统计已发生事件。第三部分是“当前杠杆与市场条件”，可以提出研究条件，但不声称知道未来清算仓位分布。

若未来采购模型化清算热力图，作为独立估计层，显示供应商、模型版本、已知方法和限制；不能与本地真实事件共用同一金额图例。清算名义额不是交易者损失、保证金损失或强制卖出净流量。

## 2. 逐交易所方向保留现有正确实现

Binance forceOrder的SELL对应被清算多头，Bybit allLiquidation的Buy对应被清算多头。当前代码已正确区分；新测试应锁定这一行为，不因为两个平台side语义不同而用统一大写映射重写。[C24｜js/heatmap/liquidation-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/heatmap/liquidation-engine.js#L1) [E03｜Bybit All Liquidation](https://bybit-exchange.github.io/docs/v5/websocket/public/all-liquidation)

未知方向必须保留unknown或隔离。当前`aggregateByPrice`把不是short的事件都累加到long，这会把unknown送入多头量。改为三分支：long、short、unknown；总量可包含单独可识别的unknown，但方向占比必须明确分母是否包含unknown，不能把方向已知覆盖比例隐藏。

事件字段缺失时不能默填默认symbol=BTCUSDT后认定属于BTC。默认值仅适用于来源频道已明确限定且协议允许的情况，必须保留依据。无法确定事件时间时保存received_at与event_time_unknown，不能用Date.now制造精确发生时间。

## 3. 价格和数量规范

| 来源字段 | 应保存的含义 | 允许的量化用途 |
|---|---|---|
| Binance `ap` | 平均成交价格 | 与可匹配的已成交数量组成平均成交价估值 |
| Binance `p` | 委托价格 | 可作委托价格观测，不无声替代实际成交均价 |
| Binance `z` | 累计成交数量 | 有稳定订单身份与序列时才可差分为新增成交 |
| Binance `l` | 最近一次成交数量 | 与对应事件规则匹配，不与累计量混为同一字段 |
| Binance `q` | 原始数量 | 不是已完成清算数量的通用替代 |
| Bybit `p` | 破产价 | 可作破产价估值，不称实际成交价 |
| Bybit `v` | 该来源描述的executed size | 与产品规格一起换算，保留原单位 |

协议依据为[E01｜Binance USDⓈ-M WebSocket市场数据](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market) [E03｜Bybit All Liquidation](https://bybit-exchange.github.io/docs/v5/websocket/public/all-liquidation)。当前归一化通过`ap/p`和`z/l/q`择首有效值，并输出统一price/qty/notional；修正保留`price_type、quantity_type、notional_method、fallback_reason`，优先显式缺失而不是悄悄换经济含义。[C24｜js/heatmap/liquidation-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/heatmap/liquidation-engine.js#L1)

`notional=price×quantity`只在该线性产品的数量确为基础币、价格为报价币/基础币时成立。反向合约或按张计量先依据规格换算；本系统当前主要BTCUSDT不意味着未来注册其他产品仍可套用。

## 4. 去重与累计更新

来源没有原生稳定订单ID时，以时间/价格/量拼接的指纹只能去掉部分相同报文，不证明两笔属性完全相同的真实事件是一笔，也不证明同一订单的累计更新是两笔不同事件。当前ID体现这种限制。[C24｜js/heatmap/liquidation-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/heatmap/liquidation-engine.js#L1)

建议事件身份分`native_id、transport_message_id、content_fingerprint、identity_confidence`。有原生订单ID且字段语义明确时维护该订单last_cumulative，只有非负合理增量进入对应统计；累计回退或消息乱序保留异常，不盲减。没有ID时保留供应商观测快照量，命名为reported snapshot exposure，禁止给“准确无重复总额”保证。

不能把同一事件从浏览器WS和D1桶相加。界面选择持久桶范围与临时实时尾段，并声明边界；切回持久数据时删除已覆盖临时尾段。恢复失败时显示可能重叠/缺口，不通过全部清空历史来掩盖。

## 5. 采样与缺口

Binance文档明确每交易对在1000ms窗口仅推最新一条清算快照。因此系统最多统计该接口观测，不代表完整清算；Bybit文档描述全部清算流也不等于本地不会丢包。[E01｜Binance USDⓈ-M WebSocket市场数据](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market) [E03｜Bybit All Liquidation](https://bybit-exchange.github.io/docs/v5/websocket/public/all-liquidation)

该类流没有事件时可能不推市场消息，不能用“90秒无清算”自动推出来源断线。transport ping/pong、订阅确认、相邻市场心跳、采集器错误和最后事件各自记录。即使transport正常，也不能证明没有发生被采样省略的事件。

`observed_zero、no_message_observed、source_disconnected、history_not_covered`必须分开。零观测只在指定来源和窗口内表达，不升级成全市场无风险。

## 6. 5m桶与价格热区

时间桶采用固定UTC边界，保留source、product、price/quantity method和coverage。价格格采用可配置宽度但不改变历史含义，宽度、锚点与是否采用中心近似写入输出。两种不同价格类型不能合在同一个严格价位热区。

按5m聚合可输出长短及unknown观测额、事件消息数、最大单条观测、价格范围、加权估值；消息数不是独立强平账户数或独立订单数。VWAP式价格必须注明权重是什么：事件基础量、名义额还是供应商snapshot量，各自不同。

历史只有时间桶时不能恢复真实价位分布或最大单笔身份。旧min/max与vwap不能合成一张真实历史热力图。只允许展示已保留的聚合证据，并在恢复等级里明确限制。[C10｜cloudflare/schema.sql（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/schema.sql#L1)

## 7. 压力矩阵退出无校准百分数

当前压力矩阵按Funding、OI、价格、基差和已发生强平加分；confidence与completeness又根据缺失减固定值。可以保留其为历史启发式基线，不继续称概率或可靠性百分数。[C25｜js/heatmap/pressure-matrix.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/heatmap/pressure-matrix.js#L1) [C26｜js/heatmap/pressure-matrix.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/heatmap/pressure-matrix.js#L260)

新主输出是条件向量：费率在自身历史位置、OI实际变化窗口、价格方向、可见清算侧别、数据缺失与可检验解释。每个条件的来源与方法分开。若有一个research priority用于排序，必须明确只影响阅读顺序，不影响事实权重，也不作为胜率。

资金费不固定%/8h；需实际结算间隔及预测/结算状态。basis不从旧槽名推断季度年化，页面的按大小猜单位和矩阵原值阈值应一起退役。24h锚点不足返回缺失，不退最早点；可另给actual_span描述，不能复用24h标签。[C25｜js/heatmap/pressure-matrix.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/heatmap/pressure-matrix.js#L1) [C27｜js/pages/derivatives.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/derivatives.js#L1)

## 8. 真正有增量的三个聚合

**观测清算强度：**在相同source/product/notional_method/有效覆盖下，将当前完整窗口观测额与过去同窗口分布比较。百分位只表示该样本内位置，不是发生极端风险的概率。缺失历史或样本窗口改变则返回不足。

**侧别集中：**长/短/unknown分别给量和比例，不将全为多头的少量事件自动称市场普遍多头拥挤。原始数量、名义额与事件消息数分别比较，以防一个大事件与很多小事件被混为同一模式。

**价格—OI—清算事件窗口：**选择明确事件窗口，看价格变化、同源OI存量变化与观测清算是否同时发生。只能称伴随；OI下降不证明全部由强平造成，价格恢复不证明清算已经结束。没有同时间/单位输入时部分返回，不插值出高频OI。

## 9. 当前页面与快照必须统一

独立快照中的压力分使用`log10(1h金额+1)×12`，并给72/42置信；页面则是多个条件加分。这两者都叫pressureMatrix却不是同一方法。[C28｜cloudflare/snapshot/marketSnapshotProgram.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/snapshot/marketSnapshotProgram.mjs#L530) [C26｜js/heatmap/pressure-matrix.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/heatmap/pressure-matrix.js#L260)

建议只有一个纯方法生产`liquidation_context`，页面显示和模型消费同一版本；压缩快照只压字段，不另计算分数。若确实保留不同用途算法，必须不同method_id与名称，不能在同一报告中互相当对照证实。新快照保留source_scope、actual_window、typed_notional与质量向量，不用生成时间代替行情时间。

## 10. 页面行为与资源管理

实时事件表与历史桶面板分开标时间范围。切换最小金额、价格格、来源和窗口会改变展示集合，统计标题同步改变；最大保留事件数达到上限时必须提示当前列表不再代表整个请求窗口。当前缓存有数量与时间限制，实际统计消费方式需查调用链后决定是否增加独立汇总器。

保留最后有效数据时明确过期与来源失效；未知方向单列，不用颜色暗示买卖。强平提醒默认站内记录，冷却与episode只在后续明确规则后启用，不把热图刷新当提醒。

页面卸载清理WS、ping、watchdog、重连timer和request，迟到消息不能更新已切换来源的图。重启恢复先读取持久范围，不能把刚连接后的数分钟结果称24h统计。

## 11. 测试与迁移

首切片保留旧桶，增加新版typed normalized事件和读取投影；旧数据lack type标`legacy_unknown`。禁止仅靠供应商今天字段定义补写所有过去事件所用fallback。新版与旧版并排对照差异，按来源和数量选择说明，不追求数字必须相同。

关键样本：BinanceBUY/SELL、BybitBuy/Sell、未知方向、ap0/p有效、z累计增量/重复/乱序、无原生ID两同属性事件、缺事件时间、两个price_type、source0事件与断线、只有1h却请求24h、同事件实时与D1重叠、压力页与快照方法一致。合成测试证明规则边界，不证明真实市场全事件完整。

通过条件是没有无声语义替换、分母范围清楚、同一研究输入跨页面与报告一致、失败能降级。若源不提供足够身份完成精确去重，就缩小承诺为观测统计，不将接口限制交给模型“推理补全”。
