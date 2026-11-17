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

	function getBgColor(s) {
		return s === 'START' ? undefined : 'bg-red-900';
	}

	function getHoverColor(s) {
		return s === 'START' ? undefined : 'hover:bg-red-700';
	}
</script>

<h1 class="text-lg font-bold">Disk</h1>
<div data-testid="reset-disk-btn">
	<PanelButton
		buttonIcon="fa-solid fa-trash-can"
		clickHandler={handleReset}
		buttonText={getButtonText(state)}
		bgColor={getBgColor(state)}
		hoverColor={getHoverColor(state)}
	/>
</div>
{#if state === 'CONFIRM'}
	<p class="text-xs text-amber-300">
		<span class="font-bold">Warning: </span>WebVM will reload. Your persistent <code>/home/user/workspace</code> files are preserved.
	</p>
{:else if state === 'RESETTING'}
	<p><span class="font-bold">Reset in progress: </span>Please wait...</p>
{:else}
	<p><span class="font-bold">Backend latency: </span>{$diskLatency}ms</p>
{/if}

<div class="pt-2 border-t border-neutral-500/50 space-y-2" data-testid="reset-workspace-btn">
	<h2 class="text-sm font-semibold text-gray-200">Persistent Workspace</h2>
	<PanelButton
		buttonIcon="fa-solid fa-broom"
		clickHandler={handleResetWorkspace}
		buttonText={getWorkspaceButtonText(workspaceState)}
		bgColor={getBgColor(workspaceState)}
		hoverColor={getHoverColor(workspaceState)}
	/>
	{#if workspaceState === 'CONFIRM'}
		<p class="text-xs text-amber-300">
			<span class="font-bold">Warning: </span>Clears only <code>/home/user/workspace</code> (OS disk is preserved).
		</p>
	{:else}
		<p class="text-xs text-gray-300">
			<code>/home/user/workspace</code> is stored in a dedicated IndexedDB device separate from the OS root disk.
		</p>
	{/if}
</div>

<p>WebVM runs on top of a complete Linux distribution</p>
<p>Filesystems up to 2GB are supported and data is downloaded completely on-demand</p>
<p>The WebVM cloud backend uses WebSockets and it's distributed via a global CDN to minimize download latency</p>
