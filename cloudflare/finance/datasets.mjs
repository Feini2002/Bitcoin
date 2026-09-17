// A finite acquisition list for the next workbench. It does not switch existing UI/LLM inputs.
const dataset = (provider, operation, parameters, role, kind, refreshSeconds, fields, limitations) =>
  ({provider,operation,parameters,role,kind,refreshSeconds,fields,limitations});
const perp = (operation, parameters, kind, seconds, fields, limitations) => dataset('binance-usdm',operation,parameters,'primary',kind,seconds,fields,limitations);
const macro = (series, units) => dataset('fred','observations',{series_id:series,limit:'1000'},'context','fred',43200,
  {value:units},'最新可得版本；观察日期不是发布日期。缺值保留 null，首次导入不提供当时已知的历史回放证据。');
export const FINANCE_DATASETS = {
  ...Object.fromEntries(['5m','15m','1h','4h','1d','1w'].map(interval => [`binance-perp-klines-${interval}`,
    perp('klines',{symbol:'BTCUSDT',interval,limit:'500'},'klines',interval==='5m'?300:900,
      {open:'USDT/BTC',high:'USDT/BTC',low:'USDT/BTC',close:'USDT/BTC',baseVolume:'BTC',quoteVolume:'USDT',takerBuyBase:'BTC',takerBuyQuote:'USDT',trades:'count'},
      'Binance USDⓈ-M BTCUSDT 独立序列；仅最新500根初始覆盖，缺口不填补，未收盘记录不能当确认信号。') ])),
  'binance-perp-premium':perp('premium',{symbol:'BTCUSDT'},'premium',300,
    {markPrice:'USDT/BTC',indexPrice:'USDT/BTC',lastFundingRate:'decimal',interestRate:'decimal',nextFundingTime:'ISO-8601'},
    '接口当前报告费率，不是新的资金费结算记录；不按分钟相加。'),
  'binance-perp-funding':perp('funding',{symbol:'BTCUSDT',limit:'500'},'funding',3600,
    {fundingRate:'decimal-per-settlement',markPrice:'USDT/BTC'},'每次已结算费率；间隔须结合 funding-info，不能默认恒为8小时。'),
  'binance-perp-oi':perp('open-interest',{symbol:'BTCUSDT'},'oi',300,{openInterest:'BTC'},'持仓数量不是多头量、资金净流入或美元市值。'),
  'binance-perp-oi-history':perp('oi-history',{symbol:'BTCUSDT',period:'1h',limit:'500'},'oi-history',3600,
    {sumOpenInterest:'BTC',sumOpenInterestValue:'USDT'},'官方仅最近一个月；初次最多500小时；不与其他交易所拼接。'),
  'binance-perp-taker':perp('taker-volume',{symbol:'BTCUSDT',period:'1h',limit:'500'},'taker',3600,
    {buyVol:'BTC',sellVol:'BTC',buySellRatio:'ratio'},'主动成交量统计；不是完整逐笔CVD或所有挂单。'),
  'binance-perp-accounts':perp('account-ratio',{symbol:'BTCUSDT',period:'1h',limit:'500'},'ratio',3600,
    {longAccount:'fraction',shortAccount:'fraction',longShortRatio:'ratio'},'净多/净空账户比例，不是仓位金额或全市场资金方向。'),
  'binance-perp-top-positions':perp('top-position-ratio',{symbol:'BTCUSDT',period:'1h',limit:'500'},'ratio',3600,
    {longAccount:'fraction',shortAccount:'fraction',longShortRatio:'ratio'},'来源定义的头部交易者持仓样本；不可解释为所有机构真实持仓。'),
  'binance-perp-basis':perp('basis',{pair:'BTCUSDT',contractType:'PERPETUAL',period:'1h',limit:'500'},'basis',3600,
    {basis:'USDT/BTC',basisRate:'decimal',annualizedBasisRate:'decimal-per-year',indexPrice:'USDT/BTC',futuresPrice:'USDT/BTC'},
    '绝对基差、基差率、年化基差率独立；空年化字段为null，不用其他单位兜底。'),
  'binance-perp-book':perp('depth',{symbol:'BTCUSDT',limit:'20'},'book',300,
    {bids:'[USDT/BTC,BTC][]',asks:'[USDT/BTC,BTC][]'},'单时点20档快照，不能称连续盘口或真实未来清算池；不含不可见订单。'),
  'binance-perp-instrument':perp('instruments',{},'instrument',86400,{},'保存BTCUSDT交易规则原字段；禁止按pricePrecision猜最小tick。'),
  'binance-perp-funding-info':perp('funding-info',{},'funding-info',86400,{},'只报告调整记录；BTCUSDT不在列表时标记未报告调整，不凭空补值。'),
  'binance-spot-klines-1h':dataset('binance-spot','klines',{symbol:'BTCUSDT',interval:'1h',limit:'500'},'context','klines',3600,
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
  'nyfed-sofr':dataset('nyfed','sofr',{count:'30'},'context','sofr',43200,{percentRate:'percent-per-year'},'工作日参考利率；周末沿用旧值不算新报价。'),
  'stablecoin-supply':dataset('defillama','stablecoins',{},'context','stablecoins',21600,{circulating:'USD-pegged-supply',price:'USD'},'USDT/USDC供应和价格分开，不把供应变化直接当BTC买盘或资金净流入。'),
  'crypto-breadth':dataset('coingecko','global',{},'context','global',3600,{marketCap:'USD',volume24h:'USD',btcDominance:'percent'},'CoinGecko聚合口径，非Binance成交量；需来源署名。'),
  'btc-fees':dataset('mempool','fees',{},'context','fees',3600,{fastestFee:'sat/vB',halfHourFee:'sat/vB',hourFee:'sat/vB',minimumFee:'sat/vB'},'网络拥堵和费用背景，不能据此推断交易所净流入。'),
  'deribit-btc-options':dataset('deribit','summary',{currency:'BTC',kind:'option'},'context','options',3600,
    {mark_iv:'percent',open_interest:'native-contract-units'},'保存原生期权摘要；mark IV不是可成交报价，不伪造25delta偏斜、庄家GEX或方向概率。'),
};

export function datasetRequest(id, origin='https://finance.internal') {
  const definition=FINANCE_DATASETS[id];
  if(!definition)throw new Error('unknown_dataset');
  const url=new URL(`/api/finance/${definition.provider}/${definition.operation}`,origin);
  for(const [key,value] of Object.entries(definition.parameters))url.searchParams.set(key,value);
  return new Request(url);
}

export function datasetCatalog() {
  return {version:'2026-09-16.1',primaryVenue:'Binance',primaryInstrument:'BTCUSDT',primaryMarket:'USDⓈ-M perpetual',
    automaticCollection:false,frontendConnected:false,
    datasets:Object.entries(FINANCE_DATASETS).map(([id,d])=>({id,...d,
      readPath:`/api/finance/datasets/${id}`,refreshPath:`/api/finance/datasets/${id}/refresh`,refreshMethod:'POST'})),
  };
}

const number = value => value===null || value===undefined || typeof value==='boolean' || String(value).trim()==='' || value==='.' ? null : Number.isFinite(Number(value))?Number(value):null;
const at = value => Number.isFinite(Number(value)) && Number(value)>0 ? new Date(Number(value)).toISOString() : null;
const numeric = (row,keys) => Object.fromEntries(keys.map(key=>[key,number(row[key])]));

export function normalizeDataset(id,envelope) {
  const d=FINANCE_DATASETS[id];
  if(!d || envelope.provider!==d.provider || envelope.operation!==d.operation)throw new Error('dataset_source_mismatch');
  for(const [key,value] of Object.entries(d.parameters))if(String(envelope.parameters[key])!==String(value))throw new Error('dataset_parameter_mismatch');
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
          finality:Number(r[6])<Date.parse(receivedAt)?'time_elapsed_only':'forming'});
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
    case 'ratio': for(const r of list())add(r.timestamp,at(r.timestamp),numeric(r,['longAccount','shortAccount','longShortRatio'])); break;
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
        add(r.date,r.date,{value:number(r.value)},'day',{realtimeStart:r.realtime_start,realtimeEnd:r.realtime_end});
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
      for(const r of data.result) if(/^BTC-/.test(r.instrument_name))add(r.instrument_name+'@'+receivedAt,at(r.creation_timestamp),r); break;
    default:throw new Error('dataset_unknown_adapter');
  }
  if(!rows.length)throw new Error('dataset_empty');
  if(['klines','premium','funding','oi','oi-history','taker','ratio','basis','fred','sofr','global'].includes(d.kind) && rows.some(r=>!r.observedAt))throw new Error('dataset_missing_source_time');
  if(rows.some(r=>r.key==='undefined'))throw new Error('dataset_missing_observation_key');
  if(['premium','funding','oi','oi-history','taker','ratio','basis','global','sofr','fees'].includes(d.kind) && rows.some(r=>!Object.values(r.values).some(v=>typeof v==='number'&&Number.isFinite(v))))throw new Error('dataset_missing_values');
  return {id,definition:d,receivedAt,sourceHost:envelope.source.host,rows};
}
