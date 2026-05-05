/* =======================================================
   副图：RSI / MACD 独立 LWC 实例，与主图 timeScale 逻辑范围同步
   ======================================================= */

(function (global) {
  "use strict";

  const CHINA_TZ = "Asia/Shanghai";

  function utcSecondsFromChartTime(time) {
    if (typeof time === "number" && Number.isFinite(time)) return time;
    if (time && typeof time === "object" && "year" in time && "month" in time && "day" in time) {
      const y = time.year;
      const m = time.month;
      const d = time.day;
      return Date.UTC(y, m - 1, d) / 1000;
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
    const TM =
      typeof LightweightCharts !== "undefined" && LightweightCharts.TickMarkType
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

  const IndicatorPanes = {
    _mainChart: null,
    _rsiChart: null,
    _macdChart: null,
    _rsiLine: null,
    _macdHist: null,
    _macdLine: null,
    _macdSignal: null,
    _rsiTimeline: null,
    _macdTimeline: null,
    _timelineData: [],
    _rsiPriceLines: [],
    _resizeRsi: null,
    _resizeMacd: null,
    _syncing: false,

    _loc() {
      return {
        locale: "zh-CN",
        timeFormatter: (time) => {
          const sec = utcSecondsFromChartTime(time);
          if (!Number.isFinite(sec)) return "";
          return chinaDateTimeFull(sec);
        },
      };
    },

    _baseOptions() {
      return {
        layout: {
          textColor: "#d1d5db",
          background: { type: "solid", color: "transparent" },
        },
        grid: {
          vertLines: { color: "rgba(42, 46, 57, 0.5)" },
          horzLines: { color: "rgba(42, 46, 57, 0.5)" },
        },
        localization: this._loc(),
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        rightPriceScale: { borderColor: "rgba(197, 203, 206, 0.2)" },
        timeScale: {
          visible: false,
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
    },

    dispose() {
      this._mainChart = null;

      if (this._resizeRsi) {
        try {
          this._resizeRsi.disconnect();
        } catch (_) {}
        this._resizeRsi = null;
      }
      if (this._resizeMacd) {
        try {
          this._resizeMacd.disconnect();
        } catch (_) {}
        this._resizeMacd = null;
      }

      if (this._rsiChart) {
        try {
          this._rsiChart.remove();
        } catch (_) {}
        this._rsiChart = null;
      }
      this._rsiLine = null;
      this._rsiTimeline = null;

      if (this._macdChart) {
        try {
          this._macdChart.remove();
        } catch (_) {}
        this._macdChart = null;
      }
      this._macdHist = null;
      this._macdLine = null;
      this._macdSignal = null;
      this._macdTimeline = null;
      this._timelineData = [];
      this._rsiPriceLines = [];
    },

    /**
     * @param {import('lightweight-charts').IChartApi} mainChart
     */
    bindMain(mainChart) {
      this._mainChart = mainChart;
    },

    _timelineSeriesOptions() {
      return {
        color: "rgba(0,0,0,0)",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      };
    },

    _setTimelineOn(series) {
      if (!series) return;
      try {
        series.setData(this._timelineData);
      } catch (_) {}
    },

    _applyLogicalRange(range) {
      this._syncing = true;
      try {
        if (this._rsiChart) {
          try {
            this._rsiChart.timeScale().setVisibleLogicalRange(range);
          } catch (_) {}
        }
        if (this._macdChart) {
          try {
            this._macdChart.timeScale().setVisibleLogicalRange(range);
          } catch (_) {}
        }
      } finally {
        this._syncing = false;
      }
    },

    syncNow() {
      if (!this._mainChart) return;
      try {
        const r = this._mainChart.timeScale().getVisibleLogicalRange();
        if (r) this._applyLogicalRange(r);
      } catch (_) {}
    },

    setTimelineData(points) {
      this._timelineData = Array.isArray(points) ? points : [];
      this._setTimelineOn(this._rsiTimeline);
      this._setTimelineOn(this._macdTimeline);
    },

    ensureRsi(containerEl) {
      if (!containerEl || this._rsiChart) return;
      const opts = this._baseOptions();
      this._rsiChart = LightweightCharts.createChart(containerEl, opts);
      this._rsiLine = this._rsiChart.addLineSeries({
        color: "#a78bfa",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      this._rsiTimeline = this._rsiChart.addLineSeries(this._timelineSeriesOptions());
      this._setTimelineOn(this._rsiTimeline);
      const pl = (price, color) =>
        this._rsiLine.createPriceLine({
          price,
          color,
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dotted,
          axisLabelVisible: true,
          title: "",
        });
      this._rsiPriceLines = [pl(70, "rgba(239,68,68,0.45)"), pl(30, "rgba(16,185,129,0.45)")];

      this._resizeRsi = new ResizeObserver((entries) => {
        if (!entries.length || entries[0].target !== containerEl || !this._rsiChart) return;
        const r = entries[0].contentRect;
        this._rsiChart.applyOptions({ width: r.width, height: r.height });
        this.syncNow();
      });
      this._resizeRsi.observe(containerEl);
      const rect = containerEl.getBoundingClientRect();
      this._rsiChart.applyOptions({ width: rect.width || 400, height: rect.height || 120 });
    },

    ensureMacd(containerEl) {
      if (!containerEl || this._macdChart) return;
      const opts = this._baseOptions();
      this._macdChart = LightweightCharts.createChart(containerEl, opts);
      this._macdHist = this._macdChart.addHistogramSeries({
        priceFormat: { type: "price", precision: 4, minMove: 0.0001 },
      });
      this._macdLine = this._macdChart.addLineSeries({
        color: "#60a5fa",
        lineWidth: 1,
        priceLineVisible: false,
      });
      this._macdSignal = this._macdChart.addLineSeries({
        color: "#fbbf24",
        lineWidth: 1,
        priceLineVisible: false,
      });
      this._macdTimeline = this._macdChart.addLineSeries(this._timelineSeriesOptions());
      this._setTimelineOn(this._macdTimeline);

      this._resizeMacd = new ResizeObserver((entries) => {
        if (!entries.length || entries[0].target !== containerEl || !this._macdChart) return;
        const r = entries[0].contentRect;
        this._macdChart.applyOptions({ width: r.width, height: r.height });
        this.syncNow();
      });
      this._resizeMacd.observe(containerEl);
      const rect = containerEl.getBoundingClientRect();
      this._macdChart.applyOptions({ width: rect.width || 400, height: rect.height || 120 });
    },

    destroyRsi() {
      if (this._resizeRsi) {
        try {
          this._resizeRsi.disconnect();
        } catch (_) {}
        this._resizeRsi = null;
      }
      if (this._rsiChart) {
        try {
          this._rsiChart.remove();
        } catch (_) {}
        this._rsiChart = null;
      }
      this._rsiLine = null;
      this._rsiTimeline = null;
      this._rsiPriceLines = [];
    },

    destroyMacd() {
      if (this._resizeMacd) {
        try {
          this._resizeMacd.disconnect();
        } catch (_) {}
        this._resizeMacd = null;
      }
      if (this._macdChart) {
        try {
          this._macdChart.remove();
        } catch (_) {}
        this._macdChart = null;
      }
      this._macdHist = null;
      this._macdLine = null;
      this._macdSignal = null;
      this._macdTimeline = null;
    },

    setRsiData(points) {
      if (this._rsiLine) this._rsiLine.setData(points);
    },

    setMacdData(line, signal, hist) {
      if (this._macdLine) this._macdLine.setData(line);
      if (this._macdSignal) this._macdSignal.setData(signal);
      if (this._macdHist) this._macdHist.setData(hist);
    },
  };

  global.IndicatorPanes = IndicatorPanes;
})(typeof window !== "undefined" ? window : globalThis);
