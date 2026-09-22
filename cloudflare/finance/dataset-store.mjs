import { FINANCE_DATASETS, normalizeDataset } from './datasets.mjs';

export function datasetWriteQueries(id,envelope,ingestionMode='cloud-readthrough', writeRows) {
  if(!['cloud-readthrough','local-bootstrap','cloud-ws'].includes(ingestionMode))throw new Error('invalid_ingestion_mode');
  const normalized=normalizeDataset(id,envelope);
  const rows = Array.isArray(writeRows) ? writeRows : normalized.rows;
  const storedAt=new Date().toISOString(),queries=[];
  for(let offset=0;offset<rows.length;offset+=100) {
    const chunk=rows.slice(offset,offset+100);
    // Preserve each receipt, including equal values: later out-of-order arrivals must
    // not erase evidence of what a subsequent response actually reported.
    queries.push({sql:`INSERT INTO finance_dataset_observations
      (dataset_id, observation_key, observed_at, time_precision, received_at, stored_at,
       source_host, ingestion_mode, source_revision_json, value_json)
      SELECT ?1, json_extract(j.value,'$.key'), json_extract(j.value,'$.observedAt'),
        json_extract(j.value,'$.timePrecision'), ?2, ?3, ?4, ?5,
        json_extract(j.value,'$.sourceRevision'), json_extract(j.value,'$.values')
      FROM json_each(?6) j
      WHERE 1
      ON CONFLICT(dataset_id,observation_key,received_at) DO NOTHING`,
      params:[id,normalized.receivedAt,storedAt,normalized.sourceHost,ingestionMode,JSON.stringify(chunk)]});
  }
  queries.push({sql:`INSERT INTO finance_dataset_state
    (dataset_id,attempted_at,last_http_status,last_success_received_at,last_success_stored_at,last_ingestion_mode,row_count)
    VALUES (?1,?2,200,?3,?2,?4,?5)
    ON CONFLICT(dataset_id) DO UPDATE SET attempted_at=excluded.attempted_at,last_http_status=200,last_error=NULL,
      last_success_received_at=excluded.last_success_received_at,last_success_stored_at=excluded.last_success_stored_at,
      last_ingestion_mode=excluded.last_ingestion_mode,row_count=excluded.row_count
    WHERE finance_dataset_state.last_success_received_at IS NULL
      OR excluded.last_success_received_at>=finance_dataset_state.last_success_received_at`,
    params:[id,storedAt,normalized.receivedAt,ingestionMode,rows.length]});
  return {queries,normalized};
}

