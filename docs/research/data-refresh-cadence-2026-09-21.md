# 系统数据刷新频率复核与拉满采集

2026-09-22 起，平台分工和仍不进时钟的源以 [采集路由](data-collection-routing-2026-09-22.md) 为准。本文仍是频率与硬删除边界的记录。

查询日期：2026-09-21（北京时间）。对象：`btc` Worker Cron / Durable Object、规范数据集、前端轮询、币安 K 线。本文记录复核当时的仓库事实、官方限额与本轮处理；不是采购指令，也不把网络瞬时成功当成长期连通。

用户要求：先把各源是秒级、分钟级还是日限额级写清楚；再按来源最大可承受频率写入云端 D1；K 线要接近直连。云端已付费，不以 Cloudflare 免费额度为采集上限。上游官方限额与出口封锁仍须遵守。

## 问题

当前各数据通路实际多久取一次、写入哪里、前端多久读一次？哪些可以按官方限额拉满，哪些受日额度或 CF 出口限制不能打满？K 线怎样才能在云端也接近直连？

## 适用版本与核验方法

- 代码：`cloudflare/wrangler.toml` Cron `* * * * *`；`cloudflare/binance-klines-worker.js`；`cloudflare/finance/datasets.mjs`、`gateway.mjs`、`desk.mjs`；`js/pages/chart.js`、足迹/强平/衍生品页。
- 资料：[通道记录](free-financial-api-channels-2026-09-16.md)、[限制矩阵](free-financial-platform-limits-2026-09-16.md)、[限额停采](finance-daily-quota-skip-2026-09-21.md)、[空桌治理](cloud-d1-desk-governance-2026-09-21.md)、[出口封锁](binance-egress-block-2026-09-19.md)、[反代方案](binance-fixed-ip-proxy-plan-2026-09-19.md)、[接线现状](binance-egress-vps-cutover-2026-09-21.md)。
- 官方：币安现货 WS [web-socket-streams.md](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md)（K 线非 1s 周期更新速度 2000ms；入站控制消息 5 条/秒）；现货只读域 [market_data_only.md](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md)。USDⓈ-M REST/WS 以开发者文档当时页为准：公开行情 IP 权重常见 2400/分钟量级，K 线流文档写 250ms 档，本轮未越过验证码抓到 futures 原文全文，实施按「WS 优先、REST 权重留余量」处理。
- FRED 免费 Key 约 120 次/分钟；CoinGecko Demo 约 1 万次/月；Twelve Data Basic 8 credits/分、800/日；Alpha 25 次/日。Cloudflare Workers Cron 最短 1 分钟；Durable Object `setAlarm` 可亚分钟。
- 本轮对照的是仓库源码与既有核验记录，不是新的全平台实盘探测。

## 核验事实：复核当时（改前）

### 调度层

| 通路 | 实际节奏 | 写入 | 说明 |
| --- | --- | --- | --- |
| `btc` Cron | 每分钟一次（配置已是 `* * * * *`） | 见下行 | 文件头注释仍写「每 5 分钟」，与配置不符 |
| K 线 `intervalsDueAt` | 5m 仅 UTC 整 5 分；15m 整 15 分；1h 整点；4h 每 4 小时；1d/3d 日界；1w 周一 | `klines` 表，每周期最多 6000 根 | 未收盘 K 在两次 due 之间不更新。Cron 最短 1 分钟，但 5m 周期被人为降到 5 分钟才写 |
| 足迹 | 每分钟 `syncFootprintOne` | `footprint_bars` | REST aggTrades 翻页，不是逐笔 WS |
| 强平 | Cron 每分钟唤醒 DO；DO 持有币安/Bybit WS；alarm 60 秒 | 5m 桶 | 事件到达即入桶；落库在收桶/flush |
| 衍生品 fast（资金费/OI 快照） | Cron 里 `min % 15 !== 0` 直接跳过；另有 15 分钟最小间隔 | `funding_binance` / `oi_binance` 等 | 最快也是 15 分钟级 |
| 衍生品 hourly 统计 | 整点 | 多空比、taker、基差等 | 小时级 |
| 宏观 VIX/MOVE | 6 小时 | Yahoo 非官方 | 日/会话级 |
| 链上稳定币背景 | UTC 偶数小时的第 12 分 | `onchain_timeseries` | 约 2 小时 |
| 规范数据集 | `automaticCollection=false`，无 Cron | `finance_dataset_observations` | 只按需 POST refresh 或本机导入 |
| 通用 finance 快照 | 请求触发；TTL 60s–1 天 | 每组参数最新快照 | 不是历史库 |
| 舆情 | `0 0,1,4,6,12,14,16 * * *`（北京 08/09/12/14/20/22 等） | yuqing D1 | 日报/分析，不是行情 |

