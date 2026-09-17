> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# 卷 10｜API、持久模型、数据契约与状态不变量

本卷是拟议研究域的接口设计，不是对当前数据库或路由的描述。已有行情表、报告表和接口仍以仓库源码为准；当前已知文件见卷01。包内 `contracts/research.schema.json`、`openapi.design.json`、`research_schema.proposed.sql` 和 `settings.design.json` 是可供开发者校验、适配的设计参考，**没有应用到任何仓库或数据库**。新增表均用 `research_*_v2` 区分；正式迁移编号、绑定、目录和认证由WP-001/015确认。

## 1. 契约优先级与职责

研究对象先遵守本卷的时间、权利、状态和引用不变量，再遵守JSON结构。结构校验只能证明字段形状满足要求，不能证明文章内容真实、数字正确、来源允许使用或查询没有未来信息。市场计算采用卷04/05的方法，内容筛选采用卷03，模型任务采用卷07；不能在API层另创第三套指标定义。

遇到冲突时，当前交易所协议约束来源字段；本方案的显式业务语义约束归一化结果；锁定版本的schema约束序列化。若来源变化使旧方法失效，提升适配/方法版本并拒绝无声转换，而不是修改测试让旧输出继续通过。旧报告保留旧方法语义，不用当前规则反写。

服务端提供owner身份和可信时间，不接受客户端自称属于其他owner、不接受模型指定policy、不接受任意SQL或文件位置。用户可提出研究时间和参数，但实际能力、数据权限、预算和允许窗口由服务端确认。新增接口不是匿名公开API。

## 2. 六种身份，不再混用snapshot/run/report

| 身份 | 生命周期 | 唯一性与作用 |
|---|---|---|
| run_id | 一次研究请求到完成/失败 | 容纳多个采集、模型步骤和一个最终产物引用；不是数据内容哈希 |
| bundle_id | 一组封存输入与方法清单 | sealed后不可变；新增证据生成child，父bundle不被覆盖 |
| artifact_id | 一个获准保存的内容对象 | 记录digest、位置、大小、权利、过期；位置不作为真实性证明 |
| evidence_id | 某bundle内可定位的证据 | 与bundle联合寻址，指向artifact和JSON pointer；不假定全局同名永远同值 |
| report_id | 已验证的最终报告 | 输入bundle与输出artifact固定；预览不借用它充当最终产物 |
| research_view_id | 用户保存的研究现场 | revision控制选择、注释和绝对窗口；不同于一条分析观点 |

Viewpoint另有viewpoint_id，表示用户关于市场的可修订判断；Forecast另有forecast_id，表示有明确定义、截止和结算规则的概率问题。它们不能共用“日志ID”后丢失不同生命周期。Article与Event也分离：一个事件可有多篇文章，一篇文章可涉及多个事件，转载关系不等于独立证据。

## 3. 数字、时间与哈希

### 3.1 Wire表示

市场价格、数量、名义金额、指标值使用十进制字符串或null，例如 `"64000.25"`；不得使用NaN、Infinity或把缺失写成0。概率0—1、计数、标注像素等可按schema使用数值，但不得将混用的财务小数悄悄转成低精度显示结果再计算。整数ID来自上游时保留字符串。

`unit`是强制业务字段，`quantity_unit=BTC`、`USD_notional`、`contract`不能互换。百分数存比率还是百分点由方法注册表声明，显示层负责格式化；`0.0001`费率应按定义显示，而不是靠字段名字猜。没有合法单位转换时返回qualified/missing，不猜合约乘数。

时间使用带Z或显式偏移的RFC3339值，入库规范化UTC。日期级发布保存其精度，不虚构午夜作为真实发布秒；若为了排序生成边界时间，应另记录 `time_precision=date` 和所用保守对齐规则。交易日、结算日和自然日不是同一概念。

### 3.2 必须由域校验实现的不变量

`window.start_at < end_at`；capture_start不晚于capture_end；sealed不早于capture_end；所有被纳入system_observed历史run的received_at不晚于knowledge_cutoff；市场窗口不穿越market_cutoff。实时run允许知识截止稍晚于市场截止，但必须展示这两个时间。

published_at可能早于received_at，但发布网站时钟异常时需要质量标记；不能一律修改时间来满足排序。只有received_at字段而没有历史日志时，不许把新抓取的旧文章认定为系统当年已经知道。publicly_available模式需要可信发布时间与相应历史版本，不能直接复用最新版。

