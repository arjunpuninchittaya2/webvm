import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import {
	MAX_SESSIONS,
	sessions,
	activeSessionId,
	activeSession,
	activeVt,
	vtAvailable,
	displayPaused,
	bootState,
	activeRenderer,
	pageHidden,
	vmState,
	tailscaleIp,
	toasts,
	upsertSession,
	updateSession,
	removeSession,
	setActiveSession,
	addToast,
	dismissToast,
	resetSessionsStore
} from '../../src/lib/stores/sessions.js';

describe('sessions.js workstation state and toast stores', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		resetSessionsStore();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('enforces MAX_SESSIONS=8, derives activeSession, and falls back cleanly on removeSession', () => {
		for (let i = 1; i <= 10; i++) {
			const res = upsertSession({ id: `tab-${i}`, title: `t${i}`, kind: i === 1 ? 'primary' : 'shell' });
			if (i <= MAX_SESSIONS) {
				expect(res).not.toBeNull();
			} else {
				expect(res).toBeNull();
			}
		}

		expect(get(sessions).length).toBe(MAX_SESSIONS);
		setActiveSession('tab-3');
		expect(get(activeSession).id).toBe('tab-3');

		updateSession('tab-3', { title: 'renamed-3', exitCode: 0, status: 'exited' });
		expect(get(activeSession).title).toBe('renamed-3');
		expect(get(activeSession).exitCode).toBe(0);

		removeSession('tab-3');
		expect(get(sessions).length).toBe(7);
		expect(get(activeSessionId)).toBe('tab-4');
	});

	it('manages toast queue auto-dismissal and manual dismissal', () => {
		const id1 = addToast({ message: 'Copied!', type: 'success', duration: 2000 });
		const id2 = addToast({ message: 'Warning', type: 'warning', duration: 0 });

		expect(get(toasts).map((t) => t.id)).toEqual([id1, id2]);

		vi.advanceTimersByTime(2000);
		expect(get(toasts).map((t) => t.id)).toEqual([id2]);

		dismissToast(id2);
		expect(get(toasts)).toEqual([]);
	});

	it('resets all workstation state stores cleanly', () => {
		activeVt.set(7);
		vtAvailable.set(true);
		displayPaused.set(true);
		activeRenderer.set('webgl');
		pageHidden.set(true);
		vmState.set('ready');
		tailscaleIp.set('100.64.0.1');
		bootState.set({ phase: 'ready', progress: 100, message: 'ok', ready: true, error: null });

		resetSessionsStore();
		expect(get(activeVt)).toBe(1);
		expect(get(vtAvailable)).toBe(false);
		expect(get(displayPaused)).toBe(false);
		expect(get(activeRenderer)).toBe('dom');
		expect(get(pageHidden)).toBe(false);
		expect(get(vmState)).toBe('booting');
		expect(get(tailscaleIp)).toBeNull();
		expect(get(bootState).ready).toBe(false);
	});
});
