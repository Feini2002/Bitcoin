// One reading stack for saved reports, their citations and exact originals.
// Rendering is supplied by the caller; this module never changes research data.
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function readerMarkup(){return `<dialog id="at-dialog" aria-label="报告与证据阅读器"><header class="at-dialog-tools"><button class="btn" id="at-back" hidden>返回上层</button><nav id="at-reader-path" aria-label="阅读路径"></nav><button class="btn" id="at-reading-export" hidden>导出阅读稿</button><button class="btn" id="at-export" disabled>导出当前原件</button><a class="btn" id="at-share" hidden>本地原件链接</a><button class="btn" id="at-close">关闭阅读</button></header><p id="at-reader-feedback" role="status"></p><div id="at-detail" tabindex="-1"></div></dialog>`;}
export function createReader(root,{load,render,download,downloadReading,label,link,onFeedback=()=>{}}){
  const life=new AbortController(),dialog=root.querySelector('#at-dialog'),detail=root.querySelector('#at-detail'),exportButton=root.querySelector('#at-export'),back=root.querySelector('#at-back'),path=root.querySelector('#at-reader-path'),share=root.querySelector('#at-share'),feedback=root.querySelector('#at-reader-feedback');
  const owner=crypto.randomUUID();let baseUrl=location.href,frames=[],serial=0,disposed=false,opener=null,leaving=false;
  const capture=()=>{const f=frames.at(-1);if(f){f.html=detail.innerHTML;f.scroll=dialog.scrollTop;f.focus=[...detail.querySelectorAll('button,a,summary')].indexOf(document.activeElement);}};
  function paint(){const f=frames.at(-1);if(!f){dialog.close();opener?.isConnected&&opener.focus({preventScroll:true});return;}
    detail.innerHTML=f.html;exportButton.disabled=!f.value;const readingExport=root.querySelector('#at-reading-export');readingExport.hidden=!downloadReading||f.value?.kind!=='report';readingExport.onclick=()=>{if(f.value?.kind==='report'){downloadReading(f.value);feedback.textContent='已导出所选报告的阅读稿；完整原件请使用原件导出。';}};back.hidden=frames.length<2;back.textContent='← 返回'+(frames.at(-2)?.label||'上层');path.textContent=frames.map(x=>x.label).join(' / ');feedback.textContent=f.error||'';
    const href=f.value&&link?.(f.value,f.ref);share.hidden=!href;if(href)share.href=href;
    if(!dialog.open)dialog.showModal();dialog.scrollTop=f.scroll||0;
    const focus=detail.querySelectorAll('button,a,summary')[f.focus];if(focus)focus.focus({preventScroll:true});else detail.focus({preventScroll:true});
  }
  function close(){if(!frames.length)return;const n=frames.length;++serial;frames=[];paint();if(location.href===baseUrl){leaving=true;history.go(-n);}}
  function up(){if(frames.length>1)history.back();else close();}
  async function open(ref,trigger){if(disposed||leaving)return;capture();if(!frames.length){opener=trigger||document.activeElement;baseUrl=location.href;}
    const f={ref,label:label(null,ref),value:null,html:'<p class="at-reader-loading">正在读取所选原件…</p>',scroll:0},ticket=++serial;frames.push(f);
    history.pushState({...history.state,atReader:{owner,depth:frames.length}},'',location.href);paint();
    try{const value=await load(ref);if(disposed||ticket!==serial)return;f.value=value;f.label=label(value,ref);f.html=render(value,ref);paint();}
    catch(error){if(disposed||ticket!==serial)return;f.error='所选原件读取失败：'+error.message;f.html='<section class="at-empty"><h2>这份原件暂时无法读取</h2><p>'+esc(ref.report||ref.run||ref.evidence||ref.role||'')+'</p><p>未替换成最新报告。可返回上层或重试。</p><button class="btn" data-reader-retry>重试这份原件</button></section>';paint();onFeedback(f.error);}
  }
  root.querySelector('#at-close').onclick=close;back.onclick=up;exportButton.onclick=()=>{const f=frames.at(-1);if(f?.value)download(f.value);};
  dialog.addEventListener('cancel',e=>{e.preventDefault();up();},{signal:life.signal});
  window.addEventListener('popstate',event=>{if(disposed)return;if(leaving){leaving=false;return;}const state=event.state?.atReader,depth=state?.owner===owner?state.depth:0;if(depth<frames.length){++serial;frames=frames.slice(0,depth);paint();}},{signal:life.signal});
  root.addEventListener('click',event=>{const retry=event.target.closest('[data-reader-retry]');if(retry){const f=frames.at(-1);if(!f)return;const ticket=++serial;f.error='正在重试…';feedback.textContent=f.error;void load(f.ref).then(value=>{if(disposed||ticket!==serial)return;f.value=value;f.label=label(value,f.ref);f.html=render(value,f.ref);f.error='';paint();}).catch(error=>{if(!disposed&&ticket===serial){f.error='所选原件读取失败：'+error.message;paint();}});return;}
    const target=event.target.closest('[data-evidence],[data-previous],[data-run],[data-report],[data-disposition]');if(!target||disposed||target.closest('[data-reader-ignore]'))return;
    const d=target.dataset,claim=d.claim||target.closest('.at-claim')?.querySelector('p')?.textContent;
    void open({evidence:d.evidence,cycle:d.cycle,run:d.run,report:d.previous||d.report,role:d.disposition,claim},target);
  },{signal:life.signal});
  const dispose=()=>{disposed=true;++serial;life.abort();dialog.close();frames=[];};dispose.open=open;dispose.close=close;return dispose;
}
