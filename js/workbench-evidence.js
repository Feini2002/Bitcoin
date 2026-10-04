// 四页工作台证据：只保存已经提交到视图的事实。不发请求，不写云端。
const WORKBENCH_EVIDENCE_SCHEMA = "workbench-evidence.2026-09-27.1";
const WORKBENCH_EVIDENCE_METHOD = "workbench-evidence.2026-09-27.1";
const WORKBENCH_EVIDENCE_SLOTS = ["chart", "orderflow", "heatmap", "derivatives"];
const WORKBENCH_EVIDENCE_LIMITS = { chart: 6000, orderflow: 240 };
const WORKBENCH_EVIDENCE_DROP = ["tradingNarrative", "signal", "recommendation", "pressureScore", "score"];

function workbenchEvidenceGuard(sourceId) {
  if (typeof BitContracts !== "undefined" && typeof BitContracts.exportPurposeGuard === "function") {
    return BitContracts.exportPurposeGuard(sourceId, "localDisplayedDownload");
  }
  return { status: "unknown", allowed: false, reason: "guard_missing", sourceId: sourceId || null };
}

function workbenchEvidenceClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function workbenchEvidenceStable(value) {
  if (Array.isArray(value)) return value.map(workbenchEvidenceStable);
  if (value && typeof value === "object") {
    const out = {};
    Object.keys(value).sort().forEach((key) => { out[key] = workbenchEvidenceStable(value[key]); });
    return out;
  }
  return value;
}

function workbenchEvidenceEmptySlot() {
  return { access: "not_visited" };
}

const workbenchEvidenceState = {
  slots: Object.fromEntries(WORKBENCH_EVIDENCE_SLOTS.map((slot) => [slot, workbenchEvidenceEmptySlot()])),
};

function workbenchEvidenceLimitRows(slot, view) {
  const next = workbenchEvidenceClone(view);
  const cap = WORKBENCH_EVIDENCE_LIMITS[slot];
  if (slot === "chart" && Array.isArray(next.series) && next.series.length > cap) {
    next.series = next.series.slice(-cap);
    next.truncatedToLimit = cap;
  }
  if (slot === "orderflow" && Array.isArray(next.bars) && next.bars.length > cap) {
    next.bars = next.bars.slice(-cap);
    next.truncatedToLimit = cap;
  }
  return next;
}

function workbenchEvidenceSanitize(view, withheld) {
  if (Array.isArray(view.series)) {
    view.series = view.series.map((bar) => {
      const itemSource = (bar && bar.sourceId) || view.sourceId;
      const item = workbenchEvidenceGuard(itemSource);
      if (bar && bar.sourceVerification === "verified" && item.allowed === true) return bar;
      withheld.push("series:" + (bar && bar.t));
      return {
        t: bar && bar.t,
        sourceVerification: (bar && bar.sourceVerification) || "unverified",
        origin: (bar && bar.origin) || null,
        withheld: true,
      };
    });
  }
  if (Array.isArray(view.cards)) {
    view.cards = view.cards.map((card) => {
      const item = workbenchEvidenceGuard((card && card.sourceId) || view.sourceId);
      if (item.allowed === true) return card;
      withheld.push("card:" + ((card && (card.id || card.sourceId)) || "unknown"));
      const copy = Object.assign({}, card);
      delete copy.values;
      delete copy.value;
      copy.withheld = true;
      return copy;
    });
  }
  if (Array.isArray(view.buckets)) {
    view.buckets = view.buckets.map((bucket) => {
      const item = workbenchEvidenceGuard((bucket && bucket.sourceId) || view.sourceId);
      if (item.allowed === true) return bucket;
      withheld.push("bucket:" + ((bucket && bucket.exchange) || "unknown"));
      return { exchange: bucket && bucket.exchange || null, withheld: true };
    });
  }
}

