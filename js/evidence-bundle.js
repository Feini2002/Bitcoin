(function (root) {
  'use strict';
  const identity = typeof module !== 'undefined' && module.exports ? require('./content-identity.js') : root.BitContentIdentity;
  const schema = 'bitdesk.evidence.v2';
  const scopes = ['chart', 'orderflow', 'heatmap', 'context'];
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  }
  function sourceManifest(data) {
    const sources = [];
    function walk(value, location) {
      if (!value || typeof value !== 'object') return;
      if (value.sourceHost || value.datasetId || value.sourceRevision || value.contentHash) {
        sources.push({ location, datasetId: value.datasetId || null, sourceHost: value.sourceHost || null,
          provider: value.provider || null, observedAt: value.observedAt || value.referencePeriod || null,
          referenceDate: value.referenceDate || null, publicAvailableAt: value.publicAvailableAt || null,
          receivedAt: value.effectiveReceivedAt || value.receivedAt || null, storedAt: value.storedAt || null,
          version: value.version || value.sourceRevision || null, contentHash: value.contentHash || identity.contentId(value),
          units: value.units || null, finality: value.finality || null });
      }
      Object.entries(value).forEach(([key, item]) => { if (item && typeof item === 'object') walk(item, location + '/' + key); });
    }
    walk(data, '');
    return sources;
  }
  const numeric = value => typeof value === 'number' && Number.isFinite(value);
  const time = value => typeof value === 'string' && value.length ? Date.parse(value) : NaN;
  function capabilities(name, data, cutoff, asOf) {
    const result = {};
    const cutoffApplied = data?.cutoff?.applied === true && data.cutoff.requested === cutoff;
    const asOfApplied = Number.isFinite(time(data?.asOf)) && time(data.asOf)===time(asOf);
    const add = (id, reason, detail = {}) => { result[id] = { ready: cutoffApplied && asOfApplied && !reason,
      reason: !cutoffApplied ? 'cutoff_not_confirmed' : !asOfApplied ? 'asof_not_confirmed' : reason || null, scope:name, ...detail }; };
    function card(id, value, {reference = false, fields = null} = {}) {
      let reason = !value || value.unavailable === true ? 'data_unavailable' : null;
      const values = value?.values || {};
      if (!reason && !(typeof fields==='function'?fields(values):fields ? fields.every(key => numeric(values[key])) : numeric(value.value) || Object.values(values).some(numeric))) reason='required_values_missing';
      const observedAt = value?.observedAt || value?.referencePeriod;
      const receipt = value?.effectiveReceivedAt || value?.receivedAt;
      if (!reason && (!Number.isFinite(time(observedAt)) || time(observedAt)>time(asOf))) reason='source_time_unknown_or_after_asof';
      if (!reason && (!Number.isFinite(time(receipt)) || time(receipt)>time(cutoff))) reason='receipt_unknown_or_after_cutoff';
      if (!reason && !value?.sourceHost) reason='source_unverified';
      if (!reason && (value.collectionStale===true || value.sourceStale===true)) reason='source_or_collection_stale';
      if (!reason && !reference && (value.collectionStale!==false || value.sourceStale!==false)) reason='freshness_not_verified';
      add(id,reason,{eligibility:reference?'reported-reference; latest release not guaranteed':'current-observation',
        observedAt:observedAt || null,receivedAt:receipt || null,
        sourceStale:value?.sourceStale ?? null,collectionStale:value?.collectionStale ?? null});
    }
    if (name==='context') {
      for (const [key,fields] of Object.entries({premium:['markPrice','indexPrice','lastFundingRate'],funding:['fundingRate'],basis:['basis','basisRate']}))
        card('context.contract.'+key,data?.contract?.[key],{fields});
      for (const [key,fields] of Object.entries({oi:['openInterest'],oiHistory:['sumOpenInterest','sumOpenInterestValue'],
        taker:['buyVol','sellVol'],accounts:['longAccount','shortAccount','longShortRatio'],topPositions:['longPosition','shortPosition','longShortRatio']}))
        card('context.positioning.'+key,data?.contract?.positioning?.[key],{fields});
      const groups={dailyRates:['fred-dgs2','fred-dgs10','fred-real10y','fred-breakeven10y','nyfed-sofr'],
        weeklyDollarH41:['fred-dollar','fred-fed-assets','fred-tga','fred-rrp'],monthlyCpi:['fred-cpi'],
        cryptoBackground:['stablecoin-supply','crypto-breadth','btc-fees']};
      for (const [group,ids] of Object.entries(groups)) for (const id of ids) {
        const value=data?.groups?.[group]?.cards?.find(item=>item.id===id);
        const fields=id==='stablecoin-supply'?values=>Array.isArray(values.coins)
          && ['USDT','USDC'].every(symbol=>values.coins.some(coin=>coin.symbol===symbol && numeric(coin.circulating) && numeric(coin.price)))
          :id==='crypto-breadth'?['marketCap','volume24h','btcDominance']:id==='btc-fees'?['fastestFee','halfHourFee','hourFee','minimumFee']
          :id==='nyfed-sofr'?['percentRate']:['value'];
        card('context.reference.'+id,value,{reference:true,fields});
        card('context.latest.'+id,value,{fields});
      }
      for (const currency of ['BTC','USDC']) {
        const value=data?.options?.[currency];
        const receiptBounded=[value?.metadataReceipt,value?.quoteReceipt].every(receipt=>Number.isFinite(time(receipt)) && time(receipt)<=time(cutoff));
        const reason=!value || !numeric(value.universe) || value.universe<=0 || value.quality?.status==='fail'?'options_unavailable'
          : !receiptBounded?'option_receipt_unknown_or_after_cutoff':value.collectionStale!==false?'option_snapshot_not_fresh'
          :value.summaryUniverseCovered!==true || value.invalidCount>0?'option_universe_not_reconciled':null;
        add('context.options.'+currency+'.summary',reason,{eligibility:'metadata-reconciled-summary; not full ticker chain'});
        add('context.options.'+currency+'.greeks',reason || (value.fullAnalyticsChain!==true || value.greeksCount!==value.universe?'full_greeks_not_collected':null));
        add('context.options.'+currency+'.bidAskIv',reason || (value.bidAskIvCount!==value.universe?'full_bid_ask_iv_not_collected':null));
      }
      for (const value of data?.externalCoverage || []) add('context.external.'+value.id,value.status==='available'?null:value.status || 'missing');
    } else if (name==='chart') {
      add('chart.price',data?.quality?.status==='fail' || !data?.series?.length?'price_unavailable':null);
      add('chart.history',data?.researchWindow?.eligible===true && data?.coverage?.truncated!==true && data?.quality?.status==='pass'?null:data?.researchWindow?.reason || 'verified_history_insufficient');
    } else if (name==='orderflow') {
      add('orderflow.aggregatedVolume',data?.quality?.status==='pass' && data?.series?.length?null:data?.quality?.reason || 'orderflow_unavailable',
        {eligibility:'retained aggregate observations; raw replay not established'});
      add('orderflow.rawReplay',data?.historicalEligibility?.eligible===true?null:'raw_event_history_not_verified');
    } else if (name==='heatmap') {
      add('heatmap.recordedEvents',data?.coverage?.returned>0 && data?.quality?.status!=='fail'?null:'no_recorded_events',
        {eligibility:'sampled recorded events; empty buckets do not prove absence'});
      add('heatmap.completeEvents','sampled_liquidation_events; complete events not observable');
    }
    return result;
  }
  function readiness(name, data, cutoff, asOf) {
    if (!scopes.includes(name)) return { cutoffApplied: false, ready: false, reason: 'context-annex; publication knowledge not reconstructed' };
    const cutoffApplied = data?.cutoff?.applied === true && data.cutoff.requested === cutoff;
    const asOfApplied = Number.isFinite(time(data?.asOf)) && time(data.asOf)===time(asOf);
    let reason = !cutoffApplied ? 'cutoff_not_confirmed' : !asOfApplied ? 'asof_not_confirmed' : data?.quality?.status === 'fail' ? data.quality.reason || 'quality_failed' : null;
    if (!reason && name === 'chart' && data?.researchWindow?.eligible !== true) reason = data?.researchWindow?.reason || 'verified_history_insufficient';
    if (!reason && name === 'heatmap') reason = 'sampled_liquidation_events; complete events not observable';
    if (!reason && name === 'orderflow' && !(data.series?.length > 0)) reason = 'no_orderflow_at_cutoff';
    if (!reason && data?.quality?.status !== 'pass') reason = data?.quality?.reason || 'partial_quality';
    if (!reason && data?.coverage?.truncated === true) reason = 'window_truncated';
    const capabilityReadiness=capabilities(name,data,cutoff,asOf);
    if (!reason && name==='context') {
      const required=Object.entries(capabilityReadiness).filter(([id])=>/^context\.(contract|positioning|reference)\./.test(id) || /^context\.options\.(BTC|USDC)\.summary$/.test(id));
      if (!required.length || required.some(([,value])=>!value.ready)) reason='context_capabilities_incomplete';
    }
    return { cutoffApplied, asOfApplied, ready: !reason, reason, capabilities:capabilityReadiness };
  }
  function build({ kind, asOf, knowledgeCutoff, resources, capturedAt = null, requirements = null }) {
    if (!Number.isFinite(Date.parse(asOf)) || !Number.isFinite(Date.parse(knowledgeCutoff)) || Date.parse(asOf) > Date.parse(knowledgeCutoff)) throw Error('invalid_bundle_cutoff');
    const canonicalCutoff = new Date(knowledgeCutoff).toISOString();
    const entries = resources.map(resource => {
      const data = resource.data === undefined ? null : JSON.parse(JSON.stringify(resource.data));
      const check = resource.ok ? readiness(resource.name, data, canonicalCutoff,asOf) : { cutoffApplied: false, ready: false, reason: resource.error || 'read_failed',capabilities:{} };
      return { name: resource.name, url: resource.url, accessedAt: resource.accessedAt, transportOk: resource.ok === true,
        error: resource.ok ? null : resource.error || 'read_failed', contentHash: identity.contentId(data),
        inputRevision: data?.inputRevision || null, schemaVersion: data?.schemaVersion || null,
        parameters: data?.requestWindow || null, coverage: data?.coverage || null, quality: data?.quality || null,
        ...check, sources: sourceManifest(data), data };
    }).sort((a, b) => a.name.localeCompare(b.name));
    if (new Set(entries.map(entry => entry.name)).size !== entries.length) throw Error('duplicate_evidence_scope');
    const required = scopes.map(name => entries.find(entry => entry.name === name));
    const capabilityReadiness=Object.assign({},...entries.map(entry=>entry.capabilities));
    const declared=requirements==null?null:JSON.parse(JSON.stringify(requirements));
    if (declared && (!Array.isArray(declared.capabilities) || declared.capabilities.length===0
      || declared.capabilities.some(id=>typeof id!=='string') || (declared.roles!=null && (typeof declared.roles!=='object' || Array.isArray(declared.roles)
        || Object.values(declared.roles).some(ids=>!Array.isArray(ids) || !ids.length || ids.some(id=>typeof id!=='string')))))) throw Error('invalid_evidence_requirements');
    function requirementCheck(ids) {
      const missing=ids.filter(id=>capabilityReadiness[id]?.ready!==true);
      return {ready:missing.length===0,required:ids,missing,reasons:Object.fromEntries(missing.map(id=>[id,capabilityReadiness[id]?.reason || 'capability_unknown_or_transport_failed']))};
    }
    const taskReadiness=declared?requirementCheck(declared.capabilities):null;
    const roleReadiness=Object.fromEntries(Object.entries(declared?.roles || {}).map(([role,ids])=>[role,requirementCheck(ids)]));
    const bundle = { schema, methodVersion: 'frozen-system-evidence.2026-09-30.2', kind,
      asOf: new Date(asOf).toISOString(), knowledgeCutoff: canonicalCutoff, capturedAt,
      atomicSnapshot: false, cutoffPolicy: 'per-scope retained system knowledge; independent commits, explicit unsupported gaps',
      transportComplete: entries.length > 0 && entries.every(entry => entry.transportOk),
      cutoffComplete: required.every(entry => entry?.transportOk && entry.cutoffApplied),
      asOfComplete: required.every(entry => entry?.transportOk && entry.asOfApplied),
      analysisReady: declared ? taskReadiness.ready && Object.values(roleReadiness).every(role=>role.ready) : required.every(entry => entry?.ready === true),
      requirements:declared,capabilityReadiness,taskReadiness,roleReadiness,
      limitations: ['Original publication time can be unknown.', 'Stored aggregate versions are not raw event replay.',
        'Sampled liquidation feeds cannot prove absence of unobserved events.', 'Report annexes are current reads, excluded from cutoff claims.'],
      entries };
    bundle.contentId = identity.contentId(bundle);
    return freeze(bundle);
  }
  function validate(bundle) {
    const errors = [];
    if (bundle?.schema !== schema || !Array.isArray(bundle?.entries)) return ['invalid_evidence_bundle'];
    const { contentId, ...content } = bundle;
    if (contentId !== identity.contentId(content)) errors.push('bundle_content_mismatch');
    for (const entry of bundle.entries) if (entry.contentHash !== identity.contentId(entry.data)) errors.push('scope_content_mismatch:' + entry.name);
    return errors;
  }
  const api = { build, validate, sourceManifest, schema, scopes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BitEvidenceBundle = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
