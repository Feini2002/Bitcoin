const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
(async () => {
  const { __footprintTestHooks: hooks } = await import(pathToFileURL(require('node:path').resolve(__dirname, '../cloudflare/binance-klines-worker.js')));
  const originalFetch = global.fetch;
  try {
    for (const [interval, count, step] of [['5m', 6500, 300000], ['1w', 368, 604800000], ['3d', 2501, 86400000]]) {
      const rows = Array.from({length:count}, (_, i) => [String(1420070400000+i*step), String(100+i), String(102+i), String(99+i), String(101+i), '1']);
      let pages = 0, primaryCalls = 0, initialPrimaryCalls = 0;
      global.fetch = async target => {
        const url = new URL(target);
        if (!url.hostname.includes('bybit')) { primaryCalls++; return new Response('restricted', {status:403}); }
        if (!pages) initialPrimaryCalls = primaryCalls;
        pages++;
        const end = Number(url.searchParams.get('end'));
        const list = rows.filter(r => Number(r[0]) <= end).slice(-Number(url.searchParams.get('limit'))).reverse();
        return Response.json({retCode:0,result:{list}});
      };
      const result = await hooks.fetchKlineHistory({ KLINE_ALTERNATE_FAILOVER: '1' }, 'BTCUSDT', interval);
      assert.equal(result.ok, true);
      assert.equal(result.source, 'bybit-failover');
      assert.equal(new Set(result.klines.map(r=>r[0])).size, result.klines.length);
      assert.ok(result.klines.every((r,i,a)=>i===0||Number(r[0])>Number(a[i-1][0])));
      if (interval==='5m') { assert.equal(result.klines.length,6000); assert.equal(Number(result.klines[0][1]),600); assert.equal(pages,6); }
      if (interval==='1w') { assert.equal(result.klines.length,368); assert.equal(result.historyExhausted,true); }
      if (interval==='3d') {
        for (const bar of result.klines) {
          const days=rows.filter(r=>Math.floor(Number(r[0])/259200000)*259200000===Number(bar[0]));
          assert.equal(Number(bar[1]),Number(days[0][1]));
          assert.equal(Number(bar[4]),Number(days.at(-1)[4]));
          assert.equal(Number(bar[5]),days.length);
        }
      }
      assert.ok(primaryCalls===initialPrimaryCalls, 'do not retry failed primary on every page');
      console.log('PASS history '+interval+' bars='+result.klines.length+' pages='+pages);
    }
    global.fetch = async target => {
      const url = new URL(target);
      if (!url.hostname.includes('bybit')) return new Response('restricted', {status:403});
      return Response.json({retCode:0,result:{list:[['1420070400000','1','1','1','1','1']]}});
    };
    const blocked = await hooks.fetchKlineHistory({}, 'BTCUSDT', '15m');
    assert.equal(blocked.ok, false);
    assert.notEqual(blocked.source, 'bybit-failover');
    console.log('PASS analysis path does not failover to Bybit by default');
  } finally { global.fetch=originalFetch; }
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE klines(symbol TEXT,interval TEXT,t INTEGER,o REAL,h REAL,l REAL,c REAL,v REAL,PRIMARY KEY(symbol,interval,t))');
    const env={DB:{prepare(sql){return {bind(...args){return {run:async()=>({meta:db.prepare(sql).run(...args)})}}}},batch:async stmts=>Promise.all(stmts.map(s=>s.run()))}};
    const rows=Array.from({length:6005},(_,i)=>[i*600000,1,2,0,1,3]);
    await hooks.persistKlines(env,'BTCUSDT','5m',rows);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM klines').get().n,6000);
    assert.equal(db.prepare('SELECT MIN(t) AS t FROM klines').get().t,3000000);
    await hooks.persistKlines(env,'BTCUSDT','5m',[[6005*600000,1,2,0,1,3]]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM klines').get().n,6000);
    console.log('PASS retain exactly 6000 with gaps and new candles');
  } finally { db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
