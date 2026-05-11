import { cleanText, normalizeSourceName, normalizeSourceUrl } from "./shared.js";

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

function normalizeParagraphs(value, fallback, limit = 4) {
  const rows = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/\n{2,}/)
        .map((s) => s.trim())
        .filter(Boolean);
  const out = rows
    .map((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        return cleanText(item.text || item.body || item.summary || item.synthesis, "", 360);
      }
      return cleanText(item, "", 360);
    })
    .filter(Boolean)
    .slice(0, limit);
  return out.length ? out : [cleanText(fallback, "本轮日报仍需更多外部来源校准，先按已确认事实保守阅读。", 260)];
}

function normalizeSearchFindings(value) {
  return arrayOf(value)
    .slice(0, 4)
    .map((item, idx) => {
      const src = item && typeof item === "object" && !Array.isArray(item) ? item : { finding: item };
      const finding = cleanText(src.finding || src.summary || src.body || src.evidence || src.fact, "", 260);
      if (!finding) return null;
      return {
        title: cleanText(src.title || src.topic || src.label || `外部校准 ${idx + 1}`, `外部校准 ${idx + 1}`, 64),
        finding,
        relation: cleanText(src.relation || src.why || src.linkToDaily || src.meaning || "", "", 180),
        sourceName: normalizeSourceName(src.sourceName || src.source || src.publisher || "Google Search", "Google Search"),
        sourceUrl: normalizeSourceUrl(src.sourceUrl || src.url || src.href || ""),
      };
    })
    .filter(Boolean);
}

