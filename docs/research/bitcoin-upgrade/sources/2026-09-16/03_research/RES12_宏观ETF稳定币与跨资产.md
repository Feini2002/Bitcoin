# RES12｜宏观ETF稳定币与跨资产

研究日期：2026-09-16。本卷是独立基础研究，不要求匹配当前仓库；“建议/迁移启示”是本研究的推论，不是项目官方承诺。未运行候选代码。


## 1. 同为资金背景，时间机制完全不同

宏观序列有观察期、发布和修订；ETF有交易日、份额/NAV披露和汇总确认；稳定币有发行、赎回、跨链映射及储备披露；证券价格有休市与复权。合成到BTC背景面板之前应分别定义，不能只加一个统一datetime。

Fed订阅、BLS日历、ALFRED版本、SEC API、发行人页面和稳定币发行人透明度页面属于不同原始入口。SEC提交/XBRL接口不等于BTC ETF每日净流量接口。[EXT067｜Federal Reserve RSS目录](https://www.federalreserve.gov/feeds/feeds.htm) [EXT068｜BLS 官方发布日历](https://www.bls.gov/schedule/2026/09_sched.htm) [EXT069｜FRED/ALFRED Real-Time Periods](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html) [EXT070｜SEC EDGAR数据API](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) [EXT071｜iShares IBIT发行人页面](https://www.ishares.com/us/products/333011/ishares-bitcoin-trust-etf) [EXT072｜Circle 透明度披露](https://www.circle.com/transparency) [EXT073｜Tether 透明度披露](https://tether.to/en/transparency/)

## 2. 宏观数据与日历

官方日历记录的是预期发布时间，可能更新；实际发布时间还需原发布记录。BLS日历采用美国东部时间，夏令时使UTC换算变化。文章转载时间不能填作未来催化剂时间，旧发布日期也不能直接给下一次事件排期。

ALFRED日期级vintage适合历史版本，不保证秒级实际可见时间。没有精确发布时间，就将研究降低到相应时间尺度；不要用最终修订数据参加“当时能否判断”的回测。部分第三方FRED序列还有独立数据权利，接入前按序列审查。

## 3. ETF净流量的分解

AUM变化包含价格影响，并不等于净申购；份额变化与NAV可以形成带假设的估计，但披露时点、费用和份额机制要说明。多个基金明细未到齐时，合计不能因空值填零就变成已确认完整值。

建议保存发行人字段、估算方法和汇总来源三层。供应商有修订时附版本，不覆盖旧报告。持有ETF价格的跨资产API，并不表示已经取得BTC ETF申购赎回数据。

## 4. 稳定币流动性

原生发行、授权但未流通、流通量、储备以及跨链映射不能混加。稳定币市值还受价格影响，供应变化不直接证明BTC买盘。储备证明或鉴证报告是发行人/审计材料，不能表述为本系统独立审计。

第一版作为低频背景，展示定义、截止时间和来源差异。若要研究是否领先BTC，需要时点正确历史、不同币种/链的去重和预声明验证，不是给供应变化乘一个权重后加入总分。

## 5. 跨资产比较

exchange_calendars帮助标注证券session；它不生成宏观日历。周末股票旧收盘价可以作为上次可见价，但不能当周末新变化；长期相关性受采样、时区、复权、缺失与制度变化影响。[EXT131｜exchange_calendars 当前仓库](https://github.com/gerrymanoim/exchange_calendars) [EXT058｜yfinance 官方仓库](https://github.com/ranaroussi/yfinance)

应使用共同可观察时点、说明前值沿用和缺失，按收益而非不平稳价格随意计算相关。相关系数不是稳定因果关系，也不是预测精度。API回退换了指数/交易所时，应重新标记可比性。

## 6. 最小新增路径

先接一个官方事件日历与一个有版本的宏观序列；ETF、稳定币和更复杂跨资产研究可独立增加，不互为前置。每项都需证明使用者能少查一次资料、识别一个重要变化或避免一个时点错误。没有收益就不扩大覆盖。


## 证据与进一步核验

[EXT069｜FRED/ALFRED Real-Time Periods](https://fred.stlouisfed.org/docs/api/fred/realtime_period.html) [EXT070｜SEC EDGAR数据API](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) [EXT071｜iShares IBIT发行人页面](https://www.ishares.com/us/products/333011/ishares-bitcoin-trust-etf) [EXT072｜Circle 透明度披露](https://www.circle.com/transparency) [EXT073｜Tether 透明度披露](https://tether.to/en/transparency/) [EXT068｜BLS 官方发布日历](https://www.bls.gov/schedule/2026/09_sched.htm) [EXT131｜exchange_calendars 当前仓库](https://github.com/gerrymanoim/exchange_calendars)

