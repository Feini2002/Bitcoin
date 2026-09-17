> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# 来源候选目录｜不自动启用

这些入口经过本文资料核验，但多数是官方目录/文档，不是已经试运行的feed地址。`runtime_endpoint`为空，`enabled=false`；按来源的实际取得方式与用途核验后才能注册。工程/论文资料只进入方法库，不默认成为BTC日行情事实。

|候选ID|类别|用途|限制|入口|
|---|---|---|---|---|
|MACRO-FED|官方货币政策与讲话|确认政策原文、讲话或声明更新|不是全市场新闻；必须区分发布机构声明与影响解释|[原始入口](https://www.federalreserve.gov/feeds/feeds.htm)|
|MACRO-BLS|官方统计排期|下一个已核实宏观检查点|排期会修订；Eastern Time与实际发布不同|[原始入口](https://www.bls.gov/schedule/2026/09_sched.htm)|
|MACRO-ALFRED|宏观历史版本|历史当时可见数值|系列第三方权利与日内精度未知|[原始入口](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html)|
|REG-SEC|监管提交与结构化披露|确认提交文件与相关字段|不是ETF净流入统一API|[原始入口](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)|
|ETF-IBIT|发行人基金披露|核对份额、NAV和带日期披露|不从AUM变化直接推净申购|[原始入口](https://www.ishares.com/us/products/333011/ishares-bitcoin-trust-etf)|
|STABLE-CIRCLE|稳定币发行人披露|供应/储备背景与变化|发行人披露不等于本系统独立审计|[原始入口](https://www.circle.com/transparency)|
|STABLE-TETHER|稳定币发行人披露|流通与储备定义核对|授权未流通、价格与链映射需区分|[原始入口](https://tether.to/en/transparency/)|
|MARKET-BINANCE|交易所实时协议|成交和盘口观察|消息完整性及数据用途未运行核验|[原始入口](https://raw.githubusercontent.com/binance/binance-spot-api-docs/master/web-socket-streams.md)|
|HISTORY-BINANCE|市场历史归档|成交/K线回补及修订|归档可替换，不是完整历史L2保证|[原始入口](https://raw.githubusercontent.com/binance/binance-public-data/master/README.md)|
|MARKET-BYBIT|清算观察|单来源清算事件|破产价及持仓方向不等于主动成交|[原始入口](https://raw.githubusercontent.com/bybit-exchange/docs/master/docs/v5/websocket/public/all-liquidation.mdx)|
|OPTIONS-DERIBIT|期权报价与规格|有限期权截面|报价质量、许可、历史覆盖另查|[原始入口](https://docs.deribit.com/api-reference/market-data/public-get_order_book)|
|HISTORY-TARDIS|商业市场历史|补过去未采集历史|需要具体授权与报价，默认不启用|[原始入口](https://docs.tardis.dev/historical-data-details/deribit)|
|CHAIN-CM|社区链上指标|研究探索和交叉核查|NC限制，不默认商用|[原始入口](https://docs.coinmetrics.io/packages/coin-metrics-community-data)|
|CHAIN-GLASSNODE|链上实体时点方法|理解标签/修订与采购需求|不是免费可调用数据配置|[原始入口](https://docs.glassnode.com/data/point-in-time-metrics)|
|CHAIN-MEMPOOL|链上浏览/API发现|费率与拥堵背景|API用途和SLA另查|[原始入口](https://github.com/mempool/mempool)|
|NEWS-MEDIACLOUD|媒体集合与新闻研究|审计来源覆盖盲区|API key与服务条件待确认|[原始入口](https://raw.githubusercontent.com/mediacloud/api-client/main/README.md)|
|NEWS-EVENTREGISTRY|商业事件与文章服务|多语事件候选发现|聚类是供应商输出，不直接当事实|[原始入口](https://github.com/EventRegistry/event-registry-python)|
|DISCOVERY-SEARXNG|元搜索发现工具|查找候选原始来源|搜索不是独立事实，不能规避来源政策|[原始入口](https://docs.searxng.org/dev/search_api.html)|
|DISCOVERY-RSSHUB|订阅路由候选|查某个合法可用feed适配|具体路由和上游权利逐项核验|[原始入口](https://github.com/DIYgod/RSSHub)|
|RESEARCH-FORECAST|预测评价研究|改进前瞻评价方法|论文不是最新模型排行榜|[原始入口](https://arxiv.org/html/2409.19839v4)|
|RESEARCH-OFI|市场微观结构论文|建立可检验的订单流方法|样本非BTC，不直接外推效果|[原始入口](https://arxiv.org/html/1011.6402v3)|
|RESEARCH-ALCE|引用评价研究|定义引用支持与覆盖|本轮未复现全部论文实验|[原始入口](https://aclanthology.org/2023.emnlp-main.398/)|
|ENGINEERING-FINOS|金融互操作规范|共享工作区上下文设计|不进入BTC行情简报事实|[原始入口](https://github.com/finos/FDC3)|
|ENGINEERING-NINJS|新闻标准|文档版本与关联设计|规范不提供正文授权|[原始入口](https://www.iptc.org/std/ninjs/userguide/)|
|ENGINEERING-DOCLING|文档提取工具|研究复杂文档摄取|工具卡不是实时新闻源|[原始入口](https://github.com/docling-project/docling)|
|DERIV-LAEVITAS|商业衍生品服务|询证现成指标/历史采购|已读API文档需Enterprise key|[原始入口](https://docs.laevitas.ch/)|
|DERIV-AMBERDATA|商业数据服务|对照历史/交付/方法|入口级证据，具体字段和合同未核全|[原始入口](https://docs.amberdata.io/)|

该目录不是对各来源商用权、完整历史、地区可达性或SLA的确认。增加其他发行人、交易所、中文媒体或研究机构时沿用同样核验，不从相邻机构继承许可。
