import { FINANCE_DATASETS, normalizeDataset } from './datasets.mjs';
import { KLINE_STEPS } from '../kline-recovery.mjs';

export const DESK_HISTORY_DDL = `CREATE TABLE IF NOT EXISTS desk_history_state (
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  head_t INTEGER NOT NULL,
  history_revision INTEGER NOT NULL,
  PRIMARY KEY (symbol, interval)
)`;

const BUMP_DDL = `CREATE TABLE IF NOT EXISTS _desk_hist_bump (
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  bump INTEGER NOT NULL,
  PRIMARY KEY (symbol, interval)
)`;

function bindQueries(db, queries) {
  return queries.map((query) => db.prepare(query.sql).bind(...query.params));
}

export function deskHistoryKey(id) {
  const definition = FINANCE_DATASETS[id];
  if (!definition) return null;
  if (definition.kind === 'klines') {
    const interval = definition.parameters.interval;
    return { symbol: definition.parameters.symbol || 'BTCUSDT', interval, step: KLINE_STEPS[interval] || 0, datasetId: id };
  }
  const symbol = definition.parameters.symbol || definition.parameters.pair || definition.parameters.currency || id;
  const period = definition.parameters.interval || definition.parameters.period;
  return { symbol, interval: id, step: KLINE_STEPS[period] || 0, datasetId: id };
}

