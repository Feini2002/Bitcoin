# 舆情分析模块 fenxi 设计与拆分规划

## 1. 模块定位

舆情分析页是 `#/news-analysis`，对应 Worker 报告类型 `sentiment_analysis`。

第一页 `shijian` 是事件一览，更像全天候信息雷达和日报编辑台；第二页 `fenxi` 不是再做一遍新闻摘要，而是把上游事件、事实池、市场快照和下游 Agent 需要的结构化状态合成一个“世界新闻 + 金融真实数据”的多重校验器。

当前页面已经完成前端工作台重构：UI 已按事件一览页风格铺好 8 个模块，且无云端分析内容时也会保留完整模块框架。但 Worker 侧仍主要集中在 `sentiment-logic.js`，没有像 `shijian/` 那样按模块拆成多个子文件。后续要把这些模块逐步拆到 `cloudflare/yuqing/fenxi/` 下，让前端占位、Worker 输出、D1 回档、下游 Agent 输入全部连通。

核心原则：

- 第二页顶部 Gauge 聚焦真实资金面与风险偏好，不复用第一页的信息热度。
- 只把“事件 + 硬数据确认”的结论传递给交易和 Agent；无法确认时必须降级为“仅见事件，未见资金跟随确认”。
- 时间轴绝不由 LLM 编日期；只渲染外部 API、硬编码日历或可信结构化来源传入的 timestamp。
- 输出必须包含下游 Agent 可读的枚举、布尔值、数据缺口标识和降级原因。

## 2. 当前实现快照

### 2.1 前端页面

- 页面入口：`js/pages/news.js`
- 路由：`#/news-analysis`
- 当前页面壳：`news-intel-shell daily-workbench-shell analysis-workbench-shell`
- 当前资源版本：`index.html` 中 `js/pages/news.js?v=20260508-fenxi-harddata1`
- 当前 UI 模块数：8 个
- 当前特点：前端已经把页面重构成模块化工作台，但很多模块仍由页面侧从旧报告字段里推导，Worker 还没有输出专门的模块字段。

当前前端模块函数：

- `renderAnalysisRiskTemperature`：资金风险温度。
- `renderAnalysisHardDataMatrix`：硬数据校验矩阵。
- `renderAnalysisNarrativeValidation`：叙事定价验证。
- `renderAnalysisCalendar`：精准催化剂时间轴。
- `renderAnalysisRiskThresholds`：风险传导阈值。
- `renderAnalysisAgentContext`：Agent 结构化输出。
- `renderAnalysisAudit`：抗失真审计。
- `renderAnalysisAiPremium`：科技叙事溢价复核。

### 2.2 Worker 当前状态

当前 `fenxi/` 文件：

- `index.js`：只做聚合导出。
- `sentiment-logic.js`：承载第二页核心逻辑，包含市场状态、风险雷达、机会条件、日历、趋势阅读等函数。

当前 `shijian/` 参照结构：

- `shared.js`：通用清洗、摘要、时间、prompt JSON 工具。
- `temperature.js`：信息温度。
- `top-stories.js`：今日头条。
- `dynamic-briefs.js`：动态速览。
- `ai-intel.js`：AI 情报站。
- `github-tools.js`：GitHub 工具雷达。
- `trend-clues.js`：趋势线索。
- `index.js`：统一导出模块函数与 `shijianModuleShell`。

当前 `buildSentimentAnalysisReport` 的上游输入：

- 最新 `daily_event` 报告：来自 D1 `yuqing_reports`。
- `factRows`：事实池条目，当前一次读取 80 条，增量搜索后最多刷新到 90 条。
- `aiFacts`：从事实池中过滤出的 AI/科技相关事实。
- `marketSnapshot`：来自 `fetchMarketContext`，包含 `klines`、`derivatives`、`liquidations`、`derivativesSnapshot`。
- `incrementalSearch`：由事件日报新鲜度、事实池条数、市场快照错误、用户强制搜索决定。
- `legacy`：目前仍调用通用 `buildReport`，再从旧 dashboard/news/timeline/ai/trends 结构中取部分信息。

当前 `sentiment_analysis.report` 字段：

- `title`
- `upstreamDaily`
- `marketState`
- `riskRadar`
- `opportunityScanner`
- `eventCalendar`
- `aiIntel`
- `trendRead`
- `incrementalSearch`
- `quality`

当前 Worker 侧不足：

- 还没有 `hardDataMatrix` 独立输出。
- 还没有 `narrativeValidation` 独立输出。
- 还没有 `agentContext` 独立输出，前端目前临时推导。
- 还没有 `distortionAudit` 独立输出，前端目前从 `grounding`、`quality`、`sourceErrors` 推导。
- `eventCalendar` 目前主要从事实池标题/分类里挑宏观关键词，时间多是发布时间或抓取时间，不等同于真实财经事件发生时间，必须继续标为 PLANNED 方向。
- 宏观日历、VIX/MOVE、美债收益率差、期权隐波等还没有确定性数据源接入。
- 定向二次搜索仍是通用增量搜索，没有按“某一叙事的定价验证”拆成专门模块。

