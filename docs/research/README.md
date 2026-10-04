# 研究资料导航

先按当前问题查询：`node scripts/research-context.cjs "当前问题"`。查询只读，输出相关代码与少量章节，不执行资料中的任务或 SQL。

## 当前开发入口

- [首次使用金融研究审查与修复记录](first-look-financial-review-2026-10-04.md)：三轮初诊与随后真实模型多轮偏纠；A–D已实施、最终.27/P22全量build通过，窗口/事件整队通过，当前五岗接受但首席超时，修后新整队E未完成。精确失败和输入修复见第10.8节，不把此前技术验收读成新金融通过。
- [Agent 架构主方案](agent-team-product-plan-2026-10-02.md)：当前产品与架构第一入口；首席默认、五领域独立研究、背景与市场证据、有限记忆、条件及能力边界。准确性优先，不以模型渠道或权限流程作页面主角。
- [实施与验收记录](agent-team-implementation-2026-10-02.md)：真实当前/窗口/事件轮次、首席审核、独立数值/分析复核、后台截图、修复与原失败。最新.27/P22、金融修复A–D及E未完成以顶部为准；旧current-9等记录保留其当时范围，合成回归与生产分开。
- [总架构修改方案V2](market-first-frontend-master-plan-2026-10-02.md)：配套总纲服从Agent主方案；数据消费、专业页面、单任务协议、记录和生命周期已有实现，共用Agent服务，工作包与AT验收在本文结算。
- [原 Agent 方案快照](agent-team-product-plan-history-2026-10-02.md)：原审查与实施前提保留；旧市场优先/固定五导航不再作为当前约束，不重新执行旧任务。
- [比特币合约系统对标与数据层复审](bitcoin-contract-data-architecture-review-2026-09-30.md)：33 项数据集覆盖、七个成熟案例、版本反例及尚未实施的采用建议；[案例与原件目录](contract-system-cases-2026-09-30/README.md)保留来源与限制。
- [四页工作台方案](repository-development-plan-2026-09-27.md)：已完成阶段、当前接续与验收边界。
- [架构核对](repository-architecture-review-2026-09-27.md)：现有链路与复用依据。
- [研究工作台](product-redesign-2026-09-29.md)、[AI 对话研究流程](ai-research-workflow.md)：事件/舆情、证据准备、预览与显式导入。
- [读取性能记录](chart-read-performance-2026-09-30.md)、[数据恢复记录](workbench-recovery-2026-09-29.md)：最近已完成的修复与历史验收证据。
- [当前开发快照与交接](../operations/development-handoff-2026-10-05.md)、[仓库布局](../architecture/repository-layout.md)：当前实现、剩余验收、本机原件与Git边界、新电脑接续和文件位置。

## 专题核验记录

本目录顶层的专题文档保留原路径，便于追溯已有链接。出口、采集、配额、免费金融通道、治理等记录按问题查询；记录中的日期与测试结果不代表服务当前状态。

## 设计资料、原件与历史

| 位置 | 使用方式 |
| --- | --- |
| [bitcoin-upgrade/QUICK_ROUTER.md](bitcoin-upgrade/QUICK_ROUTER.md) | 功能定位、资料用途和权威层级 |
| `bitcoin-upgrade/sources/` | 原始研究快照，保持作者结构与内容 |
| `bitcoin-upgrade/archives/` | 原始 ZIP，保持原始字节 |
| `bitcoin-upgrade/repository-baseline/` | 当时仓库事实与审阅基线 |
| `bitcoin-upgrade/batch2-execution/` | 第二批设计与旧执行记录，不重新执行旧总计划 |
| [../reference/](../README.md) | 早期代码、技能资料与治理历史，供追溯 |

`FILE_CATALOG.json` 是可再生导航元数据；资料用途或章节变化后运行 `node scripts/research-context.cjs --refresh`，再用 `--check` 核对。文本大小按统一换行计数，原始 ZIP 按实际字节计数。
