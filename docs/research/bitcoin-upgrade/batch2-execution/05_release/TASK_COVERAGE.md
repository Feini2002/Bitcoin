# 48项原任务覆盖与入口去冲突

所有原NEW编号恰好有一份当前任务正文；未重编号，未删除原任务。39项非条件任务全部纳入主线，9项原条件任务保持触发式。硬依赖与原JSON保持一致；默认主线是其有效拓扑顺序。

根README只是链接，卷00负责技术目标，卷16/18只作路由；EXECUTION_MASTER负责范围与调度；阶段文件承担任务执行规格；tasks.json为相同内容的派生导航。日志仅记实际状态，不能变成第三份设计计划。

|原编号|当前归属|当前唯一正文|
|---|---|---|
| NEW-001 | P00 / default_local_mainline | [锁定本次工作区和能力范围](../01_execution/phases/P00_repository_binding.md#new-001) |
| NEW-002 | P00 / default_local_mainline | [登记启用来源的用途与运行条件](../01_execution/phases/P00_repository_binding.md#new-002) |
| NEW-003 | P00 / default_local_mainline | [把审查反例接到现有测试入口](../01_execution/phases/P00_repository_binding.md#new-003) |
| NEW-004 | P01 / default_local_mainline | [建立最小typed observation与quality适配](../01_execution/phases/P01_data_contracts.md#new-004) |
| NEW-005 | P01 / default_local_mainline | [能力状态与真实新鲜度读取](../01_execution/phases/P01_data_contracts.md#new-005) |
| NEW-006 | P01 / default_local_mainline | [有界as-of与窗口选择](../01_execution/phases/P01_data_contracts.md#new-006) |
| NEW-007 | P01 / default_local_mainline | [纯方法注册与跨消费者映射](../01_execution/phases/P01_data_contracts.md#new-007) |
| NEW-008 | P02 / default_local_mainline | [主图接入规范同产品K线](../01_execution/phases/P02_chart_workbench.md#new-008) |
| NEW-009 | P02 / default_local_mainline | [主图实时确认和晚到请求保护](../01_execution/phases/P02_chart_workbench.md#new-009) |
| NEW-010 | P02 / default_local_mainline | [新增成交额、主动量与真实VWAP](../01_execution/phases/P02_chart_workbench.md#new-010) |
| NEW-011 | P02 / default_local_mainline | [修正结构价位和近端突破生命周期](../01_execution/phases/P02_chart_workbench.md#new-011) |
| NEW-012 | P02 / default_local_mainline | [主图周期覆盖与默认信息层](../01_execution/phases/P02_chart_workbench.md#new-012) |
| NEW-013 | P05 / default_local_mainline | [分离足迹分析格与显示格](../01_execution/phases/P05_orderflow.md#new-013) |
| NEW-014 | P05 / default_local_mainline | [统一POC并列及价值区规则](../01_execution/phases/P05_orderflow.md#new-014) |
| NEW-015 | P05 / default_local_mainline | [SFP按已知价位和确认bar评估](../01_execution/phases/P05_orderflow.md#new-015) |
| NEW-016 | P05 / default_local_mainline | [足迹新鲜度、CVD与失衡方法](../01_execution/phases/P05_orderflow.md#new-016) |
| NEW-017 | P06 / default_local_mainline | [强平类型与unknown方向](../01_execution/phases/P06_liquidations.md#new-017) |
| NEW-018 | P06 / default_local_mainline | [强平事件身份与实时/历史互斥](../01_execution/phases/P06_liquidations.md#new-018) |
| NEW-019 | P06 / default_local_mainline | [清算窗口和强度的范围化统计](../01_execution/phases/P06_liquidations.md#new-019) |
| NEW-020 | P06 / default_local_mainline | [压力页与快照统一条件向量](../01_execution/phases/P06_liquidations.md#new-020) |
| NEW-021 | P04 / default_local_mainline | [资金费与基差显式单位](../01_execution/phases/P04_derivatives.md#new-021) |
| NEW-022 | P04 / default_local_mainline | [OI窗口、规格与估值分解](../01_execution/phases/P04_derivatives.md#new-022) |
| NEW-023 | P04 / default_local_mainline | [Taker和多空比例语义对齐](../01_execution/phases/P04_derivatives.md#new-023) |
| NEW-024 | P04 / default_local_mainline | [衍生品页与四页快照同源方法](../01_execution/phases/P04_derivatives.md#new-024) |
| NEW-025 | C25 / conditional | [有界历史回补和周期覆盖](../01_execution/phases/P11_conditional_branches.md#new-025) |
| NEW-026 | C26 / conditional | [接收版本写放大与冲突优化](../01_execution/phases/P11_conditional_branches.md#new-026) |
| NEW-027 | C27 / conditional | [采集运行环境与持续性实验](../01_execution/phases/P11_conditional_branches.md#new-027) |
| NEW-028 | C28 / conditional | [FRED与跨资产时点背景](../01_execution/phases/P11_conditional_branches.md#new-028) |
| NEW-029 | C29 / conditional | [有限ETF披露核对试点](../01_execution/phases/P11_conditional_branches.md#new-029) |
| NEW-030 | C30 / conditional | [期权摘要优先复用与有限截面](../01_execution/phases/P11_conditional_branches.md#new-030) |
| NEW-031 | P07 / default_local_mainline | [有限独立情报来源登记](../01_execution/phases/P07_intelligence.md#new-031) |
| NEW-032 | P07 / default_local_mainline | [文档版本与有界提取](../01_execution/phases/P07_intelligence.md#new-032) |
| NEW-033 | P07 / default_local_mainline | [事件主张、转载和更正关系](../01_execution/phases/P07_intelligence.md#new-033) |
| NEW-034 | P07 / default_local_mainline | [BTC相关性与覆盖不足状态](../01_execution/phases/P07_intelligence.md#new-034) |
| NEW-035 | P03 / default_local_mainline | [按能力封存输入和结果身份](../01_execution/phases/P03_market_template.md#new-035) |
| NEW-036 | P03 / default_local_mainline | [确定性变化简报与误导规则退出](../01_execution/phases/P03_market_template.md#new-036) |
| NEW-037 | P08 / default_local_mainline | [根任务预算与模型适配](../01_execution/phases/P08_model_workflow.md#new-037) |
| NEW-038 | P08 / default_local_mainline | [受约束综合与程序核验](../01_execution/phases/P08_model_workflow.md#new-038) |
| NEW-039 | P03 / default_local_mainline | [预览与不可变最终报告](../01_execution/phases/P03_market_template.md#new-039) |
| NEW-040 | P09 / default_local_mainline | [统一四页证据入口与Research View](../01_execution/phases/P09_workspace_history.md#new-040) |
| NEW-041 | P09 / default_local_mainline | [旧链接、导出和分层保留](../01_execution/phases/P09_workspace_history.md#new-041) |
| NEW-042 | C42 / conditional | [观点记录与条件预警试点](../01_execution/phases/P11_conditional_branches.md#new-042) |
| NEW-043 | P10 / default_local_mainline | [数据增量与模型增量分离评价](../01_execution/phases/P10_validation_handoff.md#new-043) |
| NEW-044 | P10 / default_local_mainline | [逐切片端到端与迁移演练](../01_execution/phases/P10_validation_handoff.md#new-044) |
| NEW-045 | C45 / conditional | [生产切换提案与有限观察](../01_execution/phases/P11_conditional_branches.md#new-045) |
| NEW-046 | C46 / conditional | [按实测评估批研究或独立数据库](../01_execution/phases/P11_conditional_branches.md#new-046) |
| NEW-047 | P00 / default_local_mainline | [对手方资料和公共源复核登记](../01_execution/phases/P00_repository_binding.md#new-047) |
| NEW-048 | P10 / default_local_mainline | [开发接手与范围闭合](../01_execution/phases/P10_validation_handoff.md#new-048) |
