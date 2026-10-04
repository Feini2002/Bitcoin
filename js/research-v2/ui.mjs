import {ROLES,FIRST_ROLES,clone,createRun,createTask,pendingRoles,receiveOutput,cancelRun,exportSession,restoreSession,captureDesk,historicalDiagnostic,effectiveClaims} from './index.mjs';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={first:'独立分析',challenge:'反证审查',response:'一次回应',synthesis:'综合研究',complete:'已完成',cancelled:'已取消',failed:'失败'};
const modeLabel={codex_cli:'AI 研究',codex_native:'AI 研究',manual:'对话研究 · 来源由使用者声明',mock:'测试样本 · 非真实研究',replay:'历史重放 · 非当前研究'};
const prose=value=>esc(globalThis.UserWorkspace?.readable(value)??value);
const date=value=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未知';
const STORAGE='bitdesk-research-sessions-v2';
function readHistory(){try{return JSON.parse(localStorage.getItem(STORAGE)||'[]').flatMap(row=>{try{return [restoreSession(row)];}catch{return [];}});}catch{return [];}}
function saveHistory(run){
  globalThis.UserWorkspace?.setReaderSession(run);
  const rows=[run,...readHistory().filter(r=>r.runId!==run.runId)].slice(0,3);
  while(rows.length>1&&JSON.stringify(rows.map(exportSession)).length>3000000)rows.pop();
  const body=JSON.stringify(rows.map(exportSession));
  if(body.length>3000000)return '完整记录较大，本次已打开；请导出保存。';
  try{localStorage.setItem(STORAGE,body);return '';}catch{return '浏览器存储已满，本次仍可使用；请导出保存。';}
}
function download(name,value){const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function mountTeam(root,engine){
  if(!root)return ()=>{};
  if(globalThis.UserWorkspace?.query().get('runId'))return mountLegacyTeam(root,engine);
  root.innerHTML='<div id="agent-task-root"></div><details class="at-legacy-tools"><summary>资料准备、手工研究与旧记录</summary><p class="muted">保留原资料准备和旧记录的读取方式；旧模型执行入口已退役。</p><div id="legacy-research-root"></div></details>';
  const {mountTask}=await import('../agent-team/ui.mjs'),taskCleanup=await mountTask(root.querySelector('#agent-task-root'));
  if(!root.isConnected){taskCleanup?.();return ()=>{};}
  const legacyCleanup=await mountLegacyTeam(root.querySelector('#legacy-research-root'),engine);
  return ()=>{taskCleanup?.();legacyCleanup?.();};
}
async function mountLegacyTeam(root,engine){
  if(!root)return ()=>{};
  let disposed=false,controller=null,run=null,selected='structure',auth=null,poll=null,busy=false,serial=0,history=readHistory(),serverHistory=[];
  const workspace=globalThis.UserWorkspace;
  const selection=workspace?.read();
  root.innerHTML=`<section class="team-compose"><label for="team-question">这次想核对什么？</label><textarea id="team-question" rows="3">BTC 当前走势有哪些支持与反证？分别核对结构成交、杠杆、宏观和事件，给出未来一小时需要观察的确认与失效条件。</textarea><div class="team-actions"><button class="btn" id="team-freeze">准备研究资料</button><button class="btn primary" id="team-run" disabled title="旧执行入口已退役，新团队请进入首席决策台">旧执行已退役</button><button class="btn" id="team-cancel" disabled>取消研究</button><button class="btn" id="team-export" disabled>导出完整记录</button><label class="btn" for="team-import">打开研究记录</label><input id="team-import" type="file" accept=".json,application/json" hidden></div><p id="team-provider" class="muted">正在读取研究入口…</p><p id="team-feedback" role="status"></p></section><div class="team-grid"><section class="team-main"><details class="team-snapshot-details"><summary>本次研究资料</summary><div id="team-snapshot"></div></details><div id="team-result"></div><details class="team-process-details"><summary>分析过程与分项依据</summary><div id="team-progress" class="team-progress"></div><div id="team-roles" class="team-roles"></div><div id="team-detail"></div><details class="team-panel" id="team-manual"><summary>在 Codex 对话中分模块运行</summary><p>依次复制本阶段提示词，将角色的 JSON 输出粘贴回来。此路径按手工会话声明记录；不需要模型 Key。</p><button class="btn" id="team-copy-prompt" disabled>复制当前模块提示词</button><pre id="team-prompt"></pre><label for="team-output">当前任务的 JSON 输出</label><textarea id="team-output" rows="5" spellcheck="false"></textarea><button class="btn" id="team-receive" disabled>接收当前任务结果</button></details></details></section><aside class="team-history team-panel"><h2>研究记录</h2><div id="team-history"></div><p class="muted">资料与判断按研究时点保存；打开旧记录不会重新计算。</p><a href="#/records">查看全部记录 →</a></aside></div>`;
  const find=id=>root.querySelector('#'+id);
  const scope=document.createElement("div");scope.className="user-scope";scope.id="team-scope";scope.textContent=workspace?.describe(selection)||"BTCUSDT 永续 · 最近资料";root.querySelector(".team-compose").prepend(scope);
  const newButton=document.createElement('button');newButton.className='btn';newButton.textContent='新研究';newButton.id='team-new';newButton.hidden=true;find('team-export').after(newButton);
  newButton.onclick=()=>{++serial;clearTimeout(poll);run=null;selected='structure';find('team-question').value='';scope.textContent=workspace?.describe(selection)||'最近资料';globalThis.history.replaceState(null,'','#/research?view=window');feedback('输入新的研究问题。');paint();};
  const diagnosticButton=document.createElement('button');diagnosticButton.className='btn';diagnosticButton.id='team-diagnostic';diagnosticButton.textContent='核对历史基线';diagnosticButton.hidden=true;diagnosticButton.disabled=true;find('team-export').after(diagnosticButton);
  const retryButton=document.createElement('button');retryButton.className='btn';retryButton.id='team-retry';retryButton.textContent='续跑未完成阶段';retryButton.disabled=true;find('team-cancel').after(retryButton);
  const evaluation=document.createElement('section');evaluation.id='team-evaluation';evaluation.className='team-panel';evaluation.hidden=true;find('team-result').after(evaluation);
  diagnosticButton.onclick=()=>{try{const artifact=run?.snapshot.artifacts.find(a=>a.scope==='chart'),rows=artifact?JSON.parse(artifact.body).series:[];if(!Array.isArray(rows)||!rows.length)throw Error('固定输入没有价格栏');const result=historicalDiagnostic(rows,{lookback:4,horizon:1,threshold:0});const record={...result,runId:run.runId,snapshotId:run.snapshot.snapshotId,source:{url:artifact.url,bodyHash:artifact.bodySha256,receivedAt:artifact.receivedAt},createdAt:new Date().toISOString()};evaluation.hidden=false;evaluation.innerHTML='<h2>历史数学基线</h2><p>只采用明确闭合栏；前4栏动量方向对下一闭合栏收益。所有缺口样本保留。</p><p>可结算 '+result.resolved+' · 无法结算 '+result.unresolved+' · 正确率 '+(result.accuracy===null?'未知':(result.accuracy*100).toFixed(1)+'%')+' · 恒上涨基线 '+(result.alwaysUpBaseline===null?'未知':(result.alwaysUpBaseline*100).toFixed(1)+'%')+'</p><p>这检验固定数学规则，不是模型回测、PIT 证明或可交易收益。</p>';download('BTC-diagnostic-'+run.runId+'.json',record);}catch(error){feedback(error.message,true);}};
  const feedback=(value,error=false)=>{if(disposed)return;find('team-feedback').textContent=value;find('team-feedback').className=error?'team-error':'team-feedback';};
  const request=async(url,options={})=>{const response=await fetch('/api/local-research/'+url,{...options,signal:options.signal||AbortSignal.timeout(30000),headers:{'Content-Type':'application/json',...(options.headers||{})}});let data;try{data=await response.json();}catch{throw Error('本地研究服务不可用；可准备资料，在 AI 对话中完成研究');}if(!response.ok)throw Error(data.error||'研究服务 HTTP '+response.status);return data;};
  function selectedTask(){if(!run||!pendingRoles(run).includes(selected))return null;return createTask(run,selected);}
  function paint(){
    if(disposed)return;
    const active=run&&!['complete','cancelled','failed'].includes(run.status);
    const reading=run?.status==='complete';root.querySelector('.team-compose').classList.toggle('is-reading',reading);newButton.hidden=!reading;
    find('team-freeze').hidden=reading;find('team-run').hidden=reading;
    find('team-run').disabled=true;
    find('team-freeze').disabled=busy||run?.mode==='codex_cli'&&active;
    find('team-cancel').disabled=!active&&!controller;
    find('team-export').disabled=!run;
    if(run)workspace?.setReaderSession(run);
    diagnosticButton.disabled=!run;
    retryButton.disabled=busy||!auth?.available||run?.mode!=='codex_cli'||run?.status!=='failed';
    retryButton.hidden=retryButton.disabled;find('team-cancel').hidden=!active&&!controller;
    const all=[...serverHistory.map(r=>({...r,origin:'host'})),...history.map(r=>({runId:r.runId,question:r.snapshot.question,createdAt:r.createdAt,status:r.status,mode:r.mode,origin:'local'}))];
    if(run&&!all.some(r=>r.runId===run.runId))all.unshift({runId:run.runId,question:run.snapshot.question,createdAt:run.createdAt,status:run.status,mode:run.mode,origin:'local'});
    find('team-history').innerHTML=all.length?all.map(r=>`<button class="team-history-item" data-run="${esc(r.runId)}" data-run-source="${r.origin}"><strong>${esc(r.question)}</strong><span>${esc(date(r.createdAt))} · ${esc(labels[r.status]||r.status)} · ${r.origin==='host'?'研究服务':'本机'}</span></button>`).join(''):'<p>还没有旧记录。可以准备资料或打开已有记录。</p>';
    if(!run){find('team-progress').innerHTML='<p class="team-empty">可以准备所选窗口的资料；新团队分析请进入首席决策台。</p>';for(const id of ['team-result','team-snapshot','team-roles','team-detail'])find(id).innerHTML='';return;}
    const snapshot=run.snapshot,bundle=snapshot.bundle;
    find('team-snapshot').innerHTML=`<section class="team-panel"><h2>本次研究资料</h2><p>${esc(snapshot.question)}</p><p class="muted">资料截止 ${esc(date(bundle.knowledgeCutoff))} · 捕获 ${esc(date(snapshot.capturedAt))}</p><strong>${bundle.analysisReady?'满足所声明证据要求':'部分资料缺失 · 结论保留相应限制'}</strong><details><summary>查看来源与覆盖</summary><code>${esc(snapshot.snapshotId)}</code>${bundle.entries.map(e=>`<p>${esc(e.name)} · ${e.transportOk?'已取得':'读取失败'} · ${esc(e.schemaVersion||'版本未知')} · ${esc(e.reason||'可读')}<br><small>${esc(e.url)}</small></p>`).join('')}<p>各来源独立提交，非原子快照；公开可得时间可能未知，历史报告附件不参与资料截止保证。</p></details></section>`;
    find('team-progress').innerHTML=['first','challenge','response','synthesis'].map(stage=>`<div class="team-stage ${run.status===stage?'is-active':''}"><strong>${esc(labels[stage])}</strong><span>${run.tasks.filter(t=>t.stage===stage&&t.receipt).length} 份已接收</span></div>`).join('');
    find('team-progress').setAttribute('data-status',run.status);
    find('team-progress').setAttribute('data-run-id',run.runId);
    const final=run.tasks.find(t=>t.stage==='synthesis'&&t.receipt)?.receipt.output;
    const dataClaims=(final?.claims||[]).filter(claim=>claim.evidenceRefs.some(ref=>/:\/(series\/|seriesWindow|contract\/|groups\/|byExchange\/)/.test(ref)));
    find('team-result').innerHTML=final?`<section class="team-panel team-conclusion"><div class="team-heading"><h2>综合结论</h2><span>${esc(modeLabel[run.mode])}</span></div><p class="team-summary">${esc({observe:"继续观察，等待进一步证据。",conditional:"判断取决于以下确认与失效条件。",insufficient:"资料不足以支持完整判断，保留局部观察。"}[final.decision])}</p><div class="user-research-findings">${dataClaims.slice(0,3).map(claim=>`<p>${prose(claim.text)}</p>`).join('')}</div><details id="team-original-summary"><summary>完整原始摘要</summary><p>${esc(final.summary)}</p></details><p>状态：${esc({observe:'继续观察',conditional:'条件判断',insufficient:'证据不足'}[final.decision])} · 可信度 ${esc({low:"较低",medium:"中等",high:"较高"}[final.confidence]||final.confidence)} · ${final.probability===null?'':'原始未校准概率 '+esc(final.probability)}</p><div class="team-scenarios">${final.scenarios.map(s=>`<article><h3>${esc(s.name)}</h3><p>触发：${prose(s.trigger)}</p><p>确认：${prose(s.confirmation)}</p><p>失效：${prose(s.invalidation)}</p><p>${prose(s.implication)}</p></article>`).join('')}</div><h3>下一观察</h3><ul>${final.nextObservations.map(x=>`<li>${prose(x)}</li>`).join('')}</ul><details><summary>主张处置与未解决分歧</summary>${final.dispositions.map(d=>`<p><strong>${esc(ROLES[d.role].name)} / ${esc(d.claimId)} · ${esc(d.decision)}</strong><br>${esc(d.reason)}</p>`).join('')}</details><details><summary>完整限制与资料缺口</summary><ul>${final.limitations.map(x=>`<li>${prose(x)}</li>`).join('')}</ul></details></section>`:`<section class="team-panel"><h2>${esc(labels[run.status]||run.status)}</h2><p>${prose(run.failure||'资料已准备，等待分析结果。')}</p><p>${esc(modeLabel[run.mode])}</p></section>`;
    if(final){const finalTask=run.tasks.find(t=>t.stage==='synthesis'&&t.receipt),review=finalTask.receipt.provenance.semanticAudit,ledger=effectiveClaims(finalTask.input.dependencies);
      find('team-result').querySelector('.team-summary').insertAdjacentHTML('beforebegin','<p id="team-result-clock">资料参考 '+esc(date(bundle.asOf))+' · 实际完成 '+esc(date(run.completedAt))+'</p><p class="team-error" id="team-result-review">'+(review?.output?.verdict==='accept'?'研究已完成依据核对；使用前仍须核对后续事实。':'本记录缺少完整的依据核对，原文保留供复核。')+' 参考点后的观察窗不等于完成后的一小时；没有后续数据时，是否触发为未知。</p>');
      const details=document.createElement('details');details.id='team-effective-claims';details.innerHTML='<summary>查看有效主张与版本</summary>'+ledger.map(c=>'<article><h3>'+esc(ROLES[c.role].name)+' / '+esc(c.claimId)+' · '+esc(c.state)+'</h3><p>原主张：'+esc(c.originalText)+'</p><p>有效内容：'+esc(c.effectiveText??'已撤回，不作为综合依据')+'</p><code>'+esc(c.effectiveClaimHash)+'</code></article>').join('');find('team-result').append(details);
    }
    find('team-roles').innerHTML=Object.entries(ROLES).map(([role,info])=>{const tasks=run.tasks.filter(t=>t.role===role);return `<button class="team-role ${selected===role?'is-selected':''}" data-role="${role}"><strong>${esc(info.name)}</strong><span>${tasks.filter(t=>t.receipt).length} 份结果</span></button>`;}).join('');
    const tasks=run.tasks.filter(t=>t.role===selected&&t.receipt);
    find('team-detail').innerHTML=tasks.map(t=>{const out=t.receipt.output;return `<section class="team-panel"><h2>${esc(ROLES[t.role].name)} · ${esc(labels[t.stage])}</h2><p>${prose(out.summary)}</p>${out.claims.map(c=>`<article class="team-claim"><h3>${esc(c.text)}</h3><p>${esc(c.kind)} · ${esc(c.reasoning)}</p><p>反证：${esc(c.counterEvidence)}</p><details><summary>查看依据</summary>${c.evidenceRefs.map(ref=>{const observation=run.snapshot.observations.find(o=>o.id===ref);return `<p><code>${esc(ref)}</code></p><pre class="team-raw">${esc(JSON.stringify(observation,null,2))}</pre>`;}).join('')}</details></article>`).join('')}${out.challenges.map(c=>`<p><strong>质疑 ${esc(ROLES[c.targetRole].name)} / ${esc(c.claimId)}</strong><br>${esc(c.reason)}</p>`).join('')}${out.responses.map(r=>`<p><strong>${esc(r.challengeId)} · ${esc(r.disposition)}</strong><br>${esc(r.explanation)}${r.replacementText?'<br>'+esc(r.replacementText):''}</p>`).join('')}<details><summary>任务与接收回执</summary><p>${esc(date(t.receipt.receivedAt))}</p><code>${esc(t.taskId)}</code><p>输出 ${esc(t.receipt.outputHash)}</p><p>来源声明 ${esc(JSON.stringify(t.receipt.provenance))}</p></details></section>`;}).join('');
    let task=null;if(run.mode==='manual')task=selectedTask();
    find('team-prompt').textContent=task?.prompt||'当前角色没有待接收任务；选择本阶段尚未完成的角色。';
    find('team-copy-prompt').disabled=!task;find('team-receive').disabled=!task;
  }
  function provider(){auth={available:false};find('team-provider').textContent='这里保留资料准备、手工研究与旧记录；新的团队分析请进入首席决策台。';paint();}
  async function refreshHistory(){if(['localhost','127.0.0.1'].includes(location.hostname)){try{serverHistory=(await request('runs')).runs;}catch{}}paint();}
  async function prepare(){
    const ticket=++serial;controller?.abort();controller=new AbortController();const abortTimer=setTimeout(()=>controller?.abort(),90000);busy=true;feedback('正在准备本次研究的市场资料…');paint();
    try{const snapshot=await captureDesk(engine,find('team-question').value,{signal:controller.signal,selection});if(disposed||ticket!==serial)return false;run=createRun(snapshot,{mode:'manual'});selected='structure';feedback('研究资料已准备；来源不足的部分会保留限制。');return true;}
    catch(error){if(!disposed&&ticket===serial)feedback(error.message,true);}finally{clearTimeout(abortTimer);if(ticket===serial){controller=null;busy=false;paint();}}
  };
  find('team-freeze').onclick=prepare;
  find('team-run').onclick=async()=>{if(busy)return;if(!run||run.mode!=='manual'||run.status!=='first'||run.snapshot.question!==find('team-question').value.trim()){if(!await prepare())return;}if(!run||disposed)return;const ticket=++serial,snapshot=run.snapshot;clearTimeout(poll);busy=true;paint();feedback('正在开始研究…');
    const openStarted=async id=>{const opened=restoreSession(await request('runs/'+id));if(disposed||ticket!==serial)return false;if(opened.snapshot.snapshotId!==snapshot.snapshotId)throw Error('后台任务使用另一份固定输入；请从研究记录查看');run=opened;selected='structure';feedback('研究已开始；切页后可从记录中查看。');startPoll();return true;};
    try{const state=await request('runs',{method:'POST',body:JSON.stringify({snapshot})});if(disposed||ticket!==serial)return;await openStarted(state.runId);}
    catch(error){if(disposed||ticket!==serial)return;try{const state=await request('status');if(disposed||ticket!==serial)return;auth=state;if(state.activeRunId&&await openStarted(state.activeRunId))return;}catch{}if(ticket===serial)feedback('启动回执未确认：'+error.message+'。请从研究记录核对后台任务，勿重复启动。',true);await refreshHistory();}finally{if(ticket===serial){busy=false;paint();}}
  };
  function startPoll(){clearTimeout(poll);const ticket=serial,id=run?.runId,current=()=>!disposed&&ticket===serial&&run?.runId===id;const tick=async()=>{if(!current()||run.mode!=='codex_cli')return;
    try{const state=await request('runs/'+id+'/summary');if(!current())return;if(state.revision!==run.audit.length){const updated=restoreSession(await request('runs/'+id));if(!current())return;run=updated;paint();}
      if(['complete','failed','cancelled'].includes(state.status)){try{saveHistory(run);}catch(error){feedback(error.message,true);}history=readHistory();await refreshHistory();if(!current())return;feedback(labels[state.status]+(state.failure?'：'+state.failure:''),state.status==='failed');return;}
    }catch(error){if(current())feedback(error.message,true);return;}if(current())poll=setTimeout(tick,3000);};poll=setTimeout(tick,1500);}
  find('team-cancel').onclick=async()=>{const ticket=++serial,id=run?.runId;clearTimeout(poll);controller?.abort();controller=null;busy=false;if(run){if(run.mode==='codex_cli'){try{await request('runs/'+id+'/cancel',{method:'POST',body:'{}'});}catch(error){if(ticket===serial)feedback(error.message,true);return;}}if(disposed||ticket!==serial||run?.runId!==id)return;cancelRun(run);feedback('研究已取消，迟到结果不会接收。');}else feedback('已取消资料读取。');paint();};
  find('team-export').onclick=()=>run&&download('BTC-research-'+run.runId+'.json',exportSession(run));
  retryButton.onclick=async()=>{if(!run||busy)return;const ticket=++serial,id=run.runId;clearTimeout(poll);busy=true;paint();feedback('正在续跑未完成阶段；已接收结果和原输入保留…');
    try{await request('runs/'+id+'/retry',{method:'POST',body:'{}'});if(disposed||ticket!==serial)return;const updated=restoreSession(await request('runs/'+id));if(disposed||ticket!==serial)return;run=updated;selected=pendingRoles(run)[0]||'synthesis';feedback('已续跑未完成阶段；综合与审核各最多15分钟，整轮最多40分钟。');startPoll();}
    catch(error){if(ticket===serial){feedback('续跑回执未确认：'+error.message+'。请从研究记录核对，勿重复启动。',true);await refreshHistory();}}finally{if(ticket===serial){busy=false;paint();}}
  };
  find('team-import').onchange=async event=>{const file=event.target.files?.[0];if(!file)return;const ticket=++serial;clearTimeout(poll);if(file.size>32*1024*1024){feedback('研究记录超过32MB上限',true);if(run?.mode==='codex_cli')startPoll();return;}
    try{const imported=restoreSession(JSON.parse(await file.text()));if(disposed||ticket!==serial)return;run=imported;busy=false;selected='synthesis';find('team-question').value=run.snapshot.question;const storageNote=saveHistory(run);history=readHistory();feedback('已打开研究记录，保留当时的资料与原始结论。'+storageNote);paint();if(run.mode==='codex_cli'&&!['complete','failed','cancelled'].includes(run.status))startPoll();}catch(error){if(ticket===serial){feedback('无法恢复：'+error.message,true);if(run?.mode==='codex_cli')startPoll();}}event.target.value='';};
  find('team-copy-prompt').onclick=async()=>{const task=selectedTask();if(task){try{await navigator.clipboard.writeText(task.prompt);feedback('当前模块提示词已复制。');}catch{feedback('请从展开的提示词中手动复制。');}}};
  find('team-receive').onclick=()=>{try{const task=selectedTask();if(!task)throw Error('当前角色没有待接收任务');receiveOutput(run,task.taskId,JSON.parse(find('team-output').value),{mode:'manual',source:'user_attested_ai_session'});find('team-output').value='';selected=pendingRoles(run)[0]||'synthesis';saveHistory(run);history=readHistory();feedback('结果已校验接收。');paint();}catch(error){feedback('拒绝接收：'+error.message,true);}};
  root.onclick=async event=>{const role=event.target.closest('[data-role]');if(role){selected=role.dataset.role;paint();return;}const item=event.target.closest('[data-run]');if(item){const ticket=++serial;clearTimeout(poll);try{const opened=item.dataset.runSource==='host'?restoreSession(await request('runs/'+encodeURIComponent(item.dataset.run))):history.find(r=>r.runId===item.dataset.run)||(workspace?.getReaderSession()?.runId===item.dataset.run?workspace.getReaderSession():null);if(!opened)throw Error('所选本机记录不存在；未替换为其他记录');if(disposed||ticket!==serial)return;run=opened;busy=false;selected='synthesis';find('team-question').value=run.snapshot.question;paint();if(run.mode==='codex_cli'&&!['complete','failed','cancelled'].includes(run.status))startPoll();}catch(error){if(ticket===serial)feedback(error.message,true);}}};
  await provider();if(!disposed)await refreshHistory();
  const requested=workspace?.query().get('runId'),origin=workspace?.query().get('source');
  if(requested&&!disposed){try{const local=history.find(item=>item.runId===requested)||(workspace?.getReaderSession()?.runId===requested?workspace.getReaderSession():null);const opened=origin==='local'?local:origin==='host'?restoreSession(await request('runs/'+encodeURIComponent(requested))):local;if(!opened)throw Error('指定记录不存在；未替换为其他记录');run=opened;selected='synthesis';find('team-question').value=run.snapshot.question;scope.textContent='正在阅读 '+date(run.createdAt)+' 的研究记录';paint();if(run.mode==='codex_cli'&&!['complete','failed','cancelled'].includes(run.status))startPoll();}catch(error){feedback(error.message,true);}}
  return ()=>{disposed=true;++serial;controller?.abort();clearTimeout(poll);root.onclick=null;};
}
