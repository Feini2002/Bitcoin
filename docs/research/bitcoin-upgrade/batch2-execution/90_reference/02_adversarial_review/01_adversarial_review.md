> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# 交付前终审｜从研究价值到可执行契约

版本：final-review-1.1-design；日期：2026-09-16。审查对象是上一轮188个文件的交付包、原16卷执行材料和用户事实报告；本次改的是文档及参考契约，没有修改业务仓库。

## 结论

方案的核心业务方向仍成立，但上一版还不适合让开发者不加区分地照表执行。问题不是“缺更多热门项目”，而是几个正例自检掩盖了契约反例，叠加多套当前规范与过粗任务依赖。此次直接修订当前文本/Schema/样例/入口，而非再附一层建议。旧包原字节在[历史档案](../90_archive/README.md)。

第一性原理的审查标准是：一个输出能否帮助用户减少重要误读、识别新证据或恢复判断现场；若不能，它的指标、Agent、表、来源和文档数量都不构成价值。真实性、可用时点、适用范围、工作量和成本是约束；它们也不能被扩张为永远没有业务交付的理由。

## 实际发现和已作的文档修正

|编号|发现|类别|定位|反例或依据|当前处理|
|---|---|---|---|---|---|
|FR-01|执行权威冲突|设计一致性|00_start/01_master_solution.md；02_adversarial_review/02_scope_override_rules.md|前版一面保留原规范，一面提出改变依赖，却让每次执行再决定哪份优先。|根入口指定当前设计与历史档案；活跃正文/契约同步改，不再靠追加勘误。|
|FR-02|最小简报沿完整任务图扩张|交付范围|01_accepted_plan/meta/tasks.json；卷13 WP-013/033|WP-033有19项传递前置，包含简报未必使用的市场类别。无环不等于范围合理。|新增按五种能力profile展开的F-00—F-10切片，原WP保留为完整能力细节与部分完成映射。|
|FR-03|收集Schema根入口不施加对象定义|机器契约|06_collection_design/collection.schema.design.json 顶层|旧根只有type/object与$defs，空对象和任意对象可通过。|根oneOf引用带object_type的对象定义；使用FormatChecker验证时间，不只check_schema。|
|FR-04|时间模式和用途词汇不一致|跨层语义|原RunRequest/Bundle与收集RetrievalRequest/rights|public_available与publicly_available、model_input与send_to_model等不一致，没有唯一机器映射。|统一公开时点模式和用途字段；compatibility_map只允许有日志的旧输入转换，当前契约拒绝混拼。|
|FR-05|覆盖不足仍可取得静默资格|机器契约|CoverageReport|insufficient + quiet_result_allowed=true通过旧结构；仅HTTP成功不能证明覆盖。|结构条件、非空面板、comparison_available及集合/窗口域校验；nochange限制在声明面板。|
|FR-06|URL首次见时间不能证明修订版当时存在|时点研究|ResourceVersion；收集时间与内容身份说明|first_seen可能属于旧网页；后来改正文但原发布时间不变，旧字段不足以判该版本当时可见。|增加version_observed_at、源内容与提取摘要分离；A→B→A保留观察转移。|
|FR-07|一刀切排除撤回资料与历史复盘冲突|产品与权限|RetrievalRequest.include_retracted const false；收集手册|私有合法审计无法查看当时曾被采用而后来撤回的说法，容易幸存者偏差。|current_valid_only / as_of_with_current_notice / audit_history；历史审计默认只用于私有展示，仍应用今天的权限。|
|FR-08|示例身份写进全部运行契约|模拟与真实分界|CollectionAttempt等五个定义example_only const true；SourceCandidate|规范只允许example_only=true，不能表达真实记录；候选却可enabled=true且无端点。|record_origin区分synthetic/observed/imported；候选永不直接启用，SourceRegistration独立登记。|
|FR-09|RunRequest不能表达正文承诺的模式|机器契约|RunRequest|budget_profile_id必填字符串但正文允许无模型模板；没有独立knowledge_cutoff_at。|generation_mode独立于execution_mode；template预算可空，model不可空；historical知识截止必填。|
|FR-10|内容摘要与实际文件字节没有明确区分|复现与证据|Artifact示例；Bundle canonicalization规则|sample_artifact记录1876字节的规范内容，但locator指向2466字节的美化JSON；哈希解释不清。|locator改指实际canonical字节文件；Bundle登记受限编码profile，算法/实现版本并列。|
|FR-11|初始基线和覆盖不足没有统一报告状态|产品与API|Report.state；收集CoverageReport；方法变化检测|只在正文说首次无比较不叫突变，Report又没有initial_baseline/insufficient_coverage且nochange无引用条件。|新增两种语义结果；nochange要求coverage与comparison引用，域校验核对实际报告与面板。|
|FR-12|幂等被写成供应商费用保证|验收措辞|卷12 R1验收|“相同幂等请求不重复计费”强于系统能够保证的本地行为。|改为不重复启动本系统相同逻辑调用；外部结果未知先对账，无法约束的费用不得宣传硬封顶。|
|FR-13|新增资料数和文档通过数容易形成成熟错觉|证据等级|来源目录、旧QC与内容统计|read包括不同支持范围；旧QC与新目录共存，统计规模不是质量或当前核验状态。|保留前轮记录、逐条标本轮是否复核；旧QC归档，当前覆盖表与结果分层；不继续用体量做验收。|
|FR-14|收益归因仍需要更明确的实验分离|价值验证|卷11 B0—B5；RES24|原方案已有基线与消融，但收集升级+分析升级同时改变时容易把新增材料收益算给Agent。|明确旧/新输入×模板/模型二维对照；独立来源面板与被抑制样本复核，不用同一选中事实池充当完整真值。|
|FR-15|版本与删除的概括措辞可被误读|生命周期|新收集手册 vs 原卷12|新手册“清理导出”未重申已下载副本无法保证召回，原卷12其实已说明。|同步当前收集说明：仅保证受控存储撤销，下载副本记录分发/更正边界。|
|FR-16|分卷引用和合订本身份不一致|交付可用性|01_accepted_plan/volumes 的 #appendix-repository-facts 与旧合订本|分卷引用只存在于合订本的本地锚点；旧合订本和新正文容易分叉。|分卷链接真实事实文件；合订本重新生成；根索引/JSON/QC一起更新。|

