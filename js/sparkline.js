/* 小型 sparkline 生成 —— 给 KPI 卡做趋势示意用 */
function renderSparkline(seed, color) {
  const rng = mulberry32(seed);
  const N = 24;
  const values = [];
  let v = 50;
  for (let i = 0; i < N; i++) {
    v += (rng() - 0.5) * 18;
    values.push(v);
  }
  const min = Math.min(...values), max = Math.max(...values);
  const norm = values.map(x => 40 - ((x - min) / (max - min || 1)) * 32);
  const pts = norm.map((y, i) => `${(i / (N - 1)) * 120},${4 + y}`).join(" ");
  return `<svg viewBox="0 0 120 48" preserveAspectRatio="none" style="width:100%; height:48px;">
    <polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts}" opacity="0.9"/>
    <polyline fill="${color}22" stroke="none" points="${pts} 120,48 0,48" opacity="0.6"/>
  </svg>`;
}