## 3. 目标文件拆分

后续 `cloudflare/yuqing/fenxi/` 建议拆为以下文件，保持与 `shijian/` 一样的“单模块单文件 + index 聚合导出”结构。

### 3.1 `shared.js`

职责：

- 提供 fenxi 专用的文本清洗、数字归一化、枚举归一化、置信度限制、状态 tone 转换。
- 复用或包裹 `shijian/shared.js` 的 `cleanText`、`itemSummary`，但不要让第二页业务逻辑散落依赖第一页模块。
- 统一输出字段命名，如 `ok`、`warn`、`planned`、`pending`、`degraded`。

建议导出：

- `cleanFenxiText`
- `safeArray`
- `clampScore`
- `normalizeBoolFlag`
- `normalizeSourceRef`
- `makePlannedMarker`
- `degradeReason`

必须处理：

- 输入为空时返回明确 fallback。
- 对象字段不能直接显示成 `[object Object]`。
- 所有 LLM 文本都必须有长度上限。
- 所有机器字段都必须稳定，不受中文文案变化影响。

### 3.2 `market-context.js`

职责：

- 接收 `fetchMarketContext` 的结果，整理为可供所有模块复用的硬数据上下文。
- 不直接发网络请求；请求仍由主 Worker 的 `fetchMarketContext` 负责，避免模块里隐藏额外 I/O。
- 将 `klines`、`derivatives`、`liquidations`、`derivativesSnapshot` 标准化。

输入：

- `marketSnapshot.ok`
- `marketSnapshot.errors`
- `marketSnapshot.data.klines`
- `marketSnapshot.data.derivatives`
- `marketSnapshot.data.liquidations`
- `marketSnapshot.data.derivativesSnapshot`

输出建议：

- `marketContext.ok`
- `marketContext.generatedAt`
- `marketContext.sources`
- `marketContext.priceAction`
- `marketContext.derivatives`
- `marketContext.liquidations`
- `marketContext.derivativesSnapshot`
- `marketContext.missingSources`
- `marketContext.dataFreshness`

分析规则：

- `klines.changePct` 只能说明价格行为，不直接代表舆情方向。
- `derivatives` 负责资金费率、OI、基差、来源健康。
- `liquidations` 负责多空清算压力和是否存在强平跟随。
- `derivativesSnapshot` 可作为二级摘要，但不能替代原始数据状态。
- 任一关键来源缺失时，应给 `market_snapshot_ok=false`，并让下游模块自动降级。

PLANNED：

- 增加 `macroProxy`，纳入 VIX/MOVE、美元指数、美债收益率差。
- 增加 `optionsIv`，从 Deribit 或衍生品 Worker 显式输出 BTC 期权隐波。
- 增加 `flowFreshness`，用于判定行情快照是否过期。

### 3.3 `risk-regime.js`

对应前端模块：资金风险温度。

当前页面状态：

- UI 已完成。
- 当前由前端 `analysisRegimeMeta` 根据 `report.marketState`、`quality.marketSnapshotOk`、`marketSnapshot.ok` 推导。
- `marketState` 当前来自 `marketStateFromLegacy`，仍偏粗略。

目标职责：

- 生成第二页顶部 Gauge 和 `macro_regime`。
- 只反映资金面与风险偏好，不读取第一页的信息温度分数。
- 输出可被下游 Agent 直接读取的状态。

输入：

- 标准化后的 `marketContext`。
- 上游 `daily_event` 的主题摘要，只作为背景，不作为分数主体。
- `incrementalSearch` 状态。

输出建议：

- `riskRegime.score`
- `riskRegime.macro_regime`：`RISK_ON`、`RISK_OFF`、`RISK_NEUTRAL`、`DATA_GAP`、`PENDING`
- `riskRegime.label`
- `riskRegime.confidence`
- `riskRegime.market_snapshot_ok`
- `riskRegime.summary`
- `riskRegime.evidence`
- `riskRegime.degrade_reason`

分析逻辑：

- 如果 `marketContext.ok=false`，直接输出 `DATA_GAP`，并降低置信度。
- 如果价格上行、资金费率/OI 同向、强平压力不异常，可偏 `RISK_ON`，但仍标注是否拥挤。
- 如果价格下行、强平集中、衍生品结构走弱，可偏 `RISK_OFF`。
- 如果价格与衍生品背离，输出 `RISK_NEUTRAL` 或 `DATA_DIVERGENCE`，不输出方向。
- 任何仅由新闻叙事推导出来的方向都必须降级。

需要从 `sentiment-logic.js` 迁出的现有函数：

- `marketStateFromLegacy` 的一部分逻辑。

优化点：

- 把 score 从固定 62/58/46 改为基于硬数据加权。
- 分数构成要可解释，至少拆成价格行为、衍生品、强平、宏观代理、数据新鲜度。
- 支持 `scoreBreakdown`，方便前端展示分数来源。

