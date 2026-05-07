# Bit 交易决策平台（数据监测分模块）

面向个人期货交易台的 **静态 Web 壳 + Cloudflare Workers + D1**：把行情、订单流、强平热力、衍生品与舆情日报收拢到同一套导航里，并为「智囊团」员工视图预留结构化快照输入。

**线上入口（示例）**

- 前端（Cloudflare Pages + 自定义域）：<https://bitcoin.feiniwork.com/>
- 行情与 D1 API（Worker `btc`）：默认根域 `https://btc.feiniwork.com`（可在 `js/config.js` 或通过注入 `window.BIT_DATA_API_BASE` 覆盖）
- 舆情日报 Worker（独立服务）：默认 `https://yuqing.feiniwork.com`（或 `window.BIT_YUQING_API_BASE`）

---

## 系统架构

| 层级 | 说明 |
|------|------|
| **前端** | 仓库根目录静态资源：`index.html`、`styles.css`、`js/`（hash 路由 `#/…`）。图表基于 Lightweight Charts；订单流为 Canvas 足迹引擎；无独立打包步骤，直接由 Pages 托管整个目录。 |
| **行情 Worker** | `cloudflare/binance-klines-worker.js` + `cloudflare/wrangler.toml`。绑定 D1（`btc`）、强平采集 Durable Object、定时 Cron。负责 K 线落库、衍生品相关拉取、足迹/快照等对外 API。 |
| **舆情 Worker** | `cloudflare/yuqing/yuqing-worker.js` + `cloudflare/wrangler.yuqing.toml`。独立 D1（`yuqing`）、定时任务、LLM 结构化日报与流式生成；事实与模块逻辑在 `yuqing-facts.js`、`shijian/`、`fenxi/` 等目录。 |
| **验证与脚本** | `scripts/` 下大量 `verify-*.cjs`、`smoke-api.cjs` 等，保证指标数学、足迹聚合、快照契约、舆情 API 与前端 `DataEngine` 调用链一致。 |

数据流概要：**浏览器 →（可选覆盖基址）→ btc / yuqing Worker → D1 / 外部 API（Binance、Bybit、FRED、Yahoo 类、Finnhub、Gemini 等按模块配置）**。

---

## 功能模块与当前进度（概览）

- **已实现并持续迭代**
  - **市场监测**：行情工作台（多周期、指标与结构上下文）、订单流与足迹图（含云端同步与新鲜度降级）、强平雷达与热力压力矩阵、衍生品面板（资金费率、OI、基差等，含 Worker 侧容错与重试策略）。
  - **舆情与事件**：事件一览 / 舆情分析页与 yuqing Worker 对接；支持日报生成、历史与删除；流式输出与「GitHub 工具 / 趋势线索」等模块在 `shijian/` 与前端 `js/pages/events.js` 中联动。
  - **智囊团**：会议室与各员工视图；市场桌面快照程序与 Worker 写入路径（供 LLM 输入契约校验，见 `verify-market-snapshot-*`）。
  - **系统**：设置（含舆情 API 等）、主题与导航分组持久化。

- **导航中仍可能为占位或局部实现**
  - 盘前简报、策略模板库、订单草稿台、复盘子系统、数据池、Playbook 等：以 `PLANNED` 或轻量 UI 为主时，**不删除占位**，按需求逐步替换（仓库约定见 `AGENTS.md` / `.cursorrules`）。

---

## 本地开发与校验

```bash
npm install
npm run lint          # 语法与关键文件检查
npm run build         # 等同 verify:all，部署前总闸
```

常用子集：

- `npm run verify:api` — 静态壳 + 默认远程 Worker 探活（可用环境变量 `BITDESK_SMOKE_ORIGIN` 覆盖根 URL）
- `npm run verify:footprint` — 足迹与强平相关
- `npm run verify:yuqing` — 舆情迁移、路由与前端契约
- `node scripts/verify-indicator-math.cjs` — 指标数学

本地可选：`npm run dev:local`（Vite，见 `package.json`）。

---

## Cloudflare 部署（按需）

**前端 Pages**（仓库根目录）：

```bash
npm run build
npm run deploy:pages
```

**Worker**（在 `cloudflare/` 目录）：

```bash
npx wrangler deploy
npx wrangler deploy --config wrangler.yuqing.toml
```

建议顺序：**先 Workers，再 Pages**。D1 表结构变更需按 `cloudflare/wrangler.toml`、`wrangler.yuqing.toml` 及 `migrations/` 内注释执行 `wrangler d1 execute … --remote`，**勿将密钥写入仓库**。

前端变更后请同步提升 `index.html` 中引用资源的 `?v=` 版本号，避免自定义域名边缘缓存旧脚本（详见 `AGENTS.md`）。

---

## 仓库约定与协作

- 协作与验证矩阵：根目录 **`AGENTS.md`**。
- 更细的 Cursor / Codex 约定：**`.cursorrules`**。
- GitHub 备份流程说明（若需）：**`GITHUB-BACKUP-WORKFLOW.md`**。

---

## 许可证与声明

本项目为私有用途配置；依赖的交易所与第三方 API 受各自服务条款约束。展示数据不构成投资建议。
