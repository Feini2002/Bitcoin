// A finite acquisition list for the next workbench. It does not switch existing UI/LLM inputs.
const dataset = (provider, operation, parameters, role, kind, refreshSeconds, fields, limitations) =>
  ({provider,operation,parameters,role,kind,refreshSeconds,fields,limitations});
const perp = (operation, parameters, kind, seconds, fields, limitations) => dataset('binance-usdm',operation,parameters,'primary',kind,seconds,fields,limitations);
const macro = (series, units) => dataset('fred','observations',{series_id:series,limit:'1000'},'context','fred',3600,
  {value:units},'最新可得版本；观察日期不是发布日期。缺值保留 null，首次导入不提供当时已知的历史回放证据。');
export const FINANCE_DATASETS = {
  ...Object.fromEntries(['5m','15m','1h','4h','1d','3d','1w'].map(interval => [`binance-perp-klines-${interval}`,
    perp('klines',{symbol:'BTCUSDT',interval,limit:'500'},'klines',15,
      {open:'USDT/BTC',high:'USDT/BTC',low:'USDT/BTC',close:'USDT/BTC',baseVolume:'BTC',quoteVolume:'USDT',takerBuyBase:'BTC',takerBuyQuote:'USDT',trades:'count'},
      'Binance USDⓈ-M BTCUSDT 独立序列；仅最新500根初始覆盖，缺口不填补，未收盘记录不能当确认信号。') ])),
  'binance-perp-premium':perp('premium',{symbol:'BTCUSDT'},'premium',5,
    {markPrice:'USDT/BTC',indexPrice:'USDT/BTC',lastFundingRate:'decimal',interestRate:'decimal',nextFundingTime:'ISO-8601'},
    '接口当前报告费率，不是新的资金费结算记录；不按分钟相加。'),
  'binance-perp-funding':perp('funding',{symbol:'BTCUSDT',limit:'500'},'funding',300,
    {fundingRate:'decimal-per-settlement',markPrice:'USDT/BTC'},'每次已结算费率；间隔须结合 funding-info，不能默认恒为8小时。'),
  'binance-perp-oi':perp('open-interest',{symbol:'BTCUSDT'},'oi',5,{openInterest:'BTC'},'持仓数量不是多头量、资金净流入或美元市值。'),
  'binance-perp-oi-history':perp('oi-history',{symbol:'BTCUSDT',period:'1h',limit:'500'},'oi-history',1800,
    {sumOpenInterest:'BTC',sumOpenInterestValue:'USDT'},'官方仅最近一个月；初次最多500小时；不与其他交易所拼接。'),
  'binance-perp-taker':perp('taker-volume',{symbol:'BTCUSDT',period:'1h',limit:'500'},'taker',1800,
    {buyVol:'BTC',sellVol:'BTC',buySellRatio:'ratio'},'主动成交量统计；不是完整逐笔CVD或所有挂单。'),
  'binance-perp-accounts':perp('account-ratio',{symbol:'BTCUSDT',period:'1h',limit:'500'},'ratio',1800,
    {longAccount:'fraction',shortAccount:'fraction',longShortRatio:'ratio'},'净多/净空账户比例，不是仓位金额或全市场资金方向。'),
  'binance-perp-top-positions':perp('top-position-ratio',{symbol:'BTCUSDT',period:'1h',limit:'500'},'ratio',1800,
    {longPosition:'fraction',shortPosition:'fraction',longShortRatio:'ratio'},'来源定义的头部交易者持仓样本；官方字段是 longPosition/shortPosition，不是账户比。'),
  'binance-perp-basis':perp('basis',{pair:'BTCUSDT',contractType:'PERPETUAL',period:'1h',limit:'500'},'basis',300,
    {basis:'USDT/BTC',basisRate:'decimal',annualizedBasisRate:'decimal-per-year',indexPrice:'USDT/BTC',futuresPrice:'USDT/BTC'},
    '绝对基差、基差率、年化基差率独立；空年化字段为null，不用其他单位兜底。'),
  'binance-perp-book':perp('depth',{symbol:'BTCUSDT',limit:'20'},'book',5,
    {bids:'[USDT/BTC,BTC][]',asks:'[USDT/BTC,BTC][]'},'单时点20档快照，不能称连续盘口或真实未来清算池；不含不可见订单。'),
  'binance-perp-instrument':perp('instruments',{},'instrument',86400,{},'保存BTCUSDT交易规则原字段；禁止按pricePrecision猜最小tick。'),
  'binance-perp-funding-info':perp('funding-info',{},'funding-info',86400,{},'只报告调整记录；BTCUSDT不在列表时标记未报告调整，不凭空补值。'),
  'binance-spot-klines-1h':dataset('binance-spot','klines',{symbol:'BTCUSDT',interval:'1h',limit:'500'},'context','klines',60,
    {open:'USDT/BTC',high:'USDT/BTC',low:'USDT/BTC',close:'USDT/BTC',baseVolume:'BTC',quoteVolume:'USDT',takerBuyBase:'BTC',takerBuyQuote:'USDT',trades:'count'},
    'Binance现货独立背景；不能替代永续主图最后价。'),
  'fred-dgs2':macro('DGS2','percent-per-year'),
  'fred-dgs10':macro('DGS10','percent-per-year'),
  'fred-real10y':macro('DFII10','percent-per-year'),
  'fred-breakeven10y':macro('T10YIE','percent-per-year'),
  'fred-dollar':macro('DTWEXBGS','index-Jan2006=100'),
  'fred-cpi':macro('CPIAUCSL','index-1982-84=100-SA'),
  'fred-fed-assets':macro('WALCL','million-USD'),
  'fred-tga':macro('WTREGEN','million-USD'),
  'fred-rrp':macro('RRPONTSYD','billion-USD'),
  'nyfed-sofr':dataset('nyfed','sofr',{count:'30'},'context','sofr',3600,{percentRate:'percent-per-year'},'工作日参考利率；周末沿用旧值不算新报价。'),
  'stablecoin-supply':dataset('defillama','stablecoins',{},'context','stablecoins',3600,{circulating:'USD-pegged-supply',price:'USD'},'USDT/USDC供应和价格分开，不把供应变化直接当BTC买盘或资金净流入。'),
  'crypto-breadth':dataset('coingecko','global',{},'context','global',300,{marketCap:'USD',volume24h:'USD',btcDominance:'percent'},'CoinGecko聚合口径，非Binance成交量；需来源署名。'),
  'btc-fees':dataset('mempool','fees',{},'context','fees',60,{fastestFee:'sat/vB',halfHourFee:'sat/vB',hourFee:'sat/vB',minimumFee:'sat/vB'},'网络拥堵和费用背景，不能据此推断交易所净流入。'),
  'deribit-btc-options':dataset('deribit','summary',{currency:'BTC',kind:'option'},'context','options',600,
    {mark_iv:'percent',open_interest:'BTC',mark_price:'BTC'},'币本位 BTC 期权摘要；元数据独立对账。mark IV不是可成交报价，摘要不含完整 Greeks，不推庄家GEX或方向。'),
  'deribit-usdc-btc-options':dataset('deribit','summary',{currency:'USDC',kind:'option'},'context','options',600,
    {mark_iv:'percent',open_interest:'BTC',mark_price:'USDC'},'USDC 结算中的 BTC 标的期权，和币本位分组。不能把币种、报价、合约数量混算。'),
  'deribit-btc-option-instruments':dataset('deribit','instruments',{currency:'BTC',kind:'option',expired:'false'},'context','option-instruments',3600,
    {strike:'USD/BTC',contract_size:'BTC',creation_timestamp:'millisecond',expiration_timestamp:'millisecond'},'当前有效币本位 BTC 期权元数据快照；首次接收前的生命周期未知，不是历史完整链。'),
  'deribit-usdc-btc-option-instruments':dataset('deribit','instruments',{currency:'USDC',kind:'option',expired:'false'},'context','option-instruments',3600,
    {strike:'USD/BTC',contract_size:'BTC',creation_timestamp:'millisecond',expiration_timestamp:'millisecond'},'当前 USDC 结算 BTC 标的期权元数据；仅保留 BTC 标的，和币本位独立。'),
  'deribit-btc-perp-ticker':dataset('deribit','ticker',{instrument_name:'BTC-PERPETUAL'},'comparison','deribit-ticker',60,
    {open_interest:'USD',mark_price:'USD/BTC',index_price:'USD/BTC',current_funding:'decimal',funding_8h:'decimal'},'Deribit BTC 反向永续独立对照；OI 单位 USD，资金费连续计付，不能冒充币安离散结算事件。'),
  'deribit-btc-perp-funding':dataset('deribit','funding-history',{instrument_name:'BTC-PERPETUAL'},'comparison','deribit-funding',3600,
    {interest_1h:'decimal',interest_8h:'decimal',index_price:'USD/BTC'},'滚动24小时小时资金费历史；1h/8h 平均费率和交易所离散结算记录不同，不直接逐点相加。'),
};

