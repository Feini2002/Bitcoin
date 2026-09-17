> **历史研究参考｜2026-09-16。** 当前仓库依据为本包锁定的 `a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；本文件的仓库现状、采用决定和任务编号不是新版本执行指令。先查根目录 README 与 `00_current`，只复用仍成立的方法、案例、协议设计。

# RES11｜链上矿工与实体资金流

研究日期：2026-09-16。本卷是独立基础研究，不要求匹配当前仓库；“建议/迁移启示”是本研究的推论，不是项目官方承诺。未运行候选代码。


## 1. 原始事实和经济解释之间有多层

区块、交易、UTXO与手续费是链上观测；地址聚类、交易所归属、矿池归属是带方法的标签；净流量与实体活动是派生指标；“矿工准备卖出”属于经济解释。后面每一层都增加假设，不能用一条交易hash证明整段解释。

Bitcoin Core提供节点事实基础，mempool提供浏览与费率语境，Glassnode PiT讨论实体聚类与历史修订。三者互补但不能等价替换。[EXT060｜Bitcoin Core 官方仓库](https://github.com/bitcoin/bitcoin) [EXT061｜mempool 官方仓库](https://github.com/mempool/mempool) [EXT062｜Glassnode Point-in-Time 指标](https://docs.glassnode.com/data/point-in-time-metrics)

## 2. 应优先研究的可复算指标

区块间隔、区块空间使用、费率分布和确认状态具有明确观测基础，适合解释拥堵/结算环境。更复杂的UTXO年龄、已实现市值等需要价格映射、移动判定和历史状态处理，算法必须公开或至少可定位。

地址数量不是人数，转移次数不是购买次数。找零、内部调拨、交易所钱包整理和跨链映射会改变可见数据但不等价于市场需求。所有指标应记录方法版本与数据覆盖，不因为链本身不可随意改写就假定分析结果永不修订。

## 3. 标签与PiT

标签新增可能让过去“未知地址”重新归类为交易所，导致历史流量变动。用于过去判断时必须有标签当时版本或供应商PiT定义；只有当前标签的历史回算，应标明是事后重建。供应商`computed_at`也需确认覆盖起点和含义，而不是只看字段存在。[EXT062｜Glassnode Point-in-Time 指标](https://docs.glassnode.com/data/point-in-time-metrics)

矿工标签涉及矿池与受益方差别。链上转入交易所只能支持“流向已标注地址”这一层事实，不能自动确认已经出售。强因果或意图措辞需要更多独立证据。

## 4. 工具维护与成本

BlockSci虽有研究价值，但维护者明确不再主动支持；将它纳入当前运行栈需承担环境和错误修复。它更适合作为分析型数据布局的案例。[EXT059｜BlockSci 官方仓库](https://github.com/citp/BlockSci)

自建节点和索引可提高自主性，却有同步、磁盘、重组、恢复和升级成本；托管服务可减少运维，但有授权、延迟、标签不透明和供应商依赖。Coin Metrics Community是受NC条件限制的子集，不是免费商业全量底座。[EXT063｜Coin Metrics Community](https://docs.coinmetrics.io/packages/coin-metrics-community-data)

## 5. 对研究价值的检验

新增链上指标先回答一个问题：它提供了价格、成交和公开事件以外的什么信息？若只是延迟反映价格或依赖同一市场数据，不能按新指标数量算独立证据。

第一轮可选择“结算拥堵显著变化时如何解释市场背景”而不是“用鲸鱼预测涨跌”。保存观测、标签、解释和未知四层；没有可验证增量时，保留低频背景或退出。模型不能在没有实体标签源时用通用知识猜地址归属。


## 证据与进一步核验

[EXT060｜Bitcoin Core 官方仓库](https://github.com/bitcoin/bitcoin) [EXT061｜mempool 官方仓库](https://github.com/mempool/mempool) [EXT062｜Glassnode Point-in-Time 指标](https://docs.glassnode.com/data/point-in-time-metrics) [EXT059｜BlockSci 官方仓库](https://github.com/citp/BlockSci) [EXT063｜Coin Metrics Community](https://docs.coinmetrics.io/packages/coin-metrics-community-data)

