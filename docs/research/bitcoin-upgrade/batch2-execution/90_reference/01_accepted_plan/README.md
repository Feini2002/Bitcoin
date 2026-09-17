> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# 比特币真实仓库全面升级执行方案｜2026-09-16

**交付状态：设计文档已完成；仓库改造、真实模型/数据调用与生产部署未执行。**

核心推荐是产品与分析链重设计：用“市场变化—重要事件—条件判断—观点复盘”组织现有能力，修正固定分数和缺失处理，统一研究输入与证据，保留可靠采集、Lightweight Charts 4.1.3底座和Gemini适配；批处理、期权/ETF、独立服务、多代理按证据启用，而非默认全部引入。

## 阅读入口

先读[卷00总纲](volumes/00_master_plan.md)与[卷01仓库事实基线](volumes/01_repository_baseline.md)，再读[卷05分析方法](volumes/05_analysis_methods_and_scenarios.md)、[卷07提示词与工作流](volumes/07_llm_prompts_workflows.md)。开发执行从[卷13任务包](volumes/13_implementation_work_packages.md)选择本次scope，并以[卷10正式契约](volumes/10_api_schema_and_state_contracts.md)和[卷12迁移回退](volumes/12_migration_operations_and_rollback.md)约束。

[合订本完整正文](complete_plan.md)与各分卷内容一致；合订本另附原始仓库事实报告以便单文件阅读。机器材料仍以contracts/fixtures/meta目录为准。

## 当前版本与检查

本目录仍沿用旧路径，但当前正文和契约已经终审修订；旧字节在根目录90_archive。16卷、完整WP和研究资料仍保留，当前小范围执行以根总纲和F任务为准。数量不是必须创建的对象数。

## 分卷

| 文件 | 用途 |
|---|---|
| [00_master_plan.md](volumes/00_master_plan.md) | 卷 00｜真实仓库全面升级总纲与阅读入口 |
| [01_repository_baseline.md](volumes/01_repository_baseline.md) | 卷 01｜仓库事实基线、分析诊断与保留／替换清单 |
| [02_external_research_and_decisions.md](volumes/02_external_research_and_decisions.md) | 卷 02｜补充研究、候选比较与架构决策记录 |
| [03_product_information_and_noise.md](volumes/03_product_information_and_noise.md) | 卷 03｜产品任务、信息架构与事件降噪的详细设计 |
| [04_market_data_contracts.md](volumes/04_market_data_contracts.md) | 卷 04｜行情、来源回退、足迹与强平的数据契约和迁移 |
| [05_analysis_methods_and_scenarios.md](volumes/05_analysis_methods_and_scenarios.md) | 卷 05｜分析方法重设计：从固定分数到变化、分歧和条件 |
| [06_catalysts_macro_etf_options.md](volumes/06_catalysts_macro_etf_options.md) | 卷 06｜催化剂、宏观、ETF、稳定币与期权能力的实施设计 |
| [07_llm_prompts_workflows.md](volumes/07_llm_prompts_workflows.md) | 卷 07｜LLM提示词、上下文、工具协议与报告工作流 |
| [08_workspace_views_and_alerts.md](volumes/08_workspace_views_and_alerts.md) | 卷 08｜研究工作区、观点记录、历史恢复与低噪音预警 |
| [09_architecture_runtime_and_storage.md](volumes/09_architecture_runtime_and_storage.md) | 卷 09｜目标架构、运行方式、存储与一致性 |
| [10_api_schema_and_state_contracts.md](volumes/10_api_schema_and_state_contracts.md) | 卷 10｜API、持久模型、数据契约与状态不变量 |
| [11_evaluation_and_acceptance.md](volumes/11_evaluation_and_acceptance.md) | 卷 11｜价值、降噪、研究正确性与运行成本的评价体系 |
| [12_migration_operations_and_rollback.md](volumes/12_migration_operations_and_rollback.md) | 卷 12｜迁移、兼容、运行手册、安全与退出机制 |
| [13_implementation_work_packages.md](volumes/13_implementation_work_packages.md) | 卷 13｜60个有依赖的实施工作包 |
| [14_end_to_end_examples_and_handoff.md](volumes/14_end_to_end_examples_and_handoff.md) | 卷 14｜端到端案例、开发接手顺序与剩余决策 |
| [15_sources_glossary_and_open_questions.md](volumes/15_sources_glossary_and_open_questions.md) | 卷 15｜统一术语、来源索引、未解决项与一致性规则 |

## 机器材料

[contracts说明](contracts/README.md)包含正式字段、接口和参考SQL的使用边界。`research.schema.json`用于结构检查；`openapi.design.json`是拟新增API，不含真实服务地址/账号；`research_schema.proposed.sql`不是已经应用的迁移；`settings.design.json`保持实际预算和保留目标未配置，不会自动批准外部消费。

[fixtures说明](fixtures/README.md)明确全部数据为合成。验收场景有input、expected、invariants和must_not_claim，不是“已经跑过74项仓库测试”。sample_report由本方案构造，没有调用模型。

[meta/tasks.json](meta/tasks.json)提供稳定任务编号、依赖、范围、已知模块、具体改动、迁移、验收、回退、权限边界和核验点。[当前文档检查](../10_final_review/results/README.md)记录本次交付物自检及明确未验证事项。

## 开发边界

原始仓库材料描述含未提交变更的工作区，不代表某固定提交或线上部署。先WP-001绑定真实代码；不要覆盖并发治理、猜文件名、恢复退役CLI或自动执行60项任务。R0/R1可独立交付，ETF/期权/预测/L2/外部运行环境是条件项。

模型/数据付费、安装运行、账号、生产读写、保留删除、对外分发和部署都需在后续实施范围中明确。本轮没有执行这些动作。已检查的是文档UTF-8、JSON/Schema、样例数值/哈希/引用、任务DAG、API本地引用与参考SQL语法；不等于D1性能、真实模型质量、数据完整性或用户收益得到验证。
