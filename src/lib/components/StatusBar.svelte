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
	class="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 px-3 py-1 bg-zinc-950 border-t border-white/10 text-[11px] text-zinc-400 shrink-0"
	data-testid="status-bar"
>
	<div class="flex items-center gap-2.5">
		<span class="inline-flex items-center gap-1.5" data-testid="status-vm-state">
			<span
				class="w-1.5 h-1.5 rounded-full {$vmState === 'ready'
					? 'bg-emerald-400'
					: $vmState === 'error'
						? 'bg-rose-400'
						: 'bg-amber-400 animate-pulse'}"
				aria-hidden="true"
			></span>
			<span class="capitalize text-zinc-200">{$vmState}</span>
		</span>

		{#if $vtAvailable}
			<span class="font-mono text-zinc-200" data-testid="status-vt">
				VT{$activeVt}{$displayPaused ? ' (Paused)' : ''}
			</span>
		{:else}
			<span class="font-mono text-zinc-400" data-testid="status-vt">VT1</span>
		{/if}

		{#if $activeSession}
			<span class="font-mono text-zinc-400 tabular-nums" data-testid="status-session">
				{$activeSession.title} · {$activeSession.cols}×{$activeSession.rows}
			</span>
		{/if}
	</div>

	<div class="flex items-center gap-3">
		<span class="font-mono text-zinc-400" data-testid="status-renderer">
			Renderer: {$activeRenderer.toUpperCase()}
		</span>
		<span class="font-mono text-zinc-400 tabular-nums" data-testid="status-cpu">CPU: {$cpuPercentage}%</span>
		<span class="font-mono text-zinc-400 tabular-nums" data-testid="status-disk">Disk: {$diskLatency}ms</span>

		{#if $tailscaleIp}
			<span class="font-mono text-emerald-400" data-testid="status-tailscale">
				Tailscale: {$tailscaleIp}
			</span>
		{/if}

		<button
			type="button"
			data-testid="status-power-saver"
			aria-pressed={$settings.powerSaver}
			aria-label="Toggle power saver mode"
			title={$settings.powerSaver
				? 'Power Saver (ECO) enabled — click to disable'
				: 'Enable Power Saver (ECO) mode'}
			class="px-2 py-0.5 rounded-md border font-mono text-[10px] leading-tight transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 {$settings.powerSaver || $pageHidden
				? 'bg-white/10 border-white/20 text-white font-medium'
				: 'bg-transparent border-white/10 text-zinc-400 hover:bg-white/5 hover:text-white'}"
			on:click={() => settings.updateSetting('powerSaver', !$settings.powerSaver)}
		>
			ECO{$settings.powerSaver ? ' ON' : ''}
		</button>
	</div>
</footer>
