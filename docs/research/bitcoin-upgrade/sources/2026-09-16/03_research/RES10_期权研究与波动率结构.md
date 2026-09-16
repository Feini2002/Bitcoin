# RES10｜期权研究与波动率结构

研究日期：2026-09-16。本卷是独立基础研究，不要求匹配当前仓库；“建议/迁移启示”是本研究的推论，不是项目官方承诺。未运行候选代码。


## 1. 最先需要的不是曲面

一个可解释截面至少有instrument、到期、行权价、call/put、基础/报价/结算币、合约乘数、bid/ask/mark、指数/远期参考、时间与质量。Deribit提供相关字段和采集模式，但公开接口不保证免费完整多年期权历史。[EXT125｜Deribit get_order_book](https://docs.deribit.com/api-reference/market-data/public-get_order_book) [EXT065｜Deribit 行情采集指南](https://docs.deribit.com/articles/market-data-collection-best-practices)

有限期限、有限delta附近合约已经可用于研究波动预期和偏斜；没有足够质量时宁可少显示。分批采集不是原子同时快照，必须记录批次开始、结束和每个报价时间。

## 2. 可以分阶段回答的问题

第一阶段观察可靠ATM附近IV与历史实现波动之间的差异，但二者窗口、年化与预期含义不同；不能直接称差值为无风险溢价。第二阶段观察期限结构、固定delta偏斜与报价流动性。第三阶段才考虑插值曲面、无套利约束或风险情景。

使用固定delta需要说明模型、spot/forward delta、利率及选取/插值方法。到期滚动和合约更换可能制造指标跳变，应保存选择的合约和权重，不只保存最终值。

## 3. 数值库的角色

vollib可以帮助在同一约定下进行价格—IV往返检查，不会替使用者选择正确合约单位和模型。币本位报价、反向结构与美元Black模型输入需明确转换。来源mark IV和独立计算不一致，先检查约定与报价时间，不立即判定一方错误。[EXT133｜vollib 当前仓库](https://github.com/vollib/py_vollib)

零买价、无双边报价、异常价差、过期mark、近到期和缺失远期，应明确排除或降级。插值不能凭空生成可成交报价，外推更不应被漂亮的连续面掩盖。

## 4. 不应过早做的指标

OI不是交易商净头寸，因而只用OI无法确定交易商Gamma方向。所谓最大痛点依赖一组简化假设，不是价格目标。把期权成交量、持仓量和主动方向混在一起会误读参与者意图。产品可以展示这些估计，但要与原始观测分层，并有具体研究价值验证。

## 5. 数据供应比较

自采原生快照便宜、易解释，但只积累未来历史。授权历史服务可补过去截面/成交，商业分析服务可能给现成曲面和指数，却增加方法不透明与再分发限制。Tardis、Laevitas和Amberdata的采购卡只提供比较入口，不能当全部字段已经验收。[EXT126｜Tardis Deribit历史覆盖](https://docs.tardis.dev/historical-data-details/deribit) [EXT139｜Laevitas API官方文档](https://docs.laevitas.ch/) [EXT140｜Amberdata 文档入口](https://docs.amberdata.io/)

询证清单应包含合约全生命周期、退市保留、时间精度、字段定义、插值/筛选、修订、缺口、交付格式、模型输入权和退出后的留存权。不要在试验前购买全市场最大套餐。

## 6. 最小验收

用人工构造有效与异常报价检查筛选，再用获准样本验证选择和数值约定。结果页应能展开使用的合约、报价时点和被排除原因。没有期限两侧样本就不生成假插值；没有双边报价就不冒充可交易IV；没有预测验证就不把曲面倾斜转成精确涨跌概率。


## 证据与进一步核验

[EXT125｜Deribit get_order_book](https://docs.deribit.com/api-reference/market-data/public-get_order_book) [EXT065｜Deribit 行情采集指南](https://docs.deribit.com/articles/market-data-collection-best-practices) [EXT133｜vollib 当前仓库](https://github.com/vollib/py_vollib) [EXT126｜Tardis Deribit历史覆盖](https://docs.tardis.dev/historical-data-details/deribit) [EXT139｜Laevitas API官方文档](https://docs.laevitas.ch/) [EXT140｜Amberdata 文档入口](https://docs.amberdata.io/)

