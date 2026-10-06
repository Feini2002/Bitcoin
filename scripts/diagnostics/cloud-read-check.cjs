const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { makeApi } = require('../operations/cloud-control.cjs');
const { DEFAULT_POLICY, makeRequest, analyze, renderReport } = require('./cloud-read-detector.cjs');
const ROOT = path.resolve(__dirname, '../..');
const REPORT_DIR = path.join(ROOT, '.artifacts/cloud-read-monitor');

async function sourceStatements(root = ROOT) {
  const source = await import(pathToFileURL(path.join(root, 'cloudflare/finance/dataset-store.mjs')).href);
  const row = { key: '1700000100000', observedAt: '2023-11-14T22:15:00.000Z', values: { close: 1 } };
  return [
    { name: 'canonicalHistoryStatements', sql: source.canonicalHistoryStatements('binance-perp-klines-5m', [row], 'fixture', 'fixture').after[0]?.sql },
    { name: 'rawKlineHistoryStatements', sql: source.rawKlineHistoryStatements('BTCUSDT', '5m', [[1700000100000, 1, 1, 1, 1, 1]]).after[0]?.sql },
    { name: 'historyBaselineStatement', sql: source.historyBaselineStatement('BTCUSDT', '5m', 'binance-perp-klines-5m').sql },
  ];
}

function officialAuth(root = ROOT) {
  // The enclosing run-bounded supervisor owns Wrangler's descendants. Never log
  // stdout, stderr, exceptions or environment from this credential-only call.
  try {
    const authLog = path.join(root, '.artifacts/cloud-read-monitor/auth-not-persisted.log');
    const output = execFileSync(process.execPath, ['--require', path.join(root, 'scripts/diagnostics/cloud-read-auth-log.cjs'), path.join(root, 'node_modules/wrangler/bin/wrangler.js'), 'auth', 'token', '--json'], {
      cwd: root, encoding: 'utf8', timeout: 12000, maxBuffer: 128 * 1024, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_SANITIZE: 'true', WRANGLER_LOG: 'log',
        WRANGLER_LOG_PATH: authLog, BIT_CLOUD_READ_AUTH_LOG: authLog },
    });
    const auth = JSON.parse(output);
    if (!auth.token && !(auth.key && auth.email)) throw Error();
    return auth;
  } catch { throw Error('AUTH_UNAVAILABLE'); }
}

async function check({ root = ROOT, now = Date.now(), api, policy = DEFAULT_POLICY, offline = false } = {}) {
  let state, request;
  try {
    state = JSON.parse(fs.readFileSync(path.join(root, 'cloudflare/cloud-control-state.json'), 'utf8'));
    request = makeRequest(state, now, policy);
  } catch {
    return analyze({ state: { phase: 'unknown' }, statements: null, policy, now, unavailable: 'SCOPE_OR_POLICY_INVALID' });
  }
  let statements = null;
  try { statements = await sourceStatements(root); } catch { /* Reported as UNKNOWN, never silently skipped. */ }
  if (offline) return analyze({ state, request, statements, policy, now, unavailable: 'OFFLINE_NO_CLOUD_METRICS' });
  let analytics, unavailable;
  try {
    if (!api) {
      const auth = officialAuth(root);
      api = makeApi(auth, (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) }));
    }
    analytics = await api('/graphql', 'POST', request.body);
  } catch (error) {
    // Stable codes only. API errors can contain SQL literals or account data.
    unavailable = error.message === 'AUTH_UNAVAILABLE' ? 'AUTH_UNAVAILABLE' : 'ANALYTICS_UNAVAILABLE';
  }
  return analyze({ state, request, statements, analytics, policy, now, unavailable });
}

function saveReport(report, directory = REPORT_DIR) {
  fs.mkdirSync(directory, { recursive: true });
  const json = JSON.stringify(report, null, 2) + '\n';
  // Each completed check has its own file; concurrent CLI/dev checks must not
  // accept somebody else's latest.json. The latest files are disposable views.
  const name = 'check-' + report.checkedAt.replace(/[:.]/g, '-') + '-' + process.pid + '.json';
  fs.writeFileSync(path.join(directory, name), json);
  for (const [name, content] of [['latest.json', json], ['latest.md', renderReport(report)]]) {
    fs.writeFileSync(path.join(directory, name), content);
  }
  // One local report per check, at most 24. No raw query text or auth output.
  const history = fs.readdirSync(directory).filter(file => /^check-[\dTZ-]+-\d+\.json$/.test(file)).sort();
  for (const file of history.slice(0, -24)) {
    try { fs.unlinkSync(path.join(directory, file)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--offline')) throw Error('unsupported_argument');
  console.log('[cloud-reads] 开始检查本项目 D1 用量；不执行业务 SQL。');
  const report = await check({ offline: args.includes('--offline') });
  saveReport(report);
  console.log(renderReport(report));
  console.log('[cloud-reads] 报告：.artifacts/cloud-read-monitor/latest.md');
  // ALERT and missing coverage both prevent a false green development gate.
  process.exitCode = report.status === 'PASS' ? 0 : report.status === 'ALERT' ? 2 : 3;
}

if (require.main === module) main().catch(() => {
  console.error('[cloud-reads] UNKNOWN：检测或报告保存失败，必须汇报；旧报告不能当作本次结果。');
  process.exitCode = 3;
});
module.exports = { check, sourceStatements, saveReport, officialAuth, REPORT_DIR, ROOT };
