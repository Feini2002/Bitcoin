/**
 * 衍生品云端同步一屏诊断：请求 Worker 的 status / read / origin-check /（可选）sync dry。
 *
 * 用法：
 *   node scripts/diagnose-derivatives-sync.cjs
 *   node scripts/diagnose-derivatives-sync.cjs https://btc.feiniwork.com
 *
 * 环境变量（覆盖 argv[2]）：
 *   BITDESK_DERIV_BASE — 例如 https://btc.feiniwork.com
 */
const BASE = String(process.env.BITDESK_DERIV_BASE || process.argv[2] || "https://btc.feiniwork.com").replace(/\/$/, "");

async function fetchJson(path) {
  const url = `${BASE}${path}`;
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_) {
    data = { _raw: text.slice(0, 400) };
  }
  return { url, status: res.status, data };
}

function fmtAge(min) {
  if (min == null || !Number.isFinite(Number(min))) return "--";
  return `${Math.round(Number(min))}m`;
}

function summarizeStatus(data) {
  if (!data || typeof data !== "object") return "(empty)";
  const lines = [];
  lines.push(`workerBuild=${data.workerBuild || "--"} binanceOriginMode=${data.binanceOriginMode || "--"}`);
  const mh = Array.isArray(data.metricHealth) ? data.metricHealth : [];
  const bad = mh.filter((r) => r && (r.level === "stale" || r.level === "missing"));
  const coreBad = bad.filter((r) => !/^(vix|vix3m|move)$/.test(String(r.metric)));
  lines.push(`metricHealth stale/missing: total ${bad.length} · core ${coreBad.length}`);
  for (const r of coreBad.slice(0, 8)) {
    lines.push(
      `  - ${r.metricLabelZh || r.metric} age=${fmtAge(r.ageMinutes)} next=${r.nextAttemptAfterIso || "--"} kind=${r.lastTaskErrorKind || "--"}`,
    );
  }
  const sr = Array.isArray(data.stalenessReasons) ? data.stalenessReasons : [];
  if (sr.length) {
    lines.push("stalenessReasons (head):");
    for (const ln of sr.slice(0, 6)) lines.push(`  · ${ln}`);
  }
  const sh = Array.isArray(data.sourceHealth) ? data.sourceHealth : [];
  if (sh.length) {
    lines.push("sourceHealth (head):");
    for (const row of sh.slice(0, 6)) {
      const cd = Number(row.cooldown_until_ms) || 0;
      lines.push(
        `  · ${row.source} kind=${row.last_error_kind || "--"} cooldown=${cd > Date.now() ? new Date(cd).toISOString() : "—"}`,
      );
    }
  }
  return lines.join("\n");
}

async function main() {
  console.log(`BITDESK derivatives diagnose → base ${BASE}\n`);
  const [st, read, origin] = await Promise.all([
    fetchJson("/api/d1/derivatives/status"),
    fetchJson("/api/d1/derivatives?symbol=BTCUSDT&range=30d"),
    fetchJson("/api/d1/derivatives/origin-check"),
  ]);
  console.log(`[status] HTTP ${st.status} ${st.url}`);
  console.log(summarizeStatus(st.data));
  console.log("\n[read] HTTP " + read.status + " " + read.url);
  const p = read.data || {};
  const df = p.dataFreshness || {};
  console.log(
    `  sourceOk=${df.sourceOk} worstCoreStaleMinutes=${df.worstCoreStaleMinutes ?? "--"} workerBuild=${p.syncHints?.workerBuild || "--"}`,
  );
  const sr = Array.isArray(p.stalenessReasons) ? p.stalenessReasons : [];
  if (sr.length) console.log("  stalenessReasons head:\n" + sr.slice(0, 4).map((l) => "    · " + l).join("\n"));

  console.log("\n[origin-check] HTTP " + origin.status + " " + origin.url);
  const ping = origin.data && origin.data.ping;
  console.log(`  summary: ${JSON.stringify(ping && typeof ping === "object" ? ping : origin.data).slice(0, 520)}`);

  if (st.status >= 400 || read.status >= 400) {
    console.error("\nFAIL: status or read returned HTTP error");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("FAIL diagnose-derivatives-sync:", e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
