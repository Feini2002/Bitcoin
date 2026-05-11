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

function readSettingsYuqingScheduleDraft() {
  if (typeof DataEngine !== "undefined" && typeof DataEngine.readYuqingScheduleDraft === "function") {
    return DataEngine.readYuqingScheduleDraft();
  }
  return {
    enabled: false,
    times: ["00:00", "08:00", "12:00", "20:00"],
    analysisTimes: ["09:00", "14:00", "22:00"],
    timezone: "Asia/Shanghai",
    adminSecretHint: "",
    updatedAt: null,
    phase: "worker_d1_reports",
  };
}

function settingsYuqingNextRunLabel(cfg) {
  const iso =
    typeof DataEngine !== "undefined" && typeof DataEngine.nextYuqingScheduleRun === "function"
      ? DataEngine.nextYuqingScheduleRun(cfg)
      : null;
  if (!iso) return "未启用";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "待计算";
  return d.toLocaleString("zh-CN", { hour12: false });
}

const SETTINGS_MODEL_CATALOG = [
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview", tier: "深度", hint: "复杂归纳、二次研判、首席策略类任务" },
  { id: "gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite Preview", tier: "轻量", hint: "低成本、短文本、状态与温度类任务" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview", tier: "快速", hint: "实时检索、事件扫描、常规模块生成" },
];

const SETTINGS_MODEL_TARGETS = [
  { id: "daily_event.dashboard", group: "事件一览", page: "事件一览", module: "信息温度", status: "active", defaultModel: "gemini-3.1-flash-lite-preview", note: "市场温度 JSON 与低延迟状态摘要。" },
  { id: "daily_event.news", group: "事件一览", page: "事件一览", module: "今日头条", status: "active", defaultModel: "gemini-3-flash-preview", note: "Google Search 事件检索与结构化头条。" },
  { id: "daily_event.timeline", group: "事件一览", page: "事件一览", module: "动态速览", status: "active", defaultModel: "gemini-3-flash-preview", note: "实时动态简报与来源归纳。" },
  { id: "daily_event.ai", group: "事件一览", page: "事件一览", module: "AI 情报站", status: "active", defaultModel: "gemini-3-flash-preview", note: "AI 行业新闻检索与可用性提炼。" },
  { id: "daily_event.githubTools", group: "事件一览", page: "事件一览", module: "GitHub 工具雷达", status: "active", defaultModel: "gemini-3-flash-preview", note: "开发工具与开源项目动态检索。" },
  { id: "daily_event.trends", group: "事件一览", page: "事件一览", module: "趋势线索", status: "active", defaultModel: "gemini-3.1-flash-lite-preview", note: "基于本轮模块输出的二次叠加。" },
  { id: "sentiment_analysis.dashboard", group: "舆情分析", page: "舆情分析", module: "市场状态", status: "active", defaultModel: "gemini-3.1-flash-lite-preview", note: "二次分析页的市场温度与状态底座。" },
  { id: "sentiment_analysis.news", group: "舆情分析", page: "舆情分析", module: "事件复盘", status: "active", defaultModel: "gemini-3.1-pro-preview", note: "复盘上游事件、动态速览与宏观主线。" },
  { id: "sentiment_analysis.ai", group: "舆情分析", page: "舆情分析", module: "AI 线索复核", status: "active", defaultModel: "gemini-3.1-pro-preview", note: "将 AI 事件放回市场语境做二次筛选。" },
  { id: "sentiment_analysis.trends", group: "舆情分析", page: "舆情分析", module: "趋势研判", status: "active", defaultModel: "gemini-3.1-pro-preview", note: "综合上游日报、事实池与市场快照。" },
  { id: "agent.chief", group: "员工 Agent", page: "智囊团", module: "首席策略官", status: "reserved", defaultModel: "gemini-3.1-pro-preview", note: "预留：未来总控汇总与最终策略指引。" },
  { id: "agent.env", group: "员工 Agent", page: "智囊团", module: "环境评估员", status: "reserved", defaultModel: "gemini-3-flash-preview", note: "预留：未来读取行情、波动率与宏观环境。" },
  { id: "agent.flow", group: "员工 Agent", page: "智囊团", module: "盘口流动性官", status: "reserved", defaultModel: "gemini-3-flash-preview", note: "预留：未来读取足迹图、成交分布与强平。" },
  { id: "agent.deriv", group: "员工 Agent", page: "智囊团", module: "衍生品情报官", status: "reserved", defaultModel: "gemini-3-flash-preview", note: "预留：未来读取资金费率、OI、期权与基差。" },
  { id: "agent.risk", group: "员工 Agent", page: "智囊团", module: "风控官", status: "reserved", defaultModel: "gemini-3-flash-preview", note: "预留：未来读取仓位、风险预算与异常模式。" },
];

let __settingsModelConfig = null;

function defaultSettingsModelConfig() {
  const effective = {};
  SETTINGS_MODEL_TARGETS.forEach((target) => {
    effective[target.id] = target.defaultModel;
  });
  return {
    ok: true,
    d1Ready: false,
    source: "fallback",
    catalog: SETTINGS_MODEL_CATALOG,
    targets: SETTINGS_MODEL_TARGETS,
    settings: { version: 1, assignments: {}, updatedAt: null },
    effective,
    warning: null,
  };
}

function normalizeSettingsModelConfig(data) {
  const fallback = defaultSettingsModelConfig();
  const src = data && typeof data === "object" ? data : {};
  const catalog = Array.isArray(src.catalog) && src.catalog.length ? src.catalog : fallback.catalog;
  const targets = Array.isArray(src.targets) && src.targets.length ? src.targets : fallback.targets;
  const settings = src.settings && typeof src.settings === "object" ? src.settings : fallback.settings;
  const assignments = settings.assignments && typeof settings.assignments === "object" ? settings.assignments : {};
  const effectiveSrc = src.effective && typeof src.effective === "object" ? src.effective : {};
  const effective = {};
  targets.forEach((target) => {
    effective[target.id] = String(effectiveSrc[target.id] || assignments[target.id] || target.defaultModel || fallback.effective[target.id] || "");
  });
  return {
    ...fallback,
    ...src,
    catalog,
    targets,
    settings: { ...settings, assignments },
    effective,
  };
}

function settingsModelSourceLabel(cfg) {
  if (cfg.source === "d1") return "D1 已保存";
  if (cfg.warning) return "读取降级";
  return cfg.d1Ready ? "默认/环境变量" : "本地默认";
}

function settingsModelOptions(catalog, selected) {
  const known = new Set((catalog || []).map((m) => m.id));
  const extra = selected && !known.has(selected)
    ? `<option value="${escapeHtml(selected)}" selected>环境变量 · ${escapeHtml(selected)}</option>`
    : "";
  return extra + (catalog || []).map((model) => `
    <option value="${escapeHtml(model.id)}" ${model.id === selected ? "selected" : ""}>
      ${escapeHtml(model.label || model.id)}
    </option>
  `).join("");
}

function renderSettingsModelChannels(config) {
  const cfg = normalizeSettingsModelConfig(config);
  const groups = [];
  cfg.targets.forEach((target) => {
    if (!groups.includes(target.group)) groups.push(target.group);
  });
  const updatedAt = cfg.settings && cfg.settings.updatedAt ? formatD1Time(cfg.settings.updatedAt) : "尚未保存";
  return `
    <div class="settings-model-summary">
      <div class="cloud-status-card">
        <span>配置来源</span>
        <strong>${escapeHtml(settingsModelSourceLabel(cfg))}</strong>
        <em>${cfg.d1Ready ? "Worker 已绑定 D1" : "D1 不可写时仅展示默认值"}</em>
      </div>
      <div class="cloud-status-card">
        <span>内置模型</span>
        <strong>${cfg.catalog.length}</strong>
        <em>${cfg.catalog.map((m) => escapeHtml(m.tier || "")).filter(Boolean).join(" / ")}</em>
      </div>
      <div class="cloud-status-card">
        <span>最后保存</span>
        <strong>${escapeHtml(updatedAt)}</strong>
        <em>${cfg.warning ? escapeHtml(cfg.warning) : "保存后下一次 Worker 请求立即生效"}</em>
      </div>
    </div>
    <div class="settings-model-groups">
      ${groups.map((group) => {
        const rows = cfg.targets.filter((target) => target.group === group).map((target) => {
          const selected = cfg.effective[target.id] || target.defaultModel;
          return `
            <label class="settings-model-row" data-model-row="${escapeHtml(target.id)}">
              <span class="settings-model-row-main">
                <span class="settings-model-row-title">
                  ${escapeHtml(target.module)}
                  <em class="settings-model-row-badge ${target.status === "reserved" ? "reserved" : "active"}">${target.status === "reserved" ? "预留" : "已接入"}</em>
                </span>
                <span class="settings-model-row-note">${escapeHtml(target.note || target.page || "")}</span>
              </span>
              <select class="settings-model-select" data-model-target="${escapeHtml(target.id)}" data-default-model="${escapeHtml(target.defaultModel)}" aria-label="${escapeHtml(target.module)}模型">
                ${settingsModelOptions(cfg.catalog, selected)}
              </select>
            </label>
          `;
        }).join("");
        return `
          <section class="settings-model-group">
            <div class="settings-model-group-head">
              <strong>${escapeHtml(group)}</strong>
              <span>${rows ? `${cfg.targets.filter((target) => target.group === group).length} 个通道` : "暂无通道"}</span>
            </div>
            <div class="settings-model-rows">${rows}</div>
          </section>
        `;
      }).join("")}
    </div>
    <div class="settings-actions settings-model-actions">
      <button type="button" class="btn" data-model-action="refresh"><i class="ph ph-arrows-clockwise"></i><span>重新读取</span></button>
      <button type="button" class="btn" data-model-action="reset"><i class="ph ph-arrow-counter-clockwise"></i><span>恢复默认</span></button>
      <button type="button" class="btn primary" data-model-action="save"><i class="ph ph-floppy-disk"></i><span>保存模型配置</span></button>
      <span class="settings-actions-msg" id="settings-model-msg"></span>
    </div>
  `;
}

function pageSettings() {
  const current = getTheme();
  const themeLabel = current === "dark" ? "深色" : "浅色";
  const yuqingSchedule = readSettingsYuqingScheduleDraft();
  const yuqingNext = settingsYuqingNextRunLabel(yuqingSchedule);
  return html`
    <div class="settings-shell">
      <header class="page-header settings-page-head">
        <div>
          <h1 class="page-title">设置</h1>
          <div class="page-sub">偏好与云端巡检 · 主题仅在浏览器会话内保存；行情读写经 Cloudflare Worker 绑定的 D1</div>
        </div>
        <span class="chip ok settings-theme-chip">当前主题 · ${themeLabel}</span>
      </header>

      <section class="settings-panel">
        <div class="settings-panel-head">
          <div class="settings-panel-icon" aria-hidden="true"><i class="ph ph-paint-brush"></i></div>
          <div>
            <h2 class="settings-panel-title">外观</h2>
            <p class="settings-panel-desc">切换后立即生效；未登录云，不与账号绑定。</p>
          </div>
        </div>
        <div class="theme-segment" id="themePicker" role="radiogroup" aria-label="界面配色">
          ${settingsThemeOptions(current)}
        </div>
      </section>

      <section class="settings-panel">
        <div class="settings-panel-head">
          <div class="settings-panel-icon settings-panel-icon--data" aria-hidden="true"><i class="ph ph-database"></i></div>
          <div>
            <h2 class="settings-panel-title">K 线与云端 D1</h2>
            <p class="settings-panel-desc">Pages 前台连接已部署 Worker；常规写库由 Cron 维护，手动同步会请求 Worker 立即从行情源补写 D1。</p>
          </div>
        </div>
        <ul class="settings-fact-list">
          <li><strong>读取</strong>行情页默认读取 <code>/api/d1/klines?sync=0</code>；若当前周期明显落后，工作台会触发一次当前周期同步，实时跳动由 Binance WS 补齐。</li>
          <li><strong>同步</strong>「立即同步 D1」调用 Worker 的 <code>/api/d1/sync</code> 全周期写库；工作台右上角按钮只同步当前周期。</li>
          <li><strong>保留策略</strong>各周期至多约 2000 根 K 线；Footprint 以 5m 为基底至多 8640 根，高周期由 Worker 聚合。</li>
          <li><strong>排障</strong>如果出现异常，优先复制下方「异常摘要」发给 Codex；完整 JSON 只用于核对 Worker/D1 原始返回。</li>
        </ul>
        <div class="settings-actions">
          <button type="button" class="btn primary" id="settings-cloud-sync">立即同步 D1</button>
          <button type="button" class="btn" id="settings-cloud-status">查看 D1 状态</button>
          <span class="settings-actions-msg" id="settings-cloud-msg"></span>
        </div>
        <div id="settings-cloud-summary" class="cloud-status-summary"></div>
        <div class="cloud-diagnostics-actions" id="settings-cloud-tools" hidden>
          <button type="button" class="btn" data-copy-cloud="diagnostic"><i class="ph ph-copy"></i><span>复制异常摘要</span></button>
          <button type="button" class="btn" data-copy-cloud="raw"><i class="ph ph-brackets-curly"></i><span>复制完整 JSON</span></button>
          <span>不用截图表格；复制摘要就能带上 Worker、周期、错误和下一步线索。</span>
        </div>
        <details class="cloud-status-raw">
          <summary>完整 JSON（机器排障用）</summary>
          <p>一般不用手看这里；当需要对照 Worker/D1 原始字段时，点上面的「复制完整 JSON」。</p>
          <pre id="settings-cloud-output"></pre>
        </details>
      </section>

      <section class="settings-panel" id="settings-yuqing-schedule-panel">
        <div class="settings-panel-head">
          <div class="settings-panel-icon settings-panel-icon--yuqing" aria-hidden="true"><i class="ph ph-newspaper-clipping"></i></div>
          <div>
            <h2 class="settings-panel-title">舆情与事件定点说明</h2>
            <p class="settings-panel-desc">云端 Cron 时点由 Worker 配置固定；此处可开关浏览器「下一档预估」提示。</p>
          </div>
        </div>
        <div class="settings-yuqing-card">
          <div class="settings-yuqing-main">
            <label class="settings-yuqing-toggle">
              <input id="settings-yuqing-enabled" type="checkbox" ${yuqingSchedule.enabled ? "checked" : ""} />
              <span>启用浏览器「下一次预估」提示（仅前端偏好；Worker Cron 时点不可在此修改）</span>
            </label>
            <div class="settings-yuqing-readonly" aria-readonly="true">
              <p class="settings-yuqing-readonly-title">云端定点任务（北京时间 · Asia/Shanghai）</p>
              <ul class="settings-yuqing-readonly-list">
                <li><strong>事件日报</strong> 每日 00:00、08:00、12:00、20:00</li>
                <li><strong>舆情二次分析</strong> 每日 09:00、14:00、22:00（依赖上游日报与市场监测）</li>
              </ul>
              <p class="muted-text settings-yuqing-readonly-note">实际触发以已部署 Worker 的 Cron 配置为准；此处仅作说明。</p>
            </div>
          </div>
          <div class="settings-yuqing-side">
            <div class="cloud-status-card">
              <span>下一次预估（事件日报下一档）</span>
              <strong id="settings-yuqing-next">${escapeHtml(yuqingNext)}</strong>
              <em>Asia/Shanghai · 前台推算（非 Worker）</em>
            </div>
            <span class="settings-actions-msg" id="settings-yuqing-msg"></span>
          </div>
        </div>
      </section>

      <section class="settings-panel" id="settings-model-panel">
        <div class="settings-panel-head">
          <div class="settings-panel-icon settings-panel-icon--model" aria-hidden="true"><i class="ph ph-cpu"></i></div>
          <div>
            <h2 class="settings-panel-title">模型通道</h2>
            <p class="settings-panel-desc">按页面、模块与员工预留通道分配模型；保存后写入舆情 Worker 绑定的 D1，下一次生成请求优先读取这里。</p>
          </div>
        </div>
        <div id="settings-model-content">
          ${renderSettingsModelChannels(__settingsModelConfig || defaultSettingsModelConfig())}
        </div>
      </section>

      <section class="settings-panel settings-panel--muted">
        <div class="settings-panel-head">
          <div class="settings-panel-icon settings-panel-icon--planned" aria-hidden="true"><i class="ph ph-lightbulb"></i></div>
          <div>
            <h2 class="settings-panel-title">路线图</h2>
            <p class="settings-panel-desc">以下模块仍在规划中，当前版本占位展示。</p>
          </div>
        </div>
        <div class="future-list future-list--settings">
          ${SETTINGS_FUTURE.map(f => `
            <div class="future-item">
              <h4>${f.title}</h4>
              <p>${f.desc}</p>
              <span class="coming">PLANNED</span>
            </div>
          `).join("")}
        </div>
      </section>
    </div>
  `;
}

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
    const max = Number(data.maxPerInterval || 2000);
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
        <td>${count ? `${count}${countRow?.estimated ? "（估算）" : ` / ${Number(data?.maxPerInterval || 2000)}`}` : "0"}</td>
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
      Pages 静态页请求 ${escapeHtml(apiBase || "已配置 Worker")}；图表页默认只读 D1，但打开后发现当前周期明显落后或点击右上角按钮时会同步当前周期；设置页的「立即同步 D1」用于全周期手动写库。Cron 仍是常规维护入口，每个周期最多保留最近 ${Number(data.maxPerInterval || 2000)} 根。
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

function collectSettingsYuqingScheduleDraft() {
  const enabled = !!document.getElementById("settings-yuqing-enabled")?.checked;
  return { enabled };
}

function refreshSettingsYuqingNext(cfg) {
  const el = document.getElementById("settings-yuqing-next");
  if (!el) return;
  el.textContent = settingsYuqingNextRunLabel(cfg || collectSettingsYuqingScheduleDraft());
}

function initSettingsYuqingSchedule() {
  const panel = document.getElementById("settings-yuqing-schedule-panel");
  if (!panel || panel.dataset.bound) return;
  panel.dataset.bound = "1";

  const msg = document.getElementById("settings-yuqing-msg");
  const showMsg = (text) => {
    if (msg) msg.textContent = text || "";
  };

  const persistEnabled = () => {
    const draft = collectSettingsYuqingScheduleDraft();
    let saved = draft;
    if (typeof DataEngine !== "undefined" && typeof DataEngine.writeYuqingScheduleDraft === "function") {
      saved = DataEngine.writeYuqingScheduleDraft(draft);
    }
    refreshSettingsYuqingNext(saved);
    showMsg(saved.enabled ? "已开启浏览器预估提示。" : "已关闭浏览器预估提示。");
  };

  const enabledEl = document.getElementById("settings-yuqing-enabled");
  if (enabledEl && !enabledEl.dataset.boundYuqing) {
    enabledEl.dataset.boundYuqing = "1";
    enabledEl.addEventListener("change", persistEnabled);
  }

  refreshSettingsYuqingNext(readSettingsYuqingScheduleDraft());
}

function showSettingsModelMsg(text) {
  const msg = document.getElementById("settings-model-msg");
  if (msg) msg.textContent = text || "";
}

function renderSettingsModelConfigIntoDom(config) {
  const content = document.getElementById("settings-model-content");
  if (!content) return;
  __settingsModelConfig = normalizeSettingsModelConfig(config);
  content.innerHTML = renderSettingsModelChannels(__settingsModelConfig);
}

function collectSettingsModelAssignments() {
  const assignments = {};
  document.querySelectorAll("[data-model-target]").forEach((el) => {
    const key = el.getAttribute("data-model-target") || "";
    const value = String(el.value || "").trim();
    if (key && value) assignments[key] = value;
  });
  return assignments;
}

function setSettingsModelBusy(panel, busy) {
  if (!panel) return;
  panel.querySelectorAll("[data-model-action], [data-model-target]").forEach((el) => {
    el.disabled = !!busy;
  });
}

function resetSettingsModelSelects(panel) {
  if (!panel) return;
  panel.querySelectorAll("[data-model-target]").forEach((el) => {
    const def = el.getAttribute("data-default-model") || "";
    if (def) el.value = def;
  });
}

async function loadSettingsModelChannels() {
  if (typeof DataEngine === "undefined" || typeof DataEngine.fetchYuqingModelSettings !== "function") {
    renderSettingsModelConfigIntoDom(defaultSettingsModelConfig());
    showSettingsModelMsg("数据引擎未加载，暂用内置默认。");
    return;
  }
  showSettingsModelMsg("正在读取模型通道…");
  try {
    const data = await DataEngine.fetchYuqingModelSettings({ timeoutMs: 25_000 });
    renderSettingsModelConfigIntoDom(data);
    showSettingsModelMsg(data && data.warning ? `已降级读取：${data.warning}` : "已读取 D1 模型通道。");
  } catch (e) {
    renderSettingsModelConfigIntoDom(defaultSettingsModelConfig());
    showSettingsModelMsg("读取失败，暂用内置默认：" + (e && e.message ? e.message : e));
  }
}

function initSettingsModelChannels() {
  const panel = document.getElementById("settings-model-panel");
  if (!panel || panel.dataset.bound) return;
  panel.dataset.bound = "1";

  panel.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-model-action]");
    if (!btn) return;
    const action = btn.getAttribute("data-model-action");
    if (action === "reset") {
      resetSettingsModelSelects(panel);
      showSettingsModelMsg("已恢复为内置默认，点击保存后写入 D1。");
      return;
    }
    if (action === "refresh") {
      setSettingsModelBusy(panel, true);
      try {
        await loadSettingsModelChannels();
      } finally {
        setSettingsModelBusy(panel, false);
      }
      return;
    }
    if (action !== "save") return;
    if (typeof DataEngine === "undefined" || typeof DataEngine.updateYuqingModelSettings !== "function") {
      showSettingsModelMsg("数据引擎未加载，无法保存。");
      return;
    }
    setSettingsModelBusy(panel, true);
    showSettingsModelMsg("正在保存到 D1…");
    try {
      const data = await DataEngine.updateYuqingModelSettings({ assignments: collectSettingsModelAssignments() }, { timeoutMs: 25_000 });
      renderSettingsModelConfigIntoDom(data);
      showSettingsModelMsg("已保存，下一次生成请求会读取新模型。");
    } catch (err) {
      showSettingsModelMsg("保存失败：" + (err && err.message ? err.message : err));
    } finally {
      setSettingsModelBusy(panel, false);
    }
  });

  loadSettingsModelChannels();
}

function initSettingsPage() {
  initSettingsYuqingSchedule();
  initSettingsModelChannels();

  const syncBtn = document.getElementById("settings-cloud-sync");
  const statusBtn = document.getElementById("settings-cloud-status");
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
    if (syncBtn) syncBtn.disabled = !!busy;
  };

  const refreshStatus = async (manualSync) => {
    if (typeof DataEngine === "undefined" || !DataEngine.fetchCloudStatus) {
      showMsg("数据引擎未加载，请刷新页面后重试。");
      return null;
    }
    const detail = manualSync ? "1" : "0";
    const syncPayload = manualSync && !manualSync.detailOnly ? manualSync : null;
    const data = await DataEngine.fetchCloudStatus({ timeoutMs: 25_000, detail });
    if (syncPayload) data._manualSync = syncPayload;
    showOutput(data);
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
      showMsg("正在查询 D1 状态…");
      try {
        await refreshStatus({ detailOnly: true });
        showMsg("已获取 D1 状态。");
      } catch (e) {
        showMsg("状态读取失败: " + (e && e.message ? e.message : e));
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
          const statusData = await DataEngine.fetchCloudStatus({ timeoutMs: 25_000, detail: "1" });
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