每个evidence_id在bundle内唯一；所有numeric_refs必须能解析到相同bundle或明确列出的父/子证据映射。模型引用一个不存在的ID是验证失败，不能由渲染器搜索相似标题补上。

### 3.3 内容哈希规则

当前Bundle声明canonicalization_version=btc-ascii-key-json-v1：键仅允许非空可打印ASCII，字符串原样保留Unicode，整数限JS安全范围，金融小数使用字符串，不允许浮点JSON数，递归按ASCII键序、UTF-8、无多余空白，数组保持顺序。它是本方案受限profile，不冒称完整RFC8785/JCS；需要任意Unicode键或浮点数时另选并验证完整实现、提升版本。Artifact.digest和byte_length对应storage_locator实际字节，EvidenceRef.digest对应所定位对象的规范化内容。两种摘要不能混用；本包canonical样例另存为真实字节文件。

计算bundle摘要时排除自身digest字段，包含时间口径、输入artifact digest、证据定位、方法与policy版本，不包含可变的last_access_at。展示标题改动是否改变digest按对象类型决定，不允许临时“为了缓存”忽略影响含义的字段。

同一个内容摘要不能绕过owner或来源权限：跨用户可复用底层对象属于内部实现选择，API仍按权限访问；不能提供公共“这个哈希是否存在”的探测接口。R2 ETag不自动等于业务SHA-256。哈希正确只证明字节一致，不证明来源真实或市场覆盖完整。

## 4. 持久模型：30张拟议表的必要性与裁剪

这些是逻辑设计的完整集合，**第一版不必全部创建**。R1首先需要来源用途、输入快照/引用、结果及幂等身份这些逻辑责任；可以由现有报告表与小型JSON清单承载，并不要求分别新建同名表。仅在启用模型时才需要调用/预算记录；只有持续恢复需求成立时才增加租约等执行状态。事件、观点、预测和预警随能力启用。更简单的现有表能等价承载时可以映射复用，但必须保留约束。

| 表族 | 保存什么 | 写入owner与更新政策 |
|---|---|---|
| source_policy / instrument_spec | 使用权及有效期规格 | 单一注册模块；新版本追加，当前引用显式更新 |
| artifact | 内容索引、存储与权利 | 内容写入器；payload不就地修改，availability可因删除/权限变化更新 |
| run / bundle / evidence | 请求执行、固定输入和引用 | capture协调器；run状态可变，sealed bundle及引用不可变 |
| observation / metric | 观察版本与已计算指标 | 各来源适配/方法层；观察修订新增，不覆盖旧证据 |
| article_version / event_version / event_article / claim_version / event_head | 文档、事件、主张及当前头指针 | 内容域；版本追加，head用版本条件推进 |
| report / report_preview / model_step | 最终报告、短期预览、模型输入输出关系 | 报告域；preview可覆盖，final不可覆盖；step按attempt记录 |
| budget_account / budget_ledger | 周期预算及调用预留结算 | 唯一预算模块；所有入口共用，不由Agent自行计数 |
| view_version / viewpoint_version / forecast | 研究现场、观点与预声明概率问题 | 用户研究域；修订保留，forecast结算有依据 |
| alert_rule / alert_episode / outbox | 规则版本、状态转移、投递计划 | 预警域；CAS推进状态，与outbox同事务写入 |
| idempotency / legacy_link / audit_event | 请求去重、旧链接、操作轨迹 | 平台适配层；不混用领域内容存储 |
| review | 固定观点revision与后续结果bundle的复盘 | 研究复盘域；不改原观点，用新artifact保存 |
| study / evaluation | 实验预声明与结果 | 批研究/评估域；配置摘要固定，结果另artifact |

SQL使用文本保存JSON与十进制值，索引字段独立抽取，不要求先开启FTS或特殊扩展。payload_json不是任意垃圾桶：对应schema、大小限制、版本与域校验必需。关键过滤条件如owner、known_at、source、status和bundle不能只藏在巨大JSON中，避免每次历史查询全扫描。

外键只能保护同数据库中存在的关系，不能证明owner相同；应用层还须验证bundle/run/artifact/owner一致。删除不简单CASCADE所有研究历史；根据保留与权利规则生成缺失/受限状态，保留允许的标识和原因。forecast概率使用REAL可满足此处0—1评估，但不是金额计算接口。

