# 旧日报系统（`ribao-cloudflare/index.html`）LLM 模块拆解与 Mock 参照

本文从 **`舆情/日报/ribao-cloudflare/index.html`（旧独立单页）** 抽取各模块职责、调用顺序与 **LLM 输出契约**，供调整 **`js/pages/events.js` / `news.js` 的 mock** 时对齐「叙事粒度与条数习惯」。**现行 BitDesk 事件一览并不渲染该 HTML**；Worker 内 prompt 与拼装以 **`cloudflare/yuqing-worker.js`** 为准。

---

## 1. 文档目的（给 Agent 怎么用）

- 设计 **前端 mock**：字段粒度、中英文标签、段落结构、列表长度应与下表一致，避免云上 JSON 回来之后 UI 留白或错乱。
- 修改 **prompt**：应编辑 Worker 内的 `buildFlashPrompt`、`buildProNewsPrompt`、`buildProAIPrompt`、`buildProTrendsPrompt`（与 ribao HTML 同名逻辑），不要把本文件当可执行源码。
- **不要**假定旧页的 API 网关（如 `GEMINI_BASE`）、模型名列表与现行部署一致——仅继承 **语义与版面契约**。

---

## 2. 页面模块与可见性开关

设置面板「模块可见性」与 DOM 对应关系（隐藏则**不发起**该路 LLM）：

| 开关标签     | 区块 ID / 容器        | 说明 |
|--------------|------------------------|------|
| 顶部仪表盘   | `#dashboard`           | 情绪指数 + 核心资产 + 跨资产信号（来自 Flash **JSON**，非 Markdown） |
| 今日头条     | `#news-section` / `#report-news` | Markdown，多头条可分页 |
| 动态速览     | `#timeline-section` / `#report-timeline` | Markdown |
| AI 情报站    | `#ai-section` / `#report-ai` | Markdown |
| 趋势研判     | `#trends-section` / `#report-trends` | Markdown，**依赖**前三类正文 + Flash JSON 文本 |

「极速 / 深度」模式影响 **新闻、AI、趋势** 所用 Gemini 模型档位；**Flash** 在旧页中单独走 `gemini-3.1-flash-lite-preview` 的 **非流式 generateContent**（与 Worker 可调模型变量名不一定相同）。

---

## 3. 数据准备（非 LLM，LLM 的输入上下文）

在进入任何 prompt 之前，脚本会按需拉取：

- **Alternative.me**：恐慌贪婪指数分值与档位（传给 Flash 与各 Pro prompt 的综述句）。
- **行情**：纳斯达克/标普/NVDA/BTC/黄金等 **24H 涨跌**（Finnhub 批量 + CoinGecko 等兜底），填入 `realMarketData`，且在 Flash prompt 中标明「数字已确认，勿猜」。

**Mock 推论**：若在 BitDesk mock 里也展示「温控 / 风险偏好」，应能对应到 **`sentiment_summary` + `market_regime`** 或 Worker 侧的等价 dashboard 字段，数值与叙事勿自相矛盾。

---

## 4. 运行时序与依赖（谁先谁后）

1. **并行（在仪表盘或宏观任一需要时先做）**  
   - **Flash**：`buildFlashPrompt` → 解析模型返回的 **JSON**（旧页常为带围栏代码块）→ 驱动 gauges、`key_assets` 卡片、跨资产三列（regime / anomaly / suggestion）。  
   - **宏观稿（今日头条 + 动态速览合一请求）**：`buildProNewsPrompt`，**启用 Google Search**，流式回填；正文按 **`===SPLIT===`** 拆成两段，分别塞进 `#report-news` 与 `#report-timeline`。  
   - **AI 情报**：`buildProAIPrompt`，**启用 Google Search**，流式回填 `#report-ai`。

2. **串行**  
   - **趋势研判**：仅当 **宏观稿完成** 且 **AI 稿完成** 后（若对应模块可见），用 `buildProTrendsPrompt(news, timeline, ai, flashJsonText)`，**不启用搜索**，流式回填 `#report-trends`。

**Mock 推论**：`trendRead` 若类比旧页「三块趋势」语气，应与头条 / 速览 / AI **叙事一致**。注意：**现行 API** 里事件一览用 **`trendRead.cracking`**，舆情分析用 **`trendRead.fracturing`**（键名不同，勿混用）。

