> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# 卷 15｜统一术语、来源索引、未解决项与一致性规则

## 1. 五种证据层次

**R：仓库调查事实。** 来自用户上传的事实版v2，作者检查的是当前本地工作区。网页端据此可以针对已报告实现提出评价，但不能自称重新读过全部源码或验证远程部署。

**H：历史文档/原型目标。** 员工角色、planned页面、旧README架构图与静态文案表达意图，不自动变成已实现能力或本次必做需求。DVOL、FRED、ETF这些字样不能当作数据链已经运行的证据。

**E：本轮外部事实。** 来自原始文档、源码、许可证、论文和提供方条款；查询日期统一2026-09-16，持续变化页面需实施时重查。文档写支持某能力不证明本系统运行成功。

**D：设计决定。** 产品工作区、数据契约、方法定义、默认降噪规则、提示词、任务和架构是本轮的建议，可被真实仓库/实验结果修订。它们不是用户已经批准的费用、生产部署或精确性能承诺。

**V：待验证。** 真实调用、来源完整率、数据许可适用、性能/账单、模型增量、用户效率、长期统计效果和生产恢复等。本包的文档/JSON/SQL语法检查只属于交付物自检，不能把这些V变成通过。

## 2. 统一术语表

| 术语 | 本套方案中的唯一含义 | 容易混淆的对象 |
|---|---|---|
| Article | 某来源文档及其内容版本 | 不等于现实事件，也不等于独立证据 |
| Event | 被追踪的现实事件及其版本 | 多篇转载可能只是一件事 |
| Claim | 能定位证据、被支持/否认/修订的一项主张 | 来源说法不自动变成真值 |
| Market fact | 程序确认来源/单位/窗口的观测或计算描述 | 不是未来方向或因果解释 |
| Interpretation | 对已知事实的解释与替代解释 | 不以流畅措辞冒充直接观察 |
| Condition case | 有成立/失效/检查条件的判断 | 不是自动交易指令 |
| Research View | 固定研究现场与绝对窗口/版本 | 不是scrollPosition，也不是一条观点 |
| Viewpoint | 用户或系统记录的研究判断和修订 | 不必是预测，不自动算对错概率 |
| Forecast | 有事前目标、截止、结果规则的概率命题 | 固定confidence或描述分位不属于它 |
| Run | 一次有界研究执行 | 不等于输入内容或报告正文 |
| Bundle | 已封存输入/方法/政策清单 | 与某处名叫snapshot的输出JSON不同 |
| Artifact | 获准保存的内容对象及定位/摘要 | 有hash不代表内容永远可读或真实 |
| Evidence ID | bundle内能解析的证据引用 | 链接可打开不等于支持主张 |
| Market cutoff | 市场分析窗口允许的最晚时点 | 不等于实际抓取结束 |
| Knowledge cutoff | 对该run允许使用的信息最晚可见时点 | 不等于模型训练截止 |
| system_observed | 本系统当时实际知道的内容 | 今天找到的旧文不能补成当年已知 |
| publicly_available | 当时公众可取得的相应版本 | 需要发布时间/历史版本证据 |
| retrospective_latest | 用后来可见最新版做回顾 | 不能拿来证明当时预测有效 |
| Quality vector | 可用性、过期、连续性、来源和时间精度 | 不汇总成涨跌概率 |
| Origin group | 共同原始公告/研究/信源 | 不按域名数和Agent数计独立票 |
| No material change | 在检查范围内没有足以改变问题的新变化 | 不等于没有执行、没有风险或永远不变 |
| Legacy unknown | 旧来源/语义/版本无法证明 | 不用默认值填满让它看起来完善 |
| Required capability | 完成这次问题必须有的输入 | 可选期权/ETF未启用不必使整个简报失败 |

卷03早期使用的View词语指研究观点时，应以本表Viewpoint为准；正式ResearchView专指研究现场。卷04业务示例中的price_kind/value等为概念别名，正式wire采用卷10/schema的price_type/notional。P03的candidate.v1只代表模型候选协议，正式report.v2由服务端映射验证后生成。

