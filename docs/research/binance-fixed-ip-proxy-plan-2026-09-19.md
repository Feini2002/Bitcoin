# 方案扩充：CF Worker + 固定 IP 小反代

日期：2026-09-19。对象：`btc` 行情 Worker 的币安上游接入。

本文是对 [币安出口封锁调研](binance-egress-block-2026-09-19.md) §4.1 的展开：把「Worker + 固定 IP 小反代」从一句思路拆成可核对的接入点、覆盖范围、边界与验证步骤。

**状态：设计稿，接线已落地。** 灰云、永续 REST/WS、现货/sapi、Bybit/OKX/Bitget REST、Bybit 强平 WS 均已上线；运行现状见 [接线现状](binance-egress-vps-cutover-2026-09-21.md)。本文不含新的部署授权。

**2026-09-21 对抗审查**：[出口转发方案对抗审查](binance-egress-plan-adversarial-2026-09-21.md)。接线以该文为准。下文 §3.2 写 finance 仍硬编码 **已过时**（`binance-usdm` 已读自定义源）。live/强平 WS 在有 `BINANCE_FSTREAM_ORIGIN` 时走反代；现货 vision 与 Bybit/OKX/Bitget REST 已走 `/x/*` 前缀。Deribit 日采不在出口范围，见 [限额停采](finance-daily-quota-skip-2026-09-21.md)。

**关于「最主流」的更正（2026-09-19 复核）**：原表述「最主流」是**证据不足的推断**。复核后能确认的是：①「把出口交给可控固定 IP」这一**模式**在多处独立记录中反复出现（来源 S4、S5、S13）；② 在 CF 内部换 region 已被实测证明无效（S13 用 `cf.resolveOverride` 失败，本仓库 `remote-NRT` 同样全 403）。但各方案的实际采用度**没有数据支撑**，`LuuOW/binance-proxy` 本身只有 0 star。因此本文的结论应读作「**目前证据最充分的一条**」，不是「最流行的一条」。

## 1. 为什么这条路可行

决定性因素是**代码已经预留了完整接入点**，不需要重构业务逻辑：

- `cloudflare/wrangler.toml` 已有 `BINANCE_FAPI_ORIGIN = ""`，注释写明「仅当 Cloudflare 直连 fapi 被 451 时使用」。
- `parseCustomFapiOrigin`（约 L199）负责校验并归一化该配置，只接受 http/https、拒绝带账号密码的 URL。
- 设置后，Worker 把上游从「5 个 fapi 域名轮询」切换为「单一自定义源」：`binanceUpstreamMode` 返回 `custom`。

关键设计是**替换而非追加**：`fetchKlinesFromBinance`、`fetchAggTradesFromBinance`、`fetchBinanceFapiJson`、`handleProxyKlines`、`handleProxyAggTrades` 等都写成 `customOrigin ? [customOrigin] : 全部直连域名`。即配置生效时**不再尝试直连**，避免继续消耗已被封的通道。

    20|## 2. 数据流

```text
Cron / 页面请求
      ↓
Cloudflare Worker（保持原地：调度、签名、聚合、写 D1）
      ↓  https://<反代域名>/fapi/...
固定 IP 小反代（仅透传 /fapi 路径，不缓存、不重写字段）
      ↓
fapi.binance.com  ← 币安看到的是反代那一个固定 IP
```

要点：**Worker 仍然是唯一的业务逻辑位置**，反代只做传输。这样保留了现有 D1 写入、去重、冷却和健康记录逻辑，也符合社区案例的共同做法（签名留在 Worker，代理不持有密钥）。

## 3. 覆盖范围（重要）

配置 `BINANCE_FAPI_ORIGIN` 后**能修好什么、修不好什么**，必须分清：

### 3.1 走 REST、能被反代修复

经代码核对，以下路径都读取同一个自定义源：

