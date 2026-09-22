import { readDataset } from './dataset-store.mjs';

export const DESK_SCHEMA_VERSION = '2026-09-21.1';
export const DESK_SCOPES = ['chart', 'orderflow', 'heatmap', 'context'];
export const FORBIDDEN_COPY = [
  'DXY', '已接入', '主链路达标', '拥挤', '占优', '挤压', '清算池',
  'Bybit 兜底主源', 'net liquidity', '净流动性', '倒挂',
];

const INTERVAL_MS = { '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000, '3d': 259200000, '1w': 604800000 };
const NEEDED_BARS = { '5m': 864, '15m': 480, '1h': 200, '4h': 120, '1d': 60, '3d': 120, '1w': 52 };
const LIVE_TAPE_FRESH_MS = 90 * 1000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function binanceHostOk(host) {
  const h = String(host || '');
  return /(?:^|\.)binance\.com$/i.test(h) || h === 'fapi.binance.com' || h === 'data-api.binance.vision' || /binance\.com/i.test(h) && !/bybit|okx/i.test(h);
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

export function mapKlineObservations(observations) {
  return (observations || []).slice().reverse().map((row) => {
    const v = row.values || {};
    return {
      t: Date.parse(row.observedAt),
      o: v.open, h: v.high, l: v.low, c: v.close,
      v: v.baseVolume, quoteVolume: v.quoteVolume, trades: v.trades,
      takerBuyBase: v.takerBuyBase, takerBuyQuote: v.takerBuyQuote,
      closed: v.closed, windowEnded: v.windowEnded, finality: v.finality, closureBasis: v.closureBasis,
      observedAt: row.observedAt, receivedAt: row.receivedAt, storedAt: row.storedAt,
      sourceHost: row.sourceHost, ingestionMode: row.ingestionMode, publicAvailableAt: row.publicAvailableAt ?? null,
    };
  }).filter((row) => Number.isFinite(row.t) && Number.isFinite(row.o) && Number.isFinite(row.c));
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
  const dataset = {
    ok: tape.authoritative,
    id: `binance-perp-klines-${interval}`,
    observations: (tape.rows || []).slice().reverse().map((row) => ({
      observedAt: new Date(row.t).toISOString(),
      receivedAt: tape.lastRun ? new Date(tape.lastRun).toISOString() : new Date(now).toISOString(),
      storedAt: tape.lastRun ? new Date(tape.lastRun).toISOString() : new Date(now).toISOString(),
      sourceHost: tape.sourceHost || 'fapi.binance.com',
      ingestionMode: tape.ingestionMode || 'cloud-ws',
      publicAvailableAt: null,
      values: {
        open: row.o, high: row.h, low: row.l, close: row.c, baseVolume: row.v,
        quoteVolume: null, trades: null, takerBuyBase: null, takerBuyQuote: null,
        closed: null, windowEnded: null, finality: 'forming',
        closureBasis: 'live-tape; exchange confirmation not stored on klines table',
      },
    })),
    collectionStale: !tape.authoritative,
    sourceStale: !tape.authoritative,
    coverage: { available: (tape.rows || []).length, returned: (tape.rows || []).length, truncated: (tape.rows || []).length >= 6000 },
    state: { last_ingestion_mode: tape.ingestionMode || 'cloud-ws', last_success_received_at: tape.lastRun ? new Date(tape.lastRun).toISOString() : null },
  };
  const desk = buildChartDesk(dataset, interval, now);
  if (tape.authoritative) {
    desk.pricePathAvailable = true;
    desk.quality = quality('pass', (desk.gap && desk.gap.reason === 'coverage_short') ? 'coverage_short' : null);
    desk.ingestionMode = tape.ingestionMode || 'cloud-ws';
    desk.sourceHost = tape.sourceHost || 'fapi.binance.com';
  }
  return desk;
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

export function buildChartDesk(dataset, interval, now = Date.now()) {
  const asOf = new Date(now).toISOString();
  const auth = klineAuthority(dataset, { now, interval });
  const series = auth.ok ? mapKlineObservations(dataset.observations) : [];
  const last = series.length ? series[series.length - 1] : null;
  const needed = NEEDED_BARS[interval] || 0;
  const coverage = {
    available: series.length,
    returned: series.length,
    truncated: !!(dataset && dataset.coverage && dataset.coverage.truncated),
    needed,
  };
  const gap = auth.ok ? (needed && series.length < needed ? { reason: 'coverage_short', needed, available: series.length } : null) : { reason: auth.reason };
  return {
    schemaVersion: DESK_SCHEMA_VERSION,
    asOf,
    asKnownMode: 'system_observed',
    scope: 'chart',
    instrumentId: auth.instrumentId,
    venue: auth.venue,
    marketType: 'usdm-perpetual',
    datasetId: dataset && dataset.id ? dataset.id : `binance-perp-klines-${interval}`,
    ingestionMode: last ? last.ingestionMode : dataset && dataset.state ? dataset.state.last_ingestion_mode : null,
    sourceHost: last ? last.sourceHost : null,
    observedAt: last ? last.observedAt : null,
    receivedAt: last ? last.receivedAt : dataset && dataset.state ? dataset.state.last_success_received_at : null,
    storedAt: last ? last.storedAt : null,
    publicAvailableAt: null,
    closed: last ? last.closed : null,
    windowEnded: last ? last.windowEnded : null,
    finality: last ? last.finality : null,
    closureBasis: last ? last.closureBasis : null,
    collectionStale: dataset ? dataset.collectionStale : true,
    sourceStale: dataset ? dataset.sourceStale : null,
    coverage,
    units: { price: 'USDT/BTC', baseVolume: 'BTC', quoteVolume: 'USDT' },
    baselineAt: null,
    windowEligible: false,
    inputRevision: inputRevision({ scope: 'chart', interval, latest: last && last.t, reason: auth.reason }),
    quality: quality(auth.ok ? (gap && gap.reason === 'coverage_short' ? 'warn' : 'pass') : 'fail', auth.reason || (gap && gap.reason)),
    pricePathAvailable: auth.ok,
    tradingNarrative: false,
    interval,
    series,
    gap,
  };
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

export function buildContextDesk(datasets, now = Date.now()) {
  const asOf = new Date(now).toISOString();
  const get = (id) => datasets && datasets[id] ? datasets[id] : null;
  const contractIds = ['binance-perp-premium', 'binance-perp-funding', 'binance-perp-basis'];
  const contractReady = contractIds.every((id) => {
    const ds = get(id);
    const latest = ds && ds.observations && ds.observations[0];
    if (!latest) return false;
    if (!binanceHostOk(latest.sourceHost)) return false;
    const age = Date.now() - Date.parse(latest.observedAt || latest.receivedAt || '');
    return Number.isFinite(age) && age < 6 * 60 * 60 * 1000 && latest.ingestionMode !== 'local-bootstrap';
  });
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
    inputRevision: inputRevision({ scope: 'context', asOf, contractReady }),
    quality: quality(contractReady ? 'pass' : 'warn', contractReady ? null : 'binance_contract_unavailable'),
    pricePathAvailable: false,
    tradingNarrative: false,
    contract: contractReady ? {
      premium: clockCard('binance-perp-premium', '标记价与报告费率', get('binance-perp-premium'), { note: 'lastFundingRate 是当前报告费率，不是已结算资金费' }),
      funding: clockCard('binance-perp-funding', '已结算资金费', get('binance-perp-funding'), { note: '按 fundingTime；禁止默认 8 小时' }),
      basis: clockCard('binance-perp-basis', '永续基差三字段', get('binance-perp-basis'), { note: 'basis / basisRate / annualizedBasisRate 独立，空为 null' }),
    } : { unavailable: true, reason: 'binance_cloud_path_missing' },
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

async function readQuiet(db, id) {
  try { return await readDataset(db, id); }
  catch { return { ok: false, id, observations: [], collectionStale: true, sourceStale: null, state: null }; }
}

export async function handleDesk(request, env) {
  if (!env || !env.DB) return json({ error: 'D1 binding missing' }, 500);
  const url = new URL(request.url);
  const parts = url.pathname.replace(/\/$/, '').split('/');
  const scope = parts[3] || '';
  if (!DESK_SCOPES.includes(scope)) return json({ error: 'unknown_desk_scope', supported: DESK_SCOPES }, 400);
  const now = Date.now();
  if (scope === 'chart') {
    const interval = String(url.searchParams.get('interval') || '15m');
    if (!INTERVAL_MS[interval]) return json({ error: 'unsupported_interval' }, 400);
    const tail = Number(url.searchParams.get('tail') || 0);
    const limit = Number.isFinite(tail) && tail > 0 ? Math.min(200, Math.max(2, Math.floor(tail))) : 6000;
    const tape = await readLiveKlineTape(env.DB, interval, limit, now);
    if (tape.authoritative) return json(buildChartDeskFromTape(tape, interval, now));
    const dataset = await readQuiet(env.DB, `binance-perp-klines-${interval}`);
    const desk = buildChartDesk(dataset, interval, now);
    if (limit < 6000 && Array.isArray(desk.series) && desk.series.length > limit) desk.series = desk.series.slice(-limit);
    return json(desk);
  }
  if (scope === 'context') {
    const ids = [
      'binance-perp-premium', 'binance-perp-funding', 'binance-perp-basis',
      'fred-dgs2', 'fred-dgs10', 'fred-real10y', 'fred-breakeven10y', 'nyfed-sofr',
      'fred-dollar', 'fred-fed-assets', 'fred-tga', 'fred-rrp', 'fred-cpi',
      'stablecoin-supply', 'crypto-breadth', 'btc-fees',
    ];
    const entries = await Promise.all(ids.map(async (id) => [id, await readQuiet(env.DB, id)]));
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
      `SELECT t, o, h, l, c, buy_vol, sell_vol, delta, volume, poc_price FROM footprint_bars
        WHERE symbol = ?1 AND interval = '5m' ORDER BY t DESC LIMIT 240`
    ).bind(symbol).all();
    const bars = (results || []).slice().reverse();
    return json(buildOrderflowDesk(status, bars, now));
  }
  return json({ error: 'unknown_desk_scope' }, 400);
}
