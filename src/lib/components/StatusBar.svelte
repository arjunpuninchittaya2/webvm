<script>
	import { cpuPercentage, diskLatency } from '$lib/activities.js';
	import {
		activeSession,
		activeVt,
		vtAvailable,
		displayPaused,
		activeRenderer,
		pageHidden,
		vmState,
		tailscaleIp
	} from '$lib/stores/sessions.js';
	import { settings } from '$lib/stores/settings.js';
</script>

<footer
	class="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-2.5 py-1 bg-neutral-900 border-t border-neutral-800 text-[11px] text-gray-300 shrink-0"
	data-testid="status-bar"
>
	<div class="flex items-center gap-2.5">
		<span class="inline-flex items-center gap-1" data-testid="status-vm-state">
			<span
				class="w-2 h-2 rounded-full {$vmState === 'ready'
					? 'bg-emerald-400'
					: $vmState === 'error'
						? 'bg-red-500'
						: 'bg-amber-400 animate-pulse'}"
			></span>
			<span class="capitalize">{$vmState}</span>
		</span>

		{#if $vtAvailable}
			<span class="font-mono text-sky-300" data-testid="status-vt">
				VT{$activeVt}{$displayPaused ? ' (Paused)' : ''}
			</span>
		{:else}
			<span class="font-mono text-gray-400" data-testid="status-vt">VT1</span>
		{/if}

		{#if $activeSession}
			<span class="font-mono text-gray-400" data-testid="status-session">
				{$activeSession.title} · {$activeSession.cols}×{$activeSession.rows}
			</span>
		{/if}
	</div>

	<div class="flex items-center gap-3">
		<span class="font-mono" data-testid="status-renderer">
			Renderer: {$activeRenderer.toUpperCase()}
		</span>
		<span class="font-mono" data-testid="status-cpu">CPU: {$cpuPercentage}%</span>
		<span class="font-mono" data-testid="status-disk">Disk: {$diskLatency}ms</span>

		{#if $tailscaleIp}
			<span class="font-mono text-emerald-300" data-testid="status-tailscale">
				Tailscale: {$tailscaleIp}
			</span>
		{/if}

		{#if $settings.powerSaver || $pageHidden}
			<span
				class="px-1.5 py-0.2 rounded bg-amber-900/60 text-amber-200 border border-amber-700/60"
				data-testid="status-power-saver"
			>
				Power Saver
			</span>
		{/if}
	</div>
</footer>
