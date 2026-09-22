# 出口转发方案对抗审查（2026-09-21）

查询日期：2026-09-21。对象：把东京小机器做成 Worker 出站网关的实施方案。本文否决原方案里会让接线失败或把已通数据弄坏的几条，并给出可执行的更具体接法。

**状态：约束仍有效。东京出口已接线完毕。** 当前怎么接、怎么回退见 [接线现状](binance-egress-vps-cutover-2026-09-21.md)。清空 `BYBIT_STREAM_ORIGIN` 即回官方 WS。Deribit 日采见 [限额停采](finance-daily-quota-skip-2026-09-21.md)，不重开。sslip.io 只作 Caddy 回退，不是橙云。

前置：[通路再核](binance-egress-workable-fixes-2026-09-21.md)、[固定 IP 反代](binance-fixed-ip-proxy-plan-2026-09-19.md)、[本地出口机](binance-egress-vps-local-2026-09-21.md)、[空桌治理](cloud-d1-desk-governance-2026-09-21.md)、[刷新频率](data-refresh-cadence-2026-09-21.md)。

## 问题

原「全量出口转发」稿建议：每个交易所一个橙云子域、防火墙只放行 Cloudflare 公布网段、Bybit 强平 WS 一并切到小机器。这些假设有没有被官方文档或本仓库代码证伪？

## 适用版本与核验