### 前端读

| 页面 | 读口 | 间隔 | 实时层 |
| --- | --- | --- | --- |
| 主图 | `/api/desk/chart`（规范集 `binance-perp-klines-*`，最多约 500 根） | D1/desk 60 秒；标题价 REST 1 秒 | 浏览器直连 `fstream` K 线/成交 WS。desk 未授权时 **不启动** K 线 WS |
| 多周期瓷砖 | 同上 desk | 主图加载后整表重拉 | 无独立 WS |
| 足迹 | `/api/desk/orderflow` | 30 秒 | 无浏览器逐笔 |
| 强平 | 云状态 30 秒；视图 15 秒；压力矩阵 60 秒 | 读 D1 桶 | 浏览器也可连强平 WS，与云端 DO 并行 |
| 衍生品页 | `/api/d1/derivatives` 等 | 60 秒 | 无 |

### 规范集建议刷新（改前，且未自动执行）

| 数据集 | refreshSeconds | 数据本身变化频率 | 限额级别 |
| --- | --- | --- | --- |
| 永续 5m K 线 | 300 | 未收盘应秒级 | 币安公开，秒/分钟级可拉；CF 出口常 403 |
| 永续 15m–1w K 线 | 900 | 周期内应秒级更新未收盘 | 同上 |
| premium / OI / 20 档盘口 | 300 | 秒到分钟 | 同上 |
| 已结算资金费、OI 历史、taker、账户比、基差 | 3600 | 小时或结算点 | 同上；历史窗约 30 天 |
| 合约规则 / funding-info | 86400 | 日 | 同上 |
| FRED 利率/美元/CPI/H.4.1 | 43200 | 日或周发布 | 分钟级配额足够，但数据不是盘中报价 |
| NYFed SOFR | 43200 | 工作日 T+1 | 日 |
| 稳定币供应 | 21600 | 日附近 | DefiLlama 公开 |
| CoinGecko 广度 | 3600 | 分钟级聚合 | **月限额** 约 1 万次 |
| mempool 费率 | 3600 | 分钟级 | 公共节点，宜分钟级 |
| Deribit 期权摘要 | 3600 | 分钟级 | **停每日长期采**（CF 429 / 额度） |

### 主图权威断裂（改前）

- 分析读口规定失败不得回落 `/api/d1`。主图只认规范集里来源为币安且未过期的观察。
- `klines` 表由 Cron 按收盘栅格写入，主图不用它。规范集 09-16 多为 `local-bootstrap`，过期后 `pricePathAvailable=false`，历史为空，浏览器 K 线 WS 也不开。
- 因此「直连感」只存在于：desk 仍新鲜 **并且** 浏览器能连上币安 WS。云端 D1 的未收盘 K 线不是秒级。

### 官方与出口边界

- Workers Cron 不能短于 1 分钟；亚分钟必须 DO alarm 或出站 WS。
- 币安现货公开 K 线 WS：非 1s 周期 2000ms 一推。合约 K 线流通常更快（文档常见 250ms），与现货不同。
- REST 拉最新 2 根权重很低；7 个周期每秒各打一次会逼近合约 IP 权重，REST 只能作 WS 失败兜底并留余量。
- CF 东京 HTTP 出口对 fapi / 部分现货只读域 historically 403。接线后 Worker 走 `BINANCE_FAPI_ORIGIN`；直连五域仍 403。finance 注册表默认主机仍写官方名，刷新时由 gateway 换自定义源。详情见 [接线现状](binance-egress-vps-cutover-2026-09-21.md)。
- 强平 DO 的币安 WS 在配置 `BINANCE_FSTREAM_ORIGIN` 后走反代 Upgrade；空则直连官方。Bybit 强平 WS 在配置 `BYBIT_STREAM_ORIGIN` 后走 `/x/bybit-stream` Upgrade；空则直连官方 `wss://stream.bybit.com/v5/public/linear`。
- Deribit / Alpha / GDELT / BLS / 不稳定 CoinPaprika 维持停每日长期采。有月限额的 CoinGecko 不能按秒打。

