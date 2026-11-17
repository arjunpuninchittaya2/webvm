<script lang="ts">
	import { onMount } from "svelte";
	import { browser } from "$app/environment";
	import formatCount from "./format-count";

	export let repo: string; // user/repo

	// https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api#primary-rate-limit-for-unauthenticated-users
	// Invalidate cache after 1 hour
	const CACHE_TTL_MS = 1000 * 60 * 60;

	$: localStorageKey = `github-stars-${repo}`;
	$: localStorageDateKey = `github-stars-date-${repo}`;

	let stars = NaN;

	function update() {
		const fetchOpts =
			typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
				? { signal: AbortSignal.timeout(5000) }
				: undefined;
		fetch("https://api.github.com/repos/" + repo, fetchOpts)
			.then((response) => {
				if (response.ok) {
					return response.json();
				}
				throw new Error(response.statusText);
			})
			.then((json) => {
				const count = json?.stargazers_count;
				if (typeof count === "number" && !Number.isNaN(count)) {
					stars = count;
					if (browser) {
						try {
							localStorage.setItem(localStorageKey, count.toString());
							localStorage.setItem(localStorageDateKey, new Date().toISOString());
						} catch {
							// Ignore storage errors
						}
					}
					console.log("got stars from GitHub", stars);
				}
			})
			.catch((error) => {
				console.error("couldn't fetch from GitHub" + error);
			});
	}

	onMount(() => {
		if (!browser) return;
		try {
			const cachedStars = parseInt(localStorage.getItem(localStorageKey) ?? "");
			const cachedDateStr = localStorage.getItem(localStorageDateKey);
			const cachedDate = cachedDateStr ? new Date(cachedDateStr) : new Date(NaN);
			if (!Number.isNaN(cachedStars)) {
				stars = cachedStars;
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

{#if !Number.isNaN(stars)}
	{formatCount(stars)}
{/if}