function normalizeWatchline(value) {
  return arrayOf(value)
    .slice(0, 5)
    .map((item, idx) => {
      const src = item && typeof item === "object" && !Array.isArray(item) ? item : { why: item };
      const why = cleanText(src.why || src.reason || src.watch || src.body || src.synthesis || src.next, "", 180);
      if (!why) return null;
      return {
        title: cleanText(src.title || src.topic || src.label || `继续阅读 ${idx + 1}`, `继续阅读 ${idx + 1}`, 64),
        why,
        sourceHint: cleanText(src.sourceHint || src.source || src.where || src.verify || "", "", 120),
      };
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
  const summary = cleanText(
    src.verdict || src.summary || src.editorialSummary || src.brief || fallbackSummary,
    fallbackSummary,
    260,
  );
  const title = cleanText(src.title || "总编辑收束", "总编辑收束", 48);
  const closingRead = normalizeParagraphs(
    src.closingRead || src.editorialRead || src.narrative || src.paragraphs || src.body,
    summary,
    4,
  );
  const searchFindings = normalizeSearchFindings(src.searchFindings || src.externalChecks || src.verifications || src.outsideAir);
  const watchline = normalizeWatchline(src.watchline || src.nextRead || src.readNext || src.next72h || src.checklist || src.observationList);
  const uncertainty = cleanText(
    src.uncertainty || src.openQuestion || src.caveat || src.contradiction || "",
    searchFindings.length ? "外部搜索已校准主要事实，但事件后续仍取决于权威来源是否继续补充细节。" : "外部校准证据不足，先按上游模块保守阅读。",
    220,
  );
  const conclusion =
    cleanText(src.conclusion, "", 220) ||
    (watchline[0] ? `${watchline[0].title}：${watchline[0].why}` : "接下来继续跟踪权威来源、主流媒体与产品/政策细节。");

  const strengthening = [
    summary,
    ...flattenForLegacy(worldNews).slice(0, 2),
    ...flattenForLegacy(techPulse).slice(0, 1),
  ].filter(Boolean);
  const cracking = flattenForLegacy(contradictions).slice(0, 3);

  return {
    title,
    summary,
    verdict: summary,
    closingRead,
    searchFindings,
    watchline,
    uncertainty,
    worldNews,
    techPulse,
    financeBackdrop,
    contradictions,
    next72h,
    strengthening: strengthening.length ? strengthening : [`最近72小时内已有 ${factCount} 条候选，优先观察哪些主题正在连续出现。`],
    cracking: cracking.length ? cracking : ["暂无明显叙事裂缝；先等待更多来源互相印证。"],
    conclusion,
    methodology: {
      usesGoogleSearch: true,
      inputOnly: false,
      mode: "上游模块 + 外部搜索校准",
      role: "全球日报收束编辑",
      promptVersion: "daily-trend-search-v1",
    },
  };
}

export function buildDailyTrendCluesPrompt(newsText, timelineText, aiText, temperatureJsonText, githubToolsText = "") {
  return (
    "你是全球日报的『收束主编 + 外部校准员』。你接手的是同一次「事件一览」已经完成的上游模块：信息温度、今日头条、动态速览、AI 情报站、GitHub 工具雷达。\n" +
    "你的任务不是再切出世界新闻、科技、金融、观察清单几个栏目，而是打开一扇窗：用 Google Search 校准上游模块是否遗漏了最新事实、是否已有权威来源补充、是否存在反向证据，然后写成一段真正的收尾短评。\n\n" +
    "【页面定位】\n" +
    "这个子页面是事件日报，不是交易研判。允许保留上游模块的强个性，但你的语气要像给忙碌读者写最后一段编辑按语：把最值得带走的公共事实、科技变化和阅读背景收成一个判断框架。\n" +
    "金融市场、资产价格、F&G、BTC/美股/黄金等只允许作为“阅读环境”和“信息热度”的背景，不输出买入、卖出、利多、利空、仓位、交易方向或风险资产押注。\n\n" +
    "【上游输入】\n" +
    "1. 信息温度（轻量金融背景，只用于判断阅读环境）：\n" + (temperatureJsonText || "（暂无）") + "\n\n" +
    "2. 今日头条（世界新闻主线）：\n" + (newsText || "（暂无）") + "\n\n" +
    "3. 动态速览（补充世界新闻、经济、科技、监管分支）：\n" + (timelineText || "（暂无）") + "\n\n" +
    "4. AI 情报站（中度科技层）：\n" + (aiText || "（暂无）") + "\n\n" +
    "5. GitHub 工具雷达（只在能说明技术扩散时使用）：\n" + (githubToolsText || "（暂无）") + "\n\n" +
    "【搜索校准方法】\n" +
    "1) 必须使用 Google Search。不要泛搜“today news”，而是围绕上游出现的具体标题、人物、机构、政策名、产品名做 3-6 次定向检索。\n" +
    "2) 优先找 Reuters / Bloomberg / AP / Financial Times / WSJ / The Verge / TechCrunch / 官方公告 / 监管机构 / 公司博客 / GitHub 官方仓库等可追溯来源。\n" +
    "3) 搜索目标不是堆新闻，而是回答三个问题：上游判断有没有被新事实更新？有没有权威来源确认或纠偏？读者接下来应该继续看哪条线？\n" +
    "4) 不要为了显得完整而硬塞金融解释；如果金融只是在背景里，就明确写成“背景”，不要写成交易信号。\n" +
    "5) 如果搜索没有找到足够强的外部证据，就坦白写证据不足，不要补故事。\n\n" +
    "【写作要求】\n" +
    "1) 输出是一段收尾短评，不是切蛋糕式栏目。closingRead 用 2-4 个自然段串起来，段落之间要有递进。\n" +
    "2) 先给一句 verdict：今天读者离开页面前最该带走的一句话。\n" +
    "3) searchFindings 只放真实搜索校准到的关键补充，每条必须有 sourceName；有 URL 就放 sourceUrl。\n" +
    "4) watchline 是“接下来读什么”，不是交易动作；每条写成可验证的后续阅读线索。\n" +
    "5) 允许有态度，但态度必须来自事实密度、来源质量和外部校准，而不是市场方向。\n\n" +
    "【输出格式】\n" +
    "仅输出 JSON，顶层字段为 trendRead。结构如下：\n" +
    "{\n" +
    "  \"trendRead\": {\n" +
    "    \"title\": \"总编辑收束\",\n" +
    "    \"verdict\": \"45-90 字，一句话写今天最该带走的总判断。\",\n" +
    "    \"closingRead\": [\"自然段1\", \"自然段2\", \"自然段3\"],\n" +
    "    \"searchFindings\": [{ \"title\": \"外部校准点\", \"finding\": \"搜索补到或纠偏的事实\", \"relation\": \"它如何改变/确认上游模块\", \"sourceName\": \"来源名\", \"sourceUrl\": \"https://...\" }],\n" +
    "    \"watchline\": [{ \"title\": \"接下来读什么\", \"why\": \"为什么要继续看\", \"sourceHint\": \"建议关注的来源或口径\" }],\n" +
    "    \"uncertainty\": \"本轮仍无法确认或需要防止误读的地方。\",\n" +
    "    \"conclusion\": \"一句收束结论，不写交易建议。\",\n" +
    "    \"methodology\": { \"usesGoogleSearch\": true, \"inputOnly\": false, \"mode\": \"上游模块 + 外部搜索校准\" }\n" +
    "  }\n" +
    "}\n" +
    "数量要求：closingRead 2-4 段；searchFindings 2-4 条；watchline 3-5 条。"
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
      title: "总编辑收束",
      summary: macroTrend || (hasLlm ? pickSectionLine(lines, "主线", "本轮日报主线仍在形成中。") : ""),
      closingRead: hasLlm ? lines.slice(0, 3) : [],
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
