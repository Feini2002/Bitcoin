> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# RES23｜完整能力组合与自建采购对照

研究日期：2026-09-16。本卷是独立基础研究，不要求匹配当前仓库；“建议/迁移启示”是本研究的推论，不是项目官方承诺。未运行候选代码。


## 1. 组合不是组件叠加

一个可用系统必须覆盖从来源到产物的全链路，并明确每个对象唯一责任。下列是独立于当前仓库的方案路线，不是所有都安装的推荐。

| 组合 | 数据与情报 | 研究与输出 | 适用情形 | 主要代价 |
|---|---|---|---|---|
| 轻量个人台 | 少量官方feed/API、原生市场适配、文件/SQL | 纯计算＋单模型＋现有网页 | 任务少、维护者一人 | 需自己保留时间/版本与失败处理 |
| 专用情报中枢 | Miniflux或FreshRSS、获准提取器、事件归并 | 词法/语义检索＋证据报告 | 多来源持续阅读 | 新服务、正文权利与索引生命周期 |
| 研究计算台 | 获准历史文件、DuckDB/Polars、实验记录 | arch/Qlib等条件工具、结果API | 较长历史/多实验 | 数据准备、可复现环境与统计设计 |
| 商业数据驱动 | 历史/新闻/期权供应商＋薄适配 | 自有证据与研究交互 | 缺稀缺历史、愿付数据费 | 合同、方法透明度、退出与供应商依赖 |
| 多任务研究平台 | 多源目录、结构化事件、持久任务 | Haystack/LangGraph等按需、统一预算 | 真实复杂分支/多人协作 | 状态、权限、编排与升级负担 |

候选能力分别来自官方组件/服务说明，不代表这些组合已运行验证。[EXT006｜Miniflux API参考](https://miniflux.app/docs/api.html) [EXT009｜FreshRSS Google Reader兼容API](https://freshrss.github.io/FreshRSS/en/developers/06_GoogleReader_API.html) [EXT105｜DuckDB 并发文档](https://duckdb.org/docs/current/connect/concurrency.html) [EXT052｜Qlib Workflow文档](https://qlib.readthedocs.io/en/latest/component/workflow.html) [EXT126｜Tardis Deribit历史覆盖](https://docs.tardis.dev/historical-data-details/deribit) [EXT031｜Event Registry Python客户端](https://github.com/EventRegistry/event-registry-python) [EXT077｜Haystack Pipelines](https://docs.haystack.deepset.ai/docs/pipelines) [EXT115｜LangGraph 持久化](https://docs.langchain.com/oss/python/langgraph/persistence)

## 2. 组合之间的可迁移边界

使用source_id、document_version、event_id、method_version和run_id作为自有业务身份；供应商ID映射在适配层。采集产物采用清楚的时间/单位与权利元数据，研究结果不引用临时进程内地址。这样以后从自采切商业或从本地切云端，不必重写所有页面与旧报告。

过度设计也有代价：小系统不需要先实现通用插件市场、全规范标准或全部30张研究表。先把一个真实任务表达完整，再扩展共用契约，避免每个实验自行建设平行事实池。

## 3. 采购与自建的决策清单

先定义缺口是否真的稀缺：过去没采的L2可能需要购买；普通官方公告可以直接订阅；专有标签需要供应商方法或自己承担推断；图表布局可以借鉴而不购买终端。不要用开源偏好阻止合理采购，也不因商业宣传省事就失去可追证能力。

每个选择写当前基线、额外价值、费用/运维、授权、替代和退出。试验失败保留原因，避免下次代理再次推荐同一失败路线。一般适用性与当前实施建议分别更新。

## 4. 第一轮不应被“完整”绑架

完整设计并不要求所有模块先完成。可以用一个官方feed和当前市场数据生成一个可追证事件简报，再单独增加检索或期权。每个切片都保留数据质量、权限和预算底线，但不要求不使用的market family先被改完。

这也是本轮对原执行DAG的补充：按当前输出的真实依赖构建最小可交付集合，不静默跳过安全前置，也不把未实现的完整WP标成已完成。详见对抗审查和Codex范围模板。


## 证据与进一步核验

[EXT006｜Miniflux API参考](https://miniflux.app/docs/api.html) [EXT105｜DuckDB 并发文档](https://duckdb.org/docs/current/connect/concurrency.html) [EXT126｜Tardis Deribit历史覆盖](https://docs.tardis.dev/historical-data-details/deribit) [EXT031｜Event Registry Python客户端](https://github.com/EventRegistry/event-registry-python) [EXT077｜Haystack Pipelines](https://docs.haystack.deepset.ai/docs/pipelines)

