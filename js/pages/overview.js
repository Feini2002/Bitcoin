/* =======================================================
   页面：概览 Dashboard
   ======================================================= */
function pageOverview() {
  const saySamples = [
    "趋势扩张期，4H 布林口张开，ATR 百分位 78%",
    "65.2k 上方 POC 堆积，下方流动性池在 63.8k",
    "BTC Funding +0.012%，OI 过去 6h 上涨 4.3%，多头略拥挤",
    "账户风险占用 18%，今日 PnL +0.8%，可开仓 1.2% 风险",
    "综合倾向：逢回踩支撑做多，止损 63.7k，目标 66.5k",
  ];
  return html`
    <header class="page-header">
      <div>
        <h1 class="page-title">今日决策一屏</h1>
        <div class="page-sub">所有员工的关键指标与一句话结论聚合</div>
      </div>
      <div class="status-pill"><span class="dot ok"></span>5 位员工在线</div>
    </header>

    <div class="dash-grid">
      <div class="card w-6 dash-advice">
        <div class="card-title">首席策略官 · 今日综合建议</div>
        <div class="big-number" style="color:var(--warn)">谨慎做多 · 试仓 30%</div>
        <div style="color:var(--muted); font-size:var(--fz-sm); margin-top:8px; line-height:1.6;">
          4H 处于扩张初期，盘口在 65.2k-65.4k 存在强烈买压堆积；衍生品资金费率中性略偏多，风控评分 B+，<strong style="color:var(--text)">建议 30% 仓位试多，止损 63.7k</strong>。
        </div>
      </div>

      <div class="card w-2"><div class="card-title">BTC 现价</div><div class="big-number">64,820</div><div class="kpi-delta up"><i class="ph ph-arrow-up-right"></i> 1.24%  24H</div></div>
      <div class="card w-2"><div class="card-title">波动率状态</div><div class="big-number" style="color:var(--info); font-size:var(--fz-xl)">趋势扩张期</div><div class="kpi-delta">ATR百分位 78%</div></div>
      <div class="card w-2"><div class="card-title">风控评分</div><div class="big-number" style="color:var(--ok)">B+</div><div class="kpi-delta">可开仓风险 1.2%</div></div>

      <div class="card w-3">
        <div class="card-title">四位专员 · 一句话汇报</div>
        ${AGENTS.filter(a => a.id !== "chief").map((a, i) => `
          <div class="agent-oneliner">
            <div class="mini-avatar" style="background:${a.color}">${a.short}</div>
            <div>
              <span class="ol-name">${a.name}</span>
              <div class="ol-say">${saySamples[i + 1] || "--"}</div>
            </div>
          </div>
        `).join("")}
      </div>

      <div class="card w-3">
        <div class="card-title">今日关键事件</div>
        <div class="cal-row"><span class="cal-date">今日 21:30</span><span class="cal-flag" style="color:var(--danger)">US</span><span class="cal-desc">美国 CPI 数据公布</span><span class="cal-imp">高</span></div>
        <div class="cal-row"><span class="cal-date">明日 02:00</span><span class="cal-flag" style="color:var(--warn)">FED</span><span class="cal-desc">FOMC 会议纪要</span><span class="cal-imp">高</span></div>
        <div class="cal-row"><span class="cal-date">+2D</span><span class="cal-flag">BTC</span><span class="cal-desc">ARB 代币解锁 $2.3亿</span><span class="cal-imp">中</span></div>
        <div class="cal-row"><span class="cal-date">+3D</span><span class="cal-flag">US</span><span class="cal-desc">初请失业金</span><span class="cal-imp">低</span></div>
      </div>
    </div>
  `;
}