这些是设计交付问题，不等于真实仓库已发生相同故障。结构反例的实际结果在[检查结果](../10_final_review/results/README.md)；该结果不是生产测试。

## 保留的内容，不为对抗而推翻

保留真实aggTrade足迹、已通过固定样本的强平方向映射、已有Gemini适配、当前图表基础及局部治理成果。保留观测/估计/解释/预测分层、前视偏差、来源修订、预算与反证。原卷10已经明确D1条件UPDATE为0行不自动终止batch，已经设计token守卫；本轮不把这个已处理问题再说成新发现。OpenAPI每个操作均声明认证，顶层没有security不是“所有接口匿名”的证据。

没有证据证明当前必须迁库、整站重写、全面多代理，也没有证据证明保守路线永远最好。具体任务若需要原生数值计算或长连接，应允许专用服务。用户的决策周期、费用上限、远程部署及真实模型效果仍未知。[原始事实范围](../01_accepted_plan/inputs/repository_facts.md)

## 研究范围的纠偏

保留25个专题、67个候选和14个案例作为选择库，不再扩数量。完整平台可能比自建更经济，也可能复制现有责任；每次比较至少包含一个成熟复用方案和一个沿用现有实现方案。零新依赖不是价值函数，全部上新也不是。

收集增量与分析增量可并行，但不是硬性规定每次都要新接两个来源。已有材料足够时先交付简报；确有盲区再做收集试点。双路并行不应变成新的强依赖。

## 外部核验边界

本轮抽核影响当前决定的官方规范、服务条款及软件许可，没有重访全部150条旧来源，没有安装候选或复现论文。来源登记保留原查询记录，并增加本轮targeted_rechecked/inherited_not_rechecked状态。JSON Schema模块复用须实际引用；format检查须由验证器明确启用。[Schema官方说明](https://json-schema.org/understanding-json-schema/structuring) [验证器说明](https://python-jsonschema.readthedocs.io/en/stable/validate/)

## 交付结论

可交给开发者作为“限定范围设计与核验材料”，不能以文档通过冒充上线成熟。最小切片与有条件扩展见[当前实施入口](../00_start/01_master_solution.md)，最终权威层次见根README。已发现的设计冲突在当前文件中修正；未验证的兼容性、效果、性能和权利不被补写成通过。
