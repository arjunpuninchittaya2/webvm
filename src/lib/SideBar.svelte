<script>
	import { createEventDispatcher } from 'svelte';
	import Icon from './Icon.svelte';
	import InformationTab from './InformationTab.svelte';
	import NetworkingTab from './NetworkingTab.svelte';
	import CpuTab from './CpuTab.svelte';
	import DiskTab from './DiskTab.svelte';
	import PostsTab from './PostsTab.svelte';
	import DiscordTab from './DiscordTab.svelte';
	import GitHubTab from './GitHubTab.svelte';
	import SmallButton from './SmallButton.svelte';
	import { cpuActivity, diskActivity, aiActivity } from './activities.js';
	import { settings } from './stores/settings.js';

	const icons = [
		{ icon: 'fas fa-info-circle', info: 'Information', activity: null },
		{ icon: 'fas fa-wifi', info: 'Networking', activity: null },
		{ icon: 'fas fa-microchip', info: 'CPU', activity: cpuActivity },
		{ icon: 'fas fa-compact-disc', info: 'Disk', activity: diskActivity },
		{ icon: 'fas fa-robot', info: 'ClaudeAI', activity: aiActivity },
		null,
		{ icon: 'fas fa-book-open', info: 'Posts', activity: null },
		{ icon: 'fab fa-discord', info: 'Discord', activity: null },
		{ icon: 'fab fa-github', info: 'GitHub', activity: null },
	];
	let dispatch = createEventDispatcher();
	let activeInfo = $settings.sidebarPin ? 'Information' : null; // Tracks currently visible info.
	let hideTimeout = 0; // Timeout for hiding info panel.
	export let sideBarPinned = $settings.sidebarPin;
	let lastSyncedPin = $settings.sidebarPin;

	$: if ($settings.sidebarPin !== lastSyncedPin) {
		lastSyncedPin = $settings.sidebarPin;
		if (sideBarPinned !== $settings.sidebarPin) {
			sideBarPinned = $settings.sidebarPin;
			if (sideBarPinned && !activeInfo) {
				activeInfo = 'Information';
			} else if (!sideBarPinned) {
				activeInfo = null;
			}
			dispatch('sidebarPinChange', sideBarPinned);
		}
	}

	function showInfo(info) {
		if (sideBarPinned) return;
		clearTimeout(hideTimeout);
		hideTimeout = 0;
		activeInfo = info;
	}
	function hideInfo() {
		// Never remove the sidebar if pinning is enabled
		if (sideBarPinned)
			return;
		// Prevents multiple timers and hides the info panel after 400ms unless interrupted.
		clearTimeout(hideTimeout);
		hideTimeout = setTimeout(() => {
			activeInfo = null;
			hideTimeout = 0;
		}, 400);
	}
	function handleMouseEnterPanel() {
		clearTimeout(hideTimeout);
		hideTimeout = 0;
	}
	// Toggles the info panel for the clicked icon, or switches active tab when pinned.
	function handleClick(icon) {
		clearTimeout(hideTimeout);
		hideTimeout = 0;
		if (sideBarPinned) {
			activeInfo = icon.info;
			return;
		}
		if (activeInfo === icon.info) {
			activeInfo = null;
		} else {
			activeInfo = icon.info;
		}
	}

	function toggleSidebarPin() {
		sideBarPinned = !sideBarPinned;
		lastSyncedPin = sideBarPinned;
		settings.updateSetting('sidebarPin', sideBarPinned);
		if (sideBarPinned && !activeInfo) {
			activeInfo = 'Information';
		}
		dispatch('sidebarPinChange', sideBarPinned);
	}

	export let handleTool;
</script>

<div class="relative z-30 flex flex-row {sideBarPinned && activeInfo ? 'w-[23.5rem]' : 'w-14'} h-full bg-neutral-700 shrink-0">
	<div class="flex flex-col shrink-0 w-14 text-gray-300">
		{#each icons as i}
			{#if i}
				<Icon
					icon={i.icon}
					info={i.info}
					activity={i.activity}
					active={activeInfo === i.info}
					on:mouseover={(e) => showInfo(e.detail)}
					on:click={() => handleClick(i)}
				/>
			{:else}
				<div class="grow" role="presentation" on:mouseenter={handleMouseEnterPanel}></div>
			{/if}
		{/each}
	</div>
	<aside
		aria-label="Sidebar panel"
		class="relative flex flex-col gap-5 shrink-0 w-80 h-full z-30 p-2 bg-neutral-600 text-gray-100 opacity-95 overflow-y-auto scrollbar"
		class:hidden={!activeInfo}
		on:mouseenter={handleMouseEnterPanel}
		on:mouseleave={hideInfo}
	>
		<div class="absolute right-2 top-2">
			<SmallButton
				buttonIcon="fa-solid fa-thumbtack"
				clickHandler={toggleSidebarPin}
				buttonTooltip={sideBarPinned ? "Unpin Sidebar" : "Pin Sidebar"}
				bgColor={sideBarPinned ? "bg-neutral-500" : "bg-neutral-700"}
			/>
		</div>
		{#if activeInfo === 'Information'}
			<InformationTab>
				<slot></slot>
			</InformationTab>
		{:else if activeInfo === 'Networking'}
			<NetworkingTab on:connect/>
		{:else if activeInfo === 'CPU'}
			<CpuTab/>
		{:else if activeInfo === 'Disk'}
			<DiskTab on:reset/>
		{:else if activeInfo === 'ClaudeAI'}
			{#await import('./AnthropicTab.svelte') then { default: AnthropicTab }}
				<AnthropicTab handleTool={handleTool} />
			{/await}
		{:else if activeInfo === 'Posts'}
			<PostsTab/>
		{:else if activeInfo === 'Discord'}
			<DiscordTab/>
		{:else if activeInfo === 'GitHub'}
			<GitHubTab/>
		{:else}
			<p>TODO: {activeInfo}</p>
		{/if}

		<div class="mt-auto text-sm text-gray-300">
			<div class="pt-1 pb-1">
				<a href="https://cheerpx.io/" target="_blank" rel="noopener noreferrer">
					<span>Powered by CheerpX</span>
					<img src="assets/cheerpx.svg" alt="CheerpX Logo" class="w-6 h-6 inline-block">
				</a>
			</div>
			<hr class="border-t border-solid border-gray-300">
			<div class="pt-1 pb-1">
				<a href="https://leaningtech.com/" target="_blank" rel="noopener noreferrer">© 2022-2025 Leaning Technologies</a>
			</div>
		</div>
	</aside>
</div>