## 推断与本轮处理

- 「最大化限制」= 在官方限额和出口现实内取最高有用频率，不是无视 429/月额度。日频宏观即使每秒请求也没有新观察。
- K 线接近直连：DO 订阅合约 K 线流，WS 帧先写入内存 Map，约 1 秒合并 upsert `klines`（避免每 250ms 打爆 D1）；规范集未收盘行原地更新。Cron 每分钟对全部周期做 REST 尾部备份。desk 在币安尾部新鲜时改读 `klines` 表（最多 6000）。浏览器 WS 保留。前端 desk 尾部轮询 1 秒。
- REST 兜底：WS 超过约 3 秒无包才拉；一次拉各周期最新 2 根，间隔约 2 秒，避免打满 2400 权重；403/451 冷却 15 分钟。
- 标记价走同一 DO 的 `markPrice@1s`；OI 与 20 档盘口约 5 秒 REST，写入规范集并裁剪旧收据。
- 规范集 Cron：跳过 Deribit 期权；K 线全量 500 根最多半小时一次（秒级由 DO 写尾部）；premium/OI/盘口由 DO 维持，Cron 只在 live 停写后补；CoinGecko 广度 5 分钟以内以月额度留余量；FRED/SOFR/稳定币约 1 小时（发布仍是日/周）。
- 衍生品 fast 改为每分钟；足迹前端 5 秒读一次（云端仍每分钟 REST）；强平视图 5 秒。读口 Cache-Control 降到足迹/强平约 4 秒、衍生品约 8 秒，避免前端轮询打到 20–30 秒旧缓存。
- finance `binance-usdm` 在配置了 `BINANCE_FAPI_ORIGIN` 时改走反代，但信封 `source.host` 仍记 `fapi.binance.com`，避免 desk 把反代主机判成非币安。
- 旧 `klines` 行若曾混入 Bybit，不能事后改写成币安；本轮只保证新写入来自币安 WS/REST。分析文案不得把混源历史说成全程币安。

## 本轮目标节奏（实施后）

| 数据 | 云端采集 | 前端 | 级别 |
| --- | --- | --- | --- |
| 永续 K 线未收盘 | DO WS 先入内存，约 1 秒合并写 D1；失败则 REST 约 2 秒；Cron 每分钟备份 | desk 1 秒尾部 + 浏览器 WS | 秒 |
| 标记价 / 报告费率 | 同 DO `markPrice@1s`，约 1 秒写规范集 | context / 衍生品约 15 秒 | 秒 |
| 永续 OI / 20 档盘口 | 同 DO 约 5 秒 REST | 衍生品页约 15 秒 | 秒–分钟 |
| 足迹 aggTrades | 每分钟 REST；`fromId` 超出近 2 天则丢掉游标拉最近成交，并回补近约 3 小时。更早空洞补不回 | 5 秒 | 分钟（云）/ 近实时读 |
| 强平 | DO WS 事件驱动 | 5 秒读桶 | 秒（事件） |
| mempool 费率 | 约 1 分钟 | 随 context | 分钟 |
| CoinGecko 广度 | 约 5 分钟 | context | 分钟，受月限额 |
| 小时统计/资金费结算 | 整点或 5–10 分钟 | 分钟读 | 分钟–小时 |
| FRED / SOFR / CPI / H.4.1 | 约 1 小时检查 | context | 日发布 |
| 合约规则 | 日 | 偶尔 | 日 |
| Deribit / Alpha / GDELT / BLS | 不自动采 | 过期则缺口 | 停采 |
| 舆情日报/二次分析 | 原定点 Cron | 原页面 | 日分段 |

