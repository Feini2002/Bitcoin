/* =======================================================
   页面：环境评估员（深度）
   ======================================================= */
function pageEnvAgent() {
  const agent = AGENT_MAP["env"];
  return html`
    ${renderOpinionLayerBanner("env")}
    <div class="env-layout">
      <section class="workbench">
        <div class="wb-context">
          <span class="ctx-tag">证据视图</span>
          <span class="ctx-text">
            下图是 <strong>环境评估员</strong>用于支撑结论的指标切片，已聚焦到本员工关心的 <strong>布林带 / ATR / DVOL</strong>。
          </span>
          <span class="ctx-spacer"></span>
          <a class="ctx-link" href="#/chart">打开完整工作台 <i class="ph ph-arrow-right"></i></a>
        </div>
        <div class="wb-toolbar">
          <div class="symbol-select">
            <span>BTCUSDT</span>
            <span class="meta">· 永续 · Binance</span>
            <span style="color:var(--muted); margin-left:4px;">▾</span>
          </div>
          <div class="tf-tabs" id="tfTabs">
            <div class="tf-tab" data-tf="15m">15m</div>
            <div class="tf-tab" data-tf="1H">1H</div>
            <div class="tf-tab active" data-tf="4H">4H</div>
            <div class="tf-tab" data-tf="1D">1D</div>
          </div>
          <div class="indicator-chips" id="indChips">
            <span class="chip active" data-ind="bb">布林带</span>
            <span class="chip active" data-ind="atr">ATR</span>
            <span class="chip" data-ind="ema">EMA20/50</span>
            <span class="chip" data-ind="dvol">DVOL叠加</span>
            <span class="chip active" data-ind="vol">成交量</span>
          </div>
        </div>
        <div class="wb-chart" id="wbChart">
          <div class="chart-legend">
            <div class="lg-row"><span class="lg-swatch" style="background:var(--info)"></span>BB 中轨</div>
            <div class="lg-row"><span class="lg-swatch" style="background:var(--accent)"></span>EMA20</div>
            <div class="lg-row"><span class="lg-swatch" style="background:var(--warn)"></span>EMA50</div>
          </div>
          <svg id="mainChart" viewBox="0 0 800 360" preserveAspectRatio="none"></svg>
        </div>
        <div class="wb-subcharts">
          <div class="wb-sub">
            <div class="wb-sub-head"><span>ATR (14)</span><span style="color:var(--ok);">百分位 78%</span></div>
            <div class="wb-sub-value">1,284.30</div>
            <svg id="atrChart" viewBox="0 0 400 60" preserveAspectRatio="none"></svg>
          </div>
          <div class="wb-sub">
            <div class="wb-sub-head"><span>成交量 / 24H 波幅</span><span style="color:var(--warn);">4.21%</span></div>
            <div class="wb-sub-value">$48.2B</div>
            <svg id="volChart" viewBox="0 0 400 60" preserveAspectRatio="none"></svg>
          </div>
        </div>
      </section>

      <aside class="report-panel">
        <div class="agent-card">
          <div class="agent-avatar" style="background:${agent.color}">${agent.short}</div>
          <div>
            <div class="agent-name">${agent.name}</div>
            <div class="agent-role">${agent.role}</div>
          </div>
        </div>

        <div class="conclusion-card">
          <div class="confidence-ring">
            <svg viewBox="0 0 64 64">
              <circle class="ring-bg" cx="32" cy="32" r="26"/>
              <circle class="ring-fg" cx="32" cy="32" r="26"
                stroke-dasharray="163.36" stroke-dashoffset="45.74"/>
            </svg>
            <div class="ring-label">72%</div>
          </div>
          <div class="conclusion-label">当前结论</div>
          <div class="conclusion-tag"><span class="tag-badge"></span>趋势扩张期</div>
          <div class="conclusion-reason">
            4H ATR 百分位已抬升至 78%，布林带口径从上周 2.1% 扩到 4.6%，DVOL 从 42 上行至 58。<br>
            倾向方向偏多但尚未失控，适合顺势 + 回踩进场。
          </div>
        </div>

        <div class="kpi-grid-3">
          <div class="kpi"><span class="kpi-label">ATR(14)</span><span class="kpi-value">1,284</span><span class="kpi-delta up">+12.4%</span></div>
          <div class="kpi"><span class="kpi-label">ATR 百分位</span><span class="kpi-value">78%</span><span class="kpi-delta up">+8pt</span></div>
          <div class="kpi"><span class="kpi-label">BB 宽度</span><span class="kpi-value">4.6%</span><span class="kpi-delta up">+2.5pt</span></div>
          <div class="kpi"><span class="kpi-label">DVOL</span><span class="kpi-value">58.2</span><span class="kpi-delta up">+3.1</span></div>
          <div class="kpi"><span class="kpi-label">期限结构</span><span class="kpi-value" style="color:var(--ok)">升水</span><span class="kpi-delta">比值 0.94</span></div>
          <div class="kpi"><span class="kpi-label">主周期</span><span class="kpi-value">4H</span><span class="kpi-delta">已切换</span></div>
        </div>

        <div class="bubble">
          <div class="bubble-head">
            <span class="name">${agent.name}</span>
            <span>· 刚刚</span>
          </div>
          <div class="bubble-body">
            <p>老板早。<strong>4H BTC 正从布林收敛末端过渡到扩张初期</strong>，口径从 2.1% 扩到 4.6%；DVOL 同步抬升，不是假扩张。</p>
            <p>倾向结论：<strong style="color:var(--info)">趋势扩张期 · 偏多</strong>。但扩张初期追高性价比低，建议等待 15m/1H 级别的回踩入场。</p>
            <p>风险点：今晚 21:30 CPI 可能引发二次波动率跳变，若数据高于预期可能转入<strong style="color:var(--danger)">极端波动</strong>状态。</p>
          </div>
          <div class="suggestions">
            <span class="chip ok">建议顺势做多</span>
            <span class="chip">关注 63.8k 支撑回踩</span>
            <span class="chip warn">CPI 前减半仓</span>
            <span class="chip">设置 ATR × 1.5 止损</span>
          </div>
        </div>

        <div class="history-feed">
          <div class="card-title">历史发言 <span style="color:var(--muted-2)">近 20 条</span></div>
          ${[
            ["昨日 09:00", "收敛末端", "4H 布林口从 3.2% 收到 1.8%，DVOL 下滑，判断为盘整。"],
            ["昨日 14:30", "预警口径", "口径 1.8% 已触底，任何方向突破都可能产生扩张，注意准备。"],
            ["昨日 21:00", "首次扩张信号", "4H 收盘突破上轨，DVOL 反弹 5 点，切换判断为扩张初期。"],
            ["前日 10:00", "区间震荡期", "BB 宽度稳定在 2%，无趋势，等待突破。"],
            ["前日 18:00", "区间延续", "波幅未扩大，日内仍在 64.2k-65.1k 内波动。"],
            ["3 日前", "Bear 假突破", "下方假破 63.5k 后快速收回，Liquidity Grab。"],
          ].map(([t, s, full]) => `
            <div class="history-item">
              <span class="history-time">${t}</span>
              <span class="history-summary">${s}</span>
              <div class="history-full">${full}</div>
            </div>
          `).join("")}
        </div>

        <div class="ask-box">
          <textarea placeholder="追问环境评估员（回车发送，Shift+回车换行）" id="askInput"></textarea>
          <button class="btn primary" id="askSend">发送</button>
        </div>
      </aside>
    </div>
  `;
}

