import { defineConfig, loadEnv } from "vite";
import fullReload from "vite-plugin-full-reload";
import { agentTeamBridge } from './scripts/agent-team/service.mjs';
import { createTools } from './scripts/agent-team/tools.mjs';

/**
 * 本地静态前端开发：监听文件变更并全页刷新（经典 script 标签无 ESM HMR）。
 * 事实 API 仍走 js/config.js 默认的云端 Worker；本地研究只在端口绑定成功后取得写所有权。
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
    strictPort: true,
    open: false,
    host: "127.0.0.1",
    fs: {
      // 保留 Vite 默认保护，并阻止本地迁移包和出口机记录被静态服务读取。
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.codex/**", "**/.local/**", "**/.artifacts/**", "**/BitDesk-PRIVATE-*", "**/BTC拷贝.zip"],
    },
    headers: {
      "Cache-Control": "no-store",
    },
    watch: { usePolling: process.platform === 'win32', interval: 300, ignored:['**/.local/**','**/.artifacts/**','**/dist/**','**/.codex/**'] },
  },
  plugins: [
    agentTeamBridge({toolsFactory:()=>createTools({marketOrigin:overrides.BIT_DATA_API_BASE||'https://btc.feiniwork.com',eventsOrigin:overrides.BIT_YUQING_API_BASE||'https://yuqing.feiniwork.com'})}),
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
    fullReload(["index.html", "assets/**/*.{css,svg}", "js/**/*.{js,mjs,css}"], {
      delay: 120,
    }),
  ],
  };
});
