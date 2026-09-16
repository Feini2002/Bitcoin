/**
 * Verify derivative Worker retry gates that protect deployed D1 freshness.
 */
const fs = require("fs");
const path = require("path");

let failed = 0;
function assert(name, cond, detail) {
  if (!cond) {
    failed++;
    console.error("FAIL:", name, detail || "");
  } else {
    console.log("OK:", name);
  }
}

(async () => {
  const file = path.join(__dirname, "..", "cloudflare", "binance-klines-worker.js");
  let src = fs.readFileSync(file, "utf8");
  src = src.replace(/^\s*import\s+[\s\S]*?from\s+["'][^"']+["']\s*;?\s*/gm, "");
  src = src.replace(/export default\s*\{/, "const __workerDefault = {");
  src += '\nsyncDerivativesOne = async (_env, _symbol, options) => options;';
  const mod = await import(`data:text/javascript;base64,${Buffer.from(src, "utf8").toString("base64")}`);
  const hooks = mod.__footprintTestHooks;

  assert("exports derivative retry hooks", !!hooks && typeof hooks.derivativeTaskRunnable === "function");

  const directOrigins = hooks.binanceDerivativeFapiOrigins({}).map((u) => new URL(u).host);
  assert("derivatives try primary fapi host first", directOrigins[0] === "fapi.binance.com", directOrigins.join(","));
  assert("derivatives keep alternate direct hosts after primary", directOrigins.includes("fapi1.binance.com") && directOrigins.includes("fapi2.binance.com"), directOrigins.join(","));

  const customOrigins = hooks.binanceDerivativeFapiOrigins({ BINANCE_FAPI_ORIGIN: "https://proxy.example.com/fapi" });
  assert("custom FAPI origin is normalized", customOrigins.length === 1 && customOrigins[0] === "https://proxy.example.com", customOrigins.join(","));

  assert(
    "direct geo restriction keeps trying alternate hosts",
    hooks.shouldStopDerivativeOriginRetry(false, { kind: "geo_restricted" }) === false
  );
  assert(
    "custom geo restriction stops immediately",
    hooks.shouldStopDerivativeOriginRetry(true, { kind: "geo_restricted" }) === true
  );
  assert(
    "exact Binance ban stops alternate retries",
    hooks.shouldStopDerivativeOriginRetry(false, { kind: "blacklisted_ip", banUntilMs: Date.now() + 60000 }) === true
  );

  assert("CloudFront 403 activates existing derivative fallback", hooks.shouldUseBybitDerivativeFallback(["http_403"], ["403 ERROR: The request could not be satisfied"]));
  assert("Binance throttle activates existing derivative fallback", hooks.shouldUseBybitDerivativeFallback(["rate_limited"], ["403 Forbidden"]));
  assert("legacy geographic failure still activates fallback", hooks.shouldUseBybitDerivativeFallback(["geo_restricted"], ["Service unavailable from a restricted location"]));
  assert("unrelated parse error does not switch exchanges", !hooks.shouldUseBybitDerivativeFallback(["parse"], ["Invalid JSON"]));

  const staleDb = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }) }) };
  const scheduledRepair = await hooks.syncDerivativesIfDue({ DB: staleDb }, "BTCUSDT", new Date("2026-09-15T16:15:00Z"));
  assert("missing proprietary history does not starve scheduled funding and OI", scheduledRepair.groups === "core", JSON.stringify(scheduledRepair));

  const now = Date.UTC(2026, 4, 4, 16, 0, 0);
  const task = hooks.derivativeTaskHealthKey("long_short", "hist");
  const staleMaxTs = now - hooks.derivativeStaleLimitWorker("long_short") - 11 * 60 * 1000;
  const futureNext = now + 2 * 60 * 60 * 1000;
  const staleRetry = hooks.derivativeTaskRunnable(
    {
      [task]: {
        next_allowed_at_ms: futureNext,
        last_attempt_at_ms: now - 20 * 60 * 1000,
        last_error_kind: "geo_restricted",
        extra_json: "{}",
      },
    },
    task,
    now,
    false,
    { maxTsByMetric: { long_short: staleMaxTs } },
  );
  assert("stale derivative metric may bypass soft cooldown", staleRetry.ok && staleRetry.staleRetry === true, JSON.stringify(staleRetry));

  const tooSoon = hooks.derivativeTaskRunnable(
    {
      [task]: {
        next_allowed_at_ms: futureNext,
        last_attempt_at_ms: now - 5 * 60 * 1000,
        last_error_kind: "geo_restricted",
        extra_json: "{}",
      },
    },
    task,
    now,
    false,
    { maxTsByMetric: { long_short: staleMaxTs } },
  );
  assert("stale retry still respects minimum attempt gap", tooSoon.ok === false, JSON.stringify(tooSoon));

  const hardBan = hooks.derivativeTaskRunnable(
    {
      [task]: {
        next_allowed_at_ms: futureNext,
        last_attempt_at_ms: now - 20 * 60 * 1000,
        last_error_kind: "rate_limited",
        extra_json: JSON.stringify({ binanceBanUntilMs: now + 60 * 60 * 1000 }),
      },
    },
    task,
    now,
    false,
    { maxTsByMetric: { long_short: staleMaxTs } },
  );
  assert("hard Binance ban is not bypassed by stale retry", hardBan.ok === false, JSON.stringify(hardBan));

  console.log(failed ? `\n${failed} derivative worker check(s) failed` : "\nAll derivative worker checks passed");
  process.exitCode = failed ? 1 : 0;
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
