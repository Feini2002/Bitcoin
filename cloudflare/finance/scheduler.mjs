import { FINANCE_DATASETS, datasetRequest, datasetSupportsIncremental, normalizeDataset } from "./datasets.mjs";
import { persistDataset, datasetFailure, datasetStates, gapHistoryStatements } from "./dataset-store.mjs";
import { handleFinance } from "./gateway.mjs";
import { financeChannelKey } from "./store.mjs";

export const DATASET_AUTO_SKIP = new Set();
export const DATASET_SCHEDULER_MAX_PER_TICK = 8;

export function pickDatasetsToRefresh(due, max = DATASET_SCHEDULER_MAX_PER_TICK) {
  const sorted = (Array.isArray(due) ? due : []).slice().sort((a, b) =>
    (b.age || 0) - (a.age || 0) || Number(!!a.failedAttempt) - Number(!!b.failedAttempt));
  const picked = [];
  const providerCount = {};
  for (const item of sorted) {
    if (picked.length >= max) break;
    const provider = String(item.provider || '');
    if (!provider.startsWith('binance-')) {
      if ((providerCount[provider] || 0) >= 1) continue;
      providerCount[provider] = (providerCount[provider] || 0) + 1;
    }
    picked.push(item);
  }
  const reserved = sorted.find((item) => !String(item.provider || '').startsWith('binance-'));
  if (reserved && !picked.some((item) => item.id === reserved.id)) {
    if (picked.length < max) picked.push(reserved);
    else picked[picked.length - 1] = reserved;
  }
  return picked;
}

