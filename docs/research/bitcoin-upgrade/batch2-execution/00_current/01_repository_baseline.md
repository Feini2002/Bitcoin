# 卷01｜当前仓库证据基线与旧报告差异

查询日期2026-09-17。仓库 `Feini2002/Bitcoin`，固定提交 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`，提交记录时间2026-09-16T08:54:24Z。本轮通过GitHub连接器读取分段源码及目录，没有成功下载或克隆整仓，因此不把分段审阅写成全文件或全仓运行审计。

## 1. 五类证据不能互相替代

**R-current**：本轮直接读取的固定提交源码；可证明代码中的逻辑和声明。**R-record**：同一提交中的测试、运行和部署记录；可证明作者记录了这些事，不能冒充本轮重新测试。**R-local-old**：用户提供的2026-09-16本地事实报告，包含未提交与未跟踪修改；不等于当前remote commit。**E**：本轮公开官方资料，支持接口或产品方法；不支持本仓库运行效果。**D/H**：本报告的设计/假设，必须以试验或实际代码绑定闭合。

文件清单、返回的blob SHA及所读范围在`04_evidence/sources.json`。部分较长返回被工具截断，本轮只使用完整可见的段落作结论；范围索引不是声称整段均已完整审计。没有检查的调用方、数据库迁移执行情况和生产输出保持未知。

## 2. 当前系统不是“几个空页面加API”

原生JS控制台已包含行情、订单流、强平、衍生品与舆情页面。现有工作有请求代次、取消、缓存、历史输入、方向映射、已有测试命令和Cloudflare发布清单。图表数学库有EMA、ATR、RSI、布林和MACD；足迹基于真实聚合成交，不是仅用涨跌K线猜买卖量。不能把用户自评“专业度低”当作所有实现都应删除的证据。[C11｜js/chart/indicator-math.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/chart/indicator-math.js#L1) [C19｜js/orderflow/footprint-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/orderflow/footprint-engine.js#L1) [C23｜js/pages/orderflow.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/orderflow.js#L1) [C24｜js/heatmap/liquidation-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/heatmap/liquidation-engine.js#L1) [C30｜package.json（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/package.json#L1)

同时，新旧数据路径并行：旧BTC库为四页提供主要消费数据；finance通用网关按参数缓存原始响应；规范dataset层将选定来源转换成观察；独立snapshot又以自己的压缩逻辑读取旧表。新数据齐全不会自动使旧页面或模型正确，必须检查实际消费入口。

## 3. 已读取模块地图

| 模块 | 已确认职责 | 不能据此推定 |
|---|---|---|
| `cloudflare/finance/registry.mjs` | 固定来源、操作与参数白名单、端点说明和费用标签 | 每个端点仍然免费、全部已获商用权、93项全部运行通过 |
| `gateway.mjs` | 有界请求、重定向手动处理、敏感回显过滤、D1/边缘缓存、dataset路由 | 外层认证完善、全球请求配额和并发刷新已全部可靠 |
| `datasets.mjs` | 32个选定规范数据集、原生字段、基础格式验证 | OHLC不变量、盘口排序、产品规格、真实闭合已完全验证 |
| `dataset-store.mjs` | 观察按receipt留存、按known_at选择、状态读回 | 公共当时可见性、无限历史、生产增长成本可接受 |
| `js/pages/chart.js` | 图表、标题、WS增量、局部状态和上级周期读取 | 所有读取同一版本、所有bar闭合、标题永不被迟到响应覆盖 |
| `indicator-math.js` | 指标与结构方法 | 结构分是概率、所有命名状态都可被触发 |
| `footprint-engine.js` | 分箱、VP、失衡、SFP、freshness和展示降级 | 基础tick等于真实交易步长、历史信号均当时可知 |
| `liquidation-engine.js` | 两所事件归一化、缓存和价桶 | 两所price/qty同义、未知方向可归多头、完整清算量 |
| `pressure-matrix.js` | 规则型压力场景与输入覆盖提示 | 完整24h、季度年化数值和8h资金费口径一直成立 |
| `js/pages/derivatives.js` | 同source-family变化、矩阵与解释 | source family相同即同合约、所有百分比无需字段定义 |
| `marketSnapshotProgram.mjs` | 四页压缩与多角色输入 | 与四页相同方法、同一有效窗口或全部样本新鲜 |
| `fenxi/sentiment-logic.js` | 固定规则到分析页面结构的转换 | 统计置信度、真实事件机会、精确催化剂 |

直接源码见[C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1) [C06｜cloudflare/finance/dataset-store.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/dataset-store.mjs#L1) [C07｜cloudflare/finance/gateway.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/gateway.mjs#L1) [C08｜cloudflare/finance/gateway.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/gateway.mjs#L170) [C11｜js/chart/indicator-math.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/chart/indicator-math.js#L1) [C19｜js/orderflow/footprint-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/orderflow/footprint-engine.js#L1) [C24｜js/heatmap/liquidation-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/heatmap/liquidation-engine.js#L1) [C25｜js/heatmap/pressure-matrix.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/heatmap/pressure-matrix.js#L1) [C27｜js/pages/derivatives.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/derivatives.js#L1) [C28｜cloudflare/snapshot/marketSnapshotProgram.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/snapshot/marketSnapshotProgram.mjs#L530) [C29｜cloudflare/yuqing/fenxi/sentiment-logic.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/yuqing/fenxi/sentiment-logic.js#L1)。

## 4. 必须纠正的旧结论

### 4.1 FRED与期权不再是“未找到任何代码”

当前已有9个FRED数据集、SOFR及Deribit BTC options摘要。新模块自身仍限定为有限采集表，并未切换前端/模型。部署记录提到读回数据，但它不是完整vintage数据、不是持续期权链，也不保证所需bid/ask/Greeks齐全。升级对象应从“新增适配”改为“补足规格与验证，接消费与增量”，而不是再找一个新库。[C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1)

### 4.2 主图标题混现货已不是同一个问题

当前标题函数使用永续REST与新的`/market/ws/`路径；旧注释或审查笔记不能证明还在使用现货。标题仍有异步竞争风险，应按采样时间和请求代次接受结果；历史K线的venue字段问题则仍然独立存在。标题正确不会反向修复过去存储的来源。[C17｜js/pages/chart.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/chart.js#L900) [C18｜js/pages/chart.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/chart.js#L1370) [C10｜cloudflare/schema.sql（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/schema.sql#L1)

### 4.3 不能再泛称没有质量控制

规范层有基础数字转换，gateway有参数与响应上限，衍生品旧表有source/metric health、锁和同步runs。审查应定位缺失的不变量和消费路径，例如`Number(null)`在另一个模块仍变成0、页面只用最新一个健康点覆盖整个窗口，而不是建议再建一套通用“生产级可观测性”。[C05｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L77) [C07｜cloudflare/finance/gateway.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/gateway.mjs#L1) [C10｜cloudflare/schema.sql（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/schema.sql#L1)

### 4.4 不应将仓库文档中的PASS当成本轮结论

当前文档报告32数据集规范写入/读回、若干HTTP状态和部署检查；用户旧事实报告另有161/96/15行PASS标记。这些验证发生于各自记录的环境与时间，而且行数不是测试用例数。本轮没有重新运行这些测试，也没有确认远程Cron与实际数据完整率。后续应重新验证所修改的实际路径，而不是无限重跑所有历史命令来替代金融语义测试。

## 5. 新数据的三个成熟度不能混为一谈

`registered`表示配置列出了来源；`observed`表示某次获取并保存了响应；`consumable`表示字段、窗口和质量满足指定方法；`live-operational`还需要连续调度、错误退化、保留与恢复验证。它们是设计标签，不要求替换现有枚举，但产品页面不能用一个“已接入”覆盖这四个阶段。

例如`deribit-btc-options`可以在目录中registered，在某次bootstrap后observed；缺少目标期限的双边报价时，不能作为25delta偏斜计算的consumable输入。`binance-perp-book`有20档单时点快照，可计算该时点可见范围，不等于live-orderbook，也不支持过去逐事件排队位置。

同理，旧`funding_binance`键实际可容纳回退来源。新`binance-perp-funding`是一个更明确的物理来源身份，但旧UI仍消费前者时，不能因目录改进而取消旧路径风险。这正是本轮需要跨页面、快照、LLM、导出同时对照的原因。

## 6. 固定提交到开发工作区的绑定步骤

开发代理先读当前HEAD、工作树差异和已有任务负责范围；将本文每个问题绑定到实际函数。如果当前代码已修复，记录对应提交和测试，不强行恢复旧实现以满足报告。如果发生重命名，只更新职责映射，不因为本方案给出路径就另建同名目录。

仅对本次切片的相关文件保存基线摘要。不要`reset`、`clean`、批量checkout到审查提交，也不要删除不认识的未跟踪文件。仓库README可能包含改代码后默认部署的工作约定；本次请求只要审查和方案，并未授权发布。后续开发应明确是否仅本地实现、是否允许外部调用及是否部署，不能由资料包自动扩权。

## 7. 审查仍然没有覆盖什么

没有逐行读取主行情Worker全文件、所有前端渲染、全部finance provider定义、外层认证与Cloudflare Access配置；没有重跑D1查询计划或恢复故障；没有检查已配置secret值；没有逐一核验93项API当前权益；没有实测高波动时的吞吐、内存或行情缺口。

这并不使已读函数中的逻辑矛盾失效，但限制了可以作出的结论。报告中的“存在可触发风险”不等于生产发生过；“基础验证缺少某检查”不等于上游一定送入坏记录；“旧压缩使用不同启发式”不等于所有报告都错误。每个未知被绑定到具体实验，不通过专业术语补齐。
