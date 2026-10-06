/* Portable synthetic replay by default. Explicit captured files stay separate; no remote writes or models. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const net = require('node:net');
const { pathToFileURL } = require('node:url');
const { chromium, expect } = require('playwright/test');

const ROOT = path.resolve(__dirname, '../..');
const label=process.env.BIT_READING_LABEL||'run-'+new Date().toISOString().toLowerCase().replace(/[:.]/g,'-');assert.match(label,/^[a-z0-9_-]{1,64}$/);
const OUT = path.join(ROOT, '.artifacts/acceptance-20261002',label);
for(const filename of ['reading-ui-report.json','result.json'])assert.equal(fs.existsSync(path.join(OUT,filename)),false,'refusing to overwrite prior reading UI receipt: '+path.join(OUT,filename));
const fixtures = require('../fixtures/workspace-replay.cjs');
const SNAPSHOT_FILE = process.env.BIT_READING_SNAPSHOT ? path.resolve(ROOT,process.env.BIT_READING_SNAPSHOT) : null;
const SESSION_FILE = process.env.BIT_READING_SESSION ? path.resolve(ROOT,process.env.BIT_READING_SESSION) : null;
const MAX_RUN_MS = Math.min(360000, Math.max(60000, Number(process.env.READING_UI_DEADLINE_MS) || 360000));
const started = Date.now();
const deadline = started + MAX_RUN_MS;
const captured = SNAPSHOT_FILE ? JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8')) : fixtures.snapshot();
let session;
const snapshotSynthetic = captured.fixture===true || captured.kind==='synthetic';
const inputMode={snapshot:SNAPSHOT_FILE?(snapshotSynthetic?'synthetic-file':'captured-file'):'synthetic-repo-fixture',session:SESSION_FILE?'explicit-file':'synthetic-repo-fixture',events:null,analysis:null};
for(const scope of ['events','analysis']){
  let artifact=captured.artifacts.find(a=>a.scope===scope);
  if(!artifact){const body=JSON.stringify(fixtures.events(scope==='events'?'daily_event':'sentiment_analysis'));artifact={scope,url:'https://fixture.invalid/'+scope,status:200,receivedAt:captured.capturedAt,body,bodySha256:crypto.createHash('sha256').update(body).digest('hex')};captured.artifacts.push(artifact);inputMode[scope]='synthetic-repo-fixture';}
  else inputMode[scope]=inputMode.snapshot;
}
const bodies = new Map(captured.artifacts.map(a => [a.scope, a]));
const payload = Object.fromEntries(captured.artifacts.map(a => [a.scope, JSON.parse(a.body)]));
const chartAsset = path.join(ROOT, 'js/vendor/lightweight-charts-4.1.3.js');
const inputDeclaration=()=>JSON.stringify(inputMode)+'; local unchanged fixture/replay, no live source or model verification';
function sessionInput(){return SESSION_FILE||{name:'portable-synthetic-session.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(session))};}
let vite, browser, browserServer, origin, watchdog, stopping = false;
const result = {
  schema: 'bitdesk.reading-ui.acceptance.v1', status: 'RUNNING', startedAt: new Date(started).toISOString(),
  deadline: new Date(deadline).toISOString(), pid: process.pid, browserPid: null,
  inputMode,
  fixtures: { snapshot: SNAPSHOT_FILE||'tests/fixtures/workspace-fixed.json', session: SESSION_FILE||'tests/fixtures/workspace-replay.cjs:legacySession', capturedAt: captured.capturedAt,
    fixtureNormalization:captured.fixtureNormalization||null,
    bodyRepresentation: 'UTF-8 decoded response body, re-encoded without changing text; not HTTP wire bytes',
    sessionAsOf: null, sessionCompletedAt: null,
    sourceDeclaration: 'Default inputs are synthetic UI fixtures. Content consistency is checked; source authenticity, PIT, live collection and model research quality are not verified.' },
  cases: [], network: [], runtime: [], reviews: [], screenshots: []
};

function checkDeadline() { if (Date.now() >= deadline || stopping) throw Error('reading UI internal deadline reached'); }
function recordNetwork(value) { if (result.network.length < 1500) result.network.push(value); }
function saveReport() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'reading-ui-report.json'), JSON.stringify(result, null, 2));
}
async function cleanup() {
  await Promise.allSettled([browser?.close(), browserServer?.close(), vite?.close()]);
}
async function reserveEphemeralPort() {
  const socket = net.createServer();
  const port = await new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => resolve(socket.address().port));
  });
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  // The socket is intentionally released before Vite binds. A competing bind is a FAIL, never retried.
  return port;
}
async function screenshot(page, name) {
  const file = path.join(OUT, name + '.png');
  await page.screenshot({ path: file, fullPage: true, timeout: 15000 });
  result.screenshots.push(file);
  return file;
}
async function focusScreenshot(page,selector,name){
  const target=page.locator(selector).first();await target.scrollIntoViewIfNeeded();
  const file=path.join(OUT,name+'.png');await page.screenshot({path:file,fullPage:false,timeout:15000});result.screenshots.push(file);
  return {file,target:selector,box:await target.boundingBox(),scope:'Visible viewport after semantic scroll; no claim of full-page coverage.'};
}
async function focusViews(page,route,label){
  const targets={overview:'#rd-home-price-path',chart:'#chart-container',orderflow:'#of-footprint-canvas',heatmap:'.heatmap-venue-block',derivatives:'[data-deriv-card="fred-dgs10"]',boardroom:'#team-result-clock'};
  const views=[await focusScreenshot(page,targets[route],label+'-'+route+'-focus')];
  if(route==='boardroom'){
    await page.locator('.team-process-details > summary').click();
    await page.locator('#team-effective-claims > summary').click();await noOverflow(page);views.push(await focusScreenshot(page,'#team-effective-claims article',label+'-boardroom-effective-focus'));
    await page.locator('[data-role="structure"]').click();views.push(await focusScreenshot(page,'#team-detail .team-panel',label+'-boardroom-role-focus'));
  }
  return views;
}
async function runCase(name, source, page, action) {
  checkDeadline();
  const row = { name, source, status: 'RUNNING', startedAt: new Date().toISOString() };
  result.cases.push(row);
  const beforeErrors = page.__runtime.length;
  try {
    row.evidence = await action() || {};
    const errors = page.__runtime.slice(beforeErrors).filter(e => !e.expected);
    assert.equal(errors.length, 0, 'unexpected runtime errors: ' + JSON.stringify(errors));
    row.status = 'PASS';
    console.log('PASS ' + name);
  } catch (error) {
    row.status = 'FAIL'; row.error = { message: error.message, stack: error.stack };
    console.error('FAIL ' + name + ': ' + error.message);
    if (!page.isClosed()) {
      try { row.failureScreenshot = await screenshot(page, name.replace(/[^\w-]/g, '-') + '-FAIL'); } catch (captureError) { row.captureError = captureError.message; }
    }
  } finally { row.completedAt = new Date().toISOString(); saveReport(); }
}

async function makeContext(viewport, theme) {
  const context = await browser.newContext({ viewport, locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
    reducedMotion: 'reduce', deviceScaleFactor: 1, serviceWorkers: 'block', acceptDownloads: true });
  context.__mode = { failFootprint: false, holdReport: null };
  context.__expectedUrls = new Set();
  await context.addInitScript(({ theme, badge }) => {
    localStorage.setItem('bit-theme', theme); localStorage.setItem('theme', theme);
    localStorage.setItem('bitdesk.workbench.chartInterval', '15m');
    localStorage.setItem('bitdesk.orderflow.settings', JSON.stringify({ interval: '5m', tickSize: 'auto',
      visibleBars: 32, loadBars: 240, showImbalance: true, showVpLevels: true }));
    document.addEventListener('DOMContentLoaded',()=>{
      const label=document.createElement('div');label.dataset.readingInput=badge;label.textContent=badge;
      label.style.cssText='position:fixed;right:8px;bottom:8px;max-width:calc(100vw - 16px);padding:4px 7px;background:#18212b;color:#fff;font:10px/1.4 sans-serif;border:1px solid #9aabbc;border-radius:4px;z-index:2147483647;pointer-events:none';
      document.body.append(label);
    },{once:true});
  }, { theme,badge:Object.values(inputMode).every(mode=>mode.startsWith('synthetic'))?'SYNTHETIC · UI 验收，非真实行情 / PIT 证明':'REPLAY · UI 验收，来源与合成成分见回执' });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    const event = { url: url.href, method: request.method(), resource: request.resourceType() };
    if (!['GET', 'HEAD'].includes(request.method())) {
      recordNetwork({ ...event, action: 'FORBIDDEN_WRITE_BLOCKED' });
      return route.fulfill({ status: 405, json: { error: 'Acceptance forbids writes/models' } });
    }
    const scope = /^\/api\/desk\/([^/]+)$/.exec(url.pathname)?.[1];
    if (scope && bodies.has(scope)) {
      const artifact = bodies.get(scope);
      const interval = url.searchParams.get('interval');
      if (scope === 'chart' && interval && interval !== payload.chart.interval) {
        context.__expectedUrls.add(url.href);
        recordNetwork({ ...event, action: 'UNCAPTURED_INTERVAL', interval });
        return route.fulfill({ status: 422, json: { error: 'No captured chart body for ' + interval } });
      }
      if (scope === 'orderflow' && context.__mode.failFootprint) {
        context.__expectedUrls.add(url.href);
        recordNetwork({ ...event, action: 'SYNTHETIC_503' });
        return route.fulfill({ status: 503, json: { error: 'Explicit synthetic cycle-switch failure' } });
      }
      recordNetwork({ ...event, action: snapshotSynthetic?'SYNTHETIC_BODY_REPLAY':'CAPTURED_BODY_REPLAY', inputMode:inputMode.snapshot, scope, sha256: artifact.bodySha256,
        requestedInterval: interval || url.searchParams.get('displayInterval'), capturedUrl: artifact.url });
      return route.fulfill({ status: artifact.status, contentType: 'application/json; charset=utf-8',
        headers: { 'X-Data-Source': artifact.url }, body: Buffer.from(artifact.body, 'utf8') });
    }
    if (url.pathname.startsWith('/api/yuqing/reports/')) {
      const scope = url.searchParams.get('kind') === 'sentiment_analysis' ? 'analysis' : 'events';
      const artifact = bodies.get(scope), row = payload[scope].report;
      if (url.pathname.endsWith('/history')) {
        recordNetwork({ ...event, action: 'DERIVED_HISTORY_METADATA', scope });
        return route.fulfill({ json: { items: row ? [{ id: row.id, generatedAt: row.generatedAt, title: row.report?.title }] : [] } });
      }
      if (context.__mode.holdReport && scope === 'events') await context.__mode.holdReport;
      const id = url.searchParams.get('id');
      if (id && id !== row?.id) {
        context.__expectedUrls.add(url.href);
        return route.fulfill({ status: 404, json: { error: 'Report not captured' } });
      }
      recordNetwork({ ...event, action: inputMode[scope].startsWith('synthetic')?'SYNTHETIC_BODY_REPLAY':'CAPTURED_BODY_REPLAY', inputMode:inputMode[scope], scope, sha256: artifact.bodySha256 });
      return route.fulfill({ status: artifact.status, contentType: 'application/json', body: Buffer.from(artifact.body, 'utf8') });
    }
    if(url.pathname==='/api/local-agent-team/presence')return route.fulfill({contentType:'text/event-stream',body:': acceptance connection\n\n'});
    if(url.pathname.startsWith('/api/local-agent-team/'))return route.fulfill({json:{chief:null,specialists:{},active:null,paused:null,history:[]}});
    if (url.pathname.startsWith('/api/local-research/')) {
      recordNetwork({ ...event, action: 'LOCAL_SERVICE_DISABLED' });
      if (url.pathname.endsWith('/status')) return route.fulfill({ json: { available: false,
        message: '本地验收：模型运行已禁用；仅打开原始研究记录。' } });
      if (url.pathname.endsWith('/runs')) return route.fulfill({ json: { runs: context.__mode.localRunList||[] } });
      if(context.__mode.localRunPayload&&url.pathname.endsWith('/runs/'+context.__mode.localRunPayload.run.runId)){
        if(context.__mode.holdLocalRun)await context.__mode.holdLocalRun;
        recordNetwork({...event,action:'SESSION_REPLAY_FOR_SYNTHETIC_RACE',inputMode:inputMode.session});return route.fulfill({json:context.__mode.localRunPayload});
      }
    }
    if (url.hostname === 'unpkg.com' && /lightweight-charts.*\.js$/.test(url.pathname)) {
      recordNetwork({ ...event, action: 'LOCAL_VENDOR_ASSET', file: chartAsset });
      return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(chartAsset) });
    }
    if (url.hostname === 'unpkg.com' && /phosphor-icons/.test(url.pathname)) {
      recordNetwork({ ...event, action: 'UNAVAILABLE_ICON_VENDOR' });
      return route.fulfill({ contentType: 'text/javascript', body: '' });
    }
    if (url.origin === origin && !url.pathname.startsWith('/api/')) return route.continue();
    context.__expectedUrls.add(url.href);
    recordNetwork({ ...event, action: 'UNCAPTURED_READ_BLOCKED' });
    return route.fulfill({ status: 503, json: { error: 'Endpoint outside captured acceptance input' } });
  });
  await context.routeWebSocket('**/*', socket => {
    recordNetwork({ url: socket.url(), action: 'WEBSOCKET_BLOCKED' }); socket.close();
  });
  return context;
}
async function makePage(context) {
  const page = await context.newPage(); page.__runtime = [];
  page.setDefaultTimeout(8000); page.setDefaultNavigationTimeout(15000);
  page.on('pageerror', error => {
    const entry = { kind: 'pageerror', message: error.message, stack: error.stack, expected: false };
    page.__runtime.push(entry); result.runtime.push(entry);
  });
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const loc = message.location(), text = message.text();
    const expected = context.__expectedUrls.has(loc.url) && /Failed to load resource|HTTP|503|422|404/i.test(text);
    const entry = { kind: 'console', message: text, location: loc, expected };
    page.__runtime.push(entry); result.runtime.push(entry);
  });
  // Fixed Date only: intervals/animation and browser acceptance waits keep their real clocks.
  await page.clock.setFixedTime(new Date(captured.capturedAt));
  return page;
}
async function goto(page, route, query = '') {
  await page.goto(origin + '/' + query + '#/' + (route==='derivatives'?'market?view=macro':route==='boardroom'?'research?view=window':route), { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#outlet h1')).toBeVisible();
  if(route==='boardroom')await openLegacy(page);
  if(route==='news'){const history=page.locator('.rd-saved-history');if(await history.count()&&!await history.evaluate(e=>e.open))await history.locator(':scope>summary').click();}
}
async function openLegacy(page){
  // The page heading precedes the async legacy mount. Wait for its input before inspecting details.
  await expect(page.locator('#team-import')).toHaveCount(1);
  const details=page.locator('details.at-legacy-tools');
  if(await details.count()){
    await expect(details.locator(':scope > summary')).toHaveText('资料准备、手工研究与旧记录');
    if(!await details.evaluate(el=>el.open))await details.locator(':scope > summary').click();
    await expect(details).toHaveAttribute('open','');await expect(page.locator('#legacy-research-root')).toBeVisible();
  }else await expect(page.locator('.team-grid')).toBeVisible();
}
async function noOverflow(page) {
  const info = await page.evaluate(() => {
    const outlet = document.querySelector('#outlet');
    return { width: innerWidth, documentWidth: document.documentElement.scrollWidth,
      outletWidth: outlet?.clientWidth, outletScrollWidth: outlet?.scrollWidth,
      offenders: [...document.querySelectorAll('#outlet *')].filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width && rect.right > innerWidth + 2 && !el.closest('.rd-table-scroll,pre,.chart-container');
      }).slice(0,12).map(el => ({ tag: el.tagName, id: el.id, class: el.className?.baseVal || el.className })) };
  });
  assert.ok(info.documentWidth <= info.width + 2, 'document overflow: ' + JSON.stringify(info));
  assert.ok(info.outletScrollWidth <= info.outletWidth + 2, 'outlet overflow: ' + JSON.stringify(info));
  return info;
}
async function loadReplay(page, route) {
  if (route === 'overview') {
    await expect(page.locator('#rd-home-refresh')).toBeEnabled();
    const last = payload.chart.series.at(-1).c.toLocaleString('en-US', { maximumFractionDigits: 2 });
    await expect(page.locator('#home-chart')).toContainText(last);
    await expect(page.locator('#rd-home-price-path .desk-time-plot')).toHaveCount(1);
    await expect(page.locator('#home-orderflow strong')).not.toBeEmpty();
  } else if (route === 'chart') {
    await page.waitForFunction(() => typeof chartOhlcv !== 'undefined' && chartOhlcv.length > 0);
    const actual = await page.evaluate(() => chartOhlcv.map(r => ({ t: r.t, c: r.c })));
    assert.deepEqual(actual, payload.chart.series.map(r => ({ t: r.t, c: r.c })), 'chart must preserve selected fixture/replay timestamps/prices');
    const last=payload.chart.series.at(-1);
    await expect(page.locator('#chart-status')).toContainText(payload.chart.interval);
    if(last.closed===true)await expect(page.locator('#chart-status')).not.toContainText('本根未收盘');
    await expect(page.locator('#chart-container canvas').first()).toBeVisible();
  } else if (route === 'orderflow') {
    await page.waitForFunction(() => typeof orderflowCanvasMeta !== 'undefined' && orderflowCanvasMeta?.visibleBars > 0 && orderflowMeta?.authoritative === true);
    assert.deepEqual(await page.evaluate(() => orderflowBars.map(r => r.t)), payload.orderflow.series.map(r => r.t));
    await expect(page.locator('#of-research-evidence')).toContainText(payload.orderflow.instrumentId);
    await orderflowWindow(page);
  } else if (route === 'heatmap') {
    await expect(page.locator('#hm-buckets .heatmap-venue-block')).toHaveCount(2);
    for (const venue of ['binance','bybit']) {
      const block = page.locator('.heatmap-venue-block').filter({ has: page.getByRole('heading', { name: venue, exact: true }) });
      await expect(block).toContainText(String(payload.heatmap.byExchange[venue].buckets.length) + ' 个 5m 桶');
      await expect(block.locator('.desk-time-plot')).toHaveCount(2);
      await expect(block).toContainText('USDT');
      const region=block.locator('[data-hm-scroll]'),hint=block.locator('.hm-scroll-hint');
      const overflow=await region.evaluate(el=>el.scrollWidth>el.clientWidth+1);
      await expect(region).toHaveAttribute('tabindex',overflow?'0':'-1');
      assert.equal(await hint.isVisible(),overflow,'scroll instruction must match actual table overflow');
      await expect(region.locator('th')).toHaveCount(4);
      if(overflow){await region.focus();await region.press('ArrowRight');await expect.poll(()=>region.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);const left=await region.evaluate(el=>el.scrollLeft);await page.evaluate(()=>refreshHeatmapView());await expect(region).toBeFocused();assert.ok(Math.abs(await region.evaluate(el=>el.scrollLeft)-left)<2,'poll redraw preserves keyboard scroll position and focus');await region.evaluate(el=>{el.scrollLeft=0;});}
    }
  } else if (route === 'derivatives') {
    await expect(page.locator('[data-deriv-card="fred-dgs10"]')).toBeVisible();
    for (const card of payload.context.groups.dailyRates.cards) {
      const el = page.locator('[data-deriv-card="' + card.id + '"]');
      await expect(el).toContainText(card.referencePeriod + '（日期）');
      await expect(el).toContainText(String(card.value));
      await expect(el).toContainText('源时效未知');
    }
    await expect(page.locator('#deriv-freq-groups')).not.toContainText('Deribit');
    assert.equal((await page.evaluate(()=>WorkbenchEvidence.capture().pages.derivatives)).parameters.view,'macro');
  } else if (route === 'boardroom') {
    await page.locator('#team-import').setInputFiles(sessionInput());
    await expect(page.locator('#team-progress')).toHaveAttribute('data-status', 'complete');
    await expect(page.locator('#team-result')).toContainText({mock:'测试样本 · 非真实研究',replay:'历史重放 · 非当前研究',manual:'对话研究 · 来源由使用者声明',codex_native:'AI 研究',codex_cli:'AI 研究'}[session.run.mode]);
    await expect(page.locator('#team-original-summary')).toContainText(session.run.tasks.find(t=>t.stage==='synthesis').receipt.output.summary);
    await expect(page.locator('#team-snapshot')).toContainText(session.run.snapshot.snapshotId);
    assert.equal(await page.locator('#team-roles [data-role]').count(), 6);
    await expect(page.locator('#team-run')).toBeHidden();
  }
}

