<script>
	export let clickUrl = null;
	export let clickHandler = null;
	export let rightClickHandler = null;
	export let buttonTooltip = null;
	export let bgColor = "bg-neutral-700";
	export let hoverColor = "hover:bg-neutral-500";
	export let buttonImage = null;
	export let buttonIcon = null;
	export let buttonText;
</script>

{#if clickUrl != null}
	<a
		href={clickUrl}
		target="_blank"
		rel="noopener noreferrer"
		on:click={clickHandler}
		on:contextmenu={rightClickHandler}
		class="block"
	>
		<span class="flex flex-row items-center {bgColor} p-2 rounded-md shadow-md shadow-neutral-900 {hoverColor} cursor-pointer" title={buttonTooltip}>
			{#if buttonImage}
				<img src={buttonImage} alt="" class="inline w-8 h-8" />
			{:else if buttonIcon}
				<i class="w-8 {buttonIcon} text-center" style="font-size: 2em;" aria-hidden="true"></i>
			{/if}
			<span class="ml-1">{buttonText}</span><slot></slot>
		</span>
	</a>
{:else}
	<button
		type="button"
		on:click={clickHandler}
		on:contextmenu={rightClickHandler}
		disabled={clickHandler == null}
		class="w-full text-left"
	>
		<span class="flex flex-row items-center {bgColor} p-2 rounded-md shadow-md shadow-neutral-900 {clickHandler != null ? `${hoverColor} cursor-pointer` : ''}" title={buttonTooltip}>
			{#if buttonImage}
				<img src={buttonImage} alt="" class="inline w-8 h-8" />
			{:else if buttonIcon}
				<i class="w-8 {buttonIcon} text-center" style="font-size: 2em;" aria-hidden="true"></i>
			{/if}
			<span class="ml-1">{buttonText}</span><slot></slot>
		</span>
	</button>
{/if}
