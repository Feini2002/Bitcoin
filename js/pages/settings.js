/* =======================================================
   页面：设置（功能性 · 主题切换 / 云端 K 线状态）
   ======================================================= */

function settingsThemeOptions(current) {
  const opts = [
    {
      id: "light",
      title: "浅色",
      hint: "高亮背景、适合日间与文档对照；图表与表格可读性更直观。",
      swatchClass: "theme-option-swatch--light",
    },
    {
      id: "dark",
      title: "深色",
      hint: "低环境光下更省力；侧栏与行情面板对比度更柔和。",
      swatchClass: "theme-option-swatch--dark",
    },
  ];
  return opts
    .map((o) => {
      const on = current === o.id;
      return `
        <button
          type="button"
          class="theme-option ${on ? "theme-option--active" : ""}"
          id="theme-option-${o.id}"
          data-theme="${o.id}"
          role="radio"
          aria-checked="${on ? "true" : "false"}"
          aria-label="${o.title}主题"
        >
          <span class="theme-option-swatch ${o.swatchClass}" aria-hidden="true"></span>
          <span class="theme-option-body">
            <span class="theme-option-title">${o.title}</span>
            <span class="theme-option-hint">${o.hint}</span>
          </span>
          <span class="theme-option-badge" aria-hidden="true">${on ? "使用中" : ""}</span>
        </button>
      `;
    })
    .join("");
}

function pageSettings(){const current=getTheme();return '<div class="settings-shell"><header class="page-header"><div><h1 class="page-title">设置</h1><p>外观与资料读取状态。</p></div><span class="chip settings-theme-chip">当前主题 · '+(current==='dark'?'深色':'浅色')+'</span></header><section class="settings-panel"><h2>外观</h2><p>主题保存在当前浏览器。</p><div class="theme-segment" id="themePicker" role="radiogroup" aria-label="界面配色">'+settingsThemeOptions(current)+'</div></section><section class="settings-panel"><h2>资料读取</h2><p>各类资料使用独立的观察周期；单页异常只影响相应的判断。</p><button class="btn" id="settings-read-check">检查读取状态</button><div id="settings-read-status" role="status"></div></section><section class="settings-panel"><h2>记录与备份</h2><p>本机记录保存在当前浏览器。研究页和报告页可以导出原始文件，用于备份和跨设备阅读。</p><a class="btn" href="#/records">打开记录 →</a></section></div>';}

function escapeHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function normalizeD1TimeMs(value) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatD1Time(ms) {
  const n = normalizeD1TimeMs(ms);
  if (!Number.isFinite(n) || n <= 0) return "暂无";
  return new Date(n).toLocaleString("zh-CN", { hour12: false });
}

function formatD1Age(ms) {
  const n = normalizeD1TimeMs(ms);
  if (!Number.isFinite(n) || n <= 0) return "暂无";
  const delta = Math.max(0, Date.now() - n);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (delta < minute) return "刚刚";
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`;
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`;
  return `${Math.floor(delta / day)} 天前`;
}

function d1IntervalMs(interval) {
  if (typeof DataEngine !== "undefined" && typeof DataEngine.getIntervalMs === "function") {
    return DataEngine.getIntervalMs(interval);
  }
  const map = {
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
    "3d": 3 * 24 * 60 * 60 * 1000,
    "1w": 7 * 24 * 60 * 60 * 1000,
  };
  return map[String(interval || "")] || 5 * 60 * 1000;
}

function d1FreshnessLevel(latestT, interval) {
  const t = normalizeD1TimeMs(latestT);
  if (!t) return "warn";
  const step = d1IntervalMs(interval);
  const openSlackMs = Math.min(90_000, Math.max(15_000, Math.floor(step / 20)));
  const statusGraceMs = step * 2 + Math.max(120_000, openSlackMs);
  return Date.now() - t > statusGraceMs ? "warn" : "ok";
}

