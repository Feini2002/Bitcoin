# 比特币系统升级资料总纲

更新日期：2026-09-21。**当前开发状态：东京出口已接线完毕，不再当待办。** Worker 出站经灰云 `bit-egress.feiniwork.com` 反代；desk 主带已恢复；生产 `#chart` / `#orderflow` / `#heatmap` 已点检。直连五域仍 403。K 线 live tape 由 Durable Object 写入 D1，分析读口仍是 `/api/desk`。Deribit 等限额项继续停每日采集。第一批研究资料保持原位归档；第二批可执行主线在独立目录。

日常修改优先使用[功能定位入口](QUICK_ROUTER.md)或 `node scripts/research-context.cjs "当前问题"`，不必每次阅读本总纲。第二批连续开发只读 [第二批执行总任务](batch2-execution/EXECUTION_MASTER.md) 与 [执行日志](batch2-execution/EXECUTION_LOG.md)。云端三库与四页装配见 [2026-09-21 治理记录](../cloud-d1-desk-governance-2026-09-21.md)。各源秒/分/日限额见 [刷新频率复核](../data-refresh-cadence-2026-09-21.md)。

## 第二批执行入口

- [第二批执行总任务](batch2-execution/EXECUTION_MASTER.md)
- [执行日志](batch2-execution/EXECUTION_LOG.md)
- [原始压缩包](archives/bitcoin_batch2_execution_ready_2026-09-17.zip)
- 第一批原件仍在 [sources/2026-09-16](sources/2026-09-16/README.md) 与 [archives/bitcoin_research_final_2026-09-16.zip](archives/bitcoin_research_final_2026-09-16.zip)，不重排、不覆盖。

## 当前开发状态

以下是 2026-09-21 傍晚仓库事实。后文归档阶段记录仅代表当时状态；原始研究包仍是参考资料，不是执行指令。线上 Worker/Pages 版本以当次部署为准。

| 范围 | 现在怎样 | 尚未完成或限制 | 详细记录 |
| --- | --- | --- | --- |
| 研究与规则 | 原包归档、来源编目、17 条功能路由、CodeGraph；修改先查资料 | 不表示原包全部架构或 F/WP 任务已经实施 | 本总纲、AGENTS.md、[功能入口](QUICK_ROUTER.md) |
| 免费平台 | 40 个平台 / 93 项操作已登记；7 个免费 Key 及 SEC 联系在 CF。2026-09-22 起 Deribit 期权摘要经 VPS、6 小时一次 | Alpha、GDELT、BLS 仍不进时钟。财政部接口不并进时钟 | [采集路由](../data-collection-routing-2026-09-22.md)、[平台限制](../free-financial-platform-limits-2026-09-16.md)、[限额停采](../finance-daily-quota-skip-2026-09-21.md) |
| D1 数据 | 32 个规范集；2026-09-21 起自动采集已打开；live tape 写 `klines` 尾部 | live 会覆盖未收盘尾部，不回写混源历史 | [数据与工作台方案](../workbench-binance-data-plan-2026-09-16.md)、[刷新频率](../data-refresh-cadence-2026-09-21.md) |
| 行情与图表 | desk `pricePathAvailable` 已真；生产三页已点检。足迹 `fromId` 过期时改拉最近成交（`3.9.6-footprint`） | 工作台聚合/布局改版未做；旧 K 线、资金费与 OI 表仍有历史跨所回退。导航「主源未恢复」是写死文案。足迹画面仍可能写未确认 | [工作台方案](../workbench-binance-data-plan-2026-09-16.md)、[刷新频率](../data-refresh-cadence-2026-09-21.md)、[币安诊断](../binance-connectivity-2026-09-16.md)、[接线现状](../binance-egress-vps-cutover-2026-09-21.md) |
| 刷新频率 | 已按官方上限写入节奏；过期硬删除无回收站 | 亚分钟依赖 DO；Cron 最短 1 分钟；OI/盘口/足迹未上交易所物理上限 | [刷新频率复核](../data-refresh-cadence-2026-09-21.md)、[限额停采](../finance-daily-quota-skip-2026-09-21.md) |
| 币安出口 | 东京 Vultr + Caddy 灰云已上线：永续 REST/WS、现货 vision、sapi、Bybit/OKX/Bitget REST、Bybit 强平 WS。浏览器仍直连官方 fstream | 不要橙云；不要用 CF 公布 IP 做防火墙；不要先改 origin 再探通。清空 origin 回直连（会再 403）。sslip.io 仅 Caddy 回退。VPS 迁移本身没有留下项 | [接线现状](../binance-egress-vps-cutover-2026-09-21.md)、[对抗审查](../binance-egress-plan-adversarial-2026-09-21.md)、[本地出口机](../binance-egress-vps-local-2026-09-21.md)、[通路再核](../binance-egress-workable-fixes-2026-09-21.md)、[出口封锁](../binance-egress-block-2026-09-19.md) |