function chunkList(rows, size) {
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

function bumpReset(symbol, interval) {
  return [
    { sql: DESK_HISTORY_DDL, params: [] },
    { sql: BUMP_DDL, params: [] },
    { sql: `UPDATE _desk_hist_bump SET bump=0 WHERE symbol=?1 AND interval=?2 AND bump<>0`, params: [symbol, interval] },
    { sql: `INSERT INTO _desk_hist_bump(symbol, interval, bump)
        SELECT ?1, ?2, 0 WHERE NOT EXISTS (SELECT 1 FROM _desk_hist_bump WHERE symbol=?1 AND interval=?2)`,
      params: [symbol, interval] },
  ];
}

function bumpIncrement(symbol, interval) {
  return { sql: `UPDATE desk_history_state SET history_revision=history_revision+1
    WHERE symbol=?1 AND interval=?2 AND EXISTS (
      SELECT 1 FROM _desk_hist_bump b WHERE b.symbol=?1 AND b.interval=?2 AND b.bump=1)`,
    params: [symbol, interval] };
}

function canonicalOutside(stepParam) {
  return `EXISTS (SELECT 1 FROM desk_history_state h WHERE h.symbol=?1 AND h.interval=?2 AND (
    (${stepParam}>0 AND CAST(json_extract(j.value,'$.open') AS INTEGER) < h.head_t - 19 * ${stepParam})
    OR (${stepParam}=0 AND CAST(json_extract(j.value,'$.open') AS INTEGER) < COALESCE((
      SELECT MIN(x.open_ms) FROM (
        SELECT CAST(observation_key AS INTEGER) AS open_ms FROM finance_dataset_observations
        WHERE dataset_id=?5 AND time_precision<>'receipt' AND observation_key GLOB '[0-9]*'
        ORDER BY observed_at DESC LIMIT 20) x), h.head_t + 1))))`;
}

export function canonicalHistoryStatements(id, rows, sourceHost, ingestionMode, {mutableReceipt=null}={}) {
  const key = deskHistoryKey(id);
  if (!key || !rows?.length) return { before: [], after: [] };
  const latestOpen = Math.max(...rows.map(row => Date.parse(row.observedAt)).filter(Number.isFinite));
  const before = bumpReset(key.symbol, key.interval);
  for (const part of chunkList(rows, 80)) {
    const payload = JSON.stringify(part.map((row) => ({
      key: String(row.key),
      open: Date.parse(row.observedAt),
      valuesJson: JSON.stringify(row.values),
    })));
    before.push({ sql: `UPDATE _desk_hist_bump SET bump=1
      WHERE symbol=?1 AND interval=?2 AND bump=0 AND EXISTS (
        SELECT 1 FROM json_each(?3) j
        WHERE ${canonicalOutside('?4')}
          AND (?8 IS NULL OR NOT EXISTS (
            SELECT 1 FROM finance_dataset_observations rejected
            WHERE rejected.dataset_id=?5 AND rejected.observation_key=json_extract(j.value,'$.key')
              AND rejected.received_at=rejected.observed_at AND rejected.stored_at>=?8))
          AND (
            SELECT CASE WHEN p.value_json IS NOT json_extract(j.value,'$.valuesJson')
              OR p.source_host IS NOT ?6 OR p.ingestion_mode IS NOT ?7 THEN 1 ELSE 0 END
            FROM finance_dataset_observations p
            WHERE p.dataset_id=?5 AND p.observation_key=json_extract(j.value,'$.key') AND p.time_precision<>'receipt'
            ORDER BY (CASE WHEN json_extract(p.value_json,'$.closed')=1 THEN 1 ELSE 0 END) DESC,
              (CASE WHEN p.received_at=p.observed_at THEN p.stored_at ELSE p.received_at END) DESC,
              p.received_at DESC
            LIMIT 1
          ) IS NOT 0)`,
      params: [key.symbol, key.interval, payload, key.step, key.datasetId, sourceHost || '', ingestionMode || 'cloud-readthrough', mutableReceipt] });
  }
  before.push(bumpIncrement(key.symbol, key.interval));
  const after = [
    { sql: `INSERT INTO desk_history_state(symbol, interval, head_t, history_revision)
        SELECT ?1, ?2, COALESCE((SELECT MAX(CAST(observation_key AS INTEGER)) FROM finance_dataset_observations
          WHERE dataset_id=?3 AND time_precision<>'receipt' AND observation_key GLOB '[0-9]*'), 0), 0
        WHERE NOT EXISTS (SELECT 1 FROM desk_history_state WHERE symbol=?1 AND interval=?2)
          AND EXISTS (SELECT 1 FROM finance_dataset_observations
            WHERE dataset_id=?3 AND time_precision<>'receipt' AND observation_key GLOB '[0-9]*')`,
      params: [key.symbol, key.interval, key.datasetId] },
    { sql: `UPDATE desk_history_state SET head_t=(
          SELECT MAX(CAST(observation_key AS INTEGER)) FROM finance_dataset_observations
          WHERE dataset_id=?3 AND time_precision<>'receipt' AND observation_key GLOB '[0-9]*')
        WHERE symbol=?1 AND interval=?2 AND head_t < (
          SELECT MAX(CAST(observation_key AS INTEGER)) FROM finance_dataset_observations
          WHERE dataset_id=?3 AND time_precision<>'receipt' AND observation_key GLOB '[0-9]*')`,
      params: [key.symbol, key.interval, key.datasetId] },
  ];
  if (FINANCE_DATASETS[id]?.kind === 'klines' && Number.isFinite(latestOpen)) {
    // The initial baseline above discovers pre-existing history once. Subsequent
    // batches already know their newest open; never rescan every receipt on each
    // forming-bar write. A delayed receipt cannot move the shared head backwards.
    after[1] = { sql: `UPDATE desk_history_state SET head_t=?3
      WHERE symbol=?1 AND interval=?2 AND head_t<?3`,
      params: [key.symbol, key.interval, latestOpen] };
  }
  return { before, after };
}

export function rawKlineHistoryStatements(symbol, interval, rows) {
  const step = KLINE_STEPS[interval] || 0;
  const usable = (rows || []).filter((row) => Number.isFinite(Number(row[0])));
  if (!usable.length) return { before: [], after: [] };
  const before = bumpReset(symbol, interval);
  for (const part of chunkList(usable, 80)) {
    const payload = JSON.stringify(part.map((row) => [Number(row[0]), Number(row[1]), Number(row[2]), Number(row[3]), Number(row[4]), Number(row[5])]));
    before.push({ sql: `UPDATE _desk_hist_bump SET bump=1
      WHERE symbol=?1 AND interval=?2 AND bump=0 AND EXISTS (
        SELECT 1 FROM json_each(?3) j
        WHERE EXISTS (SELECT 1 FROM desk_history_state h WHERE h.symbol=?1 AND h.interval=?2
          AND CAST(json_extract(j.value,'$[0]') AS INTEGER) < h.head_t - 19 * ?4)
          AND (
            NOT EXISTS (SELECT 1 FROM klines k WHERE k.symbol=?1 AND k.interval=?2 AND k.t=CAST(json_extract(j.value,'$[0]') AS INTEGER))
            OR EXISTS (SELECT 1 FROM klines k WHERE k.symbol=?1 AND k.interval=?2 AND k.t=CAST(json_extract(j.value,'$[0]') AS INTEGER)
              AND (k.o IS NOT CAST(json_extract(j.value,'$[1]') AS REAL) OR k.h IS NOT CAST(json_extract(j.value,'$[2]') AS REAL)
                OR k.l IS NOT CAST(json_extract(j.value,'$[3]') AS REAL) OR k.c IS NOT CAST(json_extract(j.value,'$[4]') AS REAL)
                OR k.v IS NOT CAST(json_extract(j.value,'$[5]') AS REAL)))))`,
      params: [symbol, interval, payload, step] });
  }
  before.push(bumpIncrement(symbol, interval));
  const after = [
    { sql: `INSERT INTO desk_history_state(symbol, interval, head_t, history_revision)
        SELECT ?1, ?2, COALESCE((SELECT MAX(t) FROM klines WHERE symbol=?1 AND interval=?2), 0), 0
        WHERE NOT EXISTS (SELECT 1 FROM desk_history_state WHERE symbol=?1 AND interval=?2)
          AND EXISTS (SELECT 1 FROM klines WHERE symbol=?1 AND interval=?2)`,
      params: [symbol, interval] },
    { sql: `UPDATE desk_history_state SET head_t=(SELECT MAX(t) FROM klines WHERE symbol=?1 AND interval=?2)
        WHERE symbol=?1 AND interval=?2 AND head_t < (SELECT MAX(t) FROM klines WHERE symbol=?1 AND interval=?2)`,
      params: [symbol, interval] },
  ];
  return { before, after };
}

export function gapHistoryStatements(id, from, nextError) {
  const key = deskHistoryKey(id);
  if (!key) return [];
  const step = key.step || 0;
  return [
    { sql: DESK_HISTORY_DDL, params: [] },
    { sql: `INSERT INTO desk_history_state(symbol, interval, head_t, history_revision)
        SELECT ?1, ?2, COALESCE((SELECT MAX(CAST(observation_key AS INTEGER)) FROM finance_dataset_observations
          WHERE dataset_id=?3 AND time_precision<>'receipt' AND observation_key GLOB '[0-9]*'), ?4), 0
        WHERE NOT EXISTS (SELECT 1 FROM desk_history_state WHERE symbol=?1 AND interval=?2)`,
      params: [key.symbol, key.interval, id, Number(from) || 0] },
    { sql: `UPDATE desk_history_state SET history_revision=history_revision+1
        WHERE symbol=?1 AND interval=?2
          AND EXISTS (SELECT 1 FROM finance_dataset_state WHERE dataset_id=?3 AND last_error=?4)
          AND (
            (?6>0 AND ?5 < head_t - 19 * ?6)
            OR (?6=0 AND ?5 < head_t)
          )`,
      params: [key.symbol, key.interval, id, nextError, Number(from) || 0, step] },
  ];
}

export function historyBaselineStatement(symbol, interval, datasetId) {
  return { sql: `INSERT INTO desk_history_state(symbol, interval, head_t, history_revision)
    SELECT ?1, ?2, COALESCE((SELECT MAX(v) FROM (
      SELECT MAX(t) AS v FROM klines WHERE symbol=?1 AND interval=?2
      UNION ALL
      SELECT MAX(CAST(observation_key AS INTEGER)) AS v FROM finance_dataset_observations
      WHERE dataset_id=?3 AND time_precision<>'receipt' AND observation_key GLOB '[0-9]*'
    )), 0), 0
    WHERE NOT EXISTS (SELECT 1 FROM desk_history_state WHERE symbol=?1 AND interval=?2)
      AND (
        EXISTS (SELECT 1 FROM klines WHERE symbol=?1 AND interval=?2)
        OR EXISTS (SELECT 1 FROM finance_dataset_observations
          WHERE dataset_id=?3 AND time_precision<>'receipt' AND observation_key GLOB '[0-9]*'))`,
    params: [symbol, interval, datasetId] };
}

function observationKeyWalkCteSql() {
  // The receipt index is cheaper in SQLite's estimate but scans/sorts the whole
  // dataset for each key. Force observed-time seeks, including nullable bounds.
  // Combine the recursive upper bounds: two separate inequalities can make
  // SQLite seek the static bound, then scan past all newer keys on every step.
  return `WITH RECURSIVE seed AS (
      SELECT observation_key, observed_at FROM finance_dataset_observations INDEXED BY idx_finance_dataset_observed
      WHERE dataset_id=?1 AND time_precision<>'receipt' AND received_at<=?2
        AND observed_at>=COALESCE(?3,'') AND observed_at<COALESCE(?4,'Z')
        AND (?6=0 OR (CASE WHEN received_at=observed_at THEN stored_at ELSE received_at END)<=?2)
      ORDER BY observed_at DESC, observation_key DESC LIMIT 1),
    keys AS (
    SELECT observation_key, observed_at, 1 AS n FROM seed
    UNION ALL
    SELECT observation_key, observed_at, 1 AS n FROM (
      SELECT observation_key, observed_at FROM finance_dataset_observations INDEXED BY idx_finance_dataset_observed
      WHERE ?3 IS NULL AND ?4 IS NULL AND dataset_id=?1 AND observed_at IS NULL
        AND time_precision<>'receipt' AND received_at<=?2
        AND (?6=0 OR (CASE WHEN received_at=observed_at THEN stored_at ELSE received_at END)<=?2)
        AND NOT EXISTS (SELECT 1 FROM seed)
      ORDER BY observation_key DESC LIMIT 1)
    UNION ALL
    SELECT (
      SELECT observation_key FROM finance_dataset_observations INDEXED BY idx_finance_dataset_observed
      WHERE dataset_id=?1 AND time_precision<>'receipt' AND received_at<=?2
        AND observed_at>=COALESCE(?3,'') AND observed_at<COALESCE(?4,'Z')
        AND (?6=0 OR (CASE WHEN received_at=observed_at THEN stored_at ELSE received_at END)<=?2)
        AND observed_at=(
          SELECT MAX(observed_at) FROM finance_dataset_observations INDEXED BY idx_finance_dataset_observed
          WHERE dataset_id=?1 AND time_precision<>'receipt' AND received_at<=?2
            AND observed_at>=COALESCE(?3,'') AND observed_at<MIN(COALESCE(?4,'Z'),keys.observed_at)
            AND (?6=0 OR (CASE WHEN received_at=observed_at THEN stored_at ELSE received_at END)<=?2))
      ORDER BY observation_key DESC LIMIT 1),
    (SELECT MAX(observed_at) FROM finance_dataset_observations INDEXED BY idx_finance_dataset_observed
      WHERE dataset_id=?1 AND time_precision<>'receipt' AND received_at<=?2
        AND observed_at>=COALESCE(?3,'') AND observed_at<MIN(COALESCE(?4,'Z'),keys.observed_at)
        AND (?6=0 OR (CASE WHEN received_at=observed_at THEN stored_at ELSE received_at END)<=?2)),
    keys.n+1
    FROM keys
    WHERE keys.n<?5 AND EXISTS (
      SELECT 1 FROM finance_dataset_observations INDEXED BY idx_finance_dataset_observed
      WHERE dataset_id=?1 AND time_precision<>'receipt' AND received_at<=?2
        AND observed_at>=COALESCE(?3,'') AND observed_at<MIN(COALESCE(?4,'Z'),keys.observed_at)
        AND (?6=0 OR (CASE WHEN received_at=observed_at THEN stored_at ELSE received_at END)<=?2)))`;
}

export function observationKeyWalkSql() {
  return `${observationKeyWalkCteSql()}
    SELECT observation_key, observed_at, n FROM keys WHERE observation_key IS NOT NULL`;
}

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
    ON CONFLICT(dataset_id) DO UPDATE SET attempted_at=excluded.attempted_at,last_http_status=200,
      last_error=CASE WHEN finance_dataset_state.last_error LIKE 'dataset_history_gap_pending:%' THEN finance_dataset_state.last_error ELSE NULL END,
      last_success_received_at=excluded.last_success_received_at,last_success_stored_at=excluded.last_success_stored_at,
      last_ingestion_mode=excluded.last_ingestion_mode,row_count=excluded.row_count
    WHERE finance_dataset_state.last_success_received_at IS NULL
      OR excluded.last_success_received_at>finance_dataset_state.last_success_received_at`,
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
const wholeSnapshot = id => ['options','option-instruments'].includes(FINANCE_DATASETS[id]?.kind);
const DATASET_RETENTION_BY_ID = {
  'crypto-breadth': { keep: 4032, maxAgeMs: 14 * DAY_MS },
  'btc-fees': { keep: 10080, maxAgeMs: 7 * DAY_MS },
  'stablecoin-supply': { keep: 2200, maxAgeMs: 90 * DAY_MS },
  'deribit-btc-options': { keep: 8, maxAgeMs: 7 * DAY_MS },
  'deribit-usdc-btc-options': { keep: 8, maxAgeMs: 7 * DAY_MS },
  'deribit-btc-option-instruments': { keep: 8, maxAgeMs: 7 * DAY_MS },
  'deribit-usdc-btc-option-instruments': { keep: 8, maxAgeMs: 7 * DAY_MS },
  'deribit-btc-perp-ticker': { keep: 1440, maxAgeMs: DAY_MS },
  'deribit-btc-perp-funding': { keep: 720, maxAgeMs: 30 * DAY_MS },
};

export function datasetRetention(id) {
  if (DATASET_RETENTION_BY_ID[id]) return DATASET_RETENTION_BY_ID[id];
  const definition = FINANCE_DATASETS[id];
  if (!definition) return { keep: 500 };
  if (definition.kind === 'klines') return { keep: id === 'binance-perp-klines-5m' ? 900 : 600 };
  if (definition.kind === 'premium' || definition.kind === 'oi') return { keep: 3600 };
  if (definition.kind === 'book') return { keep: 720 };
  if (definition.kind === 'fred' || definition.kind === 'sofr') return { keep: 1500 };
  if (definition.kind === 'instrument' || definition.kind === 'funding-info') return { keep: 30 };
  return { keep: 500 };
}

export async function pruneDatasetObservations(db, id, keep, batchSize = 1000) {
  const cap = Math.max(1, Number(keep) || 1);
  // Options are whole received snapshots, not individual option contracts.
  if (wholeSnapshot(id)) {
    const res = await db.prepare(`DELETE FROM finance_dataset_observations
      WHERE dataset_id=?1 AND received_at=(
        SELECT received_at FROM finance_dataset_observations WHERE dataset_id=?1
        GROUP BY received_at ORDER BY received_at DESC LIMIT 1 OFFSET ?2
      )`).bind(id, cap).run();
    return Number(res?.meta?.changes) || 0;
  }
  const batch = Math.max(1, Math.min(1000, Number(batchSize) || 1000));
  const res = await db.prepare(
    `DELETE FROM finance_dataset_observations
      WHERE rowid IN (SELECT rowid FROM finance_dataset_observations
        WHERE dataset_id=?1 AND time_precision<>'receipt' AND observation_key NOT IN (
          SELECT observation_key FROM finance_dataset_observations WHERE dataset_id=?1
          AND time_precision<>'receipt'
          GROUP BY observation_key
          ORDER BY MAX(COALESCE(observed_at,received_at)) DESC, observation_key DESC LIMIT ?2
        ) LIMIT ?3)`
  ).bind(id, cap, batch).run();
  let pruned=Number(res?.meta?.changes) || 0;
  if (pruned<batch && ['fred','sofr'].includes(FINANCE_DATASETS[id]?.kind)) {
    // Receipt evidence lives only as long as at least one referenced retained date.
    // Never expire a true revision or a still-queryable receipt by an arbitrary age.
    const receipts=await db.prepare(`DELETE FROM finance_dataset_observations WHERE rowid IN (
      SELECT m.rowid FROM finance_dataset_observations m WHERE m.dataset_id=?1 AND m.time_precision='receipt'
        AND NOT EXISTS (SELECT 1 FROM json_each(m.value_json,'$.keys') k JOIN finance_dataset_observations o
          ON o.dataset_id=m.dataset_id AND o.observation_key=k.value AND o.time_precision<>'receipt') LIMIT ?2)`)
      .bind(id,batch-pruned).run();
    pruned+=Number(receipts?.meta?.changes) || 0;
  }
  return pruned;
}

export async function pruneDatasetByAge(db, id, maxAgeMs, now = Date.now()) {
  const age = Number(maxAgeMs) || 0;
  if (age <= 0) return 0;
  const cutoff = new Date(now - age).toISOString();
  if (wholeSnapshot(id)) {
    const res = await db.prepare(`DELETE FROM finance_dataset_observations
      WHERE dataset_id=?1 AND received_at=(SELECT MIN(received_at)
        FROM finance_dataset_observations WHERE dataset_id=?1 AND received_at < ?2)`)
      .bind(id, cutoff).run();
    return Number(res?.meta?.changes) || 0;
  }
  const res = await db.prepare(
    `DELETE FROM finance_dataset_observations WHERE rowid IN (
      SELECT rowid FROM finance_dataset_observations WHERE dataset_id=?1 AND received_at < ?2 LIMIT 1000
    )`
  ).bind(id, cutoff).run();
  return Number(res && res.meta && res.meta.changes) || 0;
}

export async function pruneExpiredDatasets(db, now = Date.now(), { ids = Object.keys(FINANCE_DATASETS) } = {}) {
  let pruned = 0;
  for (const id of ids) {
    if (!FINANCE_DATASETS[id]) continue;
    const rule = datasetRetention(id);
    if (rule.maxAgeMs) pruned += await pruneDatasetByAge(db, id, rule.maxAgeMs, now);
    if (rule.keep) pruned += await pruneDatasetObservations(db, id, rule.keep);
  }
  return pruned;
}

export async function persistLiveSnapshot(db, id, data, sourceHost, ingestionMode = 'cloud-ws', options = {}) {
  const definition = FINANCE_DATASETS[id];
  if (!definition) return 0;
  const receivedAt = options.receivedAt || new Date().toISOString();
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

export async function persistLiveKlineBar(db, interval, kline, sourceHost, ingestionMode = 'cloud-ws', options = {}) {
  const id = `binance-perp-klines-${interval}`;
  const definition = FINANCE_DATASETS[id];
  if (!definition) return 0;
  const receivedAt = options.receivedAt || new Date().toISOString();
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
  if (Object.hasOwn(options, 'closed')) {
    row.values.closed = typeof options.closed === 'boolean' ? options.closed : null;
    row.values.finality = options.closed === true ? 'exchange_closed' : options.closed === false ? 'forming' : 'unknown';
    row.values.closureBasis = 'exchange-websocket-close-flag';
  }
  if (options.closed === null && ingestionMode === 'cloud-readthrough') {
    const confirmed = await db.prepare(`SELECT received_at FROM finance_dataset_observations
      WHERE dataset_id=?1 AND observation_key=?2 AND received_at<=?3
        AND (CASE WHEN received_at=observed_at THEN stored_at ELSE received_at END)<=?3
        AND json_extract(value_json,'$.finality')='exchange_closed' LIMIT 1`)
      .bind(id,row.key,receivedAt).all();
    if (confirmed.results?.length) {
      row.values.closed = true;
      row.values.finality = 'exchange_closed';
      row.values.closureBasis = 'exchange-websocket-close-flag; retained across later REST observation';
    }
  }
  const liveReceipt = options.closed === true ? receivedAt : row.observedAt;
  const storedAt = receivedAt;
  const mode = ['cloud-readthrough', 'local-bootstrap', 'cloud-ws'].includes(ingestionMode) ? ingestionMode : 'cloud-ws';
  if (options.closed === true) {
    const result = await db.prepare(`SELECT value_json FROM finance_dataset_observations
      WHERE dataset_id=?1 AND observation_key=?2 AND received_at=?3`).bind(id,row.key,receivedAt).all();
    if (result.results?.length) {
    if (JSON.stringify(JSON.parse(result.results[0].value_json)) !== JSON.stringify(row.values)) throw new Error('dataset_identity_content_conflict');
      return 0;
    }
    const {queries} = datasetWriteQueries(id,envelope,mode,[row]);
    const history = canonicalHistoryStatements(id, [row], normalized.sourceHost, mode);
    await db.batch(bindQueries(db, [...history.before, ...queries, ...history.after]));
    return 1;
  }
  // Check the mutable upsert's acceptance condition in the same transaction as
  // the revision bump; a delayed/replayed receipt must not invalidate history.
  const history = canonicalHistoryStatements(id, [row], normalized.sourceHost, mode, {mutableReceipt:receivedAt});
  await db.batch([
    ...bindQueries(db, history.before),
    db.prepare(`INSERT INTO finance_dataset_observations
      (dataset_id, observation_key, observed_at, time_precision, received_at, stored_at,
       source_host, ingestion_mode, source_revision_json, value_json)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
      ON CONFLICT(dataset_id,observation_key,received_at) DO UPDATE SET
        value_json=excluded.value_json, stored_at=excluded.stored_at,
        source_host=excluded.source_host, ingestion_mode=excluded.ingestion_mode
      WHERE excluded.stored_at>finance_dataset_observations.stored_at`)
      .bind(
        id, String(row.key), row.observedAt, row.timePrecision, liveReceipt, storedAt,
        normalized.sourceHost, mode,
        row.sourceRevision ? JSON.stringify(row.sourceRevision) : null,
        JSON.stringify(row.values)
      ),
    db.prepare(`INSERT INTO finance_dataset_state
      (dataset_id,attempted_at,last_http_status,last_success_received_at,last_success_stored_at,last_ingestion_mode,row_count)
      VALUES (?1,?2,200,?3,?2,?4,1)
      ON CONFLICT(dataset_id) DO UPDATE SET attempted_at=excluded.attempted_at,last_http_status=200,
        last_error=CASE WHEN finance_dataset_state.last_error LIKE 'dataset_history_gap_pending:%' THEN finance_dataset_state.last_error ELSE NULL END,
        last_success_received_at=excluded.last_success_received_at,last_success_stored_at=excluded.last_success_stored_at,
        last_ingestion_mode=excluded.last_ingestion_mode
      WHERE finance_dataset_state.last_success_received_at IS NULL
        OR excluded.last_success_received_at>finance_dataset_state.last_success_received_at`)
      .bind(id, storedAt, receivedAt, mode),
    ...bindQueries(db, history.after),
  ]);
  return 1;
}

export async function persistDataset(db,id,envelope,ingestionMode) {
  const definition = FINANCE_DATASETS[id];
  const normalized = normalizeDataset(id,envelope);
  let rows = normalized.rows;
  if (definition && ['fred','sofr'].includes(definition.kind)) return persistMacroDataset(db,id,envelope,ingestionMode,normalized);
  if (definition?.kind === 'klines') {
    const confirmed = await db.prepare(`SELECT DISTINCT observation_key FROM finance_dataset_observations
      WHERE dataset_id=?1 AND received_at<=?2 AND json_extract(value_json,'$.finality')='exchange_closed'
        AND (CASE WHEN received_at=observed_at THEN stored_at ELSE received_at END)<=?2
        AND observation_key IN (SELECT value FROM json_each(?3))`)
      .bind(id,normalized.receivedAt,JSON.stringify(rows.map(row=>row.key))).all();
    const closed = new Set((confirmed.results || []).map(row=>row.observation_key));
    for (const row of rows) if (closed.has(row.key) && row.values.closed===true) {
      row.values.closed=true; row.values.finality='exchange_closed';
      row.values.closureBasis='exchange-websocket-close-flag; retained across later REST observation';
    }
  }
  // A cached response has the same receipt identity. Reusing it must not write
  // observations, a success heartbeat or a retention scan. Different receipts,
  // even equal-valued ones, remain separate evidence (including late arrivals).
  const receipt = await db.prepare(`SELECT observation_key, value_json, source_revision_json
    FROM finance_dataset_observations WHERE dataset_id=?1 AND received_at=?2
      AND observation_key IN (SELECT value FROM json_each(?3))`)
    .bind(id, normalized.receivedAt, JSON.stringify(rows.map(row => row.key))).all();
  const existingReceipt = new Map((receipt.results || []).map(row => [row.observation_key, row]));
  rows = rows.filter(row => {
    const previous = existingReceipt.get(row.key);
    if (!previous) return true;
    if (JSON.stringify(JSON.parse(previous.value_json)) !== JSON.stringify(row.values)
      || JSON.stringify(previous.source_revision_json ? JSON.parse(previous.source_revision_json) : null) !== JSON.stringify(row.sourceRevision || null)) {
      throw new Error('dataset_identity_content_conflict');
    }
    return false;
  });
  if (!rows.length) return 0;
  const envelopeForWrite = envelope;
  const {queries} = datasetWriteQueries(id, envelopeForWrite, ingestionMode, rows);
  if (!queries.length) return 0;
  const history = canonicalHistoryStatements(id, rows, normalized.sourceHost, ingestionMode);
  await db.batch(bindQueries(db, [...history.before, ...queries, ...history.after]));
  return rows.length;
}

export async function datasetFailure(db,id,http,error) {
  await db.prepare(`INSERT INTO finance_dataset_state(dataset_id,attempted_at,last_http_status,last_error)
    VALUES (?1,?2,?3,?4) ON CONFLICT(dataset_id) DO UPDATE SET attempted_at=excluded.attempted_at,
      last_http_status=excluded.last_http_status,
      last_error=CASE WHEN finance_dataset_state.last_error LIKE 'dataset_history_gap_pending:%' THEN finance_dataset_state.last_error ELSE excluded.last_error END`
  ).bind(id,new Date().toISOString(),http,error).run();
}

function macroSignature(values,revision,receipt) {
  const queryWindow=revision?.queryWindow===true || (revision && !Object.hasOwn(revision,'queryWindow') && revision.realtimeStart===String(receipt).slice(0,10) && revision.realtimeEnd===String(receipt).slice(0,10));
  return JSON.stringify([values,queryWindow ? {queryWindow:true}:revision || null]);
}
function macroRevisionSql(revision,receipt) {
  return `(CASE WHEN json_extract(${revision},'$.queryWindow')=1 OR
    (json_type(${revision},'$.queryWindow') IS NULL AND json_extract(${revision},'$.realtimeStart')=substr(${receipt},1,10)
      AND json_extract(${revision},'$.realtimeEnd')=substr(${receipt},1,10))
    THEN '{"queryWindow":true}' ELSE COALESCE(${revision},'null') END)`;
}
async function persistMacroDataset(db,id,envelope,ingestionMode,normalized) {
  const {rows,receivedAt}=normalized, keys=rows.map(row=>row.key), keyJson=JSON.stringify(keys);
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(rows)));
  const digest=Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
  const receipt=await db.prepare(`SELECT value_json FROM finance_dataset_observations
    WHERE dataset_id=?1 AND observation_key='@receipt' AND received_at=?2`).bind(id,receivedAt).all();
  if(receipt.results?.length) {
    if(JSON.parse(receipt.results[0].value_json).digest!==digest)throw new Error('dataset_identity_content_conflict');
    return 0;
  }
  const previous=await db.prepare(`SELECT o.* FROM finance_dataset_observations o
    WHERE o.dataset_id=?1 AND o.observation_key IN (SELECT value FROM json_each(?3)) AND o.received_at<=?2
      AND o.received_at=(SELECT MAX(v.received_at) FROM finance_dataset_observations v
        WHERE v.dataset_id=o.dataset_id AND v.observation_key=o.observation_key AND v.received_at<=?2)`)
    .bind(id,receivedAt,keyJson).all();
  const prev=new Map((previous.results || []).map(row=>[row.observation_key,row]));
  rows.forEach(row=>{
    const prior=prev.get(row.key); if(!prior)return true;
    const same=macroSignature(JSON.parse(prior.value_json),prior.source_revision_json?JSON.parse(prior.source_revision_json):null,prior.received_at)
      ===macroSignature(row.values,row.sourceRevision,receivedAt);
    if(prior.received_at===receivedAt && !same)throw new Error('dataset_identity_content_conflict');
  });
  // Both decisions run inside the D1 batch transaction. A preflight read alone
  // cannot see another isolate's intervening receipt and may erase A -> B -> A.
  const {queries}=datasetWriteQueries(id,envelope,ingestionMode,rows);
  queries.at(-1).params[4]=rows.length;
  for(const query of queries.slice(0,-1)) {
    query.sql=query.sql.replace('WHERE 1',`WHERE NOT EXISTS (
      SELECT 1 FROM finance_dataset_observations p WHERE p.dataset_id=?1 AND p.observation_key=json_extract(j.value,'$.key')
        AND p.received_at=(SELECT MAX(v.received_at) FROM finance_dataset_observations v
          WHERE v.dataset_id=p.dataset_id AND v.observation_key=p.observation_key AND v.received_at<=?2)
        AND p.value_json=json_extract(j.value,'$.values')
        AND ${macroRevisionSql('p.source_revision_json','p.received_at')}=${macroRevisionSql("json_extract(j.value,'$.sourceRevision')",'?2')})`);
  }
  // Materialize once and drive joins from the input keys: flattening this CTE
  // multiplies successor lookup by every stored observation (daily FRED: 1,500).
  queries.unshift({sql:`INSERT INTO finance_dataset_observations
    (dataset_id,observation_key,observed_at,time_precision,received_at,stored_at,source_host,ingestion_mode,source_revision_json,value_json)
    WITH next_receipts AS MATERIALIZED (
      SELECT json_extract(j.value,'$.key') AS observation_key,j.value AS payload,
        (SELECT MIN(m.received_at) FROM finance_dataset_observations m
          WHERE m.dataset_id=?1 AND m.observation_key='@receipt' AND m.time_precision='receipt' AND m.received_at>?2
            AND EXISTS(SELECT 1 FROM json_each(m.value_json,'$.keys') k WHERE k.value=json_extract(j.value,'$.key'))) AS next_at
      FROM json_each(?3) j)
    SELECT ?1,o.observation_key,o.observed_at,o.time_precision,n.next_at,m.stored_at,m.source_host,m.ingestion_mode,o.source_revision_json,o.value_json
    FROM next_receipts n CROSS JOIN finance_dataset_observations m CROSS JOIN finance_dataset_observations o
    WHERE n.next_at IS NOT NULL
      AND m.dataset_id=?1 AND m.observation_key='@receipt' AND m.received_at=n.next_at
      AND o.dataset_id=?1 AND o.observation_key=n.observation_key
      AND o.received_at=(SELECT MAX(v.received_at) FROM finance_dataset_observations v
        WHERE v.dataset_id=?1 AND v.observation_key=n.observation_key AND v.received_at<=n.next_at)
      AND o.received_at<n.next_at AND (o.value_json<>json_extract(n.payload,'$.values')
      OR ${macroRevisionSql('o.source_revision_json','o.received_at')}<>${macroRevisionSql("json_extract(n.payload,'$.sourceRevision')",'?2')})
    ON CONFLICT(dataset_id,observation_key,received_at) DO NOTHING`,params:[id,receivedAt,JSON.stringify(rows)]});
  for(const query of queries.slice(0,-1))query.sql+=' RETURNING observation_key';
  const queryWindow=rows.every(row=>row.sourceRevision?.queryWindow) ? rows[0].sourceRevision:null;
  queries.push({sql:`INSERT INTO finance_dataset_observations
    (dataset_id,observation_key,observed_at,time_precision,received_at,stored_at,source_host,ingestion_mode,source_revision_json,value_json)
    VALUES (?1,'@receipt',NULL,'receipt',?2,?3,?4,?5,NULL,?6) ON CONFLICT(dataset_id,observation_key,received_at) DO NOTHING`,
    params:[id,receivedAt,new Date().toISOString(),normalized.sourceHost,ingestionMode || 'cloud-readthrough',JSON.stringify({digest,keys,queryWindow})]});
  const history=canonicalHistoryStatements(id, rows, normalized.sourceHost, ingestionMode || 'cloud-readthrough');
  const batchQueries=[...history.before, ...queries, ...history.after];
  const committed=await db.batch(bindQueries(db, batchQueries));
  const observationResults=committed.slice(history.before.length, history.before.length + queries.length - 2);
  return observationResults.reduce((sum,result)=>sum+(result.results?.length || 0),0);
}

export async function persistRestKlineBatch(db,interval,rows,sourceHost,{receivedAt,requestStartedAt,transportHost=null}={}) {
  const id=`binance-perp-klines-${interval}`, definition=FINANCE_DATASETS[id];
  if(!definition)return 0;
  if(Array.isArray(rows) && !rows.length)return 0;
  const cutoff=Date.parse(requestStartedAt);
  if (!definition || !Number.isFinite(cutoff) || !Number.isFinite(Date.parse(receivedAt))
    || !Array.isArray(rows) || rows.some(row=>!Number.isFinite(Number(row[6])) || Number(row[6])>=cutoff)) throw new Error('dataset_invalid_closed_rest_batch');
  return persistDataset(db,id,{provider:definition.provider,operation:definition.operation,parameters:definition.parameters,
    source:{host:sourceHost, ...(transportHost ? {transportHost} : {})},requestedAt:requestStartedAt,receivedAt,data:rows},'cloud-readthrough');
}

export async function readDataset(db,id,options={}) {
  const {limit=1000,knownAt=new Date().toISOString(),historical=Object.hasOwn(options,'knownAt')}=options;
  const definition=FINANCE_DATASETS[id];
  if(!definition)throw new Error('unknown_dataset');
  const snapshotOnly=wholeSnapshot(id);
  let selection=`o.dataset_id=?1 AND o.time_precision<>'receipt' AND o.received_at<=?2
    AND o.received_at=(SELECT MAX(v.received_at) FROM finance_dataset_observations v
      WHERE v.dataset_id=o.dataset_id ${snapshotOnly?'':'AND v.observation_key=o.observation_key'} AND v.received_at<=?2)`;
  if (definition.kind==='klines') {
    // Legacy/current live rows use the bar-open time as a mutable storage key.
    // Compare their last actual receipt with immutable REST/closed receipts for
    // current reads. Historical reads cannot reconstruct an overwritten live
    // state; exclude that row when its actual receipt is later than knownAt.
    const effective = alias => `(CASE WHEN ${alias}.received_at=${alias}.observed_at THEN ${alias}.stored_at ELSE ${alias}.received_at END)`;
    const eligible = alias => `${alias}.received_at<=?2${historical?` AND ${effective(alias)}<=?2`:''}`;
    const closed = alias => `(CASE WHEN json_extract(${alias}.value_json,'$.closed')=1 THEN 1 ELSE 0 END)`;
    selection=`o.dataset_id=?1 AND ${eligible('o')}
      AND NOT EXISTS (SELECT 1 FROM finance_dataset_observations v
        WHERE v.dataset_id=o.dataset_id AND v.observation_key=o.observation_key AND ${eligible('v')}
          AND (${closed('v')}>${closed('o')} OR (${closed('v')}=${closed('o')} AND
            (${effective('v')}>${effective('o')} OR
              (${effective('v')}=${effective('o')} AND v.received_at>o.received_at)))))`;
  }
  const [metadata,observations,count]=await db.batch([
    db.prepare('SELECT * FROM finance_dataset_state WHERE dataset_id=?1').bind(id),
    db.prepare(`SELECT o.* FROM finance_dataset_observations o WHERE ${selection}
      ORDER BY COALESCE(o.observed_at,o.received_at) DESC,o.observation_key DESC LIMIT ?3`).bind(id,knownAt,limit),
    db.prepare(`SELECT COUNT(*) AS n FROM finance_dataset_observations o WHERE ${selection}`).bind(id,knownAt),
  ]);
  const state=metadata.results[0]||null;
  const macroReceipt=await readMacroReceipt(db,id,definition,knownAt);
  let unresolvedGap=null;
  if(String(state?.last_error || '').startsWith('dataset_history_gap_pending:')) {
    try {const gap=JSON.parse(state.last_error.slice('dataset_history_gap_pending:'.length));unresolvedGap={from:new Date(gap.from).toISOString(),to:new Date(gap.to).toISOString(),retryAt:gap.retryAt?new Date(gap.retryAt).toISOString():null};}catch{}
  }
  const collectionStale=!state?.last_success_received_at || Date.now()-Date.parse(state.last_success_received_at)>definition.refreshSeconds*1000;
  const latestObserved=Math.max(...observations.results.map(r=>Date.parse(r.observed_at)||0),0);
  const sourceLagSeconds=latestObserved?Math.max(0,(Date.parse(knownAt)-latestObserved)/1000):null;
  const intervals={'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400,'1w':604800};
  const maxAge=definition.kind==='klines' ? intervals[definition.parameters.interval]*2+definition.refreshSeconds
    : ['premium','oi','book','global','options'].includes(definition.kind)?definition.refreshSeconds*2
      : ['oi-history','taker','ratio','basis'].includes(definition.kind)?10800:null;
  const sourceStale=maxAge!==null&&sourceLagSeconds!==null?sourceLagSeconds>maxAge:null;
  return {ok:observations.results.length>0,id,...definition,state,knownAt,
    readIntent:historical?'historical':'current',
    stateScope:'current collection health; not historical health at knownAt',
    knowledgeBasis:'system-received; historical bootstrap is not point-in-time public availability',
    selection:snapshotOnly?'latest-received-snapshot':'latest-version-per-observation',
    coverage:{available:count.results[0].n,returned:observations.results.length,truncated:count.results[0].n>observations.results.length,incomplete:!!unresolvedGap,unresolvedGap},
    collectionStale,sourceLagSeconds,sourceStale,
    sourceFreshnessBasis:maxAge===null?'publication-schedule-not-evaluated':`source observation age; threshold ${maxAge} seconds`,
    stale:collectionStale||sourceStale===true,
    observations:observations.results.map(row=>applyMacroReceipt(mapStoredObservation(row,definition),macroReceipt)),
  };
}

async function readMacroReceipt(db, id, definition, knownAt) {
  if (!['fred','sofr'].includes(definition.kind)) return null;
  const latest=await db.prepare(`SELECT * FROM finance_dataset_observations
    WHERE dataset_id=?1 AND observation_key='@receipt' AND time_precision='receipt'
      AND received_at<=?2 ORDER BY received_at DESC LIMIT 1`).bind(id,knownAt).all();
  const row=latest.results?.[0];
  if (!row) return null;
  const receipt=JSON.parse(row.value_json);
  return {...receipt,keys:new Set(receipt.keys || []),receivedAt:row.received_at,storedAt:row.stored_at,
    sourceHost:row.source_host,ingestionMode:row.ingestion_mode};
}

function applyMacroReceipt(observation, receipt) {
  if (!receipt?.keys.has(observation.key)) return observation;
  return {...observation,receivedAt:receipt.receivedAt,storedAt:receipt.storedAt,
    effectiveReceivedAt:receipt.receivedAt,sourceHost:receipt.sourceHost,ingestionMode:receipt.ingestionMode,
    sourceRevision:receipt.queryWindow || observation.sourceRevision};
}

function mapStoredObservation(row, definition) {
  return {key:row.observation_key,observedAt:row.observed_at,timePrecision:row.time_precision,
    receivedAt:row.received_at,storedAt:row.stored_at,
    effectiveReceivedAt:definition.kind==='klines'&&row.received_at===row.observed_at?row.stored_at:row.received_at,
    sourceHost:row.source_host,ingestionMode:row.ingestion_mode,publicAvailableAt:null,
    sourceRevision:row.source_revision_json?JSON.parse(row.source_revision_json):null,
    values:JSON.parse(row.value_json)};
}

// The prepared read can join raw tape, version and state reads in one D1 batch.
// Only cap+1 distinct in-range keys and one predecessor reach winner selection.
// Select one ranked rowid per key. Comparing every receipt against all other
// receipts was quadratic and caused D1 overload even for a 20-candle tail.
export function prepareBoundedObservations(db, id, {limit=6000, fromMs=null, toMs=null, knownAt=new Date().toISOString(), historical=false, predecessor=true}={}) {
  const definition = FINANCE_DATASETS[id];
  if (!definition) throw new Error('unknown_dataset');
  const cap = Math.max(1, Math.min(6000, Number(limit) || 1));
  const fromIso = Number.isFinite(fromMs) ? new Date(fromMs).toISOString() : null;
  const toIso = Number.isFinite(toMs) ? new Date(toMs).toISOString() : null;
  const statement=db.prepare(`${observationKeyWalkCteSql()},
    predecessor_key AS (
      SELECT observation_key, observed_at, 0 AS n FROM finance_dataset_observations INDEXED BY idx_finance_dataset_observed
      WHERE ?7=1 AND dataset_id=?1 AND time_precision<>'receipt' AND received_at<=?2
        AND (?6=0 OR (CASE WHEN received_at=observed_at THEN stored_at ELSE received_at END)<=?2)
        AND observed_at<COALESCE(?3,(SELECT observed_at FROM keys WHERE n<?5 ORDER BY n DESC LIMIT 1))
      ORDER BY observed_at DESC, observation_key DESC LIMIT 1),
    selected_keys AS (
      SELECT observation_key, observed_at, n FROM keys WHERE observation_key IS NOT NULL
      UNION ALL SELECT observation_key, observed_at, n FROM predecessor_key)
    SELECT o.*, k.n AS bounded_position FROM selected_keys k
    CROSS JOIN finance_dataset_observations o
    WHERE o.rowid=(SELECT v.rowid FROM finance_dataset_observations v
      WHERE v.dataset_id=?1 AND v.observation_key=k.observation_key
        AND v.time_precision<>'receipt' AND v.received_at<=?2
        AND (?6=0 OR (CASE WHEN v.received_at=v.observed_at THEN v.stored_at ELSE v.received_at END)<=?2)
      ORDER BY (CASE WHEN json_extract(v.value_json,'$.closed')=1 THEN 1 ELSE 0 END) DESC,
        (CASE WHEN v.received_at=v.observed_at THEN v.stored_at ELSE v.received_at END) DESC,
        v.received_at DESC LIMIT 1)
    ORDER BY k.n`).bind(id,knownAt,fromIso,toIso,cap+1,historical?1:0,predecessor?1:0);
  return {statement,parse(result) {
    const rows=result.results || [];
    return {observations:rows.filter(row=>row.bounded_position>0&&row.bounded_position<=cap).map(row=>mapStoredObservation(row,definition)),
      truncated:rows.some(row=>row.bounded_position>cap),
      predecessor:rows.some(row=>row.bounded_position===0)?mapStoredObservation(rows.find(row=>row.bounded_position===0),definition):null};
  }};
}

export async function readBoundedObservations(db, id, options={}) {
  const prepared=prepareBoundedObservations(db,id,options);
  return prepared.parse(await prepared.statement.all());
}

export async function readDatasetSummary(db, id, options={}) {
  const definition = FINANCE_DATASETS[id];
  if (!definition) throw new Error('unknown_dataset');
  const knownAt = options.knownAt || new Date().toISOString();
  const historical = Object.hasOwn(options, 'knownAt');
  const limit = definition.kind === 'funding' ? 2 : 1;
  const [bounded, metadata, macroReceipt] = await Promise.all([
    readBoundedObservations(db, id, {limit, knownAt, historical, predecessor:false}),
    db.prepare('SELECT * FROM finance_dataset_state WHERE dataset_id=?1').bind(id).all(),
    readMacroReceipt(db,id,definition,knownAt),
  ]);
  const currentState = metadata.results?.[0] || null;
  // Current poll status is not evidence of health at an earlier knowledge cutoff.
  const state = historical ? null : currentState;
  const observations = bounded.observations.map(row=>applyMacroReceipt(row,macroReceipt));
  const collectionStale = historical ? null : !state?.last_success_received_at || Date.now() - Date.parse(state.last_success_received_at) > definition.refreshSeconds * 1000;
  const latestObserved = Math.max(...observations.map((row) => Date.parse(row.observedAt) || 0), 0);
  const sourceLagSeconds = latestObserved ? Math.max(0, (Date.parse(knownAt) - latestObserved) / 1000) : null;
  const intervals = {'5m':300,'15m':900,'1h':3600,'4h':14400,'1d':86400,'1w':604800};
  const maxAge = definition.kind === 'klines' ? intervals[definition.parameters.interval] * 2 + definition.refreshSeconds
    : ['premium','oi','book','global','options'].includes(definition.kind) ? definition.refreshSeconds * 2
      : ['oi-history','taker','ratio','basis'].includes(definition.kind) ? 10800 : null;
  const sourceStale = maxAge !== null && sourceLagSeconds !== null ? sourceLagSeconds > maxAge : null;
  return {ok:observations.length>0,id,...definition,state,knownAt,
    readIntent:'summary',
    stateScope:'current collection health; not historical health at knownAt',
    knowledgeBasis:'system-received; summary keeps the latest reference period, not a replayed publication',
    selection:definition.kind==='funding'?'latest-version-of-two-settlement-events':'latest-reference-period',
    coverage:{available:null,returned:observations.length,truncated:bounded.truncated,needed:null},
    collectionStale,sourceLagSeconds,sourceStale,
    sourceFreshnessBasis:maxAge===null?'publication-schedule-not-evaluated':`source observation age; threshold ${maxAge} seconds`,
    stale:collectionStale||sourceStale===true,
    observations};
}

export async function datasetStates(db) {
  return (await db.prepare('SELECT * FROM finance_dataset_state ORDER BY dataset_id').all()).results;
}
