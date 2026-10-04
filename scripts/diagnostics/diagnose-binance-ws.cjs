// Public, credential-free endpoint comparison. Each socket has a 20s deadline.
const fs = require('node:fs');
async function probe(route) {
  return new Promise(resolve => {
    const url = `wss://fstream.binance.com/${route}stream?streams=btcusdt@aggTrade/btcusdt@kline_1m`;
    const result = { url, opened: false, messages: 0, types: [], elapsedMs: 0 };
    const started = Date.now();
    const socket = new WebSocket(url);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      result.elapsedMs = Date.now() - started;
      try { socket.close(); } catch {}
      console.log(JSON.stringify(result));
      resolve(result);
    };
    const timer = setTimeout(finish, 20000);
    socket.onopen = () => { result.opened = true; };
    socket.onmessage = event => {
      try {
        const payload = JSON.parse(event.data);
        const data = payload.data || payload;
        if (data.s !== 'BTCUSDT' || !['aggTrade', 'kline'].includes(data.e)) return;
        result.messages++;
        if (!result.types.includes(data.e)) result.types.push(data.e);
        if (result.types.length === 2) finish();
      } catch {}
    };
    socket.onerror = () => { result.error = 'transport_error'; finish(); };
    socket.onclose = finish;
  });
}
const hardDeadline = setTimeout(() => process.exit(2), 25000);
Promise.all([probe(''), probe('market/')]).then(results => {
  fs.mkdirSync('.artifacts/binance-connectivity', { recursive: true });
  fs.writeFileSync('.artifacts/binance-connectivity/ws-comparison.json', JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
  clearTimeout(hardDeadline);
  process.exit(results[1].types.length === 2 ? 0 : 1);
});