---

## 5. 各模块契约（产品经理视角）

### 5.1 Flash · 市场情绪与核心资产（**JSON**，非 Markdown）

- **检索**：不要求 Google Search（纯数值 + LLM 补叙）。  
- **输出**：一个 **JSON code block**，字段语义如下（占位符说明模型应用自然语言填空）：
  - `sentiment_summary`：一句话市场情绪，约定 **≈20 字内**。
  - `market_regime`：枚举口吻四选一：**追逐风险 / 回避风险 / 结构分化 / 防御轮动**。
  - `key_assets`：长度 5，与 **纳指、标普500、英伟达、比特币、黄金** 顺序一致；每项含 **`name`、`change`（数值与输入一致）、`catalyst`（约 30 字）、`structure`（约 35 字）**。
  - `cross_asset`：跨资产综述，约定 **≈60 字内**。
  - `anomaly_alert`：背离/异动，约定 **≈50 字内**，无则 **`无明显背离`**。
  - `action_suggestion`：小白向关注/操作建议，约定 **≈40 字内**。

在 **ribao 单页**内，前端把该 JSON **解析成图表与三列文案**。

**与现行 mock 对齐（勿一比一照搬 UI）**：Worker 把这些字段吸入 **`daily_event.report.marketTemperature`** 等温控文案，以及 **舆情页** **`marketState` / `riskRadar`** 的语气；事件一览 **不**再放「五条 key_assets 横条控件」。Mock 侧重 **字数、regime 四选一语感、摘要与告警是否同人**，不必伪造 ribao 专有的 ECharts 结构。

---

### 5.2 今日头条 + 动态速览（**同一 prompt**，Markdown，`===SPLIT===`）

- **检索**：Google Search ON。  
- **硬性分隔**：模型先写 **今日头条** 部分，完毕单独一行 **`===SPLIT===`**，再写 **动态速览**。前端用该分隔符切段，不要用「第二个 ##」偷懒假设。  
- **今日头条**要点：
  - **双轨**：72 小时热点 + 一周内「碾压级」长尾（地缘/系统性风险等），后者标 **`[持续追踪]`**。  
  - **条数**：默认 1 条头条为主；多台独立大单事件时 **最多 3 条**，且须先判断是否同一宏观主轴，能合并则合并。  
  - **每条 Markdown 骨架**：
    - `### [事件类别] 事件核心标题`
    - `**【事实锁定】**`：单句，不换行堆砌多段。  
    - `**【结构拆解】**`：三项 **直接触发原因 / 深层结构性矛盾 / 声明与行动的差异**（列表 `- **…**`）。  
    - `**【传导预判】**`：高/中/低概率情景三项。  

- **动态速览**要点：
  - 内部：**强制搜索 → 1–10 加权打分 → 去重验真 → 输出 5 条**。  
  - **类别**：地缘政治 / 宏观经济 / 科技产业 / 加密市场 / 企业动态 / 政策监管。  
  - **每条**：`### [类别] 事件标题`，随后 **`**事件**：…`** 与 **类别模板**在同一行延展（`**博弈方…**`、`**已定价…**` 等），末尾同一行收口 **`**⏰ 48-72h观察点**：升级/结束条件`，**不许另起标题行**.  
  - **篇末**：单独一段 **`**宏观趋势总结**`**。

**Mock 推论**（映射到 **`events.js` 结构化日报**）：  
`topStory` ≈ **一条**今日头条（`category/title/fact/structure[]/transmission[]` 对应 事实锁定/拆解要点/传导）；`dynamicBriefs[]` ≈ 动态速览 **5 条尺度** 的缩略版（`category/title/body/watch`）；`watch` 常可对应 48–72h 观察语言。

---

### 5.3 AI 情报站（Markdown，产业工具向）

- **检索**：Google Search ON。  
- **时间窗**：**72 小时内**；严禁把旧模型预热、数月旧闻充数。  
- **受众**：会用 AI 的普通用户，重「**对我有什么用**」，轻参数堆叠。  
- **拒答**：无重磅则输出 **`近72小时暂无改变行业的重大AI发布`**。  
- **条数**：通常 **3–5 条**（实在没有可少于 3）。  
- **单条骨架**：
  - `### [公司名/工具名] 核心变化一句话总结`
  - `**发布日期**` / `**新了什么**` / `**对我有什么用**` / `**值得关注的程度**`（高/中/低）  
