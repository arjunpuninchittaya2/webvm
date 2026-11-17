import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { load } from '../../src/routes/+layout.server.js';

describe('+layout.server.js', () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('does not import unused $app/server', () => {
		const src = fs.readFileSync(path.resolve('src/routes/+layout.server.js'), 'utf8');
		expect(src).not.toContain('$app/server');
	});

	it('parses og:title and og:image in parallel when network succeeds', async () => {
		globalThis.fetch = vi.fn(async (url, init) => {
			expect(init?.signal).toBeDefined();
			const slug = url.split('/').pop();
			return {
				ok: true,
				status: 200,
				text: async () =>
					`<html><head><meta property="og:title" content="Title ${slug}"><meta property="og:image" content="https://img/${slug}.png"></head></html>`
			};
		});

		const result = await load();
		expect(result.posts).toHaveLength(7);
		expect(result.posts[0]).toEqual({
			title: 'Title webvm-claude',
			image: 'https://img/webvm-claude.png',
			url: 'https://labs.leaningtech.com/blog/webvm-claude'
		});
	});

	it('returns empty posts array cleanly when completely offline', async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('fetch failed: ENOTFOUND'));
		const result = await load();
		expect(result).toEqual({ posts: [] });
	});

	it('handles timeouts and partial HTTP failures gracefully', async () => {
		let idx = 0;
		globalThis.fetch = vi.fn(async (url) => {
			idx++;
			if (idx === 1) {
				return {
					ok: true,
					status: 200,
					text: async () =>
						'<html><head><meta property="og:title" content="Only Surviving Post"><meta property="og:image" content="https://img/ok.png"></head></html>'
				};
			}
			if (idx === 2) {
				return { ok: false, status: 503, text: async () => 'Service Unavailable' };
			}
			const err = new Error('The operation timed out');
			err.name = 'TimeoutError';
			throw err;
		});

		const result = await load();
		expect(result.posts).toHaveLength(1);
		expect(result.posts[0].title).toBe('Only Surviving Post');
	});
});
