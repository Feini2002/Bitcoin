# 仓库布局与发布边界

2026-09-30 分层整理。依据文件引用与实际职责归类；保留 npm 命令、根目录启动器、两个 HTML 入口与页面 hash。本次仅本地整理。下文历史验收记录保留其原日期，不代表本次验证结果。

2026-10-05接续见[开发快照](../operations/development-handoff-2026-10-05.md)。新增本地Agent执行与研究模块仍服从下列目录边界；本次Git备份包含累计迁移，未部署。

## 目录职责

| 位置 | 职责 | 进入 Pages |
| --- | --- | --- |
| index.html | 前端入口 | 是 |
| Bit交易决策平台.html | 兼容旧书签，跳转 index.html | 是 |
| assets/css/、assets/icons/ | 原样移动的样式与图标 | 资产清单内文件 |
| js/ | 页面、导航、数据请求、图表及Agent契约/界面 | 资产清单内.js/.mjs文件 |
| cloudflare/ | 行情、舆情 Worker、配置、数据库迁移 | 否 |
| cloudflare/snapshot/ | 独立市场快照程序、Worker、配置与 schema | 否 |
| cloudflare/finance/ | 免费金融通道目录、网关、按需 D1 最新响应存储与独立建表 SQL | 否 |
| config/pages-assets.json | Pages 资产清单 | 否 |
| scripts/build/、scripts/dev/ | 构建与日常开发工具 | 否 |
| scripts/agent-team/ | 本地Agent执行、工具、存储、方法及真实分析验收 | 否 |
| scripts/research/ | 资料导航、证据准备、报告导入 | 否 |
| scripts/diagnostics/、scripts/operations/ | 诊断、线上读回与有副作用的专项运维 | 否 |
| tests/unit/、tests/integration/、tests/browser/、tests/fixtures/ | 分层测试与固定样例 | 否 |
| docs/ | 架构、操作、治理记录与分类文档入口 | 否 |
| docs/research/bitcoin-upgrade/ | 升级研究总纲、主题路由、代码对应表、来源快照与原始ZIP | 否 |
| .codex/ | Codex 项目技能与配置 | 否 |
| .local/migration/ | 私密迁移原包、校验文件与恢复说明，仅本机 | 否 |
| docs/reference/project-skills/ | 保留的早期技能资料，不作为当前操作入口 | 否 |
| docs/reference/archive/ | 历史代码文本与早期参考 | 否 |
| dist/pages/ | 可再生网站发布产物 | 只上传其内容 |
| .artifacts/ | 浏览器报告、截图、测试夹具及日志 | 否 |
| .wrangler/、node_modules/、本地环境文件 | 缓存、依赖和本地配置 | 否 |

根目录保留常用启动入口与项目配置。npm 命令继续稳定；scripts/research-context.cjs 与 scripts/run-bounded.cjs 保留为简短兼容入口，实现分别在 research/、dev/。其他直接调用脚本的路径已经按分类同步到 package.json、现行说明、研究路由和测试。完整用途与副作用见 [脚本索引](../../scripts/README.md)，测试入口见 [测试分类](../../tests/README.md)。

## 2026-09-30 分层迁移

| 原位置 | 当前位置 |
| --- | --- |
| 根目录 styles.css、desk-ui.css | assets/css/ 同名文件 |
| 根目录 btc.svg | assets/icons/btc.svg |
| scripts/verify-*.cjs 离线检查 | tests/unit/ 或 tests/integration/ |
| scripts/ 的浏览器检查、固定样例 | tests/browser/、tests/fixtures/ |
| scripts/ 的构建、开发、研究、诊断、运维实现 | scripts/ 下对应职责目录 |
| docs/bitdesk-harness-guide.md | docs/operations/development-guide.md |
| docs/governance.md | docs/reference/history/governance-2026-09-16.md |
| 根目录私密迁移 ZIP、SHA-256、说明 | .local/migration/，按原文件移动，不读取内容 |

现有 `.env` 与 `.codex/ssh/` 保持原位置。`.local/` 同时受 Git 忽略、Wrangler 排除和 Vite 访问限制保护；发布仍只组装明确白名单，不会复制整仓。原始研究快照和 ZIP 不移动、不改写；[研究导航](../research/README.md) 区分当前入口、专题记录、设计资料与历史。

## 发布流程

1. npm run build：离线验证全部通过后构建 dist/pages/。
2. 构建器只从 config/pages-assets.json 收集入口、assets/ 清单文件和 js/。HTML 入口及 hash 保持原样；样式/图标引用使用分类后的 URL，样式版本为 20260930-layout1。
3. 入口引用未列入产物的本地脚本/样式/图片时构建失败；正常重建先完整复制到独立临时目录，再替换旧输出，避免复制失败留下半成品和过期文件残留。
4. npm run deploy:pages 重新生成产物，再上传 dist/pages/，随后沿用既有部署保留策略。不要直接向 Pages 上传仓库根目录。
5. Worker、D1 和本地文档独立于网站产物。本轮不恢复服务、不迁移远程数据库、不部署、不 commit/push。