function renderEnvCharts() {
  const main = $("#mainChart");
  const atr = $("#atrChart");
  const vol = $("#volChart");
  if (!main) return;
  const rng = mulberry32(20260422);

  const N = 60;
  const W = 800, H = 360, PAD = 24;
  const candleW = (W - PAD * 2) / N * 0.65;
  const gap = (W - PAD * 2) / N;

  let price = 64500;
  const candles = [];
  for (let i = 0; i < N; i++) {
    const drift = Math.sin(i / 7) * 80 + (i > 42 ? (i - 42) * 25 : 0);
    const volAmt = 200 + Math.abs(Math.sin(i / 3)) * 300;
    const open = price;
    const close = price + (rng() - 0.45) * volAmt + (i > 42 ? 45 : 0);
    const high = Math.max(open, close) + rng() * 120;
    const low = Math.min(open, close) - rng() * 120;
    candles.push({ open, close, high, low });
    price = close + drift * 0.04;
  }
  const prices = candles.flatMap(c => [c.high, c.low]);
  const pMin = Math.min(...prices) - 100;
  const pMax = Math.max(...prices) + 100;
  const y = v => PAD + (1 - (v - pMin) / (pMax - pMin)) * (H - PAD * 2);

  const bb = [];
  for (let i = 0; i < N; i++) {
    const slice = candles.slice(Math.max(0, i - 19), i + 1).map(c => c.close);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const sd = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / slice.length);
    bb.push({ mid: mean, up: mean + 2 * sd, dn: mean - 2 * sd });
  }
  const ema20 = [];
  const ema50 = [];
  const k20 = 2 / 21, k50 = 2 / 51;
  candles.forEach((c, i) => {
    ema20.push(i === 0 ? c.close : ema20[i - 1] + k20 * (c.close - ema20[i - 1]));
    ema50.push(i === 0 ? c.close : ema50[i - 1] + k50 * (c.close - ema50[i - 1]));
  });

  const path = (arr, acc) => {
    return arr.map((v, i) => {
      const x = PAD + i * gap + gap / 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y(acc(v, i)).toFixed(1)}`;
    }).join(" ");
  };

  const grid = [0.2, 0.4, 0.6, 0.8].map(r => `<line x1="${PAD}" y1="${PAD + r * (H - PAD * 2)}" x2="${W - PAD}" y2="${PAD + r * (H - PAD * 2)}" class="svg-grid" stroke-dasharray="2 4"/>`).join("");

  const candleSVG = candles.map((c, i) => {
    const x = PAD + i * gap + gap / 2;
    const up = c.close >= c.open;
    const color = up ? "#10b981" : "#ef4444";
    return `
      <line x1="${x.toFixed(1)}" y1="${y(c.high).toFixed(1)}" x2="${x.toFixed(1)}" y2="${y(c.low).toFixed(1)}" stroke="${color}" stroke-width="1"/>
      <rect x="${(x - candleW / 2).toFixed(1)}" y="${y(Math.max(c.open, c.close)).toFixed(1)}" width="${candleW.toFixed(1)}" height="${Math.max(1, Math.abs(y(c.open) - y(c.close))).toFixed(1)}" fill="${color}" opacity="0.85"/>
    `;
  }).join("");

  main.innerHTML = `
    <defs>
      <linearGradient id="bbFill" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.08"/>
        <stop offset="100%" stop-color="#38bdf8" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${grid}
    <path d="${path(bb, v => v.up)} L${(PAD + (N - 1) * gap + gap / 2).toFixed(1)},${y(bb[N - 1].dn).toFixed(1)} ${bb.slice().reverse().map((v, i) => `L${(PAD + (N - 1 - i) * gap + gap / 2).toFixed(1)},${y(v.dn).toFixed(1)}`).join(" ")} Z" fill="url(#bbFill)" stroke="none"/>
    <path d="${path(bb, v => v.up)}" fill="none" stroke="#38bdf8" stroke-width="1" opacity="0.7" stroke-dasharray="3 3"/>
    <path d="${path(bb, v => v.dn)}" fill="none" stroke="#38bdf8" stroke-width="1" opacity="0.7" stroke-dasharray="3 3"/>
    <path d="${path(bb, v => v.mid)}" fill="none" stroke="#38bdf8" stroke-width="1.5"/>
    <path d="${path(ema20, v => v)}" fill="none" stroke="#a78bfa" stroke-width="1.5"/>
    <path d="${path(ema50, v => v)}" fill="none" stroke="#fbbf24" stroke-width="1.5" opacity="0.6"/>
    ${candleSVG}
  `;

  const atrVals = [];
  for (let i = 0; i < N; i++) {
    const tr = i === 0 ? candles[i].high - candles[i].low
      : Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
    atrVals.push(i === 0 ? tr : (atrVals[i - 1] * 13 + tr) / 14);
  }
  const aMax = Math.max(...atrVals);
  const aY = v => 50 - (v / aMax) * 45;
  atr.innerHTML = `
    <path d="${atrVals.map((v, i) => `${i === 0 ? "M" : "L"}${(i * 400 / N).toFixed(1)},${aY(v).toFixed(1)}`).join(" ")} L400,60 L0,60 Z" fill="rgba(56,189,248,0.14)"/>
    <path d="${atrVals.map((v, i) => `${i === 0 ? "M" : "L"}${(i * 400 / N).toFixed(1)},${aY(v).toFixed(1)}`).join(" ")}" fill="none" stroke="#38bdf8" stroke-width="1.5"/>
  `;

  const volBars = candles.map((c, i) => {
    const volV = 30 + Math.abs(c.close - c.open) * 0.8 + rng() * 20;
    const color = c.close >= c.open ? "#10b981" : "#ef4444";
    return `<rect x="${(i * 400 / N).toFixed(1)}" y="${(55 - volV * 0.4).toFixed(1)}" width="${(400 / N - 1).toFixed(1)}" height="${(volV * 0.4).toFixed(1)}" fill="${color}" opacity="0.6"/>`;
  }).join("");
  vol.innerHTML = `<line x1="0" y1="55" x2="400" y2="55" class="svg-axis"/>${volBars}`;
}
