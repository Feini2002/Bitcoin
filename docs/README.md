# 文档索引

| 分类 | 阅读入口 |
| --- | --- |
| 当前开发与安装 | [当前开发快照与交接](operations/development-handoff-2026-10-05.md)、[新电脑初始化](operations/new-computer.md)、[开发导航](operations/development-guide.md) |
| 当前架构与文件职责 | [仓库布局](architecture/repository-layout.md)、architecture/ |
| 研究与实现依据 | [研究资料导航](research/README.md)、[按问题定位](research/bitcoin-upgrade/QUICK_ROUTER.md) |
| 历史记录与早期参考 | reference/history/、reference/archive/、reference/project-skills/ |

操作说明放在 operations/，历史材料保留其当时的结论；研究原始快照和 ZIP 继续保存原内容。

- [2026-10-05开发快照](operations/development-handoff-2026-10-05.md)：Agent、数据、前端与目录整理的当前实现、真实通过/失败、未完成E、模型调用预算和Git备份边界。
- [Agent主方案](research/agent-team-product-plan-2026-10-02.md)、[服从Agent的总架构V2](research/market-first-frontend-master-plan-2026-10-02.md)、[实施记录](research/agent-team-implementation-2026-10-02.md)：当前架构与精确状态入口。
- [2026-09-30开发交接](operations/development-handoff-2026-09-30.md)：当时已发布主线、发布状态、性能验证与换电脑背景，不替代当前快照。
- [研究工作台改版](research/product-redesign-2026-09-29.md) 与 [AI 对话研究流程](research/ai-research-workflow.md)：事件/舆情模块及无模型 Key 的研究、预览和显式导入。
- [行情读取性能修复](research/chart-read-performance-2026-09-30.md)：慢 SQL、请求调度、共享窗口、取消/恢复、真实测量与发布记录。
- [数据恢复与采集核验](research/workbench-recovery-2026-09-29.md)：恢复后的数据修复与实测，不是长期在线保证。
- [四页数据工作台已完成阶段](research/repository-development-plan-2026-09-27.md)：W1–W4的依赖、受影响文件、历史验收和发布边界，当前开发服从Agent主方案。
- [当前架构核对](research/repository-architecture-review-2026-09-27.md)：复用的治理成果、实际链路缺口及旧计划归并。
- [币安插件与四页工作台复用手册](research/binance-plugin-workbench-research-2026-09-27.md)：当前工具实测、官方与社区来源、数据核对/补查流程及可复制研究指令；接入建议尚未实施。
- [云端暂停与恢复](research/cloudflare-pause-resume-2026-09-27.md)：已于 2026-09-29 恢复；当前状态用 `cloud:status` 核对，开关使用固定脚本和保存的恢复记录。
- [币安连接诊断与修复](research/binance-connectivity-2026-09-16.md)：WebSocket迁移实测、CF REST 403边界与免费采集路径。

- [币安主源工作台数据与改版方案](research/workbench-binance-data-plan-2026-09-16.md)：32个规范数据集、D1验收、金融对抗审查、聚合和图表优化；页面留待下一轮实施。
- [全部平台限制与连接记录](research/free-financial-platform-limits-2026-09-16.md)：40个平台逐项用途、免费权限、额度、时效和故障归因。
- [免费金融 API 通道](research/free-financial-api-channels-2026-09-16.md)：40 个平台/产品、93 个操作，免费边界、配置、诊断和历次上线记录。

- [功能定位入口](research/bitcoin-upgrade/QUICK_ROUTER.md)：先按问题查询，返回具体代码、少量资料章节与验证；含K线专项定位和CodeGraph说明。
- [系统升级资料总纲](research/bitcoin-upgrade/README.md)：研究包与历次实施的阅读入口；历史材料不替代当前开发方案。
- [升级资料阅读路由](research/bitcoin-upgrade/READING_ROUTES.md)：按问题查分卷、专题、复用卡、案例与终审资料。
- [升级主题与仓库对应表](research/bitcoin-upgrade/REPOSITORY_MAP.md)：现有页面、数据/报告链路、共享状态与验证入口。
- [仓库布局与发布边界](architecture/repository-layout.md)：文件归属、迁移映射、资产清单、验证和生成产物。
- [2026-09-16 功能治理记录](reference/history/governance-2026-09-16.md)：早期功能分层与验收历史，当前状态以架构核对为准。
- [市场快照](architecture/market-snapshot.md)：快照 Worker、D1、员工输入契约和后续接入范围。
- [舆情拆分计划](architecture/yuqing-plan.md)：舆情模块后续工作与关联关系。
- [GitHub 备份](operations/github-backup.md)：按用户要求备份和恢复源码。
- [新电脑开发与敏感配置迁移](operations/new-computer.md)：依赖安装、单一 .env、本地联调、测试和登录。
- [个人登录](operations/cloudflare-access-personal-login.md)：Cloudflare Access 接入说明。
- [项目导航](operations/development-guide.md)：开发入口。

README.md 负责启动和常用命令，AGENTS.md 负责执行约束；专项文档不复制发布审批或全局工作规则。research/ 保存待采用的研究与设计，并区分来源快照和本仓库导航；其中的命令与提示词不自动成为用户指令。reference/ 中的资料不作为当前操作依据。
