> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# RES03｜网页提取与浏览器采集

研究日期：2026-09-16。本卷是独立基础研究，不要求匹配当前仓库；“建议/迁移启示”是本研究的推论，不是项目官方承诺。未运行候选代码。


## 1. 从获取难度而非项目热度选工具

结构化API可用时，不先调用浏览器。静态HTML可读时，不先使用需要模型的抓取。只有真实页面依赖脚本且获取用途允许，才考虑浏览器自动化。这个顺序减少资源和攻击面，不是断言所有简单提取器准确率更高。

Readability明确只提取正文，不是HTML净化器；Trafilatura提供正文/元数据提取；Scrapy提供爬取和持久任务机制；Crawl4AI/Firecrawl则覆盖更完整的抓取与内容处理。各自职责需要区分。[EXT013｜Mozilla Readability 原始说明](https://raw.githubusercontent.com/mozilla/readability/main/README.md) [EXT015｜Trafilatura Python用法](https://trafilatura.readthedocs.io/en/latest/usage-python.html) [EXT018｜Scrapy 持久任务](https://docs.scrapy.org/en/latest/topics/jobs.html) [EXT020｜Crawl4AI 官方仓库](https://github.com/unclecode/crawl4ai) [EXT023｜Firecrawl 自托管文档](https://docs.firecrawl.dev/contributing/self-host)

## 2. 文章不是一个字符串

采集产物建议同时记录响应元数据、原始URL与规范URL、取得时间、提取器版本、标题、正文语言、作者候选、发布时间及其来源。正文哈希基于明确规范化规则；不能把广告变化当新闻更新，也不能为稳定哈希而删掉否定句、表格单位或脚注。

标题时间常由站点模板推断，只能标候选。PDF、图表或图片中的数字不可由HTML正文空白自动补足；缺少可合法、可靠解析的内容就保留定位和未知。完整文章、摘录和链接元数据需要不同存储政策。

## 3. 抽取器对照该看什么

设计样本包含公告、更正、表格、转载、长篇分析、多语言和访问拒绝。人工标注应保留的主体句、否定词、数字单位和原始链接。比较正文召回、模板残留、错误发布日期和关键语义丢失，而不是只比较输出字符数。

同一页面提取失败时，回退不能从“正文为空”变成“让模型根据标题写摘要”。应返回`metadata_only`、`extraction_failed`或`access_denied`，禁止这类产物进入已核事实池。模型可以解释当前材料不足，但不能补写未读内容。

## 4. 动态浏览器的成本与安全

浏览器实例、页面、下载、请求监听和超时都需释放；取消任务后要验证后台仍否在执行。限制并发、页面字节、跳转、访问域、私网目标及附件类型，外部页面脚本不能得到内部凭据。反机器人挑战或登录墙不意味着可自动绕过。

Scrapy的JOBDIR可以保存队列/状态，但恢复时cookies、会话、源内容与解析版本可能已经改变；恢复流程须验证这些条件，而不是以“任务恢复了”宣称所有结果与原时点一致。[EXT018｜Scrapy 持久任务](https://docs.scrapy.org/en/latest/topics/jobs.html)

## 5. 自托管与商业抓取

Firecrawl云服务与自托管能力不是自动等价；SDK、主项目和服务条款分开。Crawl4AI许可包含署名相关段落，不能只看到Apache字样就忽略附加内容。两者的获取便利也不创造原站内容授权。[EXT023｜Firecrawl 自托管文档](https://docs.firecrawl.dev/contributing/self-host) [EXT024｜Firecrawl 主项目许可证](https://raw.githubusercontent.com/firecrawl/firecrawl/main/LICENSE) [EXT021｜Crawl4AI 许可证及署名条款](https://raw.githubusercontent.com/unclecode/crawl4ai/main/LICENSE)

适合购买的情形是合法来源的复杂提取维护持续占用人力、供应商样本表现和合同边界明确。适合自建的情形是来源有限、接口稳定且需要严格控制内容流向。先算每个可用独立事件的成本，别只算一次请求价格。


## 证据与进一步核验

[EXT013｜Mozilla Readability 原始说明](https://raw.githubusercontent.com/mozilla/readability/main/README.md) [EXT015｜Trafilatura Python用法](https://trafilatura.readthedocs.io/en/latest/usage-python.html) [EXT018｜Scrapy 持久任务](https://docs.scrapy.org/en/latest/topics/jobs.html) [EXT023｜Firecrawl 自托管文档](https://docs.firecrawl.dev/contributing/self-host) [EXT021｜Crawl4AI 许可证及署名条款](https://raw.githubusercontent.com/unclecode/crawl4ai/main/LICENSE)

