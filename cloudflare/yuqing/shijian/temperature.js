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
      const ch = Number(item.change || 0);
      return `${name} ${ch > 0 ? "+" : ""}${ch}%`;
    })
    .join("，");
  return (
    "当前时间：" + timeStr + "。\n" +
    "加密恐慌贪婪指数(F&G)：" + fngScore + "（" + fngClass + "）。\n" +
    "跨资产背景(ETF/24h口径)：" + assetLine + "。\n\n" +
    "你是事件日报编辑。该分数仅代表加密市场情绪，跨资产背景仅作参考，两者不要混淆。\n" +
    "评估今天整体的「信息温度」。禁止输出投资或买卖建议。\n\n" +
    "仅输出一个 JSON 代码块，字段必须为：\n" +
    "- sentiment_summary：用一两句话解释数字“" + fngScore + "”的含义及与近期资产波动的联系，30字内。\n" +
    "- market_regime：从「信息过热 / 信息偏热 / 信息中性 / 信息偏冷 / 信息稀薄」中选一项。\n" +
    "- cross_asset：一句话概括跨资产背景（" + assetLine + "）呈现的信息密度，20字内。\n" +
    "- anomaly_alert：若跨资产表现与 F&G 分数背离则提醒背离噪音，否则填无，20字内。\n" +
    "- action_suggestion：阅读今日事件的一句话建议，20字内。"
  );
}

export function buildDailyTemperature(sources, dashboard) {
  const score = marketScoreFromSources(sources);
  const regime = cleanText(dashboard && dashboard.marketRegime, score >= 70 ? "信息偏热" : score <= 35 ? "信息偏冷" : "信息中性", 32);
  const summary = cleanText(dashboard && dashboard.sentimentSummary, "基于恐慌贪婪指数计算，当前情绪中性。", 140);
  const crossAsset = cleanText(dashboard && dashboard.crossAsset, "资产呈现正常波动特征。", 120);
  const anomaly = cleanText(dashboard && dashboard.anomalyAlert, "无", 120);
  const suggestion = cleanText(dashboard && dashboard.actionSuggestion, "可正常阅读各类来源信息。", 120);
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
