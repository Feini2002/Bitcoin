# RES09｜资金费持仓基差与强平

研究日期：2026-09-16。本卷是独立基础研究，不要求匹配当前仓库；“建议/迁移启示”是本研究的推论，不是项目官方承诺。未运行候选代码。


## 1. 这些指标回答不同问题

资金费描述持有永续多空之间的支付安排或预期，不直接表示资金流入；OI是未平仓存量，不等于净多头；基差比较特定期货/永续与现货基准；可见强平只描述接口提供的强制平仓事件。把四者各投一票得到“75%偏多”没有统计依据。

Deribit对不同产品的OI单位有明文区别；Bybit清算文档还区分持仓方向与破产价格。数值列名相同不保证可相加。[EXT125｜Deribit get_order_book](https://docs.deribit.com/api-reference/market-data/public-get_order_book) [EXT124｜Bybit allLiquidation 原始文档](https://raw.githubusercontent.com/bybit-exchange/docs/master/docs/v5/websocket/public/all-liquidation.mdx)

## 2. 资金费比较的正确单位

记录预测/已结算、费率、覆盖起止、实际结算点、基准币与计算来源。跨所结算间隔不同，先变成明确的可比期间；显示年化应说明简单还是复利及假定费率持续，并明确它不是未来一年可锁定收益。

费率缺失不能填零，零费率是一个观测。正费率通常描述支付方向，但不能单独证明后续价格下跌或上涨。平台因规则调整而改变结算频率时，要保留规格生效区间。

## 3. OI与基差的常见误读

币量OI和美元名义OI应分开。价格上涨可以增加名义值，即使合约存量没有变化。以固定价格换算有利于拆分价格与数量效应，但这是一种分析方法，应保存基准价和窗口；它仍不等于新增净资金。

交割合约基差需要同一时点的合约价与现货基准、到期时间、计价币和年化方式。永续没有固定到期，不能把交割期货年化公式直接套用。现货源故障或稳定币脱锚时，基差异常可能来自基准而非真实套利机会。

## 4. 强平观测不是清算地图真值

清算消息可能是订单、成交累计或快照，不同数量字段不能随意回退。使用平均成交价、订单价、标记价和破产价的名义金额必须分列或明确类型。重复累计字段重放时尤其容易重复累计；交易所报告“全部推送”也不保证本系统没有漏包。

清算位置热力图通常属于模型估计，与已发生清算流和可见挂单热力图不同。没有全市场真实杠杆和保证金信息时，应使用“估计”与假设标签，不将最亮价格带称为必触发点。商业API采购要问清方法、更新与历史修订。[EXT139｜Laevitas API官方文档](https://docs.laevitas.ch/) [EXT140｜Amberdata 文档入口](https://docs.amberdata.io/)

## 5. 可用的分析产物

更有价值的输出是一个压力条件向量：价格变化、OI数量变化、费率位置、基差变化、可见清算/成交规模以及覆盖。分别给支持、矛盾、不可比和缺失，而不是强迫综合方向。

用历史同类窗口检验这些组合是否提供增量时，先固定阈值与事件定义，保存全部试验。没有样本外证据的组合只作描述规则。异常时先排查来源切换、未结算窗口和单位，之后才讨论挤仓或去杠杆。

## 6. 采购与自建

原生接口适合有限市场，CCXT减轻普通适配；Tardis补历史；Laevitas/Amberdata可提供更广服务，但许可、历史字段、数据派生方法和费用必须样本核实。买到一个最终分数而无法核对输入，可能降低而不是提高可信度。


## 证据与进一步核验

[EXT125｜Deribit get_order_book](https://docs.deribit.com/api-reference/market-data/public-get_order_book) [EXT124｜Bybit allLiquidation 原始文档](https://raw.githubusercontent.com/bybit-exchange/docs/master/docs/v5/websocket/public/all-liquidation.mdx) [EXT056｜CCXT 官方仓库](https://github.com/ccxt/ccxt) [EXT126｜Tardis Deribit历史覆盖](https://docs.tardis.dev/historical-data-details/deribit) [EXT139｜Laevitas API官方文档](https://docs.laevitas.ch/) [EXT140｜Amberdata 文档入口](https://docs.amberdata.io/)

