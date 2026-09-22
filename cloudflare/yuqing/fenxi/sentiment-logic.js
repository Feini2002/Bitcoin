import { itemSummary } from "../shijian/index.js";

/** 舆情分析 (sentiment_analysis) 核心逻辑：结合上游事件日报与当前市场快照进行二次研判。 */

export function marketStateFromLegacy(legacy, marketSnapshot) {
  const dash = legacy && legacy.dashboard ? legacy.dashboard : null;
  const src = marketSnapshot && marketSnapshot.data && marketSnapshot.data.derivativesSnapshot && marketSnapshot.data.derivativesSnapshot.data;
  const hasDash = !!(dash && dash.sentimentSummary);
  const hasMarket = !!(marketSnapshot && marketSnapshot.ok);
  const noPrice = !!(marketSnapshot && (marketSnapshot.tradingNarrativeForbidden || marketSnapshot.pricePathAvailable === false));
  if (noPrice) {
    return {
      regime: "无价格路径 / 仅宏观背景",
      score: null,
      bias: "未评分",
      confidence: null,
      scoreNote: "主行情不可用，不得输出交易向段落",
      summary: "无价格路径 / 仅宏观背景。不得把宏观背景或过期期权写成交易确认。",
      keyAssets: [
        { name: "BTC", change: "", stance: "无价格路径", driver: "desk chart 未提供权威币安序列。" },
        { name: "环境背景", change: "", stance: "可看宏观卡片", driver: "FRED/SOFR/稳定币仅作 system_observed 背景。" },
      ],
    };
  }
  return {
    regime: dash && dash.marketRegime ? dash.marketRegime : hasMarket ? "市场数据可用，等待二次确认" : "市场快照存在缺口",
    score: null,
    bias: "未评分",
    confidence: null,
    scoreNote: hasDash ? "已有日报摘要，不把可用性写成概率" : hasMarket ? "市场快照可读，不等于方向概率" : "输入不足",
    summary:
      dash && dash.crossAsset
        ? dash.crossAsset
        : "已读取事件日报和市场监测上下文，详细交易推演需结合风险雷达与机会条件。",
    keyAssets: Array.isArray(dash && dash.keyAssets)
      ? dash.keyAssets.map((x) => ({
          name: x.name || "",
          change: x.change != null ? String(x.change) : "",
          stance: x.structure || x.catalyst || "",
          driver: x.catalyst || x.structure || "",
        }))
      : [
          { name: "BTC", change: "", stance: "待确认", driver: "读取主行情 Worker 快照作为背景。" },
          { name: "衍生品", change: "", stance: src ? "有快照" : "待补齐", driver: "资金费率、OI 与期权快照参与二次判断。" },
        ],
  };
}

export function riskRadarFromInputs(daily, marketSnapshot, facts) {
  const risks = [];
  const marketErrors = (marketSnapshot && marketSnapshot.errors) || [];
  if (marketErrors.length) {
    risks.push({
      level: "high",
      title: "市场监测上下文不完整",
      window: "当前",
      trigger: marketErrors.map((e) => e.source).join(" / "),
      assets: ["BTC", "衍生品", "强平"],
      response: "不要把本轮舆情结论当成完整交易信号，先核对市场监测页。",
    });
  }
  const dailyTitle = daily && daily.report && daily.report.topStory ? daily.report.topStory.title : "上游日报";
  risks.push({
    level: "mid",
    title: "上游事件继续发酵",
    window: "48-72h",
    trigger: dailyTitle,
    assets: ["BTC", "纳指", "美元", "美债"],
    response: "只在价格、资金流和衍生品结构同向时提高权重。",
  });
  if ((facts || []).length < 18) {
    risks.push({
      level: "mid",
      title: "事实池覆盖不足",
      window: "本轮",
      trigger: "D1 事实条目偏少",
      assets: ["信息质量"],
      response: "等待下一轮日报或手动强制增量搜索。",
    });
  }
  return risks.slice(0, 4);
}

export function opportunitiesFromInputs(daily, marketSnapshot) {
  const hasMarket = !!(marketSnapshot && marketSnapshot.ok);
  const noPrice = !!(marketSnapshot && (marketSnapshot.tradingNarrativeForbidden || marketSnapshot.pricePathAvailable === false));
  return [
    {
      label: "顺势确认",
      direction: "BTC 方向确认",
      setup: noPrice
        ? "无价格路径时不得提高方向权重；宏观背景不能证明交易桌已活。"
        : hasMarket ? "仅当事件、价格与衍生品同向时再提高权重；数据可用不等于证据同向。" : "先恢复市场快照，再判断方向。",
      invalidation: "价格反应与事件叙事背离，或资金费率/OI 与价格路径不同步。",
      priority: null,
      enabled: hasMarket && !noPrice,
      aligned: false,
    },
    {
      label: "等待复核",
      direction: "不追第一反应",
      setup: "事件发生后等待 1-2 根高波动 K 线收敛，再观察 ETF/资金流确认。",
      invalidation: "上游日报事件被官方来源否认或热度迅速消退。",
      priority: null,
    },
  ];
}

export function calendarFromFacts(facts) {
  const rows = [];
  for (const it of facts || []) {
    if (rows.length >= 6) break;
    const cat = String(it.category || "").toLowerCase();
    const title = String(it.title || "");
    if (!/macro|calendar|economic|cpi|fed|fomc|就业|通胀|利率/i.test(`${cat} ${title}`)) continue;
    const published = Number(it.publishedAt);
    const fetched = Number(it.fetchedAt);
    const eventAt = Number.isFinite(published) ? published : Number.isFinite(fetched) ? fetched : null;
    if (eventAt == null) continue;
    rows.push({
      id: it.id || `event-${rows.length}`,
      title: title || "宏观事件",
      startsAtUtc: new Date(eventAt).toISOString(),
      precision: Number.isFinite(published) ? "source_published" : "fetched_only",
      displayTimezone: "Asia/Shanghai",
      sourceType: it.sourceType || "fact_pool",
      sourceName: it.source || "Yuqing D1",
      sourceUrl: it.url || "",
      confidence: it.confidence == null ? null : Number(it.confidence),
      impactScore: it.confidence == null ? null : Math.round(Number(it.confidence) * 100),
      assets: ["BTC", "美元", "美债", "纳指"],
      why: itemSummary(it, "宏观事件可能影响风险资产定价。"),
      officialSchedule: null,
      futureCatalyst: false,
    });
  }
  return rows;
}

export function trendReadForSentiment(legacy, incremental) {
  const md = legacy && legacy.sections && legacy.sections.trends && legacy.sections.trends.markdown;
  return {
    strengthening: md ? ["云端趋势模块已生成，结合事件日报与市场快照给出二次判断。"] : ["事件日报和市场监测已合并为本轮舆情底座。"],
    fracturing: incremental && incremental.used ? ["本轮触发按需增量搜索，说明上游事实或市场上下文存在缺口。"] : ["未执行增量搜索，覆盖状态未知，不能据此声称来源已足够。"],
    checklist: ["先核对市场监测页数据新鲜度。", "再看事件日报主题是否继续出现新事实。", "最后用风险雷达决定是否需要降低仓位或等待确认。"],
  };
}
