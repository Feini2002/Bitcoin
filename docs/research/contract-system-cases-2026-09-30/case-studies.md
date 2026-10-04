# 七个核心案例：方法、架构与本仓库映射

查询日期：2026-09-30。全文为本轮归纳，来源事实与适配建议分开。固定提交、原始路径和文本校验和见 [sources.json](sources.json)；旧研究卡保留在 09-16 原包。本轮没有运行候选交易系统。

## 1. CCXT：先统一产品身份和能力，再谈多所

**官方事实。** 当前手册区分现货、到期合约、永续、线性与反向结算；合约市场提供 contractSize、结算币、精度和限额等元数据，能力声明告诉调用方某个接口是否支持。BTC/USDT 与 BTC/USDT:USDT 是不同产品，统一 API 不将它们合并。[固定手册](https://github.com/ccxt/ccxt/blob/80ca1ef6d89dc632fc63da8396fe4e317f12e3ac/wiki/Manual.md)

**结构。** 多个交易所适配器 → 统一公共市场接口与市场字典 → 调用方自己的历史、质量和计算。CCXT 是接口库，不是替调用方建设历史数据库的服务。

**迁移方法。** 增加第二个衍生品交易所时，产品键至少包括交易所、市场类型、原生 symbol、结算币、线性／反向、到期和合约大小。金额计算依据真实合约规则，保留原单位及变换依据。各适配器记录支持的接口、历史范围、频率与限制；空响应不自动解释为零。

**仓库映射。** 当前 datasets.mjs 的 Binance 单市场身份与单位已经明确，egress/gateway 也已有少数适配。先扩这个有限注册表；重复维护真的增加时再比较直接引入 CCXT。不为了“100 多交易所”将现有可靠主图替换或让上游无声切换。

**主要代价与边界。** 增加依赖和版本跟踪；统一接口仍须验证每个交易所的原生参数、限速和语义。本项目当前最重要的是覆盖声明，而不是把所有可调用端点都加到每分钟时钟。

## 2. Cryptofeed：事件、序列与原始录制

**官方事实。** 支持标准化 trade、L2/L3、资金费、OI、清算等公共事件与存储回调；README 描述 pcap 录制／回放。所查 Binance 适配源码维护更新 ID，旧更新可忽略，序列失配会丢弃并重建订单簿。[固定 README](https://github.com/bmoscon/cryptofeed/blob/6cbd9b959f104fe970791d32444a2ef13ddacc2f/README.md)、[Binance 实现](https://github.com/bmoscon/cryptofeed/blob/6cbd9b959f104fe970791d32444a2ef13ddacc2f/cryptofeed/exchanges/binance.py)

**结构。** feed handler → 每所连接／订阅／标准化 → 类型化事件＋收据 → 回调与存储；录制原始传输支持后续回放和调试。

**迁移方法。** 在聚合前保留源事件 ID、来源时点、收据、序列、连接代次及有效性。连续盘口的事实来源由快照＋增量重建，缺包后显式失效和重新初始化；接收到消息只是连接存活证据，不证明整个盘口连续。

**仓库映射。** 当前 DO、恢复游标、来源和去重已具备部分方法。主要差别是订单流／强平聚合后没有长期原始磁带，盘口仍为 REST 快照。先为单所定义可回放的事件协议和留存，而非用另一个常驻框架重复采集。

**主要代价与边界。** Python 长连接运行、录制量和维护增加；框架无法补回未公开／未收到的强平。当前固定版本 LICENSE 为 AGPL-3.0-or-later 并有署名附加条款，GitHub 元数据未识别完整许可；实际集成应以精确原文为准。本轮吸收方法，不将源码作为业务依赖。

## 3. NautilusTrader：同一事件模型贯通历史与实时

**官方事实。** 架构有 DataEngine、RiskEngine、ExecutionEngine、Cache、MessageBus 和适配器；共享系统内核运行回测、sandbox 与 live。数据文档同时定义成交、报价、盘口增量、资金费、标记价等类型，历史目录基于 Parquet 等持久化路径。[固定架构](https://github.com/nautechsystems/nautilus_trader/blob/2249c98829ea1f8d2598b3319c04371e145d5f8f/docs/concepts/architecture.md)、[数据](https://github.com/nautechsystems/nautilus_trader/blob/2249c98829ea1f8d2598b3319c04371e145d5f8f/docs/concepts/data/index.md)、[目录](https://github.com/nautechsystems/nautilus_trader/blob/2249c98829ea1f8d2598b3319c04371e145d5f8f/docs/concepts/data/catalog.md)

**时间细节。** ts_event 表示事件时间，ts_init 表示对象初始化时间；官方明确后者不总是收据时间。本仓库不能将它机械替换 receivedAt，也不能将 K 线收盘边界当首次可知时间。

**结构。** 历史目录／实时适配器 → 相同类型化事件与数据引擎 → 缓存／计算／策略；交易命令另外经风险与执行引擎。共享实现减少两套代码漂移，实盘的网络、成交和持久化差异仍需单独验证。

**迁移方法。** 当前数据与重算输入使用同一规范模型；保存算法版本、事件次序、原始文件范围与校验清单。按事件时间组织行情，按当时可见的收据／公布时间组织历史研究；两种时钟不能互相替代。

**仓库映射。** dataset-store 已有观察／收据／版本，可作为事实模型；desk 负责窗口装配。建议原始事件走旁路文件归档，D1 继续供在线窗口和目录索引。没有实盘执行目标时只取事件、目录和回放方法，不安装完整交易引擎。

**主要代价与边界。** 精确事件重算要求先获得原始数据；采用 Rust/Python 完整引擎会增加栈与部署维护。研究冻结的是 develop 提交，不是建议将开发 wheel 用于生产。

## 4. Freqtrade：数据下载、合约费用与前视偏差验收

**官方事实。** 有 futures 模式、历史下载、回测、dry-run，以及 lookahead-analysis；后者通过切片重跑比较指标与交易变化，不能用简单“看代码没问题”代替。订单流文档标 beta，使用交易数据构建价位足迹。[合约要求](https://github.com/freqtrade/freqtrade/blob/f6a7b767a31720b2f34059dd7b166b28abef3f09/docs/leverage.md)、[前视检查](https://github.com/freqtrade/freqtrade/blob/f6a7b767a31720b2f34059dd7b166b28abef3f09/docs/lookahead-analysis.md)、[订单流](https://github.com/freqtrade/freqtrade/blob/f6a7b767a31720b2f34059dd7b166b28abef3f09/docs/advanced-orderflow.md)

**结构。** 交易所公共历史 → 标准化本地数据 → 同一策略计算 → 回测／dry-run／实时交易；费用、标记价与资金费参与合约收益。

**迁移方法。** 给每项研究声明数据和最少连续窗口；按历史时点切断未来观察／收据，比较计算与输出。做收益评价时需真实结算资金费、费用、滑点、成交模型和缺失范围，不只有最后价 K 线。

**本轮拒绝照搬的做法。** 官方允许资金费历史缺失时填 0 来运行回测，同时明确会使历史收益不准。本项目事实层保留 missing；若情景分析采用假设 0，应独立标为假设结果。官方还说明清算费用并未完全计入，不能因机器人“支持合约”就认为所有合约风险都被建模。

**仓库映射。** 复用 K 线资格、数学回归、funding-info 和已结算费率；增补历史时点验收及方法版本，不恢复交易机器人。足迹方法可比较分箱与主动量，不能将 beta 功能当完整盘口回放。

## 5. Hummingbot：连接器、控制器与执行器各司其职

**官方事实。** 多所连接器区分现货与永续；V2 控制器组织策略，执行器管理 position、DCA、grid、arbitrage 等订单生命周期。所查 OrderBookTracker 维护 diff／snapshot 队列、更新 ID、处理与拒绝计数和健康信息。当前 README 还介绍由 Condor 将模型决策连接到确定性执行。[固定 README](https://github.com/hummingbot/hummingbot/blob/9af100d6822da7d2d0291a906c730ef172284ee2/README.md)、[订单簿实现](https://github.com/hummingbot/hummingbot/blob/9af100d6822da7d2d0291a906c730ef172284ee2/hummingbot/core/data_type/order_book_tracker.py)

**结构。** 每所连接器／订单簿／公共行情 → 市场数据与控制器 → 独立执行器与订单状态；模型可以给决策输入，但订单实际执行由确定性程序管理。

**迁移方法。** 数据采集健康、研究建议、风险检查与执行状态采用不同对象；每个阶段记录实际结果。订单簿重建和缺包计数可用作数据质量，不把机器人还活着当源数据没丢。

**仓库映射。** 当前范围保留公共行情、连接代次、恢复与质量方法。未来若开发交易执行，应另建账户／订单／风险契约，不让人工研究报告直接成为执行指令，也不把现有员工／会议室原型转正。

**主要代价与边界。** 完整接入会引入账户和长期运行成本；当前没有该目标。健康订单簿只是当前状态，要历史重算仍需归档。Condor 仅作为官方 README 明示的架构方向，本轮未独立运行或深审其仓库。

## 6. TradingAgents：分工之外，关键是日期、来源和反证

**官方事实。** 当前 README 为 v0.5.2，列出并行分析、运行设置记录、历史时点限制、市场／新闻／情绪等分析、讨论与风险流程；有 BTC-USD、ETH-USD 示例。所查 graph 有运行签名／checkpoint、历史记忆截止；date_window 对工具请求日期设置上界，并显式报告近期源无法覆盖旧窗口，避免将未观察到解释为没有发生。[固定 README](https://github.com/TauricResearch/TradingAgents/blob/8b22d43d01d9ddda5d686d093d5385884622f3de/README.md)、[graph](https://github.com/TauricResearch/TradingAgents/blob/8b22d43d01d9ddda5d686d093d5385884622f3de/tradingagents/graph/trading_graph.py)、[日期与覆盖](https://github.com/TauricResearch/TradingAgents/blob/8b22d43d01d9ddda5d686d093d5385884622f3de/tradingagents/dataflows/date_window.py)

**结构。** 研究请求与运行配置 → 工具／身份／日期约束 → 各证据任务 → 多空反证讨论 → 风险／综合输出与运行记录。角色分工依靠共享约束，不能只靠角色名称。

**迁移方法。** 本项目可将市场事实、事件原文、样本舆情、反证、条件情景和审计拆为不同任务；共用冻结输入和截止，数值由现有算法计算。保存来源 ID、输入内容版本、提示词／方法版本、实际工具输出、限制和最终报告引用关系。

**需要保留的限制。** README 同时说明模型采样及实时社会／新闻来源会使同日期运行不同；日期截断不能还原未保存的旧内容。日级 BTC-USD 支持不证明有 BTCUSDT 永续资金费、OI、盘口、清算与成交的完整模型。高 Star 和论文实验均不等于稳定可复制收益。

**仓库映射。** 延续 research-protocol 的事实、反证、情景和审计顺序，先补证据版本和冻结包。网站模型执行已退役；架构研究不恢复它，也不自动派发子助手。多角色与单助手应在相同证据、预算与人工评价下比较。

## 7. FinRobot：代码产出数字，模型解释，系统核对

**官方事实。** 当前公开 V0 AutoGen、V1 Agents SDK、V2 PydanticAI 桌面目录；V2 文档描述确定性计算、数字到函数调用的来源追踪、审计及 Lead／流水线／多空讨论角色。作者将其称为生产系统，本轮只核对公开目录与说明，未独立验收其所有运算和产品质量。[固定主说明](https://github.com/AI4Finance-Foundation/FinRobot/blob/2717499b8e30f242640af08c4ad9afd1113c2d45/README.md)、[V2 说明](https://github.com/AI4Finance-Foundation/FinRobot/blob/2717499b8e30f242640af08c4ad9afd1113c2d45/finrobot_desktop/README.md)

**结构。** 数据适配与校验 → 确定性计算和来源记录 → 分工解释／建模／综合 → 反证讨论 → 审计后报告。公开说明强调模型、计算、编排和核验分别承担职责。

**迁移方法。** 市场指标由现有数学与规范窗口计算；每个重要数字指向输入范围和方法版本。报告数值引用经程序核对，反证与情景有各自证据；不让模型临时猜一个价位、概率或覆盖百分比。冻结包是多角色共用的事实边界。

**仓库映射。** indicator-math、desk、workbench-evidence 与 research-protocol 已具备一部分分工。优先解决完整内容版本和运行证据关联；定性研究仍在用户主动对话中执行。

**BTC 不适用的部分。** 企业现金流、DCF、DDM、LBO 和股权估值依赖不同经济对象，不能用于给 BTC 定价。V2 发布开放状态覆盖旧 CASE09 的部分前提，但“开放代码”和“适用于合约研究”仍是两件事。

## 8. 本仓库应该吸收的共同方法

| 共同方法 | 当前已有 | 本轮建议 |
| --- | --- | --- |
| 原生产品身份与单位 | 单所 Binance 身份、单位、源主机和样本说明 | 扩所时延伸结算币／合约大小／线性反向；维持源独立 |
| 来源、观察与实际可知时间 | 规范收据、修订、knownAt、部分实时证据 | 冻结完整范围；未知公布时间不补成观察日期 |
| 可回放事件和覆盖清单 | K 线和短期聚合窗口、恢复状态 | 逐笔／深度研究触发原始旁路归档 |
| 同一事实与算法输出 | 四页 desk、数学程序与导出 | 内容版本覆盖所有事实、质量和算法前提 |
| 分工与反证 | 人工研究协议，模型自动运行退役 | 证据先固定，再按需比较单助手与多角色 |
| 样本外与真实使用验收 | 确定性回归、页面和短生产样本 | 新研究方法以相同输入／成本／评价对照，分别记录数据正确和研究增量 |

这份集合覆盖从数据到分析的可迁移部分，不是七套软件的安装清单。具体实施切片见 [adoption-plan.md](adoption-plan.md)。
