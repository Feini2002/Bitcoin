# RES15｜完整金融平台的可迁移经验

研究日期：2026-09-16。本卷是独立基础研究，不要求匹配当前仓库；“建议/迁移启示”是本研究的推论，不是项目官方承诺。未运行候选代码。


## 1. 先比较平台解决的任务

| 平台/项目 | 主要研究定位 | 可迁移成果 | 不能直接迁移的假设 |
|---|---|---|---|
| OpenBB | 多来源金融数据与API | provider边界、字段对象、数据接入 | 所有数据免费、全部provider同样可靠 |
| Qlib | 模型/因子研究工作流 | 实验记录、特征标签和评估分离 | 股票样例时间/交易制度直接套BTC |
| TradingAgents | 多角色金融分析 | 任务图、检查点、观点与决策记录 | 角色投票等于独立证据或交易优势 |
| FinRobot | 金融AI代理与产品研究 | 已公开任务与报告组织 | 未公开V2产品源码可直接部署 |
| FinGPT | 金融模型/数据训练研究 | 任务化标注、领域模型对照 | 有金融标签就比通用模型更好 |

这些定位来自公开项目和文档，运行表现本轮未复现。[EXT053｜OpenBB 官方仓库](https://github.com/OpenBB-finance/OpenBB) [EXT052｜Qlib Workflow文档](https://qlib.readthedocs.io/en/latest/component/workflow.html) [EXT046｜TradingAgents 官方仓库](https://github.com/TauricResearch/TradingAgents) [EXT048｜FinRobot 当前README](https://raw.githubusercontent.com/AI4Finance-Foundation/FinRobot/master/README.md) [EXT050｜FinGPT 官方仓库](https://github.com/AI4Finance-Foundation/FinGPT)

## 2. 不要把股票估值错误迁移到BTC

公司研究中的收入、利润、现金流和财务报表有明确主体。BTC没有同样的发行公司现金流，不能为了复用DCF或公司评分页面而制造对应关系。可以迁移的是证据结构、假设检验和报告组织，不是未经证明的估值公式。

类似地，交易框架中的风险预算、账户仓位和下单流程在研究系统不是默认职责。一个“风险官”若没有账户数据，只能分析可观察市场风险，不应假装计算用户资产敞口。

## 3. 整体采用有真实适用条件

从零建设多资产平台、持续维护大量provider、多人共享实验或确需复杂事件驱动过程时，完整框架可能比自造所有模块更便宜。不能因本仓库暂时不合适就在基础资料库否定它。

评价整体采用时，画出它将接管哪些责任：数据身份、调度、配置、存储、模型、UI、评价。每多保留一套相同责任都要说明唯一真值在哪里。把平台作为独立只读服务可能更容易撤回，但不是解除许可或运维的技巧。

## 4. 平台案例的核验层次

README说明只能证明项目声明与接口入口；定位源码可以证明实现存在；测试运行才能支持该环境行为；目标数据实验才能支持金融效果。FinRobot官方区分公开与未开放版本，是特别需要保留的反例。TradingAgents修复历史输入问题的记录，也是限制而不是“现在绝对无泄漏”的证明。[EXT048｜FinRobot 当前README](https://raw.githubusercontent.com/AI4Finance-Foundation/FinRobot/master/README.md) [EXT047｜TradingAgents CHANGELOG](https://raw.githubusercontent.com/TauricResearch/TradingAgents/main/CHANGELOG.md)

## 5. 决策方法

先列“用平台”“借一个模块”“只借方法”“继续现有实现”四种路线，各自承担相同任务和验收。计算迁移、模型、数据、运营和退出成本，不只比较安装复杂度或仓库大小。

第一轮选择一个代表性问题，例如用同一组真实数据生成条件简报，或注册一次事件研究。平台的额外功能不计入成功，除非使用者确实需要。没有净收益时保留学习成果与卡片，不把试验变成必须完成的长期迁移。


## 证据与进一步核验

[EXT053｜OpenBB 官方仓库](https://github.com/OpenBB-finance/OpenBB) [EXT052｜Qlib Workflow文档](https://qlib.readthedocs.io/en/latest/component/workflow.html) [EXT047｜TradingAgents CHANGELOG](https://raw.githubusercontent.com/TauricResearch/TradingAgents/main/CHANGELOG.md) [EXT048｜FinRobot 当前README](https://raw.githubusercontent.com/AI4Finance-Foundation/FinRobot/master/README.md) [EXT050｜FinGPT 官方仓库](https://github.com/AI4Finance-Foundation/FinGPT)

