import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import fs from 'node:fs';
import path from 'node:path';

import { TERMINAL_THEMES, DEFAULT_SETTINGS, settings, resetSettings, getThemeDefinition } from '../../src/lib/stores/settings.js';
import { formatCleanError } from '../../src/lib/anthropic.js';
import SystemMonitorTab from '../../src/lib/SystemMonitorTab.svelte';
import SettingsModal from '../../src/lib/components/SettingsModal.svelte';

const EMOJI_REGEX = /(?:\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F|[\u{2600}-\u{26FF}\u{1F000}-\u{1FAFF}])/u;
const TOKEN_HYGIENE_RE = new RegExp('gh' + 'sat|github_pat_|ghp_|\\?token=', 'i');

function collectSourceFiles(dir) {
	const results = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...collectSourceFiles(fullPath));
		} else if (/\.(svelte|js|ts|css|html)$/i.test(entry.name)) {
			results.push(fullPath);
		}
	}
	return results;
}

describe('DESIGN_GUIDELINES.md compliance and M8 UI standards', () => {
	let container;
	let instance;

	beforeEach(() => {
		localStorage.clear();
		resetSettings();
		container = document.createElement('div');
		document.body.appendChild(container);
	});

	afterEach(() => {
		instance?.$destroy();
		instance = null;
		container?.remove();
		resetSettings();
	});

	it('includes DESIGN_GUIDELINES.md with key sections and zero URL/auth tokens', () => {
		const guidelinesPath = path.resolve('DESIGN_GUIDELINES.md');
		expect(fs.existsSync(guidelinesPath)).toBe(true);

		const content = fs.readFileSync(guidelinesPath, 'utf8');
		expect(content).toContain('Matte Minimal Dark');
		expect(content).toContain('Strict Zero-Emoji Policy');
		expect(content).toContain('Semantic Notices');
		expect(content).not.toMatch(TOKEN_HYGIENE_RE);
	});

	it('enforces strict zero-emoji policy across all files in src/', () => {
		const srcDir = path.resolve('src');
		const files = collectSourceFiles(srcDir);
		expect(files.length).toBeGreaterThan(0);

		const violations = [];
		for (const filePath of files) {
			const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
			lines.forEach((line, idx) => {
				if (EMOJI_REGEX.test(line)) {
					violations.push(`${path.relative(process.cwd(), filePath)}:${idx + 1}: ${line.trim()}`);
				}
			});
		}
		expect(violations).toEqual([]);
	});

	it('aligns TERMINAL_THEMES.dark canvas colors with #09090b / #e4e4e7', () => {
		expect(TERMINAL_THEMES.dark.theme.background).toBe('#09090b');
		expect(TERMINAL_THEMES.dark.theme.foreground).toBe('#e4e4e7');

		const resolved = getThemeDefinition('dark');
		expect(resolved.background).toBe('#09090b');
		expect(resolved.foreground).toBe('#e4e4e7');
	});

	it('formatCleanError strips prefixes, unwraps raw JSON blobs, and preserves network/auth messages', () => {
		expect(formatCleanError('Error: Connection reset')).toBe('Connection reset');
		expect(formatCleanError('API Error: Rate limit reached')).toBe('Rate limit reached');
		expect(formatCleanError('Provider returned error: Overloaded')).toBe('Overloaded');
		expect(formatCleanError('Error: API Error: Bad gateway')).toBe('Bad gateway');

		const jsonErr1 = formatCleanError('{"error":{"code":500,"message":"Upstream service unavailable"}}');
		expect(jsonErr1).toBe('Upstream service unavailable');
		expect(jsonErr1).not.toContain('{"error"');

		const jsonErr2 = formatCleanError('400 {"type":"error","error":{"type":"invalid_request_error","message":"Max tokens exceeded"}}');
		expect(jsonErr2).toBe('Max tokens exceeded');
		expect(jsonErr2).not.toContain('{"error"');

		const jsonErr3 = formatCleanError('API Error: {"error":{"message":"Quota exceeded"}}');
		expect(jsonErr3).toBe('Quota exceeded');
		expect(jsonErr3).not.toContain('{"error"');

		expect(formatCleanError(new TypeError('Failed to fetch'))).toBe('Failed to fetch');
		expect(formatCleanError('Invalid API key')).toBe('Invalid API key');
		expect(formatCleanError({ status: 401 })).toBe('Invalid API key');
	});

	it('formatCleanError safely handles adversarial objects, null prototypes, prose braces, reason-phrase JSON, truncated JSON, and code-only payloads', () => {
		expect(formatCleanError(null)).toBe('Unknown error');
		expect(formatCleanError(undefined)).toBe('Unknown error');
		expect(formatCleanError('')).toBe('Unknown error');
		expect(formatCleanError(0)).toBe('Unknown error');

		const throwingToString = {
			toString() {
				throw new Error('boom');
			}
		};
		expect(() => formatCleanError(throwingToString)).not.toThrow();
		expect(formatCleanError(throwingToString)).toBe('Unknown error');

		const throwingToPrimitive = {
			[Symbol.toPrimitive]() {
				throw new Error('primitive boom');
			}
		};
		expect(() => formatCleanError(throwingToPrimitive)).not.toThrow();
		expect(formatCleanError(throwingToPrimitive)).toBe('Unknown error');

		const nullProto = Object.create(null);
		expect(() => formatCleanError(nullProto)).not.toThrow();
		expect(formatCleanError(nullProto)).toBe('Unknown error');

		expect(formatCleanError('Invalid syntax near {foo}')).toBe('Invalid syntax near {foo}');

		const proxyErr = formatCleanError('502 Bad Gateway {"detail":"Proxy failed"}');
		expect(proxyErr).toBe('Proxy failed');
		expect(proxyErr).not.toContain('{');

		const truncatedJson = formatCleanError('API Error: {"error":{"message":"cut off');
		expect(truncatedJson).toBe('Unknown error');
		expect(truncatedJson).not.toContain('{');
		expect(truncatedJson).not.toContain('API Error');

		const codeOnlyJson = formatCleanError('{"code":503}');
		expect(codeOnlyJson).toBe('Request failed. Please check your API key and try again.');
		expect(codeOnlyJson).not.toContain('{');

		expect(formatCleanError({ status: 401, message: 'Error: Unauthorized' })).toBe('Invalid API key');
		expect(formatCleanError('Provider returned error: {"error":{"code":500,"message":"API Error: Upstream crash"}}')).toBe('Upstream crash');
	});

	describe('SystemMonitorTab proportional usage thresholds (<80% / >=80% / >=95%)', () => {
		async function withMockedUsage({ usage, quota, usedHeap, heapLimit }, fn) {
			const origStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');
			const origMemory = Object.getOwnPropertyDescriptor(performance, 'memory');

			Object.defineProperty(navigator, 'storage', {
				configurable: true,
				value: {
					estimate: async () => ({ usage, quota })
				}
			});
			Object.defineProperty(performance, 'memory', {
				configurable: true,
				value: {
					usedJSHeapSize: usedHeap,
					totalJSHeapSize: heapLimit,
					jsHeapSizeLimit: heapLimit
				}
			});

			try {
				instance = new SystemMonitorTab({ target: container, props: { vmManager: null } });
				await new Promise((r) => setTimeout(r, 10));
				await tick();
				await fn();
			} finally {
				instance?.$destroy();
				instance = null;
				if (origStorage) Object.defineProperty(navigator, 'storage', origStorage);
				else delete navigator.storage;
				if (origMemory) Object.defineProperty(performance, 'memory', origMemory);
				else delete performance.memory;
			}
		}

		it('uses calm neutral styling when storage and heap usage are < 80%', async () => {
			await withMockedUsage({ usage: 500, quota: 1000, usedHeap: 400, heapLimit: 1000 }, () => {
				const storageEl = container.querySelector('[data-testid="storage-quota"]');
				const memoryEl = container.querySelector('[data-testid="memory-stats"]');
				const storageText = `${storageEl.className} ${storageEl.innerHTML}`;
				const memoryText = `${memoryEl.className} ${memoryEl.innerHTML}`;

				expect(storageText).not.toMatch(/amber-|rose-/);
				expect(storageText).toMatch(/border-white\/10|bg-white\/5/);
				expect(memoryText).not.toMatch(/amber-|rose-/);
				expect(memoryText).toMatch(/border-white\/10|bg-white\/5/);
			});
		});

		it('uses amber warning styling when usage is >= 80% and < 95%', async () => {
			await withMockedUsage({ usage: 850, quota: 1000, usedHeap: 800, heapLimit: 1000 }, () => {
				const storageEl = container.querySelector('[data-testid="storage-quota"]');
				const memoryEl = container.querySelector('[data-testid="memory-stats"]');
				const storageText = `${storageEl.className} ${storageEl.innerHTML}`;
				const memoryText = `${memoryEl.className} ${memoryEl.innerHTML}`;

				expect(storageText).toMatch(/amber-/);
				expect(storageText).not.toMatch(/rose-/);
				expect(memoryText).toMatch(/amber-/);
				expect(memoryText).not.toMatch(/rose-/);
			});
		});

		it('uses rose critical styling when usage is >= 95%', async () => {
			await withMockedUsage({ usage: 950, quota: 1000, usedHeap: 980, heapLimit: 1000 }, () => {
				const storageEl = container.querySelector('[data-testid="storage-quota"]');
				const memoryEl = container.querySelector('[data-testid="memory-stats"]');
				const storageText = `${storageEl.className} ${storageEl.innerHTML}`;
				const memoryText = `${memoryEl.className} ${memoryEl.innerHTML}`;

				expect(storageText).toMatch(/rose-/);
				expect(storageText).not.toMatch(/amber-/);
				expect(memoryText).toMatch(/rose-/);
				expect(memoryText).not.toMatch(/amber-/);
			});
		});
	});

	it('SettingsModal renders 5 interactive Apple-style checkbox switches wired to settings store', async () => {
		instance = new SettingsModal({ target: container, props: { open: true } });
		await tick();

		const switchSpecs = [
			{ testId: 'setting-cursor-blink', key: 'cursorBlink' },
			{ testId: 'setting-power-saver', key: 'powerSaver' },
			{ testId: 'setting-sidebar-pin', key: 'sidebarPin' },
			{ testId: 'setting-virtual-keys', key: 'virtualKeysVisible' },
			{ testId: 'setting-audio-bell', key: 'audioBell' }
		];

		for (const { testId, key } of switchSpecs) {
			const input = container.querySelector(`[data-testid="${testId}"]`);
			expect(input).toBeTruthy();
			expect(input.tagName).toBe('INPUT');
			expect(input.type).toBe('checkbox');
			expect(input.checked).toBe(DEFAULT_SETTINGS[key]);

			input.click();
			await tick();
			expect(input.checked).toBe(!DEFAULT_SETTINGS[key]);
			expect(get(settings)[key]).toBe(!DEFAULT_SETTINGS[key]);

			input.click();
			await tick();
			expect(input.checked).toBe(DEFAULT_SETTINGS[key]);
			expect(get(settings)[key]).toBe(DEFAULT_SETTINGS[key]);
		}
	});
});
