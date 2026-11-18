<script>
	import { bootState } from '$lib/stores/sessions.js';

	let dismissedError = null;

	$: if (!$bootState.error) {
		dismissedError = null;
	}
</script>

{#if !$bootState.ready && ($bootState.error ? dismissedError !== $bootState.error : $bootState.phase !== 'idle')}
	<div
		class="pointer-events-none absolute top-2 right-3 z-[25] w-[calc(100%-1.5rem)] max-w-xs sm:max-w-sm"
		data-testid="boot-progress-overlay"
	>
		<div
			class="{$bootState.error
				? 'pointer-events-auto border-rose-500/20 bg-zinc-950/95 text-rose-300'
				: 'pointer-events-none border-white/10 bg-zinc-900/95 text-zinc-200'} relative overflow-hidden flex flex-col gap-1.5 px-3 py-2.5 rounded-xl border backdrop-blur-md shadow-2xl text-xs"
			role="status"
			aria-live="polite"
		>
			{#if $bootState.error}
				<div class="pointer-events-none absolute inset-0 bg-rose-500/10" aria-hidden="true"></div>
			{/if}
			<div class="relative flex items-center justify-between gap-3">
				<span class="font-medium">
					{$bootState.error ? 'Boot unavailable' : $bootState.message}
				</span>
				{#if $bootState.error}
					<button
						type="button"
						aria-label="Dismiss boot notice"
						class="pointer-events-auto px-2 py-0.5 rounded-md border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 text-[11px] font-medium text-rose-300 transition-all active:scale-[0.97]"
						on:click={() => {
							dismissedError = $bootState.error;
						}}
					>
						Dismiss
					</button>
				{:else}
					<span class="font-mono text-[11px] text-zinc-400 tabular-nums">{$bootState.progress}%</span>
				{/if}
			</div>
			{#if !$bootState.error}
				<div class="relative w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
					<div
						class="h-full rounded-full bg-zinc-200 transition-all duration-200"
						style="width: {Math.max(5, Math.min(100, $bootState.progress))}%"
					></div>
				</div>
			{:else}
				<p class="relative text-[11px] text-rose-300/90 break-words leading-relaxed">{$bootState.error}</p>
			{/if}
		</div>
	</div>
{/if}