- **篇末**：追加一段 **`**AI工具近期方向总结**`**。

**Mock 推论**：`aiIntel[]` 数组项可对应 `title/date/what/use/attention`；与旧 Markdown 的「新了什么 / 对我有什么用」语义对齐。

---

### 5.4 趋势研判（Markdown，**无搜索**）

- **输入**：已生成的 **今日头条全文、动态速览全文、AI 情报全文**，以及可选 **Flash JSON 原文**作「基础市场行情状态」。  
- **输出三块**（含 emoji 标题，便于人眼与 CSS 区分）：
  1. `### 📶 正在强化的信号` — **2–3 段**，段间空行；区分范式转移 vs 噪音。  
  2. `### ⚡ 正在裂变的信号` — **1–2 段**；没有则明确写 **暂无明显裂变信号**。  
  3. `### 🎯 48-72h观察清单` — **3–5 条**列表，每项格式：  
     `- **事件/数据名称**：观察什么？若…则…；若…则…`（**不换行拆步骤**）。

**Mock 推论**：**舆情分析** mock 用 **`strengthening` / `fracturing` / `checklist`**；**事件一览**用 **`strengthening` / `cracking` / `conclusion`**（与 Worker `daily_event` 一致）。条数与语气可参照上表三段式习惯。

---

## 6. 前端 Markdown 渲染约定（旧页行为，改 mock 时避免踩坑）

- **标题修复**：`###` 后若缺空格，渲染前会正则补空格。  
- **去重卡片标题**：正文中若重复 `##/### 今日头条|动态速览|AI情报站|趋势研判`，会剥离，因 UI 已有大标题。  
- **头条分页**：`###` 分段；首段非 `###` 时会拼到下一段，支持「导读+首条」脏格式。  
- **加粗修复**：对 `【事实锁定】` 等标签做统一加粗与空行，缓解模型粘连输出。  
- **流式输出**：趋势/新闻等用 `streamGemini`，途中会剥掉误嵌的 JSON 围栏残留。

**Mock 推论**：若 mock 走 **HTML 模板** 而非 Markdown，仍建议在 **copy 字段** 上保留 **相同小标题语感**（如 **【事实锁定】**），便于日后切 Markdown 或 Worker 回填。

---

## 7. 与现行双子页面（BitDesk）的对应关系

| 旧 ribao 模块 | Worker / 现行行为（概念） | 前端主要消费 |
|---------------|---------------------------|--------------|
| Flash 仪表盘 | `buildReport` 解析入 `dashboard`，再映射到 `daily_event.report.marketTemperature` 等；舆情侧参与 `marketState` | `events.js` 温控区；`news.js` `marketState` |
| 今日头条 + 动态速览 | **`daily_event.report` 卡片以 D1 事实池拼装为主**（`topStory` / `dynamicBriefs`）；`sections.news|timeline` Markdown **不**再整段渲染在事件一览页 | `events.js` |
| AI 情报站 | 事实池 `aiIntel` + legacy `sections.ai` 综合 | `events.js` / `news.js` 的 `aiIntel` |
| 趋势研判 | `sections.trends` 影响摘要；结构化输出为 **`trendRead`**（键名见上文 **cracking / fracturing**） | `events.js` / `news.js` 各自 `trendRead` |

舆情分析页独有：**`upstreamDaily`、`riskRadar`、`opportunityScanner`、`eventCalendar` 等**；旧 ribao 无对等区块——mock 时保持 **条件列表、观察窗口字级** 与 prompt 习惯一致即可。

---

## 8. 修订记录

- **2026-05-05（校）**：纠正 **trendRead** 键名（`cracking` vs `fracturing`）；明确 **事件一览以事实池卡片为主、不渲染 ribao 整段 Markdown**；弱化「Flash 与 mock 控件一一对应」表述；去掉文内破损的围栏片段。
- **2026-05-05**：初版——自 `ribao-cloudflare/index.html` 拆解模块与契约。

---

更多部署与双层日报流水线见仓库 **`舆情/脚手架搭建.md`**。
