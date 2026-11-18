<script>
	export let title;
	export let image;
	export let url;
</script>
<a href={url} target="_blank" rel="noopener noreferrer" class="group block rounded-xl border border-white/10 bg-zinc-900/60 p-2.5 transition-all hover:bg-white/5 hover:border-white/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-white/20">
	{#if image}
		<img class="w-full aspect-[40/21] rounded-lg object-cover mb-2 border border-white/5" src={image} alt={title ?? ''}>
	{/if}
	<h2 class="text-xs font-semibold text-zinc-200 group-hover:text-white transition-colors leading-snug">{title}</h2>
</a>
