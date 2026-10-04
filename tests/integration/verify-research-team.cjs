'use strict';
const assert=require('node:assert/strict');
const evidence=require('../../js/evidence-bundle.js');
const identity=require('../../js/content-identity.js');
(async()=>{
  const m=await import('../../js/research-v2/index.mjs');
  const at='2026-10-01T00:00:00.000Z',t=Date.parse(at),bar={t:t-900000,o:100,h:102,l:99,c:101,v:8,closed:true};
  const payloads={chart:{scope:'chart',series:[bar],instrumentId:'BINANCE:USDM:BTCUSDT:PERPETUAL',interval:'15m'},orderflow:{scope:'orderflow',series:[{...bar,buyVol:5,sellVol:3,delta:2,volume:8,levels:[{price:101,buyVol:5,sellVol:3}]}]},heatmap:{scope:'heatmap',byExchange:{binance:{buckets:[{bucket_start:t-300000,long_notional:0,short_notional:10}]}}},context:{scope:'context',contract:{premium:{values:{markPrice:101,lastFundingRate:0},units:{lastFundingRate:'decimal'}}}},events:{report:{events:[],note:'synthetic missing-source test'}}};
  const resources=Object.entries(payloads).map(([name,data])=>({name,data,url:'https://fixture.invalid/'+name,ok:true,accessedAt:at}));
  const bundle=evidence.build({kind:'team_research',asOf:at,knowledgeCutoff:at,capturedAt:at,resources});
  const snapshot=m.createSnapshot({bundle,question:'synthetic workflow acceptance',artifacts:resources.map(r=>({scope:r.name,url:r.url,receivedAt:at,status:200,body:JSON.stringify(r.data)}))});
  assert.equal(snapshot.registryVersion,3);assert.ok(snapshot.observations.some(o=>o.path==='/byExchange/binance'));
  const run=m.createRun(snapshot,{mode:'mock'}),first=[];
  const output=task=>({taskId:task.taskId,runId:task.runId,snapshotId:task.snapshotId,role:task.role,stage:task.stage,summary:'synthetic acceptance',confidence:'low',probability:null,probabilityStatus:'not_provided',decision:null,claims:[],challenges:[],responses:[],scenarios:[],dispositions:[],limitations:['synthetic only'],nextObservations:[]});
  const take=(task,out)=>m.receiveOutput(run,task.taskId,out,{mode:'mock',fixture:true});
  for(const role of m.FIRST_ROLES){const task=m.createTask(run,role);assert.equal(task.input.dependencies.length,0);assert.ok(task.input.observations.every(o=>m.ROLES[role].scopes.includes(o.scope)));const out=output(task);out.claims=[{id:role+'-c',text:'original '+role,kind:'observation',evidenceRefs:[task.input.observations[0].id],reasoning:'synthetic',counterEvidence:'source unknown'}];
    assert.throws(()=>m.receiveOutput(run,task.taskId,out,{mode:'manual'}),/wrong_output_mode/);
    assert.throws(()=>take(task,{...out,role:'synthesis'}),/wrong_role/);
    assert.throws(()=>take(task,{...out,probability:.5,probabilityStatus:'raw_uncalibrated'}),/registered_outcome/);
    assert.throws(()=>take(task,{...out,claims:[{...out.claims[0],evidenceRefs:['forged']}]}),/invalid_evidence_reference/);
    take(task,out);first.push(task);assert.throws(()=>take(task,out),/duplicate_receipt|wrong_or_late_task/);
  }
  const challenge=m.createTask(run,'challenger'),co=output(challenge);
  co.challenges=['structure','derivatives','macro'].map((role,i)=>({id:'q'+i,targetRole:role,claimId:role+'-c',reason:'test assigned challenge',evidenceRefs:[snapshot.observations[0].id]}));take(challenge,co);
  const dispositions={structure:'revise',derivatives:'concede',macro:'maintain'};
  for(const role of m.pendingRoles(run)){const task=m.createTask(run,role);assert.ok(task.input.dependencies.every(d=>d.role===role||d.role==='challenger'));const out=output(task),q=task.input.dependencies.find(d=>d.role==='challenger').output.challenges;
    out.responses=q.map(c=>({challengeId:c.id,disposition:dispositions[role],explanation:'test',replacementText:role==='structure'?'revised structure':null,evidenceRefs:[task.input.observations[0].id]}));assert.throws(()=>take(task,{...out,responses:[]}),/response_coverage/);take(task,out);
  }
  assert.equal(run.status,'synthesis');const task=m.createTask(run,'synthesis'),out=output(task);out.decision='insufficient';out.scenarios=[{name:'wait',trigger:'new closed bar',confirmation:'source valid',invalidation:'gap',implication:'review',evidenceRefs:[snapshot.observations[0].id]}];out.nextObservations=['read source'];
  const sealedReceipts=identity.contentId(run.tasks.filter(t=>t.receipt));m.failRun(run,'synthetic bounded timeout');m.resumeFailedRun(run);assert.equal(run.status,'synthesis');assert.equal(identity.contentId(run.tasks.filter(t=>t.receipt)),sealedReceipts);assert.equal(m.createTask(run,'synthesis').taskId,task.taskId);assert.deepEqual(m.restoreSession(m.exportSession(run)),m.clone(run));
  out.dispositions=task.input.effectiveClaims.map(c=>({role:c.role,claimId:c.claimId,decision:c.state==='withdrawn'?'reject':c.state==='revised'?'revise':c.state==='unresolved'?'unresolved':'retain',reason:c.effectiveText||'withdrawn',evidenceRefs:[snapshot.observations[0].id]}));
  for(const role of ['structure','derivatives','macro']){const invalid=m.clone(out);invalid.dispositions.find(d=>d.role===role).decision='retain';assert.throws(()=>take(task,invalid),/withdrawn_claim_retained|old_revision_retained|unresolved_challenge_erased/);}
  take(task,out);assert.equal(run.status,'complete');assert.deepEqual(m.restoreSession(m.exportSession(run)),m.clone(run));
  assert.throws(()=>m.resumeFailedRun(run),/only_failed/);
  const pending=m.createRun(snapshot,{mode:'manual'});m.createTask(pending,'structure');const mutated=m.exportSession(pending);mutated.run.tasks[0].input.observations.push({id:'forged',scope:'context',value:123});const {contentHash,...rest}=mutated;mutated.contentHash=identity.contentId(rest);assert.throws(()=>m.restoreSession(mutated),/task_restore_mismatch/);
  const cancellation=m.createRun(snapshot,{mode:'mock'}),ct=m.createTask(cancellation,'structure');m.cancelRun(cancellation);assert.throws(()=>m.receiveOutput(cancellation,ct.taskId,output(ct),{mode:'mock'}),/run_not_active/);
  assert.throws(()=>m.resumeFailedRun(cancellation),/only_failed/);
  const partial=m.createRun(snapshot,{mode:'mock'}),partialTask=m.createTask(partial,'structure');m.failRun(partial,'synthetic first-stage timeout');m.resumeFailedRun(partial);assert.equal(partial.status,'first');assert.equal(m.createTask(partial,'structure').taskId,partialTask.taskId);
  console.log('PASS synthetic role isolation, identity/mode/ref rejection, assigned responses, effective revision/withdrawal/disagreement, import tampering and cancel');
  const originalNow=Date.now;let clock=t+120000;Date.now=()=>clock;
  try{
    const source={venue:'binance',instrumentId:'BINANCE:USDM:BTCUSDT:PERPETUAL',symbol:'BTCUSDT',interval:'1m',sourceHost:'fapi.binance.com',endpoint:'https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1m',units:'USDT/BTC'};
    const spec={runId:run.runId,snapshotId:snapshot.snapshotId,source,reference:{t:clock-60000,c:100,closed:true},issuedAt:new Date(clock).toISOString(),targetStart:clock+60000,targetAt:clock+120000};
    const forecast=m.registerForecast(spec);assert.equal(forecast.probability,null);assert.throws(()=>m.registerForecast({...spec,reference:{...spec.reference,c:Infinity}}),/reference/);
    assert.throws(()=>m.registerForecast({...spec,targetAt:spec.targetStart+1000}),/forecast/);
    assert.throws(()=>m.registerForecast({...spec,issuedAt:'2099-01-01T00:00:00Z'}),/forecast|reference/);
    assert.equal(m.settleForecast(forecast,{source,receivedAt:new Date(clock).toISOString()}).status,'pending');
    clock=forecast.targetAt+1000;const receivedAt=new Date(clock).toISOString(),body=JSON.stringify([[forecast.targetStart,100,102,99,101,8,forecast.targetAt-1]]),artifact={url:source.endpoint,receivedAt,body},artifactHash='sha256:'+identity.sha256(body),target={t:forecast.targetStart,c:101,closed:true};
    const settled=m.settleForecast(forecast,{source,target,receivedAt,artifactHash,artifact});assert.equal(settled.outcome,1);assert.equal(settled.brier,null);
    assert.throws(()=>m.settleForecast(forecast,{source,target,receivedAt,artifactHash,artifact:{...artifact,url:source.endpoint.replace('BTCUSDT','ETHUSDT')}}),/artifact_mismatch/);
    assert.throws(()=>m.settleForecast(forecast,{source,target,receivedAt,artifactHash,artifact:{...artifact,body:'[]'}}),/artifact_mismatch/);
    assert.equal(m.settleForecast(forecast,{source,target:{...target,closed:false},receivedAt}).status,'pending');
    clock=forecast.targetAt+forecast.spec.graceMs+1;assert.equal(m.settleForecast(forecast,{source,receivedAt:new Date(clock).toISOString()}).status,'unresolved');
  }finally{Date.now=originalNow;}
  const bars=Array.from({length:12},(_,i)=>({t:t+i*60000,c:100+i,closed:true}));assert.deepEqual(m.historicalDiagnostic(bars),m.historicalDiagnostic(bars));assert.equal(m.historicalDiagnostic(bars).accuracy,1);assert.equal(m.historicalDiagnostic(bars).alwaysUpBaseline,1);assert.ok(m.historicalDiagnostic(bars.filter((_,i)=>i!==7)).unresolved>0);
  console.log('PASS synthetic exact source/product/interval, finite values, cutoff/forming/late/missing/altered artifact, null probability and deterministic historical baseline');
})().catch(e=>{console.error(e);process.exitCode=1;});
