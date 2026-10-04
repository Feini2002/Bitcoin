# 测试分类

测试集中在本目录，原有 npm 命令保持不变；优先从仓库根目录执行命令。

| 目录 | 内容 | 命令 |
| --- | --- | --- |
| `unit/` | 指标数学、斐波那契统计、足迹聚合与超时、压力矩阵 | `npm test`、`npm run verify:fib`、`npm run verify:footprint` |
| `integration/` | Worker、数据存储、共享读取、报告协议、产物与云端开关的离线契约 | `npm run build` 或对应 `verify:*` |
| `browser/` | 本地开发、桌面/手机导航、研究报告与费用治理 | `npm run verify:dev`、`npm run verify:ui`、`npm run verify:research-ui`、`npm run verify:cost-ui` |
| `fixtures/` | 研究报告与市场快照固定样例 | 由测试导入，不是独立运行入口 |

完整 build 包含语法检查、离线回归和 `dist/pages/` 构建；浏览器流程按上表单独运行。真实线上读回、性能测量等工具在 [scripts/diagnostics/](../scripts/README.md)，不与固定数据测试混放。测试通过不能替代线上服务健康或发布验收。

截图、日志、报告与临时夹具统一写入 `.artifacts/`；开发隔离测试仅在 `.local/` 和临时 `.env.verify-*` 写入虚构哨兵，真实私密文件只检查 HTTP HEAD 状态。禁止将真实凭据复制进本目录。
