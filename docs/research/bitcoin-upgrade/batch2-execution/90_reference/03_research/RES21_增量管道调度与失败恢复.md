> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# RES21｜增量管道调度与失败恢复

研究日期：2026-09-16。本卷是独立基础研究，不要求匹配当前仓库；“建议/迁移启示”是本研究的推论，不是项目官方承诺。未运行候选代码。


## 1. 三类任务采用不同控制

定期拉取新文章适合增量游标/条件请求；多年市场回补适合可分区批任务；持续流需要连接和背压；多步骤模型研究还要管理预算与外部副作用。不能只用一个“定时任务成功”状态代表这些不同义务。

dlt围绕增量加载，Dagster围绕数据资产/回补，Temporal围绕持久工作流。它们的价值不同，应先确定缺失责任再选框架。[EXT084｜dlt 增量游标文档](https://dlthub.com/docs/general-usage/incremental/cursor) [EXT109｜Dagster 分区与回补](https://docs.dagster.io/guides/build/partitions-and-backfills) [EXT112｜Temporal Activities](https://docs.temporal.io/activities)

## 2. 幂等身份必须来自业务

市场事件用来源ID/序列与instrument，文章用来源版本，计算用输入版本＋方法参数，报告用根任务与最终产物身份。随机生成一个新ID并重试，会把重复结果当新数据。相反，用过宽ID又可能覆盖合法不同事件。

外部模型调用返回但本地写入失败，是典型不确定状态。不能假定重试免费或结果相同；应记录请求/供应商响应身份、费用状态与是否允许重调。幂等键支持取决于外部API，内部去重不能让供应商已计费操作消失。

## 3. 游标、回看与更正

只拉大于上次最大时间的记录可能遗漏迟到和旧稿更正。采用来源适配的回看窗口、边界去重、版本比对和周期性覆盖检查；参数依据来源行为与价值，不随机设一个统一天数。

游标推进应在产物持久化并校验后；失败批次不能标完成。分页过程中源集合变化需保留页游标和查询边界，无法保证一致时把覆盖标partial。

## 4. 取消、资源释放与公平预算

用户取消需要停止可取消步骤、释放浏览器/连接、阻止后续发布，并标明已发生费用。同步线程或不可取消外部操作可能继续，必须隔离其写回。Haystack相关文档明确不同执行方式的取消边界，这提醒所有方案都应实际测试。[EXT077｜Haystack Pipelines](https://docs.haystack.deepset.ai/docs/pipelines)

根预算先预留后结算；并行子任务共享可原子检查的总额。未知价格不等于零费用，预算未配置时模板仍可工作。定期采集、一次深研和历史重算分开队列或额度，避免互相饿死。

## 5. 最小可观测性

来源最后成功、迟到/缺口、任务积压、重试原因、数据版本、模型拒绝原因和费用比CPU在线率更接近研究质量。失败分类至少区分访问拒绝、限流、解析变化、字段缺失、预算不足、模型无支持输出与系统异常。

运维职责必须明确一个人或一个模块负责同一状态。没有大量任务时，现有Cron＋幂等账本可以满足要求；当恢复和可见性复杂度超出可维护范围，再部署专门平台。安装调度器不是可靠性的验收。


## 证据与进一步核验

[EXT084｜dlt 增量游标文档](https://dlthub.com/docs/general-usage/incremental/cursor) [EXT109｜Dagster 分区与回补](https://docs.dagster.io/guides/build/partitions-and-backfills) [EXT112｜Temporal Activities](https://docs.temporal.io/activities) [EXT077｜Haystack Pipelines](https://docs.haystack.deepset.ai/docs/pipelines)

