export function collectionState(definition, state, now = Date.now(), { mode = 'automatic-dataset' } = {}) {
  const receipt = Date.parse(state?.last_success_received_at || state?.received_at || '');
  const attempt = Date.parse(state?.attempted_at || '');
  const ageSeconds = Number.isFinite(receipt) ? Math.max(0, (now - receipt) / 1000) : null;
  const targetSeconds = Number(definition?.refreshSeconds || definition?.ttl || 0) || null;
  const error = state?.last_error || null;
  const count = state?.row_count ?? state?.last_count ?? null;
  let status = 'not-collected';
  if (Number.isFinite(receipt)) status = targetSeconds && ageSeconds > targetSeconds ? 'delayed' : 'current';
  if (Number.isFinite(attempt) && (!Number.isFinite(receipt) || attempt >= receipt)) {
    if (error) status = /restricted|permission|auth|forbidden/.test(error) ? 'access-limited' : /empty|no_data/.test(error) ? 'no-data' : 'collection-error';
    else if (state?.last_ok === 0 && count === 0) status = 'no-data';
  }
  if (mode === 'on-demand-cache' && status === 'delayed') status = 'old-cache-sample';
  return { status, mode, lastSuccessfulReceipt: Number.isFinite(receipt) ? new Date(receipt).toISOString() : null,
    lastAttempt: Number.isFinite(attempt) ? new Date(attempt).toISOString() : null, ageSeconds, targetSeconds,
    lastBatchCount: count, countBasis: 'last batch; not full retained history', error,
    continuousCoverageVerified: false, publicationFreshness: 'evaluate reference date and provider release separately' };
}

export function datasetCoverage(definitions, states, now = Date.now()) {
  const byId = Object.fromEntries((states || []).map(state => [state.dataset_id, state]));
  return Object.entries(definitions).map(([id, definition]) => ({ id, provider: definition.provider,
    marketRole: definition.role, fields: definition.fields, limitations: definition.limitations,
    ...collectionState(definition, byId[id], now) }));
}