### 3.4 `hard-data-matrix.js`

对应前端模块：硬数据校验矩阵。

当前页面状态：

- UI 已完成。
- 当前前端展示 6 个通道：BTC 1h 价格行为、资金费率/OI/基差、强平与清算分布、衍生品 AI 快照、宏观日历 timestamp、VIX/美债收益率差。
- 前 4 个来自现有 `marketSnapshot`。
- 后 2 个仍是 PLANNED 占位。

目标职责：

- 生成独立的 `hardDataMatrix`。
- 每个数据源必须标明接入状态、数据值、时间、新鲜度、缺口原因和关联页面。

输入：

- `marketContext`
- 未来 `macroCalendarContext`
- 未来 `macroProxyContext`
- 未来 `optionsContext`

输出建议：

- `hardDataMatrix.items[]`
- 每项包含 `key`、`label`、`status`、`value`、`summary`、`freshness`、`route`、`is_planned`、`missing_reason`

分析逻辑：

- 数据项只负责事实，不输出交易结论。
- 数据缺失不是错误，而是必须显式暴露给叙事验证和 Agent 输出。
- PLANNED 项要保留，直到对应数据源和验证脚本都落地。

PLANNED 项：

- `macro_calendar_timestamp`：财经日历结构化时间。
- `vix_move_yield_spread`：VIX/MOVE/美债利差。
- `options_iv_skew`：期权隐波、偏斜、期限结构。
- `stablecoin_liquidity`：稳定币流动性和链上资金代理。
- `etf_flow`：BTC ETF 净流入/流出代理。

优化点：

- 将 `sourceHealthSummary` 对象标准化，避免前端直接显示对象键。
- 给每个数据项增加 `last_updated_at` 和 `stale`。
- 给缺失数据提供 `recover_hint`，比如应检查哪个 Worker endpoint。

### 3.5 `narrative-validation.js`

对应前端模块：叙事定价验证。

当前页面状态：

- UI 已完成。
- 当前前端从 `upstreamDaily`、`riskRadar`、`opportunityScanner` 临时拼出事件事实、定价证据、降级规则、后续证据。
- Worker 还没有独立输出 `narrativeValidation`。

目标职责：

- 把第一页事件拆成“叙事候选”，再用硬数据检查是否有资金跟随。
- 专门解决“LLM 分析 LLM”的回音室问题。

上游接入：

- `daily.report.topStories`：主要叙事候选。
- `daily.report.dynamicBriefs`：次级叙事候选。
- `daily.report.trendRead` 或趋势线索：主题共振和裂变。
- `factRows`：来源事实和非 LLM 事实池。
- `marketContext`：价格和资金面确认。

输出建议：

- `narrativeValidation.items[]`
- 每项包含 `narrative_id`、`source_daily_report_id`、`title`、`event_fact`、`pricing_evidence`、`funds_follow_confirmed`、`downgrade_required`、`degrade_reason`、`next_evidence`、`confidence`、`related_assets`

分析逻辑：

- 第一步：从上游日报提取叙事候选，不把结论当事实。
- 第二步：检查叙事是否映射到 BTC、纳指、美元、美债、黄金、AI 股票、能源等资产。
- 第三步：用硬数据矩阵判断是否有资金跟随。
- 第四步：如果无法确认，固定输出“仅见事件，未见资金跟随确认”。
- 第五步：只有在价格、衍生品、强平或宏观代理至少两类同向时，才允许提高叙事权重。

需要的 LLM 权限：

- 可以归纳事件事实。
- 可以解释为什么某类数据能验证该叙事。
- 不可以编造价格反应。
- 不可以编造事件时间。
- 不可以输出买卖指令。

PLANNED：

- 增加定向二次搜索，只搜索某个叙事的定价验证。
- 搜索目标应优先是财经/官方/交易所/公司公告来源。
- 搜索结果必须写入 `sourceRefs` 或 grounding，不能只进入自由文本。

优化点：

- 给叙事候选加去重，避免 topStories 和 dynamicBriefs 讲同一件事。
- 给每个叙事生成 `validation_status`：`CONFIRMED`、`UNCONFIRMED`、`CONFLICTED`、`DATA_GAP`。
- 增加 `market_reaction_window`，区分事件前、事件后 1h、4h、24h。

### 3.6 `catalyst-calendar.js`

对应前端模块：精准催化剂时间轴。

当前页面状态：

- UI 已完成。
- 当前 `calendarFromFacts` 会从事实池里用宏观关键词筛选条目，但时间多来自 `publishedAt` 或 `fetchedAt`，只能算占位，不是严格事件时间。
- 前端已经在无确定时间时显示“结构化财经日历 PLANNED”，并写明“不编造”。

目标职责：

- 只渲染确定性的时间节点。
- LLM 只能解释影响面，不能计算或生成日期。

输入：

- 未来财经日历 API。
- 未来硬编码可靠日历，如 FOMC、CPI、非农、期权到期、主要代币解锁。
- 未来交易所公告或官方日程。
- 当前事实池只可作为候选提示，不可直接升级为精确时间。

