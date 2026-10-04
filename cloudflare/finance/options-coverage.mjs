import identity from '../../js/content-identity.js';
import { deribitOptionGroup } from './datasets.mjs';

export function optionCoverage(metadata, summary, currency, now = Date.now()) {
  const invalid=[];
  function validRows(dataset, isMetadata) {
    return (dataset?.observations || []).map(row=>row.values).filter(row=>{
      try {
        if(deribitOptionGroup(row,currency,{metadata:isMetadata}))return true;
        invalid.push({source:isMetadata?'metadata':'summary',instrument:row?.instrument_name || null,reason:'non_btc_instrument_in_normalized_dataset'});
      } catch(error) {invalid.push({source:isMetadata?'metadata':'summary',instrument:row?.instrument_name || null,reason:error.message});}
      return false;
    });
  }
  const instruments = validRows(metadata,true).filter(row=>row.is_active !== false && Number(row.expiration_timestamp)>now);
  const quotes = validRows(summary,false);
  const wanted = new Set(instruments.map(row=>row.instrument_name));
  const mapped = quotes.filter(row=>wanted.has(row.instrument_name));
  const available = new Set(mapped.map(row=>row.instrument_name));
  const missing = [...wanted].filter(name=>!available.has(name)).sort();
  const extras = quotes.filter(row=>!wanted.has(row.instrument_name)).map(row=>row.instrument_name).sort();
  const quoteReceipt = summary?.observations?.[0]?.effectiveReceivedAt || summary?.observations?.[0]?.receivedAt || null;
  const metadataReceipt = metadata?.observations?.[0]?.effectiveReceivedAt || metadata?.observations?.[0]?.receivedAt || null;
  const quoteAge=now-Date.parse(quoteReceipt || ''),metadataAge=now-Date.parse(metadataReceipt || '');
  const stale = !Number.isFinite(quoteAge) || quoteAge<0 || quoteAge>1200000
    || !Number.isFinite(metadataAge) || metadataAge<0 || metadataAge>7200000;
  const expiries = [...new Set(instruments.map(row=>Number(row.expiration_timestamp)))].sort((a,b)=>a-b);
  const lookup = new Map(mapped.map(row=>[row.instrument_name,row]));
  const smiles = expiries.slice(0,3).map(expiry=>({expiry:new Date(expiry).toISOString(),
    points:instruments.filter(row=>Number(row.expiration_timestamp)===expiry).sort((a,b)=>Number(a.strike)-Number(b.strike)||a.instrument_name.localeCompare(b.instrument_name))
      .slice(0,160).map(row=>{const quote=lookup.get(row.instrument_name);return {instrument:row.instrument_name,strike:Number(row.strike),type:row.option_type,
        markIv:quote?.mark_iv??null,openInterest:quote?.open_interest??null,markPrice:quote?.mark_price??null,underlyingPrice:quote?.underlying_price??null};})}));
  const covered = wanted.size>0 && !missing.length && !extras.length && !invalid.length
    && metadata?.ok!==false && summary?.ok!==false && metadata?.coverage?.truncated!==true && summary?.coverage?.truncated!==true;
  return { currency, underlying:'BTC', group:currency==='BTC'?'coin-settled':'usdc-settled',
    metadataReceipt,quoteReceipt,collectionStale:stale,universe:wanted.size,summary:quotes.length,mapped:mapped.length,
    missingCount:missing.length,missingInstruments:missing.slice(0,30),unexpectedCount:extras.length,unexpectedInstruments:extras.slice(0,30),
    invalidCount:invalid.length,invalidInstruments:invalid.slice(0,30),
    summaryUniverseCovered:covered,markIvCount:mapped.filter(row=>Number.isFinite(Number(row.mark_iv)) && row.mark_iv!==null).length,
    bidAskIvCount:0,greeksCount:0,fullAnalyticsChain:false,
    contentHash:identity.contentId({instruments:instruments.slice().sort((a,b)=>a.instrument_name.localeCompare(b.instrument_name)),quotes:quotes.slice().sort((a,b)=>a.instrument_name.localeCompare(b.instrument_name)),invalid}),
    quality:{status:!invalid.length && wanted.size && quotes.length ? 'warn':'fail',reason:invalid.length?'option_instrument_group_invalid':stale?'option_snapshot_delayed':!covered?'option_universe_not_reconciled':'summary_only; full Greeks not collected'},
    units:{strike:'USD/BTC',markIv:'percent',openInterest:'BTC',markPrice:currency},smiles,
    limitations:['Metadata discovery and summary snapshots; no claimed full ticker/Greeks stream.', 'Mark IV is not an executable bid/ask quote.',
      'Historical IV/Greeks before first receipt unavailable.', 'OI and gamma alone do not reveal dealer positioning.'] };
}