export function datasetSupportsIncremental(id) {
  const d = FINANCE_DATASETS[id];
  return !!d?.provider.startsWith('binance-') && ['klines','funding','oi-history','taker','ratio','basis'].includes(d.kind);
}

function validateDatasetParameters(id, parameters) {
  const d = FINANCE_DATASETS[id], incremental = datasetSupportsIncremental(id);
  if (!parameters) throw new Error('dataset_parameter_mismatch');
  for (const [key,value] of Object.entries(d.parameters)) {
    if (incremental && key === 'limit') {
      if (!/^\d+$/.test(String(parameters.limit)) || Number(parameters.limit)<1 || Number(parameters.limit)>500) throw new Error('dataset_parameter_mismatch');
    } else if (String(parameters[key]) !== String(value)) throw new Error('dataset_parameter_mismatch');
  }
  for (const key of ['startTime','endTime']) if (Object.hasOwn(parameters,key)) {
    if (!incremental || !/^\d+$/.test(String(parameters[key])) || !Number.isSafeInteger(Number(parameters[key]))
      || Number(parameters[key])>8640000000000000) throw new Error('dataset_parameter_mismatch');
  }
  if (parameters.startTime !== undefined && parameters.endTime !== undefined && Number(parameters.startTime)>Number(parameters.endTime)) throw new Error('dataset_parameter_mismatch');
  if (d.kind==='deribit-funding' && (!['start_timestamp','end_timestamp'].every(key=>/^\d+$/.test(String(parameters[key]))&&Number.isSafeInteger(Number(parameters[key])))
    || Number(parameters.end_timestamp)<=Number(parameters.start_timestamp) || Number(parameters.end_timestamp)-Number(parameters.start_timestamp)>48*3600000)) throw new Error('dataset_parameter_mismatch');
}