## 5. 原始行情的增量修改，不强迫搬进研究表

当前行情表包含K线、足迹桶、强平与衍生指标，它们继续承担在线数据供给。新的研究表捕获用于某次研究的窗口输入或衍生证据，不复制全量市场库。原始行情新增source/spec/revision信息应在其现有owner处实施，具体ALTER或新表方案必须检查真实schema和迁移历史，包内SQL没有假造这些旧表。

K线建议新写入身份至少含venue、market_type、source_symbol、period、open_time和适配版本。业务展示的“BTC主价格”通过selection segment引用物理来源，不在同一主键下用另一交易所无声覆盖。如果实际旧表修改风险高，可追加来源侧表和读取适配，但关联键必须可唯一确定，否则不能伪造来源历史。

旧数据无法证明来源时标legacy_unknown；已有source元数据的衍生指标可迁为无交易所暗示的metric_key+source_id，但不能因为旧槽名funding_binance就覆盖真实Bybit标识。迁移清单记录行数、时间范围、未知比例及不可复算边界。

## 6. API公共约定

包内OpenAPI提供39个操作的机器可读起点。所有路径为拟新增 `/api/research/v2`，正式挂接既有Worker或新边界由WP-001确定。文档不要求在Cloudflare之外新增API网关。

成功信封为 `{data, request_id, next_cursor?}`。HTTP200不表示数据完整：quality与reason_codes仍必须检查。错误为Error对象，客户端按code而不是匹配中文message判断；message用于显示，details不能暴露token、内部网络、原始SQL或受限正文。

分页采用稳定游标，编码查询过滤器、排序键和快照/known截止，不把page=2建立在不断变动的latest集合上。默认limit与最大100是拟议API保护值，不是已测吞吐；更改要更新文档和测试。客户端不得借扩大limit绕过来源条款或内容导出限制。

GET不触发模型、不采集大段新历史、不生成计费任务；POST创建任务或导出；PUT更新有revision的用户对象。条件化批处理未启用时返回EXECUTION_UNAVAILABLE，而不是接受任务后永久queued。

### 6.1 关键错误映射

| HTTP | code | 客户端与任务含义 |
|---|---|---|
| 400 | INVALID_INPUT | 修改参数，不自动重试；包括非法窗口、单位、未知method |
| 401/403 | UNAUTHENTICATED / FORBIDDEN | 身份/owner问题；不展示私有对象是否存在 |
| 403 | RESTRICTED_SOURCE | 返回可披露的限制原因与允许降级，不偷偷换来源 |
| 404 | NOT_FOUND | 无对象；对受限对象是否统一404由认证策略决定 |
| 409 | CONFLICT | 同幂等键不同请求、状态冲突或不可覆盖对象 |
| 412 | PRECONDITION_FAILED | If-Match落后，前端获取新revision后让用户合并 |
| 422 | INSUFFICIENT_HISTORY | 参数形式有效但无法完成所请求方法；允许明确缩窗口 |
| 409/503 | BUDGET_NOT_CONFIGURED / EXECUTION_UNAVAILABLE | 未配置预算或执行器；模板/只读路径仍可用 |
| 429 | BUDGET_EXCEEDED / RATE_LIMITED | 区分本系统预算与上游限流，给安全重试建议 |
| 503 | SOURCE_UNAVAILABLE | 可以降级已获准部分，不无声填值 |
| 202或查询状态 | PROVIDER_OUTCOME_UNKNOWN | 请求可能已经计费/执行，先对账不自动重复 |

OpenAPI错误响应的通用引用不排除上表具体状态；实施时按各操作补齐状态响应与响应头的端到端测试，不能因为例子列了400/403/409就把所有错误统一409。

## 7. 创建run：幂等、预算、捕获与执行模式

`POST /runs`要求Idempotency-Key，服务端对规范化请求计算request_digest。同owner+operation+key且digest相同，返回已有run；digest不同返回CONFLICT。不同owner的相同key互不影响。幂等记录保留期须覆盖客户端和任务的重试窗口，但它不是报告归档期。

创建时验证profile、capabilities、源权限、历史窗口及generation_mode。RunRequest明确template/model和独立knowledge_cutoff_at；template允许budget_profile_id=null，model必须提供已确认配置。capture_kind=historical时知识截止不可空；live留空由服务端捕获并返回实际值。执行方式request_bound/durable独立于是否使用模型，不允许把template当成网络执行器。市场简报只需要必需market inputs；options未启用、ETF无历史不应使它整体失败。

