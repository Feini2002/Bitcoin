# 09｜统一分析方法注册表：新增价值、公式、参数与失效条件

**本卷定义的是拟采用方法，不是已验证预测器。** 保留当前合法的EMA/ATR/RSI等实现，修改的是同名方法跨页面不一致、输入语义与质量边界；新增方法按实际数据能力启用，不能全部默认加载。当前实现证据见[C11｜js/chart/indicator-math.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/chart/indicator-math.js#L1) [C19｜js/orderflow/footprint-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/orderflow/footprint-engine.js#L1) [C25｜js/heatmap/pressure-matrix.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/heatmap/pressure-matrix.js#L1) [C27｜js/pages/derivatives.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/derivatives.js#L1)，来源统计定义见[E01｜Binance USDⓈ-M WebSocket市场数据](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market) [E02｜Binance USDⓈ-M REST市场数据](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data)。

## 1. 注册规范

每项方法需要稳定ID、version、implementation_hash、input_dataset/spec、窗口和锚点规则、单位、最低覆盖、形成中政策、参数、缺失处理、output_epistemic_type、测试和消费者。参数更新与算法更新分别记录；只改显示颜色不必重算历史，改变价格格、统计样本、金额字段则必须新版本。

任何method只能消费传入的固定输入，不在纯计算内部fetch latest、读取全局UI选择或隐式使用Date.now。时间通过context.now/cutoff传入，随机实验记录seed。否则同一输入在不同页面和重放时会产生不可解释差异。

## 2. 价格、成交与波动

| ID | 方法与计算 | 必要边界 | 新增价值/默认地位 |
|---|---|---|---|
| M01 | 简单收益P1/P0−1；对数收益ln(P1/P0)分别命名 | 同产品同价型、P>0、边界点真实可用；不跨未知来源段 | 基础描述，默认 |
| M02 | 高低幅度(H−L)/P0 | 固定窗口、完整高低覆盖；分母定义固定 | 描述范围，不等于收益或未来波动 |
| M03 | ATR保留Wilder递推，TR=max(H−L,|H−Cprev|,|L−Cprev|) | period、seed与gap政策固定；缺前收不假设0 | 尺度归一化，复用 |
| M04 | RV=sqrt(sum(r²)/n × 年观测次数) | 等间隔log收益、连续市场年化、是否去均值明确 | 历史风险描述；不称预测 |
| M05 | 趋势效率=|sum r|/sum|r| | 分母0为flat/undefined，不填1；窗口连续 | 减少多指标同票，试验 |
| M06 | quote/base窗口VWAP=ΣquoteVol/ΣbaseVol | 同成交群体、分母>0、锚点与覆盖 | 替代未标近似，优先 |
| M07 | HLC3近似VWAP=Σ((H+L+C)/3×V)/ΣV | 明示近似与分辨率；仅有低精度输入时用 | 历史兼容，不与M06同名 |
| M08 | 相对成交量=current/median(reference) | 同周期/季节口径；形成中不能直接比完整量 | 参与度背景，条件启用 |
| M09 | K线主动净量=2*takerBuy−total | 原生量单位一致、0≤takerBuy≤total | 利用已有额外字段，优先 |
| M10 | 价格距价位百分比及ATR倍数 | 价位known_at≤评价时点；ATR有效 | 比绝对价位更可比，优先 |
| M11 | 前一完整UTC日高低/均价 | 明确目标日；缺日不退更早日 | 图表结构锚点，修正 |
| M12 | 已知价位突破条件：closedClose>level+buffer，镜像下破 | level先于测试已知；确认状态与方法已定 | 修复近端分支，不称胜率 |

这里年观测次数是规范参数，不从实际缺失后的数组长度推算。例如5m连续市场的完整年理论频率与证券session频率不同，禁止统一365×24×12。日线及以上数据不能恢复盘中先后顺序，高/低同时触及只证明范围，不证明先涨后跌或止盈先于止损。

EMA/MACD/RSI/布林可继续用于交互，但“5个指标同向”不能自动当5份独立证据。方法注册应给`signal_family=price_trend/price_volatility/traded_flow`及共享输入。family帮助减少重复展示，不是统计证明独立。

## 3. 足迹与分布

| ID | 方法与计算 | 必要边界 | 默认地位 |
|---|---|---|---|
| M13 | 单桶Delta=Buy−Sell；Volume=Buy+Sell | 同源主动方向已核、缺失不是0 | 基础事实派生 |
| M14 | CVD=从显式anchor累计Delta | gap断段/重锚；quantity类型与范围固定 | 优先，非全市场资金流 |
| M15 | POC=max(volume_by_price)并保留并列集合 | 统一tie规则、价格格、窗口 | 修复跨函数不一致 |
| M16 | 价值区由POC向相邻格扩张至指定比例 | 明示空格/并列和实际coverage | 保留现有政策但版本化 |
| M17 | 同价失衡Buy(p)/Sell(p)及镜像 | 最小绝对量、零分母另类、无Infinity | 保留并正确命名 |
| M18 | 对角失衡Buy(p)/Sell(p−bin)，镜像 | 精确相邻格、方向排列、零量与缺失不同 | 可选，独立于M17 |
| M19 | 同柱连续相邻价格格失衡数 | 不跨空缺或反向格；分析格固定 | 新增需实验 |
| M20 | 跨时间持续方向序列 | 每bar统计定义一致；缺bar中断 | 与堆叠失衡分开 |
| M21 | POC/VA迁移Δ与价格相对位置 | 相同范围长度与格；可见窗口变动不当市场变化 | 可选描述 |
| M22 | SFP候选/确认/失效状态 | level_known_at、confirmBar完成、后续失效 | 先修时点再评价效果 |

不要对大比例分子0/分母0都输出0%。没有成交分布时，POC/VA/失衡均缺失；合法零交易窗口仍可显示零量，但它不产生价位分布。交易所聚合成交数量不是原始独立订单数，不能用trade_count估计参与者数量。

## 4. 持仓、费率与价格关系

| ID | 方法 | 边界与解释 |
|---|---|---|
| M23 | Funding事件原生费率、每小时简单费率r/h、简单年化r/h×8760 | 仅h已知；预测/结算分开；年化是条件数学，不是收益 |
| M24 | 固定窗口已结算费率合计Σr_i | 完整事件集合与同名义额假设；无头寸不算实际现金流 |
| M25 | Funding变化Δr，以bp/百分点显示 | 不用跨零百分比增速；单位decimal↔percent由合同 |
| M26 | OI数量绝对/比例变化 | 期初末锚点、规格与量单位一致；不是资金净流 |
| M27 | OI估值分解P0ΔQ+Q0ΔP+ΔPΔQ | 仅V=P×Q适用；source valuation不同需另法 |
| M28 | 现货/永续溢价F/S−1 | 产品独立，两侧时间/币种/价型可比 |
| M29 | 交割年化基差(F/S−1)×365/剩余天数 | 到期正；ACT规范；与对数年化是不同方法 |
| M30 | Mark-index偏离Mark/Index−1 | 来源与采样一致；不替代末笔基差 |
| M31 | Taker buy/sell ratio或buy share | 优先先聚合量再求比；缺分子分母不伪造 |
| M32 | 账户/头部账户/头部持仓比例 | 三种来源样本分别命名；不当聪明钱总量 |
| M33 | OI/同窗口交易量 | 同币量或同估值，存量/流量维度明确 | 

累计费率、成交量和OI是不同数学对象：费率事件可以按明示假设累计，成交量是流量，OI是时点存量。不能将小时OI求和当全天持仓，也不能将同一个预测费率重复快照累计成当日资金费用。

## 5. 清算、订单簿与执行条件

| ID | 方法 | 输出和限制 |
|---|---|---|
| M34 | 来源限定的观测清算量，按price/qty method分层 | 已观测估值，不称完整损失或净抛压 |
| M35 | 多/空/unknown侧别占比 | 分母和未知比例明示；未知不默认多 |
| M36 | 当前观测清算窗口相对历史位置 | 同采样/来源/方法；没有完整总量基准不造完整率 |
| M37 | 顶层spread=ask−bid；bps=spread/mid×10000 | bid>0、ask≥bid、两侧有效；交叉或空簿拒绝 |
| M38 | 可见bid/ask深度在给定bps范围内的币量/名义量 | 快照是否覆盖整个带宽；不足给lower_bound/partial |
| M39 | 顶层microprice=(ask×bidQty+bid×askQty)/(bidQty+askQty) | 仅静态顶层加权价，不是价格预测或可成交保证 |
| M40 | 静态扫单成本：逐档累计目标量的加权价与mid差 | 目标量超过可见深度即incomplete；不代表真实交易滑点 |
| M41 | 订单流不平衡OFI | 需要连续可恢复盘口更新，单个20档快照不够 |

M37–M40可在已有合法book快照上试验，但应在UI醒目标为采样时点和可见范围。20档覆盖价差可能很窄，不允许将未见带宽深度当0。真实执行还受延迟、撤单、费用、队列和市场冲击影响，本项目不构建下单平台。M41在持续L2尚未验证前保持未启用，不从两张相隔5分钟快照拼出“真实OFI”。

## 6. 跨资产、期权与事件

| ID | 方法 | 约束 |
|---|---|---|
| M42 | 收益率/利率差：DGS10−DGS2等 | 同发布/观察版本、百分数单位；不是预测概率 |
| M43 | CPI同比=100*(Index_t/Index_t−12−1) | 同季调/序列版本，缺月份不跳过；发布惊喜需额外共识数据 |
| M44 | 跨资产收益相关 | 共同可用时间与session、样本数；沿用旧价不算新样本 |
| M45 | 稳定币供应变化与价格偏离 | 原生/跨链、供应/市值分开；不解释为BTC净买盘 |
| M46 | ATM IV/期限结构 | 规格与报价、moneyness、方差插值，截断与薄报价标记 |
| M47 | IV−RV差 | 同年化、期限与标的；不推无风险收益 |
| M48 | 事件前后窗口收益/基准差 | 预声明事件与窗口，混杂和重叠；不是因果证明 |
| M49 | 概率Brier=mean((p−y)^2) | 客观结算、前瞻概率、基线、结算缺失率、分布与校准图 |
| M50 | 信息增量/遗漏与引用支持 | 定义来源面板、人工标注对象和分母；不是全网真值 |

这些方法并非同时进入首页。M42–M47只能在对应数据真实可用、用途可接受和覆盖通过时启用。尤其FRED的观察日期、宏观共识预测、ETF净流与期权仓位方向均不能靠现有字段名称猜出。[C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1) [E04｜Deribit期权摘要](https://docs.deribit.com/api-reference/market-data/public-get_book_summary_by_currency) [E15｜FRED/ALFRED实时区间](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html)

## 7. 公共边界函数

`selectComparableWindow`应根据instrument、source、method、finality、cutoff和锚点容差选输入，并返回未选原因。`safeRatio`返回分母缺失/零/不合法类别而不是仅返回数字。`quantizePrice`依据规格和格定义，不能使用当前币价随意变grid。`classifyQuality`使用方法实际依赖，而非所有数据同一阈值。

这些是拟新增职责名称，不声称仓库已有同名函数。可以适配现有helper，禁止为了统一新建三套相同工具。只对本次切片使用的方法建立实现；其余登记为not_enabled，不构成主线欠账。

## 8. 参数与默认值政策

窗口、分位、最小量、价位缓冲、freshness和异常阈值都是明确参数，不是绝对金融定律。初始值来源分为用户习惯、原实现兼容、官方规格、经验设计、已验证模型五类。不能把原实现中的0.05%或72直接改名为“专业阈值”继续使用。

参数评价采用敏感性曲线和独立测试期，记录所有试验而非只保留最好结果。涉及高频重叠窗口时，有效样本数远小于bar数量，不能拿百万条记录当百万独立实验。对于描述方法，比较的是解释清晰和一致性，不要没有预测目标也硬报胜率。

## 9. 同输入复算的含义

数值方法在固定输入/版本/精度内应一致；跨语言实现先定义容差及排序并列规则，不要求未经定义的浮点字节绝对相同。哈希用于输入身份，不能证明方法正确。原始payload、转换版本与结果引用同时保留才能定位错误来源。

模型解释不要求逐字重现，但原输出artifact必须能读取；重新调用模型生成的是新解释版本，不能冒充历史原文。输入修订后允许新方法结果不同，区别在于不无痕覆盖旧结果，而不是禁止所有更新。

## 10. 价值筛选：每个新增方法至少赢什么

候选可以减少时间/单位误读、揭示有意义的分歧、缩短核查时间、发现旧流程遗漏的异常，或以更低维护成本提供同等结果。只增加图表颜色、术语或相关指标数量，不足以进入默认产品。

对M08/M14/M26/M28/M46等新信息分组做增量对照：价格/成交基线→加持仓成本→加事件→加期权。只有依赖数据和费用均明确时才测试；不存在的数据不通过模拟漂亮结果来证明价值。某组没有增量可以留在专题页，不默认喂给每份报告。
