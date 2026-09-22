# 东京出口机接线现状（2026-09-21）

2026-09-22 起，各数据集走 VPS 还是 Cloudflare 直连，以 [采集路由](data-collection-routing-2026-09-22.md) 为准。Deribit `DERIBIT_API_ORIGIN` 已写到灰云 `/x/deribit`。

查询日期：2026-09-21。对象：Cloudflare `btc` Worker 打不穿的币安（及其它所 REST）上游，经东京 Vultr 小机器转发。**VPS 出口迁移已接线完毕，本文不再当待办板。** 阶段清单与当日采样过程已删；要看当时怎么否决橙云、怎么分 REST/WS，读 [对抗审查](binance-egress-plan-adversarial-2026-09-21.md)。Deribit 日采不在出口待办里，见 [限额停采](finance-daily-quota-skip-2026-09-21.md)。开发状态总览见 [资料总纲](bitcoin-upgrade/README.md)。

不是把网站或 D1 搬到 VPS。Worker 仍是调度、D1、desk、密钥；小机器只做带密钥的薄反代。浏览器继续直连官方 `fstream`，不对网页开放这台机。SSH 与共享密钥只在 gitignore 的根 `.env` 和 `.codex/`，本文不含口令。

## 这篇怎么读

| 要找什么 | 读哪份 |
| --- | --- |
| 现在怎么接、怎么回退 | 本文 |
| 为什么不能橙云、不能用 CF 公布 IP 做防火墙、必须先探通再写 origin | [对抗审查](binance-egress-plan-adversarial-2026-09-21.md) |
| 换 Codex 时 SSH 键在哪 | [本地出口机](binance-egress-vps-local-2026-09-21.md) |
| 为什么直连 Worker 永远 403 | [封锁调研](binance-egress-block-2026-09-19.md)、[通路再核](binance-egress-workable-fixes-2026-09-21.md) |
| Deribit / Alpha 等为何不日采 | [限额停采](finance-daily-quota-skip-2026-09-21.md) |
| 空桌装配禁则 | [治理](cloud-d1-desk-governance-2026-09-21.md) |

## 当前接线

- 机器：Vultr 东京 `vc2-1c-1gb`，IPv4 `45.32.40.84`，保持 Running。未授权不 Destroy。
- 出口主机：灰云 `https://bit-egress.feiniwork.com`（DNS only A，无 AAAA，**不要橙云**）。Caddy 2.11 同时服务 `45.32.40.84.sslip.io` 作回退。
- 鉴权：请求头 `X-Bitdesk-Egress-Secret`；无密钥须 403。密钥在 Worker Secret 与机器 `/etc/bitdesk/egress.env`，不进 git、docs、wrangler 明文。
- 防火墙：ufw 放行 22/80/443 对公网。**不要**用 cloudflare.com/ips 做白名单。
- Worker origin（`cloudflare/wrangler.toml`）：`BINANCE_FAPI_ORIGIN` / `BINANCE_FSTREAM_ORIGIN` 为灰云根；现货 `/x/spot`、sapi `/x/sapi`、Bybit REST `/x/bybit`、OKX `/x/okx`、Bitget `/x/bitget`。Bybit 强平 WS 为 `/x/bybit-stream`。`DERIBIT_API_ORIGIN` 空。
- 路径拼接用 `joinEgress`，禁止 `new URL(绝对路径, 带前缀的 base)`。Bybit REST 与 WS 都是 `/v5`，不得共用 `/x/bybit`。
- 信封主机仍写官方名（`fapi.binance.com`、`fstream.binance.com`、`data-api.binance.vision`、`api.bybit.com` 等）。反代主机名进信封会把合格带判成非币安。
- 浏览器不走这台机。清空自定义 origin 再部署即回直连（币安会再 403）。Bybit WS 回退是清空 `BYBIT_STREAM_ORIGIN`。sslip.io 回退是把 FAPI/FSTREAM 改回 `https://45.32.40.84.sslip.io` 再部署。
- 直连五域（`fapi` / `fapi1`–`fapi4`）**仍然** 403 CloudFront。通的是反代，不是「币安已放过 Cloudflare」。

## 怎么确认还活着

采样只证明当时。不要单看 `sync_status.last_ok`。强平成交稀疏时看 `lastMarketMessageAt` / 心跳，不要用 `lastEventAt=0` 当失败。

- 机外：无密钥 `/fapi/v1/ping` → 403；带密钥 → 200。
- `/api/d1/derivatives/origin-check`：`binanceOriginMode=custom`，自定义源 ping 200，五域直连仍 403。
- `/api/desk/chart?interval=5m`：`pricePathAvailable=true`，质量 `pass`，约 6000 根。
- live wake：`realtime`，信封主机仍是 `fstream.binance.com`。
- 强平 wake：币安 / Bybit 腿 `realtime`。
- 生产页（需 Access）：`https://bitcoin.feiniwork.com/#chart`、`#orderflow`、`#heatmap`。导航「主源未恢复」是写死文案，不是运行时状态。

命令：`npm run verify:egress`、`verify:api`、`diagnose`、`verify:footprint`、`verify:finance`、`npm run build`。

## 改配置时记住的坑

- 先机外带密钥探通（REST 200 / WS 101），再写 wrangler origin。配了自定义源就只打这一条。
- Caddy `admin off` 时用 `systemctl restart`，不要 `reload`。`caddy validate` 必须带上 systemd 的 `EnvironmentFile`，否则密钥匹配器变空。
- 本机 Clash 假 IP 会把灰云解析成 `198.18.x`，这不是橙云。以 DoH 或出口机 `dig @1.1.1.1` 为准。
- Wrangler OAuth 能部署 Worker，不一定能写 Zone DNS。
- Durable Object 内存态在部署后重置；Bybit 腿会短暂 connecting。
- `verify-derivatives-worker.cjs` 会剥 import；origin 解析和强平套接字辅助函数必须留在 Worker 本地副本。

## 限制

- 出站 Durable Object WebSocket 不能休眠，费用本轮接受。
- 未授权不 Destroy、不改远程 D1 schema、不自动 commit。
- 网络实时成功不是长期稳定结论。

## 关联代码

- 反代：`cloudflare/egress/Caddyfile`、`cloudflare/egress/caddy-environment.conf`
- Worker：`cloudflare/finance/egress.mjs`、`cloudflare/binance-klines-worker.js`、`cloudflare/kline-live-collector.mjs`、`cloudflare/wrangler.toml`
