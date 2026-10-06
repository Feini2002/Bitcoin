// Offline fixtures plus a loopback-only Vite lifecycle check. No Cloudflare calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const detector = require('../../scripts/diagnostics/cloud-read-detector.cjs');
const { check, sourceStatements, saveReport } = require('../../scripts/diagnostics/cloud-read-check.cjs');
const seed = require('../../cloudflare/cloud-control-state.json');
const incident = require('../../docs/research/d1-cost-review-2026-10-05/queries.json');
const { makeApi } = require('../../scripts/operations/cloud-control.cjs');
const now = Date.parse('2026-10-05T15:00:00Z');
const state = { ...structuredClone(seed), phase: 'active' };
const request = detector.makeRequest(state, now);
const ids = request.scope.map(db => db.id);
const safeStatements = ['canonical', 'raw', 'baseline'].map(name => ({ name, sql: 'INSERT INTO desk_history_state SELECT 1 WHERE CASE WHEN EXISTS (SELECT 1 FROM desk_history_state) THEN 0 ELSE 1 END' }));
const metrics = rows => ({ rowsRead: rows, rowsWritten: 2, readQueries: 2, writeQueries: 1 });
function fixture() {
  const account = {
    minutes: ids.flatMap(id => [
      { dimensions: { databaseId: id, datetimeMinute: '2026-10-05T14:30:00Z' }, sum: metrics(100) },
      { dimensions: { databaseId: id, datetimeMinute: '2026-10-05T14:50:00Z' }, sum: metrics(100) },
    ]),
    day: ids.map(id => ({ dimensions: { databaseId: id }, sum: metrics(200) })),
    ...Object.fromEntries(ids.map((id, i) => ['q' + i, [{ count: 3, dimensions: { databaseId: id, query: 'SELECT fixture_' + i },
      sum: { rowsRead: 100, rowsWritten: 2, rowsReturned: 10 } }]])),
  };
  return { viewer: { accounts: [account] } };
}
const account = data => data.viewer.accounts[0];
const evaluate = (data, extra = {}) => detector.analyze({ state, request, statements: safeStatements, analytics: data, now, ...extra });
const codes = report => report.findings.map(item => item.code);
let cases = 0;
async function test(name, run) { await run(); cases++; console.log('PASS cloud-read-monitor ' + name); }

