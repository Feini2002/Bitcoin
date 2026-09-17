> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# 契约迁移与适配说明｜v2.1 / collection v2

## 1. 范围

本轮只更改拟议契约与合成示例，未对真实数据表执行ALTER，也未推断线上字段。旧对象保留原内容、版本和摘要；需要使用新约束时经过明确适配，记录来源版本和无法提供的字段。不存在的历史数据不能由默认值补成“已验证”。

## 2. 新旧映射

|旧设计|当前设计|迁移规则|
|---|---|---|
|collection根type/object+$defs|oneOf+object_type|根入口实际应用具体类型；单类型校验仍需明确$ref|
|public_available|publicly_available|只在旧输入适配器转换并记日志，当前API拒绝旧拼写|
|internal_display/public_display/model_input|display_private/display_public/send_to_model|统一用途；不能只改字段名而扩大权限|
|example_only=true强制|record_origin|旧样例只能变synthetic；真实采集由服务端设observed；导入unknown不当现场证据|
|SourceCandidate active|SourceCandidate禁用＋SourceRegistration|新登记必须有真实端点、用途、网络/限制与owner，不复制整套法律自动化服务|
|first_seen/fetched|增加version_observed_at|URL首次见与此正文版本首次见分开；旧记录未知保持null|
|include_retracted=false|retraction_view|当前判断过滤撤回；私有历史视图可选当时版本，另附当前更正，今天权限始终生效|
|observed_sources|usable_sources|不是把收到HTTP200的源直接改名；必须满足该窗口的数据/解析/新鲜度规则|
|quiet=true单独布尔|coverage/comparison/domain约束|布尔是计算结果不是客户端或模型自授资格|
|RunRequest必填预算无生成模式|generation_mode/capture_kind/knowledge_cutoff|template预算可空；model须预算；历史截止独立于市场时间|
|无编码身份的bundle摘要|canonicalization_version|旧摘要保留legacy，不重新哈希后冒称同一历史输入|
|Report缺基线/覆盖状态|initial_baseline/insufficient_coverage|流程published与结论状态不同；nochange必须有有效覆盖和比较引用|

## 3. 三种历史读取

`system_observed`：本系统当时实际见到的那个版本；看version_observed_at，不以旧URL或旧发布日期回填新正文。

`publicly_available`：依据可信原始发布时间及当时版本重建公众可得信息；现在抓到的更正版不能自动代替当时版。无法证明则降为retrospective_latest或拒绝精确历史承诺。

`retrospective_latest`：明确事后整理。历史审计的当前更正提示与“截至当时证据”分栏，前者不能进入过去的预测输入。真实数据可能已删除或受限，返回恢复等级，不用新文章伪造恢复。

## 4. 资料撤回与权限不是同一维度

retracted表示来源撤回或主张失效，restricted表示用途禁止。获准私有审计可读取已撤回材料，以研究错误为何发生；没有当前使用权仍不得读取正文。普通模型输入默认不启用audit_history；未来若确有复盘模型任务，须增加独立用途与测试，而不是用现有布尔绕过。

## 5. 哈希与内容版本

Artifact摘要针对实际保存字节；本包sample_metrics.canonical.json与其locator、长度、哈希一致。漂亮排版的sample_metrics.json是阅读副本，不再被假称同一字节对象。

Bundle的受限profile `btc-ascii-key-json-v1`只允许非空可打印ASCII键、Unicode值原样、安全整数、布尔/null/数组、金融小数字符串；不含浮点JSON数，不改变数组顺序。它不是全量JCS。完整RFC8785还规定UTF-16属性顺序及数值序列化，不能由普通排序替代。[RFC8785](https://www.rfc-editor.org/rfc/rfc8785.html)

源正文A→B→A时内容A可共享字节对象，但第二次观察到A的事件不能丢失。抽取器升级只新增提取版本，不伪造来源更新。当前参考Article表将内容摘要唯一约束改成version_observation_key唯一约束，允许A→B→A生成新的观察版本，同时底层Artifact仍可去重。重复请求必须复用同一观察key或记unchanged；不能每次轮询都生成一篇新文章。真实仓库可用已有采集日志/版本头等价承载，不要求直接照搬新增列。

## 6. Schema和域校验的分工

Schema处理类型、必需字段、枚举、简单条件；FormatChecker验证日期格式。集合包含、跨引用owner、版本时间、当前政策、窗口覆盖、是否真的没有重大变化必须由域层验证。`10_final_review/tests`是本包的离线反例演示，不是完整生产授权系统。

所有新增schema $id是标识不是网络地址，验证使用本地注册，不联网自动获取；测试脚本不安装依赖。JSON重复键、无穷数和不可解析Unicode在导入边界拒绝，不通过重序列化洗掉异常。


## 7. 收集对象到Article的准确映射

resource_id→article_id；version_id→article_version_id；version_observed_at和version_observation_key原样传递；source_published_at→published_at；published_precision统一date（旧day只在适配器转换）；extraction_digest→content_digest；source_content_digest表示另一个原始内容摘要；extractor_version→extraction_method中的显式版本标识。来源状态与当前可访问性保持独立。原始正文未获准保留时source_content_digest可空，不能为了非空约束下载受限内容。

Reference DDL已同步新增观察字段与唯一键，仅通过内存SQLite语法检查；对现有生产schema的迁移、索引和并发需开发者核验。