输出建议：

- `catalystCalendar.items[]`
- 每项包含 `id`、`title`、`startsAtUtc`、`precision`、`displayTimezone`、`sourceName`、`sourceUrl`、`confidence`、`impactScore`、`assets`、`pre_event_watch`、`llm_commentary_allowed`

分析逻辑：

- `precision=time` 才允许倒计时。
- `precision=date` 只显示日期级，不显示小时分钟倒计时。
- `precision=unknown` 或 `planned` 必须保留占位，不显示假时间。
- 如果事件时间来自 LLM 文本，必须丢弃或标记为 `untrusted_time`。

PLANNED：

- 接入财经日历结构化源。
- 增加 D1 表或本地 JSON，用于维护固定宏观日历。
- 增加代币解锁/期权到期/美股财报关键表。
- 给日历源加验证脚本，防止时间字段为空或格式错误。

优化点：

- 增加“事件前关注点”和“事件后复盘点”两段。
- 区分宏观、链上、交易所、公司/科技四类催化剂。
- 支持同一事件多个时区展示，但内部统一 UTC。

### 3.7 `risk-thresholds.js`

对应前端模块：风险传导阈值。

当前页面状态：

- UI 已完成。
- 当前前端从 `riskRadar` 和 `opportunityScanner` 渲染触发、确认、失效条件。
- Worker 当前由 `riskRadarFromInputs` 和 `opportunitiesFromInputs` 生成粗略风险和条件队列。

目标职责：

- 把事件传导拆成触发条件、确认条件、失效条件、响应建议。
- 输出“条件队列”，不输出交易执行。

输入：

- `narrativeValidation`
- `riskRegime`
- `hardDataMatrix`
- `marketContext`
- 上游日报主题

输出建议：

- `riskThresholds.items[]`
- 每项包含 `level`、`window`、`trigger`、`confirmation`、`invalidation`、`affected_assets`、`response_hint`、`requires_manual_review`

分析逻辑：

- 如果叙事未被硬数据确认，风险等级最多到 `mid`，不能因为新闻标题升级到 `high`。
- 如果市场数据缺口存在，风险等级可标高，但原因必须是“数据缺口风险”，不是行情方向。
- `response_hint` 只能提示降低权重、等待确认、检查页面，不直接给仓位或买卖点。

需要迁出的现有函数：

- `riskRadarFromInputs`
- `opportunitiesFromInputs`

PLANNED：

- 增加阈值配置，例如 funding 极端值、OI 增幅、强平密度。
- 增加跨页面联动，让风险项可跳转到行情、衍生品、强平雷达。
- 增加“失效后如何降级”的结构化字段。

优化点：

- 风险和机会不要分成两套重复卡片，统一为 `threshold` 条目。
- 每条阈值都应绑定至少一个证据来源。
- 可增加 `severity_score`，但必须解释分数来源。

### 3.8 `agent-context.js`

对应前端模块：Agent 结构化输出。

当前页面状态：

- UI 已完成。
- 当前前端从 `marketState`、`quality`、`incrementalSearch`、`sourceErrors`、`eventCalendar` 临时推导 6 个 flag。
- Worker 还没有持久化 `agentContext`。

当前前端 flag：

- `macro_regime`
- `verified_catalyst`
- `data_divergence`
- `market_snapshot_ok`
- `incremental_search_used`
- `llm_downgrade_required`

目标职责：

- 为下游员工/Agent 提供稳定机器输入。
- 这些字段应写入 `report.agentContext`，而不是只在前端推导。

输入：

- `riskRegime`
- `hardDataMatrix`
- `narrativeValidation`
- `catalystCalendar`
- `distortionAudit`

输出建议：

- `agentContext.macro_regime`
- `agentContext.verified_catalyst`
- `agentContext.data_divergence`
- `agentContext.market_snapshot_ok`
- `agentContext.incremental_search_used`
- `agentContext.llm_downgrade_required`
- `agentContext.risk_window`
- `agentContext.allowed_actions`
- `agentContext.blocked_actions`
- `agentContext.reason_codes`

分析逻辑：

- 所有字段必须是稳定枚举、布尔值或短数组。
- 不把长文本传给下游 Agent 作为判断主依据。
- `allowed_actions` 可以是“提高观察权重”“等待确认”“查看原始数据页”。
- `blocked_actions` 应包含“基于未验证叙事直接输出交易方向”。

PLANNED：

- 智囊团、订单流、衍生品、风控员工读取该上下文。
- 增加快照导出，让人工复盘可看到当时 Agent 输入。
- 增加版本号 `agent_context_version`，避免字段升级破坏下游。

优化点：

- 增加 `confidence_floor`，由数据缺口自动下调。
- 增加 `requires_human_review`，遇到高影响低确认事件时提醒人工。

### 3.9 `distortion-audit.js`

对应前端模块：抗失真审计。

当前页面状态：

