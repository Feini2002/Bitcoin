import { FINANCE_DATASETS, normalizeDataset } from './datasets.mjs';
import { DESK_HISTORY_DDL, datasetWritePlan, liveKlineWritePlan, rawKlineHistoryStatements, winningReceiptExistsSql } from './dataset-store.mjs';
import { KLINE_STEPS } from '../kline-recovery.mjs';
import { measuredBatch } from './d1-cost.mjs';
import { cloudTrialExpired } from '../cloud-trial.mjs';

// 6000-bar recovery uses <= 12 commits, each bounded in input size and statement
// count. Only the complete call acknowledges recovery; every chunk is atomic.
export const KLINE_COMMIT_CHUNK = 500;
const bind = (sql,params,tag) => ({sql,params,tag});
function winnerCte() {
  return `WITH winners AS MATERIALIZED (
    SELECT o.* FROM json_each(?3) j JOIN finance_dataset_observations o ON o.rowid=(
      SELECT p.rowid FROM finance_dataset_observations p
      WHERE p.dataset_id=?4 AND p.observation_key=CAST(j.value AS TEXT)
        AND p.dataset_id GLOB 'binance-perp-klines-*' AND p.time_precision<>'receipt'
        AND json_extract(p.value_json,'$.supersededByWs') IS NOT 1
      ORDER BY (CASE WHEN json_extract(p.value_json,'$.closed')=1 THEN 1 ELSE 0 END) DESC,
        (CASE WHEN p.received_at=p.observed_at THEN p.stored_at ELSE p.received_at END) DESC,
        p.received_at DESC LIMIT 1))`;
}

export function projectionQueries(symbol,interval,keys) {
  const params=[symbol,interval,JSON.stringify(keys.map(String)),`binance-perp-klines-${interval}`];
  const different=`k.o IS NOT json_extract(o.value_json,'$.open') OR k.h IS NOT json_extract(o.value_json,'$.high')
    OR k.l IS NOT json_extract(o.value_json,'$.low') OR k.c IS NOT json_extract(o.value_json,'$.close')
    OR k.v IS NOT json_extract(o.value_json,'$.baseVolume')`;
  return [
    bind(DESK_HISTORY_DDL,[],'history-ddl'),
    bind(`${winnerCte()} UPDATE desk_history_state SET history_revision=history_revision+1
      WHERE symbol=?1 AND interval=?2 AND EXISTS (
        SELECT 1 FROM winners o LEFT JOIN klines k ON k.symbol=?1 AND k.interval=?2 AND k.t=CAST(o.observation_key AS INTEGER)
        WHERE CAST(o.observation_key AS INTEGER)<head_t-19*?5 AND (k.t IS NULL OR ${different}))`,
      [...params,KLINE_STEPS[interval]],'projection-revision'),
    bind(`${winnerCte()} INSERT INTO klines(symbol,interval,t,o,h,l,c,v)
      SELECT ?1,?2,CAST(observation_key AS INTEGER),json_extract(value_json,'$.open'),json_extract(value_json,'$.high'),
        json_extract(value_json,'$.low'),json_extract(value_json,'$.close'),json_extract(value_json,'$.baseVolume') FROM winners WHERE 1
      ON CONFLICT(symbol,interval,t) DO UPDATE SET o=excluded.o,h=excluded.h,l=excluded.l,c=excluded.c,v=excluded.v
      WHERE klines.o IS NOT excluded.o OR klines.h IS NOT excluded.h OR klines.l IS NOT excluded.l
        OR klines.c IS NOT excluded.c OR klines.v IS NOT excluded.v`,params,'raw-projection'),
    ...rawKlineHistoryStatements(symbol,interval,keys.map(t=>[Number(t)])).after.map(q=>({...q,tag:'raw-head'})),
  ];
}