## 3. 跨卷和机器材料优先级

当文字示例与正式字段形状不同，先看卷10的映射说明和contracts正式schema，不把example_only、示例来源或注释字段原样写入生产。金融含义依卷04/05，不能为了满足JSON enum乱选一个价格类型。新增复杂字段需要一起更新契约、样例、消费者与测试，而不是只改prompt。

任务ID固定WP-001—060；方法ID固定M-001—021；提示词P01—P05；用户任务U01—U06；数据/主题能力使用CAP前缀。任务完成状态由真实实施证据决定，文档拥有稳定编号不意味着已经执行。

API一律以`contracts/openapi.design.json`列出的拟议v2路径为正式参考；例如日历为/calendar、预警为/alerts/rules与/alerts/episodes，研究现场更新为PUT与If-Match。源数据内部adapter可以有不同路由，但不能要求前端猜测多个同义接口。

SQL是新增研究域的参考设计，不包括对真实旧表的ALTER和实际migration编号。普通SQLite语法检查不证明D1所有约束、权限、性能或远程环境；尤其CAS更新0行不会自动使后续batch写回滚，应用必须采用卷10的token守卫。

## 4. 原始输入与仓库事实索引

两份原始材料保存在inputs中，只为离线追溯。它们不是本轮原创内容，不计入原创正文统计；没有修改其结论或把以前的观点当本仓库事实。最新调查已经删除旧作者的升级建议，这允许本轮独立评价架构和分析体系。

| R编号 | 事实主题 | 原报告范围与边界 |
|---|---|---|
| R01 | 工作区及核验边界 | [事实报告§导言，L3-10](../inputs/repository_facts.md)：当前工作区非固定提交或线上；HEAD历史记录9206c35不能绑定未提交变更。 |
| R02 | 原生技术与已用组件 | [事实报告§1，L16-26](../inputs/repository_facts.md)：HTML/CSS/JS、Pages/Workers/D1，已用LWC4.1.3和现有采集/模型能力。 |
| R03 | 部署与并发治理 | [事实报告§1.3，L28-36](../inputs/repository_facts.md)：本地配置已启用但远程未知；65个跟踪文件变化及额外未跟踪。 |
| R04 | 当前系统地图 | [事实报告§2，L38-51](../inputs/repository_facts.md)：现有真实模块与路径，connected不等于服务在线。 |
| R05 | 双快照入口 | [事实报告§2，L53-58](../inputs/repository_facts.md)：独立快照与行情Worker摘要并存，yuqing并行读多个端点。 |
| R06 | 计算/指纹/留存 | [事实报告§3 A1-A3，L62-90](../inputs/repository_facts.md)：指纹部分只含最新时间或数量；输出保留不等于输入重放；各类保留有边界。 |
| R07 | 回退来源与指标槽 | [事实报告§3 A4-A5，L92-102](../inputs/repository_facts.md)：K线历史缺逐行venue；衍生品槽名可与来源不同，生产容量未知。 |
| R08 | 足迹与清算实现 | [事实报告§4 B1-B2，L104-118](../inputs/repository_facts.md)：足迹aggTrade；方向映射已有测试；priceType未保留。 |
| R09 | 期权和规格边界 | [事实报告§4 B3-B4，L120-131](../inputs/repository_facts.md)：未确认活跃Deribit链路、统一有效期instrument；已有采集器。 |
| R10 | 宏观与事件边界 | [事实报告§5，L133-148](../inputs/repository_facts.md)：未确认FRED/ALFRED/ETF流、事件研究等生产链路。 |
| R11 | 云端适配与报告上下文 | [事实报告§6，L150-181](../inputs/repository_facts.md)：Gemini适配可复用，结果上下文非完整冻结；报告流状态与七天清理。 |
| R12 | 界面现场与预警 | [事实报告§7，L183-201](../inputs/repository_facts.md)：局部视口/reportId存在；绝对历史现场、持久预警/笔记未证实。 |
| R13 | 全球日报和FNG | [事实报告§8.1，L203-215](../inputs/repository_facts.md)：跨资产/AI/GitHub，FNG缺失回退50，3—6次搜索只是prompt要求。 |
| R14 | 二次分析和固定规则 | [事实报告§8.2-8.3，L217-240](../inputs/repository_facts.md)：62/58/46与72/54等固定分支；日历时间可来自文章时间；部分文案超出数据范围。 |
| R15 | 规划与角色 | [事实报告§9，L248-283](../inputs/repository_facts.md)：26路由的local/connected/demo/planned，不把规划当需求或实现。 |
| R16 | 治理边界与差异 | [事实报告§10，L285-310](../inputs/repository_facts.md)：请求取消、云端专用、目录移动、发布清单等已治理，需避免重叠。 |
| R17 | 未知使用条件 | [事实报告§11，L312-324](../inputs/repository_facts.md)：周期、预算、历史长度、共享、运维资源未给定。 |
| R18 | 历史测试与文件清单 | [事实报告§12-13，L326-352](../inputs/repository_facts.md)：161/96/15是历史PASS标记，未重测生产/模型/浏览器。 |

