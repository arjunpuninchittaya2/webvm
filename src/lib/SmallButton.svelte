<script>
	const DEFAULT_BG = 'bg-zinc-900/60';
	const DEFAULT_HOVER = 'hover:bg-white/5 hover:text-white hover:border-white/20';

	export let clickHandler = null;
	export let buttonTooltip = null;
	export let bgColor = DEFAULT_BG;
	export let hoverColor = DEFAULT_HOVER;
	export let buttonIcon = null;
	export let active = false;
	export let variant = 'default';

	$: hasCustomBg = Boolean(bgColor && bgColor !== DEFAULT_BG);
	$: hasCustomHover = Boolean(hoverColor && hoverColor !== DEFAULT_HOVER);
	$: surfaceClasses = active
		? 'border-white/20 bg-white/10 text-white'
		: variant === 'destructive' && !hasCustomBg
			? 'border-rose-500/20 bg-rose-500/10 text-rose-300'
			: `border-white/10 ${bgColor || DEFAULT_BG} text-zinc-400`;
	$: hoverClasses =
		variant === 'destructive' && !hasCustomHover
			? 'hover:bg-rose-500/20 hover:border-rose-500/30'
			: hoverColor || DEFAULT_HOVER;
</script>

<button
	type="button"
	class="inline-flex items-center justify-center h-7 w-7 rounded-lg border text-xs shadow-xs transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-white/20 {surfaceClasses} {clickHandler != null
		? `${hoverClasses} cursor-pointer active:scale-[0.97]`
		: 'opacity-50 cursor-not-allowed'}"
	aria-label={buttonTooltip || undefined}
	title={buttonTooltip}
	disabled={clickHandler == null}
	on:click={clickHandler}
>
	<i class="{buttonIcon} text-xs leading-none" aria-hidden="true"></i>
</button>
