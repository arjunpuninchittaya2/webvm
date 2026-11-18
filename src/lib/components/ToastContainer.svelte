<script>
	import { toasts, dismissToast } from '$lib/stores/sessions.js';

	function toastStyle(type) {
		switch (type) {
			case 'success':
				return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300';
			case 'warning':
				return 'border-amber-500/20 bg-amber-500/10 text-amber-300';
			case 'error':
				return 'border-rose-500/20 bg-rose-500/10 text-rose-300';
			default:
				return 'border-white/10 bg-white/5 text-zinc-300';
		}
	}
</script>

<div
	class="fixed bottom-9 right-4 z-40 flex flex-col gap-2 max-w-sm pointer-events-none"
	aria-live="polite"
	data-testid="toast-container"
>
	{#each $toasts as toast (toast.id)}
		<div class="pointer-events-auto rounded-xl bg-zinc-950/95 backdrop-blur-md shadow-2xl animate-in fade-in-0 duration-150">
			<div
				class="flex items-center gap-2 px-3 py-2 rounded-xl border text-xs {toastStyle(toast.type)}"
				role="status"
			>
				{#if toast.type === 'success'}
					<svg class="w-3.5 h-3.5 shrink-0 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<circle cx="12" cy="12" r="10" />
						<path d="m9 12 2 2 4-4" />
					</svg>
				{:else if toast.type === 'warning'}
					<svg class="w-3.5 h-3.5 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
						<path d="M12 9v4" />
						<path d="M12 17h.01" />
					</svg>
				{:else if toast.type === 'error'}
					<svg class="w-3.5 h-3.5 shrink-0 text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<circle cx="12" cy="12" r="10" />
						<line x1="12" x2="12" y1="8" y2="12" />
						<line x1="12" x2="12.01" y1="16" y2="16" />
					</svg>
				{:else}
					<svg class="w-3.5 h-3.5 shrink-0 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<circle cx="12" cy="12" r="10" />
						<path d="M12 16v-4" />
						<path d="M12 8h.01" />
					</svg>
				{/if}
				<span class="flex-1">{toast.message}</span>
				<button
					type="button"
					aria-label="Dismiss notification"
					class="p-0.5 rounded-md opacity-75 hover:opacity-100 hover:bg-white/10 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
					on:click={() => dismissToast(toast.id)}
				>
					<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M18 6 6 18" />
						<path d="m6 6 12 12" />
					</svg>
				</button>
			</div>
		</div>
	{/each}
</div>
