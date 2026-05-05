/* =======================================================
   页面：会议室
   ======================================================= */
function pageBoardroom() {
  const feeds = [
    { id: "env", t: "09:02", text: "4H 已进入趋势扩张期，BB 宽度从 2.1% 扩到 4.6%，VIX/MOVE 未出现极端冲击。方向偏多。", ev: ["4H 主图", "BB 宽度曲线", "宏观旁路"] },
    { id: "flow", t: "09:04", text: "上方 65.2k-65.4k 是昨日 VAH 堆积区，下方 63.8k 存在未触及的流动性池，昨晚 SFP 下影已形成。", ev: ["足迹图", "VP 分布", "强平雷达"] },
    { id: "deriv", t: "09:06", text: "BTC Funding +0.012%，OI 过去 6h +4.3%，主动买盘略占优，Top Trader 偏多但未极端。", ev: ["资金费率", "OI 变化", "主动买卖量"] },
    { id: "risk", t: "09:08", text: "账户当前风险占用 18%，本日 PnL +0.8%，最大可开仓对应 1.2% 风险。CPI 前建议仓位不超 30%。", ev: ["账户快照", "风控评分"] },
    { id: "chief", t: "09:12", text: "综合四位结论：环境偏多、流动性利于回踩做多、衍生品未极端、风控允许。建议 30% 试仓，入场 63.9-64.2k，止损 63.7k，目标 66.5k。若 CPI 高于预期即清仓待定。", ev: ["综合决策"] },
  ];
  const seatAngles = [
    { id: "env", deg: -150 },
    { id: "flow", deg: -120 },
    { id: "chief", deg: -90 },
    { id: "deriv", deg: -60 },
    { id: "risk", deg: -30 },
  ];
  const seats = seatAngles.map(s => {
    const a = AGENT_MAP[s.id];
    const rad = s.deg * Math.PI / 180;
    const x = 50 + Math.cos(rad) * 36;
    const y = 55 + Math.sin(rad) * 36;
    return `
      <div class="seat" style="left:${x}%; top:${y}%;">
        <div class="seat-avatar" style="background:${a.color}">${a.short}</div>
        <div class="seat-name">${a.name}</div>
        <div class="seat-line">${feeds.find(f => f.id === s.id)?.text.slice(0, 28) || ""}…</div>
      </div>
    `;
  }).join("");

  return html`
    <header class="page-header">
      <div>
        <h1 class="page-title">晨会 · 会议室</h1>
        <div class="page-sub">老板与 5 位员工的每日交班</div>
      </div>
      <button class="btn primary">召集新一次会议</button>
    </header>

    <div class="boardroom">
      <div class="brief-card">
        <div class="brief-row">
          <div>
            <div class="brief-date">2026-04-22 · WED · 09:15</div>
            <div class="brief-summary" style="margin-top:6px;">
              今日市场进入 <em>趋势扩张期</em>，倾向偏多但需防 CPI 波动。建议 <em>30% 试多</em>，入场回踩 63.9-64.2k，止损 63.7k。
            </div>
          </div>
          <div class="brief-keywords">
            <span class="chip warn">CPI 风险</span>
            <span class="chip">回踩做多</span>
            <span class="chip">63.7k 止损</span>
          </div>
        </div>
      </div>

      <div class="round-table">
        <div class="card-title">围桌 · 老板与 5 位员工</div>
        <div class="table-surface">
          ${seats}
          <div class="seat boss" style="left:50%; top:92%;">
            <div class="seat-avatar">老</div>
            <div class="seat-name">老板</div>
            <div class="seat-line">接收 · 质询</div>
          </div>
        </div>
      </div>

      <div class="feed-col">
        <div class="feed-head">
          <div class="feed-title">发言时间线</div>
          <span class="chip">晨会</span>
        </div>
        <div class="feed-list">
          ${feeds.map(f => {
            const a = AGENT_MAP[f.id];
            return `
              <div class="msg ${f.id === "chief" ? "chief" : ""}">
                <div class="msg-avatar" style="background:${a.color}">${a.short}</div>
                <div class="msg-body">
                  <div class="msg-head">
                    <span class="msg-name">${a.name}</span>
                    <span class="msg-time">${f.t}</span>
                    ${f.id === "chief" ? '<span class="msg-badge">首席发言</span>' : ""}
                  </div>
                  <div class="msg-text">${f.text}</div>
                  <div class="msg-evidence">
                    ${f.ev.map(e => `<span class="ev-chip"><i class="ph ph-link"></i> ${e}</span>`).join("")}
                  </div>
                </div>
              </div>
            `;
          }).join("")}
        </div>

        <div class="boss-ask">
          <div class="boss-ask-head">
            <span style="font-size:var(--fz-sm); color:var(--muted)">追问：</span>
            <select id="askTarget">
              <option value="all">所有员工</option>
              ${AGENTS.map(a => `<option value="${a.id}">${a.name}</option>`).join("")}
            </select>
          </div>
          <textarea placeholder="老板，请在此质询或提出新任务（回车发送）"></textarea>
          <div style="display:flex; justify-content:flex-end;">
            <button class="btn primary">发送追问</button>
          </div>
        </div>
      </div>
    </div>
  `;
}
