/* User navigation and observation handoff. Viewing state never mutates a saved snapshot. */
const UserWorkspace = (() => {
  const views = [
    ['chart', '价格与结构'], ['orderflow', '成交足迹'], ['heatmap', '强平'],
    ['leverage', '杠杆与定价'], ['macro', '宏观与资金'],
  ];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let selection = {symbol:'BTCUSDT', product:'perpetual', chartInterval:'15m', orderflowInterval:'5m', liquidationRange:'24h', from:null, to:null, origin:'chart', material:null,clientObservedAt:null};
  let readerSession = null;
  const copy = value => JSON.parse(JSON.stringify(value));
  function query(){return new URLSearchParams(location.hash.split('?')[1] || '');}
  function view(route){const requested=query().get('view');return route==='derivatives' ? (requested==='macro'?'macro':'leverage') : route;}
  function marketShell(route, content){const selected=view(route);return `<div class="user-market" data-market-view="${esc(selected)}"><nav class="user-workspace-tabs" aria-label="市场与事件"><a href="#/market" aria-current="page">行情</a><a href="#/events">消息</a><a href="#/overview">市场概览</a></nav><nav class="user-view-tabs" aria-label="市场视图">${views.map(([id,label])=>`<a href="#/market?view=${id}" ${selected===id?'aria-current="page"':''}>${label}</a>`).join('')}</nav>${content}</div>`;}
  function researchShell(route,content){if(!['research-window','news-analysis'].includes(route))return content;const selected=route==='research-window'?'window':'narratives';return `<nav class="user-view-tabs" aria-label="研究与资料视图"><a href="#/boardroom">返回首席决策台</a>${[['window','指定问题研究'],['narratives','叙事资料与历史']].map(([id,label])=>`<a href="#/research?view=${id}" ${selected===id?'aria-current="page"':''}>${label}</a>`).join('')}</nav>${content}`;}
  function read(){return copy(selection);}
  function update(values){selection={...selection,...values};return read();}
  function describe(s=selection){const names={...Object.fromEntries(views),events:'所选事件'};const range=Number.isSafeInteger(s.from)&&Number.isSafeInteger(s.to)?new Date(s.from).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+' — '+new Date(s.to).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+' 北京时间':s.material?'事件原报告，未限定市场窗口':'尚未选择时间范围';const cadence=s.origin==='orderflow'?s.orderflowInterval:s.origin==='heatmap'?s.liquidationRange:['macro','leverage','events'].includes(s.origin)?'各来源原生频率':s.chartInterval;return `${s.symbol||'BTCUSDT'} ${s.product==='spot'?'现货':'永续'} · ${names[s.origin]||'市场'} · ${cadence} · ${range}${s.material?' · '+s.material.title:''}`;}
  function begin(values={}){update({...values,...(values.material?{from:null,to:null}:{}),clientObservedAt:new Date().toISOString()});location.hash='#/research?view=window';}
  function captureView(route){
    let values={origin:view(route),clientObservedAt:new Date().toISOString()};
    if(route==='chart'){
      const range=typeof lwChart!=='undefined'&&lwChart?.timeScale().getVisibleRange();
      const convert=t=>typeof t==='number'?t*1000:null;
      values={...values,chartInterval:currentInterval,from:convert(range?.from),to:range?convert(range.to)+DataEngine.getIntervalMs(currentInterval)-1:null,material:null};
    }else if(route==='orderflow'){
      const bars=getOrderflowVisibleStudyBars(),interval=readOrderflowState().interval;
      values={...values,orderflowInterval:interval,from:bars.length?Number(bars[0].t):null,to:bars.length?Number(bars.at(-1).t)+DataEngine.getIntervalMs(interval)-1:null,material:null};
    }else if(route==='heatmap'){
      const range=readHeatmapState().window,selectedRange=range==='all'?'30d':range,hours={'1h':1,'4h':4,'24h':24,'7d':168,'30d':720}[selectedRange];const to=Date.now();values={...values,liquidationRange:selectedRange,from:hours?to-hours*3600000:null,to:hours?to:null,material:null};
    }else values={...values,from:null,to:null,material:null};
    return update(values);
  }
  function mountMarket(route){
    const root=document.querySelector('.user-market');if(!root)return;
    root.querySelectorAll('a[href="#/news-analysis"]').forEach(link=>{link.href='#/research?view=window';link.textContent='研究这个窗口 →';link.onclick=()=>captureView(route);});
    if(!root.querySelector('[href="#/research?view=window"]')){
      const button=document.createElement('a');button.className='btn';button.href='#/research?view=window';button.textContent='研究这个背景 →';button.onclick=()=>captureView(route);root.querySelector('.deriv-action-cluster')?.append(button);
    }
    for(const id of ['chart','of','hm','deriv']){
      const note=root.querySelector('#'+id+'-research-evidence');if(note){const details=document.createElement('details');details.className='user-evidence-note';details.innerHTML='<summary>来源、范围与使用边界</summary>';note.before(details);details.append(note);}
    }
    const domain={chart:'env',orderflow:'flow',heatmap:'deriv',leverage:'deriv',macro:'macro'}[view(route)];
    const link=document.createElement('a');link.className='user-domain-link';link.href='#/agent-'+domain;link.textContent='阅读此领域的独立研究 →（另有资料截止）';root.querySelector('.rd-page-head')?.after(link);
    root.querySelectorAll('.owner-link').forEach(node=>node.remove());
  }
  function readable(value){
    const pairs=[['analysisReady=false','资料不足以支持完整分析'],['analysisReady=true','满足本次分析的资料要求'],['cutoff_not_confirmed','资料截止资格未确认'],['cutoffApplied/asOfApplied=false','来源未确认执行了资料截止筛选'],['collectionStale=false','采集未标为陈旧'],['sourceStale=null','来源时效未知'],['quality.pass','资料质量检查通过'],['system_observed','以系统收到资料的时间为准'],['publicly_available','已核对公开可得时间'],['same_response_raw_bytes_missing','无法取得同一响应的原始资料'],['partial','部分资料缺失'],['sourceStale','来源时效'],['collectionStale','采集时效'],['asKnownMode','资料时间依据'],['knowledgeCutoff','资料截止'],['capturedAt','资料固定时间'],['snapshotId','原始资料标识'],['asOf','参考时间'],['forming','进行中'],['scope','资料范围'],['insufficient','资料不足'],['ready','可用'],['PIT','历史当时可得性'],['decimal-per-settlement','每次结算的比例'],['decimal-per-8h','每8小时的比例'],['decimal-per-1h','每小时的比例'],['decimal-per-year','年化比例']];
    let text=String(value??'');for(const [raw,label]of pairs)text=/^[A-Za-z_]+$/.test(raw)?text.replace(new RegExp('\\b'+raw+'\\b','g'),label):text.replaceAll(raw,label);return text.replace(/sha256:[a-f0-9]{64}/g,'原始资料标识（见原文）');
  }
  return {views,esc,query,view,marketShell,researchShell,mountMarket,read,update,describe,begin,readable,
    setReaderSession:value=>{readerSession=value;},getReaderSession:()=>readerSession};
})();
globalThis.UserWorkspace = UserWorkspace;
