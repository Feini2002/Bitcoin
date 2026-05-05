# GitHub 源码备份与工作流约定

本文件专用于：**把本仓库与 GitHub 上的远程快照对齐**，与 Cloudflare 线上环境互为备份；需要回档或换机器时，可直接克隆远程仓库还原当时已推送的源码。

本文档内容与 `.cursor/rules/auto-build-deploy.mdc`、`AGENTS.md` 部署章节一致收口；若在 Cursor Agent 收尾顺序上有歧义，**以 Cursor 规则与 AGENTS.md 中的验证／部署条目为准**，本文档补足 **Git／GitHub** 段落。

---

## 远程与工作区克隆前提

| 项目 | 说明 |
|------|------|
| 默认远程 | `origin` → `https://github.com/Feini2002/Bitcoin.git`（私有仓库时，克隆与推送均需已登录/Git 凭据或 SSH）。 |
| 默认分支 | `main` |
| 敏感信息 | 勿提交令牌、密钥或未纳入 `.gitignore` 的环境文件（如 `.env`）；以根目录 `.gitignore` 为准。 |

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
3. **GitHub 推送逻辑与脑内决策树（Agent 必须执行的判断）**  
   Agent 在执行 Git 备份前，**必须**在后台（脑内）按以下逻辑走一遍，收束行为边界：

   **步骤 1：判断目标分支 (Main vs Branch)**
   - **默认推 `main` 的条件**：本次改动范围小且明确、已完整完成 `.cursorrules` 与 `AGENTS.md` 要求的克隆侧验证与按需部署、功能不破坏现有业务逻辑。
   - **必须建新分支的条件**（分支名使用 `feat/YYYYMMDD-简述` 或 `fix/YYYYMMDD-简述`）：
     1. 实验性修改、试错性质的代码或大规模重构；
     2. 由于环境限制或报错，未能跑通所有校验验证，有把线上环境弄坏的风险；
     3. 任务本身还没做完，只是为了换设备而做的“阶段性保存”；
     4. 当前 `main` 拉取时遇到严重冲突，需要单独分支承载本次改动避免阻塞主线。

   **步骤 2：撰写 Commit 信息规范**
   - 必须采用结构化规范格式：`<type>(<scope>): <subject>`
     - `type`: `feat` (新功能), `fix` (修复), `docs` (文档), `style` (格式), `refactor` (重构), `chore` (日常/配置维护)。
     - `scope`: 影响的模块名，例如 `worker`, `chart`, `news`, `ui`, `cf` 等。
     - `subject`: 用精简的中文描述做了什么（例如“新增足迹图的买卖失衡计算”或“修复 D1 写入超时的 bug”）。
   - **禁忌**：不写过于细碎或无意义的说明（如“update file”、“修改了若干文件”、“Fix bug”），必须切中本次任务的核心业务价值。

   **步骤 3：执行同步与推送 (Sync & Push)**
   - **若判定在 `main` 提交**：
     1. 先 `git pull --rebase origin main` 拉取远程最新变化防覆盖；
     2. 若遇简单冲突，优先尝试解决；若冲突严重复杂，放弃 rebase，转为新建分支提交；
     3. 成功后 `git push origin main`。
   - **若判定在新分支提交**：
     1. 检出并提交 `git checkout -b <branch-name>`；
     2. 推送 `git push -u origin <branch-name>`。

**不包含代码变更的对话**（仅答疑、查阅）：不强制 commit／push。

**异常退出机制**：若部署或验证在克隆工作区彻底失败，且不符合「阶段性保存」的诉求，必须向用户汇报失败原因；在未确认修复前不要强行合入 `main`，以免把明显坏的状态推上去。

---

## 与用户手工流程的关系

- 你在工作区也可用 GitHub Desktop、`git gui` 等工具完成同样操作；正文约定的是 **Cursor Agent 自动收尾**时应遵守的顺序。  
- 若你希望某次改为「先开分支再合并」，须在任务中说明；默认 **直接更新 `main` 并推送** 以降低步骤数。

---

## 回档与检出

- **按提交恢复**：在克隆仓库中用 `git log` 找到目标提交后检出该提交或基于该提交开分支（具体命令依你使用的 Git 客户端而定）。  
- **整库回到远程状态**：`git fetch origin` 后将当前工作区的 `main` 重置到 `origin/main`（会丢弃尚未推送的那部分提交记录，执行前需自行确认）。  

详细 Git 命令请使用你习惯的文档或客户端；本文件只固定 **「改完 → 校验 → CF 部署 → 推 GitHub」** 的职责边界。

---

## 修订记录

- 增加本工作流：与 Cloudflare 部署规则并列，作为 Agent 默认收尾的一部分。
