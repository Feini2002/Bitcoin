// 本地验证/部署启动器：记录父子 PID，硬截止时停止本次进程树。
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const [secondsText, command, ...args] = process.argv.slice(2);
const seconds = Number(secondsText);
if (!command || !Number.isFinite(seconds) || seconds <= 0) throw Error('Usage: node scripts/run-bounded.cjs seconds node|npm args...');
const executable = command === 'node' || command === 'npm' ? process.execPath : command;
const childArgs = command === 'npm' ? [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), ...args] : args;
const child = spawn(executable, childArgs, { stdio: 'inherit', windowsHide: true });
console.log(JSON.stringify({ supervisorPid: process.pid, childPid: child.pid, deadline: new Date(Date.now()+seconds*1000).toISOString(), command, args }));
let stopping = false;
function stop(reason) {
  if (stopping) return;
  stopping = true;
  console.error('STOP ' + reason + ' childPid=' + child.pid);
  if (child.pid && process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { timeout: 10000, windowsHide: true, stdio: 'inherit' });
  else child.kill('SIGTERM');
  process.exitCode = 124;
}
const timer = setTimeout(() => stop('hard deadline'), seconds*1000);
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
child.on('error', error => { clearTimeout(timer); console.error(error.message); process.exitCode=1; });
child.on('exit', (code, signal) => { clearTimeout(timer); console.log(JSON.stringify({ childPid:child.pid, code, signal, stopped:stopping })); process.exitCode=stopping ? 124 : (code ?? 1); });
