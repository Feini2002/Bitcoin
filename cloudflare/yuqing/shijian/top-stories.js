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
    occurredAt: "",
    duration: "",
    structure: {
      trigger: "优先等待官方来源、主流媒体 and 多源交叉确认。",
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
    "你是兼具『顶级地缘情报官』与『宏观对冲基金经理』双重身份的决策层主编。请使用 Google Search 检索最新资讯，为每天时间极少但必须掌控全球大局的读者，萃取今日最核心的 1~3 条影响世界走向的绝对大事件。\n\n" +
    "【一、 绝对红线与筛选标准（宁缺毋滥）】\n" +
    "1) 极高门槛：必须是对全球宏观流动性、风险资产定价（Crypto/美股/大宗/美债等）、或大国地缘格局具有【实质外溢效应】的事件。\n" +
    "   - ❌ 坚决抛弃：常规财报发布、无国际波及的局部政策、例行外交发言、普通天灾人祸。\n" +
    "   - ✅ 重点捕捉：重塑降息预期的通胀数据、引发VIX飙升的黑天鹅、打破原有供应链的科技制裁、或引发核心资产大幅重估的突发。\n" +
    "2) 交叉铁证：必须有 24 小时内的最新关键进展。必须通过权威机构/主流媒体（信源）与社交媒体/暗网情绪（热度）双向验证。\n" +
    "3) 数量克制：若今日天下太平或仅有 1 件真正的大事，果断只返回 1 条。坚决不拿次要新闻凑数，读者的时间极度宝贵。\n\n" +
    "【二、 深度分析与拆解结构（投研级输出）】\n" +
    "- 事实锁定 (fact)：冰冷、客观、精确。必须包含具体数据、核心人物或确切动作。禁止使用“大幅”、“严重”等主观形容词，用具体数值和事实说话。\n" +
    "- 时间锁定：明确事件发生的具体时间 (occurredAt) 和它所处的宏观周期位置 (duration，如“突发初期”、“长期拉锯的转折点”)。\n" +
    "- 结构拆解 (structure)：\n" +
    "  - trigger (直接催化剂)：打破原有平衡的最新关键动作、数据公布或声明（精确到时间戳级别的导火索）。\n" +
    "  - conflict (深层宏观症结)：穿透表象，一针见血指出背后的历史宿怨、权力分配失衡或资金争夺逻辑（必须明确指出谁是利益受损方，谁是受益方）。\n" +
    "  - divergence (预期差/反常识点)：这是最具判断价值的信息。强制使用对比句式写出“市场原有的共识预期是什么 vs 实际发生的现实是什么”，或各方表态与真实行动之间的巨大裂痕。\n" +
    "- 传导推演 (impacts)：针对大类资产（黄金、美债、BTC、汇率等）或核心社会板块，给出明确的传导推演。必须指明是“一阶直接冲击”还是“二阶情绪蔓延”，以及推演的因果逻辑链 (logic)。\n" +
    "- 后续观察 (nextWatch)：指明下一次可能引发变盘的确切时间节点、需紧盯的先行数据指标或核心人物的后续动作。\n\n" +
    "【三、 搜索与信息源狩猎指南（强制检索路径）】\n" +
    "为确保获取最顶级情报，你的搜索动作应遵循以下约束：\n" +
    "1) 搜索词组合策略：不要仅搜索“今日大新闻”，必须使用极具针对性的组合词。例如使用：'global market selloff' / 'geopolitical escalation' / 'Fed unexpected' / 'crypto liquidity crisis' / 'systemic risk' 等高级术语，结合过去 24 小时的时间过滤。\n" +
    "2) 锁定顶级信源：必须优先从以下平台提取事实核心：Bloomberg, Reuters, WSJ, Financial Times, 各国央行/财政部官方发布, SEC Filings。\n" +
    "3) 情绪与博弈验证点：对于检索到的事件，必须尝试结合 'Twitter (X) 金融大V (如 tier10k, unusual_whales) 的解读'、'Polymarket 预测市场概率剧变' 或 'VIX/期权波动率异动' 来交叉验证该事件是否真的引发了真金白银的震动。\n\n" +
    "【四、 格式与输出要求】\n" +
    "仅输出一个 JSON 代码块，顶层字段为 topStories（数组，1~3 个元素）。每条必须包含：\n" +
    "category（事件类别，必须使用中文，如：地缘政治、宏观经济、科技产业、加密市场、企业动态、政策监管等）, \n" +
    "title, fact, occurredAt, duration, \n" +
    "structure (含 trigger, conflict, divergence), \n" +
    "impacts (数组，含 asset/scope 和 logic，其中 asset 必须使用中文，如：比特币、美股、黄金、美元等), \n" +
    "nextWatch, sourceName, sourceUrl。\n" +
    "注意：JSON内的文本必须是投研级别的情报体极简风格，拒绝任何废话和套话。"
  );
}