验证：全量 build 通过。网络成功只证明采样时点。本地 `.artifacts/` 不纳入 Git 或 Pages。源码提交不等于 D1、Secret 或账户配置备份。

下一轮按用户新指令启动，不自动执行：

1. 为主行情建立严格币安品种、合约类型、来源与时效契约，处理旧表混源；现有数据保留，不未经核验清洗覆盖。出口侧不要在反代未通时只改 origin，不用别所冒充币安。
2. 在免费额度内落实增量调度、缺口回补和修订保留；先评估 D1 实际读写与存储预算。
3. 实施已记录的工作台聚合和图表方案：币安主源、辅助数据分层、统一窗口和单位，显式显示缺失/过期；同步覆盖快照、报告与分析输入。可顺手改掉导航写死的「主源未恢复」。
4. Deribit 期权摘要已按 [采集路由](../data-collection-routing-2026-09-22.md) 以 6 小时经 VPS 采集。Alpha、BLS、GDELT 仍不进时钟。

本目录整合用户提供的最终研究包与仓库原有研究文档，供之后逐项讨论和修改系统。这里只建立分类、阅读入口和代码定位，不把报告中的方案、命令、提示词或任务清单当作本次执行指令。实际开发范围由后续用户任务与适用仓库规则确定。

## 从这里开始

| 需要做什么 | 入口 |
| --- | --- |
| 了解整体方向与资料身份 | 本页 |
| 按具体问题查方案、调研和案例 | [阅读路由](READING_ROUTES.md) |
| 找现有页面、数据链路及相关验证 | [仓库对应表](REPOSITORY_MAP.md) |
| 阅读研究包作者的总纲 | [原包当前总纲](sources/2026-09-16/00_start/01_master_solution.md) |
| 浏览完整设计 | [16 卷目录](sources/2026-09-16/01_accepted_plan/README.md)；[合订本](sources/2026-09-16/01_accepted_plan/complete_plan.md) |
| 理解终审修订与限制 | [终审说明](sources/2026-09-16/02_adversarial_review/01_adversarial_review.md)；[交付状态](sources/2026-09-16/DELIVERY_STATUS.md) |
| 回查整理前仓库调查 | [仓库基线材料](repository-baseline/README.md) |

## 整合后的方向

以下是对资料的归纳，属于**待逐项核对和采用的设计方向**，不代表现有系统已经具备，也不代表一次性批准全部改造。

