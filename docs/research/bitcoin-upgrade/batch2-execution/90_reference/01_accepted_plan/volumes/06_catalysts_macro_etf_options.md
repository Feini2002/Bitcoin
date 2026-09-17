> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# 卷 06｜催化剂、宏观、ETF、稳定币与期权能力的实施设计

本卷将新的业务分析能力拆成可以独立交付的模块。官方催化剂和宏观版本、BTC ETF流量、期权预期不要求同时接通；每项有自己的数据权利、覆盖门槛和退出条件。不存在的数据源不得由静态文案补齐。

## 1. 当前起点与新增价值

事实报告确认当前可用背景主要是Yahoo跨资产报价、VIX/VIX3M/MOVE旁路、USDT/USDC稳定币背景及一般新闻分析；没有已证实的运行FRED/ALFRED、BTC ETF净流入和Deribit期权链。股票ETF价格不是BTC ETF申购数据。[R04｜仓库事实报告§2，L38-51](../inputs/repository_facts.md) [R09｜仓库事实报告§4 B3-B4，L120-131](../inputs/repository_facts.md) [R10｜仓库事实报告§5，L133-148](../inputs/repository_facts.md)

本卷选择的新增价值是：知道接下来哪些官方事件何时发布；知道宏观数据当时版本和修订；把ETF需求叙事与可追溯披露对照；把稳定币背景和真实BTC流量区分；在有报价质量时显示期权市场的波动预期与偏斜。不是一次增加几十个宏观序列或一张彩色曲面。

## 2. CAP-CALENDAR｜经验证的催化剂时间线

### 2.1 用户场景与前后变化

升级前，当前辅助calendar条目可能只是从文章关键词和发布时间提取。升级后，首页未来事件只包含有可靠排期依据的项；文章提到某事件但排期未核实，显示在“待核查”而不是倒计时。用户可订阅该事件的发布、修订或取消，不会因为重复报道多次被提醒。[R14｜仓库事实报告§8.2-8.3，L217-240](../inputs/repository_facts.md)

### 2.2 输入与字段

