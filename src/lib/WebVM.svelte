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
	import { networkInterface, networkData, startLogin, setPopupBlocked } from '$lib/network.js';
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
		stickyModifiers,
		addToast
	} from '$lib/stores/sessions.js';
	import { createVmManager } from '$lib/vm/vmManager.js';
	import { resolveBootConfig, loadProfile } from '$lib/vm/bootProfile.js';
	import { createSupervisor } from '$lib/vm/serviceSupervisor.js';
	import { notifyDesktop } from '$lib/audio/bell.js';
	import {
		ensureWorkspaceHydrated,
		importHostFiles,
		resetWorkspace as resetWorkspaceBridge
	} from '$lib/fs/fileBridge.js';

	export let configObj = null;
	export let processCallback = null;
	export let cacheId = null;

	const connectionState = networkData.connectionState;
	$: if ($connectionState === 'CONNECTED' && networkData.currentIp) {
		tailscaleIp.set(networkData.currentIp);
	} else if ($connectionState === 'DISCONNECTED') {
		tailscaleIp.set(null);
	}

	let consoleElement = null;
	let displayElement = null;
	let displayWrapperEl = null;
	let sideBarPinned = $settings.sidebarPin;
	let searchOpen = false;
	let settingsOpen = false;
	let isFullscreen = false;
	let searchMatchIndex = -1;
	let searchMatchCount = 0;

	let isDraggingOver = false;
	let dragDepth = 0;

	// Apply the saved boot profile (distro / custom .ext2 / uid / gid / env / cmd) onto the route config.
	const resolvedBoot = resolveBootConfig(configObj, loadProfile(), cacheId);
	configObj = resolvedBoot.config;
	cacheId = resolvedBoot.cacheId;

	const vmManager = createVmManager(configObj, {
		cacheId,
		networkInterface,
		processCallback,
		onWorkspaceReset: () => resetWorkspaceBridge({ skipVmReset: true })
	});

	const supervisor = createSupervisor({
		vm: vmManager,
		storage: typeof localStorage !== 'undefined' ? localStorage : null,
		notify: (message, type) => {
			addToast({ message, type });
			notifyDesktop('WebVM', message);
		}
	});

	let unsubSearch = null;

	function handleDragEnter(e) {
		e.preventDefault();
		e.stopPropagation();
		dragDepth += 1;
		isDraggingOver = true;
	}

	function handleDragOver(e) {
		e.preventDefault();
		e.stopPropagation();
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = 'copy';
		}
		isDraggingOver = true;
	}

	function handleDragLeave(e) {
		e.preventDefault();
		e.stopPropagation();
		dragDepth = Math.max(0, dragDepth - 1);
		if (dragDepth === 0) {
			isDraggingOver = false;
		}
	}

	async function handleDrop(e) {
		e.preventDefault();
		e.stopPropagation();
		dragDepth = 0;
		isDraggingOver = false;

		let files = Array.from(e.dataTransfer?.files || []);
		if (files.length === 0 && e.dataTransfer?.items) {
			for (const item of Array.from(e.dataTransfer.items)) {
				if (item.kind === 'file') {
					const f = item.getAsFile?.();
					if (f) files.push(f);
				}
			}
		}
		if (files.length === 0) return;

		const res = await importHostFiles(files, '', { vmManager });
		if (res.errors.length > 0) {
			addToast({ message: res.errors[0], type: 'error' });
		}
		if (res.imported.length > 0) {
			const msg =
				res.extractedArchives.length > 0
					? `Extracted ${res.extractedArchives.join(', ')} into /home/user/workspace`
					: `Imported ${res.imported.length} file(s) to /home/user/workspace`;
			addToast({ message: msg, type: 'success' });
		}
	}

	onMount(async () => {
		ensureWorkspaceHydrated();
		supervisor.startTimer();
		unsubSearch = vmManager.onSearchResultsChange(({ resultIndex, resultCount }) => {
			searchMatchIndex = resultIndex;
			searchMatchCount = resultCount;
		});

		if (consoleElement) {
			consoleElement.addEventListener('dragover', handleDragOver, false);
			consoleElement.addEventListener('dragenter', handleDragEnter, false);
			consoleElement.addEventListener('dragleave', handleDragLeave, false);
			consoleElement.addEventListener('drop', handleDrop, false);
		}

		await vmManager.boot({
			consoleElement,
			displayElement
		});
	});

	onDestroy(() => {
		if (consoleElement) {
			consoleElement.removeEventListener('dragover', handleDragOver, false);
			consoleElement.removeEventListener('dragenter', handleDragEnter, false);
			consoleElement.removeEventListener('dragleave', handleDragLeave, false);
			consoleElement.removeEventListener('drop', handleDrop, false);
		}
		unsubSearch?.();
		supervisor.dispose();
		vmManager.dispose();
	});

	let isConnectingNetwork = false;
	async function handleConnect() {
		if (isConnectingNetwork || $connectionState === 'LOGINSTARTING' || $connectionState === 'CONNECTED') {
			return;
		}
		isConnectingNetwork = true;
		setPopupBlocked(false);
		try {
			if (networkInterface.authKey) {
				networkData.connectionState.set('LOGINSTARTING');
				vmManager.networkLogin();
				return;
			}
			const w = window.open('login.html', '_blank');
			if (!w) {
				setPopupBlocked(true);
				addToast({ message: 'Popup blocked — open Tailscale login from Networking tab', type: 'warning' });
			}
			vmManager.networkLogin();
			try {
				const url = await startLogin();
				if (w) {
					w.location.href = url;
					setPopupBlocked(false);
				} else {
					setPopupBlocked(true);
				}
			} catch (e) {
				w?.close?.();
				console.warn(e);
			}
		} finally {
			isConnectingNetwork = false;
		}
	}

	async function handleReset() {
		await vmManager.resetDisk();
	}

	async function handleResetWorkspace() {
		await resetWorkspaceBridge({ vmManager });
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
	function handleFullscreenChange() {
		isFullscreen = typeof document !== 'undefined' && Boolean(document.fullscreenElement);
		vmManager.scheduleResize();
		vmManager.applyDisplayScale(true);
		if (isFullscreen && $activeVt === 7) {
			vmManager.focusDisplay();
		}
	}

	async function toggleDisplayFullscreen() {
		if (typeof document === 'undefined') return;
		try {
			if (document.fullscreenElement) {
				await document.exitFullscreen();
				return;
			}
			const target = ($activeVt === 7 && displayWrapperEl) || displayWrapperEl || consoleElement;
			if (target?.requestFullscreen) {
				await target.requestFullscreen();
			}
		} catch {
			addToast({ message: 'Fullscreen mode blocked by browser', type: 'warning' });
		}
	}
</script>

<svelte:window on:keydown={handleGlobalKeydown} />
<svelte:document on:fullscreenchange={handleFullscreenChange} />

<main
	class="relative w-full h-full flex flex-row overflow-hidden bg-zinc-950 text-zinc-200 {$settings.powerSaver || $pageHidden
		? 'power-saver'
		: ''}"