- Cloudflare 网络 WebSocket 说明（2026-08-14 页，本轮读取）：[WebSockets](https://developers.cloudflare.com/network/websockets/)。要点：代理 WebSocket 在双向都无数据一段时间后会断开；官方要求应用层心跳；未公布免费套餐可调超时。社区交叉：协议 ping/pong 常不被算作活动，安静约 100 秒即断。
- Workers 出站 WebSocket：[Using the WebSockets API](https://developers.cloudflare.com/workers/examples/websockets/)。出站可 `fetch` 并带 `Upgrade: websocket`，然后 `webSocket.accept()`。这是能自定义请求头的路径。
- Worker 出站源 IP：Cloudflare 社区确认 [Workers 出站 IP 段不公布](https://community.cloudflare.com/t/what-are-cf-worker-egress-ip-ranges/911150)；[cloudflare.com/ips](https://www.cloudflare.com/ips/) 只覆盖橙色代理回源，不是 Worker `fetch` 源地址。
- Caddy `reverse_proxy` 文档：默认会设置 `X-Forwarded-For` / `Proto` / `Host`；WebSocket 自动升级；`header_up -Name` 可删头。币安 CloudFront 会因转发头再 403，见 PROXYPLAN。
- 本仓库：`parseCustomFapiOrigin` 只留 URL origin（剥 pathname）；pathname 以 `/` 开头的 `new URL` 会丢掉 base 前缀，阶段 B 必须 `joinEgress`。有 `BINANCE_FSTREAM_ORIGIN` 时 live/强平走 `fetch`+Upgrade；空则直连官方。Bybit 强平 WS 有 `BYBIT_STREAM_ORIGIN` 时走 `/x/bybit-stream`（不得复用 REST `/x/bybit`）；空则直连官方 `wss://stream.bybit.com/v5/public/linear`。

## 核验事实（会否决原稿的条目）

1. **出口主机名不能走橙云。** Worker→橙云主机名→VPS→fstream 时，安静的强平流（可能数分钟无成交）会撞 Cloudflare 代理空闲断开。K 线 `markPrice@1s` 也许能撑住，强平腿撑不住。官方只保证「有数据才续上」，没有承诺协议 ping 算活动。
2. **不能用 cloudflare.com/ips 做 ufw 白名单。** Worker `fetch` 源地址不在该名单。写上等于挡住真正的客户端。443 必须对公网开放，靠共享密钥和路径白名单，不靠 IP 段。
3. **先写 `BINANCE_FAPI_ORIGIN` 再装反代会更糟。** 配置非空时 Worker **只打**自定义源、不再轮询五域。反代未通 = 唯一上游死亡，并触发 collector 15 分钟 `restrictedCooling`。
4. **`/api/v3` 与 `/v5` 会撞车。** 现货 vision、现货 `api.binance.com`、Bitget 都是 `/api/v3`。Bybit REST 与 Bybit WS 都是 `/v5`。单主机按官方 path 无法区分。`new URL('/api/v3/klines', 'https://host/x/spot')` 会得到 `https://host/api/v3/klines`，前缀丢失。
5. **Bybit 强平 WS 在 REST 未稳、反代未 101 时不要迁。** 热力页 Bybit 腿当时是通的；把未验证的反代接到同一 `/v5` 前缀上会弄死它。NEW-027 也禁止用别所顶币安。实施顺序是：REST 再稳 → 独立 `/x/bybit-stream` 机外 101 → 再写 origin；回退是清空 `BYBIT_STREAM_ORIGIN`。
6. **PROXYPLAN §3.2 过时。** finance `binance-usdm` 已读 `BINANCE_FAPI_ORIGIN`。A2 之后 live/强平在配置了 `BINANCE_FSTREAM_ORIGIN` 时不再硬编码官方 fstream。现货 vision 与 Bybit/OKX/Bitget REST 已走阶段 B 前缀；Deribit 日采仍停。
7. **REST 先通就能解开空桌。** live collector 在 WS 停滞 3 秒后会用 REST 拉 2 根、间隔约 2 秒。出口只修 fapi 时，desk 的 `pricePathAvailable` 可以先靠 REST 备份变真；WS 是「接近直连」，不是空桌的唯一钥匙。

## 推断与建议（实施必须遵守）

- 一个灰云 A 记录：`bit-egress.feiniwork.com` 指向东京机 IPv4，不要 AAAA，除非 IPv6 已实测。Let's Encrypt HTTP-01 开 80。
- 阶段 A1：Caddy 只放行 `/fapi/*`、`/futures/data/*`；剥转发头；回源 Host/SNI 为 `fapi.binance.com`；要求头 `X-Bitdesk-Egress-Secret`。Worker 只在机外带密钥探测 200 之后，才写入 `BINANCE_FAPI_ORIGIN` 并部署。
- 阶段 A2：同一主机 `/market/ws`、`/market/stream` 升到 `fstream.binance.com`。collector / 强平改为 `fetch`+Upgrade 才能带头。`connect()` 必须改成异步，`ensureStarted` 要等待。
- 阶段 B：其它所走 `/x/<venue>/...`，Worker 用字符串拼接而不是 `new URL(绝对路径, base)`。Bybit WS 必须另开 `/x/bybit-stream`，不得复用 REST `/x/bybit`。先 REST 稳定并机外 101，再写 `BYBIT_STREAM_ORIGIN`。Deribit 只通路由，不重开日采。
- 浏览器继续直连官方 fstream；VPS 不对网页开放。
- 密钥：Worker Secret + 机器环境变量。不进 git、docs、wrangler 明文。

## 限制

- 灰云会把 VPS IPv4 暴露在 DNS。安全边界是密钥和路径白名单，不是隐藏 IP。
- 出站 Durable Object WebSocket 仍不能休眠，费用问题本轮接受。
- 本文当时不是授权去改 DNS、装 Caddy 或部署 Worker；用户随后已授权实施。
- 2026-09-21 实施：Wrangler OAuth 不能写 Zone DNS（403）。用户在本机控制台建了灰云 A `bit-egress.feiniwork.com`（DNS only，无 AAAA）。Caddy 双站点；Worker 源已改该主机。sslip.io 留作回退。Cursor 内置浏览器过不了仪表盘验证，不能当 DNS 控制台。

## 关联代码与验证

接线后怎么接、怎么回退以 [接线现状](binance-egress-vps-cutover-2026-09-21.md) 为准。当时约定：`/api/d1/derivatives/origin-check` 的 `binanceOriginMode=custom`；desk 5m 的 `pricePathAvailable`；live `lastMessageAt` 与强平币安心跳。不要单看 `sync_status.last_ok`。命令：`npm run verify:api`、`npm run diagnose`、`npm run verify:footprint`、`npm run verify:finance-datasets`、`npm run verify:refresh-cadence`、`npm run build`。
