# 08｜衍生品面板：资金费、OI、基差、期权与宏观的分层升级

**当前依据：`js/pages/derivatives.js`、`finance/datasets.mjs`及快照。** 本页不是缺少字段，而是旧指标槽、单位推断、比较窗口和旁路解释与新数据底座尚未统一。新设计以“持有成本、仓位存量、主动成交、期限结构、外部背景”五个问题组织，不把所有数值加成多空总分。[C27｜js/pages/derivatives.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/derivatives.js#L1) [C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1)

## 1. 现有能力应保留什么

保留已有资金费、OI、账户/头部持仓比例、taker、基差、跨资产背景的读取与图表；保留`derivNumber`对null/空串的显式处理；保留当前变化方法在完全缺锚点时返回null的行为。不要把它替换成压力矩阵的最早点回退。

现有按source family筛选比完全无来源比较更好，但不足以定义同一个数据产品。`binance-xxx`共同前缀不能证明市场、合约、单位、统计类型和连续来源段相同；筛完再计算mixedSource也不能充分暴露丢弃了哪些来源。新结果应返回实际选择的source/spec/method以及excluded segments。[C27｜js/pages/derivatives.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/derivatives.js#L1)

## 2. 统一窗口比较合同

每次变化计算声明目标结束点、请求回看跨度、期初/期末定义、锚点最大误差、所需样本与来源身份。取得最接近且不晚于目标的有效观察，并检查偏差；如果离目标过远，输出anchor_too_old，不把几天前的点当24h前。

返回`start_value、end_value、requested_start/end、actual_start/end、actual_span、boundary_error、change_absolute、change_fraction、status`。小时OI不插值成每分钟事实；可以以step方式显示已知持仓值，但用户看到的是沿用观察，不是新采样。

形成中窗口与完整窗口不要混比。统计端点的timestamp语义必须从源到API再到显示保持一致；Binance OI历史为统计期末，而taker/basis的期初字段需要展开为对应窗口。[E02｜Binance USDⓈ-M REST市场数据](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data)

## 3. 资金费率：报价、预测、结算分别存

推荐三条序列：当前报告/预测费率快照、已结算费率事件、资金费规则与调整。premium每分钟读取相同lastFundingRate不代表每分钟发生一次资金费用，不能累加。资金费结算事件以funding_time和产品身份去重，规则表保存间隔、上限/下限、生效依据。[C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1)

展示原生费率如decimal 0.0001→0.01%，附interval_hours与状态。只有明确要比较持有成本才换算：每小时简单费率`r/h`，简单年化`r/h*24*365`。这是保持该费率的数学年化，不是未来收益承诺；不默认复利，因为资金费不等于自动再投资。跨不规则结算期累计时逐事件求和并说明头寸/名义额假设，不拿一条快照推多年收益。

已结算费率变化应优先用百分点或basis points差，而不是正负经过零点时百分比增长。0.01%到0.02%增加0.01个百分点、1bp；“增加100%”可以数学成立但常误导，应只在明确任务需要时显示。

拥挤标签使用同产品同结算间隔历史的分位和有效样本数，不能所有币种统一0.05%或固定8h。历史很短时给原值与有限背景，不出精确极端概率。当前pressure中的%/8h必须连同快照一起改。[C25｜js/heatmap/pressure-matrix.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/heatmap/pressure-matrix.js#L1)

funding-info列表没有BTCUSDT仅表示该接口未报告调整，不自动证明当前间隔。间隔依据来源规则或有证据的相邻结算时间；缺少规则时保留unknown，实际历史间距与现行计划分开。

## 4. OI：数量、估值与持仓变化

OI是未平仓存量，必须说明单位与合约规格。数量增长不能叫净资金流入，也不能确定新增多头；每份合约同时有多空双方。新数据集原生数量和值分别保存，是正确方向，不再只展示“XX亿美元”。[C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1)

建议默认两张叠图：基础/合约数量OI与统一估值OI。对`V=P*Q`且规格固定的线性估值，可精确分解：`ΔV=P0*ΔQ+Q0*ΔP+ΔP*ΔQ`。三项分别为按旧价的数量变化、按旧量的价格变化和交互项；它们不是现金流，也不是交易者实际保证金变动。反向合约不得不经规格换算直接套此式。

可增加`OI/过去24h成交量`作为存量相对交易活跃度的描述，但币量和成交额口径要一致；不把这个比率解释成平均持仓时间或强平概率。若成交量缺失、窗口不全或跨产品，返回qualified或missing。

价格与OI四象限提供条件描述：涨价增仓、涨价减仓、跌价增仓、跌价减仓。每个都附替代解释。当前“价格下跌OI上升，偏新增空头拥挤”只能作为待验证假设，不能直接推出主力做空或未来必跌。资金费、现货成交与观测清算可以增加约束，但不是证明交易者身份的证据。[C27｜js/pages/derivatives.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/derivatives.js#L1)

## 5. 主动成交比、账户比与头部持仓比

三个类别不得互相替代：taker买卖量比描述主动成交；账户多空比描述被统计账户的净方向比例；头部持仓比描述来源定义的特定样本持仓。账户数不是金额，头部样本不是所有机构，更不是“聪明钱”标签。

显示比值同时显示分子分母可得性、样本定义与窗口。只给ratio=2但不说明是账户或成交会误导。两类比值的“分歧”只表示不同样本/统计维度不一致，不自动构成反转信号。

新规范目录只有top-position-ratio，当前旧面板还消费top_account。迁移时不能用position填account；要么新增真正端点并核认证/权限，要么隐藏缺少的比较。当前官方目录对部分Top Trader方法的API Key说明与仓库无密钥设计存在需核验差异；这是采用前核对点，不据文档变化直接宣布已存数据错误或所有接口不能用。[C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1) [C09｜cloudflare/finance/registry.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/registry.mjs#L1) [E02｜Binance USDⓈ-M REST市场数据](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data)

时间聚合也不同：主动量可在一致窗口求和后再求比，账户比与持仓比不应把多个时点比值简单求和。平均比值与总分子/总分母比不等价，缺原始分子分母时必须说明采用时间平均，不能称真实总比。

## 6. 基差：停止按数值大小猜单位

当前`fmtDerivRate`与`derivBasisState`把绝对值不超过1的数乘100，其余当百分数。这会在1附近制造不连续，也无法区分0.5是0.5%还是50%。单位必须由数据契约给，不得依数值分支判断。[C27｜js/pages/derivatives.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/derivatives.js#L1)

基差最少三列：绝对价格差`F-S`（报价币/基础币）、比例`F/S-1`（decimal）、交割合约年化基差（明确ACT天数与年基数）。例如ACT/365简单年化`(F/S-1)*365/days_to_expiry`；期限非正不可算。连续复利`ln(F/S)*365/days`是另一方法，不能无版本替换。交易所原生annualizedBasisRate保留原值与来源算法，不强迫与自算完全相同。

永续没有交割到期日，不能用任意90天模拟季度年化。当前新basis数据集是PERPETUAL，旧basis_quarter需要真正季度合约数据才能迁移。sourcePrice可以是index、mark或现货mid，必须声明；期货末笔与几分钟前现货价格的差包含时间错位，不能解读为套利收益。

建议加入mark-index偏离、perp-spot溢价与交割期限结构三个独立对象，不把它们都叫basis。每张图显示两侧时间、产品、价格类型和最大偏差容忍。某侧旧价时返回不可比，不能用最近一条凑齐。

## 7. 期权：已有摘要，尚未自动具备曲面

当前`deribit-btc-options`能保存原生汇总截面，目录标未接前端。它是基础能力进步，不能再写“没有Deribit”。官方summary本身已经包含可空的best bid/ask、underlying_price、interest_rate和mark_iv，当前options归一化还保留原生整行，应先复用这些字段，不新增重复请求。它不提供完整深度或Greeks保证，也不能仅凭存在字段认定报价同时有效、全链无截断，因而仍不能直接宣称可信25delta skew或交易商GEX。[C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1) [E04｜Deribit期权摘要](https://docs.deribit.com/api-reference/market-data/public-get_book_summary_by_currency)

第一阶段可展示按到期分组的合约数量、可用mark IV范围、OI分布和样本质量。须明确mark是供应商估值，不一定是可成交报价；缺合约规格时不跨产品汇总OI成美元。返回截断则禁止计算“全市场总OI”。

第二阶段先验证已保存的bid/ask和underlying字段，再补必要instrument定义及缺失的报价约定；这些信息在同一批次满足要求后，再算ATM期限结构。选取规则应基于固定目标到期与moneyness，插值使用总方差`σ²T`，不在没有相邻期限时无说明外推。25delta需定义delta约定、call/put符号、premium-adjustment及远期口径；有delta字段也需要确认定义。

IV-RV差只在单位、年化、标的和期限可比时展示，代表隐含和已实现的差，不自动证明“期权贵”“可无风险卖波动”。GEX需要持仓方向或明确假设；只知道每个行权价OI，不能知道交易商净Gamma。

## 8. 宏观背景必须另一个时间层

VIX/VIX3M/MOVE、FRED、SOFR、美元和实际收益率按自身发布日历更新，不和秒级BTC显示同一个“实时”。当前vixTerm用各自最后一条相除，需要两侧日期/时段对齐；缺精确时间可标背景，不放进当前1h因果说明。[C27｜js/pages/derivatives.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/derivatives.js#L1)

DGS2/DGS10等百分数变动用百分点/bp，CPIAUCSL是指数不是同比，DTWEXBGS不是ICE DXY。WALCL、WTREGEN、RRPONTSYD单位与频率不同；不能简单拼出“净流动性等于BTC买盘”。若建立解释性合成指标，单位统一、观察时点与发布时间、周均与时点值差异、样本与版本必须公开，先作为研究实验，不加入默认方向总分。[C03｜docs/research/workbench-binance-data-plan-2026-09-16.md（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/docs/research/workbench-binance-data-plan-2026-09-16.md#L1) [C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1)

## 9. 面板组织与读取方式

建议默认四组：持有成本、仓位与参与、价格/期限关系、外部背景；期权截面作为独立可选页内tab。每组只有一份权威方法结果，压缩快照和LLM消费同一结果而不是页面复算一份、Worker再写启发式一份。

共享选择含primaryInstrument、comparisonWindow、cutoff、sourceMode与methodVersion。切换范围不更换产品；换source明确改变范围。数字卡可展开原生字段、计算式、实际窗口、质量和引用。数据不足时保留其他组，不因一个宏观源失效将整页标不可用。

## 10. 迁移与测试

先移除猜单位与错窗口，保留旧报告原值并标legacy；再将已验证规范funding/OI/taker/basis映射新读取对象；随后增加mark/index与期权摘要，最后才考虑复杂曲面。所有旧槽名都通过兼容层读取，不让旧消费者以名字推交易所。

必须测试：decimal与percent两种明确输入、0/空串/null、正负费率跨零、不同结算间隔、funding-info未报告、不到24h与锚点过老、OI数量/价格估值变化、同family不同产品、来源回退段、账户和仓位缺一侧、perp无到期、两侧报价异步、期权截断、宏观休市和日后修订。

结果不仅应通过函数测试，还应核对压力页、主图侧栏、独立快照、舆情模型和Markdown导出。若同一方法在不同层出现不同数值，先检查窗口/版本/输入，不让模型编造金融原因解释软件差异。
