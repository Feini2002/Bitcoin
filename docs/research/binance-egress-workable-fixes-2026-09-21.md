# 币安云端通路：2026-09-21 全网再核，哪些办法真能用

查询日期：2026-09-21（北京时间；同日下午又做了一轮全网再核）。对象：当时 `btc` Worker 到币安 USDⓈ-M REST 与 `fstream` 仍不通。本文回答「哪些办法能落地」，**不是当天傍晚之后的运行状态**。现状见 [接线现状](binance-egress-vps-cutover-2026-09-21.md)。

前置：[出口封锁归因](binance-egress-block-2026-09-19.md)、[固定 IP 反代方案](binance-fixed-ip-proxy-plan-2026-09-19.md)、[VPS 采购清单](vps-proxy-purchase-checklist-2026-09-19.md)、[09-16 连接诊断](binance-connectivity-2026-09-16.md)、[刷新频率](data-refresh-cadence-2026-09-21.md)。仓库规则 NEW-027：不得用别所冒充币安，商业代理绕过地域限制需单独授权。

## 问题

主图、足迹、资金费、持仓都卡在同一件事：Cloudflare 边缘出口被币安拦。上一轮改 K 线 WS 到 `/market` 后，collector 仍零行情帧、REST 仍 403。到底有没有能落地的办法？

## 适用版本与核验方法

