<script>
	export let clickHandler = null;
	export let buttonTooltip = null;
	export let bgColor = "bg-neutral-700";
	export let hoverColor = "hover:bg-neutral-500";
	export let buttonIcon = null;
</script>

<button
	type="button"
	class="inline-flex items-center justify-center h-7 {bgColor} text-sm p-1 rounded-md shadow-md shadow-neutral-900 {(clickHandler != null) ? `${hoverColor} cursor-pointer` : 'opacity-75 cursor-default'}"
	aria-label={buttonTooltip || undefined}
	title={buttonTooltip}
	disabled={clickHandler == null}
	on:click={clickHandler}
>
	<i class="w-5 {buttonIcon} text-center" aria-hidden="true"></i>
</button>
