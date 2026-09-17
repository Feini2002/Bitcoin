const ACCESS_JWT_HEADER = "Cf-Access-Jwt-Assertion";
const ACCESS_CERTS_TTL_MS = 10 * 60 * 1000;
const DEFAULT_ALLOWED_ORIGIN = "https://bitcoin.feiniwork.com";

const certsCache = new Map();

export function accessAllowedOrigin(env, origin) {
  const allowed = splitList(env && env.ACCESS_ALLOWED_ORIGINS).concat(DEFAULT_ALLOWED_ORIGIN);
  const unique = new Set(allowed.map((v) => v.replace(/\/$/, "")));
  const normalized = origin ? String(origin).replace(/\/$/, "") : DEFAULT_ALLOWED_ORIGIN;
  if (unique.has(normalized)) return normalized;
  if (isPagesPreviewOrigin(normalized)) return normalized;
  return DEFAULT_ALLOWED_ORIGIN;
}

export function accessCorsHeaders(env, extra = {}) {
  return {
    "Access-Control-Allow-Origin": accessAllowedOrigin(env, extra.origin),
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, HEAD",
    "Access-Control-Allow-Headers": "Content-Type, Accept, Cf-Access-Jwt-Assertion",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    ...withoutOrigin(extra),
  };
}

export function accessServiceHeaders(env, extra = {}) {
  const clientId = env && (env.ACCESS_SERVICE_CLIENT_ID || env.CF_ACCESS_CLIENT_ID);
  const clientSecret = env && (env.ACCESS_SERVICE_CLIENT_SECRET || env.CF_ACCESS_CLIENT_SECRET);
  return {
    ...extra,
    ...(clientId && clientSecret
      ? {
          "CF-Access-Client-Id": String(clientId),
          "CF-Access-Client-Secret": String(clientSecret),
        }
      : {}),
  };
}

export async function requireCloudflareAccess(request, env, jsonResponder) {
  const cfg = accessJwtConfig(env);
  if (!cfg.enabled) return null;
  if (!cfg.teamDomain || !cfg.audiences.length) {
    return jsonResponder(
      { ok: false, error: "Cloudflare Access JWT is required but ACCESS_TEAM_DOMAIN or ACCESS_AUD is missing" },
      500,
      { "Cache-Control": "no-store" },
    );
  }

  const token = request.headers.get(ACCESS_JWT_HEADER) || "";
  if (!token) {
    return jsonResponder({ ok: false, error: "Cloudflare Access login required" }, 401, { "Cache-Control": "no-store" });
  }

  try {
    const claims = await verifyCloudflareAccessJwt(token, cfg);
    if (cfg.allowedEmails.length) {
      const email = String(claims.email || claims.common_name || "").toLowerCase();
      if (!cfg.allowedEmails.includes(email)) {
        return jsonResponder({ ok: false, error: "Cloudflare Access user is not allowed" }, 403, { "Cache-Control": "no-store" });
      }
    }
    return null;
  } catch (e) {
    return jsonResponder(
      { ok: false, error: `Cloudflare Access token rejected: ${e && e.message ? e.message : String(e)}` },
      403,
      { "Cache-Control": "no-store" },
    );
  }
}

function withoutOrigin(headers) {
  const out = { ...(headers || {}) };
  delete out.origin;
  return out;
}

function splitList(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function isPagesPreviewOrigin(origin) {
  try {
    const u = new URL(origin);
    return u.protocol === "https:" && (
      u.hostname === "bit-trading-desk.pages.dev" ||
      u.hostname.endsWith(".bit-trading-desk.pages.dev")
    );
  } catch {
    return false;
  }
}

function accessJwtConfig(env) {
  const teamDomain = normalizeTeamDomain(env && (env.ACCESS_TEAM_DOMAIN || env.CLOUDFLARE_ACCESS_TEAM_DOMAIN));
  const audiences = splitList(env && (env.ACCESS_AUD || env.ACCESS_AUDS || env.CLOUDFLARE_ACCESS_AUD));
  const allowedEmails = splitList(env && (env.ACCESS_ALLOWED_EMAIL || env.ACCESS_ALLOWED_EMAILS)).map((v) => v.toLowerCase());
  const required = isTruthy(env && (env.ACCESS_JWT_REQUIRED || env.CLOUDFLARE_ACCESS_REQUIRED));
  return {
    enabled: required || !!(teamDomain && audiences.length),
    teamDomain,
    audiences,
    allowedEmails,
  };
}

function isTruthy(value) {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function normalizeTeamDomain(raw) {
  const value = String(raw || "").trim().replace(/^https?:\/\//i, "").replace(/\/$/, "");
  if (!value || value === "CHANGE_ME") return "";
  return value;
}

async function verifyCloudflareAccessJwt(token, cfg) {
  const parts = String(token).split(".");
  if (parts.length !== 3) throw new Error("malformed JWT");
  const header = parseJwtPart(parts[0]);
  const payload = parseJwtPart(parts[1]);
  if (header.alg !== "RS256") throw new Error("unexpected JWT algorithm");

  const issuer = `https://${cfg.teamDomain}`;
  if (payload.iss !== issuer) throw new Error("issuer mismatch");
  const aud = Array.isArray(payload.aud) ? payload.aud.map(String) : [String(payload.aud || "")];
  if (!aud.some((v) => cfg.audiences.includes(v))) throw new Error("audience mismatch");

  const now = Math.floor(Date.now() / 1000);
  if (Number(payload.exp || 0) <= now) throw new Error("token expired");
  if (payload.nbf != null && Number(payload.nbf) > now) throw new Error("token not active yet");

  const jwks = await loadAccessJwks(cfg.teamDomain);
  const jwk = (jwks.keys || []).find((key) => key.kid === header.kid);
  if (!jwk) throw new Error("signing key not found");

  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) throw new Error("signature mismatch");
  return payload;
}

async function loadAccessJwks(teamDomain) {
  const cached = certsCache.get(teamDomain);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`certs HTTP ${res.status}`);
  const value = await res.json();
  certsCache.set(teamDomain, { value, expiresAt: Date.now() + ACCESS_CERTS_TTL_MS });
  return value;
}

function parseJwtPart(part) {
  const text = new TextDecoder().decode(base64UrlToBytes(part));
  return JSON.parse(text);
}

function base64UrlToBytes(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