1. **围绕研究问题组织产品。** 从“罗列指标和资讯”走向“市场发生什么变化、证据有何分歧、哪些条件值得观察、还有什么未知”。保留有用的行情、足迹、强平、快照和云端报告能力。
2. **先让事实与解释对得上。** 区分真实中性、数据缺失、数据过期；区分描述性分数与经过校准的概率。报告涉及哪些数据，就核对相应单位、来源、窗口和比较基线。
3. **把材料转为可追溯证据。** 来源发现、正文提取、内容版本、事件归并、更正和检索各有职责；新增来源应填补具体盲区。市场数据与事件材料并行进入研究，不要求先建全网采集平台。
4. **逐步统一研究输入与历史。** 将一次分析实际使用的市场窗口、材料版本、方法和结果关联起来；保留旧报告，并诚实说明历史能够恢复到什么程度。具体物理表和服务数量留待对应任务决定。
5. **模板与模型分开评价。** 先有可核对的事实和简报，再判断模型解释、新来源或额外角色是否带来增量。缺少证据、没有重要变化时允许短输出。
6. **用实际问题决定架构扩展。** 现有 JS、Pages、Workers、D1 和云端模型适配是可复用起点；独立计算、持续采集服务、期权、ETF、向量检索及多代理都是条件选项。

对应设计主线为：**实际输入 → 事实与变化 → 相关事件及反证 → 模板或模型解释 → 证据与历史 → 使用效果评价**。这是资料中的逻辑职责，不是已经新增的服务拓扑。

## 分类与存放位置

| 目录或文件 | 内容 | 使用方式 |
| --- | --- | --- |
| [sources/2026-09-16/](sources/2026-09-16/README.md) | 最终研究包完整解压内容，共 219 个文件 | 保留原文件名、目录和字节；日常通过外层索引查阅 |
| [00_start](sources/2026-09-16/00_start/01_master_solution.md) | 当前总纲，1 个文件 | 先理解问题与设计方向 |
| [01_accepted_plan](sources/2026-09-16/01_accepted_plan/README.md) | 40 个文件：16 卷、合订本、契约、合成样例、任务及事实输入 | 深入某项设计；目录名沿用原包，不表示已批准实施 |
| [02_adversarial_review](sources/2026-09-16/02_adversarial_review/01_adversarial_review.md) | 3 个文件：审查、更正范围、依赖分析 | 了解方案取舍与修订背景 |
| [03_research](sources/2026-09-16/03_research/README.md) | 25 个专题及索引，共 26 个文件 | 查研究方法与外部经验 |
| [04_reuse_cards](sources/2026-09-16/04_reuse_cards/README.md) | 67 张软件、服务、规范及方法卡和索引 | 比较复用、自建与采购候选 |
| [05_cases](sources/2026-09-16/05_cases/README.md) | 14 个案例及索引 | 理解具体可迁移经验 |
| [06_collection_design](sources/2026-09-16/06_collection_design/01_collection_handbook.md) | 12 个文件：采集手册、来源、契约、查询配方与合成场景 | 查资料收集和证据生命周期 |
| [07_codex_usage](sources/2026-09-16/07_codex_usage/01_reading_and_selection.md) | 5 个文件：阅读方法、提示词、记录模板等 | 仅作未来任务的表达参考，不自动激活提示词 |
| [08_evidence](sources/2026-09-16/08_evidence/coverage_matrix.md) | 11 个文件：来源登记、覆盖、研究日志与索引 | 回溯出处及证据限制 |
| [09_prior_research](sources/2026-09-16/09_prior_research/README.md) | 3 份前期研究与索引 | 查观点演进，不当作最新设计入口 |
| [10_final_review](sources/2026-09-16/10_final_review/README.md) | 21 个文件：限定任务、契约迁移、审查结果与 3 个 Python 脚本 | 查终审后的设计细节；脚本原样保存，本轮未运行 |
| [90_archive](sources/2026-09-16/90_archive/README.md) | 8 个文件，含上一轮原始 ZIP | 历史追溯；内层 ZIP 不重复展开 |
| [repository-baseline/](repository-baseline/README.md) | 从仓库根目录移入的两份文档 | 保留本仓库材料及其原始语境 |
| [archives/](archives/README.md) | 本次收到的原始 ZIP | 保留可重新解压的原件 |