目前前端和 Worker 未发现通过 Pages 读取本地提示文件、schema 或内部 Markdown 的运行依赖。以后若新增此类依赖，应将必要的公开资源明确加入资产清单，不能重新改成整仓复制。

## 2026-09-16 历史迁移

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
- docs/research/bitcoin-upgrade/：[升级研究资料入口](../research/bitcoin-upgrade/README.md)；设计、调查基线与历史资料分开，不代表已实施或已授权执行。
- docs/operations/：操作说明，不重复创造授权流程。
- docs/reference/history/governance-2026-09-16.md：早期业务治理证据。
- docs/reference/：历史参考，不属于当前规则。

## 验证与保留项

- npm run verify:pages 检查实际产物范围、旧入口、过期输出清理和漏列依赖；测试中的环境文件均为虚构哨兵，不读取真实凭据。
- npm run build 覆盖新目录下的快照、指标一致性、存取链路以及既有业务回归；语法检查明确覆盖 js/、scripts/、tests/、cloudflare/ 和 Vite 配置，包含 .mjs，不扫描生成产物或归档。
- BITDESK_UI_ROOT=dist/pages 时，npm run verify:ui 直接验收实际发布目录，而不是源目录。
- 迁移 SQL、PLANNED、旧 HTML 跳转与已有用户修改保留。
- 根目录旧日志、截图与快照缓存已归入 .artifacts/legacy/；新验收产物统一放 .artifacts/，全部不进入网站。

## 2026-09-30 本轮验收结果

- npm run build：通过完整离线回归，生成 39 个前端资产；资源清单使用 assets/ 下的新路径。
- npm run verify:dev：3 PASS、0 FAIL；验证入口、资源类型、公开 API 地址注入及私密文件访问隔离。真实私密文件只以 HEAD 验证拒绝访问，测试内容使用虚构哨兵。
- BITDESK_UI_ROOT=dist/pages npm run verify:ui：50 PASS、0 FAIL；Chromium 147.0.7727.15，桌面 1440×1000、手机 390×844，覆盖实际产物、图表库、页面导航、失败恢复与导出。
- npm run verify:research-ui：4 个桌面/手机研究流程通过，覆盖事件、舆情、历史兼容及研究工具。
- 研究导航检查：313 个文件、20 条路由、27 个查询用例通过。路径核对通过 71 个公开文件迁移、17 个相对导入和 58 个 npm 脚本目标；npm 命令名称保持原样。
- 样式与图标内容、js/、cloudflare/、原始研究 sources/ 与 archives/ 均保持原样；三个私密迁移文件按原文件移动并确认被 Git 忽略。
- 首次完整界面验收通过 40 项后，因沙箱拒绝下载固定版本图表测试库而中止；允许该公共下载后同一验收全部通过。开发自检也因 esbuild 的父目录读取限制使用了获批执行。此处不代表真实线上行情可用。
- 日志见 .artifacts/reorganization/，浏览器报告见 .artifacts/pages-artifact/results.json。下一步继续按当前开发计划工作；本轮没有部署、远程写入、commit 或 push。

## 2026-09-16 历史验收结果

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

## 2026-09-16 升级研究资料归档补记

本次仅整理资料。上面的构建/UI记录属于此前文件治理工作，不是本次重新执行的结果。

| 原位置 | 新位置 |
| --- | --- |
| 根目录 bitcoin_research_final_2026-09-16.zip | docs/research/bitcoin-upgrade/archives/ 原名保存 |
| ZIP内 bitcoin_research_final_2026-09-16/ | docs/research/bitcoin-upgrade/sources/2026-09-16/，完整保留内部结构和219个文件 |
| 根目录 bitcoin_research_evidence_review_2026-09-16.md | docs/research/bitcoin-upgrade/repository-baseline/ 原名保存 |
| 根目录 bitcoin_research_repository_response_2026-09-16.md | docs/research/bitcoin-upgrade/repository-baseline/ 原名保存 |

新增[总纲](../research/bitcoin-upgrade/README.md)、[阅读路由](../research/bitcoin-upgrade/READING_ROUTES.md)与[仓库对应表](../research/bitcoin-upgrade/REPOSITORY_MAP.md)。研究包中的SQL、Schema、示例和检查脚本保留在资料目录，未并入运行代码、迁移或默认测试。没有变更Pages资产清单，也未部署。
