/* =======================================================
   数据引擎 Data Engine
   仅负责调用云�?Worker + D1 �?K 线接口�?   不再使用浏览�?IndexedDB：历史数据存�?Cloudflare D1�?   实时 K 线跳动由 chart.js �?Binance kline WebSocket 负责；主图标题：aggTrade/现货线路 WS + 币安 REST 轮询兜底（均�?D1/K 线序列）�?   ======================================================= */

const DataEngine = {
  SUPPORTED_INTERVALS: ["5m", "15m", "1h", "4h", "1d", "3d", "1w"],

  /** Worker 基址：固定使用已部署 Cloudflare Worker�?*/
  apiBase() {
    if (typeof getBitDataApiBase === "function") {
      return getBitDataApiBase();
    }
    if (typeof window !== "undefined" && window.BIT_DATA_API_BASE) {
      return String(window.BIT_DATA_API_BASE).replace(/\/$/, "");
    }
    return "https://btc.feiniwork.com";
  },

  /** Cloudflare「舆情日报」Worker �?URL（独立于 btc.feiniwork.com）�?*/
  yuqingApiBase() {
    if (typeof getYuqingApiBase === "function") {
      return String(getYuqingApiBase()).replace(/\/$/, "");
    }
    if (typeof window !== "undefined" && window.BIT_YUQING_API_BASE) {
      return String(window.BIT_YUQING_API_BASE).replace(/\/$/, "");
    }
    return "https://yuqing.feiniwork.com";
  },

  attachAbort(parentSignal, ctrl) {
    if (!parentSignal || !ctrl || typeof parentSignal.addEventListener !== "function") return () => {};
    if (parentSignal.aborted) {
      ctrl.abort();
      return () => {};
    }
    const onAbort = () => ctrl.abort();
    parentSignal.addEventListener("abort", onAbort);
    return () => parentSignal.removeEventListener("abort", onAbort);
  },

  workerFetch(url, init = {}) {
    return fetch(url, {
      credentials: "include",
      ...(init || {}),
    });
  },

  async parseWorkerJsonResponse(res, label = "Worker") {
    const text = await res.text().catch(() => "");
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = null;
      }
    }
    if (!res.ok) {
      const detail = data && (data.error || data.message)
        ? String(data.error || data.message)
        : text.slice(0, 240);
      throw new Error(`${label} ${res.status}${detail ? ": " + detail : ""}`);
    }
    if (!data || typeof data !== "object") {
      throw new Error(`${label} 返回格式错误：不�?JSON 对象`);
    }
    return data;
  },

  /** @param {{ signal?: AbortSignal }} opts */
  async fetchYuqingHealth(opts = {}) {
    const url = `${this.yuqingApiBase()}/api/yuqing/health`;
    const res = await this.workerFetch(url, { cache: "no-store", signal: opts.signal });
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 220);
      } catch (_) {}
      throw new Error(`舆情 Worker health ${res.status}${detail ? ": " + detail : ""}`);
    }
    return res.json();
  },

  /** @param {{ signal?: AbortSignal }} opts */
  async fetchYuqingSources(opts = {}) {
    const url = `${this.yuqingApiBase()}/api/yuqing/sources`;
    const ctrl = new AbortController();
    const unsub = this.attachAbort(opts.signal, ctrl);
    const t = setTimeout(() => ctrl.abort(), 30_000);
    let res;
    try {
      res = await this.workerFetch(url, { cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      const m = e && e.name === "AbortError" ? "请求超时或已取消" : e && e.message ? e.message : String(e);
      throw new Error(`无法访问舆情数据�?${url}�?{m}`);
    } finally {
      clearTimeout(t);
      unsub();
    }
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 240);
      } catch (_) {}
      throw new Error(`舆情数据源接�?${res.status}${detail ? ": " + detail : ""}`);
    }
    return res.json();
  },

  async fetchYuqingLatest(opts = {}) {
    const url = `${this.yuqingApiBase()}/api/yuqing/latest`;
    const ctrl = new AbortController();
    const unsub = this.attachAbort(opts.signal, ctrl);
    const t = setTimeout(() => ctrl.abort(), 30_000);
    let res;
    try {
      res = await this.workerFetch(url, { cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      clearTimeout(t);
      unsub();
      const m = e && e.name === "AbortError" ? "请求超时或已取消" : e && e.message ? e.message : String(e);
      throw new Error(`无法访问舆情 latest ${url}�?{m}`);
    } finally {
      clearTimeout(t);
      unsub();
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const hint = data && (data.error || data.message);
      throw new Error(`舆情 latest ${res.status}${hint ? `: ${hint}` : ""}`);
    }
    return data;
  },

  /**
   * @param {{ category?: string, limit?: number, signal?: AbortSignal }} opts
   */
  async fetchYuqingItems(opts = {}) {
    const q = new URLSearchParams();
    if (opts.category) q.set("category", String(opts.category));
    if (opts.limit != null) q.set("limit", String(opts.limit));
    const url = `${this.yuqingApiBase()}/api/yuqing/items?${q.toString()}`;
    const ctrl = new AbortController();
    const unsub = this.attachAbort(opts.signal, ctrl);
    const t = setTimeout(() => ctrl.abort(), 30_000);
    let res;
    try {
      res = await this.workerFetch(url, { cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      clearTimeout(t);
      unsub();
      const m = e && e.name === "AbortError" ? "请求超时或已取消" : e && e.message ? e.message : String(e);
      throw new Error(`无法访问舆情 items�?{m}`);
    } finally {
      clearTimeout(t);
      unsub();
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const hint = data && (data.error || data.message);
      throw new Error(`舆情 items ${res.status}${hint ? `: ${hint}` : ""}`);
    }
    return data;
  },

  /**
   * @param {number} days
   * @param {{ signal?: AbortSignal }} opts
   */
  async fetchYuqingHistory(days = 7, opts = {}) {
    const q = new URLSearchParams({ days: String(days) });
    const url = `${this.yuqingApiBase()}/api/yuqing/history?${q.toString()}`;
    const ctrl = new AbortController();
    const unsub = this.attachAbort(opts.signal, ctrl);
    const t = setTimeout(() => ctrl.abort(), 20_000);
    let res;
    try {
      res = await this.workerFetch(url, { cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      clearTimeout(t);
      unsub();
      const m = e && e.name === "AbortError" ? "请求超时或已取消" : e && e.message ? e.message : String(e);
      throw new Error(`无法访问舆情 history�?{m}`);
    } finally {
      clearTimeout(t);
      unsub();
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const hint = data && (data.error || data.message);
      throw new Error(`舆情 history ${res.status}${hint ? `: ${hint}` : ""}`);
    }
    return data;
  },

  async fetchYuqingReportLatest(kind = "sentiment_analysis", opts = {}) {
    const q = new URLSearchParams({ kind: String(kind || "sentiment_analysis") });
    const url = `${this.yuqingApiBase()}/api/yuqing/reports/latest?${q.toString()}`;
    const ctrl = new AbortController();
    const unsub = this.attachAbort(opts.signal, ctrl);
    const t = setTimeout(() => ctrl.abort(), Math.min(30_000, Math.max(5_000, Number(opts.timeoutMs) || 15_000)));
    let res;
    try {
      res = await this.workerFetch(url, { cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      const m = e && e.name === "AbortError" ? "请求超时或已取消" : e && e.message ? e.message : String(e);
      throw new Error(`无法读取最新研究报告：${m}`);
    } finally {
      clearTimeout(t);
      unsub();
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const hint = data && (data.error || data.message);
      throw new Error(`舆情报告 latest ${res.status}${hint ? `: ${hint}` : ""}`);
    }
    return data;
  },

  async fetchYuqingReportHistory(kind = "sentiment_analysis", days = 7, opts = {}) {
    const q = new URLSearchParams({ kind: String(kind || "sentiment_analysis"), days: String(days || 7) });
    const url = `${this.yuqingApiBase()}/api/yuqing/reports/history?${q.toString()}`;
    const ctrl = new AbortController();
    const unsub = this.attachAbort(opts.signal, ctrl);
    const t = setTimeout(() => ctrl.abort(), Math.min(30_000, Math.max(5_000, Number(opts.timeoutMs) || 15_000)));
    let res;
    try {
      res = await this.workerFetch(url, { cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      const m = e && e.name === "AbortError" ? "请求超时或已取消" : e && e.message ? e.message : String(e);
      throw new Error(`无法读取研究报告历史：${m}`);
    } finally {
      clearTimeout(t);
      unsub();
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const hint = data && (data.error || data.message);
      throw new Error(`舆情报告 history ${res.status}${hint ? `: ${hint}` : ""}`);
    }
    return data;
  },

  async fetchYuqingReportItem(id, opts = {}) {
    const q = new URLSearchParams({ id: String(id || "") });
    const url = `${this.yuqingApiBase()}/api/yuqing/reports/item?${q.toString()}`;
    const ctrl = new AbortController();
    const unsub = this.attachAbort(opts.signal, ctrl);
    const t = setTimeout(() => ctrl.abort(), Math.min(30_000, Math.max(5_000, Number(opts.timeoutMs) || 15_000)));
    let res;
    try {
      res = await this.workerFetch(url, { cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      const m = e && e.name === "AbortError" ? "请求超时或已取消" : e && e.message ? e.message : String(e);
      throw new Error(`无法读取指定研究报告：${m}`);
    } finally {
      clearTimeout(t);
      unsub();
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const hint = data && (data.error || data.message);
      throw new Error(`舆情报告 item ${res.status}${hint ? `: ${hint}` : ""}`);
    }
    return data;
  },

  async deleteYuqingReportItem(id, opts = {}) {
    const q = new URLSearchParams({ id: String(id || "").trim() });
    const url = `${this.yuqingApiBase()}/api/yuqing/reports/item?${q.toString()}`;
    const ctrl = new AbortController();
    const unsub = this.attachAbort(opts.signal, ctrl);
    const t = setTimeout(() => ctrl.abort(), Math.min(25_000, Math.max(5_000, Number(opts.timeoutMs) || 15_000)));
    let res;
    try {
      res = await this.workerFetch(url, { method: "DELETE", cache: "no-store", signal: ctrl.signal, headers: { Accept: "application/json" } });
    } catch (e) {
      const m = e && e.name === "AbortError" ? "请求超时或已取消" : e && e.message ? e.message : String(e);
      throw new Error(`无法删除舆情报告�?{m}`);
    } finally {
      clearTimeout(t);
      unsub();
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const hint = data && (data.error || data.message);
      throw new Error(`舆情报告删除 ${res.status}${hint ? `: ${hint}` : ""}`);
    }
    return data;
  },

  async fetchYuqingEventDashboardSettings(opts = {}) {
    const url = `${this.yuqingApiBase()}/api/yuqing/settings/event-dashboard`;
    const ctrl = new AbortController();
    const unsub = this.attachAbort(opts.signal, ctrl);
    let res;
    try {
      res = await this.workerFetch(url, { cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      unsub();
      throw new Error(`获取舆情设置失败�?{url}）：${e.message || String(e)}`);
    }
    unsub();
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const hint = data && (data.error || data.message);
      throw new Error(`获取舆情设置接口 ${res.status}${hint ? `: ${hint}` : ""}`);
    }
    return data;
  },

  async updateYuqingEventDashboardSettings(settings, opts = {}) {
    const url = `${this.yuqingApiBase()}/api/yuqing/settings/event-dashboard`;
    const ctrl = new AbortController();
    const unsub = this.attachAbort(opts.signal, ctrl);
    let res;
    try {
      res = await this.workerFetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: ctrl.signal,
        body: JSON.stringify(settings)
      });
    } catch (e) {
      unsub();
      throw new Error(`更新舆情设置失败�?{url}）：${e.message || String(e)}`);
    }
    unsub();
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const hint = data && (data.error || data.message);
      throw new Error(`更新舆情设置接口 ${res.status}${hint ? `: ${hint}` : ""}`);
    }
    return data;
  },

  async fetchYuqingSentimentAnalysisSettings(opts = {}) {
    const url = `${this.yuqingApiBase()}/api/yuqing/settings/sentiment-analysis`;
    const ctrl = new AbortController();
    const unsub = this.attachAbort(opts.signal, ctrl);
    let res;
    try {
      res = await this.workerFetch(url, { cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      unsub();
      throw new Error(`获取舆情分析设置失败�?{url}）：${e.message || String(e)}`);
    }
    unsub();
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const hint = data && (data.error || data.message);
      throw new Error(`获取舆情分析设置接口 ${res.status}${hint ? `: ${hint}` : ""}`);
    }
    return data;
  },

  async updateYuqingSentimentAnalysisSettings(settings, opts = {}) {
    const url = `${this.yuqingApiBase()}/api/yuqing/settings/sentiment-analysis`;
    const ctrl = new AbortController();
    const unsub = this.attachAbort(opts.signal, ctrl);
    let res;
    try {
      res = await this.workerFetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        cache: "no-store",
        signal: ctrl.signal,
        body: JSON.stringify(settings && typeof settings === "object" ? settings : {}),
      });
    } catch (e) {
      unsub();
      throw new Error(`保存舆情分析设置失败�?{url}）：${e.message || String(e)}`);
    }
    unsub();
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const hint = data && (data.error || data.message);
      throw new Error(`保存舆情分析设置接口 ${res.status}${hint ? `: ${hint}` : ""}`);
    }
    return data;
  },

  async fetchYuqingReportStatus(opts = {}) {
    const [health, daily, analysis] = await Promise.allSettled([
      this.fetchYuqingHealth(opts),
      this.fetchYuqingReportLatest("daily_event", opts),
      this.fetchYuqingReportLatest("sentiment_analysis", opts),
    ]);
    return {
      health: health.status === "fulfilled" ? health.value : null,
      daily: daily.status === "fulfilled" ? daily.value : null,
      analysis: analysis.status === "fulfilled" ? analysis.value : null,
      errors: [health, daily, analysis]
        .filter((x) => x.status === "rejected")
        .map((x) => String(x.reason && x.reason.message ? x.reason.message : x.reason)),
    };
  },

  yuqingPreviewReportKey(kind = "analysis") {
    const safe = String(kind || "analysis").replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "analysis";
    return `bitdesk.yuqing.${safe}.preview.report`;
  },

  yuqingPreviewStatusKey(kind = "analysis") {
    const safe = String(kind || "analysis").replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "analysis";
    return `bitdesk.yuqing.${safe}.preview.status`;
  },

  readYuqingPreviewReportId(kind = "analysis", fallbackId = "") {
    try {
      return localStorage.getItem(this.yuqingPreviewReportKey(kind)) || fallbackId || "";
    } catch (_) {
      return fallbackId || "";
    }
  },

  writeYuqingPreviewReportId(kind = "analysis", reportId = "") {
    const id = String(reportId || "").trim();
    try {
      if (id) localStorage.setItem(this.yuqingPreviewReportKey(kind), id);
      else localStorage.removeItem(this.yuqingPreviewReportKey(kind));
    } catch (_) {}
    return id;
  },

  readYuqingPreviewStatus(kind = "analysis", fallbackText = "") {
    try {
      return localStorage.getItem(this.yuqingPreviewStatusKey(kind)) || fallbackText || "";
    } catch (_) {
      return fallbackText || "";
    }
  },

  writeYuqingPreviewStatus(kind = "analysis", text = "") {
    const value = String(text || "");
    try {
      if (value) localStorage.setItem(this.yuqingPreviewStatusKey(kind), value);
      else localStorage.removeItem(this.yuqingPreviewStatusKey(kind));
    } catch (_) {}
    return value;
  },

  /**
   * �?Worker /api/d1/klines 读取云端存储�?K 线（已按升序、最�?6000 根）�?   * 返回 [{t,o,h,l,c,v}, ...]
   */
  async fetchKlinesFromD1(symbol, interval, limit = 6000, opts = {}) {
    const q = new URLSearchParams({ symbol, interval, limit: String(limit) });
    if (opts.sync != null && String(opts.sync) !== "") q.set("sync", String(opts.sync));
    const url = this.apiBase() + '/api/d1/klines?' + q;
    const ctrl = new AbortController();
    const unsub = this.attachAbort(opts.signal, ctrl);
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await this.workerFetch(url, { cache: opts.cache || "default", signal: ctrl.signal });
      const data = await this.parseWorkerJsonResponse(res, "D1 K 线接口");
      if (!Array.isArray(data.klines)) throw new Error("D1 K 线返回格式错误：缺少 klines 数组");
      if (ctrl.signal.aborted) throw new DOMException("K 线请求已取消", "AbortError");
      const rows = data.klines.map(row => ({
        t: Number(row.t), o: parseFloat(row.o), h: parseFloat(row.h),
        l: parseFloat(row.l), c: parseFloat(row.c), v: parseFloat(row.v),
      }));
      if (rows.some(row => !Object.values(row).every(Number.isFinite))) throw new Error("D1 K 线包含无效数值");
      // 元数据交给本次请求的消费者，避免多周期面板覆盖主图状态。
      if (typeof opts.onMetadata === "function") {
        const latestT = Number(data.latestT || (rows.length ? rows[rows.length - 1].t : 0));
        opts.onMetadata({
          symbol, interval, count: rows.length, latestT,
          lastSync: data.lastSync || null,
          source: res.headers.get("X-Data-Source") === "cloudflare-d1" ? "d1" : "unknown",
          backend: new URL(this.apiBase()).host,
          receivedAt: Date.now(),
        });
      }
      return rows;
    } catch (error) {
      if (opts.signal && opts.signal.aborted) throw new DOMException("K 线请求已取消", "AbortError");
      if (ctrl.signal.aborted) throw new Error("D1 K 线请求超时（30 秒）");
      throw error;
    } finally {
      clearTimeout(timer);
      unsub();
    }
  },

  /**
   * 设置�?运维入口：触发已部署 Worker 手动同步 K 线到其绑定的 Cloudflare D1�?   * 设置页用于全周期运维同步；图表页只在当前周期落后或手动按钮触发时调用当前周期同步�?   */
  async triggerCloudSync(symbol, interval = "all", wait = true, opts = {}) {
    if (wait && typeof wait === "object") {
      opts = wait;
      wait = opts.wait !== false;
    }
    const q = new URLSearchParams({ symbol, interval, wait: wait ? "1" : "0" });
    const url = `${this.apiBase()}/api/d1/sync?${q.toString()}`;
    const ctrl = new AbortController();
    const unsub = this.attachAbort(opts.signal, ctrl);
    const timeoutMs = Math.min(
      wait ? 180_000 : 45_000,
      Math.max(10_000, Number(opts.timeoutMs) || (wait ? 150_000 : 30_000)),
    );
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await this.workerFetch(url, { method: "POST", cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      const m = (e && e.name === "AbortError")
        ? `请求超时(${Math.round(timeoutMs / 1000)}s)`
        : (e && e.message ? e.message : String(e));
      throw new Error(
        `无法触发 D1 手动同步：浏览器连不上已部署 Worker (${this.apiBase()})。请检查网络、代理、CORS �?Worker 可用性。原错误: ${m}`
      );
    } finally {
      clearTimeout(t);
      unsub();
    }
    let data;
    try {
      data = await this.parseWorkerJsonResponse(res, "D1 手动同步");
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      let hint = "";
      if (/451|restricted|region|geo/i.test(msg)) hint = "upstream geo restriction; check Binance proxy or Bybit fallback";
      else if (/429/.test(msg)) hint = "upstream rate limited; retry later";
      else if (/502|503/.test(msg)) hint = "Worker reachable but upstream source or D1 write failed";
      throw new Error(`${msg}${hint ? `�?{hint}）` : ""}`);
    }
    return data;
  },

  /**
   * 查看已部�?Worker 绑定 D1 当前各周期的存储概况与最近同步结果�?   */
  async fetchCloudStatus(opts = {}) {
    const q = new URLSearchParams();
    if (opts && opts.detail != null && String(opts.detail) !== "") q.set("detail", String(opts.detail));
    const url = `${this.apiBase()}/api/d1/status${q.toString() ? "?" + q.toString() : ""}`;
    const ctrl = new AbortController();
    const unsub = this.attachAbort(opts.signal, ctrl);
    const timeoutMs = Math.min(60_000, Math.max(5_000, Number(opts.timeoutMs) || 20_000));
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await this.workerFetch(url, { cache: opts.cache || "default", signal: ctrl.signal });
    } catch (e) {
      const m = e && e.name === "AbortError"
        ? `请求超时(${Math.round(timeoutMs / 1000)}s)`
        : e && e.message ? e.message : String(e);
      throw new Error(`无法读取 D1 状态：浏览器连不上已部�?Worker (${url})。原错误: ${m}`);
    } finally {
      clearTimeout(t);
      unsub();
    }
    return this.parseWorkerJsonResponse(res, "D1 status");
  },

  /**
   * 分析路径只读 /api/desk/{scope}。失败即缺口，禁止回落 /api/d1。
   * scope: chart | orderflow | heatmap | context
   */
  _deskReads: new Map(),
  _deskArtifacts: new WeakMap(),
  _chartWindows: new Map(),
  _deskQueue: [],
  _deskActive: 0,
  _deskBackgroundActive: 0,

  // Two transports at most; tiles use only one, leaving room for the current
  // page. Queued work cancelled by a navigation never reaches the Worker/D1.
  drainDeskQueue() {
    while (this._deskActive < 2) {
      let index = this._deskQueue.findIndex(job => job.entry.priority !== 'background');
      if (index < 0 && !this._deskBackgroundActive) index = 0;
      if (index < 0 || !this._deskQueue.length) return;
      const job = this._deskQueue.splice(index, 1)[0];
      clearTimeout(job.timer);
      job.entry.ctrl.signal.removeEventListener('abort', job.abort);
      const background = job.entry.priority === 'background';
      this._deskActive++;
      if (background) this._deskBackgroundActive++;
      Promise.resolve().then(() => job.request(job.entry.ctrl.signal)).then(job.resolve, job.reject).finally(() => {
        this._deskActive--;
        if (background) this._deskBackgroundActive--;
        this.drainDeskQueue();
      });
    }
  },

  queueDeskRead(entry, request) {
    return new Promise((resolve, reject) => {
      const job = { entry, request, resolve, reject, abort: null, timer: null };
      const cancel = error => {
        clearTimeout(job.timer);
        entry.ctrl.signal.removeEventListener('abort', job.abort);
        const index = this._deskQueue.indexOf(job);
        if (index >= 0) this._deskQueue.splice(index, 1);
        reject(error);
      };
      job.abort = () => cancel(new DOMException('读取已取消', 'AbortError'));
      if (entry.ctrl.signal.aborted) { job.abort(); return; }
      entry.ctrl.signal.addEventListener('abort', job.abort, { once: true });
      job.timer = setTimeout(() => cancel(new Error('数据读取繁忙，请稍后重试')), 12_000);
      this._deskQueue.push(job);
      this.drainDeskQueue();
    });
  },

  peekChartWindow(symbol, interval) {
    const entry = this._chartWindows.get(`${this.apiBase()}|${symbol}|${interval}`);
    return entry && Date.now() - entry.at < 5 * 60_000 ? entry.data : null;
  },

  // Each consumer owns cancellation. Leaving a page only cancels the transport
  // when no main chart, tile or other reader still needs that exact response.
  shareDeskRead(url, signal, request, priority = 'foreground') {
    if (signal?.aborted) return Promise.reject(new DOMException('读取已取消', 'AbortError'));
    let entry = this._deskReads.get(url);
    if (!entry || entry.ctrl.signal.aborted) {
      const ctrl = new AbortController();
      entry = { ctrl, readers: 0, settled: false, priority };
      entry.promise = this.queueDeskRead(entry, request).finally(() => {
        entry.settled = true;
        if (this._deskReads.get(url) === entry) this._deskReads.delete(url);
      });
      this._deskReads.set(url, entry);
    } else if (priority !== 'background' && entry.priority === 'background') {
      // A queued tile may become the main chart after a period switch.
      entry.priority = 'foreground';
      this.drainDeskQueue();
    }
    entry.readers++;
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn, value) => {
        if (done) return;
        done = true;
        signal?.removeEventListener('abort', abort);
        entry.readers--;
        if (!entry.readers && !entry.settled) entry.ctrl.abort();
        fn(value);
      };
      const abort = () => finish(reject, new DOMException('读取已取消', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      entry.promise.then(data => finish(resolve, data), error => finish(reject, error));
    });
  },

  async requestDeskJson(url, signal) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl = new AbortController();
      const unsub = this.attachAbort(signal, ctrl);
      const timer = setTimeout(() => ctrl.abort(), 12_000);
      try {
        if (signal.aborted) throw new DOMException('读取已取消', 'AbortError');
        const res = await this.workerFetch(url, { cache: 'no-store', signal: ctrl.signal });
        if (!res.ok) {
          const error = new Error(`数据接口 HTTP ${res.status}`);
          error.status = res.status;
          // Cancel error bodies; a gateway HTML page must not be rendered as data.
          await res.body?.cancel();
          throw error;
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength > 4 * 1024 * 1024) throw new Error('desk 载荷超过读取上限');
        const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (!data || typeof data !== 'object' || !data.schemaVersion) throw new Error('desk 载荷缺少 schemaVersion');
        this._deskArtifacts.set(data, { bytes, url, receivedAt: new Date().toISOString(), status: res.status });
        return data;
      } catch (error) {
        if (signal.aborted) throw new DOMException('读取已取消', 'AbortError');
        const retryable = ctrl.signal.aborted || error instanceof TypeError || error instanceof SyntaxError
          || [429, 502, 503, 504].includes(error.status);
        if (!attempt && retryable) {
          // Bounded, abortable backoff: at most one transport retry per read.
          await new Promise((resolve, reject) => {
            const abort = () => { clearTimeout(wait); reject(new DOMException('读取已取消', 'AbortError')); };
            const wait = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 400);
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
          });
          continue;
        }
        if (ctrl.signal.aborted) throw new Error('数据读取超时，稍后可重试');
        throw error;
      } finally {
        clearTimeout(timer);
        unsub();
      }
    }
  },

  readDeskArtifact(data) {
    const artifact = this._deskArtifacts.get(data);
    return artifact ? { ...artifact, bytes: new Uint8Array(artifact.bytes) } : null;
  },

  async fetchDesk(scope, opts = {}) {
    const allowed = ["chart", "orderflow", "heatmap", "context"];
    const name = String(scope || "");
    if (!allowed.includes(name)) throw new Error("未知 desk scope: " + name);
    const q = new URLSearchParams();
    if (opts.interval) q.set("interval", String(opts.interval));
    if (opts.symbol) q.set("symbol", String(opts.symbol));
    if (opts.range) q.set("range", String(opts.range));
    if (opts.tail != null && String(opts.tail) !== "") q.set("tail", String(opts.tail));
    if (opts.from != null && String(opts.from) !== "") q.set("from", String(opts.from));
    if (opts.to != null && String(opts.to) !== "") q.set("to", String(opts.to));
    if (opts.knownAt != null && String(opts.knownAt) !== "") q.set("knownAt", String(opts.knownAt));
    const url = `${this.apiBase()}/api/desk/${encodeURIComponent(name)}${q.toString() ? "?" + q.toString() : ""}`;
    if (opts.signal?.aborted) throw new DOMException('读取已取消', 'AbortError');
    const data = await this.shareDeskRead(url, opts.signal, signal => this.requestDeskJson(url, signal),
      opts.priority === 'background' ? 'background' : 'foreground');
    if (opts.signal?.aborted) throw new DOMException('读取已取消', 'AbortError');
    if (name === 'chart' && opts.tail == null && opts.from == null && opts.to == null && opts.knownAt == null
        && data.pricePathAvailable === true && data.coverageScope === 'window' && data.series?.length) {
      const key = `${this.apiBase()}|${opts.symbol || 'BTCUSDT'}|${opts.interval || '15m'}`;
      this._chartWindows.delete(key);
      this._chartWindows.set(key, { at: Date.now(), data });
      while (this._chartWindows.size > 7) this._chartWindows.delete(this._chartWindows.keys().next().value);
    }
    if (typeof opts.onMetadata === 'function') opts.onMetadata(data);
    return data;
  },


  async fetchLiquidationStatus() {
    const res = await this.workerFetch(`${this.apiBase()}/api/d1/liquidations/status`, { cache: "default" });
    if (!res.ok) throw new Error(`liquidation status ${res.status}`);
    return res.json();
  },

  async wakeLiquidationCollector() {
    const res = await this.workerFetch(`${this.apiBase()}/api/d1/liquidations/wake`, { method: "POST", cache: "no-store" });
    if (!res.ok) throw new Error(`liquidation wake ${res.status}`);
    return res.json();
  },

  async fetchLiquidationBuckets(symbol = "BTCUSDT", range = "30d", opts = {}) {
    const q = new URLSearchParams({ symbol, range });
    if (opts && opts.includeActive) q.set("includeActive", "1");
    const res = await this.workerFetch(`${this.apiBase()}/api/d1/liquidations?${q.toString()}`, { cache: opts.cache || "default" });
    if (!res.ok) throw new Error(`liquidation buckets ${res.status}`);
    return res.json();
  },

  async fetchDerivatives(symbol = "BTCUSDT", range = "30d", opts = {}) {
    const q = new URLSearchParams({ symbol, range });
    if (opts && opts.sync != null && String(opts.sync) !== "") q.set("sync", String(opts.sync));
    const res = await this.workerFetch(`${this.apiBase()}/api/d1/derivatives?${q.toString()}`, { cache: opts.cache || "default" });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.text()).slice(0, 200); } catch (_) {}
      throw new Error(`derivatives ${res.status}${detail ? ": " + detail : ""}`);
    }
    const data = await res.json();
    if (!this.hasStablecoinContext(data)) {
      data.stablecoinContext = await this.fetchStablecoinContextFallback().catch((e) => ({
        scope: "GLOBAL",
        range: "90d",
        generatedAt: new Date().toISOString(),
        dataSource: { primary: "legacy-onchain-fallback", endpoints: [] },
        reliability: { weight: "low", confidence: "low_to_medium" },
        llmGuidance: {
          weight: "low",
          confidence: "low_to_medium",
          policy: "Stablecoin context fallback failed; do not use as a trade trigger.",
        },
        series: {},
        dataFreshness: {
          latestT: null,
          staleMs: null,
          sourceOk: false,
          warnings: [`稳定币背景读取失败：${e && e.message ? e.message : String(e)}`],
        },
      }));
    }
    return data;
  },

  hasStablecoinContext(data) {
    const series = data && data.stablecoinContext && data.stablecoinContext.series;
    return !!(
      series &&
      Array.isArray(series.stable_usdt_circ) &&
      series.stable_usdt_circ.length &&
      Array.isArray(series.stable_usdc_circ) &&
      series.stable_usdc_circ.length
    );
  },

  async fetchStablecoinContextFallback() {
    const q = new URLSearchParams({ scope: "GLOBAL", range: "90d" });
    const url = `${this.apiBase()}/api/d1/onchain?${q.toString()}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    let res;
    try {
      res = await this.workerFetch(url, { cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      const m = e && e.name === "AbortError" ? "请求超时(8s)" : e && e.message ? e.message : String(e);
      throw new Error(`legacy onchain fallback ${m}`);
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.text()).slice(0, 160); } catch (_) {}
      throw new Error(`legacy onchain fallback ${res.status}${detail ? ": " + detail : ""}`);
    }
    const data = await res.json();
    return {
      ...data,
      dataSource: {
        ...(data && data.dataSource ? data.dataSource : {}),
        primary: "legacy-onchain-fallback",
      },
      reliability: data?.reliability || { weight: "low", confidence: "low_to_medium" },
      llmGuidance: data?.llmGuidance || {
        weight: "low",
        confidence: "low_to_medium",
        policy: "Stablecoin context is a low-weight liquidity background only; do not use it as a trade trigger.",
      },
    };
  },

  async triggerDerivativesSync(symbol = "BTCUSDT", wait = true, opts = {}) {
    const q = new URLSearchParams({ symbol, wait: wait ? "1" : "0" });
    if (opts && opts.groups != null && String(opts.groups) !== "") q.set("groups", String(opts.groups));
    if (opts && opts.force) q.set("force", "1");
    const timeoutMs = Math.min(
      wait ? 240_000 : 30_000,
      Math.max(5_000, Number(opts.timeoutMs) || (wait ? 120_000 : 25_000)),
    );
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await this.workerFetch(`${this.apiBase()}/api/d1/derivatives/sync?${q.toString()}`, {
        cache: "no-store",
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(t);
      if (e && e.name === "AbortError") {
        throw new Error("同步触发超时，已尝试读取 D1 缓存");
      }
      const raw = e && e.message ? String(e.message) : String(e);
      if (/Failed to fetch|NetworkError|NETWORK_ERROR/i.test(raw)) {
        throw new Error(`浏览器无法连接云�?Worker：请检查网�?/ 代理 / 广告拦截插件。原错误�?{raw}`);
      }
      throw new Error(raw);
    } finally {
      clearTimeout(t);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      let hint = "";
      if (res.status === 451 || (data && String(data.error || "").toLowerCase().includes("restricted"))) {
        hint = "upstream geo restriction; check Cloudflare Worker BINANCE_FAPI_ORIGIN or retry later";
      } else if (res.status === 429) hint = "疑似限流�?29），请降低同步频率或稍后重试";
      else if (res.status === 502 || res.status === 503) hint = "Worker 可达但上游不可用�?D1 异常";
      throw new Error(
        `derivatives sync HTTP ${res.status}${data && data.error ? `: ${data.error}` : ""}${hint ? `�?{hint}）` : ""}`,
      );
    }
    return data;
  },

  /**
   * 页面「同步云端」：若核心指标已旧，阻塞修复对应分组；否�?fast(wait) + hourly 后台维护�?   * @returns {Promise<{ fast: object|null, repair: object|null, hourlyQueued: boolean, fastError: string|null, repairError: string|null }>}
   */
  async triggerDerivativesSyncStages(symbol = "BTCUSDT", opts = {}) {
    const hourlyFireAndForget = !(opts && opts.hourly === false);
    const fastTimeout = Number(opts.fastTimeoutMs) > 0 ? Number(opts.fastTimeoutMs) : 90_000;
    const repairTimeout = Number(opts.repairTimeoutMs) > 0 ? Number(opts.repairTimeoutMs) : 210_000;
    const out = {
      fast: null,
      repair: null,
      preStaleCoreMetrics: [],
      repairGroup: "",
      hourlyQueued: false,
      hourlySkipped: false,
      fastError: null,
      repairError: null,
    };
    let pre = opts && opts.currentPayload ? opts.currentPayload : null;
    if (!pre) {
      pre = await this.fetchDerivatives(symbol, "30d", { sync: "0" }).catch(() => null);
    }
    out.preStaleCoreMetrics = this.derivativesStaleCoreMetrics(pre);
    const suggested = pre && pre.syncHints && pre.syncHints.suggestedSyncGroup ? String(pre.syncHints.suggestedSyncGroup) : "";
    out.repairGroup = suggested || this.derivativesSyncGroupForStaleCore(out.preStaleCoreMetrics);
    if (out.preStaleCoreMetrics.length && out.repairGroup) {
      try {
        out.repair = await this.triggerDerivativesSync(symbol, true, {
          groups: out.repairGroup,
          timeoutMs: repairTimeout,
          force: !!(opts && opts.force),
        });
      } catch (e) {
        out.repairError = e && e.message ? String(e.message) : String(e);
      }
      const r = out.repair;
      const lockBusy = r && (r.skippedBecause === "sync_lock_busy" || r.queuedOrSkipped === "locked");
      out.hourlySkipped = !!lockBusy || !hourlyFireAndForget;
      return out;
    }
    try {
      out.fast = await this.triggerDerivativesSync(symbol, true, { groups: "fast", timeoutMs: fastTimeout });
    } catch (e) {
      out.fastError = e && e.message ? String(e.message) : String(e);
    }
    const f = out.fast;
    const lockBusy =
      f && (f.skippedBecause === "sync_lock_busy" || f.queuedOrSkipped === "locked");

    if (hourlyFireAndForget && !lockBusy) {
      const q = new URLSearchParams({ symbol, groups: "hourly", wait: "0", force: "0" });
      this.workerFetch(`${this.apiBase()}/api/d1/derivatives/sync?${q.toString()}`, { cache: "no-store" }).catch(() => {});
      out.hourlyQueued = true;
    } else if (hourlyFireAndForget && lockBusy) {
      out.hourlySkipped = true;
    } else if (!hourlyFireAndForget) {
      out.hourlySkipped = true;
    }
    return out;
  },

  derivativesStaleCoreMetrics(payload) {
    const fm = payload && payload.dataFreshness && payload.dataFreshness.freshnessByMetric;
    if (!fm || typeof fm !== "object") return [];
    const macro = new Set(["vix", "vix3m", "move"]);
    return Object.keys(fm).filter((key) => {
      if (macro.has(key)) return false;
      const lvl = fm[key] && fm[key].level;
      return lvl === "stale" || lvl === "missing";
    });
  },

  derivativesSyncGroupForStaleCore(keys) {
    const arr = Array.isArray(keys) ? keys.map(String).filter(Boolean) : [];
    if (!arr.length) return "";
    const heavy = new Set(["basis_quarter", "top_account_long_short", "top_position_long_short"]);
    if (arr.every((key) => heavy.has(key))) return "core-proprietary";
    return "core";
  },

  async fetchDerivativesStatus() {
    const res = await this.workerFetch(`${this.apiBase()}/api/d1/derivatives/status`, { cache: "default" });
    if (!res.ok) throw new Error(`derivatives status ${res.status}`);
    return res.json();
  },

  async syncKlines(symbol, interval, limit = 6000, opts = {}) {
    return await this.fetchKlinesFromD1(symbol, interval, limit, opts);
  },

  /**
   * 行情历史版本只留在本模块内存。完整窗口成功提交后才确认；
   * 页面对象重建不丢失，刷新浏览器则清空。不写入 localStorage。
   */
  _deskHistoryState: Object.create(null),

  deskHistoryKey(symbol, interval) {
    return `${String(symbol || "")}|${String(interval || "")}`;
  },

  readDeskHistory(symbol, interval) {
    const row = this._deskHistoryState[this.deskHistoryKey(symbol, interval)];
    if (!row) return { confirmedRevision: null, pendingRevision: null };
    return { confirmedRevision: row.confirmedRevision, pendingRevision: row.pendingRevision };
  },

  noteDeskHistoryPending(symbol, interval, revision) {
    const key = this.deskHistoryKey(symbol, interval);
    const row = this._deskHistoryState[key] || { confirmedRevision: null, pendingRevision: null };
    this._deskHistoryState[key] = row;
    const rev = Number(revision);
    if (!Number.isFinite(rev) || (row.confirmedRevision != null && rev <= row.confirmedRevision)) {
      return {
        raised: false,
        confirmedRevision: row.confirmedRevision,
        pendingRevision: row.pendingRevision,
      };
    }
    const raised = row.pendingRevision == null || rev > row.pendingRevision;
    if (raised) row.pendingRevision = rev;
    return { raised, confirmedRevision: row.confirmedRevision, pendingRevision: row.pendingRevision };
  },

  confirmDeskHistory(symbol, interval, revision) {
    const key = this.deskHistoryKey(symbol, interval);
    const row = this._deskHistoryState[key] || { confirmedRevision: null, pendingRevision: null };
    this._deskHistoryState[key] = row;
    const rev = Number(revision);
    if (!Number.isFinite(rev) || (row.confirmedRevision != null && rev < row.confirmedRevision)) {
      return { confirmedRevision: row.confirmedRevision, pendingRevision: row.pendingRevision };
    }
    row.confirmedRevision = rev;
    if (row.pendingRevision != null && row.pendingRevision <= rev) row.pendingRevision = null;
    return { confirmedRevision: row.confirmedRevision, pendingRevision: row.pendingRevision };
  },

  /** 字符串周�?�?毫秒 */
  getIntervalMs(interval) {
    const map = {
      "1m": 60 * 1000,
      "3m": 3 * 60 * 1000,
      "5m": 5 * 60 * 1000,
      "15m": 15 * 60 * 1000,
      "30m": 30 * 60 * 1000,
      "1h": 60 * 60 * 1000,
      "2h": 2 * 60 * 60 * 1000,
      "4h": 4 * 60 * 60 * 1000,
      "6h": 6 * 60 * 60 * 1000,
      "12h": 12 * 60 * 60 * 1000,
      "1d": 24 * 60 * 60 * 1000,
      "3d": 3 * 24 * 60 * 60 * 1000,
      "1w": 7 * 24 * 60 * 60 * 1000,
    };
    return map[interval] || 60 * 1000;
  },
};
