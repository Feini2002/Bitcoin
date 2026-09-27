'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { authentication, retentionPlan, createApi, prune, main } = require('./prune-pages-deployments.cjs');
const project = 'bit-trading-desk';
function fixture({ noOpDelete = false, failDelete = false, lateAlias = false } = {}) {
  const rows = ['production', 'preview'].flatMap(environment => Array.from({ length: 18 }, (_, i) => ({
    id: `${environment}-${i}`, environment, created_on: new Date(Date.UTC(2026, 8, i + 1)).toISOString(), aliases: [], latest_stage: { status: 'success' },
  })));
  rows.find(r => r.id === 'preview-0').aliases = ['https://branch.example.pages.dev'];
  const info = { name: project, canonical_deployment: { id: 'production-0' }, latest_deployment: { id: 'production-17' } };
  const methods = [], pages = [], logs = [];
  let listPass = 0;
  const api = async (route, method = 'GET') => {
    const url = new URL(route, 'https://local');
    methods.push({ method, route });
    if (url.pathname.endsWith('/deployments')) {
      assert.equal(url.searchParams.get('per_page'), '25');
      const page = Number(url.searchParams.get('page'));
      if (page === 1) listPass++;
      pages.push(page);
      // Intentionally return oldest first: pruning must sort created_on itself.
      return { success: true, result: rows.slice((page - 1) * 25, page * 25), result_info: { total_pages: Math.ceil(rows.length / 25) } };
    }
    if (url.pathname.endsWith(`/projects/${project}`)) return { success: true, result: info };
    const id = url.pathname.split('/').at(-1);
    const at = rows.findIndex(row => row.id === id);
    if (method === 'DELETE') {
      assert.equal(url.searchParams.get('force'), 'false');
      assert.ok(at >= 0);
      assert.equal(rows[at].aliases.length, 0);
      assert.notEqual(id, info.canonical_deployment.id);
      assert.notEqual(id, info.latest_deployment.id);
      if (failDelete) throw new Error('injected DELETE failure');
      if (!noOpDelete) rows.splice(at, 1);
      return { success: true, result: null };
    }
    assert.ok(at >= 0);
    if (lateAlias && id === 'preview-1') rows[at].aliases = ['https://newly-active.example.pages.dev'];
    return { success: true, result: rows[at] };
  };
  return { rows, info, api, methods, pages, logs, get listPass() { return listPass; }, options: { api, account: 'account', project, keep: 8, log: x => logs.push(x) } };
}
(async () => {
  let command;
  const auth = authentication({}, (file, args, options) => {
    command = { file, args, options };
    return { status: 0, stdout: JSON.stringify({ token: 'test-only-token' }) };
  });
  assert.equal(auth.Authorization, 'Bearer test-only-token');
  assert.equal(command.file, process.execPath);
  assert.ok(command.args[0].endsWith(path.join('wrangler-dist', 'cli.js')));
  assert.equal(command.options.shell, false);
  assert.equal(command.options.timeout, 30000);
  assert.deepEqual(command.options.stdio, ['ignore', 'pipe', 'pipe']);
  let requests = 0;
  await assert.rejects(main({ env: {}, argv: [], run: () => ({ status: 0, stdout: 'Operation cancelled.' }), fetcher: async () => { requests++; }, log() {} }), /valid JSON/);
  assert.equal(requests, 0);
  assert.throws(() => authentication({}, () => ({ status: 0, stdout: '{}' })), /no credentials/);
  console.log('PASS local bounded Wrangler authentication; CLI cancellation/exit 0 cannot count as success');

  const dry = fixture();
  const plan = retentionPlan(dry.rows, dry.info, 8);
  assert.equal(plan.length, 18);
  assert.equal(plan.some(row => row.id === 'production-0' || row.id === 'preview-0'), false);
  assert.equal(plan.some(row => Number(row.id.split('-')[1]) >= 10), false);
  await prune({ ...dry.options, dryRun: true });
  assert.equal(dry.methods.some(x => x.method === 'DELETE'), false);
  assert.deepEqual(dry.pages, [1, 2]);
  assert.equal(dry.rows.length, 36);
  console.log('PASS full 25-row pagination, actual created_on ordering, newest 8/environment, canonical/aliases, read-only dry-run');

  const success = fixture({ lateAlias: true });
  const result = await prune(success.options);
  assert.equal(result.deleted.length, 17);
  assert.equal(success.rows.length, 19);
  assert.ok(success.rows.some(row => row.id === 'preview-1'));
  assert.equal(success.listPass, 2);
  assert.equal(success.logs.filter(line => /deleted .*verified absent/.test(line)).length, 17);
  assert.ok(result.deleted.every(id => !success.rows.some(row => row.id === id)));
  console.log('PASS recheck protects newly active alias; DELETE force=false; full read-back proves every reported deletion');

  const bounded = fixture();
  const limited = await prune({ ...bounded.options, maxDeletes: 3 });
  assert.equal(limited.deleted.length, 3);
  assert.equal(limited.remainingEligible, 15);
  assert.equal(bounded.rows.length, 33);
  assert.equal(bounded.listPass, 2);
  console.log('PASS explicit deletion batch finishes read-back and reports the remaining backlog');

  const unchanged = fixture({ noOpDelete: true });
  await assert.rejects(prune(unchanged.options), /still-present=18/);
  assert.equal(unchanged.logs.some(line => /deleted .*verified absent/.test(line)), false);
  const failed = fixture({ failDelete: true });
  await assert.rejects(prune(failed.options), /failed=18/);
  assert.equal(failed.listPass, 2);
  console.log('PASS successful-looking no-op deletion and DELETE failures fail verification instead of reporting success');

  const badApi = createApi({}, async () => Response.json({ success: false, errors: [{ code: 9109 }] }, { status: 403 }));
  await assert.rejects(badApi('/anything', 'DELETE'), /HTTP 403/);
  const file = path.join(__dirname, 'prune-pages-deployments.cjs');
  const child = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(file)}).runCli({env:{},argv:[],run:()=>({status:0,stdout:'{"token":"test-only-token"}'}),fetcher:async()=>Response.json({success:false,errors:[{code:9109}]},{status:403}),log(){}})`], { encoding: 'utf8', timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 });
  assert.equal(child.status, 1);
  assert.ok(!`${child.stdout}${child.stderr}`.includes('test-only-token'));
  console.log('PASS production CLI failure handler exits nonzero without printing authentication material');
})().catch(error => { console.error(error); process.exitCode = 1; });
