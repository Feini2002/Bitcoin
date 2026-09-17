> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# RES06｜实时行情采集与标准化

研究日期：2026-09-16。本卷是独立基础研究，不要求匹配当前仓库；“建议/迁移启示”是本研究的推论，不是项目官方承诺。未运行候选代码。


## 1. 统一对象必须保留来源差异

CCXT和Cryptofeed能减少适配劳动，但字段统一不能抹去经济含义。Binance的maker方向、Bybit清算持仓方向、不同合约数量和价格字段必须按原协议映射。统一后的side不能既表示主动买卖又表示被清算仓位。[EXT056｜CCXT 官方仓库](https://github.com/ccxt/ccxt) [EXT057｜Cryptofeed 官方仓库](https://github.com/bmoscon/cryptofeed) [EXT123｜Binance Spot WebSocket 原始规范](https://raw.githubusercontent.com/binance/binance-spot-api-docs/master/web-socket-streams.md) [EXT124｜Bybit allLiquidation 原始文档](https://raw.githubusercontent.com/bybit-exchange/docs/master/docs/v5/websocket/public/all-liquidation.mdx)

建议事件包至少有来源、market类型、instrument规格版本、频道、原始ID/序列、来源时间、接收时间、原始载荷、标准化字段和质量标记。价格与数量保留原精度，跨语言JSON传输时避免将超安全整数ID转成近似浮点。

## 2. 连接可靠与数据完整分开

WebSocket连上只说明有连接。必须处理快照/增量衔接、序列缺口、重复、乱序、连接轮换和下游过慢。恢复后应记录何时恢复到有效状态；断档期间的盘口不能靠插值伪造精确档位。对于无连续序列的接口，不能宣称已证明无漏包。

前端订阅可以改善交互，但若历史依赖浏览器一直打开，就不是持续研究采集。是否外置长期进程取决于产品是否真的要求不断档，而不是默认所有数据都要常驻。

## 3. 来源切换与合成指数

故障回退能改善可用性，却可能改变价格序列和成交口径。历史中保留来源段、fallback原因与选择策略，不让Bybit值写进名为Binance的长期系列后失去痕迹。显示用连续序列与单交易所研究序列应分开。

跨所CVD、OI和清算汇总需要共同单位、采样和覆盖；缺一个来源时分母/组成发生变化，应同时显示来源集合。USD、USDT、USDC也不应默认为永久无差异的一种报价币；转换方法与时点要写明。

## 4. 选择采集器的实际条件

| 条件 | 较小方案 | 升级候选 |
|---|---|---|
| 少数来源、原生适配正确 | 保留代码＋协议样本 | 不强制统一框架 |
| 多个普通REST接口重复 | CCXT或薄provider | 验证端点支持、限流与字段 |
| 多所持续事件订阅 | 专门采集服务 | Cryptofeed或原生异步服务 |
| 缺过去的高频历史 | 获准历史文件 | Tardis等数据商，而非新采集器 |

## 5. 衡量维护成本

按“每次上游字段变化需要修改几处”“同一事件是否可找到原文”“故障是否可定位到来源/转换/存储”衡量，不按减少代码行数。锁定版本后运行黄金样本；不要自动跟随最新版，也不能永不更新协议。

验收包含生产协议样本与合成破坏样本，但本轮没有接收真实数据。报告中写“采集器文档支持”与“我们测得完整”必须是两种结论。对当前仓库，已有真实足迹和强平不应被描述成待从零建设。


## 证据与进一步核验

[EXT056｜CCXT 官方仓库](https://github.com/ccxt/ccxt) [EXT057｜Cryptofeed 官方仓库](https://github.com/bmoscon/cryptofeed) [EXT123｜Binance Spot WebSocket 原始规范](https://raw.githubusercontent.com/binance/binance-spot-api-docs/master/web-socket-streams.md) [EXT124｜Bybit allLiquidation 原始文档](https://raw.githubusercontent.com/bybit-exchange/docs/master/docs/v5/websocket/public/all-liquidation.mdx) [EXT126｜Tardis Deribit历史覆盖](https://docs.tardis.dev/historical-data-details/deribit)