>
	<SideBar
		bind:sideBarPinned
		{vmManager}
		{supervisor}
		on:connect={handleConnect}
		on:reset={handleReset}
		on:resetWorkspace={handleResetWorkspace}
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
			isFullscreen={isFullscreen}
			on:copy={() => vmManager.copySelection()}
			on:paste={() => vmManager.pasteClipboard()}
			on:toggleSearch={toggleSearch}
			on:toggleVirtualKeys={() =>
				settings.updateSetting('virtualKeysVisible', !$settings.virtualKeysVisible)}
			on:toggleVt={() => vmManager.toggleVt()}
			on:toggleDisplayPause={() => vmManager.toggleDisplayPause()}
			on:changeDisplayScale={(e) => settings.updateSetting('displayScale', e.detail)}
			on:toggleFullscreen={toggleDisplayFullscreen}
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
					bind:this={displayWrapperEl}
					data-testid="display-wrapper"
					class="absolute inset-0 bg-black transition-opacity duration-150 {$activeVt === 7
						? 'z-20 opacity-100 pointer-events-auto'
						: 'z-0 opacity-0 pointer-events-none'}"
				>
					<canvas
						bind:this={displayElement}
						class="w-full h-full cursor-none"
						id="display"
						on:click={() => vmManager.focusDisplay()}
					></canvas>
					{#if $displayPaused}
						<div
							data-testid="display-paused-badge"
							class="pointer-events-none absolute top-3 right-3 px-2.5 py-1 rounded-lg border border-white/15 bg-zinc-900/90 backdrop-blur-md text-[11px] font-mono text-zinc-200 shadow-lg"
						>
							Display Paused
						</div>
					{/if}
				</div>
			{/if}

			<div
				bind:this={consoleElement}
				class="absolute inset-0 z-10 p-1 scrollbar bg-zinc-950"
				id="console"
			></div>

			{#if isDraggingOver}
				<div
					data-testid="dropzone-overlay"
					class="pointer-events-none absolute inset-3 z-30 flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-dashed border-white/20 bg-zinc-950/90 backdrop-blur-md shadow-2xl text-zinc-200 animate-in fade-in-0 duration-150"
				>
					<i class="fas fa-upload text-2xl text-zinc-300 mb-1" aria-hidden="true"></i>
					<p class="text-sm font-semibold text-zinc-100">Drop files, scripts, archives, or i386 binaries</p>
					<p class="text-[11px] leading-relaxed text-zinc-400">
						Imports into <span class="font-mono text-zinc-300">/home/user/workspace</span>
					</p>
				</div>
			{/if}

			<BootProgressOverlay />
		</div>

		<VirtualKeyBar
			visible={$settings.virtualKeysVisible}
			activeVt={$activeVt}
			stickyCtrl={$stickyModifiers.ctrl}
			ctrlLocked={$stickyModifiers.ctrlLocked}
			stickyAlt={$stickyModifiers.alt}
			altLocked={$stickyModifiers.altLocked}
			on:modifierChange={(e) => vmManager.setStickyModifiers(e.detail)}
			on:sendKey={(e) => vmManager.sendInputToActive(e.detail)}
			on:copy={() => vmManager.copySelection()}
			on:paste={() => vmManager.pasteClipboard()}
		/>

		<StatusBar />
	</div>

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