## 限制

- 币安 CF 出口直连五域在接线后**仍然** 403。2026-09-21 傍晚自定义源已从 sslip.io 改到灰云 `bit-egress.feiniwork.com`，desk 与 live 验收见 [接线现状](binance-egress-vps-cutover-2026-09-21.md)。下文 3.9.2 / 3.9.3 与「origin 仍为空」是**改 URL 当天、接线之前**的快照，不要当成当前 Worker。
- 未收盘 K 的 `observedAt` 是开盘时间；过期判定必须用采集时间/最后写入，不能只用开盘时间超过一个周期就空白主图。
- 规范集观察表对 K 线秒级必须原地更新；全量 500 根不能按秒插入。
- CoinGecko/Twelve/CMC 以账户实时余额为准；本轮按文档上限留余量，不保证某日不被平台改配额。
- Cloudflare 付费消除的是我方计算/存储顾虑，不是币安 IP 权重或免费 Key 月限额。

## 加固审查（2026-09-21 续）

查询日期仍为 2026-09-21。对象：上一轮 live tape / 拉满采集改动。对照：强平 DO 与主图浏览器已走 2026-04-23 后的 USDⓈ-M market 路径；live collector 当时仍用已下线的组合流。

核验事实：

- `LiquidationCollector` 使用 `wss://fstream.binance.com/market/ws/!forceOrder@arr` 与 combined `.../market/stream?streams=`。主图 `startChartWs` 使用 `wss://fstream.binance.com/market/ws/{symbol}@kline_{interval}`。live collector 上一轮写成 `wss://fstream.binance.com/stream?streams=`（无 `/market`）。
- 第三方对官方公告的交叉：2026-03-06 USDⓈ-M WS 拆成 `/public`、`/market`、`/private`；遗留 `/ws` 与 `/stream` 于 2026-04-23 永久下线。K 线、aggTrade、markPrice 属 `/market`。这足以解释 collector「WS error」且与 REST 403 独立。
- Cron REST 备份在 tail 过期且 fapi 403 时会把 `sync_status.last_ok` 写成 0。desk 以 `last_ok` + 90 秒写入龄授权 tape。REST 失败会把刚写好的 WS tape 判成非权威，主图回落到过期 `local-bootstrap` 规范集。
- live 写入 `skipPrune`。Cron 只在 REST persist 成功时按 6000 根裁剪。REST 长期 403 时 `klines` 与规范集收据会无界增长。
- 规范集 `persistDataset` 原先不对 FRED/费用/广度做硬删除；FRED 虽只在数值或 vintage 变化时插入，长期仍会积修订日志。

本轮处理：collector 改 `klineLiveCombinedStreamUrl` → `/market/stream`；REST 失败且 90 秒内有成功 live 写入则不改 `last_ok`；Cron 每分钟独立 `pruneExpiredStorage`（`klines` 6000 根帽 + 规范集 keep/时间窗）；写入口也按同一边界硬删除。无软删除、无回收站。

## 官方限额是否真的最大化（2026-09-21 再核）

「最大化」= 在官方限额、数据本身变化频率、出口现实内取最高有用频率。不是把每分钟 100 次的配额打满到没有新观察的日频序列上。

