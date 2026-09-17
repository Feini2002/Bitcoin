# 20｜32个当前规范数据集的接入清单

来源为固定提交`cloudflare/finance/datasets.mjs`及其归一化。下表不是新增32个API或自动采集配置；同一目录已存在，重点是消费、覆盖和领域验收。[C04｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L1) [C05｜cloudflare/finance/datasets.mjs（读取范围见登记）](https://github.com/Feini2002/Bitcoin/blob/a6ef6c8974dcdaace32acf25c3a231ecd279ef37/cloudflare/finance/datasets.mjs#L77)

| 既有ID | 已有数据 | 目标用途 | 接入前限制 | 必须通过的验收 |
|---|---|---|---|---|
| binance-perp-klines-5m | USDⓈ-M 5m原生K线 | 主图与M01/M03/M06/M09 | 初始500根；补实际范围、完成状态、OHLC/量守恒；旧来源不明段不可混入 | 同产品、同周期、历史/WS交接；quote与base一致，不用HLC3冒充真VWAP |
| binance-perp-klines-15m | USDⓈ-M 15m原生K线 | 主图与M01/M03/M06/M09 | 初始500根；补实际范围、完成状态、OHLC/量守恒；旧来源不明段不可混入 | 同产品、同周期、历史/WS交接；quote与base一致，不用HLC3冒充真VWAP |
| binance-perp-klines-1h | USDⓈ-M 1h原生K线 | 主图与M01/M03/M06/M09 | 初始500根；补实际范围、完成状态、OHLC/量守恒；旧来源不明段不可混入 | 同产品、同周期、历史/WS交接；quote与base一致，不用HLC3冒充真VWAP |
| binance-perp-klines-4h | USDⓈ-M 4h原生K线 | 主图与M01/M03/M06/M09 | 初始500根；补实际范围、完成状态、OHLC/量守恒；旧来源不明段不可混入 | 同产品、同周期、历史/WS交接；quote与base一致，不用HLC3冒充真VWAP |
| binance-perp-klines-1d | USDⓈ-M 1d原生K线 | 主图与M01/M03/M06/M09 | 初始500根；补实际范围、完成状态、OHLC/量守恒；旧来源不明段不可混入 | 同产品、同周期、历史/WS交接；quote与base一致，不用HLC3冒充真VWAP |
| binance-perp-klines-1w | USDⓈ-M 1w原生K线 | 主图与M01/M03/M06/M09 | 初始500根；补实际范围、完成状态、OHLC/量守恒；旧来源不明段不可混入 | 同产品、同周期、历史/WS交接；quote与base一致，不用HLC3冒充真VWAP |
| binance-perp-premium | mark/index/当前费率快照 | M30及持有成本旁证 | 当前报告值不代表新结算；nextFundingTime与采样时间分别保存 | 重复读取不重复累计费用，价格类型各自命名 |
| binance-perp-funding | 已结算费率事件 | M23/M24/M25 | 500事件不保证连续，间隔要有依据 | 跨零、间隔变化、缺事件和预测值不能混入 |
| binance-perp-oi | 当前OI数量 | M26及当前杠杆观察 | BTC数量，不是美元市值或多头量 | 与历史同规格/同时间对齐，不插值造频率 |
| binance-perp-oi-history | 1h OI历史数量和值 | M26/M27 | 最多500小时初始化、官方近一个月，期末时间 | 短窗口拒绝24h标签；数量与估值分开 |
| binance-perp-taker | 1h主动量与比值 | M31/主图参与度 | 统计窗口期初标签，非全逐笔CVD | 先聚合分子分母，不累加比值 |
| binance-perp-accounts | 账户方向比例 | M32 | 来源账户样本，不是金额 | 显示类型和窗口，跨源不冒充同群体 |
| binance-perp-top-positions | 头部持仓样本比例 | M32 | 不是top账户比；当前认证需核 | 不能填缺失top-account字段，不声称机构真实仓位 |
| binance-perp-basis | PERPETUAL原生基差 | M28/M30 | 绝对/比例/年化字段分开；非季度 | 空年化不填；禁止单位按大小猜 |
| binance-perp-book | 20档时点深度 | M37–M40条件试验 | 不是连续L2，未见带宽不为零 | bid/ask排序数量、交叉和深度足量检查 |
| binance-perp-instrument | BTCUSDT原生规格 | 全部数量价格方法 | pricePrecision不是tick；需effective version | 规则修改产生版本，旧观察关联旧规格 |
| binance-perp-funding-info | 费率调整信息 | M23规则依据之一 | 列表无BTC仅未报告调整，不证明8h | 间隔来源未知保持未知 |
| binance-spot-klines-1h | 现货1h上下文 | 现货/永续比较 | 不能作为永续主图标题或历史回退 | 两系列独立，窗口/quote可比 |
| fred-dgs2 | 2年期收益率 | M42宏观 | percent/year、观察日非发布时间 | 变化显示bp，休市和版本明确 |
| fred-dgs10 | 10年期收益率 | M42期限利差 | 同前；与2y对齐 | 不跨不同时点直接求利差 |
| fred-real10y | 10年实际收益率 | 宏观背景 | 来源系列定义与修订 | 不当日内实时，不给独立投票保证 |
| fred-breakeven10y | 10年通胀补偿 | 宏观背景 | 与相关利率有定义联系 | 不把相关构造当三个独立证据 |
| fred-dollar | 广义贸易加权美元指数 | 美元背景 | 不是DXY；Jan2006基期 | 名称、变化和时间正确 |
| fred-cpi | 季调CPI指数 | M43 | 不是同比或超预期 | 缺12月基准/共识分别拒绝对应方法 |
| fred-fed-assets | 联储资产 | 周度背景/代理实验 | million USD；具体观察时点 | 与周均/日频混合时显式重采样 |
| fred-tga | 财政账户周平均系列 | 财政流动性背景 | million USD；不假装某日余额 | 不可直接当日内净流量 |
| fred-rrp | 逆回购系列 | 流动性背景 | billion USD；与前两者量级不同 | 单位转换、时间与公式透明 |
| nyfed-sofr | 工作日参考利率 | 融资背景 | percent/year，effectiveDate | 周末沿用不是新发布 |
| stablecoin-supply | USDT/USDC供应与价格 | M45 | source time未知不补now；供应不等于净买盘 | 桥接/市值/供应区分，价格异常保留 |
| crypto-breadth | 全市场cap/volume/ dominance | 市场背景 | CoinGecko口径，不是币安成交 | 字段范围与价格单位明确、署名与权利检查 |
| btc-fees | mempool费率建议 | 网络拥堵背景 | sat/vB，不是资金流 | 无时间字段保留接收依据 |
| deribit-btc-options | 期权摘要原生整行 | Q0/Q1 | 已有可空bid/ask、underlying和mark；无完整Greeks保证 | 先复用字段，核产品/批次/截断/双边质量 |

## 实施排序

先接当前选定切片实际使用的数据集，例如S1的5m/1h K线与instrument、S4的funding/OI/basis。宏观和期权目录存在不意味着要与第一批一起接完。新来源的质量不低于旧源；若规范数据覆盖不足，保留明确的旧历史参考，不无声混接。

## 每个数据集的能力记录

记录registered_at、last_success_receipt、实际观察起止、行数/截断、method readiness、consumer status、continuous collection及source policy。不要只新增enabled=true。批刷新由当前固定参数构造，历史分页或自动Cron需单独任务，不从refreshSeconds字段推断已经定时运行。

## 共同退出规则

端点不再满足免费/公开范围、当前来源不可达、真实数据频率不支持目标方法、单位无法确认、历史窗口不足或现有输入已经提供同等价值时，停止该数据集的新增消费。它可以继续作为研究候选，不因为目录有条目就必须上线。
