import { bjtDateLabel, cleanText, markdownTitle, normalizeSourceName, normalizeSourceUrl } from "./shared.js";

export function buildDailyGithubToolsPrompt(timeStr) {
  return (
    "当前时间：" +
    timeStr +
    "。\n" +
    "你是面向前沿开发者的『AI 兵器谱情报官』。请使用 Google Search 监听全网开发者社区（包括 X/Twitter、Hacker News、Reddit 及 GitHub Trending 等），寻找过去 14 天内引发热议、能显著提升 AI Coding (Vibecoding) 效率的新工具、MCP Server、Agent 框架或 IDE 插件。\n\n" +
    "【一、 选材红线与优先级】\n" +
    "1) 落脚点必须是代码：线索可以来自社交媒体，但最终推荐的工具必须有公开的 GitHub 仓库、配置说明或直接的下载/安装链接。\n" +
    "2) 拒绝玩具：必须是有 README、有示例、普通开发者能直接 clone 下来跑通，或直接接入 Cursor / VS Code / Claude Code 的实用工具。\n" +
    "3) 精品意识：宁缺毋滥。不要为了凑数推已经过气的老项目。如果没有真正惊艳的，推 3 个极品即可。\n\n" +
    "【二、 深度拆解结构】\n" +
    "每条工具必须以“向开发者安利”的极简干练口吻写出：\n" +
    "- title：工具名 + 一句话定位（不超过 28 个字）。\n" +
    "- repo：GitHub 仓库全名（如 owner/name），无则留空。\n" +
    "- target：适配的生态（如 Cursor, Claude Code, MCP, VS Code, 或通用命令行）。\n" +
    "- date：最近的开源日期、发布日期或在社区引爆讨论的日期。\n" +
    "- whyUseful：核心痛点击穿。为什么在推特上火了？它帮 AI 程序员解决了什么恶心的问题？\n" +
    "- howToUse：新手第一步怎么跑？（写出关键的安装命令，如 npm install / git clone，或指明需要在哪个配置里加链接）。\n" +
    "- rating：只能是「S级」(神仙工具/必须安装)、「A级」(极大提效/强烈推荐) 或「B级」(潜力股/先加Star观测)。\n\n" +
    "【三、 侦察搜寻路径（全网雷达）】\n" +
    "打破只搜 GitHub 的局限，请交叉使用以下雷达扇区：\n" +
    "1) 社交媒体爆款：'\"GitHub\" (MCP OR Cursor OR \"Claude Code\") site:twitter.com' / '\"built this weekend\" github AI coding'\n" +
    "2) 极客社区推荐：site:news.ycombinator.com \"Show HN\" (MCP OR agent OR coding tool)\n" +
    "3) 生态最新拼图：'Cursor rule templates' / 'MCP server release' / 'LangChain integration github'\n" +
    "4) 黑马与前沿：'open source devin alternative' / 'autonomous coding agent github'\n\n" +
    "【四、 输出格式】\n" +
    "仅输出一个 JSON 代码块，顶层字段为 githubTools（数组，精选 3~5 条）。每条必须包含：\n" +
    "title, repo, target, date, whyUseful, howToUse, rating, sourceName, sourceUrl。\n" +
    "sourceUrl 请优先提供 GitHub 链接或引爆该讨论的社区链接。JSON 内文本保持极度硬核的情报体风格。"
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
