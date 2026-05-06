import { bjtDateLabel, cleanText, markdownTitle, normalizeSourceName, normalizeSourceUrl } from "./shared.js";

export function buildDailyAiIntelPrompt(timeStr) {
  return (
    "当前时间：" +
    timeStr +
    "。\n" +
    "你是 AI 日常情报编辑。请使用 Google Search 检索近72小时内公开可核验的 AI 工具、模型、平台和产品更新。\n\n" +
    "搜索限定：\n" +
    "1) 必须至少提取 5 条以上内容，着重挖掘头部 AI 公司（OpenAI, Google, Anthropic, Microsoft, Meta等）的新工具与新特性发布。\n" +
    "2) 只纳入近72小时内有公开来源的新动作，严禁用旧闻凑数。\n" +
    "3) 优先官方博客、发布说明、可信科技媒体和开发者社区高置信更新。\n" +
    "4) 重点是普通用户、内容创作者、开发者或办公工作流能感知的变化。\n" +
    "5) 不写金融市场影响，不把 AI 新闻解释成交易叙事。\n\n" +
    "仅输出一个 JSON 代码块，顶层字段为 aiIntel。每条包含 title、date、what、use、attention、sourceName、sourceUrl。attention 只能是「高」「中」「低」。"
  );
}

export function normalizeDailyAiIntelItems(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const it of arr.slice(0, 10)) {
    if (!it || typeof it !== "object") continue;
    const attentionRaw = cleanText(it.attention || it.level || "中", "中", 8);
    let attention = "中";
    if (/高/.test(attentionRaw)) attention = "高";
    else if (/低/.test(attentionRaw)) attention = "低";
    out.push({
      title: cleanText(it.title || it.headline, "AI 动态", 200),
      date: cleanText(it.date || it.publishDate || "", bjtDateLabel(), 48),
      what: cleanText(it.what || it.news || it.summary, "", 500),
      use: cleanText(it.use || it.valueForUser || it.impact, "", 500),
      attention,
      sourceName: normalizeSourceName(it.sourceName || it.source || "Google 检索", "Google 检索"),
      sourceUrl: normalizeSourceUrl(it.sourceUrl || it.url || ""),
    });
  }
  if (!out.length) {
    return [
      {
        title: "近72小时暂无满足筛选条目的重大 AI 发布",
        date: bjtDateLabel(),
        what: "检索未命中符合时间窗与可核验要求的条目，未用训练记忆补位。",
        use: "可稍后使用实时扫描重试，或等待下一轮日报刷新。",
        attention: "低",
        sourceName: "Gemini + Google Search",
        sourceUrl: "",
      },
    ];
  }
  return out;
}

export function renderDailyAiIntelMarkdownForTrends(items) {
  return (items || [])
    .map((item) => {
      return [
        `### ${markdownTitle(item.title, "AI 情报")}`,
        `发布日期：${cleanText(item.date, "", 48)}`,
        `新了什么：${cleanText(item.what, "", 400)}`,
        `对日常使用有什么用：${cleanText(item.use, "", 400)}`,
        `关注程度：${cleanText(item.attention, "中", 8)}`,
      ].join("\n\n");
    })
    .join("\n\n")
    .trim();
}