async function orderflowWindow(page) {
  const value = await page.evaluate(() => {
    const bars = getOrderflowVisibleStudyBars(), last = bars.at(-1), canvas = document.querySelector('#of-footprint-canvas');
    const rect = canvas.getBoundingClientRect(), wrap = canvas.closest('.orderflow-canvas-wrap').getBoundingClientRect();
    return { meta: { ...orderflowCanvasMeta, visibleBarsData: undefined, volumeProfile: undefined },
      timestamps: bars.map(b => b.t), last: last && { t: last.t, delta: last.delta, poc: last.pocPrice },
      expected: last && { time: fmtOfTime(last.t), delta: fmtOfVol(last.delta), poc: fmtOfPrice(last.pocPrice) },
      scope: (()=>{const el=document.querySelector('#of-visible-scope');return el&&{first:Number(el.dataset.firstOpen),last:Number(el.dataset.lastOpen),count:Number(el.dataset.count),tick:Number(el.dataset.tick),text:el.textContent};})(),
      shown: { time: document.querySelector('#of-kpi-time').textContent, delta: document.querySelector('#of-kpi-delta').textContent,
        poc: document.querySelector('#of-kpi-poc').textContent, count: document.querySelector('#of-side-visible').textContent },
      canvas: { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, wrapBottom: wrap.bottom },
      parameters: readOrderflowState(), intervalMs: orderflowCanvas.opts.intervalMs,
      exported: WorkbenchEvidence.capture().pages.orderflow };
  });
  assert.ok(value.meta.visibleBars > 0 && value.meta.visibleBars <= value.meta.capacity, 'visible capacity');
  assert.equal(value.meta.visibleBars, value.timestamps.length);
  assert.equal(value.shown.count, String(value.timestamps.length));
  assert.deepEqual({ time: value.shown.time, delta: value.shown.delta, poc: value.shown.poc }, value.expected, 'KPI must describe visible final bar');
  assert.ok(value.canvas.bottom <= value.canvas.wrapBottom + 2, 'canvas bottom is clipped by its wrapper');
  assert.ok(value.canvas.height >= 320, 'canvas drawing height below renderer minimum');
  assert.deepEqual(value.exported.bars.map(b => b.t), value.timestamps, 'exported window must match visible timestamps');
  assert.equal(value.exported.window.displayed, value.timestamps.length);
  assert.deepEqual({first:value.scope.first,last:value.scope.last,count:value.scope.count,tick:value.scope.tick},{first:value.timestamps[0],last:value.timestamps.at(-1),count:value.timestamps.length,tick:value.meta.effectiveTickSize},'judgment scope must match the exact rendered/rebinned bars');
  assert.ok(value.scope.text.includes('棒开盘（北京时间）'),'scope states timestamp meaning');
  if(await page.evaluate(()=>orderflowCanvasMeta.visibleBarsData.some(b=>b.closed===false||b.finality==='forming')))assert.ok(value.scope.text.includes('含形成中棒；不代表完整闭合窗口'),'forming render cannot be called a complete closed window');
  return value;
}
async function downloadJson(page, selector, filename) {
  const pending = page.waitForEvent('download'); await page.locator(selector).click();
  const download = await pending, file = path.join(OUT, filename);
  await download.saveAs(file); return { file, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
}
async function receiptRefresh(page, selector, refresh) {
  const summary = page.locator(selector + ' > summary'); await summary.click(); await summary.focus();
  const pending = page.waitForResponse(r => /\/api\/desk\//.test(r.url()) && r.status() === 200);
  // Calling the actual click handler preserves summary focus while starting the same refresh action.
  await page.locator(refresh).evaluate(el => el.click()); await pending;
  await expect(page.locator(refresh)).toBeEnabled();
  await expect(page.locator(selector)).toHaveAttribute('open', ''); await expect(summary).toBeFocused();
  return { receipt: selector, open: true, focus: await summary.evaluate(el => document.activeElement === el) };
}

async function interactions(context, page, label) {
  await runCase(label+'-chart-reference-axis-density','synthetic reference-price-line presentation shape only; '+inputDeclaration(),page,async()=>{
    await goto(page,'chart');await loadReplay(page,'chart');const original=page.viewportSize();
    const before=await page.evaluate(()=>{const p=chartOhlcv.at(-1).c;drawChartStructurePriceLines({currentPrice:p,rangeContext:{upper:p+10,lower:p-10,breakout:{price:p+20}},nearContext:{support:{price:p-20}},fibonacci:{levels:[{price:p-5,ratio:0.5,role:'retracement'},{price:p+5,ratio:0.618,role:'retracement'}]}});return {data:chartOhlcv.map(b=>({t:b.t,c:b.c})),lines:chartKeyPriceLines.map(l=>({price:l.options().price,title:l.options().title})),ema:seriesEma.options().lastValueVisible,vwap:seriesVwap.options().lastValueVisible};});
    await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>chartKeyPriceLines.length>0&&chartKeyPriceLines.every(l=>l.options().axisLabelVisible===false));
    const compact=await page.evaluate(()=>({width:document.querySelector('#chart-container').getBoundingClientRect().width,lines:chartKeyPriceLines.map(l=>({price:l.options().price,title:l.options().title})),ema:seriesEma.options().lastValueVisible,vwap:seriesVwap.options().lastValueVisible,data:chartOhlcv.map(b=>({t:b.t,c:b.c}))}));
    assert.deepEqual(compact.lines,before.lines,'compact plot retains every professional reference line');assert.deepEqual(compact.data,before.data,'resize retains original chart bars');assert.equal(compact.ema,true);assert.equal(compact.vwap,true);assert.ok(compact.width<600);
    await page.setViewportSize({width:1440,height:1000});await page.waitForFunction(()=>chartKeyPriceLines.every(l=>l.options().axisLabelVisible===true));
    await page.setViewportSize(original);await goto(page,'chart');await loadReplay(page,'chart');return {lines:before.lines.length,compactWidth:compact.width,keptPrimaryLabels:['current price','EMA','VWAP'],note:'Injected presentation shapes are explicitly synthetic, not market-derived structure.'};
  });
  await runCase(label + '-overview-receipt-refresh', inputDeclaration(), page, async () => {
    await goto(page, 'overview'); await loadReplay(page, 'overview');
    const baseline=await page.locator('#home-price-change').textContent();await page.locator('#rd-home-refresh').click();await expect(page.locator('#rd-home-refresh')).toBeEnabled();await expect(page.locator('#home-price-change')).toHaveText(baseline);return {baseline};
  });
  await runCase(label + '-derivatives-receipt-refresh', inputDeclaration(), page, async () => {
    await goto(page, 'derivatives'); await loadReplay(page, 'derivatives');
    return receiptRefresh(page, '[data-receipt="fred-dgs10"]', '#deriv-refresh');
  });
  await runCase(label + '-orderflow-history-density-export', inputDeclaration()+'; native 5m footprint', page, async () => {
    await goto(page, 'orderflow'); await loadReplay(page, 'orderflow');
    await page.locator('#of-visible-bars').selectOption('64');
    const latest = await orderflowWindow(page);
    assert.equal(latest.meta.requestedBars, 64);
    await page.evaluate(()=>{window.__readingOriginalRenderMeta=orderflowCanvasMeta;orderflowCanvasMeta={...orderflowCanvasMeta,visibleBarsData:orderflowCanvasMeta.visibleBarsData.map((bar,i,rows)=>i===rows.length-1?{...bar,closed:false,finality:'forming'}:bar)};updateOrderflowResearch();});
    try{await expect(page.locator('#of-visible-scope')).toContainText('含形成中棒；不代表完整闭合窗口');}
    finally{await page.evaluate(()=>{orderflowCanvasMeta=window.__readingOriginalRenderMeta;delete window.__readingOriginalRenderMeta;updateOrderflowResearch();});}
    await page.locator('#of-prev').click();
    await page.waitForFunction(() => orderflowCanvasMeta?.scrollFromRight > 0);
    const historical = await orderflowWindow(page);
    assert.ok(historical.last.t < latest.last.t, 'history paging must move the visible last timestamp');
    const exported = await downloadJson(page, '[data-workbench-export]', label + '-orderflow-export.json');
    assert.deepEqual(exported.data.pages.orderflow.bars.map(b => b.t), historical.timestamps);
    await page.locator('#of-first').click(); const first = await orderflowWindow(page);
    assert.equal(first.timestamps[0], payload.orderflow.series[0].t);
    const canvas = page.locator('#of-footprint-canvas'); await canvas.focus(); await canvas.press('End');
    assert.equal((await orderflowWindow(page)).last.t, latest.last.t);
    await canvas.press('ArrowLeft'); assert.ok((await orderflowWindow(page)).last.t < latest.last.t);
    await page.locator('#of-latest').click();
    return { latest, historical, first, download: exported.file };
  });
  await runCase(label + '-orderflow-4h-raw-aggregation', inputDeclaration()+'; native 5m aggregated by product', page, async () => {
    await page.locator('[data-of-tf="4h"]').click();
    await page.waitForFunction(() => orderflowMeta?.displayInterval === '4h' && orderflowMeta?.authoritative === true && orderflowCanvasMeta?.visibleBars > 0);
    const view = await orderflowWindow(page); assert.equal(view.intervalMs, 14400000);
    // Independently compute bucket identities from unchanged raw timestamps, rather than copying the renderer's helper.
    const compare = { expected: [...new Set(payload.orderflow.series.map(b => Math.floor(b.t / 14400000) * 14400000))].sort((a,b) => a-b),
      actual: await page.evaluate(() => orderflowBars.map(b => b.t)) };
    assert.deepEqual(compare.actual, compare.expected);
    assert.equal(view.exported.parameters.displayInterval, '4h');
    await screenshot(page, label + '-orderflow-4h');
    return { ...view, originalSourceIntervalMs: 300000, aggregate: compare, note: 'No raw timestamps or intervals were changed.' };
  });
  await runCase(label + '-cycle-failure-clears-old-bars', 'synthetic HTTP 503; '+inputDeclaration(), page, async () => {
    context.__mode.failFootprint = true;
    try {
      await page.locator('[data-of-tf="1h"]').click();
      await page.waitForFunction(() => readOrderflowState().interval === '1h' && orderflowBars.length === 0 && orderflowMeta?.authoritative !== true);
      await expect(page.locator('#of-kpi-time')).toHaveText('--');
      const evidence = await page.evaluate(() => WorkbenchEvidence.capture().pages.orderflow);
      assert.ok(!evidence.bars?.length || evidence.parameters?.displayInterval !== '1h' || evidence.stale === true,
        'old successful bars must not be relabelled as a new successful interval');
      await screenshot(page, label + '-orderflow-synthetic-failure'); return { evidence };
    } finally { context.__mode.failFootprint = false; }
  });
  await runCase(label + '-macro-strict-values', 'synthetic formatter negative inputs, separately from raw screenshot input', page, async () => {
    await goto(page, 'derivatives'); await loadReplay(page, 'derivatives');
    const values = await page.evaluate(() => ({ zero: fmtDeskPlain(0), unknown: fmtDeskPlain(null),
      missing: fmtDeskPlain(undefined), bool: fmtDeskPlain(false), truth: fmtDeskPlain(true),
      empty: fmtDeskPlain(''), date: fmtDeskClock('2026-09-29') }));
    assert.deepEqual(values, { zero: '0', unknown: '—', missing: '—', bool: '—', truth: '—', empty: '—', date: '2026-09-29（日期）' });
    return values;
  });
}

async function boardroomRoundtrip(page) {
  await goto(page, 'boardroom'); await loadReplay(page, 'boardroom');
  await page.locator('.team-process-details > summary').click();
  for (const task of session.run.tasks) {
    await page.locator('[data-role="' + task.role + '"]').click();
    await expect(page.locator('#team-detail')).toContainText(await page.evaluate(value=>UserWorkspace.readable(value),task.receipt.output.summary));
    if(task.receipt.provenance.agentId||task.receipt.provenance.threadId)await expect(page.locator('#team-detail')).toContainText(task.receipt.provenance.agentId||task.receipt.provenance.threadId);
    else await expect(page.locator('#team-detail')).toContainText(JSON.stringify(task.receipt.provenance));
    await expect(page.locator('#team-detail')).toContainText(task.receipt.outputHash);
    if(session.run.mode==='codex_native')await expect(page.locator('#team-detail')).toContainText('public data authenticity/PIT not independently verified');
  }
  const exported = await downloadJson(page, '#team-export', 'boardroom-original-export.json');
  assert.deepEqual(exported.data, session, 'selected original session must round-trip without changing any receipt/task/source');
  const { restoreSession, exportSession } = await import(pathToFileURL(path.join(ROOT, 'js/research-v2/index.mjs')).href);
  assert.deepEqual(exportSession(restoreSession(exported.data)), session);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openLegacy(page);
  await page.locator('#team-import').setInputFiles(exported.file);
  await expect(page.locator('#team-progress')).toHaveAttribute('data-status', 'complete');
  const restored = await downloadJson(page, '#team-export', 'boardroom-restored-export.json');
  assert.deepEqual(restored.data, session);
  const clocks = { browserNow: await page.evaluate(() => new Date().toISOString()),
    inputAsOf: session.run.snapshot.bundle.asOf, completedAt: session.run.completedAt,
    inputMode,
    qualification: 'Recorded source/receipt identity does not establish public-data authenticity or PIT. Browser Date is fixed to the selected input; synthetic completion is fixture metadata, captured completion remains a source declaration.' };
  assert.equal(clocks.browserNow, captured.capturedAt);
  await screenshot(page, 'boardroom-original-restored'); return { clocks, exported: exported.file, restored: restored.file };
}
async function boardroomExtras(context,page){
  await runCase('boardroom-fixed-historical-diagnostic',inputDeclaration()+'; mathematical baseline, no model execution',page,async()=>{
    await goto(page,'boardroom');await loadReplay(page,'boardroom');
    await page.locator('#team-diagnostic').evaluate(button=>button.hidden=false);
    const output=await downloadJson(page,'#team-diagnostic','fixed-historical-diagnostic.json');
    const {historicalDiagnostic}=await import(pathToFileURL(path.join(ROOT,'js/research-v2/evaluation.mjs')).href);
    const artifact=session.run.snapshot.artifacts.find(a=>a.scope==='chart');
    const expected=historicalDiagnostic(JSON.parse(artifact.body).series,{lookback:4,horizon:1,threshold:0});
    for(const key of Object.keys(expected))assert.deepEqual(output.data[key],expected[key],key);
    assert.equal(output.data.source.bodyHash,artifact.bodySha256);assert.equal(output.data.snapshotId,session.run.snapshot.snapshotId);
    await expect(page.locator('#team-evaluation')).toContainText('不是模型回测');
    return {resolved:expected.resolved,unresolved:expected.unresolved,accuracy:expected.accuracy,alwaysUpBaseline:expected.alwaysUpBaseline,inputHash:expected.inputHash,download:output.file,focus:await focusScreenshot(page,'#team-evaluation','boardroom-fixed-historical-diagnostic-focus')};
  });
  await runCase('boardroom-late-history-cannot-replace-new-import','synthetic response delay plus '+inputDeclaration()+' and new unexecuted manual record',page,async()=>{
    const {createRun,exportSession}=await import(pathToFileURL(path.join(ROOT,'js/research-v2/index.mjs')).href);
    const fresh=exportSession(createRun(session.run.snapshot,{mode:'manual',runId:'synthetic-ui-fresh-selection'}));
    let release;context.__mode.holdLocalRun=new Promise(resolve=>release=resolve);context.__mode.localRunPayload=session;
    context.__mode.localRunList=[{runId:session.run.runId,question:'Synthetic delayed archived-record selection',createdAt:session.run.createdAt,status:'complete',mode:session.run.mode}];
    try{
      await goto(page,'boardroom','?reading-history-race=synthetic');
      const archivedRecord=page.locator('[data-run-source="host"][data-run="'+session.run.runId+'"]');
      await expect(archivedRecord).toHaveCount(1);
      await Promise.all([
        page.waitForRequest(request=>request.url().endsWith('/runs/'+session.run.runId)),
        archivedRecord.click()
      ]);
      await page.locator('#team-import').setInputFiles({name:'synthetic-unexecuted-manual.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fresh))});
      await expect(page.locator('#team-progress')).toHaveAttribute('data-run-id',fresh.run.runId);
      const response=page.waitForResponse(r=>r.url().endsWith('/runs/'+session.run.runId));release();await(await response).finished();
      const saved=await downloadJson(page,'#team-export','synthetic-new-selection-after-late-read.json');
      assert.equal(saved.data.run.runId,fresh.run.runId);await expect(page.locator('#team-progress')).toHaveAttribute('data-run-id',fresh.run.runId);
      return {rejectedLateRecord:session.run.runId,retainedUnexecutedManualRun:fresh.run.runId,download:saved.file};
    }finally{release();context.__mode.holdLocalRun=null;context.__mode.localRunPayload=null;context.__mode.localRunList=[];}
  });
}

async function previewRaces(context, page) {
  for (const variant of ['close-workflow', 'invalid-preview']) {
    await runCase('preview-race-' + variant, inputDeclaration()+'; report held by synthetic network gate; invalid JSON separately synthetic', page, async () => {
      let release; context.__mode.holdReport = new Promise(resolve => { release = resolve; });
      try {
        await goto(page, 'news', '?reading-race=' + variant);
        await expect(page.locator('#rd-feedback')).toContainText('正在读取');
        if (variant === 'close-workflow') {
          await page.locator('[data-action="workflow"]').first().click();
          await page.locator('[data-action="close-dialog"]').click();
        } else {
          await page.locator('[data-action="preview"]').click();
          await page.locator('#rd-file').setInputFiles({ name: 'explicit-invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
          await expect(page.locator('#rd-preview-errors')).not.toBeEmpty();
          await page.locator('[data-action="close-dialog"]').click();
        }
        context.__mode.holdReport = null; release();
        await expect(page.locator('#rd-feedback')).toContainText('已载入保存的研究快照');
        await expect(page.locator('#rd-content')).toContainText(payload.events.report.report.title);
        return { preservedReportId: payload.events.report.id };
      } finally { context.__mode.holdReport = null; release(); }
    });
  }
  await runCase('preview-race-late-file-after-close', 'synthetic delayed File.text plus existing explicitly labelled UI fixture', page, async () => {
    await goto(page, 'news'); await expect(page.locator('#rd-feedback')).toContainText('已载入');
    const fixture = require('../fixtures/research-test-fixtures.cjs').report('daily_event');
    await page.evaluate(() => {
      const original = File.prototype.text;
      File.prototype.text = function() {
        if (this.name === 'late-synthetic.json') return new Promise(resolve => { window.__releaseReadingPreview = () => original.call(this).then(resolve); });
        return original.call(this);
      };
    });
    await page.locator('[data-action="preview"]').click();
    await page.locator('#rd-file').setInputFiles({ name: 'late-synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) });
    await page.waitForFunction(() => typeof window.__releaseReadingPreview === 'function');
    await page.locator('[data-action="close-dialog"]').click();
    await page.locator('[data-action="workflow"]').first().click();
    await page.evaluate(() => window.__releaseReadingPreview());
    await expect(page.locator('#rd-dialog')).toBeVisible();
    await expect(page.locator('#rd-dialog-title')).toContainText('在 AI 对话中完成研究');
    await expect(page.locator('#rd-feedback')).toContainText('已载入保存的研究快照');
    await expect(page.locator('#rd-content')).toContainText(payload.events.report.report.title);
    return { rejectedLateSyntheticReport: fixture.id, retainedInputReport: payload.events.report.id };
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  watchdog = setTimeout(async () => {
    stopping = true; result.status = 'FAIL'; result.deadlineExceeded = true; saveReport();
    const force = setTimeout(() => { browserServer?.kill().catch(() => {}); process.exit(1); }, 5000);
    await cleanup(); clearTimeout(force); process.exit(1);
  }, Math.max(1, deadline - Date.now()));
  session=SESSION_FILE?JSON.parse(fs.readFileSync(SESSION_FILE,'utf8')):await fixtures.legacySession();
  const syntheticSession=session.run.mode==='mock'||session.run.tasks.some(t=>t.receipt?.provenance?.fixture===true);
  inputMode.session=SESSION_FILE?(syntheticSession?'synthetic-file':'captured-file'):'synthetic-repo-fixture';
  result.fixtures.sessionAsOf=session.run.snapshot.bundle.asOf;result.fixtures.sessionCompletedAt=session.run.completedAt;
  result.fixtures.sourceDeclaration=inputDeclaration()+'; session mode='+session.run.mode+'; authenticity/PIT not independently verified';
  for (const artifact of captured.artifacts) assert.equal(crypto.createHash('sha256').update(artifact.body, 'utf8').digest('hex'), artifact.bodySha256, artifact.scope + ' raw body integrity');
  assert.ok(fs.existsSync(chartAsset), 'existing local LightweightCharts 4.1.3 asset required; do not fetch an uncaptured substitute');
  assert.equal(session.run.status, 'complete'); assert.equal(session.run.tasks.filter(t=>t.stage==='first').length, 4);
  result.reviews.push('Phosphor external icon vendor is unavailable in local assets; icons are excluded from visual acceptance, all such requests recorded.');
  result.reviews.push('Only selected chart 15m input is replayed. Other chart intervals return an explicit gap; footprint display intervals aggregate unchanged native 5m timestamps.');
  result.reviews.push('Default inputs are synthetic. Fixed browser Date reflects their anchor; synthetic completion is fixture metadata. Captured-file authenticity, current forecast triggers and PIT are not asserted.');
  const { createServer } = await import('vite');
  const ephemeralPort = await reserveEphemeralPort();
  result.requestedPort = ephemeralPort;
  vite = await createServer({ configFile: false, root: ROOT, envDir: path.join(OUT, 'no-env'),
    cacheDir: path.join(OUT, 'vite-cache'), logLevel: 'error', appType: 'spa',
    server: { host: '127.0.0.1', port: ephemeralPort, strictPort: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true }, clearScreen: false,
    plugins:[{name:'acceptance-no-hmr-client',transformIndexHtml:{order:'post',handler:html=>html.replace(/<script\b[^>]*src="\/@vite\/client"[^>]*><\/script>/g,'')}}] });
  await vite.listen(); origin = 'http://127.0.0.1:' + vite.httpServer.address().port;
  browserServer = await chromium.launchServer({ headless: true });
  result.browserPid = browserServer.process().pid; result.origin = origin;
  browser = await chromium.connect(browserServer.wsEndpoint());
  console.log(JSON.stringify({ task: 'verify-reading-ui', pid: process.pid, browserPid: result.browserPid, origin, deadline: result.deadline }));
  if(process.env.BIT_READING_SCOPE==='preview'){result.scope='preview-only';const context=await makeContext({width:1440,height:1000},'light'),page=await makePage(context);try{await previewRaces(context,page);}finally{await context.close();}}else
  for (const [device, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    for (const theme of ['light', 'dark']) {
      const context = await makeContext(viewport, theme); const page = await makePage(context);
      try {
        for (const route of ['overview', 'chart', 'orderflow', 'heatmap', 'derivatives', 'boardroom']) {
          await runCase(device + '-' + theme + '-' + route, inputDeclaration(), page, async () => {
            await goto(page, route); await loadReplay(page, route);
            await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
            const overflow = await noOverflow(page);
            const file = await screenshot(page, device + '-' + theme + '-' + route);
            const focused=await focusViews(page,route,device+'-'+theme);
            return { overflow, screenshot: file,focused, inputCapturedAt: captured.capturedAt };
          });
        }
        if (theme === 'light') {
          await interactions(context, page, device);
          if (device === 'desktop') {
            await runCase('boardroom-original-roundtrip', inputDeclaration()+'; original '+session.run.mode+' session; no model execution', page, () => boardroomRoundtrip(page));
            await boardroomExtras(context,page);
            await previewRaces(context, page);
          }
        }
      } finally { await context.close(); }
    }
  }
  const forbidden = result.network.filter(r => r.action === 'FORBIDDEN_WRITE_BLOCKED');
  assert.equal(forbidden.length, 0, 'UI attempted an unauthorized write/model request: ' + JSON.stringify(forbidden));
  result.status = result.cases.some(row => row.status !== 'PASS') ? 'FAIL' : 'PASS';
  result.visualStatus = 'REVIEW'; // Screenshots need human review; a loaded page is not a visual PASS.
  result.completedAt = new Date().toISOString(); saveReport();
  console.log(JSON.stringify({ status: result.status, visualStatus: result.visualStatus, cases: result.cases.length,
    failures: result.cases.filter(r => r.status === 'FAIL').map(r => r.name), screenshots: result.screenshots.length,
    report: path.join(OUT, 'reading-ui-report.json') }));
  if (result.status !== 'PASS') process.exitCode = 1;
}
main().catch(error => {
  result.status = 'FAIL'; result.fatal = { message: error.message, stack: error.stack };
  result.completedAt = new Date().toISOString(); saveReport(); console.error(error.stack); process.exitCode = 1;
}).finally(async () => { clearTimeout(watchdog); await cleanup(); });
