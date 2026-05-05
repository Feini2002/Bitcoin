/* =======================================================
   主题（亮/暗）
   ======================================================= */
const THEME_KEY = "bit-theme";

function getTheme() {
  return document.documentElement.getAttribute("data-theme") || "light";
}

function setTheme(theme) {
  if (theme !== "dark" && theme !== "light") theme = "light";
  document.documentElement.setAttribute("data-theme", theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem(THEME_KEY); } catch (_) {}
  setTheme(saved === "dark" ? "dark" : "light");
}