| 源 | 官方约束（本轮检索） | 仓库节奏 | 是否打满有用上限 | 说明 |
| --- | --- | --- | --- | --- |
| 币安 USDⓈ-M K 线 / 标记价 | [现货 WS 文档](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md)：现货非 1s K 线 2000ms 一推；入站控制消息 5 条/秒、单连接 1024 流。USDⓈ-M 行情流走 `/market`（kline、markPrice）；合约 K 线文档常见 250ms，官网 futures 页本轮仍遇验证码，未把 250ms 当已核原文。REST 权重以 `exchangeInfo.rateLimits` 为准，公开常见 REQUEST_WEIGHT 约 2400/分钟，429 后须退避否则 418。官方建议行情用 WS。 | DO 组合流 7 周期 K 线 + `markPrice@1s`；1 秒合并写 D1；WS 停 3 秒才 REST 各周期 2 根、间隔 2 秒 | **K 线/标记价：是 WS 上限**（再快只会多打 D1，买不到更密的交易所推送）。REST 备份刻意留余量，不是打满 2400 | 上一轮 URL 错，等于没连上最大通路 |
| 币安 OI / 20 档盘口 | OI 无对等公开 WS；depth/bookTicker 高频在 `/public`。depth REST 权重低 | DO 约 5 秒 REST | **不是交易所物理上限** | 5 秒对桌面盘口够用；100ms depth WS 是另一条产品，本轮不扩。权重远低于 2400 |
| 足迹 aggTrades | 成交 WS 实时；REST 翻页吃权重 | Cron 每分钟 REST | **云端不是最大** | 强平 DO 已持成交/强平流。足迹改逐笔 WS 是独立工程 |
| CoinGecko Demo 广度 | 官方定价页 2026-09-21：[Demo 1 万次/月、100 次/分、数据新鲜度 from 60 sec](https://www.coingecko.com/en/api/pricing)。月额度才是硬顶：10000/30≈333 次/日≈每 4.3 分钟一次 | 5 分钟一次 ≈ 288 次/日 ≈ 8640 次/月 | **相对月额度已接近最大** | 按 100 次/分打会一个月内耗尽。4 分钟会超过 1 万。留约 14% 余量防 4xx 也计次 |
| FRED | v2 错误页写明超过约 **2 次/秒** 返回 429；社区常写 120 次/分，与 2/秒同量级。系列本身是日/周发布 | 约 1 小时检查 9 个序列 | **相对发布频率已超过需要** | 再快没有新观察。不能把 2/秒当成「应该每秒拉国债」 |
| NYFed SOFR / DefiLlama 稳定币 | 日或近日报价；DefiLlama 公开无密钥 | 约 1 小时 | 同上 | 不是盘中报价 |
| mempool.space 费率 | [官方 REST](https://mempool.space/docs/api/rest) 只声明有限流、429、可封禁，**不公布数字**；维护者说「需要问就说明会撞限」 | 约 1 分钟 | **在未公布限额下取保守分钟级** | 再加密易 429。需要更密应自建节点，不打公共实例 |
| 资金费结算 / OI 历史 / 账户比 / 基差 | 结算点或小时窗；官方历史约 30 天 | 5–30 分钟或整点 | 有用上限已覆盖 | 不是 tick |
| Deribit / Alpha / GDELT / BLS | 日额度或 CF 429 | 停每日长期采 | 故意不打满 | 见限额停采名单 |
| Workers Cron | 最短 1 分钟 | `* * * * *` | Cron 已顶格 | 亚分钟只能 DO |

结论：K 线「接近直连」的正确最大值是 USDⓈ-M `/market` WS，不是把 REST 打到 2400。CoinGecko 5 分钟是月额度最大值，不是分钟限额最大值。OI/盘口/足迹仍低于交易所可达上限，属于产品边界而非配额打满。宏观序列按时点发布，小时检查已经偏勤。

## 硬删除边界（无回收站）

原则：超过边界立即 `DELETE`，不保留 tombstone、不建云端回收站、不改远程 schema。Cron 每分钟跑一次，写入路径成功后也裁，避免 REST 失败时只写不删。

| 表/对象 | 边界 | 约合时长 | 依据 |
| --- | --- | --- | --- |
| `klines` 每个 (品种, 周期) | 最新 **6000** 根，更早的 `t` 删除 | 5m≈21 天；15m≈62 天；1h≈250 天；4h≈2.7 年；1d 起按根数封顶 | 主图最多读 6000；展示所需远小于此（5m 864 根/3 天） |
| `footprint_bars` | 最多 **8640** 根 5m | 30 天 | 已有 cap |
| `liquidation_5m_buckets` | `bucket_start` 早于 **30 天** | 30 天 | 热力窗最大 30d |
| `derivative_timeseries` | 点时戳早于 **30 天** | 30 天 | 衍生品页窗 |
| `onchain_timeseries` | 点时戳早于 **90 天** | 90 天 | 链上背景窗 |
| 规范集 K 线观察 | 每种周期最新 **600** 条收据 | 与 desk 尾部同量级 | 秒级必须原地更新，禁止按秒插入 500 根全窗 |
| premium | 最新 **3600** | 约 1 小时（1s） | 桌面用不了更长标记价史 |
| OI | 最新 **3600** | 约 5 小时（5s） | 同上 |
| 20 档盘口 | 最新 **720** | 约 1 小时（5s） | 快照不是连续盘口史 |
| 资金费/OI 历史/taker/账户比/基差 | 最新 **500** | 贴近官方一次窗口 | 官方本身约 30 天窗 |
| 合约规则 / funding-info | 最新 **30** | 约月 | 日更 |
| FRED / SOFR | 最新 **1500** 条收据 | 覆盖 1000 点窗口 + 若干修订 | 只保留最近修订，旧 vintage 超出则删 |
| CoinGecko 广度 | 14 天或 4032 条，先到先删 | 14 天 | 5 分钟快照不需要季度史 |
| mempool 费率 | 7 天或 10080 条 | 7 天 | 分钟级费用 |
| 稳定币供应 | 90 天或 2200 条 | 90 天 | 近日报价 |
| Deribit 期权（停采） | 7 天或 8 条 | 若仍有旧行则清 | 不无限留停采残骸 |
| yuqing 条目/报告 | **7 天** | 已有 | 舆情库 |
| `finance_dataset_state` / `sync_status` | 不删 | — | 一行健康状态，不是时序 |

没有「先标记删除再清」。超界的行不再可读、不可恢复，除非上游再拉。分析文案不得把已删窗口说成仍在库。

## 主图 K 线现在用什么数据，能否实时

读口只有 `/api/desk/chart`（`DataEngine.fetchDesk`），禁止分析回落 `/api/d1`。

优先序：

1. `klines` live tape：`sync_status.last_ok=1`、错误里没有 Bybit/OKX、最近写入 ≤90 秒、最后一根开盘龄 ≤ 2 个周期。满足则 `pricePathAvailable=true`，序列来自 D1 `klines`（最多 6000）。写入方应是 collector 的币安 `/market` WS（1 秒合并）或 REST 备份。
2. 否则读规范集 `binance-perp-klines-{周期}`。须币安主机且未过期。09-16 `local-bootstrap` 过期后与缺失同等：序列空，`pricePathAvailable=false`。
3. 浏览器 `wss://fstream.binance.com/market/ws/{symbol}@kline_{interval}` **仅在** desk 已授权时启动；另每 1 秒轮询 desk 尾部 20 根。

因此：**设计上**主图是「云端币安永续 K 线表 + 浏览器同所 WS」，不是 Bybit，也不是过期 bootstrap。接线后验收以 [收口](binance-egress-vps-cutover-2026-09-21.md) 为准：`GET /api/d1/klines/wake` 为 `realtime` 且 `/api/desk/chart?interval=5m` 的 `pricePathAvailable=true`。浏览器直连币安与 Worker 出站仍是两条路。

## 关联代码与验证

- 采集：`cloudflare/kline-live-collector.mjs`、`cloudflare/binance-klines-worker.js`、`cloudflare/finance/scheduler.mjs`
- 存储与装配：`cloudflare/finance/dataset-store.mjs`、`datasets.mjs`、`desk.mjs`、`gateway.mjs`
- 前端：`js/pages/chart.js`、`js/data-engine.js`、足迹/强平/衍生品页
- 硬删除：`pruneExpiredStorage`、`pruneKlinesCap`、`datasetRetention` / `pruneExpiredDatasets`
- 验证：`node scripts/verify-refresh-cadence.cjs`、`npm run verify:finance`、`node scripts/verify-kline-history.cjs`、`node scripts/verify-desk-assembly.cjs`、`npm run build`
- 线上：`GET /api/d1/status`、`GET /api/d1/klines/live`、`GET /api/desk/chart?interval=5m`、`GET /api/finance/datasets`
