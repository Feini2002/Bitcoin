/** Shared Worker <-> VPS egress helpers. No secrets in this file. */

export const EGRESS_SECRET_HEADER = "X-Bitdesk-Egress-Secret";

const PROVIDER_ORIGIN_ENV = {
  "binance-spot": "BINANCE_SPOT_ORIGIN",
  bybit: "BYBIT_API_ORIGIN",
  okx: "OKX_API_ORIGIN",
  bitget: "BITGET_API_ORIGIN",
  deribit: "DERIBIT_API_ORIGIN",
};

export const EGRESS_ENVELOPE_HOST = {
  "binance-usdm": "fapi.binance.com",
  "binance-spot": "data-api.binance.vision",
  bybit: "api.bybit.com",
  okx: "www.okx.com",
  bitget: "api.bitget.com",
  deribit: "www.deribit.com",
};

const EGRESS_ENV_KEYS = [
  "BINANCE_FAPI_ORIGIN",
  "BINANCE_FSTREAM_ORIGIN",
  "BINANCE_SPOT_ORIGIN",
  "BINANCE_SAPI_ORIGIN",
  "BYBIT_API_ORIGIN",
  "BYBIT_STREAM_ORIGIN",
  "OKX_API_ORIGIN",
  "BITGET_API_ORIGIN",
  "DERIBIT_API_ORIGIN",
];

function parsedUrl(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  try {
    const u = new URL(String(raw).trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

export function parseOriginOnly(raw) {
  const u = parsedUrl(raw);
  return u ? u.origin : null;
}

export function parseOriginBase(raw) {
  const u = parsedUrl(raw);
  if (!u) return null;
  u.hash = "";
  u.search = "";
  const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
  return u.origin + path;
}

export function joinEgress(base, path) {
  const rawPath = String(path || "");
  if (!base) return rawPath;
  const b = String(base).replace(/\/$/, "");
  const q = rawPath.indexOf("?");
  const pathname = q >= 0 ? rawPath.slice(0, q) : rawPath;
  const search = q >= 0 ? rawPath.slice(q) : "";
  const p = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return b + p + search;
}

export function remapProviderBase(providerId, env, fallback) {
  if (providerId === "binance-usdm") return parseOriginOnly(env && env.BINANCE_FAPI_ORIGIN) || fallback;
  const key = PROVIDER_ORIGIN_ENV[providerId];
  if (!key) return fallback;
  return parseOriginBase(env && env[key]) || fallback;
}

export function envelopeHost(providerId, urlHost) {
  return EGRESS_ENVELOPE_HOST[providerId] || urlHost;
}

export function egressHostsFromEnv(env) {
  const hosts = new Set();
  for (const key of EGRESS_ENV_KEYS) {
    const base = parseOriginBase(env && env[key]);
    if (!base) continue;
    try {
      hosts.add(new URL(base).host.toLowerCase());
    } catch {
      /* ignore malformed origin */
    }
  }
  return hosts;
}

export function egressRequestHeaders(env, targetUrl, extra = {}) {
  const headers = { ...extra };
  const secret = env && env.EGRESS_PROXY_SECRET;
  if (!secret) return headers;
  try {
    const host = new URL(String(targetUrl)).host.toLowerCase();
    if (egressHostsFromEnv(env).has(host)) headers[EGRESS_SECRET_HEADER] = String(secret);
  } catch {
    /* ignore */
  }
  return headers;
}

export function toWebSocketUrl(httpOrWsOrigin, pathAndQuery) {
  const httpsBase = String(httpOrWsOrigin).replace(/^ws/i, "http");
  return joinEgress(httpsBase, pathAndQuery).replace(/^http:/, "ws:").replace(/^https:/, "wss:");
}

export async function openEgressWebSocket(env, url) {
  const httpsUrl = String(url).replace(/^wss:/i, "https:").replace(/^ws:/i, "http:");
  let host = "";
  try {
    host = new URL(httpsUrl).host.toLowerCase();
  } catch {
    return new WebSocket(url);
  }
  if (!egressHostsFromEnv(env).has(host)) return new WebSocket(url);
  const resp = await fetch(httpsUrl, {
    headers: egressRequestHeaders(env, httpsUrl, { Upgrade: "websocket" }),
  });
  const ws = resp.webSocket;
  if (!ws) {
    const err = new Error(`websocket handshake ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  ws.accept();
  return ws;
}
