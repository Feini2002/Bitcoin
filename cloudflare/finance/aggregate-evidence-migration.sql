-- Additive, idempotent migration. No backfill: pre-installation knowledge is unknown.
-- Triggers are atomic with the existing aggregate writes. Network receipt time
-- remains NULL; stored_at is the statement clock, not a confirmed commit or
-- event publication time. Readers must not claim a commit acknowledgement.
CREATE TABLE IF NOT EXISTS desk_aggregate_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL, symbol TEXT NOT NULL, item_key TEXT NOT NULL,
  observed_at INTEGER NOT NULL, received_at TEXT,
  stored_at TEXT NOT NULL, source_host TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0, payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_desk_aggregate_cutoff
  ON desk_aggregate_versions(scope,symbol,observed_at DESC,item_key,stored_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_desk_aggregate_receipt
  ON desk_aggregate_versions(scope,symbol,stored_at DESC,id DESC);

CREATE TRIGGER IF NOT EXISTS desk_footprint_insert AFTER INSERT ON footprint_bars BEGIN
  INSERT INTO desk_aggregate_versions(scope,symbol,item_key,observed_at,stored_at,source_host,payload_json)
  VALUES('orderflow',NEW.symbol,NEW.interval||':'||NEW.t,NEW.t,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'fstream.binance.com',
    json_object('t',NEW.t,'o',NEW.o,'h',NEW.h,'l',NEW.l,'c',NEW.c,'buy_vol',NEW.buy_vol,'sell_vol',NEW.sell_vol,
      'delta',NEW.delta,'volume',NEW.volume,'poc_price',NEW.poc_price,'levels_json',NEW.levels_json,
      'last_trade_id',NEW.last_trade_id,'updated_at',NEW.updated_at));
END;
CREATE TRIGGER IF NOT EXISTS desk_footprint_update AFTER UPDATE ON footprint_bars
WHEN NEW.o IS NOT OLD.o OR NEW.h IS NOT OLD.h OR NEW.l IS NOT OLD.l OR NEW.c IS NOT OLD.c
 OR NEW.buy_vol IS NOT OLD.buy_vol OR NEW.sell_vol IS NOT OLD.sell_vol OR NEW.delta IS NOT OLD.delta
 OR NEW.volume IS NOT OLD.volume OR NEW.poc_price IS NOT OLD.poc_price OR NEW.levels_json IS NOT OLD.levels_json
 OR NEW.last_trade_id IS NOT OLD.last_trade_id BEGIN
  INSERT INTO desk_aggregate_versions(scope,symbol,item_key,observed_at,stored_at,source_host,payload_json)
  VALUES('orderflow',NEW.symbol,NEW.interval||':'||NEW.t,NEW.t,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'fstream.binance.com',
    json_object('t',NEW.t,'o',NEW.o,'h',NEW.h,'l',NEW.l,'c',NEW.c,'buy_vol',NEW.buy_vol,'sell_vol',NEW.sell_vol,
      'delta',NEW.delta,'volume',NEW.volume,'poc_price',NEW.poc_price,'levels_json',NEW.levels_json,
      'last_trade_id',NEW.last_trade_id,'updated_at',NEW.updated_at));
END;
CREATE TRIGGER IF NOT EXISTS desk_footprint_delete AFTER DELETE ON footprint_bars BEGIN
  INSERT INTO desk_aggregate_versions(scope,symbol,item_key,observed_at,stored_at,source_host,deleted,payload_json)
  VALUES('orderflow',OLD.symbol,OLD.interval||':'||OLD.t,OLD.t,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'fstream.binance.com',1,'{}');
END;

CREATE TRIGGER IF NOT EXISTS desk_liquidation_insert AFTER INSERT ON liquidation_5m_buckets BEGIN
  INSERT INTO desk_aggregate_versions(scope,symbol,item_key,observed_at,stored_at,source_host,payload_json)
  VALUES('heatmap',NEW.symbol,NEW.exchange||':'||NEW.bucket_start,NEW.bucket_start,strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    CASE WHEN NEW.exchange='binance' THEN 'fstream.binance.com' WHEN NEW.exchange='bybit' THEN 'stream.bybit.com' ELSE 'unknown' END,
    json_object('symbol',NEW.symbol,'exchange',NEW.exchange,'bucket_start',NEW.bucket_start,'long_notional',NEW.long_notional,
      'short_notional',NEW.short_notional,'long_count',NEW.long_count,'short_count',NEW.short_count,'max_notional',NEW.max_notional,
      'max_side',NEW.max_side,'min_price',NEW.min_price,'max_price',NEW.max_price,'vwap_price',NEW.vwap_price,'updated_at',NEW.updated_at));
END;
CREATE TRIGGER IF NOT EXISTS desk_liquidation_update AFTER UPDATE ON liquidation_5m_buckets
WHEN NEW.long_notional IS NOT OLD.long_notional OR NEW.short_notional IS NOT OLD.short_notional
 OR NEW.long_count IS NOT OLD.long_count OR NEW.short_count IS NOT OLD.short_count OR NEW.max_notional IS NOT OLD.max_notional
 OR NEW.max_side IS NOT OLD.max_side OR NEW.min_price IS NOT OLD.min_price OR NEW.max_price IS NOT OLD.max_price
 OR NEW.vwap_price IS NOT OLD.vwap_price BEGIN
  INSERT INTO desk_aggregate_versions(scope,symbol,item_key,observed_at,stored_at,source_host,payload_json)
  VALUES('heatmap',NEW.symbol,NEW.exchange||':'||NEW.bucket_start,NEW.bucket_start,strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    CASE WHEN NEW.exchange='binance' THEN 'fstream.binance.com' WHEN NEW.exchange='bybit' THEN 'stream.bybit.com' ELSE 'unknown' END,
    json_object('symbol',NEW.symbol,'exchange',NEW.exchange,'bucket_start',NEW.bucket_start,'long_notional',NEW.long_notional,
      'short_notional',NEW.short_notional,'long_count',NEW.long_count,'short_count',NEW.short_count,'max_notional',NEW.max_notional,
      'max_side',NEW.max_side,'min_price',NEW.min_price,'max_price',NEW.max_price,'vwap_price',NEW.vwap_price,'updated_at',NEW.updated_at));
END;
CREATE TRIGGER IF NOT EXISTS desk_liquidation_delete AFTER DELETE ON liquidation_5m_buckets BEGIN
  INSERT INTO desk_aggregate_versions(scope,symbol,item_key,observed_at,stored_at,source_host,deleted,payload_json)
  VALUES('heatmap',OLD.symbol,OLD.exchange||':'||OLD.bucket_start,OLD.bucket_start,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'unknown',1,'{}');
END;

CREATE TRIGGER IF NOT EXISTS desk_footprint_status_insert AFTER INSERT ON footprint_sync_status BEGIN
  INSERT INTO desk_aggregate_versions(scope,symbol,item_key,observed_at,stored_at,source_host,payload_json)
  VALUES('orderflow-status',NEW.symbol,'collector',NEW.last_trade_time,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'fstream.binance.com',
    json_object('last_run',NEW.last_run,'last_trade_id',NEW.last_trade_id,'last_trade_time',NEW.last_trade_time,
      'last_count',NEW.last_count,'last_ok',NEW.last_ok,'last_error',NEW.last_error));
END;
CREATE TRIGGER IF NOT EXISTS desk_footprint_status_update AFTER UPDATE ON footprint_sync_status BEGIN
  INSERT INTO desk_aggregate_versions(scope,symbol,item_key,observed_at,stored_at,source_host,payload_json)
  VALUES('orderflow-status',NEW.symbol,'collector',NEW.last_trade_time,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'fstream.binance.com',
    json_object('last_run',NEW.last_run,'last_trade_id',NEW.last_trade_id,'last_trade_time',NEW.last_trade_time,
      'last_count',NEW.last_count,'last_ok',NEW.last_ok,'last_error',NEW.last_error));
END;
