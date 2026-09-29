/* Live read overview: availability is derived from each desk response, never maturity. */
let researchOverviewDispose = null;
function pageResearchOverview() {
  const lanes=[['chart','行情工作台','价格、结构与多周期'],['orderflow','订单流与足迹','主动成交与价格分布'],['heatmap','强平雷达','Binance / Bybit 分所观察'],['derivatives','环境背景','资金、杠杆与宏观']];
  return `<div class="rd-overview"><header class="rd-page-head"><div><div class="rd-eyebrow">PERSONAL BITCOIN RESEARCH</div><h1>研究总览</h1><p>从市场事实出发，找到事件，再检验你的判断。</p></div><button class="btn" id="rd-home-refresh">刷新快照 ↻</button></header><div class="rd-market-grid">${lanes.map(([route,title,hint])=>`<a class="rd-market-card" href="#/${route}" id="home-${route}"><header><strong>${title}</strong><span aria-hidden="true">↗</span></header><div class="rd-market-value">读取中</div><p>${hint}</p><p class="rd-home-status">正在核对数据</p></a>`).join('')}</div><p class="rd-feedback" id="rd-home-feedback" role="status">此处为读取时快照，打开工作台查看持续更新的数据。</p><div class="rd-home-grid"><div><section class="rd-panel"><header class="rd-section-head"><h2>今天，按这个顺序开始</h2><p>让事实、解释和行动条件各就其位。</p></header><div class="rd-journey"><a href="#/chart"><span>01 / OBSERVE</span><h3>看清市场</h3><p>核对价格、成交、杠杆与数据时间，先排除缺口。</p></a><a href="#/news"><span>02 / UNDERSTAND</span><h3>找到催化剂</h3><p>辨认真实事件、源头披露和下一次验证时间。</p></a><a href="#/news-analysis"><span>03 / CHALLENGE</span><h3>验证与反证</h3><p>检验叙事是否得到数据支持，写明判断失效条件。</p></a></div></section><section class="rd-panel" style="margin-top:22px"><header class="rd-section-head"><h2>最近的研究</h2><p>报告是某个时点的记录，不是随行情滚动的结论。</p></header><div id="rd-home-reports">${ResearchDesk.empty('正在读取研究记录','事件和舆情报告独立读取。')}</div></section></div><aside><section class="rd-panel rd-workflow-card"><div class="rd-eyebrow">YOUR RESEARCH WORKFLOW</div><h2>用白话发起，带证据回来</h2><p class="rd-dialog-intro">在事件或舆情页准备研究指令，交给你的 AI 对话完成。无需在网站配置模型密钥。</p><ol class="rd-process"><li><div><strong>选择研究问题</strong><p class="rd-muted">一次事件梳理，或一次观点复核。</p></div></li><li><div><strong>在 AI 对话中分析</strong><p class="rd-muted">检索原文，核对四页数据，主动寻找反证。</p></div></li><li><div><strong>保存可追溯的结果</strong><p class="rd-muted">校验结构、保存新版本，回到这里阅读。</p></div></li></ol><a class="btn rd-full" href="#/news">准备第一次研究 →</a></section><section class="rd-panel rd-context-note" style="margin-top:22px"><h3>先核对，再下结论</h3><p>没有数据不等于没有风险；社媒热度不等于事实；OI 增加也不等于多头看涨。保持来源、时间和观察窗口一致。</p><a href="#/settings">数据状态与外观设置 ↗</a></section></aside></div><details class="rd-home-plans"><summary>查看功能清单、规划与演示</summary><p class="rd-muted">已接入只表示该页连上了接口；运行状态以页内的数据来源、更新时间和错误提示为准，不代表服务在线或可交易。</p><div class="feature-grid">${FEATURES.filter(x=>x.id!=='overview').map(x=>`<a class="card feature-card" href="#/${x.id}"><strong>${x.label}</strong><span class="chip">${featureInfo(x.id).label}</span><p>${featureInfo(x.id).note}</p></a>`).join('')}</div></details></div>`;
}
function initResearchOverview() {
  researchOverviewDispose?.();const ctrl=new AbortController();let generation=0;
  const esc=ResearchDesk.esc;
  async function refresh(){
    const ticket=++generation;const button=document.getElementById('rd-home-refresh');button.disabled=true;
    const scopes=[['chart','chart'],['orderflow','orderflow'],['heatmap','heatmap'],['derivatives','context']];
    await Promise.all(scopes.map(async ([route,scope])=>{
      const card=document.getElementById('home-'+route);
      try{const d=await DataEngine.fetchDesk(scope,{symbol:'BTCUSDT',interval:scope==='chart'?'15m':undefined,tail:scope==='chart'?32:undefined,range:'24h',signal:ctrl.signal});if(ctrl.signal.aborted||ticket!==generation)return;
        const stale=d.collectionStale===true||d.sourceStale===true||d.quality?.status==='fail';
        let value='需核对',detail='打开工作台查看证据';
        if(scope==='chart'){const raw=d.series?.at(-1)?.c,c=Number(raw);value=raw!=null&&!stale&&d.pricePathAvailable&&Number.isFinite(c)&&c>0?c.toLocaleString('en-US',{maximumFractionDigits:1})+' USDT':'行情不可用';detail='BTCUSDT 永续 · 15m 最近读数';}
        if(scope==='orderflow'){value=!stale&&d.series?.length?d.series.length+' 根足迹':'足迹不可用';detail='5m 来源 · Delta 为主动量近似';}
        if(scope==='heatmap'){const venues=['binance','bybit'].filter(v=>d.byExchange?.[v]?.buckets?.length);value=venues.length?venues.length+' 所已记录':'暂无观察';detail='仅表示已有记录，不代表实时连接状态';}
        if(scope==='context'){const c=d.contract;const cards=c?[c.premium,c.funding,c.basis,...Object.values(c.positioning||{})].filter(Boolean):[];value=!c||c.unavailable?'合约暂缺':c.partial||cards.some(x=>x.unavailable||x.sourceStale||x.collectionStale)?'部分需核对':'合约已返回';detail='宏观时效需按各自发布频率核对';}
        card.querySelector('.rd-market-value').textContent=value;card.querySelector('p').textContent=detail;card.querySelector('.rd-home-status').textContent=(stale?'需核对 · ':'读取于 ')+ResearchDesk.time(d.asOf);
      }catch(e){if(ctrl.signal.aborted||ticket!==generation)return;card.querySelector('.rd-market-value').textContent='读取失败';card.querySelector('.rd-home-status').textContent='打开工作台查看原因';card.title=e.message;}
    }));
    if(!ctrl.signal.aborted&&ticket===generation){button.disabled=false;document.getElementById('rd-home-feedback').textContent='本轮读取结束 · '+ResearchDesk.time(new Date().toISOString())+' · 状态与缺口见各卡片，打开工作台查看持续更新的数据。';}
  }
  async function reports(){
    const rows=await Promise.all(['daily_event','sentiment_analysis'].map(async kind=>{try{return {kind,data:await DataEngine.fetchYuqingReportLatest(kind,{signal:ctrl.signal})};}catch(e){return {kind,error:e.message};}}));if(ctrl.signal.aborted)return;
    document.getElementById('rd-home-reports').innerHTML=rows.map(({kind,data,error})=>{const row=data?.report,event=kind==='daily_event',route=event?'news':'news-analysis';return `<article class="rd-latest-report"><div class="rd-eyebrow">${event?'事件研究':'舆情分析'}</div><h3><a href="#/${route}${row?.id?'?reportId='+encodeURIComponent(row.id):''}">${esc(row?.report?.title||(error?'报告读取失败':'尚未保存研究'))} ↗</a></h3><p>${row?esc(ResearchDesk.time(row.report?.asOf||row.generatedAt))+' · '+(row.report?.schemaVersion===ResearchProtocol.VERSION?'结构化研究':'历史格式，请核对时效'):error?'可进入报告页重试；未使用其他数据替代。':'从研究流程开始，完成后将结果保存到网站。'}</p></article>`;}).join('');
  }
  document.getElementById('rd-home-refresh').addEventListener('click',refresh,{signal:ctrl.signal});refresh();reports();researchOverviewDispose=()=>{++generation;ctrl.abort();};
}
function disposeResearchOverview(){researchOverviewDispose?.();researchOverviewDispose=null;}
