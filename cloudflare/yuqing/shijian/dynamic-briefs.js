import { cleanText, markdownTitle, normalizeSourceName, normalizeSourceUrl } from "./shared.js";

function fallbackBrief(idx = 0) {
  return {
    category: idx === 0 ? "系统状态" : "综合",
    title: idx === 0 ? "等待下一轮事实采集" : "暂无新增高置信动态",
    body: "暂未出现足够可靠的新动态。",
    description: "信息不足时不强行补位，等待下一轮检索或事实池刷新。",
    analysis: "先降低权重，后续看是否有权威来源跟进。",
    watch: "继续等待多源确认。",
    sourceName: "Yuqing Worker",
    sourceUrl: "",
  };
}

export function buildDailyBriefsPrompt(timeStr) {
  return (
    "当前时间：" +
    timeStr +
    "。\n" +
    "你是华尔街前线与全球顶级科技智库的「全天候信息雷达主编」。请使用 Google Search 检索过去 24-48 小时内各领域值得快速关注的异动与关键节点，输出 5 条左右的高价值快讯。\n\n" +
    "【一、 选材与过滤（宁缺毋滥）】\n" +
    "1) 高价值导向：覆盖政治/地缘、宏观经济、AI/前沿科技、加密资产与传统市场。寻找那些「可能改变行业格局的政策、资本异动、科技突破或市场分歧」。\n" +
    "2) 坚决摒弃：毫无营养的软文、已被充分讨论的旧闻、普通公司发版、没有数据支撑的主观评论。\n" +
    "3) 来源核验：必须基于可靠来源（主流媒体、官方公告、顶级分析师/机构报告），并尽量避免与今日最核心的头条大事件重复，侧重于补充其他重要分支。\n\n" +
    "【二、 分析与拆解视角】\n" +
    "每条动态请保持冷峻、客观、精炼的「情报体」风格，拒绝长篇大论：\n" +
    "- body (核心事实)：一针见血，只讲谁、在什么时候、做了什么或发生了什么数据变化。禁止空泛形容。\n" +
    "- analysis (异动解析)：2句话说明为什么这条信息值得被雷达捕捉？它打破了什么常规？或者隐含了什么潜在趋势？\n" +
    "- watch (后续盯防)：下一步该盯紧什么关键指标、会议、或人物动作，来验证该事件的后续走向？\n\n" +
    "【三、 搜索雷达建议】\n" +
    "请交叉使用以下关键词组拓展视野：\n" +
    "- 科技/AI: 'AI breakthrough' / 'LLM benchmark' / 'tech antitrust' / 'OpenAI / Google / Anthropic unexpected'\n" +
    "- 宏观/加密: 'Fed rate odds' / 'crypto regulatory shift' / 'SEC ETF update' / 'on-chain whale movement'\n" +
    "- 地缘/市场: 'supply chain disruption' / 'commodity surge' / 'emerging market risk'\n\n" +
    "【四、 格式与输出要求】\n" +
    "仅输出一个 JSON 代码块，顶层字段为 dynamicBriefs（数组，5 条左右）。每条包含：\n" +
    "category（必须从「政治」「经济」「AI」「市场」「加密」「科技」「监管」「公司」中选择最贴近的分类）, \n" +
    "title (不超过 20 字的硬核标题), \n" +
    "body, analysis, watch, \n" +
    "time (确切的新闻发生或披露时间，如“5月6日 14:00”), \n" +
    "sourceName (信源名称), sourceUrl (信源链接)。"
  );
}

export function normalizeDailyBriefItems(raw, fallbackRows = []) {
  const candidates = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  const out = [];
  for (let i = 0; i < candidates.length && out.length < 5; i += 1) {
    const src = candidates[i] && typeof candidates[i] === "object" ? candidates[i] : {};
    const fb = fallbackRows[out.length] || fallbackBrief(out.length);
    const body = cleanText(src.body || src.fact || src.summary || fb.body, fb.body, 160);
    const analysis = cleanText(src.analysis || src.whyItMatters || src.why || fb.analysis, "后续观察权威来源跟进。", 150);
    const watch = cleanText(src.watch || src.nextWatch || src.next || analysis || fb.watch, "继续等待多源确认。", 130);
    out.push({
      category: cleanText(src.category || src.type || fb.category, "综合", 32),
      title: cleanText(src.title || src.headline || fb.title, "未命名动态", 120),
      body,
      description: cleanText(src.description || src.detail || body, body, 180),
      analysis,
      watch,
      time: cleanText(src.time || src.date || "", "", 48),
      sourceName: normalizeSourceName(src.sourceName || src.source || fb.sourceName, ""),
      sourceUrl: normalizeSourceUrl(src.sourceUrl || src.url || fb.sourceUrl),
    });
  }
  return out.length ? out : [fallbackRows[0] || fallbackBrief(0)];
}

export function renderDailyBriefsMarkdown(briefs) {
  return (briefs || [])
    .map((item, idx) => {
      const timeLine = item.time ? `时间：${item.time}\n` : "";
      return [
        `### ${idx + 1}. ${markdownTitle(item.title, "动态")}`,
        timeLine + cleanText(item.body, "事件细节等待补强。", 220),
        `异动解析：${cleanText(item.analysis, "逻辑待补充。", 220)}`,
        `后续盯防：${cleanText(item.watch, "后续观察权威来源跟进。", 220)}`,
      ].join("\n\n");
    })
    .join("\n\n")
    .trim();
}
