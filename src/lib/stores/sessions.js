import { derived, writable } from 'svelte/store';

export const MAX_SESSIONS = 8;

const DEFAULT_BOOT_STATE = {
	phase: 'idle',
	progress: 0,
	message: 'Initializing workstation...',
	ready: false,
	error: null
};

export const sessions = writable([]);
export const activeSessionId = writable(null);
export const activeSession = derived(
	[sessions, activeSessionId],
	([$sessions, $activeId]) => $sessions.find((s) => s.id === $activeId) || $sessions[0] || null
);

export const activeVt = writable(1);
export const vtAvailable = writable(false);
export const displayPaused = writable(false);
export const bootState = writable({ ...DEFAULT_BOOT_STATE });
export const activeRenderer = writable('dom');
export const pageHidden = writable(false);
export const vmState = writable('booting');
export const tailscaleIp = writable(null);
export const toasts = writable([]);

let nextToastSeq = 1;
const toastTimers = new Map();

export function createSessionRecord(partial = {}) {
	return {
		id: partial.id || `session-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
		title: partial.title || 'bash',
		kind: partial.kind || 'shell',
		status: partial.status || 'starting',
		exitCode: partial.exitCode ?? null,
		cmd: partial.cmd || '/bin/sh',
		args: Array.isArray(partial.args) ? [...partial.args] : [],
		cwd: partial.cwd || '/home/user',
		env: Array.isArray(partial.env) ? [...partial.env] : [],
		createdAt: partial.createdAt ?? Date.now(),
		cols: partial.cols ?? 80,
		rows: partial.rows ?? 24
	};
}

export function upsertSession(record) {
	const normalized = createSessionRecord(record);
	let inserted = false;
	sessions.update((list) => {
		const idx = list.findIndex((s) => s.id === normalized.id);
		if (idx >= 0) {
			const next = [...list];
			next[idx] = { ...next[idx], ...normalized };
			inserted = true;
			return next;
		}
		if (list.length >= MAX_SESSIONS) {
			return list;
		}
		inserted = true;
		return [...list, normalized];
	});
	return inserted ? normalized : null;
}

export function updateSession(id, patch) {
	sessions.update((list) => {
		let changed = false;
		const next = list.map((s) => {
			if (s.id !== id) return s;
			changed = true;
			return { ...s, ...patch };
		});
		return changed ? next : list;
	});
}

export function removeSession(id) {
	let fallbackId = null;
	sessions.update((list) => {
		const idx = list.findIndex((s) => s.id === id);
		if (idx < 0) return list;
		const next = list.filter((s) => s.id !== id);
		if (next.length > 0) {
			fallbackId = next[Math.min(idx, next.length - 1)].id;
		}
		return next;
	});
	activeSessionId.update((current) => (current === id ? fallbackId : current));
}

export function setActiveSession(id) {
	activeSessionId.set(id);
}

export function dismissToast(id) {
	const timer = toastTimers.get(id);
	if (timer !== undefined) {
		clearTimeout(timer);
		toastTimers.delete(id);
	}
	toasts.update((list) => list.filter((t) => t.id !== id));
}

export function addToast({ message, type = 'info', duration = 3500 } = {}) {
	if (!message) return null;
	const id = `toast-${nextToastSeq++}`;
	const entry = {
		id,
		message: String(message),
		type,
		createdAt: Date.now()
	};
	toasts.update((list) => [...list.slice(-4), entry]);
	if (duration > 0) {
		const timer = setTimeout(() => {
			toastTimers.delete(id);
			dismissToast(id);
		}, duration);
		toastTimers.set(id, timer);
	}
	return id;
}

export function resetSessionsStore() {
	for (const timer of toastTimers.values()) {
		clearTimeout(timer);
	}
	toastTimers.clear();
	sessions.set([]);
	activeSessionId.set(null);
	activeVt.set(1);
	vtAvailable.set(false);
	displayPaused.set(false);
	bootState.set({ ...DEFAULT_BOOT_STATE });
	activeRenderer.set('dom');
	pageHidden.set(false);
	vmState.set('booting');
	tailscaleIp.set(null);
	toasts.set([]);
}
