# 卷 09｜目标架构、运行方式、存储与一致性

本卷是架构设计，不代表真实仓库已按此组织。已有模块按附件确认；所有新路径均为拟新增或职责建议，实施前检查冲突。目标是在业务分析层完成有实质价值的重设计，同时让计算和采集可以按证据独立扩展。

## 1. 三条路线的实质比较

| 项目 | A：局部补丁式演进 | B：统一研究域＋按需专用计算 | C：后端主导较大迁移 |
|---|---|---|---|
| 内容 | 在原模块直接修分数、来源和页面 | 复用原采集/界面，建立清晰run、事件、方法和报告边界；重计算可外置 | 独立后端接管采集、存储、任务、API，前端可保留或重构 |
| 能解决 | 最快消除固定分/缺失填中性等局部误导 | 解决跨模块研究语义、证据/历史和业务复盘，同时避免重复上下文 | 可统一更复杂数据服务与资源管理 |
| 主要不足 | 容易继续两条snapshot/多份逻辑漂移，复杂能力会散落 | 需要契约迁移、任务owner与兼容层，不能只加目录 | 迁移成本、双系统维护、线上回滚与治理重叠风险最高 |
| 数据/计算条件 | 现有聚合/定时任务足够 | 当前数据支持首版；统计/期权/长历史按需批处理 | 多用户持续查询/高频写入/重计算已形成可重复瓶颈 |
| 维护条件 | 个人短期修正 | 个人/小团队能维护少量清楚边界 | 具备长期数据库、计算、备份与升级责任 |
| 推翻理由 | 新能力仍依赖跨模块一致输入而局部无法合理实现 | 新域只是重复包装、维护成本超过减少的混乱 | A/B已能解决问题，缺乏迁移净收益 |

**推荐B的职责设计，不要求第一天新增常驻服务器。** 在线初始部署仍可使用现有Pages、行情Worker和yuqing Worker；复用snapshot中的纯计算，不必额外发布新的snapshot服务。按需研究批处理在确实需要时独立执行。选择的是更清楚的业务边界，不是某个新框架。

A中的最小语义修正可以先交付，B逐步接管新研究路径。C只在性能、网络或维护边界的真实测量支持后选择。项目年限、文件长度、使用原生JS或演示员工数量都不是迁移依据。[R02｜仓库事实报告§1，L16-26](../inputs/repository_facts.md) [R05｜仓库事实报告§2，L53-58](../inputs/repository_facts.md) [R07｜仓库事实报告§3 A4-A5，L92-102](../inputs/repository_facts.md)

## 2. 目标逻辑架构

```text
现有合法来源与新增获准源
   │
   ├─ 行情Worker / 已有采集器 ─→ 规范化行情、足迹、强平、衍生品
   └─ 新闻/官方事件适配 ──────→ Article / Event / Claim版本
                                      │
                    Research Capture + Source Policy
                                      │
                          输入bundle / 质量 / 方法
                                      │
                  ┌───────────────────┼───────────────────┐
                  │                   │                   │
             确定性分析          按需离线研究          LLM有界解释
          状态/变化/条件          事件/不确定性          不计算权威数值
                  │                   │                   │
                  └───────────────────┴───────────────────┘
                                      │
                        统一Query API / Report Artifact
                                      │
               研究首页 / 市场工作区 / 证据 / 观点 / 预警 / 历史
```

每个框是职责，不要求每个框一个容器。小规模可以同一Worker内多个纯模块；某个模块需要Python时可通过文件/HTTP边界外置，不拖全站迁移。

## 3. 拟议代码职责与路径

