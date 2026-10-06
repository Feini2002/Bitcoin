/* =======================================================
   路由注册与启动
   ======================================================= */
const ROUTES = {
  "overview": { crumbs: ["首席决策台", "最新事实"], render: pageResearchOverview, afterMount: initResearchOverview },
  "domains": { crumbs: ["研究", "领域研究"], render: () => pageAgentTeam('domains'), afterMount: initAgentTeam },
  "market": {}, "events": {}, "research": {},
  "records": { crumbs: ["研究", "研究报告"], render: pageResearchRecords, afterMount: initResearchRecords },
  "research-window": { crumbs: ["研究团队", "指定问题研究"], render: pageResearchTeam, afterMount: initResearchTeam },
  "team-record": { crumbs: ["记录", "岗位研究"], render: pageTeamRecord, afterMount: initTeamRecord },
  "premarket": { crumbs: ["核心", "盘前简报"], render: () => pagePlaceholder(PLACEHOLDERS.premarket) },

  "chart": { crumbs: ["市场监测", "行情工作台"], render: pageChart, afterMount: initChart },
  "orderflow": { crumbs: ["市场监测", "订单流与足迹图"], render: pageOrderflow, afterMount: initOrderflow },
  "heatmap": { crumbs: ["市场监测", "强平雷达"], render: pageHeatmap, afterMount: initHeatmap },
  "derivatives": { crumbs: ["市场监测", "环境背景"], render: pageDerivatives, afterMount: initDerivatives },

  "news": { crumbs: ["研究", "事件一览"], render: () => researchLegacyRoute() ? pageYuqingEvents() : ResearchDesk.scaffold('daily_event'), afterMount: () => researchLegacyRoute() ? initYuqingEvents() : ResearchDesk.mount('daily_event') },
  "news-analysis": { crumbs: ["研究", "舆情分析"], render: () => researchLegacyRoute() ? pageNews() : ResearchDesk.scaffold('sentiment_analysis'), afterMount: () => researchLegacyRoute() ? initNews() : ResearchDesk.mount('sentiment_analysis') },

  "boardroom": { crumbs: ["智囊团", "首席决策台"], render: () => pageAgentTeam('chief'), afterMount: initAgentTeam },
  "boardroom-demo": { crumbs: ["规划与演示", "旧会议示例"], render: pageBoardroom },
  "agent-chief": { crumbs: ["智囊团", "首席策略官"], render: () => pageAgentTeam('chief'), afterMount: initAgentTeam },
  "agent-env": { crumbs: ["智囊团", "环境评估员"], render: () => pageAgentTeam('env'), afterMount: initAgentTeam },
  "agent-flow": { crumbs: ["智囊团", "盘口流动性官"], render: () => pageAgentTeam('flow'), afterMount: initAgentTeam },
  "agent-deriv": { crumbs: ["智囊团", "衍生品情报官"], render: () => pageAgentTeam('deriv'), afterMount: initAgentTeam },
  "agent-macro": { crumbs: ["智囊团", "宏观研究员"], render: () => pageAgentTeam('macro'), afterMount: initAgentTeam },
  "agent-events": { crumbs: ["智囊团", "事件与舆情研究员"], render: () => pageAgentTeam('events'), afterMount: initAgentTeam },
  "agent-risk": { crumbs: ["智囊团", "风控官"], render: () => pageAgentPlaceholder("risk") },
  "archive": { crumbs: ["研究", "研究报告"], render: pageResearchRecords, afterMount: initResearchRecords },

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
  "settings": { crumbs: ["系统", "设置"], render: pageSettings, afterMount: () => {initSettingsPage();initAgentTeamSettings();} },
};

function researchLegacyRoute() { return /(?:[?&])legacy=1(?:&|$)/.test(location.hash); }
function resolveRoute() {
  const h = location.hash.replace(/^#\/?/, "").trim();
  const id = h.split("?")[0];
  if (id === "market") { const view = UserWorkspace.query().get('view'); return ['orderflow','heatmap'].includes(view) ? view : ['leverage','macro'].includes(view) ? 'derivatives' : 'chart'; }
  if (id === "events") return "news";
  if (id === "research") return UserWorkspace.query().get('view')==='window' ? 'research-window' : UserWorkspace.query().get('view')==='narratives' ? 'news-analysis' : 'boardroom';
  if (!id || !ROUTES[id]) return "boardroom";
  return id;
}

// 只释放上一个页面；取消尚未执行的挂载，避免快速切页后启动旧订阅。
const PAGE_DISPOSERS = {
  boardroom: () => disposeAgentTeam(),
  domains: () => disposeAgentTeam(),
  'research-window': () => disposeResearchTeam(),
  'team-record': () => disposeTeamRecord(),
  'agent-chief': () => disposeAgentTeam(), 'agent-env': () => disposeAgentTeam(), 'agent-flow': () => disposeAgentTeam(), 'agent-deriv': () => disposeAgentTeam(), 'agent-macro': () => disposeAgentTeam(), 'agent-events': () => disposeAgentTeam(), archive: () => disposeResearchRecords(),
  overview: () => disposeResearchOverview(),
  records: () => disposeResearchRecords(),
  settings: () => {disposeUserSettings();disposeAgentTeam();},
  chart: () => window.__bitDeskDisposeChart?.(),
  orderflow: () => window.__bitDeskDisposeOrderflow?.(),
  heatmap: () => window.__bitDeskDisposeHeatmap?.(),
  derivatives: () => disposeDerivatives(),
  news: () => { ResearchDesk.dispose(); window.__bitDeskDisposeYuqingEvents?.(); },
  "news-analysis": () => { ResearchDesk.dispose(); window.__bitDeskDisposeNews?.(); },
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
  const market = ["chart","orderflow","heatmap","derivatives"].includes(id);
  const research = ['boardroom','research-window','news-analysis','agent-chief','agent-env','agent-flow','agent-deriv','agent-macro','agent-events'].includes(id);
  const content = market ? UserWorkspace.marketShell(id, route.render()) : research ? UserWorkspace.researchShell(id,route.render()) : route.render();
  outlet.innerHTML = renderFeatureNotice(id) + (FEATURE_STATE_BY_ROUTE[id] === "demo" ? renderDemoPreview(content) : content);
  disableDemoControls(outlet);
  void outlet.offsetWidth;
  outlet.style.animation = "";

  setBreadcrumb(market ? ["证据工作区", Object.fromEntries(UserWorkspace.views)[UserWorkspace.view(id)]] : id === "news" ? ["证据工作区","事件资料"] : route.crumbs);
  highlightNav(id);

  if (typeof route.afterMount === "function") {
    pendingPageMount = requestAnimationFrame(() => {
      pendingPageMount = null;
      mountedPage = id;
      route.afterMount();
      if (market) UserWorkspace.mountMarket(id);
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
  initAgentTeamPresence();
  initTheme();
  buildSidebar();
  initMobileNavigation();
  const rawHash = location.hash.replace(/^#\/?/, "").trim();
  if (!rawHash || !ROUTES[rawHash.split("?")[0]]) {
    history.replaceState(null, "", "#/boardroom");
  }
  render();
  window.addEventListener("hashchange", render);
  document.addEventListener("visibilitychange", () => {
    if (mountedPage !== "chart") return;
    const hook = window.__bitDeskSetChartVisible;
    if (typeof hook !== "function") return;
    hook(!document.hidden);
  });
  tickClock();
  setInterval(tickClock, 1000);
}

init();
