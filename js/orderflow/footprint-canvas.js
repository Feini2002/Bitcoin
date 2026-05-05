/* =======================================================
   Footprint canvas renderer
   ======================================================= */
(function (global) {
  "use strict";

  const AUTO_TICKS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000];

  function fmtVol(v) {
    const n = Number(v) || 0;
    if (Math.abs(n) >= 100) return n.toFixed(0);
    if (Math.abs(n) >= 10) return n.toFixed(1);
    if (Math.abs(n) >= 1) return n.toFixed(2);
    return n.toFixed(3);
  }

  function fmtPrice(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "--";
    return n >= 1000 ? n.toFixed(0) : n.toFixed(2);
  }

  function colorWithAlpha(rgb, alpha) {
    return `rgba(${rgb},${Math.max(0, Math.min(1, alpha))})`;
  }

  function roundToTick(price, tick) {
    const t = Math.max(1e-8, Number(tick) || 1);
    const s = String(t);
    const dot = s.indexOf(".");
    const d = dot >= 0 ? Math.min(8, s.length - dot - 1) : 0;
    return Number((Math.round(Number(price) / t) * t).toFixed(d));
  }

  function imbalanceSide(buyVol, sellVol) {
    const b = Number(buyVol) || 0;
    const s = Number(sellVol) || 0;
    const small = Math.min(b, s);
    const big = Math.max(b, s);
    if (small < 0.01 || big <= 0 || big / small < 3) return null;
    return b > s ? "buy" : "sell";
  }

  function detectBaseTick(bars) {
    const prices = [];
    for (const bar of bars || []) {
      for (const level of bar.levels || []) {
        const p = Number(level.price);
        if (Number.isFinite(p)) prices.push(p);
      }
    }
    const uniq = [...new Set(prices)].sort((a, b) => a - b);
    let best = Infinity;
    for (let i = 1; i < uniq.length; i++) {
      const gap = Math.abs(uniq[i] - uniq[i - 1]);
      if (gap > 0 && gap < best) best = gap;
    }
    return Number.isFinite(best) ? best : 10;
  }

  function chooseAutoTick(bars, plotH) {
    const prices = [];
    for (const bar of bars || []) {
      for (const level of bar.levels || []) {
        const p = Number(level.price);
        if (Number.isFinite(p)) prices.push(p);
      }
    }
    if (!prices.length) return 10;
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    const range = Math.max(1, hi - lo);
    const targetRows = Math.max(30, Math.min(45, Math.floor(plotH / 16)));
    const baseTick = detectBaseTick(bars);
    for (const tick of AUTO_TICKS) {
      if (tick < baseTick) continue;
      if (Math.ceil(range / tick) + 1 <= targetRows) return tick;
    }
    return AUTO_TICKS[AUTO_TICKS.length - 1];
  }

  function rebinBars(bars, tickSize, plotH) {
    const explicit = tickSize !== "auto" && tickSize != null && tickSize !== "";
    const tick = explicit ? Math.max(1, Number(tickSize) || 10) : chooseAutoTick(bars, plotH);
    const out = (bars || []).map((bar) => {
      const map = new Map();
      for (const level of bar.levels || []) {
        const price = roundToTick(level.price, tick);
        if (!map.has(price)) map.set(price, { price, buyVol: 0, sellVol: 0, delta: 0, total: 0, imbalance: null });
        const row = map.get(price);
        row.buyVol += Number(level.buyVol) || 0;
        row.sellVol += Number(level.sellVol) || 0;
      }
      const levels = [...map.values()]
        .map((level) => ({
          ...level,
          delta: level.buyVol - level.sellVol,
          total: level.buyVol + level.sellVol,
          imbalance: imbalanceSide(level.buyVol, level.sellVol),
        }))
        .filter((level) => level.total > 0)
        .sort((a, b) => b.price - a.price);
      let pocPrice = null;
      let maxTotal = -1;
      for (const level of levels) {
        if (level.total > maxTotal) {
          maxTotal = level.total;
          pocPrice = level.price;
        }
      }
      return { ...bar, levels, pocPrice };
    });
    return { bars: out, tick };
  }

  class FootprintCanvas {
    constructor(canvas, opts) {
      this.canvas = canvas;
      this.ctx = canvas ? canvas.getContext("2d") : null;
      this.opts = opts || {};
      this.bars = [];
      this.showImbalance = this.opts.showImbalance !== false;
      this.showVpLevels = this.opts.showVpLevels !== false;
      this.maxBars = Number(this.opts.maxBars) || 32;
      this.tickSize = this.opts.tickSize || "auto";
      this.tooltipEl = this.opts.tooltipEl || null;
      this.onRenderMeta = typeof this.opts.onRenderMeta === "function" ? this.opts.onRenderMeta : function () {};
      this.scrollFromRight = 0;
      this.hitCells = [];
      this.lastEffectiveTick = null;
      this._wheelHandler = (e) => {
        if (!this.bars.length || this.bars.length <= this.maxBars) return;
        e.preventDefault();
        const maxOffset = Math.max(0, this.bars.length - this.maxBars);
        const delta = Math.sign(Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY);
        this.scrollFromRight = Math.max(0, Math.min(maxOffset, this.scrollFromRight + delta));
        this.render();
      };
      this._moveHandler = (e) => this.handlePointerMove(e);
      this._leaveHandler = () => this.hideTooltip();
      this.ro = null;
      this.dpr = 1;
      if (canvas) {
        canvas.addEventListener("wheel", this._wheelHandler, { passive: false });
        canvas.addEventListener("mousemove", this._moveHandler);
        canvas.addEventListener("mouseleave", this._leaveHandler);
      }
      if (canvas && typeof ResizeObserver !== "undefined") {
        this.ro = new ResizeObserver(() => this.resize());
        this.ro.observe(canvas);
      }
      this.resize();
    }

    destroy() {
      this.hideTooltip();
      if (this.ro) {
        try { this.ro.disconnect(); } catch (_) {}
      }
      this.ro = null;
      if (this.canvas) {
        try { this.canvas.removeEventListener("wheel", this._wheelHandler); } catch (_) {}
        try { this.canvas.removeEventListener("mousemove", this._moveHandler); } catch (_) {}
        try { this.canvas.removeEventListener("mouseleave", this._leaveHandler); } catch (_) {}
      }
      this.canvas = null;
      this.ctx = null;
    }

    setOptions(opts) {
      opts = opts || {};
      if (opts.maxBars != null) this.maxBars = Number(opts.maxBars) || this.maxBars;
      if (opts.showImbalance != null) this.showImbalance = !!opts.showImbalance;
      if (opts.showVpLevels != null) this.showVpLevels = !!opts.showVpLevels;
      if (opts.tickSize != null) this.tickSize = opts.tickSize || "auto";
      if (opts.tooltipEl !== undefined) this.tooltipEl = opts.tooltipEl;
      if (typeof opts.onRenderMeta === "function") this.onRenderMeta = opts.onRenderMeta;
      this.render();
    }

    setData(bars) {
      this.bars = Array.isArray(bars) ? bars.slice() : [];
      const maxOffset = Math.max(0, this.bars.length - this.maxBars);
      this.scrollFromRight = Math.max(0, Math.min(maxOffset, this.scrollFromRight));
      this.render();
    }

    resize() {
      if (!this.canvas || !this.ctx) return;
      const rect = this.canvas.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width || 0));
      const h = Math.max(320, Math.floor(rect.height || 0));
      this.dpr = Math.max(1, Math.min(2, global.devicePixelRatio || 1));
      this.canvas.width = Math.floor(w * this.dpr);
      this.canvas.height = Math.floor(h * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.render();
    }

    renderEmpty(w, h, msg) {
      const ctx = this.ctx;
      this.hitCells = [];
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#0b1220";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(148,163,184,0.88)";
      ctx.font = "13px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(msg || "Waiting for footprint data...", w / 2, h / 2);
    }

    render() {
      if (!this.canvas || !this.ctx) return;
      const rect = this.canvas.getBoundingClientRect();
      const w = Math.max(320, Math.floor(rect.width || 0));
      const h = Math.max(320, Math.floor(rect.height || 0));
      const ctx = this.ctx;
      const maxOffset = Math.max(0, this.bars.length - this.maxBars);
      this.scrollFromRight = Math.max(0, Math.min(maxOffset, this.scrollFromRight));
      const end = this.bars.length - this.scrollFromRight;
      const start = Math.max(0, end - this.maxBars);
      const rawBars = this.bars.slice(start, end);

      if (!rawBars.length) {
        this.onRenderMeta({ effectiveTickSize: null, visibleBars: 0, totalBars: this.bars.length, visibleBarsData: [], volumeProfile: null });
        this.renderEmpty(w, h, "Waiting for Binance footprint data...");
        return;
      }

      const leftW = 78;
      const bottomH = 34;
      const topH = 24;
      const plotW = Math.max(120, w - leftW - 8);
      const plotH = Math.max(160, h - topH - bottomH);
      const rebinned = global.FootprintEngine && typeof global.FootprintEngine.rebinDisplayBars === "function"
        ? global.FootprintEngine.rebinDisplayBars(rawBars, this.tickSize, { plotH })
        : rebinBars(rawBars, this.tickSize, plotH);
      const bars = rebinned.bars;
      this.lastEffectiveTick = rebinned.tick;
      const volumeProfile = global.FootprintEngine && typeof global.FootprintEngine.buildVolumeProfile === "function"
        ? global.FootprintEngine.buildVolumeProfile(bars)
        : null;
      const allPrices = [];
      let maxCell = 0;
      for (const bar of bars) {
        for (const level of bar.levels || []) {
          allPrices.push(Number(level.price));
          maxCell = Math.max(maxCell, Number(level.buyVol) || 0, Number(level.sellVol) || 0);
        }
      }
      if (!allPrices.length) {
        this.onRenderMeta({ effectiveTickSize: rebinned.tick, visibleBars: bars.length, totalBars: this.bars.length, visibleBarsData: bars, volumeProfile: null });
        this.renderEmpty(w, h, "Aggregating first footprint bar...");
        return;
      }

      const prices = [...new Set(allPrices.filter(Number.isFinite))].sort((a, b) => b - a);
      const rowH = Math.max(12, Math.min(24, plotH / Math.max(1, prices.length)));
      const contentH = rowH * prices.length;
      const y0 = topH + Math.max(0, plotH - contentH);
      const barW = Math.max(16, Math.min(118, plotW / Math.max(1, bars.length)));
      const cellGap = 2;
      const imbW = this.showImbalance ? 10 : 2;
      const dataW = Math.max(12, barW - imbW - cellGap * 3);
      const halfW = Math.max(5, dataW / 2);
      const priceIndex = new Map(prices.map((price, idx) => [price, idx]));
      const yForPrice = (price) => {
        const n = roundToTick(price, rebinned.tick);
        let idx = priceIndex.get(n);
        if (idx == null) {
          let bestIdx = 0;
          let bestDist = Infinity;
          for (let i = 0; i < prices.length; i++) {
            const dist = Math.abs(prices[i] - n);
            if (dist < bestDist) {
              bestDist = dist;
              bestIdx = i;
            }
          }
          idx = bestIdx;
        }
        return y0 + idx * rowH + rowH / 2;
      };

      this.hitCells = [];
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#0b1220";
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = "rgba(148,163,184,0.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= prices.length; i++) {
        const y = y0 + i * rowH;
        ctx.moveTo(leftW, y);
        ctx.lineTo(w, y);
      }
      ctx.stroke();

      ctx.fillStyle = "rgba(203,213,225,0.86)";
      ctx.font = "11px ui-monospace, SFMono-Regular, Consolas, monospace";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (let i = 0; i < prices.length; i++) {
        const y = y0 + i * rowH + rowH / 2;
        if (y < topH || y > h - bottomH) continue;
        ctx.fillText(fmtPrice(prices[i]), leftW - 8, y);
      }

      bars.forEach((bar, bi) => {
        const x = leftW + bi * barW + 2;
        const levelMap = new Map((bar.levels || []).map((level) => [Number(level.price), level]));
        const barPrices = (bar.levels || []).map((level) => Number(level.price)).filter(Number.isFinite);
        const hiLevel = barPrices.length ? Math.max(...barPrices) : bar.high;
        const loLevel = barPrices.length ? Math.min(...barPrices) : bar.low;
        const bodyTop = y0 + (priceIndex.get(hiLevel) || 0) * rowH;
        const bodyBot = y0 + ((priceIndex.get(loLevel) || prices.length - 1) + 1) * rowH;
        ctx.strokeStyle = Number(bar.delta) >= 0 ? "rgba(16,185,129,0.35)" : "rgba(239,68,68,0.35)";
        ctx.strokeRect(x - 1, bodyTop, Math.max(4, barW - 5), Math.max(rowH, bodyBot - bodyTop));
        if (bi === bars.length - 1) {
          ctx.save();
          ctx.strokeStyle = "rgba(248,250,252,0.72)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(x - 2, bodyTop - 1, Math.max(6, barW - 3), Math.max(rowH + 2, bodyBot - bodyTop + 2));
          ctx.restore();
        }

        for (const [price, level] of levelMap) {
          const rowIdx = priceIndex.get(price);
          if (rowIdx == null) continue;
          const y = y0 + rowIdx * rowH + 1;
          if (y < topH || y > h - bottomH) continue;
          const buy = Number(level.buyVol) || 0;
          const sell = Number(level.sellVol) || 0;
          const buyA = maxCell > 0 ? 0.10 + 0.68 * Math.sqrt(buy / maxCell) : 0.10;
          const sellA = maxCell > 0 ? 0.10 + 0.68 * Math.sqrt(sell / maxCell) : 0.10;
          const sellX = x;
          const buyX = x + halfW + cellGap;
          const cellH = Math.max(2, rowH - 2);

          ctx.fillStyle = colorWithAlpha("239,68,68", sellA);
          ctx.fillRect(sellX, y, halfW, cellH);
          ctx.fillStyle = colorWithAlpha("16,185,129", buyA);
          ctx.fillRect(buyX, y, halfW, cellH);

          this.hitCells.push({
            x: sellX,
            y,
            w: halfW * 2 + cellGap,
            h: cellH,
            price,
            buy,
            sell,
            delta: buy - sell,
            total: buy + sell,
          });

          if (bar.pocPrice === price) {
            ctx.strokeStyle = "rgba(251,191,36,0.95)";
            ctx.strokeRect(sellX - 0.5, y - 0.5, halfW * 2 + cellGap + 1, Math.max(3, rowH - 1));
          }

          if (this.showImbalance && level.imbalance) {
            const imbX = x + dataW + cellGap * 2 + 4;
            ctx.fillStyle = level.imbalance === "buy" ? "#10b981" : "#ef4444";
            ctx.beginPath();
            ctx.arc(imbX, y + rowH / 2, 3, 0, Math.PI * 2);
            ctx.fill();
          }

          if (rowH >= 16 && barW >= 54) {
            ctx.font = barW >= 74 ? "10px ui-monospace, SFMono-Regular, Consolas, monospace" : "9px ui-monospace, SFMono-Regular, Consolas, monospace";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "rgba(248,250,252,0.92)";
            ctx.textAlign = "center";
            ctx.fillText(fmtVol(sell), sellX + halfW / 2, y + rowH / 2);
            ctx.fillText(fmtVol(buy), buyX + halfW / 2, y + rowH / 2);
          }
        }

        if (barW >= 34) {
          ctx.fillStyle = Number(bar.delta) >= 0 ? "rgba(16,185,129,0.95)" : "rgba(239,68,68,0.95)";
          ctx.font = barW >= 54 ? "11px ui-monospace, SFMono-Regular, Consolas, monospace" : "9px ui-monospace, SFMono-Regular, Consolas, monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(fmtVol(bar.delta), x + Math.max(4, barW - 5) / 2, h - 18);
        }
      });

      const closePoints = bars
        .map((bar, bi) => {
          const close = Number(bar.close != null ? bar.close : bar.c);
          if (!Number.isFinite(close)) return null;
          return {
            x: leftW + bi * barW + Math.max(4, barW - 5) / 2 + 2,
            y: yForPrice(close),
            close,
            delta: Number(bar.delta) || 0,
          };
        })
        .filter(Boolean);
      if (closePoints.length >= 2) {
        ctx.save();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(226,232,240,0.72)";
        ctx.shadowColor = "rgba(56,189,248,0.28)";
        ctx.shadowBlur = 8;
        ctx.beginPath();
        closePoints.forEach((point, idx) => {
          if (idx === 0) ctx.moveTo(point.x, point.y);
          else ctx.lineTo(point.x, point.y);
        });
        ctx.stroke();
        ctx.shadowBlur = 0;
        for (const point of closePoints) {
          ctx.fillStyle = point.delta >= 0 ? "rgba(16,185,129,0.92)" : "rgba(239,68,68,0.92)";
          ctx.beginPath();
          ctx.arc(point.x, point.y, barW >= 44 ? 3.2 : 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
        const latest = closePoints[closePoints.length - 1];
        ctx.strokeStyle = "rgba(248,250,252,0.55)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(leftW, latest.y);
        ctx.lineTo(w - 6, latest.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(248,250,252,0.95)";
        ctx.font = "10px ui-monospace, SFMono-Regular, Consolas, monospace";
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.fillText(`Now ${fmtPrice(latest.close)}`, w - 10, latest.y - 3);
        ctx.restore();
      }

      if (this.showVpLevels && volumeProfile && Number.isFinite(volumeProfile.pocPrice)) {
        const drawVpLine = (price, label, stroke, dash) => {
          const idx = priceIndex.get(Number(price));
          if (idx == null) return;
          const y = y0 + idx * rowH + rowH / 2;
          if (y < topH || y > h - bottomH) return;
          ctx.save();
          ctx.strokeStyle = stroke;
          ctx.lineWidth = label === "POC" ? 1.5 : 1;
          ctx.setLineDash(dash || []);
          ctx.beginPath();
          ctx.moveTo(leftW, y);
          ctx.lineTo(w - 6, y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = stroke;
          ctx.font = "10px ui-monospace, SFMono-Regular, Consolas, monospace";
          ctx.textAlign = "left";
          ctx.textBaseline = "bottom";
          ctx.fillText(label, leftW + 4, y - 2);
          ctx.restore();
        };
        drawVpLine(volumeProfile.vah, "VAH", "rgba(56,189,248,0.9)", [5, 4]);
        drawVpLine(volumeProfile.val, "VAL", "rgba(56,189,248,0.9)", [5, 4]);
        drawVpLine(volumeProfile.pocPrice, "POC", "rgba(251,191,36,0.95)", []);
      }

      ctx.fillStyle = "rgba(148,163,184,0.92)";
      ctx.font = "12px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(`左卖右买 · 底部为净主动量 · 黄线POC / 蓝线价值区 · 价格档 ${fmtPrice(rebinned.tick)}`, leftW, 12);
      if (this.scrollFromRight > 0) {
        ctx.textAlign = "right";
        ctx.fillText(`回看 ${this.scrollFromRight} 根`, w - 10, 12);
      }
      this.onRenderMeta({
        effectiveTickSize: rebinned.tick,
        visibleBars: bars.length,
        totalBars: this.bars.length,
        scrollFromRight: this.scrollFromRight,
        visibleBarsData: bars,
        volumeProfile,
      });
    }

    handlePointerMove(e) {
      if (!this.canvas || !this.tooltipEl) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const hit = this.hitCells.find((cell) => (
        x >= cell.x && x <= cell.x + cell.w && y >= cell.y && y <= cell.y + cell.h
      ));
      if (!hit) {
        this.hideTooltip();
        return;
      }
      this.tooltipEl.innerHTML = `
        <strong>${fmtPrice(hit.price)}</strong>
        <span>主动卖 ${fmtVol(hit.sell)}</span>
        <span>主动买 ${fmtVol(hit.buy)}</span>
        <span>净主动量 ${fmtVol(hit.delta)}</span>
      `;
      this.tooltipEl.style.display = "block";
      this.tooltipEl.style.left = `${Math.min(rect.width - 150, Math.max(8, x + 12))}px`;
      this.tooltipEl.style.top = `${Math.max(8, y - 56)}px`;
    }

    hideTooltip() {
      if (!this.tooltipEl) return;
      this.tooltipEl.style.display = "none";
    }
  }

  global.FootprintCanvas = FootprintCanvas;
})(typeof window !== "undefined" ? window : globalThis);
