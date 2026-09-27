/** Local SQLite recovery for actual BTC liquidation events, never market heartbeats. */
export class LiquidationRecovery {
  constructor(storage) {
    if (!storage?.sql) throw new Error("LiquidationCollector requires its existing SQLite storage");
    this.storage = storage;
    this.sql = storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS liquidation_recovery_buckets (
      bucket_key TEXT PRIMARY KEY, bucket_start INTEGER NOT NULL, payload TEXT NOT NULL,
      version INTEGER NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS liquidation_recovery_events (
      event_id TEXT PRIMARY KEY, bucket_start INTEGER NOT NULL)`);
    this.sql.exec("CREATE INDEX IF NOT EXISTS liquidation_recovery_event_time ON liquidation_recovery_events(bucket_start)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS liquidation_recovery_bucket_time ON liquidation_recovery_buckets(bucket_start)");
  }

  pending() {
    return this.sql.exec("SELECT bucket_key,payload,version FROM liquidation_recovery_buckets WHERE version > acknowledged")
      .toArray().map(row => [row.bucket_key, { ...JSON.parse(row.payload), recoveryVersion: row.version }]);
  }

  ingest(key, eventId, bucketStart, build) {
    let result = null;
    this.storage.transactionSync(() => {
      if (this.sql.exec("SELECT event_id FROM liquidation_recovery_events WHERE event_id=?", eventId).toArray().length) return;
      const old = this.sql.exec("SELECT payload,version FROM liquidation_recovery_buckets WHERE bucket_key=?", key).toArray()[0];
      const bucket = build(old ? JSON.parse(old.payload) : null);
      const version = (Number(old?.version) || 0) + 1;
      this.sql.exec("INSERT INTO liquidation_recovery_events(event_id,bucket_start) VALUES (?,?)", eventId, bucketStart);
      this.sql.exec(`INSERT INTO liquidation_recovery_buckets(bucket_key,bucket_start,payload,version)
        VALUES (?,?,?,?) ON CONFLICT(bucket_key) DO UPDATE SET payload=excluded.payload,version=excluded.version`,
      key, bucketStart, JSON.stringify(bucket), version);
      result = { ...bucket, recoveryVersion: version };
    });
    return result;
  }

  acknowledge(key, version) {
    // A response to version N must not confirm an event received during D1 I/O (N+1).
    this.sql.exec(`UPDATE liquidation_recovery_buckets SET acknowledged=MAX(acknowledged,?)
      WHERE bucket_key=? AND version>=?`, version, key, version);
  }

  seed(key, merge) {
    let result;
    this.storage.transactionSync(() => {
      const old = this.sql.exec("SELECT payload,version FROM liquidation_recovery_buckets WHERE bucket_key=?", key).toArray()[0];
      if (!old) return;
      const current = JSON.parse(old.payload);
      if (current.d1BaselineLoaded) { result = { ...current, recoveryVersion: old.version }; return; }
      const bucket = { ...merge(current), d1BaselineLoaded: true };
      const version = Number(old.version) + 1;
      this.sql.exec("UPDATE liquidation_recovery_buckets SET payload=?,version=? WHERE bucket_key=?", JSON.stringify(bucket), version, key);
      result = { ...bucket, recoveryVersion: version };
    });
    return result;
  }

  prune(cutoff, limit = 500) {
    // Retain full acknowledged buckets for late arrivals over the same public 30-day window.
    this.storage.transactionSync(() => {
      this.sql.exec(`DELETE FROM liquidation_recovery_events WHERE event_id IN
        (SELECT event_id FROM liquidation_recovery_events WHERE bucket_start<? ORDER BY bucket_start LIMIT ?)`, cutoff, limit);
      this.sql.exec(`DELETE FROM liquidation_recovery_buckets WHERE bucket_key IN
        (SELECT bucket_key FROM liquidation_recovery_buckets WHERE bucket_start<? AND version=acknowledged
        ORDER BY bucket_start LIMIT ?)`, cutoff, limit);
    });
  }
}