## 5. 外部来源索引与访问状态

以下索引区分成功读取材料和访问失败。社区只用于发现争议/使用问题；关键能力、协议、许可和条款回到原始资料。没有把无法访问的X帖子、私密论坛、登录后服务或付费终端算成已读。代码许可证与数据/服务条款分别处理；没有明确数据授权就标未知。

版本/主分支会变化，正式选依赖时应锁版本并保留相应许可与兼容测试。Stars、README宣传、自报性能和最近一次提交日期都不能单独证明成熟度。既有平台也不能因不频繁发版就被认定停止维护。

| 来源ID | 原始入口 | 本轮使用范围 | 访问/验证层次 |
|---|---|---|---|
| S001 | [Alternative.me FNG 方法、API和署名](https://alternative.me/crypto/fear-and-greed-index/) | 指数包含波动与成交量等成分；第三方指数不是独立市场概率。 | 已读取公开材料；未运行验证 |
| S002 | [Binance 现货 WebSocket 协议](https://raw.githubusercontent.com/binance/binance-spot-api-docs/master/web-socket-streams.md) | maker方向、逐笔与聚合、盘口恢复、时间单位。 | 已读取公开材料；未运行验证 |
| S003 | [Binance public-data README](https://raw.githubusercontent.com/binance/binance-public-data/master/README.md) | MIT声明、归档时间单位、校验和及历史文件可能替换。 | 已读取公开材料；未运行验证 |
| S004 | [Binance USDⓈ-M 市场流](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market) | 聚合成交、RPI口径、可见清算采样与字段。 | 已读取公开材料；未运行验证 |
| S005 | [Binance USDⓈ-M REST 市场数据](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) | OI历史范围/期末时间等；不同方法分别核对。 | 已读取公开材料；未运行验证 |
| S006 | [Bybit allLiquidation 文档源码](https://raw.githubusercontent.com/bybit-exchange/docs/master/docs/v5/websocket/public/all-liquidation.mdx) | S为持仓方向，p为破产价，v为执行规模；不是普通主动成交。 | 已读取公开材料；未运行验证 |
| S007 | [Deribit get_order_book](https://docs.deribit.com/api-reference/market-data/public-get_order_book) | OI单位、IV和Greeks等字段；并非历史完整性保证。 | 已读取公开材料；未运行验证 |
| S008 | [Deribit summary by currency](https://docs.deribit.com/api-reference/market-data/public-get_book_summary_by_currency) | 币种范围合约截面入口。 | 已读取公开材料；未运行验证 |
| S009 | [Deribit 采集最佳实践](https://docs.deribit.com/articles/market-data-collection-best-practices) | raw认证与聚合/连接方面的边界。 | 已读取公开材料；未运行验证 |
| S010 | [Deribit 限流](https://docs.deribit.com/articles/rate-limits) | 不同端点调用成本不能用单一频率概括。 | 已读取公开材料；未运行验证 |
| S011 | [Deribit volatility index](https://docs.deribit.com/api-reference/market-data/public-get_volatility_index_data) | 波动率指数历史端点；本次未请求数据或测覆盖。 | 已读取公开材料；未运行验证 |
| S012 | [CoinGecko market chart](https://docs.coingecko.com/reference/coins-id-market-chart) | 价格、市值、总成交量与历史粒度接口；不同计划边界需按使用版本复核。 | 已读取公开材料；未运行验证 |
| S013 | [DeFiLlama 方法与仓库地图](https://docs.llama.fi/) | 稳定币对应circulating supply/peg；不要把TVL规则误套所有指标。 | 已读取公开材料；未运行验证 |
| S014 | [DeFiLlama stablecoin页面](https://defillama.com/stablecoins) | 产品口径参考；未独立确认本系统用途授权和SLA。 | 已读取公开材料；未运行验证 |
| S015 | [FRED/ALFRED real-time periods](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html) | 日期级历史版本与当前值的区别。 | 已读取公开材料；未运行验证 |
| S016 | [FRED API条款](https://fred.stlouisfed.org/docs/api/terms_of_use.html) | 第三方序列权利独立核验。 | 已读取公开材料；未运行验证 |
| S017 | [Federal Reserve FOMC日历](https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm) | 官方会议及发布材料入口，不使用新闻发布时间冒充未来日程。 | 已读取公开材料；未运行验证 |
| S018 | [BLS CPI发布时间表](https://www.bls.gov/schedule/news_release/cpi.htm) | 官方日程与时区来源。 | 已读取公开材料；未运行验证 |
| S019 | [IBIT发行人披露](https://www.ishares.com/us/products/333011/ishares-bitcoin-trust-etf) | 带日期的份额/资产等字段；不等于全ETF净申购数据库。 | 已读取公开材料；未运行验证 |
| S020 | [Farside BTC ETF汇总](https://farside.co.uk/btc/) | 交叉核验来源；未取得本产品分发授权/完整历史SLA。 | 已读取公开材料；未运行验证 |
| S021 | [Glassnode PiT](https://docs.glassnode.com/data/point-in-time-metrics) | 实体指标历史可能变化，时点数据有覆盖限制。 | 已读取公开材料；未运行验证 |
| S022 | [Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output) | 支持JSON Schema子集，语法合规不证明事实正确。 | 已读取公开材料；未运行验证 |
| S023 | [Gemini Google Search Grounding](https://ai.google.dev/gemini-api/docs/google-search) | 自动搜索、注释与模型版本差异；搜索数量不能靠prompt保证。 | 已读取公开材料；未运行验证 |
| S024 | [Gemini API附加条款](https://ai.google.dev/gemini-api/terms) | 已读2026-03-23生效文本；普通生成与Grounding及付费/免费用途有区别，具体适用需确认。 | 已读取公开材料；未运行验证 |
| S025 | [Gemini定价](https://ai.google.dev/gemini-api/docs/pricing) | 模型、thinking、缓存及搜索计费维度不同；不提供本系统实际账单。 | 已读取公开材料；未运行验证 |
| S026 | [Anthropic多代理研究工程](https://www.anthropic.com/engineering/multi-agent-research-system) | 独立子问题并行研究与协调开销；不是本系统收益证据。 | 已读取公开材料；未运行验证 |
| S027 | [ALCE引用评估论文](https://aclanthology.org/2023.emnlp-main.398/) | 引用支持与覆盖方法，不直接采用其数据集作为金融基准。 | 已读取公开材料；未运行验证 |
| S028 | [scikit-learn校准文档](https://scikit-learn.org/stable/modules/calibration.html) | 可靠性图和适当评分；Brier同时受多项因素影响。 | 已读取公开材料；未运行验证 |
| S029 | [Metaculus题目编写](https://www.metaculus.com/question-writing/) | 明确问题、时间与可客观结算标准的方法。 | 已读取公开材料；未运行验证 |
| S030 | [Metaculus评分FAQ](https://www.metaculus.com/help/scores-faq/) | 评分规则与预测概率的可评估性，借鉴不复制平台复杂积分。 | 已读取公开材料；未运行验证 |
| S031 | [LLMTime论文](https://arxiv.org/abs/2310.07820) | 时间序列预测研究线索，论文效果不等于BTC上线效果。 | 已读取公开材料；未运行验证 |
| S032 | [LLM时间序列消融论文](https://arxiv.org/abs/2406.16964) | 针对若干方法的消融反证；不能外推所有LLM无效。 | 已读取公开材料；未运行验证 |
| S033 | [datasketch仓库](https://github.com/ekzhu/datasketch) | 近似集合相似性；主分支2.0算法变更需索引重建/兼容。 | 已读取公开材料；未运行验证 |
| S034 | [datasketch MinHashLSH文档](https://ekzhu.com/datasketch/lsh.html) | 候选检索会有误报漏报，不等于事件语义去重。 | 已读取公开材料；未运行验证 |
| S035 | [datasketch LICENSE](https://raw.githubusercontent.com/ekzhu/datasketch/master/LICENSE) | MIT。 | 已读取公开材料；未运行验证 |
| S036 | [Trafilatura仓库](https://github.com/adbar/trafilatura) | 正文与元数据提取，不提供媒体内容权利。 | 已读取公开材料；未运行验证 |
| S037 | [Trafilatura LICENSE](https://raw.githubusercontent.com/adbar/trafilatura/master/LICENSE) | Apache-2.0。 | 已读取公开材料；未运行验证 |
| S038 | [RSSHub仓库](https://github.com/DIYgod/RSSHub) | 多源RSS路由；逐路由可达性和条款独立。 | 已读取公开材料；未运行验证 |
| S039 | [RSSHub当前LICENSE](https://raw.githubusercontent.com/DIYgod/RSSHub/master/LICENSE) | 当前主分支AGPL-3.0；不沿用旧MIT印象。 | 已读取公开材料；未运行验证 |
| S040 | [TrendRadar仓库](https://github.com/sansan0/TrendRadar) | 中文聚合/筛选/推送设计，热点不是BTC相关性标签。 | 已读取公开材料；未运行验证 |
| S041 | [TrendRadar当前LICENSE](https://raw.githubusercontent.com/sansan0/TrendRadar/master/LICENSE) | GPL-3.0；不是AGPL或MIT。 | 已读取公开材料；未运行验证 |
| S042 | [GDELT DOC API官方说明](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) | 新闻检索与时间线方法；旧说明不保证当前运行覆盖。 | 已读取公开材料；未运行验证 |
| S043 | [TradingAgents仓库](https://github.com/TauricResearch/TradingAgents) | 多角色、决策日志、恢复；自身披露时点/来源/模型非确定性限制。 | 已读取公开材料；未运行验证 |
| S044 | [TradingAgents LICENSE](https://raw.githubusercontent.com/TauricResearch/TradingAgents/main/LICENSE) | 当前Apache-2.0。 | 已读取公开材料；未运行验证 |
| S045 | [FinGPT仓库](https://github.com/AI4Finance-Foundation/FinGPT) | 金融模型/数据研究项目；模型权重与数据授权不随代码自动开放。 | 已读取公开材料；未运行验证 |
| S046 | [FinGPT LICENSE](https://raw.githubusercontent.com/AI4Finance-Foundation/FinGPT/master/LICENSE) | MIT。 | 已读取公开材料；未运行验证 |
| S047 | [exchange_calendars仓库](https://github.com/gerrymanoim/exchange_calendars) | 证券交易日历；不是宏观新闻日历。 | 已读取公开材料；未运行验证 |
| S048 | [exchange_calendars LICENSE](https://raw.githubusercontent.com/gerrymanoim/exchange_calendars/master/LICENSE) | Apache-2.0。 | 已读取公开材料；未运行验证 |
| S049 | [River仓库](https://github.com/online-ml/river) | 在线学习/漂移检测，需已有可评价数据流。 | 已读取公开材料；未运行验证 |
| S050 | [River LICENSE](https://raw.githubusercontent.com/online-ml/river/main/LICENSE) | BSD-3-Clause。 | 已读取公开材料；未运行验证 |
| S051 | [arch时间序列bootstrap](https://bashtage.github.io/arch/bootstrap/timeseries-bootstraps.html) | 区块重采样；文档对moving-block端点欠采样有警告。 | 已读取公开材料；未运行验证 |
| S052 | [arch LICENSE](https://raw.githubusercontent.com/bashtage/arch/main/LICENSE.md) | NCSA式许可，按原文而非随意标MIT。 | 已读取公开材料；未运行验证 |
| S053 | [promptfoo断言](https://www.promptfoo.dev/docs/configuration/expected-outputs/) | 确定性/模型断言；默认综合评分不替代关键错误硬拒绝。 | 已读取公开材料；未运行验证 |
| S054 | [promptfoo JS断言](https://www.promptfoo.dev/docs/configuration/expected-outputs/javascript/) | 可运行本地自定义验证；只使用可信测试配置。 | 已读取公开材料；未运行验证 |
| S055 | [promptfoo LICENSE](https://raw.githubusercontent.com/promptfoo/promptfoo/main/LICENSE) | MIT。 | 已读取公开材料；未运行验证 |
| S056 | [Lightweight Charts v4到v5迁移](https://tradingview.github.io/lightweight-charts/docs/migrations/from-v4-to-v5) | API有变化，不将当前4.1.3自动替换成5系列。 | 已读取公开材料；未运行验证 |
| S057 | [Lightweight Charts LICENSE](https://raw.githubusercontent.com/tradingview/lightweight-charts/master/LICENSE) | Apache-2.0；NOTICE与署名另按锁定版本检查。 | 已读取公开材料；未运行验证 |
| S058 | [SQLite FTS5](https://www.sqlite.org/fts5.html) | 全文检索方法；不等于D1允许任意扩展或适合中文语义检索。 | 已读取公开材料；未运行验证 |
| S059 | [DuckDB LICENSE](https://raw.githubusercontent.com/duckdb/duckdb/main/LICENSE) | MIT。 | 已读取公开材料；未运行验证 |
| S060 | [DuckDB并发](https://duckdb.org/docs/current/connect/concurrency.html) | 区分嵌入式文件和其他并发架构；本方案采用受控批处理。 | 已读取公开材料；未运行验证 |
| S061 | [vollib LICENSE](https://raw.githubusercontent.com/vollib/py_vollib/master/LICENSE) | MIT；具体运行兼容仍需选择版本。 | 已读取公开材料；未运行验证 |
| S062 | [D1限制](https://developers.cloudflare.com/d1/platform/limits/) | 容量/SQL运行边界；不直接证明必须迁库。 | 已读取公开材料；未运行验证 |
| S063 | [D1读副本](https://developers.cloudflare.com/d1/best-practices/read-replication/) | Sessions/bookmark不是业务历史快照。 | 已读取公开材料；未运行验证 |
| S064 | [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/) | batch事务范围限同数据库；不是跨Worker/R2事务。 | 已读取公开材料；未运行验证 |
| S065 | [Workers限制](https://developers.cloudflare.com/workers/platform/limits/) | CPU、触发/生命周期与配置区别。 | 已读取公开材料；未运行验证 |
| S066 | [DO WebSocket实践](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) | 出站WS不能使用入站休眠机制。 | 已读取公开材料；未运行验证 |
| S067 | [Workflows限制](https://developers.cloudflare.com/workflows/reference/limits/) | 持久步骤也有资源与保留边界。 | 已读取公开材料；未运行验证 |
| S068 | [Queues交付](https://developers.cloudflare.com/queues/reference/delivery-guarantees/) | 至少一次，幂等仍由应用负责。 | 已读取公开材料；未运行验证 |
| S069 | [R2定价](https://developers.cloudflare.com/r2/pricing/) | 存储和操作单价，不含研究全成本。 | 已读取公开材料；未运行验证 |
| S070 | [R2一致性](https://developers.cloudflare.com/r2/reference/consistency/) | 强一致对象语义仍不产生跨D1事务；缓存另论。 | 已读取公开材料；未运行验证 |
| S071 | [CoinGlass清算热力图](https://docs.coinglass.com/reference/liquidation-aggregate-heatmap) | 市场数据与杠杆假设模型；不是真实全量清算持仓。 | 已读取公开材料；未运行验证 |
| S072 | [Reddit历史盘口讨论](https://www.reddit.com/r/algotrading/comments/nz5lnl/binance_full_or_atleast_sufficiently_deep/) | 只作发现问题的社区线索，不作当前协议依据。 | 已读取公开材料；未运行验证 |
| S073 | [HN工作流讨论](https://news.ycombinator.com/item?id=41039204) | 只作复杂度/维护话题线索，不作架构性能证据。 | 已读取公开材料；未运行验证 |
| S074 | [X帖子访问失败](https://x.com/coinglass_com/status/1833073677015126058) | 搜索命中，正文403，未用于证明帖文事实。 | 访问失败；未用正文作结论 |
| S075 | [RSSHub中文部署文档访问失败](https://docs.rsshub.app/zh/deploy/) | 正文403；没有声称完整核验该页运行要求。 | 访问失败；未用正文作结论 |
| S076 | [Deribit instrument规格](https://docs.deribit.com/api-reference/market-data/public-get_instruments) | 规格、到期、contract_size与min_trade_amount不同；示例不是当前真实规格。 | 已读取公开材料；未运行验证 |
| S077 | [Coin Metrics Community](https://docs.coinmetrics.io/packages/coin-metrics-community-data) | CC BY-NC 4.0社区数据；商业范围另核验。 | 已读取公开材料；未运行验证 |
| S078 | [Circle披露](https://www.circle.com/transparency) | 发行人供应/储备披露；不是本方案独立审计。 | 已读取公开材料；未运行验证 |
| S079 | [Tether披露](https://tether.to/en/transparency/) | 发行人流通/储备页面；保存与分发权另核验。 | 已读取公开材料；未运行验证 |

## 6. 时间和出处的局限

查询日期不是内容发布日期。旧GDELT介绍、历史社区帖和论文描述的方法仍可提供设计线索，但不能证明当前端点SLA或现在的免费套餐。相反，当前发布页不能单独证明去年某日是什么版本；本包不伪造当时网页快照。

没有下载/执行候选软件测试；源码路径、许可证和方法文档支持的结论都保留到相应范围。供应商声称的历史覆盖和完整事件仍需在拟购市场、频道、日期上抽样验收。文档声称支持JSON结构不等于模型总能正确引用数据。

金融统计方法只支撑如何构建研究与检验，不支撑本系统已经获得某收益率、预测准确率或噪音下降比例。作者论文的结论范围、对照数据和适用任务不能未经复现直接外推BTC当前行情。

## 7. 尚未解决的实施问题

生产D1容量、行扫描、写入/查询分位、对象请求和账单未知；现有auth、真实Cron/域名/Worker部署和旧清理状态未知；实际Gemini模型/付费合同/工具选项和全部输入记录未取得；来源完整率、时间偏差和历史覆盖未运行检验。

用户的主要时间尺度、历史保留长度、预算、公开分发计划、独立服务维护资源和外发提醒偏好未给定。方案已为不受这些未知影响的能力提供最小实现，涉及费用/权限的项目保留显式关口，不自行补成已批准。

本文没有完整审计全部候选的依赖树、漏洞、贡献者集中度、CI覆盖和维护者响应速度。重点选择优先局部复用和可替换边界，不能因此宣称“所有推荐均已生产验证”。

## 8. 文档维护规则

实施后新增事实以真实代码/测试/部署证据更新，保留设计与实际不同之处。不要把设计默认值复制到事实总纲后当作已运行配置；不要把planned改connected却没有运行证据；不要用新报告覆盖旧报告使过去看起来更正确。

若一个外部来源变更条款或协议，登记影响的CAP/M/WP以及需要重放的测试，不必重写整套研究。若数据/方法被证明没有价值，修改ADR并明确退出，不把既有投入当继续扩张的理由。

所有后续下载、安装、真实模型/数据调用、数据库变更和发布需按该阶段授权执行。本包只交付实施依据与测试材料，不提供后台运行承诺，也不让开发代理自动执行全部可选项目。
