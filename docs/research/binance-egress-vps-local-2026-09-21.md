# 币安出口机：本机 SSH 记录位置（2026-09-21）

查询日期：2026-09-21。对象：已开通并测通的东京 Vultr 小机器。本文只指路，**不含口令、不含可登录密钥**。

前置：[采购清单](vps-proxy-purchase-checklist-2026-09-19.md)、[通路再核](binance-egress-workable-fixes-2026-09-21.md)、[固定 IP 反代方案](binance-fixed-ip-proxy-plan-2026-09-19.md)。

## 问题

换一次 Codex / 新对话时，如何找到这台已测通的出口机，且不把 root 口令写进 git。

## 适用版本与核验

- 商家 Vultr，Shared CPU，`vc2-1c-1gb`，地区东京，系统 Ubuntu 24.04 LTS x64，自动备份关闭。
- 2026-09-21 约 14:02 北京时间在该机实测：`fapi` ping 为 200 空对象；5 分钟 K 线 200；`fstream` WebSocket 握手 101 并收到 K 线帧。
- 2026-09-21 晚些时候已在该机安装 Caddy 反代（密钥头、剥转发头、回源官方 Host/SNI）。同日傍晚用户在本机控制台建灰云 A `bit-egress.feiniwork.com`（DNS only）。Worker `BINANCE_FAPI_ORIGIN` / `BINANCE_FSTREAM_ORIGIN` 已指向该主机。sslip.io 仍在 Caddy 上作回退。同日已装本机 ed25519 公钥并轮换 root 口令。共享密钥在 `.env` 的 `EGRESS_PROXY_SECRET` 与 Worker Secret，不进 git。

## 核验事实：口令放哪

| 位置 | 是否进 git | 内容 |
| --- | --- | --- |
| 仓库根 `.env` 的 `VPS_BINANCE_EGRESS_*` | 否（`.gitignore` 已忽略 `.env`） | 主机、用户、口令、端口、地区、私钥路径 |
| `.codex/ssh/bitdesk_egress_ed25519` | 否（`.codex/*` 已忽略） | 出口机 SSH 私钥 |
| `.codex/binance-egress-vps.local.md` | 否（`.codex/*` 已忽略，技能目录除外） | 同一套连接说明，给本机 Codex 读 |
| `.env.example` | 是 | 只有空键名，没有真实值 |
| 本文 | 是 | 只说明键名与状态 |

换 Codex 时先读 `.env`：`VPS_BINANCE_EGRESS_HOST`、`VPS_BINANCE_EGRESS_USER`、`VPS_BINANCE_EGRESS_IDENTITY_FILE`、`VPS_BINANCE_EGRESS_PASSWORD`、`VPS_BINANCE_EGRESS_PORT`。优先用私钥登录；口令仍启用作为备份，且不得带英文引号。不要把口令或私钥写进 `wrangler.toml`、不要写进 Worker 密钥（那是反代用的另一套 token）。

## 运维边界（未授权不要做）

- 保持 Running。Vultr 的 Stop 仍计费；要停钱必须 Destroy。
- 反代已装；Worker 源已指向灰云 `https://bit-egress.feiniwork.com`。sslip.io 仍在 Caddy 上，回退时改 wrangler 再部署。接线约束见 [对抗审查](binance-egress-plan-adversarial-2026-09-21.md)：不要橙云、不要用 Cloudflare 公布 IP 做防火墙。Bybit 强平 WS 已走独立前缀；回退是清空 `BYBIT_STREAM_ORIGIN`。
- 2026-09-21 傍晚已装本机 ed25519 公钥并轮换 root 口令；sshd 仍允许密码登录作备份。私钥只在 `.codex/ssh/`。

## 限制

- 本文可提交 git；真实主机、口令与私钥以本机 `.env` 和 `.codex/ssh/` 为准，过期或换机后只改这些 gitignore 文件，不要把新口令补进本文。
- 换电脑时需自行带上 `.env` 和 `.codex/ssh/`，空仓库克隆不会带出登录信息。

## 关联代码与验证

- 本地键：`.env`、`.env.example`、gitignore 的 `.codex/ssh/bitdesk_egress_ed25519`
- 规则入口：`AGENTS.md`、`.codex/skills/bit-trading-desk/SKILL.md`
- 测通后接入见 [接线现状](binance-egress-vps-cutover-2026-09-21.md)；约束见 [对抗审查](binance-egress-plan-adversarial-2026-09-21.md)
- 核对：机外带密钥访问反代 `/fapi/v1/ping` 须 200、无密钥须 403；线上 `/api/d1/derivatives/origin-check` 为 `custom` 且自定义源 200；desk `/api/desk/chart?interval=5m` 的 `pricePathAvailable`