const BINANCE_RESTRICTED_COOL_MS = 15 * 60 * 1000;
const KLINE_FULL_REFRESH_MS = 30 * 60 * 1000;
export const DATASET_HISTORY_AUDIT_MS = 24 * 60 * 60 * 1000;
const GAP_PREFIX='dataset_history_gap_pending:';
export const DATASET_GAP_RETRY_MS=30*60*1000;
export const DATASET_GAP_RETRY_MAX_MS=6*60*60*1000;
const historyStep=d=>({'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000,'3d':259200000,'1w':604800000}[d.parameters.interval || d.parameters.period]);
function parseGap(error) {
  if (!String(error || '').startsWith(GAP_PREFIX)) return null;
  try { const gap=JSON.parse(error.slice(GAP_PREFIX.length)); return gap.from<=gap.to && gap.step>0 ? {...gap,identity:error}:null; } catch {return null;}
}
async function pendingGap(db,id) {
  const result=await db.prepare('SELECT last_error FROM finance_dataset_state WHERE dataset_id=?1').bind(id).all();
  return parseGap(result.results?.[0]?.last_error);
}
async function markGap(db,id,from,to,step) {
  for(let attempt=0;attempt<3;attempt++) {
    const old=await pendingGap(db,id);
    const next=GAP_PREFIX+JSON.stringify({from:Math.min(from,old?.from ?? from),to:Math.max(to,old?.to ?? to),step,token:crypto.randomUUID(),retryAt:old?.retryAt || 0,failures:old?.failures || 0});
    const statements=[
      db.prepare(`UPDATE finance_dataset_state SET last_error=?2
        WHERE dataset_id=?1 AND ((?3 IS NULL AND (last_error IS NULL OR last_error NOT LIKE 'dataset_history_gap_pending:%')) OR last_error=?3)
        RETURNING dataset_id`).bind(id,next,old?.identity || null),
      ...gapHistoryStatements(id, Math.min(from, old?.from ?? from), next).map((query) => db.prepare(query.sql).bind(...query.params)),
    ];
    const results=await db.batch(statements);
    const changed=Number(results?.[0]?.meta?.changes ?? results?.[0]?.results?.length ?? 0);
    if(changed>0)break;
  }
  return pendingGap(db,id);
}
async function deferGap(db,id,gap,now) {
  const failures=Math.min(16,(gap.failures || 0)+1);
  const delay=Math.min(DATASET_GAP_RETRY_MAX_MS,DATASET_GAP_RETRY_MS*2**(failures-1));
  const next=GAP_PREFIX+JSON.stringify({from:gap.from,to:gap.to,step:gap.step,token:gap.token,retryAt:now+delay,failures});
  await db.prepare('UPDATE finance_dataset_state SET last_error=?2 WHERE dataset_id=?1 AND last_error=?3').bind(id,next,gap.identity).run();
}
async function advanceGap(db,id,gap) {
  const result=await db.prepare(`SELECT DISTINCT observed_at FROM finance_dataset_observations
    WHERE dataset_id=?1 AND observed_at>=?2 AND observed_at<=?3 ORDER BY observed_at LIMIT 501`)
    .bind(id,new Date(gap.from).toISOString(),new Date(gap.to).toISOString()).all();
  let from=gap.from;
  for (const row of result.results || []) { const at=Date.parse(row.observed_at); if(at!==from)break; from+=gap.step; }
  if(from===gap.from)return pendingGap(db,id);
  const next=from>gap.to ? null : GAP_PREFIX+JSON.stringify({from,to:gap.to,step:gap.step,token:gap.token});
  // A concurrent refresh may have changed the checkpoint; only its owner may advance it.
  await db.prepare('UPDATE finance_dataset_state SET last_error=?2 WHERE dataset_id=?1 AND last_error=?3').bind(id,next,gap.identity).run();
  return pendingGap(db,id);
}

async function fullAuditTimes(db) {
  const identities = Object.entries(FINANCE_DATASETS).filter(([id]) => datasetSupportsIncremental(id))
    .map(([id,d]) => ({id,key:financeChannelKey(d.provider,d.operation,d.parameters)}));
  const result = await db.prepare(`SELECT json_extract(j.value,'$.id') AS id,s.received_at
    FROM json_each(?1) j LEFT JOIN finance_channel_state s ON s.channel_key=json_extract(j.value,'$.key')
    WHERE EXISTS (SELECT 1 FROM finance_dataset_observations o
      WHERE o.dataset_id=json_extract(j.value,'$.id') AND o.received_at=s.received_at)`)
    .bind(JSON.stringify(identities)).all();
  return Object.fromEntries((result.results || []).map(row => [row.id, Date.parse(row.received_at)]));
}

async function latestDatasetPoints(db, id) {
  const result = await db.prepare(`SELECT observation_key,MAX(observed_at) AS observed_at
    FROM finance_dataset_observations WHERE dataset_id=?1
    GROUP BY observation_key ORDER BY observed_at DESC LIMIT 2`).bind(id).all();
  return result.results || [];
}

export function datasetDueForCollection(id, definition, state, now = Date.now()) {
  if (!definition || DATASET_AUTO_SKIP.has(id)) return { due: false, reason: "skipped" };
  const last = state && state.last_success_received_at ? Date.parse(state.last_success_received_at) : 0;
  const attempted = state && state.attempted_at ? Date.parse(state.attempted_at) : 0;
  const retryAt = state && state.retry_at ? Date.parse(state.retry_at) : 0;
  if (Number.isFinite(retryAt) && retryAt > now) return { due: false, reason: "cooldown" };
  if (
    state &&
    state.last_error === "upstream_access_restricted" &&
    String(definition.provider || "").startsWith("binance-") &&
    now - attempted < BINANCE_RESTRICTED_COOL_MS
  ) {
    return { due: false, reason: "binance_restricted" };
  }
  const refreshMs = Number(definition.refreshSeconds || 60) * 1000;
  if (parseGap(state?.last_error) && !(parseGap(state.last_error).retryAt>now)) return {due:true,reason:'history_gap',age:now-last};
  if (state?.last_error === 'dataset_history_catchup_pending') return {due:true,reason:'history_catchup',age:now-last};
  if (definition.kind === "klines") {
    if (last > 0 && now - attempted < KLINE_FULL_REFRESH_MS) return { due: false, reason: "kline_live_or_recent" };
    if (last > 0 && now - last < KLINE_FULL_REFRESH_MS) return { due: false, reason: "kline_full_interval" };
    return { due: true, reason: "kline_full", age: now - last };
  }
  if (last > 0 && now - last < refreshMs) return { due: false, reason: "fresh" };
  return { due: true, reason: last > 0 ? "stale" : "never", age: now - last };
}

export async function refreshFinanceDataset(env, id, {now=Date.now(),forceFull=false,dependencies={},skipGap=false}={}) {
  const definition = FINANCE_DATASETS[id];
  const incremental = datasetSupportsIncremental(id);
  let gap=incremental ? await pendingGap(env.DB,id):null;
  // Another full refresh may have filled the hole during its retry cooldown.
  // Reconcile persisted coverage before deferring the upstream request again.
  if (gap && !skipGap && gap.retryAt>now) gap=await advanceGap(env.DB,id,gap);
  if(gap && !skipGap && !(gap.retryAt>now)) {
    let recovered=0,error=null;
    try {
      const window={startTime:String(gap.from),endTime:String(Math.min(gap.to,gap.from+499*gap.step)),limit:'500'};
      const response=await handleFinance(datasetRequest(id,'https://finance.internal',window),env,{}, {...dependencies,cache:null});
      const envelope=await response.json();
      if(!response.ok || !envelope.ok)throw new Error(envelope.error || 'dataset_history_gap_pending');
      recovered=await persistDataset(env.DB,id,envelope,'cloud-readthrough');
      const before=gap.from;
      gap=await advanceGap(env.DB,id,gap);
      if(gap && gap.from===before)await deferGap(env.DB,id,gap,now);
    } catch(cause) {error=cause.message;await deferGap(env.DB,id,gap,now);}
    // An unrecoverable old interval must never stop acquisition of the current tape.
    const current=await refreshFinanceDataset(env,id,{now,dependencies,skipGap:true});
    const remaining=await pendingGap(env.DB,id);
    return {...current,mode:'gap-recovery',written:current.written+recovered,requests:current.requests+1,
      catchupPending:!!remaining,uncoveredGap:!!remaining,recoveryError:error};
  }
  const points = incremental ? await latestDatasetPoints(env.DB,id) : [];
  const audits = incremental && !forceFull ? await fullAuditTimes(env.DB) : {};
  const full = !skipGap && (!incremental || forceFull || !points.length || !audits[id] || now-audits[id]>=DATASET_HISTORY_AUDIT_MS);
  // Funding may settle at irregular times; overlap the previous two actual
  // settlements. Other historical sources support a stable latest-two window.
  let window = full ? {} : definition.kind==='funding'
    ? {startTime:String(Date.parse(points.at(-1).observed_at)),limit:'500'} : {limit:'2'};
  let written=0,requests=0,mode=full?'full':'tail';
  const existingGap=gap; gap=null;
  for (let attempt=0;attempt<(skipGap || existingGap ? 1:2);attempt++) {
    const upstream = await handleFinance(datasetRequest(id,"https://finance.internal",window), env, {}, {...dependencies,cache:null});
    requests++;
    const envelope = await upstream.json();
    if (!upstream.ok || !envelope.ok) {
      await datasetFailure(env.DB,id,upstream.status,envelope.error || 'dataset_upstream_failed');
      if(gap)await deferGap(env.DB,id,gap,now);
      return {id,ok:false,error:envelope.error || 'dataset_upstream_failed',status:upstream.status,written,requests};
    }
    let normalized;
    try {normalized=normalizeDataset(id,envelope);}catch(error){if(gap)await deferGap(env.DB,id,gap,now);throw error;}
    let detectedGap=false;
    if (attempt===0 && !gap && !full && definition.kind!=='funding') {
      const earliest = Math.min(...normalized.rows.map(row => Date.parse(row.observedAt)));
      const previous = Date.parse(points[0].observed_at);
      const step = historyStep(definition);
      if (earliest>previous+step) { gap=await markGap(env.DB,id,previous+step,earliest-step,step); detectedGap=true; }
    }
    written += await persistDataset(env.DB,id,envelope,'cloud-readthrough');
    if (detectedGap) {
      if(skipGap || existingGap)return {id,ok:true,written,requests,mode,catchupPending:true,uncoveredGap:true};
      window={startTime:String(gap.from),endTime:String(Math.min(gap.to,gap.from+499*gap.step)),limit:'500'}; mode='gap-full'; continue;
    }
    if (gap) {
      gap=await advanceGap(env.DB,id,gap);
      return {id,ok:true,written,requests,mode,catchupPending:!!gap,uncoveredGap:!!gap};
    }
    // A saturated funding page is saved, not discarded. Subsequent cycles start
    // at its real last settlements and continue; this is not complete coverage.
    const catchupPending = !full && definition.kind==='funding' && normalized.rows.length>=500;
    if (catchupPending) await datasetFailure(env.DB,id,200,'dataset_history_catchup_pending');
    const step = historyStep(definition);
    const uncoveredGap = mode==='gap-full' && Math.min(...normalized.rows.map(row => Date.parse(row.observedAt)))>Date.parse(points[0].observed_at)+step;
    if (uncoveredGap) await datasetFailure(env.DB,id,200,'dataset_history_gap_outside_window');
    return {id,ok:true,written,requests,mode,catchupPending:catchupPending || !!existingGap,uncoveredGap:uncoveredGap || !!existingGap};
  }
}

export async function syncFinanceDatasetsIfDue(env, now = Date.now()) {
  if (!env || env.FINANCE_D1_ENABLED !== "true" || !env.DB) {
    return { ok: true, skipped: true, reason: "storage_disabled" };
  }
  let states = [];
  try {
    states = await datasetStates(env.DB);
  } catch (_) {
    return { ok: false, error: "dataset_state_unavailable" };
  }
  const byId = Object.fromEntries((states || []).map((row) => [row.dataset_id, row]));
  let audits = {};
  try { audits = await fullAuditTimes(env.DB); } catch (_) {}
  const due = [];
  for (const [id, definition] of Object.entries(FINANCE_DATASETS)) {
    let verdict = datasetDueForCollection(id, definition, byId[id], now);
    // Live success does not replace the daily older-history revision audit.
    if (datasetSupportsIncremental(id) && !['cooldown','binance_restricted','history_catchup','history_gap'].includes(verdict.reason)
      && (!audits[id] || now-audits[id]>=DATASET_HISTORY_AUDIT_MS)) {
      verdict={due:true,reason:'history_audit',age:now-(audits[id] || 0)};
    }
    if (verdict.due) {
      const state=byId[id],attempted=Date.parse(state?.attempted_at || ''),last=Date.parse(state?.last_success_received_at || '') || 0;
      const failedAttempt=!!state?.last_error && Number.isFinite(attempted) && attempted>last;
      // A failed source stays due, but its completed attempt relinquishes queue
      // priority. Old last-success times must not occupy all eight slots forever.
      const age=failedAttempt ? Math.min(verdict.age || 0,Math.max(0,now-attempted)) : verdict.age || 0;
      due.push({ id, provider: definition.provider, age, reason: verdict.reason, failedAttempt });
    }
  }
  const picked = pickDatasetsToRefresh(due);
  const results = [];
  for (const item of picked) {
    const started = Date.now();
    try {
      results.push(await refreshFinanceDataset(env, item.id, {now,forceFull:item.reason==='history_audit'}));
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      try {
        await datasetFailure(env.DB, item.id, 502, message.slice(0, 160));
      } catch (_) {}
      results.push({ id: item.id, ok: false, error: message.slice(0, 160) });
    } finally {
      const elapsedMs = Date.now() - started;
      if (elapsedMs > 2000) console.log(JSON.stringify({event:'finance_collection_slow',dataset:item.id,elapsedMs,ok:results.at(-1)?.ok===true}));
    }
  }
  return {
    ok: true,
    due: due.length,
    attempted: picked.length,
    results,
  };
}
