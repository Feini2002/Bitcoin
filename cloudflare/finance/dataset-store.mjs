import { FINANCE_DATASETS, normalizeDataset } from './datasets.mjs';

export function datasetWriteQueries(id,envelope,ingestionMode='cloud-readthrough') {
  if(!['cloud-readthrough','local-bootstrap'].includes(ingestionMode))throw new Error('invalid_ingestion_mode');
  const normalized=normalizeDataset(id,envelope);
  const storedAt=new Date().toISOString(),queries=[];
  for(let offset=0;offset<normalized.rows.length;offset+=100) {
    const rows=normalized.rows.slice(offset,offset+100);
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
      params:[id,normalized.receivedAt,storedAt,normalized.sourceHost,ingestionMode,JSON.stringify(rows)]});
  }
  queries.push({sql:`INSERT INTO finance_dataset_state
    (dataset_id,attempted_at,last_http_status,last_success_received_at,last_success_stored_at,last_ingestion_mode,row_count)
    VALUES (?1,?2,200,?3,?2,?4,?5)
    ON CONFLICT(dataset_id) DO UPDATE SET attempted_at=excluded.attempted_at,last_http_status=200,last_error=NULL,
      last_success_received_at=excluded.last_success_received_at,last_success_stored_at=excluded.last_success_stored_at,
      last_ingestion_mode=excluded.last_ingestion_mode,row_count=excluded.row_count
    WHERE finance_dataset_state.last_success_received_at IS NULL
      OR excluded.last_success_received_at>=finance_dataset_state.last_success_received_at`,
    params:[id,storedAt,normalized.receivedAt,ingestionMode,normalized.rows.length]});
  return {queries,normalized};
}

export async function persistDataset(db,id,envelope,ingestionMode) {
  const {queries,normalized}=datasetWriteQueries(id,envelope,ingestionMode);
  await db.batch(queries.map(q=>db.prepare(q.sql).bind(...q.params)));
  return normalized.rows.length;
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
