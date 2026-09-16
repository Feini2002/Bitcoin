# 收集生命周期与最小契约

本节字段是拟议设计，应映射原卷10及真实schema；不要求建立平行数据库。本目录JSON Schema仅校验补充对象，不替代完整业务校验。

## 1. 对象映射

| 补充对象 | 字段责任 | 与原方案关系 |
|---|---|---|
| SourceCandidate | 发现入口、用途问题、核验状态、未确认事项 | 研究资料库提名，不是已批准SourcePolicy |
| SourceRegistration | 运行端点、身份、用途、限额、调度和owner | 扩展/复用原SourcePolicy及来源配置 |
| CollectionAttempt | 请求窗口、游标、HTTP/解析状态、失败、预算与计数 | 可映射原run/step或采集日志，不混同报告run |
| ResourceVersion | 响应/内容身份、取得时间、发布时间精度、提取版本、权利 | 映射原ArticleVersion/Artifact，不另造事实真值 |
| ClaimCandidate | 极性、模态、数值、定位、状态和缺失 | 映射原主张对象；不是自动confirmed |
| CoverageReport | 必需来源健康、事件范围、已知缺口、允许静默结论 | 给原bundle/data_limitations使用 |

## 2. 状态与转移

候选来源：reference_candidate_only→examined→pilot_eligible，或paused/rejected。SourceCandidate始终enabled=false；获得实际端点、用途、网络与费用限制后另建SourceRegistration，才可能configured→active。候选资格不是激活权限，unknown只限制相应用途。

采集尝试：queued→fetching→received→validated→persisted→indexed；终态可unchanged、partial、failed、denied、cancelled。`received`不等于内容有效，`indexed`不等于事实正确。索引失败不能回退游标导致重复写入，应支持幂等重建。

文档版本：metadata_only/parsed/partial→superseded或retracted；rights_restricted独立于内容真伪。删除操作按政策影响原文、摘要、嵌入、缓存和导出；保留合法tombstone表明旧引用为什么无法恢复。

主张：extracted→reviewed/unsupported/conflicted；支持关系只能指向允许且实际读取的定位。模型不得通过改status自授确认。

## 3. 时间

source_published_at可空且带精度；first_seen_at是本系统第一次发现该资源（不是所有未来版本首次可见）；fetched_at是真实取得时间；ingested_at是写入；source_updated_at和版本关系表示更正。不能把一者缺失用另一者填上而不记录推断。

统一时间模式为system_observed / publicly_available / retrospective_latest。system_observed要求本次ResourceVersion的version_observed_at不晚于截止，而不是仅检查URL首次出现时间。publicly_available需要当时正文版本与可信发布时间依据；旧发布时间不能证明当前已更正正文当时存在。retrospective_latest明确使用事后版本。日期级时间保留YYYY-MM-DD，不伪造午夜。

## 4. 幂等与内容身份

资源键采用source＋来源对象ID/规范URL＋版本或规范内容摘要，仍保留原URL。URL规范化只删除已确认跟踪参数，不能任意删查询参数改变页面语义。source_content_digest针对允许保存的来源内容字节，extraction_digest针对固定提取输出；提取器改变不冒充来源发布了新版本。source_revision_id与version_observed_at记录观察时序；源改正文但发布时间未变时仍新增观测版本。A→B→A回退可复用A内容对象，但必须保留第二次回到A的观察/头指针事件。

采集attempt_id与resource_version_id不同：多次抓到同一版本只增加尝试日志，不重复文章；同URL新版本必须保留。队列至少一次投递条件下，persist和索引都有幂等键。

## 5. 拟议API职责

以下仅建议，不声称仓库已有这些路由。实际命名绑定后更新原OpenAPI，而不是运行两个同义API。

|操作|方法/示例路径|语义|
|---|---|---|
|发现候选|POST /research/source-candidates|写入候选，不启用网络|
|查询目录|GET /research/source-candidates|按主题、证据状态、用途过滤|
|登记来源|POST /research/sources|校验运行端点、owner、用途与预算|
|触发有限采集|POST /research/collection-runs|幂等请求，明确范围与上限|
|查看采集|GET /research/collection-runs/{id}|失败/覆盖/费用与产物引用|
|查看文档版本|GET /research/resources/{id}/versions|严格用途过滤，不无条件返回全文|
|证据查询|POST /research/evidence/search|query、cutoff、purpose、language、source_scope|
|建议关系|POST /research/claims/relations|候选合并/更正，非永久删记录|
|撤回或更正|POST /research/resources/{id}/status-events|append事件，不篡改原历史|
|覆盖检查|GET /research/coverage|必需源、时间窗、缺口、静默结论资格|

写接口需要现有认证/防CSRF等策略；公开网站不把管理员登记与采集触发暴露成匿名接口。模型工具使用source_id/resource_key，不直接调用任意URL接口。

## 6. 缓存和导出

查询缓存含用户/用途、policy版本、cutoff、索引/方法版本、retraction_view和筛选。数据撤回或权限变化要失效，不能只按query缓存。导出携带来源、版本、时间模式与质量；受限内容不因下载Markdown而绕过展示规则。

## 7. 事务边界

先落资源与manifest，再推进游标；索引是可重建投影。报告读取封存bundle，不读未完成采集事务。批次部分成功时保存每源状态，允许有限结果但不假装整批完整。具体数据库事务能力要在真实部署核验，不能用一个“atomic”字段假称跨API原子。


## 8. 当前机器契约

collection.schema.design.json为v2-design；根oneOf只接受声明object_type的七类对象，UseDecisions是内部共用定义。record_origin必须区分synthetic/observed/imported。样例JSON的键是类型名，值才是可供根Schema校验的对象，不能将整本样例字典作为一个运行请求。

CoverageReport使用required_sources和usable_sources，后者表示满足该面板窗口/解析/新鲜度要求，不等于HTTP收到。quiet_result_allowed需要非空必需源、comparison_available及usable覆盖；动态集合、过期和真正是否有变化由域校验。已收数据不证明全网覆盖。

RetrievalRequest采用统一用途display_private/send_to_model/display_public/export。as_of_with_current_notice及audit_history仅用于获准私有历史审阅，默认不进入普通模型输入。当前权利与历史可见性分别检查。

SourceRegistration中的approved_operations和policy版本需要服务端真实确认；仅通过JSON格式并不自动批准网络、费用或保存。所有API沿原/research/v2研究域的实际挂接统一，不另起一个同义公共入口。


ResourceVersion→Article的完整字段映射见../10_final_review/contract_migration.md；date精度不包装成午夜timestamp。version_observation_key用于幂等观察，content digest用于内容一致性，两者不可互换。
