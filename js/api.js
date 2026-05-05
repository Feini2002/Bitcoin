/* 其他 JSON 接口的基址。K 线走 DataEngine：默认 BIT_DATA_API_BASE Worker，或同源 server /api/binance/klines */
// const API_BASE = "http://127.0.0.1:3000";

async function fetchJson(path, options = {}) {
  if (typeof API_BASE === "undefined" || !API_BASE) {
    throw new Error("API_BASE 未配置：先在 api.js 中设置后端地址");
  }
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json", ...options.headers },
    ...options,
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}
