import { defineConfig } from "vite";
import fullReload from "vite-plugin-full-reload";

/**
 * 本地静态前端开发：监听文件变更并全页刷新（经典 script 标签无 ESM HMR）。
 * API 仍走 js/config.js 默认的云端 Worker；D1 仅经由线上 Worker，浏览器不直连。
 */
export default defineConfig({
  root: ".",
  server: {
    port: 5173,
    strictPort: false,
    open: "/index.html",
    host: true,
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
        return html.replace(/(\.(js|css)\?v=)([a-zA-Z0-9\-_]+)/g, `$1${timestamp}`);
      },
    },
    fullReload(["index.html", "styles.css", "js/**/*.{js,css}", "btc.svg"], {
      delay: 120,
    }),
  ],
});
