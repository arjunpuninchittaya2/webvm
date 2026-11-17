<script>
	import { onDestroy, onMount, tick } from 'svelte';
	import SideBar from '$lib/SideBar.svelte';
	import TerminalTabBar from '$lib/components/TerminalTabBar.svelte';
	import TerminalToolbar from '$lib/components/TerminalToolbar.svelte';
	import TerminalSearchBar from '$lib/components/TerminalSearchBar.svelte';
	import VirtualKeyBar from '$lib/components/VirtualKeyBar.svelte';
	import StatusBar from '$lib/components/StatusBar.svelte';
	import SettingsModal from '$lib/components/SettingsModal.svelte';
	import ToastContainer from '$lib/components/ToastContainer.svelte';
	import BootProgressOverlay from '$lib/components/BootProgressOverlay.svelte';
	import '$lib/global.css';
	import '@xterm/xterm/css/xterm.css';
	import '@fortawesome/fontawesome-free/css/all.min.css';
	import { networkInterface, networkData, startLogin } from '$lib/network.js';
	import { handleToolImpl } from '$lib/anthropic.js';
	import { settings } from '$lib/stores/settings.js';
	import {
		MAX_SESSIONS,
		sessions,
		activeSessionId,
		activeVt,
		vtAvailable,
		displayPaused,
		activeRenderer,
		pageHidden,
		tailscaleIp,
		addToast
	} from '$lib/stores/sessions.js';
	import { createVmManager } from '$lib/vm/vmManager.js';

	export let configObj = null;
	export let processCallback = null;
	export let cacheId = null;

	const connectionState = networkData.connectionState;
	$: if ($connectionState === 'CONNECTED' && networkData.currentIp) {
		tailscaleIp.set(networkData.currentIp);
	}

	let consoleElement = null;
	let displayElement = null;
	let sideBarPinned = $settings.sidebarPin;
	let searchOpen = false;
	let settingsOpen = false;
	let searchMatchIndex = -1;
	let searchMatchCount = 0;

	const vmManager = createVmManager(configObj, {
		cacheId,
		networkInterface,
		processCallback
	});

	let unsubSearch = null;

	function preventDefaults(e) {
		e.preventDefault();
		e.stopPropagation();
	}

	onMount(async () => {
		unsubSearch = vmManager.onSearchResultsChange(({ resultIndex, resultCount }) => {
			searchMatchIndex = resultIndex;
			searchMatchCount = resultCount;
		});

		if (consoleElement) {
			consoleElement.addEventListener('dragover', preventDefaults, false);
			consoleElement.addEventListener('dragenter', preventDefaults, false);
			consoleElement.addEventListener('dragleave', preventDefaults, false);
			consoleElement.addEventListener('drop', preventDefaults, false);
		}

		await vmManager.boot({
			consoleElement,
			displayElement
		});
	});

	onDestroy(() => {
		if (consoleElement) {
			consoleElement.removeEventListener('dragover', preventDefaults, false);
			consoleElement.removeEventListener('dragenter', preventDefaults, false);
			consoleElement.removeEventListener('dragleave', preventDefaults, false);
			consoleElement.removeEventListener('drop', preventDefaults, false);
		}
		unsubSearch?.();
		vmManager.dispose();
	});

	async function handleConnect() {
		if (networkInterface.authKey) {
			networkData.connectionState.set('LOGINSTARTING');
			vmManager.networkLogin();
			return;
		}
		const w = window.open('login.html', '_blank');
		vmManager.networkLogin();
		try {
			const url = await startLogin();
			if (w) {
				w.location.href = url;
			} else {
				addToast({ message: 'Popup blocked — open Tailscale login from Networking tab', type: 'warning' });
			}
		} catch (e) {
			w?.close();
			console.warn(e);
		}
	}

	async function handleReset() {
		await vmManager.resetDisk();
	}

	async function handleTool(tool) {
		return await handleToolImpl(tool, vmManager.getActiveTerminal());
	}

	async function handleSidebarPinChange(event) {
		sideBarPinned = event.detail;
		await tick();
		vmManager.scheduleResize();
	}

	function toggleSearch() {
		searchOpen = !searchOpen;
		if (!searchOpen) {
			vmManager.clearSearch();
			vmManager.getActiveTerminal()?.focus();
		}
	}

	function handleSearch(event) {
		const { query, caseSensitive, regex, wholeWord, direction, incremental } = event.detail;
		vmManager.search(query, { caseSensitive, regex, wholeWord, direction, incremental });
	}

	function handleGlobalKeydown(e) {
		if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
			e.preventDefault();
			toggleSearch();
		} else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'c') {
			const term = vmManager.getActiveTerminal();
			if ($activeVt === 1 && term?.hasSelection?.()) {
				e.preventDefault();
				vmManager.copySelection();
			}
		} else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'v') {
			e.preventDefault();
			vmManager.pasteClipboard();
		}
	}
