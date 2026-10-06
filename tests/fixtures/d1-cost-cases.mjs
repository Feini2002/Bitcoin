import { canonicalHistoryStatements, rawKlineHistoryStatements, historyBaselineStatement } from '../../cloudflare/finance/dataset-store.mjs';
import { persistKlineCommit } from '../../cloudflare/finance/kline-commit.mjs';
export const ID='binance-perp-klines-5m';
export const HEAD=1791200000000, STEP=300000;
export function fixtureQueries(H,V) {
  const values={open:100,high:120,low:90,close:100,baseVolume:2,quoteVolume:200,trades:4,takerBuyBase:1,takerBuyQuote:100,
    closed:true,windowEnded:true,finality:'exchange_closed',closureBasis:'fixture'};
  return [
    ...['finance_dataset_observations','finance_dataset_state','klines','sync_status','desk_history_state','_desk_hist_bump'].map(table=>({sql:`DELETE FROM ${table}`,params:[]})),
    {sql:`WITH RECURSIVE keys(n) AS (VALUES(0) UNION ALL SELECT n+1 FROM keys WHERE n+1<?1),
      versions(v) AS (VALUES(0) UNION ALL SELECT v+1 FROM versions WHERE v+1<?2)
      INSERT INTO finance_dataset_observations(dataset_id,observation_key,observed_at,time_precision,received_at,stored_at,source_host,ingestion_mode,value_json)
      SELECT ?3,CAST(?4-(?1-1-n)*?5 AS TEXT),strftime('%Y-%m-%dT%H:%M:%fZ',(?4-(?1-1-n)*?5)/1000.0,'unixepoch'),'millisecond',
        strftime('%Y-%m-%dT%H:%M:%fZ',(?4+?5+v*1000)/1000.0,'unixepoch'),strftime('%Y-%m-%dT%H:%M:%fZ',(?4+?5+v*1000)/1000.0,'unixepoch'),
        'fapi.binance.com','cloud-readthrough',?6 FROM keys CROSS JOIN versions`,params:[H,V,ID,HEAD,STEP,JSON.stringify(values)]},
    {sql:`WITH RECURSIVE keys(n) AS (VALUES(0) UNION ALL SELECT n+1 FROM keys WHERE n+1<?1)
      INSERT INTO klines SELECT 'BTCUSDT','5m',?2-(?1-1-n)*?3,100,120,90,100,2 FROM keys`,params:[H,HEAD,STEP]},
    {sql:"INSERT INTO desk_history_state VALUES ('BTCUSDT','5m',?1,7)",params:[HEAD]},
    {sql:"INSERT INTO _desk_hist_bump VALUES ('BTCUSDT','5m',0)",params:[]},
  ];
}
export async function runCostCase(db,{H,V,originals}) {
  await db.batch(fixtureQueries(H,V).map(q=>db.prepare(q.sql).bind(...q.params)));
  const row={key:String(HEAD),observedAt:new Date(HEAD).toISOString(),values:{close:100}};
  const samples=[];
  for(const [name,newQuery] of Object.entries({
    canonical:canonicalHistoryStatements(ID,[row],'fapi.binance.com','cloud-readthrough').after[0],
    raw:rawKlineHistoryStatements('BTCUSDT','5m',[[HEAD,100,120,90,100,2]]).after[0],
    baseline:historyBaselineStatement('BTCUSDT','5m',ID),
  })) {
    for(const [version,query] of [['old',originals[name]],['new',newQuery]]) {
      const [result]=await db.batch([db.prepare(query.sql).bind(...query.params)]);
      samples.push({name,version,query,meta:result.meta || null});
    }
  }
  const before=db.batches?.length;
  const costs=[];
  await persistKlineCommit({DB:db},'BTCUSDT','5m',[[HEAD,100,120,90,101,2,HEAD+STEP-1,200,4,1,100]],
    'fstream.binance.com','cloud-ws',{closed:true,receivedAt:new Date(HEAD+STEP+200000).toISOString(),onCost:r=>costs.push(r)});
  const batches=before===undefined?null:db.batches.slice(before);
  return {H,V,samples,costs,batches};
}
