# E2E Test Suite Ready (`TEST_READY.md`)

**Status:** `READY`
**Verified At:** `2026-11-17T21:52:00Z`
**Spec:** [`TEST_INFRA.md`](./TEST_INFRA.md)
**Runner:** [`tests/e2e/run-tiers.mjs`](./tests/e2e/run-tiers.mjs)

---

## Summary of Capabilities & Coverage
- **85 Opaque-Box Playwright E2E Tests** (`playwright-core` + `/usr/bin/chromium`, COOP/COEP `window.crossOriginIsolated === true`):
  - **Tier 1 (Feature Coverage):** `36` tests (`6` per area across `CORE`, `PERF`, `FS`, `APP`, `NET`, `SYS`)
  - **Tier 2 (Boundary & Corner Cases):** `30` tests (`5` per area)
  - **Tier 3 (Cross-Feature Combinations):** `12` tests
  - **Tier 4 (Real-World Application Scenarios):** `7` tests
- **Complete Feature Coverage:** Covers all 28 runtime user-facing capabilities (`#4`–`#6`, `#8`–`#10`, `#12`–`#33`) from `PROJECT.md` within documented CheerpX 1.4.0 hard limits.
- **Verification Gate Results:**
  - `M1`: **5/5 PASS (100%)** against `./build`
  - `M2`: **19/19 PASS (100%)** against `./build`
  - `M4` & `M5`: **0 false passes** on unimplemented features (`T2-SYS-05` fails cleanly with exit `1`)
  - CLI validation (`--unknown-flag`, invalid `--tier`/`--port`/`--static-dir`, 0 matched tests) exits `1` cleanly; process-group cleanup leaves `0` orphaned server processes.

## Recommended Usage for Milestone 6 (Final E2E Pass)
```bash
# Build static bundle first, then run sequentially by tier against ./build:
npm run build
node tests/e2e/run-tiers.mjs --static-dir ./build --tier 1 --action-timeout 6000
node tests/e2e/run-tiers.mjs --static-dir ./build --tier 2 --action-timeout 6000
node tests/e2e/run-tiers.mjs --static-dir ./build --tier 3 --action-timeout 6000
node tests/e2e/run-tiers.mjs --static-dir ./build --tier 4 --action-timeout 6000
```
*(Note: `--action-timeout 6000` is recommended during cold CheerpX Wasm initialization under CPU load; `vite dev` auto-start mode currently hits a pre-existing `vite.config.js` `esbuild` top-level-await pre-bundling error on `@leaningtech/cheerpx`, so `--static-dir ./build` is the primary verified execution path.)*
