/* Plots only already fetched desk observations; no requests. */
(function(root){
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const numeric=v=>typeof v==='number'&&Number.isFinite(v);
  const stamp=t=>new Date(t).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  function timeSeries(rows,{timeKey='t',valueKey='c',unit='',intervalMs=0,title='',zeroBase=false,sparseEvents=false}={}){
    const points=(rows||[]).map(r=>({t:r[timeKey],v:r[valueKey],forming:!sparseEvents&&r.closed===false,unknown:!sparseEvents&&intervalMs>0&&r.closed!==true&&r.closed!==false})).filter(p=>numeric(p.t)&&numeric(p.v)).sort((a,b)=>a.t-b.t);
    if(!points.length)return '<p class="muted">没有可绘制的原值，未补零。</p>';
    const minT=points[0].t,maxT=points.at(-1).t,low=zeroBase?Math.min(0,...points.map(p=>p.v)):Math.min(...points.map(p=>p.v)),high=Math.max(...points.map(p=>p.v));
    const span=high-low||Math.max(Math.abs(high)*.002,1),x=t=>56+(t-minT)/Math.max(1,maxT-minT)*644,y=v=>140-(v-low)/span*110;
    let paths='',segment=[],gaps=0;
    function flush(){if(segment.length>1)paths+='<path d="'+segment.map((p,i)=>(i?'L':'M')+x(p.t).toFixed(2)+','+y(p.v).toFixed(2)).join(' ')+'"/>';segment=[];}
    for(const [i,p]of points.entries()){if(i&&intervalMs&&p.t-points[i-1].t!==intervalMs){flush();if(!sparseEvents)gaps++;}if(p.forming){flush();}else segment.push(p);}flush();
    const circles=points.map(p=>'<circle class="'+(p.forming?'forming':p.unknown?'unknown':'')+'" cx="'+x(p.t).toFixed(2)+'" cy="'+y(p.v).toFixed(2)+'" r="'+(p.forming||p.unknown?3:1.7)+'"/>').join('');
    const number=v=>v.toLocaleString('en-US',{maximumFractionDigits:3});
    return '<figure class="desk-time-plot"><figcaption>'+esc(title)+' · '+esc(unit)+' · '+points.length+(sparseEvents?' 个已记录事件桶 · 未记录不等于无事件':' 个观察点')+(gaps?' · '+gaps+' 处时间缺口':'')+(points.some(p=>p.forming)?' · 空心点为未闭合':'')+(points.some(p=>p.unknown)?' · 虚线空心点为闭合状态未知':'')+'</figcaption><svg viewBox="0 0 720 185" role="img" aria-label="'+esc(title+'，真实时间轴，'+unit+(sparseEvents?'，已记录事件，覆盖完整性未证明':'，'+gaps+'处缺口'))+'"><line class="grid" x1="56" y1="140" x2="700" y2="140"/><line class="grid" x1="56" y1="30" x2="700" y2="30"/><g class="curve">'+paths+circles+'</g><text x="2" y="34">'+esc(number(high))+'</text><text x="2" y="144">'+esc(number(low))+'</text><text x="56" y="174">'+esc(stamp(minT))+'</text><text x="700" y="174" text-anchor="end">'+esc(stamp(maxT))+'</text></svg></figure>';
  }
  function replace(container,html){
    const open=new Set([...container.querySelectorAll('details[data-receipt][open]')].map(e=>e.dataset.receipt));
    const active=document.activeElement,focus=container.contains(active)?active?.closest('details[data-receipt]')?.dataset.receipt:null;
    container.innerHTML=html;
    for(const details of container.querySelectorAll('details[data-receipt]')){details.open=open.has(details.dataset.receipt);if(focus===details.dataset.receipt)details.querySelector('summary')?.focus({preventScroll:true});}
  }
  root.DeskVisual={timeSeries,replace,stamp,esc};
})(globalThis);
