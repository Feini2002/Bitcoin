# RES05｜多语言检索与研究上下文

研究日期：2026-09-16。本卷是独立基础研究，不要求匹配当前仓库；“建议/迁移启示”是本研究的推论，不是项目官方承诺。未运行候选代码。


## 1. 检索应证明找到的是正确版本

研究助手不只要召回主题相近内容，还要在正确语言、时间、权限与证据层次内查找。用户问“当时市场知道什么”时，最新文章即使最相关也可能不能使用。检索必须接受`as_of`与用途条件，不能生成后再靠提示词剔除未来信息。

SQLite FTS5提供词法检索；Sentence Transformers示例区分召回与重排；SearXNG聚合外部搜索。这三者分别服务本地词法、语义排序和外部发现，不等于三个独立事实源。[EXT039｜SQLite FTS5 官方文档](https://www.sqlite.org/fts5.html) [EXT037｜Sentence Transformers 检索与重排](https://sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html) [EXT026｜SearXNG Search API](https://docs.searxng.org/dev/search_api.html)

## 2. 推荐的检索层次

先用规范实体/合约/指标别名和日期过滤；词法召回负责准确金额、代码与术语；语义召回负责同义和跨语言；重排缩小阅读集合；最终证据校验判断是否支持主张。不要用余弦相似度替代最后一步。

保存原文及允许的译文版本。翻译可以辅助检索，但引用必须回到原文定位，尤其是否定、数量级、计划/完成、预计/确认。中英文同稿不是两份独立来源。查询重写需保留原始问题、扩展词和过滤条件，防止“为什么下跌”被改写成只寻找利空。

## 3. 证据包的构造

最小材料包包括问题、时间模式、已知事实、来源与版本、支持/反驳关系、缺失和允许工具。不把整个资料库塞给模型，也不只给一份已经抹平分歧的摘要。对于大文档，提供相关段落加文档身份，必要时可受控读取上下文；摘要不得成为唯一权威副本。

本地资料库中的工具卡、论文和技术文章属于方法层；市场新闻属于事件层；用户旧观点属于历史判断层。检索时先选层，不让一篇解释CVD的教程被当成当前BTC买量证据。

## 4. 搜索与留存权利

Google Search Grounding有专门使用条件，不能默认作为构建长期索引或爬取目标列表的入口；普通模型生成和独立获准抓取必须分开。具体合同适用和条款例外要核对，不能把所有结果都说成绝对不得保存。[EXT128｜Gemini API附加条款](https://ai.google.dev/gemini-api/terms)

长期研究库应依赖可独立授权的来源登记与采集，而不是先把受限结果抽成事实再假定已脱离限制。索引向量、摘要和缓存也属于用途审查范围，删除原文时需要关联清理或限制访问。

## 5. 实验设计

测试集按任务分为准确数字查找、跨语种同义、反证定位、旧版恢复、相似事件区分和证据不足。比较词法、语义、混合三条路径的召回、错误版本、权利违规和总成本；不以生成答案的流畅度评价检索。

没有召回结果时返回未找到，不转用模型记忆当检索成功。需要扩大范围时明确记录时间或来源范围变化，并生成新输入版本。检索质量合格之后，才值得比较复杂RAG平台。


## 证据与进一步核验

[EXT039｜SQLite FTS5 官方文档](https://www.sqlite.org/fts5.html) [EXT037｜Sentence Transformers 检索与重排](https://sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html) [EXT026｜SearXNG Search API](https://docs.searxng.org/dev/search_api.html) [EXT128｜Gemini API附加条款](https://ai.google.dev/gemini-api/terms)

