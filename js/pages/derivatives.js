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
let derivativesPayload = null;
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

function fmtDerivRate(v, digits = 2) {
  if (v == null || v === "") return "--";
  const n = derivNumber(v);
  if (!Number.isFinite(n)) return "--";
  const scaled = Math.abs(n) <= 1 ? n * 100 : n;
  return `${scaled >= 0 ? "+" : ""}${scaled.toFixed(digits)}%`;
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
  if (n >= high) return "多头占优";
  if (n <= low) return "空头占优";
  return "均衡";
}

function derivBasisState(row) {
  const n = derivNumber(row && row.value);
  if (!Number.isFinite(n)) return "样本不足";
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
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
    else if (priceChange < -1 && oi24h.changePct > 1) divergence = "价格下跌但 OI 上升，偏新增空头拥挤";
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
  return html`
    <section class="deriv-desk">
      <section class="deriv-status-strip" aria-label="衍生品数据状态">
        <div class="deriv-status-main">
          <span class="deriv-feed-dot" aria-hidden="true"></span>
          <strong>BTCUSDT 永续</strong>
          <span>Cloud D1 衍生品 30d · Binance USD-M 主源 · Bybit Funding/OI 兜底 · Yahoo 宏观旁路 · 东八区时间轴 · 前台 60 秒刷新</span>
        </div>
        <div class="deriv-status-actions">
          <span class="chip ok" id="deriv-live-chip">D1 衍生品</span>
          ${derivAgentLinkHtml("deriv")}
          ${derivAgentLinkHtml("env")}
        </div>
      </section>

      <div class="deriv-toolbar">
        <label class="deriv-field">
          <span>交易对</span>
          <strong>${DERIV_SYMBOL}</strong>
        </label>
        <label class="deriv-field">
          <span>窗口</span>
          <strong>${DERIV_RANGE}</strong>
        </label>
        <div class="deriv-action-cluster">
          <button type="button" class="btn" id="deriv-refresh"><i class="ph ph-arrow-clockwise"></i>刷新</button>
          <button type="button" class="btn" id="deriv-source-status"><i class="ph ph-activity"></i>源状态</button>
          <span class="deriv-status" id="deriv-status">准备读取 Cloudflare D1...</span>
        </div>
      </div>

      <div class="deriv-kpis" id="deriv-kpis">
        ${["Funding 拥挤", "OI 24h", "主动买卖比", "数据可信度"].map((label) => `
          <div class="deriv-kpi"><span>${label}</span><strong>--</strong><em>等待数据</em></div>
        `).join("")}
      </div>

      <div class="deriv-layout">
        <section class="deriv-main">
          <div class="deriv-section-title">衍生品六项矩阵</div>
          <div class="deriv-grid" id="deriv-panels">
            <div class="deriv-empty">正在加载衍生品数据...</div>
          </div>
        </section>
        <aside class="deriv-side">
          <section class="deriv-side-panel">
            <div class="deriv-side-panel-head">
              <div>
                <div class="card-title">衍生品观察栏</div>
                <div class="deriv-sub">可信度 / 宏观旁路 / 低权重背景</div>
              </div>
              <span class="chip" id="deriv-side-summary">等待数据</span>
            </div>

            <div class="deriv-side-section">
              <div class="deriv-side-section-head">
                <div>
                  <span class="card-title">数据可信度</span>
                  <span class="deriv-sub">D1 / 主链路 / 上游状态</span>
                </div>
              </div>
              <div class="deriv-freshness" id="deriv-freshness">等待数据...</div>
            </div>

            <details class="deriv-detail-card">
              <summary>
                <div>
                  <span class="card-title">宏观旁路</span>
                  <span class="deriv-sub">VIX / VIX3M / MOVE，仅作跨市场风险提示</span>
                </div>
                <span class="chip" id="deriv-macro-summary">等待数据</span>
              </summary>
              <div class="deriv-freshness" id="deriv-macro">等待数据...</div>
            </details>

            <details class="deriv-detail-card">
              <summary>
                <div>
                  <span class="card-title">稳定币背景</span>
                  <span class="deriv-sub">USDT / USDC · 低权重，只作流动性背景</span>
                </div>
                <span class="chip warn" id="deriv-stablecoin-summary">low</span>
              </summary>
              <div class="deriv-stablecoin" id="deriv-stablecoin">等待数据...</div>
            </details>
          </section>
        </aside>
      </div>
    </section>
  `;
}

