import {identity,clone,assert} from './contract.mjs';
export function historicalDiagnostic(bars,{lookback=4,horizon=1,threshold=0}={}){
  assert(Number.isInteger(lookback)&&lookback>0&&Number.isInteger(horizon)&&horizon>0&&Number.isFinite(threshold),'invalid_evaluation_parameters');
  const rows=bars.filter(b=>b.closed===true&&Number.isFinite(b.t)&&typeof b.c==='number'&&Number.isFinite(b.c)&&b.c>0).slice().sort((a,b)=>a.t-b.t);
  const samples=[];for(let i=lookback;i+horizon<rows.length;i++){
    const input=rows.slice(i-lookback,i+1),target=rows[i+horizon];
    const step=rows[i].t-rows[i-1].t;
    if(input.some((b,k)=>k&&b.t-input[k-1].t!==step)||rows.slice(i,i+horizon+1).some((b,k)=>k&&b.t-rows[i+k-1].t!==step)){samples.push({referenceAt:rows[i].t,status:'unresolved',reason:'missing_interval'});continue;}
    const momentum=rows[i].c/rows[i-lookback].c-1,prediction=momentum>threshold?1:0,actual=target.c/rows[i].c-1>threshold?1:0;
    samples.push({referenceAt:rows[i].t,targetAt:target.t,status:'resolved',prediction,actual,return:target.c/rows[i].c-1});
  }
  const resolved=samples.filter(s=>s.status==='resolved');
  return {schema:'bitdesk.research.diagnostic.v1',method:'fixed past-close momentum vs next closed-bar return',parameters:{lookback,horizon,threshold},inputHash:identity.contentId(rows),samples,
    resolved:resolved.length,unresolved:samples.length-resolved.length,accuracy:resolved.length?resolved.filter(s=>s.prediction===s.actual).length/resolved.length:null,
    alwaysUpBaseline:resolved.length?resolved.filter(s=>s.actual===1).length/resolved.length:null,
    limitations:['Historical diagnostic; revisions and model memory are not PIT controlled.','This evaluates a fixed mathematical baseline, not a model or trading P&L.','No trading fees/slippage apply to the research return.']};
}
export function registerForecast({runId,snapshotId,source,reference,targetStart,targetAt,issuedAt=new Date().toISOString(),probability=null,rationaleRefs=[]}){
  assert(source&&['venue','instrumentId','interval','sourceHost','units'].every(k=>typeof source[k]==='string'&&source[k]),'forecast_source_missing');
  assert(typeof source.endpoint==='string','forecast_endpoint_missing');
  const endpoint=new URL(source.endpoint);
  assert(endpoint.host===source.sourceHost&&source.symbol==='BTCUSDT'&&source.venue==='binance'&&source.instrumentId==='BINANCE:USDM:BTCUSDT:PERPETUAL','unsupported_forecast_product');
  assert(endpoint.searchParams.get('symbol')===source.symbol&&endpoint.searchParams.get('interval')===source.interval&&endpoint.pathname==='/fapi/v1/klines'&&endpoint.host==='fapi.binance.com','forecast_endpoint_product_mismatch');
  const intervalMatch=/^(\d+)(m|h|d)$/.exec(source.interval);assert(intervalMatch,'invalid_source_interval');
  const intervalMs=Number(intervalMatch[1])*({m:60000,h:3600000,d:86400000}[intervalMatch[2]]);
  const now=Date.now(),issued=Date.parse(issuedAt);
  assert(reference?.closed===true&&typeof reference.c==='number'&&Number.isFinite(reference.c)&&reference.c>0&&Number.isFinite(reference.t)&&reference.t+intervalMs<=issued,'invalid_reference_bar');
  assert(Number.isFinite(targetStart)&&Number.isFinite(targetAt)&&targetAt===targetStart+intervalMs&&targetStart%intervalMs===0&&issued<targetStart&&Math.abs(issued-now)<5000&&reference.t<targetStart,'late_or_invalid_forecast');
  assert(probability===null||typeof probability==='number'&&probability>=0&&probability<=1,'invalid_probability');
  const forecast={schema:'bitdesk.research.forecast.v1',runId,snapshotId,source:clone(source),reference:clone(reference),issuedAt,targetStart,targetAt,probability,probabilityStatus:probability===null?'not_provided':'raw_uncalibrated',rationaleRefs:clone(rationaleRefs),spec:{family:'closed_bar_simple_return_gt_zero',comparison:'>',threshold:0,intervalMs,revisionPolicy:'first-captured-closed-target',missingPolicy:'unresolved_after_grace',graceMs:600000},eligibility:'user-attested shadow; public/PIT provenance not independently established'};
  return {...forecast,forecastId:identity.contentId(forecast)};
}
export function settleForecast(forecast,{source,target,receivedAt=new Date().toISOString(),artifactHash,artifact}){
  const {forecastId,...content}=forecast;assert(identity.contentId(content)===forecastId,'forecast_mutated');
  assert(identity.contentId(source)===identity.contentId(forecast.source),'target_source_mismatch');
  const now=Date.parse(receivedAt);assert(Number.isFinite(now)&&now<=Date.now()+5000,'invalid_settlement_time');
  if(now<forecast.targetAt)return {forecastId,status:'pending',receivedAt};
  if(!target||target.t!==forecast.targetStart||target.closed!==true)return {forecastId,status:now>forecast.targetAt+forecast.spec.graceMs?'unresolved':'pending',reason:'precise_closed_target_missing',receivedAt};
  assert(typeof target.c==='number'&&Number.isFinite(target.c)&&target.c>0&&/^sha256:[a-f0-9]{64}$/.test(artifactHash||''),'invalid_target_evidence');
  const actualUrl=new URL(artifact?.url||'http://invalid');const expectedUrl=new URL(source.endpoint);
  assert(artifact&&artifact.receivedAt===receivedAt&&actualUrl.host===expectedUrl.host&&actualUrl.pathname===expectedUrl.pathname&&actualUrl.searchParams.get('symbol')===source.symbol&&actualUrl.searchParams.get('interval')===source.interval&&'sha256:'+identity.sha256(artifact.body)===artifactHash,'target_artifact_mismatch');
  const parsed=JSON.parse(artifact.body),rows=Array.isArray(parsed)?parsed:(parsed.series||parsed.klines||parsed.data);
  assert(Array.isArray(rows),'target_artifact_bars_missing');
  const raw=rows.find(bar=>(Array.isArray(bar)?Number(bar[0]):bar.t)===target.t);
  assert(raw&&Number(Array.isArray(raw)?raw[4]:raw.c)===target.c,'target_not_in_artifact');
  if(Array.isArray(raw))assert(Number(raw[6])<now&&Number(raw[6])+1===forecast.targetAt,'target_close_time_mismatch');
  else assert(raw.closed===true&&raw.t+forecast.spec.intervalMs<=now,'target_not_closed');
  const value=target.c/forecast.reference.c-1,outcome=value>0?1:0;
  return {forecastId,status:'resolved',receivedAt,artifactHash,target:clone(target),return:value,outcome,brier:forecast.probability===null?null:(forecast.probability-outcome)**2,scope:'single user-attested research outcome; not skill or profit verification'};
}
