// Free/public market-data channels only. No trading, accounts, paid endpoints or scheduled collection.
export const FINANCE_VERSION = '2026-09-16.3';
const text = (value, pattern = '^[A-Za-z0-9_.:-]{1,80}$') => ({ type: 'text', default: value, pattern });
const num = (value, min, max) => ({ type: 'integer', default: value, min, max });
const choice = (value, values) => ({ type: 'enum', default: value, values });
const date = value => text(value, '^\\d{4}-\\d{2}-\\d{2}$');
const op = (path, params = {}, extra = {}) => ({ path, params, ...extra });
const symbol = text('BTCUSDT');
const limit = num(100, 1, 500);
const free = '公开市场数据，遵守来源限流和数据使用条款；不含交易与账户操作。';
const provider = (name, category, base, docs, operations, extra = {}) => ({ name, category, base, docs, cost: 'free-public', notes: free, ttl: 60, operations, ...extra });
export const FINANCE_PROVIDERS = {
  'binance-spot': provider('Binance 现货', 'exchange', 'https://data-api.binance.vision', 'https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints', {
    instruments: op('/api/v3/exchangeInfo', { symbol }),
    ticker: op('/api/v3/ticker/24hr', { symbol }),
    klines: op('/api/v3/klines', { symbol, interval: choice('1h', ['1m','5m','15m','1h','4h','1d','1w']), limit }),
    depth: op('/api/v3/depth', { symbol, limit: choice('100', ['5','10','20','50','100']) }),
  }, { market: 'spot' }),
  'binance-usdm': provider('Binance USDⓈ-M', 'derivatives', 'https://fapi.binance.com', 'https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data', {
    instruments: op('/fapi/v1/exchangeInfo'),
    'funding-info': op('/fapi/v1/fundingInfo'),
    'book-ticker': op('/fapi/v1/ticker/bookTicker', { symbol }),
    ticker: op('/fapi/v1/ticker/24hr', { symbol }),
    klines: op('/fapi/v1/klines', { symbol, interval: choice('1h', ['1m','5m','15m','1h','4h','1d','1w']), limit }),
    premium: op('/fapi/v1/premiumIndex', { symbol }),
    funding: op('/fapi/v1/fundingRate', { symbol, limit }),
    'open-interest': op('/fapi/v1/openInterest', { symbol }),
    'oi-history': op('/futures/data/openInterestHist', { symbol, period:choice('1h',['5m','15m','1h','4h','1d']), limit }),
    'taker-volume': op('/futures/data/takerlongshortRatio', { symbol, period:choice('1h',['5m','15m','1h','4h','1d']), limit }),
    'account-ratio': op('/futures/data/globalLongShortAccountRatio', { symbol, period:choice('1h',['5m','15m','1h','4h','1d']), limit }),
    'top-position-ratio': op('/futures/data/topLongShortPositionRatio', { symbol, period:choice('1h',['5m','15m','1h','4h','1d']), limit }),
    basis: op('/futures/data/basis', { pair:symbol, contractType:choice('PERPETUAL',['PERPETUAL','CURRENT_QUARTER','NEXT_QUARTER']), period:choice('1h',['5m','15m','1h','4h','1d']), limit }),
    depth: op('/fapi/v1/depth', { symbol, limit: choice('100', ['5','10','20','50','100']) }),
  }, { market: 'usdm-futures' }),
  bybit: provider('Bybit', 'derivatives', 'https://api.bybit.com', 'https://bybit-exchange.github.io/docs/v5/market/kline', {
    ticker: op('/v5/market/tickers', { category: choice('linear',['spot','linear','inverse','option']), symbol }),
    klines: op('/v5/market/kline', { category: choice('linear',['spot','linear','inverse']), symbol, interval: choice('60',['1','5','15','60','240','D','W']), limit }),
    funding: op('/v5/market/funding/history', { category: choice('linear',['linear','inverse']), symbol, limit: num(100,1,200) }),
    'open-interest': op('/v5/market/open-interest', { category: choice('linear',['linear','inverse']), symbol, intervalTime: choice('1h',['5min','15min','30min','1h','4h','1d']), limit: num(50,1,200) }),
  }, { market: 'parameter:category' }),
  okx: provider('OKX', 'derivatives', 'https://www.okx.com', 'https://www.okx.com/docs-v5/en/', {
    ticker: op('/api/v5/market/ticker', { instId: text('BTC-USDT-SWAP') }),
    klines: op('/api/v5/market/candles', { instId:text('BTC-USDT-SWAP'), bar:choice('1H',['1m','5m','15m','1H','4H','1Dutc']), limit:num(100,1,300) }),
    funding: op('/api/v5/public/funding-rate', { instId:text('BTC-USDT-SWAP') }),
    'open-interest': op('/api/v5/public/open-interest', { instType:choice('SWAP',['SWAP','FUTURES','OPTION']), instId:text('BTC-USDT-SWAP') }),
  }, { market:'instrument-specific' }),
  deribit: provider('Deribit', 'options', 'https://www.deribit.com', 'https://docs.deribit.com/api-reference/market-data/public-get_order_book', {
    ticker: op('/api/v2/public/ticker', { instrument_name:text('BTC-PERPETUAL') }),
    book: op('/api/v2/public/get_order_book', { instrument_name:text('BTC-PERPETUAL'), depth:choice('5',['1','5','10','20']) }),
    instruments: op('/api/v2/public/get_instruments', { currency:choice('BTC',['BTC','ETH','USDC','USDT']), kind:choice('option',['option','future','spot']), expired:choice('false',['false']) }),
    summary: op('/api/v2/public/get_book_summary_by_currency', { currency:choice('BTC',['BTC','ETH']), kind:choice('option',['option','future']) }),
  }, { market:'instrument-specific', ttl:120 }),
  coinbase: provider('Coinbase', 'exchange', 'https://api.coinbase.com', 'https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/rest-api', {
    ticker: op('/api/v3/brokerage/market/products/{product}/ticker', { product:text('BTC-USD'), limit:num(10,1,100) }),
    product: op('/api/v3/brokerage/market/products/{product}', { product:text('BTC-USD') }),
    book: op('/api/v3/brokerage/market/product_book', { product_id:text('BTC-USD'), limit:num(20,1,100) }),
  }, { market:'spot' }),
  kraken: provider('Kraken', 'exchange', 'https://api.kraken.com', 'https://docs.kraken.com/api/docs/rest-api/get-ticker-information/', {
    ticker: op('/0/public/Ticker', { pair:text('XBTUSD') }),
    klines: op('/0/public/OHLC', { pair:text('XBTUSD'), interval:choice('60',['1','5','15','30','60','240','1440','10080']) }),
    depth: op('/0/public/Depth', { pair:text('XBTUSD'), count:num(20,1,100) }),
  }, { market:'spot' }),
  bitfinex: provider('Bitfinex', 'exchange', 'https://api-pub.bitfinex.com', 'https://docs.bitfinex.com/reference/rest-public-ticker', {
    ticker: op('/v2/ticker/{symbol}', { symbol:text('tBTCUSD') }),
    candles: op('/v2/candles/trade:{timeframe}:{symbol}/hist', { timeframe:choice('1h',['1m','5m','15m','1h','4h','1D']), symbol:text('tBTCUSD'), limit, sort:choice('-1',['-1','1']) }),
  }, { market:'spot' }),
  bitstamp: provider('Bitstamp', 'exchange', 'https://www.bitstamp.net', 'https://www.bitstamp.net/api/', {
    ticker: op('/api/v2/ticker/{pair}/', { pair:text('btcusd') }),
    klines: op('/api/v2/ohlc/{pair}/', { pair:text('btcusd'), step:choice('3600',['60','300','900','3600','14400','86400']), limit, exclude_current_candle:choice('true',['true','false']) }),
  }, { market:'spot' }),
  bitget: provider('Bitget', 'exchange', 'https://api.bitget.com', 'https://www.bitget.com/docs/catalog/market/market-data', {
    book: op('/api/v3/market/orderbook', { category:choice('USDT-FUTURES',['SPOT','USDT-FUTURES','COIN-FUTURES','USDC-FUTURES']), symbol, limit:choice('20',['5','20','50']) }),
  }, { market:'parameter:category' }),
  kucoin: provider('KuCoin', 'exchange', 'https://api.kucoin.com', 'https://www.kucoin.com/docs-new/api-3470167', {
    tickers: op('/api/v1/market/allTickers'),
  }, { market:'spot', ttl:120 }),
  hyperliquid: provider('Hyperliquid', 'derivatives', 'https://api.hyperliquid.xyz', 'https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint', {
    mids: op('/info', {}, { body:{type:'allMids'} }),
    context: op('/info', {}, { body:{type:'metaAndAssetCtxs'} }),
    book: op('/info', { coin:text('BTC') }, { body:{type:'l2Book'} }),
  }, { market:'perpetual', notes:free+' 上游 POST /info 仅查询公开数据，不开放 /exchange。' }),
  coingecko: provider('CoinGecko Demo', 'aggregate', 'https://api.coingecko.com', 'https://www.coingecko.com/en/api/pricing', {
    prices: op('/api/v3/simple/price', { ids:text('bitcoin','^[a-z0-9-]{1,64}$'), vs_currencies:choice('usd',['usd','eur','cny']), include_last_updated_at:choice('true',['true']) }),
    global: op('/api/v3/global'),
    markets: op('/api/v3/coins/markets', { vs_currency:choice('usd',['usd','eur']), per_page:num(50,1,100), page:num(1,1,10) }),
  }, { cost:'free-key', secret:'FREE_COINGECKO_API_KEY', auth:{header:'x-cg-demo-api-key'}, ttl:300, notes:'仅 Demo 免费计划，10,000 次/月，具体限速以账号为准；署名 CoinGecko，不接 Pro API。' }),
  coinpaprika: provider('CoinPaprika', 'aggregate', 'https://api.coinpaprika.com', 'https://docs.coinpaprika.com/api-reference/rest-api/introduction', {
    ticker: op('/v1/tickers/{coin}', { coin:text('btc-bitcoin') }),
    global: op('/v1/global'),
  }, { ttl:300, notes:'仅公开免费最新数据；历史与付费字段不接入，展示时署名 CoinPaprika。' }),
  coinmarketcap: provider('CoinMarketCap Basic', 'aggregate', 'https://pro-api.coinmarketcap.com', 'https://coinmarketcap.com/api/pricing/', {
    listings: op('/v1/cryptocurrency/listings/latest', { start:num(1,1,500), limit:num(20,1,100), convert:choice('USD',['USD']) }),
  }, { cost:'free-key', secret:'FREE_COINMARKETCAP_API_KEY', auth:{header:'X-CMC_PRO_API_KEY'}, ttl:600, notes:'主机虽名 pro-api，本通道仅使用 Basic 免费计划明确提供的最新列表；需自行申请 Basic key，不自动升级。' }),
  defillama: provider('DefiLlama', 'defi', 'https://api.llama.fi', 'https://github.com/DefiLlama/api-docs', {
    chains: op('/v2/chains'),
    tvl: op('/tvl/{protocol}', { protocol:text('aave') }),
    stablecoins: op('/stablecoins', { includePrices:choice('true',['true','false']) }, { base:'https://stablecoins.llama.fi' }),
  }, { ttl:600, notes:'仅无密钥免费端点，TVL/稳定币供应不等于资金净流入；不接付费解锁/融资/用户数接口。' }),
  dexscreener: provider('DEX Screener', 'defi', 'https://api.dexscreener.com', 'https://docs.dexscreener.com/api/reference', {
    search: op('/latest/dex/search', { q:text('WBTC','^[A-Za-z0-9 _.-]{1,60}$') }),
  }, { ttl:120, notes:'免费公开 DEX 搜索；单池价格/成交量不能当全市场值，遵守端点速率限制。' }),
  alternative: provider('Alternative.me', 'sentiment', 'https://api.alternative.me', 'https://alternative.me/crypto/fear-and-greed-index/#api', {
    fng: op('/fng/', { limit:num(30,1,365), format:choice('json',['json']) }),
  }, { ttl:3600, notes:'免费恐惧贪婪指数；展示必须署名 Alternative.me，不当作独立于价格/成交量的概率。' }),
  coinmetrics: provider('Coin Metrics Community', 'onchain', 'https://community-api.coinmetrics.io', 'https://docs.coinmetrics.io/api', {
    metrics: op('/v4/timeseries/asset-metrics', { assets:text('btc'), metrics:text('PriceUSD','^[A-Za-z0-9_,]{1,120}$'), frequency:choice('1d',['1d']), page_size:num(30,1,100), start_time:date('2026-01-01') }),
  }, { ttl:3600, notes:'Community 免费非商业研究范围；CC 条款与指标覆盖按官方文档，禁止默认为商用授权。' }),
  mempool: provider('mempool.space', 'onchain', 'https://mempool.space', 'https://mempool.space/docs/api/rest', {
    fees: op('/api/v1/fees/recommended'),
    difficulty: op('/api/v1/difficulty-adjustment'),
    mempool: op('/api/mempool'),
    hashrate: op('/api/v1/mining/hashrate/1m'),
  }, { ttl:120, notes:'免费公共节点，有限流且无 SLA；不申请 Enterprise，不广播交易。' }),
  blockstream: provider('Blockstream Esplora', 'onchain', 'https://blockstream.info', 'https://github.com/Blockstream/esplora/blob/master/API.md', {
    fees: op('/api/fee-estimates'),
    blocks: op('/api/blocks'),
    mempool: op('/api/mempool'),
  }, { ttl:120, notes:'公共 Bitcoin 链数据，仅查询区块/费率/内存池，不开放广播或账户操作。' }),
  blockchain: provider('Blockchain.com', 'onchain', 'https://api.blockchain.info', 'https://www.blockchain.com/explorer/api', {
    stats: op('/stats', { format:choice('json',['json']) }),
    hashrate: op('/charts/hash-rate', { timespan:choice('30days',['30days','90days','1year']), format:choice('json',['json']) }),
  }, { ttl:3600 }),
  fred: provider('FRED / ALFRED', 'macro', 'https://api.stlouisfed.org', 'https://fred.stlouisfed.org/docs/api/fred/', {
    series: op('/fred/series', { series_id:text('DFF'), file_type:choice('json',['json']) }),
    observations: op('/fred/series/observations', { series_id:text('DFF'), file_type:choice('json',['json']), sort_order:choice('desc',['desc','asc']), limit:num(100,1,1000), realtime_start:date(undefined), realtime_end:date(undefined) }),
  }, { cost:'free-key', secret:'FREE_FRED_API_KEY', auth:{query:'api_key'}, ttl:3600, notes:'免费申请 FRED key；ALFRED 通过 realtime_start/end 查询版本，单系列第三方使用限制仍适用。' }),
  bls: provider('美国劳工统计局 BLS', 'macro', 'https://api.bls.gov', 'https://www.bls.gov/developers/api_signature.htm', {
    series: op('/publicAPI/v1/timeseries/data/{series}', { series:text('CUUR0000SA0') }),
  }, { ttl:21600, notes:'无注册 v1 免费接口，额度与历史跨度小于注册版；本通道不自动申请账号。' }),
  treasury: provider('美国财政部 Fiscal Data', 'macro', 'https://api.fiscaldata.treasury.gov', 'https://fiscaldata.treasury.gov/api-documentation/', {
    debt: op('/services/api/fiscal_service/v2/accounting/od/debt_to_penny', { 'page[size]':num(30,1,100), sort:choice('-record_date',['-record_date']), format:choice('json',['json']) }),
    'operating-cash': op('/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance', { 'page[size]':num(30,1,100), sort:choice('-record_date',['-record_date']), format:choice('json',['json']) }),
  }, { ttl:21600, notes:'免费官方财政数据；观测日期与发布日期不同，TGA 口径需消费方按表字段解释。' }),
  ecb: provider('欧洲央行 ECB', 'macro', 'https://data-api.ecb.europa.eu', 'https://data.ecb.europa.eu/help/api/data-examples', {
    fx: op('/service/data/EXR/{series}', { series:text('D.USD.EUR.SP00.A'), lastNObservations:num(30,1,100), format:choice('csvdata',['csvdata']) }, { format:'text', content:'csv' }),
  }, { ttl:21600, notes:'官方参考汇率，CSV 保留原字段；不是可执行交易报价。' }),
  worldbank: provider('世界银行', 'macro', 'https://api.worldbank.org', 'https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures', {
    indicator: op('/v2/country/{country}/indicator/{indicator}', { country:text('USA','^[A-Za-z]{2,3}$'), indicator:text('NY.GDP.MKTP.CD'), format:choice('json',['json']), per_page:num(20,1,100), mrv:num(10,1,50) }),
  }, { ttl:86400, notes:'免费低频指标；保留单位、年份与缺值，不填成实时行情。' }),
  frankfurter: provider('Frankfurter', 'fx', 'https://api.frankfurter.dev', 'https://frankfurter.dev/', {
    rates: op('/v2/rates', { base:text('USD','^[A-Za-z]{3}$'), quotes:text('EUR','^[A-Za-z]{3}$'), date:date(undefined) }),
    currencies: op('/v2/currencies'),
  }, { ttl:21600, notes:'免费免 key 央行参考汇率，非盘中交易报价；底层来源条款分别适用。' }),
  bankofcanada: provider('加拿大央行', 'macro', 'https://www.bankofcanada.ca', 'https://www.bankofcanada.ca/valet-api-how-to/', {
    observations: op('/valet/observations/{series}/json', { series:text('FXUSDCAD'), recent:num(30,1,100) }),
  }, { ttl:21600, notes:'Valet 免费且无需注册；汇率/经济统计按来源发布时间更新。' }),
  nyfed: provider('纽约联储', 'rates', 'https://markets.newyorkfed.org', 'https://www.newyorkfed.org/markets/data-hub', {
    sofr: op('/api/rates/secured/sofr/last/{count}.json', { count:num(5,1,30) }),
    effr: op('/api/rates/unsecured/effr/last/{count}.json', { count:num(5,1,30) }),
  }, { ttl:21600, notes:'官方日频参考利率，SOFR 与 EFFR 口径分别保留。' }),
  eurostat: provider('Eurostat', 'macro', 'https://ec.europa.eu', 'https://ec.europa.eu/eurostat/web/user-guides/data-browser/api-data-access/api-introduction', {
    hicp: op('/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_manr', { geo:text('EA20'), coicop:choice('CP00',['CP00']), lastTimePeriod:num(12,1,36), lang:choice('EN',['EN']) }),
  }, { ttl:86400, notes:'欧盟官方免费统计接口，JSON-stat 保留维度/状态；指标修订和统计区变化需消费方解释。' }),
  cftc: provider('CFTC COT', 'positioning', 'https://publicreporting.cftc.gov', 'https://dev.socrata.com/foundry/publicreporting.cftc.gov/gpe5-46if', {
    tff: op('/resource/gpe5-46if.json', { cftc_contract_market_code:text('133741','^[0-9A-Za-z]{6}$'), '$limit':num(20,1,100), '$order':choice('report_date_as_yyyy_mm_dd DESC',['report_date_as_yyyy_mm_dd DESC']) }),
  }, { ttl:86400, notes:'官方免费 TFF Futures Only 数据；报告时点与公开发布时间不同，不是实时持仓。' }),
  alphavantage: provider('Alpha Vantage', 'equities', 'https://www.alphavantage.co', 'https://www.alphavantage.co/documentation/', {
    daily: op('/query', { function:choice('TIME_SERIES_DAILY',['TIME_SERIES_DAILY']), symbol:text('IBM'), outputsize:choice('compact',['compact']) }),
  }, { cost:'free-key', secret:'FREE_ALPHAVANTAGE_API_KEY', auth:{query:'apikey'}, ttl:21600, notes:'免费 25 次/日，仅 compact 日线；不接 premium、实时付费报价、付费新闻和 full 历史。' }),
  finnhub: provider('Finnhub', 'equities', 'https://finnhub.io', 'https://finnhub.io/docs/api', {
    quote: op('/api/v1/quote', { symbol:text('AAPL') }),
    news: op('/api/v1/news', { category:choice('general',['general','forex','crypto','merger']) }),
  }, { cost:'free-key', secret:'FREE_FINNHUB_API_KEY', auth:{header:'X-Finnhub-Token'}, ttl:300, notes:'仅个人免费计划的报价/普通新闻；市场权限以账号为准，不使用 premium 端点，不转载新闻全文。' }),
  twelvedata: provider('Twelve Data Basic', 'equities', 'https://api.twelvedata.com', 'https://twelvedata.com/pricing', {
    price: op('/price', { symbol:text('AAPL') }),
    daily: op('/time_series', { symbol:text('AAPL'), interval:choice('1day',['1day']), outputsize:num(30,1,100) }),
  }, { cost:'free-key', secret:'FREE_TWELVEDATA_API_KEY', auth:{query:'apikey'}, ttl:3600, notes:'个人 Basic 免费：8 credits/min、800/day；仅账号免费市场，不批量多代码、不启用试用 WS 或付费市场。' }),
  sec: provider('SEC EDGAR', 'filings', 'https://data.sec.gov', 'https://www.sec.gov/search-filings/edgar-application-programming-interfaces', {
    submissions: op('/submissions/CIK{cik}.json', { cik:text('0000320193','^[0-9]{10}$') }),
    concept: op('/api/xbrl/companyconcept/CIK{cik}/us-gaap/{tag}.json', { cik:text('0000320193','^[0-9]{10}$'), tag:text('Assets') }),
  }, { setting:'FINANCE_SEC_USER_AGENT', ttl:3600, notes:'免费披露 API，须配置真实应用名与联系邮箱的 User-Agent；不是 ETF 每日净申购 API。' }),
  eia: provider('美国能源信息署 EIA', 'commodities', 'https://api.eia.gov', 'https://www.eia.gov/opendata/documentation.php', {
    petroleum: op('/v2/petroleum/pri/spt/data/', { frequency:choice('daily',['daily']), 'data[0]':choice('value',['value']), 'facets[series][]':choice('RWTC',['RWTC','RBRTE']), 'sort[0][column]':choice('period',['period']), 'sort[0][direction]':choice('desc',['desc']), length:num(30,1,100) }),
  }, { cost:'free-key', secret:'FREE_EIA_API_KEY', auth:{query:'api_key'}, ttl:21600, notes:'官方免费 key；石油现货统计，不冒充实时期货行情。' }),
  gdelt: provider('GDELT', 'news', 'https://api.gdeltproject.org', 'https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/', {
    articles: op('/api/v2/doc/doc', { query:text('bitcoin','^[A-Za-z0-9 ()".:_-]{1,120}$'), mode:choice('artlist',['artlist']), format:choice('json',['json']), maxrecords:num(20,1,100), timespan:choice('24h',['24h','48h','7d']), sort:choice('datedesc',['datedesc']) }),
  }, { ttl:900, notes:'免费新闻发现接口，返回标题/链接元数据；不代表获准抓取、再分发或发送新闻全文给模型。' }),
  fed: provider('美联储公告订阅', 'news', 'https://www.federalreserve.gov', 'https://www.federalreserve.gov/feeds/feeds.htm', {
    releases: op('/feeds/press_all.xml', {}, { format:'text', content:'rss' }),
    policy: op('/feeds/press_monetary.xml', {}, { format:'text', content:'rss' }),
  }, { ttl:1800, notes:'官方免费 RSS 通道（不是 JSON API），保留原始标题、链接和发布时间。' }),
  polymarket: provider('Polymarket Gamma', 'prediction', 'https://gamma-api.polymarket.com', 'https://docs.polymarket.com/api-reference/markets/list-markets', {
    markets: op('/markets', { active:choice('true',['true']), closed:choice('false',['false']), limit:num(20,1,100), offset:num(0,0,1000) }),
    events: op('/events', { active:choice('true',['true']), closed:choice('false',['false']), limit:num(20,1,100), offset:num(0,0,1000) }),
  }, { ttl:300, notes:'仅免费公开市场元数据，不连接钱包、不下单；价格受流动性与结算规则影响，不直接当客观概率。' }),
};

export const FINANCE_EXCLUSIONS = [
  {name:'Glassnode / CryptoQuant / Nansen / Santiment / Laevitas / Amberdata / Kaiko / Tardis', reason:'未确认满足本任务的长期免费生产 API 范围；不把网页免费、样本下载或试用当免费接口。'},
  {name:'Bloomberg / LSEG / Trading Economics / CoinGlass', reason:'专业数据 API 通常涉及订阅或合同，本轮不接付费/试用通道。'},
  {name:'Yahoo Finance / 东方财富 / 新浪 / AkShare 抓取链', reason:'未核实稳定、官方且获准的免费 API 合同；保留已有实现，不新增非官方抓取通道。'},
  {name:'ETF 发行人 / Circle / Tether', reason:'官方披露网页不是已核实的统一免费 API，不伪造 ETF 净流入或储备接口。'},
  {name:'BIS / OECD / IMF / 中国官方统计', reason:'有免费公开数据，但本轮尚未核实可稳定调用的具体接口与当前数据集契约；保留候选，不能把网页或失效旧接口冒充已接通。'},
];
