# 10｜辅助数据升级：宏观、ETF、稳定币、链上与期权

## 1. 先纠正当前状态

当前规范目录已经登记九条FRED序列、SOFR、USDT/USDC供应、CoinGecko全局数据、mempool费用和Deribit期权摘要。它们不是过去事实报告描述的空白区域，但目录仍不代表已被前端和LLM消费，也不代表实时采集持续成功。[C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1)

本卷的原则是把辅助数据变成有时间与意义的背景，不让它们污染短时市场结论。小时OI与日/周宏观可以同时展示，但不在一个未说明单位与发布时间的分数中相加。

## 2. 利率与美元：尽量先用可解释的派生

DGS2与DGS10可以形成期限利差，单位是百分点；显示bp时乘100。DFII10与T10YIE分别反映来源定义的实际收益率和通胀补偿，不能当独立于名义利率的完全不同证据投票。每条来自FRED的数据还要保留系列说明、单位、频率、季调、来源机构、revision与版权提示。

DTWEXBGS是广义贸易加权美元指数，当前目录正确标明基期，不得在界面改写为DXY。使用它研究美元背景时，应比较自己的变化而不是与另一个指数水平直接相减。短时BTC价格不能用昨天美元指数解释为“即时美元拉升导致”。[C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1)

建议首版显示最新有效观察、相对前个可比观察的变化、实际发布/接收状态及休市说明。未建立发布日历时，sourceStale不应简单按24小时判断：周末日频市场、周度统计和节假日更新规律不同。新数据层已对部分宏观不作源新鲜度判定，这是诚实状态，不能为了所有卡片绿色去填假时间。[C06｜cloudflare/finance/dataset-store.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/dataset-store.mjs#L1)

## 3. CPI：水平、增速和惊喜是三个概念

CPIAUCSL是季调指数；同比需要同一版本的当月与12个月前，环比需要上月。一个月缺失不允许跳到两个月前还叫环比。历史研究应使用当时版本，今天导入当前全系列不能证明过去已知。ALFRED日期级实时区间机制可以帮助重建版本，但精确日内可见时间还需要原始发布记录。[E15｜FRED/ALFRED实时区间](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html)

“超预期”需要事前冻结的市场共识与实际首次发布值；现有九条序列没有共识调查。不能用上月值代替预期，也不能让LLM从新闻口吻推一个共识数字。第一版只做发布事实与观察变化；共识数据采购或获准来源另行登记。

## 4. 所谓流动性合成指标

当前目录含WALCL、WTREGEN和RRPONTSYD。仓库说明已区分前两者百万美元、RRP十亿美元，且WALCL时点、WTREGEN周平均和RRP日频不相同。直接相减即使单位转换正确，也不自动产生同一时点净现金供给，更不等于BTC潜在买盘。[C03｜docs/research/workbench-binance-data-plan-2026-09-16.md（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/docs/research/workbench-binance-data-plan-2026-09-16.md#L1) [C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1)

建议先把三条独立展示，并解释数据类型、观察期间和可见时间。若研究者提出某种“净流动性代理”，把公式、重新采样策略、使用最后已知值的最大年龄、发布日期与历史版本写入实验。输出名称含proxy，检验与BTC的关系仅为样本内/外统计，不能预设单向因果。重新采样会引入台阶和日历效应，必须与简单基线对照。

## 5. ETF：正式新增，而不是用股票ETF报价替代

当前旧跨资产QQQ/SPY/GLD属于证券报价，不是BTC ETF净申购赎回。新规范目录没有已证明完整的BTC ETF流管道，仍需独立能力。历史研究资料中的发行人和汇总来源是候选，不构成本轮实际商用授权或实时覆盖核验。

建议对象分基金披露、来源汇总、估算流量和到齐状态。保存fund_id、as_of_date、shares、NAV、BTC holdings、披露时间、获取时间、修订、币种及字段来源。AUM变动包含资产价格变化，不可直接叫净流入。份额变化×某NAV可以作为有假设的估算，需说明申赎时间、费用及数据不完全，不能替代来源正式flow。

每日合计只对已确认可比明细计算，缺一只基金时标partial并列缺项。合法零值、尚未披露、供应商“-”、解析失败四种状态不得都转0。晚到修订产生新日期版本；当时报告保留“当时未到齐”，今日页面可显示修订后合计。

验收用合成矩阵覆盖：全部到齐、部分零值、部分空白、两源冲突、份额与NAV不同as_of、周末、基金新增/退出和单位千/百万。只有完成来源条款、字段与历史范围核验后，才允许真实外部接入。

## 6. 稳定币：供应、价格、链映射与市值分开

当前USDT/USDC背景来源是DefiLlama，原生circulating及prevDay/prevWeek保留。它能说明供应背景，但来源更新时间缺失时不能用抓取时间当供应变化发生时间。[C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1) [C05｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L77)

供应新增不是交易所净流入，授权发行未流通不是实际流通，桥接表示与原生发行不能重复计数。市值等于价格×供应的近似关系不能让系统在供应缺失时默认价格1美元反推“真实供应”。脱锚时价格、供应与市值更应单独显示。

建议首版给每币供应变化、来源原单位、可用时间和价格偏离；不加入固定低权重或高权重总分。历史source切换时保留不同系列，只有核对定义可比后才建立显式拼接方法。即使两个提供商都称circulating也不能靠数值近似认定一致。

## 7. 链上与矿工的分层

mempool费用是网络拥堵/交易确认费用背景，不是交易所资金流。未来可增加区块费率、交易数量、难度或区块间隔，先利用合适授权API，不因BTC研究就默认自建完整节点。

交易所余额、矿工卖出、实体流入依赖标签或聚类。Glassnode的PiT说明历史指标会因实体识别与修正发生变化；计算时间与公众可用时间不同，早期历史字段覆盖也不当然完整。[E08｜Glassnode PiT](https://docs.glassnode.com/data/point-in-time-metrics)

自建节点能提供链事实，但不能天然识别某地址属于交易所或资金转移代表买卖。自行复算指标应保存区块hash/height、确认深度、重组处理、价格序列和方法版本。矿工相关经济解释不能从一个已标地址转账直接推断“矿工正在抛售”。

地址级大范围标签采集、自建归档索引或商业标签采购只在具体问题、授权和维护资源明确后进行，不能作为首份市场简报前置。

## 8. 期权能力的分级交付

Q0是当前已登记的原生摘要：按到期整理、展示质量和覆盖；Q1先复用summary已提供的可空bid/ask、underlying与利率，再补缺少的instrument定义和报价校验，生成有限ATM期限结构；Q2才做固定delta偏斜与数值校验；Q3是独立模型实验，不默认建GEX或潜在仓位热图。[C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1) [E04｜Deribit期权摘要](https://docs.deribit.com/api-reference/market-data/public-get_book_summary_by_currency)

每批记录capture_start/end以及各合约时间。分批取数期间市场变化会造成截面异步，最大允许采样跨度由使用任务决定，不能拿今天旧期权mark与最新现货混合。价格单位、结算币、到期UTC、乘数、call/put与delta约定是前置，不以instrument名字看起来像BTC就跳过。

无双边报价、过宽价差、零bid、异常mark、深度极低、缺期限括号分别标质量，不用插值填满漂亮曲面。历史定价误差大的原因可能是数据而不是模型，不先靠更复杂求根或GPU修复。

## 9. 全部辅助数据与三层分析的接法

结构化观察先进入规范数据层；新闻/披露中的主张进入事件层；综合器根据研究窗口选择允许证据，不把每个macro字段都塞到每次5m分析。小时任务可能只需交易所事件与当前仓位；周度复盘才需要更长宏观和链上背景。

“相关性强”不是永远有效。保存选择理由和没选的主要原因，允许用户查看背景但不占默认简报。两个指标共享来源或定义关系时，归入同一证据家族，不增加投票数。

## 10. 发布与停止条件

辅助能力每项独立开关，关闭时没有确认文案或模型暗示。缺vintage时仅当前描述，缺共识时不叫惊喜，缺ETF明细时不叫总量，缺双边期权时不叫可成交曲面。数据不足不影响其他有效市场观察。

如果来源权限不能满足、历史缺失无法补、样本短到没有统计意义或新增内容主要重复已有解释，则停止该能力投入，保留候选及原因。停止不是全部系统失败，也不是必须换更昂贵供应商。
