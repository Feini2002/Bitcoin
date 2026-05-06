export function cleanText(value, fallback = "", maxLen = 600) {
  const raw = value == null ? "" : String(value);
  const text = raw.replace(/\s+/g, " ").trim();
  const safe = text || fallback || "";
  return maxLen > 0 && safe.length > maxLen ? safe.slice(0, maxLen) : safe;
}

export function normalizeSourceName(value, fallback = "") {
  return cleanText(value, fallback, 100);
}

export function normalizeSourceUrl(value) {
  const url = cleanText(value, "", 600);
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url : "";
}

export function bjtDateLabel(input = Date.now()) {
  return new Date(input).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" });
}

export function markdownTitle(value, fallback = "未命名") {
  return cleanText(value, fallback, 120).replace(/^#+\s*/, "");
}

export function stringifyJsonForPrompt(value) {
  try {
    return JSON.stringify(value == null ? {} : value, null, 2);
  } catch (_) {
    return "{}";
  }
}
