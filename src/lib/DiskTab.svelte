<script>
	import PanelButton from './PanelButton.svelte';
	import { createEventDispatcher } from 'svelte';
	import { diskLatency } from './activities.js';

	const dispatch = createEventDispatcher();
	let state = 'START';
	let workspaceState = 'START';

	function handleReset() {
		if (state === 'START') {
			state = 'CONFIRM';
		} else if (state === 'CONFIRM') {
			state = 'RESETTING';
			dispatch('reset');
		}
	}

	function handleResetWorkspace() {
		if (workspaceState === 'START') {
			workspaceState = 'CONFIRM';
		} else if (workspaceState === 'CONFIRM') {
			workspaceState = 'RESETTING';
			dispatch('resetWorkspace');
			setTimeout(() => {
				workspaceState = 'START';
			}, 300);
		}
	}

	function getButtonText(s) {
		if (s === 'START') return 'Reset disk';
		if (s === 'RESETTING') return 'Resetting...';
		return 'Reset disk. Confirm?';
	}

	function getWorkspaceButtonText(s) {
		if (s === 'START') return 'Reset workspace';
		if (s === 'RESETTING') return 'Resetting workspace...';
		return 'Reset workspace. Confirm?';
	}
</script>

<h1 class="text-sm font-semibold text-zinc-100 pr-8">Disk</h1>
<div data-testid="reset-disk-btn">
	<PanelButton
		buttonIcon="fa-solid fa-trash-can"
		clickHandler={handleReset}
		buttonText={getButtonText(state)}
		variant={state === 'START' ? 'default' : 'destructive'}
	/>
</div>
{#if state === 'CONFIRM'}
	<p class="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
		<span class="font-semibold">Warning: </span>WebVM will reload. Your persistent <code class="font-mono">/home/user/workspace</code> files are preserved.
	</p>
{:else if state === 'RESETTING'}
	<p class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-200"><span class="font-semibold">Reset in progress: </span>Please wait...</p>
{:else}
	<p class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-200"><span class="font-semibold">Backend latency: </span><span class="font-mono tabular-nums">{$diskLatency}ms</span></p>
{/if}

<div class="pt-3 border-t border-white/5 space-y-2" data-testid="reset-workspace-btn">
	<h2 class="text-xs font-semibold text-zinc-200">Persistent Workspace</h2>
	<PanelButton
		buttonIcon="fa-solid fa-broom"
		clickHandler={handleResetWorkspace}
		buttonText={getWorkspaceButtonText(workspaceState)}
		variant={workspaceState === 'START' ? 'default' : 'destructive'}
	/>
	{#if workspaceState === 'CONFIRM'}
		<p class="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
			<span class="font-semibold">Warning: </span>Clears only <code class="font-mono">/home/user/workspace</code> (OS disk is preserved).
		</p>
	{:else}
		<p class="text-[11px] leading-relaxed text-zinc-400">
			<code class="font-mono text-zinc-300">/home/user/workspace</code> is stored in a dedicated IndexedDB device separate from the OS root disk.
		</p>
	{/if}
</div>

<p class="text-[11px] leading-relaxed text-zinc-400">WebVM runs on top of a complete Linux distribution</p>
<p class="text-[11px] leading-relaxed text-zinc-400">Filesystems up to 2GB are supported and data is downloaded completely on-demand</p>
<p class="text-[11px] leading-relaxed text-zinc-400">The WebVM cloud backend uses WebSockets and it's distributed via a global CDN to minimize download latency</p>
