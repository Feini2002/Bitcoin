# 免费通道：不纳入每日长期采集的限额项

2026-09-22 起，采集走哪边以 [采集路由](data-collection-routing-2026-09-22.md) 为准。Deribit 期权摘要已改为经东京 VPS、6 小时一次；Alpha、BLS、GDELT 仍不进时钟。

查询日期：2026-09-21（北京时间）。对象：Cloudflare `btc` Worker 免费金融通道与规范数据集。本文只记录额度结论与处理决定，不是实施或采购指令。

用户决定：目前有限额、无法作为每日长期来源的数据先不管；通道保留，不再为它们安排每日采集或反复探测。

## 问题

哪些已登记免费通道因为官方额度或当前 Cloudflare 出口配额，不能作为本系统的每日长期采集源？

## 适用版本与核验方法

- 通道目录版本 `2026-09-16.3`（40 平台 / 93 操作）。
- 线上 `GET https://btc.feiniwork.com/api/finance/status` 与 `/api/finance/{provider}/{operation}`。
- 2026-09-21 北京时间约 09:55–10:10：全量探测后，对冷却到期的限额项各复测一次。失败不自动重试、不买升级。
- 对照：[通道记录](free-financial-api-channels-2026-09-16.md)、[限制矩阵](free-financial-platform-limits-2026-09-16.md)。

## 核验事实：先不管（不作为每日长期源）

| 通道 / 数据集 | 官方或账户限额 | 2026-09-21 CF 出口 | 处理 |
| --- | --- | --- | --- |
| Deribit：ticker、book、instruments、summary；规范集 `deribit-btc-options` | [Deribit 限流](https://docs.deribit.com/articles/rate-limits) | 冷却后再测仍 429，`quota_reported` | 停每日采集。东京 Caddy 已通 Deribit 路由，但 `DERIBIT_API_ORIGIN` 故意留空，**不随 VPS 出口重开日采**。D1 仍保留 2026-09-16 本机导入的期权摘要，标过期 |
| Alpha Vantage：daily | [免费 25 次/日](https://www.alphavantage.co/support/#api-key)，仅 compact 日线 | 429，`upstream_rate_limited`；冷却到当日 15:55 北京时间 | 停每日采集。未取得可用日线 |
| GDELT：articles | 公共 Doc API，无本仓库专用额度 | 冷却后仍 429 | 停每日采集 |
| BLS：series | [无注册 v1](https://www.bls.gov/developers/api_signature.htm) 额度小于注册版；本仓库未申请 BLS 账号 | `upstream_rejected_or_quota_exhausted` | 停每日采集，不申请付费/注册升级 |
| CoinPaprika：ticker、global | [免费约 2 万次/月](https://docs.coinpaprika.com/api-plans)；[402/429 均为额度](https://docs.coinpaprika.com/faq) | 先 402，约 1 分钟后 200 并写入 D1 | 今日有快照，但不作为每日长期必拉：共享出口额度不稳定 |

以上项通道代码和目录保留。失败只更新健康/冷却，不覆盖上次成功快照。不把 429/402 伪装成接通。

## 有限额、但仍可按日偶发取数（本次不放弃）

这些官方有额度，但当前每日几次的用法未打满，09-21 已成功写入 D1。继续按需读取，不新开全平台轮询。

- CoinGecko Demo：约 1 万次/月；prices、global、markets 与广度数据集已写入。
- Twelve Data Basic：8 credits/分、800/日；price、daily 已写入。上屏前仍须核展示许可。
- Finnhub Free：quote、news 已写入。
- CoinMarketCap Basic：listings 已写入。
- FRED / NYFed / 多数无密钥官方源：09-21 云端成功；FRED 各系列版权与 Key 分开，但不属于“打不满就放弃”的日额度。

## 不是额度问题（本文不展开、也不改处理）

- Binance 现货 / USDⓈ-M、Bitget：CF **直连**出口 403，属访问限制。永续 REST/WS、现货、Bybit/OKX/Bitget REST 与 Bybit 强平 WS 已走东京反代，见 [接线现状](binance-egress-vps-cutover-2026-09-21.md)。Deribit 不在那份出口待办里：路由可通、origin 为空，日采仍停。
- 美国财政部 debt / operating-cash：525 TLS 或超时，不是免费次数用尽。
- 足迹、币安衍生品增量：同一出口问题，不在本记录的限额清单里。

## 推断与建议

- 本系统继续只采集当前 CF 出口能稳定成功、且日频不会打满免费额度的通道。
- 不为上表“先不管”项增加 Cron、全量诊断或冷却后循环重试。
- 需要 Deribit 期权截面时，另开任务：写 `DERIBIT_API_ORIGIN`、核官方限额后再采；未授权前保持缺口。Alpha / BLS / GDELT 同样另开，不并进出口迁移。

## 限制

- 限额以账号与官方当时文档为准；本次只证明 2026-09-21 该 CF 出口的结果。
- 通道最新快照不是完整历史库；规范数据集除已刷新的宏观/稳定币/广度/费用外，币安与 Deribit 项仍是旧导入或失败状态。
- 页面和分析输入仍未切换到这些 finance 表。

## 关联代码与验证

- 登记：`cloudflare/finance/registry.mjs`
- 网关冷却：`cloudflare/finance/gateway.mjs`（429 默认 900 秒，Alpha 6 小时）
- 只读核对：`GET /api/finance/status`、`GET /api/finance/stored/{provider}/{operation}`
- 不把 `npm run diagnose:finance --all` 当作日常任务；有限额接口禁止反复全量探测。
