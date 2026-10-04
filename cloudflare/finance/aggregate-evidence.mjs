import identity from '../../js/content-identity.js';

// This journal records aggregate versions from installation onward. It cannot
// reconstruct pre-installation trades, full liquidation events or network receipts.
export async function readAggregateAsKnown(db, scope, symbol, { knownAt, from = null, to = null, limit = 240 }) {
  const unavailable = reason => ({ rows: [], status: null, truncated: false, reason,
    evidence: { stateScope: 'unavailable at requested cutoff', journal: { available: false, reason }, versions: [] } });
  const cap = Math.min(20000, Math.max(1, Number(limit) || 240));
  let rows, metadata, status;
  try {
    [rows, metadata, status] = await Promise.all([
      db.prepare(`WITH candidates AS (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY item_key ORDER BY stored_at DESC, id DESC) AS version_rank
        FROM desk_aggregate_versions WHERE scope=?1 AND symbol=?2 AND stored_at<=?3
          AND (?4 IS NULL OR observed_at>=?4) AND (?5 IS NULL OR observed_at<?5)
      ) SELECT * FROM candidates WHERE version_rank=1 AND deleted=0 ORDER BY observed_at DESC, item_key LIMIT ?6`)
        .bind(scope, symbol, knownAt, from, to, cap + 1).all(),
      db.prepare('SELECT MIN(stored_at) AS first_stored_at, MAX(stored_at) AS last_stored_at FROM desk_aggregate_versions WHERE scope=?1 AND symbol=?2 AND stored_at<=?3')
        .bind(scope, symbol, knownAt).first(),
      scope === 'orderflow' ? db.prepare(`SELECT * FROM desk_aggregate_versions WHERE scope='orderflow-status' AND symbol=?1 AND stored_at<=?2
        ORDER BY stored_at DESC,id DESC LIMIT 1`).bind(symbol, knownAt).first() : Promise.resolve(null),
    ]);
  } catch (error) {
    if (/no such table.*desk_aggregate_versions/i.test(error.message)) return unavailable('aggregate_version_journal_not_installed');
    throw error;
  }
  const selected = (rows.results || []).slice(0, cap).reverse();
  const versions = selected.map(row => ({ key: row.item_key, version: row.id,
    observedAt: new Date(row.observed_at).toISOString(), receivedAt: row.received_at,
    storedAt: row.stored_at, sourceHost: row.source_host,
    committedAt: null, commitAcknowledged: false,
    knowledgeBasis: 'database statement clock; commit acknowledgement and original network receipt unavailable',
    contentHash: identity.contentId(JSON.parse(row.payload_json)) }));
  return {
    rows: selected.map(row => JSON.parse(row.payload_json)),
    status: status && !status.deleted ? JSON.parse(status.payload_json) : null,
    truncated: (rows.results || []).length > cap,
    reason: selected.length ? null : 'no_retained_aggregate_version_at_cutoff',
    evidence: { stateScope: 'retained aggregate versions at cutoff', versions,
      journal: { available: true, firstStoredAt: metadata?.first_stored_at || null, lastStoredAt: metadata?.last_stored_at || null,
        knowledgeClock: 'database-statement-time', commitAcknowledged: false,
        historyBeforeFirstReceipt: 'unavailable', rawEventReplay: false } },
  };
}
