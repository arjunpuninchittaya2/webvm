// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { compile, preprocess } from 'svelte/compiler';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { transformSync } from 'esbuild';

const require = createRequire(import.meta.url);

async function renderSsrWithoutLocalStorage(filePath, props = {}) {
	const raw = fs.readFileSync(path.resolve(filePath), 'utf8');
	const pp = await preprocess(raw, vitePreprocess(), { filename: filePath });
	const compiled = compile(pp.code, {
		filename: filePath,
		generate: 'ssr'
	});
	const cjs = transformSync(compiled.js.code, { format: 'cjs', loader: 'js' });

	const mod = { exports: {} };
	const customRequire = (id) => {
		if (id === '$app/environment') {
			return { browser: false, dev: false, building: true, version: 'test' };
		}
		if (id === './format-count') {
			return {
				default: (n) => String(n)
			};
		}
		if (id.startsWith('svelte')) {
			return require(id);
		}
		return require(path.resolve(path.dirname(filePath), id));
	};

	const fn = new Function('require', 'module', 'exports', cjs.code);
	const ctx = vm.createContext({
		require: customRequire,
		module: mod,
		exports: mod.exports,
		console,
		fetch: () => Promise.reject(new Error('fetch should not run during SSR'))
	});
	vm.runInContext(
		`(${fn.toString()})(require, module, exports);`,
		ctx,
		{ filename: filePath }
	);
	return mod.exports.default.render(props);
}

describe('Social counter components (SSR Node execution)', () => {
	it('DiscordPresenceCount renders during SSR with localStorage undefined and zero fetch calls', async () => {
		const rendered = await renderSsrWithoutLocalStorage(
			'src/lib/counters/DiscordPresenceCount.svelte',
			{ guildId: '988743885121548329' }
		);
		expect(rendered.html.trim()).toBe('');
	});

	it('GitHubStarCount renders during SSR with localStorage undefined and zero fetch calls', async () => {
		const rendered = await renderSsrWithoutLocalStorage(
			'src/lib/counters/GitHubStarCount.svelte',
			{ repo: 'leaningtech/webvm' }
		);
		expect(rendered.html.trim()).toBe('');
	});
});