export function datasetRequest(id, origin='https://finance.internal', window={}) {
  const definition=FINANCE_DATASETS[id];
  if(!definition)throw new Error('unknown_dataset');
  if (Object.keys(window).some(key => !['limit','startTime','endTime'].includes(key))) throw new Error('dataset_parameter_mismatch');
  const parameters={...definition.parameters,...window};
  if (definition.kind==='deribit-funding') { parameters.end_timestamp=String(Date.now()); parameters.start_timestamp=String(Number(parameters.end_timestamp)-24*3600000); }
  validateDatasetParameters(id,parameters);
  const url=new URL(`/api/finance/${definition.provider}/${definition.operation}`,origin);
  for(const [key,value] of Object.entries(parameters))url.searchParams.set(key,value);
  return new Request(url);
}

export function datasetCatalog() {
  return {version:'2026-09-30.2',primaryVenue:'Binance',primaryInstrument:'BTCUSDT',primaryMarket:'USDⓈ-M perpetual',
    automaticCollection:true,frontendConnected:true,
    datasets:Object.entries(FINANCE_DATASETS).map(([id,d])=>({id,...d,
      readPath:`/api/finance/datasets/${id}`,refreshPath:`/api/finance/datasets/${id}/refresh`,refreshMethod:'POST'})),
  };
}

const number = value => value===null || value===undefined || typeof value==='boolean' || String(value).trim()==='' || value==='.' ? null : Number.isFinite(Number(value))?Number(value):null;
const at = value => Number.isFinite(Number(value)) && Number(value)>0 ? new Date(Number(value)).toISOString() : null;
const numeric = (row,keys) => Object.fromEntries(keys.map(key=>[key,number(row[key])]));

