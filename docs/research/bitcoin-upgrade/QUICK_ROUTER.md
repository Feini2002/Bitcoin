# 功能定位入口：少读上下文，沿问题查资料与代码

[资料总纲](README.md) · [完整主题表](READING_ROUTES.md) · [仓库对应表](REPOSITORY_MAP.md)

日常修改从这里或本地查询工具开始。总纲、合订本和整份机器目录不用每次加载。先选一个功能路由，读取相关代码与少量资料片段；出现真实依赖时再沿关联路由扩展。

## 最短使用路径

免费金融平台接入先读 [通道实施与免费边界](../free-financial-api-channels-2026-09-16.md)，再查 `finance-channels` 路由；平台名字出现在研究包中不表示有免费 API。

1. 描述问题：例如 `node scripts/research-context.cjs K线历史回补`。返回最相关功能、代码起点、最多3份首读资料及章节行号、CodeGraph查询、条件关联和验证入口。
2. 先看真实代码：执行返回的CodeGraph查询；命令运行仍沿用项目的有界执行约定。索引有代码变化时先 `codegraph sync`，查询可以用 `codegraph query loadChartData --limit 5` 缩小到符号，再用explore查看关系。
3. 任何修改前先读相关资料片段并据此构思：例如 `node scripts/research-context.cjs --file V08 时间和来源`，只返回摘要与章节位置；按该位置读取相关段落。资料不足或过时时，立即定向检索外部来源，核验并沉淀后再实施依赖该结论的修改；具体要求见根目录 AGENTS.md。
4. 若问题涉及共享数据、快照或报告，沿输出的“关联扩展”继续；没有对应依赖就停在当前功能范围。路由是入口提示，不是穷尽式影响分析或必须修改的文件清单。

其他入口：`--list` 列15条功能路由；`--find 期权` 返回最多8份文件摘要；`--file TOOL057` 查图表库复用卡；`--file RES07` 查历史回补研究。自然语言使用关键词匹配，不保证理解所有同义表达；未命中时换关键词或直接输入路由ID，不默认全文加载。

所有查询只读；工具展示的CodeGraph、测试和部署相关文字不会被自动执行。

## K线图：按症状继续定位

最新专项复核：[行情工作台数据与图表评估（2026-09-16）](../chart-workbench-review-2026-09-16.md)。包含来源混用、未收盘状态、VWAP边界与分阶段优化建议；建议尚未实施。

主图数据读取的现有入口是 `loadChartData → readChartD1Klines → DataEngine.fetchKlinesFromD1`，之后通过HTTP进入行情Worker；实时更新另有WebSocket与D1轮询路径。以下符号和职责来自本轮CodeGraph定位及必要的源码片段，不代表已诊断出任何故障。

| 修改点或症状 | 先找代码/符号 | 资料按需读取 | 扩展条件与验证 |
| --- | --- | --- | --- |
| 图形样式、缩放、十字线、恢复视口 | [chart.js](../../../js/pages/chart.js)：initChart、readViewportState、persistViewportNow、restoreChartViewport；样式与indicator-panes | V08 §4市场工作区交互、TOOL057 | 查页面卸载与品种/周期状态；UI验收检查交互后的可见状态 |
| 切周期后旧数据覆盖、新请求取消或标签不一致 | chart.js：loadChartData、readChartD1Klines；[data-engine.js](../../../js/data-engine.js)：fetchKlinesFromD1 | V04 §2通用时间语义、V08 §4.2时间和来源切换 | 主图与多周期都消费请求层；跑market-recovery和UI相关流程 |
| 历史不足、左侧无更早数据、保留窗口、回补 | chart.js、data-engine.js、[行情Worker](../../../cloudflare/binance-klines-worker.js)、[schema](../../../cloudflare/schema.sql) | RES07、V04时间/来源；需要购买历史时再查TOOL025 | 对齐读取上限、Worker保留与实际历史，不只改前端数字；跑kline-history |
| 实时停止、未收盘K线、断线恢复 | chart.js：startChartWs、startChartD1Polling、klineOpenMatchesActiveInterval；共享请求层 | V04 §2.3未完成窗口、RES06 | 核当前周期、D1/实时合并及离页清理；跑market-recovery |
| EMA、ATR等指标、关键位、多周期不一致 | [indicator-math.js](../../../js/chart/indicator-math.js)、[indicator-panes.js](../../../js/chart/indicator-panes.js)、[mtf-tiles.js](../../../js/chart/mtf-tiles.js)；applyIndicatorsFromOhlcv、applyChartKeyLevelsFromOhlcv | V05 §2方法注册表、V04 §3数字精度 | 涉及数值时追踪快照；跑indicator-math及受影响快照验证 |
| 图表结构、证据或指标导出至员工/报告 | [chartStructureSnapshot.mjs](../../../cloudflare/snapshot/chartStructureSnapshot.mjs)、[marketSnapshotProgram.mjs](../../../cloudflare/snapshot/marketSnapshotProgram.mjs)及实际报告消费者 | V10、CONTRACT-MIGRATION | 独立快照与行情Worker摘要分别追踪；跑verify:market-snapshot，影响报告再跑verify:yuqing |

