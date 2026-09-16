# 免费金融平台限制与连接记录（2026-09-16）

本页列出全部40个平台/产品、93个操作的用途与边界。来源为仓库已核验的官方资料及当前注册表；历史全量实测时间为 2026-09-16T07:32:35.912Z，当时84个操作、61通过、23失败。下表历史状态不等于本轮全部93项已重新验证；新增9项均为Binance公开数据。32个规范数据集的最新接入、D1和工作台方案另见[完整方案](workbench-binance-data-plan-2026-09-16.md)。

接口权限、请求权重、数据授权按对应官方文档和账号实时权益执行。未公布统一数字的接口不编造限速；本仓库TTL只是缓存策略，不是平台授予的额度或SLA。所有交易所除Binance永续外均只能作为辅助，不能静默替代主图。

| 平台/官方依据 | 本仓库操作 | 缓存秒数 | 免费与分析限制 | 历史CF基线 |
| --- | --- | --- | --- | --- |
| [Binance 现货](https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints) | instruments、ticker、klines、depth | 60 | 公开市场数据，遵守来源限流和数据使用条款；不含交易与账户操作。 | 0/3通过；403 |
| [Binance USDⓈ-M](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data) | instruments、funding-info、book-ticker、ticker、klines、premium、funding、open-interest、oi-history、taker-volume、account-ratio、top-position-ratio、basis、depth | 60 | 公开市场数据，遵守来源限流和数据使用条款；不含交易与账户操作。 | 0/6通过；403、probe_network_or_timeout |
| [Bybit](https://bybit-exchange.github.io/docs/v5/market/kline) | ticker、klines、funding、open-interest | 60 | 公开市场数据，遵守来源限流和数据使用条款；不含交易与账户操作。 | 4/4通过 |
| [OKX](https://www.okx.com/docs-v5/en/) | ticker、klines、funding、open-interest | 60 | 公开市场数据，遵守来源限流和数据使用条款；不含交易与账户操作。 | 3/4通过；429 |
| [Deribit](https://docs.deribit.com/api-reference/market-data/public-get_order_book) | ticker、book、instruments、summary | 120 | 公开市场数据，遵守来源限流和数据使用条款；不含交易与账户操作。 | 0/4通过；429 |
| [Coinbase](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/rest-api) | ticker、product、book | 60 | 公开市场数据，遵守来源限流和数据使用条款；不含交易与账户操作。 | 3/3通过 |
| [Kraken](https://docs.kraken.com/api/docs/rest-api/get-ticker-information/) | ticker、klines、depth | 60 | 公开市场数据，遵守来源限流和数据使用条款；不含交易与账户操作。 | 3/3通过 |
| [Bitfinex](https://docs.bitfinex.com/reference/rest-public-ticker) | ticker、candles | 60 | 公开市场数据，遵守来源限流和数据使用条款；不含交易与账户操作。 | 2/2通过 |
| [Bitstamp](https://www.bitstamp.net/api/) | ticker、klines | 60 | 公开市场数据，遵守来源限流和数据使用条款；不含交易与账户操作。 | 2/2通过 |
| [Bitget](https://www.bitget.com/docs/catalog/market/market-data) | book | 60 | 公开市场数据，遵守来源限流和数据使用条款；不含交易与账户操作。 | 0/1通过；403 |
| [KuCoin](https://www.kucoin.com/docs-new/api-3470167) | tickers | 120 | 公开市场数据，遵守来源限流和数据使用条款；不含交易与账户操作。 | 1/1通过 |
| [Hyperliquid](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint) | mids、context、book | 60 | 公开市场数据，遵守来源限流和数据使用条款；不含交易与账户操作。 上游 POST /info 仅查询公开数据，不开放 /exchange。 | 3/3通过 |
| [CoinGecko Demo](https://www.coingecko.com/en/api/pricing) | prices、global、markets | 300 | 仅 Demo 免费计划，10,000 次/月，具体限速以账号为准；署名 CoinGecko，不接 Pro API。 | 3/3通过 |
| [CoinPaprika](https://docs.coinpaprika.com/api-reference/rest-api/introduction) | ticker、global | 300 | 仅公开免费最新数据；历史与付费字段不接入，展示时署名 CoinPaprika。 | 0/2通过；402 |
| [CoinMarketCap Basic](https://coinmarketcap.com/api/pricing/) | listings | 600 | 主机虽名 pro-api，本通道仅使用 Basic 免费计划明确提供的最新列表；需自行申请 Basic key，不自动升级。 | 1/1通过 |
| [DefiLlama](https://github.com/DefiLlama/api-docs) | chains、tvl、stablecoins | 600 | 仅无密钥免费端点，TVL/稳定币供应不等于资金净流入；不接付费解锁/融资/用户数接口。 | 3/3通过 |
| [DEX Screener](https://docs.dexscreener.com/api/reference) | search | 120 | 免费公开 DEX 搜索；单池价格/成交量不能当全市场值，遵守端点速率限制。 | 0/1通过；429 |
| [Alternative.me](https://alternative.me/crypto/fear-and-greed-index/#api) | fng | 3600 | 免费恐惧贪婪指数；展示必须署名 Alternative.me，不当作独立于价格/成交量的概率。 | 1/1通过 |
| [Coin Metrics Community](https://docs.coinmetrics.io/api) | metrics | 3600 | Community 免费非商业研究范围；CC 条款与指标覆盖按官方文档，禁止默认为商用授权。 | 1/1通过 |
| [mempool.space](https://mempool.space/docs/api/rest) | fees、difficulty、mempool、hashrate | 120 | 免费公共节点，有限流且无 SLA；不申请 Enterprise，不广播交易。 | 4/4通过 |
| [Blockstream Esplora](https://github.com/Blockstream/esplora/blob/master/API.md) | fees、blocks、mempool | 120 | 公共 Bitcoin 链数据，仅查询区块/费率/内存池，不开放广播或账户操作。 | 3/3通过 |
| [Blockchain.com](https://www.blockchain.com/explorer/api) | stats、hashrate | 3600 | 公开市场数据，遵守来源限流和数据使用条款；不含交易与账户操作。 | 2/2通过 |
| [FRED / ALFRED](https://fred.stlouisfed.org/docs/api/fred/) | series、observations | 3600 | 免费申请 FRED key；ALFRED 通过 realtime_start/end 查询版本，单系列第三方使用限制仍适用。 | 2/2通过 |
| [美国劳工统计局 BLS](https://www.bls.gov/developers/api_signature.htm) | series | 21600 | 无注册 v1 免费接口，额度与历史跨度小于注册版；本通道不自动申请账号。 | 0/1通过；429 |
| [美国财政部 Fiscal Data](https://fiscaldata.treasury.gov/api-documentation/) | debt、operating-cash | 21600 | 免费官方财政数据；观测日期与发布日期不同，TGA 口径需消费方按表字段解释。 | 0/2通过；525 |
| [欧洲央行 ECB](https://data.ecb.europa.eu/help/api/data-examples) | fx | 21600 | 官方参考汇率，CSV 保留原字段；不是可执行交易报价。 | 1/1通过 |
| [世界银行](https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures) | indicator | 86400 | 免费低频指标；保留单位、年份与缺值，不填成实时行情。 | 1/1通过 |
| [Frankfurter](https://frankfurter.dev/) | rates、currencies | 21600 | 免费免 key 央行参考汇率，非盘中交易报价；底层来源条款分别适用。 | 2/2通过 |
| [加拿大央行](https://www.bankofcanada.ca/valet-api-how-to/) | observations | 21600 | Valet 免费且无需注册；汇率/经济统计按来源发布时间更新。 | 1/1通过 |
| [纽约联储](https://www.newyorkfed.org/markets/data-hub) | sofr、effr | 21600 | 官方日频参考利率，SOFR 与 EFFR 口径分别保留。 | 2/2通过 |
| [Eurostat](https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-introduction) | hicp | 86400 | 欧盟官方免费统计接口，JSON-stat 保留维度/状态；指标修订和统计区变化需消费方解释。 | 1/1通过 |
| [CFTC COT](https://dev.socrata.com/foundry/publicreporting.cftc.gov/gpe5-46if) | tff | 86400 | 官方免费 TFF Futures Only 数据；报告时点与公开发布时间不同，不是实时持仓。 | 1/1通过 |
| [Alpha Vantage](https://www.alphavantage.co/documentation/) | daily | 21600 | 免费 25 次/日，仅 compact 日线；不接 premium、实时付费报价、付费新闻和 full 历史。 | 0/1通过；upstream_rate_limited |
| [Finnhub](https://finnhub.io/docs/api) | quote、news | 300 | 仅个人免费计划的报价/普通新闻；市场权限以账号为准，不使用 premium 端点，不转载新闻全文。 | 2/2通过 |
| [Twelve Data Basic](https://twelvedata.com/pricing) | price、daily | 3600 | 个人 Basic 免费：8 credits/min、800/day；仅账号免费市场，不批量多代码、不启用试用 WS 或付费市场。 | 2/2通过 |
| [SEC EDGAR](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) | submissions、concept | 3600 | 免费披露 API，须配置真实应用名与联系邮箱的 User-Agent；不是 ETF 每日净申购 API。 | 2/2通过 |
| [美国能源信息署 EIA](https://www.eia.gov/opendata/documentation.php) | petroleum | 21600 | 官方免费 key；石油现货统计，不冒充实时期货行情。 | 1/1通过 |
| [GDELT](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/) | articles | 900 | 免费新闻发现接口，返回标题/链接元数据；不代表获准抓取、再分发或发送新闻全文给模型。 | 0/1通过；upstream_timeout |
| [美联储公告订阅](https://www.federalreserve.gov/feeds/feeds.htm) | releases、policy | 1800 | 官方免费 RSS 通道（不是 JSON API），保留原始标题、链接和发布时间。 | 2/2通过 |
| [Polymarket Gamma](https://docs.polymarket.com/api-reference/markets/list-markets) | markets、events | 300 | 仅免费公开市场元数据，不连接钱包、不下单；价格受流动性与结算规则影响，不直接当客观概率。 | 2/2通过 |

## 重要配额与数据授权

- Binance请求权重随端点/limit变化，响应限流头及exchangeInfo为准；USD-M的OI和账户/基差统计一般只有最近30天或一个月。公开market接口不要求交易Key；REST成功不能证明WS或逐笔历史完整。
- CoinGecko Demo：已登记10,000 credits/月；当前账号页面显示100 calls/min。以账号与官方最新文档为准，错误请求也可能消耗额度；必须署名。此前401为领取页掩码误配，已修正。
- CoinMarketCap Basic：仅已确认免费的listings/latest；pro-api是主机名，不代表本项目购买Pro。响应按credits计费，不能把一次HTTP请求等同固定免费额度，余额以账户为准。
- CoinPaprika：官方免费计划20,000次/月；402/429均表示额度限制，CF共享出口或账号实际余量不能从套餐最大值推断。
- Alpha Vantage：免费25次/日。daily compact可用，实时/15分钟延迟美股、full及其他premium权限不纳入；当前仍存在免费额度限制。
- Twelve Data Basic：8 API credits/min、800/day，WS标为trial而非永久免费；当前价格页列为internal non-display。采集能力不自动赋予网页展示或再分发许可。
- FRED免费Key与各系列版权分开；ALFRED修订时点不能用观察日期或系统接收时间代替。BLS无注册v1的跨度/额度少于注册版；本轮没有新增BLS账号。
- SEC不需要Key，但要求真实联系User-Agent，联系内容只保存在CF加密设置，不进入仓库或页面。SEC文件不是ETF每日净申购API。
- Finnhub/Twelve/Alpha的免费市场范围不是全球实时股票全覆盖。参考外汇、EIA现货统计、SOFR、CFTC报告均按各自观察/发布频率解释。
- Coin Metrics Community保留非商业限制；Alternative.me、CoinGecko、CoinPaprika保留署名要求。新闻通道仅元数据与链接，不据此转载全文。Polymarket市场价格受流动性和结算条件影响，不是客观概率。

## 故障归因与处理

| 类型 | 已获得证据 | 可得结论与处理 |
| --- | --- | --- |
| Binance CF 403 | 当前18个规范数据集均拒绝，同期本机18项成功；脱敏分类为unclassified_upstream_rejection | 出口差异已证实，具体地域/WAF原因未证实；保持Binance来源、首次导入标local-bootstrap，不购买代理或静默替代交易所 |
| Deribit CF 429 | 明确quota_reported；本机摘要898合约成功 | 仅证明当前CF限流；云端持续采集未就绪，本机首次截面不算修好CF |
| mempool CF超时 | 两次12秒源预算超时，本机费用接口成功 | 出口/来源链路差异；本机样本不宣称云端通畅 |
| Alpha/其他429与CoinPaprika402 | 免费额度/速率错误；新Key不保证立刻有配额 | 遵守Retry-After和冷却，不重复申请Key/购买升级；Alpha应用层200限流也必须判失败 |
| Treasury525 | 上游TLS握手状态 | 保留失败，不降低TLS；具体源站或边缘责任未确认 |
| GDELT超时 | 12秒预算无完整结果 | 不落空数据，必要时减少查询范围；不是所有新闻不存在 |
| 其他403/网络错误 | 特定时间单次响应 | 只登记实际状态；不泛化为永久不可用 |

所有失败只更新健康记录，成功数据保留但必须显示过期；通用finance仅存每组参数最新原生快照，新dataset表保存来源明确的观察版本。没有新增40平台全量轮询，也没有购买付费API。接口目录、配置状态、实测状态、D1已有数据、持续采集和页面已使用是六件不同的事。
