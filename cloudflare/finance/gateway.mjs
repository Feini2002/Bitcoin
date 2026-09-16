import { FINANCE_PROVIDERS, FINANCE_EXCLUSIONS, FINANCE_VERSION } from './registry.mjs';
import { financeChannelKey, readFinanceSnapshot, persistFinanceSnapshot, persistFinanceFailure, financeStorageStatus } from './store.mjs';
import { FINANCE_DATASETS, datasetCatalog, datasetRequest } from './datasets.mjs';
import { persistDataset, datasetFailure, readDataset, datasetStates } from './dataset-store.mjs';

const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 12000;
const reply = (body, status = 200, headers = {}) => Response.json(body, { status, headers:{'Cache-Control':'no-store', ...headers} });
class ChannelError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

export function financeCatalog(env = {}) {
  return {
    version:FINANCE_VERSION,
    mode:env.FINANCE_D1_ENABLED==='true' ? 'on-demand-d1-cache' : 'on-demand-read-only',
    storage:{enabled:env.FINANCE_D1_ENABLED==='true', retention:'latest-success-per-parameter-set', readPath:'/api/finance/stored/{provider}/{operation}', statusPath:'/api/finance/status'},
    automaticCollection:false,
    billing:'No subscriptions, upgrades, paid API hosts (except CMC Basic host), or billable background jobs are created. Cloudflare account usage remains subject to its existing plan.',
    providers:Object.entries(FINANCE_PROVIDERS).map(([id,p]) => ({
      id, name:p.name, category:p.category, market:p.market || 'see-native-payload', cost:p.cost, docs:p.docs,
      notes:p.notes, ttlSeconds:p.ttl, checkedAt:'2026-09-16',
      configuration:p.secret ? (env[p.secret] ? 'configured-not-probed' : 'missing-free-key')
        : p.setting ? (env[p.setting] ? 'configured-not-probed' : 'missing-contact-setting') : 'no-key-required-not-probed',
      requiredSetting:p.secret || p.setting || null,
      operations:Object.entries(p.operations).map(([name,o]) => ({
        name, path:`/api/finance/${id}/${name}`, format:o.format || 'json', parameters:o.params,
        example:`/api/finance/${id}/${name}`,
      })),
    })),
    excluded:FINANCE_EXCLUSIONS,
  };
}

export function buildFinanceRequest(providerId, operation, search = new URLSearchParams(), env = {}, skipAuth = false) {
  const p = FINANCE_PROVIDERS[providerId];
  const o = p?.operations[operation];
  if (!p || !o) throw new ChannelError('unknown_channel',404);
  const values = {};
  for (const key of search.keys()) {
    if (!Object.hasOwn(o.params,key) || search.getAll(key).length !== 1) throw new ChannelError('unsupported_or_duplicate_parameter');
  }
  for (const [key, spec] of Object.entries(o.params)) {
    const raw = search.has(key) ? search.get(key) : spec.default;
    if (raw === undefined) continue;
    const value = String(raw);
    if (spec.type === 'integer') {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value)<spec.min || Number(value)>spec.max) throw new ChannelError('invalid_parameter');
    } else if (spec.type === 'enum') {
      if (!spec.values.includes(value)) throw new ChannelError('invalid_parameter');
    } else if (!new RegExp(spec.pattern).test(value)) throw new ChannelError('invalid_parameter');
    if (spec.pattern === '^\\d{4}-\\d{2}-\\d{2}$' && (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value)) throw new ChannelError('invalid_date');
    values[key] = value;
  }
  const used = new Set();
  const pathname = o.path.replace(/\{([^}]+)\}/g, (_,key) => {
    if (values[key] === undefined) throw new ChannelError('missing_parameter');
    if (values[key]==='.' || values[key]==='..') throw new ChannelError('invalid_parameter');
    used.add(key);
    return encodeURIComponent(values[key]);
  });
  const url = new URL(pathname, o.base || p.base);
  const headers = { Accept:o.format === 'text' ? 'text/csv, application/xml, text/xml, */*' : 'application/json' };
  const body = o.body ? { ...o.body } : null;
  for (const [key,value] of Object.entries(values)) if (!used.has(key)) {
    if (body) body[key]=value; else url.searchParams.set(key,value);
  }
  // Only a dedicated free-plan binding can be used; no reuse of existing paid-service credentials.
  if (p.secret && !skipAuth) {
    if (!env[p.secret]) throw new ChannelError('missing_free_api_key',503);
    if (p.auth.header) headers[p.auth.header]=String(env[p.secret]);
    else url.searchParams.set(p.auth.query,String(env[p.secret]));
  }
  if (p.setting && !skipAuth) {
    const agent = String(env[p.setting] || '');
    if (!agent || !/\S+@\S+\.\S+/.test(agent) || /[\r\n]/.test(agent)) throw new ChannelError('missing_valid_contact_user_agent',503);
    headers['User-Agent']=agent;
  }
  if (body) headers['Content-Type']='application/json';
  return { provider:p, definition:o, url, values, init:{method:body?'POST':'GET',headers,redirect:'manual',...(body?{body:JSON.stringify(body)}:{})} };
}

