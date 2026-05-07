import { bjtDateLabel, cleanText, markdownTitle, normalizeSourceName, normalizeSourceUrl } from "./shared.js";

export function buildDailyAiIntelPrompt(timeStr) {
  return (
    "当前时间：" +
    timeStr +
    "。\n" +
    "你是全球前沿 AI 生态的『首席侦察官』与『生产力工具主编』。你的读者已经对各大厂底层大模型（如 GPT-4, Gemini 3.1, Claude 3.5）的基础能力烂熟于心。请使用 Google Search 扫描过去 72 小时内能真实改变工作流的 AI 突变，萃取 4~5 条高纯度的硬核情报。\n\n" +
    "【一、 选材红线与生态倾斜（宁缺毋滥）】\n" +
    "1) 摒弃底层跑分：不要给我看大模型之间枯燥的 Benchmark 跑分或基础参数对比（除非是革命性突破）。读者更关心“基于大模型长出的新工具和新生态”。\n" +
    "2) 聚焦产品链与工具链：重点捕捉头部模型的**周边生态完善**、**产品联动**、**插件/Skill/API 工具链增强**、**Agentic 框架（智能体开发）**、以及类似 Cursor/GitHub Copilot 等超级应用的新功能落地。\n" +
    "3) 实用至上：必须是读者“今天就能用”或“马上能接入工作流”的更新。坚决屏蔽纯资本融资宣发、PPT概念和无聊八卦。\n\n" +
    "【二、 深度拆解（情报体规范）】\n" +
    "每条情报必须剔除公关废话，保持极度冷峻的客观描述：\n" +
    "- title：极简硬核标题，不超过 26 个字。公式：生态/工具名 + 最关键动作/突破。\n" +
    "- date：确切的发布或披露日期。\n" +
    "- coreFact (核心突破)：只讲干货。它引入了什么新的 API 机制？提供了什么新工具集？与其他产品产生了怎样的联动？\n" +
    "- actionableValue (落地价值)：它能帮开发者/创作者省掉什么步骤？扩展了什么应用边界？写出 1~2 个最致命的实际业务场景。\n" +
    "- rating (关注评级)：只能是「S级」(重塑工作流/立刻接入)、「A级」(生态重要拼图/大幅提效) 或「B级」(值得记录的更新)。\n\n" +
    "【三、 侦察搜寻路径】\n" +
    "建议交叉检索：\n" +
    "1) 生态与工具链：'Gemini extension update' / 'OpenAI function calling update' / 'Claude computer use' / 'Agentic framework release' / 'LangChain/LlamaIndex update'\n" +
    "2) 开发与工作流：'Cursor feature update' / 'Notion AI integration' / 'Vercel AI SDK update' / 'GitHub Copilot workspace'\n" +
    "3) 官方动向：site:openai.com/blog OR developers.googleblog.com OR anthropic.com/news\n\n" +
    "【四、 格式输出】\n" +
    "仅输出一个 JSON 代码块，顶层字段为 aiIntel（数组，4~5 条）。每条必须包含：\n" +
    "title, date, coreFact, actionableValue, rating, sourceName, sourceUrl。\n" +
    "记住：你的受众是高阶开发者与 AI 重度用户，只喂给他们“能直接武装到牙齿”的生态工具与能力扩展。"
  );
}

export function normalizeDailyAiIntelItems(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const it of arr.slice(0, 5)) {
    if (!it || typeof it !== "object") continue;

    const ratingRaw = cleanText(it.rating || it.attention || it.level || "B级", "B级", 16);
    let rating = "B级";
    if (/S级|高/.test(ratingRaw)) rating = "S级";
    else if (/A级|中/.test(ratingRaw)) rating = "A级";
    else if (/B级|低/.test(ratingRaw)) rating = "B级";
    else rating = ratingRaw;

    out.push({
      title: cleanText(it.title || it.headline, "AI 动态", 200),
      date: cleanText(it.date || it.publishDate || "", bjtDateLabel(), 48),
      coreFact: cleanText(it.coreFact || it.what || it.news || it.summary, "", 500),
      actionableValue: cleanText(it.actionableValue || it.use || it.valueForUser || it.impact, "", 500),
      rating,
      sourceName: normalizeSourceName(it.sourceName || it.source || "Google 检索", "Google 检索"),
      sourceUrl: normalizeSourceUrl(it.sourceUrl || it.url || ""),
    });
  }
  if (!out.length) {
    return [
      {
        title: "近72小时暂无 S/A 级重大 AI 发布",
        date: bjtDateLabel(),
        coreFact: "侦察雷达未命中符合时间窗与硬核落地标准的条目。",
        actionableValue: "保持工作流原样，等待下一波技术突破。",
        rating: "B级",
        sourceName: "Yuqing Worker",
        sourceUrl: "",
      },
    ];
  }
  return out;
}

export function renderDailyAiIntelMarkdownForTrends(items) {
  return (items || [])
    .map((item) => {
      const fact = item.coreFact || item.what;
      const value = item.actionableValue || item.use;
      const rate = item.rating || item.attention;
      return [
        `### ${markdownTitle(item.title, "AI 情报")}`,
        `发布日期：${cleanText(item.date, "", 48)} · 评级：**${cleanText(rate, "B级", 16)}**`,
        `核心突破：${cleanText(fact, "暂缺细节", 400)}`,
        `落地价值：${cleanText(value, "暂缺落地场景推演", 400)}`,
      ].join("\n\n");
    })
    .join("\n\n")
    .trim();
}