function workbenchEvidenceApplyGuard(view) {
  const sourceId = view && view.sourceId ? String(view.sourceId) : "";
  const decision = workbenchEvidenceGuard(sourceId);
  const withheld = [];
  WORKBENCH_EVIDENCE_DROP.forEach((key) => {
    if (view && Object.prototype.hasOwnProperty.call(view, key)) {
      withheld.push(key);
      delete view[key];
    }
  });
  if (decision.allowed === true || !sourceId) {
    workbenchEvidenceSanitize(view, withheld);
    view.exportPurpose = {
      sourceId: sourceId || null,
      purpose: "localDisplayedDownload",
      status: sourceId ? decision.status : "itemized",
      allowed: sourceId ? true : null,
    };
    if (withheld.length) view.withheldFields = withheld;
    return view;
  }
  const kept = {
    access: view.access,
    displayedAt: view.displayedAt || null,
    readAt: view.readAt || null,
    asOf: view.asOf || null,
    parameters: view.parameters || null,
    contentRevision: view.contentRevision || null,
    historyRevision: view.historyRevision ?? null,
    sourceId: sourceId || null,
    sourceVerification: view.sourceVerification || null,
    window: view.window || null,
    gaps: view.gaps || null,
    clocks: view.clocks || null,
    units: view.units || null,
    failure: view.failure || null,
    stale: view.stale === true,
    limitations: view.limitations || null,
  };
  ["series", "bars", "buckets", "cards", "values", "close", "open", "high", "low", "volume"].forEach((key) => {
    if (view && Object.prototype.hasOwnProperty.call(view, key)) withheld.push(key);
  });
  kept.withheldFields = withheld;
  kept.exportPurpose = {
    sourceId: sourceId || null,
    purpose: "localDisplayedDownload",
    status: decision.status || "unknown",
    allowed: false,
    reason: decision.reason || decision.status || "not_allowed",
  };
  kept.limitation = "该来源未获用户本地下载授权，仅保留元数据、缺口和限制，不导出数值。";
  return kept;
}

const WorkbenchEvidence = {
  schema: WORKBENCH_EVIDENCE_SCHEMA,
  methodVersion: WORKBENCH_EVIDENCE_METHOD,
  reset() {
    WORKBENCH_EVIDENCE_SLOTS.forEach((slot) => { workbenchEvidenceState.slots[slot] = workbenchEvidenceEmptySlot(); });
  },
  commitDisplayed(slot, view) {
    if (!WORKBENCH_EVIDENCE_SLOTS.includes(slot)) throw new Error("unknown_evidence_slot");
    const next = workbenchEvidenceLimitRows(slot, view || {});
    next.access = "displayed";
    workbenchEvidenceState.slots[slot] = workbenchEvidenceApplyGuard(next);
    return workbenchEvidenceClone(workbenchEvidenceState.slots[slot]);
  },
  commitFailure(slot, failure) {
    if (!WORKBENCH_EVIDENCE_SLOTS.includes(slot)) throw new Error("unknown_evidence_slot");
    const current = workbenchEvidenceState.slots[slot];
    const fail = { at: failure && failure.at ? failure.at : null, message: failure && failure.message ? String(failure.message) : "read_failed" };
    if (current && current.access === "displayed") {
      const kept = workbenchEvidenceClone(current);
      kept.failure = fail;
      kept.stale = true;
      workbenchEvidenceState.slots[slot] = kept;
      return workbenchEvidenceClone(kept);
    }
    workbenchEvidenceState.slots[slot] = { access: "unavailable", failure: fail, stale: false };
    return workbenchEvidenceClone(workbenchEvidenceState.slots[slot]);
  },
  capture(generatedAt) {
    return {
      schema: WORKBENCH_EVIDENCE_SCHEMA,
      generatedAt: generatedAt || null,
      methodVersion: WORKBENCH_EVIDENCE_METHOD,
      atomicSnapshot: false,
      captureNote: "generatedAt/displayedAt 采用浏览器本机时钟；asOf/readAt 保留资料接口声明时钟，两者未核验同步，不能仅按先后排序判断未来数据。各页读取彼此独立，这不是一次数据库原子快照。",
      pages: workbenchEvidenceClone(workbenchEvidenceState.slots),
    };
  },
  serialize(snapshot) {
    return JSON.stringify(workbenchEvidenceStable(snapshot));
  },
  download(generatedAt) {
    const snapshot = this.capture(generatedAt || new Date().toISOString());
    if (typeof document === "undefined" || typeof URL === "undefined") return snapshot;
    const link = document.createElement("a");
    const url = URL.createObjectURL(new Blob([this.serialize(snapshot)], { type: "application/json" }));
    link.href = url;
    link.download = "workbench-evidence.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return snapshot;
  },
};

if (typeof document !== "undefined") {
  document.addEventListener("click", (event) => {
    const button = event.target && event.target.closest ? event.target.closest("[data-workbench-export]") : null;
    if (!button) return;
    event.preventDefault();
    WorkbenchEvidence.download();
  });
}
