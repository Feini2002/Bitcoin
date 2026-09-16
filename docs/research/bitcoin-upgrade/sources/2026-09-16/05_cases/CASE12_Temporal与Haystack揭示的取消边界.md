# CASE12｜Temporal与Haystack揭示的取消边界

资料核验：2026-09-16。这里分析已公开的产品/方法，不声称实际使用过产品，也不复制其商业实现。


## 来源事实
Temporal活动强调幂等和重试；Haystack区分同步线程与异步取消；LangGraph有检查点与恢复。它们说明“任务恢复”与“外部操作只发生一次”不同。

## 失败时间线
外部模型已返回并计费，进程在记录结果前崩溃。重试可能再次调用模型；用户取消时，无法中断的后台操作仍可能完成。若没有业务幂等身份与发布门，旧任务结果还可能覆盖新任务。

## 迁移设计
根任务保存预算预留、步骤请求身份、结果状态和发布版本。重试先判外部结果是否可查询/复用；不支持时明确不确定费用和是否允许重调。取消阻止后续发布，已发生费用单独结算。

## 最小故障注入
在请求前、返回后、持久化前、发布后分别中断，用合成外部服务验证不会重复发布或绕过预算。通过一次正常运行不算恢复验收。

## 选型结论
简单流程用现有账本可能足够；长期跨服务恢复才值得完整平台。框架越强越不能省掉领域幂等和资金/数据边界。


## 原始依据

[EXT112｜Temporal Activities](https://docs.temporal.io/activities) [EXT077｜Haystack Pipelines](https://docs.haystack.deepset.ai/docs/pipelines) [EXT115｜LangGraph 持久化](https://docs.langchain.com/oss/python/langgraph/persistence)