| 能力 | 入口函数 | 状态 |
| --- | --- | --- |
| K 线（5m/15m/1h/4h/1d/3d/1w） | `fetchKlinesFromBinance`、`fetchKlineHistory` | 可修 |
| 逐笔成交（足迹） | `fetchAggTradesFromBinance` | 可修 |
| 衍生品全部指标 | `fetchBinanceFapiJson`（经 `binanceDerivativeFapiOrigins`） | 可修 |
| 反代型兼容端点 | `handleProxyKlines`、`handleProxyAggTrades`、`handleProxyTickerPrice` | 可修 |
| 自检 | `derivativeWarmBinanceCustomPing`、`pingBinanceFapiEndpoints` | 可修 |

    40|修好后的直接效果：足迹图、基差、多空比、主动买卖、大户持仓、资金费、OI 都应恢复——它们当前全部因为这一个原因失败。

### 3.2 不走 REST、需要单独处理

**（1）WebSocket 强平采集**

`LiquidationCollector` Durable Object 直接连 `wss://fstream.binance.com/market/ws/!forceOrder@arr`，**不经过 `BINANCE_FAPI_ORIGIN`**。

这与仓库卷 14 §3 记录一致：出站 DO WebSocket 不能用服务端休眠模型，且 CF Workers 对出站 CONNECT 隧道支持不完整。**HTTP 反代无法覆盖 WebSocket**，需要单独方案（在反代主机上做 WS 转发，或把采集整体迁到固定 IP 主机）。

当前强平数据实测约 18 分钟延迟，尚在正常工作，所以这条不是最紧急项，但不能误以为反代会一并解决。

排查这条线的 WebSocket 中断前，先按调研文档 §4.5 排除 Access 造成的伪 403（Access 目标是 Worker destination 时会静默拒绝 WS 升级并返回空体 403，与币安封锁特征相似），否则容易误判原因。

**（2）finance 数据集那条线**

`cloudflare/finance/registry.mjs` 把币安域名**硬编码**：`binance-spot` 用 `https://data-api.binance.vision`，`binance-usdm` 用 `https://fapi.binance.com`，且不含 `BINANCE_FAPI_ORIGIN` 判断。

因此即使配好反代，`cloudflare/finance/` 下的采集路径**仍然直连、仍然 403**。要让 finance 也走反代，需要单独改造（给 registry 增加可配置 base，或让 gateway 支持来源前缀）。这是本次方案主要的额外改动面。

**（3）Bybit 兜底**

`fetchKlinesWithFailover` 的 binance → bybit → okx 链条中，Bybit 同样在 CloudFront 之后、同样 403。反代只解决币安这一段，**不解决 Bybit**；而按仓库规则，OKX/Bybit 数据也不能静默顶替币安。

## 4. 反代主机要求

从社区案例提炼的共同约束：

- **出口地区**：需在币安允许的区域。仓库代码注释建议 HK / SG / TYO；社区案例用东京（延迟低）。
- **固定 IP**：币安按源 IP 限制，必须是稳定、可白名单的地址，不能是共享动态段。
- **只透传 `/fapi`**：不缓存（行情有时效）、不重写字段、不改响应结构。
- **剥除转发头**：反代注入的 `X-Forwarded-*`、`Fly-*` 等会被币安 CloudFront 识别并 403，必须用白名单方式只保留必要头。
- **鉴权**：反代需共享密钥（社区用 `X-Proxy-Secret`），否则等于开放匿名代理。
- **不持有密钥**：只做传输，签名留在 Worker。
- **健康检查**：提供轻量端点，配合 Worker 已有的 `customPing` 自检。
- **回退设计**：`BINANCE_FAPI_ORIGIN` 清空即回到原有直连逻辑，无需改代码。这是本方案最大的优势。

## 5. 分步实施与验证（未执行）

### 5.1 实施顺序建议

