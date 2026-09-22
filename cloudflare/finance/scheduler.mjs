import { FINANCE_DATASETS, datasetRequest } from "./datasets.mjs";
import { persistDataset, datasetFailure, datasetStates } from "./dataset-store.mjs";
import { handleFinance } from "./gateway.mjs";

export const DATASET_AUTO_SKIP = new Set();
export const DATASET_SCHEDULER_MAX_PER_TICK = 8;

export function pickDatasetsToRefresh(due, max = DATASET_SCHEDULER_MAX_PER_TICK) {
  const sorted = (Array.isArray(due) ? due : []).slice().sort((a, b) => (b.age || 0) - (a.age || 0));
  const picked = sorted.slice(0, max);
  const context = sorted.find((item) => !String(item.provider || "").startsWith("binance-"));
  if (context && !picked.some((item) => item.id === context.id)) {
    if (picked.length < max) picked.push(context);
    else picked[picked.length - 1] = context;
  }
  return picked;
}

const BINANCE_RESTRICTED_COOL_MS = 15 * 60 * 1000;
const KLINE_FULL_REFRESH_MS = 30 * 60 * 1000;

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
  if (definition.kind === "klines") {
    if (last > 0 && now - attempted < KLINE_FULL_REFRESH_MS) return { due: false, reason: "kline_live_or_recent" };
    if (last > 0 && now - last < KLINE_FULL_REFRESH_MS) return { due: false, reason: "kline_full_interval" };
    return { due: true, reason: "kline_full", age: now - last };
  }
  if (last > 0 && now - last < refreshMs) return { due: false, reason: "fresh" };
  return { due: true, reason: last > 0 ? "stale" : "never", age: now - last };
}

async function refreshOne(env, id) {
  const upstream = await handleFinance(datasetRequest(id, "https://finance.internal"), env, {}, { cache: null });
  const envelope = await upstream.json();
  if (!upstream.ok || !envelope.ok) {
    await datasetFailure(env.DB, id, upstream.status, envelope.error || "dataset_upstream_failed");
    return { id, ok: false, error: envelope.error || "dataset_upstream_failed", status: upstream.status };
  }
  await persistDataset(env.DB, id, envelope, "cloud-readthrough");
  return { id, ok: true };
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
  const due = [];
  for (const [id, definition] of Object.entries(FINANCE_DATASETS)) {
    const verdict = datasetDueForCollection(id, definition, byId[id], now);
    if (verdict.due) due.push({ id, provider: definition.provider, age: verdict.age || 0, reason: verdict.reason });
  }
  const picked = pickDatasetsToRefresh(due);
  const results = [];
  for (const item of picked) {
    try {
      results.push(await refreshOne(env, item.id));
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      try {
        await datasetFailure(env.DB, item.id, 502, message.slice(0, 160));
      } catch (_) {}
      results.push({ id: item.id, ok: false, error: message.slice(0, 160) });
    }
  }
  return {
    ok: true,
    due: due.length,
    attempted: picked.length,
    results,
  };
}
