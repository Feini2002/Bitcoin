/* 其他 JSON 接口的基址；主行情走 DataEngine / window.BIT_DATA_API_BASE。 */
const API_BASE =
  typeof window !== "undefined" && window.BIT_DATA_API_BASE
    ? String(window.BIT_DATA_API_BASE).replace(/\/$/, "")
    : "https://btc.feiniwork.com";

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
