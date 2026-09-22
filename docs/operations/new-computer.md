# 新电脑开发与敏感配置迁移

## 安装和启动

1. 安装 Git 和 Node.js 24（本次使用 24.14.1；版本记录在根目录 .node-version）。
2. 克隆 https://github.com/Feini2002/Bitcoin.git，进入仓库根目录。
3. 执行 `npm ci --include=dev`，按 package-lock.json 安装完整开发依赖。无需全局安装 Vite、Playwright 或 Wrangler。
4. 执行 `npm run dev:local`。Windows 也可双击 start-local-cloud.bat；依赖缺失时会按锁文件安装。
5. 默认在本机 http://127.0.0.1:5173/index.html 打开页面。端口占用时以终端显示为准，Ctrl+C 结束。

源码、页面壳和离线回归无需 API 密钥；真实行情、报告和模型调用取决于相应服务与凭据，克隆源码不会复制远程 D1 数据。

## 本地敏感配置

- 仓库根目录 `.env` 是业务密钥的主存放处。旧电脑已有该文件时直接单独拷贝到新克隆的仓库根目录，不要用模板覆盖它。
- 出口机 SSH 私钥不写进 `.env` 正文，而在 gitignore 的 `.codex/ssh/bitdesk_egress_ed25519`。换电脑时与 `.env` 一起拷贝，否则连不上东京出口机。
- 没有旧文件时，复制 `.env.example` 为 `.env`，再填入实际需要的值。模板只记录名称，不含真实密钥。
- 本次整理时本地仅发现 GEMINI_API_KEY。其他名称是可选配置说明，空白或未填不表示已从云端备份。
- 本次只读查询舆情 Worker Secrets 名称包含 GEMINI_API_KEY、FINNHUB_API_KEY、CODEX_BRIDGE_TOKEN。后两项未在本地发现原值；CODEX_BRIDGE_TOKEN 属于已退役通道，不是新电脑开发必需项。本次未删除、轮换或导出云端 Secrets，也未验证本地 Gemini 值与云端值是否相同。
- `.env`、环境变体、.dev.vars、私钥、本地数据库、日志、浏览器产物均被 Git 忽略。Pages 只发布 dist/pages/ 中的明确资产清单，不会上传这些开发文件。
- 不把密钥改名为 VITE_ 开头的变量；该前缀用于暴露给浏览器的配置。
- GitHub 与 Wrangler 的登录由各自工具保管，新电脑重新登录；不把 OAuth 缓存、SSH 私钥或 Codex 登录资料拼入 .env。
- Cloudflare 已部署的加密 Secrets 不能按此文件自动导出。只有保存在旧电脑或密码管理器中的原始值才能迁移；缺失值需要在原服务重新取得或生成。
- `npm run cf -- ...`、Pages 发布命令会加载根目录 .env。单独运行需要密钥的 Node 运维脚本时，使用 `node --env-file-if-exists=.env scripts/脚本名.cjs`。

## 本地 Worker 联调（可选）

- 先准备根目录 .env；分别运行 `npm run dev:btc` 与 `npm run dev:yuqing`，监听 8787 与 8788。两个命令显式使用同一个 .env，并启用 --local；不会自动部署或执行远程 D1 迁移。
- 在 .env 填写公开地址 BIT_DATA_API_BASE=http://127.0.0.1:8787 与 BIT_YUQING_API_BASE=http://127.0.0.1:8788，再重启前端。仅这两个地址被注入浏览器，密钥不会注入。
- 本地 D1 初始为空。按 cloudflare/schema.sql 和对应迁移准备本地结构；需要历史行情或历史报告时另行准备数据，不能把空库启动当作完整业务联调成功。
- 默认不填地址覆盖时仍访问 js/config.js 中的云端地址。仓库的暂停记录是历史记录，本地 Wrangler 配置目前声明启用；操作云端前核对实时状态，不因换电脑自动恢复、暂停或改写服务。

## 验证

- `npm run build`：离线回归和网站产物构建。
- `npm run setup:browser`：安装项目 Playwright 对应的 Chromium，不依赖机器上是否安装 Chrome。
- `npm run verify:dev`：开发服务器入口、API 地址注入和 .env 访问隔离。
- `npm run verify:ui`：固定数据的桌面与移动界面流程。
- `node scripts/verify-yuqing-cloud-ui.cjs`：舆情设置与报告流程固定数据验收。
- `npm run verify:api`：额外的线上只读探测；网络或服务异常与离线构建结果分开记录。
- 自动化长任务可用 `node scripts/run-bounded.cjs 180 npm run build`；该命令有内部截止并记录本次父子 PID。

## 运维与发布

- 新电脑先执行 `npm run cf -- login` 登录 Cloudflare，或在根目录 .env 配置所需 CLOUDFLARE_API_TOKEN 与 CLOUDFLARE_ACCOUNT_ID；无需复制登录缓存。
- `npm run build` 后通过 `npm run deploy:pages` 发布，默认清理超出保留数量的历史 Pages 部署。
- Worker 配置、D1 资源标识和迁移 SQL 随源码保存；标识不是访问凭据。发布、远程写入和暂停/恢复遵循 AGENTS.md 及当前用户授权。
- collect-market-local.cjs 是有远程 D1 写入的专项采集脚本，不属于开发启动。它使用锁定版本 Wrangler 的内部接口，升级 Wrangler 时需复核；本次只消除全局安装路径依赖，未执行采集。

## Windows 沙箱故障

本次机器上 Codex 沙箱日志报告仓库根目录和 .codex 子目录无法写入 ACL（SetNamedSecurityInfoW failed: 5）。两个目录归管理员组所有，非管理员进程没有修改权限表的能力。用户切换完整访问后命令已恢复，但这不等于原沙箱配置修复。换电脑时建议在当前用户拥有的开发目录克隆，并完成 Codex 正常沙箱设置；不需把旧机器的 ACL、沙箱账户或缓存复制过去。