- 本仓库线上：`btc-worker/3.9.3-live`，`BINANCE_FAPI_ORIGIN` 空。2026-09-21 13:27 北京时间再采：`binanceOriginMode=direct`；fapi 五域仍全 403（CloudFront HTML，`binanceCode=null`）；`binance_direct` 连续失败 526 次；live collector `reconnectCount=163`、`lastMessageAt=0`、`restrictedCooling=true`；desk 5m 仍是 09-16 `stale_bootstrap`、`pricePathAvailable=false`。
- 官方：币安[通用说明](https://developers.binance.com/docs/fiat/general-info)（403=WAF，限额按 IP）；现货[只读域 FAQ](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md)；Cloudflare [Dedicated egress IPs](https://developers.cloudflare.com/cloudflare-one/traffic-policies/egress-policies/dedicated-egress-ips/)（2026-09-04 页，仍为企业附加项）；[2026-06-05 Workers 经 Gateway 出站](https://developers.cloudflare.com/changelog/post/2026-06-05-gateway-egress/)。
- 2026 年仍在跑的同类实作：[andychien555 的 DO 新加坡反代 README](https://github.com/andychien555/binance-smart-money-tracker/blob/main/proxy/README.md)（2026-05-13 起 CF 被 451，迁 DO 后 fapi ping 为 `{}`）；[osindo-dev/whalescope-mcp](https://github.com/osindo-dev/whalescope-mcp)（Worker 经 Vercel 中继，因 CF WAF 公司级 403）；失败对照 [lijiachang 纯 Worker 代理](https://github.com/lijiachang/cloudflare-worker-binance-api-proxy)；论坛 [Can't fetch API from Cloudflare worker](https://dev.binance.vision/t/cant-fetch-api-from-cloudflare-worker/3638)。
- 2026-09-21 下午已开 Vultr 东京 `vc2-1c-1gb`，同机实测 fapi ping/K 线 200、fstream WS 101。SSH 只在本机 `.env` 的 `VPS_BINANCE_EGRESS_*`，见 [本地出口机记录](binance-egress-vps-local-2026-09-21.md)。同日已装 Caddy 并写入 Worker 自定义源（sslip.io，因 Wrangler OAuth 不能写灰云 DNS）。接线方案经对抗审查后收敛为灰云单主机、先 REST 后 WS，见 [对抗审查](binance-egress-plan-adversarial-2026-09-21.md)。

## 核验事实：什么路已经死了

| 办法 | 证据 | 对本仓库 |
| --- | --- | --- |
| Worker 直连 `fapi` / `fstream` | 本仓库 09-16、09-19、09-21 连续 403 / WS 零帧；论坛与纯 Worker 代理仓库同样失败 | **走不通** |
| 在 Cloudflare 里换东京/台湾/placement | 本仓库 `remote-NRT` 仍全 403；社区 `cf.resolveOverride` 仍失败 | **走不通** |
| 只改 WS 路径到 `/market` | 09-21 已改；collector 与强平币安侧仍无市场消息 | **必要但不充分** |
| 用 `data-api.binance.vision` 顶主图 | [官方 FAQ](https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md) 只有现货 `/api/v3/*`，没有 USDⓈ-M `fapi` | **不能当永续主图** |
| 换成 `binance.us` | 美国独立实体，不是绕过手段 | **不适用** |
| 用 Bybit/OKX 静默顶币安 | 与 NEW-027 及空桌规则冲突 | **不做** |
| 向币安申诉解开 CF 段 | 论坛记录客服帮不上，无人能从黑名单拿掉 CF；官方论坛该帖本轮 WebFetch 也回 451 | **不可依赖** |
| Worker `connect()` / TCP sockets 直打 443 | 官方写明 80/443 应用 `fetch`；HN 实测 `connect()` 源 IP 仍属 Cloudflare，只是不在公开 IP 列表 | **走不通** |
| Worker 自己 HTTP CONNECT 再 `startTls()` | [LuuOW 记录](https://github.com/LuuOW/binance-proxy) 与社区帖：`startTls()` 无法改 CONNECT 之后的 SNI，TLS 对不上币安 | **走不通** |
| 买 Dedicated CDN Egress IPs（原 Aegis） | [官方](https://developers.cloudflare.com/smart-shield/configuration/dedicated-egress-ips/other-products/)：`fetch()` 专用 IP **只用于访问你自己的源站**；`connect()` 不用这组 IP。这是锁源站防火墙的产品，不是给币安换出口 | **对症不对** |
| Worker 走 Gateway `env.EGRESS.fetch()` 但不买专用/BYOIP | [2026-06-05](https://developers.cloudflare.com/changelog/post/2026-06-05-gateway-egress/) 只是把出站送进 Gateway 策略；默认仍是 Cloudflare 共享出口 | **不够** |
| 把币安请求改到 Vercel / Railway / 多数函数平台 | Vercel 社区 2025-12 公开 451；Railway 员工 2026-04 写明美东/美西/荷兰/**新加坡** 出口都被拦，metal 区同样 451 | **不要当第一枪** |
| 用 Cloudflare Worker 当「币安反代」给别人用 | 部分 WordPress 插件文档仍这样教；方向与本仓库相反，会把出口继续留在 CF | **帮倒忙** |

## 核验事实：2026 年还能看见的活路

共同模式没有变：**让币安看到的源 IP 不再是 Cloudflare 共享段。** 2026-05-13 之后，至少有一份公开实作写明：Binance 对 CF anycast 回 451，Smart Placement 不能指定出口国，于是把 Worker 出站改到新加坡 DigitalOcean（约 $6/月，1 核 1GB），Caddy + 带 token 的 Node 反代，Worker 把 `fapi.binance.com` 改写成 `https://<vps>/host-fapi/...`。该作者从「家里 Mac + cloudflared 应急」迁到 DO，并写了 fapi ping 预期为 `{}`。另有 MCP 项目曾选 Vercel 中继；下午再核 Vercel 社区已出现公开 451，不能再把它当成稳妥对照。

Cloudflare 2026-06-05 起，Worker 可用 VPC 绑定走 Gateway 出公网；专用出口 IP 官方仍写 **Zero Trust Enterprise 附加项、需联系客户经理**，不是普通 Workers 付费档自助开关。专用 IP 仍是 Cloudflare 地址；若币安按 ASN 拦 CF，花钱也可能照样被拦。社区 2023 年有人估过企业静态 IP 量级很高，**不是官方价**，此处不引用为报价。

## 对本仓库真正能用的办法（按推荐顺序）

### 1. 按小时买一台新加坡/东京小 VPS，先试通再常开（最像能成）

干什么：机器只做两件事——HTTPS 原样转发 `/fapi` 给币安；另外把 `fstream` WebSocket 也转出来（或直接在这台机器上跑 K 线/强平采集再写入 D1）。

为什么排第一：

- 仓库已经有 `BINANCE_FAPI_ORIGIN`，REST 不用改业务逻辑。A1 已按此接上；当前状态见收口文，不要把本节「尚未接入」读成今天。
- 2026 年有人在 **DigitalOcean 新加坡** 对 `fapi` 跑通，说明「机房 IP 一定被封」不是定律。
- 采购清单已写：Vultr/DO 可按小时试，不通立刻 Destroy，试错几美分。

必须同时做 WebSocket，否则主图仍接近直连不了：`BINANCE_FAPI_ORIGIN` **只管 REST**。A2 已加 `BINANCE_FSTREAM_ORIGIN` 与 `fetch`+Upgrade，不再写死官方 fstream。Durable Object **出站** WebSocket 不能休眠，官方也写明这一点。当时完整方案二选一（本轮选了反代，没有把采集搬到 VPS）：

- VPS 上再开 `wss` 转发（Caddy/Nginx `Upgrade`），Worker 增加类似 `BINANCE_FSTREAM_ORIGIN` 的配置后再连这台机器；币安看到的是 VPS 的 IP。
- 把采集进程放到同一台已通的机器上写 D1（本仓库已有 `scripts/collect-market-local.cjs` 可作过渡；生产应改成常驻服务 + 鉴权写入口）。andychien555 的公开配方是 **15 分钟 REST cron**，没有给我们现成的 fstream 常连模板。

风险：这台机房 IP 也可能 451。下午再核加强了这一点：**「新加坡」四个字不够**——Railway 新加坡照样 451，DigitalOcean SGP1 有人通。所以**先在机器上 curl `/fapi/v1/ping` 和一根 K 线，通了再改 Worker**。

接线有两种，都不必先改业务指标：

- **公开 HTTPS 反代**（2026 年最完整的公开配方：[andychien555 proxy README](https://github.com/andychien555/binance-smart-money-tracker/blob/main/proxy/README.md)）。DigitalOcean 新加坡 1 核 1GB 约 $6/月，Caddy + 本机 Node，token 校验，剥 `X-Forwarded-*`，自己写浏览器 UA。路径前缀不要跟币安的 `/fapi` 撞名（他们用 `/host-fapi`）。本仓库已有 `BINANCE_FAPI_ORIGIN`，应按**现有契约**把反代做成「根就是 fapi 源」，让 `/fapi/v1/...` 原样过去，不要照抄别人的 `/host-fapi` 除非同时改 Worker。
- **不公开端口**：VPS 上跑 `cloudflared` + 只听本机的反代。Worker 用 [Workers VPC](https://developers.cloudflare.com/workers-vpc/configuration/vpc-networks/) 绑定那条 Tunnel（beta、各档免费）去打内网反代。Medium 上的交易机器人也是 Worker VPC → Tunnel → EC2 固定 IP。比 nip.io 暴露公网更干净。

finance 规范集的 REST：`gateway.mjs` **已经**在 `binance-usdm` 上读 `BINANCE_FAPI_ORIGIN` 换 base；`registry.mjs` 默认仍写 `https://fapi.binance.com`，只是目录展示。配反代后 usdm REST 会走自定义源。现货 `data-api.binance.vision` 仍是另一条线，不能当永续主图。

### 2. 家里或办公室已有常开电脑 + Cloudflare Tunnel（零买机器，但不稳）

干什么：cloudflared 把这台机能直连币安的出口，接到 Worker（官方 VPC/Tunnel；2026-05 有人用 Mac 应急过几天）。Worker 出站走隧道，币安看到的是家用/办公室 IP。

前提：这台机器**不走 Clash 之类全局代理**时，裸连 `fapi`/`fstream` 真的 200。本仓库 09-16/09-19 本机 200 是 TUN 代理污染，不能当家里出口已通。

限制：关机、换宽带、运营商 CGNAT、家庭 IP 被标成机房，都会断。只适合过渡，不适合当唯一生产出口。仓库已有 `scripts/collect-market-local.cjs`，同样依赖本机长期在线且 Wrangler 已登录。

### 3. 用 Vercel / Fly / Railway 当薄反代（下午再核：多数会 451，不要先买这个）

上午把「非 CF 函数平台」写成可试。下午核对到：Vercel 公开 451；Railway 新加坡和 metal 同样 451；Fly 上能跑通的公开例子 [LuuOW/binance-proxy](https://github.com/LuuOW/binance-proxy) **并不是 Fly 的 IP 通了**，而是 Fly 再去连 Bright Data 住宅出口。没有住宅代理授权时，这条和方案 1 相比只是更不可控的机房 IP。

### 4. 浏览器开着页面时，用你自己的电脑去连币安（不能当云端）

09-16 本机浏览器新 `/market` 地址约 1.9 秒就有成交和 K 线。理论上可把帧回写 D1。但：没人开页面就没采集；现在规定 desk 未授权不开 WS，会和空图互相卡住；也不能冒充「云端已直连」。最多当人工盯盘时的补丁，不能替代方案 1。

### 5. 买 Cloudflare 企业专用出口 IP（下午再核：产品要对号，仍不推荐当首选）

有两样容易混：

- **Dedicated CDN Egress IPs / 原 Aegis**：企业功能，用来让你的源站只放行 CF 专用 IP。Worker 去打币安用不上。
- **Zero Trust Gateway Dedicated Egress IPs**：[官方 2026-09-04](https://developers.cloudflare.com/cloudflare-one/traffic-policies/egress-policies/dedicated-egress-ips/) 仍是 Enterprise 附加项，需客户经理。2026-06-05 之后 Worker 理论上可经 VPC `cf1:network` 走 Gateway 出站。出来的若是 Cloudflare 租用地址，ASN 仍是 CF，币安按段拦截时照样可能 403。真正可能改观的是 **BYOIP**（你自己的非 CF 前缀），成本和合同都不适合当第一枪。

只有方案 1 试过、且确认「非 CF 的新加坡/东京独享 IPv4 也不通」之后，才值得问客户经理。

### 6. 住宅代理（Bright Data 等）

社区在机房 IP 也被封时用过，能给固定住宅出口。按流量付费，和 NEW-027「不得用代理绕过」冲突，**你没另说授权前不做**。

## 对主图的最低完整集

只修 REST：足迹、资金费、OI、历史 K 线尾部可以活，**主图未收盘仍不会像直连**。

要主图接近直连，三件都要：

1. 一台币安接受的固定出口（先按小时验证 ping）。
2. REST 走 `BINANCE_FAPI_ORIGIN`（已预留）。
3. WebSocket 也走同一出口（新开 VPS 上的 WS 反代，或采集改在 VPS 写 D1）。usdm REST 配 `BINANCE_FAPI_ORIGIN` 即可；live/强平 WS 仍要另接线。

## 推断与建议（待你拍板）

建议按这个顺序，每步都可停：

1. 按 [采购清单](vps-proxy-purchase-checklist-2026-09-19.md) 买 **按小时** 的新加坡或东京 1 核 1GB（Vultr 或 DigitalOcean）。不要年付。
2. 把 IP 和登录交给实施（另开任务）：先在机器上测 `fapi` ping 和一根 K 线。不通就 Destroy，换一家再试，不要先改线上 Worker。
3. 通了再装带密钥、剥转发头的最小反代；填 `BINANCE_FAPI_ORIGIN`；再补 WS 转发或 VPS 采集。
4. 用 `/api/d1/derivatives/origin-check`、`/api/d1/klines/live`、`/api/desk/chart?interval=5m` 看是否 `custom` + 有行情帧 + `pricePathAvailable=true`。`last_ok=1` 单独不算成功。

不建议：继续在 Worker 里换域名重试；买企业静态 IP 当第一枪；用他所行情顶主图。

## 2026-09-21 下午再核：没有第三条「纯云免费」活路

这一轮额外核过的官方页与公开实作：Cloudflare TCP sockets、Dedicated CDN Egress IPs、Gateway Dedicated Egress IPs、Workers VPC、2026-06-05 Gateway 出站、币安现货只读域 FAQ、andychien555 DO 反代 README、LuuOW Fly+Bright Data、Vercel/Railway 451 讨论、dev.binance.vision 旧帖（本轮抓取 451）。

结论没有变，只更窄：

1. **共同模式仍是「让币安看到非 Cloudflare 的固定 IPv4」。** 没有新的 Worker 开关能把共享 CF 出口变成币安接受的地址。
2. **2026 年仍在跑、写得最清楚的成功案例是 DigitalOcean 新加坡小机器 + 带 token 的 HTTPS 反代。** 作者 2026-05-13 起 CF 回 451，先用家里 Mac + cloudflared 顶一天，5-14 迁到 DO；fapi ping 预期 `{}`。这是 REST 配方，不是本仓库主图所需的 fstream 常连。
3. **机房平台不等于能通。** 同一「新加坡」标签下，DO SGP1 有人 200，Railway 新加坡 451。Vercel、多数 AWS/GCP 函数也是 451。所以采购清单里的「按小时试、不通立刻 Destroy」不是保守，是硬条件。
4. **住宅代理能打通**（LuuOW、DEV.to 机房 451 后的做法），但 NEW-027 要你另说授权；本轮仍不实施。
5. **家里常开电脑 + Tunnel** 仍是零购机过渡，前提是裸连 fapi/fstream 真 200。本仓库本机 200 曾被 Clash TUN 污染，不能直接当家里已通。

## 限制

- 别人的 DO 新加坡通，不保证你买到的那台通。必须以你的机器实测为准。
- 币安策略可突然变，没有一劳永逸。
- `data-api.binance.vision` 官方只提供现货 `/api/v3/*` 与 `data-stream.binance.vision`，没有 USDⓈ-M `fapi`。本轮未从本仓库 CF 出口新测该域是否 200；即使通也不能替代永续主图。
- Dedicated egress 价格官方不公开；不把论坛旧数字当报价。
- 本轮 WebFetch 打不开币安开发者论坛旧帖（451），不影响本仓库 Worker 已实测的 CloudFront 403。
- 本文当时未部署。同日傍晚已接线，见 [收口](binance-egress-vps-cutover-2026-09-21.md)。

## 关联代码与验证

- REST：`BINANCE_FAPI_ORIGIN`、`parseCustomFapiOrigin`、`fetchKlinesFromBinance`；finance `gateway.mjs` 对 `binance-usdm` 已换自定义 base
- A2 之后 live/强平可读 `BINANCE_FSTREAM_ORIGIN`：`kline-live-collector.mjs`、`LiquidationCollector`；空则直连官方
- 运行现状：[接线现状](binance-egress-vps-cutover-2026-09-21.md)
- 本机过渡：`scripts/collect-market-local.cjs`（足迹/衍生品 REST，不是 live WS）
- 核对：`GET /api/d1/status`、`/api/d1/klines/live`、`/api/d1/derivatives/origin-check`、`/api/desk/chart?interval=5m`
