# Validation Matrix

Use this reference when a BitDesk task touches more than one area.

| Change area | Primary files | Validation |
| --- | --- | --- |
| Syntax / shared JS | `js/**/*.js`, `cloudflare/**/*.js`, `scripts/**/*.cjs` | `npm run lint` |
| Chart indicators | `js/chart/indicator-math.js`, `js/pages/chart.js` | `node scripts/verify-indicator-math.cjs` |
| Footprint/orderflow | `js/orderflow/*`, `js/pages/orderflow.js`, `cloudflare/binance-klines-worker.js` | `npm run verify:footprint` |
| Static shell / Worker HTTP | `index.html`, `js/app.js`, `js/data-engine.js`, `scripts/smoke-api.cjs` | `npm run verify:api` (default probes deployed btc Worker); `npm run diagnose` when Binance ↔ Worker probes matter |
| Cloudflare Worker | `cloudflare/binance-klines-worker.js`, `cloudflare/schema.sql`, `cloudflare/wrangler.toml` | `npm run lint`; `npm run verify:footprint` for footprint paths |
| Frontend UI | `index.html`, `styles.css`, `js/pages/*` | `npm run lint`; in-app browser screenshot on affected route |
| Broad refactor | Multiple areas | `npm run verify:all` plus browser check |

Always run `npm run diff:summary` before the final reply. If the folder is not a git repo, manually list changed files.
