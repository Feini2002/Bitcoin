// Pure analysis of Cloudflare's existing analytics. Never executes business SQL.
const crypto = require('node:crypto');
const { validateState } = require('../operations/cloud-control.cjs');
const DEFAULT_POLICY = require('./cloud-read-policy.json');
const MINUTE = 60000;
const metricKeys = ['rowsRead', 'rowsWritten', 'readQueries', 'writeQueries'];
const queryKeys = ['rowsRead', 'rowsWritten', 'rowsReturned'];
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
const iso = ms => new Date(ms).toISOString();
const sqlShape = sql => String(sql).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
const fingerprint = sql => crypto.createHash('sha256').update(sqlShape(sql)).digest('hex').slice(0, 16);

function validatePolicy(policy) {
  for (const key of Object.keys(DEFAULT_POLICY)) {
    if (!Number.isFinite(policy[key]) || policy[key] <= 0) throw Error('invalid_policy');
  }
  if (policy.version !== 1 || policy.pollIntervalMs < 60000 || policy.analyticsLagMinutes < 1 ||
    policy.windowMinutes * 2 > policy.lookbackMinutes || policy.lookbackMinutes > 120 ||
    policy.queryLimit > 100 || !Number.isInteger(policy.queryLimit)) throw Error('invalid_policy');
  return policy;
}

