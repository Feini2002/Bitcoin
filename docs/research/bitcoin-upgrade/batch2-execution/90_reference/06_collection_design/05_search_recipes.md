> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# 中英文发现与反向核验模板

以下是供后续研究复用的查询模板，不声称本轮逐字执行了每条。每个主题先广泛发现，再回原始文档；反向查询要找限制、失败、更正、许可和停止维护。不要自动执行账号、抓取、下载或安装。

## Q01｜官方事件

英文：`official release RSS central bank bitcoin policy calendar`

中文：`官方 公告 比特币 政策 发布时间 RSS`

核验目标：找到原始发布，不用转载日期当事件时间。起点：[EXT067｜Federal Reserve RSS目录](https://www.federalreserve.gov/feeds/feeds.htm)

## Q02｜统计日历

英文：`BLS release calendar timezone ICS revision`

中文：`美国 经济数据 官方 发布 日历 时区 修订`

核验目标：验证未来排期和时区。起点：[EXT068｜BLS 官方发布日历](https://www.bls.gov/schedule/2026/09_sched.htm)

## Q03｜ETF定义

英文：`bitcoin ETF shares outstanding NAV issuer daily holdings flow methodology`

中文：`比特币 ETF 净流入 份额 NAV 发行人 计算 口径`

核验目标：区分披露字段与估计流量。起点：[EXT071｜iShares IBIT发行人页面](https://www.ishares.com/us/products/333011/ishares-bitcoin-trust-etf)

## Q04｜历史修订

英文：`ALFRED vintage real time period revised historical data`

中文：`宏观 数据 初值 修订 vintage 前视偏差`

核验目标：寻找当时可见版本。起点：[EXT069｜FRED/ALFRED Real-Time Periods](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html)

## Q05｜新闻独立

英文：`news syndication original source correction retraction event clustering`

中文：`新闻 转载 原始来源 更正 辟谣 事件 聚类`

核验目标：不按域名计独立证据。起点：[EXT041｜IPTC ninjs 用户指南](https://www.iptc.org/std/ninjs/userguide/)

## Q06｜正文提取

英文：`HTML main content extraction readability trafilatura metadata dates`

中文：`网页 正文 提取 日期 误识别 表格 脚注`

核验目标：比较字段保留，不只看干净文本。起点：[EXT013｜Mozilla Readability 原始说明](https://raw.githubusercontent.com/mozilla/readability/main/README.md)

## Q07｜文档解析

英文：`document parsing financial table footnotes Docling GROBID`

中文：`PDF 财务 表格 脚注 单位 解析 开源`

核验目标：找结构保留与人工对照方法。起点：[EXT142｜Docling 当前仓库](https://github.com/docling-project/docling)

## Q08｜持续采集

英文：`RSS feed API ETag incremental failed polling Miniflux`

中文：`RSS 订阅 API 增量 失败重试 Miniflux`

核验目标：查更新与错误元数据。起点：[EXT006｜Miniflux API参考](https://miniflux.app/docs/api.html)

## Q09｜动态页面

英文：`web change monitoring selector changedetection browser resource limits`

中文：`网页 变化 监控 选择器 浏览器 资源限制`

核验目标：只对合法目标监测实质变化。起点：[EXT011｜changedetection.io 官方仓库](https://github.com/dgtlmoon/changedetection.io)

## Q10｜近重复

英文：`MinHash LSH news near duplicate false positives corrections`

中文：`新闻 近重复 MinHash LSH 误合并 更正`

核验目标：检验候选召回和误合并。起点：[EXT034｜datasketch MinHash LSH](https://ekzhu.com/datasketch/lsh.html)

## Q11｜跨语种检索

英文：`hybrid lexical dense retrieval rerank multilingual finance`

中文：`金融 中英文 混合 检索 重排 关键词`

核验目标：准确数字与语义召回分别评价。起点：[EXT037｜Sentence Transformers 检索与重排](https://sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html)

## Q12｜市场语义

英文：`exchange trade maker side liquidation bankruptcy price documentation`

中文：`交易所 主动 买卖 maker 强平 破产价 口径`

核验目标：回到原协议字段。起点：[EXT124｜Bybit allLiquidation 原始文档](https://raw.githubusercontent.com/bybit-exchange/docs/master/docs/v5/websocket/public/all-liquidation.mdx)

## Q13｜历史L2

英文：`historical L2 order book gaps replay local timestamp dataset`

中文：`历史 订单簿 L2 回放 缺口 接收时间`

核验目标：先确认数据可得性再选框架。起点：[EXT126｜Tardis Deribit历史覆盖](https://docs.tardis.dev/historical-data-details/deribit)

## Q14｜期权模型

英文：`bitcoin options implied volatility quote currency delta convention`

中文：`比特币 期权 IV 币本位 delta 报价 约定`

核验目标：避免错误模型输入。起点：[EXT125｜Deribit get_order_book](https://docs.deribit.com/api-reference/market-data/public-get_order_book)

## Q15｜链上标签

英文：`point in time exchange labels entity adjusted revisions`

中文：`链上 交易所 标签 实体 调整 历史 修订`

核验目标：识别估计与原始观测。起点：[EXT062｜Glassnode Point-in-Time 指标](https://docs.glassnode.com/data/point-in-time-metrics)

## Q16｜研究验证

英文：`financial event study overlapping windows block bootstrap`

中文：`金融 事件研究 重叠窗口 区块 bootstrap`

核验目标：明确样本单位和依赖。起点：[EXT086｜arch 时间序列Bootstrap](https://bashtage.github.io/arch/bootstrap/timeseries-bootstraps.html)

## Q17｜预测评价

英文：`forecasting benchmark temporal leakage resolved outcomes calibration`

中文：`预测 评价 时间泄漏 校准 结算 规则`

核验目标：不能用已知结果测试模型记忆。起点：[EXT090｜ForecastBench 论文v4](https://arxiv.org/html/2409.19839v4)

## Q18｜多代理反证

英文：`multi agent research ablation cost coordination shared evidence`

中文：`多代理 研究 消融 成本 同源证据 错误相关`

核验目标：寻找不支持多代理的条件。起点：[EXT085｜Anthropic 多代理研究工程](https://www.anthropic.com/engineering/multi-agent-research-system)

## Q19｜恢复副作用

英文：`durable workflow activities idempotency duplicate model calls`

中文：`持久 工作流 幂等 重试 模型 重复计费`

核验目标：检查失败时间线而非正常路径。起点：[EXT112｜Temporal Activities](https://docs.temporal.io/activities)

## Q20｜知识引用

英文：`W3C annotation text quote selector document version citation`

中文：`证据 引用 段落 定位 文档 版本`

核验目标：引用支持范围与定位分开。起点：[EXT043｜W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/)

## Q21｜工作区

英文：`FDC3 context intent research workspace linked charts`

中文：`金融 工作区 联动 图表 context intent`

核验目标：研究状态而非截图风格。起点：[EXT074｜FINOS FDC3 当前仓库](https://github.com/finos/FDC3)

## Q22｜许可变化

英文：`project license AGPL attribution SDK hosted terms`

中文：`项目 许可证 AGPL 署名 SDK 自托管 服务 条款`

核验目标：锁实际文件，不借旧记忆。起点：[EXT021｜Crawl4AI 许可证及署名条款](https://raw.githubusercontent.com/unclecode/crawl4ai/main/LICENSE)

## Q23｜新闻采购

英文：`event news API clustering corrections historical redistribution`

中文：`新闻 事件 API 历史 更正 再分发 商业`

核验目标：询证权利与退出，而非采纳宣传数字。起点：[EXT031｜Event Registry Python客户端](https://github.com/EventRegistry/event-registry-python)

## Q24｜维护反证

英文：`repository no longer maintained archived support migration`

中文：`仓库 停止维护 归档 迁移 支持`

核验目标：维护者声明优先于最后提交时间。起点：[EXT059｜BlockSci 官方仓库](https://github.com/citp/BlockSci)
