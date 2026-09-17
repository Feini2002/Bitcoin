> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# 收集能力手册｜从发现来源到可检索证据

本手册是新增设计，不是已运行的采集器。它独立于Cloudflare与JavaScript，允许直接依赖、独立服务、API或只借模型。原方案已有事件与证据对象优先复用，具体映射见本目录04。

## 1. 目标与非目标

目标是持续取得对研究问题有用的材料、降低重复阅读、捕获更正与失效、让模型能回到可核查版本。非目标是镜像全网、绕过限制、长期保存一切、用文章数量证明覆盖、用热度预测价格。

收集层既服务“发生了什么”的持续更新，也服务“这个说法能否核对”的按需调查。持续流和主动搜索必须共享来源身份与权利，但不能共用一个没有截止点的无限任务。

## 2. 六个职责模块

| 职责 | 输入 | 输出 | 唯一责任与失败边界 |
|---|---|---|---|
| 来源发现 | 研究问题、现有盲区、官方目录/人工提名 | 候选来源与缺口说明 | 不自动启用抓取，不把搜索命中当已读 |
| 来源登记 | 取得方式、字段、用途证据、更新规律 | 可按特定用途启用的SourcePolicy | unknown不能自动许可；不是法律自动推理器 |
| 调度获取 | 来源、游标、预算、请求边界 | FetchAttempt、响应元数据、获准资源 | 限流、拒绝、解析变化分别报告 |
| 内容版本 | 资源与提取器 | 文档版本、结构、定位、时间精度 | 不用摘要覆盖原文，不靠标题补正文 |
| 事件证据 | 文档/结构化观察、既有候选 | 主张、关系、事件版本与冲突 | 合并可逆，模型只建议不直接永久删 |
| 检索与分发 | 问题、时间、权限、目的 | 有支持范围的证据与未决项 | 当前判断排除不适用或撤回材料；获准私有历史审计可读取当时版本并另附今天已知更正，不把相关性当真伪 |

模块可以是现有进程中的函数，不要求六个服务。信息日志与业务事实分开：一次HTTP成功只是获取层结果，不能自动标为研究事实已确认。

## 3. 来源策略与发现规则

官方机构、交易所、发行人、自有标注、专业研究、媒体采访、聚合与社媒各有作用。按当前主张判断“原始来源”而不是按域名统一打分：发行人能证明其披露了什么，未必证明披露充分；独立研究可以提出反证，但需查方法和样本。

每个候选列一个它能填补的缺口。若只是另一家转发同一公告，不算新增独立信息。候选范围可全球，但本次run按研究问题限制主题、语言、时间和调用。无关AI/GitHub资讯可以独立保留工程频道，不默认写入BTC模型上下文。