async function readBounded(response) {
  const length = Number(response.headers.get('content-length'));
  if (length>MAX_BYTES) { await response.body?.cancel(); throw new ChannelError('upstream_response_too_large',502); }
  if (!response.body) throw new ChannelError('empty_upstream_body',502);
  const reader=response.body.getReader();
  const chunks=[];
  let total=0;
  try {
    for (;;) {
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>MAX_BYTES){await reader.cancel();throw new ChannelError('upstream_response_too_large',502);}
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const joined=new Uint8Array(total);
  let offset=0;
  for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}
  return new TextDecoder().decode(joined);
}

async function diagnoseRejection(response) {
  // Read at most 32 KiB in memory. Only fixed classifications leave this function.
  const reader=response.body?.getReader();
  if(!reader)return 'no_error_body';
  let text='',bytes=0;
  try {
    while(bytes<32768) {
      const {done,value}=await reader.read();
      if(done)break;
      const slice=value.subarray(0,32768-bytes); bytes+=slice.length;
      text+=new TextDecoder().decode(slice);
    }
    if(/restricted location|restricted jurisdiction|not available in your country|not available in your region/i.test(text))return 'location_restriction_reported';
    if(/cloudfront/i.test(text))return 'cdn_rejection_reported';
    if(/rate limit|too many requests|quota|credits? exhausted/i.test(text))return 'quota_reported';
    if(/invalid api.?key|api.?key.*invalid|unauthorized/i.test(text))return 'authentication_rejection_reported';
    return response.status===525?'upstream_tls_handshake_failed':'unclassified_upstream_rejection';
  } finally { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
}

export function validateFinancePayload(providerId, definition, data) {
  if (definition.format==='text') {
    if (definition.content==='rss' && !/<(?:rss|feed)\b/i.test(data)) throw new ChannelError('invalid_upstream_feed',502);
    if (definition.content==='csv' && (!data.includes(',') || /<html/i.test(data))) throw new ChannelError('invalid_upstream_csv',502);
    return;
  }
  if (data===null || data===undefined || (typeof data==='string')) throw new ChannelError('invalid_upstream_payload',502);
  if (providerId==='alphavantage') {
    const notice=data.Note || data.Information || data['Error Message'];
    if (notice) {
      // Notices can repeat the API key. Classify in memory and return only fixed codes.
      if (/rate limit|call frequency|requests per day/i.test(String(notice))) throw new ChannelError('upstream_rate_limited',429);
      throw new ChannelError('upstream_rejected_or_quota_exhausted',502);
    }
  }
  const rejected =
    (providerId==='bybit' && data.retCode!==0) ||
    (providerId==='okx' && String(data.code)!=='0') ||
    (providerId==='bitget' && String(data.code)!=='00000') ||
    (providerId==='kucoin' && String(data.code)!=='200000') ||
    (providerId==='kraken' && (!Array.isArray(data.error) || data.error.length>0)) ||
    (providerId==='bls' && data.status!=='REQUEST_SUCCEEDED') ||
    (providerId==='coinmarketcap' && data.status?.error_code!==0) ||
    (providerId==='worldbank' && (!Array.isArray(data) || data[0]?.message)) ||
    (providerId==='bitfinex' && Array.isArray(data) && data[0]==='error') ||
    data.error_code || (data.error && !(Array.isArray(data.error) && data.error.length===0)) || data.status==='error';
  if (rejected) throw new ChannelError('upstream_rejected_or_quota_exhausted',502);
  if (typeof data==='boolean' || (typeof data==='number' && providerId!=='defillama') || (typeof data==='object' && !Array.isArray(data) && Object.keys(data).length===0)) throw new ChannelError('invalid_upstream_payload',502);
  if (providerId==='alphavantage' && !data['Time Series (Daily)']) throw new ChannelError('invalid_upstream_payload',502);
}

async function handleFinanceUpstream(request, env = {}, ctx = {}, dependencies = {}) {
  if (request.method!=='GET') return reply({ok:false,error:'read_only_get_required'},405, {Allow:'GET'});
  const incoming=new URL(request.url);
  const parts=incoming.pathname.replace(/\/$/,'').split('/');
  if (parts.length===4 && parts[3]==='catalog') return reply(financeCatalog(env));
  if (parts.length!==5) return reply({ok:false,error:'unknown_channel'},404);
  const [, , , providerId, operation]=parts;
  let built;
  try { built=buildFinanceRequest(providerId,operation,incoming.searchParams,env); }
  catch(e){ return reply({ok:false,provider:providerId,operation,error:e.code || 'invalid_request'},e.status || 400); }
  const { provider:p, definition:o, url, values, init }=built;
  const cache = Object.hasOwn(dependencies,'cache') ? dependencies.cache : globalThis.caches?.default;
  const cacheUrl=new URL(incoming.origin+`/api/finance/${providerId}/${operation}`);
  cacheUrl.searchParams.set('_version',FINANCE_VERSION);
  for(const key of Object.keys(values).sort())cacheUrl.searchParams.set(key,values[key]);
  const cacheKey=new Request(cacheUrl);
  if(cache) {
    try {
      const hit=await cache.match(cacheKey);
      if(hit){const result=await hit.json();result.cache={hit:true,ttlSeconds:p.ttl};return reply(result);}
    } catch (_) { /* Cache unavailability must not turn a public read into a false data failure. */ }
  }
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),dependencies.timeoutMs || TIMEOUT_MS);
  const requestedAt=new Date().toISOString();
  try {
    const fetcher=dependencies.fetch || fetch;
    const response=await fetcher(url.toString(),{...init,signal:controller.signal});
    if(!response.ok){
      const diagnosis=await diagnoseRejection(response);
      const quota=response.status===429 || (providerId==='coinpaprika' && response.status===402);
      const error=quota?'upstream_rate_limited':response.status===401||response.status===403||response.status===451?'upstream_access_restricted':response.status>=300&&response.status<400?'upstream_redirect_not_followed':'upstream_http_error';
      const retry=response.headers.get('retry-after');
      const seconds=retry && /^\d+$/.test(retry) ? Number(retry) : Math.ceil((Date.parse(retry)-Date.now())/1000);
      return reply({ok:false,provider:providerId,operation,error,diagnosis,upstreamStatus:response.status},quota?429:502,
        Number.isFinite(seconds) && seconds>0 ? {'Retry-After':String(Math.min(seconds,86400))} : {});
    }
    const raw=await readBounded(response);
    let data;
    if(o.format==='text')data=raw;
    else {try{data=JSON.parse(raw);}catch(_){throw new ChannelError('invalid_upstream_json',502);}}
    validateFinancePayload(providerId,o,data);
    if(p.secret && raw.includes(String(env[p.secret]))) throw new ChannelError('upstream_sensitive_echo',502);
    const envelope={
      ok:true,version:FINANCE_VERSION,provider:providerId,operation,
      source:{name:p.name,docs:p.docs,host:url.host,market:p.market || 'see-native-payload',cost:p.cost,notes:p.notes},
      parameters:values,requestedAt,receivedAt:new Date().toISOString(),
      timeSemantics:'receivedAt is gateway receipt time, not the market observation/publication time; retain native time fields in data.',
      format:o.format || 'json',normalized:false,cache:{hit:false,ttlSeconds:p.ttl},data,
    };
    if(cache && ctx.waitUntil) {
      const write=cache.put(cacheKey,Response.json(envelope,{headers:{'Cache-Control':`public, max-age=${p.ttl}`}})).catch(()=>{});
      ctx.waitUntil(write);
    }
    return reply(envelope);
  } catch(e) {
    // Upstream error bodies and request URLs can contain API keys. Never return/log them.
    return reply({ok:false,provider:providerId,operation,error:controller.signal.aborted?'upstream_timeout':e.code || 'upstream_network_error'},controller.signal.aborted?504:e.status || 502);
  } finally { clearTimeout(timer); }
}

