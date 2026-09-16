# 脚本用途

优先通过 package.json 的稳定命令调用。脚本保留现有路径，避免为分类而破坏操作入口。

| 用途 | 入口 | 副作用 |
| --- | --- | --- |
| 离线完整验证 + 网站产物 | npm run build | 仅本地 dist/pages/ |
| 网站资产构建 | npm run build:pages | 重建可再生 dist/pages/ |
| 发布边界验证 | npm run verify:pages | 本地固定样例与发布产物 |
| 指标/快照/足迹/舆情 | npm test、verify:footprint、verify:market-snapshot、verify:yuqing | 固定测试数据，不调用真实模型 |
| 浏览器治理验收 | npm run verify:ui | Chrome、短时本地 HTTP 服务、.artifacts/ |
| 静态壳 | npm run verify:shell | 只读本地 |
| 行情服务探测 | npm run verify:api | 线上 GET |
| 行情/衍生品诊断 | diagnose-klines.cjs、diagnose-derivatives-sync.cjs、baseline-derivatives-prod.cjs | 联网；按脚本实际路径判断写入范围 |
| 快照远程诊断 | diagnose-market-snapshot-cloud.cjs | 包含 POST 写快照，不能当纯只读检查运行 |
| 报告导入 | import-yuqing-report.cjs | 远程报告写入，仅在明确授权时使用 |
| Pages 发布/清理 | deploy-pages-safe.cjs、prune-pages-deployments.cjs | 上传网站、清理历史部署 |
| 有界启动 | run-bounded.cjs | 记录父子 PID，按指定秒数停止本次进程树 |
| 新电脑开发验收 | npm run verify:dev | 本地 Vite 和 Chromium，固定 API 地址，无远程写入 |
| 专项市场采集 | collect-market-local.cjs | 远程 D1 写入，不随开发启动；使用锁定版本 Wrangler 内部接口 |
| 差异摘要 | diff-summary.cjs | 仅按需，不作为默认收尾步骤 |

本地长任务示例：node scripts/run-bounded.cjs 180 npm run build。调用方每轮观察不超过 30 秒，实际成果仍须验收。

已退役的重复快照包装器统一使用 npm run verify:market-snapshot；旧 npm run verify:chart-snapshot 别名继续可用。一次性拼接脚本保留在 docs/reference/archive/maintenance/，不再是可执行维护入口。
