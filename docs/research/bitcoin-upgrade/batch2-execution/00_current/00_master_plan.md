> 执行路线已在本次整理中统一：请先读[唯一执行总任务](../EXECUTION_MASTER.md)。本卷是技术设计底稿，不再提供另一套任务调度；原源码/外部核验日期不变，本次未重新联网审库。

# 卷00｜当前仓库系统升级技术总纲（执行入口已统一）

**审查日期：2026-09-17，Asia/Singapore。代码基线：`a6ef6c8974dcdaace32acf25c3a231ecd279ef37`。** 本版直接读取 GitHub 固定提交的关键源码及文档；没有运行该仓库、访问生产数据库、调用真实模型、修改代码或部署。它不是上一版事实报告换日期。

## 1. 一句话结论

**最有价值的升级不是再连接几十个接口或把五个角色变成真实 Agent，而是把已经取得的数据转成语义一致、时间明确、可以复核的研究输入，并让四个数据页面和云端分析真正消费同一套方法。** 在此基础上增加成交成本、变化、分歧和条件研究，收集层补独立事件与更正，分析层按问题调用，而不是按角色数量调用。

这不意味着系统“只有基础治理可做”。本方案明确增加完整会话 VWAP、成交额与主动占比、同窗 OI/价格分解、有限盘口深度与模拟成交成本、规则可重放的结构/SFP、期权期限与质量截面、事件催化剂和观点复盘。新增能力必须能回答具体问题；不能只改文案，也不能以数据工程无限推迟可用页面。

## 2. 研究起点已发生变化

上一份本地事实报告认为没有确认 FRED/ALFRED 或 Deribit 请求链。当前提交的 `cloudflare/finance/datasets.mjs` 已经明确登记 FRED、Deribit 期权、Binance 永续/现货和稳定币等 32 个数据集。目录同时写明 `automaticCollection:false`、`frontendConnected:false`。因此正确结论是“有新的获取和持久化基础，尚未自动收集或连接旧四页”，不是“没有这些代码”，也不是“这些指标已经参与了分析”。[C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1)

