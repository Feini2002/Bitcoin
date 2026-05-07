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

function parseJsonPayload(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (_) {
    return null;
  }
}

function arrayOf(value) {
  if (Array.isArray(value)) return value.filter((x) => x != null && x !== "");
  if (value == null || value === "") return [];
  return [value];
}

function normalizeEvidence(value) {
  return arrayOf(value)
    .map((x) => cleanText(x, "", 90))
    .filter(Boolean)
    .slice(0, 3);
}

function normalizeTrendEntry(item, fallbackTitle, fallbackBody) {
  if (item && typeof item === "object" && !Array.isArray(item)) {
    const title = cleanText(
      item.title || item.signal || item.checkpoint || item.label || item.topic || item.name || fallbackTitle,
      fallbackTitle,
      64,
    );
    return {
      title,
      synthesis: cleanText(
        item.synthesis || item.body || item.summary || item.why || item.logic || item.tension || item.action || item.signal,
        fallbackBody,
        240,
      ),
      evidence: normalizeEvidence(item.evidence || item.inputEvidence || item.modules || item.from),
      watch: cleanText(item.watch || item.nextWatch || item.sourceHint || item.verify || item.next || "", "", 170),
    };
  }
  return {
    title: fallbackTitle,
    synthesis: cleanText(item, fallbackBody, 240),
    evidence: [],
    watch: "",
  };
}

function normalizeTrendEntries(value, fallbackTitle, fallbackBody, limit) {
  return arrayOf(value)
    .slice(0, limit)
    .map((item) => normalizeTrendEntry(item, fallbackTitle, fallbackBody))
    .filter((item) => item.synthesis);
}

function flattenForLegacy(rows) {
  return (rows || [])
    .map((item) => {
      if (!item || typeof item !== "object") return cleanText(item, "", 220);
      const title = cleanText(item.title, "", 48);
      const body = cleanText(item.synthesis || item.body || item.summary || item.action, "", 180);
      return title && body ? `${title}：${body}` : body || title;
    })
    .filter(Boolean);
}

function normalizeDailyTrendReadPayload(payload, fallbackMacro, factCount, fallbackLines) {
  const src = payload && typeof payload === "object" ? payload.trendRead || payload : {};
  const worldNews = normalizeTrendEntries(
    src.worldNews || src.worldMainline || src.worldMainlines || src.worldSignals || src.mainlines,
    "世界新闻主线",
    "从今日头条与动态速览中提取跨区域、跨行业外溢的主线。",
    3,
  );
  const techPulse = normalizeTrendEntries(
    src.techPulse || src.techSignals || src.technology || src.tech,
    "科技扩散脉冲",
    "从 AI 情报站与 GitHub 工具雷达中提取正在扩散的技术线索。",
    2,
  );
  const financeBackdrop = normalizeTrendEntries(
    src.financeBackdrop || src.financeContext || src.marketContext || src.finance,
    "轻量金融背景",
    "只把市场温度作为阅读背景，不输出交易方向。",
    2,
  );
  const contradictions = normalizeTrendEntries(
    src.contradictions || src.tensions || src.narrativeGaps || src.cracking,
    "叙事裂缝",
    "记录输入模块之间尚未互相印证的分歧。",
    3,
  );
  const next72h = normalizeTrendEntries(
    src.next72h || src.checklist || src.observationList || src.watchlist,
    "观察点",
    "继续跟踪权威来源、产品发布或政策细节是否补强。",
    5,
  );

  const fallbackSummary =
    cleanText(fallbackMacro, "", 220) ||
    (fallbackLines && fallbackLines.length
      ? pickSectionLine(fallbackLines, "主线", "本轮日报尚未形成足够清晰的合成主线。")
      : `最近72小时内已有 ${factCount} 条候选，先按事实密度和来源可靠性阅读。`);
  const summary = cleanText(src.summary || src.editorialSummary || src.brief || fallbackSummary, fallbackSummary, 260);
  const title = cleanText(src.title || "日报线索合成", "日报线索合成", 48);
  const conclusion =
    cleanText(src.conclusion, "", 220) ||
    (next72h[0] ? `0-72小时观察：${next72h[0].synthesis}` : "0-72小时观察：等待上游模块补充更多权威来源与具体细节。");

  const strengthening = [
    summary,
    ...flattenForLegacy(worldNews).slice(0, 2),
    ...flattenForLegacy(techPulse).slice(0, 1),
  ].filter(Boolean);
  const cracking = flattenForLegacy(contradictions).slice(0, 3);

  return {
    title,
    summary,
    worldNews,
    techPulse,
    financeBackdrop,
    contradictions,
    next72h,
    strengthening: strengthening.length ? strengthening : [`最近72小时内已有 ${factCount} 条候选，优先观察哪些主题正在连续出现。`],
    cracking: cracking.length ? cracking : ["暂无明显叙事裂缝；先等待更多来源互相印证。"],
    conclusion,
    methodology: {
      usesGoogleSearch: false,
      inputOnly: true,
      mix: "重度世界新闻 + 中度科技 + 轻量金融背景",
    },
  };
}

