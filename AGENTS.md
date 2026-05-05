# Codex Harness Rules

本仓库是 Bit Trading Desk / 加密数据监测分模块。Codex 在本项目中工作时，优先用可验证的小步修改，而不是大范围重构。

## Context First

- 先读 `.cursorrules`、`package.json`、`index.html` 与相关 `js/` 页面入口，再改代码。
- 保留未被明确要求实现的 `PLANNED`、占位 UI、预留注释和示意结构。
- 路径包含空格和中文，PowerShell 命令优先使用 `-LiteralPath`，文件编辑优先用 `apply_patch`。

## Connected Logic Scope

- 当用户要求修改某个功能点时，必须先检查当前页面内其他功能点、其他页面功能点、共享数据层、共享状态、Worker/D1/API、快照导出、员工/LLM 分析输入等是否与该功能点存在真实逻辑关联。
- 只要存在真实逻辑关联，就必须把相关点一起纳入修改范围，保证入口、数据流、展示、状态、缓存、验证和错误处理前后一致；不得只修当前按钮/当前卡片/当前页面的一小段而留下断裂逻辑。
- 如果用户明确表示「先为当前功能点列一个修改 plan / 规划」，该 plan 也必须包含所有已识别的关联点、受影响文件、验证命令和部署/D1 操作，确保后续实现整体逻辑严丝合缝、十分严谨。
- 若某个关联点因风险、权限或范围原因暂时不能改，必须在 plan 或最终回复中明确标出原因、影响和后续处理方式。

## Validation Loop

- 本仓库没有独立打包产物时，`npm run build` 作为部署前总闸，等价运行全量验证。
- 通用改动后运行 `npm run lint`。
- 指标数学或行情图表改动后运行 `node scripts/verify-indicator-math.cjs`。
- 足迹图、订单流或 Cloudflare footprint 改动后运行 `npm run verify:footprint`。
- Worker/静态壳相关改动后运行 `npm run verify:api`（默认探测已部署行情 Worker `/api/d1/status`，可用 `BITDESK_SMOKE_ORIGIN` 覆盖根 URL）；需要探测 Binance 与 `BITDESK_KLINE_API_BASE` 指向的行情 Worker `/api/d1/klines` 时再运行 `npm run diagnose`。
- 改动跨多个区域时运行 `npm run verify:all`。
- 收尾时默认不运行 `npm run diff:summary`；最终回复里手工列出改动文件即可。只有用户明确要求差异摘要，或需要借助该脚本排查改动范围时再运行。

## Frontend Checks

- 前端 UI 改动后在生产站点 `https://bitcoin.feiniwork.com/` 核验受影响 hash，例如 `/index.html#chart`、`/index.html#orderflow`、`/index.html#settings`。

## Cloudflare Deployments

- 当前系统已经完整部署。修改任何仓库内容后，默认在收尾阶段运行 `npm run build`，然后部署受影响的线上面：
  - 前端、静态资源、规则/文档、脚本或共享逻辑改动后执行 `npm run deploy:pages`。
  - Worker 改动后在 `cloudflare/` 下执行 `wrangler deploy`。
  - 同时影响 Pages 与 Worker 时，两者都要部署，先 Worker 后 Pages。
- 凡是修改已部署在 Cloudflare 上的 Worker（如 `cloudflare/binance-klines-worker.js`）后，默认完成克隆侧校验并直接执行对应的 `wrangler deploy`，不要只做改代码跳过线上发布。
- 凡是修改 D1 schema、迁移 SQL 或需要调整远程 D1 表结构/表内容的改动，默认同步执行对应的远程 D1 迁移/写入命令（如 `wrangler d1 execute ... --remote --file=...`），并在最终回复说明已处理的远程对象与命令。
- 若部署或远程 D1 操作因登录、权限、网络或 Cloudflare 状态失败，必须明确说明失败原因和下一步需要的人工动作。
- **GitHub 备份**：对已产生应向用户交付的仓库改动的收尾，在条件允许时于部署之后将变更 **commit 并 push 到 `origin/main`**（细节与例外见仓库根目录 `GITHUB-BACKUP-WORKFLOW.md` 及 `.cursor/rules/auto-build-deploy.mdc`）。

## Pages Custom Domain Cache

- 本项目自定义域名是 `https://bitcoin.feiniwork.com/`。前端、静态资源、页面入口、样式或关键 JS 改动后，部署 Pages 前必须同步更新 `index.html` 中受影响资源的 `?v=` 版本号，避免自定义域名、浏览器或边缘缓存继续加载旧 `styles.css` / JS。
- 如果只是恢复、替换或修补 `styles.css`、`js/pages/*.js`、`js/app.js`、`js/config.js`、图表入口或其他由 `index.html` 引入的静态文件，也必须提升对应资源版本号；不要只部署文件本体。
- Pages 部署后必须核验 `https://bitcoin.feiniwork.com/` 返回的 `index.html` 已包含新 `?v=`，并至少检查受影响 hash 页面；若自定义域名和 `*.pages.dev` 内容不一致，优先排查 Pages production 指针、Cloudflare 缓存和浏览器缓存。

## Reporting

- 与 `.cursorrules`「与用户的回答风格」一致：**默认**说明类回复仅用分点中文；**禁止**三反引号围栏代码块（含源码摘录、伪代码、示例计算用代码），除非用户本轮明文要代码；不要用函数名/代码对照代替文字结论。
- 最终回复用中文，简短说明改动、验证命令和未能完成的检查。
- 不要把网络实时数据成功当成稳定测试结论；行情源、Worker、Binance、Bybit 状态都可能随时间变化。
