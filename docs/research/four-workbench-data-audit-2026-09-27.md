# 四页工作台：采集实况、缺口与补源审查

核对日期：2026-09-27 北京时间；主要线上样本为 2026-09-26 19:35–19:45 UTC。当前源码工作区已有其他会话改动，本记录不覆盖它们。范围为只读审查、真实响应复现及外部研究；未修改运行代码、远程数据、调度或部署。记录与导航属于 L1 可逆文档变更。

## 结论与接续入口

云端已恢复运行，行情采集持续推进；七个行情周期的当前研究窗口合格。四页尚不能整体判定为数据完整可分析：足迹明细在新接口丢失，头部持仓字段映射错误，宏观采集多项失败，强平订阅健康证据与历史覆盖不足。下一轮应围绕下列 C1–C5 补齐数据链路，不需要重新搭架构，也不应重复启动已经完成的 W1–W4。

本记录更新[当前开发方案](repository-development-plan-2026-09-27.md)的运行事实。该方案中“32 个集、3d 无规范数据、5m 600 根、15m 中间洞”等旧样本不能用作当前结论：本次 catalog 为 33 个集，3d 已有规范记录，源码 5m 保留配置已为 900；更早 raw 历史未全部验证仍是事实。

## 实测证据与限制

- `node scripts/run-bounded.cjs 60 npm run cloud:status`：active；BTC 每分钟 Cron 和域名绑定在，BTC 版本 `16af8c68-57ea-41b0-88bf-b284268b11e5`；公开状态 build 为 `btc-worker/3.11.1-context-clocks`。yuqing、snapshot 没有 Cron 不等于故障，应遵从当前已退役任务的契约。
- 主采集器在两次样本间继续收到消息并写入；19:43 样本 messageCount=5655、writeCount=699、lastError 为空，七周期均不需要 reconcile。
- yuqing 自定义域第一次连接超时，第二次自定义域和 workers.dev 均 HTTP 200；snapshot health 中 Worker 与两个数据库探针正常。一次网络失败未认定服务停机，一次成功也不代表长期稳定。
- 正式域名 Playwright 检查进入 Cloudflare Access 登录页，因此未完成生产 DOM 验收。足迹问题证据为线上真实 API 响应、真实前端函数执行及独立 D1 只读兼容接口对照，不能冒称已看见生产页面结果。
- 本次没有重新跑全量 build：未修改业务实现；也没有读取全天监控或账单，因此不作全天可用率和费用保证。

本地原始证据目录：`.artifacts/data-audit-20260927/`。`probe-1790451397989.json` 保存首轮完整响应，`followup.json` 保存第二轮；`footprint-reproduction.json` 保存计算结果；`browser.json` 保存页面受 Access 限制的结果；`sources/manifest.json` 与原始响应保存外部采样时间及 SHA256。采样脚本均在同目录，外层使用 `scripts/run-bounded.cjs` 硬截止，全部已正常退出。云端开关证据另见 `.artifacts/cloud-control/1790451317098-status.json`。这些是本机审查材料，不应假定已提交或在其他电脑存在。

## 四页当前状态

### 行情：当前研究窗合格，完整远期历史仍需区别

首轮各周期 pricePathAvailable=true，collectionStale=false，研究窗 eligible=true；返回窗内没有检测到缺棒。

| 周期 | 返回棒数 | 已验证连续已收盘棒 | 研究要求 |
| --- | ---: | ---: | ---: |
| 5m | 6000 | 904 | 864 |
| 15m | 6000 | 601 | 480 |
| 1h | 6000 | 600 | 336 |
| 4h | 6000 | 600 | 360 |
| 1d | 2576 | 600 | 180 |
| 3d | 380 | 379 | 180 |
| 1w | 369 | 368 | 156 |

这证明当前规定研究窗口可用，不证明返回的全部 6000 根都已验证。3d 规范数据覆盖自 2023-08-16 起；5m 配置 900 与样本暂时多于 900 是清理时机问题，不能误记成已经永久承诺更大保留量。

### 足迹/订单流：P1，已有明细被接口遗漏

线上 `/api/desk/orderflow` 返回 240 根、quality=pass，且采集新鲜，但每行只有 `buy_vol/sell_vol/poc_price` 等汇总，没有 `levels`。`cloudflare/finance/desk.mjs` 的 SELECT 没有读取 `levels_json`，也没有转换成前端契约。

把首轮真实响应输入当前 `js/orderflow/footprint-engine.js` 的 `aggregateFootprintBars` 和 `FootprintAggregator.loadBars`：输入累计 volume=27983.253，合并后与加载后均为 0，价格档位数为 0。前者只读 camelCase 买卖量，后者又只按档位重算。