export function deribitOptionGroup(row, currency, {metadata=false} = {}) {
  if (!['BTC','USDC'].includes(currency)) throw new Error('dataset_option_currency_unsupported');
  if (!row || typeof row !== 'object') throw new Error('dataset_invalid_option_instrument');
  const name=String(row.instrument_name || '');
  const btcCandidate=/^BTC(?:-|_)/.test(name) || row.base_currency==='BTC' || row.underlyingCurrency==='BTC';
  if (!btcCandidate) return false; // USDC responses legitimately contain other underlyings.
  const match=/^(BTC|BTC_USDC)-(\d{1,2}[A-Z]{3}\d{2})-(\d+(?:\.\d+)?)-([CP])$/.exec(name);
  if (!match || !(Number(match[3])>0)) throw new Error('dataset_invalid_option_instrument');
  const settlement=match[1]==='BTC'?'BTC':'USDC';
  if (settlement!==currency) throw new Error('dataset_instrument_group_mismatch');
  for (const key of ['settlement_currency','settlementCurrency'])
    if (row[key] != null && row[key]!==settlement) throw new Error('dataset_option_settlement_mismatch');
  for (const key of ['base_currency','underlyingCurrency'])
    if (row[key] != null && row[key]!=='BTC') throw new Error('dataset_option_underlying_mismatch');
  if (row.kind != null && row.kind!=='option') throw new Error('dataset_option_kind_mismatch');
  if (metadata && (row.base_currency!=='BTC' || row.kind!=='option' || row.settlement_currency!==settlement))
    throw new Error('dataset_option_metadata_incomplete');
  if (row.option_type != null && row.option_type!==(match[4]==='C'?'call':'put')) throw new Error('dataset_option_type_mismatch');
  if (metadata && (row.expiration_timestamp==null || !Number.isFinite(Number(row.expiration_timestamp))
    || row.strike==null || Number(row.strike)!==Number(match[3]))) throw new Error('dataset_invalid_option_instrument');
  return true;
}