function syncQuery(symbol,interval,at,complete,count,error,keys) {
  return bind(`INSERT INTO sync_status(symbol,interval,last_run,last_t,last_count,last_ok,last_error)
    SELECT ?1,?2,?3,COALESCE((SELECT MAX(t) FROM klines WHERE symbol=?1 AND interval=?2),0),?4,?5,?6
    WHERE ?5=0 OR ${winningReceiptExistsSql('?7','?8','?9')}
    ON CONFLICT(symbol,interval) DO UPDATE SET last_run=excluded.last_run,last_t=excluded.last_t,
      last_count=excluded.last_count,last_ok=excluded.last_ok,last_error=excluded.last_error
    WHERE excluded.last_run>=sync_status.last_run AND (excluded.last_run<>sync_status.last_run
      OR excluded.last_t<>sync_status.last_t OR excluded.last_count<>sync_status.last_count
      OR excluded.last_ok<>sync_status.last_ok OR excluded.last_error IS NOT sync_status.last_error)`,
    [symbol,interval,at,count,complete?1:0,error,`binance-perp-klines-${interval}`,JSON.stringify(keys.map(String)),new Date(at).toISOString()],'sync-state');
}

export async function markKlineCommitFailed(db,symbol,interval,{onCost}={}) {
  const id=`binance-perp-klines-${interval}`;
  await measuredBatch(db,[bind(`INSERT INTO sync_status(symbol,interval,last_run,last_t,last_count,last_ok,last_error)
      VALUES (?1,?2,0,0,0,0,'kline_commit_failed') ON CONFLICT(symbol,interval) DO UPDATE SET
        last_ok=0,last_error='kline_commit_failed'`,[symbol,interval],'sync-failure'),
    bind(`INSERT INTO finance_dataset_state(dataset_id,attempted_at,last_http_status,last_error)
      VALUES (?1,?2,503,'kline_commit_failed') ON CONFLICT(dataset_id) DO UPDATE SET
        attempted_at=excluded.attempted_at,last_http_status=503,
        last_error=CASE WHEN finance_dataset_state.last_error LIKE 'dataset_history_gap_pending:%'
          THEN finance_dataset_state.last_error ELSE excluded.last_error END`,[id,new Date().toISOString()],'dataset-failure'),
  ],{operation:'kline-failure',dataset:id,onCost});
}

