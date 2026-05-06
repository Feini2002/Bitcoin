import { cleanText, markdownTitle, normalizeSourceName, normalizeSourceUrl } from "./shared.js";

function normalizeStoryStructure(raw, fact) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return {
      trigger: cleanText(raw.trigger || raw.surface || raw.what, "事件已被多源报道，需先锁定原始事实。", 180),
      conflict: cleanText(raw.conflict || raw.background || raw.why, "背景信息仍需继续补强。", 180),
      divergence: cleanText(raw.divergence || raw.dispute || raw.uncertainty, "暂无明确分歧，后续看官方或权威媒体更新。", 180),
    };
  }
  const text = cleanText(raw, "", 360) || cleanText(fact, "等待事实补强。", 180);
  return {
    trigger: text,
    conflict: "先从事实、背景和相关方动作拆解，不做交易方向判断。",
    divergence: "观察后续来源是否相互印证，避免单源误读。",
  };
}

function normalizeImpactScope(raw) {
  const candidates = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out = [];
  for (const item of candidates.slice(0, 3)) {
    const src = item && typeof item === "object" ? item : { logic: item };
    out.push({
      asset: cleanText(src.scope || src.asset || src.group || "公众议题", "公众议题", 32),
      direction: "shock",
      logic: cleanText(src.logic || src.reason || src.why, "记录事件影响范围，不判断交易方向。", 180),
    });
  }
  return out.length ? out : [{ asset: "公众议题", direction: "shock", logic: "记录事件影响范围，不判断交易方向。" }];
}

function fallbackTopStory(idx = 0) {
  return {
    category: "综合事件",
    title: idx === 0 ? "等待高价值事件更新" : "等待更多可靠来源补充",
    fact: "当前事实池尚未形成足够明确的日报头条。",
    structure: {
      trigger: "优先等待官方来源、主流媒体和多源交叉确认。",
      conflict: "信息不足时不强行给出判断。",
      divergence: "暂无明确分歧。",
    },
    impacts: [{ asset: "信息关注", direction: "shock", logic: "先作为待观察议题留存。" }],
    nextWatch: "关注后续是否出现权威来源确认或更多细节。",
    sourceName: "Yuqing D1",
    sourceUrl: "",
  };
}

export function buildDailyTopStoriesPrompt(timeStr) {
  return (
    "当前时间：" +
    timeStr +
    "。\n" +
    "你是事件日报编辑。请使用 Google Search 检索最新可核验资讯，筛选今日最值得普通读者知道的 3 条高价值事件。\n\n" +
    "搜索限定：\n" +
    "1) 优先过去72小时；若一周内有国家级政策、头部科技公司、重大地缘事件、系统性公共事件，可作为持续追踪纳入。\n" +
    "2) 必须能在公开来源中核验，不用训练记忆补旧闻。\n" +
    "3) 避免三条都来自同一主题；若同一大事件很重要，也要拆成不同参与方或影响范围。\n\n" +
    "分析限定：只做日报情报收集，不写投资建议，不写利多利空，不写交易传导。\n\n" +
    "仅输出一个 JSON 代码块，顶层字段为 topStories。每条必须包含 category、title、fact、structure、impacts、nextWatch、sourceName、sourceUrl。\n" +
    "structure 包含 trigger、conflict、divergence；impacts 表示影响范围数组，每项用 scope 或 asset 表示对象，用 logic 说明为什么值得关注。"
  );
}

/** 第二路并行检索：偏快讯/通讯社口径，与主路 prompt 不同，用于去重合并后取 3 条。 */
export function buildDailyTopStoriesWirePrompt(timeStr) {
  return (
    "当前时间：" +
    timeStr +
    "。\n" +
    "你是通讯社快讯编辑。请使用 Google Search 检索过去 24～48 小时内「刚发生、仍在更新」的硬新闻线索（地缘、宏观数据窗口、大型公司突发、监管动作、科技产品发布等）。\n\n" +
    "要求：\n" +
    "1) 与「72 小时深度头条」角度不同，优先抓**新进展**与**待核实节点**。\n" +
    "2) 必须可指向公开来源；无足够新料时宁可少写。\n" +
    "3) 输出 3 条，字段与主路一致，仍禁止投资建议与交易传导。\n\n" +
    "仅输出一个 JSON 代码块，顶层字段为 topStories。"
  );
}

/** 合并两路 LLM 返回的头条候选（按标题去重），供再 normalize 成 3 条。 */
export function mergeTopStoryCandidatesForDaily(rawA, rawB) {
  const norm = (t) => String(t || "").trim().toLowerCase().replace(/\s+/g, "");
  const seen = new Set();
  const out = [];
  for (const arr of [rawA, rawB]) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (!item || typeof item !== "object") continue;
      const k = norm(item.title);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(item);
    }
  }
  return out;
}

export function normalizeDailyTopStoryItems(raw, fallbackRows = []) {
  const candidates = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
  const out = [];
  for (let i = 0; i < candidates.length && out.length < 3; i += 1) {
    const src = candidates[i] && typeof candidates[i] === "object" ? candidates[i] : {};
    const fb = fallbackRows[out.length] || fallbackTopStory(out.length);
    const fact = cleanText(src.fact || src.summary || src.body || fb.fact, fb.fact, 260);
    out.push({
      category: cleanText(src.category || src.type || fb.category, "综合事件", 32),
      title: cleanText(src.title || src.headline || fb.title, "未命名事件", 140),
      fact,
      structure: normalizeStoryStructure(src.structure || src.deconstruction || src.analysis, fact),
      impacts: normalizeImpactScope(src.impacts || src.impactScopes || src.scopes || src.impact || fb.impacts),
      nextWatch: cleanText(src.nextWatch || src.next_watch || src.watch || fb.nextWatch, "关注后续权威来源确认。", 180),
      sourceName: normalizeSourceName(src.sourceName || src.source || fb.sourceName, ""),
      sourceUrl: normalizeSourceUrl(src.sourceUrl || src.url || fb.sourceUrl),
    });
  }
  while (out.length < 3) out.push(fallbackRows[out.length] || fallbackTopStory(out.length));
  return out;
}

export function renderDailyTopStoriesMarkdown(stories) {
  return (stories || [])
    .map((story, idx) => {
      const scopes = (story.impacts || []).map((imp) => `[${imp.asset}] ${imp.logic}`).join("；");
      return [
        `### ${idx + 1}. ${markdownTitle(story.title, "头条事件")}`,
        `- 事实：${cleanText(story.fact, "等待事实补强。", 260)}`,
        `- 背景：${cleanText(story.structure && story.structure.conflict, "背景待补充。", 180)}`,
        `- 分歧：${cleanText(story.structure && story.structure.divergence, "暂无明确分歧。", 180)}`,
        `- 影响范围：${scopes || "等待影响范围确认。"}`,
        `- 后续观察：${cleanText(story.nextWatch, "继续跟踪权威来源。", 180)}`,
      ].join("\n");
    })
    .join("\n\n")
    .trim();
}

export function dailyThemeFromStoriesAndBriefs(stories, briefs) {
  const top = (stories || []).slice(0, 2).map((x) => cleanText(x.title, "", 80)).filter(Boolean);
  const fast = (briefs || []).slice(0, 2).map((x) => cleanText(x.title, "", 80)).filter(Boolean);
  const names = [...top, ...fast].slice(0, 4);
  return names.length
    ? `本轮日报主线集中在：${names.join("；")}。后续重点看权威来源是否继续补充细节。`
    : "本轮日报尚未形成清晰主线，先按来源可信度和事件新鲜度阅读。";
}
