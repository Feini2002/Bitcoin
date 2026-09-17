# 02｜当前源码审查：问题、反例、影响范围与修正决定

**基线：`a6ef6c8974dcdaace32acf25c3a231ecd279ef37`；查询日期：2026-09-17。** 本卷依据实际读取的源码范围，不是线上故障统计。以下“可推导”表示从函数与条件可严格推导，未执行原函数；“风险路径”表示需要调用链或运行样本确定影响。P0/P1/P2是本方案的修复排序，不是交易风险评级。

## 1. 先撤销已经过时的诊断

不能继续把当前仓库说成没有金融来源注册、没有FRED、没有Deribit摘要或没有来源时间。`finance`模块已经建立有限来源注册、原生响应缓存、32个规范数据集与接收版本。不能继续要求重做这一层。当前缺的是持续性、字段的业务验证、足够历史与旧消费者的迁移。[C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1) [C06｜cloudflare/finance/dataset-store.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/dataset-store.mjs#L1)

不能继续把标题行情“自动切换现货”列为现存确定缺陷。实际读取的标题REST只有fapi和检查响应来源头的代理，aggTrade也固定USDⓈ-M。文件开头与较早审阅文档仍存在旧描述，应该修订注释，而不是重复实施已经完成的修复。[C17｜js/pages/chart.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/chart.js#L900) [C18｜js/pages/chart.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/chart.js#L1370) [C31｜docs/research/chart-workbench-review-2026-09-16.md（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/docs/research/chart-workbench-review-2026-09-16.md#L1)

不能宣称整个强平引擎方向相反：Binance SELL→多头、Bybit Buy→多头的区分已经存在。问题在未知方向、价格类型、数量类型、事件身份与聚合范围，不在已正确的两条映射。[C24｜js/heatmap/liquidation-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/heatmap/liquidation-engine.js#L1)

## 2. 审查清单

| ID/顺序 | 当前证据与问题 | 可观察后果及确定性 | 本次决定 |
|---|---|---|---|
| F01/P0 | 旧`klines`主键仅symbol/interval/t，无venue与产品；新规范序列另存 | 旧表本身不能证明每根历史属于币安；不能由当前标题补出过去来源 | 新研究读规范序列；旧数据只读兼容，不无证据补Binance |
| F02/P0 | 新dataset目录`automaticCollection=false`、`frontendConnected=false` | 32个数据集存在不等于四页已消费，也不保证今天数据更新 | 建立逐能力接入矩阵，启用前检查真实采集与历史 |
| F03/P1 | 新5m仅500根，结构目标864根；无3d数据集而主图含3d | 默认结构覆盖与原窗口不一致；3d链路需要选择，不可悄悄回旧混源表 | 能力声明最小输入；补历史或显式压缩；3d禁用或经验证重采样 |
| F04/P0 | 主图WS存t/o/h/l/c/v，未保留k.x、事件时间及报价币量 | 形成中的末根可以进入“收盘确认”计算；跨消费者无法追源确认依据 | live preview与已完成输入分开，保留原生状态 |
| F05/P1 | WS OPEN被描述为实时；来源提示把D1当交易所证明 | 已连接但无行情也可能呈现实时；存储位置掩盖真实市场身份 | 分开transport、lastMarketEvent、sourceAge、coverage |
| F06/P1 | 标题1秒异步轮询，进入请求时检查WS新鲜，返回时未见相同检查 | 慢REST晚于新WS覆盖标题、并发请求堆叠是可达风险；发生频率未知 | 加in-flight、generation与返回时语义/时间检查 |
| F07/P0 | 近端压力先限定price>当前价，再判当前价>压力+buffer | 对合法正buffer，近端向上突破分支不可达；支撑镜像同样不可达 | 将历史锁定的被测价位与显示最近价位分离 |
| F08/P1 | VWAP使用HLC3×v，初始累积量为零时返回HLC3 | 近似被展示为一般VWAP；无成交也有数；高周期每日重置退化 | 真正quote/base VWAP与HLC3近似分别命名，零分母缺失 |
| F09/P1 | 前日高低选择最后一个“较早观察日”，不检查完整日 | 缺前一天时可能把更早一天标前日；日/周K无法证实完整日内覆盖 | 固定目标日与覆盖；必要时读取独立基础序列 |
| F10/P1 | 摆动点需要右侧wing；反应评分使用之后最多8根 | 当前回看可以成立，但回填为当时已知信号会前视 | 增加level_known_at/confirmed_at；回看与前瞻分开 |
| F11/P1 | 单柱POC降序并列选高价；整窗POC升序并列选低价 | 同一分布在不同视图可得不同POC；可静态推导 | 统一并列政策并注册版本，不声称一种政策是行业唯一真值 |
| F12/P1 | 先round到基础格，再round到展示格 | 分箱可不具结合性，重聚合与直接聚合不同 | 采用可嵌套边界格；旧中心格只保留旧方法，不能伪造精度 |
| F13/P1 | base tick取观察到的最小价差，自动展示tick依赖画布 | 稀疏样本的最小价差不是交易所tick；展示变化可能传导分析 | 分开exchangeTick、storageBin、analysisBin、displayBin |
| F14/P1 | SFP先用全窗口构造价位/中位量再扫描历史 | 历史候选可能利用候选以后形成的分布；不是当时信号 | 逐前缀重放或明确retrospective；记录价位生效时间 |
| F15/P1 | SFP已有降级，但用最新bar状态影响候选confirmed | 已关闭的旧确认可能因最新bar未关被降级；具体调用需验证 | 对candidate.confirmBar校验，保留现有整体数据降级 |
| F16/P1 | 足迹新鲜度缺真实成交时间时用min(now,barEnd) | 进行中bar会得到age=0，时间经过本身不能证明收到新数据 | 未知接收时间保持unknown，不用计划结束时间造心跳 |
| F17/P0 | unknown强平方向在聚合三元式走long | 未识别方向被计入多头；源码条件可直接证明 | 拒绝/独立unknown累计，不默认任何一侧 |
| F18/P1 | Binance ap/p、z/l/q回退及Bybit p×v归一为price/qty | 平均成交价、委托价、破产价与累计/单次/原始量混同 | 明示type和fallback reason；禁止跨语义精确合计 |
| F19/P1 | 合成事件ID由时间、方向、价量拼接 | 相同属性的两事件可能碰撞；累计更新可能重复 | 区分原生ID与指纹；无原生ID不承诺无损去重 |
| F20/P1 | 压力矩阵24h变化找不到锚点就用最早值 | 1小时变化可能被标成24h；页面另一方法却返回缺失 | 共用有实际区间和容差的as-of方法 |
| F21/P1 | 压力矩阵固定%/8h；basis季度阈值直接比较；页面按数值大小猜单位 | 同一数据可跨页解释100倍差异，费率间隔可能不真实 | 费率与basis单位在契约决定，展示禁止猜单位 |
| F22/P1 | 压力页多因子加分；独立快照另用log10金额评分及72/42 | 同名压力不是同一方法，LLM无法对应用户看到的解释 | 共用方法输出或明确不同分析ID；不再以同名伪装一致 |
| F23/P1 | chart snapshot任一周期新鲜就整页fresh，并取最小staleMs | 当前选中周期过期可能被其他周期遮盖 | 按当前任务依赖选择质量，不用全局any掩盖 |
| F24/P1 | snapshot raw_fact含trend和rangePosition；指纹主要最新时间 | 描述计算被误当原始观测；早期行修订指纹不变 | 修订认识类型；内容/方法摘要用于身份但不代表真实性 |
| F25/P1 | 原分析固定62/58/46与72/54；机会条目以market.ok推断数据同向 | 数据可用被当成市场证据一致，且bias三个分值都中性 | 退出固定概率外观；事实、解释、预测分层 |
| F26/P1 | 日历取文章发布时间/抓取时间/当前时间；未搜索文案称覆盖足够 | 回顾新闻可能伪装未来催化剂；流程状态代替信息覆盖 | 官方排期独立；搜索是否执行与覆盖评估分开 |
| F27/P1 | 规范化仅有限形状/有限值校验 | OHLC关系、负量、交叉盘口等可能通过此层；全链是否另挡未知 | 补领域验证并追外层，不能仅有JSON合法 |
| F28/P2 | 每次新receipt保存全部500历史点；同主键冲突DO NOTHING | 高频开启会写放大；同receipt不同内容可能无声丢冲突 | 分开收取批次与内容修订；冲突登记；先估真实规模 |
| F29/P2 | gateway缓存过期后多请求可各自访问上游 | 所读函数内未见singleflight，外层锁未知 | 检查外层；仅必要时按channelKey单飞与限额 |
| F30/P1 | `known_at`限制接收时间，但健康来自当前state | 代码已明确stateScope，不能算隐藏bug；消费者若忽略会误用 | 历史健康独立或显示未保存，市场cutoff另行限制 |

来源：F01–03/F27–30见[C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1) [C05｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L77) [C06｜cloudflare/finance/dataset-store.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/dataset-store.mjs#L1) [C07｜cloudflare/finance/gateway.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/gateway.mjs#L1) [C08｜cloudflare/finance/gateway.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/gateway.mjs#L170) [C10｜cloudflare/schema.sql（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/schema.sql#L1)；F04–10见[C11｜js/chart/indicator-math.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/chart/indicator-math.js#L1) [C12｜js/chart/indicator-math.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/chart/indicator-math.js#L235) [C13｜js/chart/indicator-math.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/chart/indicator-math.js#L470) [C14｜js/chart/indicator-math.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/chart/indicator-math.js#L720) [C17｜js/pages/chart.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/chart.js#L900) [C18｜js/pages/chart.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/chart.js#L1370)；F11–16见[C19｜js/orderflow/footprint-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/orderflow/footprint-engine.js#L1) [C20｜js/orderflow/footprint-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/orderflow/footprint-engine.js#L210) [C21｜js/orderflow/footprint-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/orderflow/footprint-engine.js#L350) [C22｜js/orderflow/footprint-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/orderflow/footprint-engine.js#L600)；F17–22见[C24｜js/heatmap/liquidation-engine.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/heatmap/liquidation-engine.js#L1) [C25｜js/heatmap/pressure-matrix.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/heatmap/pressure-matrix.js#L1) [C26｜js/heatmap/pressure-matrix.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/heatmap/pressure-matrix.js#L260) [C27｜js/pages/derivatives.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/derivatives.js#L1) [C28｜cloudflare/snapshot/marketSnapshotProgram.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/snapshot/marketSnapshotProgram.mjs#L530)；F23–26见[C28｜cloudflare/snapshot/marketSnapshotProgram.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/snapshot/marketSnapshotProgram.mjs#L530) [C29｜cloudflare/yuqing/fenxi/sentiment-logic.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/yuqing/fenxi/sentiment-logic.js#L1)。

## 3. 四个不用真实行情就能理解的反例

### 3.1 “最近压力”不等于“刚刚突破的压力”

假设当前价100，排序函数只返回101以上的压力，缓冲1。当前价不可能大于102；若下一根变成103，重新筛选又只留下104以上的压力。被跨过的101消失，所以同一流程无法宣布它被跨越。正确设计在前一可用时刻固定101这一候选，下一根分别做“是否跨过101＋缓冲”与“目前最近新压力在哪里”。两种输出都可能有用，但不能共用当前价筛选后的一条变量。这里没有宣称`rangeContext`所有突破分支也失效。

### 3.2 VWAP的近似差异

合成成交：90成交4单位、110成交6单位，最高110、最低90、收盘110，真实成交均价为102。HLC3为103.333…；单根HLC3加权输出不是102。只有正确的报价币成交额1020与基础币量10才能恢复这一窗口VWAP。若没有成交量，除法不可定义；回填HLC3会制造“存在成交均价”的假象。这个例子只证明方法差异，不证明原近似完全无参考价值。

### 3.3 POC及价格格的确定性

价格100和110各有相同成交量，升序`>`选择100，降序`>`选择110。修正应声明并列选择规则，例如离窗口VWAP最近、仍并列取低价；或者保留POC带，而不是让数组顺序决定。另一个合成数4.6，先round到1单位格得到5，再round到10单位格得到10；直接round到10单位格得到0。继承旧中心格后不能声称无损恢复原始价格，必须保留原格方法。

### 3.4 24h标签不能靠函数参数证明

输入只有10:00的100与11:00的110。调用`changePctOverWindow(...,24h)`，找不到前日11:00锚点后使用10:00，会得到10%，但实际时距只有1小时。新输出应为`requestedWindow=24h, actualWindow=1h, value=null, reason=insufficient_anchor`，可以另展示“已有样本变化10%”，不能把它放在24h列。

这些例子由本次审查构造，未运行仓库函数。后续固定样本应接到实际函数及所有消费者，不能只测试一个新写的理想实现。

## 4. 不应错误扩大结论的地方

EMA、RSI、ATR的种子和递推存在合法约定差异；没有证据要求全部替换。布林带使用总体标准差不是自然错误。MACD直方图按变化斜率着色是显示政策，应该写清而不是自动判为数学错。SFP已经有数据降级逻辑、资金费页面已经有空值处理、数据集已区分source lag与collection age，这些应保留。

历史摆动点包含右侧确认样本，在今天回看是允许的；错误发生在把后来确认的点标成当时已知。压力矩阵已经声明不是未来清算池金额，不能为制造审查力度指责它冒充CoinGlass真实仓位。正确批评是规则权重、时间与跨页同名不一致。

## 5. 修正后的实施规则

P0首先防止错误身份和未知分类进入新分析；P1围绕四页各自形成完整切片，包括计算、解释、快照、导出与测试，而不是按文件大小依次重写。P2由实测负载触发优化，不能因为可能有写放大就宣布D1无法承载。

所有F编号在任务与验收场景中有对应。若实施时发现新提交已修复某条，状态改为`resolved_in_newer_code`并附新证据，不再执行重复修改；若调用链阻止某风险，只保留防御性测试并降低其优先级。任何未读模块的保护都保持未知，不以“本段没看到”证明全仓没有。
