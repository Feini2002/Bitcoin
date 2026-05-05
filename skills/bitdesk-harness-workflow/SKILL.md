---
name: bitdesk-harness-workflow
description: BitDesk project harness workflow for Codex development. Use when modifying, reviewing, debugging, or validating this Bit Trading Desk repository, especially when choosing lint/test/API/browser checks, preserving PLANNED placeholders, generating diff summaries, or improving static Pages-hosted frontend, Cloudflare Worker, chart, indicator, orderflow, or footprint behavior.
---

# BitDesk Harness Workflow

Use this skill to make Codex behave like a project-aware engineering harness for BitDesk.

## Start

1. Read `AGENTS.md`, `.cursorrules`, and the files directly related to the request.
2. Preserve unrelated user/Cursor edits and all unrelated `PLANNED` placeholders.
3. Identify the touched surface: static shell/Worker/API client, chart/indicators, orderflow/footprint, Cloudflare Worker, or pure UI.

## Edit

- Keep changes tightly scoped to the requested module.
- Prefer existing helpers and page patterns in `js/app.js`, `js/config.js`, `js/data-engine.js`, `js/pages/*`, `js/chart/*`, and `js/orderflow/*`.
- Do not replace visible API failures with fake market data.
- Use `apply_patch` for manual edits.

## Validate

Choose the smallest useful set:

- Any JavaScript change: `npm run lint`
- Indicator math or chart data calculations: `node scripts/verify-indicator-math.cjs`
- Orderflow, footprint aggregation, or Cloudflare footprint paths: `npm run verify:footprint`
- Static entry / Worker client wiring: `npm run verify:api`
- Cross-module changes: `npm run verify:all`
- Real kline diagnostics: `npm run diagnose`
- Final change summary: `npm run diff:summary`

If a validation fails, inspect the failure, patch the cause, and rerun the relevant command before reporting.

## Browser Check

For frontend changes, open the affected hash route on your deployed/static host (`/index.html#...`) with the in-app browser:

- `#chart` for行情/indicator work
- `#orderflow` for footprint/orderflow work
- `#settings` for API base/settings work
- `#boardroom` and agent routes for analysis-layer UI

Check desktop and narrow viewport when practical. Confirm the page is nonblank, controls do not overlap, canvas/chart areas render, and unrelated `PLANNED` labels remain.

## References

- Read `references/validation-matrix.md` when deciding validation commands.
- Read `docs/bitdesk-harness-guide.md` for the broader project map and troubleshooting notes.