export async function persistKlineCommit(env,symbol,interval,rows,sourceHost,mode='cloud-ws',options={}) {
  if(cloudTrialExpired(env)) throw new Error('cloud_trial_expired');
  const db=env?.DB, id=`binance-perp-klines-${interval}`, def=FINANCE_DATASETS[id];
  if (!db || symbol!=='BTCUSDT' || !def || !Array.isArray(rows) || rows.length>6000) throw new Error('invalid_kline_commit');
  if (!rows.length) return {inserted:0,chunks:0};
  const receivedAt=options.receivedAt || new Date().toISOString();
  const requestStartedAt=options.requestStartedAt || receivedAt;
  const envelope={provider:def.provider,operation:def.operation,parameters:def.parameters,
    source:{host:sourceHost,...(options.transportHost ? {transportHost:options.transportHost}: {})},
    requestedAt:requestStartedAt,receivedAt,data:rows};
  let chunks=0;
  const costOptions={operation:options.restBatch?'kline-rest':'kline-live',dataset:id,onCost:options.onCost,
    counts:{input:0,accepted:0,duplicate:0,late:0,closed:0,revisions:0}};
  // Include preflight SELECT metadata in the operation's cost, not just writes.
  const planDb={prepare(sql){return {bind(...params){return {async all(){
    return (await measuredBatch(db,[bind(sql,params,'preflight')],costOptions))[0];
  }};}};}};
  try {
    // Validate the whole payload before the first commit, including later chunks.
    normalizeDataset(id,envelope);
    if (options.restBatch && (!Number.isFinite(Date.parse(requestStartedAt)) || rows.some(r=>Number(r[6])>=Date.parse(requestStartedAt)))) {
      throw new Error('dataset_invalid_closed_rest_batch');
    }
    for(let offset=0;offset<rows.length;offset+=KLINE_COMMIT_CHUNK) {
      if(cloudTrialExpired(env)) throw new Error('cloud_trial_expired');
      const part=rows.slice(offset,offset+KLINE_COMMIT_CHUNK), queries=[bind(`SELECT COUNT(*) AS input,
        SUM(CASE WHEN prior.received_at IS NOT NULL AND (?4=1 OR prior.stored_at=?2) THEN 1 ELSE 0 END) AS duplicate,
        SUM(CASE WHEN (SELECT CASE WHEN p.received_at=p.observed_at THEN p.stored_at ELSE p.received_at END
          FROM finance_dataset_observations p WHERE p.dataset_id=?1 AND p.observation_key=json_extract(j.value,'$.key')
            AND p.dataset_id GLOB 'binance-perp-klines-*' AND p.time_precision<>'receipt'
            AND json_extract(p.value_json,'$.supersededByWs') IS NOT 1
          ORDER BY (CASE WHEN json_extract(p.value_json,'$.closed')=1 THEN 1 ELSE 0 END) DESC,
            (CASE WHEN p.received_at=p.observed_at THEN p.stored_at ELSE p.received_at END) DESC,p.received_at DESC LIMIT 1)>?2
          THEN 1 ELSE 0 END) AS late
        FROM json_each(?3) j LEFT JOIN finance_dataset_observations prior ON prior.dataset_id=?1
          AND prior.observation_key=json_extract(j.value,'$.key')
          AND prior.received_at=CASE WHEN ?4=1 THEN ?2 ELSE json_extract(j.value,'$.observedAt') END`,
        [id,receivedAt,JSON.stringify(part.map(row=>({key:String(row[0]),observedAt:new Date(Number(row[0])).toISOString()}))),
          options.restBatch || options.closed===true ? 1:0],'input-counts')];
      if(options.restBatch) {
        const plan=await datasetWritePlan(planDb,id,{...envelope,data:part},'cloud-readthrough');
        queries.push(...plan.queries);
      } else {
        // Live calls contain one bar; keeping this contract bounded also avoids
        // a many-row collection of duplicate per-bar state statements.
        if(rows.length>2) throw new Error('live_kline_commit_too_many_rows');
        for(const row of part) {
          const plan=await liveKlineWritePlan(planDb,interval,row,sourceHost,mode,{...options,receivedAt,requestStartedAt});
          queries.push(...plan.queries);
        }
      }
      for(const q of queries) if (/^\s*INSERT INTO finance_dataset_observations\b/.test(q.sql)) {
        q.sql+=' RETURNING observation_key'; q.tag='canonical-observation';
      }
      queries.push(...projectionQueries(symbol,interval,part.map(row=>row[0])));
      const complete=offset+part.length>=rows.length;
      queries.push(syncQuery(symbol,interval,Date.parse(receivedAt),complete,part.length,complete?null:'kline_commit_pending',part.map(row=>row[0])));
      queries.push(bind(`UPDATE finance_dataset_state SET last_http_status=?3,
          last_error=CASE WHEN last_error LIKE 'dataset_history_gap_pending:%' THEN last_error ELSE ?2 END
        WHERE dataset_id=?1 AND (?3<>200 OR ${winningReceiptExistsSql('?1','?4','?5')})
          AND (last_http_status<>?3 OR (last_error IS NOT ?2 AND (last_error IS NULL OR last_error NOT LIKE 'dataset_history_gap_pending:%')))`,
        [id,complete?null:'kline_commit_pending',complete?200:503,JSON.stringify(part.map(row=>String(row[0]))),receivedAt],'commit-coverage'));
      for(const q of queries) if (/UPDATE desk_history_state SET history_revision=history_revision\+1/.test(q.sql)) {
        q.sql+=' RETURNING history_revision';q.tag='history-revision';
      }
      await measuredBatch(db,queries,{...costOptions,counts:results=>({input:part.length,
        accepted:results.reduce((n,r,i)=>n+(queries[i].tag==='canonical-observation' ? r.results?.length || 0:0),0),
        duplicate:results[0]?.results?.[0]?.duplicate ?? null,late:results[0]?.results?.[0]?.late ?? null,
        revisions:results.reduce((n,r,i)=>n+(queries[i].tag==='history-revision' ? r.results?.length || 0:0),0),
        closed:options.closed===true || options.restBatch ? part.length:0,
      })});
      chunks++;
    }
  } catch(error) {
    if(error.message==='cloud_trial_expired') throw error;
    try { await markKlineCommitFailed(db,symbol,interval,options); }
    catch { error.failureStateUnknown=true; }
    throw error;
  }
  return {inserted:rows.length,chunks};
}