| 职责 | 已知可以复用的路径 | 拟新增位置/约束 |
|---|---|---|
| 纯类型、时间、数值、方法与schema适配 | 现有`js/chart/`、`chartStructureSnapshot.mjs`等纯逻辑，需核DOM依赖 | `shared/research/`（拟新增）只含纯逻辑，不含secret/网络/DB |
| 市场适配与持久 | `cloudflare/binance-klines-worker.js`、`cloudflare/schema.sql` | 局部adapter/sidecar，不强制整文件拆分 |
| 统一capture与run | `cloudflare/snapshot/marketSnapshotProgram.mjs`、`market-snapshot-worker.mjs` | `cloudflare/research/capture/`（拟新增）或合并现有职责，禁止第二份算法 |
| 新闻/事件/主张 | `cloudflare/yuqing/yuqing-facts.js`、`shijian/` | `cloudflare/research/events/`（拟新增）由旧入口适配 |
| 报告/预算/校验 | `cloudflare/yuqing/yuqing-worker.js`、`fenxi/` | `cloudflare/research/reports/`、`policy/`（拟新增） |
| 前端适配 | `js/pages/`、`js/app.js`、`js/config.js`、`js/features.js` | `js/research/`（拟新增），原生JS接口，非强制React |
| 研究批处理 | 未确认已有独立环境 | `research-jobs/`（拟新增、条件启用），只接受版本化合法输入 |
| 测试 | `scripts/verify-*.cjs`、Playwright、bounded runner | 在现有测试体系追加，不另造强制运行平台 |

新增shared目录是否符合当前治理布局需WP-001/007与治理负责人确认；若已有等价目录，使用它并更新本文路径绑定记录。目录迁移不作为业务功能已完成证据。构建清单只加入需要发布的前端模块，不能把政策密钥或完整文档包放入静态资产。[R16｜仓库事实报告§10，L285-310](../inputs/repository_facts.md) [R18｜仓库事实报告§12-13，L326-352](../inputs/repository_facts.md)

### 3.1 纯计算边界

每项方法函数概念上接收`inputs, config, context`返回`value, metadata, quality, dependencies`，但本文不声称仓库已存在这些函数名。纯模块不能隐式fetch最新来源、读全局设置、使用Date.now改变结果或访问DOM；now/cutoff显式作为context输入。

浏览器仍可使用纯模块做交互预览，正式报告使用封存输入和相同方法版本。计算大数据可转外部环境，但须提供同样schema和黄金样本；不要求多语言字节相同，数值容差及排序规则须预定。

## 4. 部署单元的初始选择

### 4.1 在线

保留Pages发布静态前端；行情Worker继续负责既有市场数据；yuqing Worker承载新研究入口/模型适配/报告。独立snapshot Worker是否保留部署取决于是否已被真实消费者使用；如果只是本地实现，则复用纯逻辑而不是为了名字再部署一份。

若两个Worker使用不同D1，研究run需把所选输入复制或引用到自己的封存bundle，不能假设跨库事务。市场Worker提供版本化查询/观测读取，研究域不直接写市场库的采集状态。

### 4.2 批处理

事件研究、长历史扫描和期权独立校验允许一个按需环境（Node或Python以真实依赖决定），读取导出的合法固定输入，输出结果JSON/Parquet和manifest。先可在本地隔离环境执行研究，不成为生产网站持续依赖。需要云端批任务时另核费用、密钥、区域、持久磁盘与触发机制。

### 4.3 长期采集服务

只有既有Worker/WS路径在目标任务下无法满足连续性或资源条件，才将具体采集器迁到独立长期进程。第一步是复制协议/契约并做影子对照，不同时扩市场、换数据库、换指标。独立采集不能解决上游本来不提供的完整性或历史，仍需标来源范围。

## 5. Cloudflare限制与自己的假设分开

