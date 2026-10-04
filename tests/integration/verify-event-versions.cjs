/** Offline regression checks for the actual Yuqing fact module and its D1 SQL. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');

const root = path.join(__dirname, '../..');

// D1-shaped API backed by SQLite: production SQL is parsed and executed unchanged.
// This verifies the local SQL contract, not the Cloudflare runtime or deployed DB.
class FakeD1 {
  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.sqlite.exec(fs.readFileSync(path.join(root, 'cloudflare/migrations/yuqing/0001_init.sql'), 'utf8'));
    this.failRead = false;
    this.failWrite = false;
  }
  prepare(sql) {
    const db = this;
    const sqliteStatement = this.sqlite.prepare(sql);
    let values = [];
    const api = {
      bind(...next) { values = next; return api; },
      async first() {
        if (db.failRead && /FROM yuqing_items/.test(sql)) throw new Error('fixture D1 read failed');
        return sqliteStatement.get(...values) || null;
      },
      async all() { return { success: true, results: sqliteStatement.all(...values) }; },
      async run() {
        if (db.failWrite && /INSERT.*yuqing_items/.test(sql)) throw new Error('fixture D1 write failed');
        const result = sqliteStatement.run(...values);
        return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
      },
    };
    return api;
  }
  items() { return this.sqlite.prepare('SELECT * FROM yuqing_items ORDER BY fetched_at, id').all(); }
  close() { this.sqlite.close(); }
}

function row(extra = {}) {
  return {
    id: 'rss:story', source: 'CoinDesk', sourceType: 'rss', category: 'Crypto',
    title: 'BTC announcement', summary: 'First observed statement',
    url: 'https://www.example.com/story', publishedAt: 1700000000000,
    fetchedAt: 1700000001000, severity: 'mid', confidence: 0.65,
    rawJson: JSON.stringify({ original: 'first raw observation' }), ...extra,
  };
}

function rssItem({ title = 'BTC announcement', url = 'https://www.example.com/story', description = 'First observed statement', pub = '' } = {}) {
  return `<rss><channel><item><title>${title}</title><link>${url}</link><description><![CDATA[${description}]]></description>${pub ? `<pubDate>${pub}</pubDate>` : ''}</item></channel></rss>`;
}

async function withRss(xml, work) {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), 'https://www.coindesk.com/arc/outboundfeeds/rss/');
    return new Response(xml, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  };
  try { return await work(); } finally { globalThis.fetch = priorFetch; }
}

async function main() {
  const facts = await import(pathToFileURL(path.join(root, 'cloudflare/yuqing/yuqing-facts.js')).href);
  let pass = 0;
  let fail = 0;
  async function check(name, work) {
    try { await work(); pass++; console.log(`PASS ${name}`); }
    catch (error) { fail++; console.error(`FAIL ${name}: ${error.message}`); }
  }
  async function withDb(work) {
    const db = new FakeD1();
    try { return await work(db); } finally { db.close(); }
  }

  await check('unchanged content across batches skips; fetchedAt alone is not a revision', () => withDb(async (db) => {
    const first = await facts.insertItemsBatch(db, [row()]);
    assert.equal(first.changes, 1);
    const original = JSON.stringify(db.items()[0]);
    const again = await facts.insertItemsBatch(db, [row({ fetchedAt: 1700000002000 })]);
    assert.equal(again.changes, 0);
    assert.deepEqual(again.errors, []);
    assert.equal(db.items().length, 1);
    assert.equal(JSON.stringify(db.items()[0]), original);
  }));

  await check('changed article inserts version 2 without overwriting original row/raw data', () => withDb(async (db) => {
    await facts.insertItemsBatch(db, [row()]);
    const original = JSON.stringify(db.items()[0]);
    const changed = row({ id: 'rss:changed-title', title: 'BTC announcement corrected', summary: 'Corrected statement', fetchedAt: 1700000002000, rawJson: JSON.stringify({ original: 'corrected raw observation' }) });
    const out = await facts.insertItemsBatch(db, [changed]);
    assert.equal(out.changes, 1);
    assert.equal(db.items().length, 2);
    assert.equal(JSON.stringify(db.items()[0]), original);
    const raw = JSON.parse(db.items()[1].raw_json);
    assert.equal(raw.version, 2);
    assert.equal(raw.previousId, 'rss:story');
    assert.equal(raw.original, 'corrected raw observation');
    assert.equal(raw.receivedAt, changed.fetchedAt);
  }));

  await check('unknown RSS publication time remains null in parser and D1', () => withDb(async (db) => {
    for (const pub of ['', 'not a publication date']) {
      const items = await withRss(rssItem({ pub }), () => facts.fetchCoinDeskRss());
      assert.equal(items[0].publishedAt, null);
      const out = await facts.insertItemsBatch(db, [items[0]]);
      assert.deepEqual(out.errors, []);
    }
    assert(db.items().every((item) => item.published_at === null));
    assert(db.items().every((item) => JSON.parse(item.raw_json).publishedAt === null));
  }));

  await check('D1 read errors are returned with row identity', () => withDb(async (db) => {
    db.failRead = true;
    const out = await facts.insertItemsBatch(db, [row()]);
    assert.equal(out.changes, 0);
    assert.deepEqual(out.errors, [{ id: 'rss:story', message: 'fixture D1 read failed' }]);
  }));

  await check('D1 write errors are returned with row identity', () => withDb(async (db) => {
    db.failWrite = true;
    const out = await facts.insertItemsBatch(db, [row()]);
    assert.equal(out.changes, 0);
    assert.deepEqual(out.errors, [{ id: 'rss:story', message: 'fixture D1 write failed' }]);
  }));

  await check('ingest return exposes item insertion errors', () => withDb(async (db) => {
    db.failWrite = true;
    const out = await withRss(rssItem(), () => facts.ingestFactPool({ YUQING_DB: db }, {
      aggregateSources: async () => ({ sources: { fixture: true } }),
    }));
    assert.equal(out.insertedRows, 0);
    assert(out.ingestErrors.some((error) => error.step === 'item_version_insert' && error.message === 'fixture D1 write failed'));
  }));

  await check('canonical URL identity survives tracking/hash changes between RSS batches', () => withDb(async (db) => {
    const first = await withRss(rssItem({ url: 'https://www.example.com/story?utm_source=first#intro' }), () => facts.fetchCoinDeskRss());
    const second = await withRss(rssItem({ url: 'https://www.example.com/story?utm_source=second#body' }), () => facts.fetchCoinDeskRss());
    assert.equal(facts.eventDedupeKey(first[0]), facts.eventDedupeKey(second[0]));
    assert.notEqual(first[0].id, second[0].id);
    await facts.insertItemsBatch(db, first);
    const out = await facts.insertItemsBatch(db, second);
    assert.equal(out.changes, 0, 'same canonical story/content should not create a fresh version 1');
    assert.equal(db.items().length, 1);
  }));

  await check('reappearing prior content records a new observation in the version chain', () => withDb(async (db) => {
    for (const [index, summary] of ['A', 'B', 'C'].entries()) {
      const out = await facts.insertItemsBatch(db, [row({ summary, fetchedAt: 1700000010000 + index * 1000 })]);
      assert.equal(out.changes, 1);
    }
    const prior = db.items().at(-1);
    const out = await facts.insertItemsBatch(db, [row({ summary: 'B', fetchedAt: 1700000014000 })]);
    assert.equal(out.changes, 1, 'B after C is a new correction observation, not an unchanged duplicate');
    assert.equal(db.items().length, 4);
    const latest = db.items().at(-1);
    assert.equal(JSON.parse(latest.raw_json).version, 4);
    assert.equal(JSON.parse(latest.raw_json).previousId, prior.id);
  }));

  await check('unchanged legacy rows without contentSha256 are not reinserted as corrections', () => withDb(async (db) => {
    const old = row();
    db.sqlite.prepare('INSERT INTO yuqing_items (id,source,source_type,category,title,summary,url,published_at,fetched_at,raw_json) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(old.id, old.source, old.sourceType, old.category, old.title, old.summary, old.url, old.publishedAt, old.fetchedAt, old.rawJson);
    const out = await facts.insertItemsBatch(db, [row({ fetchedAt: 1700000002000 })]);
    assert.equal(out.changes, 0, 'existing legacy content is byte-identical in stored columns');
    assert.equal(db.items().length, 1);
  }));

  await check('full RSS source content beyond summary truncation is retained and versioned', () => withDb(async (db) => {
    const prefix = 'x'.repeat(800);
    const first = await withRss(rssItem({ description: prefix + ' ORIGINAL' }), () => facts.fetchCoinDeskRss());
    const second = await withRss(rssItem({ description: prefix + ' CORRECTED' }), () => facts.fetchCoinDeskRss());
    await facts.insertItemsBatch(db, first);
    const out = await facts.insertItemsBatch(db, second);
    assert.equal(out.changes, 1, 'changed original text after character 800 must not disappear');
    assert(db.items()[0].raw_json.includes('ORIGINAL'), 'original full content must be persisted');
    assert(db.items()[1].raw_json.includes('CORRECTED'), 'corrected full content must be persisted');
  }));

  console.log(JSON.stringify({ suite: 'event-versions', pass, fail, scope: 'offline actual module + in-memory SQLite D1-shaped API; no network or deployed D1' }));
  if (fail) process.exitCode = 1;
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