export function classifyReceiptConflict(existing, incoming) {
  if (!existing) return { action: 'insert' };
  if (existing.datasetId===incoming.datasetId && existing.observationKey===incoming.observationKey && existing.receivedAt===incoming.receivedAt) {
    if (JSON.stringify(existing.values)===JSON.stringify(incoming.values)) return { action: 'reuse' };
    return { action: 'reject', reason: 'identity_content_conflict' };
  }
  return { action: 'insert' };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DATASET_RETENTION_BY_ID = {
  'crypto-breadth': { keep: 4032, maxAgeMs: 14 * DAY_MS },
  'btc-fees': { keep: 10080, maxAgeMs: 7 * DAY_MS },
  'stablecoin-supply': { keep: 2200, maxAgeMs: 90 * DAY_MS },
  'deribit-btc-options': { keep: 8, maxAgeMs: 7 * DAY_MS },
};

export function datasetRetention(id) {
  if (DATASET_RETENTION_BY_ID[id]) return DATASET_RETENTION_BY_ID[id];
  const definition = FINANCE_DATASETS[id];
  if (!definition) return { keep: 500 };
  if (definition.kind === 'klines') return { keep: 600 };
  if (definition.kind === 'premium' || definition.kind === 'oi') return { keep: 3600 };
  if (definition.kind === 'book') return { keep: 720 };
  if (definition.kind === 'fred' || definition.kind === 'sofr') return { keep: 1500 };
  if (definition.kind === 'instrument' || definition.kind === 'funding-info') return { keep: 30 };
  return { keep: 500 };
}

export async function pruneDatasetObservations(db, id, keep) {
  const cap = Math.max(1, Number(keep) || 1);
  const res = await db.prepare(
    `DELETE FROM finance_dataset_observations
      WHERE dataset_id=?1 AND received_at < (
        SELECT received_at FROM finance_dataset_observations
         WHERE dataset_id=?1 ORDER BY received_at DESC LIMIT 1 OFFSET ?2
      )`
  ).bind(id, cap - 1).run();
  return Number(res && res.meta && res.meta.changes) || 0;
}

export async function pruneDatasetByAge(db, id, maxAgeMs, now = Date.now()) {
  const age = Number(maxAgeMs) || 0;
  if (age <= 0) return 0;
  const cutoff = new Date(now - age).toISOString();
  const res = await db.prepare(
    'DELETE FROM finance_dataset_observations WHERE dataset_id=?1 AND received_at < ?2'
  ).bind(id, cutoff).run();
  return Number(res && res.meta && res.meta.changes) || 0;
}

export async function pruneExpiredDatasets(db, now = Date.now()) {
  let pruned = 0;
  for (const id of Object.keys(FINANCE_DATASETS)) {
    const rule = datasetRetention(id);
    if (rule.maxAgeMs) pruned += await pruneDatasetByAge(db, id, rule.maxAgeMs, now);
    if (rule.keep) pruned += await pruneDatasetObservations(db, id, rule.keep);
  }
  return pruned;
}

async function pruneAfterWrite(db, id) {
  const rule = datasetRetention(id);
  if (rule.maxAgeMs) {
    try { await pruneDatasetByAge(db, id, rule.maxAgeMs); } catch (_) {}
  }
  if (rule.keep) {
    try { await pruneDatasetObservations(db, id, rule.keep); } catch (_) {}
  }
}

export async function persistLiveSnapshot(db, id, data, sourceHost, ingestionMode = 'cloud-ws') {
  const definition = FINANCE_DATASETS[id];
  if (!definition) return 0;
  const receivedAt = new Date().toISOString();
  const envelope = {
    ok: true,
    provider: definition.provider,
    operation: definition.operation,
    parameters: definition.parameters,
    source: { host: sourceHost || 'fstream.binance.com' },
    requestedAt: receivedAt,
    receivedAt,
    data,
  };
  const mode = ['cloud-readthrough', 'local-bootstrap', 'cloud-ws'].includes(ingestionMode) ? ingestionMode : 'cloud-ws';
  return persistDataset(db, id, envelope, mode);
}

export async function persistLiveKlineBar(db, interval, kline, sourceHost, ingestionMode = 'cloud-ws') {
  const id = `binance-perp-klines-${interval}`;
  const definition = FINANCE_DATASETS[id];
  if (!definition) return 0;
  const receivedAt = new Date().toISOString();
  const envelope = {
    ok: true,
    provider: definition.provider,
    operation: definition.operation,
    parameters: definition.parameters,
    source: { host: sourceHost || 'fstream.binance.com' },
    requestedAt: receivedAt,
    receivedAt,
    data: [kline],
  };
  const normalized = normalizeDataset(id, envelope);
  const row = normalized.rows[0];
  const liveReceipt = row.observedAt;
  const storedAt = receivedAt;
  const mode = ['cloud-readthrough', 'local-bootstrap', 'cloud-ws'].includes(ingestionMode) ? ingestionMode : 'cloud-ws';
  await db.batch([
    db.prepare(`INSERT INTO finance_dataset_observations
      (dataset_id, observation_key, observed_at, time_precision, received_at, stored_at,
       source_host, ingestion_mode, source_revision_json, value_json)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
      ON CONFLICT(dataset_id,observation_key,received_at) DO UPDATE SET
        value_json=excluded.value_json, stored_at=excluded.stored_at,
        source_host=excluded.source_host, ingestion_mode=excluded.ingestion_mode`)
      .bind(
        id, String(row.key), row.observedAt, row.timePrecision, liveReceipt, storedAt,
        normalized.sourceHost, mode,
        row.sourceRevision ? JSON.stringify(row.sourceRevision) : null,
        JSON.stringify(row.values)
      ),
    db.prepare(`INSERT INTO finance_dataset_state
      (dataset_id,attempted_at,last_http_status,last_success_received_at,last_success_stored_at,last_ingestion_mode,row_count)
      VALUES (?1,?2,200,?3,?2,?4,1)
      ON CONFLICT(dataset_id) DO UPDATE SET attempted_at=excluded.attempted_at,last_http_status=200,last_error=NULL,
        last_success_received_at=excluded.last_success_received_at,last_success_stored_at=excluded.last_success_stored_at,
        last_ingestion_mode=excluded.last_ingestion_mode`)
      .bind(id, storedAt, receivedAt, mode),
  ]);
  await pruneAfterWrite(db, id);
  return 1;
}

export async function persistDataset(db,id,envelope,ingestionMode) {
  const definition = FINANCE_DATASETS[id];
  const normalized = normalizeDataset(id,envelope);
  let rows = normalized.rows;
  if (definition && (definition.kind === 'fred' || definition.kind === 'sofr')) {
    const existing = await db.prepare(
      `SELECT o.observation_key AS observation_key, o.value_json AS value_json, o.source_revision_json AS source_revision_json
         FROM finance_dataset_observations o
        WHERE o.dataset_id=?1
          AND o.received_at=(SELECT MAX(v.received_at) FROM finance_dataset_observations v
            WHERE v.dataset_id=o.dataset_id AND v.observation_key=o.observation_key)`
    ).bind(id).all();
    const prev = new Map((existing.results || existing || []).map((row) => [String(row.observation_key), row]));
    rows = normalized.rows.filter((row) => {
      const last = prev.get(String(row.key));
      if (!last) return true;
      const lastValues = typeof last.value_json === 'string' ? JSON.parse(last.value_json) : last.value_json;
      const lastRev = last.source_revision_json
        ? (typeof last.source_revision_json === 'string' ? JSON.parse(last.source_revision_json) : last.source_revision_json)
        : null;
      if (JSON.stringify(lastValues) !== JSON.stringify(row.values)) return true;
      if (JSON.stringify(lastRev) !== JSON.stringify(row.sourceRevision || null)) return true;
      return false;
    });
  }
  const envelopeForWrite = envelope;
  const {queries} = datasetWriteQueries(id, envelopeForWrite, ingestionMode, rows);
  if (!queries.length) return 0;
  await db.batch(queries.map(q=>db.prepare(q.sql).bind(...q.params)));
  await pruneAfterWrite(db, id);
  return rows.length;
}

export async function datasetFailure(db,id,http,error) {
  await db.prepare(`INSERT INTO finance_dataset_state(dataset_id,attempted_at,last_http_status,last_error)
    VALUES (?1,?2,?3,?4) ON CONFLICT(dataset_id) DO UPDATE SET attempted_at=excluded.attempted_at,
      last_http_status=excluded.last_http_status,last_error=excluded.last_error`
  ).bind(id,new Date().toISOString(),http,error).run();
}

export async function readDataset(db,id,{limit=1000,knownAt=new Date().toISOString()}={}) {
  const definition=FINANCE_DATASETS[id];
  if(!definition)throw new Error('unknown_dataset');
  const snapshotOnly=definition.kind==='options';
  const selection=`o.dataset_id=?1 AND o.received_at<=?2
    AND o.received_at=(SELECT MAX(v.received_at) FROM finance_dataset_observations v
      WHERE v.dataset_id=o.dataset_id ${snapshotOnly?'':'AND v.observation_key=o.observation_key'} AND v.received_at<=?2)`;
  const [metadata,observations,count]=await db.batch([
    db.prepare('SELECT * FROM finance_dataset_state WHERE dataset_id=?1').bind(id),
    db.prepare(`SELECT o.* FROM finance_dataset_observations o WHERE ${selection}
      ORDER BY COALESCE(o.observed_at,o.received_at) DESC,o.observation_key DESC LIMIT ?3`).bind(id,knownAt,limit),
    db.prepare(`SELECT COUNT(*) AS n FROM finance_dataset_observations o WHERE ${selection}`).bind(id,knownAt),
  ]);
  const state=metadata.results[0]||null;
  const collectionStale=!state?.last_success_received_at || Date.now()-Date.parse(state.last_success_received_at)>definition.refreshSeconds*1000;
  const latestObserved=Math.max(...observations.results.map(r=>Date.parse(r.observed_at)||0),0);
  const sourceLagSeconds=latestObserved?Math.max(0,(Date.parse(knownAt)-latestObserved)/1000):null;
  const intervals={'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400,'1w':604800};
  const maxAge=definition.kind==='klines' ? intervals[definition.parameters.interval]*2+definition.refreshSeconds
    : ['premium','oi','book','global','options'].includes(definition.kind)?definition.refreshSeconds*2
      : ['oi-history','taker','ratio','basis'].includes(definition.kind)?10800:null;
  const sourceStale=maxAge!==null&&sourceLagSeconds!==null?sourceLagSeconds>maxAge:null;
  return {ok:observations.results.length>0,id,...definition,state,knownAt,
    stateScope:'current collection health; not historical health at knownAt',
    knowledgeBasis:'system-received; historical bootstrap is not point-in-time public availability',
    selection:snapshotOnly?'latest-received-snapshot':'latest-version-per-observation',
    coverage:{available:count.results[0].n,returned:observations.results.length,truncated:count.results[0].n>observations.results.length},
    collectionStale,sourceLagSeconds,sourceStale,
    sourceFreshnessBasis:maxAge===null?'publication-schedule-not-evaluated':`source observation age; threshold ${maxAge} seconds`,
    stale:collectionStale||sourceStale===true,
    observations:observations.results.map(row=>({key:row.observation_key,observedAt:row.observed_at,
      timePrecision:row.time_precision,receivedAt:row.received_at,storedAt:row.stored_at,
      sourceHost:row.source_host,ingestionMode:row.ingestion_mode,publicAvailableAt:null,
      sourceRevision:row.source_revision_json?JSON.parse(row.source_revision_json):null,values:JSON.parse(row.value_json)})),
  };
}

export async function datasetStates(db) {
  return (await db.prepare('SELECT * FROM finance_dataset_state ORDER BY dataset_id').all()).results;
}
