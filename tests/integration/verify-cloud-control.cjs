// Offline cloud lifecycle simulation: no credentials and no real network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { CloudControl, makeApi, bindings, domains, routes, probeUrl } = require('../../scripts/operations/cloud-control.cjs');
const seed = require('../../cloudflare/cloud-control-state.json');
const copy = value => structuredClone(value);
const names = ['btc', 'yuqing', 'market-snapshot'];
const base = `/accounts/${seed.accountId}`;
global.fetch = () => { throw Error('Real network forbidden in cloud-control tests'); };

function fixture() {
  const state = copy(seed), saved = [], calls = [], probes = [];
  delete state.costIncident; // Legacy lifecycle fixtures; incident behavior is tested separately.
  state.phase = 'paused';
  const live = { workers: copy(state.restore.workers), domains: [], routes: state.restore.routes.map((r, i) => ({ ...r, id: 'route-' + i, script: null })) };
  live.workers.btc.versionId = state.maintenance.versionId;
  for (const w of Object.values(live.workers)) { w.crons = []; w.subdomain = { enabled: false, previews_enabled: false }; }
  const versions = new Map(names.map(n => [state.restore.workers[n].versionId, { resources: { bindings: copy(state.restore.workers[n].bindings) } }]));
  versions.set(state.maintenance.versionId, { resources: { bindings: copy(state.restore.workers.btc.bindings) }, annotations: { 'workers/tag': 'bitdesk-paused' } });
  const otherDomain = { id: 'other-domain', hostname: 'untouched.feiniwork.com', service: 'unrelated-worker', zone_id: seed.zoneId };
  const otherRoute = { id: 'other-route', pattern: 'unrelated.feiniwork.com/*', script: 'unrelated-worker' };
  let generation = 0, tick = 0, freeze = false, failOnce = null;
  async function api(url, method = 'GET', body) {
    calls.push({ url, method, body });
    let result;
    const match = url.match(/\/workers\/scripts\/([^/]+)\/(.*)$/);
    if (match) {
      const [, name, action] = match; assert.ok(names.includes(name)); const w = live.workers[name];
      if (method === 'GET' && action === 'settings') result = { bindings: copy(w.bindings), compatibility_date: '2024-12-01', placement: { mode: 'targeted', target: [12] } };
      else if (method === 'GET' && action === 'deployments') result = { deployments: [{ versions: [{ version_id: w.versionId, percentage: 100 }] }] };
      else if (method === 'GET' && action === 'schedules') result = { schedules: w.crons.map(cron => ({ cron })) };
      else if (method === 'GET' && action === 'subdomain') result = copy(w.subdomain);
      else if (method === 'GET' && action.startsWith('versions/')) { assert.ok(versions.has(action.slice(9)), 'version available'); result = copy(versions.get(action.slice(9))); }
      else if (method === 'PUT' && action === 'schedules') { w.crons = body.map(s => s.cron); result = {}; }
      else if (method === 'POST' && action === 'subdomain') { w.subdomain = copy(body); result = {}; }
      else if (method === 'POST' && action === 'deployments') {
        assert.equal(name, 'btc'); assert.equal(body.versions.length, 1); assert.equal(body.versions[0].percentage, 100);
        w.versionId = body.versions[0].version_id; result = { id: 'deployment-' + generation };
      } else if (method === 'POST' && action === 'versions') {
        assert.equal(name, 'btc'); const metadata = JSON.parse(body.get('metadata'));
        assert.deepEqual(metadata.keep_bindings, ['plain_text', 'secret_text', 'secret_key', 'json']);
        assert.deepEqual(metadata.placement, { mode: 'targeted', region: 'aws:ap-northeast-1' });
        assert.equal(metadata.migrations, undefined);
        assert.ok(metadata.bindings.every(b => !['plain_text', 'secret_text'].includes(b.type)));
        assert.ok((await body.get(metadata.main_module).text()).includes('deleteAlarm'));
        const id = 'new-maintenance-version-' + (++generation);
        versions.set(id, { resources: { bindings: copy(w.bindings) }, annotations: metadata.annotations }); result = { id };
      } else throw Error('Unexpected worker operation: ' + method + ' ' + url);
    } else if (url === base + '/workers/domains' && method === 'GET') result = [...copy(live.domains), copy(otherDomain)];
    else if (url === base + '/workers/domains' && method === 'PUT') {
      assert.ok(names.includes(body.service)); assert.equal(body.zone_id, seed.zoneId);
      live.domains.push({ ...copy(body), id: 'domain-' + body.hostname + '-' + generation }); result = live.domains.at(-1);
    } else if (url.startsWith(base + '/workers/domains/') && method === 'DELETE') {
      const id = url.split('/').at(-1); assert.notEqual(id, otherDomain.id);
      assert.ok(live.domains.some(d => d.id === id)); live.domains = live.domains.filter(d => d.id !== id); result = null;
    } else if (url === `/zones/${seed.zoneId}/workers/routes` && method === 'GET') result = [...copy(live.routes), copy(otherRoute)];
    else if (url.startsWith(`/zones/${seed.zoneId}/workers/routes/`) && method === 'PUT') {
      const r = live.routes.find(r => r.id === url.split('/').at(-1)); assert.ok(r); Object.assign(r, copy(body)); result = copy(r);
    } else if (url === base + '/workers/durable_objects/namespaces' && method === 'GET') result = state.restore.workers.btc.bindings.filter(b => b.namespace_id).map(b => ({ id: b.namespace_id }));
    else if (url.includes('/d1/database/') && method === 'GET') result = { uuid: url.split('/').at(-1) };
    else if (url.endsWith('/query') && method === 'POST') {
      assert.match(body.sql, /^SELECT /); assert.doesNotMatch(body.sql, /\b(INSERT|DELETE|UPDATE|DROP|ALTER)\b/i);
      const isLive = body.sql.includes('finance_dataset_observations');
      if (isLive && !freeze && live.workers.btc.versionId === state.restore.workers.btc.versionId) tick++;
      result = [{ success: true, meta: { rows_written: 0 }, results: isLive ? [{ dataset_id: 'binance-perp-premium', latest: new Date(1790435000000 + tick * 1000).toISOString() }] : [{ value: 1 }] }];
    } else throw Error('Unexpected operation: ' + method + ' ' + url);
    if (failOnce?.(url, method, body)) { failOnce = null; throw Error('Simulated lost response AFTER remote success'); }
    return result;
  }
  const controller = new CloudControl({ state, api, save: s => saved.push(copy(s)), sleep: async ms => assert.equal(ms, 30000), probe: async (url, kind) => { probes.push({ url, kind }); return true; } });
  return { state, controller, live, saved, calls, probes, versions,
    fail: fn => { failOnce = fn; }, freeze: () => { freeze = true; },
    writes: () => calls.filter(c => c.method !== 'GET' && !c.url.endsWith('/query')) };
}

