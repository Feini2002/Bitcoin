// D1 rows are limited to 2 MB. Chunk native payloads without changing their meaning.
const CHUNK_CHARS = 180000;
const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;

export function financeChannelKey(provider, operation, parameters) {
  const query = new URLSearchParams();
  for (const key of Object.keys(parameters).sort()) query.set(key, parameters[key]);
  return `${provider}/${operation}?${query}`;
}

export async function readFinanceSnapshot(db, key) {
  const [metadata, parts] = await db.batch([
    db.prepare('SELECT * FROM finance_channel_state WHERE channel_key = ?').bind(key),
    db.prepare(`SELECT c.part, c.content FROM finance_snapshot_chunks c
      JOIN finance_channel_state s ON s.channel_key = c.channel_key AND s.snapshot_id = c.snapshot_id
      WHERE c.channel_key = ? ORDER BY c.part`).bind(key),
  ]);
  const state = metadata.results[0] || null;
  if (!state?.snapshot_id) return {state, envelope:null};
  if (parts.results.length !== state.chunk_count || parts.results.some((row, index) => row.part !== index)) throw new Error('incomplete_snapshot');
  return {state, envelope:JSON.parse(parts.results.map(row => row.content).join(''))};
}

export async function persistFinanceSnapshot(db, key, envelope, attemptedAt) {
  const raw = JSON.stringify(envelope);
  const bytes = new TextEncoder().encode(raw).byteLength;
  if (bytes > MAX_SNAPSHOT_BYTES) throw new Error('snapshot_too_large');
  const chunks = [];
  for (let start = 0; start < raw.length;) {
    let end = Math.min(start + CHUNK_CHARS, raw.length);
    if (end < raw.length && /[\uD800-\uDBFF]/.test(raw[end - 1])) end--;
    chunks.push(raw.slice(start, end));
    start = end;
  }
  const id = crypto.randomUUID();
  const storedAt = new Date().toISOString();
  const statements = chunks.map((content, part) => db.prepare(
    'INSERT INTO finance_snapshot_chunks(channel_key, snapshot_id, part, content) VALUES (?, ?, ?, ?)'
  ).bind(key, id, part, content));
  statements.push(db.prepare(`INSERT INTO finance_channel_state
    (channel_key, provider, operation, parameters_json, attempted_at, last_http_status,
     snapshot_id, received_at, stored_at, payload_bytes, chunk_count)
    VALUES (?, ?, ?, ?, ?, 200, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_key) DO UPDATE SET
      attempted_at = excluded.attempted_at, last_http_status = 200, last_error = NULL,
      upstream_status = NULL, retry_at = NULL, snapshot_id = excluded.snapshot_id,
      received_at = excluded.received_at, stored_at = excluded.stored_at,
      payload_bytes = excluded.payload_bytes, chunk_count = excluded.chunk_count
    WHERE finance_channel_state.received_at IS NULL OR excluded.received_at > finance_channel_state.received_at
  `).bind(key, envelope.provider, envelope.operation, JSON.stringify(envelope.parameters), attemptedAt,
    id, envelope.receivedAt, storedAt, bytes, chunks.length));
  statements.push(db.prepare(`DELETE FROM finance_snapshot_chunks WHERE channel_key = ?
    AND snapshot_id <> (SELECT snapshot_id FROM finance_channel_state WHERE channel_key = ?)`
  ).bind(key, key));
  await db.batch(statements);
}

export async function persistFinanceFailure(db, key, provider, operation, parameters, body, status, attemptedAt, retryAt) {
  await db.prepare(`INSERT INTO finance_channel_state
    (channel_key, provider, operation, parameters_json, attempted_at, last_http_status, last_error, upstream_status, retry_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(channel_key) DO UPDATE SET attempted_at = excluded.attempted_at,
      last_http_status = excluded.last_http_status, last_error = excluded.last_error,
      upstream_status = excluded.upstream_status, retry_at = excluded.retry_at
    WHERE excluded.attempted_at >= finance_channel_state.attempted_at
  `).bind(key, provider, operation, JSON.stringify(parameters), attemptedAt, status,
    body.error, body.upstreamStatus || null, retryAt).run();
}

export async function financeStorageStatus(db) {
  const [summary, channels] = await db.batch([
    db.prepare(`SELECT COUNT(*) AS channels, COUNT(snapshot_id) AS stored,
      COALESCE(SUM(payload_bytes), 0) AS payloadBytes FROM finance_channel_state`),
    db.prepare(`SELECT channel_key, provider, operation, parameters_json, attempted_at,
      last_http_status, last_error, upstream_status, retry_at, received_at, stored_at,
      payload_bytes, chunk_count FROM finance_channel_state ORDER BY provider, operation, channel_key LIMIT 500`),
  ]);
  return {...summary.results[0], entries:channels.results, truncated:summary.results[0].channels > 500};
}
