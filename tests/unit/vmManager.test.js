import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { createVmManager, resolveShellPath } from '../../src/lib/vm/vmManager.js';
import {
	sessions,
	activeSessionId,
	activeVt,
	vtAvailable,
	bootState,
	activeRenderer,
	vmState,
	stickyModifiers,
	DEFAULT_STICKY_MODIFIERS,
	resetSessionsStore
} from '../../src/lib/stores/sessions.js';
import { settings, resetSettings } from '../../src/lib/stores/settings.js';
import { displayConfig } from '../../src/lib/anthropic.js';

function createFakeTerminalEnv({ webglShouldThrow = false, webglDisposeShouldThrow = false } = {}) {
	const createdTerms = [];
	let contextLossCb = null;

	class MockTerminal {
		constructor(opts) {
			this.options = { ...opts };
			this.cols = 80;
			this.rows = 24;
			this.writes = [];
			this._onData = [];
			this._onBinary = [];
			this._onResize = [];
			this.disposed = false;
			this.parser = {
				registerOscHandler: vi.fn(() => ({ dispose: vi.fn() }))
			};
			this._core = {
				_isDisposed: false,
				_renderService: {
					setRenderer: vi.fn(),
					handleResize: vi.fn(),
					resize: vi.fn(),
					handleFocus: vi.fn()
				},
				_createRenderer: vi.fn(() => ({ kind: 'dom-renderer' })),
				viewport: { syncScrollArea: vi.fn() }
			};
			createdTerms.push(this);
		}
		loadAddon(addon) {
			addon.activate?.(this);
		}
		open(el) {
			this.el = el;
		}
		scrollToTop() {}
		scrollToBottom() {}
		focus() {}
		clear() {}
		getSelection() {
			return 'selected-text';
		}
		paste(txt) {
			this._onData.forEach((cb) => cb(txt));
		}
		write(data) {
			this.writes.push(data);
		}
		onData(cb) {
			this._onData.push(cb);
			return { dispose: vi.fn() };
		}
		onBinary(cb) {
			this._onBinary.push(cb);
			return { dispose: vi.fn() };
		}
		onResize(cb) {
			this._onResize.push(cb);
			return { dispose: vi.fn() };
		}
		emitData(d) {
			this._onData.forEach((cb) => cb(d));
		}
		emitResize(cols, rows) {
			this.cols = cols;
			this.rows = rows;
			this._onResize.forEach((cb) => cb({ cols, rows }));
		}
		dispose() {
			this.disposed = true;
		}
	}

	class MockFitAddon {
		fit() {}
		dispose() {}
	}
	class MockWebLinksAddon {
		dispose() {}
	}
	class MockSearchAddon {
		constructor() {
			this.findNext = vi.fn((q) => {
				if (q === '[invalid') throw new SyntaxError('Invalid regex');
				return true;
			});
			this.findPrevious = vi.fn(() => true);
			this.clearDecorations = vi.fn();
			this.onDidChangeResults = vi.fn((cb) => {
				this._cb = cb;
				return { dispose: vi.fn() };
			});
		}
		dispose() {}
	}
	class MockWebglAddon {
		constructor() {
			if (webglShouldThrow) {
				throw new Error('WebGL not supported');
			}
			this.disposed = false;
		}
		onContextLoss(cb) {
			contextLossCb = cb;
			return { dispose: vi.fn() };
		}
		dispose() {
			this.disposed = true;
			if (webglDisposeShouldThrow) {
				throw new TypeError("Cannot read properties of undefined (reading '_isDisposed')");
			}
		}
	}

	const cxReadSpy = vi.fn();
	const mockCx = {
		run: vi.fn(async () => ({ status: 0 })),
		setCustomConsole: vi.fn((writeFn) => {
			mockCx._writeFn = writeFn;
			return cxReadSpy;
		}),
		setActivateConsole: vi.fn((cb) => {
			mockCx._activateCb = cb;
		}),
		setKmsCanvas: vi.fn(),
		registerCallback: vi.fn(),
		unregisterCallback: vi.fn(),
		delete: vi.fn()
	};

	const cloudCreate = vi.fn(async (url) => {
		if (url.startsWith('wss:')) throw new Error('ws blocked');
		return { kind: 'cloud', url };
	});

	const MockCheerpX = {
		CloudDevice: { create: cloudCreate },
		HttpBytesDevice: { create: vi.fn(async () => ({})) },
		GitHubDevice: { create: vi.fn(async () => ({})) },
		IDBDevice: { create: vi.fn(async () => ({ reset: vi.fn() })) },
		WebDevice: { create: vi.fn(async () => ({})) },
		DataDevice: { create: vi.fn(async () => ({})) },
		OverlayDevice: { create: vi.fn(async () => ({})) },
		Linux: { create: vi.fn(async () => mockCx) }
	};

	return {
		createdTerms,
		mockCx,
		cxReadSpy,
		cloudCreate,
		triggerContextLoss: () => contextLossCb?.(),
		loadDeps: async () => ({
			Terminal: MockTerminal,
			FitAddon: MockFitAddon,
			WebLinksAddon: MockWebLinksAddon,
			SearchAddon: MockSearchAddon,
			WebglAddon: MockWebglAddon,
			CheerpX: MockCheerpX
		})
	};
}