- UI 已完成。
- 当前前端从 `grounding`、`quality`、`incrementalSearch`、`sourceErrors`、`upstreamDaily` 推导审计内容。
- Worker 还没有独立输出 `distortionAudit`。

目标职责：

- 明确记录本轮是否存在“LLM 分析 LLM”的失真风险。
- 让所有降级都有可追溯原因。

输入：

- `daily_event` 报告 ID 和生成时间。
- `factRows` 数量和样本 ID。
- `incrementalSearch` 决策原因。
- `sourceErrors`。
- `marketContext.missingSources`。
- LLM 输出模块状态。

输出建议：

- `distortionAudit.upstream_daily_id`
- `distortionAudit.fact_count`
- `distortionAudit.source_coverage`
- `distortionAudit.incremental_search_used`
- `distortionAudit.incremental_search_reasons`
- `distortionAudit.market_data_gaps`
- `distortionAudit.llm_inputs`
- `distortionAudit.degrade_reasons`
- `distortionAudit.caveat`

分析逻辑：

- 事实池不足、日报过旧、市场快照错误、定向搜索失败，都必须进入审计。
- 审计模块不负责润色结论，只负责把证据链讲清楚。
- 审计输出应优先结构化，前端再转成易读卡片。

PLANNED：

- 记录每个模块是否使用 LLM、是否联网、是否使用 Google Search。
- 记录被排除的上游 `sourceId` 数量和原因。
- 增加 prompt 版本号，方便回溯。

优化点：

- 让 `sourceCoverage` 不只是事实条数，还要考虑来源类型多样性。
- 增加“审计失败也可渲染”的兜底，防止整个报告空白。

### 3.10 `tech-premium.js`

对应前端模块：科技叙事溢价复核。

当前页面状态：

- UI 已完成。
- 当前 `aiIntel` 来自旧 `legacy.sections.ai.data.aiIntel` 或 `dailyAiIntelFromFacts(aiFacts)`。
- 当前只能展示“叙事”和“验证点”，还没有真正判断科技叙事是否影响风险偏好。

目标职责：

- 保留 AI/科技事件，但要求经过资金面复核。
- 判断科技叙事是“日常信息”“风险偏好助推”“风险偏好无关”还是“需要进一步验证”。

输入：

- `aiFacts`
- 上游 `daily.report.aiIntel`
- `riskRegime`
- `narrativeValidation`
- 未来纳指、AI 股票、半导体指数、美元利率代理。

输出建议：

- `techPremium.items[]`
- 每项包含 `title`、`category`、`narrative`、`market_link`、`risk_appetite_effect`、`verification_needed`、`confidence`、`sourceName`、`sourceUrl`

分析逻辑：

- AI/科技新闻默认不等于交易变量。
- 只有当它与纳指、美元利率、AI 相关资产、BTC 风险偏好出现同向关系时，才提升权重。
- 如果没有硬数据，只输出“等待资金面复核”。

PLANNED：

- 接入纳指/QQQ/半导体/AI 股票代理数据。
- 接入 GitHub 工具雷达与科技发布的联动。
- 增加科技叙事与 BTC 风险偏好的历史相关观察。

优化点：

- 不要让科技模块侵占主交易判断权重。
- 将 AI 事件按“模型发布”“工具发布”“政策/监管”“资本开支”“芯片/算力”分类。

### 3.11 `report-compose.js`

职责：

- 聚合所有 fenxi 子模块，产出最终 `sentiment_analysis` payload。
- 让主 Worker 的 `buildSentimentAnalysisReport` 变薄，类似 `shijian` 目录把 prompt/schema 拆出去后的形态。

输入：

- `daily`
- `factRows`
- `aiFacts`
- `marketSnapshot`
- `incrementalSearch`
- `legacy` 或未来专用 LLM 结果
- `sourceErrors`

输出：

- `report`
- `grounding`
- `sourceRefs`
- `marketSnapshot`
- `sourceErrors`

组合顺序：

1. 标准化 `marketContext`。
2. 生成 `hardDataMatrix`。
3. 生成 `riskRegime`。
4. 生成 `narrativeValidation`。
5. 生成 `catalystCalendar`。
6. 生成 `riskThresholds`。
7. 生成 `techPremium`。
8. 生成 `distortionAudit`。
9. 生成 `agentContext`。
10. 向前兼容旧字段：保留 `marketState`、`riskRadar`、`opportunityScanner`、`eventCalendar`、`aiIntel`、`trendRead`，直到前端完全切换到新字段。

## 4. 页面模块与 Worker 输出映射

