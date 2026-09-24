/**
 * Yuqing Worker：事实池（D1 + 定时抓取）辅助模块。
 * 由同级 `yuqing-worker.js` 引用；勿单独作为主入口部署。
 *
 * 事件一览「今日头条 / 动态速览 / AI 情报站」的既有报告内容，
 * 此处 ingest **不再写入 Finnhub 新闻与经济日历**（Finnhub 仍可由 Worker 用于行情 quote）。
 */

const FINNHUB_ORIGIN = "https://finnhub.io";
const FETCH_TIMEOUT_SOURCES_MS = 12_000;

const COINDESK_RSS = "https://www.coindesk.com/arc/outboundfeeds/rss/";

async function fetchWithTimeout(url, opts, timeoutMs = FETCH_TIMEOUT_SOURCES_MS) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...(opts || {}), signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

export function d1Bound(env) {
  return !!(env && env.YUQING_DB && typeof env.YUQING_DB.prepare === "function");
}

export function documentContentDigest(payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload || {});
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 33 + text.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

export function mergeDocumentVersion(prev, next) {
  if (!prev) return { action: "insert", version: 1, contentDigest: next && next.contentDigest };
  if (prev.contentDigest === (next && next.contentDigest)) return { action: "reuse", version: prev.version || 1, contentDigest: prev.contentDigest };
  return { action: "revise", version: (prev.version || 1) + 1, previousDigest: prev.contentDigest, contentDigest: next.contentDigest };
}

export function eventDedupeKey(item) {
  const title = String((item && item.title) || "").trim().toLowerCase().replace(/\s+/g, " ");
  const source = String((item && item.source) || "");
  const published = item && (item.publishedAt || item.officialAt || "");
  return `${source}|${title}|${published}`;
}

async function sha256Short(input) {
  const buf = new TextEncoder().encode(input);
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 26);
}

function xmlText(el, tag) {
  const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`, "i");
  const m = re.exec(el);
  if (!m) return "";
  let t = m[1].trim();
  if (t.startsWith("<![CDATA[")) {
    t = t.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
  }
  return t.replace(/<[^>]+>/g, "").trim();
}

async function parseRssItems(xml, source, category) {
  const items = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const title = xmlText(block, "title");
    const link = xmlText(block, "link");
    const pub = xmlText(block, "pubDate");
    if (!title) continue;
    let publishedAt = Date.now();
    if (pub) {
      const t = Date.parse(pub);
      if (!Number.isNaN(t)) publishedAt = t;
    }
    const url = link || "";
    const hid = await sha256Short(`rss:${source}:${url}:${title}:${publishedAt}`);
    items.push({
      id: `rss:${hid}`,
      source,
      sourceType: "rss",
      category,
      title: title.slice(0, 500),
      summary: "",
      url: url || null,
      publishedAt,
      fetchedAt: Date.now(),
      severity: "mid",
      confidence: 0.65,
      rawJson: JSON.stringify({ source, title, link: url, pub }),
    });
  }
  return items;
}

export async function fetchCoinDeskRss() {
  const res = await fetchWithTimeout(COINDESK_RSS, {
    headers: { Accept: "application/rss+xml, application/xml, text/xml, */*" },
  });
  if (!res.ok) throw new Error(`CoinDesk RSS HTTP ${res.status}`);
  const xml = await res.text();
  return parseRssItems(xml, "CoinDesk", "Crypto");
}

export async function fetchFinnhubEconomicCalendar(env) {
  const token = env && env.FINNHUB_API_KEY;
  if (!token) return [];
  const now = new Date();
  const to = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const url = `${FINNHUB_ORIGIN}/api/v1/calendar/economic?from=${fmt(now)}&to=${fmt(to)}&token=${encodeURIComponent(token)}`;
  const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Finnhub economic HTTP ${res.status}`);
  const j = await res.json().catch(() => null);
  const arr = (j && j.economicCalendar) || (j && j.data) || [];
  const list = Array.isArray(arr) ? arr : [];
  const out = [];
  for (const row of list) {
    const title = String(row.event || row.indicator || row.name || "").trim();
    if (!title) continue;
    const country = row.country || row.region || "";
    const day = row.date || row.time || row.releaseTime || "";
    const summary = [country, row.actual != null ? `实际 ${row.actual}` : "", row.estimate != null ? `预期 ${row.estimate}` : ""]
      .filter(Boolean)
      .join(" · ");
    const publishedAt = day ? Date.parse(String(day)) || Date.now() : Date.now();
    const url = row.url || row.link || null;
    const raw = JSON.stringify(row);
    const hid = await sha256Short(`macro|${title}|${day}|${country}`);
    out.push({
      id: `macro:${hid}`,
      source: "Finnhub",
      sourceType: "calendar",
      category: "Macro",
      title: title.slice(0, 500),
      summary: summary.slice(0, 800),
      url,
      publishedAt,
      fetchedAt: Date.now(),
      severity: "mid",
      confidence: 0.55,
      rawJson: raw,
    });
  }
  return out;
}

