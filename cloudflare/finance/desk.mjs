import { prepareBoundedObservations, readDatasetSummary, historyBaselineStatement } from './dataset-store.mjs';
import { FINANCE_DATASETS } from './datasets.mjs';
import { klineOpenAt } from '../kline-recovery.mjs';

export const DESK_SCHEMA_VERSION = '2026-09-27.1';
export const DESK_SCOPES = ['chart', 'orderflow', 'heatmap', 'context'];
export const FORBIDDEN_COPY = [
  'DXY', '已接入', '主链路达标', '拥挤', '占优', '挤压', '清算池',
  'Bybit 兜底主源', 'net liquidity', '净流动性', '倒挂',
];

const INTERVAL_MS = { '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000, '3d': 259200000, '1w': 604800000 };
const NEEDED_BARS = { '5m': 864, '15m': 480, '1h': 336, '4h': 360, '1d': 180, '3d': 180, '1w': 156 };
const LIVE_TAPE_FRESH_MS = 90 * 1000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const BINANCE_EXACT_HOSTS = new Set([
  'fapi.binance.com', 'fstream.binance.com', 'dapi.binance.com', 'api.binance.com',
  'stream.binance.com', 'data-api.binance.vision',
]);

export function binanceHostOk(host) {
  const name = String(host || '').trim().toLowerCase().replace(/\.$/, '');
  if (!name || name.includes('..') || /[^a-z0-9.-]/.test(name)) return false;
  if (BINANCE_EXACT_HOSTS.has(name)) return true;
  if (!name.endsWith('.binance.com')) return false;
  const prefix = name.slice(0, -'.binance.com'.length);
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(prefix);
}

export function parseJsonSafe(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export function klineAuthority(dataset, { now = Date.now(), interval = '15m' } = {}) {
  if (!dataset || dataset.ok === false || !Array.isArray(dataset.observations) || !dataset.observations.length) {
    return { ok: false, reason: 'missing', venue: null, instrumentId: null };
  }
  const latest = dataset.observations[0];
  const host = latest.sourceHost || dataset.state?.source_host || '';
  if (!binanceHostOk(host)) return { ok: false, reason: 'non_binance_host', venue: null, instrumentId: null };
  const mode = latest.ingestionMode || dataset.state?.last_ingestion_mode || '';
  const observedMs = Date.parse(latest.observedAt || '');
  const step = INTERVAL_MS[interval] || INTERVAL_MS['15m'];
  if (!Number.isFinite(observedMs)) return { ok: false, reason: 'missing_source_time', venue: null, instrumentId: null };
  if (now - observedMs > step * 2) return { ok: false, reason: mode === 'local-bootstrap' ? 'stale_bootstrap' : 'source_stale', venue: null, instrumentId: null };
  if (dataset.sourceStale === true || dataset.collectionStale === true) {
    return { ok: false, reason: dataset.sourceStale ? 'source_stale' : 'collection_stale', venue: null, instrumentId: null };
  }
  return {
    ok: true,
    reason: null,
    venue: 'binance-usdm',
    instrumentId: 'BINANCE:USDM:BTCUSDT:PERPETUAL',
    ingestionMode: mode,
    sourceHost: host,
  };
}

export function sourceVerified(row) {
  return !!(row && row.origin === 'canonical' && row.ingestionMode !== 'local-bootstrap'
    && binanceHostOk(row.sourceHost));
}

export function mapKlineObservations(observations) {
  return (observations || []).slice().reverse().map((row) => {
    const v = row.values || {};
    const bar = {
      t: Date.parse(row.observedAt),
      o: v.open, h: v.high, l: v.low, c: v.close,
      v: v.baseVolume, quoteVolume: v.quoteVolume ?? null, trades: v.trades ?? null,
      takerBuyBase: v.takerBuyBase ?? null, takerBuyQuote: v.takerBuyQuote ?? null,
      closed: v.closed ?? null, windowEnded: v.windowEnded ?? null, finality: v.finality ?? null, closureBasis: v.closureBasis ?? null,
      observedAt: row.observedAt, receivedAt: row.receivedAt ?? null, storedAt: row.storedAt ?? null,
      effectiveReceivedAt: row.effectiveReceivedAt ?? (row.receivedAt && row.receivedAt !== row.observedAt ? row.receivedAt : row.storedAt ?? row.receivedAt ?? null),
      sourceHost: row.sourceHost ?? null, ingestionMode: row.ingestionMode ?? null, publicAvailableAt: row.publicAvailableAt ?? null,
      origin: 'canonical',
      sourceVerification: 'unverified',
    };
    bar.sourceVerification = sourceVerified(bar) ? 'verified' : 'unverified';
    return bar;
  }).filter((row) => Number.isFinite(row.t) && Number.isFinite(row.o) && Number.isFinite(row.c));
}

function rawTapeBar(row) {
  return {
    t: Number(row.t), o: Number(row.o), h: Number(row.h), l: Number(row.l), c: Number(row.c), v: Number(row.v) || 0,
    quoteVolume: null, trades: null, takerBuyBase: null, takerBuyQuote: null,
    closed: null, windowEnded: null, finality: null, closureBasis: null,
    observedAt: new Date(Number(row.t)).toISOString(),
    receivedAt: null, storedAt: null, effectiveReceivedAt: null,
    sourceHost: null, ingestionMode: null, publicAvailableAt: null,
    origin: 'raw-tape', sourceVerification: 'unverified',
  };
}

export function nextKlineOpen(interval, open) {
  return klineOpenAt(interval, Number(open) + INTERVAL_MS[interval]);
}

export async function readLiveKlineTape(db, interval, limit = 6000, now = Date.now()) {
  const symbol = 'BTCUSDT';
  const cap = Math.min(6000, Math.max(2, Number(limit) || 6000));
  const [rowsRes, status] = await Promise.all([
    db.prepare('SELECT t, o, h, l, c, v FROM klines WHERE symbol = ?1 AND interval = ?2 ORDER BY t DESC LIMIT ?3').bind(symbol, interval, cap).all(),
    db.prepare('SELECT last_run, last_t, last_ok, last_error FROM sync_status WHERE symbol = ?1 AND interval = ?2').bind(symbol, interval).first(),
  ]);
  const rows = (rowsRes && rowsRes.results ? rowsRes.results : []).slice().reverse().map((row) => ({
    t: Number(row.t), o: Number(row.o), h: Number(row.h), l: Number(row.l), c: Number(row.c), v: Number(row.v) || 0,
  })).filter((row) => Number.isFinite(row.t) && Number.isFinite(row.o) && Number.isFinite(row.c));
  const lastRun = Number(status && status.last_run) || 0;
  const lastOk = Number(status && status.last_ok) === 1;
  const step = INTERVAL_MS[interval] || INTERVAL_MS['15m'];
  const last = rows.length ? rows[rows.length - 1] : null;
  const barAge = last ? now - last.t : Infinity;
  const writeAge = lastRun ? now - lastRun : Infinity;
  const error = status && status.last_error ? String(status.last_error) : '';
  const mixed = /bybit|okx/i.test(error);
  const authoritative = lastOk && !mixed && last && writeAge <= LIVE_TAPE_FRESH_MS && barAge <= step * 2;
  return {
    rows,
    status,
    lastRun,
    authoritative,
    sourceHost: 'fapi.binance.com',
    ingestionMode: 'cloud-ws',
  };
}

export function buildChartDeskFromTape(tape, interval, now = Date.now()) {
  const series = (tape.rows || []).map(rawTapeBar).filter((row) => Number.isFinite(row.t) && Number.isFinite(row.o) && Number.isFinite(row.c));
  return finishChartDesk({
    interval, now, series, authoritative: !!tape.authoritative, truncated: series.length >= 6000,
    dataset: { id: `binance-perp-klines-${interval}`, collectionStale: !tape.authoritative, sourceStale: !tape.authoritative,
      state: { last_ingestion_mode: tape.ingestionMode || 'cloud-ws' } },
    ingestionMode: tape.authoritative ? (tape.ingestionMode || 'cloud-ws') : null,
    sourceHost: tape.authoritative ? (tape.sourceHost || 'fapi.binance.com') : null,
  });
}

function inputRevision(parts) {
  const text = JSON.stringify(parts);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}

function quality(status, reason) {
  return { status, reason: sanitizeDeskReason(reason) };
}

function sanitizeDeskReason(reason) {
  const raw = String(reason || '').trim();
  if (!raw) return null;
  if (/<!DOCTYPE|<html|Cloudflare|Access Denied|error code:/i.test(raw)) return 'upstream_html_error';
  return raw.replace(/\s+/g, ' ').slice(0, 80);
}

function chartEvidence(series, inWindowGaps) {
  return {
    series: series.map((bar) => ({
      t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v,
      quoteVolume: bar.quoteVolume, trades: bar.trades, takerBuyBase: bar.takerBuyBase, takerBuyQuote: bar.takerBuyQuote,
      origin: bar.origin, sourceVerification: bar.sourceVerification, effectiveReceivedAt: bar.effectiveReceivedAt,
      closed: bar.closed, finality: bar.finality, closureBasis: bar.closureBasis,
    })),
    inWindowGaps,
  };
}

export function finishChartDesk({
  interval, now = Date.now(), series = [], predecessor = null, truncated = false, unresolvedGap = null,
  readIntent = 'window', requestFrom = null, requestTo = null, tail = null, historyRevision = 0, headT = null,
  dataset = null, authoritative = false, ingestionMode = null, sourceHost = null, clearStale = false,
} = {}) {
  const asOf = new Date(now).toISOString();
  const step = INTERVAL_MS[interval] || INTERVAL_MS['15m'];
  const ordered = (series || []).filter((bar) => Number.isFinite(bar.t)).slice().sort((a, b) => a.t - b.t);
  const auth = dataset ? klineAuthority(dataset, { now, interval }) : { ok: false, reason: ordered.length ? null : 'missing', venue: null, instrumentId: null };
  const visible = clearStale ? [] : ordered;
  const inWindowGaps = [];
  for (let i = 1; i < visible.length; i++) {
    if (nextKlineOpen(interval, visible[i - 1].t) !== visible[i].t) inWindowGaps.push({ from: visible[i - 1].t + step, to: visible[i].t });
  }
  if (readIntent === 'window' && Number.isFinite(requestFrom) && visible.length && visible[0].t > requestFrom) {
    inWindowGaps.unshift({ from: requestFrom, to: visible[0].t });
  }
  if (readIntent === 'window' && Number.isFinite(requestTo) && visible.length && visible[visible.length - 1].t + step < requestTo) {
    inWindowGaps.push({ from: visible[visible.length - 1].t + step, to: requestTo });
  }
  const boundaryGap = predecessor && visible.length && nextKlineOpen(interval, predecessor.t) !== visible[0].t
    ? { after: predecessor.t, before: visible[0].t } : null;
  let continuousVerifiedClosed = 0;
  let end = visible.length - 1;
  while (end >= 0 && visible[end].closed !== true && now - visible[end].t < step * 2) end -= 1;
  for (let i = end; i >= 0; i--) {
    const bar = visible[i];
    if (bar.sourceVerification !== 'verified' || bar.closed !== true) break;
    if (i < end && nextKlineOpen(interval, bar.t) !== visible[i + 1].t) break;
    continuousVerifiedClosed += 1;
  }
  const needed = NEEDED_BARS[interval] || 0;
  const researchEligible = continuousVerifiedClosed >= needed;
  let researchReason = null;
  if (inWindowGaps.length && !researchEligible) researchReason = 'in_window_gap';
  else if (readIntent === 'tail' && visible.length < needed) researchReason = 'tail_sample';
  else if (!researchEligible) researchReason = 'verified_history_insufficient';
  const last = visible.length ? visible[visible.length - 1] : null;
  const fresh = !!(last && last.t <= now && now - last.t <= step * 2);
  const pricePathAvailable = clearStale ? false : !!(authoritative || fresh);
  const unverified = visible.some((bar) => bar.sourceVerification !== 'verified');
  let status = 'pass';
  let reason = null;
  if (clearStale || (!visible.length && !pricePathAvailable)) {
    status = 'fail';
    reason = clearStale ? 'stale_bootstrap' : (auth.reason || 'missing');
  } else if (inWindowGaps.length || unverified || !researchEligible) {
    status = 'warn';
    reason = inWindowGaps.length ? 'in_window_gap' : (unverified ? 'unverified_history' : researchReason);
  }
  const venue = !clearStale && (authoritative || auth.ok || visible.some((bar) => bar.sourceVerification === 'verified')) ? 'binance-usdm' : null;
  const verifiedCount = visible.filter((bar) => bar.sourceVerification === 'verified').length;
  return {
    schemaVersion: DESK_SCHEMA_VERSION,
    asOf,
    asKnownMode: 'system_observed',
    scope: 'chart',
    instrumentId: venue ? 'BINANCE:USDM:BTCUSDT:PERPETUAL' : null,
    venue,
    marketType: 'usdm-perpetual',
    datasetId: dataset && dataset.id ? dataset.id : `binance-perp-klines-${interval}`,
    ingestionMode: ingestionMode || (last ? last.ingestionMode : dataset && dataset.state ? dataset.state.last_ingestion_mode : null),
    sourceHost: sourceHost || (last && last.origin === 'canonical' ? last.sourceHost : null),
    observedAt: last ? last.observedAt : null,
    receivedAt: last ? last.receivedAt : null,
    storedAt: last ? last.storedAt : null,
    effectiveReceivedAt: last ? last.effectiveReceivedAt : null,
    publicAvailableAt: null,
    closed: last ? last.closed : null,
    windowEnded: last ? last.windowEnded : null,
    finality: last ? last.finality : null,
    closureBasis: last ? last.closureBasis : null,
    collectionStale: dataset ? dataset.collectionStale : true,
    sourceStale: dataset ? dataset.sourceStale : null,
    requestWindow: { symbol: 'BTCUSDT', interval, readIntent, from: requestFrom, to: requestTo, tail: readIntent === 'tail' ? tail : null },
    returnedRange: visible.length ? { from: visible[0].t, to: visible[visible.length - 1].t + step } : { from: null, to: null },
    coverageScope: readIntent,
    stateScope: 'current',
    historyRevision: Number.isInteger(historyRevision) ? historyRevision : 0,
    headT: Number.isFinite(headT) ? headT : null,
    researchWindow: { needed, continuousVerifiedClosed, eligible: researchEligible, reason: researchReason },
    coverage: {
      returned: visible.length, verified: verifiedCount, truncated: !!truncated, needed,
      inWindowGaps, boundaryGap, unresolvedGap: unresolvedGap || null, available: null,
    },
    units: { price: 'USDT/BTC', baseVolume: 'BTC', quoteVolume: 'USDT' },
    baselineAt: null,
    windowEligible: false,
    inputRevision: inputRevision(chartEvidence(visible, inWindowGaps)),
    quality: quality(status, reason),
    pricePathAvailable,
    tradingNarrative: false,
    interval,
    series: visible,
    gap: status === 'fail' ? { reason } : (inWindowGaps.length ? { reason: 'in_window_gap' } : null),
  };
}

export function buildChartDesk(dataset, interval, now = Date.now()) {
  const auth = klineAuthority(dataset, { now, interval });
  return finishChartDesk({
    interval, now, dataset, clearStale: auth.reason === 'stale_bootstrap',
    series: auth.reason === 'stale_bootstrap' ? [] : mapKlineObservations(dataset && dataset.observations),
    truncated: !!(dataset && dataset.coverage && dataset.coverage.truncated),
    unresolvedGap: dataset && dataset.coverage ? dataset.coverage.unresolvedGap : null,
  });
}

function clockCard(id, label, dataset, extra = {}) {
  const latest = dataset && dataset.observations && dataset.observations[0];
  const values = latest && latest.values ? latest.values : {};
  return {
    id,
    label,
    datasetId: id,
    referencePeriod: latest ? latest.observedAt : null,
    publicAvailableAt: latest ? latest.publicAvailableAt : null,
    receivedAt: latest ? latest.receivedAt : dataset && dataset.state ? dataset.state.last_success_received_at : null,
    units: extra.units || (dataset && dataset.fields ? dataset.fields : {}),
    value: extra.value != null ? extra.value : values.value,
    values,
    sourceHost: latest ? latest.sourceHost : null,
    ingestionMode: latest ? latest.ingestionMode : null,
    collectionStale: dataset ? dataset.collectionStale : true,
    sourceStale: dataset ? dataset.sourceStale : null,
    realtimeStart: latest && latest.sourceRevision ? latest.sourceRevision.realtimeStart : null,
    realtimeEnd: latest && latest.sourceRevision ? latest.sourceRevision.realtimeEnd : null,
    note: extra.note || null,
    asKnownMode: 'system_observed',
  };
}

function contractClock(dataset,id,now,{sourceMaxAgeMs=null}={}) {
  const latest=dataset?.observations?.[0];
  const trusted=!!latest && dataset?.ok!==false && binanceHostOk(latest.sourceHost) && latest.ingestionMode!=='local-bootstrap';
  const observedAt=Date.parse(latest?.observedAt || '');
  const receipt=Date.parse(dataset?.state?.last_success_received_at || latest?.receivedAt || '');
  const refreshMs=Number(dataset?.refreshSeconds || FINANCE_DATASETS[id]?.refreshSeconds || 60)*1000;
  const collectionLimit = sourceMaxAgeMs != null && sourceMaxAgeMs <= 60000 ? Math.max(refreshMs, sourceMaxAgeMs) : refreshMs;
  const collectionStale=!trusted || dataset?.collectionStale===true || !Number.isFinite(receipt) || receipt>now || now-receipt>collectionLimit;
  const sourceStale=!trusted || !Number.isFinite(observedAt) || observedAt>now
    || dataset?.sourceStale===true || (sourceMaxAgeMs!==null && now-observedAt>sourceMaxAgeMs);
  return {trusted,latest,observedAt,collectionStale,sourceStale,available:trusted && !collectionStale && !sourceStale};
}

function fundingClock(dataset,premium,premiumClock,info,now) {
  const clock=contractClock(dataset,'binance-perp-funding',now);
  const infoLatest=info?.observations?.[0];
  const infoReceipt=Date.parse(info?.state?.last_success_received_at || infoLatest?.receivedAt || '');
  const reportedHours=Number(infoLatest?.values?.record?.fundingIntervalHours);
  const infoFresh=info?.ok!==false && !!infoLatest && binanceHostOk(infoLatest.sourceHost)
    && infoLatest.ingestionMode!=='local-bootstrap' && info?.collectionStale!==true
    && Number.isFinite(infoReceipt) && infoReceipt<=now
    && now-infoReceipt<=Number(info?.refreshSeconds || FINANCE_DATASETS['binance-perp-funding-info'].refreshSeconds)*1000;
  const prior=dataset?.observations?.find(row=>Date.parse(row.observedAt)<clock.observedAt);
  const observedSpacing=prior ? clock.observedAt-Date.parse(prior.observedAt):null;
  const intervalMs=infoFresh && Number.isFinite(reportedHours) && reportedHours>0 ? reportedHours*3600000
    : Number.isFinite(observedSpacing) && observedSpacing>0 ? observedSpacing:null;
  const intervalBasis=infoFresh && Number.isFinite(reportedHours) && reportedHours>0 ? 'exchange-funding-info'
    : intervalMs ? 'observed-settlement-spacing; not a guaranteed future interval':'unknown';
  const next= premiumClock.available ? Date.parse(premium?.observations?.[0]?.values?.nextFundingTime || ''):NaN;
  let sourceStale=clock.sourceStale ? true:null,reason=clock.sourceStale?'invalid_settlement_observation':null;
  // fundingTime is a settled event, not a continuously changing quote. Source
  // clocks come from the exchange's next settlement and reported/observed interval.
  if(!clock.sourceStale && Number.isFinite(next)) {
    if(next<=now || clock.observedAt>=next) {sourceStale=true;reason='settlement_due_or_schedule_inconsistent';}
    else if(intervalMs) {
      sourceStale=clock.observedAt<next-intervalMs-1000;
      reason=sourceStale?'latest_scheduled_settlement_missing':null;
    }
  } else if(!clock.sourceStale && intervalBasis==='exchange-funding-info') {
    sourceStale=now>=clock.observedAt+intervalMs;
    reason=sourceStale?'reported_settlement_interval_elapsed':null;
  }
  return {...clock,sourceStale,available:clock.trusted && !clock.collectionStale && sourceStale!==true,
    nextFundingTime:Number.isFinite(next)?new Date(next).toISOString():null,
    fundingIntervalHours:intervalMs ? intervalMs/3600000:null,intervalBasis,
    sourceFreshnessBasis:'settled event; collection receipt and settlement schedule are separate',
    freshnessReason:reason || (sourceStale===null?'settlement_schedule_not_verified':null)};
}

function contractCard(id,label,dataset,clock,note) {
  return {...clockCard(id,label,clock.trusted?dataset:null,{note}),
    collectionStale:clock.collectionStale,sourceStale:clock.sourceStale,
    unavailable:!clock.trusted,
    reason:!clock.trusted?'binance_cloud_path_missing':clock.collectionStale?'collection_stale':clock.freshnessReason || (clock.sourceStale?'source_stale':null),
    ...(clock.intervalBasis?{nextFundingTime:clock.nextFundingTime,fundingIntervalHours:clock.fundingIntervalHours,
      intervalBasis:clock.intervalBasis,sourceFreshnessBasis:clock.sourceFreshnessBasis}:{}),
  };
}

function positioningCard(id, dataset, now, spec) {
  const clock = contractClock(dataset, id, now, {sourceMaxAgeMs: spec.sourceMaxAgeMs});
  const card = contractCard(id, spec.label, dataset, clock, spec.note);
  const latest = clock.latest;
  return {...card,
    referencePeriod: latest ? latest.observedAt : null,
    receivedAt: latest ? (latest.receivedAt || card.receivedAt) : card.receivedAt,
    effectiveReceivedAt: latest ? (latest.effectiveReceivedAt ?? latest.receivedAt ?? null) : null,
    period: spec.period, sample: spec.sample, units: spec.units,
    collectionStale: clock.collectionStale, sourceStale: clock.sourceStale, unavailable: !clock.trusted};
}

export function buildContextDesk(datasets, now = Date.now()) {
  const asOf = new Date(now).toISOString();
  const get = (id) => datasets && datasets[id] ? datasets[id] : null;
  const premium=get('binance-perp-premium'),funding=get('binance-perp-funding'),basis=get('binance-perp-basis');
  const premiumClock=contractClock(premium,'binance-perp-premium',now,{sourceMaxAgeMs:FINANCE_DATASETS['binance-perp-premium'].refreshSeconds*2000});
  const fundingStatus=fundingClock(funding,premium,premiumClock,get('binance-perp-funding-info'),now);
  const basisClock=contractClock(basis,'binance-perp-basis',now,{sourceMaxAgeMs:3*3600000});
  const clocks=[premiumClock,fundingStatus,basisClock];
  const contractReady=clocks.some(clock=>clock.trusted),contractComplete=clocks.every(clock=>clock.available && clock.sourceStale===false);
  const positioning = {
    oi: positioningCard('binance-perp-oi', get('binance-perp-oi'), now, {label:'持仓量', period:null, sample:null, sourceMaxAgeMs:15000, units:{openInterest:'BTC'}, note:'openInterest 单位 BTC，不是美元市值'}),
    oiHistory: positioningCard('binance-perp-oi-history', get('binance-perp-oi-history'), now, {label:'持仓量历史', period:'1h', sample:null, sourceMaxAgeMs:7200000, units:{sumOpenInterest:'BTC', sumOpenInterestValue:'USDT'}, note:'sumOpenInterest 为 BTC，sumOpenInterestValue 为 USDT'}),
    taker: positioningCard('binance-perp-taker', get('binance-perp-taker'), now, {label:'主动买卖量', period:'1h', sample:null, sourceMaxAgeMs:7200000, units:{buyVol:'BTC', sellVol:'BTC', buySellRatio:'ratio'}, note:'主动量单位 BTC'}),
    accounts: positioningCard('binance-perp-accounts', get('binance-perp-accounts'), now, {label:'全账户多空比', period:'1h', sample:'all-accounts', sourceMaxAgeMs:7200000, units:{longAccount:'fraction', shortAccount:'fraction', longShortRatio:'ratio'}, note:'样本为全部账户'}),
    topPositions: positioningCard('binance-perp-top-positions', get('binance-perp-top-positions'), now, {label:'头部持仓多空比', period:'1h', sample:'top-positions', sourceMaxAgeMs:7200000, units:{longPosition:'fraction', shortPosition:'fraction', longShortRatio:'ratio'}, note:'样本为头部持仓'}),
  };
  return {
    schemaVersion: DESK_SCHEMA_VERSION,
    asOf,
    asKnownMode: 'system_observed',
    scope: 'context',
    instrumentId: null,
    venue: null,
    marketType: null,
    publicAvailableAt: null,
    collectionStale: null,
    sourceStale: null,
    coverage: { available: null, returned: null, truncated: false, needed: null },
    units: {},
    baselineAt: null,
    windowEligible: false,
    inputRevision: inputRevision({ scope: 'context', contractReady,
      premium: premium?.observations?.[0]?.observedAt || null,
      funding: funding?.observations?.[0]?.observedAt || null,
      basis: basis?.observations?.[0]?.observedAt || null }),
    quality: quality(contractComplete ? 'pass' : 'warn', contractComplete ? null : contractReady?'binance_contract_partial':'binance_contract_unavailable'),
    pricePathAvailable: false,
    tradingNarrative: false,
    contract: contractReady ? {
      unavailable:false,partial:!contractComplete,
      premium: contractCard('binance-perp-premium','标记价与报告费率',premium,premiumClock,'lastFundingRate 是当前报告费率，不是已结算资金费'),
      funding: contractCard('binance-perp-funding','已结算资金费',funding,fundingStatus,'按 fundingTime 保留已结算事件；采集时钟与结算时钟分开，不默认结算周期'),
      basis: contractCard('binance-perp-basis','永续基差三字段',basis,basisClock,'basis / basisRate / annualizedBasisRate 独立，空为 null'),
      positioning,
    } : { unavailable: true, reason: 'binance_cloud_path_missing', positioning },
    groups: {
      dailyRates: {
        title: '日终利率（CMT / SOFR，非可成交）',
        cards: [
          clockCard('fred-dgs2', '2y CMT 日终', get('fred-dgs2'), { units: { value: 'percent-per-year' }, note: '非 on-the-run、非期货' }),
          clockCard('fred-dgs10', '10y CMT 日终', get('fred-dgs10'), { units: { value: 'percent-per-year' } }),
          clockCard('fred-real10y', '10y TIPS CMT', get('fred-real10y'), { units: { value: 'percent-per-year' } }),
          clockCard('fred-breakeven10y', '10y TIPS 盈亏平衡', get('fred-breakeven10y'), { note: '不是通胀互换或调查预期' }),
          clockCard('nyfed-sofr', 'SOFR 参考利率', get('nyfed-sofr'), { units: { percentRate: 'percent-per-year' }, value: get('nyfed-sofr')?.observations?.[0]?.values?.percentRate, note: 'T+1；周末沿用旧值不是新报价' }),
        ],
      },
      weeklyDollarH41: {
        title: '周频美元与 H.4.1（禁止相减）',
        cards: [
          clockCard('fred-dollar', 'Fed 广义贸易加权美元（2006=100，周频）', get('fred-dollar'), { note: '不是洲际交易所美元指数' }),
          clockCard('fred-fed-assets', 'WALCL 周三时点（百万美元）', get('fred-fed-assets')),
          clockCard('fred-tga', 'WTREGEN 截至周三周平均（百万美元）', get('fred-tga'), { note: '不是周三时点 TGA，也不是财政部日频 TGA' }),
          clockCard('fred-rrp', 'RRPONTSYD 日频中标量（十亿美元）', get('fred-rrp')),
        ],
        residualForbidden: true,
      },
      monthlyCpi: {
        title: '月频 CPI 指数',
        cards: [
          clockCard('fred-cpi', 'CPIAUCSL 季调指数（1982-84=100）', get('fred-cpi'), { note: '不是同比、不是环比、禁止 24h 变化' }),
        ],
      },
      cryptoBackground: {
        title: '加密背景（非币安成交、非流入）',
        cards: [
          clockCard('stablecoin-supply', 'USDT/USDC 供应', get('stablecoin-supply'), { note: '供应变化不是交易所净流入' }),
          clockCard('crypto-breadth', 'CoinGecko 广度', get('crypto-breadth'), { note: '聚合成交额不是币安成交量' }),
          clockCard('btc-fees', 'mempool 费用 sat/vB', get('btc-fees'), { note: '不是交易所流入' }),
        ],
      },
      unofficialVol: {
        title: '非官方波动率（不上屏除非 desk 标明 unofficial）',
        cards: [],
        planned: true,
        note: 'Yahoo VIX/MOVE 保持 unofficial；MOVE 不得伪日内；Deribit 默认 PLANNED',
      },
    },
  };
}

export function buildHeatmapDesk(rows, now = Date.now()) {
  const asOf = new Date(now).toISOString();
  const byExchange = {};
  for (const row of rows || []) {
    const ex = String(row.exchange || 'unknown').toLowerCase();
    const key = ex === 'binance' || ex === 'bybit' ? ex : 'unknown';
    if (!byExchange[key]) byExchange[key] = { exchange: key, buckets: [], longNotional: 0, shortNotional: 0, longCount: 0, shortCount: 0 };
    const g = byExchange[key];
    g.buckets.push(row);
    g.longNotional += Number(row.long_notional) || 0;
    g.shortNotional += Number(row.short_notional) || 0;
    g.longCount += Number(row.long_count) || 0;
    g.shortCount += Number(row.short_count) || 0;
  }
  return {
    schemaVersion: DESK_SCHEMA_VERSION,
    asOf,
    asKnownMode: 'system_observed',
    scope: 'heatmap',
    instrumentId: null,
    venue: null,
    marketType: 'usdm-perpetual',
    publicAvailableAt: null,
    collectionStale: null,
    sourceStale: null,
    coverage: { available: (rows || []).length, returned: (rows || []).length, truncated: false, needed: null },
    units: { notional: 'USDT' },
    baselineAt: null,
    windowEligible: false,
    inputRevision: inputRevision({ scope: 'heatmap', exchanges: Object.keys(byExchange) }),
    quality: quality(Object.keys(byExchange).length ? 'pass' : 'warn', Object.keys(byExchange).length ? null : 'no_liquidation_buckets'),
    pricePathAvailable: false,
    tradingNarrative: false,
    combinedTotalsForbidden: true,
    byExchange,
    note: '已实现强平 5m 桶，分所展示；币安 forceOrder 与 Bybit 全量流覆盖不可比，禁止比笔数。',
  };
}

export function buildOrderflowDesk(status, bars, now = Date.now()) {
  const asOf = new Date(now).toISOString();
  const lastOk = Number(status && status.last_ok) === 1;
  const lastError = status && status.last_error ? String(status.last_error) : '';
  const latestT = Number(status && status.last_trade_time) || (bars && bars.length ? Number(bars[bars.length - 1].t) : 0);
  const fresh = lastOk && latestT > 0 && (now - latestT) < 15 * 60 * 1000;
  const ok = fresh && Array.isArray(bars) && bars.length > 0;
  return {
    schemaVersion: DESK_SCHEMA_VERSION,
    asOf,
    asKnownMode: 'system_observed',
    scope: 'orderflow',
    instrumentId: ok ? 'BINANCE:USDM:BTCUSDT:PERPETUAL' : null,
    venue: ok ? 'binance-usdm' : null,
    marketType: 'usdm-perpetual',
    datasetId: null,
    ingestionMode: 'aggtrade-collector',
    sourceHost: ok ? 'fstream.binance.com' : null,
    observedAt: latestT ? new Date(latestT).toISOString() : null,
    receivedAt: status && status.last_run ? new Date(Number(status.last_run)).toISOString() : null,
    storedAt: null,
    publicAvailableAt: null,
    collectionStale: !fresh,
    sourceStale: !fresh,
    coverage: { available: ok ? bars.length : 0, returned: ok ? bars.length : 0, truncated: false, needed: null },
    units: { volume: 'BTC' },
    baselineAt: null,
    windowEligible: false,
    inputRevision: inputRevision({ scope: 'orderflow', latestT, lastOk }),
    quality: quality(ok ? 'pass' : 'fail', ok ? null : (sanitizeDeskReason(lastError) || 'footprint_not_authoritative')),
    pricePathAvailable: false,
    tradingNarrative: false,
    venueNote: 'footprint_bars 无交易所列；采集器仅币安 aggTrade。失败或过期则主画布空。Delta 是 aggTrade 主动量近似，不是逐笔 CVD。',
    series: ok ? bars : [],
    gap: ok ? null : { reason: sanitizeDeskReason(lastError) || 'footprint_not_authoritative' },
  };
}

async function readSummaryQuiet(db, id, knownAt) {
  try { return await readDatasetSummary(db, id, knownAt ? {knownAt} : {}); }
  catch { return { ok: false, id, observations: [], collectionStale: true, sourceStale: null, state: null }; }
}

function tapeRowsFrom(result) {
  return ((result && result.results) || []).map((row) => rawTapeBar(row)).filter((row) => Number.isFinite(row.t));
}

function unresolvedFromState(row) {
  const error = row && row.last_error ? String(row.last_error) : '';
  if (!error.startsWith('dataset_history_gap_pending:')) return null;
  try {
    const gap = JSON.parse(error.slice('dataset_history_gap_pending:'.length));
    return {from: new Date(gap.from).toISOString(), to: new Date(gap.to).toISOString(), retryAt: gap.retryAt ? new Date(gap.retryAt).toISOString() : null};
  } catch { return null; }
}

function footprintLevels(raw) {
  let levels = raw;
  if (typeof raw === 'string') {
    try { levels = JSON.parse(raw); } catch { levels = []; }
  }
  if (!Array.isArray(levels)) return [];
  return levels.map((level) => ({
    price: Number(level.price),
    buyVol: Number(level.buyVol != null ? level.buyVol : level.buy_vol) || 0,
    sellVol: Number(level.sellVol != null ? level.sellVol : level.sell_vol) || 0,
  })).filter((level) => Number.isFinite(level.price) && (level.buyVol > 0 || level.sellVol > 0));
}

function footprintDeskBar(row) {
  const levels = footprintLevels(row.levels_json);
  const buyVol = Number(row.buy_vol) || levels.reduce((sum, level) => sum + level.buyVol, 0);
  const sellVol = Number(row.sell_vol) || levels.reduce((sum, level) => sum + level.sellVol, 0);
  return {
    t: Number(row.t),
    o: Number(row.o), h: Number(row.h), l: Number(row.l), c: Number(row.c),
    open: Number(row.o), high: Number(row.h), low: Number(row.l), close: Number(row.c),
    buyVol, sellVol, buy_vol: buyVol, sell_vol: sellVol,
    delta: Number.isFinite(Number(row.delta)) ? Number(row.delta) : buyVol - sellVol,
    volume: Number.isFinite(Number(row.volume)) ? Number(row.volume) : buyVol + sellVol,
    pocPrice: row.poc_price == null ? null : Number(row.poc_price),
    poc_price: row.poc_price == null ? null : Number(row.poc_price),
    levels,
  };
}

export async function handleDesk(request, env) {
  if (!env || !env.DB) return json({ error: 'D1 binding missing' }, 500);
  const url = new URL(request.url);
  const parts = url.pathname.replace(/\/$/, '').split('/');
  const scope = parts[3] || '';
  if (!DESK_SCOPES.includes(scope)) return json({ error: 'unknown_desk_scope', supported: DESK_SCOPES }, 400);
  const now = Date.now();
  if (scope === 'chart') {
    const symbolParam = url.searchParams.get('symbol');
    const symbol = symbolParam == null || symbolParam.trim() === '' ? 'BTCUSDT' : symbolParam.trim().toUpperCase();
    if (symbol !== 'BTCUSDT') return json({ error: 'unsupported_symbol' }, 400);
    const interval = String(url.searchParams.get('interval') || '15m');
    if (!INTERVAL_MS[interval]) return json({ error: 'unsupported_interval' }, 400);
    const hasFrom = url.searchParams.has('from');
    const hasTo = url.searchParams.has('to');
    if (hasFrom !== hasTo) return json({ error: 'invalid_window' }, 400);
    let requestFrom = null, requestTo = null;
    if (hasFrom) {
      requestFrom = Number(url.searchParams.get('from'));
      requestTo = Number(url.searchParams.get('to'));
      if (!Number.isSafeInteger(requestFrom) || !Number.isSafeInteger(requestTo) || requestFrom >= requestTo
        || requestFrom !== klineOpenAt(interval, requestFrom) || requestTo !== klineOpenAt(interval, requestTo)) {
        return json({ error: 'invalid_window' }, 400);
      }
    }
    let tail = null;
    if (url.searchParams.has('tail')) {
      const rawTail = url.searchParams.get('tail');
      if (!/^\d+$/.test(rawTail)) return json({ error: 'invalid_tail' }, 400);
      tail = Number(rawTail);
      if (!Number.isInteger(tail) || tail < 2 || tail > 200) return json({ error: 'invalid_tail' }, 400);
    }
    let knownAt = null;
    if (url.searchParams.has('knownAt') || url.searchParams.has('known_at')) {
      knownAt = url.searchParams.get('knownAt') || url.searchParams.get('known_at');
      if (!Number.isFinite(Date.parse(knownAt))) return json({ error: 'invalid_known_at' }, 400);
    }
    const readIntent = hasFrom ? 'window' : (tail ? 'tail' : 'window');
    const limit = readIntent === 'tail' ? tail : 6000;
    const datasetId = `binance-perp-klines-${interval}`;
    const statements = [];
    if (readIntent === 'window') statements.push(env.DB.prepare(historyBaselineStatement('BTCUSDT', interval, datasetId).sql).bind(...historyBaselineStatement('BTCUSDT', interval, datasetId).params));
    statements.push(env.DB.prepare('SELECT head_t, history_revision FROM desk_history_state WHERE symbol=?1 AND interval=?2').bind('BTCUSDT', interval));
    statements.push(env.DB.prepare(`SELECT t,o,h,l,c,v FROM klines WHERE symbol=?1 AND interval=?2
      AND (?3 IS NULL OR t>=?3) AND (?4 IS NULL OR t<?4) ORDER BY t DESC LIMIT ?5`).bind('BTCUSDT', interval, requestFrom, requestTo, limit + 1));
    const stateIndex = statements.length;
    statements.push(env.DB.prepare('SELECT last_error FROM finance_dataset_state WHERE dataset_id=?1').bind(datasetId));
    const canonicalRead = prepareBoundedObservations(env.DB, datasetId, {
      limit, fromMs: requestFrom, toMs: requestTo, knownAt: knownAt || new Date(now).toISOString(), historical: knownAt != null,
    });
    const canonicalIndex = statements.length;
    statements.push(canonicalRead.statement);
    const predecessorIndex = statements.length;
    statements.push(env.DB.prepare(`SELECT t,o,h,l,c,v FROM klines WHERE symbol=?1 AND interval=?2
      AND t < COALESCE(?3, (SELECT MIN(t) FROM (SELECT t FROM klines WHERE symbol=?1 AND interval=?2
        AND (?4 IS NULL OR t<?4) ORDER BY t DESC LIMIT ?5))) ORDER BY t DESC LIMIT 1`)
      .bind('BTCUSDT', interval, requestFrom, requestTo, limit));
    const statusIndex = statements.length;
    statements.push(env.DB.prepare('SELECT last_run, last_ok, last_error FROM sync_status WHERE symbol=?1 AND interval=?2').bind('BTCUSDT', interval));
    const batched = await env.DB.batch(statements);
    const revisionRow = (batched[readIntent === 'window' ? 1 : 0].results || [])[0] || null;
    const tapeResult = batched[readIntent === 'window' ? 2 : 1];
    let tape = knownAt ? [] : tapeRowsFrom(tapeResult).reverse();
    const tapeTruncated = tape.length > limit;
    if (tapeTruncated) tape = tape.slice(tape.length - limit);
    let tapePredecessor = null;
    if (!knownAt) {
      const rows = tapeRowsFrom(batched[predecessorIndex]);
      tapePredecessor = rows.length && (!tape.length || rows[0].t !== tape[0].t) ? rows[0] : null;
    }
    let canonical = [];
    let canonicalPredecessor = null;
    let canonicalTruncated = false;
    const bounded = canonicalRead.parse(batched[canonicalIndex]);
    canonical = mapKlineObservations(bounded.observations);
    canonicalPredecessor = bounded.predecessor ? mapKlineObservations([bounded.predecessor])[0] : null;
    canonicalTruncated = bounded.truncated;
    const byOpen = new Map();
    for (const bar of tape) byOpen.set(bar.t, bar);
    for (const bar of canonical) byOpen.set(bar.t, bar);
    let series = [...byOpen.values()].sort((a, b) => a.t - b.t);
    let predecessor = canonicalPredecessor || (knownAt ? null : tapePredecessor);
    let truncated = tapeTruncated || canonicalTruncated;
    if (series.length > limit) {
      predecessor = series[series.length - limit - 1] || predecessor;
      series = series.slice(series.length - limit);
      truncated = true;
    }
    const unresolvedGap = unresolvedFromState((batched[stateIndex].results || [])[0]);
    const status = (batched[statusIndex].results || [])[0] || null;
    const lastRun = Number(status && status.last_run) || 0;
    const last = series.length ? series[series.length - 1] : null;
    const step = INTERVAL_MS[interval];
    const authoritative = !!(status && Number(status.last_ok) === 1 && lastRun && now - lastRun <= LIVE_TAPE_FRESH_MS
      && last && now - last.t <= step * 2 && !/bybit|okx/i.test(String(status.last_error || '')));
    return json(finishChartDesk({
      interval, now, series, predecessor, truncated, unresolvedGap,
      readIntent, requestFrom, requestTo, tail, historyRevision: Number(revisionRow?.history_revision || 0),
      headT: revisionRow ? Number(revisionRow.head_t) : null, authoritative,
      dataset: { id: datasetId, collectionStale: !authoritative, sourceStale: null, observations: [] },
    }));
  }
  if (scope === 'context') {
    const ids = [
      'binance-perp-premium', 'binance-perp-funding', 'binance-perp-funding-info', 'binance-perp-basis',
      'binance-perp-oi', 'binance-perp-oi-history', 'binance-perp-taker', 'binance-perp-accounts', 'binance-perp-top-positions',
      'fred-dgs2', 'fred-dgs10', 'fred-real10y', 'fred-breakeven10y', 'nyfed-sofr',
      'fred-dollar', 'fred-fed-assets', 'fred-tga', 'fred-rrp', 'fred-cpi',
      'stablecoin-supply', 'crypto-breadth', 'btc-fees',
    ];
    let knownAt = null;
    if (url.searchParams.has('knownAt') || url.searchParams.has('known_at')) {
      knownAt = url.searchParams.get('knownAt') || url.searchParams.get('known_at');
      if (!Number.isFinite(Date.parse(knownAt))) return json({ error: 'invalid_known_at' }, 400);
    }
    const entries = await Promise.all(ids.map(async (id) => [id, await readSummaryQuiet(env.DB, id, knownAt)]));
    return json(buildContextDesk(Object.fromEntries(entries), now));
  }
  if (scope === 'heatmap') {
    const symbol = String(url.searchParams.get('symbol') || 'BTCUSDT').toUpperCase();
    const rangeMs = { '24h': 86400000, '7d': 7 * 86400000, '30d': 30 * 86400000 }[String(url.searchParams.get('range') || '24h')] || 86400000;
    const from = now - rangeMs;
    const { results } = await env.DB.prepare(
      `SELECT symbol, exchange, bucket_start, long_notional, short_notional, long_count, short_count, max_notional, max_side, min_price, max_price, vwap_price
         FROM liquidation_5m_buckets WHERE symbol = ?1 AND bucket_start >= ?2 ORDER BY bucket_start ASC`
    ).bind(symbol, from).all();
    return json(buildHeatmapDesk(results || [], now));
  }
  if (scope === 'orderflow') {
    const symbol = String(url.searchParams.get('symbol') || 'BTCUSDT').toUpperCase();
    const status = await env.DB.prepare(
      'SELECT last_run, last_trade_id, last_trade_time, last_count, last_ok, last_error FROM footprint_sync_status WHERE symbol = ?1'
    ).bind(symbol).first();
    const { results } = await env.DB.prepare(
      `SELECT t, o, h, l, c, buy_vol, sell_vol, delta, volume, poc_price, levels_json FROM footprint_bars
        WHERE symbol = ?1 AND interval = '5m' ORDER BY t DESC LIMIT 240`
    ).bind(symbol).all();
    const bars = (results || []).slice().reverse().map(footprintDeskBar);
    return json(buildOrderflowDesk(status, bars, now));
  }
  return json({ error: 'unknown_desk_scope' }, 400);
}
