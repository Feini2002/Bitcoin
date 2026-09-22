# 币安主源行情工作台：数据接入与改版依据

研究/实施日期：2026-09-16。用户确认本轮完成数据接入、D1 沉淀、对抗审查与详细方案，页面下一轮改。本文区分事实、已实施内容和后续方案，不把 API 可调用当作数据可用于交易决策。2026-09-21 空桌治理与 `/api/desk` 装配见 [cloud-d1-desk-governance-2026-09-21.md](cloud-d1-desk-governance-2026-09-21.md)。永续主带 CF 403 已于 2026-09-21 傍晚经东京反代解开，见 [接线现状](binance-egress-vps-cutover-2026-09-21.md)；下文「当前 CF 403」是 09-16 快照。现货与其它所 REST 已随出口接线完成。工作台聚合/布局仍未做，见 [资料总纲](bitcoin-upgrade/README.md)「当前开发状态」。

## 本轮采用的依据

- 仓库卷04的交易所/市场/单位/时间契约，卷06与 RES12 的宏观修订、ETF、稳定币及期权限制。
- [币安现货公共市场 API](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints)、[USDⓈ-M 市场数据](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data)：主源合约、标记价/指数价、结算资金费、持仓量、基差及交易统计定义。
- [FRED observation API](https://fred.stlouisfed.org/docs/api/fred/series_observations.html)、[ALFRED 时点](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html)：日期级观测与修订不是日内实时报价。
- [Deribit 限流](https://docs.deribit.com/articles/rate-limits)、[Binance 官方历史文件](https://github.com/binance/binance-public-data)：来源预算和历史回补边界。现货历史文件自 2025 年起可能采用微秒，不能套用毫秒解析；日文件是次日发布，不能冒充实时流。
- [Cloudflare D1 限制](https://developers.cloudflare.com/d1/platform/limits/)与[Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)：使用现有库、限定数据集、批量写入；不新购服务。

## 实时核对的关键事实

1. 原 `klines` 主键为 symbol/interval/t，没有来源；Worker 的回退可取 Bybit/OKX，持久化时没有传入来源。历史来源无法事后凭价格近似恢复，不能统一标为 Binance。
2. 远程 D1 在 `funding_binance` 中实际存在 Bybit 历史和快照；`oi_binance` 也有 Bybit 数据。这不是仅存在代码中的假设风险。
3. 对抗审查复现了基差单位错误路径：空 annualizedBasisRate 被转为零，同时 basisRate 和绝对 basis 被混作备选。新数据保留三个字段，空串为 null，分别标记 USDT/BTC价格差、比例、年化比例。
4. 当前 CF 出口的 Binance REST 多次返回 403；同机公开 REST 对照的六个操作有五个成功、一个连接失败。可以确认出口差异，不能仅从 403 断言法律地域限制、账号封禁或具体 WAF 规则。现有 Binance WS 状态没有市场消息，不能宣称 WS 已替代 REST。
5. 当前通用 finance 存储是每组参数最近成功的原生响应，适合接口验证，尚不足以作为带来源历史分析底座。

## 本轮数据底座设计

- 主源固定 Binance USDⓈ-M BTCUSDT；Binance 现货分开作为现货/永续价差与成交背景。其他交易所只作明确命名的辅助，不写入 Binance 数据集。
- 先登记有限、可解释的数据集：完整 K 线字段、mark/index 与资金费状态、已结算资金费、OI 当前/历史、taker 主动成交、账户/头部仓位比例、原生基差、合约/资金费规则；辅助为美元/利率/通胀/政策流动性、USDT/USDC 供应、市场广度、BTC 链拥堵与期权摘要。
- 新增独立规范观察表，来源、市场、数据集、观测时点、接收时点、采集位置和原生单位均可追溯；保留每次独立接收的版本，同次重复导入由主键去重。不能跨接收时间只按数值去重，否则迟到数据会改写错误的历史。缺失数值不是零；K 线分开表示窗口结束、请求是否发生在期末之后，缺证据时收盘状态为未知。
- 按需刷新复用既有免费网关和 TTL/冷却，另提供只读数据集接口。前端/LLM 本轮不自动切换到新表，避免页面不改而输入口径悄然变化。
- CF 受限而本机官方公开接口可达时，可以做有界首次样本导入；记录 `local-bootstrap`，不冒充 CF 定时采集成功，不开启本机常驻服务。持续云端采集能力仍单列缺口。
- 本轮不无差别定时请求 40 个平台，不新增付费 Key、试用或代理。每项数据的刷新周期、预算与缺口在最终清单记录后，下一轮依实际消费需求启用。

## 实施与验证顺序

1. 补充 Binance 公开操作与脱敏错误原因分类；保持固定官方目标，不输出上游错误原文中的可能凭据。
2. 实现固定数据集适配、独立 D1 schema 与只读/按需刷新接口；现有表不删除、不重写。
3. 用真实 SQLite 检查来源隔离、空值/单位、K 线收盘、观察修订及读回；用现有完整构建验证关联接口。
4. 生产建表、代码发布、限定数据集初次采集/导入与远程 SQL 验收；不将本机连通证据当 CF 连通证据。
5. 落实全部平台限制、数据缺口、对抗审查与下轮页面/快照/分析输入联动方案。

## 第一性原理：系统到底需要证明什么

交易分析首先要回答：在什么市场、什么时间范围、用什么可观察证据，形成了什么结论；哪些缺失会使结论失效。接口数量、指标数量和图表复杂程度都不能替代这些条件。

| 决策问题 | 最小证据组合 | 不能推出的结论 |
| --- | --- | --- |
| BTC 当前处于什么价格结构 | Binance 永续已完成 K 线、成交量、当前周期与上级周期 | 单条均线交叉不等于独立胜率 |
| 价格变动是否伴随杠杆扩张 | 同市场同窗口价格变化、OI 数量与价值变化、资金费 | OI 上升不等于资金净流入或新增多头 |
| 主动交易偏向哪边 | 同窗口买卖主动成交量、taker 比例、现货/永续分别观察 | 账户多空比不是多空资金量，单时点盘口不是订单流 |
| 执行条件是否恶化 | Binance 最优买卖价、可见深度、价差、短期波动、来源延迟 | 20档快照不能描述全部流动性或未来清算位置 |
| 外部环境是否变化 | 利率/美元/通胀、政策资产负债表、稳定币、期权、事件 | 宏观相关性不等于 BTC 因果方向或即时买卖信号 |
| 结论能否复核 | 来源、观察/接收/保存时间、原生单位、采集位置、覆盖与修订 | 今天导入的历史不等于历史当时可见信息 |

## 32 个规范数据集与使用边界

运行时定义以 [datasets.mjs](../../cloudflare/finance/datasets.mjs) 为准，普通免费通道仍保留原生响应。规范数据只是下轮的输入底座，本轮没有切换现有主图、快照或 LLM。

| 组别 | 数据集 / 初始范围 | 语义和用途 |
| --- | --- | --- |
| 主图 | Binance 永续 5m/15m/1h/4h/1d/1w，各最多500根 | OHLC、BTC量、USDT量、成交笔数、主动买入双币种量；短周期500根不足原结构算法864根窗口，下一轮须先补足或显示不足 |
| 永续价格与费率 | premium、funding，结算费率最多500次 | mark/index 与最后报告费率分开；已结算费率按实际结算时间保存；不把 premium 每分钟采样叠加为收入 |
| 杠杆与主动交易 | 当前OI、小时OI历史、taker、普通账户比、头部持仓比，各历史最多500点 | OI数量/价值、主动买卖量与账户样本分开；官方统计历史通常仅最近30天/一个月，不能声称完整长期历史 |
| 基差与执行 | basis、20档depth、instrument、funding-info | 基差绝对值/比例/年化独立；资金费调整列表空缺只表示未报告调整；tick从filters读取 |
| 现货辅助 | Binance spot 1h最多500根 | 始终标为现货；不接替永续主图；USD和USDT跨平台不可直接等同 |
| 利率/美元/通胀 | FRED DGS2、DGS10、DFII10、T10YIE、DTWEXBGS、CPIAUCSL，各最多1000点 | 百分数不是比例小数；美元指数为广义贸易加权美元，不能标为ICE DXY；CPI为季调指数，不是同比值 |
| 流动性背景 | FRED WALCL、WTREGEN、RRPONTSYD各最多1000点 | WALCL是周三时点、WTREGEN是截至周三的周平均、RRP是日频；前两者百万美元，RRP十亿美元。日期相同也不是相同统计口径，不能直接相减解释为资金流 |
| 短端利率 | NYFed SOFR最近30个工作日 | 日频年化百分比，参考利率不是可成交报价 |
| 链与市场背景 | USDT/USDC供应、CoinGecko广度、mempool费用 | 供应变化不是交易所净流入；聚合成交量不是币安成交量；费用为sat/vB、源时间未知时不捏造 |
| 期权背景 | Deribit BTC期权原生摘要 | 最新接收截面单独读取，返回总数和截断标识；mark IV不等于可成交隐波，暂不计算无完整报价依据的25delta偏斜/GEX |

`GET /api/finance/datasets` 列出32项定义、观察字段、推荐刷新间隔与当前采集状态。`GET /api/finance/datasets/{id}` 只读D1；`POST /api/finance/datasets/{id}/refresh` 请求固定来源，复用现有TTL/冷却并同步保存。不能传任意URL、任意交易所或交易操作。`limit`为1–1000；`known_at`只表示本系统接收时点的版本筛选，不证明真实公开时间。期权默认只返回最新截面；任何`coverage.truncated=true`都不能据此计算全截面总量。

`collectionStale`描述采集年龄，`sourceLagSeconds/sourceStale`描述来源观察年龄；宏观发布日期未建模时返回尚未评估，不能用当前采集时间掩盖旧数据。当前采集状态是现在的健康状态，不是`known_at`的历史健康状态。缺少源时间保留null；公开号时间`publicAvailableAt`本轮仍为null。`closed`只是“请求发生在计划期末之后”的证据，`closureBasis`明确不是交易所收盘确认标志。

## 对抗审查与处理决定

已由原生金融审查子代理进行只读审查，不向第三方模型提供仓库或数据。根代理核对了实际代码、D1、官方文档，并用真实SQLite补复现。严重级别是修改优先级，不是交易风险评级。

| 优先级 | 已发现问题 | 本轮处理 / 下一轮处理 |
| --- | --- | --- |
| P0 | 老K线无交易所列；资金费/OI名为binance但存在Bybit记录 | 新底座严格隔离；原数据保留且不能事后统一改名。下轮统一切换页面、快照与分析输入 |
| P1 | 基差把USDT、比例和年化混为同一数值，空串变0 | 新底座字段、单位、null已独立；旧展示与快照算法下轮一起修 |
| P1 | 新接收旧源数据被判新鲜；一个周期新鲜掩盖当前周期过期 | 新底座分开源年龄和接收年龄；旧快照按当前周期计算，下轮修 |
| P1 | 比值仅与最新值去重，乱序到达破坏历史甚至当前值 | 新底座保存每次独立接收，复现两种乱序均通过；不能用哈希/数值相同省略接收证据 |
| P1 | 网络跨越收盘边界导致未完成K线被标完成 | 加入请求起始时间及明确推断依据；没有请求证据时未知 |
| P1 | 24h变化基线可能取到48h；宏观日期被误作日内发布时间 | 下轮按实际基线时间/允许偏差求变化，缺点返回不可计算；本轮时点语义明确 |
| P2 | 相同数值的新FRED修订元信息丢失 | 每次独立接收完整保存，null→数值及同值新修订均测试 |
| P2 | 期权多次截面重复计数，1000条截断不明 | 默认最新截面，返回available/returned/truncated；历史不混入总量 |
| P2 | EMA/MACD/RSI重复计分，启发式结构/清算分数被解读为概率 | 下轮归入同一价格因子族，展示证据强弱/覆盖，未经校准不输出胜率 |

## 仍缺什么：分开可补、需建设和免费范围不能证明的内容

| 缺口 | 为什么需要 | 免费来源与处理 |
| --- | --- | --- |
| Binance持续云端数据路径 | 首次样本很快过期，不能服务实时主图 | 当前CF403、本机可达；本轮无常驻本机服务。须先使受支持部署出口稳定直连官方接口，或明确选择既有设备的持续采集方式后再验收，不能悄悄换Bybit |
| 更长、来源明确的K线历史 | 结构窗口、指标预热和不同周期比较 | 官方REST分页/官方归档；须解析毫秒与微秒差异、窗口缺口、交付延迟。不可拿老无来源K线补成“币安历史” |
| 连续逐笔和盘口序列 | CVD、成交量轮廓、冲击成本和盘口变化 | Binance aggTrades/WS与depth快照衔接；需要序列号、断线缺口及重建验证。当前20档REST不足，不能当已完成 |
| 可核验的期权偏斜/期限结构 | 比单个mark IV更有分析意义 | Deribit instruments与book联合取样，匹配expiry、delta、bid/ask、单位和时间，再拟合；本轮仅原生摘要 |
| 发布日历、宏观历史版本 | 避免事件前后看错时间及回测前视 | 官方央行/统计局发布页+FRED/ALFRED版本；区分参考期、发布日期、修订日和系统首次收到日 |
| ETF日净申购/赎回与发行人数据 | 观察现货需求背景 | 发行人披露/官方文件逐项核对，先建日期/发行人/原始链接契约；SEC submissions不是日净流量API，不伪造已接通 |
| CME定位及跨资产比较 | 中低频环境辅助 | 已有CFTC TFF、Finnhub/Twelve/Alpha通道按实际免费权限选；CFTC为报告期与发布期分开，不拿美股休市旧值当实时 |
| 交易所净流入、实体标签、历史全深度 | 需要完整标签和覆盖才有可信语义 | 当前免费通道不提供可靠完整证据；明确缺失。链上转账不等于交易所存取；不买Key、不抓网页伪装API |
| 真实未来清算分布、隐藏订单、庄家仓位 | 公开数据无法直接观察 | 保留情景估算标签；不把推导图称真实清算地图。Binance forceOrder每秒仅最新事件，不能声称覆盖全部强平 |

依据：[Binance历史归档](https://github.com/binance/binance-public-data)、[强平流契约](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market#liquidation-order-streams)、[SEC接口说明](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)、[Deribit订单簿](https://docs.deribit.com/api-reference/market-data/public-get_order_book)。未实施项不进入当前能力状态。

## 下一轮工作台方案（本轮不实施）

### 信息顺序

1. 删除截图两行：泛化“已接入”横幅，以及BTCUSDT/员工跳转横条；已有导航承担页面切换。保留一处紧凑合约身份：Binance、USDⓈ-M、BTCUSDT、当前周期、真实源时间与异常标记。
2. 主图上方只放当前报价、mark/index、价差/资金费状态和数据时效；指标开关收进紧凑工具栏。主图默认K线+成交量，EMA可选；布林、Fib、VWAP、RSI、MACD按需启用，避免满屏同类线。
3. 主图下方按“价格结构 → 杠杆/主动成交 → 外部背景 → 数据证据”排列。宏观不挤占短线图，按日/周频率显示，并标最近观察日与发布状态。
4. 聚合卡展示当前值、变化窗口、基线时点、单位、来源和缺口。点击展开原生数据和计算依据；空值显示未取得/不可计算，不填0、不在主区展示长接口说明。

### 聚合逻辑

- 主价格唯一取Binance永续同一instrument，不平均不同交易所价格。现货/永续价差必须时点对齐并分别标市场；其他平台只进入独立辅助组。
- 每个派生值明确输入、频率、窗口、单位、时间截止、最少样本与缺失行为。24h变化取目标基线附近有容许偏差的同源值，返回实际窗口；缺口超阈值则不计算。OI数量变化与OI的USDT名义价值变化并列，避免价格上涨被重复解释为加仓。
- 用“价格↑/↓ × OI↑/↓ × 主动成交”作观察标签，再由资金费/现货辅助校验；这是情景描述，不是确定方向。账户比、头部仓位比只是样本，不能直接投票成多空胜率。
- 派生因子按价格趋势、波动、杠杆、主动成交、外部环境分组；EMA/MACD/RSI不各算一票。事实、统计派生、启发式解释三层分开。覆盖不足优先展示“不足以判断”。
- 宏观对齐实际观察频率和截至时点；FRED美元指数不得冒充DXY。WALCL−TGA−RRP不能只靠单位一致和日期对齐直接计算：现有TGA为周平均、WALCL为周三时点。须先取得匹配的时点序列或明确统一期间统计方法；若研究中保留混合口径，只能标“混合口径流动性研究代理”，不是资产负债表恒等式、资金流、BTC可投资资金或稳定因果关系。
- 页面和LLM使用同一服务端聚合输出及相同版本；LLM收到原始事实、衍生值、缺失原因和来源，不让模型补造缺口。保留当前已存报告，不重新解释成新口径。

### K线与图表规则

- 当前形成中的bar使用独立样式；已确认结构只消费有期末后请求证据的bar，缺证据时保守标未知。WS增量与D1同来源、同市场、同时间桶合并；错周期的迟到请求不能覆盖当前视图。
- 蜡烛、成交量、OI/资金费/RSI等窗格共享时间轴与十字线；切周期、加载更多、自动跟随最新、拖动历史后的视口行为分别测试。
- 主图关键位按相关性限制数量，合并近邻并支持展开；保留tick精度与标签碰撞处理。启发式支撑阻力/Fib以清晰标签标示，不能展示未经验证的概率。
- 成交量优先用原生quoteVolume；有takerBuyQuote时可构成窗口主动买卖量，不能据K线粗略推断逐笔价格分布。Anchored VWAP必须有明确锚点；OHLC近似VWAP必须标近似，不能当真实成交均价。
- 波动用ATR/实现波动的明确窗口与单位；副图默认只开启最有用的一项，其余按用户选择。长周期价格可选对数轴；价格、指标各自坐标，不能把OI金额强行画在价格轴上。
- 数据不足先反馈可用覆盖与所需长度；特别是5m的500根只有约41.7小时，小于现有864根结构窗口。先完成Binance历史回补验收再恢复相同结构能力。

### 联动文件与实施次序

| 次序 | 受影响范围 | 验收标准 |
| --- | --- | --- |
| A 来源与时间 | `cloudflare/binance-klines-worker.js`、`cloudflare/finance/*`、`js/data-engine.js`、`cloudflare/schema.sql`相关只读迁移设计 | 主源只允许Binance；旧无来源历史单独标unknown；暂停/失败不串源；当前周期时效不被其他周期覆盖 |
| B 聚合计算 | `cloudflare/snapshot/marketSnapshotProgram.mjs`、`chartStructureSnapshot.mjs`、`market-snapshot-worker.mjs`、`js/chart/indicator-math.js` | 基差单位、24h真实基线、已收盘窗口、样本不足、源时间和宏观日期契约一致 |
| C 页面与关联点 | `js/pages/chart.js`、`js/chart/indicator-panes.js`、`mtf-tiles.js`、`styles.css`、`index.html`；核对overview、derivatives、orderflow、heatmap中的同源展示 | 两行删除，主图非空且来源一致；辅助数据明确分组，无0值伪造；默认信息密度降低 |
| D 分析输入 | `js/agent-views.js`、`cloudflare/snapshot/*`、`cloudflare/yuqing/*`、快照导出与已存报告读取 | 同一个instrument/asOf/version；缺失随输入传递；历史报告保留原版本，不后台触发模型消费 |
| E 发布验收 | Worker先发布、资源版本提升、Pages发布；需要的D1动作限定新来源回补/迁移，不自动删除老表 | API与D1读回、生产hash页、桌面/移动Playwright全部对应功能通过 |

流程验收：`#chart → 选择周期/切指标/拖动历史/刷新数据 → 当前周期、来源、指标和视口一致`。稳定用例：CHART-01去噪与身份；02切周期与迟到请求；03缺数据/过期/未收盘；04指标单位与关键位；05副图同步；06桌面/移动无溢出；07导出/LLM契约一致。既有检查：`npm run lint`、`node scripts/verify-indicator-math.cjs`、`npm run verify:market-snapshot`、`npm run verify:footprint`、`npm run verify:finance`、`npm run verify:ui`、`npm run build`、`npm run verify:api`。浏览器断言与视觉审阅分开，不以截图代替功能验证。

## 免费预算、保留与持续采集的决定

后续币安故障专题与实际修复见[连接诊断记录](binance-connectivity-2026-09-16.md)：已修正过期WS入口；CF实时出口与REST 403仍须独立解决。

- 本轮只做按需取数和有限首次导入，`automaticCollection=false`；已有系统Cron保持，不让新增32项自动进入旧定时任务。表中`refreshSeconds`是建议时效，不是已经运行的调度器。
页面与分析输入切换的现行治理见 [2026-09-21 空桌装配](cloud-d1-desk-governance-2026-09-21.md)：停止混写、desk 硬身份、主带未恢复前空桌，而不是把 09-16 样本当实时主图。

- 下轮优先增量采集：5m主K线每5分钟取最近少量bar；其他周期在边界刷新，历史按缺口分页；OI/premium约5分钟，小时统计按小时，规则每日；FRED每天1–2次并对修订窗采样，稳定币6小时、广度1小时，期权摘要按实际消费约1小时。先计算真实写入预算，不把当前500/1000点引导采集直接放进高频Cron。
- 当前保留每次独立接收的版本，因此反复全历史刷新会增长存储与写次数。没有后台删除旧观察，本轮不自动清理远程历史。持续模式上线前要选定增量窗口、修订保留与查询索引；清理既有持久数据需另有明确范围。
- [D1 Free](https://developers.cloudflare.com/d1/platform/pricing/)当前为每日500万读行、10万写行、总存储5GB；索引也产生写行，不能把观察行数当实际写额度。账户既有套餐未改，使用量仍计入既有账户；免费上游不能证明Cloudflare总账单为零。本轮不升级任何套餐。
- 若CoinGecko仅为广度每小时一次，约720次/30日，低于Demo登记的10,000月额度，但其他页面/诊断共用额度。Alpha25次/日、Twelve8credits/min且800/day不能被界面轮询消耗。Twelve当前Basic列明internal non-display；下轮上屏前须确认展示许可，不把个人账号等同可公开再分发。
- 关键卡点继续按事实记录：403仅能证明当前出口被拒绝；限流按Retry-After或既有冷却；TLS525不降级证书/HTTP；超时不反复自动重试；不创建付费代理、试用或隐藏常驻采集。

## 代码、操作与恢复

新增schema为 `cloudflare/finance/dataset-schema.sql`，仅新建 `finance_dataset_observations`、`finance_dataset_state`及一个索引。采集脚本 `scripts/collect-finance-datasets.cjs` 默认CF固定32项、并发2；本机模式默认仅Binance，明确选择单项时仅支持无Key公共数据。它只生成本地SQL，不暗中执行远程导入。`scripts/verify-finance-datasets-live.cjs`只读线上数据，逐字段核对已导入样本。

回退：Worker可回退本轮前版本 `50839539-ffb2-4b04-9452-fabf434a3414`，前提是确认之后没有新的Secret变更；保留新增D1表和已收集数据。也可停止调用新数据集refresh接口；本轮没有新增定时器需要停。`FINANCE_D1_ENABLED=false`会同时关闭原finance存储，不能误称只关闭新数据集。本轮不提交或推送Git。

## 本轮实际交付与验收（2026-09-16 北京时间）

- 新接口已发布至生产Worker：`199c5d0d-15b0-431b-855c-c4df75499dc3`，100%流量；通用目录版本`2026-09-16.3`，40个平台/产品、93项操作契约。原有Secret、Cron、路由保留；本轮未改页面运行文件。
- 16:12前后独立只读验收：**32 PASS、0 MISSING、0 FAIL，共16,260条观察**。12个CF直接采集数据集共8,988条；20个本机首次导入数据集共7,272条（Binance18项6,373条、Deribit898条、mempool1条）。这证明首次沉淀和读取，不证明连续云端采集。
- 20项本机导入均逐字段比较源样本与云端D1读回，包括来源、接收时间、采集模式和数值；12项CF采集在写入后独立GET比较完整观察列表。期权898条完整截面，返回未截断。全部Binance样本来自`fapi.binance.com`或现货`data-api.binance.vision`，没有跨交易所替代。
- CF原生采集首次32项为12通过、20失败：Binance18项403（具体拒绝原因未判定），Deribit429并报告额度/速率原因，mempool超时且单次复核仍超时。失败原生通道健康记录保留；本机导入后的数据集成功状态必须结合`last_ingestion_mode`理解，不能据200认定CF上游已恢复。
- D1应用仅新schema、87条Binance导入语句及12条辅助导入语句。Cloudflare返回真实成功及写行统计；导入后数据库约18.8MB。补充SQL文件的只读汇总执行成功但只返回执行元数据；改用query端点取SELECT结果时遇到Cloudflare鉴权错误10000，未用其冒充精确SQL汇总。本次精确16,260条来自全部数据集独立API读回，与导入结果一致。
- FRED另有9项series元数据经CF成功读取并存入原生快照；核验单位、季调与频率。特别确认WTREGEN为截至周三周平均，WALCL为周三时点、RRPONTSYD为日频，不能只对齐日期便直接相减。
- 离线验证：`npm run verify:finance`共40 PASS（18通道、9原生D1、13规范数据集）；93个操作请求契约通过。`npm run build`全量通过，研究路由17项检查通过，CodeGraph同步完成。数据集线上读回为独立确定性验收，不以命令退出码代替成果。
- Wrangler多次在返回业务成功后未退出，已由有界启动器按记录PID终止本次进程树并核对残留；没有因退出异常重复导入数据或重新发布相同版本。SQL query鉴权问题与上游API的403/429/超时分开记录。

证据位置：`.artifacts/finance-datasets/cloud.json`、`local-bootstrap*.json`、`acceptance.json`与对应公开数据SQL；FRED元数据为`.artifacts/workbench-research/fred-series-metadata.json`。这些运行产物不进入Pages发布目录，仓库研究文档也不保存Key、鉴权URL或联系设置。

16:25发布后核对：生产catalog HTTP200，40平台/93操作，7个免费Key和SEC设置共8个配置仍在；数据集目录HTTP200、32项均有成功记录，`automaticCollection=false`、`frontendConnected=false`。原`/api/d1/status` HTTP200。Pages发布为`d38358a1.bit-trading-desk.pages.dev`，该地址与生产`bit-trading-desk.pages.dev`均HTTP200、入口资源引用正常；33个静态文件全部为已上传内容，本轮没有新增页面变化。自定义域仍是Cloudflare Access 302，未冒充已登录页面验收。发布命令在业务成功后未收口，到120秒按精确进程树停止且无残留；后续旧部署清理未确认完成，不据此重复发布。发布核对报告为`.artifacts/workbench-research/release.json`。
