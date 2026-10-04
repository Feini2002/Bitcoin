let researchTeamCleanup = null;
let researchTeamGeneration = 0;
function pageResearchTeam() {
  const historical = typeof UserWorkspace !== 'undefined' && UserWorkspace.query().has('runId');
  return '<header class="page-header"><div><h1 class="page-title">'+(historical?'当时的研究记录':'指定问题研究')+'</h1><div class="page-sub">'+(historical?'保留原问题、原始资料与当时的判断。':'核对所选市场区间或事件，读取团队判断与原始依据。')+'</div></div><a class="btn" href="#/boardroom">首席决策台 →</a></header><div id="research-team-root" aria-live="polite">正在打开研究…</div>';
}
async function initResearchTeam() {
  const generation=++researchTeamGeneration;
  try {const module=await import('./research-v2/ui.mjs');if(generation!==researchTeamGeneration)return;const cleanup=await module.mountTeam(document.getElementById('research-team-root'),DataEngine);if(generation!==researchTeamGeneration){cleanup?.();return;}researchTeamCleanup=cleanup;}
  catch(error){if(generation===researchTeamGeneration){const root=document.getElementById('research-team-root');if(root)root.textContent='研究室加载失败：'+error.message;}}
}
function disposeResearchTeam(){researchTeamGeneration++;researchTeamCleanup?.();researchTeamCleanup=null;}