第二轮独立只读 `/api/d1/footprint?symbol=BTCUSDT&interval=5m&limit=240&sync=0` 返回 240 根、1265 个价格档位、累计量 28068.171。两个样本时间不同，不能直接要求累计量相等，但明确证明档位已在库，无须新增数据商。修复应在 desk 正确传递已有明细，并让聚合、指标、图形和导出保持一致；不能把分析页面悄悄切回旧接口规避统一契约。

### 衍生品/环境：P1 字段丢失；宏观部分采集失败

- 资金费、基差、OI、账户比和主动成交量的最新记录存在；不能概括为衍生品未接入。
- `binance-perp-top-positions` 的 `longPosition/shortPosition` 均为 null，ratio 有数值。D1 保存的真实币安原始响应使用 `longAccount/shortAccount`（例如 0.6576/0.3424），即使接口语义是“头部持仓比例”。`datasets.mjs` 读取错误字段，`verify-finance-datasets.cjs` 的假响应也使用了错误字段，导致测试不能发现问题。应显式把该接口的字段映射到内部持仓语义，不得混成全账户多空比。
- 9 个 FRED 数据集，8 个最后采集状态为 502：DGS2、实际 10 年利率、10 年盈亏平衡通胀、美元、联储资产、TGA、RRP、CPI；DGS10 最后成功。错误是网关记录的 `upstream_http_error`，尚未证明八项各自的上游原始 HTTP 状态或根因，不应笼统断言 FRED 全站宕机。
- 系统利率最新参考日仍为 9 月 24 日；本次财政部直接读取已取得 25 日的 2Y=4.81%、10Y=5.17%、实际 10Y=2.83%。这里存在可实际补入的较新数据，但须核对系列等价关系和来源标记。
- BLS 官方 CPI 季调序列 `CUSR0000SA0` 最新仍是 2026 年 8 月、334.131，与系统一致。因此 CPI 当前数值未证明过时，失败的是采集链路；不能要求月频数据每天产生新观察。
- SOFR 最新数值与 NYFed 直接读取一致，但采集状态停在 14:06，第二轮已超过 5 小时；BTC 手续费也超过其声明刷新周期。应查调度公平性、失败重试和配置，而不是直接提高所有频率。
- premium/OI 两轮中出现 8–15 秒级数据被判 collection/source stale，而实时采集器持续推进。代码以刷新周期直接作为部分陈旧阈值，需把采集频率、正常端到端延迟与真正失联阈值分开；禁止简单关掉 stale。
- 主动量历史存在 9 月 26 日 14:00–15:00 UTC 的 unresolvedGap，已失败 3 次、下次重试 21:34:59 UTC；最新 18:00 记录正常，不足以证明整段历史连续。

### 强平：有历史数据，当前订阅与覆盖仍须核验

- 24h 窗口两所都有非空桶；30d 查询中 Bybit 最早桶约 8 月 27 日，Binance 最早仅 9 月 21 日。因此 Binance 的 30d 选项并不意味着已有 30 天记录。无事件的空桶和采集未覆盖的时间必须区分。
- 19:34:39 启动后到 19:43 第二轮，两所 BTC eventCount 都是 0；Bybit lastSubscribeOk=0、messageCount=0，但 ticker 心跳持续。不能仅凭安静几分钟断定没有采集能力，也不能因状态 `realtime` 就判强平订阅成功。
- 源码 `touchHeartbeat/touchTransport` 会设置 realtime 并清空 lastError；三个 Bybit 订阅共用一个 lastSubscribeOk，没有按 req_id 区分。因此旧 liquidation 订阅失败可以污染 allLiquidation 订阅状态，后续 ticker 又能隐藏错误。应分开传输存活、目标订阅确认、实际事件和落库证据。
- 官方 Bybit `allLiquidation` 接口可继续使用。Binance 与 Bybit 事件语义不同，接入第三方历史也必须保留交易所、产品和原始/推算口径；不能靠跨所合计掩盖缺数。

## 外部来源核验与取舍

查询日期均为 2026-09-27；下面是当前文档和本次 GET 样本，不承诺未来稳定或无使用限制。