export async function fetchFinnhubMarketNews(env, category) {
  const token = env && env.FINNHUB_API_KEY;
  if (!token) return [];
  const url = `${FINNHUB_ORIGIN}/api/v1/news?category=${encodeURIComponent(category)}&token=${encodeURIComponent(token)}`;
  const res = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Finnhub news(${category}) HTTP ${res.status}`);
  const arr = await res.json().catch(() => []);
  const out = [];
  if (!Array.isArray(arr)) return out;
  for (const n of arr.slice(0, 25)) {
    const headline = String(n.headline || n.title || "").trim();
    if (!headline) continue;
    const urlArticle = String(n.url || n.link || "").trim() || null;
    let publishedAt =
      typeof n.datetime === "number" ? n.datetime * 1000 : n.datetime ? Number(n.datetime) : Date.now();
    if (!Number.isFinite(publishedAt)) publishedAt = Date.now();
    const src = String(n.source || "").trim() || "Finnhub";
    const hid = await sha256Short(`news:${category}:${urlArticle || headline}:${publishedAt}`);
    const catUpper = category === "crypto" ? "Crypto" : "Market";
    out.push({
      id: `${catUpper.toLowerCase()}:${hid}`,
      source: src,
      sourceType: "finnhub_news",
      category: catUpper,
      title: headline.slice(0, 500),
      summary: String(n.summary || "").slice(0, 800),
      url: urlArticle,
      publishedAt,
      fetchedAt: Date.now(),
      severity: "mid",
      confidence: 0.5,
      rawJson: JSON.stringify(n),
    });
  }
  return out;
}

/** 简单关键词归入 AI：用于 AI 专区事实池（非搜索）。 */
const AI_TERMS =
  /\b(OpenAI|ChatGPT|GPT|Anthropic|Claude|Gemini|Google AI|DeepMind|Meta Llama|Mistral|xAI|Grok|Hugging\s*Face|Cursor|Perplexity)\b/i;

export function filterAiFactsFromNewsItems(items) {
  const out = [];
  for (const it of items || []) {
    const t = `${it.title || ""} ${it.summary || ""}`;
    if (AI_TERMS.test(t)) out.push({ ...it, category: "AI" });
  }
  return out.slice(0, 30);
}

export function formatFactsMarkdown(items, max = 35) {
  const lines = [];
  const slice = (items || []).slice(0, max);
  for (const it of slice) {
    const when = it.publishedAt ? new Date(it.publishedAt).toISOString() : "";
    const url = it.url ? ` ${it.url}` : "";
    lines.push(`- [${it.category || "?"}] **${it.source || "?"}** · ${it.title || ""}（${when}）${url}`);
  }
  return lines.join("\n");
}

export async function loadRecentItems(db, limit = 45) {
  const lim = Math.min(200, Math.max(5, Number(limit) || 45));
  const q = await db
    .prepare(
      `SELECT id, source, source_type as sourceType, category, title, summary, url, published_at as publishedAt, fetched_at as fetchedAt, severity, confidence
       FROM yuqing_items ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT ?`,
    )
    .bind(lim)
    .all();
  return (q && q.results) || [];
}

export async function loadItemsPage(db, category, limit) {
  const lim = Math.min(100, Math.max(1, Number(limit) || 40));
  let sql =
    `SELECT id, source, source_type as sourceType, category, title, summary, url, published_at as publishedAt, fetched_at as fetchedAt, severity, confidence
     FROM yuqing_items`;
  const binds = [];
  if (category && String(category).trim()) {
    sql += " WHERE category = ?";
    binds.push(String(category).trim());
  }
  sql += " ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT ?";
  binds.push(lim);
  const stmt = db.prepare(sql);
  const res = await stmt.bind(...binds).all();
  const rows = (res && res.results) || [];
  return { items: rows };
}

export async function loadHistoryStats(db, days = 7) {
  const d = Math.min(30, Math.max(1, Number(days) || 7));
  const cutoff = Date.now() - d * 86400000;
  const cutoffIso = new Date(cutoff).toISOString();
  let itemsInWindow = null;
  let snapshotsInWindow = null;
  try {
    const r = await db.prepare(`SELECT COUNT(*) as c FROM yuqing_items WHERE fetched_at >= ?`).bind(cutoff).first();
    itemsInWindow = r && r.c != null ? Number(r.c) : null;
  } catch (_) {}
  try {
    const r = await db
      .prepare(`SELECT COUNT(*) as c FROM yuqing_snapshots WHERE captured_at >= ?`)
      .bind(cutoffIso)
      .first();
    snapshotsInWindow = r && r.c != null ? Number(r.c) : null;
  } catch (_) {}
  return { days: d, snapshotsInWindow, itemsInWindow };
}

export async function pruneOldItems(db, days = 7) {
  const cutoffMs = Date.now() - days * 86400000;
  const cutoffIso = new Date(cutoffMs).toISOString();
  await db.prepare(`DELETE FROM yuqing_items WHERE fetched_at < ?`).bind(cutoffMs).run();
  await db.prepare(`DELETE FROM yuqing_snapshots WHERE captured_at < ?`).bind(cutoffIso).run();
}

async function insertItemsBatch(db, rows) {
  if (!rows.length) return { attempted: 0, changes: 0 };
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO yuqing_items (id, source, source_type, category, title, summary, url, published_at, fetched_at, severity, confidence, raw_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  let changes = 0;
  for (const r of rows) {
    if (!r.id) continue;
    try {
      const out = await stmt
        .bind(
          r.id,
          r.source,
          r.sourceType,
          r.category,
          r.title,
          r.summary || "",
          r.url,
          r.publishedAt != null ? Number(r.publishedAt) : null,
          r.fetchedAt != null ? Number(r.fetchedAt) : Date.now(),
          r.severity || "mid",
          r.confidence != null ? Number(r.confidence) : null,
          (function attachVersionRaw(row) {
            let parsed = {};
            try { parsed = row.rawJson ? JSON.parse(row.rawJson) : {}; } catch (_) { parsed = { raw: row.rawJson }; }
            parsed.contentDigest = row.contentDigest || parsed.contentDigest || documentContentDigest({ title: row.title, url: row.url, summary: row.summary });
            parsed.dedupeKey = row.dedupeKey || parsed.dedupeKey || eventDedupeKey(row);
            parsed.version = row.version || parsed.version || 1;
            return JSON.stringify(parsed);
          })(r),
        )
        .run();
      changes += out && out.meta && out.meta.changes != null ? Number(out.meta.changes) : 0;
    } catch (_) {}
  }
  return { attempted: rows.length, changes };
}

export async function insertSnapshotRow(db, snapshotJson, sourceErrors) {
  const capturedAt = new Date().toISOString();
  await db
    .prepare(`INSERT INTO yuqing_snapshots (captured_at, snapshot_json, source_errors) VALUES (?, ?, ?)`)
    .bind(capturedAt, snapshotJson, JSON.stringify(sourceErrors || []))
    .run();
  return capturedAt;
}

/**
 * 执行一轮事实抓取并写入 D1。
 * @param {any} env
 * @param {{ aggregateSources: (e:any)=>Promise<any> }} hooks
 */
export async function ingestFactPool(env, hooks) {
  const db = env.YUQING_DB;
  const ingestErrors = [];
  const rows = [];
  let agg;
  try {
    agg = await hooks.aggregateSources(env);
  } catch (e) {
    ingestErrors.push({ step: "aggregateSources", message: String(e && e.message ? e.message : e) });
    agg = { sources: { fng: { ok: false }, btc: { ok: false }, assets: [], errors: [] }, realMarketData: {} };
  }

  try {
    const rss = await fetchCoinDeskRss();
    for (const x of rss) {
      rows.push({ ...x, fetchedAt: Date.now() });
    }
  } catch (e) {
    ingestErrors.push({ step: "coindesk_rss", message: String(e && e.message ? e.message : e) });
  }

  const dedup = new Map();
  for (const r of rows) {
    if (!r.id) continue;
    if (!dedup.has(r.id)) dedup.set(r.id, r);
  }
  const unique = [];
  const seenDedupe = new Map();
  for (const r of [...dedup.values()]) {
    const key = eventDedupeKey(r);
    const digest = documentContentDigest({ title: r.title, url: r.url, summary: r.summary });
    const next = { ...r, dedupeKey: key, contentDigest: digest };
    if (!seenDedupe.has(key)) {
      seenDedupe.set(key, { ...next, version: 1 });
      continue;
    }
    const prev = seenDedupe.get(key);
    const merged = mergeDocumentVersion(
      { version: prev.version || 1, contentDigest: prev.contentDigest },
      { contentDigest: digest },
    );
    if (merged.action === "revise") {
      seenDedupe.set(key, { ...next, version: merged.version, previousDigest: merged.previousDigest });
    }
  }
  unique.push(...seenDedupe.values());

  const snapshotPayload = {
    capturedAt: new Date().toISOString(),
    sources: agg.sources,
    ingestStats: { candidateItems: unique.length, ingestErrors },
  };

  let capturedAt = snapshotPayload.capturedAt;
  try {
    capturedAt = await insertSnapshotRow(db, JSON.stringify(snapshotPayload), ingestErrors);
  } catch (e) {
    ingestErrors.push({ step: "snapshot", message: String(e && e.message ? e.message : e) });
  }

  let insertResult = { attempted: 0, changes: 0 };
  try {
    insertResult = await insertItemsBatch(db, unique);
  } catch (e) {
    ingestErrors.push({ step: "items_insert", message: String(e && e.message ? e.message : e) });
  }

  try {
    await pruneOldItems(db, 7);
  } catch (e) {
    ingestErrors.push({ step: "prune", message: String(e && e.message ? e.message : e) });
  }

  return {
    capturedAt,
    insertedRows: insertResult.changes,
    attemptedItems: insertResult.attempted,
    candidateItems: unique.length,
    ingestErrors,
    sources: agg.sources,
  };
}
