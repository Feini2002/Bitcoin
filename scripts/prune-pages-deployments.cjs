/** Pages retention: newest 8 per environment plus every active deployment.
 * --dry-run reads only. Authentication remains in memory; never use force=true.
 */
'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_ACCOUNT = '5c7e14191f8b616a07f03f767ec48bb8';

function authentication(env = process.env, run = spawnSync) {
  // Invoke the installed CLI directly, avoiding npx installation and its launcher child.
  const result = run(process.execPath, [path.join(ROOT, 'node_modules/wrangler/wrangler-dist/cli.js'), 'auth', 'token', '--json'], {
    cwd: ROOT, encoding: 'utf8', shell: false, windowsHide: true, timeout: 30000,
    maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], env: { ...env, WRANGLER_SEND_METRICS: 'false' },
  });
  if (result.error || result.status !== 0) throw new Error('Wrangler authentication failed or timed out');
  let auth;
  try { auth = JSON.parse(result.stdout || ''); } catch { throw new Error('Wrangler authentication did not return valid JSON'); }
  if (typeof auth.token === 'string' && auth.token) return { Authorization: `Bearer ${auth.token}` };
  if (typeof auth.key === 'string' && auth.key && typeof auth.email === 'string' && auth.email) return { 'X-Auth-Key': auth.key, 'X-Auth-Email': auth.email };
  throw new Error('Wrangler authentication returned no credentials');
}

function active(row, project) {
  return row.id === project.canonical_deployment?.id || row.id === project.latest_deployment?.id ||
    Array.isArray(row.aliases) && row.aliases.length > 0 || row.latest_stage?.status === 'active';
}

function retentionPlan(rows, project, keep) {
  if (!project || !project.name) throw new Error('Missing Pages project identity');
  const result = [];
  for (const environment of ['production', 'preview']) {
    const sorted = rows.filter(row => row.environment === environment);
    if (sorted.some(row => !row.id || !Number.isFinite(Date.parse(row.created_on)))) throw new Error('Invalid deployment identity or creation time');
    sorted.sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on) || a.id.localeCompare(b.id));
    result.push(...sorted.slice(keep).filter(row => !active(row, project)));
  }
  return result;
}

function createApi(headers, fetcher = fetch, deadline = Date.now() + 120000) {
  return async (route, method = 'GET') => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error('Pages prune hard deadline reached');
    const response = await fetcher(`https://api.cloudflare.com/client/v4${route}`, {
      method, headers: { ...headers, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(Math.min(18000, remaining)),
    });
    let data;
    try { data = await response.json(); } catch { throw new Error(`Pages API returned invalid JSON (HTTP ${response.status})`); }
    if (!response.ok || data.success !== true || data.errors?.length) {
      throw new Error(`Pages API ${method} failed (HTTP ${response.status}; codes=${(data.errors || []).map(error => error.code).join(',')})`);
    }
    return data;
  };
}

async function listDeployments(api, base) {
  const rows = new Map();
  for (let page = 1; page <= 1000; page++) {
    const data = await api(`${base}/deployments?per_page=25&page=${page}`);
    if (!Array.isArray(data.result)) throw new Error('Pages deployment listing is not an array');
    let added = 0;
    for (const row of data.result) {
      if (!row.id) throw new Error('Pages deployment listing is missing an id');
      if (!rows.has(row.id)) added++;
      rows.set(row.id, row);
    }
    if (data.result.length && !added) throw new Error('Pages deployment pagination did not advance');
    const pages = Number(data.result_info?.total_pages);
    if (Number.isFinite(pages) && pages > 0 ? page >= pages : data.result.length < 25) return [...rows.values()];
  }
  throw new Error('Pages deployment pagination limit exceeded');
}

async function prune({ api, account, project, keep = 8, maxDeletes = Infinity, dryRun = false, log = console.log }) {
  const base = `/accounts/${encodeURIComponent(account)}/pages/projects/${encodeURIComponent(project)}`;
  const projectInfo = (await api(base)).result;
  if (projectInfo?.name !== project) throw new Error('Pages project does not match requested target');
  const before = await listDeployments(api, base);
  const eligible = retentionPlan(before, projectInfo, keep);
  const victims = eligible.slice(0, maxDeletes);
  log(`pages prune [${project}]: total=${before.length}, keep=${keep}/environment, eligible=${eligible.length}, this-pass=${victims.length}${dryRun ? ' (dry-run)' : ''}`);
  if (dryRun) {
    for (const row of victims) log(`  would delete ${row.id} ${row.environment}`);
    return { dryRun: true, before: before.length, eligible: victims.map(row => row.id), deleted: [] };
  }
  const requested = [], failures = [], protectedNow = [];
  for (const row of victims) {
    try {
      // Recheck activity immediately before mutation, then keep the API alias guard enabled.
      const currentProject = (await api(base)).result;
      const current = (await api(`${base}/deployments/${encodeURIComponent(row.id)}`)).result;
      if (currentProject?.name !== project || current?.id !== row.id || current.environment !== row.environment) throw new Error('Deployment identity changed');
      if (active(current, currentProject)) { protectedNow.push(row.id); log(`  protected ${row.id}`); continue; }
      await api(`${base}/deployments/${encodeURIComponent(row.id)}?force=false`, 'DELETE');
      requested.push(row.id);
      log(`  requested ${row.id} (pending verification)`);
    } catch (error) {
      failures.push(row.id);
      log(`  failed ${row.id}: ${error.message}`);
    }
  }
  // A successful CLI exit/API response is not proof of deletion. Read the full list again.
  const after = await listDeployments(api, base);
  const remaining = new Set(after.map(row => row.id));
  const deleted = requested.filter(id => !remaining.has(id));
  for (const id of deleted) log(`  deleted ${id} (verified absent)`);
  const unchanged = requested.filter(id => remaining.has(id));
  if (failures.length || unchanged.length) throw new Error(`Pages prune incomplete: failed=${failures.length}, still-present=${unchanged.length}`);
  const remainingEligible = retentionPlan(after, (await api(base)).result, keep).length;
  log(`pages prune [${project}]: verified deleted=${deleted.length}, remaining=${after.length}, remaining-eligible=${remainingEligible}, newly-protected=${protectedNow.length}`);
  return { before: before.length, after: after.length, deleted, protectedNow, remainingEligible };
}

async function main({ env = process.env, argv = process.argv.slice(2), run, fetcher, log = console.log } = {}) {
  const deadline = Date.now() + 120000;
  const project = String(env.BIT_PAGES_PROJECT || 'bit-trading-desk').trim();
  const account = String(env.CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_ID || DEFAULT_ACCOUNT).trim();
  const keep = Math.max(1, Math.min(50, parseInt(String(env.BIT_PAGES_KEEP || '8'), 10) || 8));
  const maxDeletes = env.BIT_PAGES_MAX_DELETIONS === undefined ? Infinity : Number(env.BIT_PAGES_MAX_DELETIONS);
  if (!(maxDeletes === Infinity || Number.isInteger(maxDeletes) && maxDeletes >= 1 && maxDeletes <= 100)) throw new Error('Invalid Pages deletion batch limit');
  const headers = authentication(env, run);
  return prune({ api: createApi(headers, fetcher, deadline), account, project, keep, maxDeletes, dryRun: argv.includes('--dry-run'), log });
}

async function runCli(options) {
  try { return await main(options); }
  catch (error) { console.error(`pages prune failed: ${error.message}`); process.exitCode = 1; }
}
module.exports = { authentication, active, retentionPlan, createApi, listDeployments, prune, main, runCli };
if (require.main === module) runCli();
