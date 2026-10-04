// Descriptive statistics over the receipt's actual rows. No new data or forecast.
export function analysisStatistics(observations,definition){
  const rows=observations.map((row,index)=>({row,index,at:Date.parse(row.observedAt)})).filter(x=>Number.isFinite(x.at)).sort((a,b)=>b.at-a.at);
  const periods=new Map();for(const x of rows)if(!periods.has(x.at))periods.set(x.at,x);
  const unique=[...periods.values()],indices=new Set([0,observations.length-1]),units={};
  const analysis={method:'observed-comparisons.v1',scope:'actual returned observations; current acquired version, no forecast or causal attribution',sampleRows:unique.length,duplicateReferenceRows:rows.length-unique.length,windows:[],comparisons:[]};
  units['analysis.sampleRows']='count';units['analysis.duplicateReferenceRows']='count';
  const finite=x=>typeof x==='number'&&Number.isFinite(x),put=(target,key,value,unit,prefix)=>{if(finite(value)){target[key]=value;units[prefix+'.'+key]=unit;}};
  if(definition.kind==='klines'){
    const seconds={'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400,'3d':259200,'1w':604800}[definition.parameters.interval],step=seconds*1000;
    const end=unique[0];
    for(const distance of [...new Set([Math.round(3600000/step),Math.round(14400000/step),unique.length-1])].filter(n=>n>=1&&n<unique.length)){
      const span=unique.slice(0,distance+1),first=span.at(-1),last=end;
      if(!span.every((x,i)=>!i||span[i-1].at-x.at===step)||!span.every(x=>finite(x.row.values.close)&&x.row.values.close>0))continue;
      const w={scope:'close-to-close of contiguous returned bars',from:first.row.values.closeTime,to:last.row.values.closeTime},p='analysis.windows.'+analysis.windows.length;
      put(w,'elapsedHours',distance*step/3600000,'hours',p);put(w,'sampleRows',span.length,'count',p);
      put(w,'startClose',first.row.values.close,'USDT/BTC',p);put(w,'endClose',last.row.values.close,'USDT/BTC',p);
      put(w,'returnPercent',(last.row.values.close/first.row.values.close-1)*100,'percent',p);
      const active=span.slice(0,-1),highs=active.filter(x=>finite(x.row.values.high)),lows=active.filter(x=>finite(x.row.values.low));
      if(highs.length===active.length&&lows.length===active.length){const high=highs.reduce((a,b)=>a.row.values.high>=b.row.values.high?a:b),low=lows.reduce((a,b)=>a.row.values.low<=b.row.values.low?a:b);put(w,'high',high.row.values.high,'USDT/BTC',p);put(w,'low',low.row.values.low,'USDT/BTC',p);put(w,'rangePercent',(high.row.values.high-low.row.values.low)/first.row.values.close*100,'percent',p);indices.add(high.index);indices.add(low.index);}
      const volumes=active.map(x=>x.row.values.baseVolume),prior=unique.slice(distance,distance*2);
      if(volumes.every(finite))put(w,'baseVolume',volumes.reduce((a,b)=>a+b,0),'BTC',p);
      if(prior.length===distance&&prior.every((x,i)=>finite(x.row.values.baseVolume)&&(!i||prior[i-1].at-x.at===step))&&active.at(-1).at-prior[0].at===step){const baseline=prior.reduce((a,x)=>a+x.row.values.baseVolume,0);put(w,'priorBaseVolume',baseline,'BTC',p);w.volumeBaselineFrom=prior.at(-1).row.observedAt;w.volumeBaselineTo=prior[0].row.values.closeTime;if(baseline>0&&finite(w.baseVolume))put(w,'volumeRatio',w.baseVolume/baseline,'ratio',p);indices.add(prior[0].index);indices.add(prior.at(-1).index);}
      const changes=span.slice(0,-1).map((x,i)=>Math.log(x.row.values.close/span[i+1].row.values.close));
      if(changes.length>=2){const mean=changes.reduce((a,b)=>a+b,0)/changes.length;put(w,'closeReturnStdPercent',Math.sqrt(changes.reduce((a,b)=>a+(b-mean)**2,0)/(changes.length-1))*100,'percent',p);}
      indices.add(first.index);indices.add(last.index);analysis.windows.push(w);
    }
  }else if(definition.kind!=='book'&&unique.length>=2){
    const latest=unique[0];
    for(const field of Object.keys(definition.fields).filter(k=>!definition.fields[k].includes('[]')&&!/time|timestamp|milliseconds/i.test(k+' '+definition.fields[k])&&finite(latest.row.values[k])))for(const distance of [1,5,20].filter(n=>n<unique.length)){
      const prior=unique[distance],a=prior.row.values[field],b=latest.row.values[field];if(!finite(a))continue;
      const c={field,scope:'different observed/reference periods; not new publication counts',from:prior.row.observedAt,to:latest.row.observedAt},p='analysis.comparisons.'+analysis.comparisons.length,u=definition.fields[field];
      put(c,'referenceSteps',distance,'count',p);put(c,'previous',a,u,p);put(c,'latest',b,u,p);put(c,'change',b-a,u,p);
      if(a>0&&!/decimal|fraction|ratio|percent/.test(u))put(c,'changePercent',(b/a-1)*100,'percent',p);
      if(u==='percent-per-year')put(c,'changeBasisPoints',(b-a)*100,'basis-points',p);
      indices.add(prior.index);analysis.comparisons.push(c);
    }
  }
  return {analysis,numericUnits:units,representativeIndices:[...indices].filter(i=>i>=0&&i<observations.length).sort((a,b)=>a-b)};
}