| 页面模块 | 当前前端字段 | 当前 Worker 字段 | 目标 Worker 字段 | 状态 |
| --- | --- | --- | --- | --- |
| 资金风险温度 | `marketState`、`quality`、`marketSnapshot` | `marketState` | `riskRegime` | UI 已完成，Worker 待拆 |
| 硬数据校验矩阵 | `marketSnapshot.data.*` | `marketSnapshot` | `hardDataMatrix` | 前 4 项已接入，宏观/隐波 PLANNED |
| 叙事定价验证 | `upstreamDaily`、`riskRadar`、`opportunityScanner` | 多字段拼接 | `narrativeValidation` | UI 已完成，Worker 待拆 |
| 精准催化剂时间轴 | `eventCalendar` | `calendarFromFacts` | `catalystCalendar` | UI 已完成，可靠时间源 PLANNED |
| 风险传导阈值 | `riskRadar`、`opportunityScanner` | 两个旧函数 | `riskThresholds` | UI 已完成，结构待升级 |
| Agent 结构化输出 | 前端临时推导 | 无独立字段 | `agentContext` | UI 已完成，Worker 待持久化 |
| 抗失真审计 | `grounding`、`quality`、`sourceErrors` | 分散字段 | `distortionAudit` | UI 已完成，Worker 待拆 |
| 科技叙事溢价复核 | `aiIntel` | `aiIntel` | `techPremium` | UI 已完成，市场联动 PLANNED |

## 5. 上游信息联通方式

### 5.1 第一页 `daily_event` 到第二页 `sentiment_analysis`

已有：

- 第二页已经读取最新 `daily_event`。
- 第二页 `sourceRefs` 已能跳回 `#/news?reportId=...`。
- 第二页 `upstreamDaily` 已保存上游日报 ID、标题、生成时间、slot、href。

待增强：

- 不只读取上游日报标题，还要读取 `topStories`、`dynamicBriefs`、`aiIntel`、`githubTools`、`trendRead`。
- 对每条上游事件生成稳定 `narrative_id`，防止重复验证。
- 把上游 `grounding.itemIdsSample` 用作去重依据，避免增量搜索重复采集同一批事实。

### 5.2 事实池到第二页

已有：

- `factRows` 已进入 Worker。
- `sourceRefsFromFacts` 已把部分事实来源放入 `sourceRefs`。
- `calendarFromFacts` 已临时从事实池筛宏观关键词。

待增强：

- 事实池要为 `narrativeValidation` 提供非 LLM 证据。
- 事实池要为 `distortionAudit` 提供来源覆盖和样本 ID。
- 事实池不能替代财经日历；新闻发布时间不能当成事件发生时间。

### 5.3 市场快照到第二页

已有：

- `klines`：BTC 1h K 线，当前压缩出 `changePct`。
- `derivatives`：衍生品矩阵和来源健康。
- `liquidations`：强平分布与多空名义额。
- `derivativesSnapshot`：衍生品 brief 摘要。

待增强：

- 市场快照要统一进入 `marketContext`。
- 所有模块只读 `marketContext`，不要各自直接读原始 endpoint。
- 新增宏观代理和期权隐波源后，也应在 `marketContext` 或独立 context 中标准化。

### 5.4 增量搜索到第二页

已有触发条件：

- 上游事件日报缺失。
- 上游日报超过 15 小时。
- 事实池条目不足。
- 市场快照存在缺口。
- 用户强制增量搜索。

待增强：

- 增量搜索要拆成两类：事实补齐搜索、叙事定价验证搜索。
- 叙事定价验证搜索必须绑定具体 `narrative_id`。
- 搜索结果必须写入 grounding，不能只进 LLM 自由文本。

## 6. 新报告结构目标

短期保持向前兼容，新增字段但不删除旧字段。

目标 `report` 顶层字段：

- `title`
- `upstreamDaily`
- `riskRegime`
- `hardDataMatrix`
- `narrativeValidation`
- `catalystCalendar`
- `riskThresholds`
- `agentContext`
- `distortionAudit`
- `techPremium`
- `incrementalSearch`
- `quality`

兼容保留字段：

- `marketState`
- `riskRadar`
- `opportunityScanner`
- `eventCalendar`
- `aiIntel`
- `trendRead`

保留兼容的原因：

- 当前前端已经能读旧字段。
- D1 历史报告里已有旧结构。
- 分阶段上线时可以先双写，再切前端读取新结构。

## 7. Prompt 与 LLM 约束

第二页 prompt 不应沿用第一页“编辑日报”的语气。它应该像一个风控前置校验器。

硬规则：

- 不允许 LLM 编造日期、会议时间、倒计时。
- 不允许 LLM 编造价格反应、资金流、期权隐波、收益率变化。
- 不允许 LLM 在没有硬数据确认时输出强方向结论。
- 不允许 LLM 把第一页的 LLM 总结当作新增事实。
- 必须输出结论降级字段。
- 必须输出数据缺口字段。
- 必须明确哪些结论只来自事件，哪些结论有资金面确认。

可允许 LLM 做的事：

- 归纳上游事件的金融含义。
- 根据传入的确定性市场数据解释影响路径。
- 对已传入的确定性时间节点解释关注点。
- 对科技/AI 新闻解释其可能的风险偏好传导，但不能脱离数据确认。

## 8. 验证与回归要求

只改 DESIGN.md：

- 可不运行全量验证。
- 建议检查文档路径和最终 diff。

