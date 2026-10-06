/* =======================================================
   Derivatives panel page
   ======================================================= */

const DERIV_SYMBOL = "BTCUSDT";
const DERIV_RANGE = "30d";

/** 阈值与 `衍生品面板/derivativesSnapshotCore.mjs` 对齐，勿单向改数。 */
const DERIV_FUNDING_CROWD_ABS = 0.0005;
const DERIV_RATIO_BAND_HIGH = 1.05;
const DERIV_RATIO_BAND_LOW = 0.95;
const DERIV_TAKER_IMBALANCE_TOL = 0.1;
const DERIV_LONG_SHORT_CHIP_WARN = 0.12;
const DERIV_BASIS_ELEVATED_PCT = 8;
const DERIV_BASIS_DISCOUNT_PCT = -1;
let derivativesTimer = null;
let derivativesInFlight = false;
let derivativesGeneration = 0;
let derivativesPayload = null;
let derivativesShownDesk = null;
let derivativesReadFailure = null;
let derivativesAbort = null;
let derivativesLastSyncReport = null;
let derivActivePanel = "oi";

function derivNumber(value) {
  return value == null || value === "" ? NaN : Number(value);
}

function derivSourceFamily(source) {
  return String(source || "").split("-")[0];
}

function escapeDerivHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clipDerivText(value, limit = 96) {
  const s = String(value || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length > limit ? `${s.slice(0, Math.max(0, limit - 1))}…` : s;
}

function fmtDerivValue(v, digits = 2) {
  if (v == null || v === "") return "--";
  const n = derivNumber(v);
  if (!Number.isFinite(n)) return "--";
  return n.toFixed(digits);
}

function fmtDerivPct(v, digits = 2) {
  if (v == null || v === "") return "--";
  const n = derivNumber(v);
  if (!Number.isFinite(n)) return "--";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

function fmtDerivRate(v, digits = 2, unit) {
  if (v == null || v === "") return "--";
  const n = derivNumber(v);
  if (!Number.isFinite(n)) return "--";
  const Contracts = typeof BitContracts !== "undefined" ? BitContracts : null;
  const shown = Contracts && Contracts.fundingDisplay
    ? Contracts.fundingDisplay({ rate: n, unit: unit || "decimal-per-settlement" })
    : { percent: unit === "percent" ? n : n * 100, guessedUnit: false };
  return `${shown.percent >= 0 ? "+" : ""}${shown.percent.toFixed(digits)}%`;
}

function fmtDerivFunding(v) {
  if (v == null || v === "") return "--";
  const n = derivNumber(v);
  if (!Number.isFinite(n)) return "--";
  return `${(n * 100).toFixed(4)}%`;
}

function fmtDerivCompact(v, digits = 2) {
  if (v == null || v === "") return "--";
  const n = derivNumber(v);
  if (!Number.isFinite(n)) return "--";
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(digits)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(digits)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(digits)}K`;
  return n.toFixed(digits);
}

function fmtDerivTime(t) {
  const n = derivNumber(t);
  if (!Number.isFinite(n) || n <= 0) return "--";
  return new Date(n).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function derivSeries(payload, key) {
  const rows = payload && payload.series && Array.isArray(payload.series[key]) ? payload.series[key] : [];
  return rows
    .map((row) => ({ t: derivNumber(row.t), value: derivNumber(row.value), source: row.source || "", extra: row.extra || {} }))
    .filter((row) => Number.isFinite(row.t) && Number.isFinite(row.value))
    .sort((a, b) => a.t - b.t);
}

function derivLatest(rows) {
  return rows && rows.length ? rows[rows.length - 1] : null;
}

function derivBefore(rows, target) {
  let out = null;
  for (const row of rows || []) {
    if (row.t <= target) out = row;
    else break;
  }
  return out;
}

function derivPreferSameSource(rows) {
  const sorted = [...(rows || [])].sort((a, b) => a.t - b.t);
  const last = derivLatest(sorted);
  if (!last || !last.source) return sorted;
  const same = sorted.filter((r) => derivSourceFamily(r.source) === derivSourceFamily(last.source));
  return same;
}

function derivChange(rows, ms) {
  const chain = derivPreferSameSource(rows);
  const last = derivLatest(chain);
  if (!last) return { latest: null, change: null, changePct: null, latestT: null, source: "", extra: {}, mixedSource: false };
  const prev = derivBefore(chain, last.t - ms);
  const change = prev ? last.value - prev.value : null;
  const changePct = prev && prev.value ? (change / Math.abs(prev.value)) * 100 : null;
  const mixedSource = !!(prev && derivSourceFamily(prev.source) !== derivSourceFamily(last.source));
  return { latest: last.value, change, changePct, latestT: last.t, source: last.source, extra: last.extra || {}, mixedSource };
}

function derivRatioState(value, high = DERIV_RATIO_BAND_HIGH, low = DERIV_RATIO_BAND_LOW) {
  const n = derivNumber(value);
  if (!Number.isFinite(n)) return "样本不足";
  if (n >= high) return "多头比值偏高";
  if (n <= low) return "空头比值偏低";
  return "均衡";
}

function derivBasisState(row) {
  const n = derivNumber(row && row.value);
  if (!Number.isFinite(n)) return "样本不足";
  const unit = row && row.unit;
  const pct = unit === "percent" || unit === "percent-per-year" ? n : n * 100;
  if (!unit && Math.abs(n) > 1) return "单位未声明";
  if (pct > DERIV_BASIS_ELEVATED_PCT) return "升水偏高";
  if (pct < DERIV_BASIS_DISCOUNT_PCT) return "贴水";
  if (pct > 0) return "温和升水";
  return "轻微贴水";
}

function derivTopAlignment(account, position) {
  const a = derivNumber(account && account.value);
  const p = derivNumber(position && position.value);
  if (!Number.isFinite(a) || !Number.isFinite(p)) return "样本不足";
  if (a > DERIV_RATIO_BAND_HIGH && p > DERIV_RATIO_BAND_HIGH) return "大户账户与仓位同向偏多";
  if (a < DERIV_RATIO_BAND_LOW && p < DERIV_RATIO_BAND_LOW) return "大户账户与仓位同向偏空";
  if ((a - 1) * (p - 1) < 0) return "账户与仓位分歧";
  return "大户方向中性";
}

function derivAnalyze(payload) {
  const fundingBinance = derivSeries(payload, "funding_binance");
  const oiBinance = derivSeries(payload, "oi_binance");
  const vix = derivSeries(payload, "vix");
  const vix3m = derivSeries(payload, "vix3m");
  const move = derivSeries(payload, "move");
  const longShort = derivSeries(payload, "long_short");
  const takerBuySell = derivSeries(payload, "taker_buy_sell");
  const basisPerp = derivSeries(payload, "basis_perp");
  const basisQuarter = derivSeries(payload, "basis_quarter");
  const topAccount = derivSeries(payload, "top_account_long_short");
  const topPosition = derivSeries(payload, "top_position_long_short");
  const day = 24 * 60 * 60 * 1000;
  const hour = 60 * 60 * 1000;
  const fb = derivChange(fundingBinance, day);
  const oi6h = derivChange(oiBinance, 6 * hour);
  const oi24h = derivChange(oiBinance, day);
  const vix24h = derivChange(vix, day);
  const move24h = derivChange(move, day);
  const vixLast = derivLatest(vix);
  const vix3mLast = derivLatest(vix3m);
  const vixTerm = vixLast && vix3mLast && vix3mLast.value ? vixLast.value / vix3mLast.value : null;
  const takerLatest = derivLatest(takerBuySell);
  const basisPerpLatest = derivLatest(basisPerp);
  const basisQuarterLatest = derivLatest(basisQuarter);
  const topAccountLatest = derivLatest(topAccount);
  const topPositionLatest = derivLatest(topPosition);
  const priceChange = derivNumber(payload && payload.priceChange24hPct);
  const pcm = payload && payload.priceChange24hMeta;
  const priceSampleOk =
    pcm && typeof pcm === "object" && pcm.sampleSufficient === false ? false : Number.isFinite(priceChange);
  const oi24hPctOk = Number.isFinite(oi24h.changePct);

  let divergence = "样本不足";
  if (priceSampleOk && oi24hPctOk) {
    if (priceChange > 1 && oi24h.changePct < -1) divergence = "价格上涨但 OI 下降，偏空仓减压/现货驱动";
    else if (priceChange < -1 && oi24h.changePct > 1) divergence = "价格下跌但 OI 上升，空头数量增加（非流入）";
    else if (priceChange < 0 && oi24h.changePct < -1) divergence = "价格小跌且 OI 下降，偏去杠杆/减仓";
    else if (Math.abs(priceChange) < 1 && Math.abs(oi24h.changePct) > 3) divergence = "价格横盘但 OI 快速变化，警惕杠杆蓄力";
    else divergence = "价格与 OI 暂无明显背离";
  } else if (!priceSampleOk) {
    divergence =
      pcm && typeof pcm === "object" && pcm.reasonHint
        ? String(pcm.reasonHint)
        : "价格涨跌样本不足：暂不判断价量背离（基于 1h K 线近似 24h）";
  } else if (!oi24hPctOk) {
    divergence = "OI 变化样本不足：暂不判断价量背离";
  }

  const df = payload && payload.dataFreshness ? payload.dataFreshness : {};
  const warnings = Array.isArray(df.warnings) ? df.warnings : [];
  const freshnessRollup = df.rollup || null;
  const sourceOkCore = df.sourceOk === true;
  const metricHealth = Array.isArray(payload && payload.metricHealth) ? payload.metricHealth : [];
  const sourceHealth = Array.isArray(payload && payload.sourceHealth) ? payload.sourceHealth : [];
  const stalenessReasons = Array.isArray(payload && payload.stalenessReasons) ? payload.stalenessReasons : [];
  const syncHints = payload && payload.syncHints && typeof payload.syncHints === "object" ? payload.syncHints : {};

  return {
    fundingBinance: fb,
    oi6h,
    oi24h,
    vix24h,
    move24h,
    vixTerm,
    longShort: derivLatest(longShort),
    taker: takerLatest,
    taker24h: derivChange(takerBuySell, day),
    basisPerp: basisPerpLatest,
    basisQuarter: basisQuarterLatest,
    topAccount: topAccountLatest,
    topPosition: topPositionLatest,
    topAlignment: derivTopAlignment(topAccountLatest, topPositionLatest),
    divergence,
    priceSampleOk,
    priceMeta: pcm,
    freshnessRollup,
    worstCoreStaleMinutes: df.worstCoreStaleMinutes,
    sourceOkCore,
    warnings,
    fundingMixed24h: !!fb.mixedSource,
    oiMixed24h: !!oi24h.mixedSource,
    metricHealth,
    sourceHealth,
    stalenessReasons,
    syncHints,
  };
}

function derivPath(rows, w = 520, h = 150, pad = 14) {
  if (!rows || rows.length < 2) return "";
  const values = rows.map((row) => derivNumber(row.value)).filter(Number.isFinite);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(Math.abs(max), 1);
  return rows.map((row, i) => {
    const x = pad + (i / Math.max(1, rows.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (row.value - min) / span) * (h - pad * 2);
    return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function derivChartSvg(rows, cls, label) {
  const path = derivPath(derivPreferSameSource(rows));
  return `
    <svg class="deriv-chart" viewBox="0 0 520 150" preserveAspectRatio="none" aria-label="${label}">
      <path class="deriv-chart-grid" d="M14 38 H506 M14 75 H506 M14 112 H506"></path>
      ${path ? `<path class="${cls}" d="${path}"></path>` : `<text x="260" y="80" text-anchor="middle">等待数据</text>`}
    </svg>
  `;
}

function derivDualChartSvg(aRows, bRows, aCls, bCls, label) {
  const rows = [...(aRows || []), ...(bRows || [])];
  if (rows.length < 2) {
    return `
      <svg class="deriv-chart" viewBox="0 0 520 150" preserveAspectRatio="none" aria-label="${label}">
        <text x="260" y="80" text-anchor="middle">等待数据</text>
      </svg>
    `;
  }
  const values = rows.map((row) => derivNumber(row.value)).filter(Number.isFinite);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.max(Math.abs(max), 1);
  const draw = (list) => (list || []).map((row, i) => {
    const x = 14 + (i / Math.max(1, list.length - 1)) * (520 - 28);
    const y = 14 + (1 - (row.value - min) / span) * (150 - 28);
    return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return `
    <svg class="deriv-chart" viewBox="0 0 520 150" preserveAspectRatio="none" aria-label="${label}">
      <path class="deriv-chart-grid" d="M14 38 H506 M14 75 H506 M14 112 H506"></path>
      <path class="${aCls}" d="${draw(aRows)}"></path>
      <path class="${bCls}" d="${draw(bRows)}"></path>
    </svg>
  `;
}

function derivStablecoinRows(payload) {
  const ctx = payload && payload.stablecoinContext ? payload.stablecoinContext : {};
  const usdt = derivSeries(ctx, "stable_usdt_circ");
  const usdc = derivSeries(ctx, "stable_usdc_circ");
  const hasRows = !!(usdt.length && usdc.length);
  return {
    usdt,
    usdc,
    freshness: ctx.dataFreshness || {
      sourceOk: false,
      warnings: ["稳定币背景暂无 D1 数据"],
    },
    reliability: ctx.reliability || {},
    llmGuidance: ctx.llmGuidance || {},
    hasRows,
  };
}

function derivAgentLinkHtml(agentId) {
  const agent = typeof AGENT_MAP !== "undefined" ? AGENT_MAP[agentId] : null;
  if (!agent) return "";
  return `
    <a class="owner-link deriv-owner-link" href="#/${agentRoute(agent.id)}" title="查看 ${agent.name} 的演示原型">
      <span class="owner-dot" style="background:${agent.color}">${agent.short}</span>
      <span>${agent.name}</span>
      <span class="owner-arrow"><i class="ph ph-arrow-right"></i></span>
    </a>
  `;
}

function pageDerivatives() {
  const macroView = typeof UserWorkspace !== "undefined" && UserWorkspace.view("derivatives") === "macro";
  const title = macroView ? "宏观与资金" : "杠杆与定价";
  const description = macroView ? "按各自频率核对利率、美元与资金背景；参考期与取得时间分别保留。" : "核对持仓、费率与基差的变化；区分账户样本、头部仓位和交易所来源。";
  return html`
    <section class="deriv-desk">
      <header class="rd-page-head rd-data-head"><div><div class="rd-eyebrow">${macroView ? "MACRO &amp; CAPITAL" : "DERIVATIVES &amp; PRICING"}</div><h1>${title}</h1><p>${description}</p></div><a class="btn" href="#/news">核对相关事件 ↗</a></header>
      <section class="deriv-status-strip" aria-label="${title}状态">
        <div class="deriv-status-main">
          <span class="deriv-feed-dot" aria-hidden="true"></span>
          <strong>${title}</strong>
          <span>宏观按日频、周频、月频原频率 · 合约卡片单独标状态 · 未知结算周期不写成固定 8 小时</span>
        </div>
        <div class="deriv-status-actions">
          <span class="chip warn" id="deriv-live-chip">按取得时点阅读</span>
        </div>
      </section>
      <p class="muted" id="deriv-research-evidence">宏观按日频、周频、月频展示，不套用行情主图周期。资料按系统取得时点保存；公布时刻未知时，不能据此还原当时已知的信息。</p>
      <div class="deriv-toolbar">
        <div class="deriv-action-cluster">
          <button type="button" class="btn" id="deriv-refresh"><i class="ph ph-arrow-clockwise"></i>刷新</button>
          <button type="button" class="btn" data-workbench-export>导出已显示证据</button>
          <span class="deriv-status" id="deriv-status">正在读取环境资料…</span>
        </div>
      </div>
      <div class="deriv-kpis" id="deriv-kpis">
        <div class="deriv-kpi"><span>合约状态</span><strong id="deriv-contract-state">等待读取</strong><em id="deriv-contract-note">等待 /api/desk/context</em></div>
        <div class="deriv-kpi"><span>时间口径</span><strong id="deriv-asknown">系统取得时点</strong><em>不等于当时已公开</em></div>
      </div>
      <div id="deriv-read-failure" class="desk-halt-card" hidden></div>
      <section class="desk-freq-group" id="deriv-contract-section">
        <h3>合约</h3>
        <p class="muted">标记价、交易所报告费率、已结算资金费、基差。每张卡单独标正常、部分缺失、源陈旧或采集陈旧。</p>
        <div class="desk-clock-grid" id="deriv-contract-cards"></div>
      </section>
      <section class="desk-freq-group" id="deriv-positioning-section">
        <h3>持仓与主动量摘要</h3>
        <p class="muted">OI 的 BTC 与 USDT 分开。主动量按 1h。账户样本与头部仓位样本分开。不还原混源评分或压力评分。</p>
        <div class="desk-clock-grid" id="deriv-positioning-cards"></div>
      </section>
      <div id="deriv-contract-empty" class="desk-halt-card" hidden>合约组空 · 仅宏观背景</div>
      <div class="desk-freq-groups" id="deriv-freq-groups">等待 desk context...</div>
    </section>
  `;
}
function humanizeDerivativesReadError(message) {
  const s = String(message || "");
  if (/Failed to fetch|NetworkError|NETWORK_ERROR|Load failed|ECONNREFUSED|paused|503|502|超时/i.test(s)) {
    return "页面暂停或网络失败";
  }
  return s;
}

function summarizeDerivSyncReport(report, payload) {
  if (!report) return "";
  const bits = [];
  if (Array.isArray(report.preStaleCoreMetrics) && report.preStaleCoreMetrics.length) {
    bits.push(`本次按旧指标阻塞修复：${report.preStaleCoreMetrics.slice(0, 4).join(",")}${report.repairGroup ? ` · ${report.repairGroup}` : ""}`);
  }
  if (report.repairError) {
    bits.push(`修复同步失败：${humanizeDerivativesReadError(report.repairError)}（仍将展示 D1 缓存）`);
  } else if (report.repair && typeof report.repair === "object") {
    const r = report.repair;
    if (r.skipped && (r.skippedBecause === "sync_lock_busy" || r.queuedOrSkipped === "locked")) {
      bits.push(`修复同步跳过：另一条同步进行中${r.lockUntilIso ? `，锁至 ${fmtDerivIsoShort(r.lockUntilIso)}` : ""}`);
    } else {
      const part = r.partial ? "部分成功" : r.ok ? "已返回" : "无新写入";
      const w = typeof r.written === "number" ? `写入 ${r.written} 行` : "";
      bits.push(["陈旧指标修复", part, w].filter(Boolean).join(" · "));
    }
    if (Array.isArray(r.errors) && r.errors.length) bits.push(`${r.errors.length} 个修复指标报错（仍保留 D1 缓存）`);
    if (r.hourlyUpstreamUntilIso) bits.push(`Binance hourly 网关冷却至 ${fmtDerivIsoShort(r.hourlyUpstreamUntilIso)}`);
  }
  if (report.fastError) {
    bits.push(`快速同步失败：${humanizeDerivativesReadError(report.fastError)}（仍将展示 D1 缓存）`);
  } else if (report.fast && typeof report.fast === "object") {
    const f = report.fast;
    if (f.skipped && (f.skippedBecause === "fresh_enough_fast" || f.queuedOrSkipped === "fresh_same_window")) {
      bits.push(`快速同步跳过：Funding/OI 仍在容忍窗口，未重复请求上游`);
    } else if (f.skipped && (f.skippedBecause === "sync_lock_busy" || f.queuedOrSkipped === "locked")) {
      bits.push(`同步跳过：另一条同步进行中${f.lockUntilIso ? `，锁至 ${fmtDerivIsoShort(f.lockUntilIso)}` : ""}`);
    } else {
      const part = f.partial ? "部分成功" : f.ok ? "已返回" : "无新写入";
      const w = typeof f.written === "number" ? `写入 ${f.written} 行` : "";
      bits.push(["云端快照同步", part, w].filter(Boolean).join(" · "));
    }
    const plan = f.syncPlanSummary && typeof f.syncPlanSummary === "object" ? f.syncPlanSummary : null;
    if (plan && plan.hourlyBinanceUpstreamBlocked && f.hourlyUpstreamUntilIso)
      bits.push(`Binance hourly 网关冷却至 ${fmtDerivIsoShort(f.hourlyUpstreamUntilIso)}`);
    else if (plan && plan.hourlyBinanceUpstreamBlocked) bits.push("Binance hourly 网关处于上游冷却窗口");
    if (f.customOriginPingBlockedHourly) bits.push(`自定义 BINANCE_FAPI_ORIGIN Ping 失败，已收敛 Binance hourly 写入`);
    if (Array.isArray(f.errors) && f.errors.length) {
      bits.push(`${f.errors.length} 个指标报错（仍保留 D1 缓存）`);
    }
  }
  if (report.hourlySkipped) bits.push("本次未后台排队 hourly（上游并发或锁生效）");
  else if (report.hourlyQueued) bits.push("已后台投递 1h 历史回填（wait=0，受锁与网关约束）");
  const wh = payload && payload.syncHints && payload.syncHints.workerBuild;
  if (wh) bits.push(`云端构建 ${wh}`);
  return bits.join(" · ") || "";
}

/** @param {string} iso */
function fmtDerivIsoShort(iso) {
  if (!iso) return "--";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return String(iso).slice(0, 28);
  return d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function mhFind(analyzed, key) {
  const arr = analyzed && analyzed.metricHealth ? analyzed.metricHealth : [];
  return arr.find((r) => r && String(r.metric) === String(key)) || null;
}

function derivSourceHealthExtra(row) {
  try {
    return row && row.extra_json ? JSON.parse(String(row.extra_json)) : {};
  } catch (_) {
    return {};
  }
}

function derivSourceCooldownActive(row, now = Date.now()) {
  if (!row) return false;
  const cd = derivNumber(row.cooldown_until_ms) || 0;
  if (cd <= now) return false;
  const kind = String(row.last_error_kind || "");
  const banUntilMs = derivNumber(derivSourceHealthExtra(row).binanceBanUntilMs);
  return !(kind === "blacklisted_ip" && Number.isFinite(banUntilMs) && banUntilMs + 60_000 <= now);
}

/**
 * 核心指标已达标（sourceOk）时，Binance 直连因地区限制进入冷却通常已由 Bybit/D1 承接，
 * 界面不必再用大字告警误导为「模块坏了」。
 * @param {boolean} sourceOkCore
 * @param {string | object} rowOrWarning sourceHealth 行或 Worker 写入的 warnings 文案
 */
function derivNoiseBinanceGeoRestrictedCooldown(sourceOkCore, rowOrWarning) {
  if (!sourceOkCore) return false;
  if (typeof rowOrWarning === "string") {
    const w = rowOrWarning;
    return /^\[binance_direct\]\s+上游冷却/.test(w) && /geo_restricted/i.test(w);
  }
  const row = rowOrWarning;
  return (
    String(row && row.source || "") === "binance_direct" &&
    String(row && row.last_error_kind || "") === "geo_restricted" &&
    derivSourceCooldownActive(row)
  );
}

/** 单行中文：展示陈旧分钟 + actionHintZh 截断（来自 Worker）。 */
function derivMetricStaleSubtitle(row) {
  if (!row) return "";
  if (row.level !== "stale" && row.level !== "missing") return "";
  const parts = [];
  if (typeof row.ageMinutes === "number" && Number.isFinite(row.ageMinutes)) parts.push(`${row.ageMinutes}m`);
  let hint = String(row.reasonZh || row.actionHintZh || "").replace(/\s+/g, "");
  hint = hint.length > 80 ? `${hint.slice(0, 78)}…` : hint;
  if (hint) parts.push(hint);
  return parts.filter(Boolean).join(" · ").slice(0, 168);
}

function summarizeDerivUpstreamBrief(rows, binMode, sourceOkCore = false) {
  const raw = Array.isArray(rows) ? rows : [];
  const list = sourceOkCore ? raw.filter((r) => !derivNoiseBinanceGeoRestrictedCooldown(true, r)) : raw;
  if (!list.length) {
    if (sourceOkCore && raw.some((r) => derivNoiseBinanceGeoRestrictedCooldown(true, r))) {
      return `${binMode || "direct"}｜备用链路可用（已收起 Binance 直连地区限制提示）`;
    }
    return `--（${binMode || "未知"} · 暂无 sourceHealth）`;
  }
  const cooled = [];
  for (const r of list.slice(0, 8)) {
    const nm = String(r.source || "").slice(0, 22);
    const k = String(r.last_error_kind || "").slice(0, 24);
    const cd = derivNumber(r.cooldown_until_ms) || 0;
    if (nm && derivSourceCooldownActive(r))
      cooled.push(`${nm}:${k || "upstream"}@${fmtDerivIsoShort(new Date(cd).toISOString())}`);
    else if (nm && k) cooled.push(`${nm}:${k}`);
  }
  const tail = cooled.length ? cooled.slice(0, 4).join("；") : "各源近期无告警摘要";
  return `${binMode || "direct"}｜${tail}`;
}

function deriveFundingSourceLabel(payload, analyzed) {
  const snap = derivLatest(derivSeries(payload, "funding_binance"));
  const fb = analyzed && analyzed.fundingBinance;
  return ((fb && fb.source) ? fb.source : null) || (snap && snap.source) || "--";
}

function derivOiChipMeta(a) {
  const oiPctOk = Number.isFinite(a.oi24h && a.oi24h.changePct);
  if (!a.priceSampleOk || !oiPctOk) return { cls: "chip", label: "样本不足" };
  if (/价格上涨|价格下跌|横盘|小跌/.test(a.divergence)) return { cls: "chip warn", label: "有价量线索" };
  return { cls: "chip ok", label: "无明显背离" };
}

function derivDataConfidenceLabel(a) {
  const roll = a.freshnessRollup && a.freshnessRollup.core ? a.freshnessRollup.core : null;
  const core = roll ? `${roll.okCount}/${roll.totalKeys}` : "--";
  const stale = typeof a.worstCoreStaleMinutes === "number" && Number.isFinite(a.worstCoreStaleMinutes)
    ? `最旧 ${a.worstCoreStaleMinutes}m`
    : "最旧 --";
  return {
    value: core,
    note: `${a.sourceOkCore ? "核心达标" : "核心需留意"} · ${stale}`,
    chip: a.sourceOkCore ? "chip ok" : "chip warn",
  };
}

function renderDerivMetricCells(items) {
  return (items || []).map((item) => `
    <span>
      <b>${escapeDerivHtml(item.label)}</b>
      <strong>${escapeDerivHtml(item.value)}</strong>
    </span>
  `).join("");
}

function buildDerivPanelDefinitions(payload, a, ctx) {
  const takerExtra = a.taker && a.taker.extra ? a.taker.extra : {};
  const perpExtra = a.basisPerp && a.basisPerp.extra ? a.basisPerp.extra : {};
  const quarterExtra = a.basisQuarter && a.basisQuarter.extra ? a.basisQuarter.extra : {};
  const topAccountExtra = a.topAccount && a.topAccount.extra ? a.topAccount.extra : {};
  const topPositionExtra = a.topPosition && a.topPosition.extra ? a.topPosition.extra : {};
  const fv = derivNumber(a.fundingBinance.latest);
  const takerRatio = a.taker && a.taker.value;
  const longShortRatio = a.longShort && a.longShort.value;
  const basisState = derivBasisState(a.basisQuarter);
  const fundingCrowded = Number.isFinite(fv) && Math.abs(fv) >= DERIV_FUNDING_CROWD_ABS;
  const takerImbalanced = a.taker && Math.abs(derivNumber(takerRatio) - 1) >= DERIV_TAKER_IMBALANCE_TOL;
  const basisWarn = basisState.includes("偏高") || basisState.includes("贴水");
  const topWarn = a.topAlignment.includes("分歧") || a.topAlignment.includes("同向");
  const longShortWarn = a.longShort && Math.abs(derivNumber(longShortRatio) - 1) >= DERIV_LONG_SHORT_CHIP_WARN;
  return [
    {
      key: "funding",
      label: "Funding",
      title: "资金费率",
      value: fmtDerivFunding(a.fundingBinance.latest),
      state: !Number.isFinite(fv) ? "样本不足" : fundingCrowded ? "偏高" : "中性",
      chip: fundingCrowded ? "chip warn" : "chip ok",
      note: `${fundingCrowded ? "费率进入偏高区" : "费率暂未偏高"} · ${ctx.fundingSrcLabel}`,
      metrics: [
        { label: "当前", value: fmtDerivFunding(a.fundingBinance.latest) },
        { label: "24h变化", value: fmtDerivFunding(a.fundingBinance.change) },
        { label: "来源", value: ctx.fundingSrcLabel },
      ],
      chart: derivChartSvg(derivSeries(payload, "funding_binance"), "deriv-path-funding", "资金费率"),
      evidence: `Binance 永续 Funding；阈值 ${fmtDerivFunding(DERIV_FUNDING_CROWD_ABS)}，只用于偏高提示。`,
    },
    {
      key: "oi",
      label: "OI",
      title: "未平仓合约 OI",
      value: fmtDerivPct(a.oi24h.changePct),
      state: ctx.oiChip.label,
      chip: ctx.oiChip.cls,
      note: a.divergence,
      metrics: [
        { label: "当前", value: fmtDerivCompact(a.oi24h.latest, 2) },
        { label: "6h", value: fmtDerivPct(a.oi6h.changePct) },
        { label: "24h", value: fmtDerivPct(a.oi24h.changePct) },
      ],
      chart: derivChartSvg(derivSeries(payload, "oi_binance"), "deriv-path-oi", "未平仓合约"),
      evidence: "价涨跌来自 1h K 线近似 24h；只在价格样本与 OI 样本都足够时判断背离。",
    },
    {
      key: "taker",
      label: "Taker",
      title: "主动买卖量",
      value: fmtDerivValue(takerRatio, 3),
      state: derivRatioState(takerRatio),
      chip: takerImbalanced ? "chip warn" : "chip ok",
      note: !a.taker ? "主动成交样本不足" : takerImbalanced ? "主动成交明显失衡" : "主动成交暂偏均衡",
      metrics: [
        { label: "Buy", value: fmtDerivCompact(takerExtra.buyVol, 2) },
        { label: "Sell", value: fmtDerivCompact(takerExtra.sellVol, 2) },
        { label: "Ratio", value: fmtDerivValue(takerRatio, 3) },
      ],
      chart: derivChartSvg(derivSeries(payload, "taker_buy_sell"), "deriv-path-taker", "主动买卖比"),
      evidence: "Binance Taker Buy/Sell Volume · 1h；只展示主动成交方向失衡。",
    },
    {
      key: "basis",
      label: "Basis",
      title: "基差 / 年化基差",
      value: fmtDerivRate(a.basisQuarter && a.basisQuarter.value),
      state: basisState,
      chip: basisWarn ? "chip warn" : "chip ok",
      note: `Perp ${fmtDerivRate(perpExtra.basisRate)} · Quarter ${fmtDerivRate(quarterExtra.basisRate)}${ctx.basisQSub ? ` · ${ctx.basisQSub}` : ""}`,
      metrics: [
        { label: "Perp", value: fmtDerivRate(a.basisPerp && a.basisPerp.value) },
        { label: "季度", value: fmtDerivRate(a.basisQuarter && a.basisQuarter.value) },
        { label: "Basis", value: fmtDerivValue(quarterExtra.basis, 2) },
      ],
      chart: derivChartSvg(derivSeries(payload, "basis_quarter"), "deriv-path-basis", "季度年化基差"),
      evidence: "PERPETUAL 与 CURRENT_QUARTER 分开读；季度年化基差用于升水/贴水状态。",
    },
    {
      key: "top",
      label: "Top Trader",
      title: "Top Trader 多空比",
      value: fmtDerivValue(a.topPosition && a.topPosition.value, 3),
      state: a.topAlignment,
      chip: topWarn ? "chip warn" : "chip ok",
      note: `账户 ${fmtDerivValue(a.topAccount && a.topAccount.value, 3)} · 持仓 ${fmtDerivValue(a.topPosition && a.topPosition.value, 3)}${ctx.topPosSub ? ` · ${ctx.topPosSub}` : ""}`,
      metrics: [
        { label: "账户", value: fmtDerivValue(a.topAccount && a.topAccount.value, 3) },
        { label: "持仓", value: fmtDerivValue(a.topPosition && a.topPosition.value, 3) },
        { label: "差值", value: fmtDerivValue(derivNumber(a.topPosition && a.topPosition.value) - derivNumber(a.topAccount && a.topAccount.value), 3) },
      ],
      chart: derivChartSvg(derivSeries(payload, "top_position_long_short"), "deriv-path-top", "Top Trader 持仓比"),
      evidence: `账户多 ${fmtDerivRate(topAccountExtra.longAccount, 1)} / 空 ${fmtDerivRate(topAccountExtra.shortAccount, 1)}；持仓多 ${fmtDerivRate(topPositionExtra.longAccount ?? topPositionExtra.longPosition, 1)} / 空 ${fmtDerivRate(topPositionExtra.shortAccount ?? topPositionExtra.shortPosition, 1)}。`,
    },
    {
      key: "longshort",
      label: "Long/Short",
      title: "全市场多空比",
      value: fmtDerivValue(longShortRatio, 3),
      state: derivRatioState(longShortRatio),
      chip: longShortWarn ? "chip warn" : "chip ok",
      note: "普通账户 Long/Short Ratio，用于对照大户方向",
      metrics: [
        { label: "Ratio", value: fmtDerivValue(longShortRatio, 3) },
        { label: "Long", value: fmtDerivRate(a.longShort && a.longShort.extra && a.longShort.extra.longAccount, 1) },
        { label: "Short", value: fmtDerivRate(a.longShort && a.longShort.extra && a.longShort.extra.shortAccount, 1) },
      ],
      chart: derivChartSvg(derivSeries(payload, "long_short"), "deriv-path-longshort", "全市场多空比"),
      evidence: "全市场账户比只作为 Top Trader 的方向对照，不与大户仓位混成同一口径。",
    },
  ];
}

function renderDerivPanelCard(panel) {
  const active = panel.key === derivActivePanel;
  return `
    <button type="button" class="deriv-matrix-card${active ? " active" : ""}" data-deriv-panel="${escapeDerivHtml(panel.key)}" aria-pressed="${active ? "true" : "false"}">
      <span class="deriv-matrix-top">
        <span>${escapeDerivHtml(panel.label)}</span>
        <em class="${escapeDerivHtml(panel.chip)}">${escapeDerivHtml(panel.state)}</em>
      </span>
      <strong>${escapeDerivHtml(panel.value)}</strong>
      <small>${escapeDerivHtml(clipDerivText(panel.note, 72))}</small>
    </button>
  `;
}

function renderDerivActivePanel(panel) {
  return `
    <section class="deriv-card deriv-panel-detail">
      <div class="deriv-card-head">
        <div>
          <div class="card-title">${escapeDerivHtml(panel.title)}</div>
          <div class="deriv-sub">${escapeDerivHtml(clipDerivText(panel.note, 120))}</div>
        </div>
        <span class="${escapeDerivHtml(panel.chip)}">${escapeDerivHtml(panel.state)}</span>
      </div>
      <div class="deriv-metrics deriv-detail-metrics">
        ${renderDerivMetricCells(panel.metrics)}
      </div>
      <div class="deriv-note">${escapeDerivHtml(panel.evidence)}</div>
      ${panel.chart}
    </section>
  `;
}

function renderDerivativesPayload(_payload, _syncReport = null) {
  return;
}
function fmtDeskClock(iso) {
  if (!iso) return "未知";
  if(/^\d{4}-\d{2}-\d{2}$/.test(String(iso)))return String(iso)+'（日期）';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "未知";
  return d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function fmtDeskMinute(iso) {
  if(/^\d{4}-\d{2}-\d{2}$/.test(String(iso)))return String(iso)+'（日期）';
  const n = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(n) || n <= 0) return "未知";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(n));
  const pick = (type) => {
    const part = parts.find((row) => row.type === type);
    return part ? part.value : "";
  };
  const hour = pick("hour") === "24" ? "00" : pick("hour");
  return `${pick("year")}-${pick("month")}-${pick("day")} ${hour}:${pick("minute")}`;
}

function fmtDeskPlain(value) {
  if (value == null || typeof value === 'boolean' || typeof value === 'object' || String(value).trim() === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return Object.is(n, -0) ? "0" : String(n);
}

function derivFactMissing(card) {
  return !card || card.unavailable === true || card.missing === true;
}

function derivFactStatus(card) {
  if (derivFactMissing(card)) return "部分缺失";
  const bits = [];
  if (card.sourceStale === true) bits.push("源陈旧");
  if (card.collectionStale === true) bits.push("采集陈旧");
  if (card.sourceStale !== true && card.sourceStale !== false) bits.push("源时效未知");
  if (card.collectionStale !== true && card.collectionStale !== false) bits.push("采集时效未知");
  if (card.quality?.status === 'partial' || card.quality?.status === 'fail') bits.push("覆盖不完整");
  return bits.length ? bits.join(" · ") : "正常";
}

function derivStatusClass(text) {
  return text === "正常" ? "chip ok" : "chip warn";
}

function fundingIntervalLabel(card) {
  const basis = String(card && card.intervalBasis || "");
  const hours = Number(card && card.fundingIntervalHours);
  if (!basis || basis === "unknown" || !Number.isFinite(hours) || hours <= 0) return "未知";
  return `${hours} 小时`;
}

function derivDisplayLine(line){
  const match=String(line).match(/^(.*)：(-?\d+(?:\.\d+)?)\s+((?:decimal|percent)(?:-[\w-]+)?)$/);
  if(match){const suffix=match[3].includes('year')?' / 年':match[3].includes('settlement')?' / 本次结算':match[3].includes('1h')?' / 1h':match[3].includes('8h')?' / 8h':'';return match[1]+'：'+(Number(match[2])*(match[3].startsWith('decimal')?100:1)).toLocaleString('en-US',{maximumFractionDigits:8})+'%'+suffix;}
  return String(line).replaceAll('USD-pegged-supply','美元计价供应').replaceAll('exchange-funding-info','交易所结算信息');
}

function derivFactCard(key, title, lines, card) {
  const status = derivFactStatus(card),items=lines.map(derivDisplayLine);
  const measures=items.filter(line=>!line.startsWith('参考期：')&&!line.startsWith('公开可得：'));
  const clocks=items.filter(line=>line.startsWith('参考期：')||line.startsWith('公开可得：'));
  if(!clocks.some(line=>line.startsWith('参考期：')))clocks.push('观察时间：'+fmtDeskMinute(card?.referencePeriod));
  clocks.push('接收时间：'+fmtDeskMinute(card?.receivedAt));
  if(!clocks.some(line=>line.startsWith('公开可得：')))clocks.push('公开可得：'+fmtDeskMinute(card?.publicAvailableAt));
  const note = card?.note ? ({
    premium: '交易所当前报告的费率与已结算资金费分别阅读。',
    funding: '按实际结算时点阅读；系统取得时间与结算时间分列，周期未知时不作推定。',
    basis: '基差、基差率和年化率各自独立；缺失值保留为空，不代为换算。',
  }[key] || card.note) : '';
  return `<article class="desk-clock-card desk-fact-row" data-deriv-card="${escapeDerivHtml(key)}"><div class="desk-fact-name"><h4>${escapeDerivHtml(title)}</h4><span class="${derivStatusClass(status)}">${escapeDerivHtml(status)}</span></div><dl class="desk-fact-values">${measures.map(line=>{const colon=line.indexOf('：');return '<div><dt>'+escapeDerivHtml(colon<0?'原读数':line.slice(0,colon))+'：</dt><dd>'+escapeDerivHtml(colon<0?line:line.slice(colon+1))+'</dd></div>';}).join('')}</dl><div class="desk-fact-clock">${clocks.map(line=>'<p>'+escapeDerivHtml(line)+'</p>').join('')}</div><details class="desk-fact-original" data-receipt="${escapeDerivHtml(key)}"><summary>来源、原值与使用边界</summary>${note?'<p>'+escapeDerivHtml(note)+'</p>':''}<pre class="team-raw">${escapeDerivHtml(JSON.stringify(card,null,2))}</pre></details></article>`;
}

function derivValueLines(card, lines) {
  return derivFactMissing(card) ? lines.map((line) => line.replace(/：.*/, "：—")) : lines;
}

function contractPremiumLines(card) {
  const values = card && card.values || {};
  return derivValueLines(card, [
    `标记价：${fmtDeskPlain(values.markPrice)} USDT/BTC`,
    `交易所报告费率：${fmtDeskPlain(values.lastFundingRate)} decimal`,
  ]);
}

function contractFundingLines(card) {
  const values = card && card.values || {};
  return derivValueLines(card, [
    `已结算资金费：${fmtDeskPlain(values.fundingRate)} decimal-per-settlement`,
    `结算周期：${fundingIntervalLabel(card)}`,
  ]);
}

function contractBasisLines(card) {
  const values = card && card.values || {};
  return derivValueLines(card, [
    `基差：${fmtDeskPlain(values.basis)} USDT/BTC`,
    `基差率：${fmtDeskPlain(values.basisRate)} decimal`,
    `年化基差率：${values.annualizedBasisRate == null ? "暂无可核对的年化值" : `${fmtDeskPlain(Number(values.annualizedBasisRate) * 100)}% / 年`}`,
  ]);
}

function positioningOiLines(card) {
  const values = card && card.values || {};
  const amount = card && card.value != null ? card.value : values.openInterest;
  return derivValueLines(card, [
    `未平仓量：${fmtDeskPlain(amount)} BTC`,
    "单位：BTC",
  ]);
}

function positioningOiHistoryLines(card) {
  const values = card && card.values || {};
  return derivValueLines(card, [
    `未平仓量：${fmtDeskPlain(values.sumOpenInterest)} BTC`,
    `未平仓名义：${fmtDeskPlain(values.sumOpenInterestValue)} USDT`,
    `周期：${card && card.period ? card.period : "1h"}`,
  ]);
}

function positioningTakerLines(card) {
  const values = card && card.values || {};
  return derivValueLines(card, [
    `主动买：${fmtDeskPlain(values.buyVol)} BTC`,
    `主动卖：${fmtDeskPlain(values.sellVol)} BTC`,
    `周期：${card && card.period ? card.period : "1h"}`,
  ]);
}

function positioningAccountsLines(card) {
  const values = card && card.values || {};
  return derivValueLines(card, [
    `多空比：${fmtDeskPlain(values.longShortRatio)} ratio`,
    `样本：${card && card.sample ? card.sample : "未标明"}`,
    `周期：${card && card.period ? card.period : "1h"}`,
  ]);
}

function positioningTopLines(card) {
  const values = card && card.values || {};
  return derivValueLines(card, [
    `多空比：${fmtDeskPlain(values.longShortRatio)} ratio`,
    `样本：${card && card.sample ? card.sample : "未标明"}`,
    `周期：${card && card.period ? card.period : "1h"}`,
  ]);
}

function derivContractCards(contract) {
  const ready = contract && contract.unavailable !== true ? contract : {};
  return [
    derivFactCard("premium", "标记价与交易所报告费率", contractPremiumLines(ready.premium), ready.premium || { unavailable: true }),
    derivFactCard("funding", "已结算资金费", contractFundingLines(ready.funding), ready.funding || { unavailable: true }),
    derivFactCard("basis", "基差", contractBasisLines(ready.basis), ready.basis || { unavailable: true }),
  ].join("");
}

function derivPositioningCards(contract) {
  const positioning = contract && contract.positioning || {};
  const missing = { unavailable: true, missing: true };
  return [
    derivFactCard("oi", "未平仓量", positioningOiLines(positioning.oi || missing), positioning.oi || missing),
    derivFactCard("oiHistory", "未平仓历史", positioningOiHistoryLines(positioning.oiHistory || missing), positioning.oiHistory || missing),
    derivFactCard("taker", "主动量", positioningTakerLines(positioning.taker || missing), positioning.taker || missing),
    derivFactCard("accounts", "账户样本", positioningAccountsLines(positioning.accounts || missing), positioning.accounts || missing),
    derivFactCard("topPositions", "头部仓位样本", positioningTopLines(positioning.topPositions || missing), positioning.topPositions || missing),
  ].join("");
}

function derivRenderedCards(contract) {
  const ready = contract && contract.unavailable !== true;
  const positioning = ready && contract.positioning ? contract.positioning : {};
  const slots = ready ? [contract.premium, contract.funding, contract.basis] : [];
  if (ready) slots.push(positioning.oi, positioning.oiHistory, positioning.taker, positioning.accounts, positioning.topPositions);
  return slots.filter(Boolean);
}

function derivHeadline(desk, failure) {
  if (failure) {
    const when = fmtDeskMinute(failure.at);
    const kept = derivativesShownDesk ? "desk context 已返回 · 陈旧" : "没有上一次成功展示";
    return `读取失败 · 失败时间 ${when} · ${failure.message} · ${kept}`;
  }
  if (!desk || !desk.contract || desk.contract.unavailable) return "合约组空 · 仅宏观背景";
  const statuses = derivRenderedCards(desk.contract).map(derivFactStatus);
  const bits = ["desk context 已返回"];
  if (statuses.some((text) => text.indexOf("部分缺失") >= 0)) bits.push("部分缺失");
  if (statuses.some((text) => text.indexOf("源陈旧") >= 0)) bits.push("源陈旧");
  if (statuses.some((text) => text.indexOf("采集陈旧") >= 0)) bits.push("采集陈旧");
  if(statuses.some(text=>text.includes('未知')))bits.push('时效未知');
  if (bits.length === 1) bits.push("正常");
  return bits.join(" · ");
}

function renderMacroGroups(desk) {
  const groupsEl = document.getElementById("deriv-freq-groups");
  if (!groupsEl) return;
  const groups = desk && desk.groups || {};
  const macroView=typeof UserWorkspace!=="undefined"&&UserWorkspace.view("derivatives")==="macro";
  const order = macroView ? ["dailyRates", "weeklyDollarH41", "monthlyCpi", "cryptoBackground"] : [];
  const content = order.map((key) => {
    const g = groups[key];
    if (!g) return "";
    const cards = (g.cards || []).map((c) => {
      const values=c.values||{},lines=[];
      const add=(label,value,unit)=>lines.push(label+'：'+fmtDeskPlain(value)+' '+(unit||''));
      if(c.id==='stablecoin-supply'){
        for(const coin of values.coins||[])if(['USDT','USDC'].includes(coin.symbol)){add(coin.symbol+' 供应',coin.circulating,'USD-pegged-supply');add(coin.symbol+' 价格',coin.price,'USD');}
      }else if(c.id==='crypto-breadth'){add('市值',values.marketCap,'USD');add('聚合 24h 成交',values.volume24h,'USD');add('BTC 市值占比',values.btcDominance,'%');}
      else if(c.id==='btc-fees'){for(const [key,label]of [['fastestFee','最快'],['halfHourFee','半小时'],['hourFee','一小时'],['minimumFee','最低']])add(label,values[key],'sat/vB');}
      else add('参考值',c.value??values.value??values.percentRate,Object.values(c.units||{})[0]);
      lines.push('参考期：'+fmtDeskClock(c.referenceDate||c.referencePeriod),'公开可得：'+fmtDeskClock(c.publicAvailableAt));
      return derivFactCard(c.id,c.label||c.id,lines,c);
    }).join("");
    return `<section class="desk-freq-group"><h3>${escapeDerivHtml(g.title || key)}</h3>${g.planned ? "<p>PLANNED · 非官方波动率本轮不上屏</p>" : ""}${g.residualForbidden ? "<p>禁止 WALCL−TGA−RRP 残差</p>" : ""}<div class="desk-clock-grid">${cards || "<p>无观测</p>"}</div></section>`;
  }).join("")+(macroView?"":renderExternalDerivatives(desk));
  DeskVisual.replace(groupsEl,content);
}

function renderExternalDerivatives(desk){
  const d=desk.comparison?.deribit;
  let html='<section class="desk-freq-group"><h3>Deribit · BTC 反向永续</h3><p>USD 报价、BTC 结算；持仓 USD 不与 Binance 的 BTC 持仓相加。资金费率按原周期分列。</p>';
  if(!d)html+='<p>当前数据服务未返回此组，覆盖未知。</p>';
  else{const v=d.values||{},h=d.hourlyFunding||{},hv=h.values||{};html+='<div class="desk-clock-grid">'+derivFactCard('deribit-perp',d.instrumentId||'Deribit BTC-PERPETUAL',[`标记价：${fmtDeskPlain(v.mark_price)} USD/BTC`,`未平仓名义：${fmtDeskPlain(v.open_interest)} USD`,`当前资金费：${fmtDeskPlain(v.current_funding)} decimal`,`8h 资金费：${fmtDeskPlain(v.funding_8h)} decimal-per-8h`],d)+derivFactCard('deribit-hourly','Deribit 小时资金费',[`1h 资金费：${fmtDeskPlain(hv.interest_1h)} decimal-per-1h`,`8h 资金费：${fmtDeskPlain(hv.interest_8h)} decimal-per-8h`],h)+'</div>';}
  html+='</section><section class="desk-freq-group"><h3>Deribit · BTC / USDC 期权</h3><p>mark IV 是估值；未采集完整 bid/ask IV 与 Greeks，不能推出 dealer gamma 或 GEX。各结算组独立。</p>';
  for(const currency of ['BTC','USDC']){const o=desk.options?.[currency];html+='<h4>'+currency+' 结算组</h4>';
    if(!o){html+='<p>当前数据服务未返回期权覆盖；未补成零。</p>';continue;}
    html+=derivFactCard('options-'+currency,'期权覆盖',[`已映射：${fmtDeskPlain(o.mapped)} / ${fmtDeskPlain(o.universe)}`,`缺报价：${fmtDeskPlain(o.missingCount)} · 非预期：${fmtDeskPlain(o.unexpectedCount)} · 无效：${fmtDeskPlain(o.invalidCount)}`,`mark IV：${fmtDeskPlain(o.markIvCount)} · bid/ask IV：${fmtDeskPlain(o.bidAskIvCount)} · Greeks：${fmtDeskPlain(o.greeksCount)}`,`元数据接收：${fmtDeskClock(o.metadataReceipt)}`,`报价接收：${fmtDeskClock(o.quoteReceipt)}`],o);
    for(const smile of(o.smiles||[]).slice(0,3))html+='<details data-receipt="smile-'+currency+'-'+escapeDerivHtml(smile.expiry)+'"><summary>'+escapeDerivHtml(fmtDeskClock(smile.expiry))+' · 已返回行权价 / mark IV</summary><p>最多160点的子集；IV单位%，OI单位BTC，mark价格单位'+currency+'。</p><div class="rd-table-scroll"><table class="rd-table"><thead><tr><th>合约</th><th>行权价 USD</th><th>mark IV %</th><th>OI BTC</th><th>mark '+currency+'</th></tr></thead><tbody>'+(smile.points||[]).map(p=>'<tr><td>'+escapeDerivHtml(p.instrument)+'</td><td>'+fmtDeskPlain(p.strike)+'</td><td>'+fmtDeskPlain(p.markIv)+'</td><td>'+fmtDeskPlain(p.openInterest)+'</td><td>'+fmtDeskPlain(p.markPrice)+'</td></tr>').join('')+'</tbody></table></div></details>';
  }return html+'</section>';
}

function renderContextDesk(desk, failure) {
  const shown = failure ? (derivativesShownDesk || desk) : desk;
  if (!failure && desk) derivativesShownDesk = desk;
  derivativesPayload = shown || desk;
  derivativesReadFailure = failure || null;
  const status = document.getElementById("deriv-status");
  const chip = document.getElementById("deriv-live-chip");
  const headline = derivHeadline(shown,failure).replace('desk context 已返回','环境资料已读取').replaceAll('desk context','环境资料');
  if (status) status.textContent = headline;
  const contract = shown && shown.contract;
  const unavailable = !contract || contract.unavailable === true;
  if (chip) {
    chip.className = failure || headline.indexOf("陈旧") >= 0 || headline.indexOf("部分缺失") >= 0 ? "chip warn" : "chip ok";
    chip.textContent = failure ? "读取失败" : (unavailable ? "资料覆盖有限" : headline.replace(/^desk context 已返回 · /, ""));
  }
  const stateEl = document.getElementById("deriv-contract-state");
  const noteEl = document.getElementById("deriv-contract-note");
  if (stateEl) stateEl.textContent = failure ? "读取失败" : (unavailable ? "空" : "已返回");
  if (noteEl) noteEl.textContent = failure ? "保留上一次成功展示" : (unavailable ? "仅宏观背景" : "卡片各自标状态");
  const asknown = document.getElementById("deriv-asknown");
  if (asknown) asknown.textContent = shown?.asKnownMode === "publicly_available" ? "公开可得时点" : "系统取得时点";
  const failureEl = document.getElementById("deriv-read-failure");
  if (failureEl) {
    failureEl.hidden = !failure;
    failureEl.innerHTML = failure
      ? `<strong>读取失败</strong><p>失败时间 ${escapeDerivHtml(fmtDeskMinute(failure.at))}。${derivativesShownDesk ? "以下仍是上一次成功展示，已标陈旧。" : "没有上一次成功展示。"}${escapeDerivHtml(failure.message)}。</p>`
      : "";
  }
  const emptyEl = document.getElementById("deriv-contract-empty");
  if (emptyEl) emptyEl.hidden = !unavailable || !!failure && !!derivativesShownDesk;
  const contractEl = document.getElementById("deriv-contract-cards");
  const positioningEl = document.getElementById("deriv-positioning-cards");
  if (contractEl) DeskVisual.replace(contractEl,shown ? derivContractCards(contract) : "");
  if (positioningEl) DeskVisual.replace(positioningEl,shown ? derivPositioningCards(contract) : "");
  if (shown) renderMacroGroups(shown);
  publishDerivativesEvidence(shown, failure);
}

function publishDerivativesEvidence(desk, failure) {
  if (typeof WorkbenchEvidence === "undefined") return;
  if (!desk) {
    WorkbenchEvidence.commitFailure("derivatives", failure || { at: new Date().toISOString(), message: "没有可展示的合约" });
    return;
  }
  const contract = desk.contract || {};
  const sourceById = {
    premium: "binance-usdm-premium",
    funding: "binance-usdm-funding",
    basis: "binance-usdm-basis",
    oi: "binance-usdm-oi",
    oiHistory: "binance-usdm-oi-history",
    taker: "binance-usdm-taker",
    accounts: "binance-usdm-accounts",
    topPositions: "binance-usdm-top-positions",
  };
  const macroView=typeof UserWorkspace!=="undefined"&&UserWorkspace.view("derivatives")==="macro";
  const cards = [];
  (macroView?[]:["premium", "funding", "basis"]).forEach((id) => {
    if (contract[id]) cards.push(Object.assign({ id, sourceId: sourceById[id] }, contract[id]));
  });
  const positioning = contract.positioning || {};
  (macroView?[]:Object.keys(sourceById)).forEach((id) => {
    if (positioning[id]) cards.push(Object.assign({ id, sourceId: sourceById[id] }, positioning[id]));
  });
  const groups = desk.groups || {};
  (macroView?Object.keys(groups).filter(key=>key!=="unofficialVol"):[]).forEach((key) => {
    ((groups[key] && groups[key].cards) || []).forEach((card) => {
      cards.push(Object.assign({ sourceId: "public-macro-displayed" }, card));
    });
  });
  if(!macroView&&desk.comparison?.deribit)cards.push({...desk.comparison.deribit,id:'deribit-perp',sourceId:'deribit-btc-perp'});
  if(!macroView&&desk.comparison?.deribit?.hourlyFunding)cards.push({...desk.comparison.deribit.hourlyFunding,id:'deribit-hourly',sourceId:'deribit-btc-perp'});
  for(const currency of macroView?[]:['BTC','USDC'])if(desk.options?.[currency])cards.push({...desk.options[currency],id:'options-'+currency,sourceId:'deribit-btc-options',values:desk.options[currency]});
  const saved = WorkbenchEvidence.commitDisplayed("derivatives", {
    displayedAt: new Date().toISOString(),
    readAt: desk.asOf || null,
    asOf: desk.asOf || null,
    parameters: { scope: "context", view: macroView?"macro":"leverage" },
    contentRevision: desk.inputRevision || null,
    cards,
    stale: !!failure,
  });
  if (failure) WorkbenchEvidence.commitFailure("derivatives", failure);
  return saved;
}

function renderDerivativesUnreadFailure(failure) {
  const status = document.getElementById("deriv-status");
  const chip = document.getElementById("deriv-live-chip");
  if (status) status.textContent = `读取失败 · 失败时间 ${fmtDeskMinute(failure.at)} · ${failure.message} · 没有上一次成功展示`;
  if (typeof WorkbenchEvidence !== "undefined") WorkbenchEvidence.commitFailure("derivatives", failure);
  if (chip) {
    chip.className = "chip warn";
    chip.textContent = "读取失败";
  }
  const failureEl = document.getElementById("deriv-read-failure");
  if (failureEl) {
    failureEl.hidden = false;
    failureEl.innerHTML = `<strong>读取失败</strong><p>失败时间 ${escapeDerivHtml(fmtDeskMinute(failure.at))}。没有上一次成功展示。${escapeDerivHtml(failure.message)}。</p>`;
  }
  const stateEl = document.getElementById("deriv-contract-state");
  const noteEl = document.getElementById("deriv-contract-note");
  if (stateEl) stateEl.textContent = "读取失败";
  if (noteEl) noteEl.textContent = failure.message;
}

function derivReadAborted(error) {
  const name = error && error.name;
  const message = String(error && error.message || error || "");
  return name === "AbortError" || /已取消|AbortError/.test(message);
}

async function loadDerivativesPage() {
  if (document.hidden || derivativesInFlight) return;
  derivativesInFlight = true;
  const generation = derivativesGeneration;
  if (derivativesAbort) derivativesAbort.abort();
  const ctrl = new AbortController();
  derivativesAbort = ctrl;
  const status = document.getElementById("deriv-status");
  try {
    if (status && !derivativesShownDesk) status.textContent = "正在读取 /api/desk/context...";
    const desk = await DataEngine.fetchDesk("context", { signal: ctrl.signal });
    if (generation !== derivativesGeneration || ctrl.signal.aborted) return;
    derivativesReadFailure = null;
    renderContextDesk(desk);
  } catch (e) {
    if (generation !== derivativesGeneration || derivReadAborted(e)) return;
    const failure = {
      at: new Date().toISOString(),
      message: humanizeDerivativesReadError(e && e.message ? e.message : String(e)),
    };
    derivativesReadFailure = failure;
    if (derivativesShownDesk) renderContextDesk(derivativesShownDesk, failure);
    else renderDerivativesUnreadFailure(failure);
  } finally {
    if (generation === derivativesGeneration) derivativesInFlight = false;
  }
}

function resumeDerivativesPolling() {
  if (!document.hidden) loadDerivativesPage();
}

function summarizeDerivativesSourceStatus(payload) {
  if (!payload || typeof payload !== "object") return "源状态不可用";
  const stale = Array.isArray(payload.stalenessReasons) ? payload.stalenessReasons.length : 0;
  const health = Array.isArray(payload.sourceHealth) ? payload.sourceHealth : [];
  const sourceBits = health.slice(0, 3).map((row) => {
    const src = row && row.source ? String(row.source) : "source";
    const ok = derivNumber(row && row.last_ok) === 1 ? "ok" : (row && row.last_error_kind ? String(row.last_error_kind) : "warn");
    const cd = derivNumber(row && row.cooldown_until_ms) || 0;
    const cdText = cd > Date.now() ? ` 冷却至 ${fmtDerivIsoShort(new Date(cd).toISOString())}` : "";
    return `${src}:${ok}${cdText}`;
  });
  return [
    payload.workerBuild || "",
    payload.binanceOriginMode ? `Binance ${payload.binanceOriginMode}` : "",
    stale ? `旧指标 ${stale} 项` : "旧指标 0 项",
    sourceBits.join(" · "),
  ].filter(Boolean).join(" · ");
}

async function loadDerivativesSourceStatus() {
  const status = $("#deriv-status");
  const btn = $("#deriv-source-status");
  if (btn) btn.disabled = true;
  try {
    if (status) status.textContent = "正在读取 Worker 源状态...";
    const payload = await DataEngine.fetchDerivativesStatus();
    const text = summarizeDerivativesSourceStatus(payload);
    if (status) {
      status.textContent = text;
      status.title = Array.isArray(payload && payload.stalenessReasons)
        ? payload.stalenessReasons.slice(0, 8).join("\n")
        : text;
    }
  } catch (e) {
    if (status) status.textContent = "源状态读取失败: " + (e && e.message ? e.message : e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function initDerivatives() {
  disposeDerivatives();
  const refresh = document.getElementById("deriv-refresh");
  if (refresh) refresh.addEventListener("click", () => loadDerivativesPage());
  loadDerivativesPage();
  derivativesTimer = setInterval(() => loadDerivativesPage(), 15_000);
  document.addEventListener("visibilitychange", resumeDerivativesPolling);
}

function disposeDerivatives() {
  derivativesGeneration += 1;
  derivativesInFlight = false;
  if (derivativesAbort) derivativesAbort.abort();
  derivativesAbort = null;
  document.removeEventListener("visibilitychange", resumeDerivativesPolling);
  if (derivativesTimer) clearInterval(derivativesTimer);
  derivativesTimer = null;
  derivativesPayload = null;
  derivativesShownDesk = null;
  derivativesReadFailure = null;
  derivativesLastSyncReport = null;
  derivActivePanel = "oi";
}
