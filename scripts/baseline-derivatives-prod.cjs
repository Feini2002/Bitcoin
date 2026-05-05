/**
 * One-shot baseline capture for derivatives prod (read-only).
 * Run: node scripts/baseline-derivatives-prod.cjs
 */
/* eslint-disable no-console */

const BASE = process.env.BTC_ORIGIN || "https://btc.feiniwork.com";

async function fetchJson(url) {
  try {
    const res = await fetch(url);
    const j = await res.json().catch(() => ({ _parseFail: true }));
    return {
      url,
      ok: res.ok,
      status: res.status,
      workerBuildHeader: res.headers.get("x-worker-build"),
      json: j,
    };
  } catch (e) {
    return { url, ok: false, error: String(e?.message || e) };
  }
}

async function main() {
  const urls = [
    `${BASE}/api/d1/status`,
    `${BASE}/api/d1/derivatives/status`,
    `${BASE}/api/d1/derivatives?symbol=BTCUSDT&range=30d`,
    `${BASE}/api/d1/derivatives/sync?symbol=BTCUSDT&groups=fast&wait=1`,
  ];
  const out = { capturedAtIso: new Date().toISOString(), baseUrl: BASE, samples: {} };
  for (const url of urls) {
    const k = url.split("/api/")[1].split("?")[0].replace(/\//g, "_");
    const r = await fetchJson(url);
    if (r.error) {
      out.samples[k] = r;
      continue;
    }
    const j = r.json || {};
    const brief = {
      httpOk: r.ok,
      status: r.status,
      workerBuildHeader: r.workerBuildHeader,
      workerBuildBody: j.workerBuild,
      binanceOriginMode: j.binanceOriginMode,
      sourceHealthRows: Array.isArray(j.sourceHealth) ? j.sourceHealth.length : null,
      written: j.written,
      partial: j.partial,
      queuedOrSkipped: j.queuedOrSkipped,
      skippedBecause: j.skippedBecause,
    };
    if (j.dataFreshness) {
      brief.worstCoreStaleMinutes = j.dataFreshness.worstCoreStaleMinutes;
      brief.sourceOk = j.dataFreshness.sourceOk;
    }
    brief.topKeys = Object.keys(j).slice(0, 45);
    out.samples[k] = brief;
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