function storedResponse(record, ttl, hit) {
  return reply({...record.envelope,
    cache:{hit, layer:'d1', ttlSeconds:ttl},
    storage:{persisted:true, storedAt:record.state.stored_at, receivedAt:record.state.received_at,
      stale:Date.now()-Date.parse(record.state.received_at)>=ttl*1000,
      latestAttemptAt:record.state.attempted_at, latestHttpStatus:record.state.last_http_status,
      latestError:record.state.last_error, retryAt:record.state.retry_at},
  });
}

export async function handleFinance(request, env = {}, ctx = {}, dependencies = {}) {
  const url=new URL(request.url);
  const parts=url.pathname.replace(/\/$/,'').split('/');
  const stored=parts[3]==='stored';
  const status=parts.length===4 && parts[3]==='status';
  if(parts[3]==='datasets')return handleDatasets(request,env,ctx,dependencies);
  if(request.method!=='GET')return reply({ok:false,error:'read_only_get_required'},405,{Allow:'GET'});
  if(parts.length===4 && parts[3]==='catalog')return reply(financeCatalog(env));
  if(env.FINANCE_D1_ENABLED!=='true') {
    if(stored || status)return reply({ok:false,error:'finance_storage_disabled'},503);
    return handleFinanceUpstream(request,env,ctx,dependencies);
  }
  if(!env.DB)return reply({ok:false,error:'finance_storage_unavailable'},503);
  if(status) {
    try{return reply({ok:true,version:FINANCE_VERSION,automaticCollection:false,...await financeStorageStatus(env.DB)});}
    catch(_){return reply({ok:false,error:'finance_storage_unavailable'},503);}
  }
  if(parts.length!==(stored?6:5))return reply({ok:false,error:'unknown_channel'},404);
  const providerId=parts[stored?4:3], operation=parts[stored?5:4];
  let built;
  try{built=buildFinanceRequest(providerId,operation,url.searchParams,env,true);}
  catch(e){return reply({ok:false,provider:providerId,operation,error:e.code || 'invalid_request'},e.status || 400);}
  const key=financeChannelKey(providerId,operation,built.values);
  const ttl=built.provider.ttl;
  let record;
  try{record=await readFinanceSnapshot(env.DB,key);}
  catch(_){return reply({ok:false,error:'finance_storage_unavailable'},503);}
  if(stored) return record.envelope ? storedResponse(record,ttl,true) : reply({ok:false,error:'snapshot_not_found'},404);
  if(record.envelope?.version===FINANCE_VERSION && Date.now()-Date.parse(record.state.received_at)<ttl*1000) return storedResponse(record,ttl,true);
  if(record.state?.retry_at && Date.parse(record.state.retry_at)>Date.now()) {
    return reply({ok:false,provider:providerId,operation,error:record.state.last_error,
      upstreamStatus:record.state.upstream_status, retryAt:record.state.retry_at,
      cooldown:true, storedAvailable:!!record.envelope},record.state.last_http_status,
      {'Retry-After':String(Math.ceil((Date.parse(record.state.retry_at)-Date.now())/1000))});
  }
  const attemptedAt=new Date().toISOString();
  // D1 is the shared cache. Avoid edge hits hiding a changed source or storage result.
  const response=await handleFinanceUpstream(request,env,ctx,{...dependencies,cache:null});
  const body=await response.json();
  try {
    if(response.ok && body.ok) {
      await persistFinanceSnapshot(env.DB,key,body,attemptedAt);
      const saved=await readFinanceSnapshot(env.DB,key);
      if(!saved.envelope)throw new Error('snapshot_not_found');
      return storedResponse(saved,ttl,false);
    }
    const retry=Number(response.headers.get('Retry-After'));
    const cooldown=retry>0 ? retry : response.status===429 ? (providerId==='alphavantage'?21600:900)
      : body.error==='upstream_access_restricted'?900 : response.status===503?0:60;
    const retryAt=cooldown ? new Date(Date.now()+cooldown*1000).toISOString():null;
    await persistFinanceFailure(env.DB,key,providerId,operation,built.values,body,response.status,attemptedAt,retryAt);
    return reply({...body,retryAt,storedAvailable:!!record.envelope},response.status,
      cooldown?{'Retry-After':String(cooldown)}:{});
  } catch(_) {
    return reply({ok:false,provider:providerId,operation,error:'finance_storage_write_failed',upstreamSucceeded:response.ok},503);
  }
}

