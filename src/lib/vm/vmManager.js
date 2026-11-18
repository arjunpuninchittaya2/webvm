import { get } from 'svelte/store';
import { displayConfig } from '$lib/anthropic.js';
import { introMessage, errorMessage, unexpectedErrorMessage } from '$lib/messages.js';
import { tryPlausible } from '$lib/plausible.js';
import { ringTerminalBell } from '$lib/audio/bell.js';
import { settings, getThemeDefinition } from '$lib/stores/settings.js';
import {
	MAX_SESSIONS,
	sessions,
	activeSessionId,
	activeVt,
	vtAvailable,
	displayPaused,
	bootState,
	activeRenderer,
	pageHidden,
	vmState,
	stickyModifiers,
	DEFAULT_STICKY_MODIFIERS,
	addToast,
	upsertSession,
	updateSession,
	removeSession,
	setActiveSession,
	resetSessionsStore
} from '$lib/stores/sessions.js';
import { createTelemetryTracker } from './telemetry.js';
import { buildSnapshotScript, parseProcSnapshot } from './processMonitor.js';
import {
	createTerminalBatcher,
	createInputWriter,
	registerOsc52Handler,
	applyTerminalModifiers,
	getDisplayWidth
} from './terminalIO.js';

const SEARCH_DECORATIONS = {
	matchBackground: '#665c00',
	matchBorder: '#b58900',
	matchOverviewRuler: '#b58900',
	activeMatchBackground: '#d97706',
	activeMatchBorder: '#fbbf24',
	activeMatchColorOverviewRuler: '#fbbf24'
};

export function resolveShellPath(cwd, target, home = '/home/user') {
	const base = cwd && cwd.startsWith('/') ? cwd : '/';
	let raw = (target || '').trim();
	if (!raw || raw === '~') {
		raw = home || '/';
	} else if (raw.startsWith('~/')) {
		raw = `${home || ''}/${raw.slice(2)}`;
	}
	const combined = raw.startsWith('/') ? raw : `${base === '/' ? '' : base}/${raw}`;
	const parts = combined.split('/');
	const resolved = [];
	for (const part of parts) {
		if (!part || part === '.') continue;
		if (part === '..') {
			resolved.pop();
		} else {
			resolved.push(part);
		}
	}
	return `/${resolved.join('/')}`;
}

