// Read-only production acceptance: compare closed source bars with the desk's actual read path.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const origin = process.env.BITDESK_SMOKE_ORIGIN || 'https://btc.feiniwork.com';
const baselineIndex = process.argv.indexOf('--baseline');
const baseline = baselineIndex >= 0 ? JSON.parse(fs.readFileSync(process.argv[baselineIndex + 1], 'utf8')) : null;
const output = path.resolve(__dirname, '../../.artifacts/plans');

async function get(route) {
  const response = await fetch(new URL(route, origin), { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, route);
  return { data: await response.json(), source: response.headers.get('x-data-source') };
}

async function main() {
  const comparisons = [];
  for (const interval of ['5m', '15m', '1h', '4h']) {
    const [desk, upstream] = await Promise.all([
      get('/api/desk/chart?interval=' + interval + '&tail=200'),
      get('/api/binance/klines?symbol=BTCUSDT&interval=' + interval + '&limit=100'),
    ]);
    assert.equal(upstream.source, 'binance-fapi', interval + ' source');
    assert.equal(desk.data.pricePathAvailable, true, interval + ' live read path');
    const closed = upstream.data.filter(row => Number(row[6]) < Date.now() - 15000);
    const targets = new Set(closed.slice(-9).map(row => Number(row[0])));
    const oldDifferences = baseline?.comparisons.find(row => row.interval === interval)?.differences || [];
    for (const item of oldDifferences) targets.add(Number(item.t));
    const sourceRows = new Map(closed.map(row => [Number(row[0]), row]));
    const deskRows = new Map(desk.data.series.map(row => [Number(row.t), row]));
    const differences = [];
    for (const timestamp of targets) {
      const expected = sourceRows.get(timestamp), actual = deskRows.get(timestamp);
      if (!expected || !actual) {
        differences.push({ t: timestamp, missing: !expected ? 'source-window' : 'desk' });
        continue;
      }
      for (const [field, column] of [['o', 1], ['h', 2], ['l', 3], ['c', 4], ['v', 5]]) {
        if (Number(actual[field]) !== Number(expected[column])) differences.push({ t: timestamp, field, desk: actual[field], source: expected[column] });
      }
    }
    comparisons.push({ interval, checked: targets.size, historicalTargets: new Set(oldDifferences.map(row => row.t)).size, differences });
  }
  const [status, live, datasets] = await Promise.all([
    get('/api/d1/status'), get('/api/d1/klines/live'), get('/api/finance/datasets'),
  ]);
  if (process.env.BITDESK_EXPECTED_WORKER_BUILD) assert.equal(status.data.workerBuild, process.env.BITDESK_EXPECTED_WORKER_BUILD, 'deployed Worker version');
  const evidence = { at: new Date().toISOString(), workerBuild: status.data.workerBuild,
    scope: 'Closed recent bars and optional baseline discrepancies only; not a full database audit or long-term stability claim.',
    comparisons, collector: live.data.collector, datasets: datasets.data };
  fs.mkdirSync(output, { recursive: true });
  const filename = path.join(output, 'governance-correctness-live-' + Date.now() + '.json');
  fs.writeFileSync(filename, JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ filename, workerBuild: evidence.workerBuild, comparisons }));
  assert(comparisons.every(row => row.checked >= 9 && row.differences.length === 0), 'closed bars must match source, including baseline discrepancies');
  console.log('PASS production closed-bar correctness and baseline repair');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
