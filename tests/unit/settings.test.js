import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	SETTINGS_STORAGE_KEY,
	DEFAULT_SETTINGS,
	TERMINAL_THEMES,
	FONT_FAMILY_PRESETS,
	sanitizeSettings,
	loadSettings,
	settings,
	resetSettings,
	getThemeDefinition
} from '../../src/lib/stores/settings.js';

describe('settings.js persistent workstation preferences', () => {
	beforeEach(() => {
		localStorage.clear();
		resetSettings();
	});

	it('sanitizes bounds and invalid values cleanly', () => {
		const sanitized = sanitizeSettings({
			fontSize: 99,
			scrollback: 10,
			theme: 'nonexistent',
			renderer: 'vulkan',
			displayScale: 5,
			cursorBlink: 'yes',
			powerSaver: true,
			sidebarPin: true,
			virtualKeysVisible: true
		});

		expect(sanitized.fontSize).toBe(28);
		expect(sanitized.scrollback).toBe(200);
		expect(sanitized.theme).toBe('dark');
		expect(sanitized.renderer).toBe('auto');
		expect(sanitized.displayScale).toBe(2);
		expect(sanitized.cursorBlink).toBe(DEFAULT_SETTINGS.cursorBlink);
		expect(sanitized.powerSaver).toBe(true);
		expect(sanitized.sidebarPin).toBe(true);
		expect(sanitized.virtualKeysVisible).toBe(true);

		const low = sanitizeSettings({ fontSize: 2, scrollback: 999999, displayScale: 0.1 });
		expect(low.fontSize).toBe(10);
		expect(low.scrollback).toBe(20000);
		expect(low.displayScale).toBe(0.5);
	});

	it('persists updates to webvm.settings.v1 and resets cleanly', () => {
		settings.updateSetting('theme', 'solarized');
		settings.updateSetting('fontSize', 18);
		settings.updateSetting('powerSaver', true);

		const raw = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY));
		expect(raw.theme).toBe('solarized');
		expect(raw.fontSize).toBe(18);
		expect(raw.powerSaver).toBe(true);

		const loaded = loadSettings();
		expect(loaded.theme).toBe('solarized');
		expect(loaded.fontSize).toBe(18);

		resetSettings();
		expect(get(settings)).toEqual(DEFAULT_SETTINGS);
	});

	it('provides fresh cloned ITheme objects and font presets', () => {
		expect(Object.keys(TERMINAL_THEMES)).toEqual(['dark', 'light', 'solarized', 'high-contrast']);
		expect(FONT_FAMILY_PRESETS.length).toBeGreaterThanOrEqual(3);

		const t1 = getThemeDefinition('solarized');
		const t2 = getThemeDefinition('solarized');
		expect(t1).not.toBe(t2);
		expect(t1.background).toBe('#002b36');
	});

	it('falls back to defaults for null, boolean, array, and empty/whitespace numeric strings', () => {
		for (const bad of [null, true, false, '', '   ', [], [12], {}]) {
			const res = sanitizeSettings({ fontSize: bad, scrollback: bad, displayScale: bad });
			expect(res.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
			expect(res.scrollback).toBe(DEFAULT_SETTINGS.scrollback);
			expect(res.displayScale).toBe(DEFAULT_SETTINGS.displayScale);
		}
		const strNum = sanitizeSettings({ fontSize: ' 16 ', scrollback: '500', displayScale: '1.5' });
		expect(strNum.fontSize).toBe(16);
		expect(strNum.scrollback).toBe(500);
		expect(strNum.displayScale).toBe(1.5);
	});
});