拆分 Worker 模块后：

- 必跑 `npm.cmd run lint`。
- 必跑 `npm.cmd run verify:yuqing`。
- 若改 `fetchMarketContext`、Worker endpoint、D1 读写或报告生成流程，额外跑 `npm.cmd run verify:api`。
- 若同时改前端和 Worker，部署前跑 `npm.cmd run build`。
- 若改前端 `js/pages/news.js` 或 `styles.css`，部署前必须同步提升 `index.html` 里的资源 `?v=`。

部署规则：

- 默认不部署。
- 只有用户明确要求“部署 / 上线 / deploy”时，才运行 Pages 或 Worker 部署。
- Worker 先于 Pages 部署。
- 涉及 D1 schema 或远程 D1 内容时，默认不执行远程 D1 命令，除非用户明确要求。

## 9. 分阶段落地计划

### Phase 0：文档对齐

目标：

- 用本 DESIGN.md 固化当前页面和目标 Worker 拆分。
- 明确哪些 UI 模块已完成，哪些只是通道和占位。
- 明确每个模块将来对应的 JS 文件。

交付：

- 更新 `cloudflare/yuqing/fenxi/DESIGN.md`。

验证：

- 文档检查。

### Phase 0.5：设置与模块注册框架

目标：

- 先落舆情分析页设置抽屉、D1 持久化和 Worker 可读取配置。
- 不实现具体分析算法，不删除任何 PLANNED。
- 为后续逐模块填入建立统一模块 key、默认设置和设置快照。

文件：

- `cloudflare/yuqing/fenxi/index.js`
- `cloudflare/yuqing/yuqing-worker.js`
- `js/data-engine.js`
- `js/pages/news.js`
- `styles.css` 如需补样式

输出：

- D1 设置 key：`sentiment_analysis_dashboard`
- 前端设置：`visibility`、`analysisCoverage`、`searchCoverage`
- Worker 报告快照：`report.settingsSnapshot` 与 `grounding.settingsSnapshot`
- 设置接口：`GET/PUT /api/yuqing/settings/sentiment-analysis`

边界：

- `visibility` 只影响页面显示。
- `analysisCoverage` 影响手动/定点二次分析纳入哪些模块。
- `searchCoverage` 只影响增量搜索和未来定向验证搜索，不控制行情、衍生品、强平等硬数据源。
- 老报告没有设置快照时，前端使用默认配置展示。

验证：

- `npm.cmd run lint`
- `npm.cmd run verify:yuqing`
- 若同时改 Worker 生成路径，补跑 `npm.cmd run verify:api`

### Phase 1：无行为变化的文件拆分

目标：

- 不改变报告输出，只把 `sentiment-logic.js` 中已有函数迁入模块文件。

文件：

- `shared.js`
- `risk-regime.js`
- `risk-thresholds.js`
- `catalyst-calendar.js`
- `report-compose.js`
- 更新 `index.js`

迁移：

- `marketStateFromLegacy` 迁到 `risk-regime.js`。
- `riskRadarFromInputs` 和 `opportunitiesFromInputs` 迁到 `risk-thresholds.js`。
- `calendarFromFacts` 迁到 `catalyst-calendar.js`，但保留“事实池日历只是占位”的注释。
- `trendReadForSentiment` 暂时迁到 `report-compose.js` 或独立 `trend-read.js`。

验证：

- `npm.cmd run lint`
- `npm.cmd run verify:yuqing`

风险：

- 导出路径改错会影响 Worker 构建。
- 需要保持旧函数名导出，避免主 Worker 断裂。

### Phase 2：硬数据矩阵与市场上下文标准化

目标：

- 新增 `market-context.js` 和 `hard-data-matrix.js`。
- Worker 开始双写 `hardDataMatrix`，前端仍兼容旧推导。

文件：

- `market-context.js`
- `hard-data-matrix.js`
- `report-compose.js`

输出：

- `report.hardDataMatrix`
- `report.quality.marketSnapshotOk` 保持兼容。

验证：

- `npm.cmd run lint`
- `npm.cmd run verify:yuqing`
- 如改 endpoint 压缩逻辑，再跑 `npm.cmd run verify:api`

优化点：

- 增加每个源的 `freshness`。
- 增加 `missing_reason`。
- 避免前端直接理解原始 endpoint 结构。

### Phase 3：Agent 结构化输出与抗失真审计

目标：

- 新增 `agent-context.js` 和 `distortion-audit.js`。
- 把当前前端临时推导的 flag 固化到 Worker 报告。

文件：

- `agent-context.js`
- `distortion-audit.js`
- `report-compose.js`

输出：

- `report.agentContext`
- `report.distortionAudit`

验证：

- `npm.cmd run lint`
- `npm.cmd run verify:yuqing`

前端改造：

- `js/pages/news.js` 优先读取 `report.agentContext`，没有时再 fallback 当前推导。
- `js/pages/news.js` 优先读取 `report.distortionAudit`，没有时再 fallback 当前审计拼装。

