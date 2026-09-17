# 06｜订单流与足迹：保留真实成交基础，修正聚合与历史信号

**对象：`js/orderflow/footprint-engine.js`、`js/pages/orderflow.js`及D1足迹桶、快照。** 当前足迹基于Binance aggTrade，不是仅依K线涨跌估算。当前5m桶可再合并更长周期，已有买卖量及恢复逻辑；本轮不建议新建第二套采集器。[C19｜js/orderflow/footprint-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/orderflow/footprint-engine.js#L1) [C23｜js/pages/orderflow.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/orderflow.js#L1) [C10｜cloudflare/schema.sql（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/schema.sql#L1)

## 1. 研究用途与数据边界

本页应回答选定市场与窗口内主动成交偏向、成交集中区域、哪些价位发生反复交易及价格是否收回已知位置。它不能从聚合成交推导真实挂单主体、全部冰山订单、净资金流或机构持仓。

来源说明包括交易所、永续/现货、聚合成交定义、RPI处理、价格格与统计窗口。当前Binance合约aggTrade和现货aggTrade的聚合规则不应默认一致；官方合约说明涉及同价格/同方向时间聚合及q/nq差异。增加现货对照时先统一产品与口径，不把两个字段同名的delta简单相减。[E01｜Binance USDⓈ-M WebSocket市场数据](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market)

## 2. 四种粒度必须独立

| 粒度 | 含义 | 允许变化 | 不允许的行为 |
|---|---|---|---|
| exchange_tick | 原生合约最小价格变动 | 随规格版本变化 | 用样本最小价差猜交易所tick |
| storage_bin | D1实际保留的基础价位宽度与锚点 | 新方法版本与新写入 | 用1美元桶恢复0.1美元原始分布 |
| analysis_bin | 计算失衡、POC、SFP所用价位划分 | 用户选择后固定在研究输入 | 随画布高度悄悄变化 |
| display_bin | 为可读性合并显示 | 缩放/屏幕变化可以调整 | 用展示重采样改写已封存统计 |

当前`detectBaseTick`取观察最小价差，`chooseDisplayTick`依据屏幕与价格范围。它们可以作为显示启发式，但不能成为金融分析的规格来源。执行者须追踪分析是否实际消费重分箱结果；本轮不宣称每次resize已经改变所有指标。[C19｜js/orderflow/footprint-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/orderflow/footprint-engine.js#L1)

## 3. 时间聚合与量守恒

5m基础桶合并15m/1h/4h需要固定UTC边界、相同来源、相同价位格与完整子窗口。open/close依据时间首尾，high/low取极值，主动买卖量求和，delta等于买减卖，volume等于两者之和。POC、VAH/VAL不能取子桶平均，必须对合并后的价格分布重算。

对包含缺口的父桶，量可以作为“已观察量”返回，但不能称完整窗口成交；`expected_children`与`present_children`并不自动证明每个子桶内无丢包。缺失的逐笔无法从已有5m桶反推，禁止合成事件冒充历史原始数据。

实时事件与已存桶混合必须有接续边界。若新桶已经包含某条事件，浏览器不得再追加同一条；反之，服务器桶落后时应显示临时补充区间与last_trade_id，待新桶替换后移除对应临时事件。仅凭接收时间先后不能保证互斥覆盖。原有恢复测试应保留并加入跨边界样本。

## 4. 价格分箱的数学合同

新方法可采用半开区间`[anchor+k*width, anchor+(k+1)*width)`，显示为中心或下界，但存储索引不随显示格式变化。使用整数tick索引，宽度为基础格的正整数倍；明确负值不适用BTC价格但通用函数仍应拒绝不合法输入。

当前最近中心round分箱存在重分箱非结合性。迁移不能直接将旧center字段当作真实成交价。保留旧方法版本；新分箱只对有原始精度的输入生效。读取旧桶时说明这是旧中心格近似，可合并但不承诺与原始直接聚合一致。[C19｜js/orderflow/footprint-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/orderflow/footprint-engine.js#L1)

验收检查总买/卖量守恒、边界价格恰好落在哪格、连续倍数合并与直接合并的一致性。不能要求非对齐宽度自动无损，如1美元旧格合并到2.5美元新格需要额外假设，应拒绝或标为近似。

## 5. POC与价值区

当前单柱降序遇并列最大量选择高价，整窗升序选择低价，这是应统一的实现差异。建议默认定义`poc_candidates`完整保留并列峰；显示主POC按预声明规则选，例如离窗口VWAP最近、仍并列取较低价。没有可靠VWAP则直接固定取低价，并明确方法。替代为显示POC价格带，适合完全并列的平台分布。[C19｜js/orderflow/footprint-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/orderflow/footprint-engine.js#L1) [C20｜js/orderflow/footprint-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/orderflow/footprint-engine.js#L210)

价值区可保留目前从POC向相邻价位扩展至70%的方法，但需要写清并列两侧同时扩展、价格空格是零成交还是缺失、达到目标后的实际coverage。70%是方法约定，不是70%价格落入概率；改变为68%/80%是参数变化，不自动提升专业度。

VAH/VAL来自成交分布，不能自动叫买卖墙。高成交节点是过去成交密集，不代表当前仍有挂单。价值区迁移、POC位移可新增为描述，但必须比较相同窗口长度、基础格、来源和完整性；任意拖动可见区导致POC变化是范围变化，不是市场突然转向。

## 6. 同价失衡与对角失衡

当前`levelImbalance`比较同价buy/sell，以ratio=3与minSmall=0.01过滤。它是明确的同价成交不平衡方法，不应直接改名成行业全部footprint通用算法。[C19｜js/orderflow/footprint-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/orderflow/footprint-engine.js#L1)

新增对角失衡作为独立方法时，需定义买侧某价主动量与下一个有效价格格的卖侧量比较，卖侧镜像；具体方向索引与价位排列在测试中固定。不能让升序/降序数组改变邻格方向。缺失格与真实零量分别处理，除数零不输出Infinity；可以返回`one_sided_observation`，只有符合最小绝对量和覆盖才参与连续失衡计数。

“堆叠失衡”应指同一根内连续相邻价位，而当前跨bar方向longestRun是另一指标。两者都可保留，名称分别为跨价位连续性、跨时间持续性。不能将所有散落高比值点数当同一类型堆叠。

阈值以可配置描述条件登记；默认3倍与最小量只是实验起点，需要跨价格格、成交活跃度与时间段做敏感性对照。筛选后没有信号是正常结果，不通过降低阈值强行凑摘要。

## 7. CVD与成交参与度

新增或整理CVD时明确`anchor_type=UTC日/选择窗口/显式事件`、anchor_at、source、quantity_unit和gap_policy。累计缺口发生后可以重新锚定或标断段，不能默默延续一条完整曲线。当前窗口的delta占比是delta/total，不是整天买盘比例。

基于K线taker统计的累计净主动量、基于aggTrade的CVD、基于价格方向估算的方向量分开方法ID。只有覆盖、事件群体与单位一致才允许守恒核对；差异不自动说明某条源错误。

可增加“成交推进效率”描述：单位主动量对应价格变化，或高成交/低价格位移的候选提示。但分母接近零、厚尾、方向改变与窗口选择会使该值不稳，首版仅给原始组合和条件，不输出“吸收强度87分”。

## 8. SFP：从回看形状到有时间条件的研究事件

### 8.1 先解决何时知道价位

当前SFP先从整个输入窗口的成交分布、失衡和摆动点建立价位，再扫描此前bar；volumeMedian也来自整窗。这可用于事后寻找形状，但不能证明当时已经知道同一价位和基准。[C21｜js/orderflow/footprint-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/orderflow/footprint-engine.js#L350)

新事件只能引用`sweep_at`之前已知的level_revision和基准统计，或明确标为`retrospective_candidate`。逐前缀实验追加未来bar时，过去已封存的前瞻候选不应无痕变化。允许今天生成一个新的回看版本，但不能替换当时结果。

### 8.2 确认、失效与当前bar

建议保存level_known_at、sweep_bar、confirm_bar、confirmation_basis、invalidation、last_evaluated_at。确认条件必须对应那根confirm_bar的完成状态，不是全局最新bar是否结束。当前已存在展示降级函数，应保留其保护并把作用对象改精确；不能声称原系统没有任何形成中保护。[C22｜js/orderflow/footprint-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/orderflow/footprint-engine.js#L600)

扫过价位与收回只是价格事件，不等于真实“扫流动性”订单行为。展示改为“越过已知价位后收回”，把吸收或止损触发解释放到假设栏。可以引用已观察强平或成交作为旁证，但不补造挂单信息。

已确认历史事件不能因为后续有更新的forming就永久抢占“当前主信号”。选择策略分最新事件、仍有效条件与历史最佳结构，默认近期视图只展示满足时效且未失效的候选；旧事件留历史列表，不用排序高分把它一直当新机会。

### 8.3 结构分的地位

原base/key/footprint/recency加分可作为历史启发式研究基线，但不能称胜率。新UI优先展示各条件的满足/缺失与价格区间，保留结构分须注明规则版本与未校准。统计验证需要预声明候选定义、确认和结算，不从最好看的案例倒推阈值。

## 9. 新鲜度与完整度

当前缺少真实成交时间时会用barEnd与now构造reference，进行中bar可得到age0。修正为真实市场事件、服务器桶更新时间、实际查询时间三列；bar计划结束不能当市场心跳。[C22｜js/orderflow/footprint-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/orderflow/footprint-engine.js#L600)

无交易事件并不自动判数据过期，尤其稀疏品种；BTC也不能以“通常很活跃”替代连接证据。数据状态可以是transport_ok、no_observed_trades、coverage_unknown。若序列或回补证明没有缺口，才允许更强的完整度表述。

图表最后一根随时间自然跨过周期不证明来源完成采集；`time_elapsed_only`与已接续且同步完成分开。临时浏览器数据不能替云端30天持久覆盖背书。

## 10. 页面组织与跨页联动

保留足迹画布、统计详情和读数。顶部显示市场、窗口、analysisBin/displayBin、量单位和质量。显示格因屏幕变化可调整，但统计详情仍指向固定分析格，并提示视觉汇总不同。

选中一根足迹，应能定位主图同一绝对窗口、查看该桶的输入范围与缺口、把一个明确候选加入观点；不能只跳到“最新BTC”。整个24hprofile、当前可见32bar profile与单bar profile必须分开标题。默认不将同一成交事实在失衡、CVD、POC三个卡里算作三份独立方向确认。

切周期、tick和路由要取消旧请求与渲染任务；保留现有有限缓存策略，但展示和导出必须说明实际加载/可见范围。不要把页面保留240bar误称完整交易历史。[C23｜js/pages/orderflow.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/orderflow.js#L1)

## 11. 失败与恢复

接口失败保留最后有效图，但标age；语义校验失败只隔离不合法bar与依赖结果，不将其改成零量；历史缺口可显示空白，不用连续线盖住。重连时先核last_trade_id与服务器覆盖，再接实时；仅凭收到一个新包不能宣告前段缺口已补齐。

旧价位格无法恢复原始成交时，恢复等级为聚合证据。历史SFP没有level_known_at时标回看，不能批量补上产生虚假的前瞻记录。更换方法后影子计算差异，已有报告保持旧版本。

## 12. 验收切片

先统一POC并列、分析格与展示格、质量时间；再修SFP时点和确认；最后增加对角失衡、CVD锚点或现货对照。每项新增指标必须回答新增什么独立信息，不能把整个库全部装入。

测试至少覆盖量守恒、POC并列、非结合round反例、格边界、空格与缺失、同价/对角区别、跨bar/跨price堆叠区别、当前bar形成中、过去价位晚确认、历史候选过期、resize不改固定统计、主图与足迹统一窗口、旧桶恢复等级。相关现有入口为`verify:footprint`、`verify:market-snapshot`，具体执行权限与运行环境另核。[C30｜package.json（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/package.json#L1)
