/* =======================================================
   Sidebar 构建（分组折叠状态持久化到 localStorage）
   ======================================================= */
const NAV_GROUP_STATE_KEY = "bit-platform-nav-groups";
const WORKSPACE_NAV = [
  {group:"阅读与探索",items:[
    {id:"boardroom",label:"首席日报",icon:"ph-newspaper"},
    {id:"domains",label:"深度解读",icon:"ph-book-open"},
    {id:"market",label:"市场",icon:"ph-chart-line"},
    {id:"records",label:"往期",icon:"ph-calendar-blank"},
  ]},
  {group:"偏好",items:[{id:"settings",label:"设置",icon:"ph-gear"}]},
];

function loadNavGroupState() {
  try {
    const raw = localStorage.getItem(NAV_GROUP_STATE_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

function saveNavGroupCollapsed(groupLabel, collapsed) {
  try {
    const st = loadNavGroupState();
    st[groupLabel] = collapsed;
    localStorage.setItem(NAV_GROUP_STATE_KEY, JSON.stringify(st));
  } catch {}
}

function buildSidebar() {
  const nav = $("#nav");
  nav.innerHTML = "";
  const saved = loadNavGroupState();
  const groups = WORKSPACE_NAV;
  groups.forEach((grp, gi) => {
    const group = el("div", { class: "nav-group", "data-gi": gi, "data-group": grp.group });
    const collapsed = false;
    if (collapsed) group.classList.add("collapsed");
    const head = el("button", { class: "nav-group-head",
      onclick: () => {
        group.classList.toggle("collapsed");
        head.setAttribute("aria-expanded", String(!group.classList.contains("collapsed")));
        saveNavGroupCollapsed(grp.group, group.classList.contains("collapsed"));
      }
    });
    head.setAttribute("aria-expanded", String(!collapsed));
    head.innerHTML = `
      <span class="grp-title">
        <span>${grp.group}</span>
        ${grp.sub ? `<span class="grp-sub">· ${grp.sub}</span>` : ""}
      </span>
      <span class="chev">▾</span>
    `;
    group.appendChild(head);

    const list = el("div", { class: "nav-list" });
    grp.items.forEach(item => {
      const badge = ["demo", "planned"].includes(FEATURE_STATE_BY_ROUTE[item.id]) ? featureInfo(item.id).label : "";
      const href = `#/${item.id}`;
      const a = el("a", { class: "nav-item" + (item.agentId ? " agent" : ""), href, "data-id": item.id });
      if (item.agentId) {
        const agent = AGENT_MAP[item.agentId];
        a.innerHTML = `
          <span class="agent-dot" style="background:${agent.color}">${agent.short}</span>
          <span>${item.label}</span>
          ${badge ? `<span class="badge">${badge}</span>` : ""}
        `;
      } else {
        a.innerHTML = `
          <i class="ph ${item.icon || "ph-circle"} icon"></i>
          <span>${item.label}</span>
          ${badge ? `<span class="badge">${badge}</span>` : ""}
        `;
      }
      list.appendChild(a);
    });
    group.appendChild(list);
    nav.appendChild(group);
  });
}

/* =======================================================
   面包屑 / 页签高亮
   ======================================================= */
function setBreadcrumb(crumbs) {
  const bc = $("#breadcrumb");
  bc.innerHTML = crumbs.map((c, i) =>
    `<span class="${i === crumbs.length - 1 ? "crumb-current" : "crumb"}">${c}</span>${i < crumbs.length - 1 ? '<span class="sep">/</span>' : ""}`
  ).join("");
}

function highlightNav(id) {
  id = ["chart","orderflow","heatmap","derivatives","news","events"].includes(id) ? "market" : ['agent-env','agent-flow','agent-deriv','agent-macro','agent-events'].includes(id) ? 'domains' : ["boardroom","research","agent-chief","overview"].includes(id) ? "boardroom" : id==='research-window' ? (globalThis.UserWorkspace?.query().get('runId')||globalThis.UserWorkspace?.query().get('taskId')?'records':'boardroom') : ['team-record','news-analysis','archive'].includes(id) ? "records" : id;
  $$(".nav-item").forEach(n => {const active=n.getAttribute("data-id") === id;n.classList.toggle("active",active);if(active)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');});
}

function findNavInfo(id) {
  for (const g of [...WORKSPACE_NAV,...NAV]) for (const it of g.items) if (it.id === id) return { group: g.group, item: it };
  return null;
}

function initMobileNavigation() {
  const toggle = document.getElementById("mobile-nav-toggle");
  const sidebar = document.getElementById("primary-sidebar");
  const setOpen = open => {
    sidebar.classList.toggle("mobile-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true"));
  sidebar.addEventListener("click", event => {
    if (event.target.closest("a[href]")) setOpen(false);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
      setOpen(false);
      toggle.focus();
    }
  });
}
