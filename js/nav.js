/* =======================================================
   Sidebar 构建（分组折叠状态持久化到 localStorage）
   ======================================================= */
const NAV_GROUP_STATE_KEY = "bit-platform-nav-groups";

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
  const activeGroups = NAV.map(group => ({ ...group, items: group.items.filter(item => !["demo", "planned"].includes(FEATURE_STATE_BY_ROUTE[item.id])) })).filter(group => group.items.length);
  const previewItems = FEATURES.filter(item => ["demo", "planned"].includes(item.state));
  const groups = [...activeGroups, { group: "规划与演示", sub: "保留原型", items: previewItems }];
  groups.forEach((grp, gi) => {
    const group = el("div", { class: "nav-group", "data-gi": gi, "data-group": grp.group });
    const collapsed = saved[grp.group] == null ? grp.group === "规划与演示" : saved[grp.group];
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
  $$(".nav-item").forEach(n => n.classList.toggle("active", n.getAttribute("data-id") === id));
}

function findNavInfo(id) {
  for (const g of NAV) for (const it of g.items) if (it.id === id) return { group: g.group, item: it };
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