function d1StatusLevel(countRow, syncRow, interval) {
  const hasRows = !!countRow && Number(countRow.cnt || 0) > 0;
  if (!hasRows) return syncRow && Number(syncRow.last_ok) === 0 ? "danger" : "warn";
  const fresh = d1FreshnessLevel(countRow.maxT || syncRow?.last_t, interval) === "ok";
  if (syncRow && Number(syncRow.last_ok) === 0) return fresh ? "warn" : "danger";
  if (!fresh) return "warn";
  return "ok";
}

function d1StatusLabel(level, countRow, syncRow, interval) {
  const hasRows = !!countRow && Number(countRow.cnt || 0) > 0;
  const fresh = hasRows && d1FreshnessLevel(countRow.maxT || syncRow?.last_t, interval) === "ok";
  if (syncRow && Number(syncRow.last_ok) === 0 && hasRows && fresh) return "可读·写库异常";
  if (level === "danger") return "同步失败";
  if (!countRow || Number(countRow.cnt || 0) <= 0) return "无数据";
  if (level === "warn") return "可能落后";
  if (syncRow && Number(syncRow.last_count || 0) === 0) return "已检查";
  return "可读";
}

function compactD1Error(error) {
  const raw = String(error || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  let msg = raw;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.msg) msg = String(parsed.msg);
    else if (parsed && parsed.error) msg = String(parsed.error);
  } catch (_) {
    const m = /"msg"\s*:\s*"([^"]+)/.exec(raw);
    if (m && m[1]) msg = m[1];
  }
  msg = msg.replace(/https?:\/\/\S+/g, (u) => u.replace(/[),.;]+$/, ""));
  if (/restricted location|Eligibility|service unavailable from a restricted/i.test(msg)) {
    return "Binance FAPI 被当前 Worker 边缘节点地域限制";
  }
  if (msg.length > 180) return `${msg.slice(0, 180)}…`;
  return msg;
}

function explainD1Error(error) {
  const raw = String(error || "");
  if (/restricted location|Eligibility|service unavailable from a restricted/i.test(raw)) {
    return "D1 已有数据仍可读；这表示某次写库请求打到的 Binance 上游被地域限制。Worker 会继续尝试 Bybit/OKX 兜底，必要时检查 Worker 日志或 BINANCE_FAPI_ORIGIN。";
  }
  if (/okx-failover/i.test(raw)) return "Binance 与 Bybit 失败后 OKX 兜底也失败，需要看完整返回链路和上游状态。";
  if (/bybit-failover/i.test(raw)) return "Binance 主链路失败后 Bybit 兜底也失败，Worker 会继续尝试 OKX。";
  if (/timeout|abort|network/i.test(raw)) return "疑似 Worker 到上游网络超时，通常需要看 Worker 日志或稍后重试。";
  if (/D1 binding/i.test(raw)) return "Worker 没有拿到 D1 绑定，需检查 wrangler 绑定和部署环境。";
  if (/persist/i.test(raw)) return "行情源已返回，但写入 D1 失败，需要检查 D1 SQL/配额/绑定。";
  return "复制这一行给 Codex，可继续定位 Worker、D1 或上游链路。";
}

function d1RowsWithContext(data) {
  const intervals = Array.isArray(data?.supportedIntervals) ? data.supportedIntervals : [];
  const counts = Array.isArray(data?.counts) ? data.counts : [];
  const status = Array.isArray(data?.status) ? data.status : [];
  return intervals.map((interval) => {
    const countRow = counts.find((r) => r.interval === interval) || null;
    const syncRow = status.find((r) => r.interval === interval) || null;
    const latestT = Number(countRow?.maxT || syncRow?.last_t || 0);
    const level = d1StatusLevel(countRow, syncRow, interval);
    return { interval, countRow, syncRow, latestT, level };
  });
}

function d1ProblemRows(data) {
  return d1RowsWithContext(data).filter((row) => {
    const err = row.syncRow && row.syncRow.last_error;
    return row.level !== "ok" || !!err || Number(row.syncRow?.last_ok) === 0;
  });
}

