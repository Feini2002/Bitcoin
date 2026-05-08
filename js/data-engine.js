/* =======================================================
   数据引擎 Data Engine
   仅负责调用云端 Worker + D1 的 K 线接口。
   不再使用浏览器 IndexedDB：历史数据存在 Cloudflare D1，
   实时 K 线跳动由 chart.js 内 Binance kline WebSocket 负责；主图标题：aggTrade/现货线路 WS + 币安 REST 轮询兜底（均非 D1/K 线序列）。
   ======================================================= */

const DataEngine = {
  SUPPORTED_INTERVALS: ["5m", "15m", "1h", "4h", "1d", "3d", "1w"],

  /** Worker 基址：固定使用已部署 Cloudflare Worker。 */
  apiBase() {
    if (typeof getBitDataApiBase === "function") {
      return getBitDataApiBase();
    }
    if (typeof window !== "undefined" && window.BIT_DATA_API_BASE) {
      return String(window.BIT_DATA_API_BASE).replace(/\/$/, "");
    }
    return "https://btc.feiniwork.com";
  },

  /** Cloudflare「舆情日报」Worker 根 URL（独立于 btc.feiniwork.com）。 */
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
      throw new Error(`${label} 返回格式错误：不是 JSON 对象`);
    }
    return data;
  },

  /** @param {{ signal?: AbortSignal }} opts */
  async fetchYuqingHealth(opts = {}) {
    const url = `${this.yuqingApiBase()}/api/yuqing/health`;
    const res = await fetch(url, { cache: "no-store", signal: opts.signal });
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
      res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      const m = e && e.name === "AbortError" ? "请求超时或已取消" : e && e.message ? e.message : String(e);
      throw new Error(`无法访问舆情数据源 ${url}：${m}`);
    } finally {
      clearTimeout(t);
      unsub();
    }
    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 240);
      } catch (_) {}
      throw new Error(`舆情数据源接口 ${res.status}${detail ? ": " + detail : ""}`);
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
      res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      clearTimeout(t);
      unsub();
      const m = e && e.name === "AbortError" ? "请求超时或已取消" : e && e.message ? e.message : String(e);
      throw new Error(`无法访问舆情 latest ${url}：${m}`);
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
      res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      clearTimeout(t);
      unsub();
      const m = e && e.name === "AbortError" ? "请求超时或已取消" : e && e.message ? e.message : String(e);
      throw new Error(`无法访问舆情 items：${m}`);
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
      res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      clearTimeout(t);
      unsub();
      const m = e && e.name === "AbortError" ? "请求超时或已取消" : e && e.message ? e.message : String(e);
      throw new Error(`无法访问舆情 history：${m}`);
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

  /**
   * 生成舆情日报全文（服务端编排 + 可选 LLM）。
   * @param {{ mode?: string, modules?: object, force?: boolean }} payload
   * @param {{ signal?: AbortSignal, timeoutMs?: number }} opts
   */
  async generateYuqingReport(payload = {}, opts = {}) {
    return this.generateYuqingStructuredReport("sentiment_analysis", payload, opts);
  },

  async fetchYuqingReportLatest(kind = "sentiment_analysis", opts = {}) {
    const q = new URLSearchParams({ kind: String(kind || "sentiment_analysis") });
    const url = `${this.yuqingApiBase()}/api/yuqing/reports/latest?${q.toString()}`;
    const ctrl = new AbortController();
    const unsub = this.attachAbort(opts.signal, ctrl);
    const t = setTimeout(() => ctrl.abort(), Math.min(30_000, Math.max(5_000, Number(opts.timeoutMs) || 15_000)));
    let res;
    try {
      res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      const m = e && e.name === "AbortError" ? "请求超时或已取消" : e && e.message ? e.message : String(e);
      throw new Error(`无法读取舆情报告 latest：${m}`);
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
      res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      const m = e && e.name === "AbortError" ? "请求超时或已取消" : e && e.message ? e.message : String(e);
      throw new Error(`无法读取舆情报告 history：${m}`);
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
      res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      const m = e && e.name === "AbortError" ? "请求超时或已取消" : e && e.message ? e.message : String(e);
      throw new Error(`无法读取舆情报告 item：${m}`);
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
      res = await fetch(url, { method: "DELETE", cache: "no-store", signal: ctrl.signal, headers: { Accept: "application/json" } });
    } catch (e) {
      const m = e && e.name === "AbortError" ? "请求超时或已取消" : e && e.message ? e.message : String(e);
      throw new Error(`无法删除舆情报告：${m}`);
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
      res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      unsub();
      throw new Error(`获取舆情设置失败（${url}）：${e.message || String(e)}`);
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
      res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        signal: ctrl.signal,
        body: JSON.stringify(settings)
      });
    } catch (e) {
      unsub();
      throw new Error(`更新舆情设置失败（${url}）：${e.message || String(e)}`);
    }
    unsub();
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const hint = data && (data.error || data.message);
      throw new Error(`更新舆情设置接口 ${res.status}${hint ? `: ${hint}` : ""}`);
    }
    return data;
  },

  async fetchYuqingModelSettings(opts = {}) {
    const url = `${this.yuqingApiBase()}/api/yuqing/settings/model-channels`;
    const ctrl = new AbortController();
    const unsub = this.attachAbort(opts.signal, ctrl);
    const timeoutMs = Math.min(45_000, Math.max(5_000, Number(opts.timeoutMs) || 20_000));
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      const m = e && e.name === "AbortError" ? `请求超时(${Math.round(timeoutMs / 1000)}s)` : e && e.message ? e.message : String(e);
      throw new Error(`获取模型通道设置失败（${url}）：${m}`);
    } finally {
      clearTimeout(t);
      unsub();
    }
    return this.parseWorkerJsonResponse(res, "模型通道设置");
  },

  async updateYuqingModelSettings(settings, opts = {}) {
    const url = `${this.yuqingApiBase()}/api/yuqing/settings/model-channels`;
    const ctrl = new AbortController();
    const unsub = this.attachAbort(opts.signal, ctrl);
    const timeoutMs = Math.min(45_000, Math.max(5_000, Number(opts.timeoutMs) || 20_000));
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        cache: "no-store",
        signal: ctrl.signal,
        body: JSON.stringify(settings && typeof settings === "object" ? settings : {}),
      });
    } catch (e) {
      const m = e && e.name === "AbortError" ? `请求超时(${Math.round(timeoutMs / 1000)}s)` : e && e.message ? e.message : String(e);
      throw new Error(`保存模型通道设置失败（${url}）：${m}`);
    } finally {
      clearTimeout(t);
      unsub();
    }
    return this.parseWorkerJsonResponse(res, "保存模型通道设置");
  },

  async generateYuqingStructuredReport(kind = "sentiment_analysis", payload = {}, opts = {}) {
    const url = `${this.yuqingApiBase()}/api/yuqing/reports/generate`;
    const timeoutMs = Math.min(600_000, Math.max(5_000, Number(opts.timeoutMs) || 185_000));
    const ctrl = new AbortController();
    const unsub = this.attachAbort(opts.signal, ctrl);
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        cache: "no-store",
        signal: ctrl.signal,
        body: JSON.stringify({
          ...(payload && typeof payload === "object" ? payload : {}),
          kind: String(kind || (payload && payload.kind) || "sentiment_analysis"),
        }),
      });
    } catch (e) {
      clearTimeout(t);
      unsub();
      const m =
        e && e.name === "AbortError"
          ? `请求超时(>${Math.round(timeoutMs / 1000)}s)或页面已切换`
            : e && e.message
              ? e.message
              : String(e);
      throw new Error(`舆情报告生成失败（${url}）：${m}`);
    }
    clearTimeout(t);
    unsub();
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const hint = data && (data.error || data.message);
      throw new Error(`舆情报告接口 ${res.status}${hint ? `: ${hint}` : ""}`);
    }
    return data;
  },

  async streamYuqingDailyEventReport(payload = {}, opts = {}) {
    const url = `${this.yuqingApiBase()}/api/yuqing/reports/generate-stream`;
    const timeoutMs = Math.min(600_000, Math.max(30_000, Number(opts.timeoutMs) || 420_000));
    const ctrl = new AbortController();
    const unsub = this.attachAbort(opts.signal, ctrl);
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const onEvent = typeof opts.onEvent === "function" ? opts.onEvent : () => {};
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        cache: "no-store",
        signal: ctrl.signal,
        body: JSON.stringify({
          kind: "daily_event",
          ...(payload && typeof payload === "object" ? payload : {}),
        }),
      });
    } catch (e) {
      clearTimeout(t);
      unsub();
      const m =
        e && e.name === "AbortError"
          ? `请求超时(>${Math.round(timeoutMs / 1000)}s)或页面已切换`
          : e && e.message
            ? e.message
            : String(e);
      throw new Error(`舆情流式生成失败（${url}）：${m}`);
    }
    if (!res.ok) {
      clearTimeout(t);
      unsub();
      const text = await res.text().catch(() => "");
      throw new Error(`舆情流式接口 ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
    }
    const reader = res.body && res.body.getReader ? res.body.getReader() : null;
    if (!reader) {
      clearTimeout(t);
      unsub();
      throw new Error("舆情流式接口未返回可读流");
    }
    const dec = new TextDecoder();
    let buf = "";
    let lastDone = null;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          let evt;
          try {
            evt = JSON.parse(line);
          } catch (_) {
            continue;
          }
          await Promise.resolve(onEvent(evt));
          if (evt && evt.type === "done" && evt.report) lastDone = evt;
          if (evt && evt.type === "error" && evt.error) {
            throw new Error(String(evt.error));
          }
        }
      }
    } finally {
      clearTimeout(t);
      unsub();
      try {
        await reader.cancel();
      } catch (_) {}
    }
    if (lastDone && lastDone.report) return lastDone;
    throw new Error("流式响应未返回完整报告");
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
   * 从 Worker /api/d1/klines 读取云端存储的 K 线（已按升序、最多 2000 根）。
   * 返回 [{t,o,h,l,c,v}, ...]
   */
  async fetchKlinesFromD1(symbol, interval, limit = 2000, opts = {}) {
    const q = new URLSearchParams({ symbol, interval, limit: String(limit) });
    if (opts && opts.sync != null && String(opts.sync) !== "") q.set("sync", String(opts.sync));
    const url = `${this.apiBase()}/api/d1/klines?${q.toString()}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30_000);
    let res;
    try {
      res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      const m = (e && e.name === "AbortError") ? "请求超时(30s)" : (e && e.message ? e.message : String(e));
      throw new Error(
        `无法访问 ${url}。请确认已部署 Worker 可访问，或检查当前网络。原错误: ${m}`
      );
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.text()).slice(0, 200); } catch (_) {}
      throw new Error(`D1 K 线接口 ${res.status}${detail ? ": " + detail : ""}`);
    }
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.klines)) {
      throw new Error("D1 K 线返回格式错误：缺少 klines 数组");
    }

    if (typeof window !== "undefined") {
      const dataSource = res.headers.get("X-Data-Source") || res.headers.get("x-data-source") || "";
      const latestT = Number(data.latestT || 0);
      const stale = latestT > 0 ? Date.now() - latestT : Infinity;
      window.__LAST_KLINES_DATA_SOURCE = dataSource === "cloudflare-d1" ? "d1" : "unknown";
      window.__LAST_KLINES_META = {
        symbol: data.symbol,
        interval: data.interval,
        count: data.count,
        latestT,
        lastSync: data.lastSync || null,
        staleMs: stale,
      };
      let klineBackend = "云端";
      try {
        const u = new URL(this.apiBase());
        if (u.hostname) klineBackend = u.hostname;
      } catch (_) {}
      window.__LAST_KLINES_BACKEND = klineBackend;
    }

    return data.klines.map((d) => ({
      t: Number(d.t),
      o: parseFloat(d.o),
      h: parseFloat(d.h),
      l: parseFloat(d.l),
      c: parseFloat(d.c),
      v: parseFloat(d.v),
    }));
  },

  /**
   * 设置页/运维入口：触发已部署 Worker 手动同步 K 线到其绑定的 Cloudflare D1。
   * 设置页用于全周期运维同步；图表页只在当前周期落后或手动按钮触发时调用当前周期同步。
   */
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
      res = await fetch(url, { method: "POST", cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      const m = (e && e.name === "AbortError")
        ? `请求超时(${Math.round(timeoutMs / 1000)}s)`
        : (e && e.message ? e.message : String(e));
      throw new Error(
        `无法触发 D1 手动同步：浏览器连不上已部署 Worker (${this.apiBase()})。请检查网络、代理、CORS 或 Worker 可用性。原错误: ${m}`
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
      if (/451|restricted|region|geo/i.test(msg)) hint = "疑似上游地域限制，请检查 Worker 的 Binance 反代或 Bybit 兜底。";
      else if (/429/.test(msg)) hint = "疑似上游限流，请稍后重试。";
      else if (/502|503/.test(msg)) hint = "Worker 可达，但上游行情源或 D1 写入失败，请查看 Worker 日志。";
      throw new Error(`${msg}${hint ? `（${hint}）` : ""}`);
    }
    return data;
  },

  /**
   * 查看已部署 Worker 绑定 D1 当前各周期的存储概况与最近同步结果。
   */
  async fetchCloudStatus(opts = {}) {
    const url = `${this.apiBase()}/api/d1/status`;
    const ctrl = new AbortController();
    const unsub = this.attachAbort(opts.signal, ctrl);
    const timeoutMs = Math.min(60_000, Math.max(5_000, Number(opts.timeoutMs) || 20_000));
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    } catch (e) {
      const m = e && e.name === "AbortError"
        ? `请求超时(${Math.round(timeoutMs / 1000)}s)`
        : e && e.message ? e.message : String(e);
      throw new Error(`无法读取 D1 状态：浏览器连不上已部署 Worker (${url})。原错误: ${m}`);
    } finally {
      clearTimeout(t);
      unsub();
    }
    return this.parseWorkerJsonResponse(res, "D1 状态");
  },

  async fetchLiquidationStatus() {
    const res = await fetch(`${this.apiBase()}/api/d1/liquidations/status`, { cache: "no-store" });
    if (!res.ok) throw new Error(`liquidation status ${res.status}`);
    return res.json();
  },

  async wakeLiquidationCollector() {
    const res = await fetch(`${this.apiBase()}/api/d1/liquidations/wake`, { method: "POST", cache: "no-store" });
    if (!res.ok) throw new Error(`liquidation wake ${res.status}`);
    return res.json();
  },

  async fetchLiquidationBuckets(symbol = "BTCUSDT", range = "30d", opts = {}) {
    const q = new URLSearchParams({ symbol, range });
    if (opts && opts.includeActive) q.set("includeActive", "1");
    const res = await fetch(`${this.apiBase()}/api/d1/liquidations?${q.toString()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`liquidation buckets ${res.status}`);
    return res.json();
  },

  async fetchDerivatives(symbol = "BTCUSDT", range = "30d", opts = {}) {
    const q = new URLSearchParams({ symbol, range });
    if (opts && opts.sync != null && String(opts.sync) !== "") q.set("sync", String(opts.sync));
    const res = await fetch(`${this.apiBase()}/api/d1/derivatives?${q.toString()}`, { cache: "no-store" });
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
      res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
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
      res = await fetch(`${this.apiBase()}/api/d1/derivatives/sync?${q.toString()}`, {
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
        throw new Error(`浏览器无法连接云端 Worker：请检查网络 / 代理 / 广告拦截插件。原错误：${raw}`);
      }
      throw new Error(raw);
    } finally {
      clearTimeout(t);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      let hint = "";
      if (res.status === 451 || (data && String(data.error || "").toLowerCase().includes("restricted"))) {
        hint = "疑似上游地域限制，请检查 Cloudflare Worker BINANCE_FAPI_ORIGIN 反代或稍后重试";
      } else if (res.status === 429) hint = "疑似限流（429），请降低同步频率或稍后重试";
      else if (res.status === 502 || res.status === 503) hint = "Worker 可达但上游不可用或 D1 异常";
      throw new Error(
        `derivatives sync HTTP ${res.status}${data && data.error ? `: ${data.error}` : ""}${hint ? `（${hint}）` : ""}`,
      );
    }
    return data;
  },

  /**
   * 页面「同步云端」：若核心指标已旧，阻塞修复对应分组；否则 fast(wait) + hourly 后台维护。
   * @returns {Promise<{ fast: object|null, repair: object|null, hourlyQueued: boolean, fastError: string|null, repairError: string|null }>}
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
      fetch(`${this.apiBase()}/api/d1/derivatives/sync?${q.toString()}`, { cache: "no-store" }).catch(() => {});
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
    const res = await fetch(`${this.apiBase()}/api/d1/derivatives/status`, { cache: "no-store" });
    if (!res.ok) throw new Error(`derivatives status ${res.status}`);
    return res.json();
  },

  yuqingScheduleDraftKey() {
    return "bitdesk.yuqing.schedule.preview";
  },

  defaultYuqingScheduleDraft() {
    return {
      enabled: false,
      times: ["00:00", "08:00", "12:00", "20:00"],
      analysisTimes: ["09:00", "14:00", "22:00"],
      timezone: "Asia/Shanghai",
      updatedAt: null,
      phase: "worker_d1_reports",
    };
  },

  normalizeYuqingScheduleTimes(times) {
    const arr = Array.isArray(times) ? times : [];
    const out = [];
    for (const t of arr) {
      const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(t || "").trim());
      if (!m) continue;
      const v = `${m[1]}:${m[2]}`;
      if (!out.includes(v)) out.push(v);
      if (out.length >= 4) break;
    }
    return out.length ? out : ["00:00", "08:00", "12:00", "20:00"];
  },

  readYuqingScheduleDraft() {
    const d = this.defaultYuqingScheduleDraft();
    try {
      const raw = localStorage.getItem(this.yuqingScheduleDraftKey());
      if (!raw) return d;
      const parsed = JSON.parse(raw);
      const merged = parsed && typeof parsed === "object" ? parsed : {};
      return {
        ...d,
        enabled: !!merged.enabled,
        times: [...d.times],
        analysisTimes: [...d.analysisTimes],
        timezone: "Asia/Shanghai",
        phase: "worker_d1_reports",
        updatedAt: merged.updatedAt != null ? merged.updatedAt : d.updatedAt,
      };
    } catch (_) {
      return d;
    }
  },

  writeYuqingScheduleDraft(payload) {
    const d = this.defaultYuqingScheduleDraft();
    const current = this.readYuqingScheduleDraft();
    const wantEnabled =
      payload && typeof payload === "object" && Object.prototype.hasOwnProperty.call(payload, "enabled")
        ? !!payload.enabled
        : !!current.enabled;
    const next = {
      ...current,
      ...d,
      enabled: wantEnabled,
      times: [...d.times],
      analysisTimes: [...d.analysisTimes],
      timezone: "Asia/Shanghai",
      updatedAt: new Date().toISOString(),
      phase: "worker_d1_reports",
    };
    try {
      localStorage.setItem(this.yuqingScheduleDraftKey(), JSON.stringify(next));
    } catch (_) {}
    return next;
  },

  nextYuqingScheduleRun(payload, now = new Date()) {
    const cfg = {
      ...this.defaultYuqingScheduleDraft(),
      ...(payload && typeof payload === "object" ? payload : {}),
    };
    const times = this.normalizeYuqingScheduleTimes(cfg.times);
    if (!cfg.enabled || !times.length) return null;
    const base = new Date(now);
    const candidates = [];
    for (let dayOffset = 0; dayOffset <= 1; dayOffset += 1) {
      for (const t of times) {
        const [hh, mm] = t.split(":").map((x) => Number(x));
        const d = new Date(base);
        d.setDate(base.getDate() + dayOffset);
        d.setHours(hh, mm, 0, 0);
        if (d.getTime() > base.getTime()) candidates.push(d);
      }
    }
    candidates.sort((a, b) => a.getTime() - b.getTime());
    return candidates[0] ? candidates[0].toISOString() : null;
  },

  /** 历史兼容别名：实际只读 D1，不触发写库；新调用优先用 fetchKlinesFromD1。 */
  async syncKlines(symbol, interval, limit = 2000, opts = {}) {
    return await this.fetchKlinesFromD1(symbol, interval, limit, opts);
  },

  /** 字符串周期 → 毫秒 */
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
