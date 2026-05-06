import { cleanText } from "./shared.js";

function substantiveLines(md) {
  return String(md || "")
    .split(/\r?\n/)
    .map((s) => s.trim().replace(/^[-*]\s*/, ""))
    .filter((s) => s && !s.startsWith("#"));
}

function pickSectionLine(lines, keyword, fallback) {
  const found = lines.find((line) => line.includes(keyword));
  return cleanText(found || lines[0], fallback, 260);
}

export function buildDailyTrendCluesPrompt(newsText, timelineText, aiText, temperatureJsonText) {
  return (
    "你是日报总编辑。下面是同一次「事件一览」已经生成的四个模块：信息温度、今日头条、动态速览、AI 情报站。\n" +
    "你必须只基于这些输入做二次归纳；禁止联网搜索，禁止新增事实，禁止编造来源，禁止输出投资建议或交易方向。\n\n" +
    "【信息温度】\n" +
    (temperatureJsonText || "（暂无）") +
    "\n\n【今日头条】\n" +
    (newsText || "（暂无）") +
    "\n\n【动态速览】\n" +
    (timelineText || "（暂无）") +
    "\n\n【AI 情报站】\n" +
    (aiText || "（暂无）") +
    "\n\n请输出三段，标题必须分别为：\n" +
    "### 正在升温的议题\n" +
    "2-3条，说明哪些主题在多个模块里重复出现或信息密度上升。\n\n" +
    "### 正在分化的叙事\n" +
    "1-2条，说明哪些判断仍有分歧、来源不足或公众理解可能误读；没有就明确写暂无明显分化。\n\n" +
    "### 24-72小时观察清单\n" +
    "3-5条，只写接下来应该看哪些官方来源、产品发布、政策细节或主流媒体跟进。"
  );
}

export function buildTrendReadFromDailyEventInputs(legacy, factCount) {
  const trendsMd = legacy && legacy.sections && legacy.sections.trends && legacy.sections.trends.markdown;
  const newsData = legacy && legacy.sections && legacy.sections.news && legacy.sections.news.data;
  const macroTrend = cleanText(newsData && newsData.macroTrend, "", 420);
  const lines = substantiveLines(trendsMd);
  const hasLlm = lines.length > 0;
  return {
    strengthening: macroTrend
      ? [macroTrend, pickSectionLine(lines, "升温", "多个主题正在获得新的来源确认，适合作为今日阅读主线。")]
      : hasLlm
        ? [pickSectionLine(lines, "升温", "多个主题正在获得新的来源确认，适合作为今日阅读主线。")]
        : [`最近72小时内已有 ${factCount} 条候选，优先观察哪些主题正在连续出现。`],
    cracking: hasLlm
      ? [pickSectionLine(lines, "分化", "暂无明显分化信号，继续观察来源是否相互印证。")]
      : ["若事实密度不足，先降低分歧判断权重，等待更多来源确认。"],
    conclusion: hasLlm
      ? pickSectionLine(lines, "观察", "未来24-72小时继续跟踪官方来源、主流媒体和产品发布细节。")
      : "24-72小时观察：跟踪高价值事件是否获得官方口径与主流来源共同确认。",
  };
}