export function buildDailyTrendCluesPrompt(newsText, timelineText, aiText, temperatureJsonText, githubToolsText = "") {
  return (
    "你是事件日报的『总编辑 + 情报合成官』。你接手的是同一次「事件一览」已经完成的上游模块：信息温度、今日头条、动态速览、AI 情报站、GitHub 工具雷达。\n" +
    "默认规则：你不使用 Google Search，不发起任何联网检索；只基于下方输入做二次叠加分析。禁止新增事实、禁止编造来源、禁止把输入里没有的事件当成最新进展。\n\n" +
    "【页面定位】\n" +
    "这个子页面是事件一览，更像一份日报：重度世界新闻 + 中度科技 + 轻量金融背景。它与金融有关，但最后一段不是交易研判，不输出买卖方向、利多利空或仓位建议。\n" +
    "配比原则：世界新闻/地缘/政策/宏观事件约 55%；AI、科技产品与开发者生态约 30%；金融市场温度与资产波动只占约 15%，仅作为阅读背景。\n\n" +
    "【上游输入】\n" +
    "1. 信息温度（轻量金融背景，只用于判断阅读环境）：\n" + (temperatureJsonText || "（暂无）") + "\n\n" +
    "2. 今日头条（世界新闻主线）：\n" + (newsText || "（暂无）") + "\n\n" +
    "3. 动态速览（补充世界新闻、经济、科技、监管分支）：\n" + (timelineText || "（暂无）") + "\n\n" +
    "4. AI 情报站（中度科技层）：\n" + (aiText || "（暂无）") + "\n\n" +
    "5. GitHub 工具雷达（只在能说明技术扩散时使用）：\n" + (githubToolsText || "（暂无）") + "\n\n" +
    "【合成方法论】\n" +
    "1) 先找跨模块重复出现的主题，不用单条信息强行造趋势。\n" +
    "2) 世界新闻优先：把头条和速览里的政治、地缘、政策、宏观事件串成日报主线。\n" +
    "3) 科技居中：只提真实改变工作流、产品链或开发者生态的 AI/工具线索，不写泛泛的模型宣传。\n" +
    "4) 金融轻放：信息温度、BTC/美股/黄金等只解释阅读背景和噪音，不转成投资结论。\n" +
    "5) 对分歧保持诚实：输入不够时写“证据不足”，不要补新闻。\n\n" +
    "【输出格式】\n" +
    "仅输出 JSON，顶层字段为 trendRead。结构如下：\n" +
    "{\n" +
    "  \"trendRead\": {\n" +
    "    \"title\": \"日报线索合成\",\n" +
    "    \"summary\": \"一段 60-110 字的总编辑摘要，说明今日世界新闻主线、科技扩散与金融背景如何叠加。\",\n" +
    "    \"worldNews\": [{ \"title\": \"主线名称\", \"synthesis\": \"只基于头条/速览归纳的合成判断\", \"evidence\": [\"今日头条\", \"动态速览\"], \"watch\": \"下一步看什么权威来源或时间节点\" }],\n" +
    "    \"techPulse\": [{ \"title\": \"科技线索\", \"synthesis\": \"AI 情报或 GitHub 工具如何补充日报主线\", \"evidence\": [\"AI 情报站\"], \"watch\": \"看发布、Release、API 或采用迹象\" }],\n" +
    "    \"financeBackdrop\": [{ \"title\": \"轻量金融背景\", \"synthesis\": \"信息温度/跨资产只作为阅读背景\", \"evidence\": [\"信息温度\"], \"watch\": \"看是否影响信息热度而非交易方向\" }],\n" +
    "    \"contradictions\": [{ \"title\": \"叙事裂缝\", \"synthesis\": \"哪些地方仍缺少互证或存在预期差\", \"evidence\": [\"对应模块名\"], \"watch\": \"如何证实或证伪\" }],\n" +
    "    \"next72h\": [{ \"title\": \"观察点\", \"synthesis\": \"可执行的观察动作\", \"evidence\": [\"对应模块名\"], \"watch\": \"具体看官方、主流媒体、产品发布或数据细节\" }],\n" +
    "    \"conclusion\": \"一句 0-72 小时观察结论，不写交易建议。\"\n" +
    "  }\n" +
    "}\n" +
    "数量要求：worldNews 2-3 条，techPulse 1-2 条，financeBackdrop 1 条，contradictions 1-2 条，next72h 3-5 条。"
  );
}

export function buildTrendReadFromDailyEventInputs(legacy, factCount) {
  const trendsMd = legacy && legacy.sections && legacy.sections.trends && legacy.sections.trends.markdown;
  const newsData = legacy && legacy.sections && legacy.sections.news && legacy.sections.news.data;
  const macroTrend = cleanText(newsData && newsData.macroTrend, "", 420);
  const parsed = parseJsonPayload(trendsMd);
  if (parsed) return normalizeDailyTrendReadPayload(parsed, macroTrend, factCount, []);

  const lines = substantiveLines(trendsMd);
  const hasLlm = lines.length > 0;
  return normalizeDailyTrendReadPayload(
    {
      title: "日报线索合成",
      summary: macroTrend || (hasLlm ? pickSectionLine(lines, "主线", "本轮日报主线仍在形成中。") : ""),
      worldNews: hasLlm ? [pickSectionLine(lines, "世界", pickSectionLine(lines, "升温", "多个主题正在获得新的来源确认，适合作为今日阅读主线。"))] : [],
      techPulse: hasLlm ? [pickSectionLine(lines, "科技", "科技线索暂未形成足够明确的扩散脉冲。")] : [],
      financeBackdrop: hasLlm ? [pickSectionLine(lines, "金融", "金融信息仅作为阅读背景，不构成交易方向。")] : [],
      contradictions: hasLlm ? [pickSectionLine(lines, "分化", "暂无明显分化信号，继续观察来源是否相互印证。")] : [],
      next72h: hasLlm ? [pickSectionLine(lines, "观察", "未来24-72小时继续跟踪官方来源、主流媒体和产品发布细节。")] : [],
    },
    macroTrend,
    factCount,
    lines,
  );
}