原包根层另有 5 个文件：README、DELIVERY_STATUS、FINAL_REVIEW、LIBRARY_INDEX 和 MANIFEST。原包的[文件索引](sources/2026-09-16/LIBRARY_INDEX.json)与[清单](sources/2026-09-16/MANIFEST.json)仍只描述原包，不扩展为整个仓库清单。

## 资料身份与版本关系

- **本页、阅读路由和仓库对应表：** 本次新增的导航层，帮助定位材料；不替代原报告的完整论证。
- **sources/2026-09-16：** `final-review-1.1-design` 资料快照。原包说明当前正文已吸收终审修订，`01_accepted_plan` 是保留路径；`research` v2.1-design 与 `collection` v2-design 均为设计契约，未据此修改生产结构。
- **repository-baseline 与包内 inputs：** 调查时的事实记录，不能证明当前线上状态。两组文件分别保留，差异见[基线说明](repository-baseline/README.md)。
- **专题、复用卡和案例：** 可选择的研究素材，外部版本、费用、可用性与许可按后续任务需要重新核对；本轮未联网复核。
- **results、fixtures、tests：** 分别是原包作者的检查记录、合成规格和参考检查脚本，不能记作本仓库本轮通过的业务测试。
- **历史报告与旧包：** 用于追溯，不与终审设计并列为当前方案；若后续发现资料冲突，记录具体差异，避免静默改写原件。

## 后续逐项修改的入口

资料包提供了以下五种可选切片；这里仅作索引，**尚未选定或启动任何一种**。用户也可以直接提出局部问题，不必采用其中一个完整切片。

| 原包名称 | 对应问题 |
| --- | --- |
| market_template | 用已有市场输入形成确定性简报 |
| collection_pilot | 为一个信息缺口试验来源与内容版本管理 |
| integrated_template | 把有限事件材料与市场模板连接 |
| model_brief | 在市场模板基础上评价模型解释 |
| integrated_model | 在有限市场与事件输入上评价模型解释 |

具体内容查[当前 F-00～F-10 任务](sources/2026-09-16/10_final_review/scoped_work_packages.md)与[机器任务索引](sources/2026-09-16/10_final_review/scoped_tasks.json)。原有 60 个 WP 保留为完整规格库；F 是其中部分范围的映射，不能把一个局部完成记成整个 WP 已完成，也不用按 60 项顺序开始开发。

之后提出一个功能或问题时，可按“阅读路由 → 仓库对应表 → 相关原文”定位，再依据当时源码确认影响范围。具体实现、测试与发布遵从该次请求；无需先执行资料包中的命令、采购候选或全套数据库设计。

## 初始资料归档阶段边界（历史记录）

- 已完成：解压、分类、原件归档、两份根目录研究文档迁入、总纲与主题/代码路由、仓库入口链接。
- 未启动：任何 F/WP 的业务实现、数据迁移、外部服务接入、模型调用、线上部署或 Git 提交推送。
- 文档与归档不在 [Pages 资产清单](../../../config/pages-assets.json)内；没有修改前端 hash 路由、资源版本、构建配置或业务代码。
- 后续新增讨论或决策可放在本目录并补入入口；需要修订原包内容时另存新版，保留本次来源快照。

## 初始归档核对结果（历史记录）

- 解压核对：ZIP内219个文件与归档目录逐文件字节比较一致，没有缺失或额外文件；未改写原包清单。
- 迁入核对：两份原根目录研究文档与Git中的原正文一致（比较时仅统一换行），本次仅移动位置。
- 文档核对：扫描173份Markdown，643处本地链接、26处Markdown锚点通过；1743处外部链接未联网检查。
- 仓库检查：`node scripts/run-bounded.cjs 30 npm run lint` 通过79个语法检查；`git diff --check` 无空白错误。
- 范围：本次未运行完整构建、浏览器/生产验证、资料包自带脚本或业务升级测试。核对记录保存在本地 `.artifacts/research-library/`，这些结果不证明设计已实现或外部资料仍然有效。
