/* =======================================================
   工具函数
   ======================================================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "style") node.style.cssText = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
};
const html = (strings, ...values) => String.raw({ raw: strings }, ...values);

/** 稳定伪随机（基于种子），用来让同一页图表每次渲染一致 */
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let __yuqingDeleteModalResolve = null;

function __closeYuqingArchiveDeleteModal(result) {
  const root = document.getElementById("yuqing-archive-delete-modal");
  const fn = __yuqingDeleteModalResolve;
  __yuqingDeleteModalResolve = null;
  if (root) {
    root.hidden = true;
    root.setAttribute("aria-hidden", "true");
  }
  if (typeof fn === "function") fn(!!result);
}

function __onYuqingArchiveDeleteEscape(ev) {
  if (ev.key !== "Escape" || __yuqingDeleteModalResolve == null) return;
  ev.preventDefault();
  __closeYuqingArchiveDeleteModal(false);
}

function __ensureYuqingArchiveDeleteModal() {
  let root = document.getElementById("yuqing-archive-delete-modal");
  if (root) return root;
  root = document.createElement("div");
  root.id = "yuqing-archive-delete-modal";
  root.className = "yuqing-delete-modal-root";
  root.setAttribute("role", "alertdialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "yuqing-archive-delete-title");
  root.setAttribute("aria-describedby", "yuqing-archive-delete-detail");
  root.hidden = true;
  root.innerHTML = `
<div class="yuqing-delete-modal-backdrop" tabindex="-1" aria-hidden="true"></div>
<div class="yuqing-delete-modal-sheet">
  <span class="yuqing-delete-modal-kicker">不可逆</span>
  <h2 class="yuqing-delete-modal-title" id="yuqing-archive-delete-title"></h2>
  <p class="yuqing-delete-modal-detail" id="yuqing-archive-delete-detail"></p>
  <div class="yuqing-delete-modal-actions">
    <button type="button" class="btn yuqing-delete-modal-cancel">取消</button>
    <button type="button" class="btn danger yuqing-delete-modal-ok">删除</button>
  </div>
</div>`;
  const backdrop = root.querySelector(".yuqing-delete-modal-backdrop");
  const cancel = root.querySelector(".yuqing-delete-modal-cancel");
  const ok = root.querySelector(".yuqing-delete-modal-ok");
  const sheet = root.querySelector(".yuqing-delete-modal-sheet");
  backdrop.addEventListener("click", () => __closeYuqingArchiveDeleteModal(false));
  cancel.addEventListener("click", () => __closeYuqingArchiveDeleteModal(false));
  ok.addEventListener("click", () => __closeYuqingArchiveDeleteModal(true));
  sheet.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("keydown", __onYuqingArchiveDeleteEscape);
  document.body.appendChild(root);
  return root;
}

/**
 * 删除 D1 回档前的全屏虚化确认框（替代 window.confirm）。
 * @param {{ title?: string, detail?: string }} [options]
 * @returns {Promise<boolean>}
 */
function confirmYuqingArchiveDelete(options) {
  const title =
    options && options.title != null && String(options.title).trim()
      ? String(options.title).trim()
      : "删除此条回档";
  const detail =
    options && options.detail != null && String(options.detail).trim()
      ? String(options.detail).trim()
      : "确定删除此条回档？云端 D1 中的对应记录将一并删除且不可恢复。";

  return new Promise((resolve) => {
    if (__yuqingDeleteModalResolve) {
      __closeYuqingArchiveDeleteModal(false);
    }
    const root = __ensureYuqingArchiveDeleteModal();
    const titleEl = root.querySelector(".yuqing-delete-modal-title");
    const detailEl = root.querySelector(".yuqing-delete-modal-detail");
    if (titleEl) titleEl.textContent = title;
    if (detailEl) detailEl.textContent = detail;
    __yuqingDeleteModalResolve = resolve;
    root.hidden = false;
    root.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => {
      const cancel = root.querySelector(".yuqing-delete-modal-cancel");
      if (cancel) cancel.focus();
    });
  });
}
