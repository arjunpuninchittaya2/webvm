<script lang="ts">
	import { onMount } from "svelte";
	import { browser } from "$app/environment";
	import formatCount from "./format-count";

	export let guildId = "988743885121548329";

	const CACHE_TTL_MS = 1000 * 60 * 15;

	$: localStorageKey = `discord-prescence-${guildId}`;
	$: localStorageDateKey = `discord-prescence-date-${guildId}`;

	let presenceCount = NaN;

	interface DiscordWidgetData {
		presence_count: number;
	}

	function update() {
		const fetchOpts =
			typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
				? { signal: AbortSignal.timeout(5000) }
				: undefined;
		fetch(`https://discord.com/api/guilds/${guildId}/widget.json`, fetchOpts)
			.then((response) => {
				if (response.ok) {
					return response.json() as Promise<DiscordWidgetData>;
				}
				throw new Error(response.statusText);
			})
			.then((json) => {
				const count = json?.presence_count;
				if (typeof count === "number" && !Number.isNaN(count)) {
					presenceCount = count;
					if (browser) {
						try {
							localStorage.setItem(localStorageKey, count.toString());
							localStorage.setItem(localStorageDateKey, new Date().toISOString());
						} catch {
							// Ignore storage errors
						}
					}
					console.log("got presence count from Discord", presenceCount);
				}
			})
			.catch((error) => {
				console.error("couldn't fetch from Discord" + error);
			});
	}

	onMount(() => {
		if (!browser) return;
		try {
			const cachedCount = parseInt(localStorage.getItem(localStorageKey) ?? "");
			const cachedDateStr = localStorage.getItem(localStorageDateKey);
			const cachedDate = cachedDateStr ? new Date(cachedDateStr) : new Date(NaN);
			if (!Number.isNaN(cachedCount)) {
				presenceCount = cachedCount;
				// Invalidate cache after 15 minutes or if date is invalid
				if (Number.isNaN(cachedDate.getTime()) || Date.now() - cachedDate.getTime() > CACHE_TTL_MS) {
					update();
				}
			} else {
				update();
			}
		} catch {
			update();
		}
	});
</script>

{#if !Number.isNaN(presenceCount)}
	{formatCount(presenceCount)}
{/if}
