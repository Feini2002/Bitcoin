# 仓库布局与发布边界

2026-09-16 文件治理。依据实际引用与运行职责整理；本轮仅本地，发布由另一项工作统一执行。

## 目录职责

| 位置 | 职责 | 进入 Pages |
| --- | --- | --- |
| index.html、styles.css、btc.svg | 前端入口、样式、图标 | 是 |
| Bit交易决策平台.html | 兼容旧书签，跳转 index.html | 是 |
| js/ | 页面、导航、数据请求及图表模块 | 当前 .js 文件 |
| cloudflare/ | 行情、舆情 Worker、配置、数据库迁移 | 否 |
| cloudflare/snapshot/ | 独立市场快照程序、Worker、配置与 schema | 否 |
| config/pages-assets.json | Pages 资产清单 | 否 |
| scripts/ | 验证、构建、诊断、导入和发布工具 | 否 |
| docs/ | 当前有效的架构、操作与治理记录 | 否 |
| .codex/ | Codex 项目技能与配置 | 否 |
| docs/reference/project-skills/ | 保留的早期技能资料，不作为当前操作入口 | 否 |
| docs/reference/archive/ | 历史代码文本与早期参考 | 否 |
| dist/pages/ | 可再生网站发布产物 | 只上传其内容 |
| .artifacts/ | 浏览器报告、截图、测试夹具及日志 | 否 |
| .wrangler/、node_modules/、本地环境文件 | 缓存、依赖和本地配置 | 否 |

根目录仅保留常用启动入口与项目配置。scripts/ 保持稳定命令路径，具体用途见 scripts/README.md；不为视觉整齐迁移几十个被调用的脚本。

## 发布流程

1. npm run build：离线验证全部通过后构建 dist/pages/。
2. 构建器只从 config/pages-assets.json 收集入口和 js/，保持现有 URL 与资源版本参数。
3. 入口引用未列入产物的本地脚本/样式/图片时构建失败；正常重建先完整复制到独立临时目录，再替换旧输出，避免复制失败留下半成品和过期文件残留。
4. npm run deploy:pages 重新生成产物，再上传 dist/pages/，随后沿用既有部署保留策略。不要直接向 Pages 上传仓库根目录。
5. Worker、D1 和本地文档独立于网站产物。本轮不恢复服务、不迁移远程数据库、不部署、不 commit/push。

目前前端和 Worker 未发现通过 Pages 读取本地提示文件、schema 或内部 Markdown 的运行依赖。以后若新增此类依赖，应将必要的公开资源明确加入资产清单，不能重新改成整仓复制。

## 本轮迁移

| 原位置 | 新位置/处理 |
| --- | --- |
| 快照程序分析/marketSnapshotProgram.mjs | cloudflare/snapshot/marketSnapshotProgram.mjs |
| 快照程序分析/chartStructureSnapshot.mjs | cloudflare/snapshot/chartStructureSnapshot.mjs |
| 快照程序分析/market-snapshot-worker.js | cloudflare/snapshot/market-snapshot-worker.mjs，明确 ESM 类型 |
| 快照程序分析/schema.sql、wrangler.snapshot.toml | cloudflare/snapshot/ 同名文件；main 与测试引用同步 |
| 快照程序分析/5个快照模块转Cloudflare Worker说明.txt | docs/architecture/market-snapshot.md |
| 舆情/脚手架搭建.md | docs/architecture/yuqing-plan.md |
| GITHUB-BACKUP-WORKFLOW.md | docs/operations/github-backup.md，更新 README 与 Cursor 引用 |
| docs/codex-harness-general.md | archive/reference/，注明不作为当前执行规则 |
| scripts/splice-sync-deriv-block.cjs | archive/maintenance/splice-sync-deriv-block.cjs.txt |
| cloudflare/_patch_derivatives_sync_block.js | archive/maintenance/derivatives-sync-block.js.txt |
| 三个旧快照验证包装器 | 删除，无仓库调用者；统一使用 verify:market-snapshot，保留 npm verify:chart-snapshot 别名 |

快照算法、SQL 内容、D1 绑定标识和云端路由保持原内容；移动不等于创建或恢复快照服务。

旧补丁与当前 Worker 并不完全一致，因此保留历史内容。归档为文本后不会被当作正式 Worker、默认测试目标或日常维护命令。

## 规则与文档归属

- README：启动、常用命令、文档入口。
- AGENTS.md 与用户指令：执行边界。
- Cursor 已停用；.cursor/ 与 .cursorrules 已删除，有效项目约束集中于 AGENTS.md。
- docs/architecture/：实际模块与待建设范围。
- docs/operations/：操作说明，不重复创造授权流程。
- docs/governance.md：上一轮业务治理证据。
- docs/reference/：历史参考，不属于当前规则。

## 验证与保留项

- npm run verify:pages 检查实际产物范围、旧入口、过期输出清理和漏列依赖；测试中的环境文件均为虚构哨兵，不读取真实凭据。
- npm run build 覆盖新目录下的快照、指标一致性、存取链路以及既有业务回归；语法检查明确覆盖 js/、scripts/、cloudflare/ 和 Vite 配置，包含 .mjs，不扫描生成产物或归档。
- BITDESK_UI_ROOT=dist/pages 时，npm run verify:ui 直接验收实际发布目录，而不是源目录。
- 迁移 SQL、PLANNED、旧 HTML 跳转与已有用户修改保留。
- 根目录旧日志、截图与快照缓存已归入 .artifacts/legacy/；新验收产物统一放 .artifacts/，全部不进入网站。

## 本轮验收结果

- npm run build：通过，包含完整本地回归与 6 项发布产物测试；生成 33 个前端文件。
- BITDESK_UI_ROOT=dist/pages npm run verify:ui：43 PASS、0 FAIL；Windows Chrome 152.0.7977.84，桌面 1440×1000、移动 390×844。
- 浏览器覆盖页面导航、占位状态、图表渲染、数据来源标记、失败恢复和卸载；使用固定测试数据，不代表线上信源连通性。
- git diff --check：无空白错误，只有现有 Windows 换行转换提示。
- 构建记录：.artifacts/file-governance-build.log；浏览器报告：.artifacts/pages-artifact/results.json。
- 本轮没有部署、远程 D1 操作、提交或推送。

## 构建故障加固

- 复制失败保留上一版完整产物；替换失败尝试恢复旧目录。若恢复也失败，错误信息指出保留的旧产物位置，不删除恢复材料。
- Windows 目录移动遇到 EPERM/EBUSY 时最多重试 4 次、累计等待 200 毫秒，持续失败正常报错；依据本机测试实际出现的 EPERM。
- HTML 资源检查支持属性大小写、等号周围空格和无引号属性；仍是本项目静态入口检查，不是通用 HTML 解析器。
- 目录切换有短暂间隙，不承诺为并发部署提供原子快照；同一工作区的构建与发布应串行。突然断电或进程被强杀不在自动恢复保证内，可重建 dist/pages。

- 加固验收：npm run build 通过，12 项产物测试全部通过，输出仍为 33 个前端文件；日志 .artifacts/hardening-build.log。本轮未修改页面资源，未重复浏览器验收；未执行线上部署。
