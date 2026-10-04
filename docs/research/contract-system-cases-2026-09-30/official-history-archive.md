# 官方历史归档：成交历史不等于 REST 查询窗口

核验日期：2026-09-30。官方来源：[Binance Public Data](https://github.com/binance/binance-public-data)、[下载说明](https://github.com/binance/binance-public-data/blob/master/python/README.md)。原文与读取回执保存在 sources/；这是补源建议，尚未下载历史 ZIP、导入数据或修改采集器。

## 已核验事实

- 官方提供日／月文件，包含 USD-M 合约 aggTrades。归档另有 CHECKSUM；文件之后可能修订。现货自 2025 年起使用微秒时间，不能把现货与合约解析规则无区别套用。
- 对 BTCUSDT 2024-07-04 合约 aggTrades ZIP 的 HEAD 返回 200，长度 22,832,921 字节；对应 CHECKSUM 的 GET 返回 200。它证明这个较早文件可访问，不证明全部日期可用或每行完整。[文件入口](https://data.binance.vision/data/futures/um/daily/aggTrades/BTCUSDT/BTCUSDT-aggTrades-2024-07-04.zip)
- 当前 cloudflare/、js/、scripts/、tests/ 定向检索未发现 data.binance.vision、binance-public-data 或对应 ZIP 回补适配。当前业务仍按既有 REST／流与聚合路径运行。
- 旧采集路由对 REST 的历史窗口描述仍有其适用范围；若据此认定更早足迹一概无法补回，则遗漏了官方归档这条路径。成交归档也不能补造未公开的全量强平或历史盘口。

## 建议与验证边界

先选一个需要补回的已知成交窗口，离线下载并校验字节、产品、UTC 范围、时间单位、字段、成交 ID 的重复／缺失及边界重叠；使用同一聚合规则比较可对照窗口。aggTrades 是聚合成交，不冒充交易所每一笔撮合记录。确认后再决定批量回补与对象存储。

文件清单保存来源、下载时间、原始 checksum、产品／窗口、schema、聚合器版本与修订。今天取得的历史文件不能冒充系统当年已经收到的证据；checksum 证明文件字节，语义完整性须另外验证。

GitHub 元数据 API 本轮返回 403，提交工具随后不可用；两份官方文档取自 master，未解析到固定提交，manifest 中明确记录 commitSha 为 null，并保存本地 SHA-256。ZIP 未下载或解压，当前没有“已修复足迹缺口”的证据。
