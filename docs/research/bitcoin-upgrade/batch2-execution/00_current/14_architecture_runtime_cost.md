# 14｜架构与运行：推荐混合职责，按证据决定部署

## 1. 推荐架构不是强制迁云

```text
交易所与结构化公开数据          获准公告、研究、新闻
        ↓                           ↓
原生适配 / finance gateway      来源登记 / 版本化收集
        ↓                           ↓
规范数据集 + 质量/修订           主张 / 事件 / 时间 / 根来源
        └──────── 研究capture ───────┘
                         ↓
           单一版本的方法结果与证据包
                  ↙              ↘
          四页/只读API         模板或受约束分析
                  ↘              ↙
           报告、研究现场、观点与评价
```

每个方框是职责，可以在现有Worker/模块中实现。当前已经有finance存储、旧市场表、独立snapshot和yuqing，不应新建第五个没有清楚责任的数据中心。先指定每种对象唯一写入者与转换边界，再按负载分进程。[C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1) [C06｜cloudflare/finance/dataset-store.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/dataset-store.mjs#L1) [C28｜cloudflare/snapshot/marketSnapshotProgram.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/snapshot/marketSnapshotProgram.mjs#L530)

## 2. 三条路线

| 路线 | 适合前提 | 新部署与收益 | 主要代价 | 推翻选择的证据 |
|---|---|---|---|---|
| A 局部演进 | 现有环境可持续取得所需数据，主要有限窗口和定时报告 | 可零新服务；最快修计算与连接 | 原Worker边界与任务生命周期可能限制复杂计算 | 实际采集不可达、持续任务不可靠、代表查询反复超限 |
| B 专用采集/批计算＋现有前端与云控制 | 有持续源或原生计算需求，且有明确运行责任 | 一个特定采集或批进程；保留Pages/API与已有数据 | 运维、认证上传、备份、部署和契约 | 维护无人负责、数据没有净增量、现有环境已足够 |
| C 较大后端调整 | 系统长期以数据计算为主体，跨边界重复成本高，有团队运维 | 模块化后端统一资源，可逐段迁移 | 数据迁移、双读校验和恢复成本最高 | 实际问题只在几个方法或适配器，A/B能解决 |

本次首选是B式清晰职责和A式局部交付；是否新增B的进程由数据可达性与任务生命周期决定。它不同于此前“无代码事实时默认保守”的判断，也不等于现在已有足够证据要求迁移整个Cloudflare。

## 3. Cloudflare限制只在适用范围内引用

D1官方单库免费500MB、付费10GB，查询/批次执行存在30秒等限制；同一实例串行处理，读副本等能力需要按实际配置理解。不能从单库上限推出整个项目必须搬走，也不能忽略高频原始写入会占资源。[E11｜D1限制](https://developers.cloudflare.com/d1/platform/limits/)

Workers付费默认CPU30秒可调至300秒，但CPU不是网络等待，也不是各种触发器统一墙钟承诺。出站Durable Objects WebSocket不能使用面向服务端连接的休眠机制，所以不能把浏览器休眠成本模型套给交易所常连采集。[E12｜Workers限制](https://developers.cloudflare.com/workers/platform/limits/) [E13｜Durable Objects WebSocket](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)

这些是官方边界，不是本系统容量测量。本轮未取得D1实际大小、扫描行数、写入增长、错误分位、模型账单或维护时间，不给月总费用和性能提升百分比。

## 4. 现有数据资产分工

旧行情表服务既有页面和历史兼容；规范dataset保存source/receipt与typed values；finance原生snapshot保存有限上游响应；研究capture只保留该次实际消费的必要输入或引用。原始、规范、计算、报告不是互相替代，更不该无目的全部复制成四份无限历史。

`dataset-store`现在每次接收都能保存新receipt，优点是保留可见历史，代价是重复写入。优化以实测行数/字节/查询行为决定。相同值的再次观察可以用批次引用表达，但必须保留A→B→A和修订关系，不能为了省空间丢掉历史时间语义。[C06｜cloudflare/finance/dataset-store.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/dataset-store.mjs#L1)

## 5. 计算环境选择

JS纯函数适合当前已实现指标和有限窗口，应保留统一方法。Python/数值库只有在必要的期权校验、批事件统计或成熟库确实节省维护时加入；多个库共享一个可重建环境，不为每个库开服务器。

DuckDB/Parquet是历史批分析候选，先读取获准导出的有限数据并返回结果包，不直接当在线多用户数据库。ClickHouse/QuestDB等只在持续在线查询瓶颈被证明后比较。旧研究库保留候选能力，具体版本、许可和部署要求采用时重核，不在本轮默认安装。

## 6. 单飞、调度与并发

现有finance网关有固定源、参数验证、12秒超时、4MiB响应限制和安全错误分类，保留这些能力。缓存失效下多个请求是否重复访问上游需检查外层锁；若无，则按规范channel key实行有限单飞，失败不得永远锁住。[C07｜cloudflare/finance/gateway.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/gateway.mjs#L1) [C08｜cloudflare/finance/gateway.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/gateway.mjs#L170)

持续任务和UI请求分开。浏览器轮询只能读取或明确触发小范围刷新，不能成为唯一云采集调度器。新增调度要保存attempt、lease、last_success和next_allowed；退出与失败释放资源，迟到旧lease结果不能覆盖新run。

SQLite/D1同事务不意味着条件UPDATE零行会自动回滚后续INSERT。发布、预算和预警写入必须用同成功token或等价守卫；不在batch结束后才发现已插入错误报告。这个是实施约束，需要真实适配测试，而非本轮声称已验证D1事务行为。

## 7. 费用模型与限额

建立每个来源/方法/模型的实际工作量表：请求数、响应字节、写入行、扫描行、对象请求、保留时间、token、重试、总耗时和人工维护。月预算用实测样本推导，不用“有40个平台所以很贵”或“免费API所以无成本”下结论。

采集峰值与平静均测量，压缩比不得凭经验填写。每条逐笔上传一个对象通常会增加请求负担，批次大小由恢复粒度与实际延迟选择。若频繁抓取500历史点仅末尾一条变动，应评估尾段刷新＋定期修订复核，而不是永远全量重复写。

模型费用分估算、供应商返回usage和可对账账单。价格目录缺失时显示unknown；预算为空不解释为无限批准。模板路径可以零模型调用，但网络和Cloudflare使用仍有实际资源成本。

## 8. 可观测性与故障恢复

最小监控围绕用户实际误判风险：当前产品是否正确、数据何时收到、窗口缺口、方法拒绝原因、报告是否用了过期/未知输入、源被限流、任务是否重复、费用是否失控。服务HTTP可用不是研究可用。

恢复以一个capture为单位：输入是否在、方法版本是否在、允许用途是否还在、结果是否可验证。缓存可重建，不作为唯一事实；原始内容按政策删除后，恢复等级诚实降级。不要为了恢复测试删除生产数据。

## 9. 安全与发布边界

保留现有Pages资产白名单，文档包和服务端配置不加入静态发布。认证与owner边界在所有研究写入、报告、导出和管理接口验证；本轮没有完整审计外层认证，不能宣称已安全或已匿名暴露。

用户提供的repo修改权不等于批准所有付费、生产数据读取或自动交易。代码改动、依赖安装、网络采集、模型调用、迁移、部署分别在实施范围中记录。这里是实施边界，不要求产品每次普通读取都弹审批。

## 10. 何时值得较大重构

若多个Worker重复处理同一规范化与权限，源采集在现有环境持续不可用，批研究与报告恢复无法合理实现，且新后端实测减少总复杂度，C路线可以是正确选择。反之，主要问题是VWAP近似、POC并列、窗口标签和固定分数，先重构整个前端不会解决它们。

架构决策应附反证：当前运行环境、代表任务、失败样本、可维护资源、退出和回滚。不存在这些证据时，将较大迁移保持为候选，不以新框架本身作为交付成果。