async function handleDatasets(request,env,ctx,dependencies) {
  const url=new URL(request.url),parts=url.pathname.replace(/\/$/,'').split('/');
  const refresh=parts.length===6 && parts[5]==='refresh';
  if(request.method!==(refresh?'POST':'GET'))return reply({ok:false,error:'dataset_method_required'},405,{Allow:refresh?'POST':'GET'});
  const id=parts[4];
  if(parts.length!==4 && (!FINANCE_DATASETS[id] || (parts.length!==5&&!refresh)))return reply({ok:false,error:'unknown_dataset'},404);
  const allowed=refresh||parts.length===4?[]:['limit','known_at'];
  for(const key of url.searchParams.keys())if(!allowed.includes(key)||url.searchParams.getAll(key).length!==1)return reply({ok:false,error:'invalid_dataset_parameter'},400);
  const limit=url.searchParams.get('limit')||'1000',knownAt=url.searchParams.get('known_at')||new Date().toISOString();
  if(!/^\d+$/.test(limit)||Number(limit)<1||Number(limit)>1000||!/^\d{4}-\d{2}-\d{2}T/.test(knownAt)||!Number.isFinite(Date.parse(knownAt)))return reply({ok:false,error:'invalid_dataset_parameter'},400);
  if(env.FINANCE_D1_ENABLED!=='true'||!env.DB)return reply({ok:false,error:'finance_storage_unavailable'},503);
  try {
    if(parts.length===4)return reply({ok:true,...datasetCatalog(),states:await datasetStates(env.DB)});
    if(refresh) {
      const upstream=await handleFinance(datasetRequest(id,url.origin),env,ctx,dependencies);
      const envelope=await upstream.json();
      if(!upstream.ok || !envelope.ok) {
        await datasetFailure(env.DB,id,upstream.status,envelope.error||'dataset_upstream_failed');
        return reply({ok:false,id,error:envelope.error,diagnosis:envelope.diagnosis||null,upstreamStatus:envelope.upstreamStatus||null,
          retryAt:envelope.retryAt||null},upstream.status);
      }
      try {await persistDataset(env.DB,id,envelope,'cloud-readthrough');}
      catch(error) {
        const code=String(error.message).startsWith('dataset_')?error.message:'dataset_storage_write_failed';
        await datasetFailure(env.DB,id,502,code);
        return reply({ok:false,id,error:code},502);
      }
    }
    const result=await readDataset(env.DB,id,{limit:Number(limit),knownAt:new Date(refresh?Date.now():Date.parse(knownAt)).toISOString()});
    return reply({...result,storage:{persisted:result.ok,mode:refresh?'refresh-and-readback':'read-only'}},result.ok?200:404);
  } catch(_) {return reply({ok:false,id,error:'dataset_storage_unavailable'},503);}
}
