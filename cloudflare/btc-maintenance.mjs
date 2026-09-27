// Cloud-only pause module. Never migrate or delete stored business data.
const paused = () => new Response(JSON.stringify({ ok: false, paused: true }), {
  status: 503,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});
class PausedCollector {
  constructor(state) {
    this.state = state;
    state.blockConcurrencyWhile(() => state.storage.deleteAlarm());
  }
  async alarm() { await this.state.storage.deleteAlarm(); }
  fetch() { return paused(); }
}
export class LiquidationCollector extends PausedCollector {}
export class KlineLiveCollector extends PausedCollector {}
export default {
  fetch() { return paused(); },
  async scheduled() {},
};
