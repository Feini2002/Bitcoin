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
    "你是日报快讯编辑。请使用 Google Search 检索过去24小时内值得记录的动态速览，输出 5 条。\n\n" +
    "搜索限定：\n" +
    "1) 优先过去24小时；若24-72小时内仍在发酵且今天有新进展，可纳入并说明新进展。\n" +
    "2) 主题尽量覆盖政治、经济、科技、社会、平台生态、公司动态等，不要与今日头条重复。\n" +
    "3) 不用训练记忆补旧闻；无法核验的社媒传言不要写入。\n\n" +
    "分析限定：每条只回答发生了什么、谁受影响、为什么值得记一笔；不要写投资建议、交易方向或资产传导。\n\n" +
    "仅输出一个 JSON 代码块，顶层字段为 dynamicBriefs。每条包含 category、title、body、description、analysis、watch、time (新闻发生或报道时间，例如“5月6日 14:00”)、sourceName、sourceUrl。"
  );
}

export function normalizeDailyBriefItems(raw, fallbackRows = []) {
  const candidates = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  const out = [];
  for (let i = 0; i < candidates.length && out.length < 5; i += 1) {
    const src = candidates[i] && typeof candidates[i] === "object" ? candidates[i] : {};
    const fb = fallbackRows[out.length] || fallbackBrief(out.length);
    const body = cleanText(src.body || src.fact || src.summary || fb.body, fb.body, 220);
    const analysis = cleanText(src.analysis || src.whyItMatters || src.watch || fb.analysis, "后续观察权威来源跟进。", 220);
    out.push({
      category: cleanText(src.category || src.type || fb.category, "综合", 32),
      title: cleanText(src.title || src.headline || fb.title, "未命名动态", 120),
      body,
      description: cleanText(src.description || src.detail || fb.description || body, body, 240),
      analysis,
      watch: cleanText(src.watch || src.nextWatch || analysis || fb.watch, "继续等待多源确认。", 220),
      time: cleanText(src.time || src.date || "", "", 48),
      sourceName: normalizeSourceName(src.sourceName || src.source || fb.sourceName, ""),
      sourceUrl: normalizeSourceUrl(src.sourceUrl || src.url || fb.sourceUrl),
    });
  }
  while (out.length < 5) out.push(fallbackRows[out.length] || fallbackBrief(out.length));
  return out;
}

export function renderDailyBriefsMarkdown(briefs) {
  return (briefs || [])
    .map((item, idx) => {
      const timeLine = item.time ? `时间：${item.time}\n` : "";
      return [
        `### ${idx + 1}. ${markdownTitle(item.title, "动态")}`,
        timeLine + cleanText(item.body, "事件细节等待补强。", 220),
        `为什么值得记：${cleanText(item.analysis || item.watch, "后续观察权威来源跟进。", 220)}`,
      ].join("\n\n");
    })
    .join("\n\n")
    .trim();
}
