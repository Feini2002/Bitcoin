# 卷 08｜研究工作区、观点记录、历史恢复与低噪音预警

本卷为界面与状态的实施规格，不是要求另造一个复杂交易终端。主图底座暂保留Lightweight Charts 4.1.3；v4→v5迁移有API差异，应作为独立对照任务而非工作区改造的隐含前置。[R02｜仓库事实报告§1，L16-26](../inputs/repository_facts.md) [S056｜Lightweight Charts v4到v5迁移](https://tradingview.github.io/lightweight-charts/docs/migrations/from-v4-to-v5)

## 1. 当前界面资产与缺口范围

当前有多个接入页面、图表视口/缩放/指标本地状态，日报与分析页有reportId历史链接。报告没有证明存在绑定绝对历史数据版本的研究现场、跨页面证据/事件/笔记闭环或持久化预警状态机。[R12｜仓库事实报告§7，L183-201](../inputs/repository_facts.md)

因此升级不是“从零做图表”，而是把已有页面的状态变成可以在研究中共享、固定和复原的对象。首次交付可以只增强首页、图表、报告三处，不需要先做所有planned路由。

## 2. 研究现场 Research View

### 2.1 对象定义

一个研究现场包含：view_id、owner_id、title、run_id、input_bundle_id、time_mode、absolute_start/end、primary_instrument_id、comparison_instruments、active_panels、selected_event_version_ids、selected_claim_ids、method_versions、annotation_revision、created_at、updated_at和mode。

`mode=live`允许获取新run，但不会静默更新已保存的历史截图/注释。`mode=pinned`固定run和绝对窗口，显示当前存在更新的提示，由用户明确选择切换。保存的是研究语义而非纯像素布局。

现有scrollPosition/barSpacing仍可作为个人显示偏好，不能替代absolute_start/end或数据版本。随着6000根滚动窗口清理，旧scrollPosition可能指向另一时间；新view恢复时必须检查数据可用性。[R06｜仓库事实报告§3 A1-A3，L62-90](../inputs/repository_facts.md) [R12｜仓库事实报告§7，L183-201](../inputs/repository_facts.md)

### 2.2 恢复等级

| restore_level | 可恢复内容 | 页面提示 |
|---|---|---|
| `exact_inputs` | 当时使用的全部必要市场/事件输入和方法可读 | 可重放对应研究事实，模型措辞不保证字节相同 |
| `evidence_snapshot` | 有当时指标/证据与必要窗口，但不完整原文/逐笔 | 复原研究依据，不能承诺逐事件重演 |
| `report_only` | 仅旧报告和部分来源/上下文 | 旧档案，只读；原始图形可能不可恢复 |
| `restricted` | 权利/权限不允许当前读取 | 不暴露受限内容，说明合法可用范围 |
| `missing` | 对象或输入已不可得 | 显示不可恢复与已知原因，不自动换成最新行情 |

哈希存在但输入删除不能称exact_inputs。旧reportId兼容应返回最诚实的恢复等级；没有当时输入不得用今天历史数据覆盖旧图再称原现场。

### 2.3 共享状态管理

全局只共享研究身份和选择，panel自己的临时交互状态放在局部。切换instrument/window/run统一发state revision，所有数据请求携带revision；返回的旧请求若不匹配当前revision丢弃，不覆盖新选择。

已有治理已做请求取消/元数据隔离，实施者复用其机制；不要再加第二套全局轮询导致双请求。新的绑定层必须有dispose，取消定时器、取消网络请求、解绑事件、释放chart实例或订阅。[R16｜仓库事实报告§10，L285-310](../inputs/repository_facts.md)

## 3. 首页：三个阅读层级

### 3.1 第一层：一分钟内找到变化

页头显示当前run时间、市场窗口、知识截止和质量。主体是少量变化卡、重要分歧/反证与下一已核实催化剂，底部提供完整研究链接。不要将各种程序分数居中放大，不用色彩暗示不存在的概率。

无新变化时显示检查范围和最近一次重要变化，不自动生成四张“建议关注风险”卡。数据不足时优先告诉用户哪一部分无法判断，并保留可用的事实，不让空白页逼模型填满。

### 3.2 第二层：解释与条件

每张变化卡展开显示事实、解释、证据范围、替代解释和下次检查条件。事实和解释使用文字标签区分，不仅靠颜色。数值旁显示单位、窗口与来源；点击可查看method_definition和输入证据。

“下一步”只表达研究动作，例如核对披露、等待完成窗口、比较现货/永续；不默认显示下单按钮、仓位建议或不存在的账户风险。

### 3.3 第三层：原始证据与研究记录

证据抽屉包含来源、获取时间、发布时间精度、版本、引用片段/表格字段、质量和使用限制。若某段原文不允许存储或显示，提供允许的定位与说明，不为了完整UI复制受限内容。

可将卡片加入研究观点，自动带run/evidence IDs，但由用户编辑问题和条件，不让模型自动把每个观察变成必须复盘的预测。

## 4. 市场工作区交互

### 4.1 面板与链接

价格、成交/足迹、杠杆/强平、预期（期权条件启用）和事件标记共用时间轴语义。十字线对齐使用真实时间，不按数组index对齐不同采样源。低频值如OI在对应观察时间显示，不插值成高频事实。

右侧研究栏显示当前选中窗口的确定性事实。用户缩放后若未点击“以此窗口研究”，已有报告不自动重生成；防止每次拖拽触发模型费用。系统可以先本地显示预览统计，权威快照需用户或预定任务显式创建。

### 4.2 时间和来源切换

选择“BTC主行情”可能触发回退来源，必须显示来源段。若用户固定某所历史，则该源不可用时不能无声切换别的所；提供明确按钮查看替代源并新建研究视图。比较跨源时保留两条曲线/表，不以一个价格合成单所历史。

### 4.3 注释

注释锚点用时间/价格/指标ID和对应run，不存唯一像素坐标。用户划线可以是个人研究条件，不自动成为程序已验证的支撑阻力。`annotation_type=user_hypothesis`与`computed_level`分开，模型引用用户划线时明确其来源。

价格桶重聚合、时间分辨率切换或图表版本迁移后注释需要重新投影，不能静默改锚点。迁移失败时显示“原注释可读但无法精确定位”，允许人工修订新版本，原版本保留。

### 4.4 LWC升级选择

先用当前4.1.3适配完成研究身份和事件联动。若需要新版本pane/插件功能，单独试验相同数据、标注和生命周期行为，再决定升级；不要在同一任务既换主API又重做数据层。根据官方迁移文档核对新接口，保留旧接口适配范围。[S056｜Lightweight Charts v4到v5迁移](https://tradingview.github.io/lightweight-charts/docs/migrations/from-v4-to-v5)

## 5. 事件时间线与反证浏览

事件卡明确event time、published time和first seen；没有确切事件时间时不能强行放到单根K线上，可以作为日期范围标记。未来催化剂有排期版本与官方来源；新闻提及的未来事项进入unverified区。

同事件多条报道在一张卡内列出处和独立根源，不重复占主时间线。相反主张不合并成一个“平均观点”，显示asserted/denied/corrected关系；用户可看某历史run当时知道的版本。

事件与价格叠加只便于观察时间关系，界面不自动写“此新闻导致该K线”。用户将某事件加入研究时，系统创建pre/post窗口和研究配置，结果计算按卷06规则，不靠人眼事后找最合适窗口。

## 6. 报告页与差异阅读

### 6.1 结构

报告页显示：标题/问题、时间边界与模式、数据/证据质量、简要结论、事实、解释、分歧/反证、条件、未知、来源与方法、历史版本。长文折叠不是隐去局限，关键限制始终可见。

旧日报的全球AI/GitHub内容原样归档，标legacy report version；不因新产品定位删除。新主brief不再默认包含这些频道，用户可主动查看engineering_watch。

### 6.2 前后比较

提供“与上份比较”：新增/修订/撤回的主张、变化的数值/窗口/来源、触发或失效条件、未解决项变化。不要只做文字diff，因为换措辞不一定是新信息；基于claim/evidence IDs和语义版本比较。

如果旧报告无structured claims，可做有限文本/元数据比较并标`legacy_comparison`，不能假装拥有与v2同等级的证据差异。模型可辅助整理，但结果不覆盖旧正文。

### 6.3 流式与失败

预览文本醒目标注“生成中、未验证”，不能触发观点结算或金融提醒。验证完成后替换为带final artifact ID的终稿；失败则预览保留为失败草稿或按权限清理，不能继续放在历史页像正式报告。

刷新页面通过run/report状态恢复，不自动重复发起模型调用。取消按钮依据request-bound/durable模式明确作用；取消已提交外部请求不保证退款，费用状态可显示pending/unknown。

## 7. 研究观点库：不是交易账户日志

### 7.1 Viewpoint对象

拟议字段：viewpoint_id、author_type（user/model_assisted）、question、thesis、kind（description/hypothesis/forecast）、created_run_id、evidence_ids、counterevidence_ids、assumptions、trigger_conditions、invalidation_conditions、review_at、status、revision和tags。

观点与Research View区别：Research View保存看盘现场；Viewpoint保存要检验的论断。同一现场可有多个观点，一条观点可以随着新run追加修订。

### 7.2 状态

```text
DRAFT → ACTIVE
ACTIVE → CONDITION_MET / INVALIDATED / EXPIRED / REVIEW_REQUIRED
CONDITION_MET → RESOLVED / REVIEW_REQUIRED
任何状态 → WITHDRAWN（保留原因，不假装从未存在）
```

description类型未必有二元结果，不强制算胜率；hypothesis可以是未决；forecast需符合可结算协议。关闭提醒不等于观点已证明错误，撤回不应被统计为预测成功。

### 7.3 创建行为

从报告点击“跟踪”时，系统预填当前问题、证据与time，但要求明确kind和复核条件。若是forecast但缺threshold/deadline/source，则只能保存draft。避免模型一键生成大量含糊预测，后来选择性展示命中。

用户手动写观点的事实和模型生成的事实一样需要标来源；用户判断不因此变成已验证事实。私人笔记不默认给其他用户或公共模型，外发需要明确设置。

### 7.4 历史更新

修改假设追加revision。旧revision绑定的预测不改变；新增条件产生新forecast而不是修改原目标。未来页面显示“当前观点”和“当时观点”两条时间线，防止复盘被当下记忆重构。

## 8. 预测记录、结算与校准

### 8.1 Forecast契约

字段：forecast_id、viewpoint_revision、question_type、target_instrument、target_metric、operator、threshold、evaluation_window、deadline、price_kind、source_policy、publication_time、probability、probability_origin、calibration_status、resolution_rule_version、fallback_rule、void_conditions、status。

概率可以为null（只有条件观察）；有值须0≤p≤1，UI显示为预测判断而非“信心分”。未经校准显示`uncalibrated`，不要自动映射“证据充足=80%”。

### 8.2 结算

程序按固定规则取得合格结果，如指定交易所截止时刻前最后一根已完成1h close。盘中触及用高/低价可能能确定是否触及，但同根事件先后不可确定。source fallback须在发布前定义，不能结算时挑更有利的交易所。

`pending`、`resolved_yes`、`resolved_no`、`void`、`disputed`和`unresolved_data`分开。暂缺数据先unresolved_data，不能为了不算错误直接void。void需预先允许的客观原因或人工裁定记录，统计报告公开排除数量与原因。

### 8.3 评价

只对符合相同目标定义的预测计算Brier、log loss（若采用，边界裁剪政策明确）、可靠性与样本量；不同horizon/问题不要合成一个误导总胜率。概率0/1错判会产生极端损失，不能事后夹到更温和值改善历史成绩。

连续概率更新的比较时点预先规定：如首次发布或固定距截止时间。不能从一天里十次改预测中挑最接近结果的一次。模型版本、提示词、输入范围和用户编辑分别记录，避免把不同系统归为一个成绩。[S028｜scikit-learn校准文档](https://scikit-learn.org/stable/modules/calibration.html) [S029｜Metaculus题目编写](https://www.metaculus.com/question-writing/) [S030｜Metaculus评分FAQ](https://www.metaculus.com/help/scores-faq/)

## 9. 预警产品的范围

首版只做站内研究预警，不默认短信、企业微信、Telegram或邮件。没有用户授权和账号配置，不增加外部连接。提醒内容是“新的重要检查/条件变化/证据异常”，不默认下单信号。

允许规则类型：已完成市场条件越界、跟踪观点条件满足/失效、已核实催化剂临近/发布/改期、重要主张被否认/修订、关键数据源故障。每条规则说明来源、方法、确认窗口、冷却和质量要求。

## 10. Alert Rule与状态机

### 10.1 规则DSL

规则使用安全的JSON条件树，不执行任意JS/SQL或模型代码。例如：

```json
{
  "rule_id":"alert_rule_example",
  "revision":1,
  "scope":{"instrument_id":"example:spot:BTC:USDT"},
  "condition":{"metric":"M-001.return_1h","operator":"gt","value":"0.02","unit":"decimal_return"},
  "confirmation":{"finalized_windows":2},
  "quality_required":["source_identity","freshness","window_complete"],
  "cooldown_seconds":3600,
  "rearm":{"operator":"lt","value":"0.01","unit":"decimal_return"},
  "channel":"in_app",
  "example_only":true
}
```

阈值是演示/配置，不是策略推荐。实际规则必须限制可用metric/operator、单位和最大复杂度。模型可建议rule draft，不可直接启用规则或修改外发渠道。

### 10.2 状态转换

基础状态：ARMED、PENDING、TRIGGERED、COOLDOWN、RECOVERED、DISABLED。data_state另有OK/SUPPRESSED_DATA，不应覆盖基础episode身份。

ARMED第一次满足进入PENDING；连续规定数量的有效finalized窗口满足才TRIGGERED，创建episode和唯一alert event。若中间窗口无效，不把它当确认，也不默认条件为false。已TRIGGERED进入COOLDOWN后不会每次采样重复通知；要满足rearm条件才进入RECOVERED并准备新episode。冷却到期但条件一直为true，不自动生成新越界事件。

数据过期叠加SUPPRESSED_DATA，暂停市场判断并产生可选数据质量提醒；恢复有效后重新确认，不把缺失当恢复。用户禁用保留原因和最后状态，不声称市场条件已消失。

### 10.3 去重与投递

alert event ID来源于rule revision、instrument、episode与transition，数据库唯一约束保证同一状态转换只记一次。队列和网络仍可能重复投递，前端按event_id幂等显示；外部通知（未来可选）不能轻易承诺exactly-once，发送后超时可能已送达。

已读/未读是用户状态，不改变市场事件。页面刷新不重新触发模型解释；同一alert的解释引用已封存run。新重要事实可形成新的事件更新，但仍按同事件归组，避免成为十次“最新进展”。

### 10.4 提醒负担

配置每用户/频道的摘要合并、静默时段、最大低优先提醒频率。critical_review可否突破静默需要用户明确选择，不能由LLM自认重要而无限推送。达到负担上限时合并为摘要，保留原事件和原因，防止为了降噪丢掉可追溯记录。

## 11. 注释、观点与预警的权限

现有认证方式未知，不能直接把笔记/规则写API公开。所有私人对象有owner/scope，后端验证而非仅前端隐藏。公共行情页面可以只读，研究观点/运行触发/预算/源配置应受控。若不存在可靠认证，先在本地/隔离环境验收，不部署公开写入口。

导出尊重隐私和数据用途。私人笔记不是默认LLM上下文；只有与当前问题相关并经设置允许的片段进入模型。用户删除私人内容时按政策处理；统计聚合注明排除而不是保留被删除敏感文本冒充审计。

## 12. API规格概览

| 拟议接口 | 关键行为 |
|---|---|
| `POST /api/research/v2/views` | 创建固定研究现场；检查run可读和输入恢复级别 |
| `GET /api/research/v2/views/{view_id}` | 返回固定身份、窗口、恢复级别，不自动切latest |
| `PUT /api/research/v2/views/{view_id}` | 需要If-Match/revision；版本前提失败412，不覆盖他人修改 |
| `POST /api/research/v2/viewpoints` | 保存研究观点/草稿，不自动启动预测 |
| `POST /api/research/v2/forecasts` | 冻结问题/概率/规则，缺字段422 |
| `GET /api/research/v2/reviews` | 按问题/模型/时间读取复盘 |
| `POST /api/research/v2/alerts/rules` | 只存安全DSL和权限，不执行任意代码 |
| `GET /api/research/v2/alerts/episodes` | 稳定cursor、用户范围、event去重 |

数据表、错误码、并发和cursor定义见卷10，不让每个前端页自行定义一套。URL参数不能携带secret，Markdown/标题/链接渲染要净化，禁用不可信HTML和危险协议。

## 13. 缓存与资源生命周期

pinned view缓存按run/bundle/method/permission，不按symbol一键复用；live panel可用短TTL但标更新状态。事件/笔记修改采用revision更新和ETag；不让旧缓存覆盖已确认修订。

页面mount创建有限订阅，unmount统一dispose；tab不可见可降低轮询但不偷偷改变数据窗口。SSE断线使用Last-Event-ID或run状态查询恢复，重连不重新POST生成任务。图表resize观察器、十字线监听、document键盘事件都应成对解绑，复用现有治理的生命周期约定。

资源释放测试检查多次页面切换后活跃定时器/连接不持续增长；这只是验收计划，不是宣称当前系统有内存泄漏。

## 14. 迁移与旧链接

旧`news`指向事件页、`news-analysis`指向分析页，不能按文件名反着迁移。旧reportId通过legacy resolver优先定位原记录；找不到已清理内容返回明确missing，不能打开最新报告冒充原链接。[R13｜仓库事实报告§8.1，L203-215](../inputs/repository_facts.md) [R12｜仓库事实报告§7，L183-201](../inputs/repository_facts.md)

旧图表localStorage偏好保留，但第一次转新Research View时明确从当前有效绝对窗口建立，不能把scrollPosition转成猜测的历史时间。迁移失败保留原偏好，别清空用户设置。

旧报告中的固定分数可以带legacy语义提示，但不修改原文。旧演示角色保留规划区，不因用户看到新研究页就将所有demo改为connected。导航迁移由一个集成任务负责，避免业务代理同时编辑js/config.js/features.js/nav.js发生冲突。

## 15. 验收与可用性测试

使用同一合成/授权数据、固定任务脚本对照当前页面和新原型：找到本轮变化、解释一项分歧、查主张证据、保存观点、恢复历史窗口、查看预测结算、辨识过期值、处理一条重复预警。

测量完成时间、错误次数、往返页面数、遗漏局限、是否误把估计当观测；不用审美打分替代研究价值。样本量小时报告个体结果和任务轨迹，不声称普适百分比提升。

自动测试覆盖：route映射、并发请求旧响应丢弃、run pinning、注释重投影、缺输入恢复、draft/final区别、XSS/危险URL、权限隔离、重复alert、冷却/重臂、数据失效恢复、日历改期和资源dispose。

通过条件是事实一致、任务可完成、错误不增加、旧链接可解释兼容。若重设计只有更复杂拖拽而没有净收益，保留新证据/观点模型，退回较简单布局；数据层不应因UI回退被删除。
