'use strict';
// Network-free structural audit fixtures. These are not real provider/model receipts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const evidence = require('../../js/evidence-bundle.js');
const identity = require('../../js/content-identity.js');

(async () => {
  const m = await import('../../js/research-v2/index.mjs');
  const reviewModule = await import('../../js/research-v2/synthesis-review.mjs');
  const at = '2026-10-01T00:00:00.000Z', t = Date.parse(at);
  const bar = {t:t-900000,o:100,h:102,l:99,c:101,v:8,closed:true};
  const payloads = {
    chart:{scope:'chart',series:[bar],instrumentId:'BINANCE:USDM:BTCUSDT:PERPETUAL',interval:'15m'},
    orderflow:{scope:'orderflow',series:[{...bar,buyVol:5,sellVol:3,delta:2,volume:8}]},
    heatmap:{scope:'heatmap',byExchange:{binance:{buckets:[]}}},
    context:{scope:'context',contract:{premium:{values:{markPrice:101,lastFundingRate:0},units:{lastFundingRate:'decimal'}}}},
    events:{report:{events:[],note:'synthetic-only source'}},
  };
  const resources = Object.entries(payloads).map(([name,data]) => ({name,data,url:'https://fixture.invalid/'+name,ok:true,accessedAt:at}));
  const bundle = evidence.build({kind:'team_research',asOf:at,knowledgeCutoff:at,capturedAt:at,resources});
  const snapshot = m.createSnapshot({bundle,question:'synthetic synthesis-review negative cases',artifacts:resources.map(r => ({scope:r.name,url:r.url,receivedAt:at,status:200,body:JSON.stringify(r.data)}))});
  const output = task => ({taskId:task.taskId,runId:task.runId,snapshotId:task.snapshotId,role:task.role,stage:task.stage,summary:'synthetic-only review fixture',confidence:'low',probability:null,probabilityStatus:'not_provided',decision:null,claims:[],challenges:[],responses:[],scenarios:[],dispositions:[],limitations:['synthetic fixture; not a real model completion'],nextObservations:[]});
  const provenance = task => ({mode:'codex_cli',auth:'chatgpt',completed:true,threadId:'fixture-'+task.taskId,fixture:true});

  function prepare(promptVersion, semanticVariant) {
    const run = m.createRun(snapshot,{mode:'codex_cli',...(promptVersion ? {promptVersion} : {})});
    for (const role of m.FIRST_ROLES) {
      const task=m.createTask(run,role), out=output(task);
      const semanticTexts={structure:'一根已闭合价格从100涨至101，可以确定BTC在资料参考点后的一小时继续上涨。',derivatives:'封存premium记录的标记价为101、资金费率为0。',macro:'context没有宏观来源字段，宏观方向未知。',events:'事件列表为空但来源覆盖不明，不能据此认定没有事件。'};
      out.claims=[{id:role+'-claim',text:semanticVariant?semanticTexts[role]:'original '+role,kind:semanticVariant&&role==='structure'?'inference':'observation',evidenceRefs:[task.input.observations[0].id],reasoning:semanticVariant&&role==='structure'?'已闭合栏价格上涨，因此可以确定下一小时方向。':'synthetic-only',counterEvidence:'source qualification unknown'}];
      m.receiveOutput(run,task.taskId,out,provenance(task));
    }
    const challenger=m.createTask(run,'challenger'), challenge=output(challenger);
    challenge.challenges=(semanticVariant?['structure']:['structure','derivatives','macro']).map((role,i) => ({id:'q-'+i,targetRole:role,claimId:role+'-claim',reason:semanticVariant?'一根历史价格栏只证明已发生的变化，无法保证下一小时方向；请撤回方向保证或改为无法判断。':'synthetic challenge',evidenceRefs:[snapshot.observations[0].id]}));
    m.receiveOutput(run,challenger.taskId,challenge,provenance(challenger));
    const responseKind={structure:semanticVariant||'concede',derivatives:'revise',macro:'maintain'};
    for (const role of m.pendingRoles(run)) {
      const task=m.createTask(run,role), out=output(task);
      out.responses=task.input.dependencies.find(d => d.stage==='challenge').output.challenges.map(q => ({challengeId:q.id,disposition:responseKind[role],explanation:semanticVariant?'原始栏不支持未来方向保证，接受该质疑。':'synthetic reply',replacementText:semanticVariant==='revise'?'原始栏只说明该栏价格从100涨至101，下一小时方向无法确定。':role==='derivatives'?'revised derivatives':null,evidenceRefs:[snapshot.observations[0].id]}));
      m.receiveOutput(run,task.taskId,out,provenance(task));
    }
    const task=m.createTask(run,'synthesis'), candidate=output(task);
    candidate.decision='insufficient';
    candidate.scenarios=[{name:'observe',trigger:'new source',confirmation:'qualified closed bar',invalidation:'missing source',implication:'recheck only',evidenceRefs:[snapshot.observations[0].id]}];
    candidate.nextObservations=['collect a qualified source'];
    candidate.dispositions=task.input.effectiveClaims.map(c => ({role:c.role,claimId:c.claimId,decision:c.state==='withdrawn'?'reject':c.state==='revised'?'revise':c.state==='unresolved'?'unresolved':'retain',reason:c.effectiveText||'withdrawn',evidenceRefs:[snapshot.observations[0].id]}));
    return {run,task,candidate};
  }

  function attestation(fixture) {
    const {task,candidate}=fixture, review=reviewModule.buildSynthesisReview(task,candidate,at);
    const audit={auditId:review.auditId,taskId:task.taskId,outputHash:identity.contentId(candidate),verdict:'accept',summary:'synthetic accept declaration; not a semantic correctness proof',basis:task.input.effectiveClaims.map(c => ({role:c.role,claimId:c.claimId,effectiveClaimHash:c.effectiveClaimHash,disposition:candidate.dispositions.find(d => d.role===c.role&&d.claimId===c.claimId).decision})),issues:[]};
    return {...provenance(task),semanticAudit:{version:review.version,auditId:review.auditId,promptHash:review.promptHash,input:m.clone(review.input),output:audit,provenance:{...provenance(task),threadId:'fixture-review-'+task.taskId}}};
  }
  const deliver=(f,p) => m.receiveOutput(f.run,f.task.taskId,f.candidate,p);
  let failures=0;
  function check(name,fn) {try {fn();console.log('PASS '+name);} catch(e) {failures++;console.log('FAIL '+name+': '+e.message);}}
  function mustReject(name,alter) {
    check(name,() => {const f=prepare(),p=attestation(f);alter(f,p);assert.throws(() => deliver(f,p));assert.equal(f.run.status,'synthesis');assert.equal(f.run.tasks.at(-1).receipt,null);});
  }

  check('valid synthetic review binds all effective versions and restores structurally',() => {
    const f=prepare();deliver(f,attestation(f));assert.equal(f.run.status,'complete');assert.equal(m.restoreSession(m.exportSession(f.run)).status,'complete');
  });
  mustReject('missing semantic review cannot complete latest CLI run',(f,p) => {delete p.semanticAudit;});
  mustReject('reject verdict cannot complete latest CLI run',(f,p) => {p.semanticAudit.output.verdict='reject';p.semanticAudit.output.issues=[{location:'summary',claimId:null,reason:'withdrawn claim reintroduced',evidenceRefs:[snapshot.observations[0].id]}];});
  mustReject('wrong audit task identity',(f,p) => {p.semanticAudit.output.taskId='wrong-task';});
  mustReject('wrong candidate output hash',(f,p) => {p.semanticAudit.output.outputHash='sha256:wrong';});
  mustReject('stale effective-claim version',(f,p) => {p.semanticAudit.output.basis[0].effectiveClaimHash='sha256:stale';});
  mustReject('incomplete effective-claim basis',(f,p) => {p.semanticAudit.output.basis.pop();});
  mustReject('duplicate effective-claim basis',(f,p) => {p.semanticAudit.output.basis[1]=m.clone(p.semanticAudit.output.basis[0]);});
  mustReject('wrong disposition binding',(f,p) => {p.semanticAudit.output.basis[0].disposition='retain';});
  mustReject('changed candidate after review',(f,p) => {f.candidate.summary='different candidate';});
  mustReject('changed prompt hash',(f,p) => {p.semanticAudit.promptHash='changed';});
  mustReject('accept with nonempty issues',(f,p) => {p.semanticAudit.output.issues=[{location:'summary',claimId:null,reason:'must reject',evidenceRefs:[]}];});
  mustReject('saved reviewer original input cannot differ from canonical task',(f,p) => {p.semanticAudit.input.input.observations[0].value={forged:'not the reviewed raw input'};});
  mustReject('saved reviewer candidate cannot differ from accepted candidate',(f,p) => {p.semanticAudit.input.candidate.summary='never reviewed this candidate';});
  mustReject('outer review audit identity must match rebuilt review',(f,p) => {p.semanticAudit.auditId='sha256:other-audit';});
  mustReject('outer review version must match rebuilt review',(f,p) => {p.semanticAudit.version='unsupported-review-version';});
  check('restore rechecks saved reviewer input after outer session hash is recomputed',() => {
    const f=prepare();deliver(f,attestation(f));const saved=m.exportSession(f.run);
    saved.run.tasks.at(-1).receipt.provenance.semanticAudit.input.candidate.summary='changed saved reviewer candidate';
    const {contentHash,...content}=saved;saved.contentHash=identity.contentId(content);
    assert.throws(() => m.restoreSession(saved));
  });
  check('previous .2 CLI prompt also requires semantic review',() => {
    const f=prepare('bitdesk.research.prompt.2026-10-02.2');
    assert.throws(() => deliver(f,provenance(f.task)),/missing_synthesis_semantic_review/);
    assert.equal(f.run.status,'synthesis');
  });
  check('restored reject verdict cannot become a completed run',() => {
    const f=prepare();deliver(f,attestation(f));const saved=m.exportSession(f.run);
    const audit=saved.run.tasks.at(-1).receipt.provenance.semanticAudit.output;
    audit.verdict='reject';audit.issues=[{location:'summary',claimId:null,reason:'synthetic rejection',evidenceRefs:[]}];
    const {contentHash,...content}=saved;saved.contentHash=identity.contentId(content);
    assert.throws(() => m.restoreSession(saved),/synthesis_semantic_review_rejected/);
  });
  check('late semantic accept cannot complete a cancelled run',() => {
    const f=prepare(),p=attestation(f);m.cancelRun(f.run);
    assert.throws(() => deliver(f,p),/run_not_active/);assert.equal(f.run.status,'cancelled');
  });
  check('legacy prompt remains identifiable and is not called newly reviewed',() => {
    const f=prepare(m.VERSION);deliver(f,provenance(f.task));assert.equal(f.run.status,'complete');assert.equal(f.run.tasks.at(-1).receipt.provenance.semanticAudit,undefined);
  });
  if(process.argv.includes('--write-fixtures')) {
    const cases=['concede','revise'].map((variant,i) => {
      const f=prepare(undefined,variant),ref=f.task.input.observations[0].id;
      f.candidate.summary='接下来的一个小时BTC一定走高，研究上可采用做多方向。';
      f.candidate.decision='conditional';
      f.candidate.claims=[{id:'synthesis-direction',text:'后续一小时BTC上涨没有悬念。',kind:'inference',evidenceRefs:[ref],reasoning:'封存闭合栏100涨至101，上行结论成立。',counterEvidence:'若价格回落再观察。'}];
      m.validateOutput(f.task,f.candidate);
      return {id:'case-'+(i+1),task:f.task,candidate:f.candidate,review:reviewModule.buildSynthesisReview(f.task,f.candidate)};
    });
    const artifact={schema:'bitdesk.synthetic.semantic-review-fixtures.v1',source:'network-free synthetic tasks; not CLI authentication, real provider completions, or market conclusions',cases};
    const file=path.resolve(__dirname,'../../.artifacts/acceptance-20261002/semantic-negative-tasks.json');
    fs.mkdirSync(path.dirname(file),{recursive:true});
    const body=JSON.stringify(artifact,null,2);fs.writeFileSync(file,body);
    console.log(JSON.stringify({fixtureFile:file,bodySha256:identity.sha256(body),bytes:Buffer.byteLength(body),cases:cases.map(c => ({id:c.id,auditId:c.review.auditId,promptHash:c.review.promptHash,outputHash:c.review.input.outputHash}))}));
  }
  console.log(JSON.stringify({kind:'network-free structural audit',failures,modelCalls:0,remoteWrites:0}));
  if(failures)process.exitCode=1;
})().catch(e => {console.error(e.message);process.exitCode=1;});
