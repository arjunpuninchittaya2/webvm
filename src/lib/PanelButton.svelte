<script>
	const DEFAULT_BG = 'bg-zinc-900/60';
	const DEFAULT_HOVER = 'hover:bg-white/5 hover:border-white/20 hover:text-white';

	export let clickUrl = null;
	export let clickHandler = null;
	export let rightClickHandler = null;
	export let buttonTooltip = null;
	export let bgColor = DEFAULT_BG;
	export let hoverColor = DEFAULT_HOVER;
	export let buttonImage = null;
	export let buttonIcon = null;
	export let buttonText;
	export let variant = 'default';

	$: hasCustomBg = Boolean(bgColor && bgColor !== DEFAULT_BG);
	$: hasCustomHover = Boolean(hoverColor && hoverColor !== DEFAULT_HOVER);
	$: surfaceClasses =
		variant === 'destructive' && !hasCustomBg
			? 'border-rose-500/20 bg-rose-500/10 text-rose-300'
			: `border-white/10 ${bgColor || DEFAULT_BG} text-zinc-200`;
	$: hoverClasses =
		variant === 'destructive' && !hasCustomHover
			? 'hover:bg-rose-500/20 hover:border-rose-500/30'
			: hoverColor || DEFAULT_HOVER;
</script>

{#if clickUrl != null}
	<a
		href={clickUrl}
		target="_blank"
		rel="noopener noreferrer"
		on:click={clickHandler}
		on:contextmenu={rightClickHandler}
		class="block rounded-xl focus:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
	>
		<span
			class="flex flex-row items-center gap-2.5 px-3 py-2 rounded-xl border text-xs font-medium shadow-xs backdrop-blur-sm transition-all cursor-pointer active:scale-[0.97] {surfaceClasses} {hoverClasses}"
			title={buttonTooltip}
		>
			{#if buttonImage}
				<img src={buttonImage} alt="" class="inline w-5 h-5 shrink-0 object-contain" />
			{:else if buttonIcon}
				<i class="w-5 {buttonIcon} text-center text-sm shrink-0" aria-hidden="true"></i>
			{/if}
			<span class="truncate">{buttonText}</span><slot></slot>
		</span>
	</a>
{:else}
	<button
		type="button"
		on:click={clickHandler}
		on:contextmenu={rightClickHandler}
		disabled={clickHandler == null}
		class="w-full text-left rounded-xl focus:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
	>
		<span
			class="flex flex-row items-center gap-2.5 px-3 py-2 rounded-xl border text-xs font-medium shadow-xs backdrop-blur-sm transition-all {surfaceClasses} {clickHandler != null
				? `${hoverClasses} cursor-pointer active:scale-[0.97]`
				: 'opacity-50 cursor-not-allowed'}"
			title={buttonTooltip}
		>
			{#if buttonImage}
				<img src={buttonImage} alt="" class="inline w-5 h-5 shrink-0 object-contain" />
			{:else if buttonIcon}
				<i class="w-5 {buttonIcon} text-center text-sm shrink-0" aria-hidden="true"></i>
			{/if}
			<span class="truncate">{buttonText}</span><slot></slot>
		</span>
	</button>
{/if}
