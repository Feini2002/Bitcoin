# 按问题查资料

[返回总纲](README.md) · [查现有代码](REPOSITORY_MAP.md)

日常定位优先用[功能查询](QUICK_ROUTER.md)；本页供浏览完整主题。K线显示、历史/周期和指标已有独立路由，不再只归入下面的“行情”大类。

这里的“路由”是文档导航，不是网站新页面或运行时路由。先读与当前问题有关的行，再沿原文查细节；不需要把 219 个文件全部读完才处理一个小问题。

## 主题路由

| 想解决的问题 | 设计原文 | 深入研究与案例 | 仓库定位 |
| --- | --- | --- | --- |
| 按第二批主线连续开发 | [执行总任务](batch2-execution/EXECUTION_MASTER.md)、[执行日志](batch2-execution/EXECUTION_LOG.md) | 第一批专题仍按本表查阅，不另开第二套 WP/SLICE | [功能定位入口](QUICK_ROUTER.md) |
| 分数、置信度、缺失值是否误导；简报如何表达变化与未知 | [卷05 分析方法](sources/2026-09-16/01_accepted_plan/volumes/05_analysis_methods_and_scenarios.md)、[价值对照](sources/2026-09-16/10_final_review/value_and_decision_tests.md) | [RES14 观点与校准](sources/2026-09-16/03_research/RES14_预测校准观点与决策记录.md)、[RES24 降噪评价](sources/2026-09-16/03_research/RES24_信息价值覆盖与降噪评价.md) | [舆情分析](REPOSITORY_MAP.md#analysis) |
| 日报应该保留哪些内容；如何减少转载、无关资讯并保留反证 | [卷03 产品与信息](sources/2026-09-16/01_accepted_plan/volumes/03_product_information_and_noise.md)、[收集手册](sources/2026-09-16/06_collection_design/01_collection_handbook.md) | [RES04 归并与更正](sources/2026-09-16/03_research/RES04_事件主张去重与更正.md)、[CASE02 去重与聚类](sources/2026-09-16/05_cases/CASE02_Feedly去重与聚类不是同一层.md) | [事件日报](REPOSITORY_MAP.md#events) |
| 补来源、订阅、正文提取、论文披露与检索 | [来源目录](sources/2026-09-16/06_collection_design/02_source_catalog.md)、[生命周期](sources/2026-09-16/06_collection_design/03_lifecycle_and_contract.md)、[搜索配方](sources/2026-09-16/06_collection_design/05_search_recipes.md) | [RES02 订阅](sources/2026-09-16/03_research/RES02_持续订阅与来源发现.md)、[RES03 网页提取](sources/2026-09-16/03_research/RES03_网页提取与浏览器采集.md)、[RES05 检索](sources/2026-09-16/03_research/RES05_多语言检索与研究上下文.md)、[RES25 复杂文档](sources/2026-09-16/03_research/RES25_论文披露与复杂文档摄取.md) | [事实池与采集](REPOSITORY_MAP.md#collection) |
| 对齐行情来源、时间窗口、足迹、强平数量和价格语义 | [卷04 市场数据](sources/2026-09-16/01_accepted_plan/volumes/04_market_data_contracts.md) | [RES06 行情标准化](sources/2026-09-16/03_research/RES06_实时行情采集与标准化.md)、[RES07 回补与修订](sources/2026-09-16/03_research/RES07_历史回补时点与数据修订.md)、[RES08 订单流](sources/2026-09-16/03_research/RES08_订单流足迹与盘口研究.md)、[RES09 衍生品](sources/2026-09-16/03_research/RES09_资金费持仓基差与强平.md) | [行情与市场快照](REPOSITORY_MAP.md#market) |
| 报告输入一致、版本身份、证据入口与旧报告恢复 | [卷10 数据/API契约](sources/2026-09-16/01_accepted_plan/volumes/10_api_schema_and_state_contracts.md)、[终审契约迁移](sources/2026-09-16/10_final_review/contract_migration.md) | [RES19 证据生命周期](sources/2026-09-16/03_research/RES19_研究知识库与证据生命周期.md)、[CASE04 证据模型](sources/2026-09-16/05_cases/CASE04_IPTC与W3C给证据模型的启示.md) | [输入、存储与历史](REPOSITORY_MAP.md#evidence) |
| 提示词、模型上下文、流式报告、失败与调用费用 | [卷07 LLM工作流](sources/2026-09-16/01_accepted_plan/volumes/07_llm_prompts_workflows.md)、[卷14 端到端案例](sources/2026-09-16/01_accepted_plan/volumes/14_end_to_end_examples_and_handoff.md) | [RES16 模型与多代理边界](sources/2026-09-16/03_research/RES16_模型工具与多代理的适用边界.md)、[RES17 报告评价](sources/2026-09-16/03_research/RES17_报告质量评价与可观测性.md) | [云端模型与设置](REPOSITORY_MAP.md#llm) |
| 官方日历、宏观历史版本、ETF、期权、稳定币或链上研究 | [卷06 专题能力](sources/2026-09-16/01_accepted_plan/volumes/06_catalysts_macro_etf_options.md) | [RES10 期权](sources/2026-09-16/03_research/RES10_期权研究与波动率结构.md)、[RES11 链上](sources/2026-09-16/03_research/RES11_链上矿工与实体资金流.md)、[RES12 宏观ETF](sources/2026-09-16/03_research/RES12_宏观ETF稳定币与跨资产.md)、[CASE05 双时钟](sources/2026-09-16/05_cases/CASE05_官方日历与vintage的双时钟.md) | [条件扩展](REPOSITORY_MAP.md#extensions) |
| 跨页面研究现场、笔记、观点复盘与预警 | [卷08 工作区](sources/2026-09-16/01_accepted_plan/volumes/08_workspace_views_and_alerts.md) | [RES18 研究现场](sources/2026-09-16/03_research/RES18_金融工作区与研究现场.md)、[CASE11 FDC3](sources/2026-09-16/05_cases/CASE11_FDC3工作区上下文迁移.md) | [页面与共享状态](REPOSITORY_MAP.md#workspace) |
| 是否需要独立服务、批处理、换存储或调整调度 | [卷09 架构与运行](sources/2026-09-16/01_accepted_plan/volumes/09_architecture_runtime_and_storage.md)、[卷12 迁移与回退](sources/2026-09-16/01_accepted_plan/volumes/12_migration_operations_and_rollback.md) | [RES20 存储计算](sources/2026-09-16/03_research/RES20_存储计算与部署路线.md)、[RES21 调度恢复](sources/2026-09-16/03_research/RES21_增量管道调度与失败恢复.md) | [运行与发布](REPOSITORY_MAP.md#runtime) |
| 如何证明升级有用；怎么比较旧/新输入与模板/模型 | [卷11 评价体系](sources/2026-09-16/01_accepted_plan/volumes/11_evaluation_and_acceptance.md)、[价值对照](sources/2026-09-16/10_final_review/value_and_decision_tests.md) | [RES13 可复现研究](sources/2026-09-16/03_research/RES13_因子事件研究与可复现验证.md)、[CASE10 实验纪律](sources/2026-09-16/05_cases/CASE10_Qlib与arch如何服务实验纪律.md) | [验证入口](REPOSITORY_MAP.md#validation) |
| 复用什么、购买什么、哪些平台只借鉴设计 | [卷02 研究与决策](sources/2026-09-16/01_accepted_plan/volumes/02_external_research_and_decisions.md)、[67张复用卡](sources/2026-09-16/04_reuse_cards/README.md) | [RES01 能力地图](sources/2026-09-16/03_research/RES01_能力地图与复用决策.md)、[RES15 平台经验](sources/2026-09-16/03_research/RES15_完整金融平台的可迁移经验.md)、[RES22 权利与退出](sources/2026-09-16/03_research/RES22_许可数据权利成本与供应商退出.md)、[RES23 自建采购](sources/2026-09-16/03_research/RES23_完整能力组合与自建采购对照.md) | [先核已有能力](REPOSITORY_MAP.md) |

## 按资料类型查找

| 资料类型 | 精确入口 | 注意其身份 |
| --- | --- | --- |
| 完整设计、剩余问题与术语 | [16卷索引](sources/2026-09-16/01_accepted_plan/README.md)、[卷15](sources/2026-09-16/01_accepted_plan/volumes/15_sources_glossary_and_open_questions.md) | 卷00/01帮助回查设计与调查基线，不能代替当前源码 |
| 专题和案例 | [25个专题](sources/2026-09-16/03_research/README.md)、[14个案例](sources/2026-09-16/05_cases/README.md) | 研究素材；不等于接入或安装任务 |
| 数据结构、API、SQL、设置草案 | [contracts](sources/2026-09-16/01_accepted_plan/contracts/README.md)、[采集对齐说明](sources/2026-09-16/06_collection_design/04_alignment_with_accepted_contracts.md) | SQL留在资料目录，未进入cloudflare迁移目录；Schema未成为运行依赖 |
| 合成样例及预期行为 | [fixtures](sources/2026-09-16/01_accepted_plan/fixtures/README.md)、[采集验收](sources/2026-09-16/06_collection_design/06_evaluation_and_fixtures.md) | 测试设计，不是已经通过的仓库测试 |
| 小范围任务及完整工作包 | [F任务](sources/2026-09-16/10_final_review/scoped_work_packages.md)、[卷13 WP规格](sources/2026-09-16/01_accepted_plan/volumes/13_implementation_work_packages.md)、[原WP机器索引](sources/2026-09-16/01_accepted_plan/meta/tasks.json) | 供后续选择；本次未更新其执行状态 |
| 来源、证据限制与抽核 | [来源登记](sources/2026-09-16/08_evidence/sources.md)、[访问限制](sources/2026-09-16/08_evidence/access_limits.md)、[终审外部抽核](sources/2026-09-16/10_final_review/external_rechecks.json) | 保留当时证据范围，本轮未重新访问外部网站 |
| 提示词和决策记录样式 | [Codex阅读入口](sources/2026-09-16/07_codex_usage/01_reading_and_selection.md)、[记录模板](sources/2026-09-16/07_codex_usage/04_decision_record_template.md) | 可参考表达方式，里面的指令不自动生效 |
| 旧版本与前期研究 | [前期研究](sources/2026-09-16/09_prior_research/README.md)、[包内旧档](sources/2026-09-16/90_archive/README.md)、[本次原ZIP](archives/README.md) | 用于追溯版本，不覆盖终审正文或用户当前要求 |

## 常用阅读顺序

- **先了解全貌：** 本目录总纲 → 原包当前总纲 → 16卷索引 → 按感兴趣主题阅读。
- **下一次修改一个功能：** 本页主题 → 仓库对应表中的关联链路 → 相关分卷与终审说明 → 依据当时源码选择实际范围。
- **只做选型研究：** 对应RES专题 → TOOL复用卡 → CASE案例 → 原始来源。安装和接入不属于阅读本身。
- **追查资料结论：** 原文就近引用 → 来源登记 → 访问限制/终审结果；不要把作者自检记录转写成本轮验收。
