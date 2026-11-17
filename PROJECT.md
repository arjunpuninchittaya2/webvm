# Project: WebVM Linux Workstation Enhancement & Chromebook Optimization

## Architecture
WebVM is a browser-based 32-bit x86 (`i386`) Linux workstation built on **SvelteKit 2 + Svelte 4 + TailwindCSS 3 + Vite 5** (`@sveltejs/adapter-static`), wrapping **@leaningtech/cheerpx@1.4.0** (x86-to-Wasm JIT + Linux syscall emulator) and **@xterm/xterm@5.5.0**.

### Target Modular Architecture
To eliminate monolithic coupling in `src/lib/WebVM.svelte` and support Chromebook efficiency + multi-module ownership:
1. **VM Core & Lifecycle (`src/lib/vm/`)**:
   - `vmManager.js`: Parallelized CheerpX initialization (`IDBDevice`, `OverlayDevice`, `DataDevice`, `WebDevice`, `FileDevice`, `HttpBytesDevice`, `CloudDevice`, `GitHubDevice`), CheerpX 1.4.0 API adapter, multi-session `cx.run(...)` process tracking, `onDestroy` cleanup.
   - `terminalIO.js`: UTF-8 `TextEncoder` input chunking, `requestAnimationFrame`-batched `term.write` ring buffer, PTY resize sync, OSC-52 clipboard handler.
   - `telemetry.js`: Zero-churn CPU/disk telemetry aggregator (fixed ring buffers, single coalesced update timer, visibility-aware throttling, `navigator.storage.estimate()`).
2. **Host ↔ VM Storage & File Bridge (`src/lib/fs/`)**:
   - `fileBridge.js`: Host→VM upload (`DataDevice.writeFile` + persistent workspace `IDBDevice` at `/home/user/workspace` or `/workspace` with `+x` staging helper), VM→Host download (`IDBDevice.readFileAsBlob`), drag-and-drop import, workspace/snapshot export & import.
   - `archiveHelper.js`: Client-side archive/package inspection and staging helpers (`.tar`, `.tar.gz`, `.zip`, binary staging).
3. **App Downloader, Launcher & Network (`src/lib/apps/`, `src/lib/network.js`)**:
   - `downloader.js`: Browser `fetch` bridge (CORS-enabled URLs, GitHub releases/raw, PyPI/npm tarballs, optional user-configured CORS proxy) writing directly into VM storage with SHA-256 verification and executable staging.
   - `appCatalog.js`: Curated Chromebook-friendly small apps, scripts, and runtime profiles + 1-click launcher/runner.
   - `network.js`: Enhanced Tailscale/Headscale configuration, disconnect/peer state, `DirectSocketsNetwork` detection, and local web-app preview helper.
4. **Desktop/Workstation UI (`src/lib/components/`, `src/lib/stores/`)**:
   - `stores/settings.js`: `localStorage`-backed preferences (font size/family, theme, scrollback, WebGL/DOM renderer, cursor blink, power-saver mode, sidebar pin, VM boot profile).
   - `stores/sessions.js`: Multi-terminal tabs/split state, VT1↔VT7 toggle, active process/service list, toast notifications.
   - Modular Sidebar Tabs & Overlays: File Manager, Code/File Editor, App Store/Downloader, Process & System Monitor, Boot/Profile Settings, Networking, Disk/Snapshots, Lazy-loaded Claude AI.
