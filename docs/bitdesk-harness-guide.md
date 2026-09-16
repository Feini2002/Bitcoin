# BitDesk 开发导航

先读仓库 README.md 与 AGENTS.md，再进入 [文档索引](README.md)。

- 前端：index.html → js/config.js、js/features.js、js/nav.js → js/app.js → js/pages/。
- 数据：js/data-engine.js → cloudflare/binance-klines-worker.js、cloudflare/yuqing/。
- 独立快照：cloudflare/snapshot/；说明见 [市场快照](architecture/market-snapshot.md)。
- 验证：package.json 的 verify:* 命令及 scripts/README.md；离线 build 与线上 verify:api 分开报告。
- Pages：config/pages-assets.json 定义发布范围，build 生成 dist/pages/；详见 [仓库布局](architecture/repository-layout.md)。

具体执行、部署、远程 D1 与 Git 操作遵从用户当前指令及 AGENTS.md，不在本文件维护第二套规则。