export function shellQuote(str) {
	return `'${String(str).replace(/'/g, `'\\''`)}'`;
}

export function updateEnvList(envList, key, value) {
	const prefix = `${key}=`;
	const filtered = (envList || []).filter((entry) => !entry.startsWith(prefix));
	if (value !== undefined && value !== null) {
		filtered.push(`${key}=${value}`);
	}
	return filtered;
}

export function getEnvValue(envList, key, fallback = '') {
	const prefix = `${key}=`;
	const match = (envList || []).find((entry) => entry.startsWith(prefix));
	return match ? match.slice(prefix.length) : fallback;
}

export function getKmsInputElement() {
	if (typeof document === 'undefined' || !document.body) return null;
	for (const node of document.body.children) {
		if (node.tagName === 'TEXTAREA') {
			return node;
		}
	}
	return null;
}

export async function sendTextToKms(text) {
	const textArea = getKmsInputElement();
	if (!textArea || !text) return false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		textArea.value = '_' + ch;
		textArea.dispatchEvent(new KeyboardEvent('keydown', { key: ch }));
		textArea.dispatchEvent(new KeyboardEvent('keyup', { key: ch }));
		if (i % 8 === 7) {
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
	}
	return true;
}

const KMS_SEQ_MAP = {
	'\x1b': { key: 'Escape', code: 'Escape' },
	'\t': { key: 'Tab', code: 'Tab' },
	'\r': { key: 'Enter', code: 'Enter' },
	'\n': { key: 'Enter', code: 'Enter' },
	'\x7f': { key: 'Backspace', code: 'Backspace' },
	'\b': { key: 'Backspace', code: 'Backspace' },
	'\x1b[A': { key: 'ArrowUp', code: 'ArrowUp' },
	'\x1b[B': { key: 'ArrowDown', code: 'ArrowDown' },
	'\x1b[C': { key: 'ArrowRight', code: 'ArrowRight' },
	'\x1b[D': { key: 'ArrowLeft', code: 'ArrowLeft' },
	'\x1b[H': { key: 'Home', code: 'Home' },
	'\x1b[F': { key: 'End', code: 'End' },
	'\x1b[3~': { key: 'Delete', code: 'Delete' },
	'\x1b[5~': { key: 'PageUp', code: 'PageUp' },
	'\x1b[6~': { key: 'PageDown', code: 'PageDown' },
	'\x1bOP': { key: 'F1', code: 'F1' },
	'\x1bOQ': { key: 'F2', code: 'F2' },
	'\x1bOR': { key: 'F3', code: 'F3' },
	'\x1bOS': { key: 'F4', code: 'F4' },
	'\x1b[15~': { key: 'F5', code: 'F5' },
	'\x1b[17~': { key: 'F6', code: 'F6' },
	'\x1b[18~': { key: 'F7', code: 'F7' },
	'\x1b[19~': { key: 'F8', code: 'F8' },
	'\x1b[20~': { key: 'F9', code: 'F9' },
	'\x1b[21~': { key: 'F10', code: 'F10' },
	'\x1b[23~': { key: 'F11', code: 'F11' },
	'\x1b[24~': { key: 'F12', code: 'F12' }
};

export function sendKeySequenceToKms(seq) {
	const textArea = getKmsInputElement();
	if (!textArea || !seq) return false;

	const mapped = KMS_SEQ_MAP[seq];
	if (mapped) {
		textArea.dispatchEvent(new KeyboardEvent('keydown', { ...mapped, bubbles: true }));
		textArea.dispatchEvent(new KeyboardEvent('keyup', { ...mapped, bubbles: true }));
		return true;
	}

	if (seq.length === 1) {
		const code = seq.charCodeAt(0);
		if (code >= 1 && code <= 26) {
			const letter = String.fromCharCode(code + 96);
			textArea.dispatchEvent(new KeyboardEvent('keydown', { key: letter, ctrlKey: true, bubbles: true }));
			textArea.dispatchEvent(new KeyboardEvent('keyup', { key: letter, ctrlKey: true, bubbles: true }));
			return true;
		}
	}

	if (seq.length === 2 && seq[0] === '\x1b') {
		const ch = seq[1];
		textArea.dispatchEvent(new KeyboardEvent('keydown', { key: ch, altKey: true, bubbles: true }));
		textArea.dispatchEvent(new KeyboardEvent('keyup', { key: ch, altKey: true, bubbles: true }));
		return true;
	}

	void sendTextToKms(seq);
	return true;
}

export function createVmManager(configObj, options = {}) {
	const cacheId = options.cacheId || 'blocks_terminal';
	const workspaceCacheId = options.workspaceCacheId || 'workspace';
	const networkInterface = options.networkInterface || undefined;
	const processCallback = options.processCallback || null;
	const telemetry = options.telemetry || createTelemetryTracker();

	let TerminalCtor = options.Terminal || null;
	let FitAddonCtor = options.FitAddon || null;
	let WebLinksAddonCtor = options.WebLinksAddon || null;
	let SearchAddonCtor = options.SearchAddon || null;
	let WebglAddonCtor = options.WebglAddon || null;
	let CheerpXMod = options.CheerpX || null;

	let consoleRoot = null;
	let displayEl = null;
	let cx = null;
	let blockCache = null;
	let workspaceDevice = null;
	let dataDevice = null;
	let cxReadFunc = null;
	let processCount = 0;
	let disposed = false;
	let webglBlocked = false;
	let activeRunTabId = null;
	let secondaryRunChain = Promise.resolve();
	let resizeObserver = null;
	let resizeTimerId = null;
	let resizeRafId = null;
	let lastPtyCols = 0;
	let lastPtyRows = 0;
	let lastKmsWidth = 0;
	let lastKmsHeight = 0;
	let tabSeq = 1;
	let primaryBootGen = 0;
	let initPromise = null;

	const tabs = new Map();
	const cleanups = [];
	const searchListeners = new Set();

	const inputWriter = createInputWriter(() => cxReadFunc);

	let currentSettings = get(settings);
	let lastFontSize = currentSettings.fontSize;
	let lastFontFamily = currentSettings.fontFamily;
	let lastThemeId = currentSettings.theme;
	let lastScrollback = currentSettings.scrollback;
	let lastCursorBlink = currentSettings.cursorBlink;
	let lastRendererPref = currentSettings.renderer;
	let lastDisplayScale = currentSettings.displayScale;
	let lastPowerSaver = currentSettings.powerSaver;

	function notifySearchChange(detail) {
		for (const listener of searchListeners) {
			listener(detail);
		}
	}

	function getActiveTab() {
		const activeId = get(activeSessionId);
		return tabs.get(activeId) || tabs.get('tab-1') || null;
	}

	function getActiveTerminal() {
		return getActiveTab()?.term || null;
	}

	function routeWriteData(buf, vt) {
		if (disposed || vt !== 1) return;
		const targetTab = (activeRunTabId && tabs.get(activeRunTabId)) || tabs.get('tab-1');
		if (targetTab?.batcher) {
			targetTab.batcher.write(buf);
		}
	}

	function handleProcessCreated() {
		processCount++;
		if (processCallback) {
			processCallback(processCount);
		}
	}

	function handleActivateConsole(vt) {
		if (disposed) return;
		const normalized = vt === 7 ? 7 : 1;
		const changed = get(activeVt) !== normalized;
		if (changed) {
			activeVt.set(normalized);
		}
		if (normalized === 7) {
			if (changed) {
				tryPlausible('Display activated');
			}
			if (displayEl) {
				applyDisplayScale(true);
				getKmsInputElement()?.focus();
			}
		} else {
			getActiveTerminal()?.focus();
			scheduleResize();
		}
	}

	function setActiveVt(vt) {
		const normalized = vt === 7 ? 7 : 1;
		activeVt.set(normalized);
		if (normalized === 1) {
			getActiveTerminal()?.focus();
			scheduleResize();
		} else if (displayEl) {
			applyDisplayScale(true);
			getKmsInputElement()?.focus();
		}
	}

	function focusDisplay() {
		if (disposed || !configObj?.needsDisplay) return false;
		const textArea = getKmsInputElement();
		if (textArea) {
			textArea.focus();
			return true;
		}
		displayEl?.focus?.();
		return false;
	}

	function syncPrimaryPtySize(cols, rows) {
		if (disposed || !cx || cols <= 0 || rows <= 0) return;
		if (cols === lastPtyCols && rows === lastPtyRows) return;
		lastPtyCols = cols;
		lastPtyRows = rows;
		cxReadFunc = cx.setCustomConsole(routeWriteData, cols, rows);
		updateSession('tab-1', { cols, rows });
	}

	function applyDisplayScale(force = false) {
		if (disposed || !configObj?.needsDisplay || !cx || !displayEl) return;
		if (get(displayPaused)) return;

		const displayWidth = displayEl.clientWidth || displayEl.offsetWidth;
		const displayHeight = displayEl.clientHeight || displayEl.offsetHeight;
		if (displayWidth <= 0 || displayHeight <= 0) return;

		const scale = Math.min(2.0, Math.max(0.5, Number(currentSettings.displayScale) || 1));
		const internalWidth = Math.max(320, Math.floor(displayWidth * scale));
		const internalHeight = Math.max(240, Math.floor(displayHeight * scale));

		if (force || internalWidth !== lastKmsWidth || internalHeight !== lastKmsHeight) {
			lastKmsWidth = internalWidth;
			lastKmsHeight = internalHeight;
			if (typeof cx.setKmsCanvas === 'function') {
				cx.setKmsCanvas(displayEl, internalWidth, internalHeight);
			}
		}

		let screenshotMult = 1.0;
		const maxWidth = 1024;
		const maxHeight = 768;
		if (internalWidth > maxWidth) {
			screenshotMult = maxWidth / internalWidth;
		}
		if (internalHeight > maxHeight) {
			screenshotMult = Math.min(screenshotMult, maxHeight / internalHeight);
		}
		const screenshotWidth = Math.floor(internalWidth * screenshotMult);
		const screenshotHeight = Math.floor(internalHeight * screenshotMult);
		const internalMult = internalWidth / displayWidth;
		displayConfig.set({
			width: screenshotWidth,
			height: screenshotHeight,
			mouseMult: internalMult * screenshotMult
		});
	}

	function ensureDomRenderer(tab) {
		if (!tab?.term) return;
		const core = tab.term._core;
		const renderService = core?._renderService;
		if (!core || core._isDisposed || !renderService || typeof core._createRenderer !== 'function') {
			return;
		}
		if (tab.hostEl?.querySelector?.('.xterm-rows')) {
			return;
		}
		try {
			const domRenderer = core._createRenderer();
			renderService.setRenderer(domRenderer);
			renderService.handleResize?.(tab.term.cols, tab.term.rows);
			renderService.resize?.(tab.term.cols, tab.term.rows);
			const activeEl = typeof document !== 'undefined' ? document.activeElement : null;
			if (activeEl && tab.hostEl?.contains?.(activeEl)) {
				renderService.handleFocus?.();
			}
			core.viewport?.syncScrollArea?.(true);
		} catch {
			// Ignore renderer recovery failure
		}
	}

	function disposeWebglAddon(tab) {
		if (!tab) return;
		if (tab.webglAddon) {
			try {
				tab.webglAddon.dispose();
			} catch {
				// @xterm/addon-webgl@0.19.0 throws on @xterm/xterm@5.5.0 before restoring DOM renderer
			}
			tab.webglAddon = null;
		}
		ensureDomRenderer(tab);
	}

	function syncWebglForActiveTab() {
		if (disposed) return;
		const activeTab = getActiveTab();
		const wantWebgl = currentSettings.renderer !== 'dom' && !webglBlocked && Boolean(WebglAddonCtor);
		let recoveredDom = false;

		for (const [id, tab] of tabs.entries()) {
			const shouldKeep = wantWebgl && activeTab && id === activeTab.id;
			if (!shouldKeep && tab.webglAddon) {
				disposeWebglAddon(tab);
				if (activeTab && id === activeTab.id) {
					recoveredDom = true;
				}
			}
		}

		if (!activeTab || !wantWebgl) {
			if (activeTab && !recoveredDom) {
				ensureDomRenderer(activeTab);
			}
			activeRenderer.set('dom');
			return;
		}

		const hasDimensions =
			(activeTab.hostEl.offsetWidth > 0 && activeTab.hostEl.offsetHeight > 0) ||
			(consoleRoot?.offsetWidth > 0 && consoleRoot?.offsetHeight > 0);
		if (activeTab.hostEl.style.display === 'none' || !hasDimensions) {
			activeRenderer.set('dom');
			return;
		}

		if (activeTab.webglAddon) {
			activeRenderer.set('webgl');
			return;
		}

		try {
			const addon = new WebglAddonCtor();
			addon.onContextLoss(() => {
				if (!activeTab.webglAddon) {
					activeTab.webglAddon = addon;
				}
				disposeWebglAddon(activeTab);
				webglBlocked = true;
				activeRenderer.set('dom');
				addToast({
					message: 'WebGL context lost — fell back to DOM renderer',
					type: 'warning'
				});
			});
			activeTab.term.loadAddon(addon);
			activeTab.webglAddon = addon;
			activeRenderer.set('webgl');
		} catch {
			webglBlocked = true;
			ensureDomRenderer(activeTab);
			activeRenderer.set('dom');
		}
	}

	function performResize() {
		if (disposed) return;
		const activeTab = getActiveTab();
		const hasDimensions =
			(activeTab?.hostEl?.offsetWidth > 0 && activeTab?.hostEl?.offsetHeight > 0) ||
			(consoleRoot?.offsetWidth > 0 && consoleRoot?.offsetHeight > 0);
		if (activeTab?.fitAddon && activeTab.hostEl.style.display !== 'none' && hasDimensions) {
			try {
				activeTab.fitAddon.fit();
				updateSession(activeTab.id, {
					cols: activeTab.term.cols,
					rows: activeTab.term.rows
				});
				if (activeTab.id === 'tab-1') {
					syncPrimaryPtySize(activeTab.term.cols, activeTab.term.rows);
				}
			} catch {
				// Ignore transient layout states
			}
		}
		applyDisplayScale();
	}

	function scheduleResize() {
		if (disposed) return;
		if (resizeTimerId !== null) {
			clearTimeout(resizeTimerId);
		}
		resizeTimerId = setTimeout(() => {
			resizeTimerId = null;
			if (disposed) return;
			if (typeof requestAnimationFrame === 'function') {
				if (resizeRafId !== null) cancelAnimationFrame(resizeRafId);
				resizeRafId = requestAnimationFrame(() => {
					resizeRafId = null;
					performResize();
				});
			} else {
				performResize();
			}
		}, 150);
	}

	function applyTerminalSettings(next) {
		currentSettings = next;
		const hiddenOrSaver = (typeof document !== 'undefined' && document.hidden) || next.powerSaver;
		const fontChanged = next.fontSize !== lastFontSize || next.fontFamily !== lastFontFamily;
		const themeChanged = next.theme !== lastThemeId;
		const scrollbackChanged = next.scrollback !== lastScrollback;
		const blinkChanged = next.cursorBlink !== lastCursorBlink || next.powerSaver !== lastPowerSaver;
		const rendererChanged = next.renderer !== lastRendererPref;
		const scaleChanged = next.displayScale !== lastDisplayScale;

		for (const tab of tabs.values()) {
			const term = tab.term;
			if (!term) continue;
			if (next.fontSize !== lastFontSize) {
				term.options.fontSize = next.fontSize;
			}
			if (next.fontFamily !== lastFontFamily) {
				term.options.fontFamily = next.fontFamily;
			}
			if (themeChanged) {
				term.options.theme = getThemeDefinition(next.theme);
			}
			if (scrollbackChanged) {
				term.options.scrollback = next.scrollback;
			}
			if (blinkChanged) {
				term.options.cursorBlink = hiddenOrSaver ? false : next.cursorBlink;
			}
		}

		lastFontSize = next.fontSize;
		lastFontFamily = next.fontFamily;
		lastThemeId = next.theme;
		lastScrollback = next.scrollback;
		lastCursorBlink = next.cursorBlink;
		lastPowerSaver = next.powerSaver;

		if (rendererChanged) {
			lastRendererPref = next.renderer;
			if (next.renderer !== 'dom') {
				webglBlocked = false;
			}
			syncWebglForActiveTab();
		}

		if (fontChanged) {
			scheduleResize();
		}
		if (scaleChanged) {
			lastDisplayScale = next.displayScale;
			applyDisplayScale(true);
		}
		telemetry.setHidden(hiddenOrSaver);
	}

	function handleVisibilityChange() {
		if (disposed || typeof document === 'undefined') return;
		const docHidden = Boolean(document.hidden);
		pageHidden.set(docHidden);
		const pauseAll = docHidden || currentSettings.powerSaver;
		for (const tab of tabs.values()) {
			if (tab.term) {
				tab.term.options.cursorBlink = pauseAll ? false : currentSettings.cursorBlink;
			}
		}
		telemetry.setHidden(pauseAll);
		if (!docHidden) {
			scheduleResize();
		}
	}

	function runSerializedCommand(tabId, fn) {
		const task = secondaryRunChain.then(async () => {
			if (disposed) return null;
			activeRunTabId = tabId;
			try {
				return await fn();
			} finally {
				if (activeRunTabId === tabId) {
					activeRunTabId = null;
				}
			}
		});
		secondaryRunChain = task.catch(() => {});
		return task;
	}

	function setStickyModifiers(next) {
		const src = next && typeof next === 'object' ? next : {};
		stickyModifiers.set({
			ctrl: Boolean(src.ctrl),
			ctrlLocked: Boolean(src.ctrlLocked),
			alt: Boolean(src.alt),
			altLocked: Boolean(src.altLocked)
		});
	}

	function consumeStickyModifiers(data) {
		const mod = get(stickyModifiers);
		if (!mod.ctrl && !mod.alt) return data;
		const { output, consumedCtrl, consumedAlt } = applyTerminalModifiers(data, {
			ctrl: mod.ctrl,
			alt: mod.alt
		});
		if ((consumedCtrl && !mod.ctrlLocked) || (consumedAlt && !mod.altLocked)) {
			stickyModifiers.set({
				ctrl: consumedCtrl && !mod.ctrlLocked ? false : mod.ctrl,
				ctrlLocked: mod.ctrlLocked,
				alt: consumedAlt && !mod.altLocked ? false : mod.alt,
				altLocked: mod.altLocked
			});
		}
		return output;
	}

	function attachShellController(tab) {
		const home = getEnvValue(tab.env, 'HOME', '/home/user');
		const user = getEnvValue(tab.env, 'USER', 'user');
		let chars = [];
		let cursor = 0;
		const history = [];
		let historyIdx = 0;
		let busy = false;
		let exited = false;

		function writeRaw(str) {
			tab.batcher.writeText(str);
		}

		function widthBetween(start, end) {
			let w = 0;
			for (let idx = start; idx < end; idx++) {
				w += getDisplayWidth(chars[idx]);
			}
			return w;
		}

		function renderPrompt(suffix = '') {
			if (exited || disposed) return;
			const shortCwd = tab.cwd === home ? '~' : tab.cwd;
			const prefix = suffix ? `${suffix}` : '';
			writeRaw(`${prefix}\x1b[32m${user}@webvm\x1b[0m:\x1b[34m${shortCwd}\x1b[0m$ `);
		}

		function redrawLine() {
			const shortCwd = tab.cwd === home ? '~' : tab.cwd;
			const promptText = `\x1b[32m${user}@webvm\x1b[0m:\x1b[34m${shortCwd}\x1b[0m$ `;
			const fullLine = chars.join('');
			const tailWidth = widthBetween(cursor, chars.length);
			const backSeq = tailWidth > 0 ? `\x1b[${tailWidth}D` : '';
			writeRaw(`\r${promptText}${fullLine}\x1b[K${backSeq}`);
		}

		function replaceLine(nextLine) {
			chars = Array.from(nextLine || '');
			cursor = chars.length;
			redrawLine();
		}

		async function executeLine(rawCmd) {
			const trimmed = rawCmd.trim();
			if (!trimmed) {
				renderPrompt();
				return;
			}
			if (history[history.length - 1] !== trimmed) {
				history.push(trimmed);
				if (history.length > 200) history.shift();
			}
			historyIdx = history.length;

			if (trimmed === 'clear') {
				tab.term.clear();
				renderPrompt();
				return;
			}
			if (trimmed === 'help') {
				writeRaw(
					'WebVM secondary shell tab (commands run via cx.run /bin/sh -c):\r\n' +
						'  Built-ins: cd, pwd, export VAR=VAL, unset VAR, env, history, clear, exit\r\n'
				);
				renderPrompt();
				return;
			}
			if (trimmed === 'pwd') {
				writeRaw(`${tab.cwd}\r\n`);
				renderPrompt();
				return;
			}
			if (trimmed === 'env') {
				writeRaw(tab.env.join('\r\n') + (tab.env.length ? '\r\n' : ''));
				renderPrompt();
				return;
			}
			if (trimmed === 'history') {
				writeRaw(history.map((cmd, idx) => `  ${idx + 1}  ${cmd}`).join('\r\n') + '\r\n');
				renderPrompt();
				return;
			}
			if (trimmed === 'exit' || trimmed.startsWith('exit ')) {
				const arg = trimmed.slice(4).trim();
				const code = arg ? Number.parseInt(arg, 10) || 0 : 0;
				exited = true;
				updateSession(tab.id, { status: 'exited', exitCode: code });
				writeRaw(`[Session exited with code ${code}]\r\n`);
				return;
			}
			if (trimmed.startsWith('export ')) {
				const rest = trimmed.slice(7).trim();
				const eqIdx = rest.indexOf('=');
				if (eqIdx > 0) {
					const k = rest.slice(0, eqIdx).trim();
					let v = rest.slice(eqIdx + 1).trim();
					if (
						(v.startsWith('"') && v.endsWith('"')) ||
						(v.startsWith("'") && v.endsWith("'"))
					) {
						v = v.slice(1, -1);
					}
					tab.env = updateEnvList(tab.env, k, v);
					updateSession(tab.id, { env: [...tab.env] });
				}
				renderPrompt();
				return;
			}
			if (trimmed.startsWith('unset ')) {
				const k = trimmed.slice(6).trim();
				if (k) {
					tab.env = updateEnvList(tab.env, k, null);
					updateSession(tab.id, { env: [...tab.env] });
				}
				renderPrompt();
				return;
			}
			if (trimmed === 'cd' || trimmed.startsWith('cd ')) {
				const target = trimmed.slice(2).trim();
				const nextDir = resolveShellPath(tab.cwd, target, home);
				if (!cx) {
					tab.cwd = nextDir;
					tab.env = updateEnvList(tab.env, 'PWD', nextDir);
					updateSession(tab.id, { cwd: nextDir, env: [...tab.env] });
					renderPrompt();
					return;
				}
				busy = true;
				try {
					const res = await runSerializedCommand(tab.id, () =>
						cx.run('/bin/sh', ['-c', `test -d ${shellQuote(nextDir)}`], {
							cwd: tab.cwd,
							env: tab.env,
							uid: configObj?.opts?.uid,
							gid: configObj?.opts?.gid
						})
					);
					const code = typeof res?.status === 'number' ? res.status : 0;
					if (code === 0) {
						tab.cwd = nextDir;
						tab.env = updateEnvList(tab.env, 'PWD', nextDir);
						updateSession(tab.id, { cwd: nextDir, env: [...tab.env], exitCode: 0 });
					} else {
						writeRaw(`cd: ${target}: No such directory\r\n`);
						updateSession(tab.id, { exitCode: code });
					}
				} catch (err) {
					writeRaw(`cd: ${err?.message || err}\r\n`);
				} finally {
					busy = false;
				}
				renderPrompt();
				return;
			}

			if (!cx) {
				writeRaw('[VM not ready yet — wait for boot or use local built-ins (help, pwd, env, cd)]\r\n');
				renderPrompt();
				return;
			}

			busy = true;
			updateSession(tab.id, { status: 'running', exitCode: null });
			try {
				const res = await runSerializedCommand(tab.id, () =>
					cx.run('/bin/sh', ['-c', trimmed], {
						cwd: tab.cwd,
						env: tab.env,
						uid: configObj?.opts?.uid,
						gid: configObj?.opts?.gid
					})
				);
				const code = typeof res?.status === 'number' ? res.status : 0;
				updateSession(tab.id, { status: 'running', exitCode: code });
				if (code !== 0) {
					writeRaw(`\r\n[exit ${code}]\r\n`);
				}
			} catch (err) {
				updateSession(tab.id, { status: 'error', exitCode: 1 });
				writeRaw(`\r\n[error: ${err?.message || err}]\r\n`);
			} finally {
				busy = false;
			}
			renderPrompt();
		}

		function handleData(data) {
			if (disposed || exited || typeof data !== 'string' || data.length === 0) return;
			if (busy) {
				if (data === '\x03') {
					writeRaw('^C\r\n');
				}
				return;
			}

			let i = 0;
			while (i < data.length) {
				if (data.startsWith('\x1b[A', i)) {
					if (historyIdx > 0) {
						historyIdx--;
						replaceLine(history[historyIdx] || '');
					}
					i += 3;
					continue;
				}
				if (data.startsWith('\x1b[B', i)) {
					if (historyIdx < history.length) {
						historyIdx++;
						replaceLine(historyIdx === history.length ? '' : history[historyIdx] || '');
					}
					i += 3;
					continue;
				}
				if (data.startsWith('\x1b[D', i)) {
					if (cursor > 0) {
						cursor--;
						const w = getDisplayWidth(chars[cursor]);
						if (w > 0) writeRaw(`\x1b[${w}D`);
					}
					i += 3;
					continue;
				}
				if (data.startsWith('\x1b[C', i)) {
					if (cursor < chars.length) {
						const w = getDisplayWidth(chars[cursor]);
						cursor++;
						if (w > 0) writeRaw(`\x1b[${w}C`);
					}
					i += 3;
					continue;
				}
				if (
					data.startsWith('\x1b[1;5D', i) ||
					data.startsWith('\x1b[1;3D', i) ||
					data.startsWith('\x1bb', i)
				) {
					const prevCursor = cursor;
					while (cursor > 0 && /\s/.test(chars[cursor - 1])) cursor--;
					while (cursor > 0 && !/\s/.test(chars[cursor - 1])) cursor--;
					const w = widthBetween(cursor, prevCursor);
					if (w > 0) writeRaw(`\x1b[${w}D`);
					i += data.startsWith('\x1bb', i) ? 2 : 6;
					continue;
				}
				if (
					data.startsWith('\x1b[1;5C', i) ||
					data.startsWith('\x1b[1;3C', i) ||
					data.startsWith('\x1bf', i)
				) {
					const prevCursor = cursor;
					while (cursor < chars.length && /\s/.test(chars[cursor])) cursor++;
					while (cursor < chars.length && !/\s/.test(chars[cursor])) cursor++;
					const w = widthBetween(prevCursor, cursor);
					if (w > 0) writeRaw(`\x1b[${w}C`);
					i += data.startsWith('\x1bf', i) ? 2 : 6;
					continue;
				}
				if (data.startsWith('\x1b[H', i) || data.startsWith('\x1b[1~', i)) {
					if (cursor > 0) {
						const w = widthBetween(0, cursor);
						cursor = 0;
						if (w > 0) writeRaw(`\x1b[${w}D`);
					}
					i += data.startsWith('\x1b[H', i) ? 3 : 4;
					continue;
				}
				if (data.startsWith('\x1b[F', i) || data.startsWith('\x1b[4~', i)) {
					if (cursor < chars.length) {
						const w = widthBetween(cursor, chars.length);
						cursor = chars.length;
						if (w > 0) writeRaw(`\x1b[${w}C`);
					}
					i += data.startsWith('\x1b[F', i) ? 3 : 4;
					continue;
				}
				if (data.startsWith('\x1b[3~', i)) {
					if (cursor < chars.length) {
						chars.splice(cursor, 1);
						redrawLine();
					}
					i += 4;
					continue;
				}
				if (data[i] === '\x1b') {
					const rest = data.slice(i);
					const csiMatch = rest.match(/^\x1b\[[0-?]*[ -/]*[@-~]/);
					if (csiMatch) {
						i += csiMatch[0].length;
						continue;
					}
					const ss3Match = rest.match(/^\x1bO[ -~]/);
					if (ss3Match) {
						i += ss3Match[0].length;
						continue;
					}
					if (i + 1 < data.length) {
						const nextCp = data.codePointAt(i + 1);
						i += 1 + (nextCp !== undefined && nextCp > 0xffff ? 2 : 1);
					} else {
						i += 1;
					}
					continue;
				}

				const cp = data.codePointAt(i);
				const ch = String.fromCodePoint(cp);
				i += ch.length;

				if (ch === '\r' || ch === '\n') {
					const toRun = chars.join('');
					chars = [];
					cursor = 0;
					writeRaw('\r\n');
					void executeLine(toRun);
					if (ch === '\r' && data[i] === '\n') i++;
				} else if (ch === '\x7f' || ch === '\b') {
					if (cursor > 0) {
						const removed = chars[cursor - 1];
						const w = getDisplayWidth(removed);
						chars.splice(cursor - 1, 1);
						cursor--;
						if (cursor === chars.length && w > 0) {
							writeRaw(`\x1b[${w}D\x1b[K`);
						} else {
							redrawLine();
						}
					}
				} else if (ch === '\x03') {
					chars = [];
					cursor = 0;
					writeRaw('^C\r\n');
					renderPrompt();
				} else if (ch === '\x04') {
					if (chars.length === 0) {
						exited = true;
						updateSession(tab.id, { status: 'exited', exitCode: 0 });
						writeRaw('exit\r\n[Session exited with code 0]\r\n');
						return;
					}
				} else if (ch === '\x0c') {
					tab.term.clear();
					redrawLine();
				} else if (ch === '\x15') {
					chars = [];
					cursor = 0;
					redrawLine();
				} else if (ch === '\x01') {
					if (cursor > 0) {
						const w = widthBetween(0, cursor);
						cursor = 0;
						if (w > 0) writeRaw(`\x1b[${w}D`);
					}
				} else if (ch === '\x05') {
					if (cursor < chars.length) {
						const w = widthBetween(cursor, chars.length);
						cursor = chars.length;
						if (w > 0) writeRaw(`\x1b[${w}C`);
					}
				} else if (cp >= 0x20 || ch === '\t') {
					if (ch === '\t') {
						chars.splice(cursor, 0, ' ', ' ');
						cursor += 2;
						if (cursor === chars.length) {
							writeRaw('  ');
						} else {
							redrawLine();
						}
					} else {
						chars.splice(cursor, 0, ch);
						cursor++;
						if (cursor === chars.length) {
							writeRaw(ch);
						} else {
							redrawLine();
						}
					}
				}
			}
		}

		const dataDisposable = tab.term.onData((data) => handleData(consumeStickyModifiers(data)));
		tab.disposables.push(dataDisposable);

		writeRaw('WebVM secondary shell session (type "help" for built-ins)\r\n');
		renderPrompt();

		return {
			reset() {
				exited = false;
				busy = false;
				chars = [];
				cursor = 0;
				updateSession(tab.id, { status: 'running', exitCode: null });
				tab.term.clear();
				writeRaw('Session restarted.\r\n');
				renderPrompt();
			},
			sendInput(str) {
				handleData(str);
			}
		};
	}

	function createTerminalInstance(tabId, kind, sessionOpts = {}) {
		if (!TerminalCtor || !consoleRoot) return null;

		const hiddenOrSaver = (typeof document !== 'undefined' && document.hidden) || currentSettings.powerSaver;
		const term = new TerminalCtor({
			cursorBlink: hiddenOrSaver ? false : currentSettings.cursorBlink,
			convertEol: true,
			fontFamily: currentSettings.fontFamily,
			fontWeight: 400,
			fontWeightBold: 700,
			fontSize: currentSettings.fontSize,
			scrollback: currentSettings.scrollback,
			theme: getThemeDefinition(currentSettings.theme)
		});

		const fitAddon = FitAddonCtor ? new FitAddonCtor() : null;
		const linkAddon = WebLinksAddonCtor ? new WebLinksAddonCtor() : null;
		const searchAddon = SearchAddonCtor ? new SearchAddonCtor() : null;

		if (fitAddon) term.loadAddon(fitAddon);
		if (linkAddon) term.loadAddon(linkAddon);
		if (searchAddon) term.loadAddon(searchAddon);

		const hostEl = document.createElement('div');
		hostEl.className = 'w-full h-full';
		hostEl.dataset.sessionId = tabId;
		consoleRoot.appendChild(hostEl);

		term.open(hostEl);
		term.scrollToTop();
		if (fitAddon) {
			try {
				fitAddon.fit();
			} catch {
				// Ignore zero-size container on initial mount
			}
		}

		const batcher = createTerminalBatcher(term, {
			isHidden: () => typeof document !== 'undefined' && Boolean(document.hidden)
		});

		const osc52Disposer = registerOsc52Handler(term, {
			onCopy: async (text) => {
				if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
					try {
						await navigator.clipboard.writeText(text);
						addToast({ message: 'Copied to clipboard (OSC-52)', type: 'success' });
					} catch {
						addToast({ message: 'Clipboard write blocked by browser', type: 'warning' });
					}
				}
			}
		});

		const disposables = [osc52Disposer];
		if (typeof term.onBell === 'function') {
			disposables.push(term.onBell(() => ringTerminalBell(get(settings).audioBell)));
		}
		if (searchAddon?.onDidChangeResults) {
			disposables.push(
				searchAddon.onDidChangeResults((ev) => {
					if (get(activeSessionId) === tabId) {
						notifySearchChange({
							resultIndex: ev?.resultIndex ?? -1,
							resultCount: ev?.resultCount ?? 0
						});
					}
				})
			);
		}

		const baseEnv = [...(configObj?.opts?.env || ['HOME=/home/user', 'TERM=xterm', 'USER=user', 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'])];
		const resolvedEnv = Array.isArray(sessionOpts.env) ? [...sessionOpts.env] : baseEnv;
		if (configObj?.needsDisplay && !resolvedEnv.some((e) => e.startsWith('DISPLAY='))) {
			resolvedEnv.push('DISPLAY=:0');
		}

		const tab = {
			id: tabId,
			kind,
			term,
			hostEl,
			fitAddon,
			linkAddon,
			searchAddon,
			webglAddon: null,
			batcher,
			disposables,
			cwd: sessionOpts.cwd || configObj?.opts?.cwd || '/home/user',
			env: resolvedEnv,
			cmd: sessionOpts.cmd || '/bin/sh',
			args: Array.isArray(sessionOpts.args) ? [...sessionOpts.args] : [],
			uid: sessionOpts.uid ?? configObj?.opts?.uid,
			gid: sessionOpts.gid ?? configObj?.opts?.gid,
			shellController: null
		};

		tabs.set(tabId, tab);

		if (kind === 'primary') {
			disposables.push(
				term.onData((data) => inputWriter.write(consumeStickyModifiers(data))),
				term.onBinary((data) => inputWriter.sendBinary(data)),
				term.onResize(({ cols, rows }) => syncPrimaryPtySize(cols, rows))
			);
		} else if (kind === 'shell') {
			tab.shellController = attachShellController(tab);
		}

		upsertSession({
			id: tabId,
			title: sessionOpts.title || (kind === 'primary' ? (configObj?.cmd === '/sbin/init' ? 'init' : 'bash') : tabId),
			kind,
			status: sessionOpts.status || (kind === 'primary' ? 'starting' : 'running'),
			exitCode: null,
			cmd: tab.cmd,
			args: tab.args,
			cwd: tab.cwd,
			env: [...tab.env],
			cols: term.cols || 80,
			rows: term.rows || 24
		});

		return tab;
	}

	function showTabContainer(targetId) {
		for (const [id, tab] of tabs.entries()) {
			tab.hostEl.style.display = id === targetId ? 'block' : 'none';
		}
	}

	function switchTab(id) {
		if (disposed || !tabs.has(id)) return;
		setActiveSession(id);
		showTabContainer(id);
		const tab = tabs.get(id);
		if (tab.fitAddon) {
			try {
				tab.fitAddon.fit();
				updateSession(id, { cols: tab.term.cols, rows: tab.term.rows });
			} catch {
				// Ignore
			}
		}
		syncWebglForActiveTab();
		if (get(activeVt) === 1) {
			tab.term.focus();
		}
		notifySearchChange({ resultIndex: -1, resultCount: 0 });
	}

	function createShellTab(opts = {}) {
		if (disposed) return null;
		const currentList = get(sessions);
		if (currentList.length >= MAX_SESSIONS) {
			addToast({ message: `Maximum of ${MAX_SESSIONS} terminal tabs reached`, type: 'warning' });
			return null;
		}
		tabSeq++;
		const id = opts.id || `tab-${tabSeq}`;
		const title = opts.title || `shell-${tabSeq - 1}`;
		const tab = createTerminalInstance(id, 'shell', {
			title,
			cwd: opts.cwd || configObj?.opts?.cwd || '/home/user',
			env: opts.env,
			status: 'running'
		});
		if (!tab) return null;
		switchTab(id);
		return id;
	}

	async function runSession({ title, cmd, args = [], cwd, env, uid, gid } = {}) {
		if (disposed || !cmd) return { status: 1 };
		const currentList = get(sessions);
		if (currentList.length >= MAX_SESSIONS) {
			addToast({ message: `Maximum of ${MAX_SESSIONS} terminal tabs reached`, type: 'warning' });
			return { status: 1 };
		}
		tabSeq++;
		const id = `task-${tabSeq}`;
		const tab = createTerminalInstance(id, 'task', {
			title: title || cmd.split('/').pop() || `task-${tabSeq}`,
			cmd,
			args,
			cwd: cwd || configObj?.opts?.cwd || '/home/user',
			env,
			uid,
			gid,
			status: 'running'
		});
		if (!tab) return { status: 1 };
		switchTab(id);
		tab.batcher.writeText(`$ ${cmd} ${args.join(' ')}\r\n`);

		if (!cx) {
			updateSession(id, { status: 'error', exitCode: 1 });
			tab.batcher.writeText('[VM is not initialized]\r\n');
			return { status: 1 };
		}

		try {
			const res = await runSerializedCommand(id, () =>
				cx.run(cmd, args, {
					cwd: tab.cwd,
					env: tab.env,
					uid: tab.uid,
					gid: tab.gid
				})
			);
			if (disposed) return { status: 1 };
			const code = typeof res?.status === 'number' ? res.status : 0;
			updateSession(id, {
				status: code === 0 ? 'exited' : 'error',
				exitCode: code
			});
			tab.batcher.writeText(`\r\n[Task exited with code ${code}]\r\n`);
			return { status: code };
		} catch (err) {
			if (disposed) return { status: 1 };
			updateSession(id, { status: 'error', exitCode: 1 });
			tab.batcher.writeText(`\r\n[Task failed: ${err?.message || err}]\r\n`);
			return { status: 1 };
		}
	}

	function isReady() {
		return Boolean(cx) && !disposed;
	}

	function backgroundOpts() {
		const env = Array.isArray(configObj?.opts?.env) ? [...configObj.opts.env] : [];
		if (configObj?.needsDisplay && !env.some((e) => e.startsWith('DISPLAY='))) {
			env.push('DISPLAY=:0');
		}
		return {
			cwd: configObj?.opts?.cwd || '/home/user',
			env: env.length > 0 ? env : configObj?.opts?.env,
			uid: configObj?.opts?.uid,
			gid: configObj?.opts?.gid
		};
	}

	// Runs a detached process (not serialized with terminal tasks, no tab). Resolves on exit.
	async function spawnBackground(id, shellCommand) {
		if (!isReady()) throw new Error('VM is not ready');
		const res = await cx.run('/bin/sh', ['-c', shellCommand], backgroundOpts());
		return { id, status: typeof res?.status === 'number' ? res.status : 0 };
	}

	async function execQuiet(script) {
		if (!isReady()) throw new Error('VM is not ready');
		const res = await cx.run('/bin/sh', ['-c', script], backgroundOpts());
		return { status: typeof res?.status === 'number' ? res.status : 0 };
	}

	const PS_SNAPSHOT_PATH = '/home/user/workspace/.webvm-ps';

	// Dumps /proc inside the VM into the workspace volume and reads it back from the host side.
	async function snapshotProcesses() {
		if (!isReady() || !workspaceDevice?.readFileAsBlob) return null;
		await execQuiet(buildSnapshotScript(PS_SNAPSHOT_PATH));
		const blob = await workspaceDevice.readFileAsBlob('/.webvm-ps');
		return parseProcSnapshot(await blob.text());
	}

	// "Stop" for a terminal session: sends Ctrl-C to its foreground job.
	function interruptSession(id) {
		const tab = tabs.get(id);
		if (!tab || disposed) return false;
		if (tab.kind === 'primary') {
			if (!isReady()) return false;
			inputWriter.write('\x03');
			return true;
		}
		if (tab.shellController) {
			tab.shellController.sendInput('\x03');
			return true;
		}
		return false;
	}

	function renameTab(id, nextTitle) {
		const trimmed = String(nextTitle || '').trim();
		if (!trimmed) return;
		updateSession(id, { title: trimmed.slice(0, 32) });
	}

	function closeTab(id) {
		const tab = tabs.get(id);
		if (!tab || tab.kind === 'primary') return;

		if (activeRunTabId === id) {
			activeRunTabId = null;
		}

		for (const d of tab.disposables) {
			try {
				d?.dispose?.();
			} catch {
				// Ignore
			}
		}
		try {
			tab.webglAddon?.dispose?.();
		} catch {
			// Ignore
		}
		try {
			tab.batcher?.dispose?.();
		} catch {
			// Ignore
		}
		try {
			tab.term?.dispose?.();
		} catch {
			// Ignore
		}
		tab.hostEl?.remove();
		tabs.delete(id);

		removeSession(id);
		const nextActive = get(activeSessionId) || 'tab-1';
		if (tabs.has(nextActive)) {
			showTabContainer(nextActive);
			syncWebglForActiveTab();
			tabs.get(nextActive)?.fitAddon?.fit();
		}
	}

	async function restartTab(id) {
		const tab = tabs.get(id);
		if (!tab || disposed) return;
		if (tab.kind === 'shell' && tab.shellController) {
			tab.shellController.reset();
			return;
		}
		if (tab.kind === 'task') {
			updateSession(id, { status: 'running', exitCode: null });
			tab.batcher.writeText(`\r\n[Restarting ${tab.cmd}...]\r\n`);
			if (!cx) {
				updateSession(id, { status: 'error', exitCode: 1 });
				tab.batcher.writeText('[VM is not initialized]\r\n');
				return;
			}
			try {
				const res = await runSerializedCommand(id, () =>
					cx.run(tab.cmd, tab.args, { cwd: tab.cwd, env: tab.env, uid: tab.uid, gid: tab.gid })
				);
				if (disposed) return;
				const code = typeof res?.status === 'number' ? res.status : 0;
				updateSession(id, { status: code === 0 ? 'exited' : 'error', exitCode: code });
				tab.batcher.writeText(`\r\n[Task exited with code ${code}]\r\n`);
			} catch (err) {
				if (disposed) return;
				updateSession(id, { status: 'error', exitCode: 1 });
				tab.batcher.writeText(`\r\n[Task failed: ${err?.message || err}]\r\n`);
			}
			return;
		}
		if (tab.kind === 'primary') {
			if (!cx) {
				await initCheerpX();
			} else {
				addToast({ message: 'Primary session auto-restarts on exit', type: 'info' });
			}
		}
	}

	function sendInputToActive(str) {
		if (disposed || !str) return;
		if (get(activeVt) === 7 && configObj?.needsDisplay) {
			sendKeySequenceToKms(str);
			return;
		}
		const tab = getActiveTab();
		if (!tab) return;
		if (tab.kind === 'primary') {
			inputWriter.write(str);
		} else if (tab.shellController) {
			tab.shellController.sendInput(str);
		}
	}

	function search(query, opts = {}) {
		const tab = getActiveTab();
		const searchAddon = tab?.searchAddon;
		if (!searchAddon) return false;
		if (!query) {
			searchAddon.clearDecorations();
			notifySearchChange({ resultIndex: -1, resultCount: 0 });
			return false;
		}
		const searchOpts = {
			caseSensitive: Boolean(opts.caseSensitive),
			regex: Boolean(opts.regex),
			wholeWord: Boolean(opts.wholeWord),
			incremental: opts.incremental !== false,
			decorations: SEARCH_DECORATIONS
		};
		try {
			if (opts.direction === 'previous') {
				return searchAddon.findPrevious(query, searchOpts);
			}
			return searchAddon.findNext(query, searchOpts);
		} catch {
			// Invalid regex or search error
			return false;
		}
	}

	function clearSearch() {
		const tab = getActiveTab();
		tab?.searchAddon?.clearDecorations();
		notifySearchChange({ resultIndex: -1, resultCount: 0 });
	}

	async function copySelection() {
		if (get(activeVt) === 7) {
			addToast({
				message: 'Use Ctrl+C inside the graphical desktop, or Paste to send host text to X11',
				type: 'info'
			});
			return false;
		}
		const term = getActiveTerminal();
		const sel = term?.getSelection?.() || '';
		if (!sel) {
			addToast({ message: 'No text selected in terminal', type: 'info' });
			return false;
		}
		try {
			if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(sel);
				addToast({ message: 'Copied selection to clipboard', type: 'success' });
				return true;
			}
		} catch {
			addToast({ message: 'Clipboard copy denied by browser', type: 'warning' });
		}
		return false;
	}

	async function pasteClipboard(fallbackText = null) {
		let text = fallbackText;
		if (text == null) {
			try {
				if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
					text = await navigator.clipboard.readText();
				}
			} catch {
				addToast({
					message: 'Clipboard read blocked — use Ctrl+V / Shift+Insert in terminal',
					type: 'warning'
				});
				return false;
			}
		}
		if (!text) return false;

		if (get(activeVt) === 7) {
			const ok = await sendTextToKms(text);
			addToast({
				message: ok ? 'Pasted text into X11 display' : 'X11 display input not ready',
				type: ok ? 'success' : 'warning'
			});
			return ok;
		}

		const term = getActiveTerminal();
		if (term?.paste) {
			term.paste(text);
		} else {
			sendInputToActive(text);
		}
		return true;
	}

	async function createBlockDevice(CheerpX) {
		switch (configObj.diskImageType) {
			case 'cloud':
				try {
					return await CheerpX.CloudDevice.create(configObj.diskImageUrl);
				} catch (e) {
					const wssProtocol = 'wss:';
					if (configObj.diskImageUrl?.startsWith(wssProtocol)) {
						tryPlausible('WS Disk failure');
						return await CheerpX.CloudDevice.create(
							'https:' + configObj.diskImageUrl.slice(wssProtocol.length)
						);
					}
					throw e;
				}
			case 'bytes':
				return await CheerpX.HttpBytesDevice.create(configObj.diskImageUrl);
			case 'github':
				return await CheerpX.GitHubDevice.create(configObj.diskImageUrl);
			default:
				throw new Error('Unrecognized device type');
		}
	}

	async function runPrimaryLoop(gen) {
		if (!cx) return;
		while (!disposed && primaryBootGen === gen) {
			updateSession('tab-1', { status: 'running', exitCode: null });
			try {
				const res = await cx.run(configObj.cmd, configObj.args, configObj.opts);
				if (disposed || primaryBootGen !== gen) break;
				const code = typeof res?.status === 'number' ? res.status : 0;
				updateSession('tab-1', { status: 'exited', exitCode: code });
				tabs.get('tab-1')?.batcher?.writeText(
					`\r\n[Process exited with code ${code} — restarting...]\r\n`
				);
			} catch (err) {
				if (disposed || primaryBootGen !== gen) break;
				updateSession('tab-1', { status: 'error', exitCode: 1 });
				tabs.get('tab-1')?.batcher?.writeText(`\r\n[Process error: ${err?.message || err}]\r\n`);
				break;
			}
		}
	}

	async function initCheerpX(cheerpxImportPromise = null) {
		if (disposed) return;
		if (initPromise) return initPromise;
		const gen = ++primaryBootGen;
		const primaryTab = tabs.get('tab-1');
		initPromise = (async () => {
			try {
				bootState.set({
					phase: 'runtime',
					progress: 20,
					message: 'Loading CheerpX virtualization runtime...',
					ready: false,
					error: null
				});
				const CheerpX = CheerpXMod || (await (cheerpxImportPromise || import('@leaningtech/cheerpx')));
				CheerpXMod = CheerpX;
				if (disposed) return;

				bootState.set({
					phase: 'devices',
					progress: 40,
					message: 'Initializing disk & filesystem devices...',
					ready: false,
					error: null
				});

				// CheerpX 1.4.0 sets an internal `aY = 1` flag synchronously on the first CheerpOS device
				// (.create on IDBDevice/WebDevice/DataDevice) while asynchronously loading cheerpOS.js.
				// Await the first IDBDevice alongside the independent block device using allSettled so
				// cheerpOS.js finishes loading before any subsequent CheerpOS device .create() runs,
				// even if createBlockDevice rejects early before a retry.
				const [blockRes, cacheRes] = await Promise.allSettled([
					createBlockDevice(CheerpX),
					CheerpX.IDBDevice.create(cacheId)
				]);
				if (disposed) return;
				if (blockRes.status === 'rejected') throw blockRes.reason;
				if (cacheRes.status === 'rejected') throw cacheRes.reason;
				const blockDevice = blockRes.value;
				const createdCache = cacheRes.value;

				const [createdWorkspace, webDevice, documentsDevice, createdDataDevice] = await Promise.all([
					CheerpX.IDBDevice.create(workspaceCacheId),
					CheerpX.WebDevice.create('.'),
					CheerpX.WebDevice.create('documents'),
					CheerpX.DataDevice.create()
				]);
				if (disposed) return;

			blockCache = createdCache;
			workspaceDevice = createdWorkspace;
			dataDevice = createdDataDevice;
			bootState.set({
				phase: 'overlay',
				progress: 70,
				message: 'Mounting Linux root filesystem...',
				ready: false,
				error: null
			});

			const overlayDevice = await CheerpX.OverlayDevice.create(blockDevice, blockCache);
			if (disposed) return;

			const mountPoints = [
				{ type: 'ext2', dev: overlayDevice, path: '/' },
				{ type: 'dir', dev: webDevice, path: '/web' },
				{ type: 'dir', dev: dataDevice, path: '/data' },
				{ type: 'devs', path: '/dev' },
				{ type: 'devpts', path: '/dev/pts' },
				{ type: 'proc', path: '/proc' },
				{ type: 'sys', path: '/sys' },
				{ type: 'dir', dev: documentsDevice, path: '/home/user/documents' },
				{ type: 'dir', dev: workspaceDevice, path: '/home/user/workspace' }
			];

			bootState.set({
				phase: 'linux',
				progress: 85,
				message: 'Creating Linux environment...',
				ready: false,
				error: null
			});

			let createdCx = null;
			try {
				createdCx = await CheerpX.Linux.create({
					mounts: mountPoints,
					networkInterface
				});
			} catch (e) {
				if (disposed) return;
				primaryTab?.batcher?.printMessage(errorMessage);
				primaryTab?.batcher?.printMessage([String(e)]);
				updateSession('tab-1', { status: 'error', exitCode: 1 });
				vmState.set('error');
				bootState.set({
					phase: 'error',
					progress: 0,
					message: e?.message || String(e),
					ready: false,
					error: e?.message || String(e)
				});
				return;
			}

			if (disposed) {
				try {
					createdCx?.delete?.();
				} catch {
					// Ignore
				}
				cx = null;
				return;
			}
			cx = createdCx;

			cx.registerCallback('cpuActivity', telemetry.cpuCallback);
			cx.registerCallback('diskActivity', telemetry.hddCallback);
			cx.registerCallback('diskLatency', telemetry.latencyCallback);
			cx.registerCallback('processCreated', handleProcessCreated);

			primaryTab?.term?.scrollToBottom();
			const cols = primaryTab?.term?.cols || 80;
			const rows = primaryTab?.term?.rows || 24;
			lastPtyCols = cols;
			lastPtyRows = rows;
			cxReadFunc = cx.setCustomConsole(routeWriteData, cols, rows);

			if (displayEl && configObj?.needsDisplay) {
				applyDisplayScale(true);
				cx.setActivateConsole(handleActivateConsole);
			}

			vmState.set('ready');
			bootState.set({
				phase: 'ready',
				progress: 100,
				message: 'System ready',
				ready: true,
				error: null
			});

			void runPrimaryLoop(gen);
			} catch (e) {
				if (disposed) return;
				primaryTab?.batcher?.printMessage(unexpectedErrorMessage);
				primaryTab?.batcher?.printMessage([String(e)]);
				updateSession('tab-1', { status: 'error', exitCode: 1 });
				vmState.set('error');
				bootState.set({
					phase: 'error',
					progress: 0,
					message: e?.message || String(e),
					ready: false,
					error: e?.message || String(e)
				});
			}
		})();
		try {
			return await initPromise;
		} finally {
			initPromise = null;
		}
	}

	async function boot({ consoleElement, displayElement = null } = {}) {
		if (disposed) return;
		consoleRoot = consoleElement;
		displayEl = displayElement;

		resetSessionsStore();
		vtAvailable.set(Boolean(configObj?.needsDisplay));
		activeVt.set(1);
		vmState.set('booting');
		bootState.set({
			phase: 'imports',
			progress: 10,
			message: 'Loading terminal & virtualization modules...',
			ready: false,
			error: null
		});

		const loadDynamicDeps = options.loadDeps
			? options.loadDeps()
			: Promise.allSettled([
					TerminalCtor ? Promise.resolve({ Terminal: TerminalCtor }) : import('@xterm/xterm'),
					FitAddonCtor ? Promise.resolve({ FitAddon: FitAddonCtor }) : import('@xterm/addon-fit'),
					WebLinksAddonCtor
						? Promise.resolve({ WebLinksAddon: WebLinksAddonCtor })
						: import('@xterm/addon-web-links'),
					SearchAddonCtor
						? Promise.resolve({ SearchAddon: SearchAddonCtor })
						: import('@xterm/addon-search'),
					WebglAddonCtor
						? Promise.resolve({ WebglAddon: WebglAddonCtor })
						: import('@xterm/addon-webgl'),
					CheerpXMod ? Promise.resolve(CheerpXMod) : import('@leaningtech/cheerpx')
				]);

		const depResults = await loadDynamicDeps;
		if (disposed) return;

		let cheerpxPromise;
		if (options.loadDeps) {
			TerminalCtor = depResults.Terminal;
			FitAddonCtor = depResults.FitAddon;
			WebLinksAddonCtor = depResults.WebLinksAddon;
			SearchAddonCtor = depResults.SearchAddon;
			WebglAddonCtor = depResults.WebglAddon;
			CheerpXMod = depResults.CheerpX || null;
			cheerpxPromise = Promise.resolve(depResults.CheerpX);
		} else {
			if (depResults[0].status === 'fulfilled') TerminalCtor = depResults[0].value.Terminal;
			if (depResults[1].status === 'fulfilled') FitAddonCtor = depResults[1].value.FitAddon;
			if (depResults[2].status === 'fulfilled') WebLinksAddonCtor = depResults[2].value.WebLinksAddon;
			if (depResults[3].status === 'fulfilled') SearchAddonCtor = depResults[3].value.SearchAddon;
			if (depResults[4].status === 'fulfilled') WebglAddonCtor = depResults[4].value.WebglAddon;
			if (depResults[5].status === 'fulfilled') CheerpXMod = depResults[5].value;
			cheerpxPromise =
				depResults[5].status === 'fulfilled'
					? Promise.resolve(depResults[5].value)
					: Promise.reject(depResults[5].reason);
			cheerpxPromise.catch(() => {});
		}

		const primaryTab = createTerminalInstance('tab-1', 'primary', {
			title: configObj?.cmd === '/sbin/init' ? 'init' : 'bash',
			cmd: configObj?.cmd || '/bin/bash',
			args: configObj?.args || [],
			status: 'starting'
		});
		setActiveSession('tab-1');
		showTabContainer('tab-1');
		syncWebglForActiveTab();
		primaryTab?.term?.focus();

		if (configObj?.printIntro && primaryTab?.batcher) {
			primaryTab.batcher.printMessage(introMessage);
		}

		if (typeof ResizeObserver !== 'undefined' && consoleRoot) {
			resizeObserver = new ResizeObserver(() => scheduleResize());
			resizeObserver.observe(consoleRoot);
			if (displayEl) resizeObserver.observe(displayEl);
		}

		if (typeof window !== 'undefined') {
			window.addEventListener('resize', scheduleResize);
			cleanups.push(() => window.removeEventListener('resize', scheduleResize));
		}

		if (typeof document !== 'undefined') {
			document.addEventListener('visibilitychange', handleVisibilityChange);
			cleanups.push(() => document.removeEventListener('visibilitychange', handleVisibilityChange));
		}

		const unsubSettings = settings.subscribe(applyTerminalSettings);
		cleanups.push(unsubSettings);

		const unsubDisplayPaused = displayPaused.subscribe((paused) => {
			if (!paused) {
				applyDisplayScale(true);
			}
		});
		cleanups.push(unsubDisplayPaused);

		await initCheerpX(cheerpxPromise);
	}

	function setDisplayElement(el) {
		displayEl = el;
	}

	async function resetDisk() {
		if (blockCache?.reset) {
			await blockCache.reset();
		}
		if (typeof location !== 'undefined') {
			location.reload();
		}
		return true;
	}

	async function resetWorkspace({ reload = false, skipBridgeReset = false } = {}) {
		if (workspaceDevice?.reset) {
			await workspaceDevice.reset();
		}
		if (!skipBridgeReset && typeof options.onWorkspaceReset === 'function') {
			await options.onWorkspaceReset();
		}
		addToast({ message: 'Workspace reset complete', type: 'info' });
		if (reload && typeof location !== 'undefined') {
			location.reload();
		}
		return true;
	}

	async function runCommandInTerminal(commandStr, { newTab = false, title = 'run', cwd = '/home/user/workspace' } = {}) {
		if (disposed || !commandStr) return { status: 1 };
		const isInitPrimary = configObj?.cmd === '/sbin/init';
		if (!isInitPrimary) {
			setActiveVt(1);
		}
		if ((newTab || isInitPrimary) && cx) {
			setActiveVt(1);
			return await runSession({
				title,
				cmd: '/bin/sh',
				args: ['-c', commandStr],
				cwd
			});
		}
		setActiveVt(1);
		let active = getActiveTab();
		if (!active || active.kind === 'task') {
			if (tabs.has('tab-1') && !isInitPrimary) {
				switchTab('tab-1');
				active = tabs.get('tab-1');
			} else {
				const newId = createShellTab({ title });
				active = newId ? tabs.get(newId) : null;
			}
		}
		if (active?.kind === 'primary') {
			sendInputToActive(`${commandStr}\r`);
		} else if (active?.shellController) {
			active.shellController.sendInput(`${commandStr}\n`);
		}
		return { status: 0 };
	}

	function networkLogin() {
		cx?.networkLogin?.();
	}

	function onSearchResultsChange(cb) {
		searchListeners.add(cb);
		return () => searchListeners.delete(cb);
	}

	function dispose() {
		if (disposed) return;
		disposed = true;
		vmState.set('disposed');

		if (resizeTimerId !== null) {
			clearTimeout(resizeTimerId);
			resizeTimerId = null;
		}
		if (resizeRafId !== null && typeof cancelAnimationFrame === 'function') {
			cancelAnimationFrame(resizeRafId);
			resizeRafId = null;
		}
		if (resizeObserver) {
			resizeObserver.disconnect();
			resizeObserver = null;
		}

		while (cleanups.length > 0) {
			const fn = cleanups.pop();
			try {
				fn();
			} catch {
				// Ignore
			}
		}

		inputWriter.dispose();
		telemetry.dispose();

		if (cx) {
			try {
				cx.unregisterCallback?.('cpuActivity', telemetry.cpuCallback);
				cx.unregisterCallback?.('diskActivity', telemetry.hddCallback);
				cx.unregisterCallback?.('diskLatency', telemetry.latencyCallback);
				cx.unregisterCallback?.('processCreated', handleProcessCreated);
			} catch {
				// Ignore
			}
			try {
				cx.delete?.();
			} catch {
				// Ignore
			}
			cx = null;
		}

		for (const tab of tabs.values()) {
			for (const d of tab.disposables) {
				try {
					d?.dispose?.();
				} catch {
					// Ignore
				}
			}
			try {
				tab.webglAddon?.dispose?.();
			} catch {
				// Ignore
			}
			try {
				tab.batcher?.dispose?.();
			} catch {
				// Ignore
			}
			try {
				tab.term?.dispose?.();
			} catch {
				// Ignore
			}
			tab.hostEl?.remove();
		}
		tabs.clear();
		searchListeners.clear();
		stickyModifiers.set({ ...DEFAULT_STICKY_MODIFIERS });
	}

	return {
		boot,
		setDisplayElement,
		createShellTab,
		runSession,
		isReady,
		spawnBackground,
		execQuiet,
		snapshotProcesses,
		interruptSession,
		switchTab,
		renameTab,
		closeTab,
		restartTab,
		setActiveVt,
		toggleVt: () => setActiveVt(get(activeVt) === 7 ? 1 : 7),
		focusDisplay,
		toggleDisplayPause: () => displayPaused.update((v) => !v),
		applyDisplayScale,
		scheduleResize,
		setStickyModifiers,
		sendInputToActive,
		search,
		clearSearch,
		onSearchResultsChange,
		copySelection,
		pasteClipboard,
		resetDisk,
		resetWorkspace,
		runCommandInTerminal,
		networkLogin,
		getActiveTerminal,
		getCheerpX: () => cx,
		getBlockCache: () => blockCache,
		getDataDevice: () => dataDevice,
		getWorkspaceDevice: () => workspaceDevice,
		getTelemetry: () => telemetry,
		dispose
	};
}
