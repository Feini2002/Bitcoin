# 第二批系统升级资料｜可顺序执行版

**唯一入口：[EXECUTION_MASTER.md](EXECUTION_MASTER.md)。**

你已归档的第一批不需要再整理；将本包作为独立目录放入仓库已有研究资料区，交给Codex读取上面的总任务即可。不要覆盖仓库根README、AGENTS或第一批原件。

本版保留第二批21卷设计、相关研究资料、48个NEW编号和66个合成场景；把“多套任选入口”收口为11个主阶段、39项默认本地任务，以及9项有条件分支。模型和情报的代码与离线验证在主线内，真实调用、生产迁移与发布按权限分别核验。

## 如何启动

将根`EXECUTION_MASTER.md`中的执行指令交给开发者。P00核对当前工作区后直接继续开发，不停在规划，也不需要你每个阶段重复选scope。遇到依赖或外部条件阻塞时记录准确状态，继续独立工作；没有授权不部署、不实调用模型、不读写生产或推送Git。

## 默认路线

|阶段|产物|
|---|---|
| [P00](01_execution/phases/P00_repository_binding.md) | 绑定当前仓库与已归档资料，建立测试和权限基线 |
| [P01](01_execution/phases/P01_data_contracts.md) | 建立供当前页面使用的最小数据、时间和方法边界 |
| [P02](01_execution/phases/P02_chart_workbench.md) | 完成行情工作台的产品身份、确认状态、VWAP和结构修正 |
| [P03](01_execution/phases/P03_market_template.md) | 尽早交付固定输入的市场变化模板与报告生命周期 |
| [P04](01_execution/phases/P04_derivatives.md) | 统一衍生品单位、窗口、OI和跨消费者方法 |
| [P05](01_execution/phases/P05_orderflow.md) | 统一足迹分箱、POC、价值区、CVD和SFP时点 |
| [P06](01_execution/phases/P06_liquidations.md) | 修正强平事件语义、统计范围及压力条件 |
| [P07](01_execution/phases/P07_intelligence.md) | 完成有限来源、文档版本、事件去重与低噪音情报链 |
| [P08](01_execution/phases/P08_model_workflow.md) | 接入受约束模型综合、根预算与输出核验 |
| [P09](01_execution/phases/P09_workspace_history.md) | 贯通四页证据、研究现场、旧链接与导出 |
| [P10](01_execution/phases/P10_validation_handoff.md) | 完成价值对照、跨页回归、迁移演练与开发收口 |

[P11](01_execution/phases/P11_conditional_branches.md)是9项条件分支，不是全做阶段。历史回补、持续采集、宏观/ETF/期权、预警和数据库实验依具体证据启用；不得用未触发分支遮蔽核心未完成。

## 文件分工

|位置|作用|
|---|---|
|`EXECUTION_MASTER.md`|唯一任务调度与范围规范|
|`01_execution/phases/`|当前逐任务执行定义，按阶段展开|
|`EXECUTION_LOG.md`|开发者实际填写的工作区、权限、实现、测试和恢复记录|
|`01_execution/tasks.json`|从MD整理出的任务导航镜像，不是另一份进度来源|
|`00_current/`|保留的第二批技术方案；卷16/18已改为总任务跳转，不再要求任选切片|
|`02_contracts/`|原设计与合成对象，非已部署接口或生产DDL|
|`03_validation/`|原66个拟验收场景和原文档QA记录，均不证明今天仓库已通过|
|`04_evidence/`|原源码/外部依据及更新后的本包文件清单|
|`90_reference/`|第一批研究的只读备用；已有归档优先，不重复索引执行|
|`05_release/`|本轮重整说明、来源保全及包自身检查|
|`99_history/`|被替换的旧执行入口原件，仅作追溯|

## 准确边界

本轮只整理文档，没有重新读取GitHub当前分支、安装依赖、运行业务代码、调用真实模型或操作生产。原源码审查基线仍为`a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；第一批本地调查和新提交的差异不能只看日期，开发前必须查当前工作区。

[本轮变更与核验](05_release/CHANGELOG.md) · [实际文档检查](05_release/delivery-checks.json) · [进度日志](EXECUTION_LOG.md)
