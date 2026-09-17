# 本轮直接证据索引

代码固定于a6ef6c8974dcdaace32acf25c3a231ecd279ef37；外部查询日期2026-09-17。源码range为请求范围，短文件返回至实际末尾；只对实际返回内容作判断。文件出现与运行成功分开。

| ID | 原始链接 | 核验支持范围 |
|---|---|---|
| C01 | [README.md（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/README.md#L1) | 用途、运行方式、历史部署记录；没有本轮访问生产。 |
| C02 | [docs/research/bitcoin-upgrade/README.md（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/docs/research/bitcoin-upgrade/README.md#L1) | 现有研究包、32数据集、16260条回读、采集探测与部署的仓库记录；其测试未由本轮重跑。 |
| C03 | [docs/research/workbench-binance-data-plan-2026-09-16.md（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/docs/research/workbench-binance-data-plan-2026-09-16.md#L1) | 当前计划、网络历史探测、数据口径与未接页面状态。 |
| C04 | [cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1) | 32个固定数据集、字段单位、读/刷新路径、自动采集和前端状态。 |
| C05 | [cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L77) | 归一化完整switch及末尾校验；options保留原始摘要行，可能已有bid/ask与underlying字段。 |
| C06 | [cloudflare/finance/dataset-store.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/dataset-store.mjs#L1) | 追加receipt历史、readDataset已知时间选择、当前健康信息和截断。 |
| C07 | [cloudflare/finance/gateway.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/gateway.mjs#L1) | 固定上游、参数白名单、有界响应和错误分类。 |
| C08 | [cloudflare/finance/gateway.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/gateway.mjs#L170) | 缓存、只读stored、GET取上游、dataset刷新与状态；外层认证未完整审计。 |
| C09 | [cloudflare/finance/registry.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/registry.mjs#L1) | 已读范围内的来源、操作、费用标签及固定参数，不代表所有93操作逐一验证。 |
| C10 | [cloudflare/schema.sql（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/schema.sql#L1) | 旧行情/足迹/强平/衍生品表，以及已有健康、锁和同步记录。 |
| C11 | [js/chart/indicator-math.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/chart/indicator-math.js#L1) | EMA/ATR/BB/RSI/MACD、HLC3 VWAP、上一观察日极值。 |
| C12 | [js/chart/indicator-math.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/chart/indicator-math.js#L235) | 候选价格按当前价两侧筛选、聚类评分、周期样本参数。 |
| C13 | [js/chart/indicator-math.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/chart/indicator-math.js#L470) | 规范化、摆动与历史反应、结构构建。 |
| C14 | [js/chart/indicator-math.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/chart/indicator-math.js#L720) | 近端突破条件与候选选择的矛盾、规则confidence和Fib。 |
| C15 | [js/pages/chart.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/chart.js#L1) | 主图请求代次、取消、标题输入与回退注释。 |
| C16 | [js/pages/chart.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/chart.js#L190) | 默认指标、共享状态、置信显示、上级周期选择。 |
| C17 | [js/pages/chart.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/chart.js#L900) | 同产品标题REST读取与周期轮询；需验证异步晚到保护。 |
| C18 | [js/pages/chart.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/chart.js#L1370) | 主图WS行情、事件字段丢弃、连接状态与来源提示。 |
| C19 | [js/orderflow/footprint-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/orderflow/footprint-engine.js#L1) | 自动展示粒度、round分箱、同价失衡与单柱POC。 |
| C20 | [js/orderflow/footprint-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/orderflow/footprint-engine.js#L210) | 失衡统计、整窗POC及价值区扩张。 |
| C21 | [js/orderflow/footprint-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/orderflow/footprint-engine.js#L350) | SFP关键位从整个输入窗口建立再扫描历史。 |
| C22 | [js/orderflow/footprint-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/orderflow/footprint-engine.js#L600) | SFP结构分、已存在的展示降级、最新bar收盘和推断新鲜度。 |
| C23 | [js/pages/orderflow.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/orderflow.js#L1) | 足迹页面设置、缓存窗口和新鲜度读取。 |
| C24 | [js/heatmap/liquidation-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/heatmap/liquidation-engine.js#L1) | 逐交易所方向、价格/数量回退、unknown方向落多头聚合。 |
| C25 | [js/heatmap/pressure-matrix.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/heatmap/pressure-matrix.js#L1) | 压力矩阵输入、窗口不足回退、固定8h和质量分。 |
| C26 | [js/heatmap/pressure-matrix.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/heatmap/pressure-matrix.js#L260) | 基差阈值、场景加分、llmBrief及结构百分数。 |
| C27 | [js/pages/derivatives.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/derivatives.js#L1) | 单位猜测、source family筛选、变化时点、ratio解释和方向性文本。 |
| C28 | [cloudflare/snapshot/marketSnapshotProgram.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/snapshot/marketSnapshotProgram.mjs#L530) | 四页压缩、任一周期新鲜判页新鲜、原始标签混描述、其他启发式与指纹。 |
| C29 | [cloudflare/yuqing/fenxi/sentiment-logic.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/yuqing/fenxi/sentiment-logic.js#L1) | 固定分数、机会、由发布时间生成日历、未搜索即覆盖足够文本。 |
| C30 | [package.json（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/package.json#L1) | 真实Node要求、验证命令、构建与部署命令；本轮均未执行。 |
| C31 | [docs/research/chart-workbench-review-2026-09-16.md（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/docs/research/chart-workbench-review-2026-09-16.md#L1) | 同日较早审阅笔记，标题混源问题与当前代码有差异，不能照抄旧缺陷。 |
| E01 | [Binance USDⓈ-M WebSocket市场数据](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market) | aggTrade路径/聚合、q/nq、强平采样、K线字段；来源描述未做实测。 |
| E02 | [Binance USDⓈ-M REST市场数据](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) | OI一个月、basis/taker期初与OI期末、原生单位、Top Trader认证声明。 |
| E03 | [Bybit All Liquidation](https://bybit-exchange.github.io/docs/v5/websocket/public/all-liquidation) | 方向为持仓方向，p破产价、v executed size；没有本轮链路完整率证明。 |
| E04 | [Deribit期权摘要](https://docs.deribit.com/api-reference/market-data/public-get_book_summary_by_currency) | 摘要包括可空bid_price、ask_price、underlying_price、interest_rate、mark_iv和原生OI单位；不含完整深度/Greeks保证。 |
| E05 | [Databento市场schema与派生关系](https://databento.com/docs/schemas-and-data-formats/whats-a-schema) | MBO/MBP/Trades/OHLCV/Definition/Status区分与派生模式；不声称提供本项目全部BTC市场。 |
| E06 | [Kaiko交付](https://docs.kaiko.com/cloud-delivery) | 批文件与云仓交付的公开说明；非实测性能/采购授权。 |
| E07 | [Kaiko流式接口](https://docs.kaiko.com/stream) | 交易所/产品事件流交付方式；SLA和特定字段需合同。 |
| E08 | [Glassnode PiT](https://docs.glassnode.com/data/point-in-time-metrics) | 标签修订、computed_at与发布延迟的区别、历史覆盖起点；不做精确历史范围采购保证。 |
| E09 | [RavenPack News Analytics](https://www.ravenpack.com/products/edge/data/news-analytics) | 实体、事件、相关性、新颖性和时间分开建模；不采信其市场份额/收益宣传。 |
| E10 | [Anthropic多代理研究工程](https://www.anthropic.com/engineering/multi-agent-research-system) | 独立子任务、编排和上下文代价的工程案例，不证明BTC预测优势。 |
| E11 | [D1限制](https://developers.cloudflare.com/d1/platform/limits/) | 单库10GB/500MB、30秒、每实例单线程、参数与批次限制。 |
| E12 | [Workers限制](https://developers.cloudflare.com/workers/platform/limits/) | 付费默认30秒CPU可配置至300秒；具体触发/墙钟约束另审。 |
| E13 | [Durable Objects WebSocket](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) | 出站WebSocket不可休眠；不由此单独推导必须迁出。 |
| E14 | [Gemini附加条款](https://ai.google.dev/gemini-api/terms) | 服务、Grounding和内容使用边界；实际合同和适用例外未知，不作法律结论。 |
| E15 | [FRED/ALFRED实时区间](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html) | 历史vintage与当前版本、日期级查询；不等于精确发布时间。 |
| E16 | [Lightweight Charts 4.1 API](https://tradingview.github.io/lightweight-charts/docs/4.1/api/interfaces/IChartApi) | 现有大版本可用接口、定制series及释放；不代表项目已使用这些功能。 |
| E17 | [Kaiko REST数据目录](https://docs.kaiko.com/rest-api/data-feeds) | 目录级读取；不能据此证明具体数据深度。 |

## 未取得所需内容

- https://www.alpha-sense.com/platform/deep-research/：本轮正文未读，不纳入能力核验
- https://fdc3.finos.org/docs/2.2/context/overview：本轮此页不可读，前轮资料仅保留其原查询日期
- https://www.cmegroup.com/education/courses/introduction-to-bitcoin/what-is-the-bitcoin-reference-rate.html：不据此声称已读参考利率公式
- https://codeload.github.com/Feini2002/Bitcoin/tar.gz/a6ef6c8974dcdaace32acf25c3a231ecd279ef37：下载失败，实际改用GitHub连接器分范围读，不声称已克隆仓库

历史资料库中的来源仍保持原日期，不计为本轮全部重查。官方文档并不证明真实服务SLA或本仓库性能；供应商宣传不作为收益证据。
