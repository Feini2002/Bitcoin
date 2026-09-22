# 基础采集路由：VPS 或 Cloudflare

查询日期：2026-09-22（北京时间）。对象：Bit Trading Desk 会持续写入的基础数据，不是财务通道目录里的全部一次性探测。本文是当前分工；频率与删除边界仍看 [刷新频率](data-refresh-cadence-2026-09-21.md)，出口接线仍看 [接线现状](binance-egress-vps-cutover-2026-09-21.md)，限额停采的历史决定仍看 [限额停采](finance-daily-quota-skip-2026-09-21.md)。

## 问题

已有东京出口机之后，每条能持续采集的数据应该走 VPS 反代，还是由 Cloudflare Worker 直连？怎样让这些数据保持在跑，而不是只登记在目录里。

## 适用版本与核验

- 代码：`cloudflare/wrangler.toml`、`cloudflare/egress/Caddyfile`、`cloudflare/finance/scheduler.mjs`、`cloudflare/finance/datasets.mjs`、`cloudflare/binance-klines-worker.js`。
- 2026-09-22 15:20 前后：线上 `GET /api/d1/status?detail=1`、`GET /api/finance/datasets`、`GET /api/d1/klines/live`、`GET /api/d1/liquidations/wake`。
- 同日单次探测：带密钥访问 `bit-egress.feiniwork.com/x/deribit/.../get_book_summary_by_currency` 返回 200；本机访问美国财政部 debt-to-penny 与 Yahoo `^VIX` 日线返回 200。探测只证明当时，密钥不写入本文。

## 分工

原则：Cloudflare 出口会被交易所 403 挡住的，走东京 VPS。Cloudflare 自己能稳定打到的官方或公开接口，留在 Worker。日额度或共享出口一打就 429、不能当时钟的，不放进每分钟调度。

| 数据 | 平台 | 原因 | 时钟 |
| --- | --- | --- | --- |
| 永续 K 线、标记价 | VPS | 合约 WS `/market` 与 REST 经灰云 | 秒级写入，Cron 补尾 |
| 永续资金费、持仓、盘口、基差、多空比、主动买卖、规则 | VPS | `fapi` 直连 403 | 秒到小时，按数据集间隔 |
| 现货 1 小时 K 线 | VPS | `/x/spot` | 约 1 分钟检查 |
| 足迹 aggTrades | VPS | 同上 | 每分钟；近两天可补，更早空洞留着 |
| 强平：币安与 Bybit | VPS | `fstream` 与 `/x/bybit-stream` | 事件流。断线前的币安桶没有回放 |
| Bybit / OKX / Bitget REST | VPS | 已有前缀 | 按现有调用，不另开全市场轮询 |
| Deribit BTC 期权摘要 | VPS | 2026-09-22 单次 200。CF 共享出口此前 429 | 6 小时一次，只留最近 8 次收据 |
| FRED 九个序列、NYFed SOFR | Cloudflare | 官方接口，Worker 能写成功 | 约 1 小时检查。发布仍是工作日 |
| CoinGecko 广度、稳定币链上 90 天 | Cloudflare | Demo 月额度；5 分钟是月额度上限附近 | 广度约 5 分钟；稳定币日频在整点 |
| DefiLlama 稳定币快照、mempool 费率 | Cloudflare | 公开接口 | 约 1 小时 / 约 1 分钟 |
| Yahoo VIX、VIX3M、MOVE | Cloudflare | 非官方旁路。本机 200，不为此加 VPS 路由 | 约 6 小时。休市写入 0 条不等于断源 |

日线、3 日线在 6000 根上限之内、且早于 2019-09-02 的部分，Cron 每次用 VPS 再向更早翻一页，翻到交易所起点或上限为止。5 分钟到 4 小时维持最新 6000 根。周线已经回到 2019-09。

## 不放进时钟

这些不是「忘了接」，是不能当持续采集：

- Alpha Vantage、BLS、GDELT：日额度或 429。通道代码保留，Cron 不打。
- 美国财政部 debt / operating cash：2026-09-21 从 Cloudflare 出站是 TLS 525 或超时。2026-09-22 本机 200，但不能据此改判 Worker 已通。桌面宏观用的是 FRED 的 TGA 与美联储资产，不把财政部接口并进时钟，也不为它新开 VPS 路由。
- CoinPaprika：有过快照，共享额度不稳，不作为必拉。
- 足迹超过约两天的空洞、币安强平开始采集之前的事件：公开接口不回放。

## 调度

每分钟最多刷新 8 个到期规范集。币安数据集占满名额时，仍给最久未成功的非币安数据集留 1 个名额，避免 SOFR、费率、广度被挤掉。抛错会写下失败状态。Deribit 不再列入永久跳过。

## 限制

- 单次 200 不是长期限额结论。Deribit 若再次 429，失败状态会留下，6 小时内不会连打。
- 网络当时成功不能当成出口永远稳定。币安五个域名从 Cloudflare 直连仍然 403。
- 本文不记录口令、私钥或出口密钥。

## 关联代码与验证

- 路由：`cloudflare/wrangler.toml` 的 `DERIBIT_API_ORIGIN`，`cloudflare/egress/Caddyfile` 的 `/x/deribit`
- 调度：`cloudflare/finance/scheduler.mjs`
- 日线回补：`extendKlineHistoryOnePage`
- 验证：`node scripts/verify-refresh-cadence.cjs`，部署后看 `GET /api/d1/status?detail=1` 与 `GET /api/finance/datasets`