request_bound模式在当前受控请求生命周期执行，客户端断开或截止后标interrupted/cancelled，不宣传后台完成。durable模式只有真正启用且测试过的持久执行器才接受；用户关闭页面之后可继续的能力需要运行环境保证，不能靠状态字段想象出来。

预算预留先于外部调用，每个step标root_run_id和reservation_key，重试不能绕过总额。价格目录缺失、搜索查询数无法约束或供应商费用上界未知时，不宣称严格货币封顶；可禁用相应计费工具，或按用户明确接受的软预算运行并清楚标记。成本估算不是支付承诺。[S025｜Gemini定价](https://ai.google.dev/gemini-api/docs/pricing)

## 8. run状态、模型step与最终报告

run状态定义为created→capturing→sealed→analyzing→validating→published；部分数据但满足最低目标可degraded；失败/取消/中断单独终态。provider_outcome_unknown可以阻止重试并等待人工或供应商对账，不伪装成确定失败。

每次修改状态必须匹配预期旧状态和lease_epoch。旧worker在租约失效后拿到迟到响应，不得覆盖新worker的产物。状态变化本身产生audit_event，记录阶段与原因而非大量敏感prompt。任务重试创建新attempt，最终artifact只能由当前epoch发布。

模型step必须保存实际发出的input摘要、prompt/model/tool配置版本及必要用量；模型名不是“智能等级”，版本与参数不同是不同实验条件。保存真实请求内容以支持重放时仍须经过权利/隐私检查；不允许保存的内容用受限引用和精度边界替代，不伪称完整复现。

预览用report_preview短期存储和step_seq推进；最终report通过验证后新写入不可变artifact和report记录，run再指向它。生成中的旧同ID更新逻辑可以经适配保留，但新最终报告不得用INSERT OR REPLACE覆盖。需要修订时supersedes指向前一版本。

SSE是传输协议，不是事务或持久队列。事件带单调step_seq，客户端忽略重复/落后帧；预览明确“未验证”。用户打开另一个run时取消旧订阅，不能让迟到的final帧覆盖当前选择。SSE重连从已保存状态恢复显示，持久性由execution_mode决定。

## 9. 封存bundle与对象存储提交协议

建议流程：采集候选→域校验→生成内容artifact→写入对象/内联内容→验证digest与必要可读性→同D1事务写manifest、evidence引用并推进run到sealed。对象存储与D1没有共同事务，必须接受对象已写、数据库未提交的中间状态。D1 batch只在相同数据库内提供事务保证。[S064｜D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)

封存失败时已写对象进入待清理集合，不能立即删除正在其他run引用的内容。清理按引用检查、保留宽限和owner/policy执行；宽限时间是配置，不是本方案凭空给出的平台保证。对象写成功但读取缓存旧结果时检查实际对象key和digest，不使用缓存来宣告数据丢失。

一个bundle引用的所有artifact是否仍可读属于运行时状态；bundle自身保持历史manifest不变。如果条款撤销必须删除原文，artifact availability更新restricted/deleted，历史页面恢复级别降低。不可变研究记录不优先于删除义务；同时不伪造“当时输入仍完整”。[S070｜R2一致性](https://developers.cloudflare.com/r2/reference/consistency/)

新增搜索证据时生成child_bundle，知识截止相应推进或保持明确历史边界。历史任务不得因后来找到一篇“旧文章”就将新信息混入system_observed过去；可转为另一个retrospective_latest研究，原run不改。

## 10. 事件版本、合并与拆分接口语义

`GET /events?known_at_lte=T`返回T时已纳入系统的版本；默认head仅适用于当前工作区，历史bundle固定event_version_id。同事件的新闻更正新增版本，不修改旧事实池。`scheduled_at`只来自已确认日程；published_at不能借此字段渲染为未来催化剂。

自动合并先记录候选关系和原因，避免不可逆地吞并两起相似事件。合并A/B为C后，保留alias和来源；如果发现错误可拆分新版本，旧report继续指向它曾使用的版本，并附后来的更正提示。不得删除原版本导致旧引用404。

source assertions、程序计算facts和分析interpretations分别保存。两个媒体引用同一公告对应一个origin group；来源数量多不等于独立确认多。冲突主张双向关联，不通过平均情绪消除事实冲突。相关性/优先级规则版本也进入payload，以便复盘“为什么当时没展示”。

## 11. 研究现场与观点写入

`POST /views`使用ResearchViewCreate，创建请求不包含owner/id/revision/restore_level等服务端字段；返回ResearchView。PUT的完整对象仍必须拒绝不匹配会话的owner，服务端生成/校验身份和时间。Viewpoint/Forecast/Alert创建采用对应Create协议。PUT要求If-Match与当前revision一致；保存新version并推进head的方式由存储适配确定，包内只保存版本表，不隐含客户端能任意回写旧revision。

view保存绝对窗口、run、bundle、选中事件版本和注释revision，不只存scrollPosition。恢复时检查实际数据与权利，返回exact_inputs/evidence_snapshot/report_only/restricted/missing之一。UI不能在missing状态下自动用latest行情伪造旧现场。

viewpoint是用户研究判断，可以写“尚不判断”“等待某条件”，不是每条都强迫选择上涨/下跌。修改观点形成新revision；作者、时间、旧依据和失效条件保留。若后续对外展示这些观点，应另处理个人资料、风险表述和来源权利。

forecast比viewpoint更严格：必须先声明目标、deadline、参考价格/观察规则、数据中断与替代来源规则。没有校准范围时probability_status=experimental；没有概率时null而不是50%。命题改变应新建forecast，不能在结果出现后修改原题使其命中。

## 12. 预警状态与outbox原子边界

同一个rule_revision、instrument、window_end只能推进一次状态。运行中数据过期切换data_state，不把市场状态自动记为RECOVERED；恢复后补评已完成窗口，依据明确的catch-up策略防止一下发送很多历史提醒。

状态推进、episode创建和站内outbox写入在同数据库事务内完成。多个调度竞争时使用revision条件更新；失败者重新读取，不生成第二条episode。外部通知不在本轮默认范围，未来开启仍只能提供至少一次/幂等尽力语义，不能承诺任意外部平台严格只投递一次。

用户改变阈值生成新rule_revision；旧episode不被新规则追溯改写。清理时先保留规则摘要、触发证据与最后状态，再按策略删除过期通知payload，防止历史预警失去依据。

## 13. 查询权限、导出与缓存

同一个owner的私有研究和公共市场数据也不能默认共用可公开缓存。缓存key包含owner/权限版本、schema/method、bundle或显式latest指针版本；公开缓存只处理已经确认可公开的数据集合。权限撤销时要使旧缓存失效，不能仅修改数据库policy。

`POST /reports/{id}/export`重新检查导出时权利，不复用当时生成权限。允许导出的Markdown包含数字来源、窗口、版本和恢复等级；受限字段显示说明。导出是生成派生副本的动作，不应把整个数据库和API凭据打包。

旧reportId链接走legacy_link。存在正文但没有完整证据时返回report_only；不存在且已过清理期时明确无法恢复。历史API接受30天不等于后端保存30天，这一现有差异需要迁移和UI一起修复，不能只扩大请求参数。[R06｜仓库事实报告§3 A1-A3，L62-90](../inputs/repository_facts.md)

## 14. 合同测试与验收

结构测试：合法示例通过、额外字段/NaN/非法概率/未知enum被拒绝；跨字段测试：逆时间、错owner、跨bundle数字引用、权限未知外发、迟到step发布、旧revision覆盖分别失败。schema文件通过不等于所有跨字段规则已实现。

API测试：GET不会触发模型；同幂等请求返回同run；同key不同body冲突；pagination在固定known截止下稳定；SSE预览不被当最终；budget未配置不发外部请求；限定能力未启用返回明确状态；legacy URL不被重定向到错误的新报告。

存储测试：模拟对象写成功DB失败、DB约束失败、bundle遗漏artifact、权限撤销、清理碰到pinned输入、租约竞争；恢复后无悬空“已发布”状态。SQL在普通SQLite可建表仅能说明参考语法，不证明D1远程迁移、性能、事务边界或现有表兼容。

实施者应提交contract版本、实际路由绑定、字段映射和上述测试结果，再让消费者接入。接口审阅不是单独的漫长前置项目：R1只实现简报路径需要的对象，其他对象随独立能力交付，禁止为了建完30张表而延迟第一个有用简报。

## 15. 模型候选到正式报告的显式转换

卷07的research.synthesis.candidate.v1是P03输出，不能直接写入最终report表。服务端映射observations→facts、watch_conditions→conditions、unknowns→limitations；每个条件分配服务器claim_id，保留requires与research_action。numeric_refs的field必须定位到输入bundle允许字段；非value字段应注册唯一的细粒度evidence定位，不能忽略field。interpretations的alternative_explanations与limitation_codes进入正式NarrativeItem可选字段。summary是正式Report可选显示字段，其数字仍受同样校验。

report_id、validated_at、validator_version、artifact_id、content_digest由服务端产生，不由模型自称验证通过。forecast只有在能力启用、问题登记和结算规则成立时进入独立Forecast，不夹带进普通简报。自动结算必须有ResolutionRule结构化配置；只有自由文本resolution_rule的历史对象可人工审阅，不能由模型猜可执行条件。

卷04/06中的业务示例是概念字段，正式TradeObservation、FootprintBucket、Liquidation、OptionQuote、ETFDisclosure以contracts为准。适配映射必须覆盖单位与价格/数量语义，未知值不得为满足enum乱选。

## 16. D1条件更新的原子性细节：零行更新不会自动中止batch

“放进同一个batch”并不足以完成乐观锁。`UPDATE ... WHERE revision=?`匹配0行通常不是SQL错误；若后面的INSERT无条件执行，旧租约仍可能写出报告或重复预警。因此所有后续写入必须受同一成功claim/token守卫，或采用已验证的等价事务方案，不能只在batch返回后查看changes再补救已经发生的写入。

**报告发布的拟议事务规则：**生成该attempt唯一publication_token。在同一D1 batch中，先条件UPDATE run：owner、status=validating、lease_epoch、租约和尚未领取token全部匹配，写入token；随后report INSERT通过`INSERT ... SELECT ... FROM research_run_v2 WHERE run_id=? AND publication_token=? AND status='validating'`守卫；最后UPDATE run为published也要求同token和匹配的report/digest存在。任何SQL错误整体回滚；如果首次claim为0行，后续SELECT为0行，不能产生新的report/head。检查结果后返回conflict或已存在的同幂等结果。日期、token、ID均用参数绑定，不能拼SQL。

report_id撞到已有不同digest属于冲突，不使用INSERT OR REPLACE。相同幂等请求可读取已有相同digest产物返回；不同attempt不得覆盖final。artifact对象可能先写而成为孤儿，仍按对象/manifest协议清理，不通过发表错误报告来避免孤儿。

**预算预留规则：**读取account revision，生成全局唯一reservation_key；同事务条件UPDATE account，检查限额、revision和可用余额，增加reserved、推进revision并写last_reservation_key；ledger INSERT SELECT只从带相同key和新revision的account取值。唯一键冲突或其他SQL错误回滚。相同reservation_key重试先确认已有ledger并返回，不再次增加reserved；并发失败重读后仍必须重新检查余额。limit为null不能被视为无限已获批准预算。

**预警规则：**episode revision的条件推进与outbox写入采用相同transition token或等价受守卫INSERT；CAS失败者不能无条件生成outbox。SQLite/D1事务只能串行保护本数据库，不保证外部通知只发送一次。

model_step的step_id标识具体attempt记录，logical_step_id标识逻辑阶段；同run+logical_step_id+attempt唯一。重试保留parent/逻辑关系，不能用同一主键覆盖前次供应商请求和用量。以上属于拟议应用逻辑，尚未在本仓库D1运行验证；必须用CASE-073/074及真实适配测试检查。


## 17. 终审契约一致性

当前有效机器定义为research v2.1-design和collection v2-design。所有后端仍须独立做跨对象、时间、单位、身份和权限校验；包内离线参考校验不是业务服务实现。具体迁移与字段映射见[契约迁移](../../10_final_review/contract_migration.md)。

Report.state与Run.status分离：published说明产物已完成发布流程，不说明市场一定有变化或判断已经真实。Report可以initial_baseline、changes_available、no_material_change、partial、insufficient_coverage或insufficient_evidence。nochange需要coverage_id和comparison_bundle_id非空且引用有效，不能只靠模型选择枚举。

原先完整表结构不是首交物理建表清单。新元数据可先放现有报告/快照的版本化payload，并将查询或并发真正需要的字段独立索引。迁移位置由实际schema决定；不为保持文档30张表而拆成多个服务。
