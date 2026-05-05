# GitHub 源码备份与工作流约定

本文件专用于：**把本仓库与 GitHub 上的远程快照对齐**，与 Cloudflare 线上环境互为备份；需要回档或换机器时，可直接克隆远程仓库还原当时已推送的源码。

本文档内容与 `.cursor/rules/auto-build-deploy.mdc`、`AGENTS.md` 部署章节一致收口；若在 Cursor Agent 收尾顺序上有歧义，**以 Cursor 规则与 AGENTS.md 中的验证／部署条目为准**，本文档补足 **Git／GitHub** 段落。

---

## 远程与本机前提

| 项目 | 说明 |
|------|------|
| 默认远程 | `origin` → `https://github.com/Feini2002/Bitcoin.git`（私有仓库时，克隆与推送均需已登录/Git 凭据或 SSH）。 |
| 默认分支 | `main` |
| 敏感信息 | 勿提交令牌、密钥、本地 `.env`；以根目录 `.gitignore` 为准。 |

若在其它机器首次拉代码：克隆上述仓库后再按 `README`/项目说明安装依赖与配置环境变量。

---

## Cursor Agent / 托管 Agent 收尾顺序（写死约定）

在用户未另行指定时，**由 Agent 对本仓库所做、且确有工作区文件变更的任务**，收尾顺序固定为：

1. **校验**（与 `.cursor/rules/auto-build-deploy.mdc` 一致）  
   - 至少：`npm run lint`  
   - 按改动范围补足：`verify-indicator-math`、`verify:footprint`、`verify:api` 等（以 `AGENTS.md` 验证矩阵为准）。
2. **Cloudflare**  
   - 按既有规则：**先需部署的 Workers（含按需 D1）→ 再按需 `npm run deploy:pages`**。  
   - 前端/静态入口若改过，须在 `index.html` 等资源上提升 `?v=` 后再上传 Pages。
3. **GitHub 推送（本增量）**  
   - **仅当**：本次任务对上述步骤之前已产生了**应向用户交付的仓库文件变更**，且未完成推送。  
   - **若**：用户明确说「本轮不要推送 / 只做本地」，则跳过本节并在回复里说明。
   - 建议步骤（按实际环境任选 HTTPS 认证或 SSH，路径含空格时注意引号或使用 `git -C "<仓库根路径>"`）：  
     - `git status` 核对变更范围。  
     - `git add`／`git commit`：提交信息简述本次功能或修复（可中文短句）。  
     - **推送前**若你与协作者共用 `main`：可先 `git pull --rebase origin main`（有冲突须在回复中标明，由人工或后续一轮解决）。  
     - `git push origin main`（或已与 `origin/main` 建立跟踪等价命令）。  

**不包含代码变更的对话**（仅答疑、查阅）：不强制 commit／push。

**部署或校验在本机失败时**：仍以回复说明失败原因为主；在未确认修复前可不 push，以免把明显坏的状态推上去；若本轮仅有文档/脚本修正且无部署责任，仍可单独 commit/push。

---

## 与用户手工流程的关系

- 你在本机也可用 GitHub Desktop、`git gui` 等工具完成同样操作；正文约定的是 **Cursor Agent 自动收尾**时应遵守的顺序。  
- 若你希望某次改为「先开分支再合并」，须在任务中说明；默认 **直接更新 `main` 并推送** 以降低步骤数。

---

## 回档与检出

- **按提交恢复**：在本机 `git log` 找到目标提交后检出该提交或基于该提交开分支（具体命令依你使用的 Git 客户端而定）。  
- **整库回到远程状态**：`git fetch origin` 后将本地 `main` 重置到 `origin/main`（会丢弃未推送的本地提交，执行前需自行确认）。  

详细 Git 命令请使用你习惯的文档或客户端；本文件只固定 **「改完 → 校验 → CF 部署 → 推 GitHub」** 的职责边界。

---

## 修订记录

- 增加本工作流：与 Cloudflare 部署规则并列，作为 Agent 默认收尾的一部分。
