export const KLINE_STEPS = { '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000, '3d': 259200000, '1w': 604800000 };

export function klineOpenAt(interval, time) {
  const step = KLINE_STEPS[interval];
  const anchor = interval === '1w' ? 4 * 86400000 : interval === '3d' ? 86400000 : 0;
  return Math.floor((time - anchor) / step) * step + anchor;
}

/** Seven durable recovery checkpoints, not a write for every market message. */
export class KlineRecovery {
  constructor(storage, intervals) {
    this.storage = storage;
    this.sql = storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS kline_recovery (
      interval TEXT PRIMARY KEY, from_t INTEGER NOT NULL DEFAULT 0,
      generation INTEGER NOT NULL DEFAULT 0, needed INTEGER NOT NULL DEFAULT 1,
      full INTEGER NOT NULL DEFAULT 0, gap_open INTEGER NOT NULL DEFAULT 1)`);
    storage.transactionSync(() => {
      for (const interval of intervals) this.sql.exec(`INSERT INTO kline_recovery(interval,generation)
        VALUES (?,1) ON CONFLICT(interval) DO UPDATE SET generation=generation+1,needed=1,gap_open=1`, interval);
    });
    this.rows = new Map(this.sql.exec('SELECT * FROM kline_recovery').toArray().map(row => [row.interval, row]));
  }

  save(row) {
    this.sql.exec(`UPDATE kline_recovery SET from_t=?,generation=?,needed=?,full=?,gap_open=? WHERE interval=?`,
      row.from_t, row.generation, row.needed, row.full, row.gap_open, row.interval);
    this.rows.set(row.interval, row);
    return row;
  }

  initialize(interval, meta) {
    const row = this.rows.get(interval);
    if (row.from_t || row.full) return row;
    return this.save({ ...row, from_t: Number(meta.maxT) || 0, full: meta.hasRows ? 0 : 1 });
  }

  beginGap(interval, cursor) {
    const row = this.rows.get(interval);
    // A successful reconciliation may checkpoint part of an ongoing outage.
    // The next missing live window is a new obligation even without WS recovery.
    if (row.gap_open && row.needed) return row;
    const from = Number(cursor) || row.from_t;
    return this.save({ ...row, needed: 1, gap_open: 1, generation: row.generation + 1,
      from_t: row.needed && row.from_t ? Math.min(row.from_t, from || row.from_t) : from });
  }

  endGap(interval) {
    const row = this.rows.get(interval);
    return row.gap_open ? this.save({ ...row, gap_open: 0 }) : row;
  }

  acknowledge(interval, generation, coveredThrough) {
    const row = this.rows.get(interval);
    if (!row || row.generation !== Number(generation) || !Number.isFinite(coveredThrough) || coveredThrough < row.from_t) return false;
    this.save({ ...row, needed: 0, full: 0, from_t: coveredThrough });
    return true;
  }
}