截至查询日，D1官方限制包括免费单库500MB、付费单库10GB以及SQL执行30秒等；付费单库上限不是可随意调高的参数。读副本/Sessions可以影响读取扩展与一致性，但bookmark不是“固定历史在这个版本”的业务快照。[S062｜D1限制](https://developers.cloudflare.com/d1/platform/limits/) [S063｜D1读副本](https://developers.cloudflare.com/d1/best-practices/read-replication/)

Workers CPU默认与可配置上限、不同触发类型的生命周期需按当前计划核对，不能把CPU等同等待外部网络的墙钟时间。DO出站WebSocket不能使用面向入站连接的休眠机制；这会影响长连接成本而不意味着平台不能用WS。[S065｜Workers限制](https://developers.cloudflare.com/workers/platform/limits/) [S066｜DO WebSocket实践](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)

Workflows/Queues按确有恢复/解耦需要引入。持久步骤也有资源与保留边界，队列至少一次投递仍需要应用幂等。不要把这些服务同时加上才叫“可靠”。[S067｜Workflows限制](https://developers.cloudflare.com/workflows/reference/limits/) [S068｜Queues交付](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)

本报告没有真实D1容量、并发、调用频率和账单，不能声称现有免费额度够用，也不能声称必须迁库。第一批测量关注真正使用的查询、输入体积和失败类型，不测一个与业务无关的合成跑分就决定架构。

## 6. 存储选择与数据所有权

### 6.1 D1保存什么

原有市场表继续承担现有有限窗口；新研究元数据包括source政策、run状态、bundle引用、方法注册、事件/主张版本、报告head、观点、预警、预算和迁移账本。小payload可存在D1，大输入对象按实际大小与权利选择对象存储。

拟议小payload阈值例如256KiB是设计起点，不是官方硬限制；应结合行/查询/响应限制测量。不能把完整多日足迹/新闻全文打成一个无限JSON塞到一行。metadata与body分离让列表查询不加载巨型正文。

### 6.2 对象存储保存什么

获准保留的输入包、较大规范化市场片段、报告成品、研究结果文件。对象键尽量内容寻址或不可变版本：`research/{owner_scope}/{kind}/{sha256}`，不把可猜的key当权限控制。public访问与private权限必须通过API/签名授权，而不是裸公开bucket。

如果当前已有可用对象存储，优先评估复用；R2是与现栈较近的候选，不是数据证据正确性的必要条件。使用R2时其强一致对象语义仍不产生跨D1事务，CDN/客户端缓存也是另一层。[S069｜R2定价](https://developers.cloudflare.com/r2/pricing/) [S070｜R2一致性](https://developers.cloudflare.com/r2/reference/consistency/)

### 6.3 原始数据与衍生结果

输入尽可能不可变保存；上游修订创建新版本，不覆盖已摄取对象。对象哈希证明内容一致性，不证明源真实性、覆盖或许可。不能仅保存source URL而声称未来能重放，网页可能变化/消失；也不能为重放违反保存限制。

旧高频记录可以按既有策略滚动，长期研究保留必要的获准输入/结果。是否保存所有原始ticks是单独成本决策，不是证据链的无限前置。

## 7. Run、Bundle与Artifact的身份

`run_id`标识一次任务及其状态，通常UUID/等价安全ID；`bundle_id`标识一组封存输入；`artifact_id`标识终稿结果；`report_id`是对用户稳定的报告身份，可有多个revision。不要用当前时间字符串同时充当四者。

Bundle内容哈希包括标准化输入、来源身份/版本、参数与质量状态，按定义稳定排序；不包含随机request_id、渲染顺序或sealed timestamp等可变运行元数据。metadata单独保存。Content digest变化后必须是新bundle，不能更新原bundle的payload。

源原文哈希与规范化输入哈希分别保存：前者追查上游修订，后者确定计算等价性。规范化空白/数字时不可丢失否定、精度和单位。null与字段缺失在schema中有明确区别，不能在不同语言间静默等价化。

## 8. 封存提交协议与失败恢复

### 8.1 有对象存储时

1. 任务取得有效lease/fencing token，生成有界capture清单。
2. 规范化和质量检查后形成bundle payload，计算内容摘要与大小。
3. 写不可变对象，记录对象key/hash/size与policy；必要时验证可读性，不把ETag无条件当SHA256。
4. 在**同一个研究D1数据库**的事务范围内写bundle manifest、依赖引用、run状态/当前fence和可见head。只有提交成功才对外显示SEALED。
5. 若对象写入成功而数据库失败，它是暂时孤儿，可重试相同内容或后续GC；不能对外发布一个只有对象但无完整manifest的run。
6. 若数据库记录存在但对象校验失败，读API返回artifact_unavailable并阻止模型继续，不假装内容为空。

D1 batch有其单数据库事务语义，不能横跨行情库、研究库和R2。需要跨组件时使用上述显式提交/补偿，而不是宣称一个大事务。[S064｜D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)

### 8.2 仅小payload在D1时

payload和manifest可在同库事务封存，仍需fence防止过期worker写入。超过大小阈值时拒绝或改对象路径，不自动截断证据。保存输出摘要但缺输入时，restore_level降为evidence_snapshot，不能叫exact_inputs。

### 8.3 并发与租约

同一run执行者使用lease_owner、lease_expires_at和单调递增fencing_token。续租必须核对owner/token；旧任务在网络恢复后不得覆盖新worker的结果。所有commit带expected token条件，不只在任务启动时检查一次。

用户双击或网络重试使用Idempotency-Key与request_hash；相同key同请求返回原run，不同请求冲突409。幂等键带owner与操作类型，不能跨用户碰撞。key过期策略和缓存分开，不因为HTTP缓存失效就新建模型请求。

## 9. 执行方式与恢复等级

### 9.1 Request-bound快速任务

适合有限输入、无重型检索的brief。请求存状态并在连接有效期间执行；客户端断开或取消即停止后续步骤、记录stopped/partial，不能用“以后后台继续”误导用户。已发出的模型请求可能无法撤销费用，账本另记。

### 9.2 Durable任务

只有对应执行器已配置并通过故障恢复测试时开放deep_dive等durable模式。可以采用现有Cron+任务账本处理有界步骤，或Cloudflare Workflows；选择由实际运行时长/恢复延迟/维护成本决定。工作流持久状态不是报告长期档案，成功终稿仍写artifact store。

队列只处理解耦/缓冲需要。至少一次消息必须与幂等step key结合；一个step的模型调用不因重复消息自动多跑。无法获得供应商请求结果时标uncertain，不无条件认为未发生。[S067｜Workflows限制](https://developers.cloudflare.com/workflows/reference/limits/) [S068｜Queues交付](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)

### 9.3 取消与资源释放

run有cancel_requested_at。每次外部调用前/后、提交前检查；取消时释放reader、AbortController、定时器与未使用预算。已sealed bundle和已发布artifact保留，取消不会删已存在报告。外部请求已发送后保留unknown cost直到对账，不错误返还全部预算。

## 10. 缓存：依赖身份比TTL更重要

| 缓存对象 | Key必须包含 | 失效/读取策略 |
|---|---|---|
| source response | source+endpoint+params+policy scope | 按ETag/TTL/数据版本，不能跨授权 |
| normalized metric | input digest+method version+params | 输入修订即新key |
| run query | run/bundle+schema+owner scope | sealed可缓存，权利撤销/删除另行拦截 |
| live changes | scope+comparison run+current run | 不用symbol单key覆盖所有历史 |
| report rendering | artifact/revision+locale+render version+rights | 旧报告不被新模型输出覆盖 |
| private notebook | owner+object revision | private/no-store或受控本地缓存 |

不可变对象可长缓存不代表永久允许显示；每次授权读取还要检查权利/删除tombstone。progress SSE、错误/缺失与受限内容不进入公共长期缓存。R2对象一致性不能消除应用缓存错误。

## 11. API读模型与页面性能

页面不每次把全部原始数据拉回来重算。首页读预计算brief/read model，详情按需加载特定事件/指标/窗口；历史列表不返回所有grounding全文。分页采用稳定排序和cursor，响应含schema/run/version以抵御过期请求。

拟议交互目标是普通已缓存研究首页快速可读、重型研究异步显示进度，不承诺某个毫秒值。实施前记录旧版同任务p50/p95、payload、请求数量、首个有用事实出现时间，再设目标；不要只优化页面骨架秒开而事实仍等很久。

首次读取缺对象时提供明确重建/不可重建状态。warmup只针对测得的冷启动问题，不默认常驻服务持续烧费。缓存命中率不是唯一价值，错误版本命中越高反而越糟。

## 12. 预算与费用模型

月费用拆分为：平台基费/请求CPU、D1读写存储、对象存储与操作、数据授权、模型输入输出/thinking/搜索、离线计算、日志备份和维护时间。R2有明确存储和操作定价，但它不是全部系统账单。[S069｜R2定价](https://developers.cloudflare.com/r2/pricing/)

建议测量表：每类型run输入字节、对象数量、模型调用次数/units、重复率、耗时、失败重试、输出大小、保留期。用真实分位估算容量，而非“每分钟一个run都差不多”。每天20次、每包100KiB只可作为算术示例，不是当前负载；主体数据市场桶可能远大于报告。

硬预算需要所有相关调用经过同一预算路径，并能界定最大费用。旧legacy报告如仍绕过账本，则只能称新链路预算受控，不称全系统硬限额。无法确定供应商自动搜索单位的调用不进入严格预算profile。

## 13. 安全与数据用途

读取公共行情与写私人观点/启动模型是不同权限。当前认证方式未知；新增write API必须在部署前绑定有效身份/权限，不能只靠隐藏按钮或CORS。数据库、模型key和源凭据仅在服务端secret；日志和导出不包含。

外部HTML/Markdown按不可信内容净化，链接协议/域和附件类型验证。工具不接受任意SQL、任意代码和任意URL。source policy约束收集、正文保存、外部推理、公开显示、导出、评估和保留，未知默认阻止相应新增用途，不扩大已知权利。

数据主体或供应商要求删除/限制时，immutable意为“不无痕改事实”，不意为拒绝合法删除。可删除受限body并保留允许的tombstone和不可重放说明；不能为保证审计把违法保存内容藏在备份。

## 14. 观测与故障定位

每个run/step记录状态转换、依赖、source freshness、error_code、attempt、input/output digest、duration、budget reservation/settlement以及fence；不记录私有密钥或模型私有推理。模型输出错误与网络故障分开，计费不确定与确定未发送分开。

最小仪表不是几十个Grafana面板：最近成功采集、异常/缺口、待重试任务、provider_outcome_unknown、未验证报告、source policy失效、预算剩余和清理影响即可。出现用户说“报告没有更新”时，能定位是source、capture、compute、model、validation、publish还是缓存，避免盲目增加重试。

备份恢复验收以重新打开一个pinned view、复算一个metric和找到原reportId为准；有备份文件但无法关联对象manifest不算成功。

## 15. 迁移路线与回退

```text
当前页面/数据/报告
 → 局部语义修正（不改变部署）
 → 新研究schema与输入捕获（旧读仍可用）
 → 统一方法/变化结果（影子对照）
 → 新brief与证据页（feature flag）
 → 事件/观点/预警模块逐项启用
 → 经过测量后选择批处理或特定服务外置
```

每次切换一个数据/业务链，保留旧读或legacy renderer。新写入owner确定后不允许旧任务继续覆盖v2head；回退使用读取/运行开关，不drop新表。历史迁移与大规模治理分工见卷12/13。

比较A/B/C不是一次性终身选择。业务层先统一研究语义不阻碍未来迁库；保存明确数据契约与输入版本可以降低迁移风险，比一开始选一个“永远够用”的数据库更实际。

## 16. 架构验收

静态：所有新增模块只有一个职责owner；前端包不包含secret/server代码；同一个方法不在多个目录复制；新路径与发布清单一致。契约：bundle/hash/time/policy/query与旧适配一致。故障：对象写成功DB失败、租约过期旧任务提交、队列重复、模型超时、客户端取消、cache旧版本、来源权限撤销均有样本。

性能：只有运行了代表性任务才宣称满足目标；没有生产数据或授权就使用有限副本并保留负载外推限制。本轮没有部署任何架构，也没有运行上述实验。
