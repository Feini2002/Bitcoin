---
name: bit-trading-desk
description: Project-specific workflow for the Bit Trading Desk / crypto data monitoring system. Use when Codex modifies, reviews, diagnoses, or plans work in this repository, especially files under js/, scripts/, cloudflare/, index.html, styles.css, or when handling PLANNED placeholders, market data APIs, indicator math, footprint/orderflow, Binance/Deribit/FRED/Yahoo data, Cloudflare workers, or static Pages-hosted frontend behavior.
---

# Bit Trading Desk

## Core Rule

Treat this as a small, practical trading decision and data-monitoring system, not an institutional research platform. Prefer focused, maintainable changes that keep the existing module boundaries and user workflow intact.

The user also uses Cursor on this project. Do not delete, rename, or rewrite `.cursorrules`; read it with UTF-8 when needed:

```powershell
Get-Content -Encoding UTF8 .cursorrules
```

## Repository Map

- `index.html`, `styles.css`: main shell and shared UI styling.
- `js/app.js`, `js/nav.js`, `js/config.js`, `js/data-engine.js`: app shell, navigation, config, data orchestration and Worker-facing `fetch` calls.
- `js/pages/`: feature pages such as overview, chart, orderflow, news, settings, calculator, environment agent, boardroom.
- `js/chart/`: chart widgets, multi-timeframe tiles, indicator panes, indicator math.
- `js/orderflow/`: footprint/orderflow engine and canvas rendering.
- `scripts/`: deterministic diagnostics and verification scripts.
- `cloudflare/`: worker and D1 schema for remote/public data paths.
- `旧参考文件/`: reference material only; do not migrate or delete unless explicitly asked.

## Cursor Rules To Preserve

Follow these project rules even when `.cursorrules` is not loaded:

- Do not casually remove demo, placeholder, reserved, or PLANNED UI/code structures.
- When the user asks to implement one module, modify only that module's implementation surface.
- Keep other modules' PLANNED labels, placeholder UI, and reserved comments unchanged.
- Inside the active module, remove a PLANNED marker only for the exact functionality that is fully implemented and usable.
- If the user asks for a plan or planning work and the module/scope is unclear, confirm the module and planned scope before editing.

## Work Style

- Start by inspecting the relevant files with `rg` / `rg --files` and small targeted reads.
- Keep changes scoped. Avoid broad cleanup, formatting churn, or architecture changes unless the task requires them.
- Assume the worktree may contain Cursor/user edits. Preserve unrelated changes and adapt to nearby edits.
- Use PowerShell-safe paths because the workspace path contains spaces and Chinese characters.
- Use `apply_patch` for manual file edits.
- Reply to the user in Chinese unless they ask otherwise.

## Data Source Preferences

Prefer stable public/official sources before fragile scraping:

- Crypto market microstructure: Binance public API/WebSocket, Deribit public API.
- Macro/liquidity/credit: FRED API when available.
- Traditional market tickers such as VIX/MOVE: Yahoo-style endpoints are acceptable but treat them as unofficial and add fallback/error handling.
- Cloudflare worker paths should stay compatible with `cloudflare/wrangler.toml` and `cloudflare/schema.sql`.
- Search/news should be used for qualitative cross-checking, not as the primary time-series source.

When API behavior, laws, prices, schedules, or current market facts matter, verify current information from primary/official sources.

## Verification

Choose the smallest useful verification set:

- Deployment gate: this system is fully deployed; after modifying any repository content, run `npm.cmd run build` before deployment. In this static app, `build` is the full verification gate (`verify:all`).
- Server/data path changes: `npm run verify:api` for static-shell checks (`BITDESK_SMOKE_ORIGIN` optional Worker probe), and `npm run diagnose` for Binance vs deployed Worker `/api/d1/klines` reachability (see `BITDESK_KLINE_API_BASE`).
- Indicator math changes: `node scripts/verify-indicator-math.cjs`.
- Footprint/orderflow changes: `npm run verify:footprint`.
- Frontend UI changes: inspect the affected route on deployed Pages (or another static host) when practical.
- Cloudflare worker/schema changes: validate syntax/config locally where possible before suggesting deployment.
- After any change, deploy affected surfaces: `npm.cmd run deploy:pages` for frontend/static/docs/rules/scripts/shared logic; `npx.cmd wrangler deploy` from `cloudflare/` for Worker changes; run both when both surfaces are affected, Worker first.

If a relevant verification cannot be run, say why in the final response.
