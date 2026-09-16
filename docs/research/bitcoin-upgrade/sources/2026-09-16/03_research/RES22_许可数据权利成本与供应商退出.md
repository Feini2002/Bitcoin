# RES22｜许可数据权利成本与供应商退出

研究日期：2026-09-16。本卷是独立基础研究，不要求匹配当前仓库；“建议/迁移启示”是本研究的推论，不是项目官方承诺。未运行候选代码。


## 1. 四份权利不能混成开源标签

代码许可回答软件怎样使用/修改/分发；数据条款回答内容能否取得、保存、展示和派生；模型/搜索条款回答输入与结果怎样处理；商业合同还约束账号、地域、服务和退出。开源爬虫不授予新闻全文权，免费API不自动允许收费再分发。

RSSHub、FreshRSS、Firecrawl主项目等有AGPL边界；Crawl4AI许可列署名要求；FDC3规范与参考软件许可不同。不能只凭熟悉的旧许可证印象选型。[EXT002｜RSSHub 当前许可证](https://raw.githubusercontent.com/DIYgod/RSSHub/master/LICENSE) [EXT010｜FreshRSS 许可证](https://raw.githubusercontent.com/FreshRSS/FreshRSS/edge/LICENSE.txt) [EXT024｜Firecrawl 主项目许可证](https://raw.githubusercontent.com/firecrawl/firecrawl/main/LICENSE) [EXT021｜Crawl4AI 许可证及署名条款](https://raw.githubusercontent.com/unclecode/crawl4ai/main/LICENSE) [EXT074｜FINOS FDC3 当前仓库](https://github.com/finos/FDC3)

## 2. 数据派生不是万能豁免

来源原始数值、抽取主张、摘要、向量、图表和模型结果可能分别受约束。Coinbase数据条款涉及对外分析/研究等衍生作品，Coin Metrics Community有NC限制，Tardis区分供应商数据及独立直采数据等用途。具体适用合同需核实，本库不代替法律结论。[EXT127｜Coinbase 市场数据条款](https://www.coinbase.com/en-nl/legal/market_data) [EXT063｜Coin Metrics Community](https://docs.coinmetrics.io/packages/coin-metrics-community-data) [EXT066｜Tardis 服务条款](https://docs.tardis.dev/legal/terms-of-service)

不能通过换库、转发第三方API或只保留摘要就自动消除原权利。政策记录至少列internal_display、public_display、store_raw、store_derived、model_input、export、retention及证据日期，unknown不得自动等同allowed。

## 3. Google Search Grounding单独处理

当前条款对Grounded Results及相关链接的保存和二次使用有专门限定与例外，不能默认用于通用索引、训练或作为爬取目标列表。普通生成和独立获准来源是另一条路径。应将发现与可归档证据渠道分开，不尝试以重新抓取受限链接“洗掉”限制。[EXT128｜Gemini API附加条款](https://ai.google.dev/gemini-api/terms)

这不等于认定现有系统违反合同，也不等于所有结果绝对不能保存；需要查实际服务、付费状态、应用用途和适用条款。明确失败状态比擅自作法务判断更合适。

## 4. 成本采用统一任务口径

成本包含数据订阅、查询、搜索、模型输入/输出、重排/嵌入、存储/请求、网络、日志、重试、研发和人工维护。按每个“可用独立事件”“获证简报”“有效研究问题”计算，比每千token更接近价值。

商业服务可能昂贵但节省持续清洗维护；自托管可能便宜但占据时间。没有真实事件率与需求时不承诺月费。免费额度和价格随版本/地区/合同变化，只作为核验入口，不写永久保证。

## 5. 退出机制

采购前确定合同结束后能保留哪些历史、衍生结果和报告；能否导出、怎样删除、用户旧链接如何显示不可恢复、索引/缓存如何撤销。库替换也需能导出稳定业务身份，而不是把所有内部event_id绑定供应商ID。

本资料包保留原创总结与来源链接，不打包第三方全文或未知授权代码。研究卡不意味着使用权已获批；下载和安装仍属于后续独立实施动作。


## 证据与进一步核验

[EXT002｜RSSHub 当前许可证](https://raw.githubusercontent.com/DIYgod/RSSHub/master/LICENSE) [EXT021｜Crawl4AI 许可证及署名条款](https://raw.githubusercontent.com/unclecode/crawl4ai/main/LICENSE) [EXT074｜FINOS FDC3 当前仓库](https://github.com/finos/FDC3) [EXT127｜Coinbase 市场数据条款](https://www.coinbase.com/en-nl/legal/market_data) [EXT063｜Coin Metrics Community](https://docs.coinmetrics.io/packages/coin-metrics-community-data) [EXT066｜Tardis 服务条款](https://docs.tardis.dev/legal/terms-of-service) [EXT128｜Gemini API附加条款](https://ai.google.dev/gemini-api/terms)

