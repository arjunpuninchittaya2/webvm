import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { aiActivity } from '../../src/lib/activities.js';

const mockCreate = vi.fn();
const sdkConstructSpy = vi.fn();

vi.mock('@anthropic-ai/sdk', () => {
	class MockAnthropic {
		constructor(opts) {
			sdkConstructSpy(opts);
			this.beta = {
				messages: {
					create: mockCreate
				}
			};
		}
	}
	return { default: MockAnthropic };
});

describe('anthropic.js lazy loading, error resilience, and incremental terminal scan', () => {
	beforeEach(() => {
		vi.resetModules();
		mockCreate.mockReset();
		sdkConstructSpy.mockReset();
		localStorage.clear();
		aiActivity.set(false);
	});

	it('does NOT import or construct @anthropic-ai/sdk on initialize() or setApiKey()', async () => {
		localStorage.setItem('anthropic-api-key', 'sk-saved-key');
		const mod = await import('../../src/lib/anthropic.js');
		expect(get(mod.apiState)).toBe('READY');
		expect(sdkConstructSpy).not.toHaveBeenCalled();

		mod.setApiKey('sk-new-key');
		expect(get(mod.apiState)).toBe('READY');
		expect(sdkConstructSpy).not.toHaveBeenCalled();
	});

	it('resets aiActivity on network error, missing e.error, 401, and non-end_turn stop_reason', async () => {
		const mod = await import('../../src/lib/anthropic.js');
		mod.setApiKey('sk-test-key');

		// 1. TypeError (e.error undefined)
		mockCreate.mockRejectedValueOnce(new TypeError('Failed to fetch'));
		await mod.addMessage('hello', vi.fn());
		expect(sdkConstructSpy).toHaveBeenCalledTimes(1);
		expect(get(aiActivity)).toBe(false);
		let list = get(mod.messageList);
		expect(list.at(-1)).toEqual({ role: 'error', content: 'Failed to fetch' });

		// 2. Non-end_turn stop_reason (max_tokens)
		mockCreate.mockResolvedValueOnce({
			role: 'assistant',
			stop_reason: 'max_tokens',
			content: [{ type: 'text', text: 'Truncated response' }]
		});
		await mod.addMessage('continue', vi.fn());
		expect(get(aiActivity)).toBe(false);

		// 3. 401 Invalid API key clears key & resets aiActivity
		mockCreate.mockRejectedValueOnce({ status: 401 });
		await mod.addMessage('auth check', vi.fn());
		expect(get(aiActivity)).toBe(false);
		expect(get(mod.apiState)).toBe('KEY_REQUIRED');
		expect(localStorage.getItem('anthropic-api-key')).toBeNull();
	});

	it('handleToolImpl scans terminal lines incrementally in O(N) instead of O(N^2)', async () => {
		const mod = await import('../../src/lib/anthropic.js');

		let onWriteParsedCb = null;
		const lines = ['user@webvm:~$ ls'];
		const translateCounts = new Map();

		const buffer = {
			baseY: 0,
			cursorY: 0,
			get length() {
				return lines.length;
			},
			getLine(idx) {
				if (idx < 0 || idx >= lines.length) return undefined;
				return {
					translateToString() {
						translateCounts.set(idx, (translateCounts.get(idx) || 0) + 1);
						return lines[idx];
					}
				};
			}
		};

		const markerDisposeSpy = vi.fn();
		const mockTerm = {
			cols: 80,
			buffer: { active: buffer },
			registerMarker: vi.fn((offset = 0) => ({
				line: buffer.baseY + buffer.cursorY + offset,
				isDisposed: false,
				dispose: markerDisposeSpy
			})),
			onWriteParsed: vi.fn((cb) => {
				onWriteParsedCb = cb;
				return { dispose: vi.fn() };
			}),
			input: vi.fn()
		};

		const resultPromise = mod.handleToolImpl({ command: 'seq 1 120' }, mockTerm);

		// Simulate 120 output lines arriving in 30 incremental chunks (4 lines per chunk)
		for (let chunk = 0; chunk < 30; chunk++) {
			for (let k = 0; k < 4; k++) {
				const num = chunk * 4 + k + 1;
				lines.push(`line-${num}`);
			}
			buffer.cursorY = lines.length - 1;
			onWriteParsedCb();
		}

		// Sentinel arrives
		lines.push('# End of AI command');
		lines.push('user@webvm:~$ ');
		buffer.cursorY = lines.length - 1;
		onWriteParsedCb();

		const output = await resultPromise;
		expect(output).toContain('line-1\n');
		expect(output).toContain('line-120\n');
		expect(output).not.toContain('# End of AI command');

		const totalTranslateCalls = Array.from(translateCounts.values()).reduce((a, b) => a + b, 0);
		// Total lines ~123, 31 events. O(N^2) would be ~1900+ calls; O(N) incremental scan is < 220 calls.
		expect(totalTranslateCalls).toBeLessThan(220);
		expect(markerDisposeSpy).toHaveBeenCalled();
	});
});
