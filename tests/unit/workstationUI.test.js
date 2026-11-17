import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import SideBar from '../../src/lib/SideBar.svelte';
import TerminalTabBar from '../../src/lib/components/TerminalTabBar.svelte';
import TerminalToolbar from '../../src/lib/components/TerminalToolbar.svelte';
import TerminalSearchBar from '../../src/lib/components/TerminalSearchBar.svelte';
import VirtualKeyBar from '../../src/lib/components/VirtualKeyBar.svelte';
import SettingsModal from '../../src/lib/components/SettingsModal.svelte';
import StatusBar from '../../src/lib/components/StatusBar.svelte';
import ToastContainer from '../../src/lib/components/ToastContainer.svelte';
import BootProgressOverlay from '../../src/lib/components/BootProgressOverlay.svelte';
import { settings, resetSettings } from '../../src/lib/stores/settings.js';
import {
	addToast,
	bootState,
	resetSessionsStore,
	vmState,
	activeVt,
	vtAvailable
} from '../../src/lib/stores/sessions.js';

describe('M2 workstation UI components & accessibility', () => {
	let container;

	beforeEach(() => {
		localStorage.clear();
		resetSettings();
		resetSessionsStore();
		container = document.createElement('div');
		document.body.appendChild(container);
	});

	afterEach(() => {
		container?.remove();
	});

	it('SideBar switches active panel when clicked while pinned and uses semantic buttons', async () => {
		const sidebar = new SideBar({
			target: container,
			props: { sideBarPinned: true, handleTool: vi.fn() }
		});
		await tick();

		const cpuBtn = container.querySelector('button[aria-label="CPU"]');
		const diskBtn = container.querySelector('button[aria-label="Disk"]');
		expect(cpuBtn).not.toBeNull();
		expect(diskBtn).not.toBeNull();

		cpuBtn.click();
		await tick();
		expect(container.textContent).toContain('Virtual CPU:');

		diskBtn.click();
		await tick();
		expect(container.textContent).toContain('Backend latency:');

		sidebar.$destroy();
	});

	it('TerminalTabBar supports select, create, inline rename, restart, and close', async () => {
		const events = { select: [], create: 0, rename: [], restart: [], close: [] };
		const bar = new TerminalTabBar({
			target: container,
			props: {
				sessions: [
					{ id: 'tab-1', title: 'bash', kind: 'primary', status: 'running', exitCode: null },
					{ id: 'tab-2', title: 'shell-1', kind: 'shell', status: 'exited', exitCode: 2 }
				],
				activeSessionId: 'tab-1',
				maxSessions: 8
			}
		});
		bar.$on('select', (e) => events.select.push(e.detail));
		bar.$on('create', () => events.create++);
		bar.$on('rename', (e) => events.rename.push(e.detail));
		bar.$on('restart', (e) => events.restart.push(e.detail));
		bar.$on('close', (e) => events.close.push(e.detail));
		await tick();

		expect(container.querySelector('[data-testid="close-tab-tab-1"]')).toBeNull();
		expect(container.querySelector('[data-testid="tab-exit-code-tab-2"]').textContent).toContain('exit 2');

		container.querySelector('[data-testid="terminal-tab-tab-2"]').click();
		container.querySelector('[data-testid="new-tab-btn"]').click();
		container.querySelector('[data-testid="restart-tab-tab-2"]').click();
		container.querySelector('[data-testid="close-tab-tab-2"]').click();

		container.querySelector('[data-testid="rename-tab-tab-2"]').click();
		await tick();
		const input = container.querySelector('[data-testid="tab-rename-input"]');
		input.value = 'logs';
		input.dispatchEvent(new Event('input'));
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
		await tick();

		expect(events.select).toEqual(['tab-2']);
		expect(events.create).toBe(1);
		expect(events.restart).toEqual(['tab-2']);
		expect(events.close).toEqual(['tab-2']);
		expect(events.rename).toEqual([{ id: 'tab-2', title: 'logs' }]);
		bar.$destroy();
	});

	it('VirtualKeyBar prevents mousedown focus steal, applies sticky/locked Ctrl & Alt modifiers, and provides mod input', async () => {
		const sent = [];
		const modChanges = [];
		const vkeys = new VirtualKeyBar({
			target: container,
			props: { visible: true, activeVt: 1 }
		});
		vkeys.$on('sendKey', (e) => sent.push(e.detail));
		vkeys.$on('modifierChange', (e) => modChanges.push(e.detail));
		await tick();

		const escBtn = container.querySelector('[data-testid="vkey-esc"]');
		const mousedownEv = new MouseEvent('mousedown', { cancelable: true });
		escBtn.dispatchEvent(mousedownEv);
		expect(mousedownEv.defaultPrevented).toBe(true);
		escBtn.click();

		// Sticky Ctrl + Arrow Left -> \x1b[1;5D and auto-releases
		const ctrlBtn = container.querySelector('[data-testid="vkey-ctrl"]');
		ctrlBtn.click();
		await tick();
		expect(ctrlBtn.getAttribute('aria-pressed')).toBe('true');

		const modInput = container.querySelector('[data-testid="vkey-mod-input"]');
		expect(modInput).not.toBeNull();
		// Clicking Ctrl did not focus modInput
		expect(document.activeElement).not.toBe(modInput);

		container.querySelector('button[aria-label="Arrow Left"]').click();
		await tick();
		expect(ctrlBtn.getAttribute('aria-pressed')).toBe('false');

		// Sticky Alt + vkey-mod-input 'x' -> \x1bx and auto-releases
		const altBtn = container.querySelector('[data-testid="vkey-alt"]');
		altBtn.click();
		await tick();
		const altModInput = container.querySelector('[data-testid="vkey-mod-input"]');
		altModInput.value = 'x';
		altModInput.dispatchEvent(new Event('input'));
		await tick();
		expect(altBtn.getAttribute('aria-pressed')).toBe('false');

		// Double-click Ctrl locks it across multiple keys (e.g. F1 -> \x1b[1;5P), click unlocks
		ctrlBtn.dispatchEvent(new MouseEvent('dblclick'));
		await tick();
		expect(ctrlBtn.getAttribute('data-locked')).toBe('true');

		container.querySelector('[data-testid="vkey-fn-toggle"]').click();
		await tick();
		expect(container.querySelector('[data-testid="virtual-fn-row"]')).not.toBeNull();

		const f1Btn = Array.from(container.querySelectorAll('[data-testid="virtual-fn-row"] button')).find(
			(b) => b.textContent.trim() === 'F1'
		);
		f1Btn.click();
		await tick();
		// Still locked after F1
		expect(ctrlBtn.getAttribute('data-locked')).toBe('true');

		// Click when locked unlocks both ctrl and ctrlLocked
		ctrlBtn.click();
		await tick();
		expect(ctrlBtn.getAttribute('data-locked')).toBe('false');
		expect(ctrlBtn.getAttribute('aria-pressed')).toBe('false');

		expect(sent).toEqual(['\x1b', '\x1b[1;5D', '\x1bx', '\x1b[1;5P']);
		expect(modChanges.length).toBeGreaterThanOrEqual(4);
		vkeys.$destroy();
	});

	it('SideBar unpinned click promotes hover to click, stays open on mouseleave, and closes on second click, Escape, or outside pointerdown', async () => {
		vi.useFakeTimers();
		const sidebar = new SideBar({
			target: container,
			props: { sideBarPinned: false, handleTool: vi.fn() }
		});
		await tick();

		const cpuBtn = container.querySelector('button[aria-label="CPU"]');
		const aside = container.querySelector('aside[aria-label="Sidebar panel"]');
		expect(aside.classList.contains('hidden')).toBe(true);

		// Hover opens panel
		cpuBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
		await tick();
		expect(aside.classList.contains('hidden')).toBe(false);

		// Clicking hovered icon promotes to 'click' and keeps it open
		cpuBtn.click();
		await tick();
		expect(aside.classList.contains('hidden')).toBe(false);

		// Leaving sidebar does NOT close click-opened panel
		const rootDiv = container.firstElementChild;
		rootDiv.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
		vi.advanceTimersByTime(500);
		await tick();
		expect(aside.classList.contains('hidden')).toBe(false);

		// Clicking same icon again closes it
		cpuBtn.click();
		await tick();
		expect(aside.classList.contains('hidden')).toBe(true);

		// Clicking icon opens again; Escape closes it
		cpuBtn.click();
		await tick();
		expect(aside.classList.contains('hidden')).toBe(false);
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		await tick();
		expect(aside.classList.contains('hidden')).toBe(true);

		// Clicking icon opens again; outside pointerdown closes it
		cpuBtn.click();
		await tick();
		expect(aside.classList.contains('hidden')).toBe(false);
		window.dispatchEvent(new Event('pointerdown', { bubbles: true }));
		await tick();
		expect(aside.classList.contains('hidden')).toBe(true);

		sidebar.$destroy();
		vi.useRealTimers();
	});

	it('TerminalToolbar, TerminalSearchBar, SettingsModal drafts, StatusBar ECO toggle, Toasts & BootOverlay render and persist', async () => {
		const toolbar = new TerminalToolbar({
			target: container,
			props: { vtAvailable: true, activeVt: 1, displayScale: 1 }
		});
		const searchBar = new TerminalSearchBar({
			target: container,
			props: { open: true, matchIndex: 1, matchCount: 5 }
		});
		const modal = new SettingsModal({
			target: container,
			props: { open: true }
		});
		vmState.set('ready');
		vtAvailable.set(true);
		activeVt.set(7);
		const statusBar = new StatusBar({ target: container });
		const toastContainer = new ToastContainer({ target: container });
		addToast({ message: 'Clipboard synced', type: 'success', duration: 0 });
		bootState.set({ phase: 'devices', progress: 45, message: 'Connecting...', ready: false, error: null });
		const bootOverlay = new BootProgressOverlay({ target: container });
		await tick();

		expect(container.querySelector('[data-testid="vt-toggle-btn"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="search-match-count"]').textContent.trim()).toBe('2/5');
		expect(container.querySelector('[data-testid="settings-modal"]').getAttribute('aria-modal')).toBe('true');
		expect(container.querySelector('[data-testid="status-vt"]').textContent).toContain('VT7');
		expect(container.querySelector('[data-testid="toast-container"]').textContent).toContain('Clipboard synced');

		const overlayEl = container.querySelector('[data-testid="boot-progress-overlay"]');
		expect(overlayEl.textContent).toContain('45%');
		expect(overlayEl.firstElementChild.className).toContain('pointer-events-none');

		// Interactive ECO Power-Saver toggle in StatusBar
		const ecoBtn = container.querySelector('[data-testid="status-power-saver"]');
		expect(ecoBtn.tagName).toBe('BUTTON');
		expect(ecoBtn.getAttribute('aria-pressed')).toBe('false');
		ecoBtn.click();
		await tick();
		expect(get(settings).powerSaver).toBe(true);
		expect(ecoBtn.getAttribute('aria-pressed')).toBe('true');

		const themeSelect = container.querySelector('[data-testid="setting-theme"]');
		themeSelect.value = 'high-contrast';
		themeSelect.dispatchEvent(new Event('change'));
		await tick();
		expect(get(settings).theme).toBe('high-contrast');

		// Clearing fontSize input does not snap to min prematurely and restores on blur
		const fontInput = container.querySelector('[data-testid="setting-font-size"]');
		fontInput.dispatchEvent(new Event('focus'));
		fontInput.value = '';
		fontInput.dispatchEvent(new Event('input'));
		await tick();
		expect(get(settings).fontSize).toBe(14);
		fontInput.dispatchEvent(new Event('blur'));
		await tick();
		expect(fontInput.value).toBe('14');
		expect(get(settings).fontSize).toBe(14);

		toolbar.$destroy();
		searchBar.$destroy();
		modal.$destroy();
		statusBar.$destroy();
		toastContainer.$destroy();
		bootOverlay.$destroy();
	});
});
