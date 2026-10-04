# 比特币合约系统案例与方法

查询日期：2026-09-30（北京时间）。本目录保存经过筛选的官方案例、固定提交原文、本仓库审查和未实施建议。先读[数据层复审](../bitcoin-contract-data-architecture-review-2026-09-30.md)，再按需求读[案例](case-studies.md)和[采用方案](adoption-plan.md)。

## 筛选方法与边界

- 使用 GitHub 与社媒发现候选，再回到官方仓库／文档／代码；转帖、收益截图和作者营销不作为“最佳”证明。
- 核对 11 个仓库的公开元数据，重点保存 8 个的固定提交原文。核心集合按接口、采集、事件回放、合约研究、执行和多角色证据分工；没有唯一总排名。
- Star 与 Fork 是采用代理指标；多年存在、仍有维护、能力有公开实现提高参考价值，不保证生产稳定或交易收益。
- 以源码事实、本轮推断和作者自述分层。FinRobot 的 production 等描述属于作者说明，本轮未独立验收其全产品。

## 核心七个案例

下列数字来自当日 GitHub REST API，原始字段摘取见[sources/repository-metadata.json](sources/repository-metadata.json)。pushed_at 是仓库最近推送，不必等于默认分支提交时间；研究 SHA 冻结源码，不是推荐安装开发分支。

| 项目 | Star / Fork | 当前研究提交（短 SHA） | 采用理由 |
| --- | --- | --- | --- |
| [CCXT](https://github.com/ccxt/ccxt) | 44,217 / 8,878 | 80ca1ef6d89d | 长期维护，多所公共接口与产品身份约束 |
| [Cryptofeed](https://github.com/bmoscon/cryptofeed) | 2,913 / 766 | 6cbd9b959f10 | 专门研究实时微观结构、事件标准化及录制；不按总 Star 排序排除专业库 |
| [NautilusTrader](https://github.com/nautechsystems/nautilus_trader) | 29,525 / 3,916 | 2249c98829ea | 多资产事件引擎、加密适配、共享回测／实盘模型 |
| [Freqtrade](https://github.com/freqtrade/freqtrade) | 54,950 / 11,380 | f6a7b767a317 | 加密合约研究、数据下载与前视偏差检查 |
| [Hummingbot](https://github.com/hummingbot/hummingbot) | 20,276 / 4,973 | 9af100d6822d | 多所现货／永续连接器与确定性订单生命周期 |
| [TradingAgents](https://github.com/TauricResearch/TradingAgents) | 109,306 / 20,988 | 8b22d43d01d9 | 多角色研究、日期边界与反证流程；当前 README 为 v0.5.2 |
| [FinRobot](https://github.com/AI4Finance-Foundation/FinRobot) | 8,113 / 1,370 | 2717499b8e30 | 计算、解释、来源和审计分工；股票方法需重定义后用于 BTC |

## 专项参考与未入选者

| 候选 | 元数据与本轮判断 |
| --- | --- |
| [Tucsky/aggr](https://github.com/Tucsky/aggr) | 1,146 Star；作为成交聚合／订单流界面的专项对照，历史需要 aggr-server；不是完整合约研究平台或连续盘口档案 |
| [QuantConnect/Lean](https://github.com/QuantConnect/Lean) | 21,827 Star；成熟多资产引擎候选，但本轮未同深度核对其合约接入和资料；与 Nautilus 的参考角色重叠，保留后续执行／多资产课题 |
| [Jesse](https://github.com/jesse-ai/jesse) | 8,605 Star；加密策略引擎候选，本輪未作同深度源码审查；核心合约研究方法优先取采用规模更大且已读原文的 Freqtrade，不能推定 Jesse 不可靠 |
| [alpha-rptr](https://github.com/TheFourGreatErrors/alpha-rptr) | 706 Star；合约机器人候选，采用证据和本轮核验深度不足；不将单仓宣传纳入“公认最佳” |

OctoBot 在尝试的旧组织路径返回 404，未据此断言项目停止。社媒发现来源见 sources.json，技术结论均指向官方材料。

## 快照与版权

- 八个案例项目原文在 sources/，统一存为 .txt；每份登记原路径、固定完整 SHA、来源 URL 和实际保存校验和。补充的官方归档文档来自 master，提交未解析，明确标为例外。文件中的命令只是原作者参考，不执行、不安装。
- 许可证原文与版权署名随快照保存。特别保留 cryptofeed Copyright (C) 2017-2026 Bryant Moscon，当前 AGPL 原文的附加署名要求见其 LICENSE 快照。
- 截至本轮，有些代码／文档来自 develop 或 main 最新提交。后续接入须选发布版本、重核差异与实际运行，不把研究提交自动部署到本仓库。
- 来源目录约为一份有界专题资料，未克隆所有项目，也未将外部原文混入业务依赖和 Pages 白名单。

## 文件用途

| 文件 | 用途 |
| --- | --- |
| [case-studies.md](case-studies.md) | 各案例架构、可迁移方法、代价和适用限制 |
| [adoption-plan.md](adoption-plan.md) | 局部修复与条件扩建的范围、验收和远程影响 |
| [official-history-archive.md](official-history-archive.md) | 币安官方成交历史回补候选、实际访问回执与尚未核验部分 |
| [sources.json](sources.json) | 来源、提交、快照校验和、访问限制与社媒线索 |
| [evidence/](evidence/) | 当前源码反例、指纹与本轮验证边界 |

