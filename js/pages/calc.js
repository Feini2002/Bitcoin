/* =======================================================
   页面：仓位与风险计算器
   ======================================================= */
function pageCalc() {
  return html`
    <header class="page-header">
      <div>
        <h1 class="page-title">仓位与风险计算器</h1>
        <div class="page-sub">按账户规模 + 单笔可承受风险，反推仓位/杠杆/保证金</div>
      </div>
      <span class="chip warn">公式待接入 · 占位</span>
    </header>

    <div class="calc-layout">
      <div class="card">
        <div class="card-title">交易参数</div>
        <div class="form-row"><label>账户余额 USDT</label><input type="number" value="50000" /></div>
        <div class="form-row"><label>单笔风险 %</label><input type="number" value="1.0" /><span class="unit">建议 0.5% ~ 2%</span></div>
        <div class="form-row"><label>入场价格</label><input type="number" value="64200" /></div>
        <div class="form-row"><label>止损价格</label><input type="number" value="63700" /></div>
        <div class="form-row"><label>方向</label>
          <div style="display:flex; gap:8px;">
            <span class="chip active">做多</span>
            <span class="chip">做空</span>
          </div>
        </div>
        <div class="form-row"><label>最大可承受杠杆</label><input type="number" value="20" /></div>
      </div>

      <div>
        <div class="result-panel">
          <div class="card-title">计算结果</div>
          <div class="result-item"><span class="result-label">止损距离</span><span class="result-value">500 USDT (0.78%)</span></div>
          <div class="result-item"><span class="result-label">允许亏损</span><span class="result-value">500 USDT</span></div>
          <div class="result-item"><span class="result-label">建议仓位</span><span class="result-value big">1.00 BTC</span></div>
          <div class="result-item"><span class="result-label">名义价值</span><span class="result-value">64,200 USDT</span></div>
          <div class="result-item"><span class="result-label">所需保证金 @ 20x</span><span class="result-value">3,210 USDT</span></div>
          <div class="result-item"><span class="result-label">强平价（参考）</span><span class="result-value" style="color:var(--danger)">61,030 USDT</span></div>
        </div>
        <div class="card" style="margin-top:var(--sp-4)">
          <div class="card-title">风控官备注</div>
          <div style="font-size:var(--fz-sm); color:var(--muted); line-height:1.6;">
            • 当前单笔 1% 风险建议合理；<br>
            • 杠杆 20x 对应强平距离与止损距离存在 2.8x 缓冲，可接受；<br>
            • 若今日账户累计风险已 &gt;3%，建议本笔降至 0.5%。
          </div>
        </div>
      </div>
    </div>
  `;
}
