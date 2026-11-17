import { describe, it, expect, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { resetBellContext, playBeep, ringTerminalBell, testBell } from '../../src/lib/audio/bell.js';
import { toasts, resetSessionsStore } from '../../src/lib/stores/sessions.js';

afterEach(() => {
	resetBellContext();
	delete window.AudioContext;
	delete window.webkitAudioContext;
	resetSessionsStore();
});

function installContext(state = 'running') {
	const osc = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: {}, type: '' };
	window.AudioContext = function () {
		return {
			state,
			currentTime: 0,
			destination: {},
			resume: vi.fn(async function () {}),
			createOscillator: () => osc,
			createGain: () => ({ gain: {}, connect: vi.fn() })
		};
	};
	return osc;
}

describe('WebAudio bell', () => {
	it('plays a beep when AudioContext works', async () => {
		const osc = installContext();
		const res = await playBeep();
		expect(res.audio).toBe(true);
		expect(osc.start).toHaveBeenCalled();
		expect(osc.stop).toHaveBeenCalled();
	});
	it('does not throw when AudioContext throws NotAllowedError', async () => {
		window.AudioContext = function () {
			throw new DOMException('blocked', 'NotAllowedError');
		};
		const res = await playBeep();
		expect(res).toEqual({ audio: false, reason: 'NotAllowedError' });
	});
	it('reports unsupported when API is missing', async () => {
		expect((await playBeep()).reason).toBe('unsupported');
	});
	it('ringTerminalBell is silent when disabled and falls back to a visual toast when blocked', async () => {
		expect((await ringTerminalBell(false)).reason).toBe('disabled');
		expect(get(toasts)).toHaveLength(0);
		const res = await ringTerminalBell(true);
		expect(res.visual).toBe(true);
		expect(get(toasts)[0].message).toMatch(/visual/i);
	});
	it('testBell always gives user feedback', async () => {
		await testBell();
		expect(get(toasts)[0].message).toMatch(/bell/i);
	});
});
