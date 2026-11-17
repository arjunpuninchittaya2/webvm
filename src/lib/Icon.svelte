<script>
	export let icon;
	export let info;
	export let activity;
	export let active = false;
	import { createEventDispatcher } from 'svelte';

	const dispatch = createEventDispatcher();
	function handleMouseover() {
		dispatch('mouseover', info);
	}
	function handleClick() {
		dispatch('click', { icon, info });
	}
</script>

<button
	type="button"
	class="w-full p-3 cursor-pointer text-center hover:bg-neutral-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 {$activity ? 'text-amber-500 animate-pulse' : 'hover:text-gray-100'} {active ? 'bg-neutral-600 text-white' : ''}"
	style="animation-duration: 0.5s"
	aria-label={info}
	title={info}
	aria-pressed={active}
	on:mouseenter={handleMouseover}
	on:click={handleClick}
>
	<i class="{icon} fa-xl" aria-hidden="true"></i>
</button>
