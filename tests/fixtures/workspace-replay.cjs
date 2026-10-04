/* Portable deterministic UI inputs. Synthetic values, never live research. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {report}=require('./research-test-fixtures.cjs');
const identity=require('../../js/content-identity.js');
const evidence=require('../../js/evidence-bundle.js');
function snapshot(){
 const value=JSON.parse(fs.readFileSync(path.join(__dirname,'workspace-fixed.json'),'utf8'));
 if(value.fixture!==true||value.kind!=='synthetic')throw Error('fixture_declaration_required');
 for(const item of value.artifacts)if(crypto.createHash('sha256').update(item.body).digest('hex')!==item.bodySha256)throw Error('fixture_body_hash_mismatch');
 // Reject incoherent fixtures; never repair inputs while an acceptance test is running.
 const anchor=Date.parse(value.capturedAt);
 function clocks(node){if(!node||typeof node!=='object')return;
  for(const[key,child]of Object.entries(node)){
   if(['receivedAt','effectiveReceivedAt','observedAt','asOf','fetchedAt','accessedAt','storedAt'].includes(key)&&typeof child==='string'&&/^\d{4}-\d\d-\d\dT/.test(child))assert.equal(Date.parse(child),anchor,'synthetic receipt clock');
   else if(key==='referencePeriod'&&typeof child==='string'&&/^\d{4}-\d\d-\d\dT/.test(child))assert.ok(Date.parse(child)<=anchor,'future observation reference period');
   else clocks(child);
  }
  if(typeof node.value==='number'&&node.values&&typeof node.values.value==='number')assert.equal(node.value,node.values.value,'display/nested value');
  if(typeof node.value==='number'&&node.values&&typeof node.values.percentRate==='number')assert.equal(node.value,node.values.percentRate,'display/nested rate');
 }
 for(const item of value.artifacts){
  assert.equal(Date.parse(item.receivedAt),anchor);const body=JSON.parse(item.body);clocks(body);
  if(item.scope==='chart'){
   assert.equal(body.coverage.returned,body.series.length);assert.equal(body.coverage.verified,0);
   assert.deepEqual(body.returnedRange,{from:body.series[0].t,to:body.series.at(-1).t+900000});
   for(const bar of body.series){assert.ok(bar.v>0&&bar.quoteVolume/bar.v>=bar.l&&bar.quoteVolume/bar.v<=bar.h,'VWAP must lie within bar prices');assert.ok(bar.takerBuyBase>=0&&bar.takerBuyBase<=bar.v,'taker buy cannot exceed total base');assert.ok(bar.takerBuyQuote>=0&&bar.takerBuyQuote<=bar.quoteVolume);assert.ok(bar.t+900000<=anchor,'closed synthetic bar ends by anchor');assert.equal(bar.sourceVerification,'unverified');assert.equal(bar.closed,true);assert.equal(bar.windowEnded,true);assert.equal(bar.finality,'closed');}
  }
  if(item.scope==='orderflow'){
   assert.equal(body.coverage.returned,body.series.length);assert.equal(body.coverage.available,body.series.length);
   for(const bar of body.series){for(const[a,b]of Object.entries({open:'o',high:'h',low:'l',close:'c',buy_vol:'buyVol',sell_vol:'sellVol',poc_price:'pocPrice'}))assert.equal(bar[a],bar[b],'native/alias '+a);assert.equal(bar.buyVol+bar.sellVol,bar.volume);assert.equal(bar.buyVol-bar.sellVol,bar.delta);assert.equal(bar.levels.reduce((s,l)=>s+l.buyVol+l.sellVol,0),bar.volume);assert.ok(bar.levels.some(l=>l.price===bar.pocPrice));assert.ok(bar.t+300000<=anchor);}
  }
  if(item.scope==='heatmap'){
   let count=0;for(const venue of Object.values(body.byExchange)){count+=venue.buckets.length;assert.equal(venue.coverage.returned,venue.buckets.length);for(const[k,b]of Object.entries({longNotional:'long_notional',shortNotional:'short_notional',longCount:'long_count',shortCount:'short_count'}))assert.equal(venue[k],venue.buckets.reduce((s,r)=>s+r[b],0),'per-venue '+k);for(const bucket of venue.buckets){assert.ok(bucket.max_notional<=bucket.long_notional+bucket.short_notional);assert.ok(bucket.min_price<=bucket.vwap_price&&bucket.vwap_price<=bucket.max_price);assert.ok(bucket.bucket_start+300000<=anchor);}}
   assert.equal(body.coverage.returned,count);assert.equal(body.coverage.available,count);
  }
 }
 return value;
}
async function legacySession(){
 const m=await import('../../js/research-v2/index.mjs'),captured=snapshot(),at=captured.capturedAt;
 const artifacts=[...captured.artifacts,{scope:'events',url:'https://fixture.invalid/events',receivedAt:at,status:200,body:JSON.stringify(events('daily_event'))}];
 const resources=artifacts.map(a=>({name:a.scope,url:a.url,data:JSON.parse(a.body),ok:true,accessedAt:at}));
 const bundle=evidence.build({kind:'team_research',asOf:at,knowledgeCutoff:at,capturedAt:at,resources});
 const initial=m.createSnapshot({bundle,question:'固定合成页面验收：原记录、引用与导出，不是真实行情分析。',artifacts});
 const sealed=structuredClone(initial);delete sealed.snapshotId;sealed.capturedAt=at;sealed.snapshotId=identity.contentId(sealed);
 const run=m.createRun(sealed,{mode:'mock',runId:'workspace-portable-synthetic-session'});
 const output=task=>({taskId:task.taskId,runId:task.runId,snapshotId:task.snapshotId,role:task.role,stage:task.stage,summary:'固定验收样本：没有真实市场结论。',confidence:'low',probability:null,probabilityStatus:'not_provided',decision:null,claims:[],challenges:[],responses:[],scenarios:[],dispositions:[],limitations:['合成UI样本，不用于研究或交易。'],nextObservations:[]});
 for(const role of m.FIRST_ROLES){const task=m.createTask(run,role),out=output(task);out.claims=[{id:role+'-fixture',text:'本领域仅有固定合成验收资料，不能形成市场判断。',kind:'observation',evidenceRefs:[task.input.observations[0].id],reasoning:'检查原件引用与格式兼容。',counterEvidence:'没有真实市场材料。'}];m.receiveOutput(run,task.taskId,out,{mode:'mock',fixture:true});}
 const challenge=m.createTask(run,'challenger');m.receiveOutput(run,challenge.taskId,output(challenge),{mode:'mock',fixture:true});
 const task=m.createTask(run,'synthesis'),out=output(task);out.decision='insufficient';out.scenarios=[{name:'资料不足',trigger:'出现可核验资料',confirmation:'复查原件',invalidation:'来源仍未知',implication:'保留未知，不给方向',evidenceRefs:[sealed.observations[0].id]},{name:'取得新资料',trigger:'出现来源可查的原件',confirmation:'核对时间与口径',invalidation:'资料与窗口不符',implication:'重新研究，不替换旧记录',evidenceRefs:[sealed.observations[0].id]}];out.nextObservations=['检查下一份真实资料'];out.dispositions=task.input.effectiveClaims.map(c=>({role:c.role,claimId:c.claimId,decision:'retain',reason:'只保留合成样本声明。',evidenceRefs:[sealed.observations[0].id]}));
 m.receiveOutput(run,task.taskId,out,{mode:'mock',fixture:true});
 // Only metadata changes after generation; task inputs/prompts/output identities stay intact.
 run.createdAt=at;
 for(const [index,task]of run.tasks.entries()){task.createdAt=new Date(Date.parse(at)+(index*2+1)*1000).toISOString();task.receipt.receivedAt=new Date(Date.parse(at)+(index*2+2)*1000).toISOString();}
 for(const [index,event]of run.audit.entries())event.at=new Date(Date.parse(at)+(index+1)*1000).toISOString();
 run.completedAt=new Date(Date.parse(at)+60000).toISOString();
 const exported=m.exportSession(run);m.restoreSession(exported);return exported;
}
function events(kind){return {report:report(kind)};}
module.exports={snapshot,legacySession,events,identity};
