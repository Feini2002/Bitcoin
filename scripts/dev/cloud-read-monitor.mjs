import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import detector from '../diagnostics/cloud-read-detector.cjs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function runCloudReadCheck({ root = ROOT, log = console.warn } = {}) {
  return new Promise(resolve => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [path.join(root, 'scripts/run-bounded.cjs'), '40', 'node', path.join(root, 'scripts/diagnostics/cloud-read-check.cjs')],
      { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    log(`[cloud-reads] 检查监督进程 PID=${child.pid ?? '未启动'}；内部截止 40 秒，清理最多另 15 秒。`);
    let output = '', supervisorClean = false, workloadPid = null;
    const capture = chunk => {
      const text = chunk.toString();
      output = (output + text).slice(-65536);
      workloadPid ??= Number(output.match(/"childPid":(\d+)/)?.[1]) || null;
      if (output.includes('"cleanup":"confirmed"')) supervisorClean = true;
    };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    child.once('error', () => resolve({ status: 'UNKNOWN', findings: [{ level: 'UNKNOWN', code: 'MONITOR_START_FAILED', message: '检测进程无法启动。' }] }));
    child.once('close', code => {
      if (!supervisorClean || ![0, 2, 3].includes(code)) {
        return resolve({ status: 'UNKNOWN', findings: [{ level: 'UNKNOWN', code: 'MONITOR_EXECUTION_FAILED',
          message: `检测未正常完成或进程清理未确认（监督 PID=${child.pid}，退出码=${code}）；旧报告不可沿用。` }], cleanupUncertain: !supervisorClean });
      }
      try {
        const directory = path.join(root, '.artifacts/cloud-read-monitor');
        const name = fs.readdirSync(directory).filter(file => /^check-[\dTZ-]+-\d+\.json$/.test(file) && file.endsWith('-' + workloadPid + '.json')).sort().at(-1);
        if (!name) throw Error();
        const report = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
        if (!Number.isFinite(Date.parse(report.checkedAt)) || Date.parse(report.checkedAt) < startedAt || !Array.isArray(report.findings) ||
          code !== (report.status === 'PASS' ? 0 : report.status === 'ALERT' ? 2 : 3)) throw Error();
        resolve(report);
      } catch {
        resolve({ status: 'UNKNOWN', findings: [{ level: 'UNKNOWN', code: 'MONITOR_REPORT_MISSING', message: '未取得本次有效检测报告。' }] });
      }
    });
  });
}

export function createMonitor({ run = runCloudReadCheck, log = console.warn, intervalMs = detector.DEFAULT_POLICY.pollIntervalMs,
  setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let closed = false, inflight = null, timer = null, latest = null;
  const tick = () => {
    if (closed || inflight) return inflight;
    if (timer) { clearTimer(timer); timer = null; }
    inflight = Promise.resolve().then(() => run({ log })).catch(() => ({ status: 'UNKNOWN', findings: [
      { level: 'UNKNOWN', code: 'MONITOR_FAILED', message: '开发检查发生异常，不能判断云端读取正常。' },
    ] })).then(report => {
      latest = report;
      log(`[cloud-reads] ${report.status}：${report.findings.length} 项；详情 .artifacts/cloud-read-monitor/latest.md`);
      if (report.window) log(`[cloud-reads] ${report.window.windowStart} — ${report.window.end}；近期读取 ${report.totals?.recent?.rowsRead ?? '未知'} 行；24 小时 ${report.totals?.day?.rowsRead ?? '未知'} 行。`);
      for (const item of report.findings) log(`[cloud-reads] ${item.level} ${item.code}${item.source ? ' ' + item.source : ''}${item.databaseId ? ' ' + item.databaseId : ''}：${item.message}`);
      if (report.cleanupUncertain) closed = true; // Never stack checks on uncertain descendants.
      return report;
    }).finally(() => {
      inflight = null;
      if (!closed) { timer = setTimer(() => { timer = null; void tick(); }, intervalMs); timer?.unref?.(); }
    });
    return inflight;
  };
  return { tick, get latest() { return latest; }, async close() { closed = true; if (timer) clearTimer(timer); await inflight; } };
}

export function cloudReadMonitor(options = {}) {
  return { name: 'development-cloud-read-monitor', apply: 'serve', configureServer(server) {
    const monitor = createMonitor({ log: text => server.config.logger.warn(text), ...options });
    server.httpServer?.once('listening', () => { void monitor.tick(); });
    const close = server.close.bind(server);
    let closing;
    // Join the bounded check; killing only its parent could strand Wrangler.
    server.close = () => closing ??= (async () => { try { await monitor.close(); } finally { await close(); } })();
    server.httpServer?.once('close', () => { void monitor.close(); });
  } };
}
