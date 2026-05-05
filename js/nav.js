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
  NAV.forEach((grp, gi) => {
    const group = el("div", { class: "nav-group", "data-gi": gi, "data-group": grp.group });
    if (saved[grp.group] === true) group.classList.add("collapsed");
    const head = el("button", { class: "nav-group-head",
      onclick: () => {
        group.classList.toggle("collapsed");
        saveNavGroupCollapsed(grp.group, group.classList.contains("collapsed"));
      }
    });
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
      const href = `#/${item.id}`;
      const a = el("a", { class: "nav-item" + (item.agentId ? " agent" : ""), href, "data-id": item.id });
      if (item.agentId) {
        const agent = AGENT_MAP[item.agentId];
        a.innerHTML = `
          <span class="agent-dot" style="background:${agent.color}">${agent.short}</span>
          <span>${item.label}</span>
          ${item.badge ? `<span class="badge">${item.badge}</span>` : ""}
        `;
      } else {
        a.innerHTML = `
          <i class="ph ${item.icon || "ph-circle"} icon"></i>
          <span>${item.label}</span>
          ${item.badge ? `<span class="badge">${item.badge}</span>` : ""}
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
