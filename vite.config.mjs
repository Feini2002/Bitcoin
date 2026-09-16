import { defineConfig, loadEnv } from "vite";
import fullReload from "vite-plugin-full-reload";

/**
 * 本地静态前端开发：监听文件变更并全页刷新（经典 script 标签无 ESM HMR）。
 * API 仍走 js/config.js 默认的云端 Worker；D1 仅经由线上 Worker，浏览器不直连。
 */
export default defineConfig(({ mode }) => {
  const local = loadEnv(mode, process.cwd(), ["BIT_DATA_API_BASE", "BIT_YUQING_API_BASE"]);
  const overrides = Object.fromEntries(["BIT_DATA_API_BASE", "BIT_YUQING_API_BASE"]
    .map(key => [key, process.env[key] ?? local[key]])
    .filter(([, value]) => value));
  return {
  root: ".",
  server: {
    port: 5173,
    strictPort: false,
    open: "/index.html",
    host: "127.0.0.1",
    headers: {
      "Cache-Control": "no-store",
    },
  },
  plugins: [
    {
      name: "live-cache-buster",
      transformIndexHtml(html) {
        // 自动将所有 ?v=... 替换为当前时间戳，确保本地开发永不缓存旧 JS/CSS
        const timestamp = Date.now();
        const updated = html.replace(/(\.(js|css)\?v=)([a-zA-Z0-9\-_]+)/g, `$1${timestamp}`);
        const publicConfig = JSON.stringify(overrides).replace(/</g, "\\u003c");
        return updated.replace("<head>", `<head><script>Object.assign(window,${publicConfig});</script>`);
      },
    },
    fullReload(["index.html", "styles.css", "js/**/*.{js,css}", "btc.svg"], {
      delay: 120,
    }),
  ],
  };
});
