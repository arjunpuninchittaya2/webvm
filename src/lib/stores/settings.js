import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export const SETTINGS_STORAGE_KEY = 'webvm.settings.v1';

export const FONT_FAMILY_PRESETS = [
	{
		id: 'system-mono',
		label: 'System Monospace',
		value: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'
	},
	{
		id: 'classic-mono',
		label: 'Classic Monospace',
		value: 'monospace'
	},
	{
		id: 'dejavu-mono',
		label: 'DejaVu / Liberation Mono',
		value: '"DejaVu Sans Mono", "Liberation Mono", "Courier New", monospace'
	},
	{
		id: 'fira-mono',
		label: 'Fira / JetBrains Fallback',
		value: '"JetBrains Mono", "Fira Code", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
	}
];

export const TERMINAL_THEMES = {
	dark: {
		id: 'dark',
		label: 'Dark (Default)',
		theme: {
			background: '#09090b',
			foreground: '#e4e4e7',
			cursor: '#fafafa',
			cursorAccent: '#09090b',
			selectionBackground: 'rgba(255, 255, 255, 0.16)',
			black: '#18181b',
			red: '#f87171',
			green: '#4ade80',
			yellow: '#fbbf24',
			blue: '#60a5fa',
			magenta: '#c084fc',
			cyan: '#22d3ee',
			white: '#e4e4e7',
			brightBlack: '#52525b',
			brightRed: '#fca5a5',
			brightGreen: '#86efac',
			brightYellow: '#fde68a',
			brightBlue: '#93c5fd',
			brightMagenta: '#d8b4fe',
			brightCyan: '#67e8f9',
			brightWhite: '#fafafa'
		}
	},
	light: {
		id: 'light',
		label: 'Light',
		theme: {
			background: '#f8fafc',
			foreground: '#0f172a',
			cursor: '#0f172a',
			cursorAccent: '#f8fafc',
			selectionBackground: 'rgba(37, 99, 235, 0.25)',
			black: '#1e293b',
			red: '#dc2626',
			green: '#16a34a',
			yellow: '#ca8a04',
			blue: '#2563eb',
			magenta: '#9333ea',
			cyan: '#0891b2',
			white: '#e2e8f0',
			brightBlack: '#64748b',
			brightRed: '#ef4444',
			brightGreen: '#22c55e',
			brightYellow: '#eab308',
			brightBlue: '#3b82f6',
			brightMagenta: '#a855f7',
			brightCyan: '#06b6d4',
			brightWhite: '#ffffff'
		}
	},
	solarized: {
		id: 'solarized',
		label: 'Solarized Dark',
		theme: {
			background: '#002b36',
			foreground: '#839496',
			cursor: '#93a1a1',
			cursorAccent: '#002b36',
			selectionBackground: 'rgba(38, 139, 210, 0.35)',
			black: '#073642',
			red: '#dc322f',
			green: '#859900',
			yellow: '#b58900',
			blue: '#268bd2',
			magenta: '#d33682',
			cyan: '#2aa198',
			white: '#eee8d5',
			brightBlack: '#586e75',
			brightRed: '#cb4b16',
			brightGreen: '#586e75',
			brightYellow: '#657b83',
			brightBlue: '#839496',
			brightMagenta: '#6c71c4',
			brightCyan: '#93a1a1',
			brightWhite: '#fdf6e3'
		}
	},
	'high-contrast': {
		id: 'high-contrast',
		label: 'High Contrast',
		theme: {
			background: '#000000',
			foreground: '#ffffff',
			cursor: '#ffff00',
			cursorAccent: '#000000',
			selectionBackground: 'rgba(255, 255, 0, 0.4)',
			black: '#000000',
			red: '#ff5555',
			green: '#55ff55',
			yellow: '#ffff55',
			blue: '#5599ff',
			magenta: '#ff55ff',
			cyan: '#55ffff',
			white: '#ffffff',
			brightBlack: '#808080',
			brightRed: '#ff8080',
			brightGreen: '#80ff80',
			brightYellow: '#ffff80',
			brightBlue: '#80bfff',
			brightMagenta: '#ff80ff',
			brightCyan: '#80ffff',
			brightWhite: '#ffffff'
		}
	}
};

