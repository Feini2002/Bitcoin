// Per-isolate diagnostics, never an account-wide spending cap. No SQL, payloads,
// credentials, or per-request identifiers are written to logs or D1.
const buckets = new Map();
const MAX_BUCKETS = 512;
const labels = new Set(['kline-live','kline-rest','kline-failure','dataset','macro','retention']);

export function summarizeD1Results(results, expected) {
  const complete = Array.isArray(results) && results.length === expected;
  const sum = field => complete && results.every(r => Number.isFinite(r?.meta?.[field]) && r.meta[field] >= 0)
    ? results.reduce((n, r) => n + r.meta[field], 0) : null;
  return { statements: expected, rowsRead: sum('rows_read'), rowsWritten: sum('rows_written'), changes: sum('changes') };
}

export function recordD1Cost(operation, dataset, summary, counts={}, now=Date.now(), emit=console.log) {
  const op = labels.has(operation) ? operation : 'dataset';
  const key = `${op}:${dataset}`;
  if (!buckets.has(key) && buckets.size >= MAX_BUCKETS) return;
  let b = buckets.get(key);
  if (b && now - b.startedAt >= 60000) {
    emit(JSON.stringify({event:'d1_cost_window', operation:op, dataset, ...b}));
    buckets.delete(key); b = null;
  }
  if (!b) {
    b={startedAt:now,batches:0,statements:0,rowsRead:0,rowsWritten:0,changes:0,unknownBatches:0,
      input:0,accepted:0,duplicate:0,late:0,closed:0,revisions:0,failures:0}; buckets.set(key,b);
  }
  b.batches++; b.statements += summary.statements;
  if ([summary.rowsRead,summary.rowsWritten,summary.changes].some(v=>v===null)) b.unknownBatches++;
  for(const field of ['rowsRead','rowsWritten','changes']) {
    b[field] = b[field]===null || summary[field]===null ? null : b[field]+summary[field];
  }
  for(const field of ['input','accepted','duplicate','late','closed','revisions']) {
    b[field] = b[field]===null || !Number.isFinite(counts[field]) ? null:b[field]+counts[field];
  }
  b.failures += Number(counts.failures) || 0;
  if (counts.failures && b.failures===1) emit(JSON.stringify({event:'d1_cost_failure',operation:op,dataset,cost:'UNKNOWN'}));
}

export async function measuredBatch(db, queries, {operation='dataset',dataset='unknown',counts={},onCost}={}) {
  try {
    const results=await db.batch(queries.map(q=>db.prepare(q.sql).bind(...q.params)));
    const summary=summarizeD1Results(results,queries.length);
    recordD1Cost(operation,dataset,summary,typeof counts==='function' ? counts(results):counts);
    onCost?.({ ...summary, perStatement:results.map((r,i)=>({
      operation:queries[i].tag || (/^\s*(\w+)/.exec(queries[i].sql)?.[1] || 'unknown').toLowerCase(),
      ...summarizeD1Results([r],1),
    })) });
    return results;
  } catch(error) {
    const summary={statements:queries.length,rowsRead:null,rowsWritten:null,changes:null};
    recordD1Cost(operation,dataset,summary,{...(typeof counts==='function'?{}:counts),failures:1});
    onCost?.({...summary,failed:true});
    throw error;
  }
}
