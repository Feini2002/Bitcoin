import { bjtDateLabel, cleanText, markdownTitle, normalizeSourceName, normalizeSourceUrl } from "./shared.js";

export function buildDailyGithubToolsPrompt(timeStr) {
  return (
    "当前时间：" +
    timeStr +
    "。\n" +
    "你是面向前沿开发者的『AI 兵器谱情报官』。请严格遵循“双重验证”搜索策略，寻找并推荐过去 14 天内出现的新工具、MCP Server、Agent 框架或 IDE 插件。\n\n" +
    "【一、 强制双重验证搜索策略】\n" +
    "1) 第一层搜索：必须先限定只在 GitHub (site:github.com) 内搜索“能显著提升 AI Coding (Vibecoding) 效率的”内容（如果不确定有没有，尽力去搜）。\n" +
    "2) 第二层验证：对搜到的 GitHub 项目，必须再去 X (Twitter)、Hacker News、Reddit 等社交媒体进行热度验证，确认它们在开发者社区确实被热议。\n" +
    "3) 筛选：只提取在 GitHub 上有产出且在社媒上重合度、热度较高的 3-5 条硬核工具。\n\n" +
    "【二、 选材红线与优先级】\n" +
    "1) 唯一来源：最终输出的内容必须完全基于 GitHub 上的项目。\n" +
    "2) 拒绝玩具：必须是有 README、普通开发者能直接跑通，或直接接入 Cursor / VS Code 等生态的实用工具。\n" +
    "3) 严控时间：只能是过去 14 天内新建、首发或产生重大质变更新的项目，禁止拿旧项目凑数。\n\n" +
    "【三、 深度拆解结构】\n" +
    "每条工具以极简干练口吻写出：\n" +
    "- title：工具名 + 一句话定位（不超过 28 个字）。\n" +
    "- repo：GitHub 仓库全名（如 owner/name）。\n" +
    "- target：适配的生态（如 Cursor, Claude Code, MCP, VS Code, 或通用命令行）。\n" +
    "- date：最近的开源日期或在社区引爆讨论的日期。\n" +
    "- whyUseful：核心痛点击穿。为什么在社媒火了？它帮 AI 程序员解决了什么恶心的问题？\n" +
    "- howToUse：新手第一步怎么跑？\n" +
    "- rating：只能是「S级」(神仙工具)、「A级」(极大提效) 或「B级」(潜力股)。\n\n" +
    "【四、 输出格式】\n" +
    "仅输出一个 JSON 代码块，顶层字段为 githubTools（数组，精选 3~5 条）。每条必须包含：\n" +
    "title, repo, target, date, whyUseful, howToUse, rating, sourceName, sourceUrl。\n" +
    "注意：sourceUrl 必须提供绝对有效的 GitHub 官方仓库链接（格式 https://github.com/...），不得提供其他任何网站的链接。"
  );
}

export function normalizeDailyGithubToolItems(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const it of arr.slice(0, 5)) {
    if (!it || typeof it !== "object") continue;
    
    const ratingRaw = cleanText(it.rating || it.fit || it.level || "B级", "B级", 16);
    let rating = "B级";
    if (/S级|高/.test(ratingRaw)) rating = "S级";
    else if (/A级|中/.test(ratingRaw)) rating = "A级";
    else if (/B级|低/.test(ratingRaw)) rating = "B级";
    else rating = ratingRaw;

    out.push({
      title: cleanText(it.title || it.name || it.repo, "GitHub AI 工具", 160),
      repo: cleanText(it.repo || it.repository || "", "", 120),
      target: cleanText(it.target || it.platform || it.for || "通用", "通用", 80),
      date: cleanText(it.date || it.updatedAt || it.releaseDate || "", bjtDateLabel(), 48),
      whyUseful: cleanText(it.whyUseful || it.value || it.use || it.summary, "适合作为 AI coding 工作流候选工具继续核验。", 360),
      howToUse: cleanText(it.howToUse || it.install || it.nextStep || it.try, "先打开 README，确认安装方式和适配环境。", 260),
      rating,
      sourceName: normalizeSourceName(it.sourceName || it.source || "GitHub", "GitHub"),
      sourceUrl: normalizeSourceUrl(it.sourceUrl || it.url || it.githubUrl || ""),
    });
  }
  if (!out.length) {
    return [
      {
        title: "近14天暂无 S/A 级爆发工具",
        repo: "",
        target: "通用",
        date: bjtDateLabel(),
        whyUseful: "本轮全网侦察未命中能在社区引发大规模讨论且立即可用的重磅工具。",
        howToUse: "请保持现有工作流，或稍后重新扫描。",
        rating: "B级",
        sourceName: "Yuqing Worker",
        sourceUrl: "",
      },
    ];
  }
  return out;
}

export function renderDailyGithubToolsMarkdownForTrends(items) {
  return (items || [])
    .map((item) => {
      const rate = item.rating || "B级";
      return [
        `### ${markdownTitle(item.title, "AI 效率利器")}`,
        `仓库：${cleanText(item.repo, "", 120) || "未确认"} · 适配：${cleanText(item.target, "通用", 80)} · 评级：**${cleanText(rate, "B级", 16)}**`,
        `引爆日期：${cleanText(item.date, "", 48)}`,
        `痛点击穿：${cleanText(item.whyUseful, "", 360)}`,
        `新手第一步：${cleanText(item.howToUse, "", 260)}`,
      ].join("\n\n");
    })
    .join("\n\n")
    .trim();
}
