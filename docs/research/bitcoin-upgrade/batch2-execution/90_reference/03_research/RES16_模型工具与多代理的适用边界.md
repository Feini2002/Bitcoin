> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# RES16｜模型工具与多代理的适用边界

研究日期：2026-09-16。本卷是独立基础研究，不要求匹配当前仓库；“建议/迁移启示”是本研究的推论，不是项目官方承诺。未运行候选代码。


## 1. 任务分解比角色命名重要

一个模型总结五个栏目，与五个模型重复读同样材料，都不等于更深入研究。适合拆分的是独立证据需求，例如核对某ETF披露、确认合约OI单位、查找某公告原文；不适合的是让三个角色用同一摘要投票。

Anthropic工程案例讨论可独立分解研究的收益与协调代价；TradingAgents展示多角色和记录。二者都不能单独证明多代理在BTC预测上更准。[EXT085｜Anthropic 多代理研究工程](https://www.anthropic.com/engineering/multi-agent-research-system) [EXT046｜TradingAgents 官方仓库](https://github.com/TauricResearch/TradingAgents)

## 2. 四种合理流程

| 流程 | 适合任务 | 控制成本的方式 |
|---|---|---|
| 程序模板 | 只有数值变化、关键数据缺失或无新事实 | 零模型调用，直接展示证据状态 |
| 单综合模型 | 已有足够事实，需要解释分歧 | 一次固定材料包，不自由刷新latest |
| 条件核查 | 出现高价值冲突、关键原始来源缺失 | 有目标的少量工具调用与一个审查 |
| 并行研究子任务 | 多个独立来源/问题可拆 | 根预算、来源去重、子结果证据汇总 |

不能把“单流程优先”写成永远不用多代理；也不能把复杂图当升级默认。比较必须控制总预算、来源权限和信息截止点。

## 3. 工具协议

工具应按来源ID与资源键受控访问，不提供任意URL代理、任意SQL或账户接口。每次工具输出包括取得时间、来源、权利、正文是否完整和错误类型。模型不能把搜索摘要当原文读过，也不能在工具拒绝时自行改用不允许来源。

上下文是版本对象：基础材料包封存；新增合法证据形成子版本；最终报告指向实际用于综合的版本。工具结果中的网页命令是数据，不能改变系统角色、泄漏秘密或触发交易。

## 4. 框架选择

Haystack适合检索组件组合，LlamaIndex适合数据连接/索引，LangGraph适合代理状态与中断，DSPy适合有可靠评价样本后的程序优化。它们不是同时需要的一组依赖。[EXT077｜Haystack Pipelines](https://docs.haystack.deepset.ai/docs/pipelines) [EXT117｜LlamaIndex 仓库](https://github.com/run-llama/llama_index) [EXT115｜LangGraph 持久化](https://docs.langchain.com/oss/python/langgraph/persistence) [EXT078｜DSPy 官方仓库](https://github.com/stanfordnlp/dspy)

框架的取消与重试语义要核实。Haystack文档明确同步线程不能与异步执行同样被取消；因此用户点击取消后仍要检查后台请求和费用。checkpoint恢复同样不能保证外部付费操作恰好一次。

## 5. 输出与评价

报告区分事实、解释、假设、反证、局限和下一检查。关键数字由程序或证据引用绑定；无依据补数是硬错误。审核模型与生成模型看同一错误来源时，不算独立核验，必须能回到原始材料。

评估多代理的必要性应观察关键遗漏减少、来源独立增加、错误相关性下降和每个有用结果成本，而不按报告长度、角色数量和工具调用数。没有增量就缩回简单流程，保留有用的日志与证据结构。


## 证据与进一步核验

[EXT085｜Anthropic 多代理研究工程](https://www.anthropic.com/engineering/multi-agent-research-system) [EXT046｜TradingAgents 官方仓库](https://github.com/TauricResearch/TradingAgents) [EXT077｜Haystack Pipelines](https://docs.haystack.deepset.ai/docs/pipelines) [EXT117｜LlamaIndex 仓库](https://github.com/run-llama/llama_index) [EXT115｜LangGraph 持久化](https://docs.langchain.com/oss/python/langgraph/persistence) [EXT078｜DSPy 官方仓库](https://github.com/stanfordnlp/dspy)

