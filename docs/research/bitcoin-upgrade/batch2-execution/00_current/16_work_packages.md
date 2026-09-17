# 16｜执行任务导航（已收口）

本版不再从旧S1—S6任意选择或与旧WP并行执行。**唯一调度入口：[EXECUTION_MASTER.md](../EXECUTION_MASTER.md)**；39项默认主线和9项条件分支的原NEW编号均保留。

逐项任务完整定义已移到`01_execution/phases/`。以下仅为导航，不是第二套待办。原任务条目中的修改、验收、回退和核验点已保留在相应阶段；本版对范围和顺序的收敛在每项“本版收敛”中说明。

|任务|名称|执行归属|
|---|---|---|
| [NEW-001](../01_execution/phases/P00_repository_binding.md#new-001) | 锁定本次工作区和能力范围 | P00 |
| [NEW-002](../01_execution/phases/P00_repository_binding.md#new-002) | 登记启用来源的用途与运行条件 | P00 |
| [NEW-003](../01_execution/phases/P00_repository_binding.md#new-003) | 把审查反例接到现有测试入口 | P00 |
| [NEW-004](../01_execution/phases/P01_data_contracts.md#new-004) | 建立最小typed observation与quality适配 | P01 |
| [NEW-005](../01_execution/phases/P01_data_contracts.md#new-005) | 能力状态与真实新鲜度读取 | P01 |
| [NEW-006](../01_execution/phases/P01_data_contracts.md#new-006) | 有界as-of与窗口选择 | P01 |
| [NEW-007](../01_execution/phases/P01_data_contracts.md#new-007) | 纯方法注册与跨消费者映射 | P01 |
| [NEW-008](../01_execution/phases/P02_chart_workbench.md#new-008) | 主图接入规范同产品K线 | P02 |
| [NEW-009](../01_execution/phases/P02_chart_workbench.md#new-009) | 主图实时确认和晚到请求保护 | P02 |
| [NEW-010](../01_execution/phases/P02_chart_workbench.md#new-010) | 新增成交额、主动量与真实VWAP | P02 |
| [NEW-011](../01_execution/phases/P02_chart_workbench.md#new-011) | 修正结构价位和近端突破生命周期 | P02 |
| [NEW-012](../01_execution/phases/P02_chart_workbench.md#new-012) | 主图周期覆盖与默认信息层 | P02 |
| [NEW-013](../01_execution/phases/P05_orderflow.md#new-013) | 分离足迹分析格与显示格 | P05 |
| [NEW-014](../01_execution/phases/P05_orderflow.md#new-014) | 统一POC并列及价值区规则 | P05 |
| [NEW-015](../01_execution/phases/P05_orderflow.md#new-015) | SFP按已知价位和确认bar评估 | P05 |
| [NEW-016](../01_execution/phases/P05_orderflow.md#new-016) | 足迹新鲜度、CVD与失衡方法 | P05 |
| [NEW-017](../01_execution/phases/P06_liquidations.md#new-017) | 强平类型与unknown方向 | P06 |
| [NEW-018](../01_execution/phases/P06_liquidations.md#new-018) | 强平事件身份与实时/历史互斥 | P06 |
| [NEW-019](../01_execution/phases/P06_liquidations.md#new-019) | 清算窗口和强度的范围化统计 | P06 |
| [NEW-020](../01_execution/phases/P06_liquidations.md#new-020) | 压力页与快照统一条件向量 | P06 |
| [NEW-021](../01_execution/phases/P04_derivatives.md#new-021) | 资金费与基差显式单位 | P04 |
| [NEW-022](../01_execution/phases/P04_derivatives.md#new-022) | OI窗口、规格与估值分解 | P04 |
| [NEW-023](../01_execution/phases/P04_derivatives.md#new-023) | Taker和多空比例语义对齐 | P04 |
| [NEW-024](../01_execution/phases/P04_derivatives.md#new-024) | 衍生品页与四页快照同源方法 | P04 |
| [NEW-025](../01_execution/phases/P11_conditional_branches.md#new-025) | 有界历史回补和周期覆盖 | C25 |
| [NEW-026](../01_execution/phases/P11_conditional_branches.md#new-026) | 接收版本写放大与冲突优化 | C26 |
| [NEW-027](../01_execution/phases/P11_conditional_branches.md#new-027) | 采集运行环境与持续性实验 | C27 |
| [NEW-028](../01_execution/phases/P11_conditional_branches.md#new-028) | FRED与跨资产时点背景 | C28 |
| [NEW-029](../01_execution/phases/P11_conditional_branches.md#new-029) | 有限ETF披露核对试点 | C29 |
| [NEW-030](../01_execution/phases/P11_conditional_branches.md#new-030) | 期权摘要优先复用与有限截面 | C30 |
| [NEW-031](../01_execution/phases/P07_intelligence.md#new-031) | 有限独立情报来源登记 | P07 |
| [NEW-032](../01_execution/phases/P07_intelligence.md#new-032) | 文档版本与有界提取 | P07 |
| [NEW-033](../01_execution/phases/P07_intelligence.md#new-033) | 事件主张、转载和更正关系 | P07 |
| [NEW-034](../01_execution/phases/P07_intelligence.md#new-034) | BTC相关性与覆盖不足状态 | P07 |
| [NEW-035](../01_execution/phases/P03_market_template.md#new-035) | 按能力封存输入和结果身份 | P03 |
| [NEW-036](../01_execution/phases/P03_market_template.md#new-036) | 确定性变化简报与误导规则退出 | P03 |
| [NEW-037](../01_execution/phases/P08_model_workflow.md#new-037) | 根任务预算与模型适配 | P08 |
| [NEW-038](../01_execution/phases/P08_model_workflow.md#new-038) | 受约束综合与程序核验 | P08 |
| [NEW-039](../01_execution/phases/P03_market_template.md#new-039) | 预览与不可变最终报告 | P03 |
| [NEW-040](../01_execution/phases/P09_workspace_history.md#new-040) | 统一四页证据入口与Research View | P09 |
| [NEW-041](../01_execution/phases/P09_workspace_history.md#new-041) | 旧链接、导出和分层保留 | P09 |
| [NEW-042](../01_execution/phases/P11_conditional_branches.md#new-042) | 观点记录与条件预警试点 | C42 |
| [NEW-043](../01_execution/phases/P10_validation_handoff.md#new-043) | 数据增量与模型增量分离评价 | P10 |
| [NEW-044](../01_execution/phases/P10_validation_handoff.md#new-044) | 逐切片端到端与迁移演练 | P10 |
| [NEW-045](../01_execution/phases/P11_conditional_branches.md#new-045) | 生产切换提案与有限观察 | C45 |
| [NEW-046](../01_execution/phases/P11_conditional_branches.md#new-046) | 按实测评估批研究或独立数据库 | C46 |
| [NEW-047](../01_execution/phases/P00_repository_binding.md#new-047) | 对手方资料和公共源复核登记 | P00 |
| [NEW-048](../01_execution/phases/P10_validation_handoff.md#new-048) | 开发接手与范围闭合 | P10 |

数据和方法详细设计仍在各专项卷，机器导航见[任务镜像](../01_execution/tasks.json)。实际进度只写[执行日志](../EXECUTION_LOG.md)，不在本表同时维护勾选状态。被替换的原六切片入口仅在[历史原件](../99_history/README.md)保留。
