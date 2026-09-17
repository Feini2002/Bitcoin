# 当前任务目录

[唯一执行总纲](../EXECUTION_MASTER.md)负责范围和调度；`phases/P00...P10`展开39项默认本地任务，`P11_conditional_branches.md`展开9项条件任务。

`tasks.json`与阶段MD由本次整理同步生成，保留原48项NEW编号及硬依赖。它是导航镜像，不用作可变进度或另一套调度权威。实际开发只更新根`EXECUTION_LOG.md`。

`acceptance_map.json`把原66个合成场景路由到实际任务，状态全部not_run_against_repository；不表示66个测试已经在仓库执行。测试入口与参数应先由P00/P01绑定真实代码。

旧WP、SLICE、S1—S6不会从本目录自动触发。历史材料用于方法或设计对照，新增能力只有在对应任务和授权成立时才实施。