已有权威目录可直接发现feed/API：Fed的订阅目录、BLS排期、SEC接口等。没有接口时先查结构化发布格式，再比较RSSHub/阅读器/网页监控，不因某项目热门就先部署。[EXT067｜Federal Reserve RSS目录](https://www.federalreserve.gov/feeds/feeds.htm) [EXT068｜BLS 官方发布日历](https://www.bls.gov/schedule/2026/09_sched.htm) [EXT070｜SEC EDGAR数据API](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) [EXT001｜RSSHub 官方仓库](https://github.com/DIYgod/RSSHub) [EXT006｜Miniflux API参考](https://miniflux.app/docs/api.html)

## 4. 请求与网络边界

请求参数由后端来源登记映射，不让模型提供任意内网URL。验证初始地址、跳转后的地址与DNS/IP策略；阻止私网、环回、元数据服务和未允许协议，限制重定向、响应大小、并发、压缩展开及下载类型。外部页面中的指令不进入系统工具权限。

条件请求保存ETag/Last-Modified，304表示对应表示未改；200为空要先校验结构再认定无记录。429采用来源建议/有界退避并暂停相应任务，不能换身份或代理规避。403、登录要求和反自动化挑战归访问限制，不自动升级到隐蔽抓取。

游标只在产物校验与持久化后前进。页间插入、迟到、更正需要回看或变更机制；稳定URL可能反复改写，不能只按URL去重。页面变化监控可用changedetection.io，但模型判断变更金融意义仍独立。[EXT011｜changedetection.io 官方仓库](https://github.com/dgtlmoon/changedetection.io) [EXT084｜dlt 增量游标文档](https://dlthub.com/docs/general-usage/incremental/cursor)

## 5. 结构化与文档处理

优先API/CSV/XML/原生HTML；一般正文用Readability/Trafilatura，复杂网页再评浏览器；PDF/论文/披露按Docling、GROBID或Unstructured的目标适配。工具只做转换，不证明内容正确。[EXT013｜Mozilla Readability 原始说明](https://raw.githubusercontent.com/mozilla/readability/main/README.md) [EXT015｜Trafilatura Python用法](https://trafilatura.readthedocs.io/en/latest/usage-python.html) [EXT142｜Docling 当前仓库](https://github.com/docling-project/docling) [EXT144｜GROBID 当前仓库](https://github.com/grobidOrg/grobid) [EXT146｜Unstructured 开源库](https://github.com/Unstructured-IO/unstructured)

原始数字、单位、限定词、否定和计划/完成状态需保留。正文清洗版本写入文档身份，不能用变化的字符偏移定位未版本化文本。表格的行列头、脚注和计价单位必须与数值一起进入主张；无法可靠读取则metadata_only或partial，不生成完整结论。

不默认OCR全部文档。先采用可用原生文本/结构，只有确有扫描或无文本问题再进入OCR，关键数字保留人工/独立校验。OCR概率不等于金融可信度。

## 6. 主张抽取与去重

精确URL/哈希去重、词面近重复、语义事件归并是不同阶段。事件归并保留新进展、辟谣、更正和不同观点；转载关系与支持关系分开。datasketch只缩小候选，语义检索只帮助相关性，不能直接把候选标为同一事实。[EXT034｜datasketch MinHash LSH](https://ekzhu.com/datasketch/lsh.html) [EXT037｜Sentence Transformers 检索与重排](https://sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html) [EXT102｜Feedly 主题事件聚类](https://docs.feedly.com/article/552-what-is-clustering)

主张建议字段：主体、动作/关系、对象、时间/期间、数值和单位、模态、极性、出处/定位、根源关系、抽取器版本及未决事项。模型不能填补来源没有的人物、金额、日期和因果。

冲突不是必须强行消除的坏状态。若官方值与汇总不同，先检查口径、时间与修订；无法确定就并列并解释影响，不让“首席”投票决定真值。

## 7. 持久存储与检索

库中分方法文献、实时事件与观点历史三类namespace。原始资源、文章版本、主张版本、事件索引和查询缓存各有保留政策。检索先按用途/时间/来源过滤，再做词法或语义；查询结果指向稳定文档版本与证据定位。

小规模FTS/关键词路径可作为基线；跨语种召回/重排有真实需求再引入Sentence Transformers；向量量大或服务化明确后再比较Qdrant。不要把“有RAG”作为验收，更不能只用模型摘要替代所有证据。[EXT039｜SQLite FTS5 官方文档](https://www.sqlite.org/fts5.html) [EXT037｜Sentence Transformers 检索与重排](https://sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html) [EXT149｜Qdrant 混合查询](https://qdrant.tech/documentation/search/hybrid-queries/)

## 8. 更正、撤回与删除

更正生成新版本并建立corrects关系；撤回标记原主张已撤回；权利收回则限制对应用途，并清理受控范围内需删除的原文、嵌入、缓存和服务器导出；已被第三方下载的副本无法保证远程召回，应记录分发与更正边界。旧报告尽可能保留合法元数据与修正说明，不静默重写，也不以审计名义违反删除约束。

每次变更生成受影响产物清单：哪些事件、bundle、报告、搜索索引和页面引用了该版本。无需每次自动重算所有报告，但必须可发现影响。恢复等级随实际可用资料变化，无法完全恢复应显式说明。

## 9. 与LLM分析的接口

分析层接收有截止点的证据包，不直接读取无限latest。它可以请求一个具体缺口，程序验证来源/用途/预算后执行，新增证据形成child bundle，不修改已封存base。没有证据就返回未找到；不同关键词搜同一根源不算多次独立核验。

Google Search Grounding输出与独立可归档证据路径保持隔离，按实际条款和用途处理，不利用其链接构建受限制的爬取目标库。[EXT128｜Gemini API附加条款](https://ai.google.dev/gemini-api/terms)

## 10. 成本控制与退化

基础订阅可不调用模型；精确重复不重复抽取；只有实质新内容/模糊主张进入模型；重排和深研有独立上限但共享根预算。价格未知或预算未配置时，允许只展示元数据、确定性变化与缺失，而不是假定零成本。

源失效只降级受影响主题；一个商业服务拒绝不应关闭所有研究功能。采集成功率、正文可用率、关键事件覆盖、实质更新率、每个独立事件费用和人工维护时间分别测量。

## 11. 最小部署对照

- 现有任务＋官方源：最少新增服务，适合有限来源。
- 订阅中枢＋薄研究适配：Miniflux/FreshRSS等管理来源与人工阅读，研究库保留自己版本。
- 专门采集/文档服务：复杂异构材料较多时按批处理或独立服务；不与浏览器页面打开绑定。
- 商业新闻/数据API：减少维护但需样本/授权/退出；供应商聚类不能自动成为内部真值。

这里没有统一推荐必须哪一种。先以两个来源、一项事件与一份报告跑闭环，数据/内容质量改善成立后再扩，不用几十个API数量证明进展。