| 缺口 | 可用路径、已验证事实 | 实施限制与建议 |
| --- | --- | --- |
| 更早 K 线、成交和可重建足迹 | [币安官方 GitHub](https://github.com/binance/binance-public-data) 列出 USD-M klines/aggTrades/trades 归档及校验；9 月 25 日 BTCUSDT 5m 归档 CHECKSUM 本次 HTTP 200 | 先补所需窗口；校验哈希、产品与时间单位，保留回补来源和实际接收时间。未下载并校验完整 zip，不能把 checksum 可访问冒称历史已回补 |
| 名义/实际国债利率 | [财政部 XML 说明](https://home.treasury.gov/treasury-daily-interest-rate-xml-feed)；202609 两种曲线 XML 均 HTTP 200、含 25 日数据 | 优先低频直接源；映射到现有 FRED 序列前核对定义、单位和参考日。名义减实际只能是明确标识的派生通胀预期，不能伪造原 FRED 系列 |
| CPI | [BLS v2](https://www.bls.gov/developers/api_signature_v2.htm)；季调序列 GET HTTP 200，最新 8 月 334.131 | 与 CPIAUCSL 对齐用 CUSR0000SA0；现有 BLS 默认 CUUR0000SA0 是不同季调口径，不能直接替换 |
| SOFR | [NYFed 参考利率](https://www.newyorkfed.org/markets/reference-rates)；`markets.newyorkfed.org/api/rates/secured/sofr/last/5.json` 本次 HTTP 200 | 仓库已接入，应先修调度和发布时间判断；不是新增来源任务 |
| 联储资产、TGA | [美联储 H.4.1](https://www.federalreserve.gov/releases/h41/current/) 本次 HTTP 200；[下载入口](https://www.federalreserve.gov/datadownload/Choose.aspx?rel=H41) 有表级数据 | 需明确周三值/周平均与 WALCL、WTREGEN 的映射。DDP 已公告未来调整，不宜新建依赖即将退役的定制下载流程；尚未完成结构化适配 |
| 旧强平事件 | [Tardis Binance 文档](https://docs.tardis.dev/historical-data-details/binance-futures) 列出 forceOrder 历史和采集范围 | 候选，不是已接入；先查所需日期覆盖、事故记录、权限和费用。归档交易所推送不等于恢复交易所从未公开的所有事件 |
| 历史强平汇总 | [CoinGlass Pair Liquidation History](https://docs.coinglass.com/reference/liquidation-history) 支持按交易所/交易对/时间窗读取，需 API key，套餐粒度不同 | 汇总不能填充价格档位或冒充逐笔事件；不是直接替换当前热图的完整方案，未实测付费接口或购买 |
| GitHub 适配参考 | [OpenBB 官方 provider 列表](https://github.com/OpenBB-finance/OpenBB/blob/develop/assets/extensions/provider.json) 有 FRED/BLS 等适配 | 参考字段与适配方式，不必引入整个 Python 服务。开源适配器本身不能提供缺失的数据授权 |

另外已核对[币安现行市场数据文档](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data)的头部持仓响应字段，以及 [Bybit allLiquidation](https://bybit-exchange.github.io/docs/v5/websocket/public/all-liquidation) 的目标主题。社区关于历史强平缺失的讨论只作候选线索，最终能力判断使用服务商文档；不把社媒截图、新闻转载数字或预测强平热图作为规范历史数据。

美元指数、RRP、精确 FRED 修订历史的替代源尚未完成逐项等价性验证。不得用 Yahoo 的另一种美元指数、财政部日度余额或当前最新版宏观数值静默覆盖既有不同口径/历史已知时点数据。

## 建议下一轮直接执行的 C1–C5

| 顺序 | 最小完整改动 | 验收条件 |
| --- | --- | --- |
| C1 / P1 | desk 传出已有 footprint levels，统一买卖量字段，贯通前端计算、展示与导出；替换错误的持仓字段映射和测试样本 | 用真实响应固定成脱敏测试夹具；足迹档位非空、总量守恒、POC/CVD 有依据；持仓多空份额与原始响应一致且语义分开。运行 verify:footprint、finance/desk 相关检查和浏览器真实 DOM 验收 |
| C2 / P1 | 逐项诊断 FRED 请求失败；修 SOFR/手续费调度迟滞；能等价验证的宏观项增加上述官方直接源 | 明确每项最近成功、最新参考期、发布日、来源与失败原因；利率取得已发布新日期，月/周频数据不误判；失败重试有上限且不挤占其他采集 |
| C3 / P2 | 按 req_id 追踪强平订阅，分离 heartbeat、订阅失败、事件和写入；呈现各所真实历史覆盖 | 固定反例“ticker 正常但 allLiquidation 失败”不能绿灯；“legacy 失败但 allLiquidation 成功”不能误判主订阅。真实在线观察验证事件→桶→D1→desk；没有事件时如实记待证，不造事件通过 |
| C4 / P2 | 定向回补主动量中间洞；修正 premium/OI 新鲜度阈值；按实际分析需求选择额外 K 线/足迹归档回补 | 缺口实际消失后才清标；尾部新鲜不掩盖历史洞；合理延迟不闪烁，真实断流仍报警；API、页面、导出一致 |
| C5 / 收口 | Worker→Pages 按实际影响发布，完成受 Access 保护的正式页面验收，更新当前计划中的旧样本与集数量 | 四页各有“真实采集/读取→处理→显示→导出”证据，检查生产资源版本；记录未接入/不可恢复历史，不把测试夹具通过当生产数据齐全 |

成本方向：C1 与字段映射主要复用已存数据；宏观按真实发布频率采集，避免每分钟重复全量；归档定向、有界、可断点恢复；不为这轮修复增加第二套常驻采集器或全量数据库重建。若购买历史数据，费用、粒度及是否真正能补当前缺口需单独核实。