describe('vmManager.js lifecycle, WebGL fallback, KMS scaling, multi-tab & cleanup', () => {
	let consoleEl;
	let displayEl;

	beforeEach(() => {
		resetSessionsStore();
		resetSettings();
		consoleEl = document.createElement('div');
		Object.defineProperty(consoleEl, 'offsetWidth', { value: 800, configurable: true });
		Object.defineProperty(consoleEl, 'offsetHeight', { value: 600, configurable: true });
		displayEl = document.createElement('canvas');
		Object.defineProperty(displayEl, 'clientWidth', { value: 800, configurable: true });
		Object.defineProperty(displayEl, 'clientHeight', { value: 600, configurable: true });
		document.body.appendChild(consoleEl);
		document.body.appendChild(displayEl);
	});

	afterEach(() => {
		consoleEl?.remove();
		displayEl?.remove();
	});

	it('resolves shell paths safely for cd', () => {
		expect(resolveShellPath('/home/user', '..')).toBe('/home');
		expect(resolveShellPath('/home/user', '~/projects/../app')).toBe('/home/user/app');
		expect(resolveShellPath('/home/user', '/etc/nginx')).toBe('/etc/nginx');
	});

	it('boots with wss->https fallback, attaches WebGL with context-loss fallback, and scales KMS cleanly', async () => {
		const env = createFakeTerminalEnv();
		// Prevent infinite primary loop after 1 run
		let primaryRuns = 0;
		env.mockCx.run.mockImplementation(async () => {
			primaryRuns++;
			if (primaryRuns === 1) {
				// Keep waiting briefly until disposed
				return await new Promise((resolve) => {
					setTimeout(() => resolve({ status: 0 }), 5000);
				});
			}
			return { status: 0 };
		});

		const manager = createVmManager(
			{
				diskImageType: 'cloud',
				diskImageUrl: 'wss://disks.webvm.io/test.ext2',
				needsDisplay: true,
				printIntro: false,
				cmd: '/sbin/init',
				args: [],
				opts: { cwd: '/root', env: ['HOME=/root'] }
			},
			{ cacheId: 'test_cache', loadDeps: env.loadDeps }
		);

		await manager.boot({ consoleElement: consoleEl, displayElement: displayEl });

		expect(env.cloudCreate).toHaveBeenCalledWith('wss://disks.webvm.io/test.ext2');
		expect(env.cloudCreate).toHaveBeenCalledWith('https://disks.webvm.io/test.ext2');
		expect(get(bootState).ready).toBe(true);
		expect(get(vmState)).toBe('ready');
		expect(get(vtAvailable)).toBe(true);
		expect(get(activeRenderer)).toBe('webgl');

		// KMS canvas scaled without forced 1024x768 upscaling (native 800x600 at 1x)
		expect(env.mockCx.setKmsCanvas).toHaveBeenCalledWith(displayEl, 800, 600);
		expect(get(displayConfig)).toMatchObject({ width: 800, height: 600 });

		settings.updateSetting('displayScale', 0.5);
		expect(env.mockCx.setKmsCanvas).toHaveBeenCalledWith(displayEl, 400, 300);

		// WebGL context loss falls back to DOM
		env.triggerContextLoss();
		expect(get(activeRenderer)).toBe('dom');

		// Bidirectional VT1 <-> VT7 switching (no one-way latch!)
		env.mockCx._activateCb(7);
		expect(get(activeVt)).toBe(7);
		env.mockCx._activateCb(1);
		expect(get(activeVt)).toBe(1);
		manager.toggleVt();
		expect(get(activeVt)).toBe(7);
		manager.toggleVt();
		expect(get(activeVt)).toBe(1);

		// Clean disposal
		manager.dispose();
		expect(env.mockCx.unregisterCallback).toHaveBeenCalledTimes(4);
		expect(env.mockCx.delete).toHaveBeenCalledTimes(1);
		expect(env.createdTerms[0].disposed).toBe(true);
	});

	it('supports multi-tab JS-hosted shell, runSession, search regex safety, and visibility power-saver', async () => {
		const env = createFakeTerminalEnv({ webglShouldThrow: true });
		env.mockCx.run.mockImplementation(async (cmd, args) => {
			if (cmd === '/bin/bash') {
				return await new Promise((resolve) => setTimeout(() => resolve({ status: 0 }), 5000));
			}
			if (cmd === '/bin/sh' && args[1]?.includes('echo hi')) {
				env.mockCx._writeFn?.(new TextEncoder().encode('hi\r\n'), 1);
				return { status: 0 };
			}
			return { status: 42 };
		});

		const manager = createVmManager(
			{
				diskImageType: 'bytes',
				diskImageUrl: '/local.ext2',
				needsDisplay: false,
				printIntro: true,
				cmd: '/bin/bash',
				args: ['--login'],
				opts: { cwd: '/home/user', env: ['HOME=/home/user', 'USER=user'] }
			},
			{ loadDeps: env.loadDeps }
		);

		await manager.boot({ consoleElement: consoleEl });
		expect(get(activeRenderer)).toBe('dom');

		// Create Tab 2 shell
		const tab2Id = manager.createShellTab({ title: 'build' });
		expect(get(sessions).length).toBe(2);
		expect(get(activeSessionId)).toBe(tab2Id);

		// Rename & send command in Tab 2
		manager.renameTab(tab2Id, 'runner');
		expect(get(sessions).find((s) => s.id === tab2Id).title).toBe('runner');

		const tab2Term = env.createdTerms[1];
		tab2Term.emitData('export FOO=bar\r');
		tab2Term.emitData('echo hi\r');
		await new Promise((r) => setTimeout(r, 20));
		expect(env.mockCx.run).toHaveBeenCalledWith(
			'/bin/sh',
			['-c', 'echo hi'],
			expect.objectContaining({ env: expect.arrayContaining(['FOO=bar']) })
		);

		// Search handles invalid regex without throwing
		expect(manager.search('[invalid', { regex: true })).toBe(false);
		expect(manager.search('hello', { caseSensitive: true })).toBe(true);
		expect(tab2Term).toBeTruthy();

		// runSession task tab records exact exitCode
		const taskRes = await manager.runSession({ title: 'lint', cmd: '/bin/true', args: [] });
		expect(taskRes.status).toBe(42);
		expect(get(sessions).length).toBe(3);

		// Visibility power-saver pauses cursorBlink
		Object.defineProperty(document, 'hidden', { value: true, configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));
		expect(tab2Term.options.cursorBlink).toBe(false);
		Object.defineProperty(document, 'hidden', { value: false, configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));
		expect(tab2Term.options.cursorBlink).toBe(true);

		// Primary tab cannot be closed; secondary tabs close cleanly
		manager.closeTab('tab-1');
		expect(get(sessions).some((s) => s.id === 'tab-1')).toBe(true);
		manager.closeTab(tab2Id);
		expect(get(sessions).some((s) => s.id === tab2Id)).toBe(false);

		manager.dispose();
	});

	it('recovers DOM renderer when WebglAddon.dispose() throws on runtime toggle or context loss', async () => {
		const env = createFakeTerminalEnv({ webglDisposeShouldThrow: true });
		env.mockCx.run.mockImplementation(
			() => new Promise((resolve) => setTimeout(() => resolve({ status: 0 }), 5000))
		);

		const manager = createVmManager(
			{
				diskImageType: 'bytes',
				diskImageUrl: '/local.ext2',
				needsDisplay: false,
				printIntro: false,
				cmd: '/bin/bash',
				args: [],
				opts: { cwd: '/home/user', env: [] }
			},
			{ loadDeps: env.loadDeps }
		);

		await manager.boot({ consoleElement: consoleEl });
		expect(get(activeRenderer)).toBe('webgl');

		const term = env.createdTerms[0];
		// Simulate missing .xterm-rows because WebglAddon threw during dispose()
		settings.updateSetting('renderer', 'dom');
		expect(get(activeRenderer)).toBe('dom');
		expect(term._core._createRenderer).toHaveBeenCalledTimes(1);
		expect(term._core._renderService.setRenderer).toHaveBeenCalledWith({ kind: 'dom-renderer' });
		expect(term._core._renderService.handleResize).toHaveBeenCalledWith(80, 24);
		expect(term._core.viewport.syncScrollArea).toHaveBeenCalledWith(true);

		// Re-enable WebGL, then simulate context loss where dispose() also throws
		settings.updateSetting('renderer', 'webgl');
		expect(get(activeRenderer)).toBe('webgl');
		env.triggerContextLoss();
		expect(get(activeRenderer)).toBe('dom');
		expect(term._core._createRenderer).toHaveBeenCalledTimes(2);

		manager.dispose();
	});

	it('handles surrogate-safe shell editing, modified word jumps, unhandled CSI discard, and physical sticky modifiers', async () => {
		const env = createFakeTerminalEnv({ webglShouldThrow: true });
		env.mockCx.run.mockImplementation(async (cmd, args) => {
			if (cmd === '/bin/bash') {
				return await new Promise((resolve) => setTimeout(() => resolve({ status: 0 }), 5000));
			}
			return { status: 0 };
		});

		const manager = createVmManager(
			{
				diskImageType: 'bytes',
				diskImageUrl: '/local.ext2',
				needsDisplay: false,
				printIntro: false,
				cmd: '/bin/bash',
				args: [],
				opts: { cwd: '/home/user', env: ['HOME=/home/user', 'USER=user'] }
			},
			{ loadDeps: env.loadDeps }
		);

		await manager.boot({ consoleElement: consoleEl });

		// Primary tab physical keyboard typing consumes sticky Ctrl & Alt
		manager.setStickyModifiers({ ctrl: true, ctrlLocked: false, alt: false, altLocked: false });
		env.createdTerms[0].emitData('c');
		expect(env.cxReadSpy).toHaveBeenCalledWith(3); // \x03
		expect(get(stickyModifiers)).toEqual(DEFAULT_STICKY_MODIFIERS);

		// Locked Alt persists across physical keys
		env.cxReadSpy.mockClear();
		manager.setStickyModifiers({ ctrl: false, ctrlLocked: false, alt: true, altLocked: true });
		env.createdTerms[0].emitData('x');
		expect(env.cxReadSpy.mock.calls.map((c) => c[0])).toEqual([0x1b, 'x'.charCodeAt(0)]);
		expect(get(stickyModifiers).altLocked).toBe(true);

		// sendInputToActive does NOT double-apply sticky modifiers
		env.cxReadSpy.mockClear();
		manager.sendInputToActive('a');
		expect(env.cxReadSpy.mock.calls.map((c) => c[0])).toEqual(['a'.charCodeAt(0)]);
		manager.setStickyModifiers(DEFAULT_STICKY_MODIFIERS);

		// Secondary shell tab: surrogate-safe editing + word jump + unhandled CSI discard
		const tab2Id = manager.createShellTab({ title: 'emoji' });
		expect(tab2Id).toBeTruthy();
		const tab2Term = env.createdTerms[1];

		// Type 'echo a😀', Backspace removes entire 😀 (not lone surrogate), then type 'b'
		tab2Term.emitData('echo a😀');
		tab2Term.emitData('\x7f');
		// Unhandled CSI/SS3 sequences must not leak onto prompt
		tab2Term.emitData('\x1b[15~\x1b[I\x1bOP');
		// Word jump left (\x1b[1;5D), insert 'x', word jump right (\x1b[1;5C), type 'b', Enter
		tab2Term.emitData('\x1b[1;5D');
		tab2Term.emitData('x');
		tab2Term.emitData('\x1b[1;5C');
		tab2Term.emitData('b\r');

		await new Promise((r) => setTimeout(r, 20));
		expect(env.mockCx.run).toHaveBeenCalledWith(
			'/bin/sh',
			['-c', 'echo xab'],
			expect.any(Object)
		);

		// Sticky Ctrl+C in secondary shell tab via physical keyboard
		manager.setStickyModifiers({ ctrl: true, ctrlLocked: false, alt: false, altLocked: false });
		tab2Term.emitData('abc');
		tab2Term.emitData('c');
		expect(get(stickyModifiers).ctrl).toBe(false);

		manager.dispose();
		expect(get(stickyModifiers)).toEqual(DEFAULT_STICKY_MODIFIERS);
	});
});