function buildD1DiagnosticText(data, interval) {
  if (!data || typeof data !== "object") return "暂无 D1 状态数据。";
  const rows = interval
    ? d1RowsWithContext(data).filter((row) => row.interval === interval)
    : d1ProblemRows(data);
  const apiBase = typeof getBitDataApiBase === "function"
    ? getBitDataApiBase()
    : (typeof window !== "undefined" && window.BIT_DATA_API_BASE) ? String(window.BIT_DATA_API_BASE) : "";
  const lines = [
    "Bit Trading Desk D1 排障摘要",
    `生成时间: ${formatD1Time(data.generatedAt || Date.now())}`,
    `Pages/Worker: ${apiBase || "--"}`,
    `Worker build: ${data.workerBuild || data.derivatives?.workerBuild || "--"}`,
    `Kline upstream: ${data.kline?.upstream || "--"}`,
    `Binance origin mode: ${data.kline?.binanceOriginMode || "--"}`,
    `Bybit failover: ${data.kline?.alternateFailover === false ? "off" : "on"}`,
    `Manual sync endpoint: ${data.kline?.manualSyncEndpoint || "/api/d1/sync"}`,
    "",
    rows.length ? "异常/关注周期:" : "当前没有异常周期。",
  ];
  rows.forEach((row) => {
    const count = Number(row.countRow?.cnt || 0);
    const max = Number(data.maxPerInterval || 6000);
    const lastRun = row.syncRow ? formatD1Time(row.syncRow.last_run) : "暂无";
    const lastCount = row.syncRow ? Number(row.syncRow.last_count || 0) : null;
    const rawError = row.syncRow?.last_error ? String(row.syncRow.last_error) : "";
    lines.push(
      `- ${row.interval}: ${d1StatusLabel(row.level, row.countRow, row.syncRow, row.interval)}`,
      `  rows: ${count}/${max}`,
      `  latest: ${formatD1Time(row.latestT)} (${formatD1Age(row.latestT)})`,
      `  last_run: ${lastRun}`,
      `  last_count: ${lastCount == null ? "暂无" : lastCount}`,
      `  explanation: ${rawError ? explainD1Error(rawError) : "无错误字段"}`,
      `  error: ${rawError || "无"}`,
    );
  });
  return lines.join("\n");
}

function renderD1ErrorCell(error, interval) {
  if (!error) return "无";
  return `
    <div class="cloud-error-cell">
      <div>
        <span class="cloud-status-error" title="${escapeHtml(error)}">${escapeHtml(compactD1Error(error))}</span>
        <em>${escapeHtml(explainD1Error(error))}</em>
      </div>
      <button type="button" class="cloud-copy-mini" data-copy-kind="interval" data-interval="${escapeHtml(interval)}">复制</button>
    </div>
  `;
}

function renderD1DiagnosticPanel(data) {
  const problems = d1ProblemRows(data);
  if (!problems.length) {
    return `
      <div class="cloud-diagnostic-panel ok">
        <strong>排障摘要</strong>
        <span>当前 K 线 D1 没有异常周期；完整 JSON 仍可用于对照 Worker 构建与 D1 原始字段。</span>
      </div>
    `;
  }
  const items = problems.map((row) => {
    const error = row.syncRow?.last_error ? compactD1Error(row.syncRow.last_error) : "无错误字段";
    return `
      <div class="cloud-diagnostic-item ${row.level}">
        <span>${escapeHtml(row.interval)}</span>
        <strong>${escapeHtml(d1StatusLabel(row.level, row.countRow, row.syncRow, row.interval))}</strong>
        <em>${escapeHtml(error)}</em>
        <button type="button" class="cloud-copy-mini" data-copy-kind="interval" data-interval="${escapeHtml(row.interval)}">复制这一项</button>
      </div>
    `;
  }).join("");
  return `
    <div class="cloud-diagnostic-panel">
      <div class="cloud-diagnostic-head">
        <strong>需要关注的周期</strong>
        <span>这些信息已经整理成可复制文本，不需要截图表格。</span>
      </div>
      <div class="cloud-diagnostic-list">${items}</div>
    </div>
  `;
}

