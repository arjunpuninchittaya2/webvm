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
	class="relative flex items-center justify-center w-full h-9 rounded-lg cursor-pointer transition-all active:scale-[0.97] focus:outline-none focus-visible:ring-1 focus-visible:ring-white/20 {active
		? 'bg-white/10 text-white'
		: 'text-zinc-400 hover:bg-white/5 hover:text-white'}"
	aria-label={info}
	title={info}
	aria-pressed={active}
	on:mouseenter={handleMouseover}
	on:click={handleClick}
>
	<i class="{icon} text-[15px] leading-none" aria-hidden="true"></i>
	{#if $activity}
		<span
			class="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400/90 ring-1 ring-zinc-950"
			aria-hidden="true"
		></span>
	{/if}
</button>