1. 选主机与地区（HK/SG/TYO），部署仅转发 `/fapi` 的最小服务，加共享密钥与健康端点。
2. 在该主机上验证出口确实能访问 `fapi.binance.com`（用 `/fapi/v1/ping` 与一个真实行情端点）。
3. 验证剥头：确认响应不再返回 CloudFront 403。
4. 在 `wrangler.toml` 设置 `BINANCE_FAPI_ORIGIN`，部署 Worker。
5. 逐项核对恢复情况（下方命令）。
6. finance 那条线如需一并修复，另行改造 registry/gateway，不要以为配置环境变量就够了。

### 5.2 验证入口

实施后应能观察到：

- `GET /api/d1/derivatives/origin-check` → `binanceOriginMode` 变为 `custom`，`pings` 中 `custom` 条目 `ok=true`。
- `GET /api/d1/status?detail=counts` → `binance_direct` / 新健康键转为 `last_ok=1`，连续失败清零。
- 足迹同步由失败转为写入，`footprint.counts.maxT` 跟上当前时间。
- 资金费、OI、基差等 `derivatives.counts.maxT` 追上当前时间。
- 回归命令：`npm run verify:api`、`npm run diagnose`、`npm run verify:footprint`、`npm run verify:finance`。

**注意**：`sync_status.last_ok=1` 不能单独作为成功证据——上游失败但 D1 尾部被认为新鲜时也会写 `ok: true`（见调研文档 §2.3）。必须结合数据时间一起判断。

## 6. 成本与运维代价（需要决策）

- 需要**一台常在线设备**，这是持续性运维承诺，不是一次性改动；服务挂了数据就断。
- 社区常见选择：Fly.io 小机器、AWS EC2 `t4g.nano`、Oracle 免费 ARM 等；价格与免费额度按各自官方说明，采用前重核。
- **商业代理（如 Bright Data）属付费方案**，且用代理解除地域限制与仓库现有规则冲突，需单独授权。
- 仓库条件分支 `NEW-027` 对此的定性是「运行环境与持续性问题」，要求验证合法可达路径、不得用代理或别所绕过、不得以历史 403 认定今天失效。本方案与之一致。

## 7. 主要风险与限制

- **单点故障**：反代成为唯一上游通道，中断即全部行情停更；需要监控与告警。
- **安全**：反代若鉴权不当等于开放代理，会被滥用并可能牵连 IP 再次被封。
- **两种 403 无法区分**：若走 API Key，白名单未生效同样返回 403（错误码 `-2015`），与地域封锁外观一致（来源 S14）。排查时不要把两者混为一谈。
- **不能解决 WebSocket**（§3.2），强平采集需另做。
- **不能解决 finance 线**（§3.2），除非一并改造。
- **不解决 Bybit 兜底失效**（§3.2）。
- **证据强度有限**：所谓「主流」无采用度数据支撑（见开头更正）；社区做法不构成币安或 Cloudflare 的承诺，策略随时可能调整。
- **法务与合规**：选择机房地区、是否使用商业代理，需自行确认符合当地与币安条款；仓库规则禁止用代理绕过地域限制，需单独授权。
- 本文档所有覆盖范围结论来自**当前代码静态核对**，未实际部署验证。

## 8. 关联代码与资料

- 接入点：`cloudflare/binance-klines-worker.js` — `parseCustomFapiOrigin`、`binanceUpstreamMode`、`binanceDerivativeFapiOrigins`、`derivativeBinanceHealthSourceKey`、`derivativeWarmBinanceCustomPing`、`fetchKlinesFromBinance`、`fetchAggTradesFromBinance`、`fetchBinanceFapiJson`。
- 配置：`cloudflare/wrangler.toml`（`BINANCE_FAPI_ORIGIN`、`[placement]`）。
- 未覆盖：`cloudflare/binance-klines-worker.js` — `LiquidationCollector`（WS）；`cloudflare/finance/registry.mjs`、`cloudflare/finance/gateway.mjs`（硬编码域名）。
- 上游资料：`docs/research/binance-egress-block-2026-09-19.md`（归因与社区案例）。
- 条件分支：`docs/research/bitcoin-upgrade/batch2-execution/01_execution/phases/P11_conditional_branches.md` — NEW-027。
