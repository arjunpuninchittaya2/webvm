import { addToast } from '$lib/stores/sessions.js';

let sharedCtx = null;

/** Drops the cached AudioContext (used when settings change and by tests). */
export function resetBellContext() {
	try {
		sharedCtx?.close?.();
	} catch {
		// ignore
	}
	sharedCtx = null;
}

function getAudioContextCtor() {
	if (typeof window === 'undefined') return null;
	return window.AudioContext || window.webkitAudioContext || null;
}

/**
 * Plays a short WebAudio beep. Never throws: a blocked/unsupported AudioContext
 * (NotAllowedError, missing API, suspended context) yields { audio: false }.
 * @returns {Promise<{audio: boolean, reason: string|null}>}
 */
export async function playBeep({ frequency = 880, durationMs = 120, volume = 0.08 } = {}) {
	const Ctor = getAudioContextCtor();
	if (!Ctor) return { audio: false, reason: 'unsupported' };
	try {
		if (!sharedCtx || sharedCtx.state === 'closed') sharedCtx = new Ctor();
		if (sharedCtx.state === 'suspended') await sharedCtx.resume();
		if (sharedCtx.state !== 'running') return { audio: false, reason: 'suspended' };
		const osc = sharedCtx.createOscillator();
		const gain = sharedCtx.createGain();
		osc.type = 'sine';
		osc.frequency.value = frequency;
		gain.gain.value = volume;
		osc.connect(gain);
		gain.connect(sharedCtx.destination);
		osc.start();
		osc.stop(sharedCtx.currentTime + durationMs / 1000);
		return { audio: true, reason: null };
	} catch (err) {
		sharedCtx = null;
		return { audio: false, reason: err?.name || 'error' };
	}
}

/** Terminal bell (BEL, 0x07): audio when enabled, always degrades to a visual toast. */
export async function ringTerminalBell(enabled) {
	if (!enabled) return { audio: false, visual: false, reason: 'disabled' };
	const res = await playBeep();
	if (!res.audio) {
		addToast({ message: 'Terminal bell (visual notification — audio unavailable)', type: 'info', duration: 1500 });
	}
	return { ...res, visual: !res.audio };
}

/** Settings "Test bell" action: always gives user feedback. */
export async function testBell() {
	const res = await playBeep();
	addToast({
		message: res.audio
			? 'Bell test: audio played'
			: `Bell test: audio unavailable (${res.reason}) — using visual notification`,
		type: res.audio ? 'success' : 'warning'
	});
	return res;
}

/** Optional desktop notification; only when already granted and page is hidden. */
export function notifyDesktop(title, body = '') {
	try {
		if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
		if (typeof document !== 'undefined' && !document.hidden) return false;
		new Notification(title, { body });
		return true;
	} catch {
		return false;
	}
}

export async function requestNotificationPermission() {
	try {
		if (typeof Notification === 'undefined') return 'unsupported';
		return await Notification.requestPermission();
	} catch {
		return 'denied';
	}
}
