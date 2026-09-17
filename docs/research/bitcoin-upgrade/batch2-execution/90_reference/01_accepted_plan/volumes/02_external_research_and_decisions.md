> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# 卷 02｜补充研究、候选比较与架构决策记录

研究日期：2026-09-16。本文引用的外部能力均来自公开材料；没有安装候选、运行官方示例、连接账号或复现实测结果。维护描述只报告看到的证据，未查看完整贡献分布、工单响应、漏洞和服务SLA的项目不称“维护无风险”。

## 1. 本轮如何改变检索问题

前两轮偏重“还能接哪些组件”，本轮从真实仓库的四个矛盾反向检索：固定分数如何变成可解释描述与可校准预测；全球新闻如何变成有来源独立性的事件；多个上下文摘要如何组成同一研究问题的输入；短期报告如何形成观点—条件—结果闭环。由此扩展到新闻提取、近似去重、预测问题设计、时间序列验证、多代理消融、使用权和报告评价，而不只搜索 Cloudflare/JavaScript 插件。

搜索路径包括中英文 GitHub 项目、官方交易所协议、专业产品的方法文档、公开论文和研究实现。社区用于发现问题：Reddit 盘口讨论提示“订阅深度”和“完整可回放”容易混淆；HN 工作流讨论提示平台生命周期会变化，但不以旧帖子判断今天的维护状态。X 索引命中后正文403，不能把摘要当全文；RSSHub 中文部署页也返回403，改以可读仓库和许可文件核对有限信息。[S072｜Reddit历史盘口讨论](https://www.reddit.com/r/algotrading/comments/nz5lnl/binance_full_or_atleast_sufficiently_deep/) [S073｜HN工作流讨论](https://news.ycombinator.com/item?id=41039204) [S074｜X帖子访问失败](https://x.com/coinglass_com/status/1833073677015126058) [S075｜RSSHub中文部署文档访问失败](https://docs.rsshub.app/zh/deploy/)

没有按 Star 排名，没有把供应商的 benchmark 或模型回测收益当本系统效果。历史服务价格、模型最新别名、限流与再分发范围在没有直接明确证据时保留未知。候选池的数量不是任务进度指标。

## 2. 方案地图：代码、服务、方法、交互分别评价

| 层次 | 本仓库已有基础 | 外部可复用成果 | 最终取舍 |
|---|---|---|---|
| 行情采集 | Binance/Bybit、WS、恢复、D1桶 | 原生协议、标准化思路、商业历史 | 优先修契约；已有采集器继续用，不新建平行全集 |
| 信息接入 | 事实池、搜索、全球日报 | 官方RSS/API、RSSHub、Trafilatura、GDELT | 原始授权源优先；其他按缺口引入，不把全网抓取当目标 |
| 去重与相关性 | 模块有摘要和事实条目 | URL规范化、MinHash、事件/主张版本、人工复核 | 先确定性候选，再小范围模型语义判断 |
| 数值分析 | 图表/Worker/快照各有计算 | DuckDB、arch、vollib、交易日历 | 共享方法注册；批量环境按需，不让界面引入Python依赖 |
| 状态识别 | 固定分数、技术描述 | 滚动稳健统计、ruptures/River研究方法 | 可解释描述先行；状态检测结果不直接当涨跌预测 |
| 研究自动化 | Gemini REST/stream、模块流程 | 结构化输出、有界工具、分工研究/反证审查 | 保留适配；程序＋单主分析＋条件审查，而非五员工必跑 |
| 评价与复盘 | 函数/契约回归、历史reportId | promptfoo、ALCE、校准、Metaculus题目规范 | 固定事实集与前瞻记录；数值硬检查，不只LLM评分 |
| 交互 | LWC4.1.3、多页面、局部视口 | Linked workspace、差异简报、证据抽屉、研究日志 | 重新设计信息入口；图表底座先保留，重构不等于換框架 |

本表中的产品设计是 D，不是任何候选承诺提供的完整功能。每个外部项目应只承担自己能够证明的职责。

## 3. 重点候选卡

### K01｜原生交易所协议与既有适配器：当前优先复用

**类型与任务。** 协议/接口与本仓库已有代码，不是采购一个新平台。用途是验证 aggTrade、强平、OI、资金费和历史回补的语义。当前仓库已有真实采集、方向映射和恢复，不适合重新从一个通用采集框架开始。[R08｜仓库事实报告§4 B1-B2，L104-118](../inputs/repository_facts.md) [R09｜仓库事实报告§4 B3-B4，L120-131](../inputs/repository_facts.md)

**直接证据。** Binance 现货与合约聚合规则、RPI范围、强平采样和 Bybit 价格字段在官方文档可定位。Binance 归档 README 声明 MIT，并说明历史文件可能更换。该声明不等于所有在线交易所数据的商业使用均获授权。[S002｜Binance 现货 WebSocket 协议](https://raw.githubusercontent.com/binance/binance-spot-api-docs/master/web-socket-streams.md) [S003｜Binance public-data README](https://raw.githubusercontent.com/binance/binance-public-data/master/README.md) [S004｜Binance USDⓈ-M 市场流](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market) [S005｜Binance USDⓈ-M REST 市场数据](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) [S006｜Bybit allLiquidation 文档源码](https://raw.githubusercontent.com/bybit-exchange/docs/master/docs/v5/websocket/public/all-liquidation.mdx)

**复用方式。** 保留 `cloudflare/binance-klines-worker.js` 的已验证路径，通过一层显式语义适配输出新的来源对象；足迹引擎继续复用。运行环境沿用当前 Worker/浏览器；是否迁出长期采集单独测量。代码维护由项目自己负责，上游协议变化需要样本契约回归。

**竞争替代。** CCXT 的一般接口统一仍值得备选，但本轮没有证明它会减少当前只有少数来源的维护，故不新增依赖；已有协议路径即为比较基线。若市场数明显增加、重复代码成为真实负担，再重核锁定版本许可和运行环境，并与一个原生接口输出对照。不能因为 CCXT 有某方法就认定各交易所该方法的历史范围相同。

**结论与停止条件。** 推荐采用协议核验和局部语义升级。若既有适配已满足新契约，只增加测试；禁止为完成“统一架构”强行改变所有稳定端点。

### K02｜datasketch / MinHashLSH：只找相似候选，不决定事件合并

**问题。** 同一通讯稿被多个网站转载，事实池条目数增多却没有增加独立证据。直接让模型阅读全部全文会增加成本，也可能误以为“多家证实”。

**直接能力。** datasketch 提供 MinHash 等概率数据结构，MinHashLSH用于近似Jaccard集合相似候选。官方文档说明近似检索存在误报和漏报。因此它适合缩小候选集合，不适合自动确定“这两条新闻是同一个事件”。主分支说明2.0散列方案变化，已持久化索引需要重建或显式兼容。[S033｜datasketch仓库](https://github.com/ekzhu/datasketch) [S034｜datasketch MinHashLSH文档](https://ekzhu.com/datasketch/lsh.html)

**许可、运行与维护。** MIT；Python及其数值依赖，库不提供新闻数据。仓库/测试目录和显式兼容说明可见，未逐项量化最近实质发布、issue响应或大型语料性能。不得把 README 的性能值当本系统测量。[S035｜datasketch LICENSE](https://raw.githubusercontent.com/ekzhu/datasketch/master/LICENSE)

**本系统接法。** 第一版使用 JS 中的URL/哈希/短文本shingle候选，规模有限时无需Python服务。若离线新闻库增大且全比较成本实测突出，可在已有研究批处理中使用 datasketch；输出候选对与相似特征，不直接修改 event_id。

**替代与取舍。** 精确哈希＋数据库按实体/时间的候选检索更简单；embedding跨语言相似性更广，但调用与隐私成本、过度合并风险更高。候选召回与错误合并率必须分别评估；“批准”和“拒绝”措辞相近时绝不能因高文本相似就覆盖为同一事实版本。

**判断。** 值得试验，非在线基线依赖。索引引入没有降低成本或提升候选召回就停用；输出仍由卷03的事件状态规则处理。

### K03｜Trafilatura：正文提取可复用，访问权不能由库提供

**能力证据。** 官方仓库提供网页主要正文与元数据提取等能力，适合减少导航、广告和模板文本进入事实池；许可原文为 Apache-2.0。它提取的是页面表达，不能保证发布日期准确、文章无误或来源独立。[S036｜Trafilatura仓库](https://github.com/adbar/trafilatura) [S037｜Trafilatura LICENSE](https://raw.githubusercontent.com/adbar/trafilatura/master/LICENSE)

**运行和数据边界。** Python组件，可按任务运行；网页内容版权、robots、API/服务条款及实际获取权另审。失败页面应返回抽取失败/元数据不可信，不能把空正文送模型后让模型凭标题补全文。若网页需要账号或拒绝自动访问，本方案不提供规避路径。

**维护证据。** 可读仓库、文档和现行许可；本轮没有执行提取质量对照或确认其所有站点适配。具体Python最低版本应在锁定发行核查，本方案不伪造通用兼容声明。

**替代。** 官方RSS/JSON API可用时先用结构化源，省去网页提取；现有JS提取足够时不加Python。只有合法来源HTML噪声确实影响主张抽取，才用相同页面样本比较提取准确率、丢表格/否定句率和维护成本。

**判断。** 条件采用独立批处理组件；不把它变成通用全网爬虫。表格数值/图表无法可靠读取时保留原链接及未知，不自动推断。

### K04｜RSSHub：按一个缺失路由评估，不部署“所有来源”

**能力与证据。** 官方仓库是多源RSS生成工具，适合没有原生RSS但存在合规可读内容的个别来源。当前主分支许可文件是 AGPL-3.0，不能沿用旧的MIT记忆；对应路由和锁定版本许可还需查看。中文部署页面本次403，未把页面未知的具体部署参数写入要求。[S038｜RSSHub仓库](https://github.com/DIYgod/RSSHub) [S039｜RSSHub当前LICENSE](https://raw.githubusercontent.com/DIYgod/RSSHub/master/LICENSE) [S075｜RSSHub中文部署文档访问失败](https://docs.rsshub.app/zh/deploy/)

**与当前系统关系。** 用户已有事实池和搜索，不缺另一个全球新闻首页。复用应限于新增源适配/API输入；自托管Node服务、缓存和路由维护是新增成本。第三方公共实例可用不等于可靠或允许所有用途；来源站点政策也不会因RSS包装改变。

**替代。** 原始发布机构RSS/Atom/ICS或受权API优先。若只是一个静态官方日历，编写小型版本化解析比维护完整RSSHub更直接。

**判断。** 特定来源确无更简单入口且条款允许时试验。不默认部署，不复制整个前端，不承诺免费实例SLA。维护状态只认定仓库可读、存在现行说明；没有完成全部路由运行健康调查。

### K05｜TrendRadar：借鉴降噪产品，而不是把热点榜搬入BTC

**类型与能力。** 中文新闻聚合/筛选/推送项目；仓库展示RSS、关键词/分析及提醒组织方式，可作来源配置、通知和阅读流的设计参考。许可原文是 GPL-3.0，不能错误标成MIT或AGPL。[S040｜TrendRadar仓库](https://github.com/sansan0/TrendRadar) [S041｜TrendRadar当前LICENSE](https://raw.githubusercontent.com/sansan0/TrendRadar/master/LICENSE)

**适配分析。** 本系统本来已有全球日报，完整搬入TrendRadar容易多出第二事实池、第二配置和第二提醒机制。热榜排名并不能回答信息是否与BTC相关、是否新事实、是否独立来源、是否足以改变研究观点。

**复用边界。** 先借鉴“按主题与变化选择输出”的交互及配置组织；拟复制特定代码时必须定位真实文件、兼容Python/任务环境并履行GPL义务。本轮没有查看每个运行函数，也没有试运行，不给出稳定性或可移植工期结论。

**替代。** 在现有yuqing入口引入本方案的事件/主张契约与抑制原因，通常比再接一个完整平台更少重复。若事实池被证明无法保留来源、版本和去重关系，再比较整体替换的迁移成本。

**判断。** 仅借鉴思想，完整平台暂不采用。它是值得研究的小型专项产品，但不能因中文和开箱截图就默认适合金融分析。

### K06｜GDELT DOC API与商业新闻接口：发现覆盖，而非新闻真相来源

GDELT官方说明提供多语新闻检索和时间线思路，可以帮助发现漏掉的事件或来源；该介绍较早，不能据此保证当前实时延迟、全部历史查询和生产SLA。本方案只将它列为覆盖审计与候选发现源，原始主张回到发布方或明确许可新闻源。[S042｜GDELT DOC API官方说明](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/)

竞争方案是商业新闻API，其结构化字段、历史和去重可能减少维护，但具体报价、许可、保存期限、来源范围及外部推理权必须按合同确认。本次搜索命中若只落到营销首页，不采用“召回率”“更新延迟”等广告数字。

最小试验：围绕一个预定义BTC事件集合，记录GDELT/现有搜索/官方订阅各自找到的唯一事件及延迟；把转载簇折算为一个根源，不按文章总量算覆盖。若多出来的主要是重复、传闻或无关稿件，停止扩源。API接通不计为通过。

### K07｜TradingAgents：可借鉴记录和恢复，不复制交易公司组织图

**直接证据。** 当前仓库展示多角色金融分析、结构化决策、持久决策日志和checkpoint恢复；README的近期变更提及时点/未来信息修正，也明确模型、数据时间与调用会造成结果差异。当前 LICENSE 为 Apache-2.0。该文档自身的限制是重要反证，不能只摘“多代理提高效果”。[S043｜TradingAgents仓库](https://github.com/TauricResearch/TradingAgents) [S044｜TradingAgents LICENSE](https://raw.githubusercontent.com/TauricResearch/TradingAgents/main/LICENSE)

**运行环境与代价。** Python/LangGraph、多模型/市场数据供应商配置，带额外运行和升级依赖；具体服务费用与数据权限分开。仓库有测试目录和变更说明，本轮未执行测试，也没有确认每个所谓修正覆盖全部路径。

**与本系统的取舍。** 本仓库已有五员工原型，但没有真实执行闭环。复制一个“分析师—辩论—交易员—组合经理”流程会默认引入交易执行和账户风险概念，并增加同一证据重复总结。保留的是“观点记录、恢复边界、被结果反驳时登记”的设计；不采用默认交易动作、收益承诺或角色人数作为质量指标。

**竞争替代。** 本方案：程序生成市场事实，单主分析解释；仅在高价值未决问题或冲突存在时启动独立反证检查。两者在相同证据、费用上限和截止点下比较，而不是一边给更多搜索/更多tokens再宣称多代理更聪明。

**判断。** 仅借鉴设计；完整平台不采用。若未来能证明某类问题确实可独立分解且带来净增量，可增加该类子任务，不必迁入整个交易框架。

### K08｜FinGPT：研究代码不等于现成的BTC分析器

官方仓库聚焦金融语言模型、数据与训练研究，当前代码许可为MIT。模型权重、训练语料、第三方来源和特定模型底座的条款不随仓库代码自动开放。[S045｜FinGPT仓库](https://github.com/AI4Finance-Foundation/FinGPT) [S046｜FinGPT LICENSE](https://raw.githubusercontent.com/AI4Finance-Foundation/FinGPT/master/LICENSE)

对本系统最有价值的是研究“金融分类/抽取是否能用较小模型降低重复劳动”，而不是本轮启动GPU训练。当前没有已标注的BTC相关性/主张支持/预测结果数据集，没有证据说明领域微调能比清楚的输入与程序校验更有效。

复用方式：先将公开方法作为离线分类基线的候选；只有积累足够合法标注样本后，再比较小模型与现有Gemini在同一测试集上的精度/召回、推理成本和维护。具体权重许可证及推理硬件要求未逐一核验，因此不列为默认依赖。

维护判断：仓库与许可可读，包含研究资产；没有完整核对各子项目的最近发布和模型复现。本轮不以研究论文成绩或大仓库名声说明它适合当前系统。

### K09｜保留Gemini适配，升级任务协议与用途隔离

结构化输出官方支持JSON Schema的子集，能够约束格式而非事实真实性；Grounding文档说明模型可能执行多个查询，提示词的“搜索3—6次”不是可靠的执行/费用约束。价格应按真实model ID、服务层级、thinking和搜索计费维度读取。[S022｜Gemini structured output](https://ai.google.dev/gemini-api/docs/structured-output) [S023｜Gemini Google Search Grounding](https://ai.google.dev/gemini-api/docs/google-search) [S025｜Gemini定价](https://ai.google.dev/gemini-api/docs/pricing)

事实报告证明现有REST/stream适配、超时和错误状态存在，因此先保留。新增的是输入封存、任务分层、工具白名单、结果校验、预算账本与能力回退；不是换SDK名称。运行在已确认支持的Worker路径中，具体模型和API版本必须以仓库设置核对。

用途风险单列为 ADR-008：Gemini普通生成与Google Search Grounded Results有不同限制；后者的展示、留存及二次使用存在用途限定，不能自动进入长期事实数据库、跨任务分析或训练集。条款有有限例外，不能简单说“所有结果禁止保存”或“最多两年所以可自由研究”。本方案仅提供隔离设计，是否适用具体合同需后续确认。[S024｜Gemini API附加条款](https://ai.google.dev/gemini-api/terms)

替代是现有适配加程序契约，或者仅在适配重复严重时采用AI SDK；不能从SDK支持工具直接推导出它能解决本仓库的事实正确性。默认模型不固定品牌/最新别名，保留provider接口；新增provider必须重新验证schema、流式、计费和工具语义。

### K10｜promptfoo与ALCE：把报告检验拆为可验证的项

promptfoo有确定性、自定义JS/Python和模型评分断言，MIT。默认合并分数并不自动满足“一个关键数值错误就拒绝”的产品要求，因此必须为关键错误设硬门，不用平均分掩盖。ALCE提供引用支持和覆盖的评估思路，不直接把通用问答数据集当金融验收集。[S053｜promptfoo断言](https://www.promptfoo.dev/docs/configuration/expected-outputs/) [S054｜promptfoo JS断言](https://www.promptfoo.dev/docs/configuration/expected-outputs/javascript/) [S055｜promptfoo LICENSE](https://raw.githubusercontent.com/promptfoo/promptfoo/main/LICENSE) [S027｜ALCE引用评估论文](https://aclanthology.org/2023.emnlp-main.398/)

接法是可选的本地/CI评估工具，依赖Node环境与所选模型接口；不需要新常驻服务。模型调用和裁判费用额外，配置可能执行代码，只运行本项目审查过的断言。遥测、网络出口、测试样本保存和日志脱敏在采用前检查。

本仓库现有Node回归可以先承担数值和契约检查；promptfoo仅在多prompt/provider对照管理变成重复劳动时引入。维护证据是可读当前文档、功能与许可；没有本轮性能/全部测试通过结论。

替代为现有测试框架＋固定JSON样本＋人工盲评。真正增量来自明确的事实与价值验收，不来自工具报告里出现一个“pass rate”。

### K11｜DuckDB／Parquet：服务离线研究，而非默认接管在线页面

DuckDB为MIT，官方文档区分嵌入式文件读写与其他并发模式。一个受控批处理读取不可变分区，是本方案可以理解和验证的简单模式；不宣称普通数据库文件可以被多个独立进程任意写入。[S059｜DuckDB LICENSE](https://raw.githubusercontent.com/duckdb/duckdb/main/LICENSE) [S060｜DuckDB并发](https://duckdb.org/docs/current/connect/concurrency.html)

适用任务是跨较长历史的事件统计、指标冗余检验、回放和生成小型结果包。初期可以导出现有合法数据在单个本地/隔离计算任务分析，再把结果JSON返回在线页面；不要求维护DuckDB HTTP服务器。Parquet是一种文件组织，不会自动补齐时间版本、来源身份或缺口。

替代首先是现有D1查询和JS计算。如果代表性任务在现有路径可接受，就不引入新环境。在线多用户/高并发场景需要其他服务型方案，但本轮没有生产负载证明需要ClickHouse/QuestDB。不得以查询库流行或“金融数据大”作为迁库依据。

维护与费用：官方文档/许可可读，具体发行包支持按运行环境核查；软件免费不等于磁盘、对象存储请求、计算和运维免费。接入方案及性能都待实验。

### K12｜arch：补不确定性估计，不增加不透明指标

官方文档提供Stationary/Circular Block等重采样，也明确指出Moving Block端点观察可能被系统性欠采样。这是不能忽略的不利证据：存在一个算法，不代表每个事件研究都适合采用。许可原文是NCSA式宽松许可。[S051｜arch时间序列bootstrap](https://bashtage.github.io/arch/bootstrap/timeseries-bootstraps.html) [S052｜arch LICENSE](https://raw.githubusercontent.com/bashtage/arch/main/LICENSE.md)

适合在既有合法收益序列和预声明事件定义上估计统计分布对序列依赖和样本变化的敏感性。普通IID重采样、重复重叠事件和稀疏宏观样本都可能制造虚假精确性。具体区块长度、样本单位和事件簇须由卷11的方法设计固定。

运行在Python批处理；没有行情服务。文档显示8.0.0，不能由版本号宣称已是本系统推荐安装版本。维护者集中度、调用性能与样本效力未知。

替代是先给出原始样本量、分位分布和分段对照。样本不足时不需要更复杂的置信区间包装。此库是条件依赖，不是每份日报必跑。

### K13｜exchange_calendars：证券会休市，BTC仍在交易

仓库提供证券交易所日历，Apache-2.0。用途是标注SPY/QQQ/GLD等跨资产价格究竟来自当前交易时段还是上一个收盘，不把周末沿用值误认为最新新数据。它不是央行/统计局发布日历，也不应被拿来生成CPI时间。[S047｜exchange_calendars仓库](https://github.com/gerrymanoim/exchange_calendars) [S048｜exchange_calendars LICENSE](https://raw.githubusercontent.com/gerrymanoim/exchange_calendars/master/LICENSE)

选择Python批处理时可以直接依赖；在线JS环境先使用最小合法日历快照和统一IANA时区处理。保存calendar_version，特殊休市修订会影响历史“当时市场是否开盘”的解释。

替代是直接从选定证券数据源取得session状态和官方交易所日历。覆盖国家/资产不多时后者更简单；没有必要为了三只美股ETF给在线Worker搬入一整套Python栈。维护状态为仓库文档可读、具体交易所未来日历准确性仍需样本验收。

### K14｜vollib与Deribit：可复核的期权期待，不是多空计分器

Deribit提供汇总、订单簿和波动率指数数据端点；vollib许可MIT，适合必要的定价/IV独立校验。该组合必须先明确计价/结算币、合约乘数、远期价格和时间年化，不能拿币本位报价不转换就送普通Black函数。[S007｜Deribit get_order_book](https://docs.deribit.com/api-reference/market-data/public-get_order_book) [S008｜Deribit summary by currency](https://docs.deribit.com/api-reference/market-data/public-get_book_summary_by_currency) [S011｜Deribit volatility index](https://docs.deribit.com/api-reference/market-data/public-get_volatility_index_data) [S061｜vollib LICENSE](https://raw.githubusercontent.com/vollib/py_vollib/master/LICENSE)

本系统没有已证实活跃期权链，因此选“有限期限快照、质量筛选、ATM IV/RV/期限结构”作为条件能力，而不直接开全曲面/交易商Gamma/最大痛点预测。独立计算和薄报价过滤都有维护成本；数据API免费可读不代表历史与分发权已确认。

替代是只显示Deribit原生指标、清楚标注来源和限制；不需要独立重算时不要加入Python数值库。某日期报价缺双边、价差过宽或缺期限括号时输出缺失，不用外推填满漂亮曲面。

### K15｜River／ruptures：分布变化与实时状态不是同义词

River官方提供在线学习与漂移检测，BSD-3-Clause；它可以监测已经形成的预测误差或特征分布流，而不是自动知道市场该涨跌。[S049｜River仓库](https://github.com/online-ml/river) [S050｜River LICENSE](https://raw.githubusercontent.com/online-ml/river/main/LICENSE)

本次先采用可解释的滚动分位/稳健标准化和显式质量状态。离线分段方法如ruptures在前轮研究中已定位为离线变点工具，本轮没有重做所有版本核验；因此只保留方法比较，不新增依赖。全样本分段的转折点可能使用未来数据，不能装成实时预警。

替代是固定滚动窗口的状态规则，先观察漂移究竟是上游数据异常、真实分布变化还是训练失配。没有已验证预测器和反馈样本时，在线学习只会增加难以解释的状态；暂不采用自动在线更新模型。

### K16｜Metaculus与预测校准：借鉴问题和结算，不复制排行榜

官方题目规范强调预先明确问题与结果判定，评分FAQ说明预测必须与实际结局对应。scikit-learn文档提供可靠性图与校准方法，并提示单个Brier指标不只度量校准。[S029｜Metaculus题目编写](https://www.metaculus.com/question-writing/) [S030｜Metaculus评分FAQ](https://www.metaculus.com/help/scores-faq/) [S028｜scikit-learn校准文档](https://scikit-learn.org/stable/modules/calibration.html)

本系统复用的是“具体事件、截止时间、取值来源、结算规则、允许撤销的客观条件、概率记录版本”。例如“未来24小时某交易所1h收盘是否高于指定价格”，不能混同“盘中触及”。概率保留p而非90分，自信语言与概率不同。

代码和运行环境可以使用本仓库现有JS；不需要接入预测市场、不需要资金交易、不要求读取Metaculus所有题库。产品交互仅借鉴；平台数据和内容许可未核验，不复制数据集。先积累前瞻记录，再评价校准；回看历史时模型可能凭预训练记忆知道结果，不能只靠隐藏未来数据就保证无泄漏。

## 4. 多代理：支持与反证一起保留

Anthropic的工程说明支持在宽广、可独立分解的研究问题中用多个子任务并行，也讨论协调与上下文代价。TradingAgents展示角色与决策日志，但其文档同时承认运行非确定性和历史输入边界。两者都不是“多Agent在BTC上更准”的证据。[S026｜Anthropic多代理研究工程](https://www.anthropic.com/engineering/multi-agent-research-system) [S043｜TradingAgents仓库](https://github.com/TauricResearch/TradingAgents)

本方案的主流程不是先跑五个角色，而是：确定性事实/事件选择 → 一个主分析 → 必要时一个独立反证审查。子任务只在问题有独立证据需求时触发，如“验证这条ETF申购说法的原始披露”和“核对该合约OI单位”；不得把同一篇文章交给三人总结后称三份独立证据。

多代理试验保持同一总费用上限、同一可访问来源和同一cutoff。评价无依据主张、重要反证遗漏、成本和任务时间，不只比较文本丰富度。若多代理只延长报告、重复搜索或降低可追溯性，退回单流程，保留有用的程序校验。

时间序列LLM研究存在支持与消融反证。某些论文展示预测能力，另一些研究发现移除LLM模块未使其比较对象变差；这些结论各有数据/方法范围，不能外推本仓库未来涨跌判断。[S031｜LLMTime论文](https://arxiv.org/abs/2310.07820) [S032｜LLM时间序列消融论文](https://arxiv.org/abs/2406.16964) 因此本方案不将通用语言模型作为未经验证的K线数值预测器。

## 5. 架构与产品决策记录（ADR）

| ADR | 决定 | 依据与替代 | 可推翻条件 |
|---|---|---|---|
| ADR-001 | 产品从多栏目日报转为BTC任务中心，全球情报分频道 | 混合内容与固定分数已核验；不是所有新闻都支持BTC研究 | 实际使用研究证明用户需要同屏综合情报且噪音没有上升 |
| ADR-002 | 退出固定市场分/置信度；状态、质量、概率分离 | R14规则不是校准模型；用理由而不是新常数代替 | 未来有明确预测目标与前瞻验证，可新增概率但不恢复旧名义 |
| ADR-003 | 一个研究run封存输入，复用已有snapshot纯逻辑 | 当前两个snapshot路径未统一；现有能力有价值 | 仓库证明已有完整相同输入封存，直接复用，不另造 |
| ADR-004 | 在线保留Cloudflare，研究域形成可独立调用模块 | 当前没有迁库证据，已有可用适配；业务需要较大调整 | 实测资源/可靠性边界支持迁出具体任务 |
| ADR-005 | 批量研究可使用单一按需环境，不默认常驻平台 | 长历史统计与Python库未必适合Worker，但不是每秒任务 | 当前JS/D1已满足研究查询，则不增加环境 |
| ADR-006 | 持久事件/主张/观点采用版本，旧内容只读兼容 | 当前短保留和上下文输出不足长期复盘 | 来源权利不允许保留时只留获准元数据，并公开不可重放范围 |
| ADR-007 | LLM为解释与发现缺口服务，不算权威市场数字 | 当前程序和模型输出边界混合；已有REST适配可保留 | 仍须用程序检验，不因模型升级取消 |
| ADR-008 | Grounding与可归档研究证据路径隔离 | 具体条款用途不同，现有合同配置未知 | 取得明确适用授权，可调整路径但保留权利记录 |
| ADR-009 | 事件优先用官方源与独立根源，报道数不当可信度 | 转载和多模型总结不增加独立观察 | 特定群体关注度研究可单列报道量，但不得冒充事实证实 |
| ADR-010 | 新能力先交付market change brief，不等全数据治理 | 已有行情/衍生品足够开展第一条研究链 | 当前基本数据无法满足最低正确性，限定输入先修一条，不扩全工程 |
| ADR-011 | 保留LWC4.1.3底座，分离版本升级和工作区改造 | 已有组件；v4到v5存在API迁移，不将版本号等同用户价值 | 具体交互需新API且对照证明收益，单独任务升级 |
| ADR-012 | 不默认接交易、账户、风险预算和持仓管理 | 核心目标为个人研究，相关现有角色多为demo | 用户另行明确项目边界与权限，不在本包隐含授权 |

ADR是设计决定，不是已执行事实。执行者可以凭代码或实验反证修订，需记录替代及影响，不能静默忽略。

## 6. 收敛的依赖策略

默认新增运行依赖可以为零：基础JSON校验、时间/数值约定、哈希、事件规则和现有适配均可先由已存在运行环境完成。并不是反对成熟组件，而是避免把本文每个候选都装进package.json。

真正可能引入的少数依赖分别有单一职责：离线Parquet分析用DuckDB；时间序列区块不确定性用arch；必要的期权定价对照用vollib；大量近似新闻候选用datasketch；获准HTML正文抽取用Trafilatura；测试编排复杂时用promptfoo。Python组件共享一个可重建研究环境，不为每个库建一个服务。

若选择组件，记录package/版本/源码许可/数据用途/运行环境/输入黄金样本/负责人/替代策略。无负责人、没有真实场景、不能比简单基线改善任何一项价值指标时，候选保持研究条目而非实施任务。

## 7. 仍未知的外部条件

Binance/Bybit/Deribit对本产品保存、展示、外部推理和分发的具体授权；Yahoo旁路适用条款；所有商业历史源的预算与退出方式；当前Gemini调用是否为付费服务、Grounding是否触发及其实际合同；各来源真实时延、覆盖与地域可达性；所用开源版本的完整依赖许可与漏洞。本文没有把“页面能打开”和“有免费API”当作这些问题的答案。
