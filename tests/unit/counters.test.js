import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tick } from 'svelte';
import DiscordPresenceCount from '../../src/lib/counters/DiscordPresenceCount.svelte';
import GitHubStarCount from '../../src/lib/counters/GitHubStarCount.svelte';

describe('Social counter components (client cache & TTL behavior)', () => {
	const originalFetch = globalThis.fetch;
	let container;

	beforeEach(() => {
		localStorage.clear();
		container = document.createElement('div');
		document.body.appendChild(container);
	});

	afterEach(() => {
		container?.remove();
		globalThis.fetch = originalFetch;
	});

	it('DiscordPresenceCount preserves valid cache TTL without overwriting timestamp on mount', async () => {
		const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
		localStorage.setItem('discord-prescence-988743885121548329', '420');
		localStorage.setItem('discord-prescence-date-988743885121548329', fiveMinsAgo);

		globalThis.fetch = vi.fn();
		const instance = new DiscordPresenceCount({
			target: container,
			props: { guildId: '988743885121548329' }
		});
		await tick();

		expect(globalThis.fetch).not.toHaveBeenCalled();
		expect(localStorage.getItem('discord-prescence-date-988743885121548329')).toBe(fiveMinsAgo);
		expect(container.textContent.trim()).toBe('420');
		instance.$destroy();
	});

	it('DiscordPresenceCount refreshes expired or invalid-date cache and never writes "NaN" on fetch failure', async () => {
		localStorage.setItem('discord-prescence-guild1', '100');
		localStorage.setItem('discord-prescence-date-guild1', 'not-a-date');

		globalThis.fetch = vi.fn(async () => ({
			ok: true,
			json: async () => ({ presence_count: 1500 })
		}));

		const inst1 = new DiscordPresenceCount({
			target: container,
			props: { guildId: 'guild1' }
		});
		await tick();
		await new Promise((r) => setTimeout(r, 10));

		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		expect(localStorage.getItem('discord-prescence-guild1')).toBe('1500');
		expect(container.textContent.trim()).toBe('1.5k');
		inst1.$destroy();

		// Empty cache + failed fetch must NOT write "NaN"
		localStorage.clear();
		globalThis.fetch = vi.fn().mockRejectedValue(new Error('offline'));
		const inst2 = new DiscordPresenceCount({
			target: container,
			props: { guildId: 'guild2' }
		});
		await tick();
		await new Promise((r) => setTimeout(r, 10));

		expect(localStorage.getItem('discord-prescence-guild2')).toBeNull();
		expect(localStorage.getItem('discord-prescence-date-guild2')).toBeNull();
		expect(container.textContent.trim()).toBe('');
		inst2.$destroy();
	});

	it('GitHubStarCount preserves fresh cache and refreshes after 1 hour TTL', async () => {
		const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
		localStorage.setItem('github-stars-leaningtech/webvm', '12345');
		localStorage.setItem('github-stars-date-leaningtech/webvm', thirtyMinsAgo);

		globalThis.fetch = vi.fn();
		const inst1 = new GitHubStarCount({
			target: container,
			props: { repo: 'leaningtech/webvm' }
		});
		await tick();

		expect(globalThis.fetch).not.toHaveBeenCalled();
		expect(localStorage.getItem('github-stars-date-leaningtech/webvm')).toBe(thirtyMinsAgo);
		expect(container.textContent.trim()).toBe('12k');
		inst1.$destroy();

		const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
		localStorage.setItem('github-stars-date-leaningtech/webvm', twoHoursAgo);
		globalThis.fetch = vi.fn(async () => ({
			ok: true,
			json: async () => ({ stargazers_count: 13000 })
		}));

		const inst2 = new GitHubStarCount({
			target: container,
			props: { repo: 'leaningtech/webvm' }
		});
		await tick();
		await new Promise((r) => setTimeout(r, 10));

		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
		expect(localStorage.getItem('github-stars-leaningtech/webvm')).toBe('13000');
		expect(localStorage.getItem('github-stars-date-leaningtech/webvm')).not.toBe(twoHoursAgo);
		expect(container.textContent.trim()).toBe('13k');
		inst2.$destroy();
	});
});