export const DEFAULT_SETTINGS = Object.freeze({
	fontSize: 14,
	fontFamily: FONT_FAMILY_PRESETS[0].value,
	theme: 'dark',
	scrollback: 2000,
	renderer: 'auto',
	cursorBlink: true,
	powerSaver: false,
	sidebarPin: false,
	displayScale: 1,
	virtualKeysVisible: false,
	audioBell: false
});

const VALID_THEMES = new Set(Object.keys(TERMINAL_THEMES));
const VALID_RENDERERS = new Set(['auto', 'webgl', 'dom']);

function clampNumber(value, min, max, fallback) {
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) return fallback;
		return Math.min(max, Math.max(min, value));
	}
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed.length === 0) return fallback;
		const num = Number(trimmed);
		if (!Number.isFinite(num)) return fallback;
		return Math.min(max, Math.max(min, num));
	}
	return fallback;
}

export function sanitizeSettings(raw) {
	const src = raw && typeof raw === 'object' ? raw : {};
	return {
		fontSize: Math.round(clampNumber(src.fontSize, 10, 28, DEFAULT_SETTINGS.fontSize)),
		fontFamily:
			typeof src.fontFamily === 'string' && src.fontFamily.trim().length > 0
				? src.fontFamily.trim()
				: DEFAULT_SETTINGS.fontFamily,
		theme: VALID_THEMES.has(src.theme) ? src.theme : DEFAULT_SETTINGS.theme,
		scrollback: Math.round(clampNumber(src.scrollback, 200, 20000, DEFAULT_SETTINGS.scrollback)),
		renderer: VALID_RENDERERS.has(src.renderer) ? src.renderer : DEFAULT_SETTINGS.renderer,
		cursorBlink: typeof src.cursorBlink === 'boolean' ? src.cursorBlink : DEFAULT_SETTINGS.cursorBlink,
		powerSaver: typeof src.powerSaver === 'boolean' ? src.powerSaver : DEFAULT_SETTINGS.powerSaver,
		sidebarPin: typeof src.sidebarPin === 'boolean' ? src.sidebarPin : DEFAULT_SETTINGS.sidebarPin,
		displayScale: Number(clampNumber(src.displayScale, 0.5, 2.0, DEFAULT_SETTINGS.displayScale).toFixed(2)),
		virtualKeysVisible:
			typeof src.virtualKeysVisible === 'boolean'
				? src.virtualKeysVisible
				: DEFAULT_SETTINGS.virtualKeysVisible,
		audioBell: typeof src.audioBell === 'boolean' ? src.audioBell : DEFAULT_SETTINGS.audioBell
	};
}

export function loadSettings() {
	if (!browser || typeof localStorage === 'undefined') {
		return { ...DEFAULT_SETTINGS };
	}
	try {
		const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
		if (!raw) return { ...DEFAULT_SETTINGS };
		const parsed = JSON.parse(raw);
		return sanitizeSettings(parsed);
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

export function saveSettings(value) {
	const clean = sanitizeSettings(value);
	if (!browser || typeof localStorage === 'undefined') {
		return clean;
	}
	try {
		localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(clean));
	} catch {
		// Ignore storage quota or private-mode errors
	}
	return clean;
}

export function getThemeDefinition(themeId) {
	const entry = TERMINAL_THEMES[themeId] || TERMINAL_THEMES[DEFAULT_SETTINGS.theme];
	return { ...entry.theme };
}

function createSettingsStore() {
	const initial = loadSettings();
	const store = writable(initial);

	function set(nextValue) {
		const clean = saveSettings(nextValue);
		store.set(clean);
	}

	function update(updater) {
		store.update((current) => {
			const next = updater(current);
			return saveSettings(next);
		});
	}

	function updateSetting(key, value) {
		update((current) => ({
			...current,
			[key]: value
		}));
	}

	function reset() {
		const defaults = { ...DEFAULT_SETTINGS };
		saveSettings(defaults);
		store.set(defaults);
		return defaults;
	}

	return {
		subscribe: store.subscribe,
		set,
		update,
		updateSetting,
		reset
	};
}

export const settings = createSettingsStore();

export function resetSettings() {
	return settings.reset();
}
