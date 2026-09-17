# 13｜页面、共享状态、API、历史与导出的统一设计

## 1. 四页保留职责，研究入口重新组织

行情页解释价格、参与度和已知结构；足迹页解释成交分布与主动量；强平页解释已观测事件与有条件的压力背景；衍生品页解释成本、存量、比例和价格关系。四页不是四个独立计算宇宙，应共享研究选择、时间语义、方法输出和质量元数据。

新研究首页展示少量“变化—分歧—下一检查点”，详细证据下钻到四页。信息密度来自有效压缩，不来自同时显示全部指标。原图表底座与已连接路由保留，员工demo与交易planned不自动转正。不能把四页重设计扩大为全26路由实现。

## 2. 共享选择对象

拟议Selection含instrument_id、primary_dataset、window_start/end、market_cutoff、knowledge_cutoff、time_mode、confirmed_or_live、method_set_version、analysis_grid与selected_evidence。它是研究身份，不要求全局一个可变对象到处直接写。

用户切周期产生新selection_revision；请求、图表、侧栏和导出都带该revision。迟到返回先检查身份，不因JSON合法就覆盖当前页面。用户只是拖动屏幕时可更新viewport preference，不自动修改用于报告的固定analysis window。

现有scrollPosition/barSpacing继续用于显示偏好；要保存研究现场则新增绝对窗口和bundle/view版本。当前仅相对视口无法保证历史滚动后恢复相同K线，不能把localStorage保存成功当历史还原证明。[C15｜js/pages/chart.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/chart.js#L1) [C23｜js/pages/orderflow.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/orderflow.js#L1)

## 3. 一张卡如何显示事实边界

每张卡至少有题目、数值/状态、实际窗口、来源范围、方法、质量标签和证据入口。带数字的解释必须能定位到相同bundle的value与unit。颜色只表示涨跌、类型或质量，不隐含推荐买卖。

质量提示有层次：主任务缺关键输入要显著显示；非依赖背景缺失折叠但可查；仅接口刚刷新不意味着观察新鲜。所谓“可信”应说明是数据字段通过还是解释证据充分，不给通用百分数。

初始基线、无重大变化、覆盖不足、来源冲突、形成中各有独立展示。只有确有基准且相同方法可比，才显示“相比上次改变”。上一次打开的报告和最近系统生成报告不是同一基准，选择规则由用户工作流明确。

## 4. 现有与拟新增API的边界

| 路由/职责 | 状态 | 行为 |
|---|---|---|
| `/api/finance/datasets` | 已有 | 目录与当前状态；不等于每类数据有效 |
| `/api/finance/datasets/{id}` | 已有 | 规范存储读取，含limit/known_at；按实际代码处理 |
| `/api/finance/datasets/{id}/refresh` | 已有 | POST按有限配置刷新；不自动变成定时采集 |
| `/api/finance/stored/{provider}/{operation}` | 已有 | 原生快照存储读取；不是规范指标 |
| `/api/research/v3/capabilities` | 拟议 | 实际可用方法、数据范围、未启用原因 |
| `/api/research/v3/captures` | 拟议POST | 创建固定输入捕获；不会因选择价格窗口默认调用模型 |
| `/api/research/v3/runs` | 拟议POST | 选择template/model模式与已获准范围，幂等创建 |
| `/api/research/v3/runs/{id}` | 拟议GET | 状态与固定产物，读取不触发新模型 |
| `/api/research/v3/reports/{id}` | 拟议GET | 当前权限下读取对应版本，不以最新替代 |
| `/api/research/v3/views` | 拟议POST | 保存绝对研究选择与允许的注释 |
| `/api/research/v3/reports/{id}/export` | 拟议POST | 按当前导出权利生成有限副本 |

既有路由依据[C07｜cloudflare/finance/gateway.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/gateway.mjs#L1) [C08｜cloudflare/finance/gateway.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/gateway.mjs#L170)。v3命名是为了与旧设计v2区分的本包建议，不声称仓库已存在；正式合并应选择唯一namespace，不同时运行三套同义API。若现有接口能兼容扩展，复用并记录版本，不为文档命名强制改路由。

## 5. 统一结果外壳与错误

成功HTTP不意味着数据完整。结果同时返回request_id、schema/method version、data、quality、coverage、timestamps、next_cursor和limits_applied。`empty_valid`、`not_collected`、`restricted`、`upstream_failed`、`invalid_payload`不得都返回空数组。

写请求按owner、operation和Idempotency-Key去重；同键同请求返回已有对象，同键不同摘要冲突。创建参数不允许客户端指定已验证、已发布、owner或价格权限；这些由后端可信逻辑决定。

错误至少区分400参数、401/403认证用途、404确无对象、409版本/幂等冲突、412条件更新失败、422历史不足、429限流/预算、503来源/执行器不可用。具体映射按现有Worker框架实施，不能硬把所有失败吞掉返回200+空数据。

## 6. 存储不是必须新建几十张表

最小闭环逻辑需要capture/run、输入清单、报告与方法版本。现有dataset、snapshot和reports能否承载这些约束由schema检查决定，可以内联JSON加关键索引，不必第一天创建旧方案全部表。

封存内容不可就地改，但可读性和权限可变化。artifact记录payload/digest/location/size与availability，bundle记录使用清单；报告引用固定bundle。内容哈希只证明字节，不证明事实真伪。canonical JSON的键序、数组顺序、小数表示和排除字段必须固定，不能一会儿hash字符串一会儿hash解析对象。

将大对象写入对象存储再提交数据库manifest时，没有跨服务事务。先写内容、验证大小/摘要，再提交索引；数据库失败留下孤儿可受控清理。读取不能只看到一个report行就认定所有输入还可用。

## 7. 历史恢复等级

`exact_inputs`：必要输入和方法版本仍可读取；`aggregate_evidence`：只有保留聚合足以解释结果，不能还原逐笔；`report_only`：只剩原报告；`restricted`：对象存在但当前用途不允许；`missing`：确实无法恢复。

旧材料的归档期限与实际删除不相同；历史API能请求30天不证明数据库仍有30天。不能由模型重写旧报告补档，也不能以今天价格重画一张旧日期图冒充当时窗口。旧reportId必须映射原对象或明确缺失，不静默跳到latest。

研究者可以在旧报告旁附今天的修订和反证，但原始观点、当时证据和后来的解释必须分列。不可变记录不优先于删除义务，允许保留的tombstone说明范围即可。

## 8. 缓存与刷新

缓存键至少区分owner/用途、数据集和产品、窗口、cutoff、source selection、method version、analysis mode与grid。最新指针是可变对象，封存bundle是不可变对象，两者不同TTL与失效政策。

source政策撤销、历史修订、方法升级、选择变化和请求取消分别触发处理。不要用最新生成时间证明所有来源新鲜；不要让cache miss自动触发付费研究。用户明确刷新可以创建新capture，屏幕展示它与旧capture的关系。

## 9. 预警与观点作为后续独立能力

预警规则保存条件、使用方法、窗口、质量门槛、冷却与恢复策略。满足规则、文案是否准确、对用户是否有用是三个评估对象。迟到历史补齐不应瞬间发送几十个过期提醒，应按catch-up policy仅补状态或合并回顾。

观点保存问题、依据、条件、反证和下一检查。可修改但产生revision，不在结果出来后修改原命题。概率问题另有严格结算规则，不能从普通笔记的“看多”自动计算命中率。

## 10. 正常/失败/资源验收

从主图选绝对窗口→打开足迹→返回简报→导出，相同instrument、窗口、方法和数据版本应保持。切换到另一run后，旧SSE/HTTP不得覆盖当前。取消时释放读流、计时器、画布监听和可释放资源，已发生外部费用另记。

权限、导出与旧链接回归以实际浏览器和API测试验证；本轮提供规格，不声称真实页面已经通过。UI效果单独验收，不以颜色更漂亮或卡片更多证明研究价值。
