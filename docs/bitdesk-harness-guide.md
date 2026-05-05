# BitDesk 专属 Harness 增强说明

本系统是轻量交易数据监测台：**静态前端**（Pages 或任意 CDN）通过 **Cloudflare Worker + D1** 拉取 K 线、footprint、衍生品与舆情接口；已无本地 Node Express 宿主。

## 当前逻辑地图

- `index.html`：页面壳，按顺序加载配置、工具、页面、图表、订单流和启动脚本。
- `js/app.js`：hash 路由、页面渲染、afterMount 初始化和全局页面事件。
- `js/config.js`：导航、员工/数据页映射、默认 Worker 基址 `https://btc.feiniwork.com`。
- `js/data-engine.js`：读取 `/api/d1/klines`、触发 `/api/d1/sync`、读取 `/api/d1/status`（相对当前 `BIT_DATA_API_BASE`）。
- `js/pages/chart.js` + `js/chart/*`：行情工作台和指标计算/展示。
- `js/pages/orderflow.js` + `js/orderflow/*`：订单流、足迹图、聚合、canvas 渲染。
- `cloudflare/binance-klines-worker.js`：D1 K 线、footprint 读写、手动同步、Binance 代理兼容路径（含 `/api/binance/*` 转发）。
- `scripts/*`：现有确定性验证脚本；含语法检查、静态壳 smoke 与 diff 摘要。

## 验证矩阵

- 所有 JS 改动：`npm run lint`
- 指标/图表数学：`node scripts/verify-indicator-math.cjs`
- 足迹聚合/订单流/Cloudflare footprint：`npm run verify:footprint`
- 静态壳 / 可选远端 Worker：`npm run verify:api`（可选 `BITDESK_SMOKE_ORIGIN=https://btc.feiniwork.com`）
- 跨模块改动：`npm run verify:all`
- 真实行情链路诊断：`npm run diagnose`（可选 `BITDESK_KLINE_API_BASE`）
- 收尾摘要：`npm run diff:summary`

## 前端截图检查

前端改动后在已上线 Pages 或任意静态宿主打开受影响路由，例如：

- 行情：`/index.html#chart`
- 订单流：`/index.html#orderflow`
- 设置：`/index.html#settings`
- 会议室：`/index.html#boardroom`

（此前依赖本机 `:port` + `npm start` 的方式已移除。）

## 云端部署

Workers 侧修改后按 `wrangler deploy`（见 `cloudflare/wrangler*.toml`）；静态资源用 `npm run deploy:pages` 或等价流程。
