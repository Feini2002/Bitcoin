import crypto from 'node:crypto';
import {FINANCE_DATASETS} from '../../cloudflare/finance/datasets.mjs';
import {ROLES,roleDatasets} from '../../js/agent-team/contract.mjs';
import '../../js/content-identity.js';
import '../../js/orderflow/footprint-engine.js';
import {klineOpenAt} from '../../cloudflare/kline-recovery.mjs';
import {sourceVerified} from '../../cloudflare/finance/desk.mjs';
import {analysisStatistics} from './analysis-statistics.mjs';
export const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const steps={'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400,'3d':259200,'1w':604800};
export function publisherExcerpt(raw){
  const html=raw.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ');
  const plain=s=>s.replace(/<\/(?:p|h[1-6]|li|div)>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&#(?:x([a-f0-9]+)|(\d+));/gi,(_,hex,decimal)=>{const n=parseInt(hex||decimal,hex?16:10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):' ';}).replace(/&(amp|quot|apos|lt|gt|nbsp);/gi,(_,key)=>({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[key.toLowerCase()])).replace(/[ \t\r]+/g,' ').replace(/\s*\n\s*/g,'\n').trim();
  // Select only the publisher's observed body container. Unknown layouts remain an explicit page excerpt.
  const blocks=[];let lastEnd=-1;
  for(const opening of html.matchAll(/<div\b[^>]*>/gi)){
    if(opening.index<lastEnd)continue;
    const className=/\bclass\s*=\s*["']([^"']*)["']/i.exec(opening[0])?.[1]||'';
    if(!className.split(/\s+/).includes('document-body'))continue;
    const start=opening.index+opening[0].length,tags=/<\/?div\b[^>]*>/gi;tags.lastIndex=start;let depth=1,end=null;
    for(let token;(token=tags.exec(html));){depth+=/^<\//.test(token[0])?-1:1;if(!depth){end=token.index;break;}}
    if(end===null)continue;
    const body=plain(html.slice(start,end));if(body)blocks.push(body);lastEnd=end;
  }
  const body=[...new Set(blocks)].join('\n\n');
  if(body.length>100){const title=plain(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]||'');return {text:[title,body].filter(Boolean).join('\n\n'),extraction:'publisher-body-excerpt'};}
  return {text:plain(html),extraction:'page-text-excerpt'};
}
export async function boundedFetch(url,{signal,fetcher=fetch,maxBytes=1024*1024}={}){
  const r=await fetcher(url,{signal:AbortSignal.any([AbortSignal.timeout(20000),...(signal?[signal]:[])]),redirect:'error'});if(!r.ok)throw Error('source_http_'+r.status);
  const reader=r.body.getReader();let size=0,parts=[];try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw Error('source_too_large');}parts.push(value);}}finally{reader.releaseLock();}
  return Buffer.concat(parts).toString('utf8');
}
export function datasetView(body,{asOf,windowHours=24,observation=null,limit=200,requireVerifiedSource=false}={}){
  if(!body.ok||!Array.isArray(body.observations))throw Error('dataset_unavailable');
  const def=FINANCE_DATASETS[body.id];if(!def)throw Error('unknown_dataset');const upper=observation?Math.min(observation.to+1,Date.parse(asOf)):Date.parse(asOf),lower=observation?observation.from:upper-windowHours*3600000;
  const macro=def.kind==='fred'||def.kind==='sofr';let observations=body.observations.filter(r=>Date.parse(r.observedAt)<=(observation?upper-1:upper)&&(!observation&&macro||Date.parse(r.observedAt)>=lower)).map(r=>({...r,values:{...r.values}}));
  const sourceCount=observations.length;
  observations.sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt));
  if(def.kind==='klines')observations=observations.filter(r=>{const end=r.values.closeTime;const closeTime=typeof end==='number'?end:Date.parse(end);return r.values.closed!==false&&r.values.finality!=='forming'&&r.finality!=='forming'&&Number.isFinite(closeTime)&&closeTime<upper;});
  const formingExcluded=sourceCount-observations.length,beforeQualification=observations.length;
  if(requireVerifiedSource)observations=observations.filter(r=>sourceVerified(r)&&r.sourceVerification==='verified');
  const excludedUnverified=beforeQualification-observations.length;
  const selectedCount=observations.length;observations=observations.slice(0,limit);
  const numericUnits={};observations.forEach((r,i)=>{for(const [k,u]of Object.entries(def.fields))if(!u.includes('[]')&&r.values[k]!==null&&r.values[k]!==''&&Number.isFinite(Number(r.values[k])))numericUnits[`observations.${i}.values.${k}`]=u;});
  const latest=observations[0];const age=latest?Math.max(0,(upper-Date.parse(latest.observedAt))/1000):null;
  const maxAge=def.kind==='klines'?(steps[def.parameters.interval]*2+def.refreshSeconds):['oi','premium','book'].includes(def.kind)?def.refreshSeconds*2:['oi-history','taker','ratio','basis'].includes(def.kind)?10800:null;
  const data={observations,metrics:{},units:def.fields,limitations:def.limitations};
  let quality=!observations.length?(excludedUnverified?'unverified_source':'missing'):maxAge!==null&&age>maxAge?'stale':macro?'publication_time_unknown':excludedUnverified?'limited_verified_source':def.kind==='funding'?'settlement_schedule_unknown':'usable';
  if(def.kind==='klines'){
    const closed=observations;
    const contiguous=closed.every((r,i)=>!i||Math.abs(Date.parse(closed[i-1].observedAt)-Date.parse(r.observedAt)-steps[def.parameters.interval]*1000)<2000)&&body.coverage?.incomplete!==true;
    data.closedCount=closed.length;data.formingExcluded=formingExcluded;data.contiguous=contiguous;data.closureBasis='close time before anchor and no explicit forming flag; source qualification checked separately';
    if(closed.length>=2&&contiguous){const last=closed[0],first=closed.at(-1),a=Number(first.values.close),b=Number(last.values.close);if(a>0&&b>0){data.metrics.return_pct=(b/a-1)*100;numericUnits['metrics.return_pct']='percent';data.returnWindow={from:first.values.closeTime,to:last.values.closeTime,scope:'returned contiguous closed bars, not guaranteed requested full window'};}}
  }
  if(def.kind==='book'&&latest){
    const levels=(v,bid)=>{if(!Array.isArray(v)||!v.length)throw Error('invalid_book');const out=v.map(([p,q])=>[Number(p),Number(q)]);if(out.some(([p,q])=>!Number.isFinite(p)||!Number.isFinite(q)||p<=0||q<0)||out.some((x,i)=>i&&(bid?x[0]>=out[i-1][0]:x[0]<=out[i-1][0])))throw Error('invalid_book');return out;};
    const bids=levels(latest.values.bids,true),asks=levels(latest.values.asks,false);if(bids[0][0]>=asks[0][0])throw Error('crossed_book');
    const sum=rows=>rows.reduce((a,[p,q])=>({qty:a.qty+q,value:a.value+p*q}),{qty:0,value:0}),bid=sum(bids),ask=sum(asks),spread=asks[0][0]-bids[0][0];
    data.metrics={spread_USDT:spread,spread_bps:spread/((asks[0][0]+bids[0][0])/2)*10000,bid_BTC:bid.qty,ask_BTC:ask.qty,bid_notional_USDT:bid.value,ask_notional_USDT:ask.value,imbalance_ratio:(bid.qty+ask.qty)>0?(bid.qty-ask.qty)/(bid.qty+ask.qty):null};
    for(const key of Object.keys(data.metrics))if(data.metrics[key]!==null)numericUnits['metrics.'+key]=key==='spread_USDT'?'USDT/BTC':key.endsWith('USDT')?'USDT':key.endsWith('BTC')?'BTC':key.endsWith('bps')?'basis-points':'ratio';
    data.method='visible-depth.v1; levels='+bids.length+'/'+asks.length+'; not continuous order changes';
  }
  if(observations.length){const computed=analysisStatistics(observations,def);data.analysis=computed.analysis;data.representativeIndices=computed.representativeIndices;Object.assign(numericUnits,computed.numericUnits);}
  const range=observations.length?{from:Date.parse(observations.at(-1).observedAt),to:def.kind==='klines'?Date.parse(observations[0].values.closeTime):Date.parse(observations[0].observedAt)}:null;
  if(range&&def.kind==='klines'&&typeof observations[0].values.closeTime==='number')range.to=observations[0].values.closeTime;
  const completeWindow=!!(observation&&def.kind==='klines'&&!excludedUnverified&&data.contiguous&&range&&range.from===lower&&range.to===upper-1&&!body.coverage?.truncated&&selectedCount<=limit);
  const closedNeeded=def.kind==='klines'?Math.max(0,(klineOpenAt(def.parameters.interval,upper)-klineOpenAt(def.parameters.interval,lower-1)-steps[def.parameters.interval]*1000)/(steps[def.parameters.interval]*1000)):null;
  return {data,numericUnits,quality,usable:observations.length>0&&quality!=='stale',coverage:{...body.coverage,...(closedNeeded!==null?{sourceNeeded:body.coverage?.needed??null,needed:closedNeeded}:{}),windowHours,selectionScope:macro?(observation?'selected-reference-period-window':'reference-period-context'):(observation?'selected-market-window':'market-window'),referencePeriodContext:macro,windowAppliedToReferencePeriods:macro?!!observation:null,requestedRange:observation?{from:observation.from,to:observation.to}:macro?null:{from:lower,to:upper-1},actualRange:range,returnedRows:observations.length,returnedInWindow:macro&&!observation?null:observations.length,excludedUnverified,sourceQualificationApplied:requireVerifiedSource,truncated:body.coverage?.truncated===true||selectedCount>limit,completeWindow},sourceChain:[def.provider+':'+def.operation+':'+JSON.stringify(def.parameters)],sourceClock:{asOf,marketWindowEnd:observation?.to??null,observedAt:latest?.observedAt||null,ageSeconds:age,publicationCalendarEvaluated:false,strictHistoricalAvailability:false},contentHash:hash(observations.map(({observedAt,values,key,finality})=>({observedAt,values,key,finality})))};
}
export function eventView(body,asOf,windowHours,observation=null){
  if(body.ok!==true||body.d1Ready!==true||!Array.isArray(body.items))throw Error('events_coverage_unavailable');
  const time=observation?Math.min(observation.to,Date.parse(asOf)):Date.parse(asOf),lower=observation?observation.from:time-windowHours*3600000,items=body.items.filter(x=>Number.isFinite(Number(x.publishedAt))&&Number(x.publishedAt)<=time&&Number(x.publishedAt)>=lower).map(x=>({...x,scope:'discovery-summary; publisher full text not acquired',probability:null}));
  return {data:{items,latestAvailableAt:body.items[0]?.publishedAt||null},numericUnits:{},quality:items.length?'summary_only':'no_current_events',usable:items.length>0,coverage:{items:items.length,fullText:false,completeWindow:false},sourceChain:[...new Set(items.map(x=>x.url||x.source))],contentHash:hash(items)};
}
export function createTools({marketOrigin='https://btc.feiniwork.com',eventsOrigin='https://yuqing.feiniwork.com',fetcher=fetch}={}){
  // Origins come from the developer launcher, never from model/browser requests.
  const cache=new Map(),articles=new Map();
  async function execute(role,request,context){
    const id=crypto.randomUUID(),base={id,role,request,requestedAt:new Date().toISOString(),asOf:context.asOf,contextId:context.task?.contextId||'current'};
    try{
      if(!ROLES[role])throw Error('unknown_role');const limit=request.limit||100,windowHours=request.windowHours||context.windowHours||24;
      if(!Number.isInteger(limit)||limit<1||limit>200||!Number.isInteger(windowHours)||windowHours<1||windowHours>2160)throw Error('invalid_tool_parameters');
      const observation=context.observation||context.task?.observation||null,key=hash({role,request,asOf:context.asOf,observation});let view;
      if(cache.has(key))view=structuredClone(cache.get(key));
      else if(request.tool==='dataset'||request.tool==='market'){
        const dataset=request.tool==='market'?(request.dataset||'binance-perp-klines-15m'):request.dataset;
        const selected=observation&&observation.view==='chart'?'binance-'+(observation.product==='spot'?'spot':'perp')+'-klines-'+observation.timeframe:null;
        if(request.tool==='market'&&!roleDatasets(role).includes(dataset))throw Error('tool_scope_denied');
        if(request.tool==='dataset'&&!(roleDatasets(role).includes(dataset)||context.conditionCheck&&/^binance-(perp-klines-(5m|15m|1h|4h|1d|3d|1w)|spot-klines-1h)$/.test(dataset)))throw Error('tool_scope_denied');
        let url,raw,body;
        if(dataset.startsWith('binance-perp-klines-')){
          const anchor=Date.parse(context.asOf),lower=observation?.from??anchor-windowHours*3600000,upper=Math.min(observation?.to??anchor-1,anchor-1),interval=dataset.slice('binance-perp-klines-'.length),step=steps[interval]*1000,end=observation?klineOpenAt(interval,upper)+step:klineOpenAt(interval,anchor),begin=Math.max(klineOpenAt(interval,lower),end-limit*step);
          url=marketOrigin+'/api/desk/chart?'+new URLSearchParams({symbol:'BTCUSDT',interval,from:String(begin),to:String(end),knownAt:context.asOf});raw=await boundedFetch(url,{signal:context.signal,fetcher});const desk=JSON.parse(raw);
          if(desk.scope!=='chart'||desk.datasetId!==dataset||desk.requestWindow?.from!==begin||desk.requestWindow?.to!==end||desk.requestWindow?.interval!==interval||!Array.isArray(desk.series))throw Error('chart_response_scope_mismatch');
          body={ok:true,id:dataset,coverage:{...desk.coverage,truncated:desk.coverage?.truncated===true||begin>lower,cutoffApplied:desk.cutoff?.applied===true},observations:desk.series.map(bar=>({key:String(bar.t),observedAt:new Date(bar.t).toISOString(),receivedAt:bar.receivedAt,effectiveReceivedAt:bar.effectiveReceivedAt,publicAvailableAt:bar.publicAvailableAt,finality:bar.finality,origin:bar.origin,sourceHost:bar.sourceHost,ingestionMode:bar.ingestionMode,sourceVerification:bar.sourceVerification,values:{open:bar.o,high:bar.h,low:bar.l,close:bar.c,baseVolume:bar.v,quoteVolume:bar.quoteVolume??null,takerBuyBase:bar.takerBuyBase??null,takerBuyQuote:bar.takerBuyQuote??null,trades:bar.trades??null,closeTime:bar.t+step-1,closed:bar.closed===true,finality:bar.finality}}))};
        }else{url=marketOrigin+'/api/finance/datasets/'+encodeURIComponent(dataset)+'?'+new URLSearchParams({limit:String(observation&&!dataset.endsWith('-book')?1000:limit),known_at:context.asOf});raw=await boundedFetch(url,{signal:context.signal,fetcher});body=JSON.parse(raw);if(body.id!==dataset)throw Error('dataset_identity_mismatch');}
        if(dataset.startsWith('binance-'))body.observations=body.observations.map(row=>{const normalized={...row,origin:row.origin??'canonical'};if(row.sourceVerification===undefined)normalized.sourceVerification=typeof row.ingestionMode==='string'&&row.ingestionMode.length>0&&sourceVerified(normalized)?'verified':'unverified';return normalized;});
        view=datasetView(body,{asOf:context.asOf,windowHours,observation,limit,requireVerifiedSource:dataset.startsWith('binance-')});view.rawHash=crypto.createHash('sha256').update(raw).digest('hex');view.rawResponse=raw;view.sourceUrl=url;
      }else if(request.tool==='footprint'&&role==='flow'){
        const url=marketOrigin+'/api/desk/orderflow?'+new URLSearchParams({symbol:'BTCUSDT',knownAt:context.asOf}),raw=await boundedFetch(url,{signal:context.signal,fetcher}),body=JSON.parse(raw);
        if(body.scope!=='orderflow'||body.instrumentId!=='BINANCE:USDM:BTCUSDT:PERPETUAL'||!Array.isArray(body.series))throw Error('footprint_scope_unavailable');
        const from=observation?.from??Date.parse(context.asOf)-windowHours*3600000,to=Math.min(observation?.to??Date.parse(context.asOf)-1,Date.parse(context.asOf)-1),native=body.series.filter(bar=>Number.isSafeInteger(bar.t)&&bar.t>=from&&bar.t+300000-1<=to&&bar.finality!=='forming'),aggregate=globalThis.FootprintEngine.aggregateFootprintBars(native,observation?.timeframe||'5m','5m'),numericUnits={};
        const observations=aggregate.bars.slice(-limit).reverse().map(bar=>({observedAt:new Date(bar.t).toISOString(),values:{open:bar.open??bar.o,high:bar.high??bar.h,low:bar.low??bar.l,close:bar.close??bar.c,volume:bar.volume,buyVolume:bar.buyVol,sellVolume:bar.sellVol,delta:bar.delta},levels:bar.levels,finality:bar.finality,complete:bar.finality!=='incomplete'}));
        observations.forEach((bar,i)=>Object.entries(bar.values).forEach(([field,value])=>{if(Number.isFinite(value))numericUnits['observations.'+i+'.values.'+field]=['open','high','low','close'].includes(field)?'USDT/BTC':'BTC';}));
        const actualRange=native.length?{from:native[0].t,to:native.at(-1).t+300000-1}:null;
        view={data:{observations,nativeBars:native,aggregation:{method:'FootprintEngine.aggregateFootprintBars',version:'native5m.v1',sourceInterval:'5m',displayInterval:observation?.timeframe||'5m',incomplete:aggregate.incomplete,gaps:aggregate.gaps},limitations:[body.venueNote,'时间经过不等于完整逐笔事件序列；历史公开可得性未证明']},quality:aggregate.incomplete?'partial_native_buckets':'native_aggregate',usable:observations.length>0,numericUnits,coverage:{...body.coverage,requestedRange:{from,to},actualRange,completeWindow:!!(actualRange&&actualRange.from===from&&actualRange.to===to&&!aggregate.incomplete&&!body.coverage?.truncated),truncated:body.coverage?.truncated===true||aggregate.bars.length>limit,rawEventCompleteness:false},sourceChain:['binance-usdm:aggTrade:5m'],sourceClock:{asOf:context.asOf,publicAvailableAt:null,strictHistoricalAvailability:false},rawHash:crypto.createHash('sha256').update(raw).digest('hex'),rawResponse:raw,sourceUrl:url,contentHash:hash(native)};
      }else if(request.tool==='liquidations'&&role==='flow'){
        const anchor=Date.parse(context.asOf),from=observation?.from??anchor-windowHours*3600000,to=Math.min(observation?.to??anchor-1,anchor-1),span=anchor-from,range=span<=86400000?'24h':span<=7*86400000?'7d':'30d';
        const url=marketOrigin+'/api/desk/heatmap?'+new URLSearchParams({symbol:'BTCUSDT',range,knownAt:context.asOf}),raw=await boundedFetch(url,{signal:context.signal,fetcher}),body=JSON.parse(raw);
        if(body.scope!=='heatmap'||!body.byExchange||body.combinedTotalsForbidden!==true)throw Error('liquidation_scope_mismatch');
        const rows=(body.byExchange.binance?.buckets||[]).filter(row=>row.symbol==='BTCUSDT'&&row.exchange==='binance'&&Number(row.bucket_start)>=from&&Number(row.bucket_start)+300000-1<=to).sort((a,b)=>Number(b.bucket_start)-Number(a.bucket_start)),numericUnits={};
        const observations=rows.slice(0,limit).map(row=>({observedAt:new Date(Number(row.bucket_start)).toISOString(),values:{longNotional:row.long_notional??null,shortNotional:row.short_notional??null,longCount:row.long_count??null,shortCount:row.short_count??null},original:row}));observations.forEach((row,i)=>Object.entries(row.values).forEach(([field,value])=>{if(Number.isFinite(value))numericUnits['observations.'+i+'.values.'+field]=field.endsWith('Count')?'count':'USDT';}));
        view={data:{observations,exchange:'binance',limitations:[body.note,'无桶不代表零强平；forceOrder为抽样事件，不能算完整清算总额或未来池']},quality:'sampled_liquidations',usable:observations.length>0,numericUnits,coverage:{...body.coverage,requestedRange:{from,to},returnedInWindow:observations.length,truncated:body.coverage?.truncated===true||rows.length>limit,completeWindow:false,eventCompleteness:'not-guaranteed'},sourceChain:['binance:forceOrder:sampled-5m-buckets'],sourceClock:{asOf:context.asOf,publicAvailableAt:null,strictHistoricalAvailability:false},rawHash:crypto.createHash('sha256').update(raw).digest('hex'),rawResponse:raw,sourceUrl:url,contentHash:hash(rows.slice(0,limit))};
      }else if(request.tool==='events'&&role==='events'){
        const sources=[],found=[];
        try{const raw=await boundedFetch(eventsOrigin+'/api/yuqing/items?limit='+limit,{signal:context.signal,fetcher});const cloud=eventView(JSON.parse(raw),context.asOf,windowHours,observation);found.push(...cloud.data.items);sources.push({source:'stored-event-list',ok:true,latest:cloud.data.latestAvailableAt,rawResponse:raw});}catch(error){sources.push({source:'stored-event-list',ok:false,error:error.message});}
        for(const url of ['https://www.federalreserve.gov/feeds/press_all.xml','https://www.coindesk.com/arc/outboundfeeds/rss']){
          try{const raw=await boundedFetch(url,{signal:context.signal,fetcher});const text=(block,tag)=>{const hit=new RegExp('<'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+tag+'>','i').exec(block);return (hit?.[1]||'').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').trim();};
            const upper=observation?.to??Date.parse(context.asOf),lower=observation?.from??upper-windowHours*3600000;let count=0;for(const item of raw.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)){const block=item[1],publishedAt=Date.parse(text(block,'pubDate')),articleUrl=text(block,'link');if(!Number.isFinite(publishedAt)||publishedAt>Math.min(upper,Date.parse(context.asOf))||publishedAt<lower)continue;
              found.push({id:'feed:'+hash({articleUrl,publishedAt}),source:url,sourceType:'publisher-rss',title:text(block,'title'),summary:text(block,'description').slice(0,6000),url:articleUrl,publishedAt,fetchedAt:Date.now(),originalRSS:block,scope:'publisher RSS item; full article not acquired',probability:null});if(++count>=limit)break;}
            sources.push({source:url,ok:true,items:count,rawHash:hash(raw)});
          }catch(error){sources.push({source:url,ok:false,error:error.message});}
        }
        if(context.signal?.aborted)throw Error('cancelled');const items=[...new Map(found.map(x=>[x.url||x.id,x])).values()].sort((a,b)=>b.publishedAt-a.publishedAt).slice(0,limit);
        view={data:{items,sources},quality:items.length?'summary_only':'no_current_events',usable:items.length>0,numericUnits:{},coverage:{items:items.length,fullText:false,completeWindow:false,discoverySucceeded:sources.every(s=>s.ok)},sourceChain:items.map(x=>x.url),contentHash:hash(items.map(({fetchedAt,...x})=>x))};for(const item of items)articles.set(item.id,item);
      }else if(request.tool==='article'&&role==='events'){
        const article=articles.get(request.articleId);if(!article)throw Error('article_not_discovered');const url=new URL(article.url);
        if(url.protocol!=='https:'||url.port||url.username||url.password||!['www.coindesk.com','www.federalreserve.gov'].includes(url.hostname))throw Error('publisher_not_registered');
        // Publisher HTML includes page chrome; the measured 1.72MB article needs more than dataset JSON.
        const raw=await boundedFetch(url.href,{signal:context.signal,fetcher,maxBytes:2*1024*1024}),{text,extraction}=publisherExcerpt(raw);
        // Extraction is an excerpt, not a guaranteed full publisher article.
        view={data:{article:{id:article.id,url:url.href,publishedAt:article.publishedAt,text:text.slice(0,24000),extraction}},quality:'original_excerpt',usable:text.length>100,numericUnits:{},coverage:{fullText:false,truncated:text.length>24000,extraction},sourceChain:[url.href],contentHash:hash(raw),rawResponse:raw,rawHash:crypto.createHash('sha256').update(raw).digest('hex')};
      }else throw Error('tool_not_allowed');
      view.receivedAt??=new Date().toISOString();cache.set(key,structuredClone(view));return {...base,checkedAt:new Date().toISOString(),ok:true,...view};
    }catch(error){if(context.signal?.aborted)throw error;return {...base,receivedAt:new Date().toISOString(),ok:false,usable:false,quality:'failed',error:error.message,data:null,numericUnits:{},sourceChain:[],contentHash:null};}
  }
  async function discover(role,context){let requests=role==='events'?[{tool:'events',limit:100,windowHours:context.windowHours}]:ROLES[role].datasets.map(dataset=>({tool:'dataset',dataset,limit:dataset.includes('klines')?120:100,windowHours:context.windowHours}));const o=context.task?.observation;if(role==='env'&&o?.view==='chart'){const dataset='binance-'+(o.product==='spot'?'spot':'perp')+'-klines-'+o.timeframe;requests=[{tool:'dataset',dataset,limit:200,windowHours:context.windowHours},...requests.filter(r=>r.dataset!==dataset)];}if(role==='flow'&&o?.view==='orderflow')requests.unshift({tool:'footprint',limit:200,windowHours:context.windowHours});if(role==='flow'&&o?.view==='heatmap')requests.unshift({tool:'liquidations',limit:200,windowHours:context.windowHours});const rows=[];for(const request of requests)rows.push(await execute(role,request,context));return rows;}
  async function readMaterial(ref,context){if(ref.source!=='stored-event')throw Error('material_source_not_allowed');
    const raw=await boundedFetch(eventsOrigin+'/api/yuqing/reports/item?'+new URLSearchParams({id:ref.id}),{signal:context.signal,fetcher}),body=JSON.parse(raw),record=body.report;
    if(!body.ok||body.d1Ready!==true||!record||record.id!==ref.id||ref.version&&record.report?.schemaVersion!==ref.version)throw Error('selected_event_report_unavailable');
    if(globalThis.ResearchProtocol.validate(record).length)throw Error('stored_event_report_schema');return record;
  }
  return {execute,discover,readMaterial};
}