/** 第二路并行检索：偏快讯/通讯社口径，与主路 prompt 不同，用于去重合并后取 3 条。 */
export function buildDailyTopStoriesWirePrompt(timeStr) {
  return (
    "当前时间：" +
    timeStr +
    "。\n" +
    "你是华尔街与全球顶级智库的高级情报官。请使用 Google Search 敏锐捕捉过去 24 小时内「刚刚爆发、暗流涌动、且尚未被市场完全计价（Unpriced）」的硬核突发异动线索。\n\n" +
    "【一、 选材标准（快、准、狠）】\n" +
    "1) 绝对精简（1~3条）：只抓黑天鹅级别的突发、远超预期的重磅宏观数据、或能引发跨国连锁反应/避险资金异动的早期线索。\n" +
    "   - 侧重于：突发性、高破坏力、预期外的冲击。\n" +
    "2) 警惕假消息：对于模糊的突发信息，必须在交叉验证社交媒体热度的同时，指出其“尚需证伪/证实”的核心疑点。\n\n" +
    "【二、 结构与视角要求】\n" +
    "1) 字段与结构完全对齐主路：包含 category（中文类别）, fact, occurredAt, duration, structure（必须含 trigger/conflict/divergence 三大穿透要素），以及 impacts（其中 asset 为中文）的一/二阶传导推演等。\n" +
    "2) 视角侧重点（异动与冲击）：相比主路的宏观定性，快讯必须突出“时效性”与“破坏力”，强调这则快讯在当下这一刻造成的【直接冲击】与【预期混乱】。例如：资产价格在新闻发布后的瞬间反应，或社交媒体上的恐慌/FOMO情绪聚集点。\n\n" +
    "【三、 突发与异动检索策略（强制搜索路径）】\n" +
    "为捕获未被计价的黑天鹅，你的搜索和验证必须极度敏锐：\n" +
    "1) 异动搜索词：聚焦带有突发性质的词汇，如：'Breaking' / 'unexpected plunge' / 'emergency meeting' / 'trading halted' / 'whale alert' / 'geopolitical strike'。\n" +
    "2) 抢占第一现场：直接搜寻彭博/路透社终端快讯标尺、SEC 8-K文件披露、央行突发声明、或项目方/当事人官方 Twitter，尽量剔除二手咀嚼过的旧闻。\n" +
    "3) 链上与暗网前哨：搜索推特上异常集中的讨论（如某交易所疑似被黑、某地突发冲突的现场视频、链上巨额资产异动），即使主流媒体尚未长篇大论，只要多源证实且影响恶劣，即可作为快讯上报。\n\n" +
    "【四、 格式要求】\n" +
    "仅输出一个 JSON 代码块，顶层字段为 topStories。保持极度冷峻、客观的情报体风格。"
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
      occurredAt: cleanText(src.occurredAt || src.time || fb.occurredAt, "", 64),
      duration: cleanText(src.duration || src.period || fb.duration, "", 64),
      structure: normalizeStoryStructure(src.structure || src.deconstruction || src.analysis, fact),
      impacts: normalizeImpactScope(src.impacts || src.impactScopes || src.scopes || src.impact || fb.impacts),
      nextWatch: cleanText(src.nextWatch || src.next_watch || src.watch || fb.nextWatch, "关注后续权威来源确认。", 180),
      sourceName: normalizeSourceName(src.sourceName || src.source || fb.sourceName, ""),
      sourceUrl: normalizeSourceUrl(src.sourceUrl || src.url || fb.sourceUrl),
    });
  }
  if (out.length === 0) {
    out.push(fallbackRows[0] || fallbackTopStory(0));
  }
  return out;
}

export function renderDailyTopStoriesMarkdown(stories) {
  return (stories || [])
    .map((story, idx) => {
      const scopes = (story.impacts || []).map((imp) => `[${imp.asset}] ${imp.logic}`).join("；");
      return [
        `### ${idx + 1}. ${markdownTitle(story.title, "头条事件")}`,
        `- 发生时间：${story.occurredAt || "近期"} · ${story.duration || "持续中"}`,
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