function humanizeDerivativesReadError(message) {
  const s = String(message || "");
  if (/Failed to fetch|NetworkError|NETWORK_ERROR|Load failed|ECONNREFUSED/i.test(s)) {
    return `无法连接云端 Worker 或网络被拦截：${s}（请检查网络 / 代理 / 广告拦截插件 / DNS）`;
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
      state: !Number.isFinite(fv) ? "样本不足" : fundingCrowded ? "拥挤" : "中性",
      chip: fundingCrowded ? "chip warn" : "chip ok",
      note: `${fundingCrowded ? "费率进入拥挤区" : "费率暂未拥挤"} · ${ctx.fundingSrcLabel}`,
      metrics: [
        { label: "当前", value: fmtDerivFunding(a.fundingBinance.latest) },
        { label: "24h变化", value: fmtDerivFunding(a.fundingBinance.change) },
        { label: "来源", value: ctx.fundingSrcLabel },
      ],
      chart: derivChartSvg(derivSeries(payload, "funding_binance"), "deriv-path-funding", "资金费率"),
      evidence: `Binance 永续 Funding；阈值 ${fmtDerivFunding(DERIV_FUNDING_CROWD_ABS)}，只用于拥挤提示。`,
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

function renderDerivativesPayload(payload, syncReport = null) {
  derivativesPayload = payload;
  derivativesLastSyncReport = syncReport || null;
  const a = derivAnalyze(payload);
  const oiChip = derivOiChipMeta(a);
  const fundingSrcLabel = deriveFundingSourceLabel(payload, a);
  const binMode = String((a.syncHints && a.syncHints.binanceOriginMode) || "--");
  const topAccMh = mhFind(a, "top_account_long_short");
  const topPosMh = mhFind(a, "top_position_long_short");
  const basisQMh = mhFind(a, "basis_quarter");
  const topAccSub = derivMetricStaleSubtitle(topAccMh);
  const topPosSub = derivMetricStaleSubtitle(topPosMh);
  const basisQSub = derivMetricStaleSubtitle(basisQMh);
  const status = $("#deriv-status");
  if (status) {
    const latest = payload && payload.dataFreshness ? payload.dataFreshness.latestT : null;
    const roll = a.freshnessRollup;
    const coreBit = roll && roll.core ? `核心 ${roll.core.okCount}/${roll.core.totalKeys}` : "";
    const macroBit = roll && roll.macro ? `宏观 ${roll.macro.okCount}/${roll.macro.totalKeys}` : "";
    const worst =
      typeof a.worstCoreStaleMinutes === "number" && Number.isFinite(a.worstCoreStaleMinutes)
        ? `核心最旧 ${a.worstCoreStaleMinutes}m`
        : "";
    const syncBrief = summarizeDerivSyncReport(syncReport, payload);
    const autoRepairBrief =
      payload && payload.syncHints && payload.syncHints.autoRepairQueued
        ? `后台修复 ${payload.syncHints.autoRepairGroup || "core"}`
        : "";
    const shortSyncBrief = clipDerivText(syncBrief || autoRepairBrief, 72);
    if (latest) {
      status.textContent = [
        `D1 任一更新 ${fmtDerivTime(latest)}`,
        coreBit,
        macroBit,
        worst,
        a.sourceOkCore ? "主链路达标" : `留意 ${a.warnings.length} 项`,
        shortSyncBrief,
      ]
        .filter(Boolean)
        .join(" · ");
    } else {
      status.textContent = syncBrief || "D1 暂无衍生品数据，请检查 Worker Cron / 源状态";
    }
  }
  const liveChip = $("#deriv-live-chip");
  if (liveChip) {
    liveChip.className = a.sourceOkCore ? "chip ok" : "chip warn";
    liveChip.textContent = a.sourceOkCore ? "D1 主链路达标" : "D1 需留意";
  }
  const sideSummary = $("#deriv-side-summary");
  if (sideSummary) {
    const confidence = derivDataConfidenceLabel(a);
    sideSummary.className = confidence.chip;
    sideSummary.textContent = confidence.note.split(" · ")[0] || "等待数据";
  }
  const kpis = $("#deriv-kpis");
  if (kpis) {
    const fv = derivNumber(a.fundingBinance.latest);
    const fs = Number.isFinite(fv) && Math.abs(fv) >= DERIV_FUNDING_CROWD_ABS ? "拥挤 · 留意" : "中性";
    const tr = a.taker && a.taker.value;
    const tNote = `${derivRatioState(tr)}${Number.isFinite(derivNumber(tr)) && Math.abs(derivNumber(tr) - 1) >= DERIV_TAKER_IMBALANCE_TOL ? " · 失衡" : ""}`;
    const confidence = derivDataConfidenceLabel(a);
    kpis.innerHTML = [
      ["Funding 拥挤", fmtDerivFunding(a.fundingBinance.latest), `${fs} · ${fundingSrcLabel}`],
      ["OI 24h", fmtDerivPct(a.oi24h.changePct), a.divergence],
      ["主动买卖比", fmtDerivValue(tr, 3), tNote],
      ["数据可信度", confidence.value, `${confidence.note} · ${binMode}`],
    ].map(([label, value, note]) => `
      <div class="deriv-kpi">
        <span>${escapeDerivHtml(label)}</span>
        <strong>${escapeDerivHtml(value)}</strong>
        <em>${escapeDerivHtml(note || "--")}</em>
      </div>
    `).join("");
  }
  const panels = $("#deriv-panels");
  if (panels) {
    const definitions = buildDerivPanelDefinitions(payload, a, {
      fundingSrcLabel,
      oiChip,
      basisQSub,
      topAccSub,
      topPosSub,
    });
    let activePanel = definitions.find((panel) => panel.key === derivActivePanel);
    if (!activePanel) {
      derivActivePanel = "oi";
      activePanel = definitions.find((panel) => panel.key === derivActivePanel) || definitions[0];
    }
    panels.innerHTML = `${definitions.map(renderDerivPanelCard).join("")}${renderDerivActivePanel(activePanel)}`;
  }
  const macro = $("#deriv-macro");
  if (macro) {
    const macroFw = a.warnings.filter((w) => typeof w === "string" && (/宏观旁路|\[宏观旁路\]/.test(w) || /^\[宏观旁路\]/.test(w)));
    const macroSummary = $("#deriv-macro-summary");
    if (macroSummary) {
      macroSummary.textContent = macroFw.length ? `留意 ${macroFw.length} 项` : (a.vixTerm && a.vixTerm > 1 ? "VIX 倒挂" : "低权重背景");
      macroSummary.className = macroFw.length || (a.vixTerm && a.vixTerm > 1) ? "chip warn" : "chip";
    }
    const macroExtra = macroFw.length
      ? `<div class="deriv-warnings">${macroFw.slice(0, 4).map((w) => `<span class="deriv-warning">${escapeDerivHtml(w)}</span>`).join("")}</div>`
      : `<div class="deriv-note">宏观仅作背景提示，不参与核心主链路 sourceOk 判定。</div>`;
    macro.innerHTML = `
      <div class="deriv-data-row"><strong>VIX</strong><span>${escapeDerivHtml(fmtDerivValue(a.vix24h.latest, 2))} / 24h ${escapeDerivHtml(fmtDerivValue(a.vix24h.change, 2))}</span></div>
      <div class="deriv-data-row"><strong>MOVE</strong><span>${escapeDerivHtml(fmtDerivValue(a.move24h.latest, 1))} / 24h ${escapeDerivHtml(fmtDerivValue(a.move24h.change, 1))}</span></div>
      <div class="deriv-data-row"><strong>VIX/VIX3M</strong><span>${escapeDerivHtml(fmtDerivValue(a.vixTerm, 3))}${a.vixTerm && a.vixTerm > 1 ? " · 倒挂" : ""}</span></div>
      ${macroExtra}
    `;
  }
  const stable = $("#deriv-stablecoin");
  if (stable) {
    const s = derivStablecoinRows(payload);
    const usdt7d = derivChange(s.usdt, 7 * 24 * 60 * 60 * 1000);
    const usdc7d = derivChange(s.usdc, 7 * 24 * 60 * 60 * 1000);
    const stableWarnings = s.freshness && Array.isArray(s.freshness.warnings) ? s.freshness.warnings : [];
    const stableSummary = $("#deriv-stablecoin-summary");
    if (stableSummary) {
      stableSummary.textContent = stableWarnings.length ? "背景告警" : (s.hasRows ? "low · 正常" : "low · 暂无D1");
      stableSummary.className = stableWarnings.length || !s.hasRows ? "chip warn" : "chip";
    }
    const warningHtml = s.freshness && Array.isArray(s.freshness.warnings) && s.freshness.warnings.length
      ? s.freshness.warnings.map((w) => `<span class="deriv-warning">${escapeDerivHtml(w)}</span>`).join("")
      : s.hasRows
        ? `<span class="deriv-ok">稳定币背景 D1 正常</span>`
        : `<span class="deriv-warning">稳定币背景暂无 D1 数据</span>`;
    stable.innerHTML = `
      <div class="deriv-stablecoin-grid">
        <span><b>USDT</b><strong>${escapeDerivHtml(fmtDerivCompact(usdt7d.latest, 2))}</strong><em>7日 ${escapeDerivHtml(fmtDerivPct(usdt7d.changePct))}</em></span>
        <span><b>USDC</b><strong>${escapeDerivHtml(fmtDerivCompact(usdc7d.latest, 2))}</strong><em>7日 ${escapeDerivHtml(fmtDerivPct(usdc7d.changePct))}</em></span>
      </div>
      <div class="deriv-stablecoin-legend">
        <span><i style="background:#2563eb"></i>USDT</span>
        <span><i style="background:#0d9488"></i>USDC</span>
      </div>
      ${derivDualChartSvg(s.usdt, s.usdc, "deriv-path-stable-usdt", "deriv-path-stable-usdc", "稳定币背景")}
      <div class="deriv-note">LLM 权重 ${escapeDerivHtml(s.llmGuidance.weight || s.reliability.weight || "low")}：仅作为稳定币流动性背景，不作为独立交易触发器。</div>
      <div class="deriv-warnings">${warningHtml}</div>
    `;
  }
  const freshness = $("#deriv-freshness");
  if (freshness) {
    const fresh = payload && payload.dataFreshness ? payload.dataFreshness : {};
    const warningHtmlCore = a.warnings
      .filter((w) => typeof w === "string" && !/^\[宏观旁路\]|\[宏观旁路\]|宏观旁路/.test(w))
      .filter((w) => !/^\[按指标观测\]|^核心 .+ 偏旧/.test(w))
      .filter((w) => !derivNoiseBinanceGeoRestrictedCooldown(a.sourceOkCore, w))
      .slice(0, 8);
    const warningHtml = warningHtmlCore.length
      ? warningHtmlCore.map((w) => `<span class="deriv-warning">${escapeDerivHtml(w)}</span>`).join("")
      : `<span class="deriv-ok">无核心附加告警</span>`;
    const roll = fresh.rollup || {};
    const c = roll.core;
    const m = roll.macro;
    const coreTxt = c ? `正常 ${c.okCount}/${c.totalKeys} · 缺 ${c.missingCount} · 旧 ${c.staleCount}` : "--";
    const macroTxt = m ? `可用 ${m.okCount}/${m.totalKeys} · 缺 ${m.missingCount} · 旧 ${m.staleCount}` : "--";
    const mix =
      (a.fundingMixed24h ? `<span class="deriv-warning">Funding 24h 混合数据源</span>` : "") +
      (a.oiMixed24h ? `<span class="deriv-warning">OI 24h 混合数据源</span>` : "");
    const syncBrief = summarizeDerivSyncReport(syncReport, payload);
    const stuckLines =
      (a.stalenessReasons && a.stalenessReasons.length
        ? a.stalenessReasons
        : a.metricHealth
            .filter((row) => row && (row.level === "stale" || row.level === "missing"))
            .map((row) => `${row.metricLabelZh || row.metric || ""}：${row.reasonZh || ""}`)
      ).slice(0, 8);
    const stuckHtml = stuckLines.length
      ? `<ul class="deriv-fresh-list">${stuckLines.map((ln) => `<li>${escapeDerivHtml(ln)}</li>`).join("")}</ul>`
      : `<div class="deriv-ok">暂无严重卡住的旧指标（宏观旧见右上角「宏观旁路」卡片）。</div>`;
    const upstreamOne = summarizeDerivUpstreamBrief(a.sourceHealth, binMode, a.sourceOkCore);
    const mhSig =
      typeof a.syncHints.metricHealthStaleSignals === "number" ? a.syncHints.metricHealthStaleSignals : stuckLines.length;
    const autoRepairText =
      a.syncHints && a.syncHints.autoRepairQueued
        ? `刷新已后台修复旧指标：${(Array.isArray(a.syncHints.staleCoreMetrics) ? a.syncHints.staleCoreMetrics : []).slice(0, 4).join(",") || "core"} · ${a.syncHints.autoRepairGroup || "core"}`
        : "";
    const syncText =
      syncBrief || autoRepairText || "刷新=只读 D1；旧指标由 Worker Cron 后台维护，持续卡住时检查源状态 / Worker 出口";

    freshness.innerHTML = `
      <div class="deriv-fresh-block"><strong>概览</strong>
        <span>核心 ${escapeDerivHtml(coreTxt)} · 主链路 ${a.sourceOkCore ? "达标" : "未达标"} · 结构化陈旧信号 ${escapeDerivHtml(mhSig)} · 云端模式 ${escapeDerivHtml(binMode)}</span></div>
      <div class="deriv-fresh-block"><strong>核心最旧</strong><span>${fresh.worstCoreStaleMinutes != null ? `${escapeDerivHtml(fresh.worstCoreStaleMinutes)} 分钟` : "--"} · Latest ${escapeDerivHtml(fmtDerivTime(fresh.latestT))}</span></div>
      <div class="deriv-fresh-block"><strong>上游与出口</strong><span>${escapeDerivHtml(clipDerivText(upstreamOne, 120))}</span></div>
      <div class="deriv-fresh-block"><strong>下一步</strong><span>${escapeDerivHtml(clipDerivText(syncText, 120))}</span></div>
      <div class="deriv-warnings">${mix}${warningHtml}</div>
      <details class="deriv-inline-details">
        <summary>查看指标健康与同步详情</summary>
        <div class="deriv-fresh-block"><strong>卡住 / 偏旧（按指标）</strong>${stuckHtml}</div>
        <div class="deriv-fresh-block muted"><strong>宏观旁路（独立）</strong><span>${escapeDerivHtml(macroTxt)} · 不改变核心 sourceOk</span></div>
        <div class="deriv-fresh-block"><strong>Stale(乐观)</strong><span>${Number.isFinite(derivNumber(fresh.staleMs)) ? `${Math.round(derivNumber(fresh.staleMs) / 60000)} 分钟` : "--"}</span></div>
        <div class="deriv-fresh-block"><strong>同步详情</strong><span>${escapeDerivHtml(syncText)}</span></div>
      </details>
    `;
  }
}

async function loadDerivativesPage() {
  const status = $("#deriv-status");
  const sourceBtn = $("#deriv-source-status");
  try {
    if (sourceBtn) sourceBtn.disabled = true;
    if (status) status.textContent = "正在读取 Cloudflare D1...";
    const payload = await DataEngine.fetchDerivatives(DERIV_SYMBOL, DERIV_RANGE, { sync: "0" });
    renderDerivativesPayload(payload, null);
  } catch (e) {
    const message = humanizeDerivativesReadError(e && e.message ? e.message : String(e));
    renderDerivativesPayload({
      symbol: DERIV_SYMBOL,
      range: DERIV_RANGE,
      generatedAt: new Date().toISOString(),
      series: {},
      optionSurface: [],
      priceChange24hPct: null,
      priceChange24hMeta: null,
      dataFreshness: {
        latestT: null,
        staleMs: null,
        sourceOk: false,
        warnings: [`读取失败：${message}`],
      },
    });
    if (status) status.textContent = `读取失败：${message}`;
  } finally {
    if (sourceBtn) sourceBtn.disabled = false;
  }
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
  $("#deriv-refresh")?.addEventListener("click", () => loadDerivativesPage());
  $("#deriv-source-status")?.addEventListener("click", () => loadDerivativesSourceStatus());
  $("#deriv-panels")?.addEventListener("click", (event) => {
    const btn = event.target && event.target.closest ? event.target.closest("[data-deriv-panel]") : null;
    if (!btn) return;
    const next = btn.getAttribute("data-deriv-panel") || "oi";
    if (next === derivActivePanel) return;
    derivActivePanel = next;
    if (derivativesPayload) renderDerivativesPayload(derivativesPayload, derivativesLastSyncReport);
  });
  loadDerivativesPage();
  derivativesTimer = setInterval(() => loadDerivativesPage(), 60_000);
}

function disposeDerivatives() {
  if (derivativesTimer) clearInterval(derivativesTimer);
  derivativesTimer = null;
  derivativesPayload = null;
  derivativesLastSyncReport = null;
  derivActivePanel = "oi";
}
