/* =======================================================
   多周期对比（2×2）— 与主图同品种，按主图「可见时间区间」同步
   ======================================================= */
(function (global) {
  "use strict";

  const MTF_KEY = "bitdesk.workbench.mtf";
  const CHINA_TZ = "Asia/Shanghai";
  const TILE_COUNT = 4;
  const DEFAULT_TFS = ["1h", "4h", "1d", "1w"];

  function defaultState() {
    return { open: true, tfs: DEFAULT_TFS.slice() };
  }

  function readMtfState() {
    try {
      const raw = localStorage.getItem(MTF_KEY);
      if (!raw) return defaultState();
      const p = JSON.parse(raw);
      const tfs = Array.isArray(p.tfs) && p.tfs.length === TILE_COUNT
        ? p.tfs.map((x) => String(x))
        : defaultState().tfs;
      return { open: p.open === true, tfs };
    } catch (_) {
      return defaultState();
    }
  }

  function writeMtfState() {
    try {
      localStorage.setItem(
        MTF_KEY,
        JSON.stringify({ open: MtfTiles._open, tfs: MtfTiles._tfs.slice() })
      );
    } catch (_) {}
  }

  function utcSecondsFromChartTime(time) {
    if (typeof time === "number" && Number.isFinite(time)) return time;
    if (time && typeof time === "object" && "year" in time && "month" in time && "day" in time) {
      return Date.UTC(time.year, time.month - 1, time.day) / 1000;
    }
    return NaN;
  }

  function chinaDateTimeFull(utcSeconds) {
    const s = new Date(utcSeconds * 1000).toLocaleString("sv-SE", {
      timeZone: CHINA_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    return s.replace("T", " ").replace(",", "");
  }

  function chinaTickMarkLabel(utcSeconds, tickMarkType) {
    const d = new Date(utcSeconds * 1000);
    const TM = LightweightCharts.TickMarkType
      ? LightweightCharts.TickMarkType
      : { Year: 0, Month: 1, DayOfMonth: 2, Time: 3, TimeWithSeconds: 4 };
    switch (tickMarkType) {
      case TM.Year:
        return new Intl.DateTimeFormat("zh-CN", { timeZone: CHINA_TZ, year: "numeric" }).format(d);
      case TM.Month:
        return new Intl.DateTimeFormat("zh-CN", { timeZone: CHINA_TZ, year: "numeric", month: "numeric" }).format(d);
      case TM.DayOfMonth:
        return new Intl.DateTimeFormat("zh-CN", {
          timeZone: CHINA_TZ,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(d);
      case TM.TimeWithSeconds:
        return new Intl.DateTimeFormat("zh-CN", {
          timeZone: CHINA_TZ,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(d);
      default:
        return new Intl.DateTimeFormat("zh-CN", {
          timeZone: CHINA_TZ,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(d);
    }
  }

  function timeToUnixSec(t) {
    if (t == null) return NaN;
    if (typeof t === "number" && Number.isFinite(t)) return t;
    if (typeof t === "object") {
      if (typeof t.timestamp === "number" && Number.isFinite(t.timestamp)) return t.timestamp;
      if ("year" in t && "month" in t && "day" in t) {
        return Date.UTC(t.year, t.month - 1, t.day) / 1000;
      }
    }
    return NaN;
  }

  function baseChartOptions() {
    return {
      layout: {
        textColor: "#d1d5db",
        background: { type: "solid", color: "transparent" },
      },
      grid: {
        vertLines: { color: "rgba(42, 46, 57, 0.5)" },
        horzLines: { color: "rgba(42, 46, 57, 0.5)" },
      },
      localization: {
        locale: "zh-CN",
        timeFormatter: (time) => {
          const sec = utcSecondsFromChartTime(time);
          if (!Number.isFinite(sec)) return "";
          return chinaDateTimeFull(sec);
        },
      },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: "rgba(197, 203, 206, 0.2)" },
      timeScale: {
        borderColor: "rgba(197, 203, 206, 0.2)",
        timeVisible: true,
        secondsVisible: false,
        tickMarkMaxCharacterLength: 20,
        tickMarkFormatter: (time, tickMarkType) => {
          const sec = utcSecondsFromChartTime(time);
          if (!Number.isFinite(sec)) return null;
          return chinaTickMarkLabel(sec, tickMarkType);
        },
      },
    };
  }

  const MtfTiles = {
    _open: true,
    _tfs: defaultState().tfs,
    _mainChart: null,
    _getMainInterval: null,
    _getMainOhlcv: null,
    _getSymbol: null,
    _supported: [],
    _timeRangeHandler: null,
    _syncLock: false,
    _timeDebounce: null,
    _tiles: /** @type {any[]} */ ([]),
    _panelBound: false,
    _rafSync: 0,

    configure(opts) {
      this._mainChart = opts.mainChart;
      this._getMainInterval = opts.getMainInterval;
      this._getMainOhlcv = opts.getMainOhlcv;
      this._getSymbol = opts.getSymbol;
      this._supported = opts.supportedTfs || [];
    },

    _setGridDisplay(on) {
      const g = document.getElementById("mtf-grid");
      if (g) g.style.display = on ? "grid" : "none";
    },

    _bindPanelOnce() {
      if (this._panelBound) return;
      this._panelBound = true;
      const tgl = document.getElementById("mtf-toggle");
      if (tgl) {
        tgl.addEventListener("change", () => {
          this._open = !!tgl.checked;
          this._setGridDisplay(this._open);
          writeMtfState();
          if (this._open) {
            this._ensureTileCharts();
            this.reloadAllTileData();
            this._attachTimeSync();
            this.syncTimeFromMain();
          } else {
            this._detachTimeSync();
            this._destroyTileChartsOnly();
          }
        });
      }
      for (let i = 0; i < TILE_COUNT; i++) {
        const sel = document.getElementById("mtf-select-" + i);
        if (sel) {
          sel.addEventListener("change", (e) => {
            const val = (e.target && e.target.value) || "";
            if (this._supported.indexOf(val) < 0) return;
            this._tfs[i] = val;
            writeMtfState();
            this._loadTile(i);
            this.syncTimeFromMain();
          });
        }
      }
    },

    _ensureTileCharts() {
      for (let i = 0; i < TILE_COUNT; i++) {
        if (this._tiles[i] && this._tiles[i].chart) continue;
        this._createTileAt(i);
      }
    },

    _createTileAt(i) {
      const wrap = document.getElementById("mtf-tile-" + i);
      if (!wrap) return;
      if (this._tiles[i] && this._tiles[i].chart) return;

      const rect = wrap.getBoundingClientRect();
      const w = Math.max(120, rect.width || 200);
      const h = Math.max(100, rect.height || 180);

      const chart = LightweightCharts.createChart(wrap, {
        width: w,
        height: h,
        ...baseChartOptions(),
      });
      const series = chart.addCandlestickSeries({
        upColor: "#10b981",
        downColor: "#ef4444",
        borderDownColor: "#ef4444",
        borderUpColor: "#10b981",
        wickDownColor: "#ef4444",
        wickUpColor: "#10b981",
        priceLineVisible: false,
      });
      const ro = new ResizeObserver((entries) => {
        if (!entries.length || entries[0].target !== wrap) return;
        const r = entries[0].contentRect;
        if (r.width < 1 || r.height < 1) return;
        try {
          chart.applyOptions({ width: r.width, height: r.height });
        } catch (_) {}
      });
      ro.observe(wrap);
      this._tiles[i] = { chart, series, ro, loadGen: 0, interval: this._tfs[i] };
    },

    _destroyTileChartsOnly() {
      this.cancelReads();
      for (let i = 0; i < this._tiles.length; i++) {
        const t = this._tiles[i];
        if (!t) continue;
        if (t.ro) {
          try {
            t.ro.disconnect();
          } catch (_) {}
        }
        if (t.chart) {
          try {
            t.chart.remove();
          } catch (_) {}
        }
        this._tiles[i] = null;
      }
      this._tiles = [];
    },

    _setTileHint(i, text) {
      const el = document.getElementById("mtf-hint-" + i);
      if (el) {
        el.textContent = text || "";
        el.style.display = text ? "block" : "none";
      }
    },

    _tileSignal(tile) {
      tile.readAbort = new AbortController();
      return tile.readAbort.signal;
    },

    _tileEvidence(interval, desk, rows) {
      const list = Array.isArray(rows) ? rows : [];
      let verified = 0;
      list.forEach((row) => {
        if (row && row.sourceVerification === "verified") verified += 1;
      });
      const range = desk && desk.returnedRange;
      const rangeText = range && Number.isFinite(Number(range.from)) && Number.isFinite(Number(range.to))
        ? `返回范围 ${Number(range.from)}–${Number(range.to)}`
        : "返回范围未知";
      const gaps = desk && desk.coverageScope === "window" && desk.coverage && desk.coverage.inWindowGaps != null
        ? desk.coverage.inWindowGaps
        : "按已加载窗口";
      const price = desk && desk.pricePathAvailable === true ? "价格路径可用" : "价格路径不可用";
      const research = desk && desk.researchWindow && desk.researchWindow.eligible === true
        ? "研究窗口合格"
        : "研究窗口不合格";
      const tailNote = desk && desk.coverageScope === "tail" ? "尾部返回不是全历史总数" : "";
      return [
        interval,
        rangeText,
        `已核实 ${verified} 根`,
        `未核实 ${list.length - verified} 根`,
        `窗内缺口 ${gaps}`,
        price,
        research,
        `已加载 ${list.length} 根`,
        tailNote,
      ].filter(Boolean).join(" · ");
    },

    async _loadTile(i) {
      if (!this._open || document.hidden) return;
      this._createTileAt(i);
      const t = this._tiles[i];
      if (!t || !t.series) return;
      const sym = this._getSymbol ? this._getSymbol() : "BTCUSDT";
      const interval = this._tfs[i];
      const identity = sym + ':' + interval;
      if (t.requestIdentity === identity) return;
      if (t.readAbort) t.readAbort.abort();
      t.readAbort = null;
      t.interval = interval;
      t.loadGen += 1;
      const g = t.loadGen;
      this._setTileHint(i, "");
      const mainTf = this._getMainInterval ? this._getMainInterval() : "";
      const errEl = (msg) => {
        if (g !== t.loadGen || this._tiles[i] !== t) return;
        t.cachedRows = null;
        this._setTileHint(i, msg);
        try {
          t.series.setData([]);
        } catch (_) {}
      };

      if (interval === mainTf) {
        t.requestIdentity = null;
        const ohlcv = this._getMainOhlcv ? this._getMainOhlcv() : [];
        if (g !== t.loadGen) return;
        if (!Array.isArray(ohlcv) || ohlcv.length === 0) {
          errEl("与主图同周期，暂无数据");
          return;
        }
        const data = ohlcv.map((d) => ({
          time: d.t / 1000,
          open: d.o,
          high: d.h,
          low: d.l,
          close: d.c,
        }));
        t.series.setData(data);
        const mainDesk = typeof chartDeskPayload !== "undefined" ? chartDeskPayload : null;
        this._setTileHint(i, `与主图同周期 · ${this._tileEvidence(interval, mainDesk, ohlcv)}`);
        this.syncTimeFromMain();
        return;
      }

      this._setTileHint(i, "加载中…");
      if (typeof DataEngine === "undefined" || !DataEngine.fetchDesk) {
        errEl("desk 装配层未就绪");
        return;
      }
      if (window.__bitDeskChartPricePathAvailable === false) {
        errEl("主源缺失，子图不画混源 K 线");
        return;
      }
      try {
        t.requestIdentity = identity;
        const signal = this._tileSignal(t);
        // Reuse a full window already read by the main chart or another tile,
        // but never draw it before a fresh tail validates its revision/coverage.
        if ((t.cacheIdentity !== identity || !t.cachedRows || Date.now() - t.fullReadAt >= 60 * 60 * 1000) && DataEngine.peekChartWindow) {
          const shared = DataEngine.peekChartWindow(sym, interval);
          if (shared?.historyRevision != null && shared.series?.length) {
            t.cacheIdentity = identity;
            t.cachedRows = shared.series;
            t.confirmedHistoryRevision = Number(shared.historyRevision);
            t.cacheInstrumentId = shared.instrumentId;
            t.fullReadAt = Date.now();
          }
        }
        const cached = t.cacheIdentity === identity && t.cachedRows && Date.now() - t.fullReadAt < 60 * 60 * 1000
          ? t.cachedRows : null;
        let desk = await DataEngine.fetchDesk("chart", { symbol: sym, interval, signal, priority: 'background', ...(cached ? { tail: 20 } : {}) });
        if (g !== t.loadGen || this._tiles[i] !== t) return;
        let fullRead = !cached;
        // A hidden tab can miss more than the tail window. Refill before merging.
        if (cached && desk.pricePathAvailable && (!desk.series?.length
            || desk.coverageScope !== 'tail' || desk.historyRevision == null
            || Number(desk.series[0].t) > Number(cached[cached.length - 1].t)
            || Number(desk.series[desk.series.length - 1].t) < Number(cached[cached.length - 1].t)
            || (t.cacheInstrumentId && desk.instrumentId !== t.cacheInstrumentId))) {
          desk = await DataEngine.fetchDesk("chart", { symbol: sym, interval, signal, priority: 'background' });
          fullRead = true;
          if (g !== t.loadGen || this._tiles[i] !== t) return;
        }
        if (!desk || desk.pricePathAvailable !== true) {
          errEl("子图无权威币安序列");
          return;
        }
        let raw = Array.isArray(desk.series) ? desk.series : [];
        if (!Array.isArray(raw) || !raw.length) {
          errEl("无合格 K 线");
          return;
        }
        const revision = desk.historyRevision == null ? NaN : Number(desk.historyRevision);
        if (t.cacheIdentity === identity && t.confirmedHistoryRevision != null
            && Number.isFinite(revision) && revision < t.confirmedHistoryRevision) return;
        if (cached && !fullRead) {
          const rows = new Map(cached.map(row => [Number(row.t), row]));
          raw.forEach(row => rows.set(Number(row.t), row));
          raw = [...rows.values()].sort((a, b) => Number(a.t) - Number(b.t)).slice(-6000);
        }
        if (t.cacheIdentity !== identity) t.confirmedHistoryRevision = null;
        t.cacheIdentity = identity;
        t.cacheInstrumentId = desk.instrumentId;
        t.cachedRows = raw;
        if (fullRead) t.fullReadAt = Date.now();
        // Consumption belongs to this tile. Another tile/main chart can read the
        // same interval without having applied this tile's bounded history read.
        if (fullRead) {
          t.confirmedHistoryRevision = Number.isFinite(revision) ? revision : null;
        } else if (Number.isFinite(revision)) {
          if ((t.confirmedHistoryRevision == null || revision > t.confirmedHistoryRevision) && !t.rereadInFlight) {
            const step = typeof DataEngine.getIntervalMs === "function" ? DataEngine.getIntervalMs(interval) : 0;
            const from = Number(raw[0].t);
            const to = Number(raw[raw.length - 1].t) + (step > 0 ? step : 1);
            t.rereadInFlight = true;
            try {
              const again = await DataEngine.fetchDesk("chart", { symbol: sym, interval, from, to, signal, priority: 'background' });
              if (g !== t.loadGen || this._tiles[i] !== t || !again || again.pricePathAvailable !== true) return;
              const againRev = again.historyRevision == null ? NaN : Number(again.historyRevision);
              if (!Number.isFinite(againRev) || againRev < revision) return;
              // Replace the requested range, rather than merely upserting it:
              // a historical correction can delete a previously displayed bar.
              const merged = new Map(raw.filter((row) => Number(row.t) < from || Number(row.t) >= to)
                .map((row) => [Number(row.t), row]));
              (again.series || []).forEach((row) => {
                if (Number(row.t) >= from && Number(row.t) < to) merged.set(Number(row.t), row);
              });
              raw = [...merged.values()].sort((a, b) => Number(a.t) - Number(b.t)).slice(-6000);
              t.cachedRows = raw;
              t.confirmedHistoryRevision = againRev;
              desk = again;
            } finally {
              t.rereadInFlight = false;
            }
          }
        }
        const data = raw.map((d) => ({
          time: Number(d.t) / 1000,
          open: parseFloat(d.o),
          high: parseFloat(d.h),
          low: parseFloat(d.l),
          close: parseFloat(d.c),
        }));
        t.series.setData(data);
        this._setTileHint(i, this._tileEvidence(interval, desk, raw));
        this.syncTimeFromMain();
      } catch (e) {
        if (e && e.name === "AbortError") return;
        errEl("加载失败: " + (e && e.message ? e.message : e));
      } finally {
        if (g === t.loadGen) t.requestIdentity = null;
      }
    },

    cancelReads() {
      for (const tile of this._tiles) {
        if (!tile) continue;
        if (tile.readAbort) tile.readAbort.abort();
        tile.readAbort = null;
        tile.loadGen++;
        tile.requestIdentity = null;
        tile.rereadInFlight = false;
      }
    },

    reloadAllTileData() {
      if (!this._open) return;
      for (let i = 0; i < TILE_COUNT; i++) {
        this._loadTile(i);
      }
    },

    _attachTimeSync() {
      this._detachTimeSync();
      if (!this._mainChart) return;
      const ts = this._mainChart.timeScale();
      if (typeof ts.subscribeVisibleTimeRangeChange !== "function") return;
      this._timeRangeHandler = (tr) => {
        if (this._syncLock) return;
        if (this._timeDebounce) clearTimeout(this._timeDebounce);
        this._timeDebounce = setTimeout(() => {
          this._timeDebounce = null;
          this._applyTimeRangeToTiles(tr);
        }, 64);
      };
      try {
        ts.subscribeVisibleTimeRangeChange(this._timeRangeHandler);
      } catch (_) {
        this._timeRangeHandler = null;
      }
    },

    _detachTimeSync() {
      if (this._timeDebounce) {
        clearTimeout(this._timeDebounce);
        this._timeDebounce = null;
      }
      if (this._mainChart && this._timeRangeHandler) {
        const ts = this._mainChart.timeScale();
        if (typeof ts.unsubscribeVisibleTimeRangeChange === "function") {
          try {
            ts.unsubscribeVisibleTimeRangeChange(this._timeRangeHandler);
          } catch (_) {}
        }
        this._timeRangeHandler = null;
      } else {
        this._timeRangeHandler = null;
      }
    },

    _applyTimeRangeToTiles(tr) {
      if (!tr || tr.from == null || tr.to == null) return;
      const fromN = timeToUnixSec(tr.from);
      const toN = timeToUnixSec(tr.to);
      if (!Number.isFinite(fromN) || !Number.isFinite(toN) || fromN >= toN) return;

      this._syncLock = true;
      try {
        for (let i = 0; i < this._tiles.length; i++) {
          const t = this._tiles[i];
          if (!t || !t.chart) continue;
          try {
            t.chart.timeScale().setVisibleRange({ from: fromN, to: toN });
          } catch (_) {}
        }
      } finally {
        this._syncLock = false;
      }
    },

    syncTimeFromMain() {
      if (this.rafSync) cancelAnimationFrame(this.rafSync);
      this.rafSync = requestAnimationFrame(() => {
        this.rafSync = 0;
        if (!this._mainChart || !this._open) return;
        let tr;
        try {
          tr = this._mainChart.timeScale().getVisibleRange();
        } catch (_) {
          return;
        }
        this._applyTimeRangeToTiles(tr);
      });
    },

    initFromDom() {
      this._bindPanelOnce();
      const st = readMtfState();
      this._tfs = st.tfs;
      this._open = st.open;
      for (let i = 0; i < TILE_COUNT; i++) {
        const sel = document.getElementById("mtf-select-" + i);
        if (sel) {
          if (this._supported.indexOf(this._tfs[i]) < 0) {
            this._tfs[i] = this._supported[0] || "15m";
          }
          sel.value = this._tfs[i];
        }
      }
      const tgl = document.getElementById("mtf-toggle");
      if (tgl) tgl.checked = this._open;
      this._setGridDisplay(this._open);
      if (this._open) {
        this._ensureTileCharts();
        this.reloadAllTileData();
        this._attachTimeSync();
        this.syncTimeFromMain();
      }
    },

    getSyncIntervals() {
      if (!this._open) return [];
      return this._tfs.slice(0, TILE_COUNT).filter(Boolean);
    },

    dispose() {
      this._panelBound = false;
      this._detachTimeSync();
      if (this.rafSync) cancelAnimationFrame(this.rafSync);
      this.rafSync = 0;
      this._destroyTileChartsOnly();
      this._mainChart = null;
    },
  };

  global.MtfTiles = MtfTiles;
})(typeof window !== "undefined" ? window : globalThis);