async function run() {
  let passed = 0;
  async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
  await test('已确认异常计费的旧版本不能恢复，预检也不得误报可恢复', async () => {
    const f=fixture();f.state.costIncident=copy(seed.costIncident);
    await assert.rejects(f.controller.resume(true),/异常计费/);
    await assert.rejects(f.controller.resume(),/异常计费/);
    assert.equal(f.calls.length,0);assert.equal(f.saved.length,0);
  });
  await test('只读恢复预检不打开入口、不唤醒、不保存状态', async () => {
    const f = fixture(); const before = copy(f.state);
    assert.equal((await f.controller.resume(true)).ready, true);
    assert.equal(f.writes().length, 0); assert.equal(f.saved.length, 0); assert.equal(f.probes.length, 0); assert.deepEqual(f.state, before);
  });
  await test('恢复原版本与原入口，保留空 Cron，确认真实写入推进契约', async () => {
    const f = fixture(); const result = await f.controller.resume();
    assert.equal(result.status, 'active'); assert.equal(result.observation.advanced, true);
    assert.deepEqual(f.live.workers, f.state.restore.workers);
    assert.deepEqual(domains(f.live.domains), domains(f.state.restore.domains)); assert.deepEqual(routes(f.live.routes), routes(f.state.restore.routes));
    assert.equal(f.probes.length, 4); assert.deepEqual(f.live.workers.yuqing.crons, []);
    const writes = f.writes().length; await f.controller.resume(); assert.equal(f.writes().length, writes);
  });
  await test('发布新版本后暂停保存新恢复点，再恢复不回滚旧代码', async () => {
    const f = fixture(); await f.controller.resume();
    const newer = 'new-business-version-after-development'; f.live.workers.btc.versionId = newer;
    f.versions.set(newer, { resources: { bindings: copy(f.live.workers.btc.bindings) } });
    const paused = await f.controller.pause();
    assert.equal(paused.restoreVersion, newer); assert.equal(paused.observation.stable, true);
    assert.equal(f.live.domains.length, 0); assert.ok(names.every(n => f.live.workers[n].crons.length === 0 && !f.live.workers[n].subdomain.enabled));
    const before = copy(f.state.restore), writes = f.writes().length;
    await f.controller.pause(); assert.deepEqual(f.state.restore, before); assert.equal(f.writes().length, writes);
    await f.controller.resume(); assert.equal(f.live.workers.btc.versionId, newer);
  });
  await test('暂停中域名删除成功但响应丢失：保留恢复点、重试补齐', async () => {
    const f = fixture(); await f.controller.resume(); const expected = copy(f.state.restore.workers);
    f.fail((url, method) => url.includes('/workers/domains/') && method === 'DELETE');
    await assert.rejects(f.controller.pause(), /lost response/); assert.equal(f.state.phase, 'pausing');
    assert.deepEqual(f.state.restore.workers, expected); assert.ok(f.state.maintenance.versionId.startsWith('new-maintenance'));
    await f.controller.pause(); assert.equal(f.state.phase, 'paused');
    await f.controller.resume(); assert.deepEqual(f.live.workers, expected);
  });
  await test('恢复部署成功但响应丢失：重试不重复部署、不丢快照', async () => {
    const f = fixture(); f.fail((url, method) => url.endsWith('/deployments') && method === 'POST');
    await assert.rejects(f.controller.resume(), /lost response/); assert.equal(f.state.phase, 'resuming');
    await f.controller.resume(); assert.equal(f.state.phase, 'active');
    assert.equal(f.calls.filter(c => c.url.endsWith('/deployments') && c.method === 'POST').length, 1);
  });
  await test('暂停期间出现未知版本或绑定漂移：不覆盖较新工作', async () => {
    const f = fixture(); f.live.workers.btc.versionId = 'unrecorded-newer-business-version';
    await assert.rejects(f.controller.resume(), /恢复点以外/); assert.equal(f.writes().length, 0);
    const g = fixture(); g.live.workers.btc.bindings.find(b => b.type === 'd1').id = 'different-db';
    await assert.rejects(g.controller.resume(), /绑定已变化/); assert.equal(g.writes().length, 0);
  });
  await test('域名被另一项目占用：不抢占入口', async () => {
    const f = fixture(); f.live.domains.push({ ...f.state.restore.domains[0], service: 'other-project', id: 'foreign' });
    await assert.rejects(f.controller.resume(), /自定义域发生变化/); assert.equal(f.writes().length, 0);
  });
  await test('接口已开但行情不推进：不报告恢复成功，仍能再次暂停', async () => {
    const f = fixture(); f.freeze(); await assert.rejects(f.controller.resume(), /尚未确认实时行情/);
    assert.equal(f.state.phase, 'resuming'); await f.controller.pause(); assert.equal(f.state.phase, 'paused');
  });
  await test('已运行时重复开启仍核验采集，不能只看开关', async () => {
    const f = fixture(); await f.controller.resume(); f.freeze();
    const before = f.writes().length;
    await assert.rejects(f.controller.resume(), /尚未确认实时行情/); assert.equal(f.writes().length, before);
  });
  await test('三种真实健康接口契约：快照没有 ok 字段，数据库失败不能误报', async () => {
    const responds = data => async () => new Response(JSON.stringify(data));
    assert.equal(await probeUrl('https://example.invalid', 'btc', responds({ ok: true })), true);
    assert.equal(await probeUrl('https://example.invalid', 'market-snapshot', responds({ worker: true, btcDb: true, snapshotDb: true })), true);
    assert.equal(await probeUrl('https://example.invalid', 'market-snapshot', responds({ worker: true, btcDb: false, snapshotDb: true })), false);
    assert.equal(await probeUrl('https://example.invalid', 'yuqing', responds({ ok: true, maintenance: false, secrets: { d1Ready: true } })), true);
    assert.equal(await probeUrl('https://example.invalid', 'yuqing', responds({ ok: true, maintenance: true, secrets: { d1Ready: true } })), false);
  });
  await test('暂停但仍在写入：不得报告完全暂停', async () => {
    const f = fixture(); let tick = 0;
    f.controller.sample = async () => ({ live: [], channels: [{ tick: ++tick }] });
    await assert.rejects(f.controller.pause(), /仍观察到写入变化/); assert.equal(f.state.phase, 'pausing');
  });
  await test('空 HTTP 200 DELETE 合法；错误响应不泄露认证或服务端载荷', async () => {
    const api = makeApi({ token: 'synthetic-private-marker' }, async () => new Response('', { status: 200 }));
    assert.equal(await api('/test', 'DELETE'), null);
    const bad = makeApi({ token: 'synthetic-private-marker' }, async () => new Response(JSON.stringify({ errors: [{ code: 10000, message: 'synthetic-private-marker' }] }), { status: 403 }));
    await assert.rejects(bad('/test'), e => e.message.includes('403') && !e.message.includes('synthetic-private-marker'));
  });
  await test('维护模块：两个类取消闹钟，保留数据，不发网络，不执行定时采集', async () => {
    const module = await import(pathToFileURL(path.resolve(__dirname, '../../cloudflare/btc-maintenance.mjs')));
    let deleted = 0, blocks = [];
    for (const name of ['LiquidationCollector', 'KlineLiveCollector']) {
      const state = { storage: { deleteAlarm: async () => { deleted++; } }, blockConcurrencyWhile: fn => blocks.push(fn()) };
      const object = new module[name](state); await object.alarm(); assert.equal(object.fetch().status, 503);
    }
    await Promise.all(blocks); assert.equal(deleted, 4); assert.equal(module.default.fetch().status, 503); await module.default.scheduled();
  });
  await test('只取最新部署，但资源列表读取完整分页', async () => {
    const urls = [];
    const api = makeApi({ token: 'fake' }, async url => {
      urls.push(url);
      const result = url.endsWith('/deployments') ? { deployments: [{ id: 'latest' }] } : [{ id: url.includes('page=2') ? 'second' : 'first' }];
      return new Response(JSON.stringify({ success: true, result, result_info: { total_pages: 2 } }));
    });
    assert.deepEqual(await api('/deployments'), { deployments: [{ id: 'latest' }] });
    assert.deepEqual(await api('/domains'), [{ id: 'first' }, { id: 'second' }]); assert.equal(urls.length, 3);
  });
  await test('状态文件不含变量值，工具无数据删除入口', async () => {
    const stateText = JSON.stringify(seed);
    assert.ok(names.every(n => seed.restore.workers[n].bindings.every(b => !('text' in b || 'value' in b))));
    assert.ok(!stateText.includes('Bearer '));
    const source = fs.readFileSync(path.join(__dirname, '../../scripts/operations/cloud-control.cjs'), 'utf8');
    assert.doesNotMatch(source, /DROP TABLE|DELETE FROM|wrangler.*deploy/);
  });
  console.log(`All ${passed} cloud-control scenarios passed (offline, cloud unchanged).`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