例如“改K线配色”通常从chart和样式起步；“改K线历史长度”应进入chart-history；“改EMA算法”应进入indicators并追踪snapshot。三者不会自动携带整个LLM、采集和部署方案作为上下文。

## 文件级目录怎样维护

- [routing.json](routing.json)保存15条功能路由的关键词、首读资料、章节、代码起点、条件关联和已有验证命令，是查询结果的来源。
- [FILE_CATALOG.json](FILE_CATALOG.json)保存222个导入文件的用途摘要、资料身份和Markdown章节行号。它由程序读取，不建议整个放入对话上下文；219个原包文件、2份仓库基线、1份原始ZIP分别保留。
- `node scripts/research-context.cjs --refresh` 在来源文档新增或变化后刷新目录；只写FILE_CATALOG.json，不改写原件、不执行包内脚本。
- `node scripts/research-context.cjs --check` 检查文件覆盖、资料/代码路径、选定章节行号、关联路由、验证命令及查询样例。出现问题时修正具体映射，不扩大为业务改造。
- 代码重命名或职责迁移时，同步更新对应路由；新功能只补相关路由，不重读整个资料库。原件版本变化仍按总纲约定另存来源快照。

## CodeGraph范围与边界

- 本仓库已使用本机CodeGraph 1.4.1初始化 `.codegraph/`，并实际执行status、query与explore。查询通过CLI可用；本轮未改全局MCP/账号配置。
- [codegraph.json](../../../codegraph.json)排除docs、验收产物、项目技能和本地环境文件；依赖与构建产物沿用CodeGraph默认排除。资料包中的Python和SQL参考不混入现行业务图。
- `.codegraph/` 是可再生本地数据库，已加入Git忽略；换电脑需重新 `codegraph init`，不能只复制本文就当作已有索引。代码变动后用 `codegraph sync`，状态由 `codegraph status` 核对。
- 本轮调用设置 `CODEGRAPH_TELEMETRY=0`、`CODEGRAPH_NO_DOWNLOAD=1`、`CODEGRAPH_NO_DAEMON=1`，使用已有安装、无常驻后台服务。索引不自动持续更新。
- CodeGraph优先用于符号和静态调用关系；本次索引统计主要为JavaScript。浏览器全局脚本、DOM事件、HTTP/API、SQL、配置和D1消费者仍需结合路由表定向确认，不能由图上没有边断言“没有关联”。
- 工具的“未找到覆盖测试”是静态推断，不是本仓库没有测试的结论；已有测试入口以路由与package.json为准。固定数据测试通过也不能证明实时市场源长期可靠。
- 实测 `readChartD1Klines`、`initChart` 能定位，`fetchKlinesFromD1` 的独立符号查询未命中。因此chart-history从前者进入图，再按明确文件路径继续查DataEngine对象方法及HTTP端点；查询工具会同时显示这一具体限制。

## 本轮实际核对

- 222个导入文件、15条路由、17个查询场景检查通过；资料路径、代码路径、关联路由、选定章节行号和已有验证命令可解析。
- 5条实际CLI流程通过：症状查询、章节查询、复用卡查询、资料搜索和未命中反馈；返回功能/章节定位，未输出源码或长报告。
- 8份入口文档的212处本地文件链接检查通过；未重新访问外部研究来源。
- `npm run lint`通过80项语法检查；CodeGraph同步后status显示80个文件且索引最新，query和explore已实际执行。
- 没有业务/UI改动，未运行全量业务回归、浏览器验收、构建或部署。日志和检查结果在本地 `.artifacts/research-library/`，不作为原研究包作者的检查记录。

本轮仅改导航工具、文档与本地索引配置，没有修改业务代码、数据库结构或线上资源。