function summarizeManualSyncMessage(syncData) {
  const rows = Array.isArray(syncData?.results) ? syncData.results : [];
  const queued = Array.isArray(syncData?.queued) ? syncData.queued : [];
  const failed = rows.filter((r) => !r || !r.ok);
  if (queued.length) return `已交给 Worker 后台同步 ${queued.length} 个周期。`;
  if (rows.length && failed.length) return `手动同步完成，但 ${failed.length}/${rows.length} 个周期失败。`;
  if (rows.length) return `手动同步完成：${rows.length} 个周期已返回。`;
  return "手动同步请求已返回。";
}

function renderManualSyncResult(syncData) {
  if (!syncData || typeof syncData !== "object") return "";
  const rows = Array.isArray(syncData.results) ? syncData.results : [];
  const queued = Array.isArray(syncData.queued) ? syncData.queued : [];
  const failed = rows.filter((r) => !r || !r.ok);
  const inserted = rows.reduce((sum, row) => sum + Number(row?.inserted || 0), 0);
  const fetched = rows.reduce((sum, row) => sum + Number(row?.fetched || 0), 0);
  const title = escapeHtml(summarizeManualSyncMessage(syncData));
  const detail = queued.length
    ? `后台队列：${queued.map(escapeHtml).join(" / ")}`
    : rows.length
      ? `获取 ${fetched} 根，写入/替换 ${inserted} 根${failed.length ? `；失败：${failed.map((r) => `${r.interval || "--"} ${r.error || ""}`).map(escapeHtml).join(" / ")}` : ""}`
      : "Worker 未返回周期明细。";
  const level = failed.length ? "danger" : "ok";
  return `
    <div class="cloud-sync-result ${level}">
      <strong>${title}</strong>
      <span>${detail}</span>
    </div>
  `;
}

