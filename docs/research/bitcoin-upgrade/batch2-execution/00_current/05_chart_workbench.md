# 05｜行情工作台：逐项计算、数据和交互改造设计

**范围：`#chart`及其实际消费者。** 当前主体为`js/pages/chart.js`、`js/chart/indicator-math.js`、`js/data-engine.js`、多周期组件与独立快照。后两者须由执行者继续绑定具体调用；本轮不宣称已经阅读所有实现。新设计优先复用Lightweight Charts 4.1.3，不把升级图表版本作为数据修复的前置。[C15｜js/pages/chart.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/chart.js#L1) [C16｜js/pages/chart.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/chart.js#L190) [E16｜Lightweight Charts 4.1 API](https://tradingview.github.io/lightweight-charts/docs/4.1/api/interfaces/IChartApi)

## 1. 页面要回答的问题

行情工作台首先回答：现在看的是什么市场、价格发生什么、成交参与度怎样、哪些结构已确认、哪些只是形成中，以及其他数据是否支持或反驳当前解释。它不是把所有指标都画在一屏，也不应该以单个“置信度”替用户作决定。

第一屏建议为固定产品身份与状态、K线与成交量、可选一组趋势线、少数已知时间明确的价位、同窗口参与度/杠杆提示。默认不同时开启EMA、布林、VWAP、Fib、RSI、MACD。已有个人设置保留，通过一次明确的默认配置迁移处理，不直接抹掉用户选择。当前默认确实开启了上述多数指标。[C16｜js/pages/chart.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/chart.js#L190)

## 2. 产品身份与价格类型

默认产品遵循当前仓库已采用的Binance USDⓈ-M BTCUSDT永续。标题同时给交易所、产品、报价币与价格类型。末笔成交价、mark、index与K线收盘是不同对象，不允许无标记互相替换。

当前标题已改为同产品aggTrade及fapi/带来源头的代理，继续保留。它与K线独立更新可以合理存在，但各自显示时间；标题最新成交不能把一根旧K线标新鲜，也不能参与按收盘定义的信号。网络不可达时保留最后值并标年龄，不从现货抓一个相近价格假装相同。[C17｜js/pages/chart.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/chart.js#L900) [C18｜js/pages/chart.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/chart.js#L1370)

旧K线来源未知时显示`legacy mixed/unknown`范围。页面可以允许“旧历史参考”开关，但新确认类计算默认不跨越未知来源段。来源变化是新的物理序列或明确组合序列，不能只改tooltip后继续拼接。

## 3. 两套合法视图：实时预览与确认研究

实时预览允许当前形成中的K线、指标和候选结构变化，必须标注“形成中”。确认研究默认以来源证据满足合同的已完成窗口为输入，形成中的数值不得参与确认条件。两者共用数值库，但输入集合与结果身份不同。

WS原生`k.x`、`k.T`、消息事件时间、累计基础/报价量等保留在内部记录。REST的计划结束时间只是另一种依据，新数据集的`closed`已经注明request-after-close而非来源flag；适配时不得把它一律提升为原生确认。[C05｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L77) [C18｜js/pages/chart.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/chart.js#L1370) [E01｜Binance USDⓈ-M WebSocket市场数据](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market)

若确认消息迟到，窗口状态从forming变为confirmed并产生新观察版本；若旧窗口后来修订，不无痕改写已封存报告。页面当前值可更新，但旧报告仍指向当时输入并展示后来的更正关系。

## 4. 历史范围与周期

现有工作台支持5m、15m、1h、4h、1d、3d、1w；新规范数据集初始缺3d，5m500根又低于结构目标864根。不能直接切新API之后悄悄降级到旧数据。[C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1) [C12｜js/chart/indicator-math.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/chart/indicator-math.js#L235) [C15｜js/pages/chart.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/chart.js#L1)

建议为每周期显示实际起止、连续有效根数、预期目标和压缩原因。3d处理有三条可选路线：增加该来源允许的原生3d操作；按明确UTC锚点从同源1d生成；或暂时禁用3d及其上级确认。原生3d锚点未核实前不能假定从当前数组第一天开始每三根就是交易所3d。派生K线须与一个实际原生样本比较后固定规则。

周线和日线锚点由源规范确定，显示时区可以继续Asia/Shanghai；显示时间不改变聚合边界。按根数的“近三日”只有在连续有效窗口成立时才称三日，缺口或不足500/864要给真实时距。

## 5. OHLCV重采样与完整性

输入必须同instrument、同source与兼容方法版本。输出open来自首个有效原始窗口，close来自最后窗口，high/low取极值；基础量、报价量、成交笔数、主动买量分别求和。未完成子窗口不得让父窗口变成confirmed。

父窗口应保存expected_children、present_children、missing_ranges、first/last_source_time和finality。没有交易与没有数据不同：来源明确零交易才可生成合法零量条；缺失数据不能由插值制造交易事实。不同来源的close即使几乎相等也不可当同序列。

合并历史REST与实时WS时以物理窗口身份和版本优先级判断，不能简单让最后到达的旧REST覆盖新WS。是否合并形成中累计量需要区分“全量快照替换”与“增量事件相加”；对K线累计量通常不能把每条更新直接求和。

## 6. 真正增加价值的成交面板

当前主图读取旧OHLCV只保留基础量，新数据已拥有quoteVolume、trades与takerBuyBase/Quote。新增成交量面板不是另采一条数据，而是消费这些已存在字段。[C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1) [C18｜js/pages/chart.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/pages/chart.js#L1370)

建议显示：基础币量、报价币成交额、主动买入占比、净主动量及同口径历史位置。净主动量可以按`2*takerBuyBase-baseVolume`计算，但必须标“该K线成交定义下的净主动量”；它不是独立于成交量的另一份证据，也不自动等于来自aggTrade的全量CVD。先核交易所两种数据群体、RPI与聚合差异，再做跨源守恒比较。[E01｜Binance USDⓈ-M WebSocket市场数据](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market) [E02｜Binance USDⓈ-M REST市场数据](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data)

相对成交量建议`current_volume / median(reference_volumes)`，参考集合必须同周期、同来源，当前窗口不进入基准；涉及日内季节性时按相同UTC时段或固定交易session比较。中位数为零或样本不足时输出不可用，不能加极小常数造极值。形成中成交量与完整窗口比较应分开，不能把未结束10%的窗口误称缩量90%。

## 7. VWAP重设计

### 7.1 三种方法必须分开

`VWAP-trade`使用同交易群体的成交价×量；`VWAP-quote/base`使用可靠报价币成交额除基础币量；`VWAP-HLC3-approx`使用K线典型价近似。前两者在数据群体、币种与覆盖相同的条件下可比较；第三种只是近似，随K线周期变化是正常方法结果，不应宣称跨周期完全一致。

当前vwapSeries是HLC3近似且UTC日重置。更改为quote/base时提升method_version，旧截图与旧报告不按新方法重算覆盖。新结构应有anchor_type、anchor_at、base_resolution、complete_anchor、source_scope、last_contribution_at、denominator。[C11｜js/chart/indicator-math.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/chart/indicator-math.js#L1)

### 7.2 锚点与零量

日内UTC VWAP从UTC00:00起。输入从当天08:00开始，只能称“自08:00起已观察区间VWAP”，不能无标记显示日内VWAP。对日线及以上，日内重置指标应禁用或从足够低粒度数据计算后取对应时点；不在每根周K上重置为HLC3。

累计分母为零则值null；同一有效锚点已有成交后出现合法零量子窗口可以沿用已有VWAP，同时保留最后贡献时间。跨日不沿用前日累计值。不以volume=0修复缺失volume。

### 7.3 偏离与标准差带

可新增`distance_pct=(close/VWAP-1)*100`、`distance_atr=(close-VWAP)/ATR`，前提是同一价格产品和对齐窗口。它们描述位置，不是均值回归概率。

严格成交价方差需要二阶加权矩；只有OHLCV与总成交额通常不足以还原。第一版不宣称精确VWAP标准差带；可以使用明确的K线近似波动带，但命名、参数和输入粒度必须区分。

## 8. EMA、ATR、RSI、布林与MACD

原EMA采用SMA种子，ATR与RSI有明确递推，布林使用总体标准差。这些可以保留。需要补的是方法注册、warmup、无效样本与增量重算政策，不是为了专业化把所有函数换库。[C11｜js/chart/indicator-math.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/chart/indicator-math.js#L1)

每项指标返回`value、valid_from、input_count、required_warmup、calculation_mode、method_version`。参数被修改后，结果不与旧参数共用缓存。历史不足时不使用默认0。RSI在真正平价且有效序列下返回50是合法约定，与FNG缺失回退50完全不同，不能一刀切删除所有50。

缺口中断递推链时必须声明策略：拒绝跨缺口确认、按缺口后重新预热，或使用明确估计的价格；最后一种不得标作原始事实。不要先过滤缺失行再把剩余行当等间隔序列。

增量更新与全量算法做逐前缀一致性测试。只有形成中最后一条变化时可复算尾部；历史较早记录修订要使受影响递推区间失效，不能永远只更新最后值。性能目标由6000根、实际副图和更新频率测量，不能从代码复杂就声称卡顿。

## 9. 结构价位与近端突破

### 9.1 独立对象

`Level`保存价格带、生成输入、known_at、来源方法、强度构成、失效规则；`LevelTest`保存某根K线对已知价位的测试结果；`NearestDisplayLevel`只是当前界面排序。三者不能合成一个每帧重算的变量。

当前近端突破逻辑使用按当前价过滤的压力/支撑，再比较当前价是否已越过它，分支存在逻辑矛盾。修正使用此前已确认的Level版本，先判断是否穿越，再计算新nearest用于显示。[C12｜js/chart/indicator-math.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/chart/indicator-math.js#L235) [C14｜js/chart/indicator-math.js（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/js/chart/indicator-math.js#L720)

### 9.2 生命周期

建议`candidate→known→tested→confirmed_break/failed_test→invalidated/retired`。无需每个状态都新增表，可以附在研究输入中，但事件时间必须保留。价格接近压力是位置观察；已完成K线超过缓冲才满足某条突破规则；满足规则不是未来延续已验证。

摆动点依赖右侧wing后才known，反应评分若看之后8根，要么等足够观察后生成新的强度版本，要么不用它评价早先时点。禁止在历史图上只标摆动发生时间，不标后来何时确认，然后拿图回测胜率。

### 9.3 强度、合并与缺失

现有触碰、来源、样本比例合成confidence改称`evidence_strength`或拆分明细，不与概率共用字段。按距离合并多个价位时保留原成员、权重与合并版本；顺序相关的反复平均不是稳定中心，改为明确加权中心或价格带，不在页面与快照分别实现。

前日高低应固定前一完整UTC自然日；缺数据返回missing_previous_day，不退到更早一天仍叫前日。样本范围内极值可以单列，不能冒充完整日极值。Fib保留为可选几何参考，anchor、ratio与带宽清楚，不能因为数列名称得到更高可信度。

## 10. 多周期上下文

当前粗多数票trend不是独立证据投票，短长周期大量共享价格。新摘要分别显示当前周期结构、上级已完成结构、各自窗口与确认状态，不把三票上涨算成高概率。

同一个market_cutoff下，上级周期可能尚未结束，默认研究只取此前已完成上级窗口，实时页面可显示“上级形成中”。不能用当前5m价格越过上级压力就写“上级收盘确认”。上级数据缓存必须带instrument、周期、截止、版本、模式，而不是只按周期。

主周期过期时，另一个周期新鲜不能使整页fresh。`required_inputs`声明本视图实际依赖；结果可以显示“主周期可用、上级不可用”，而不是所有内容一起失败或一起正常。[C28｜cloudflare/snapshot/marketSnapshotProgram.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/snapshot/marketSnapshotProgram.mjs#L530)

## 11. 界面、导出与资源生命周期

十字线显示源时间、OHLC、量、主动量与确认状态。显示UTC8可以保留，锚点说明另列。增加“回到最新”“固定绝对区间”“查看方法”的操作，不把拖动和查看触发为模型请求。默认卡片不超过实际有用的任务集合，完整指标可展开。

所有异步请求携带selection generation；返回前检查产品、周期、时间和代次，页面卸载取消订阅与定时器。标题REST增加单飞与超时，返回时若已有更新的相同价格类型观测则丢弃旧响应。控制并发是防止相互覆盖，不是承诺供应商永远可用。

导出必须从封存输入或固定选择生成，包含方法、来源、缺口、锚点与最终性；仅导屏幕数值不能满足研究复盘。保存研究现场用绝对窗口与数据版本，scrollPosition/barSpacing仍是显示偏好而非历史身份。

## 12. 迁移与验收

先修身份与确认，影子生成新指标，不改变旧历史；再替换主图数据适配及新量面板；随后修结构状态；最后调默认布局。每一步独立开关，不能因UI回退恢复已确认错误的source标签或固定概率。

必测样本：同symbol不同交易所、同交易所现货/永续、乱序WS与REST、k.x=false/true、缺上级周期、500/864样本不足、3d未启用、完整/不完整UTC日、零量/缺量、两峰POC引用、历史修订、两种时区跨日、旧研究窗口恢复。比较页面、独立快照和新简报输出字段；只测主图截图不够。

实际命令候选为现有`verify-indicator-math`、`verify-market-recovery`、`verify-kline-history`、`verify:market-snapshot`与浏览器测试。先读当前脚本副作用再按实施权限运行；本轮没有执行这些命令。[C30｜package.json（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/package.json#L1)