5. **E2E & Unit Test Suite (`tests/`)**:
   - `tests/unit/`: Vitest unit/component tests for all pure modules, Svelte stores/components, service worker, build config, and offline SSR resilience.
   - `tests/e2e/`: Playwright (`playwright-core` + `/usr/bin/chromium`) browser tests served with COOP/COEP headers (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`).

### CheerpX / Browser Hard Limits (Explicitly Documented Exceptions)
- **32-bit x86 (`i386`) user-mode only**: No `x86_64`/ARM binaries, no kernel modules (`insmod`/eBPF), no Docker/KVM nested virtualization.
- **Software 2D KMS rendering**: No hardware 3D/OpenGL/Vulkan GPU passthrough.
- **Browser Socket Sandbox**: No raw ICMP `ping` or unproxied raw TCP/UDP sockets from inside x86 processes without Tailscale / Exit Node / Chrome IWA `DirectSocketsNetwork`; host-side HTTP fetch bridge handles CORS-accessible downloads into the VM filesystem.
- **Ext2 / Browser Quotas**: Ext2 root image max 2GB (`950M` GitHub chunk workflow); `IDBDevice` constrained by browser origin storage quota; requires COOP/COEP (`window.crossOriginIsolated`).

---

## Code Layout
- `src/app.html`, `src/lib/global.css`, `serviceWorker.js` — App shell, fonts/analytics, COI + Cache Service Worker
- `src/routes/+layout.server.js`, `src/routes/+page.svelte`, `src/routes/alpine/+page.svelte` — SvelteKit routes & SSR data
- `src/lib/WebVM.svelte`, `src/lib/SideBar.svelte`, `src/lib/Icon.svelte`, `src/lib/*Tab.svelte` — Main UI shell and tabs
- `src/lib/vm/` — VM lifecycle, terminal I/O batching, telemetry, multi-session runner
- `src/lib/fs/` — Persistent workspace bridge, file upload/download, snapshot export/import
- `src/lib/apps/` — Browser HTTP/package downloader bridge, app catalog, 1-click runner
- `src/lib/stores/` — Persistent settings, session/VT state, notifications, monitor stores
- `src/lib/network.js`, `src/lib/anthropic.js` — Networking and lazy-loaded Claude AI integration
- `config_public_terminal.js`, `config_public_alpine.js`, `config_github_terminal.js` — Runtime VM presets
- `vite.config.js`, `postcss.config.js`, `package.json`, `svelte.config.js` — Build, CSS icon pruning, scripts
- `dockerfiles/` — Custom i386 Debian image definitions
- `tests/unit/`, `tests/e2e/` — Vitest unit tests and Playwright E2E test suite
- `README.md` — Continuously updated user & developer documentation

---

## Feature Inventory
Every Survey feature, bug, bottleneck, and missing Linux OS capability assigned to a milestone (none unassigned).

| # | Feature / Fix | Description | Milestone | Source |
|---|---------------|-------------|-----------|--------|
| 1 | `.gitignore` `.agents/` exclusion & clean git | Add `.agents/` to `.gitignore`; keep working tree clean with focused commits | M1 | survey_1 |
| 2 | Dependency install & test harness setup | Run `npm install`; add `vitest`, `svelte-check`, `playwright-core` (`/usr/bin/chromium`), COOP/COEP test server | M1 | survey_1,3 |
| 3 | Verify CheerpX 1.4.0 `.d.ts` APIs | Inspect `node_modules/@leaningtech/cheerpx/index.d.ts` after install & record exact API surface | M1 | survey_1,2,3 |
| 4 | Offline-resilient `+layout.server.js` | Wrap blog `fetch` in `Promise.allSettled` + timeout + fallback; remove unused `read` import | M1 | survey_1,2,3 |
| 5 | Fix `serviceWorker.js` crashes + caching | Fix `r.status` on `undefined` & `catch` `ReferenceError: e`; add Cache API caching for static assets | M1 | survey_2,3 |
| 6 | Fix `postcss.config.js` icon stripping | Restore `.fa-robot` and support all icons used across UI without silent stripping | M1 | survey_1,2,3 |
| 7 | Build bloat & dead code cleanup | Remove unused root `xterm/` (300KB); exclude README-only `assets/` (~8.3MB) from `viteStaticCopy`; optimize hero image | M1 | survey_1,2,3 |
| 8 | Non-blocking head & font loading | Defer/async `plausible` script, remove render-blocking Google Fonts `@import` / add local fallback | M1 | survey_2,3 |
| 9 | Fix social counter cache & SSR bugs | Guard `localStorage` with `browser` check and fix reactive TTL overwrite in Discord/GitHub counters | M1 | survey_2,3 |
| 10 | Lazy-load AI SDK/screenshot & fix AI bugs | Dynamic-import `@anthropic-ai/sdk` + `html2canvas-pro`; fix stuck `aiActivity`, `e.error` null-check, $O(N^2)$ scan | M1 | survey_1,2,3 |
| 11 | Baseline `README.md` accuracy & test docs | Fix mismatched Discord invite URLs; document `npm run dev`, env vars, mounts, and test scripts | M1 | survey_3 |
| 12 | Eliminate `cpuCallback` & `latencyCallback` churn | Replace `setInterval` recreation & `Array.shift()` with ring buffers and single coalesced timer | M2 | survey_1,2,3 |
| 13 | Batched terminal writes & UTF-8 input | `requestAnimationFrame` `term.write` batching + `TextEncoder` UTF-8 chunked `readData` + bulk `printMessage` | M2 | survey_1,2,3 |
| 14 | WebGL/Canvas xterm renderer + search | Add `@xterm/addon-webgl` (with DOM fallback) and `@xterm/addon-search` | M2 | survey_2 |
| 15 | Debounced resize, PTY sync & KMS scaling | Debounce resize, sync `term.onResize`, avoid forced `1024x768` upscale on Chromebooks, add `onDestroy` cleanup | M2 | survey_1,2,3 |
| 16 | Parallel boot & visibility power-saver | Parallelize imports/devices, show boot progress, throttle cursor blink/timers/animations when `document.hidden` | M2 | survey_2 |
| 17 | Multi-terminal tabs & session manager | Multiple concurrent shell tabs/processes (`cx.run` sessions), rename/close/restart, exit code reporting | M2 | survey_1,2,3 |
| 18 | VT1 ↔ VT7 switcher & display controls | UI toggle between text console (`vt 1`) and X11 display (`vt 7`), scaling/resolution & pause controls | M2 | survey_1,2,3 |
| 19 | Clipboard sync & virtual key bar | Copy/Paste buttons, OSC-52 clipboard sync, X11 clipboard bridge, Chromebook virtual keys (`Esc`/`Tab`/`Ctrl`/`Alt`/arrows/`F1-F12`) | M2 | survey_1,2,3 |
| 20 | Persistent settings, status bar & accessibility | `localStorage` preferences (font/theme/scrollback/renderer/power-saver/pin), status bar, toasts, semantic `<button>`/ARIA | M2 | survey_2 |
| 21 | Persistent user workspace `IDBDevice` | Dedicated `IDBDevice` mounted at `/home/user/workspace` separate from OS reset, with independent workspace reset | M3 | survey_1,3 |
| 22 | Host → VM file upload & drag-and-drop | Replace `drop` blocker on `#console` with multi-file/archive/binary uploader via `DataDevice` + workspace `+x` staging | M3 | survey_1,2,3 |
| 23 | VM → Host file manager & download | Browse workspace/`/data`/`/web`/`/home/user/documents`, mkdir/rename/delete, download via `IDBDevice.readFileAsBlob` | M3 | survey_1,2,3 |
| 24 | Workspace & disk snapshot export/import | Export/import workspace files & backup bundles (`.json`/archive) so installed apps/files persist across devices | M3 | survey_1,2 |
| 25 | Built-in file/code editor & "Run" button | Lightweight in-browser code/config/log editor saving directly to VM storage with 1-click "Run in Terminal" | M3 | survey_2 |
| 26 | Host-browser HTTP / package downloader bridge | Fetch CORS-enabled URLs, GitHub raw/releases, PyPI/npm tarballs, or proxy URLs into `/data` & workspace (`+x` staging, archive extract, SHA-256) | M4 | survey_1,2,3 |
| 27 | App catalog & 1-click app/binary runner | Curated Chromebook-friendly app/toolchain catalog + 1-click run for scripts, Python/Node/Lua/C, and uploaded i386 ELFs | M4 | survey_1,2,3 |
| 28 | Enhanced Tailscale/Headscale & `DirectSockets` UI | `controlUrl`/`authKey` form, disconnect, peer list, popup-blocker fallback for `login.html`, `DirectSocketsNetwork` support | M4 | survey_2,3 |
| 29 | Local web app / service preview & net diagnostics | Preview web apps/HTML/static servers or Tailscale service links from the VM + clear network diagnostics | M4 | survey_1,3 |
| 30 | Real-time system, storage & process monitor | CPU/latency sparklines, `navigator.storage.estimate()` IDB quota, memory stats, process table (`processCreated` + `/proc`) + kill/stop | M5 | survey_1,2 |
| 31 | VM profile, user, env & custom `.ext2` boot config | OS profile switcher (Debian/Alpine/Custom `.ext2` URL or local `FileDevice`), `uid`/`gid` (`user`/`root`), env editor (fix `LC_ALL=C`), cmd/args | M5 | survey_1,2,3 |
| 32 | Lightweight service / daemon & cron supervisor | Launch/stop/inspect background services & scheduled jobs (`cron`, `sshd`, local servers) in Debian/Alpine | M5 | survey_1 |
| 33 | Notifications, WebAudio bell & Dockerfile docs | Browser/toast notifications, WebAudio terminal bell, and updated `dockerfiles/` docs (`npm`, `sudo`, `git`, `pip`) | M5 | survey_1,2,3 |
| 34 | Opaque-box E2E test suite (Tiers 1–4) | Independent requirement-driven E2E suite (`TEST_INFRA.md` -> `TEST_READY.md`) covering all features | E2E Track | survey_3 |
| 35 | Final E2E pass (Tiers 1–4) & Tier 5 hardening | Pass 100% of Tiers 1–4 sequentially + white-box adversarial Tier 5 Challenger hardening + final README & git check | M6 | pattern |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Foundation, Build/SW Fixes & Test Harness | `.gitignore` (`.agents/`), `npm install`, CheerpX `.d.ts` verification, offline `+layout.server.js`, `serviceWorker.js` fixes & caching, `postcss.config.js` icons, asset/dead-code trim, non-blocking head/fonts, counter cache fixes, lazy AI + bug fixes, Vitest + Playwright-core (`/usr/bin/chromium`) + `svelte-check`, baseline `README.md`, clean commit | none | DONE (`5155e2b`) |
| M2 | Chromebook Efficiency, Terminal Engine & Multi-Session Workstation | `vm/` + `terminalIO.js` + `telemetry.js`, WebGL xterm + search, rAF write batching, UTF-8 `readData`, ring-buffer CPU/disk telemetry, debounced resize + PTY sync + KMS cap, parallel boot + progress, visibility power-saver, multi-tab terminals, VT1↔VT7 toggle, clipboard/virtual-key bar, persistent settings, status bar, accessibility, unit/browser tests, `README.md`, commit | M1 | DONE (`bf027da`, `62ee539`) |
| M3 | Host ↔ VM File Bridge, Persistent Workspace & Code Editor | Dedicated persistent workspace `IDBDevice`, DnD + file/archive/binary upload (`DataDevice` + `+x` staging), File Manager UI + `readFileAsBlob` download, workspace snapshot export/import, built-in Code/File Editor + Run button, tests, `README.md`, commit | M2 | DONE (`34e300b`) |
| M4 | App Downloader, Package/Binary Runner, Networking & Web Preview | Host HTTP/package downloader bridge (URL/GitHub/PyPI/npm/proxy, extract, `+x` staging, SHA-256), curated small-app catalog + 1-click app/binary runner, Tailscale/Headscale form + disconnect + diagnostics + popup fallback, local web-app/service preview, tests, `README.md`, commit | M3 | IN_PROGRESS |
| M5 | Linux OS Completeness: Process Monitor, Boot Profiles, Services & Audio | Real-time CPU/latency charts, IDB quota & memory monitor, process viewer/killer, VM profile & custom `.ext2` (graceful `FileDevice` fallback / URL `HttpBytesDevice`) + `uid`/`env`/cmd config, service/daemon/cron supervisor, notifications + WebAudio bell, `dockerfiles/` updates, tests, `README.md`, commit | M4 | PLANNED |
| E2E | E2E Testing Track (Opaque-Box) | Independent `TEST_INFRA.md`, COOP/COEP Playwright-core test runner, Tiers 1–4 opaque-box E2E tests covering all Feature Inventory features, publishes `TEST_READY.md` | M1 (runs in parallel with M2–M5) | DONE (`03cdb17`) |
| M6 | Final Milestone: E2E Pass (Tiers 1–4) & Tier 5 Adversarial Hardening | Phase 1: pass Tiers 1→2→3→4 sequentially; Phase 2: Tier-5 white-box adversarial Challenger hardening; whole-project audit, final `README.md`, clean git check | M5, E2E (`TEST_READY.md`) | PLANNED |

### Verified `@leaningtech/cheerpx@1.4.0` API Surface (from M1)
- Exported by `node_modules/@leaningtech/cheerpx/index.js`: `Linux`, `HttpBytesDevice`, `CloudDevice`, `GitHubDevice`, `IDBDevice`, `WebDevice`, `DataDevice`, `OverlayDevice`, `System` (`FileDevice` is in `index.d.ts` only — NOT exported on `index.js`; `DirectSocketsNetwork`, `flushIO`, `Linux.activateConsole` are NOT in `1.4.0`).
- `Linux.create({ mounts, networkInterface })`, `cx.run(fileName, args, { env, cwd, uid, gid }) -> Promise<{ status }>`, `cx.setCustomConsole(writeFunc, cols, rows) -> (keyCode) => void`, `cx.setActivateConsole(cb)`, `cx.setKmsCanvas(canvas, w, h)`, `cx.registerCallback/unregisterCallback`, `cx.delete()`.
- `DataDevice.create()` / `writeFile(path, data)`; `IDBDevice.create(name)` / `readFileAsBlob(path)` / `reset()`.

---

## Interface Contracts

### 1. VM Core ↔ Terminal & Display (`src/lib/vm/vmManager.js`, `terminalIO.js`, `telemetry.js`)
- `createVmManager(config, callbacks)` manages CheerpX lifecycle (`boot`, `runSession`, `activateVt`, `resizePty`, `setDisplayScale`, `pausePowerSaver`, `dispose`).
- `createTerminalBatcher(term)` batches `Uint8Array` writes via `requestAnimationFrame` with backpressure flush; `encodeUtf8Chunks(str, maxBytes)` encodes UTF-8 safely for `cxReadFunc`.
- `createTelemetryTracker()` maintains O(1) ring buffers for CPU and disk latency, emitting coalesced Svelte store updates only on change / non-hidden tab.

### 2. Storage & File Bridge ↔ VM & UI (`src/lib/fs/fileBridge.js`)
- Mounts dedicated persistent `IDBDevice("workspace")` at `/home/user/workspace` (distinct from OS root `OverlayDevice` `cacheId`).
- `importHostFiles(fileList, targetDir)`: writes via `DataDevice.writeFile` (`/data`) or workspace `IDBDevice` and provides staging/executable copy command (`chmod +x`) when executables/scripts are uploaded.
- `exportVmFile(path)` / `exportWorkspaceSnapshot()` / `importWorkspaceSnapshot(blob)`: uses `IDBDevice.readFileAsBlob` / IDB enumeration without resetting OS disk.

### 3. App Downloader & Runner ↔ File Bridge & VM (`src/lib/apps/downloader.js`, `appCatalog.js`)
- `downloadResource({ url, targetPath, corsProxy, sha256, makeExecutable })`: fetches via browser `fetch()`, verifies optional SHA-256 via `crypto.subtle.digest`, writes to `/data` or workspace, and queues staging/extraction in active/dedicated shell.
- `runApp({ cmd, args, cwd, env, tabTitle })`: launches app in a terminal session tab or background service tracker with exit-code notification.

### 4. Settings, Sessions & Monitor Stores ↔ Sidebar Tabs (`src/lib/stores/*.js`)
- All UI settings persist under versioned `localStorage` keys (`webvm.settings.v1`) with SSR-safe `browser` guards.
- All FontAwesome icons used by new/existing UI components MUST be preserved in `postcss.config.js` or rendered via inline SVG so production CSS never hides icons.

### 5. E2E Testing Track ↔ Implementation Track (`TEST_INFRA.md`, `TEST_READY.md`)
- E2E suite owns `tests/e2e/tiers/` and `TEST_INFRA.md`/`TEST_READY.md`; Implementation milestones own `src/`, `vite.config.js`, `postcss.config.js`, `serviceWorker.js`, `tests/unit/`, `README.md`.
- E2E tests exercise the app purely as an end user via Playwright (`playwright-core` + `/usr/bin/chromium`) against the built static bundle served with COOP/COEP headers (`window.crossOriginIsolated === true`).
