# WebVM

[![Discord server](https://img.shields.io/discord/988743885121548329?color=%235865F2&logo=discord&logoColor=%23fff)](https://discord.gg/yTNZgySKGa)
[![Issues](https://img.shields.io/github/issues/leaningtech/webvm)](https://github.com/leaningtech/webvm/issues)

This repository hosts the source code for [https://webvm.io](https://webvm.io), a Linux virtual machine that runs in your browser.

Try out the new Alpine / Xorg / i3 graphical environment: [https://webvm.io/alpine.html](https://webvm.io/alpine.html)

<img src="/assets/welcome_to_WebVM_alpine_2024.png" width="90%">

## What is WebVM?

WebVM is a server-less virtual environment running fully client-side in HTML5/WebAssembly. It's designed to be Linux ABI-compatible and runs an unmodified Debian distribution including many native development toolchains.

WebVM is powered by the **CheerpX** virtualization engine, which provides:

- x86-to-WebAssembly JIT compiler
- Virtual block-based file system
- Linux syscall emulator
- Safe, sandboxed client-side execution

## Table of Contents

- [Networking](#networking)
- [Development & Customization](#development--customization)
  - [Deploy to GitHub Pages](#deploy-to-github-pages)
  - [Local Serving & Image Configuration](#local-serving--image-configuration)
- [Claude AI Integration](#claude-ai-integration)
- [Community & Support](#community--support)
- [Learn More](#learn-more)
- [License](#license)

> [!NOTE]
> Visit [https://webvm.io](https://webvm.io) to get started immediately in your browser. No setup required.
>
> For local setup, custom image builds, and fork/deploy guidance, see [Development & Customization](#development--customization).

## Networking

WebVM supports **Tailscale** integration. So your browser VM can reach your private network and, with an exit node, the public internet too.

> [!NOTE]
> Some low-level networking operations (especially ICMP used by `ping`) are not currently available in this environment. For connectivity checks, use `curl` or `wget`.

### Local network

1.  Open the "Networking" panel from the sidebar
2.  Click "Connect to Tailscale"
3.  Log in (create a free account at [tailscale.com](https://tailscale.com) if needed)
4.  Click "Connect" when prompted

WebVM now has access to all machines in your Tailscale network!

### Internet Usage Tips

> [!TIP]
> On slower connections there may be a short delay before initialisation. Connection status is shown as a colored dot on the button: orange = local network, green = global/internet. The button text shows your Tailscale IP address once connected.

To access the public internet from WebVM, set up an **Exit Node** on another device in your Tailscale network:

1. Follow the [Tailscale Exit Node quickstart](https://tailscale.com/kb/1408/quick-guide-exit-nodes?tab=linux) (sections: "Advertise a device as an exit node")
2. WebVM automatically uses the exit node once advertised

### Using an Auth Key

As an alternative to interactive login, add your Tailscale auth key to the URL fragment:

```
https://webvm.io/#authKey=<your-ephemeral-key>
```

This is equivalent to Tailscale's `--login-server` option.

> [!TIP]
> If you also need a custom control server, add `controlUrl` in the same URL fragment and separate values with `&`, for example: `#authKey=...&controlUrl=...`.

### Self-Hosting Tailscale with Headscale

We also support [headscale](https://headscale.net/stable/), a selfhosted open source implementation of the Tailscale control server.
Because Headscale does not add CORS headers by default, you will need a proxy in front of it. See the [Headscale reverse proxy setup docs](https://headscale.net/stable/ref/integration/reverse-proxy/#nginx) for an example.

Once ready, add the following line to your `location /` block in your nginx config file.

```nginx
if ($http_origin = "https://yourdomain.com") {
    add_header 'Access-Control-Allow-Origin' "$http_origin";
    add_header 'Access-Control-Allow-Credentials' 'true' always;
}
```

Then access WebVM with:

```
https://yourdomain.com/#controlUrl=<your-headscale-url>
```

## Development & Customization

> [!NOTE]
> The default Debian terminal (`config_public_terminal.js`) boots as non-root `user` (`uid: 1000`, `gid: 1000`), while Alpine (`config_public_alpine.js`) boots as `root` (`uid: 0`, `gid: 0`). `sudo` is not pre-installed in the default Debian image (you can add it in the Dockerfile or use `su -` with password `password` in `debian_mini`).

### Deploy to GitHub Pages

This is a simple, beginner-friendly workflow. For local hosting and customization, see below [Local Serving & Image Configuration](#local-serving--image-configuration).

Fork the WebVM repository to deploy your own version to GitHub Pages:

<img src="/assets/fork_deploy_instructions.gif" alt="deploy_instructions_gif" width="90%">

1. **Fork the repository**
2. **Enable GitHub Pages** _via forked repository_ in Settings → Pages using "GitHub Actions" as source
3. **Run the `Deploy` workflow** from Actions
4. After completion, open the URL shown under the `deploy_to_github_pages` job

<img src="/assets/result.png" width="70%">

The same `Deploy` workflow also builds custom `.ext2` disk images from a Dockerfile. You can point it at `dockerfiles/debian_mini` or another Dockerfile, then either publish the result as a GitHub Release asset or deploy the Pages build from your fork.

> [!NOTE]
> `dockerfiles/debian_large` is too large of an image for GitHub pages.

### Local Serving & Image Configuration

#### 1. Clone the repository

```sh
git clone https://github.com/leaningtech/webvm.git
cd webvm
```

#### 2. Put your image in `custom-disk-images/`

This repository includes a persistent `custom-disk-images/` directory for local `.ext2` files.

To use the official Debian mini image, download it from Releases:

[debian_mini_20230519_5022088024.ext2](https://github.com/leaningtech/webvm/releases/download/ext2_image/debian_mini_20230519_5022088024.ext2)

You can also copy in an image you built yourself.

#### 3. Point WebVM to your local image

Edit `config_public_terminal.js`:

```js
export const diskImageUrl =
  "/custom-disk-images/debian_mini_20230519_5022088024.ext2";
export const diskImageType = "bytes";
```

#### 4. Install dependencies, develop, test, and build

```sh
npm install
npm run dev          # Start Vite dev server with COOP/COEP/CORP headers
npm run check        # Run svelte-kit sync + svelte-check
npm run build        # Build static site into build/ (works offline)
npm run preview      # Preview build/ via Vite with COOP/COEP/CORP headers
npm test             # Run Vitest unit tests (alias: npm run test:unit)
npm run test:e2e     # Run Playwright-core Chromium smoke tests against build/
```

**Build environment variables:**
- `WEBVM_MODE`: Set to `github` to resolve `/config_terminal` to `config_github_terminal.js`; defaults to `config_public_terminal.js`.
- `CX_URL`: Optional URL/path override for the `@leaningtech/cheerpx` ESM module.

#### 5. Serve locally with COOP/COEP headers

WebVM requires `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` (`window.crossOriginIsolated === true`) for SharedArrayBuffer/CheerpX execution. You can use either the built-in Node preview server (`node tests/e2e/server.mjs` or `npm run preview`) or Nginx:

```sh
nginx -p . -c nginx.conf
```

Then open http://127.0.0.1:8081 and enjoy your local WebVM!

#### Virtual Filesystem Mounts

WebVM configures the following CheerpX Linux mount points (`src/lib/vm/vmManager.js`):

| Mount Path | Type | Backing Device |
|---|---|---|
| `/` | `ext2` | `OverlayDevice` (`CloudDevice` / `HttpBytesDevice` / `GitHubDevice` + `IDBDevice` cache) |
| `/web` | `dir` | `WebDevice("")` (web server root files) |
| `/data` | `dir` | `DataDevice` (host-to-VM data channel) |
| `/home/user/documents` | `dir` | `WebDevice("documents")` (sample documents) |
| `/home/user/workspace` | `dir` | `IDBDevice("workspace")` (persistent user workspace, preserved across OS disk resets) |
| `/dev`, `/dev/pts`, `/proc`, `/sys` | virtual | Linux device, PTY, proc, and sysfs pseudo-filesystems |

#### Recent Foundation & Efficiency Improvements (M1)

- **Offline-resilient SSR/builds**: `+layout.server.js` fetches blog metadata in parallel with timeouts and clean fallbacks so `npm run build` succeeds offline.
- **Service Worker stability & Cache API caching**: Fixed undefined-response and `catch` errors, avoided reload loops when `crossOriginIsolated` is already enabled, and added `webvm-cache-v1` caching (cache-first for `/_app/immutable/*`, network-first for HTML, stale-while-revalidate for static assets, bypassing `Range`/cross-origin requests) while preserving COOP/COEP/CORP headers.
- **Smaller, faster page load**: Removed unused `xterm/` files and excluded README-only GIFs/screenshots from `build/assets/`, optimized `assets/webvm_hero.png`, deferred analytics, removed render-blocking Google Fonts `@import`, fixed FontAwesome pruning so `.fa-robot` and all UI icons render, and lazy-loaded `@anthropic-ai/sdk` and `html2canvas-pro`.
- **SSR & AI reliability**: Fixed SSR `localStorage` and TTL bugs in social counters, fixed `aiActivity` resets and null-safe error handling in `src/lib/anthropic.js`, and replaced the $O(N^2)$ terminal output scan with an `IMarker`-tracked incremental scan.

#### Workstation Engine, Efficiency & Multi-Session Improvements (M2)

- **Modular VM & I/O architecture**:
  - `src/lib/vm/telemetry.js`: Fixed-capacity `Float64Array`/`Uint8Array` ring buffers for CPU utilization and 30-sample disk latency with a single coalesced 250ms timer, dirty-checked Svelte store updates, automatic idle/hidden pause, and 60-point history.
  - `src/lib/vm/terminalIO.js`: `requestAnimationFrame`-batched `term.write` buffer (64KB/frame cap, 256KB backpressure drain), UTF-8 `TextEncoder` chunked `InputWriter` (`128` bytes per `4ms` tick), raw binary mouse sequence forwarding, and OSC-52 clipboard handler.
  - `src/lib/vm/vmManager.js`: Parallel dynamic module loading and device `.create()` boot with progress (`BootProgressOverlay.svelte`), WebGL terminal renderer with automatic DOM fallback on context loss (`@xterm/addon-webgl`), regex/case/word search (`@xterm/addon-search`), debounced `ResizeObserver` PTY sync, native KMS scaling (`displayScale`), visibility power-saver mode, and full `onDestroy` resource cleanup.
- **Multi-Tab Workstation & VT1 ↔ VT7 Display Controls**:
  - `TerminalTabBar.svelte` & `src/lib/stores/sessions.js`: Up to 8 terminal tabs — Tab 1 owns raw `/dev/tty1` PTY in a restartable loop with exit-code reporting, while `+ New Tab` spawns interactive JS-hosted shell sessions (`cd`, `export`, history, `Ctrl+C`/`Ctrl+L`, command dispatch via `cx.run('/bin/sh', ['-c', ...])`) and `runSession` task tabs with rename, close, and restart controls.
  - `TerminalToolbar.svelte`: Copy/Paste buttons (with X11 KMS paste bridge on VT7), Search toggle, Chromebook Virtual Key Bar toggle, bidirectional `VT1 ↔ VT7` switcher, Display Pause/Resume, and Display Scale selector (`0.5x`–`2x`) on `/alpine.html`.
- **Chromebook Virtual Keys, Persistent Settings & Accessibility**:
  - `VirtualKeyBar.svelte`: Focus-preserving (`mousedown|preventDefault`) virtual keys with sticky/double-click-locked `Ctrl`/`Alt` (affecting both virtual and physical keys, plus an inline modifier key input), `Esc`, `Tab`, `Ctrl+C`/`D`/`Z`/`L`, arrows, navigation keys, clipboard actions, and collapsible `F1`–`F12` keys.
  - `SettingsModal.svelte` & `src/lib/stores/settings.js`: `localStorage`-persisted (`webvm.settings.v1`) theme (`dark`, `light`, `solarized`, `high-contrast`), font size/family, scrollback, renderer (`auto`/`webgl`/`dom`), cursor blink, power-saver mode, sidebar pin, and display scale.
  - `StatusBar.svelte` & `ToastContainer.svelte`: Live VM state, VT, session dimensions, active renderer, CPU/disk telemetry, Tailscale IP, interactive `ECO` Power-Saver toggle, and toast notifications; semantic `<button>`/ARIA controls across `Icon.svelte`, `SmallButton.svelte`, `PanelButton.svelte`, and `SideBar.svelte` (supporting both unpinned click-to-stay-open and pinned-tab click switching).

**Workstation keyboard shortcuts:**
- `Ctrl+Shift+F`: Toggle terminal search bar (`Enter` next, `Shift+Enter` previous, `Esc` close)
- `Ctrl+Shift+C`: Copy selected terminal text
- `Ctrl+Shift+V`: Paste clipboard into active terminal (or X11 display on VT7)

#### Host ↔ VM File Bridge, Persistent Workspace & Code Editor (M3)

- **Dedicated Persistent Workspace (`#21`)**: `src/lib/vm/vmManager.js` mounts a dedicated `IDBDevice("workspace")` at `/home/user/workspace` separate from the OS root `OverlayDevice` cache. Resetting the OS root disk (`DiskTab` → `Reset disk`) preserves `/home/user/workspace`, while an independent `Reset workspace` control clears only workspace storage.
- **Dual-Layer Host ↔ VM File Bridge & Archive Extraction (`#22`)**: `src/lib/fs/fileBridge.js` and `src/lib/fs/archiveHelper.js` provide IndexedDB (`webvm_workspace_vfs`) + `localStorage` (`webvm.workspace.v1`) persistence, `DataDevice` / `/home/user/workspace` synchronization, client-side `.tar`, `.tar.gz`/`.tgz`, and `.zip` extraction with path-traversal protection, drag-and-drop import onto `#console`, multi-file upload, and automatic ELF (`i386` vs `x86_64`) / shebang `+x` detection.
- **File Manager & Host Download (`#23`)**: `src/lib/FilesTab.svelte` (`Files` sidebar tab) supports directory navigation, `mkdir`, inline rename, recursive delete, `+x` permission toggling, 1-click `Run`, and host browser download (`IDBDevice.readFileAsBlob` + `Blob` fallback).
- **Workspace Snapshot Export & Import (`#24`)**: Export and restore `.json` workspace snapshots (`exportWorkspaceSnapshot` / `importWorkspaceSnapshot`) with schema validation and non-destructive error handling.
- **Built-in Code/File Editor (`#25`)**: `src/lib/EditorTab.svelte` (`Editor` sidebar tab) provides in-browser file editing with binary/non-UTF-8 guard, `Tab` indentation, `Ctrl+S` save, host download, and 1-click **Run in Terminal**.


For the full Alpine desktop environment, see [leaningtech/alpine-image](https://github.com/leaningtech/alpine-image).

For more details, see [CheerpX Custom Images documentation](https://cheerpx.io/docs/guides/custom-images).

> [!TIP]
> For Python3 REPL, the `Deploy` workflow takes into account the `CMD` specified in the Dockerfile.
>
> To build a REPL you can simply change `CMD [ "/bin/bash" ]` to `CMD [ "/usr/bin/python3" ]` and deploy.

## Claude AI Integration

To access Claude AI, you need an API key. Follow these steps to get started:

#### 1. Create an account

- Visit [Anthropic Console](https://console.anthropic.com/login) and sign up with your e-mail. You'll receive a sign in link to the Anthropic Console.

#### 2. Get your API key

- Once logged in, navigate to **Get API keys**.
- Purchase the amount of credits you need. After completing the purchase, you'll be able to generate the key through the API console.

#### 3. Log in with your API key

- Navigate to your WebVM and hover over the robot icon. This will show the Claude AI Integration tab. For added convenience, you can click the pin button in the top right corner to keep the tab in place.
- You'll see a prompt where you can insert your Claude API key.

#### 4. Start using Claude AI

- Once your API key is entered, you can begin interacting with Claude AI by asking questions such as:

**"Solve the CTF challenge at `/home/user/chall1.bin.` Note that the binary reads from stdin."**

<img src="/assets/webvm_claude_ctf.gif" alt="deploy_instructions_gif" width="90%">

**Important:** Your API key is private and should never be shared. We do not have access to your key, it is only stored locally in your browser.

## Community & Support

**Report issues:** Use [GitHub Issues](https://github.com/leaningtech/webvm/issues) to report bugs or request features.

**Chat with us:** Join our [Discord community](https://discord.gg/yTNZgySKGa) to discuss WebVM, share ideas, and get help.

## Learn More

**Articles & Resources:**

- [WebVM: Server-less x86 virtual machines in the browser](https://leaningtech.com/webvm-server-less-x86-virtual-machines-in-the-browser/)
- [WebVM: Linux Virtualization in WebAssembly with Full Networking via Tailscale](https://leaningtech.com/webvm-virtual-machine-with-networking-via-tailscale/)
- [Mini.WebVM: Your own Linux box from Dockerfile, virtualized in the browser via WebAssembly](https://leaningtech.com/mini-webvm-your-linux-box-from-dockerfile-via-wasm/)
- [Crafting the Impossible: X86 Virtualization in the Browser with WebAssembly](https://www.youtube.com/watch?v=VqrbVycTXmw) — Talk at JsNation 2022

**Example Deployment:**

- [Mini.WebVM Reference](https://mini.webvm.io) — A running example deployed to GitHub Pages

**Technology Behind WebVM:**

This project is powered by:

- **[CheerpX](https://cheerpx.io/)** — x86-to-WebAssembly JIT compiler | by [Leaning Technologies](https://leaningtech.com/)
- **[xterm.js](https://xtermjs.org/)** — Web-based terminal emulator
- **[Tailscale](https://tailscale.com/)** — VPN networking layer
- **[lwIP](https://savannah.nongnu.org/projects/lwip/)** — TCP/IP stack, compiled for the Web via [Cheerp](https://github.com/leaningtech/cheerp-meta/)

**Versioning:**

WebVM uses the [CheerpX](https://www.npmjs.com/package/@leaningtech/cheerpx) NPM package, which is updated on every release.

Every build is immutable. If a specific version works well for you today, it will keep working forever.

## License

WebVM is released under the Apache License, Version 2.0.

You are welcome to use, modify, and redistribute the contents of this repository.

The public CheerpX deployment is provided **as-is** and is **free to use** for technological exploration, testing and use by individuals. Any other use by organizations, including non-profit, academia and the public sector, requires a license. Downloading a CheerpX build for the purpose of hosting it elsewhere is not permitted without a commercial license.

Read more [here](https://cheerpx.io/docs/licensing) about our licensing practices.

If you want to build a product on top of CheerpX/WebVM, please see our other licensing options: [CheerpX licensing](https://cheerpx.io/licensing) or get in touch: sales@leaningtech.com
