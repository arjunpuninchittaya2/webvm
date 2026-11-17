<script>
	import { toasts, dismissToast } from '$lib/stores/sessions.js';

	function toastStyle(type) {
		switch (type) {
			case 'success':
				return 'bg-emerald-950/95 border-emerald-700 text-emerald-100';
			case 'warning':
				return 'bg-amber-950/95 border-amber-700 text-amber-100';
			case 'error':
				return 'bg-red-950/95 border-red-700 text-red-100';
			default:
				return 'bg-neutral-900/95 border-neutral-700 text-gray-100';
		}
	}
</script>

<div
	class="fixed bottom-9 right-4 z-40 flex flex-col gap-2 max-w-sm pointer-events-none"
	aria-live="polite"
	data-testid="toast-container"
>
	{#each $toasts as toast (toast.id)}
		<div
			class="pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-md border shadow-lg text-xs {toastStyle(toast.type)}"
			role="status"
		>
			<span class="flex-1">{toast.message}</span>
			<button
				type="button"
				aria-label="Dismiss notification"
				class="p-0.5 rounded opacity-75 hover:opacity-100 focus:outline-none"
				on:click={() => dismissToast(toast.id)}
			>
				<svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
					<path
						fill-rule="evenodd"
						d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
						clip-rule="evenodd"
					/>
				</svg>
			</button>
		</div>
	{/each}
</div>
