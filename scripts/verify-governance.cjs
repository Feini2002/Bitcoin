const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
const source = p => fs.readFileSync(path.join(ROOT,p),'utf8');
let passed = 0;
function check(name, action) { action(); passed++; console.log('PASS '+name); }
async function main() {
  const context = vm.createContext({ window: { BIT_DATA_API_BASE: 'https://fixture.local/' }, console, URL, URLSearchParams, AbortController, DOMException, setTimeout, clearTimeout, Date, fetch });
  vm.runInContext(source('js/config.js')+source('js/features.js')+source('js/data-engine.js')+';globalThis.engine=DataEngine;globalThis.features=FEATURES;',context);
  check('GOV-01 API override is used by data engine',()=>assert.equal(context.engine.apiBase(),'https://fixture.local'));
  check('GOV-02 all navigation entries have explicit maturity',()=> { assert.equal(context.features.length,26); assert.ok(context.features.every(x=>x.state)); });
  check('GOV-11 market-page maturity does not claim runtime availability',()=> {
    for (const pricePathAvailable of [false, true]) {
      context.window.__bitDeskChartPricePathAvailable=pricePathAvailable;
      for (const id of ['chart','orderflow','heatmap','derivatives']) {
        assert.equal(context.features.find(item=>item.id===id).state,'connected');
        const info=vm.runInContext(`featureInfo(${JSON.stringify(id)})`,context);
        assert.equal(info.label,'已接入');
        assert.match(info.note,/页内的数据来源、更新时间和错误提示/);
        assert.match(info.note,/不代表服务在线或可交易/);
      }
    }
  });
  const pending = new Map();
  context.engine.workerFetch = (url, options) => new Promise((resolve,reject) => {
    if(options.signal.aborted) return reject(new DOMException('aborted','AbortError'));
    options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')), {once:true});
    pending.set(new URL(url).searchParams.get('interval'), resolve);
  });
  const response = (interval,t) => new Response(JSON.stringify({symbol:'BTCUSDT',interval,latestT:t,klines:[{t,o:'1',h:'2',l:'1',c:'2',v:'3'}]}),{headers:{'X-Data-Source':'cloudflare-d1'}});
  const metas={};
  const a=context.engine.fetchKlinesFromD1('BTCUSDT','5m',1,{onMetadata:m=>metas.main=m});
  const b=context.engine.fetchKlinesFromD1('BTCUSDT','1d',1,{onMetadata:m=>metas.tile=m});
  pending.get('1d')(response('1d',100)); await b;
  pending.get('5m')(response('5m',200)); const rows=await a;
  check('GOV-03 concurrent timeframe metadata stays with consumer',()=> { assert.equal(metas.main.interval,'5m'); assert.equal(metas.tile.interval,'1d'); assert.equal(metas.main.source,'d1'); assert.equal(context.window.__LAST_KLINES_META,undefined); assert.equal(rows[0].c,2); });
  const cancel=new AbortController();
  const cancelled=context.engine.fetchKlinesFromD1('BTCUSDT','1h',1,{signal:cancel.signal}); cancel.abort();
  await assert.rejects(cancelled,{name:'AbortError'}); passed++; console.log('PASS GOV-04 request cancellation propagates');
  context.engine.workerFetch=async()=>new Response('<html>unavailable</html>',{status:503});
  await assert.rejects(context.engine.fetchKlinesFromD1('BTCUSDT','5m'),/503/); passed++; console.log('PASS GOV-05 service failure preserves status');
  const failedDeskRequests=[];
  context.engine.workerFetch=async url=>{failedDeskRequests.push(new URL(url).pathname);return new Response(JSON.stringify({error:'fixture service paused'}),{status:503});};
  await assert.rejects(context.engine.fetchDesk('chart'),/503/);
  check('GOV-12 desk failure retries once without a legacy fallback',()=>assert.deepEqual(failedDeskRequests,['/api/desk/chart','/api/desk/chart']));
  context.engine.workerFetch=async()=>new Response(JSON.stringify({klines:[],latestT:0}));
  const empty=await context.engine.fetchKlinesFromD1('BTCUSDT','5m');
  check('GOV-06 empty data is not fabricated',()=>assert.equal(empty.length,0));
  context.engine.workerFetch=async()=>new Response(JSON.stringify({klines:[{t:1,o:null,h:2,l:1,c:2,v:3}]}));
  await assert.rejects(context.engine.fetchKlinesFromD1('BTCUSDT','5m'),/无效数值/);passed++;console.log('PASS GOV-10 invalid prices do not become zero candles');
  // 路由的真实代码运行在最小 DOM 中，连续渲染必须取消旧挂载。
  const frameCallbacks=new Map(); let nextFrame=0; const mounted=[]; const disposed=[];
  const outlet={style:{},innerHTML:'',offsetWidth:1};
  const appContext=vm.createContext({window:{__bitDeskDisposeChart:()=>disposed.push('chart')},location:{hash:'#/chart'},console,
    $:selector=>selector==="#outlet"?outlet:null,$$:()=>[],renderFeatureNotice:()=>'',renderDemoPreview:x=>x,disableDemoControls:()=>{},FEATURE_STATE_BY_ROUTE:{},
    setBreadcrumb:()=>{},highlightNav:()=>{},
    requestAnimationFrame:fn=>{frameCallbacks.set(++nextFrame,fn);return nextFrame;},cancelAnimationFrame:id=>frameCallbacks.delete(id),
    pagePlaceholder:()=>'',pageAgentPlaceholder:()=>'',PLACEHOLDERS:{},disposeDerivatives:()=>{},
    pageResearchOverview:()=>'',initResearchOverview:()=>{},disposeResearchOverview:()=>{},
    ResearchDesk:{scaffold:()=>'',mount:kind=>mounted.push(kind),dispose:()=>{}},
  });
  for(const name of ['pageOverview','pageChart','pageOrderflow','pageHeatmap','pageDerivatives','pageYuqingEvents','pageNews','pageBoardroom','pageEnvAgent','pageCalc','pageSettings']) appContext[name]=()=>name;
  for(const name of ['initChart','initOrderflow','initHeatmap','initDerivatives','initYuqingEvents','initNews','renderEnvCharts','initSettingsPage']) appContext[name]=()=>mounted.push(name);
  vm.runInContext(source('js/app.js').replace(/init\(\);\s*$/, ''),appContext);
  vm.runInContext('render()',appContext);
  appContext.location.hash='#/news';vm.runInContext('render()',appContext);
  for(const fn of frameCallbacks.values()) fn(); frameCallbacks.clear();
  check('GOV-07 rapid navigation mounts only final route',()=>assert.deepEqual(mounted,['daily_event']));
  appContext.location.hash='#/chart?interval=4h';
  check('GOV-08 query-bearing hash resolves consistently',()=>assert.equal(vm.runInContext('resolveRoute()',appContext),'chart'));
  vm.runInContext('render()',appContext);for(const fn of frameCallbacks.values()) fn();frameCallbacks.clear();
  appContext.location.hash='#/overview';vm.runInContext('render()',appContext);
  check('GOV-09 mounted chart is disposed once',()=>assert.deepEqual(disposed,['chart']));
  console.log('Governance: '+passed+' PASS, 0 FAIL');
}
main().catch(error=>{console.error('FAIL governance',error);process.exitCode=1;});
