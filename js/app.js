/* =======================================================
   路由注册与启动
   ======================================================= */
const ROUTES = {
  "overview": { crumbs: ["核心", "概览 Dashboard"], render: pageOverview },
  "premarket": { crumbs: ["核心", "盘前简报"], render: () => pagePlaceholder(PLACEHOLDERS.premarket) },

  "chart": { crumbs: ["市场监测", "行情工作台"], render: pageChart, afterMount: initChart },
  "orderflow": { crumbs: ["市场监测", "订单流与足迹图"], render: pageOrderflow, afterMount: initOrderflow },
  "heatmap": { crumbs: ["市场监测", "强平雷达"], render: pageHeatmap, afterMount: initHeatmap },
  "derivatives": { crumbs: ["市场监测", "衍生品面板"], render: pageDerivatives, afterMount: initDerivatives },

  "news": { crumbs: ["舆情与事件", "事件一览"], render: pageYuqingEvents, afterMount: initYuqingEvents },
  "news-analysis": { crumbs: ["舆情与事件", "舆情分析"], render: pageNews, afterMount: initNews },

  "boardroom": { crumbs: ["智囊团", "会议室"], render: pageBoardroom },
  "agent-chief": { crumbs: ["智囊团", "首席策略官"], render: () => pageAgentPlaceholder("chief") },
  "agent-env": { crumbs: ["智囊团", "环境评估员"], render: pageEnvAgent, afterMount: renderEnvCharts },
  "agent-flow": { crumbs: ["智囊团", "盘口流动性官"], render: () => pageAgentPlaceholder("flow") },
  "agent-deriv": { crumbs: ["智囊团", "衍生品情报官"], render: () => pageAgentPlaceholder("deriv") },
  "agent-risk": { crumbs: ["智囊团", "风控官"], render: () => pageAgentPlaceholder("risk") },
  "archive": { crumbs: ["智囊团", "发言历史库"], render: () => pagePlaceholder(PLACEHOLDERS.archive) },

  "calc": { crumbs: ["交易执行", "仓位与风险计算器"], render: pageCalc },
  "templates": { crumbs: ["交易执行", "策略模板库"], render: () => pagePlaceholder(PLACEHOLDERS.templates) },
  "draft": { crumbs: ["交易执行", "订单草稿台"], render: () => pagePlaceholder(PLACEHOLDERS.draft) },
  "positions": { crumbs: ["交易执行", "当前持仓"], render: () => pagePlaceholder(PLACEHOLDERS.positions) },

  "journal": { crumbs: ["复盘系统", "交易日志"], render: () => pagePlaceholder(PLACEHOLDERS.journal) },
  "daily-review": { crumbs: ["复盘系统", "每日复盘"], render: () => pagePlaceholder(PLACEHOLDERS["daily-review"]) },
  "perf": { crumbs: ["复盘系统", "绩效统计"], render: () => pagePlaceholder(PLACEHOLDERS.perf) },
  "patterns": { crumbs: ["复盘系统", "错误模式"], render: () => pagePlaceholder(PLACEHOLDERS.patterns) },

  "data-vault": { crumbs: ["系统", "数据池"], render: () => pagePlaceholder(PLACEHOLDERS["data-vault"]) },
  "playbook": { crumbs: ["系统", "知识库 Playbook"], render: () => pagePlaceholder(PLACEHOLDERS.playbook) },
  "settings": { crumbs: ["系统", "设置"], render: pageSettings, afterMount: initSettingsPage },
};

function resolveRoute() {
  const h = location.hash.replace(/^#\/?/, "").trim();
  const id = h.split("?")[0];
  if (!id || !ROUTES[id]) return "chart";
  return id;
}

// 只释放上一个页面；取消尚未执行的挂载，避免快速切页后启动旧订阅。
const PAGE_DISPOSERS = {
  chart: () => window.__bitDeskDisposeChart?.(),
  orderflow: () => window.__bitDeskDisposeOrderflow?.(),
  heatmap: () => window.__bitDeskDisposeHeatmap?.(),
  derivatives: () => disposeDerivatives(),
  news: () => window.__bitDeskDisposeYuqingEvents?.(),
  "news-analysis": () => window.__bitDeskDisposeNews?.(),
};
let mountedPage = null;
let pendingPageMount = null;
function render() {
  if (pendingPageMount !== null) cancelAnimationFrame(pendingPageMount);
  pendingPageMount = null;
  if (mountedPage && PAGE_DISPOSERS[mountedPage]) PAGE_DISPOSERS[mountedPage]();
  mountedPage = null;
  const id = resolveRoute();
  const route = ROUTES[id];
  const outlet = $("#outlet");

  outlet.style.animation = "none";
  const content = route.render();
  outlet.innerHTML = renderFeatureNotice(id) + (FEATURE_STATE_BY_ROUTE[id] === "demo" ? renderDemoPreview(content) : content);
  disableDemoControls(outlet);
  void outlet.offsetWidth;
  outlet.style.animation = "";

  setBreadcrumb(route.crumbs);
  highlightNav(id);

  if (typeof route.afterMount === "function") {
    pendingPageMount = requestAnimationFrame(() => {
      pendingPageMount = null;
      mountedPage = id;
      route.afterMount();
    });
  }
  attachPageEvents();
}

function attachPageEvents() {
  $$(".history-item").forEach(h => {
    h.addEventListener("click", () => h.classList.toggle("open"));
  });
  const themePicker = $("#themePicker");
  if (themePicker && !themePicker.dataset.bound) {
    themePicker.dataset.bound = "1";
    themePicker.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".theme-option");
      if (!btn || !themePicker.contains(btn)) return;
      const next = btn.getAttribute("data-theme");
      if (!next || getTheme() === next) return;
      setTheme(next);
      $$("#themePicker .theme-option").forEach((x) => {
        const on = x.getAttribute("data-theme") === next;
        x.classList.toggle("theme-option--active", on);
        x.setAttribute("aria-checked", on ? "true" : "false");
        const badge = x.querySelector(".theme-option-badge");
        if (badge) badge.textContent = on ? "使用中" : "";
      });
      const chip = document.querySelector(".settings-theme-chip");
      if (chip) chip.textContent = `当前主题 · ${next === "dark" ? "深色" : "浅色"}`;
    });
  }
}

function tickClock() {
  const elTime = $("#nowTime");
  if (!elTime) return;
  elTime.textContent = new Date().toLocaleTimeString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function init() {
  initTheme();
  buildSidebar();
  initMobileNavigation();
  const rawHash = location.hash.replace(/^#\/?/, "").trim();
  if (!rawHash || !ROUTES[rawHash.split("?")[0]]) {
    history.replaceState(null, "", "#chart");
  }
  render();
  window.addEventListener("hashchange", render);
  tickClock();
  setInterval(tickClock, 1000);
}

init();
