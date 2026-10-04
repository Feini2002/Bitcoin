const number = value => value !== null && value !== undefined && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;

// https://bybit-exchange.github.io/docs/v5/market/open-interest
export function bybitOpenInterest(row, { category, symbol = 'BTCUSDT' }) {
  if (!['linear','inverse'].includes(category)) throw Error('unsupported_bybit_category');
  const doubled = number(row.openInterest), single = number(row.singleOpenInterest);
  if (doubled === null || doubled < 0 || (single !== null && single < 0)) throw Error('invalid_bybit_oi');
  return { venue:'bybit', symbol, marketType:category, nativeOpenInterest:doubled, singleOpenInterest:single,
    nativeSideBasis:'double-sided', sideBasis:single === null ? 'double-sided-only' : 'single-sided',
    comparableOpenInterest:single, unit:category === 'linear' ? 'BTC' : 'USD',
    observedAt:row.timestamp ? new Date(Number(row.timestamp)).toISOString() : null,
    combinedTotalsAllowed:false, normalization:'use reported singleOpenInterest; never silently halve legacy double-sided data' };
}

// https://www.okx.com/docs-v5/en/#rest-api-public-data-get-open-interest
export function okxOpenInterest(row, instrument) {
  if (!row.instId || instrument?.instId !== row.instId || !instrument.ctVal || !instrument.ctValCcy || !instrument.ctType) throw Error('missing_okx_contract_metadata');
  const oi = number(row.oi), oiCcy = number(row.oiCcy), oiUsd = number(row.oiUsd);
  if (oi === null || oi < 0 || (oiCcy !== null && oiCcy < 0) || (oiUsd !== null && oiUsd < 0)) throw Error('invalid_okx_oi');
  return { venue:'okx',instrumentId:row.instId,contracts:oi,coinOpenInterest:oiCcy,usdOpenInterest:oiUsd,
    units:{contracts:'contracts',coinOpenInterest:'BTC',usdOpenInterest:'USD'},
    contract:{ctVal:instrument.ctVal,ctValCcy:instrument.ctValCcy,ctType:instrument.ctType,settleCcy:instrument.settleCcy||null},
    observedAt:row.ts ? new Date(Number(row.ts)).toISOString() : null,combinedTotalsAllowed:false };
}