### Phase 4：叙事定价验证模块

目标：

- 新增 `narrative-validation.js`。
- 从上游日报中提取叙事候选，并和硬数据矩阵联通。

文件：

- `narrative-validation.js`
- 可能新增 `directed-search.js`

输出：

- `report.narrativeValidation`

关键点：

- 从 `daily.report.topStories`、`dynamicBriefs`、`trendRead` 生成候选。
- 生成 `validation_status`。
- 明确 `funds_follow_confirmed`。
- 明确 `degrade_reason`。

验证：

- `npm.cmd run lint`
- `npm.cmd run verify:yuqing`
- 若新增搜索调用，补充 verify 断言：搜索结果必须进入 grounding。

### Phase 5：精准催化剂时间轴

目标：

- 把当前 `calendarFromFacts` 降级为 fallback。
- 接入可靠的财经日历或硬编码确定性日历。

文件：

- `catalyst-calendar.js`
- 可能新增 `calendar-sources.js`
- 可能新增 D1 migration 或静态 JSON。

输出：

- `report.catalystCalendar`

关键点：

- `startsAtUtc` 必须来自结构化源。
- `precision=time` 才允许倒计时。
- 事实池新闻发布时间不能当作事件时间。

验证：

- `npm.cmd run lint`
- `npm.cmd run verify:yuqing`
- 若新增 D1 schema，补 D1 migration 检查。

### Phase 6：科技叙事溢价复核

目标：

- 新增 `tech-premium.js`。
- 把 AI/科技新闻从“信息卡片”升级为“风险偏好复核模块”。

文件：

- `tech-premium.js`

输出：

- `report.techPremium`

关键点：

- 不能让 AI 新闻直接影响交易方向。
- 必须和风险偏好、纳指/科技代理或市场数据联动。
- 没有市场确认时，输出“等待资金面复核”。

验证：

- `npm.cmd run lint`
- `npm.cmd run verify:yuqing`

### Phase 7：前端读取新字段

目标：

- 前端从 Worker 新字段读取模块数据。
- 保留旧报告 fallback，支持 D1 历史回档。

文件：

- `js/pages/news.js`
- `styles.css` 如有必要
- `index.html` 资源版本号

改造顺序：

1. 资金风险温度读取 `riskRegime`。
2. 硬数据矩阵读取 `hardDataMatrix`。
3. 叙事定价验证读取 `narrativeValidation`。
4. 时间轴读取 `catalystCalendar`。
5. 风险阈值读取 `riskThresholds`。
6. Agent 输出读取 `agentContext`。
7. 抗失真审计读取 `distortionAudit`。
8. 科技复核读取 `techPremium`。

验证：

- `npm.cmd run lint`
- `npm.cmd run verify:yuqing`
- 本地 Vite 打开 `http://127.0.0.1:5173/index.html#/news-analysis`
- 桌面和移动端检查无横向溢出。

### Phase 8：专项回归与部署

目标：

- 补足 `scripts/verify-yuqing-reports.cjs` 对新 fenxi 字段的断言。
- 用户明确要求后再部署。

验证：

- `npm.cmd run lint`
- `npm.cmd run verify:yuqing`
- `npm.cmd run verify:api`
- `npm.cmd run build`

部署：

- 若只改前端，部署 Pages。
- 若改 Worker，先部署 Worker，再部署 Pages。
- 部署 Pages 前提升 `index.html` 中 `styles.css` 和 `js/pages/news.js` 版本号。

## 10. 当前 PLANNED 清单

保留 PLANNED 的原因：这些模块的 UI 通道已预留，但 Worker 数据源、模块拆分或验证脚本尚未完整落地。

- 宏观日历 timestamp：需要结构化财经日历源。
- VIX/MOVE/美债收益率差：需要宏观代理数据源。
- BTC 期权隐波/偏斜：需要 Deribit 或衍生品 Worker 显式输出。
- 定向二次搜索：需要按叙事 ID 触发，并写入 grounding。
- `agentContext`：当前前端推导，Worker 尚未持久化。
- `distortionAudit`：当前前端拼装，Worker 尚未独立输出。
- `narrativeValidation`：当前由旧字段临时拼装，Worker 尚未专门生成。
- `techPremium`：当前展示 AI 情报，未与科技资产和风险偏好硬数据联动。
- `scoreBreakdown`：资金风险温度分数尚未拆解成可解释权重。
- 数据新鲜度：部分 endpoint 有时间字段，但还未统一 `stale` 判定。

## 11. 最重要的实现边界

- 不要为了让页面“看起来有内容”而用 LLM 补不存在的数据。
- 不要用新闻发布时间伪装宏观事件时间。
- 不要把第一页日报总结再次喂给 LLM 后当作新增事实。
- 不要让第二页输出买卖方向或仓位。
- 不要删除 PLANNED 占位，除非对应 Worker 模块、数据源、前端读取和验证都已完整可用。
- 每次只落地一个模块时，其他模块的占位和 PLANNED 必须保留。