首批来源为FOMC官方会议/材料日历与BLS CPI发布日历，后续再按使用问题扩展。[S017｜Federal Reserve FOMC日历](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm) [S018｜BLS CPI发布时间表](https://www.bls.gov/schedule/news_release/cpi.htm)

`scheduled_event`字段：event_id、event_type、title、organizer、jurisdiction、scheduled_start、scheduled_end、source_timezone、time_precision、schedule_revision、source_document_id、source_published_at、first_seen_at、status、related_series、expected_release_components、verification_status。

时间必须使用IANA时区，例如America/New_York；不要把纽约固定成UTC-5，夏令时转换由统一时间库/平台能力完成。日期级事件不默认转00:00Z倒计时，UI只显示日期。多日会议区间与政策决定发布时间是不同对象；只找到会议日期时不填具体决定时间。

### 2.3 状态机

```text
DISCOVERED_UNVERIFIED → SCHEDULE_CONFIRMED
SCHEDULE_CONFIRMED → REVISED / CANCELLED / DUE
DUE → RELEASED / DELAYED / NOT_OBSERVED
RELEASED → CORRECTED（保留原始发布版本）
```

`NOT_OBSERVED`是系统未获得发布，不证明发布未发生；`DELAYED`必须有来源说明，不能只是抓取超时。事件延期保留同event_id的新schedule_revision，旧提醒状态关闭并产生“时间变更”记录，不重建成互不关联的两件事。

### 2.4 采集和解析

先读取官方结构化页面/RSS/可用文件，保存允许的原始片段与解析版本。解析器只抽取标题、官方时间、链接和状态；页面结构变更时停止写入新日程，保留旧已核实版本并标需复核。模型只能辅助解释或标出候选，不自动写入confirmed时间。

请求采用来源预算和有限重试；401/403不绕过；网络失败不触发假取消。定时任务只检查未来有限区间和近期发布，避免每次重抓多年历史。历史排期与当前网站最新排期不同，研究run用schedule_version固定。

### 2.5 与市场关联

事件页显示“发布前”“发布后”的固定窗口，不允许用户滑动后仍标同一研究结果。发布前市场事实与发布后市场反应分开保存，后者不能进入前者的预测输入。当前观察与历史事件统计都可以链接，但历史统计必须保留样本定义。

如果没有经许可的同期一致预期数据，不显示“超预期/不及预期”字段，或明确它只相对前值而非市场预期。预期调查、预测市场概率和分析师观点是不同来源，不能混算。

### 2.6 API、存储与验收

拟议`GET /api/research/v2/calendar?start_at=&end_at=&known_at_lte=`返回事件版本、UTC及原始时区、精度、状态和证据；无可靠时间的项不进入`confirmed`集合。`POST`写入仅内部source adapter或授权人工复核端可用，不给LLM工具开放任意写日历。

测试包括夏令时切换、只有日期、会议两天但无发布时刻、官方延期、文章时间早于真正发布、页面空白和重复获取。通过标准是不会创造未来时间、变更可追踪、旧run可还原。失败退回来源链接/待核查列表，不影响行情brief。

## 3. CAP-MACRO｜宏观版本和事件响应研究

### 3.1 最小数据范围

不先接“全球宏观全家桶”。选择一个明确问题，例如通胀/政策发布附近BTC的波动与方向分布，首批只需相应官方事件、一个或少数宏观序列、可用BTC价格、选定跨资产背景。FRED/ALFRED提供日期级实时区间/vintage机制，第三方序列权利逐项检查。[S015｜FRED/ALFRED real-time periods](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html) [S016｜FRED API条款](https://fred.stlouisfed.org/docs/api/terms_of_use.html)

### 3.2 Observation版本

保存series_id、observation_period、value、unit、seasonal_adjustment、frequency、vintage_start/end、source_release_id、public_available_at、available_precision、received_at、revision_of、source_policy_id。原始单位和转换后单位均保留。

一条“2026年8月值”不能把8月1日当已知时间；一次后来修订必须新版本。ALFRED日期粒度不自动给出毫秒级公共可见时点，日内研究需结合原始发布日程/档案；查不到精确时间则降低研究分辨率。

### 3.3 实时描述与历史回放查询

当前页面可以选latest vintage；历史run必须按模式选择：publicly_available使用当时已公开版本，system_observed使用本系统当时已拿到版本。后补历史只可标`retrospective_reconstruction`，不能伪造收到时间。

数据接口返回选用版本和被排除的未来版本数/原因，便于测试。查询不能只在前端按日期过滤，因为服务端可能已经把最后修订值写回旧观察日期；版本选择必须发生在计算前。

### 3.4 事件研究定义

研究配置包含event_set_definition、sample_period、event_timestamp_source、pre_window、post_windows、price_source、return_method、comparison_baseline、overlap_policy、exclusion_rules和registered_at。发布时在不知道最终研究结果前固定。

可以先输出每事件的收益、绝对收益、实现波动和样本分布，再考虑异常收益或条件分组。异常收益基准须在事件前估计；不能使用全样本拟合市场模型后解释过去。BTC单资产没有天然完美控制组，SPY/黄金等基准选择只是分析假设，应并列敏感性，不称完成因果识别。

重叠事件需要排除、合并事件簇或明确联合事件标签；选择必须提前固定。把同一发布一天内数十个重叠窗口当独立样本，会夸大证据。

### 3.5 统计计算

基础统计可用现有JS/SQL；较长历史的区块重采样在可选Python研究环境进行。arch可以帮助处理序列依赖，但不能修复错误事件定义、缺失历史版本或幸存者偏差。固定种子只提升复算一致性，不意味着统计结论可靠。[S051｜arch时间序列bootstrap](https://bashtage.github.io/arch/bootstrap/timeseries-bootstraps.html)

样本不足时显示n和分布，不用复杂模型生成精确概率。结果输出包括效应大小、样本段稳定性、区间及其假设、剔除原因；没有稳健差异就写无足够证据，而不是继续筛参数直到“显著”。

### 3.6 失败与迁移

新增表/文件与现有Yahoo报价分开，不用FRED低频值替代原实时行情。旧报告中的宏观描述保持历史原文，加来源/版本能力说明；新界面分别标quote context与economic release。API失败时最新宏观显示stale，但不伪装实时发布，也不阻止有效BTC市场分析。

## 4. CAP-ETF｜BTC ETF需求证据面板

### 4.1 目标问题

“关于机构需求的叙事，有哪些实际披露支持？数据是否到齐、是否修订、是否足以与价格窗口比较？”不把每日流量转成自动多空指令，也不把所有ETF报价泛称资金流。当前未确认BTC ETF净流入管道，所以不能假装只是修一个空值bug。[R10｜仓库事实报告§5，L133-148](../inputs/repository_facts.md)

### 4.2 来源与权利

以发行人带日期的份额/资产等披露和经许可的汇总来源交叉核对。IBIT页面是一个具体原始入口；Farside可作汇总参照，但不能假设其全部历史/API/商用分发均免费。[S019｜IBIT发行人披露](https://www.ishares.com/us/products/333011/ishares-bitcoin-trust-etf) [S020｜Farside BTC ETF汇总](https://farside.co.uk/btc/)

接入前登记每个fund的provider、字段定义、币种、as_of_date、发布时区、更新方式、用途和保留规则。基金组成表具有生效区间，不把今天所有基金名单放回历史，也不把注销/新设产品静默剔除。

### 4.3 数据类型必须分开

- `reported_net_flow`：供应商明确报告的净流量，保留其计算/数据口径。
- `shares_outstanding`、`nav_per_share`、`aum`、`btc_holdings`：发行人观察字段，不互相冒充。
- `estimated_flow_from_shares`：根据份额变化与选定估值推导，写明公式和限制。
- `price_return`：基金价格变化，完全不同于申购赎回。

简单估计 `Δshares × selected_NAV` 需要明确估值时点，并可能受份额拆分、费用、数据修订、创建赎回安排等影响。AUM变化含价格影响，不能当净申购。没有完整创建赎回资料时只能称估计。

### 4.4 每日完成状态

每fund/day状态为pending、reported、estimated、revised、unavailable、not_applicable；value可为0但pending必须为null。aggregate存expected_fund_set_version、reported_count、estimated_count、pending_ids、known_sum和completeness。

有一只基金未到齐时，可以显示已确认部分合计，不显示为全体总和。除非来源明确当天没有申购赎回或不适用，不把“-”或空格当0。一个供应商给总和并不自动证明所有组件已到齐，解析器需要保存供应商原始完成标识与本地检查。

### 4.5 版本与窗口

美国交易日与UTC日不同；fund_day用对应市场日历，data_available_at另外保存。以北京时间/新加坡时间看某日早晨，数据可能对应美国前一交易日，标题必须写清。修订产生新版本，并影响“最新数据分析”，不覆盖旧run所选值。

比较价格前必须判断流量何时可见，不以fund_day零点作为公开时点。日流量与同日BTC涨跌相关不证明因果或预测性；不允许用收盘后汇总值当上午预测输入。

### 4.6 展示与报告

表格列fund、交易日、数据版本、已报告/估计、值、来源和首次获知时间；顶层一句“完整/部分/待披露”。趋势只连接可比完整口径，估计值可以虚线/标签但不混作确报。

报告允许描述“已确认的部分净流量为…，仍有…未到齐”，不允许补全未知总额。没有数据时旧静态“ETF确认”文案必须退出，界面显示功能尚未启用或数据不足。

### 4.7 验收和停止

合成样本：同一日两fund为0、一fundpending；后续变reported；再修订前日；基金新加入；来源缺nav；数值带括号负号与千位；表格列变动。检验空值、组成、单位与时点，旧run保持不变。

没有可接受的数据用途权利、实际更新不足或阅读者不使用该信息时，保留人工来源入口，不采购大套餐。ETF不是第一份brief上线的硬前置。

## 5. CAP-STABLE｜稳定币作为流动性背景

### 5.1 保留当前收敛范围

当前链上相关逻辑明确限于USDT/USDC背景，CoinGecko历史与DeFiLlama当前快照回退，不参与交易所余额、矿工、鲸鱼。该收敛可以保留，不为了“链上全面”扩到一堆未经授权标签指标。[R04｜仓库事实报告§2，L38-51](../inputs/repository_facts.md)

### 5.2 市值、供应和估值变化

CoinGecko市场图的价格、市值与成交量字段不是同一个量；DeFiLlama稳定币口径是流通供应/锚定信息。供应、market cap、链分布和估价方法分开存储，不能把两个供应商字段都叫liquidity然后无缝拼接。[S012｜CoinGecko market chart](https://docs.coingecko.com/reference/coins-id-market-chart) [S013｜DeFiLlama 方法与仓库地图](https://docs.llama.fi/) [S014｜DeFiLlama stablecoin页面](https://defillama.com/stablecoins)

若 `market_cap≈supply×price`，变化可能来自price，不能全部解释为净发行。桥接映射、锁定与原生发行避免重复计数；超出当前来源可解释范围时仅展示供应商定义，不构造“真实全球可用美元”结论。

### 5.3 来源切换

与K线不同，稳定币供应商的统计覆盖也可能不同。source_changed时停止同序列差分，先并行展示两来源重叠期差异并记录method_mapping。无法确定可比就分段，不以CoinGecko历史+DeFiLlama当前点计算看似精确的当天增量。

### 5.4 发行人核对

Circle、Tether披露可用于核对发行人表达的供应/储备背景，但它们不是本系统独立审计，也未自动提供无限历史再分发授权。[S078｜Circle披露](https://www.circle.com/transparency) [S079｜Tether披露](https://tether.to/en/transparency/)

USDT/USDC脱锚事件由可信价格源按预声明阈值、持续时间、场所覆盖判断；单所异常价先作为数据/局部市场异常，不立刻断言发行人偿付问题。阈值是提醒规则，不是破产概率。

### 5.5 验收

价格下跌但供应不变、供应增加但估值下跌、来源切换、链分布重复、当前快照缺发布时间等情况均有样本。输出只称背景，不自动加到BTC多头分；断源时不把供应降到0。

## 6. CAP-ONCHAIN｜原始链上与标签指标的可选扩展

当前阶段不默认自建全节点。若明确问题是区块拥堵、费率或区块统计，可接可授权API或后续节点；若问题是交易所资金流/矿工卖压，必须承认依赖地址标签、实体聚类与推断。Glassnode PiT方法说明历史实体指标会变化；Coin Metrics Community数据采用CC BY-NC 4.0，非自动商用底座。[S021｜Glassnode PiT](https://docs.glassnode.com/data/point-in-time-metrics) [S077｜Coin Metrics Community](https://docs.coinmetrics.io/packages/coin-metrics-community-data)

每个链上指标登记原始可复算、依赖价格、依赖标签、供应商专有四类。记录区块height/hash、确认/重组状态、标签版本、价格基准和计算时间；标签后来增加不能回填过去然后声称当时知道地址属于交易所。

自建节点和索引器只在需要自行复算且托管来源不能满足权利/覆盖时引入。不要因为“比特币系统应有链上数据”就新建无人维护的高存储服务。旧planned数据池页面也不是已有链上索引器。退出条件是没有明确研究任务、无法取得授权标签或维护负担超过可测使用价值。

## 7. CAP-OPTIONS｜期权预期与尾部关注，不是方向保证

### 7.1 进入条件

期权是本方案条件能力。必须先确认来源用途、合约规格、快照质量、运行预算和实际需求。`derivative_option_surface`表存在不代表可以直接启用；当前role中的DVOL也不当数据。[R09｜仓库事实报告§4 B3-B4，L120-131](../inputs/repository_facts.md) [R15｜仓库事实报告§9，L248-283](../inputs/repository_facts.md)

最小产品选择：当前有限期限ATM IV、7/30/90天等目标期限的可用括号（仅示例配置）、IV与历史RV的比较、偏斜的明确约定、报价质量。目标期限缺有效样本时不外推填满。

### 7.2 数据采集

先获取instrument规格和available/expired状态，按currency/market/kind筛选。官方规格区分contract_size和min_trade_amount，不能假设相等。快照汇总、必要订单簿抽样和波动率指数端点按方法限流，raw频道需要认证且不保证绝对无合并。[S076｜Deribit instrument规格](https://docs.deribit.com/api-reference/market-data/public-get_instruments) [S008｜Deribit summary by currency](https://docs.deribit.com/api-reference/market-data/public-get_book_summary_by_currency) [S007｜Deribit get_order_book](https://docs.deribit.com/api-reference/market-data/public-get_order_book) [S009｜Deribit 采集最佳实践](https://docs.deribit.com/articles/market-data-collection-best-practices) [S010｜Deribit 限流](https://docs.deribit.com/articles/rate-limits) [S011｜Deribit volatility index](https://docs.deribit.com/api-reference/market-data/public-get_volatility_index_data)

不将官方示例的test域或演示合约规格直接写入生产设置。开发者需核对当前REST/JSON-RPC方法与浏览器/Worker请求能力；文档中的GET带body示例不能自动作为可直接运行的Web Fetch实现，应按官方实际接受的查询或JSON-RPC transport编写并验证。

### 7.3 Quote契约

instrument_id、snapshot_id、quote_time、received_at、expiry、strike、option_type、bid/ask、mark、bid_iv/ask_iv/mark_iv、index_price、underlying_price/forward、open_interest及unit、quote_currency、settlement_currency、spec_version、source_status和quality_flags。

一批快照保存start/end与最大时间离散度。报告可称“在这个采样区间取得的截面”，不能称所有合约精确同毫秒。若从聚合summary补单合约orderbook，记录每个数据时间，超出允许跨度则重抓/降级，不混成隐含同步。

### 7.4 报价筛选

必须有有效到期时间、规格与价格；bid/ask不得为负或bid>ask；mark-only与有双边可执行报价分开。相对价差可定义 `(ask-bid)/mid`，mid为0时无效，筛选阈值是实验配置。零bid不能直接用bid_iv=0参与平均。

还应检查成交量/OI是否仅作辅助质量信息，不能因有OI就假设当前报价有流动性。深虚值/近到期数值病态单列原因，不能将不稳定IV当尾部风险精确数字。

### 7.5 ATM与期限结构

ATM选择基于明确的forward或index moneyness约定，不能在不同期限随意切换。采用最近可用strike还是同期限插值必须写方法版本。若做目标期限插值，优先在有效相邻期限间对总方差 `w(T)=sigma(T)^2*T`线性插值，再恢复sigma；T以实际秒数/约定年秒数计算。无左右括号则null，不向外无限延长。

这是拟议研究方法，不保证无套利曲面或交易执行可用。结果需展示原始期限和插值标记；跳过的报价及原因可查。供应商DVOL方法与自算ATM IV不是同一指标，不能直接替换名称。

### 7.6 偏斜和Greeks

若增加25delta risk reversal，先固定delta定义（现货/远期、是否premium-adjusted）、call/put符号与到期、插值规则。简单 `IV_call25 - IV_put25` 的正负要在UI明确，不在不同产品间反转。没有可比delta则不输出。

vollib可作独立校验，但先完成币本位价格和模型输入约定；无需定价时不加它。不能从公开OI推断做市商是多Gamma还是空Gamma，因为持仓方向/参与者身份未知。最大痛点等模型最多是带假设研究对象，不用于第一版风险结论。

### 7.7 IV/RV解释

IV表达期权价格中的模型化波动尺度，包含风险溢价、供需与模型约定，不是物理世界未来真实波动保证。与RV比较必须说明期限和历史窗口；过去30天RV与未来30天IV时间方向不同，这本来就是比较目的，但不能把差值称无风险套利。

报告允许：“所选期限的IV高于选定历史RV，可能反映风险定价或其他期权供需；具体未来波动仍未知。”不允许：“市场预测未来上涨X%”。

### 7.8 工作流、失败与验收

规格缓存 → 小范围期权快照 → 筛选/报价质量 → 确定性指标 → 写option_batch与evidence → API → 预期页签/报告。API失败只降级期权维度；不替换成静态数据，不让主brief失败。

测试包括到期前后、缺双边报价、价差异常、单位/币种错误、截面时间跨度过大、目标期限无括号、历史规格变化、IV小数/百分数混淆。模型库对照只在相同约定下要求价格—IV往返容差，不要求无条件匹配供应商mark。

费用与运维包括限流、缓存、潜在商业历史和批计算。先固定有限合约范围与采样间隔测价值；没有研究增量就保留原生指标链接，取消全曲面工程。

## 8. CAP-CROSSASSET｜跨资产环境的时间对齐

当前有跨资产窗口测试，但完整交易日历与休市旧值新鲜度未验证。[R10｜仓库事实报告§5，L133-148](../inputs/repository_facts.md) 新接口保留market_session、last_trade_at、price_kind、adjustment、exchange_timezone和calendar_version。

相关性用共同有效收益区间，不将证券周末填平价格后与BTC连续波动计算大量0收益；不要用不同close时刻拼为同一日而不给定义。用户看到“相关性”时必须能查看样本、窗口和session规则。样本少或基准变更返回null而非0相关。

quote背景可以显示最近收盘并明确时间；未来研究如需要事件分钟级联动，必须购买/接入合适粒度和历史，不从日线重建分钟价格。exchange_calendars是可选离线组件；不是为三只ETF强加在线Python服务。[S047｜exchange_calendars仓库](https://github.com/gerrymanoim/exchange_calendars) [S048｜exchange_calendars LICENSE](https://raw.githubusercontent.com/gerrymanoim/exchange_calendars/master/LICENSE)

## 9. 数据与LLM的边界

LLM输入只包含本run有效观察、具体单位、time_mode、quality与source policy。缺某能力就传`capability_status=not_enabled/no_data`，不给“请结合ETF与期权做综合分析”这种默认要求。模型不能自行假设planned组件已上线。

对事件和期权，输入“解释需要考虑的限制”可以是程序固定方法说明，但不能带预设方向。模型提出新指标只能作为research_request返回，不能立即调用未注册来源或改变schema。

## 10. 关联文件与任务

现有主要受影响位置：`cloudflare/binance-klines-worker.js`的衍生品/稳定币相关入口、`cloudflare/yuqing/yuqing-worker.js`、`yuqing-facts.js`、`fenxi/`、`shijian/`、`js/pages/derivatives.js`是否存在需以目录核查（事实报告仅确认页面职责，不将猜测路径当既有文件）、`js/pages/events.js`与`js/pages/news.js`。精确bind在WP-001完成。

拟新增职责位于`research/domain/`、`research/adapters/`或按仓库现有布局接受的等价位置，所有新增路径在卷09标为建议，不要求另外顶层迁仓。任务WP-026/027/028/029/046/047分别负责官方日历、宏观、ETF、稳定币、事件研究和期权；不得由每个任务各建一套来源、时间和证据服务。

## 11. 交付顺序与独立价值

第一阶段新主brief用已有市场数据即可。官方催化剂可独立新增，用户能获得真实时间线；随后宏观/ETF输入分别接入，不能互为不必要依赖。期权作为条件包，不因尚未接通阻塞观点记录或降噪。

每项数据源只有在“来源用途可接受＋输入语义通过＋最小业务结果可读”时启用对应feature flag。源不可用则模块明确未启用，删除静态假确认文案，但保留其他可用研究功能。
