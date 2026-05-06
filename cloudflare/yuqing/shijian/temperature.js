import { cleanText } from "./shared.js";

function marketScoreFromSources(sources) {
  const fng = sources && sources.fng && sources.fng.ok ? Number(sources.fng.value) : 50;
  return Math.max(0, Math.min(100, Number.isFinite(fng) ? fng : 50));
}

export function buildDailyTemperaturePrompt(timeStr, fngScore, fngClass, realMarketData) {
  const mkData = realMarketData || {};
  const assetLine = ["纳指", "标普500", "英伟达", "比特币", "黄金"]
    .map((name) => {
      const item = mkData[name] || {};
      return `${name} ${Number(item.change || 0)}%`;
    })
    .join("，");
  return (
    "当前时间：" +
    timeStr +
    "。\n" +
    "恐慌贪婪指数：" +
    fngScore +
    "（" +
    fngClass +
    "）。\n" +
    "辅助背景：" +
    assetLine +
    "。\n\n" +
    "你是日报编辑，不是交易分析师。请把这些数据只当作今天信息环境的背景噪声，评估「事件一览」顶部的信息温度。\n" +
    "禁止输出投资建议、买卖建议、利多利空结论；只说明今天资讯是否密集、主题是否集中、来源是否可靠、噪音是否偏多。\n\n" +
    "仅输出一个 JSON 代码块，字段必须为：\n" +
    "- sentiment_summary：一句话说明今天信息温度为什么是这个状态，30字内。\n" +
    "- market_regime：从「信息过热 / 信息偏热 / 信息中性 / 信息偏冷 / 信息稀薄」中选一项。\n" +
    "- key_assets：数组，可沿用输入里的5个背景对象，但 catalyst 写成信息温度来源，structure 写成阅读时需要注意的噪音或可信度。\n" +
    "- cross_asset：改写为主题集中度说明，60字内。\n" +
    "- anomaly_alert：改写为信息噪音/异常传播提醒，50字内。\n" +
    "- action_suggestion：改写为阅读建议，例如先看哪些来源、哪些主题需要等确认，40字内。"
  );
}

export function buildDailyTemperature(sources, dashboard) {
  const score = marketScoreFromSources(sources);
  const regime = cleanText(dashboard && dashboard.marketRegime, score >= 70 ? "信息偏热" : score <= 35 ? "信息偏冷" : "信息中性", 32);
  const summary = cleanText(dashboard && dashboard.sentimentSummary, "当前信息温度中性，先按主题密度和来源可信度阅读。", 140);
  const crossAsset = cleanText(dashboard && dashboard.crossAsset, "主题分布未形成明显单一主线。", 120);
  const anomaly = cleanText(dashboard && dashboard.anomalyAlert, "暂无明显异常传播或噪音放大。", 120);
  const suggestion = cleanText(dashboard && dashboard.actionSuggestion, "优先阅读高可信来源，争议信息等待二次确认。", 120);
  return {
    score,
    label: regime,
    summary,
    regime,
    crossAsset,
    anomaly,
    suggestion,
  };
}