async function main() {
  await test('project scope is deduplicated, fixed, read-only and uses complete UTC windows', () => {
    assert.equal(ids.length, 3);
    assert.equal(request.window.end, '2026-10-05T14:55:00.000Z');
    assert.equal(request.window.windowStart, '2026-10-05T14:40:00.000Z');
    assert.equal(request.window.dayStart, '2026-10-04T14:55:00.000Z');
    assert.ok(!/mutation|SELECT|\/api\/|\/query/.test(request.body.query));
    for (const id of ids) assert.ok(request.body.query.includes(id));
    assert.throws(() => detector.makeRequest({ ...state, accountId: 'another-account' }, now));
    assert.throws(() => detector.makeRequest(state, now, { ...detector.DEFAULT_POLICY, rowsReadPerWindow: 0 }));
  });
  await test('normal metrics, separate windows and all three known source scan shapes', () => {
    const report = evaluate(fixture());
    assert.equal(report.status, 'PASS');
    assert.equal(report.totals.recent.rowsRead, 300);
    assert.equal(report.totals.previous.rowsRead, 300);
    assert.equal(report.totals.day.rowsRead, 600);
    assert.equal(detector.localRisks(['canonical', 'raw', 'baseline'].map(name => ({ name, sql: incident[name].sql }))).length, 3);
    assert.equal(detector.localRisks(safeStatements).length, 0);
    assert.equal(detector.localRisks(null)[0].level, 'UNKNOWN');
  });
  await test('aggregate budget and spike catch load spread across databases', () => {
    const data = fixture();
    for (const row of account(data).minutes) row.sum.rowsRead = row.dimensions.datetimeMinute.includes('50:00') ? 500000 : 50000;
    for (const row of account(data).day) row.sum.rowsRead = 50000000;
    assert.deepEqual(codes(evaluate(data)), ['WINDOW_READ_BUDGET', 'DAY_READ_BUDGET', 'READ_SPIKE']);
  });
  await test('missing, null, malformed, duplicate, foreign, out-of-window and partial metrics never pass', () => {
    const mutations = [
      data => { data.viewer.accounts = []; },
      data => { delete account(data).minutes; },
      data => { account(data).minutes[0].sum.rowsRead = null; },
      data => { account(data).minutes[0].sum.rowsRead = -1; },
      data => { account(data).minutes.push(account(data).minutes[0]); },
      data => { account(data).day[0].dimensions.databaseId = 'foreign'; },
      data => { account(data).minutes[0].dimensions.datetimeMinute = '2026-10-05T14:55:00Z'; },
      data => { account(data).minutes[0].dimensions.datetimeMinute = '2026-10-05T14:50:10Z'; },
      data => { account(data).q2 = null; },
    ];
    for (const mutate of mutations) { const data = fixture(); mutate(data); assert.equal(evaluate(data).status, 'UNKNOWN'); }
    const data = fixture(); account(data).minutes = []; account(data).day = [];
    const report = evaluate(data);
    assert.equal(report.status, 'REVIEW'); assert.equal(report.totals.recent, null);
    assert.equal(report.findings.filter(item => item.code === 'NO_RECENT_RECORDS').length, 3);
    assert.ok(codes(evaluate(fixture(), { unavailable: 'ANALYTICS_UNAVAILABLE' })).includes('ANALYTICS_UNAVAILABLE'));
  });
  await test('pause cutoff ignores earlier activity and distinguishes later activity and bad timestamps', () => {
    const paused = { ...state, phase: 'paused', verifiedAt: '2026-10-05T14:45:01Z' };
    assert.ok(!codes(evaluate(fixture(), { state: paused })).includes('ACTIVITY_AFTER_PAUSE'));
    const data = fixture(); account(data).minutes[1].dimensions.datetimeMinute = '2026-10-05T14:51:00Z';
    assert.ok(codes(evaluate(data, { state: paused })).includes('ACTIVITY_AFTER_PAUSE'));
    assert.ok(codes(evaluate(data, { state: { ...paused, verifiedAt: null } })).includes('PAUSE_TIME_INVALID'));
    assert.ok(codes(evaluate(data, { state: { ...paused, verifiedAt: '2026-10-06T00:00:00Z' } })).includes('PAUSE_TIME_INVALID'));
  });
  await test('repeated zero-write init and scan amplification are separate; SQL literals never reach report', () => {
    const data = fixture();
    account(data).q0 = [
      { count: 50, dimensions: { databaseId: ids[0], query: incident.raw.sql + " -- PRIVATE_LITERAL_123" }, sum: { rowsRead: 200000, rowsWritten: 0, rowsReturned: 0 } },
      { count: 50, dimensions: { databaseId: ids[0], query: "SELECT count(*) FROM secret WHERE name='PRIVATE_LITERAL_456'" }, sum: { rowsRead: 200000, rowsWritten: 0, rowsReturned: 50 } },
    ];
    const report = evaluate(data), serialized = JSON.stringify(report) + detector.renderReport(report);
    assert.ok(codes(report).includes('REPEATED_EMPTY_INITIALIZATION'));
    assert.ok(codes(report).includes('HIGH_SCAN_AMPLIFICATION'));
    assert.ok(!serialized.includes('PRIVATE_LITERAL') && !serialized.includes('SELECT count'));
    account(data).q0[0].sum.rowsWritten = 1;
    assert.ok(!codes(evaluate(data)).includes('REPEATED_EMPTY_INITIALIZATION'));
  });
  await test('SQL Top N cap remains visible without losing total-row checks', () => {
    const data = fixture();
    account(data).q0 = Array.from({ length: detector.DEFAULT_POLICY.queryLimit }, (_, i) => ({ count: 1,
      dimensions: { databaseId: ids[0], query: 'SELECT ' + i }, sum: { rowsRead: 1, rowsWritten: 0, rowsReturned: 1 } }));
    assert.ok(codes(evaluate(data)).includes('QUERY_TOP_N'));
  });
  await test('incomplete daily or SQL coverage is reported even when minute metrics look normal', () => {
    const data = fixture(); account(data).day = [];
    assert.ok(codes(evaluate(data)).includes('DAY_METRICS_MISSING'));
    const missingQuery = fixture(); account(missingQuery).q1 = [];
    assert.ok(codes(evaluate(missingQuery)).includes('QUERY_METRICS_MISSING'));
  });
  await test('actual SQL generation is inspected and live adapter calls only analytics', async () => {
    assert.equal((await sourceStatements()).length, 3);
    const calls = [];
    const result = await check({ now, api: async (...args) => { calls.push(args); return fixture(); } });
    assert.notEqual(result.cloudStatus, 'UNKNOWN');
    assert.equal(result.totals.recent.rowsRead, 300);
    assert.equal(calls.length, 1); assert.deepEqual(calls[0].slice(0, 2), ['/graphql', 'POST']);
    assert.ok(!calls[0][2].query.includes('mutation'));
    const offline = await check({ now, offline: true, api: () => { throw Error('must not call'); } });
    assert.ok(codes(offline).includes('OFFLINE_NO_CLOUD_METRICS'));
  });
  await test('HTTP success with GraphQL partial errors is still unavailable', async () => {
    const api = makeApi({ token: 'fixture-only' }, async () => new Response(JSON.stringify({ data: fixture(), errors: [{ message: 'PRIVATE_LITERAL_789' }] })));
    const result = await check({ now, api });
    assert.ok(codes(result).includes('ANALYTICS_UNAVAILABLE'));
    assert.ok(!JSON.stringify(result).includes('PRIVATE_LITERAL_789'));
  });
  await test('official auth output logging is suppressed only for the dedicated log path', async () => {
    const { suppressAuthLog } = require('../../scripts/diagnostics/cloud-read-auth-log.cjs');
    const writes = [], fake = { appendFile: async (...args) => { writes.push(args); } };
    const target = path.resolve('test-auth-not-persisted.log'), restore = suppressAuthLog(target, fake);
    await fake.appendFile(target, 'fixture credential');
    await fake.appendFile(path.resolve('unrelated.log'), 'normal diagnostic');
    assert.equal(writes.length, 1); assert.equal(writes[0][1], 'normal diagnostic');
    restore(); await fake.appendFile(target, 'fixture'); assert.equal(writes.length, 2);
  });
  await test('bounded report history and latest report contain no raw SQL', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'btc-cloud-read-test-'));
    try {
      for (let i = 0; i < 27; i++) saveReport({ ...evaluate(fixture()), checkedAt: new Date(now + i * 1000).toISOString() }, dir);
      assert.equal(fs.readdirSync(dir).filter(file => file.startsWith('check-')).length, 24);
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'latest.json'), 'utf8')).checkedAt, new Date(now + 26000).toISOString());
    } finally { for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file)); fs.rmdirSync(dir); }
  });
  const { createMonitor, cloudReadMonitor } = await import(pathToFileURL(path.resolve(__dirname, '../../scripts/dev/cloud-read-monitor.mjs')));
  await test('overlapping checks are coalesced; errors reported; closing waits and cancels next check', async () => {
    let resolve, calls = 0, scheduled = 0, cleared = 0;
    const logs = [], monitor = createMonitor({ log: text => logs.push(text), run: () => { calls++; return new Promise(done => { resolve = done; }); },
      setTimer: () => { scheduled++; return 1; }, clearTimer: () => { cleared++; } });
    const one = monitor.tick(), two = monitor.tick();
    assert.equal(one, two); await Promise.resolve(); assert.equal(calls, 1);
    resolve({ status: 'UNKNOWN', findings: [{ level: 'UNKNOWN', code: 'AUTH_UNAVAILABLE', message: '登录失效' }] });
    await one; assert.equal(scheduled, 1); assert.ok(logs.some(text => text.includes('AUTH_UNAVAILABLE')));
    await monitor.close(); assert.equal(cleared, 1); assert.equal(monitor.tick(), null);
    let finish;
    const stopping = createMonitor({ log: () => {}, run: () => new Promise(done => { finish = done; }), setTimer: () => { throw Error('must not schedule after close'); } });
    const running = stopping.tick(); await Promise.resolve(); let closed = false;
    const closing = stopping.close().then(() => { closed = true; }); await Promise.resolve(); assert.equal(closed, false);
    finish({ status: 'PASS', findings: [] }); await running; await closing; assert.equal(closed, true);
    const failed = createMonitor({ log: () => {}, run: () => { throw Error('PRIVATE_ERROR'); }, setTimer: () => 1, clearTimer: () => {} });
    assert.equal((await failed.tick()).status, 'UNKNOWN'); await failed.close();
    const uncertain = createMonitor({ log: () => {}, run: async () => ({ status: 'UNKNOWN', findings: [], cleanupUncertain: true }), setTimer: () => { throw Error('must stop'); } });
    await uncertain.tick(); await uncertain.close();
  });
  await test('actual Vite start triggers checks and close releases timers without production fetch', async () => {
    const { createServer } = await import('vite');
    let calls = 0;
    const server = await createServer({ configFile: false, root: path.resolve(__dirname, '../..'), logLevel: 'silent',
      server: { host: '127.0.0.1', port: 0, watch: null },
      plugins: [cloudReadMonitor({ log: () => {}, intervalMs: 20, run: async () => { calls++; return { status: 'REVIEW', findings: [{ level: 'REVIEW', code: 'NO_RECENT_RECORDS', message: '空闲或延迟' }] }; } })] });
    try {
      await server.listen();
      const deadline = Date.now() + 2000;
      while (calls < 2 && Date.now() < deadline) await new Promise(done => setTimeout(done, 10));
      assert.ok(calls >= 2);
    } finally { await server.close(); }
    const afterClose = calls; await new Promise(done => setTimeout(done, 60)); assert.equal(calls, afterClose);
    const config = fs.readFileSync(path.resolve(__dirname, '../../vite.config.mjs'), 'utf8');
    assert.ok(config.includes('cloudReadMonitor(),'));
  });
  console.log(`PASS ${cases} cloud-read-monitor scenarios; real Cloudflare network was not used.`);
}
const deadline = setTimeout(() => { console.error('FAIL cloud-read-monitor internal 25s deadline'); process.exit(124); }, 25000);
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(deadline));
