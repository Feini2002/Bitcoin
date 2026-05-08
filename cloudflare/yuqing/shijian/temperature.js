import { cleanText } from "./shared.js";

export function marketScoreFromSources(sources) {
  const fng = sources && sources.fng && sources.fng.ok ? Number(sources.fng.value) : 50;
  return Math.max(0, Math.min(100, Number.isFinite(fng) ? fng : 50));
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmtPct(value) {
  const n = finiteNumber(value);
  if (n == null) return "缺失";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function normalizeTemperatureAssets(sources, dashboard) {
  const srcRows =
    sources && Array.isArray(sources.assetMoves) && sources.assetMoves.length
      ? sources.assetMoves
      : sources && Array.isArray(sources.assets)
        ? sources.assets
        : [];
  const dashboardRows = dashboard && Array.isArray(dashboard.keyAssets) ? dashboard.keyAssets : [];
  const byName = new Map(dashboardRows.map((row) => [String(row && row.name ? row.name : ""), row]));
  return srcRows
    .map((row) => {
      const name = cleanText(row && row.name, "", 24);
      if (!name) return null;
      const llm = byName.get(name) || {};
      const moves = row.moves || {};
      return {
        name,
        symbol: cleanText(row.symbol || row.dataSymbol || llm.symbol || "", "", 24),
        price: finiteNumber(row.price),
        h24: finiteNumber(moves.h24 ?? row.changePct ?? llm.h24 ?? llm.change),
        d3: finiteNumber(moves.d3 ?? row.change3dPct ?? llm.d3),
        d7: finiteNumber(moves.d7 ?? row.change7dPct ?? llm.d7),
        source: cleanText(row.source || "", "", 48),
        latestAt: cleanText(row.latestAt || "", "", 48),
        ok: row.ok !== false,
        note: cleanText(llm.structure || llm.catalyst || "", "", 120),
      };
    })
    .filter(Boolean);
}

function marketMoveLine(realMarketData) {
  const names = ["比特币", "纳指", "标普500", "英伟达", "黄金"];
  const mkData = realMarketData || {};
  return names
    .map((name) => {
      const item = mkData[name] || {};
      const moves = item.moves || {};
      const symbol = item.symbol || name;
      return `${name}(${symbol}) 24h ${fmtPct(moves.h24 ?? item.change)} / 3d ${fmtPct(moves.d3)} / 7d ${fmtPct(moves.d7)}`;
    })
    .join("；");
}

export function buildDailyTemperaturePrompt(timeStr, fngScore, fngClass, realMarketData) {
  const assetLine = marketMoveLine(realMarketData);
  return (
    "当前时间：" + timeStr + "。\n" +
    "加密恐慌贪婪指数(F&G)：" + fngScore + "（" + fngClass + "）。\n" +
    "跨资产多周期背景（Worker 已按历史序列计算，不是 quote 单点）：" + assetLine + "。\n\n" +
    "你是事件日报编辑。F&G 只代表加密情绪，跨资产涨跌只代表阅读背景，两者不要混淆。\n" +
    "使用规则：24h=短线冲击，3d=短线延续，7d=背景趋势。判断温度时以 3d 为主轴，用 24h 识别突发冲击，用 7d 判断是否顺着一周背景。\n" +
    "禁止把单日涨跌叫趋势，禁止输出买入、卖出、加仓、减仓等投资或交易建议。\n\n" +
    "仅输出一个 JSON 代码块，字段必须为：\n" +
    "- sentiment_summary：用一两句话解释数字“" + fngScore + "”的含义及与多周期资产波动的联系，30字内。\n" +
    "- market_regime：从「信息过热 / 信息偏热 / 信息中性 / 信息偏冷 / 信息稀薄」中选一项。\n" +
    "- key_assets：数组，必须覆盖比特币、纳指、标普500、英伟达、黄金；每项包含 name、h24、d3、d7、structure。structure 用一句话说明 24h/3d/7d 是强化、修正还是背离。\n" +
    "- cross_asset：一句话概括跨资产背景呈现的信息密度，优先比较 3d，再补 24h/7d，35字内。\n" +
    "- anomaly_alert：若跨资产表现与 F&G 分数或多周期方向背离则提醒背离噪音，否则填无，25字内。\n" +
    "- action_suggestion：阅读今日事件的一句话建议，只能指导信息阅读权重，20字内。"
  );
}

export function buildDailyTemperature(sources, dashboard) {
  const score = marketScoreFromSources(sources);
  const regime = cleanText(dashboard && dashboard.marketRegime, score >= 70 ? "信息偏热" : score <= 35 ? "信息偏冷" : "信息中性", 32);
  const summary = cleanText(dashboard && dashboard.sentimentSummary, "基于恐慌贪婪指数计算，当前情绪中性。", 140);
  const crossAsset = cleanText(dashboard && dashboard.crossAsset, "资产呈现正常波动特征。", 120);
  const anomaly = cleanText(dashboard && dashboard.anomalyAlert, "无", 120);
  const suggestion = cleanText(dashboard && dashboard.actionSuggestion, "可正常阅读各类来源信息。", 120);
  const assets = normalizeTemperatureAssets(sources, dashboard);
  return {
    score,
    label: regime,
    summary,
    regime,
    crossAsset,
    anomaly,
    suggestion,
    assets,
  };
}