export function normalizeDataset(id,envelope) {
  const d=FINANCE_DATASETS[id];
  if(!d || envelope.provider!==d.provider || envelope.operation!==d.operation)throw new Error('dataset_source_mismatch');
  validateDatasetParameters(id,envelope.parameters);
  const data=envelope.data,receivedAt=envelope.receivedAt;
  if(!Number.isFinite(Date.parse(receivedAt)))throw new Error('dataset_invalid_receipt');
  if(d.provider.startsWith('binance-') && data?.symbol && data.symbol!=='BTCUSDT')throw new Error('dataset_instrument_mismatch');
  if(d.provider.startsWith('binance-') && Array.isArray(data) && data.some(r=>r?.symbol&&r.symbol!=='BTCUSDT') && d.kind!=='funding-info')throw new Error('dataset_instrument_mismatch');
  const rows=[];
  const add=(key,observedAt,values,timePrecision='millisecond',sourceRevision=null) => rows.push({key:String(key),observedAt,
    timePrecision:observedAt?timePrecision:'unknown',values,sourceRevision});
  const list=()=>{if(!Array.isArray(data))throw new Error('dataset_invalid_shape');return data;};
  switch(d.kind) {
    case 'klines':
      for(const r of list()) {
        if(!Array.isArray(r)||r.length<11||!at(r[0])||![1,2,3,4,5].every(i=>number(r[i])!==null))throw new Error('dataset_invalid_kline');
        add(r[0],at(r[0]),{open:number(r[1]),high:number(r[2]),low:number(r[3]),close:number(r[4]),baseVolume:number(r[5]),
          closeTime:at(r[6]),quoteVolume:number(r[7]),trades:number(r[8]),takerBuyBase:number(r[9]),takerBuyQuote:number(r[10]),
          windowEnded:Number(r[6])<Date.parse(receivedAt),
          closed:Number.isFinite(Date.parse(envelope.requestedAt))?Number(r[6])<Date.parse(envelope.requestedAt):null,
          closureBasis:'request-after-scheduled-close; no exchange confirmation flag',
          finality:Number(r[6])<Date.parse(receivedAt)?'time_elapsed_only':'forming'}, 'millisecond',
          envelope.source?.transportHost ? { transportHost: envelope.source.transportHost, providerHost: envelope.source.host } : null);
        const last=rows[rows.length-1].values;
        if(!(last.high>=last.open && last.high>=last.close && last.high>=last.low && last.low<=last.open && last.low<=last.close))throw new Error('dataset_invalid_ohlc');
        if(last.baseVolume<0 || last.quoteVolume<0 || last.takerBuyBase<0)throw new Error('dataset_negative_volume');
        if(last.takerBuyBase>last.baseVolume)throw new Error('dataset_taker_exceeds_total');
      } break;
    case 'premium': add(data.time,at(data.time),{...numeric(data,['markPrice','indexPrice','lastFundingRate','interestRate']),nextFundingTime:at(data.nextFundingTime)}); break;
    case 'funding': for(const r of list()) {if(r.symbol && r.symbol!=='BTCUSDT')throw new Error('dataset_instrument_mismatch'); add(r.fundingTime,at(r.fundingTime),numeric(r,['fundingRate','markPrice']));} break;
    case 'oi': add(data.time,at(data.time),numeric(data,['openInterest'])); break;
    case 'oi-history': for(const r of list())add(r.timestamp,at(r.timestamp),numeric(r,['sumOpenInterest','sumOpenInterestValue'])); break;
    case 'taker': for(const r of list())add(r.timestamp,at(r.timestamp),numeric(r,['buyVol','sellVol','buySellRatio'])); break;
    case 'ratio': {
      const position = !!(d.fields && d.fields.longPosition);
      for (const r of list()) {
        const values = position
          ? {
              longPosition: number(r.longPosition != null ? r.longPosition : r.longAccount),
              shortPosition: number(r.shortPosition != null ? r.shortPosition : r.shortAccount),
              longShortRatio: number(r.longShortRatio),
            }
          : numeric(r, ['longAccount', 'shortAccount', 'longShortRatio']);
        add(r.timestamp, at(r.timestamp), values);
      }
    } break;
    case 'basis': for(const r of list())add(r.timestamp,at(r.timestamp),numeric(r,['basis','basisRate','annualizedBasisRate','indexPrice','futuresPrice'])); break;
    case 'book': if(!Array.isArray(data.bids)||!Array.isArray(data.asks))throw new Error('dataset_invalid_book');
      if(data.bids[0] && data.asks[0] && Number(data.asks[0][0])<Number(data.bids[0][0]))throw new Error('dataset_crossed_book');
      add(data.T||data.E||receivedAt,at(data.T||data.E),{lastUpdateId:data.lastUpdateId,bids:data.bids,asks:data.asks}); break;
    case 'instrument': {
      const instrument=data.symbols?.find(row=>row.symbol==='BTCUSDT');
      if(!instrument)throw new Error('dataset_missing_instrument');
      add(receivedAt,null,instrument); break;
    }
    case 'funding-info': add(receivedAt,null,{adjustmentReported:list().some(row=>row.symbol==='BTCUSDT'),record:data.find(row=>row.symbol==='BTCUSDT')||null}); break;
    case 'fred': if(!Array.isArray(data.observations))throw new Error('dataset_invalid_fred');
      for(const r of data.observations) {
        if(!/^\d{4}-\d{2}-\d{2}$/.test(r.date))throw new Error('dataset_invalid_date');
        const requestDay=String(envelope.requestedAt || receivedAt).slice(0,10);
        const rootWindow=data.realtime_start && data.realtime_end ? {start:data.realtime_start,end:data.realtime_end}:null;
        const queryWindow=(!envelope.parameters.output_type || String(envelope.parameters.output_type)==='1')
          && !envelope.parameters.vintage_dates && !envelope.parameters.realtime_start && !envelope.parameters.realtime_end
          && (rootWindow ? r.realtime_start===rootWindow.start && r.realtime_end===rootWindow.end
            : r.realtime_start===requestDay && r.realtime_end===requestDay);
        add(r.date,r.date,{value:number(r.value)},'day',{realtimeStart:r.realtime_start,realtimeEnd:r.realtime_end,queryWindow});
      } break;
    case 'sofr': if(!Array.isArray(data.refRates))throw new Error('dataset_invalid_sofr');
      for(const r of data.refRates)add(r.effectiveDate,r.effectiveDate,{percentRate:number(r.percentRate)},'day'); break;
    case 'stablecoins': {
      const coins=data.peggedAssets?.filter(r=>['USDT','USDC'].includes(r.symbol));
      if(coins?.length!==2)throw new Error('dataset_missing_stablecoins');
      add(receivedAt,null,{coins:coins.map(r=>({id:r.id,symbol:r.symbol,circulating:r.circulating?.peggedUSD??null,
        circulatingPrevDay:r.circulatingPrevDay?.peggedUSD??null,circulatingPrevWeek:r.circulatingPrevWeek?.peggedUSD??null,price:number(r.price),chains:r.chains}))}); break;
    }
    case 'global': if(!data.data)throw new Error('dataset_invalid_global');
      add(data.data.updated_at,at(Number(data.data.updated_at)*1000),{marketCap:number(data.data.total_market_cap?.usd),volume24h:number(data.data.total_volume?.usd),btcDominance:number(data.data.market_cap_percentage?.btc)}); break;
    case 'fees': add(receivedAt,null,numeric(data,['fastestFee','halfHourFee','hourFee','minimumFee'])); break;
    case 'options': if(!Array.isArray(data.result))throw new Error('dataset_invalid_options');
      for(const r of data.result) if(deribitOptionGroup(r,d.parameters.currency))add(r.instrument_name+'@'+receivedAt,at(r.creation_timestamp),
        {...r,underlyingCurrency:'BTC',settlementCurrency:d.parameters.currency,openInterestUnit:'BTC',sideBasis:'venue-reported-open-contracts'},'millisecond',
        {provider:'deribit',operation:'summary',settlementCurrency:d.parameters.currency,parser:'deribit-options.v3'}); break;
    case 'option-instruments': if(!Array.isArray(data.result))throw new Error('dataset_invalid_option_instruments');
      for(const r of data.result) if(deribitOptionGroup(r,d.parameters.currency,{metadata:true})) {
        add(r.instrument_name+'@'+receivedAt,null,{...r,underlyingCurrency:'BTC',settlementCurrency:r.settlement_currency},'unknown',
          {provider:'deribit',operation:'instruments',scope:'current active BTC options',parser:'deribit-instruments.v2'});
      } break;
    case 'deribit-ticker': {
      const r=data.result;
      if(!r || r.instrument_name!==d.parameters.instrument_name)throw new Error('dataset_instrument_mismatch');
      if(number(r.open_interest)===null || number(r.open_interest)<0 || !at(r.timestamp))throw new Error('dataset_invalid_deribit_ticker');
      add(r.timestamp,at(r.timestamp),{...r,...numeric(r,['open_interest','mark_price','index_price','last_price','current_funding','funding_8h']),
        instrumentId:'DERIBIT:BTC-PERPETUAL',marketType:'inverse-perpetual',settlementCurrency:'BTC',quoteCurrency:'USD',underlyingCurrency:'BTC',
        openInterestUnit:'USD',sideBasis:'venue-reported-open-contracts',fundingMethod:'continuous-payment'},'millisecond',
        {provider:'deribit',operation:'ticker',parser:'deribit-ticker.v1'});
    } break;
    case 'deribit-funding': if(!Array.isArray(data.result))throw new Error('dataset_invalid_deribit_funding');
      for(const r of data.result) {
        if(!at(r.timestamp)||number(r.interest_1h)===null||number(r.interest_8h)===null)throw new Error('dataset_invalid_deribit_funding');
        if(Number(r.timestamp)<Number(envelope.parameters.start_timestamp)||Number(r.timestamp)>Number(envelope.parameters.end_timestamp))throw new Error('dataset_window_mismatch');
        add(r.timestamp,at(r.timestamp),{...numeric(r,['index_price','prev_index_price','interest_1h','interest_8h']),
          instrumentId:'DERIBIT:BTC-PERPETUAL',fundingMethod:'continuous-payment; hourly history',period:'1h'},'millisecond',
          {provider:'deribit',operation:'funding-history',parser:'deribit-funding.v1'});
      } break;
    default:throw new Error('dataset_unknown_adapter');
  }
  if(!rows.length)throw new Error('dataset_empty');
  if (datasetSupportsIncremental(id) && rows.some(row =>
    (envelope.parameters.startTime !== undefined && Date.parse(row.observedAt)<Number(envelope.parameters.startTime))
    || (envelope.parameters.endTime !== undefined && Date.parse(row.observedAt)>Number(envelope.parameters.endTime)))) throw new Error('dataset_window_mismatch');
  if(['klines','premium','funding','oi','oi-history','taker','ratio','basis','fred','sofr','global'].includes(d.kind) && rows.some(r=>!r.observedAt))throw new Error('dataset_missing_source_time');
  if(rows.some(r=>r.key==='undefined'))throw new Error('dataset_missing_observation_key');
  if(['premium','funding','oi','oi-history','taker','ratio','basis','global','sofr','fees'].includes(d.kind) && rows.some(r=>!Object.values(r.values).some(v=>typeof v==='number'&&Number.isFinite(v))))throw new Error('dataset_missing_values');
  return {id,definition:d,receivedAt,sourceHost:envelope.source.host,rows};
}