function projectScope(state) {
  validateState(state);
  const ids = new Map();
  for (const [worker, config] of Object.entries(state.restore.workers)) {
    for (const binding of config.bindings.filter(value => value.type === 'd1')) {
      if (!/^[a-f0-9-]{36}$/.test(binding.id)) throw Error('invalid_database_scope');
      const entry = ids.get(binding.id) || { id: binding.id, names: [], workers: [] };
      if (!entry.names.includes(binding.name)) entry.names.push(binding.name);
      if (!entry.workers.includes(worker)) entry.workers.push(worker);
      ids.set(binding.id, entry);
    }
  }
  if (ids.size !== 3) throw Error('unexpected_database_scope');
  return [...ids.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function makeRequest(state, now = Date.now(), policy = DEFAULT_POLICY) {
  validatePolicy(policy);
  const scope = projectScope(state);
  if (!Number.isFinite(now)) throw Error('invalid_clock');
  // Exclusive upper bound, aligned to a complete minute. Lag is a local margin,
  // not a Cloudflare completeness guarantee.
  const end = Math.floor(now / MINUTE) * MINUTE - policy.analyticsLagMinutes * MINUTE;
  const windowStart = end - policy.windowMinutes * MINUTE;
  const previousStart = windowStart - policy.windowMinutes * MINUTE;
  const start = end - policy.lookbackMinutes * MINUTE;
  const dayStart = end - 24 * 60 * MINUTE;
  const filter = (from, ids) => `{datetime_geq:${JSON.stringify(iso(from))},datetime_lt:${JSON.stringify(iso(end))},databaseId_in:${JSON.stringify(ids)}}`;
  const sums = 'sum{readQueries writeQueries rowsRead rowsWritten}';
  const query = `query CloudReadMonitor($accountTag:string){viewer{accounts(filter:{accountTag:$accountTag}){
    minutes:d1AnalyticsAdaptiveGroups(limit:10000,filter:${filter(start, scope.map(db => db.id))}){${sums} dimensions{databaseId datetimeMinute}}
    day:d1AnalyticsAdaptiveGroups(limit:10000,filter:${filter(dayStart, scope.map(db => db.id))}){${sums} dimensions{databaseId}}
    ${scope.map((db, index) => `q${index}:d1QueriesAdaptiveGroups(limit:${policy.queryLimit},filter:${filter(windowStart, [db.id])},orderBy:[sum_rowsRead_DESC]){count sum{rowsRead rowsWritten rowsReturned} dimensions{databaseId query}}`).join('\n')}
  }}}`;
  return { body: { query, variables: { accountTag: state.accountId } }, scope,
    window: { start: iso(start), end: iso(end), windowStart: iso(windowStart), previousStart: iso(previousStart), dayStart: iso(dayStart) } };
}

function localRisks(statements) {
  const findings = [];
  if (!Array.isArray(statements) || statements.length !== 3) return [{ level: 'UNKNOWN', code: 'SOURCE_UNAVAILABLE', message: '三个历史初始化入口未能完整检查。' }];
  for (const { name, sql } of statements) {
    if (typeof sql !== 'string' || !sql.trim()) {
      findings.push({ level: 'UNKNOWN', code: 'SOURCE_UNAVAILABLE', message: '历史初始化 SQL 无法读取。' });
      continue;
    }
    const text = sqlShape(sql);
    if (/insert\s+into\s+desk_history_state\b/.test(text) &&
      /where not exists\s*\(select 1 from desk_history_state\b/.test(text) &&
      /and\s*\(?\s*exists\s*\(select 1 from (finance_dataset_observations|klines)\b/.test(text)) {
      findings.push({ level: 'ALERT', code: 'KNOWN_REPEAT_SCAN', source: name, fingerprint: fingerprint(sql),
        message: '源码仍含已确认的历史初始化重复扫描形态；恢复前需按事故方案修复并验证。这不等于当前正在收费。' });
    }
  }
  return findings;
}

function numericValues(row, keys) {
  const out = {};
  for (const key of keys) {
    if (typeof row?.[key] !== 'number' || !Number.isFinite(row[key]) || row[key] < 0 || row[key] > Number.MAX_SAFE_INTEGER) throw Error('invalid_metrics');
    out[key] = row[key];
  }
  return out;
}

function parseAnalytics(data, request, policy = DEFAULT_POLICY) {
  if (!Array.isArray(data?.viewer?.accounts) || data.viewer.accounts.length !== 1) throw Error('account_metrics_missing');
  const account = data.viewer.accounts[0], allowed = new Set(request.scope.map(db => db.id));
  const readMetrics = (rows, withTime) => {
    if (!Array.isArray(rows) || rows.length >= 10000) throw Error('metrics_missing_or_truncated');
    const seen = new Set();
    return rows.map(row => {
      const id = row?.dimensions?.databaseId;
      if (!allowed.has(id)) throw Error('metrics_scope_mismatch');
      const at = withTime ? row.dimensions.datetimeMinute : null;
      const time = Date.parse(at);
      if (withTime && (!Number.isFinite(time) || time % MINUTE !== 0 || time < Date.parse(request.window.start) || time >= Date.parse(request.window.end))) throw Error('metrics_window_mismatch');
      const key = id + ':' + at;
      if (seen.has(key)) throw Error('duplicate_metrics');
      seen.add(key);
      return { databaseId: id, ...(withTime ? { at: iso(time) } : {}), ...numericValues(row.sum, metricKeys) };
    });
  };
  const minutes = readMetrics(account.minutes, true), day = readMetrics(account.day, false), queries = [], truncated = [];
  for (const [index, db] of request.scope.entries()) {
    const rows = account['q' + index];
    if (!Array.isArray(rows) || rows.length > policy.queryLimit) throw Error('query_metrics_missing');
    if (rows.length === policy.queryLimit) truncated.push(db.id);
    const seen = new Set();
    for (const row of rows) {
      const text = row?.dimensions?.query;
      if (row?.dimensions?.databaseId !== db.id || typeof text !== 'string' || !text.trim() || text.length > 200000) throw Error('query_metrics_invalid');
      const count = numericValues(row, ['count']).count;
      if (count <= 0) throw Error('query_count_invalid');
      // Query text can contain literals: classify/hash in memory, never persist it.
      const id = fingerprint(text);
      if (seen.has(id)) throw Error('duplicate_query_metrics');
      seen.add(id);
      const shape = sqlShape(text);
      queries.push({ databaseId: db.id, fingerprint: id, count,
        kind: /insert\s+into\s+desk_history_state\b/.test(shape) ? 'history-initialization' : 'other',
        ...numericValues(row.sum, queryKeys) });
    }
  }
  return { minutes, day, queries, truncated };
}

function statusOf(findings) {
  if (findings.some(item => item.level === 'ALERT')) return 'ALERT';
  if (findings.some(item => item.level === 'UNKNOWN')) return 'UNKNOWN';
  if (findings.some(item => item.level === 'REVIEW')) return 'REVIEW';
  return 'PASS';
}

function analyze({ state, request, analytics, statements, policy = DEFAULT_POLICY, now = Date.now(), unavailable = null }) {
  const findings = localRisks(statements);
  let metrics = null;
  if (unavailable) findings.push({ level: 'UNKNOWN', code: unavailable, message: '云端指标检测未完成；不能据此判断读取正常。请检查官方 Wrangler 登录、网络及 Analytics 权限。' });
  else {
    try { metrics = parseAnalytics(analytics, request, policy); }
    catch { findings.push({ level: 'UNKNOWN', code: 'INVALID_ANALYTICS', message: '云端指标缺失、越界或格式变化；未把缺失值当作零。' }); }
  }
  const totals = { recent: null, previous: null, day: null, afterPause: null };
  const perDatabase = [];
  if (metrics) {
    const recent = metrics.minutes.filter(row => row.at >= request.window.windowStart);
    const previous = metrics.minutes.filter(row => row.at >= request.window.previousStart && row.at < request.window.windowStart);
    const total = rows => rows.length ? Object.fromEntries(metricKeys.map(key => [key, sum(rows, key)])) : null;
    totals.recent = total(recent); totals.previous = total(previous); totals.day = total(metrics.day);
    for (const db of request.scope) {
      const own = metrics.minutes.filter(row => row.databaseId === db.id), ownDay = metrics.day.filter(row => row.databaseId === db.id);
      perDatabase.push({ ...db, latestReportedMinute: own.reduce((last, row) => !last || row.at > last ? row.at : last, null),
        recent: total(own.filter(row => row.at >= request.window.windowStart)), day: total(ownDay),
        coverage: own.some(row => row.at >= request.window.windowStart) ? 'REPORTED' : 'NO_RECENT_RECORDS' });
      if (own.length && !ownDay.length) findings.push({ level: 'UNKNOWN', code: 'DAY_METRICS_MISSING', databaseId: db.id,
        message: '分钟指标有记录，但涵盖该时段的 24 小时总量缺失，无法完成日读取量核验。' });
      const recentOwn = own.filter(row => row.at >= request.window.windowStart);
      if (recentOwn.some(row => row.readQueries > 0 || row.writeQueries > 0) && !metrics.queries.some(row => row.databaseId === db.id)) findings.push({ level: 'REVIEW', code: 'QUERY_METRICS_MISSING', databaseId: db.id,
        message: '用量指标显示近期查询，但 SQL 统计没有记录，可能延迟或未覆盖；尚不能判断高耗费语句。' });
      if (!own.some(row => row.at >= request.window.windowStart)) findings.push({ level: 'REVIEW', code: 'NO_RECENT_RECORDS', databaseId: db.id,
        message: '该库近期未返回活动记录（可能暂停、空闲或指标延迟），不能证明实时零读取。' });
    }
    if ((totals.recent?.rowsRead ?? 0) > policy.rowsReadPerWindow) findings.push({ level: 'ALERT', code: 'WINDOW_READ_BUDGET', rowsRead: totals.recent.rowsRead,
      message: `本项目 ${policy.windowMinutes} 分钟读取量超过开发告警线 ${policy.rowsReadPerWindow} 行。` });
    if ((totals.day?.rowsRead ?? 0) > policy.rowsReadPerDay) findings.push({ level: 'ALERT', code: 'DAY_READ_BUDGET', rowsRead: totals.day.rowsRead,
      message: `本项目过去 24 小时读取量超过开发告警线 ${policy.rowsReadPerDay} 行；可能包含暂停前用量。` });
    if (totals.previous?.rowsRead >= policy.spikeBaselineRows && totals.recent?.rowsRead >= totals.previous.rowsRead * policy.spikeRatio) findings.push({ level: 'ALERT', code: 'READ_SPIKE',
      message: `相邻等长窗口读取量上升至少 ${policy.spikeRatio} 倍。` });
    if (state.phase === 'paused') {
      const verified = Date.parse(state.verifiedAt);
      if (!Number.isFinite(verified) || verified > now) findings.push({ level: 'UNKNOWN', code: 'PAUSE_TIME_INVALID', message: '暂停记录时间无效；无法区分暂停前后用量。' });
      else {
        const cutoff = iso(Math.ceil((verified + policy.analyticsLagMinutes * MINUTE) / MINUTE) * MINUTE);
        const rows = metrics.minutes.filter(row => row.at >= cutoff);
        totals.afterPause = total(rows);
        if (totals.afterPause && metricKeys.some(key => totals.afterPause[key] > 0)) findings.push({ level: 'ALERT', code: 'ACTIVITY_AFTER_PAUSE',
          message: '已记录暂停后的观察窗口仍有数据库活动。需查来源，诊断读取也会计入；这不是已证明采集自动恢复。' });
      }
    } else if (state.phase !== 'active') findings.push({ level: 'UNKNOWN', code: 'CLOUD_TRANSITION', message: '本地云端状态处于切换中，需要核对实际开关状态。' });
    for (const q of metrics.queries) {
      if (q.count < policy.queryMinCalls || q.rowsRead < policy.queryMinRows || q.rowsRead / q.count < policy.queryMeanRows) continue;
      if (q.kind === 'history-initialization' && q.rowsWritten === 0) findings.push({ level: 'ALERT', code: 'REPEATED_EMPTY_INITIALIZATION', databaseId: q.databaseId, fingerprint: q.fingerprint,
        message: `初始化执行 ${q.count} 次，读取 ${q.rowsRead} 行且写入 0 行，疑似重复历史扫描。` });
      else if (q.rowsRead / Math.max(1, q.rowsReturned) >= policy.scanToReturnRatio) findings.push({ level: 'REVIEW', code: 'HIGH_SCAN_AMPLIFICATION', databaseId: q.databaseId, fingerprint: q.fingerprint,
        message: '该 SQL 读取量远大于返回量，需要检查索引、聚合及重复调用；不能仅凭这一比值判定无用。' });
    }
    for (const id of metrics.truncated) findings.push({ level: 'REVIEW', code: 'QUERY_TOP_N', databaseId: id, message: 'SQL 统计达到 Top N 上限；数据库总量仍单独检查，未声称覆盖全部 SQL。' });
  }
  return { version: 1, checkedAt: iso(now), status: statusOf(findings), cloudStatus: statusOf(findings.filter(item => !['KNOWN_REPEAT_SCAN', 'SOURCE_UNAVAILABLE'].includes(item.code))),
    localPhase: state.phase, pauseVerifiedAt: state.verifiedAt || null, window: request?.window || null, scope: request?.scope || [],
    thresholds: policy, totals, databases: perDatabase, queries: metrics?.queries || [], findings,
    limitations: ['只检查 BTC 项目三个 D1 库，不覆盖其他项目或 Workers/DO/存储/账号固定月费。',
      'Analytics 有延迟；空记录、Top N 和 SQL 静态形态不能证明所有读取正常。',
      '开发告警线不是账单上限；检测不会自动停服、部署、修复 SQL 或恢复采集。',
      'localPhase 来自本地恢复记录；本检查没有重新核验线上开关配置。'] };
}

function renderReport(report) {
  const number = value => typeof value === 'number' ? value.toLocaleString('en-US') + ' 行' : '无可核验记录';
  return [`# 云端异常读取检测：${report.status}`, '', `- 检测时间：${report.checkedAt}`, `- 云端指标结论：${report.cloudStatus}`,
    `- 本地开关记录：${report.localPhase}；它不代替实时开关核验。`,
    `- 最近窗口：${report.window?.windowStart || '未知'} — ${report.window?.end || '未知'}（UTC，右端不含）`,
    `- 最近窗口读取：${number(report.totals.recent?.rowsRead)}；过去 24 小时：${number(report.totals.day?.rowsRead)}。`, '',
    '## 必须汇报的问题', '', ...(report.findings.length ? report.findings.map(item => `- **${item.level} / ${item.code}**${item.source ? `（${item.source}）` : ''}${item.databaseId ? `（${item.databaseId}）` : ''}：${item.message}`) : ['- 当前覆盖范围未命中告警规则。']), '',
    '## 检测边界', '', ...report.limitations.map(text => '- ' + text), ''].join('\n');
}

module.exports = { DEFAULT_POLICY, MINUTE, validatePolicy, projectScope, makeRequest, localRisks, parseAnalytics, analyze, renderReport, statusOf, fingerprint };
