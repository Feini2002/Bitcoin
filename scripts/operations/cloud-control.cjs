// Reversible operations for this project's three Workers; no business-source deploys.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../..');
const STATE_FILE = path.join(ROOT, 'cloudflare/cloud-control-state.json');
const TARGETS = ['btc', 'yuqing', 'market-snapshot'];
const ACCOUNT = '5c7e14191f8b616a07f03f767ec48bb8';
const ZONE = '3054bed2326bd0cbb301660b2c636c8e';
const CLASSES = ['KlineLiveCollector', 'LiquidationCollector'];
const RETAIN = ['plain_text', 'secret_text', 'secret_key', 'json'];
const stamp = () => new Date().toISOString();
const canonical = value => JSON.stringify(value, (_, v) => v && !Array.isArray(v) && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const equal = (a, b) => canonical(a) === canonical(b);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const need = (ok, message) => { if (!ok) throw new Error(message); };
const bindings = list => list.map(b => Object.fromEntries(
  ['name', 'type', 'id', 'namespace_id', 'class_name', 'service', 'environment', 'script_name'].filter(k => b[k] !== undefined).map(k => [k, b[k]])
)).sort((a, b) => a.name.localeCompare(b.name));
const domains = list => list.map(d => ({ hostname: d.hostname, service: d.service, zone_id: d.zone_id }))
  .sort((a, b) => a.hostname.localeCompare(b.hostname));
const routes = list => list.map(r => ({ pattern: r.pattern, script: r.script || null, request_limit_fail_open: r.request_limit_fail_open === true }))
  .sort((a, b) => a.pattern.localeCompare(b.pattern));

function validateState(state) {
  need(state.schemaVersion === 1 && state.accountId === ACCOUNT && state.zoneId === ZONE, '恢复记录账号/格式不匹配；未执行云端修改。');
  need(['paused', 'pausing', 'resuming', 'active'].includes(state.phase), '恢复记录阶段无效。');
  need(equal(Object.keys(state.restore.workers).sort(), [...TARGETS].sort()), '恢复记录必须恰好包含本项目三个 Worker。');
  for (const name of TARGETS) {
    const w = state.restore.workers[name];
    need(typeof w.versionId === 'string' && w.versionId.length > 10 && Array.isArray(w.crons) && w.crons.every(c => typeof c === 'string'), '版本或 Cron 恢复记录无效：' + name);
    need(typeof w.subdomain.enabled === 'boolean' && typeof w.subdomain.previews_enabled === 'boolean' && Array.isArray(w.bindings), '入口/绑定恢复记录无效：' + name);
  }
  need(state.restore.domains.every(d => TARGETS.includes(d.service) && d.zone_id === ZONE), '自定义域超出本项目范围。');
  need(state.restore.routes.every(r => !r.script || TARGETS.includes(r.script)), '路由恢复记录包含其他项目。');
}

function makeApi(auth, fetcher = fetch) {
  const headers = auth.token ? { Authorization: 'Bearer ' + auth.token } : { 'X-Auth-Key': auth.key, 'X-Auth-Email': auth.email };
  const request = async (route, method = 'GET', body) => {
    const form = body instanceof FormData;
    let response;
    try {
      response = await fetcher('https://api.cloudflare.com/client/v4' + route, {
        method, redirect: 'error', headers: { ...headers, ...(!form ? { 'Content-Type': 'application/json' } : {}) },
        ...(body === undefined ? {} : { body: form ? body : JSON.stringify(body) }), signal: AbortSignal.timeout(20000),
      });
    } catch { throw new Error(`Cloudflare 请求超时或网络失败：${method} ${route}；先查看状态再重试。`); }
    const text = await response.text();
    // Worker domain DELETE may return 200 with an empty body. Readback still verifies it.
    if (response.ok && method === 'DELETE' && !text.trim()) return null;
    let json;
    try { json = JSON.parse(text); } catch { throw new Error(`Cloudflare 返回非 JSON：HTTP ${response.status} ${route}`); }
    need(response.ok && json.success !== false && !json.errors?.length,
      `Cloudflare API 失败：HTTP ${response.status} ${route}；错误码 ${(json.errors || []).map(e => e.code).join(',')}（401/403 请重新登录或核对权限）。`);
    // Deployments uses only the newest item. Resource lists must include every page.
    const pages = json.result_info?.total_pages || 1;
    if (pages > 1 && !/[?&]page=/.test(route) && !(method === 'GET' && route.endsWith('/deployments'))) {
      need(method === 'GET' && Array.isArray(json.result) && pages <= 100, 'Cloudflare 列表分页格式不支持：' + route);
      const all = [...json.result];
      for (let page = 2; page <= pages; page++) {
        const next = await request(route + (route.includes('?') ? '&' : '?') + 'page=' + page);
        need(Array.isArray(next), 'Cloudflare 分页响应不是列表。'); all.push(...next);
      }
      return all;
    }
    return json.result ?? json.data;
  };
  return request;
}

class CloudControl {
  constructor({ state, api, save = () => {}, log = () => {}, sleep = ms => new Promise(r => setTimeout(r, ms)), probe = probeUrl }) {
    validateState(state);
    this.state = state; this.api = api; this.save = save; this.log = log; this.sleep = sleep; this.probe = probe;
    this.base = `/accounts/${ACCOUNT}`;
  }
  worker(name, suffix) { need(TARGETS.includes(name), 'Worker 不在本项目范围。'); return `${this.base}/workers/scripts/${name}/${suffix}`; }
  persist() { this.state.updatedAt = stamp(); this.save(this.state); }
  async snapshot() {
    const workers = {};
    await Promise.all(TARGETS.map(async name => {
      const [deps, schedules, subdomain, settings] = await Promise.all(['deployments', 'schedules', 'subdomain', 'settings'].map(k => this.api(this.worker(name, k))));
      const versions = deps.deployments?.[0]?.versions;
      need(versions?.length === 1 && versions[0].percentage === 100, '仅支持已完成发布的单版本 Worker：' + name);
      workers[name] = { versionId: versions[0].version_id, crons: schedules.schedules.map(s => s.cron).sort(),
        subdomain: { enabled: subdomain.enabled, previews_enabled: subdomain.previews_enabled }, bindings: bindings(settings.bindings || []) };
    }));
    const [allDomains, allRoutes] = await Promise.all([this.api(`${this.base}/workers/domains`), this.api(`/zones/${ZONE}/workers/routes`)]);
    const hosts = this.state.restore.domains.map(d => d.hostname), patterns = this.state.restore.routes.map(r => r.pattern);
    const projectDomains = allDomains.filter(d => TARGETS.includes(d.service) || hosts.includes(d.hostname));
    const projectRoutes = allRoutes.filter(r => TARGETS.includes(r.script) || patterns.includes(r.pattern));
    return { at: stamp(), workers, domains: projectDomains, routes: projectRoutes };
  }
  controlsMatch(snapshot, paused) {
    const restore = this.state.restore;
    return TARGETS.every(name => equal(snapshot.workers[name].crons, paused ? [] : restore.workers[name].crons)
      && equal(snapshot.workers[name].subdomain, paused ? { enabled: false, previews_enabled: false } : restore.workers[name].subdomain))
      && equal(domains(snapshot.domains), paused ? [] : domains(restore.domains))
      && equal(routes(snapshot.routes), routes(restore.routes.map(r => paused ? { ...r, script: null } : r)));
  }
  classify(snapshot) {
    const sameBindings = TARGETS.every(n => equal(snapshot.workers[n].bindings, bindings(this.state.restore.workers[n].bindings)));
    const maintenance = snapshot.workers.btc.versionId === this.state.maintenance?.versionId;
    const sameOthers = TARGETS.filter(n => n !== 'btc').every(n => snapshot.workers[n].versionId === this.state.restore.workers[n].versionId);
    if (maintenance && sameOthers && sameBindings && this.controlsMatch(snapshot, true)) return 'paused';
    if (!maintenance && this.controlsMatch(snapshot, false)) return 'active';
    return 'partial-or-drift';
  }
  assertCompatible(snapshot) {
    for (const name of TARGETS) {
      const wanted = this.state.restore.workers[name], live = snapshot.workers[name];
      need(equal(live.bindings, bindings(wanted.bindings)), '绑定已变化，请核对恢复记录，未继续覆盖：' + name);
      need(live.versionId === wanted.versionId || (name === 'btc' && live.versionId === this.state.maintenance?.versionId), '检测到恢复点以外的版本，未回退较新的工作：' + name);
    }
    need(snapshot.domains.every(d => this.state.restore.domains.some(w => equal(domains([d]), domains([w])))), '自定义域发生变化，未覆盖其他绑定。');
    need(snapshot.routes.every(r => this.state.restore.routes.some(w => w.pattern === r.pattern && (!r.script || r.script === w.script))), '路由发生变化，未覆盖其他项目。');
    need(this.state.restore.routes.every(w => snapshot.routes.some(r => r.pattern === w.pattern)), '保存的路由已被删除，需核对后恢复。');
  }
  async preflightVersions() {
    await Promise.all(TARGETS.map(async name => {
      const w = this.state.restore.workers[name];
      const version = await this.api(this.worker(name, 'versions/' + w.versionId));
      need(equal(bindings(version.resources.bindings), bindings(w.bindings)), '恢复版本绑定不匹配：' + name);
    }));
    const ids = [...new Set(TARGETS.flatMap(n => this.state.restore.workers[n].bindings.filter(b => b.type === 'd1').map(b => b.id)))];
    await Promise.all(ids.map(id => this.api(`${this.base}/d1/database/${id}`)));
    const namespaces = await this.api(`${this.base}/workers/durable_objects/namespaces`);
    need(this.state.restore.workers.btc.bindings.filter(b => b.type === 'durable_object_namespace')
      .every(b => namespaces.some(n => n.id === b.namespace_id)), '采集器存储命名空间缺失；禁止重建来伪装恢复。');
  }
  async uploadMaintenance() {
    const settings = await this.api(this.worker('btc', 'settings'));
    need(equal(bindings(settings.bindings), bindings(this.state.restore.workers.btc.bindings)), '上传前绑定发生变化。');
    const objects = settings.bindings.filter(b => b.type === 'durable_object_namespace');
    need(equal(objects.map(b => b.class_name).sort(), CLASSES), '采集器类已变化，需更新维护模块后再暂停。');
    need(!['yuqing', 'market-snapshot'].some(n => this.state.restore.workers[n].bindings.some(b => b.type === 'durable_object_namespace')), '新增后台采集器不在当前暂停模块覆盖范围。');
    const code = fs.readFileSync(path.join(ROOT, 'cloudflare/btc-maintenance.mjs'));
    const metadata = {
      main_module: 'btc-maintenance.mjs', compatibility_date: settings.compatibility_date,
      compatibility_flags: settings.compatibility_flags || [], keep_bindings: RETAIN,
      bindings: settings.bindings.filter(b => !RETAIN.includes(b.type)),
      annotations: { 'workers/message': 'BitDesk pause; restore=' + this.state.restore.workers.btc.versionId, 'workers/tag': 'bitdesk-paused' },
    };
    if (settings.limits) metadata.limits = settings.limits;
    // GET uses an internal target ID; uploads require the public region selector.
    if (settings.placement?.mode === 'targeted') {
      need(fs.readFileSync(path.join(ROOT, 'cloudflare/wrangler.toml'), 'utf8').includes('region = "aws:ap-northeast-1"'), '东京部署提示已改变，请核对维护版 placement。');
      metadata.placement = { mode: 'targeted', region: 'aws:ap-northeast-1' };
    } else if (settings.placement) metadata.placement = settings.placement;
    const form = new FormData(); form.set('metadata', JSON.stringify(metadata));
    form.set(metadata.main_module, new Blob([code], { type: 'application/javascript+module' }), metadata.main_module);
    this.log('上传无采集维护版本，保留云端变量及存储绑定');
    const uploaded = await this.api(this.worker('btc', 'versions'), 'POST', form);
    // Persist before any deployment, so a lost response cannot lose the restore point.
    this.state.maintenance = { versionId: uploaded.id, sha256: hash(code) }; this.persist();
    const version = await this.api(this.worker('btc', 'versions/' + uploaded.id));
    need(equal(bindings(version.resources.bindings), bindings(settings.bindings)), '维护版绑定验证失败，未部署。');
  }
  async deploy(name, versionId) {
    this.log(`切换 ${name} 的云端版本`);
    await this.api(this.worker(name, 'deployments'), 'POST', { strategy: 'percentage', versions: [{ version_id: versionId, percentage: 100 }], annotations: { 'workers/message': 'BitDesk reversible cloud control' } });
  }
  async closeEntries(snapshot) {
    for (const name of TARGETS) {
      if (snapshot.workers[name].crons.length) await this.api(this.worker(name, 'schedules'), 'PUT', []);
      if (snapshot.workers[name].subdomain.enabled || snapshot.workers[name].subdomain.previews_enabled)
        await this.api(this.worker(name, 'subdomain'), 'POST', { enabled: false, previews_enabled: false });
    }
    for (const r of snapshot.routes.filter(r => r.script)) await this.api(`/zones/${ZONE}/workers/routes/${r.id}`, 'PUT', { pattern: r.pattern, script: null, request_limit_fail_open: r.request_limit_fail_open === true });
    for (const d of snapshot.domains) await this.api(`${this.base}/workers/domains/${d.id}`, 'DELETE');
  }
  async pause(dryRun = false) {
    let live = await this.snapshot();
    if (this.state.phase === 'active') {
      need(live.workers.btc.versionId !== this.state.maintenance?.versionId, '运行态记录与维护版冲突；保留原恢复点。');
      need(live.domains.every(d => TARGETS.includes(d.service) && d.zone_id === ZONE), '域名指向其他项目或区域，未覆盖。');
      need(live.routes.every(r => !r.script || TARGETS.includes(r.script)), '路由指向其他项目，未覆盖。');
      const v = await this.api(this.worker('btc', 'versions/' + live.workers.btc.versionId));
      need(!/paused|pause; restore=/i.test(canonical(v.annotations || v.metadata?.annotations || {})), '当前版本标记为暂停，不能保存为正式恢复点。');
      this.state.restore = { capturedAt: stamp(), workers: live.workers, domains: domains(live.domains), routes: routes(live.routes) };
      this.state.maintenance = null;
    } else this.assertCompatible(live);
    await this.preflightVersions();
    if (dryRun) return { dryRun: true, action: 'pause', before: this.classify(live), restore: this.state.restore };
    this.state.phase = 'pausing'; this.persist();
    if (!this.state.maintenance) await this.uploadMaintenance();
    // Confirm a previously uploaded version as well, including after an interrupted upload check.
    const maintenance = await this.api(this.worker('btc', 'versions/' + this.state.maintenance.versionId));
    need(equal(bindings(maintenance.resources.bindings), bindings(this.state.restore.workers.btc.bindings)), '维护版绑定不匹配。');
    this.log('关闭三个 Worker 的定时任务和公网入口');
    live = await this.snapshot(); this.assertCompatible(live);
    await this.closeEntries(live);
    if (live.workers.btc.versionId !== this.state.maintenance.versionId) await this.deploy('btc', this.state.maintenance.versionId);
    live = await this.snapshot();
    need(this.classify(live) === 'paused', '暂停开关读回尚未一致；保留恢复点，可继续暂停。');
    const observation = await this.observe('paused');
    this.state.phase = 'paused'; this.state.verifiedAt = stamp(); this.persist();
    return { status: 'paused', observation, restoreVersion: this.state.restore.workers.btc.versionId };
  }
  async resume(dryRun = false) {
    let live = await this.snapshot();
    if (this.state.phase === 'active') {
      need(this.classify(live) === 'active', '已运行记录与入口不一致；先核对状态，不回退新代码。');
      if (dryRun) return { status: 'active', alreadyActive: true, dryRun, message: '入口已开启；本次只读预检未验证采集。' };
      const checks = await this.health();
      const observation = await this.observe('active');
      this.state.verifiedAt = stamp(); this.persist();
      return { status: 'active', alreadyActive: true, checks, observation, message: '已开启且实时写入正在推进；未重新部署或回退版本。' };
    }
    this.assertCompatible(live);
    await this.preflightVersions();
    if (dryRun) return { dryRun: true, action: 'resume', ready: true, before: this.classify(live), restore: this.state.restore };
    this.state.phase = 'resuming'; this.persist();
    if (live.workers.btc.versionId !== this.state.restore.workers.btc.versionId) await this.deploy('btc', this.state.restore.workers.btc.versionId);
    // Restore URLs before Cron. Originally empty schedules remain empty.
    for (const d of this.state.restore.domains) if (!live.domains.some(x => equal(domains([x]), domains([d]))))
      await this.api(`${this.base}/workers/domains`, 'PUT', d);
    for (const r of this.state.restore.routes) {
      const current = live.routes.find(x => x.pattern === r.pattern);
      if (!equal(routes([current]), routes([r]))) await this.api(`/zones/${ZONE}/workers/routes/${current.id}`, 'PUT', r);
    }
    for (const name of TARGETS) {
      const wanted = this.state.restore.workers[name];
      if (!equal(live.workers[name].subdomain, wanted.subdomain)) await this.api(this.worker(name, 'subdomain'), 'POST', wanted.subdomain);
      if (!equal(live.workers[name].crons, wanted.crons)) await this.api(this.worker(name, 'schedules'), 'PUT', wanted.crons.map(cron => ({ cron })));
    }
    live = await this.snapshot(); this.assertCompatible(live);
    need(this.classify(live) === 'active', '恢复开关读回尚未一致；已保留恢复记录，可继续恢复。');
    const checks = await this.health();
    const observation = await this.observe('active');
    this.state.phase = 'active'; this.state.verifiedAt = stamp(); this.persist();
    return { status: 'active', checks, observation, message: '云端已开启；历史缺口与上游健康仍按系统原有规则处理。' };
  }
  async health() {
    const checks = {};
    const urls = {
      btc: 'https://btc.feiniwork.com/api/d1/status',
      yuqing: 'https://yuqing.feiniwork.com/api/yuqing/health',
      'market-snapshot': `https://market-snapshot.${this.state.accountSubdomain}.workers.dev/api/ai/health`,
    };
    for (const name of TARGETS) { checks[name] = await this.probe(urls[name], name); need(checks[name], '入口已恢复但健康检查未通过：' + name + '；保留 resuming 状态，可重试核验。'); }
    // Explicit, existing wake entry starts the combined collector immediately; no bulk backfill.
    need(await this.probe('https://btc.feiniwork.com/api/d1/klines/wake'), '采集器唤醒未确认；保留 resuming 状态。');
    return checks;
  }
  async sample() {
    const db = this.state.restore.workers.btc.bindings.find(b => b.name === 'DB' && b.type === 'd1').id;
    const queries = {
      datasets: 'SELECT dataset_id,attempted_at,last_success_received_at,last_success_stored_at FROM finance_dataset_state ORDER BY dataset_id',
      channels: 'SELECT provider,operation,MAX(stored_at) AS last_stored,MAX(attempted_at) AS last_attempt FROM finance_channel_state GROUP BY provider,operation ORDER BY provider,operation',
      klines: 'SELECT symbol,interval,last_run,last_t,last_count,last_ok,last_error FROM sync_status ORDER BY symbol,interval',
      liquidations: 'SELECT exchange,MAX(updated_at) AS latest FROM liquidation_5m_buckets GROUP BY exchange ORDER BY exchange',
      footprint: 'SELECT MAX(updated_at) AS latest FROM footprint_bars',
      live: "SELECT dataset_id,MAX(stored_at) AS latest FROM finance_dataset_observations WHERE dataset_id='binance-perp-premium' GROUP BY dataset_id",
    };
    const data = {};
    await Promise.all(Object.entries(queries).map(async ([key, sql]) => {
      const result = await this.api(`${this.base}/d1/database/${db}/query`, 'POST', { sql });
      need(result.every(r => r.success && r.meta.rows_written === 0), '只读采集检查失败。');
      data[key] = result.flatMap(r => r.results);
    }));
    return data;
  }
  async observe(mode) {
    const samples = [];
    for (let i = 0; i < 5; i++) {
      const data = await this.sample();
      samples.push({ at: stamp(), hash: hash(canonical(data)), live: data.live });
      this.log(`采集核验 ${i + 1}/5：${mode === 'paused' ? '观察写入是否停止' : '观察实时数据是否推进'}`);
      if (i < 4) await this.sleep(30000);
    }
    const stable = samples.every(s => s.hash === samples[0].hash);
    const advanced = samples.at(-1).live.some(row => {
      const old = samples[0].live.find(x => x.dataset_id === row.dataset_id);
      return Number.isFinite(Date.parse(row.latest)) && Date.parse(row.latest) > Date.parse(old?.latest || '1970-01-01');
    });
    need(mode === 'paused' ? stable : advanced, mode === 'paused'
      ? '入口关闭但仍观察到写入变化；尚未确认全部暂停，请继续核验。'
      : '入口已恢复，但两分钟内尚未确认实时行情写入推进；请检查上游/VPS。恢复点保留，可继续恢复或再次暂停。');
    return { stable, advanced, samples };
  }
}

async function probeUrl(url, kind, fetcher = fetch) {
  try {
    const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    if (!response.ok) return false;
    if (kind === 'market-snapshot') return data.worker === true && data.btcDb === true && data.snapshotDb === true;
    if (kind === 'yuqing') return data.ok === true && data.maintenance === false && data.secrets?.d1Ready === true;
    return data.ok === true;
  } catch { return false; }
}

function acquireLock(filename) {
  const lock = { pid: process.pid, host: os.hostname(), at: stamp() };
  try { fs.writeFileSync(filename, JSON.stringify(lock), { flag: 'wx' }); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const previous = JSON.parse(fs.readFileSync(filename, 'utf8'));
    let dead = false;
    if (previous.host === os.hostname()) { try { process.kill(previous.pid, 0); } catch (error) { dead = error.code === 'ESRCH'; } }
    need(dead, '已有云端开关操作，或锁属于另一台电脑；请先核对：' + filename);
    fs.unlinkSync(filename); fs.writeFileSync(filename, JSON.stringify(lock), { flag: 'wx' });
  }
  return () => { if (fs.existsSync(filename) && fs.readFileSync(filename, 'utf8') === JSON.stringify(lock)) fs.unlinkSync(filename); };
}

async function main(args = process.argv.slice(2)) {
  const [command = 'status', ...flags] = args;
  need(['status', 'pause', 'resume'].includes(command) && flags.every(f => f === '--dry-run'), '用法：npm run cloud:status / cloud:pause / cloud:resume；-- --dry-run 仅预检。');
  const dryRun = flags.includes('--dry-run');
  const artifacts = path.join(ROOT, '.artifacts/cloud-control'); fs.mkdirSync(artifacts, { recursive: true });
  const reportFile = path.join(artifacts, `${Date.now()}-${command}.json`);
  const release = command === 'status' || dryRun ? () => {} : acquireLock(path.join(ROOT, 'cloudflare/.cloud-control.lock'));
  const started = Date.now();
  const timer = setTimeout(() => { console.error('云端操作达到 8 分钟硬截止；先运行 cloud:status，恢复记录已保留。'); process.exit(124); }, 480000);
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); validateState(state);
    let auth;
    try {
      auth = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), 'auth', 'token', '--json'],
        { encoding: 'utf8', timeout: 15000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: path.join(artifacts, 'wrangler.log') } }));
      need(auth.token || (auth.key && auth.email), 'missing auth');
    } catch { throw new Error('Cloudflare 登录不可用；请运行 npm run cf -- login 完成官方登录后重试，无需提供密钥。'); }
    const controller = new CloudControl({ state, api: makeApi(auth), log: message => console.log(`[${stamp()}] ${message}`),
      save: next => {
        fs.copyFileSync(STATE_FILE, path.join(artifacts, `state-${Date.now()}-${crypto.randomUUID()}.json`));
        const temporary = STATE_FILE + '.tmp'; fs.writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n'); fs.renameSync(temporary, STATE_FILE);
      },
    });
    console.log(JSON.stringify({ pid: process.pid, command, dryRun, deadline: new Date(started + 480000).toISOString() }));
    let result;
    if (command === 'status') { const live = await controller.snapshot(); result = { status: controller.classify(live), recordedPhase: state.phase, live, lastVerification: state.verifiedAt }; }
    else result = await controller[command](dryRun);
    fs.writeFileSync(reportFile, JSON.stringify({ at: stamp(), command, ...result }, null, 2) + '\n');
    console.log(JSON.stringify({ ...result, reportFile }, null, 2));
    if (result.status === 'partial-or-drift') process.exitCode = 2;
  } finally { clearTimeout(timer); release(); }
}
module.exports = { CloudControl, makeApi, validateState, bindings, domains, routes, acquireLock, probeUrl, main };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