</script>

<svelte:window on:keydown={handleGlobalKeydown} />

<main
	class="relative w-full h-full flex flex-row overflow-hidden bg-black {$settings.powerSaver || $pageHidden
		? 'power-saver'
		: ''}"
>
	<SideBar
		bind:sideBarPinned
		on:connect={handleConnect}
		on:reset={handleReset}
		handleTool={handleTool}
		on:sidebarPinChange={handleSidebarPinChange}
	>
		<slot></slot>
	</SideBar>

	<div class="flex-1 min-w-0 flex flex-col h-full relative">
		<TerminalTabBar
			sessions={$sessions}
			activeSessionId={$activeSessionId}
			maxSessions={MAX_SESSIONS}
			on:select={(e) => vmManager.switchTab(e.detail)}
			on:create={() => vmManager.createShellTab()}
			on:close={(e) => vmManager.closeTab(e.detail)}
			on:rename={(e) => vmManager.renameTab(e.detail.id, e.detail.title)}
			on:restart={(e) => vmManager.restartTab(e.detail)}
		/>

		<TerminalToolbar
			vtAvailable={$vtAvailable}
			activeVt={$activeVt}
			displayPaused={$displayPaused}
			displayScale={$settings.displayScale}
			virtualKeysVisible={$settings.virtualKeysVisible}
			searchOpen={searchOpen}
			activeRenderer={$activeRenderer}
			on:copy={() => vmManager.copySelection()}
			on:paste={() => vmManager.pasteClipboard()}
			on:toggleSearch={toggleSearch}
			on:toggleVirtualKeys={() =>
				settings.updateSetting('virtualKeysVisible', !$settings.virtualKeysVisible)}
			on:toggleVt={() => vmManager.toggleVt()}
			on:toggleDisplayPause={() => vmManager.toggleDisplayPause()}
			on:changeDisplayScale={(e) => settings.updateSetting('displayScale', e.detail)}
			on:openSettings={() => {
				settingsOpen = true;
			}}
		/>

		<TerminalSearchBar
			open={searchOpen}
			matchIndex={searchMatchIndex}
			matchCount={searchMatchCount}
			on:search={handleSearch}
			on:close={() => {
				searchOpen = false;
				vmManager.clearSearch();
				vmManager.getActiveTerminal()?.focus();
			}}
		/>

		<div class="relative flex-1 min-h-0 w-full overflow-hidden">
			{#if configObj?.needsDisplay}
				<div
					data-testid="display-wrapper"
					class="absolute inset-0 transition-opacity duration-150 {$activeVt === 7
						? 'z-20 opacity-100 pointer-events-auto'
						: 'z-0 opacity-0 pointer-events-none'}"
				>
					<canvas bind:this={displayElement} class="w-full h-full cursor-none" id="display"></canvas>
				</div>
			{/if}

			<div
				bind:this={consoleElement}
				class="absolute inset-0 z-10 p-1 scrollbar"
				id="console"
			></div>
		</div>

		<VirtualKeyBar
			visible={$settings.virtualKeysVisible}
			activeVt={$activeVt}
			on:sendKey={(e) => vmManager.sendInputToActive(e.detail)}
			on:copy={() => vmManager.copySelection()}
			on:paste={() => vmManager.pasteClipboard()}
		/>

		<StatusBar />
	</div>

	<BootProgressOverlay />
	<ToastContainer />
	<SettingsModal
		open={settingsOpen}
		on:close={() => {
			settingsOpen = false;
		}}
	/>
</main>

<style>
	:global(.power-saver .animate-pulse),
	:global(.power-saver .animate-spin),
	:global(.power-saver .animate-bounce) {
		animation: none !important;
	}
</style>