function renderKlineStatusTable(data) {
  const intervals = Array.isArray(data?.supportedIntervals) ? data.supportedIntervals : [];
  const counts = Array.isArray(data?.counts) ? data.counts : [];
  const status = Array.isArray(data?.status) ? data.status : [];
  const rows = intervals.map((interval) => {
    const countRow = counts.find((r) => r.interval === interval) || null;
    const syncRow = status.find((r) => r.interval === interval) || null;
    const count = Number(countRow?.cnt || 0);
    const latestT = Number(countRow?.maxT || syncRow?.last_t || 0);
    const level = d1StatusLevel(countRow, syncRow, interval);
    const label = d1StatusLabel(level, countRow, syncRow, interval);
    const lastCount = syncRow ? Number(syncRow.last_count || 0) : null;
    const error = syncRow && syncRow.last_error ? String(syncRow.last_error) : "";
    return `
      <tr>
        <td><strong>${escapeHtml(interval)}</strong></td>
        <td><span class="cloud-status-pill ${level}">${label}</span></td>
        <td>${count ? `${count}${countRow?.estimated ? "（估算）" : ` / ${Number(data?.maxPerInterval || 6000)}`}` : "0"}</td>
        <td>${escapeHtml(formatD1Time(countRow?.minT))} - ${escapeHtml(formatD1Time(latestT))}</td>
        <td>${escapeHtml(formatD1Age(latestT))}</td>
        <td>${syncRow ? escapeHtml(formatD1Time(syncRow.last_run)) : "暂无记录"}</td>
        <td>${lastCount == null ? "暂无" : `${lastCount} 根`}</td>
        <td>${renderD1ErrorCell(error, interval)}</td>
      </tr>
    `;
  }).join("");

  if (!rows) return `<p class="cloud-status-empty">Worker 没有返回支持的 K 线周期。</p>`;
  return `
    <div class="cloud-status-table-wrap">
      <table class="cloud-status-table">
        <thead>
          <tr>
            <th>周期</th>
            <th>状态</th>
            <th>已存 K 线</th>
            <th>覆盖时间</th>
            <th>最新距今</th>
            <th>最近同步</th>
            <th>本次写入</th>
            <th>错误</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderCloudStatusSummary(data) {
  if (!data || typeof data !== "object") return "";
  const intervals = Array.isArray(data.supportedIntervals) ? data.supportedIntervals : [];
  const counts = Array.isArray(data.counts) ? data.counts : [];
  const filled = intervals.filter((iv) => counts.some((r) => r.interval === iv && Number(r.cnt || 0) > 0)).length;
  const latest = counts.reduce((max, row) => Math.max(max, Number(row.maxT || 0)), 0);
  const fpCount = (data.footprint?.counts || []).reduce((sum, row) => sum + Number(row.cnt || 0), 0);
  const rows = d1RowsWithContext(data);
  const danger = rows.filter((r) => r.level === "danger").length;
  const warn = rows.filter((r) => r.level === "warn").length;
  const workerBuild = data.workerBuild || data.derivatives?.workerBuild || "--";
  const apiBase = typeof getBitDataApiBase === "function"
    ? getBitDataApiBase()
    : (typeof window !== "undefined" && window.BIT_DATA_API_BASE) ? String(window.BIT_DATA_API_BASE) : "";
  const manualHtml = renderManualSyncResult(data._manualSync);
  if (!intervals.length && manualHtml) return manualHtml;

  return `
    ${manualHtml}
    <div class="cloud-status-help">
      <strong>真实架构：</strong>
      Pages 静态页请求 ${escapeHtml(apiBase || "已配置 Worker")}；图表页默认只读 D1，但打开后发现当前周期明显落后或点击右上角按钮时会同步当前周期；设置页的「立即同步 D1」用于全周期手动写库。Cron 仍是常规维护入口，每个周期最多保留最近 ${Number(data.maxPerInterval || 6000)} 根。
      ${data.lightweight ? " 当前为轻量状态：行数来自状态表推导，详细统计请点手动刷新状态。" : ""}
    </div>
    <div class="cloud-status-cards">
      <div class="cloud-status-card">
        <span>周期覆盖</span>
        <strong>${filled}/${intervals.length || 0}</strong>
        <em>有数据的 K 线周期</em>
      </div>
      <div class="cloud-status-card">
        <span>同步健康</span>
        <strong>${danger ? `${danger} 个失败` : warn ? `${warn} 个需关注` : "全部正常"}</strong>
        <em>可读性、末根 K 与写库结果分开判断</em>
      </div>
      <div class="cloud-status-card">
        <span>最新 K 线</span>
        <strong>${escapeHtml(formatD1Age(latest))}</strong>
        <em>${escapeHtml(formatD1Time(latest))}</em>
      </div>
      <div class="cloud-status-card">
        <span>Footprint 基础库</span>
        <strong>${fpCount || 0}</strong>
        <em>5m bars，最多 ${Number(data.footprint?.maxBaseBars || 8640)} 根</em>
      </div>
      <div class="cloud-status-card">
        <span>Worker 构建</span>
        <strong>${escapeHtml(workerBuild)}</strong>
        <em>${escapeHtml(data.kline?.upstream || "Binance FAPI / failover")}</em>
      </div>
    </div>
    ${renderD1DiagnosticPanel(data)}
    ${renderKlineStatusTable(data)}
  `;
}

async function copySettingsText(text) {
  const value = String(text || "");
  if (!value) throw new Error("没有可复制内容");
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = value;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
}

function initLegacySettingsPage() {

  const syncBtn = document.getElementById("settings-cloud-sync");
  const statusBtn = document.getElementById("settings-cloud-status");
  const detailBtn = document.getElementById("settings-cloud-detail");
  const msg = document.getElementById("settings-cloud-msg");
  const out = document.getElementById("settings-cloud-output");
  const summary = document.getElementById("settings-cloud-summary");
  const tools = document.getElementById("settings-cloud-tools");
  if (!statusBtn && !syncBtn) return;

  let lastStatusData = null;
  let lastRawPayload = null;

  const showMsg = (text) => { if (msg) msg.textContent = text || ""; };
  const showOutput = (obj, rawObj) => {
    const raw = rawObj === undefined ? obj : rawObj;
    lastStatusData = obj && obj.supportedIntervals ? obj : (obj && obj.status && obj.status.supportedIntervals ? obj.status : obj);
    lastRawPayload = raw || obj || null;
    if (out) out.textContent = raw ? JSON.stringify(raw, null, 2) : "";
    if (tools) tools.hidden = !lastRawPayload;
    if (!summary) return;
    if (!obj) {
      summary.innerHTML = "";
    } else {
      summary.innerHTML = renderCloudStatusSummary(obj);
    }
  };
  const setBusy = (busy) => {
    if (statusBtn) statusBtn.disabled = !!busy;
    if (detailBtn) detailBtn.disabled = !!busy;
    if (syncBtn) syncBtn.disabled = !!busy;
  };

  const refreshStatus = async (opts = {}) => {
    if (typeof DataEngine === "undefined" || !DataEngine.fetchCloudStatus) {
      showMsg("数据引擎未加载，请刷新页面后重试。");
      return null;
    }
    const detail = opts && opts.detail ? "1" : "0";
    const syncPayload = opts && opts.manualSync ? opts.manualSync : null;
    const data = await DataEngine.fetchCloudStatus({ timeoutMs: 25_000, detail });
    if (syncPayload) data._manualSync = syncPayload;
    showOutput(data);
    const deskBox = document.getElementById("settings-desk-health");
    if (deskBox && DataEngine.fetchDesk) {
      try {
        const scopes = ["chart", "orderflow", "heatmap", "context"];
        const rows = await Promise.all(scopes.map(async (scope) => {
          try {
            const desk = await DataEngine.fetchDesk(scope, { interval: scope === "chart" ? "15m" : undefined, range: scope === "heatmap" ? "24h" : undefined });
            return `${scope}: quality=${desk.quality && desk.quality.status} pricePath=${desk.pricePathAvailable === true} asKnownMode=${desk.asKnownMode}`;
          } catch (e) {
            return `${scope}: 缺口 ${e && e.message ? e.message : e}`;
          }
        }));
        deskBox.innerHTML = `<div class="cloud-sync-result warn"><strong>desk 分区健康（不是行情事实）</strong><span>${rows.map((x) => String(x).replace(/</g, "&lt;")).join(" · ")}</span></div>`;
      } catch (_) {}
    }
    return data;
  };

  const copyFromState = async (kind, interval) => {
    if (!lastRawPayload) {
      showMsg("还没有可复制的 D1 状态，请先查看状态。");
      return;
    }
    const text = kind === "raw"
      ? JSON.stringify(lastRawPayload, null, 2)
      : buildD1DiagnosticText(lastStatusData || lastRawPayload, interval);
    await copySettingsText(text);
    showMsg(kind === "raw" ? "已复制完整 JSON。" : interval ? `已复制 ${interval} 排障摘要。` : "已复制异常摘要。");
  };

  if (tools && !tools.dataset.bound) {
    tools.dataset.bound = "1";
    tools.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-copy-cloud]");
      if (!btn) return;
      try {
        await copyFromState(btn.getAttribute("data-copy-cloud"));
      } catch (err) {
        showMsg("复制失败: " + (err && err.message ? err.message : err));
      }
    });
  }

  if (summary && !summary.dataset.copyBound) {
    summary.dataset.copyBound = "1";
    summary.addEventListener("click", async (e) => {
      const btn = e.target.closest("[data-copy-kind='interval']");
      if (!btn) return;
      try {
        await copyFromState("diagnostic", btn.getAttribute("data-interval") || "");
      } catch (err) {
        showMsg("复制失败: " + (err && err.message ? err.message : err));
      }
    });
  }

  if (statusBtn && !statusBtn.dataset.bound) {
    statusBtn.dataset.bound = "1";
    statusBtn.addEventListener("click", async () => {
      setBusy(true);
      showMsg("正在查询轻量 D1 状态…");
      try {
        await refreshStatus({ detail: false });
        showMsg("已获取 D1 状态。");
      } catch (e) {
        showMsg("状态读取失败: " + (e && e.message ? e.message : e));
      } finally {
        setBusy(false);
      }
    });
  }

  if (detailBtn && !detailBtn.dataset.bound) {
    detailBtn.dataset.bound = "1";
    detailBtn.addEventListener("click", async () => {
      setBusy(true);
      showMsg("正在查询 D1 详细诊断…");
      try {
        await refreshStatus({ detail: true });
        showMsg("已获取 D1 详细诊断。");
      } catch (e) {
        showMsg("详细诊断失败: " + (e && e.message ? e.message : e));
      } finally {
        setBusy(false);
      }
    });
  }

  if (syncBtn && !syncBtn.dataset.bound) {
    syncBtn.dataset.bound = "1";
    syncBtn.addEventListener("click", async () => {
      if (typeof DataEngine === "undefined" || !DataEngine.triggerCloudSync) {
        showMsg("数据引擎未加载，请刷新页面后重试。");
        return;
      }
      setBusy(true);
      showMsg("正在请求 Worker 手动同步 BTCUSDT 全周期 D1…");
      let syncData = null;
      try {
        syncData = await DataEngine.triggerCloudSync("BTCUSDT", "all", true, { timeoutMs: 150_000 });
        showMsg(summarizeManualSyncMessage(syncData) + " 正在刷新状态…");
        try {
          const statusData = await DataEngine.fetchCloudStatus({ timeoutMs: 25_000, detail: "0" });
          statusData._manualSync = syncData;
          showOutput(statusData, { sync: syncData, status: statusData });
          showMsg(summarizeManualSyncMessage(syncData) + " 已刷新 D1 状态。");
        } catch (statusErr) {
          const statusMsg = statusErr && statusErr.message ? statusErr.message : String(statusErr);
          showOutput({ _manualSync: syncData }, { sync: syncData, statusError: statusMsg });
          showMsg(summarizeManualSyncMessage(syncData) + " 但状态刷新失败: " + statusMsg);
        }
      } catch (e) {
        const err = e && e.message ? e.message : String(e);
        showMsg("同步失败: " + err);
        showOutput(null, { syncError: err });
      }
      finally {
        setBusy(false);
      }
    });
  }
}

let userSettingsCleanup=null;
function disposeUserSettings(){userSettingsCleanup?.();userSettingsCleanup=null;}
function initSettingsPage(){disposeUserSettings();const ctrl=new AbortController(),button=document.getElementById('settings-read-check'),out=document.getElementById('settings-read-status');if(!button)return;let serial=0;userSettingsCleanup=()=>{ctrl.abort();++serial;};button.addEventListener('click',async()=>{const ticket=++serial;button.disabled=true;out.textContent='正在读取资料…';const rows=await Promise.all([['chart','价格与结构'],['orderflow','成交'],['heatmap','强平'],['context','杠杆与宏观']].map(async([scope,label])=>{try{const data=await DataEngine.fetchDesk(scope,{interval:scope==='chart'?'15m':scope==='orderflow'?'5m':undefined,range:'24h',signal:ctrl.signal});const unavailable=data.quality?.status==='fail'||scope==='chart'&&data.pricePathAvailable!==true;const issue=data.sourceStale||data.collectionStale||data.quality?.status==='warn';return '<p><strong>'+label+'</strong> · '+(unavailable?'本次资料不足':issue?'可读取，部分资料需核对':'已读取；时效见对应页面')+' · '+escapeHtml(ResearchDesk.time(data.asOf))+'</p>';}catch{return '<p><strong>'+label+'</strong> · 暂时无法读取，请重试。</p>';}}));if(ctrl.signal.aborted||ticket!==serial)return;out.innerHTML=rows.join('');button.disabled=false;},{signal:ctrl.signal});}
