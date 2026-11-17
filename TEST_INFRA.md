# WebVM Opaque-Box E2E Test Infrastructure (`TEST_INFRA.md`)

> **Track**: E2E Testing Track (Requirement-Driven, Opaque-Box)
> **Browser & Isolation**: `playwright-core` + `/usr/bin/chromium` against SvelteKit served with COOP (`same-origin`) and COEP (`require-corp`) headers (`window.crossOriginIsolated === true`).
> **Target App**: `/home/antigravity/arjunpuninchittaya2/webvm`

---

## 1. Feature Inventory (Opaque-Box User Capabilities)

Derived from `ORIGINAL_REQUEST.md` and `PROJECT.md § Feature Inventory` (Features #1–#33) and `§ Interface Contracts`:

| Area ID | Feature Area | Covered Features (`PROJECT.md`) | User-Facing Capabilities |
|---|---|---|---|
| `CORE` | Core Shell, Isolation, Resilience & Terminal Engine | `#4, #5, #6, #8, #9, #10, #12, #13, #14, #15, #17, #18` | COOP/COEP isolation on `/` & `/alpine`, offline SSR blog fallback, Service Worker caching, FontAwesome icon CSS integrity, lazy-loaded Claude AI & error recovery, xterm WebGL/DOM renderer + search, UTF-8 input, debounced resize & capped KMS scaling, multi-tab terminal sessions, VT1 ↔ VT7 toggle & display pause/scale |
| `PERF` | Chromebook Performance, Accessibility & Persistent Settings | `#16, #19, #20, #33` | Boot progress indicator, visibility power-saver throttling, clipboard Copy/Paste & OSC-52 sync, Chromebook virtual key bar (`Esc`, `Tab`, `Ctrl`, `Alt`, Arrows, `F1–F12`), `localStorage` settings (`webvm.settings.v1`), status bar, semantic `<button>`/ARIA keyboard navigation, toast notifications & WebAudio terminal bell |
| `FS` | Host ↔ VM File Bridge, Persistent Workspace & Code Editor | `#21, #22, #23, #24, #25` | Dedicated persistent `/home/user/workspace` `IDBDevice` independent of OS disk reset, multi-file/archive/binary upload & drag-and-drop onto `#console` (`+x` staging), VM→Host File Manager (`mkdir`, rename, delete, download), workspace snapshot export/import, built-in Code/File Editor + `"Run in Terminal"` |
| `APP` | App Downloader, Catalog, Runner & Local Preview | `#26, #27, #29` | Host-browser HTTP/package downloader bridge (URL, GitHub, PyPI, npm, CORS proxy, SHA-256 verification, archive extraction, `+x` staging), curated Chromebook-friendly app catalog & 1-click app/script/i386 runner, local web app / HTML preview panel |
| `NET` | Networking, Diagnostics & Tailscale/Headscale | `#28, #29` | Tailscale/Headscale `controlUrl` & `authKey` configuration form, disconnect & peer/exit-node status, popup-blocker fallback for `login.html`, `DirectSocketsNetwork` capability reporting & network diagnostics, local/Tailscale service preview links |
| `SYS` | System/Process Monitor, VM Boot Profiles & Services/Cron | `#30, #31, #32` | Real-time CPU/disk latency sparklines, `navigator.storage.estimate()` IDB quota & memory monitor, process table & kill/stop, VM boot profile switcher (Debian/Alpine/custom `.ext2` URL + graceful local `.ext2` limitation notice), `uid`/`gid`/`env`/`cmd` config, lightweight daemon & cron supervisor |

### Documented CheerpX 1.4.0 & Browser Hard Limits (Explicitly Excluded)
Tests strictly avoid impossible operations outside CheerpX 1.4.0's capability envelope:
- No `x86_64` or ARM binaries (only `i386` ELFs or interpreted scripts; Tier 2 tests verify clean rejection of `x86_64` ELFs).
- No KVM, Docker, kernel modules (`insmod`/eBPF), or hardware 3D OpenGL/Vulkan acceleration.
- No unproxied raw TCP/UDP sockets or raw ICMP `ping` from inside x86 without Tailscale/Headscale or Chrome IWA `DirectSocketsNetwork`.
- No runtime `FileDevice` dependency (`FileDevice` is not exported in `@leaningtech/cheerpx@1.4.0` `index.js`).

---

## 2. 4-Tier Testing Methodology

1. **Tier 1 — Feature Coverage (`36` tests; `6` per feature area, `>= 5` required)**
   - Isolated happy-path behavioral tests verifying each feature area works via real browser interactions.
2. **Tier 2 — Boundary & Corner Cases (`30` tests; `5` per feature area, `>= 5` required)**
   - Edge cases, invalid inputs, corrupted state, permission denials, offline failures, and unsupported formats, verifying graceful rejection without uncaught `pageerror` or UI lockups.
3. **Tier 3 — Cross-Feature Combinations (`12` tests; `>= 10` required)**
   - Pairwise and multi-feature interactions across terminal tabs, settings, workspace, drag-and-drop, file manager, snapshots, code editor, downloader, web preview, networking, boot profiles, services, and process monitor.
4. **Tier 4 — Real-World Application Scenarios (`7` tests; `>= max(5, N/2) = 5` required)**
   - End-to-end multi-step user journeys simulating Chromebook power users, developers authoring/backing up projects, external package download/patch/run, web app building/previewing, Headscale setup with popup fallback, sysadmin cron/resource management, and graphical Alpine VT1↔VT7 workflows.

---

## 3. Complete Test Catalog

### Tier 1 — Feature Coverage (`36` tests)
- **Area `CORE`**:
  - `T1-CORE-01` (`#4, #5, #8`): COOP/COEP isolation (`window.crossOriginIsolated === true`), zero same-origin errors on `/` and Alpine route, offline Blog Posts fallback.
  - `T1-CORE-02` (`#5, #6`): Service Worker registration & FontAwesome icon `::before` computed content across all sidebar icons.
  - `T1-CORE-03` (`#9, #10`): Lazy-loaded Claude AI SDK/screenshot (not loaded until AI tab opens) & `localStorage`-safe social counter tabs.
  - `T1-CORE-04` (`#12, #13, #14`): Terminal search bar (`Ctrl+Shift+F` / search toggle), UTF-8 input rendering on xterm WebGL/DOM renderer, and CPU/Disk telemetry readout.
  - `T1-CORE-05` (`#15, #18`): Responsive viewport resize & VT1 ↔ VT7 display switcher with pause/scale controls on Alpine route.
  - `T1-CORE-06` (`#17`): Multi-terminal tabs & session lifecycle (create tab, rename, switch, close).
- **Area `PERF`**:
  - `T1-PERF-01` (`#16`): Boot progress indicator & visibility power-saver throttling when `document.hidden` / `visibilitychange` triggers.
  - `T1-PERF-02` (`#19`): Chromebook virtual key bar (`Esc`, `Tab`, `Ctrl`, `Alt`, Arrow keys, `F1–F12`) with sticky modifier state.
  - `T1-PERF-03` (`#19`): Clipboard Copy/Paste toolbar actions with granted clipboard permissions.
  - `T1-PERF-04` (`#20`): Persistent settings in `localStorage` (`webvm.settings.v1`: font size, renderer, power saver, sidebar pin) across reload.
  - `T1-PERF-05` (`#20`): Status bar readout & semantic `<button>` keyboard/ARIA accessibility on sidebar navigation.
  - `T1-PERF-06` (`#33`): Accessible toast notifications (`role="alert"` / `role="status"`) & WebAudio terminal bell preference persistence.
- **Area `FS`**:
  - `T1-FS-01` (`#21`): Dedicated persistent `/home/user/workspace` surviving reload AND surviving OS root disk reset (`Reset disk`).
  - `T1-FS-02` (`#22`): Host → VM multi-file upload via File Manager `<input type="file" multiple>` with `+x` script staging.
  - `T1-FS-03` (`#22`): Drag-and-drop file import onto `#console` (verifying old `drop` blocker is replaced).
  - `T1-FS-04` (`#23`): VM → Host File Manager CRUD (`mkdir`, rename, delete) & file download (`waitForEvent('download')`).
  - `T1-FS-05` (`#24`): Workspace snapshot export & import round-trip after workspace reset.
  - `T1-FS-06` (`#25`): Built-in Code/File Editor save & 1-click `"Run in Terminal"`.
- **Area `APP`**:
  - `T1-APP-01` (`#26`): Host HTTP downloader fetches mocked CORS URL into VM workspace with valid SHA-256 verification & `+x`.
  - `T1-APP-02` (`#26`): Archive download (`.tar.gz`) via CORS proxy URL rewriting & automatic extraction.
  - `T1-APP-03` (`#26`): Package source shortcut (GitHub / PyPI / npm) fetches mocked package artifact into VM storage.
  - `T1-APP-04` (`#27`): Curated Chromebook app catalog browsing, search filtering, and 1-click launch.
  - `T1-APP-05` (`#27`): 1-click runner for uploaded script/executable in workspace with terminal launch & run status.
  - `T1-APP-06` (`#29`): Local web app / HTML preview panel rendering saved workspace `index.html`.
- **Area `NET`**:
  - `T1-NET-01` (`#28`): Tailscale/Headscale `controlUrl` & `authKey` configuration form submission.
  - `T1-NET-02` (`#28`): Tailscale popup-blocker fallback (`window.open` returns `null`) renders fallback link without throwing `TypeError`.
  - `T1-NET-03` (`#28`): Tailscale disconnect control & peer/exit-node status UI.
  - `T1-NET-04` (`#29`): Network diagnostics reporting `crossOriginIsolated`, `DirectSocketsNetwork` capability, and Host Fetch Bridge status.
  - `T1-NET-05` (`#29`): Local / Tailscale service preview link builder (`127.0.0.1:8080`).
  - `T1-NET-06` (`#28`): Networking `controlUrl` preference persistence across page reload.
- **Area `SYS`**:
  - `T1-SYS-01` (`#30`): Real-time CPU & disk latency sparkline charts (`<canvas>`/`<svg>`) in System Monitor.
  - `T1-SYS-02` (`#30`): `navigator.storage.estimate()` IDB storage quota & memory monitor readout.
  - `T1-SYS-03` (`#30`): Process table viewer & stop/kill action control.
  - `T1-SYS-04` (`#31`): VM profile switcher (Debian / Alpine), `uid`/`gid`, `env` (`LC_ALL=C`), and `cmd`/`args` persistence.
  - `T1-SYS-05` (`#31`): Custom `.ext2` URL config & graceful local `.ext2` (`FileDevice` unavailable in CheerpX 1.4.0) notice.
  - `T1-SYS-06` (`#32`): Lightweight service/daemon & cron supervisor UI (start/stop service, add scheduled cron job).

### Tier 2 — Boundary & Corner Cases (`30` tests)
- `T2-CORE-01` (`#4, #5`): Total offline mode (`page.route` aborts all external origins) leaves UI shell & `#console` error-free.
- `T2-CORE-02` (`#10`): Claude AI HTTP 401/error response displays error without locking `aiActivity` / `#ai-input`.
- `T2-CORE-03` (`#13, #14`): Terminal search zero matches and regex metacharacters (`[.*?`) handled without `SyntaxError`.
- `T2-CORE-04` (`#17`): Attempting to close the sole terminal tab keeps a fallback shell active.
- `T2-CORE-05` (`#15, #18`): Narrow mobile viewport (`360x640`) & rapid resize storm stays non-zero sized without exceptions.
- `T2-PERF-01` (`#20`): Corrupted `localStorage.getItem('webvm.settings.v1')` JSON recovers cleanly to defaults.
- `T2-PERF-02` (`#20`): Out-of-range font size (`2`, `200`) and negative scrollback (`-50`) clamped/rejected safely.
- `T2-PERF-03` (`#19`): Clipboard Paste with denied browser permissions shows graceful warning without unhandled rejection.
- `T2-PERF-04` (`#19`): Virtual sticky modifier (`Ctrl`/`Alt`) toggles cleanly on/off without getting stuck.
- `T2-PERF-05` (`#33`): WebAudio bell when `AudioContext` is blocked/suspended runs without `NotAllowedError` crash.
- `T2-FS-01` (`#22, #23`): Path-traversal (`../escape`) and empty filenames rejected in File Manager `mkdir`/rename.
- `T2-FS-02` (`#22`): Zero-byte file upload (`0 B`) and duplicate filename upload handled cleanly.
- `T2-FS-03` (`#24`): Corrupted/non-JSON snapshot import rejected cleanly while preserving existing workspace files.
- `T2-FS-04` (`#25`): Binary/non-UTF8 file guard or unsaved changes warning in Code Editor.
- `T2-FS-05` (`#23`): Non-empty directory deletion removes nested contents cleanly without stale entries.
- `T2-APP-01` (`#26`): SHA-256 mismatch aborts download and prevents staging untrusted payload into workspace.
- `T2-APP-02` (`#26`): Invalid URL scheme (`javascript:alert(1)`) blocked & HTTP 404 surfaces readable error.
- `T2-APP-03` (`#26`): Corrupted `.tar.gz` extraction failure handled gracefully without partial-state crash.
- `T2-APP-04` (`#27`): Unsupported 64-bit `x86_64` ELF rejected with CheerpX 32-bit `i386`-only message.
- `T2-APP-05` (`#29`): Web Preview on non-existent workspace path shows `"File not found"` safely.
- `T2-NET-01` (`#28`): Malformed Headscale `controlUrl` rejected with inline validation error.
- `T2-NET-02` (`#28`): Double-clicking connect with blocked popup stays idempotent without null dereference.
- `T2-NET-03` (`#28`): Clicking Disconnect while already disconnected is safe/disabled.
- `T2-NET-04` (`#29`): Out-of-range service preview port (`99999`) rejected with `1–65535` validation.
- `T2-NET-05` (`#29`): Network diagnostics under `context.setOffline(true)` accurately reports offline state.
- `T2-SYS-01` (`#31`): Invalid `uid` (`-1`) or malformed env line (`INVALID_NO_EQUALS`) rejected cleanly.
- `T2-SYS-02` (`#31`): Invalid/unreachable custom `.ext2` URL (`ftp://bad/disk.ext2`) allows safe recovery to Debian profile.
- `T2-SYS-03` (`#30`): Kill/Stop on exited/empty process entry handles safely without `pageerror`.
- `T2-SYS-04` (`#32`): Invalid cron schedule (`99 99 * * *`) rejected by Cron Supervisor validation.
- `T2-SYS-05` (`#30`): `navigator.storage.estimate === undefined` fallback renders `"Unavailable"` without `pageerror`.

### Tier 3 — Cross-Feature Combinations (`12` tests)
- `T3-01`: Pinned sidebar + custom font size inherited across newly opened terminal tabs (`#17 + #20`).
- `T3-02`: Virtual key bar & status bar across VT1 ↔ VT7 toggle on Alpine (`#18 + #19`).
- `T3-03`: Power-saver preference persisted across reload + `visibilitychange` throttling (`#16 + #20`).
- `T3-04`: Upload script → edit in Code Editor → save → verify persistence after reload (`#21 + #22 + #25`).
- `T3-05`: Drag-and-drop onto `#console` → rename in File Manager → export snapshot → reset → import (`#22 + #23 + #24`).
- `T3-06`: `"Run in Terminal"` from Code Editor opens/focuses execution tab & updates status (`#25 + #17`).
- `T3-07`: Download `.tar.gz` via HTTP bridge → extract to workspace → browse & download extracted file (`#26 + #21 + #23`).
- `T3-08`: Download script with SHA-256 → inspect in Code Editor → 1-click Run (`#26 + #25 + #27`).
- `T3-09`: Edit HTML in Code Editor → live-update in Web Preview panel (`#25 + #29`).
- `T3-10`: Tailscale disconnected while Host HTTP Fetch Bridge succeeds independently (`#28 + #26`).
- `T3-11`: Switching OS profile (Debian ↔ Alpine) preserves `/home/user/workspace` (`#31 + #21`).
- `T3-12`: Start service in Service Supervisor → observe in Process Monitor → stop with toast notification (`#30 + #32 + #33`).

### Tier 4 — Real-World Application Scenarios (`7` tests)
- `T4-01`: Chromebook power-user setup (pinned sidebar, font size, power saver, virtual keys, reload persistence, multi-tab logs, terminal search).
- `T4-02`: Developer authoring, running & backing up a multi-file project across OS root disk reset + workspace snapshot disaster recovery.
- `T4-03`: External package download (mocked GitHub release `.tar.gz` + SHA-256), extraction, code edit, and 1-click run.
- `T4-04`: Building & previewing a local HTML/CSS web app inside WebVM and downloading artifact to host.
- `T4-05`: Headscale setup, popup-blocker fallback recovery, diagnostics inspection, and disconnect workflow.
- `T4-06`: Sysadmin workstation profile (`uid`, `LC_ALL=C`), scheduled cron job, storage quota & process monitor workflow.
- `T4-07`: Full offline-resilient graphical + terminal workstation journey on Alpine (`/alpine`) with VT1↔VT7, workspace, catalog, and monitor tabs.

---

## 4. Progressive Testability & Runner Usage

All tests run via `/home/antigravity/arjunpuninchittaya2/webvm/tests/e2e/run-tiers.mjs` using `playwright-core` + `/usr/bin/chromium` (`--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage`).

```bash
# Run all tiers against vite dev on port 4179 (auto-starts and tears down vite dev)
node tests/e2e/run-tiers.mjs

# Run a specific tier
node tests/e2e/run-tiers.mjs --tier 1
node tests/e2e/run-tiers.mjs --tier 2
node tests/e2e/run-tiers.mjs --tier 3
node tests/e2e/run-tiers.mjs --tier 4

# Filter by feature area, milestone tag, test ID, or substring, or list tests
node tests/e2e/run-tiers.mjs --area CORE
node tests/e2e/run-tiers.mjs --milestone M1
node tests/e2e/run-tiers.mjs --id T1-CORE-01
node tests/e2e/run-tiers.mjs --filter "clipboard"
node tests/e2e/run-tiers.mjs --list --json

# Point at an already running COOP/COEP server or static bundle, customize port/timeout, or view help
node tests/e2e/run-tiers.mjs --url http://127.0.0.1:4179
node tests/e2e/run-tiers.mjs --static-dir ./build --port 4180 --action-timeout 5000
node tests/e2e/run-tiers.mjs --help
```

- **Dev vs Static Route Adaptation**: `run-tiers.mjs` probes `/alpine` vs `/alpine.html` at startup so tests run seamlessly against both `vite dev --port 4179 --strictPort --host 127.0.0.1` and static `build/`.
- **Strict Pass/Fail Semantics**: Exit code is `0` ONLY when every executed test passes; any failed assertion, unknown/invalid CLI flag, or zero matched tests returns exit code `1`. No tests are skipped or faked to pass.
