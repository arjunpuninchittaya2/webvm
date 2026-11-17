<script>
	import { bootState } from '$lib/stores/sessions.js';

	let dismissedError = null;

	$: if (!$bootState.error) {
		dismissedError = null;
	}
</script>

{#if !$bootState.ready && ($bootState.error ? dismissedError !== $bootState.error : $bootState.phase !== 'idle')}
	<div
		class="pointer-events-none fixed bottom-9 left-16 z-[25] max-w-md"
		data-testid="boot-progress-overlay"
	>
		<div
			class="pointer-events-auto flex flex-col gap-1.5 px-3 py-2 rounded-md border shadow-lg text-xs {$bootState.error
				? 'bg-red-950/90 border-red-800 text-red-100'
				: 'bg-neutral-900/90 border-neutral-700 text-gray-200'}"
			role="status"
			aria-live="polite"
		>
			<div class="flex items-center justify-between gap-3">
				<span class="font-medium">
					{$bootState.error ? 'Boot unavailable' : $bootState.message}
				</span>
				{#if $bootState.error}
					<button
						type="button"
						aria-label="Dismiss boot notice"
						class="px-1.5 py-0.5 rounded bg-red-900 hover:bg-red-800 text-[11px]"
						on:click={() => {
							dismissedError = $bootState.error;
						}}
					>
						Dismiss
					</button>
				{:else}
					<span class="font-mono text-gray-400">{$bootState.progress}%</span>
				{/if}
			</div>
			{#if !$bootState.error}
				<div class="w-full h-1.5 rounded-full bg-neutral-800 overflow-hidden">
					<div
						class="h-full bg-amber-500 transition-all duration-200"
						style="width: {Math.max(5, Math.min(100, $bootState.progress))}%"
					></div>
				</div>
			{:else}
				<p class="text-[11px] text-red-200/90 break-words">{$bootState.error}</p>
			{/if}
		</div>
	</div>
{/if}