当前仓库文档记录了 40 个平台/产品、93 个固定操作及 16,260 条规范记录读回，并记载网络和部署探测。这里引用的是**仓库作者的历史验证记录**，本轮没有重新访问那些服务，也不据此给线上可用性背书。新增设计先承认并复用这些工作，避免再建一个平行的金融 API 网关。[C02｜docs/research/bitcoin-upgrade/README.md（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/docs/research/bitcoin-upgrade/README.md#L1)

已修正的内容也不能继续当缺陷：主图标题的实际读取路径已收敛到 Binance USDⓈ-M；旧审查中的自动回退现货描述不能覆盖当前函数。剩余问题是历史来源、同一产品内的迟到覆盖、K 线收盘状态及不同采样数据的含义，不是简单重复“标题混现货”。[C17｜js/pages/chart.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/chart.js#L900) [C18｜js/pages/chart.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/chart.js#L1370) [C31｜docs/research/chart-workbench-review-2026-09-16.md（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/docs/research/chart-workbench-review-2026-09-16.md#L1)

## 3. 用户的三层，应怎样落实

| 层次 | 正式职责 | 不应承担的职责 |
|---|---|---|
| 数据层 | 来源适配、原生观察、规格、时间、质量、版本、确定性计算及查询 | 为了页面好看填零、用模型决定单位、把显示像素当分析参数 |
| 舆情/情报层 | 原始发布与社媒线索发现、文档版本、事件与主张、独立性和更正 | 用转载数量当证实、以未搜索推导信息足够、伪造事件时间 |
| 分析层 | 固定材料包下的解释、竞争假设、条件、反证、待查问题和报告 | 自造金融数字、把可用性分数叫成功概率、默认输出交易指令 |

图表是数据的消费端，不是数据真值本身。数据与情报是并行输入；没有相关新闻也能分析市场结构，没有新价格也可处理事件更正。二者通过统一研究上下文汇合。模型更聪明仍然无法弥补混合的产品、错误的百分数或事后生成的历史信号。

## 4. 当前最优先的五个结果

**结果A：一眼知道看的是什么。** 四页页头统一展示 venue、市场类型、基础/报价币、价格类型、实际窗口、完成状态和来源健康。旧混合历史仍可看，但不能标成逐根可追溯的纯 Binance 历史。页面刷新成功不等于市场数据新鲜。

**结果B：修复会改变判断的计算。** 修复近端突破不可达分支、百分比猜测、短窗口冒充24h、未知强平方向落多头、POC并列规则分歧、初始零量VWAP等可静态定位的问题；保留正确的 EMA/ATR 与已有成交方向映射。这里没有要求把所有分数都删掉，要求将启发式诊断、数据质量和预测分开。

**结果C：四页能提供新的有用信息。** 主图增加成交额、同锚定 VWAP 和已完成收益；足迹把固定分析分箱和显示分箱分开；强平用来源分层的已观察冲击，而不是潜在清算池；衍生品按确切结算间隔和 OI 单位展示杠杆条件。它们应能用于报告，但不自动构成涨跌概率。

**结果D：现有 finance 数据真正连到旧系统。** 用薄适配把新 dataset 读模型接到 DataEngine、页面和 capture；只替换必要路径。不让用户看到一套新的数据浏览器、旧页继续用另一套数据、模型再取第三套 latest。

**结果E：一份可反驳的简报。** 使用确认过的市场切片及有限事件，回答“变化是什么、相互支持什么、不能解释什么、下一步核对什么”。有证据缺口就返回缺口；没重大变化是合法结果，但必须限定已检查范围。

## 5. 明确的保留、修改、新增和退出

| 对象 | 决定 | 理由 |
|---|---|---|
| 原生JS、Pages、LWC 4.1.3、已有页面 | 保留并局部重构 | 当前没有证据证明换框架提升数据正确性；该版本已提供多种定制与交互接口 [E16｜Lightweight Charts 4.1 API](https://tradingview.github.io/lightweight-charts/docs/4.1/api/interfaces/IChartApi) |
| finance registry/gateway/dataset-store | 保留，增强验证与消费路径 | 固定端点、有界请求、分离状态和保留receipt有价值；不是缺新网关 [C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1) [C06｜cloudflare/finance/dataset-store.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/dataset-store.mjs#L1) [C07｜cloudflare/finance/gateway.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/gateway.mjs#L1) |
| 旧 K 线/足迹/强平聚合库 | 兼容保留，按类新增元数据 | 历史不可逆损失不能靠改字段名恢复；不能删掉现有有效数据 [C10｜cloudflare/schema.sql（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/schema.sql#L1) |
| 同价失衡、SFP、结构位、压力矩阵 | 保留可解释部分，修复定义与历史可用性 | 这些是规则研究，不应被包装成已校准胜率 |
| 固定 marketState 分数/置信度 | 从新输出退出概率外观 | 62/58/46、72/54仍在当前代码；没有统计依据 [C29｜cloudflare/yuqing/fenxi/sentiment-logic.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/yuqing/fenxi/sentiment-logic.js#L1) |
| 第一份报告的全部市场前置 | 按所用数据裁剪 | 不用期权就不要求先有期权；使用强平则不得省略强平语义 |
| 全量多代理、账户与执行平台 | 暂不采用 | 用户目标是研究辅助，不是增加下单权限 |
| 独立采集/批计算服务 | 按证据启用 | 运行地点能否稳定取得特定数据要测，不能由语言偏好决定 |

## 6. 架构选择：目标是混合职责，不是预购一台服务器

目标逻辑为“来源层 → 规范观察与质量 → 可版本化查询 → 方法与变化 → 固定研究包 → 页面/报告/历史”。初期部署继续使用现有环境。若同一来源在现有合法运行环境不能稳定获取，允许迁出**该采集任务**；如果长期历史研究确有性能需要，允许按批运行 DuckDB/Python，不要求在线四页都迁移。

仓库记录过 Cloudflare 出口访问 Binance 失败而本地入口成功。它只支持提出可达性实验，不证明当前所有 Cloudflare 都不可用，更不授权绕过来源访问规则。独立节点必须满足来源条款、费用和维护条件。当前页面的浏览器直连可以提供用户即时观察，但不应成为任何匿名用户可写入权威数据库的通道。[C02｜docs/research/bitcoin-upgrade/README.md（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/docs/research/bitcoin-upgrade/README.md#L1) [C03｜docs/research/workbench-binance-data-plan-2026-09-16.md（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/docs/research/workbench-binance-data-plan-2026-09-16.md#L1)

大型机构的可借鉴部分是清晰数据规格、时点历史、分层交付和主张追证，而不是内部组织图。Databento 公布了细粒度数据派生较低粒度 schema 的设计；Kaiko 把流、REST和批交付区分；Glassnode区分后来修订与当时版本；RavenPack把实体、事件、相关性和新颖性分别建模。我们借鉴机制，不声称获得它们的私有代码或复现它们的商业服务。[E05｜Databento市场schema与派生关系](https://databento.com/docs/schemas-and-data-formats/whats-a-schema) [E06｜Kaiko交付](https://docs.kaiko.com/cloud-delivery) [E08｜Glassnode PiT](https://docs.glassnode.com/data/point-in-time-metrics) [E09｜RavenPack News Analytics](https://www.ravenpack.com/products/edge/data/news-analytics)

## 7. 当前默认实施顺序

本轮用户要求第二批能够由开发者顺着任务执行，因此不再保留“先任选S1—S6”的当前入口。唯一执行总纲是[EXECUTION_MASTER.md](../EXECUTION_MASTER.md)，详细任务在其链接的阶段MD。

顺序为P00工作区/资料绑定 → P01最小数据与方法 → P02主图 → P03先交模板 → P04衍生品 → P05足迹 → P06强平 → P07情报 → P08模型代码与核验 → P09证据/历史联动 → P10回归/交接。原NEW编号和硬依赖保留；模型实调用、生产、历史与新环境条件按相应分支核验。

第一份模板仅用当时已确认输入，不等其他三页或新情报源。P04先于P06，是压力条件的真实依赖。主线受阻时可做硬依赖已经满足的独立任务，不把顺序表误读成所有前阶段必须全量上线后才能动后一行。

技术内容和修改建议仍在本卷与专项卷；执行总纲只收敛范围、依赖、连续推进与交接方式，没有将原数据方法替换成新的金融结论。

## 8. 文档如何使用

`00_current`是本版当前设计；`01_execution/phases`保存当前逐项执行定义，`01_execution/tasks.json`仅为派生导航；`02_contracts`保存拟议消费契约，不是已经存在的API；`03_validation`是验收样例及本轮文档检查结果；`04_evidence`区分当前源码、外部资料和未验证范围。

`90_reference`保留前轮的专题、工具卡、案例与更详细的通用设计。每份都有日期和历史标签。其“本仓库没有FRED/期权链”“当前执行优先级”等旧判断一律先与本版核对；其参数、候选或SQL不得自动成为安装与建表清单。旧资料的合理方法仍可复用，不需要为了“本轮更新”重写全部已有研究。

## 9. 完成与不能保证的事情

本轮完成的是：固定提交关键路径的静态审查、代码与外部规范对照、四页改造设计、任务及验收规格、文档包检查。没有声称看过每一行代码，没有复跑历史测试，没有访问账户或云端控制面。

确定性矛盾可以直接说明；异步竞态、数据污染发生率、生产容量、用户效率、模型增量和行情预测需要实验。软件存在相应功能不等于在本仓库可用，代码能访问数据不等于所有用途获准，生成了大文档不等于系统已经专业。验收围绕用户减少的错误与重复劳动，而不是新表、角色、接口或总字数。
