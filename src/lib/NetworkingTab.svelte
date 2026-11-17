<script>
	import { createEventDispatcher, onMount } from 'svelte';
	import {
		networkData,
		networkConfig,
		validateControlUrl,
		configureNetwork,
		disconnectNetwork,
		getNetworkDiagnostics,
		updateButtonData,
		currentIp
	} from '$lib/network.js';
	import { buildServicePreviewUrl, validateServicePort } from '$lib/apps/webPreview.js';
	import PanelButton from './PanelButton.svelte';

	const dispatch = createEventDispatcher();
	const connectionState = networkData.connectionState;
	const exitNode = networkData.exitNode;
	const peers = networkData.peers;
	const loginUrlStore = networkData.loginUrlStore;
	const popupBlocked = networkData.popupBlocked;

	let controlUrlInput = $networkConfig.controlUrl || '';
	let authKeyInput = $networkConfig.authKey || '';
	let configError = '';
	let configStatus = '';

	// Service preview link builder state
	let serviceProtocol = 'http';
	let serviceHost = '127.0.0.1';
	let servicePort = '8080';
	let servicePath = '/';
	let serviceLinkError = '';
	let builtServiceUrl = '';

	// Diagnostics state (reactive to online/offline events)
	let diagnostics = getNetworkDiagnostics();

	function refreshDiagnostics() {
		diagnostics = getNetworkDiagnostics();
	}

	onMount(() => {
		refreshDiagnostics();
		if (typeof window !== 'undefined') {
			window.addEventListener('online', refreshDiagnostics);
			window.addEventListener('offline', refreshDiagnostics);
			return () => {
				window.removeEventListener('online', refreshDiagnostics);
				window.removeEventListener('offline', refreshDiagnostics);
			};
		}
	});

	function handleControlUrlInput() {
		configStatus = '';
		const check = validateControlUrl(controlUrlInput);
		configError = check.valid ? '' : check.error;
	}

	function handleServicePortInput() {
		const check = validateServicePort(servicePort);
		if (!check.valid) {
			serviceLinkError = check.error;
			builtServiceUrl = '';
		} else {
			serviceLinkError = '';
		}
	}

	function handleConnect() {
		if ($connectionState === 'DOWNLOADING' || $connectionState === 'LOGINSTARTING' || $connectionState === 'CONNECTED') {
			return;
		}
		const check = validateControlUrl(controlUrlInput);
		if (!check.valid) {
			configError = check.error;
			configStatus = '';
			return;
		}
		configError = '';
		connectionState.set('DOWNLOADING');
		dispatch('connect');
	}

	function handleDisconnect() {
		disconnectNetwork();
		configStatus = 'Disconnected from Tailscale network';
		configError = '';
	}

	function handleSaveConfig(andConnect = false) {
		configError = '';
		configStatus = '';
		const res = configureNetwork({
			controlUrl: controlUrlInput,
			authKey: authKeyInput,
			persist: true
		});
		if (!res.ok) {
			configError = res.error;
			return;
		}
		configStatus = res.controlUrl
			? `Configured Headscale control URL: ${res.controlUrl}`
			: 'Configured default Tailscale coordination server';
		if (andConnect && ($connectionState === 'DISCONNECTED' || $connectionState === 'LOGINFAILED')) {
			handleConnect();
		}
	}

	function handleBuildServiceLink() {
		serviceLinkError = '';
		const res = buildServicePreviewUrl({
			host: serviceHost,
			port: servicePort,
			protocol: serviceProtocol,
			path: servicePath
		});
		if (!res.ok) {
			serviceLinkError = res.error;
			builtServiceUrl = '';
			return;
		}
		builtServiceUrl = res.url;
	}

	function useTailscaleIp() {
		if ($currentIp) {
			serviceHost = $currentIp;
		}
	}

	$: {
		const res = buildServicePreviewUrl({
			host: serviceHost,
			port: servicePort,
			protocol: serviceProtocol,
			path: servicePath
		});
		if (res.ok) {
			serviceLinkError = '';
			builtServiceUrl = res.url;
		} else {
			serviceLinkError = res.error;
			builtServiceUrl = '';
		}
	}

	let buttonData = null;
	$: buttonData = updateButtonData($connectionState, handleConnect);
</script>

<div class="flex flex-col gap-3 text-sm">
	<h1 class="text-lg font-bold">Networking</h1>

	<div
		class="flex items-center justify-between text-xs px-2 py-1 rounded bg-neutral-700/70 border border-neutral-500/50"
		data-testid="network-connection-status"
	>
		<span class="text-gray-300">Status:</span>
		<span
			class="font-semibold {$connectionState === 'CONNECTED'
				? 'text-emerald-400'
				: $connectionState === 'LOGINFAILED'
					? 'text-red-400'
					: $connectionState === 'DISCONNECTED'
						? 'text-gray-300'
						: 'text-amber-300'}"
		>
			{$connectionState === 'CONNECTED'
				? $currentIp
					? `Connected (${$currentIp})`
					: 'Connected'
				: $connectionState === 'DISCONNECTED'
					? 'Disconnected'
					: $connectionState === 'DOWNLOADING'
						? 'Loading IP stack...'
						: $connectionState === 'LOGINSTARTING'
							? 'Connecting...'
							: $connectionState === 'LOGINREADY'
								? 'Login Ready'
								: $connectionState === 'LOGINFAILED'
									? 'Login Failed'
									: $connectionState}
		</span>
	</div>

	<div class="flex flex-col gap-2">
		<PanelButton
			buttonImage="assets/tailscale.svg"
			clickUrl={buttonData.clickUrl}
			clickHandler={buttonData.clickHandler}
			rightClickHandler={buttonData.rightClickHandler}
			buttonTooltip={buttonData.buttonTooltip}
			buttonText={buttonData.buttonText}
		>
			{#if $connectionState === 'CONNECTED'}
				<i
					class="fas fa-circle fa-xs ml-auto {$exitNode ? 'text-green-500' : 'text-amber-500'}"
					title={$exitNode ? 'Exit node ready' : 'No exit node'}
				></i>
			{/if}
		</PanelButton>

		<button
			type="button"
			data-testid="network-disconnect-btn"
			disabled={$connectionState === 'DISCONNECTED'}
			on:click={handleDisconnect}
			class="w-full py-1.5 px-3 rounded text-xs font-semibold border border-neutral-500 transition-colors
				{$connectionState === 'DISCONNECTED'
				? 'bg-neutral-700 text-gray-400 cursor-not-allowed opacity-60'
				: 'bg-red-700 hover:bg-red-600 text-white'}"
		>
			<i class="fas fa-plug mr-1" aria-hidden="true"></i>
			Disconnect
		</button>
	</div>

	{#if $popupBlocked}
		<div
			role="alert"
			data-testid="network-popup-fallback"
			class="p-2 rounded bg-amber-900/60 border border-amber-500/60 text-amber-100 text-xs flex flex-col gap-1"
		>
			<span>Popup blocked by browser. Open the login page manually:</span>
			<a
				href={$loginUrlStore || 'login.html'}
				target="_blank"
				rel="noopener noreferrer"
				data-testid="network-popup-fallback-link"
				class="underline font-semibold text-amber-200 hover:text-white break-all"
			>
				Open Tailscale Login
			</a>
		</div>
	{/if}

	<form
		on:submit|preventDefault={() => handleSaveConfig(false)}
		class="flex flex-col gap-2 p-2 rounded bg-neutral-700/70 border border-neutral-500/50"
	>
		<div class="font-semibold text-xs text-gray-200">Tailscale / Headscale Config</div>
		<label class="flex flex-col gap-1 text-xs">
			<span class="text-gray-300">Control URL (Headscale, optional)</span>
			<input
				type="text"
				data-testid="network-control-url-input"
				bind:value={controlUrlInput}
				on:input={handleControlUrlInput}
				on:change={handleControlUrlInput}
				placeholder="https://headscale.example.com"
				class="px-2 py-1 rounded bg-neutral-800 border border-neutral-500 text-gray-100 text-xs"
			/>
		</label>
		<label class="flex flex-col gap-1 text-xs">
			<span class="text-gray-300">Auth Key (optional)</span>
			<input
				type="password"
				data-testid="network-auth-key-input"
				bind:value={authKeyInput}
				placeholder="tskey-auth-..."
				class="px-2 py-1 rounded bg-neutral-800 border border-neutral-500 text-gray-100 text-xs"
			/>
		</label>

		{#if configError}
			<div role="alert" data-testid="network-config-error" class="text-xs text-red-300 bg-red-900/50 p-1.5 rounded">
				{configError}
			</div>
		{/if}
		{#if configStatus}
			<div role="status" data-testid="network-config-status" class="text-xs text-emerald-300 bg-emerald-900/40 p-1.5 rounded">
				{configStatus}
			</div>
		{/if}

		<div class="flex gap-2">
			<button
				type="submit"
				data-testid="network-config-save-btn"
				class="flex-1 py-1 px-2 rounded bg-neutral-500 hover:bg-neutral-400 text-white text-xs font-semibold"
			>
				Save Config
			</button>
			<button
				type="button"
				data-testid="network-config-connect-btn"
				on:click={() => handleSaveConfig(true)}
				class="flex-1 py-1 px-2 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
			>
				Apply &amp; Connect
			</button>
		</div>
	</form>

	<div class="p-2 rounded bg-neutral-700/70 border border-neutral-500/50 flex flex-col gap-1 text-xs" data-testid="network-peers-section">
		<div class="flex items-center justify-between font-semibold text-gray-200">
			<span>Peers &amp; Exit Node</span>
			<span class="text-[11px] {$exitNode ? 'text-emerald-400' : 'text-gray-400'}" data-testid="network-exit-node-status">
				{$exitNode ? 'Exit Node Ready' : 'No Exit Node'}
			</span>
		</div>
		{#if $peers.length === 0}
			<p class="text-gray-400 text-[11px]">No Tailscale peers discovered yet.</p>
		{:else}
			<ul class="flex flex-col gap-1 max-h-24 overflow-y-auto" data-testid="network-peers-list">
				{#each $peers as peer (peer.id)}
					<li class="flex items-center justify-between bg-neutral-800/80 px-2 py-1 rounded">
						<span class="truncate">{peer.name}</span>
						<span class="text-[10px] text-gray-300">
							{peer.addresses[0] || ''}
							{#if peer.exitNode}
								<span class="ml-1 text-emerald-400">(exit)</span>
							{/if}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<div class="p-2 rounded bg-neutral-700/70 border border-neutral-500/50 flex flex-col gap-2 text-xs">
		<div class="flex items-center justify-between font-semibold text-gray-200">
			<span>Service Preview Link Builder</span>
			{#if $currentIp}
				<button
					type="button"
					on:click={useTailscaleIp}
					class="text-[11px] text-sky-300 hover:underline"
				>
					Use Tailscale IP
				</button>
			{/if}
		</div>
		<div class="grid grid-cols-3 gap-1">
			<select
				aria-label="Service protocol"
				bind:value={serviceProtocol}
				class="px-1.5 py-1 rounded bg-neutral-800 border border-neutral-500 text-gray-100 text-xs"
			>
				<option value="http">http</option>
				<option value="https">https</option>
			</select>
			<input
				type="text"
				aria-label="Service host"
				data-testid="service-host-input"
				bind:value={serviceHost}
				placeholder="127.0.0.1"
				class="px-1.5 py-1 rounded bg-neutral-800 border border-neutral-500 text-gray-100 text-xs"
			/>
			<input
				type="text"
				aria-label="Service port"
				data-testid="service-port-input"
				bind:value={servicePort}
				on:input={handleServicePortInput}
				on:change={handleServicePortInput}
				placeholder="8080"
				class="px-1.5 py-1 rounded bg-neutral-800 border border-neutral-500 text-gray-100 text-xs"
			/>
		</div>
		<div class="flex gap-1">
			<input
				type="text"
				aria-label="Service path"
				bind:value={servicePath}
				placeholder="/"
				class="flex-1 px-2 py-1 rounded bg-neutral-800 border border-neutral-500 text-gray-100 text-xs"
			/>
			<button
				type="button"
				data-testid="service-preview-build-btn"
				on:click={handleBuildServiceLink}
				class="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold"
			>
				Build Link
			</button>
		</div>
		{#if serviceLinkError}
			<div role="alert" data-testid="service-preview-error" class="text-red-300 bg-red-900/50 p-1.5 rounded">
				{serviceLinkError}
			</div>
		{/if}
		{#if builtServiceUrl}
			<div class="flex items-center justify-between bg-neutral-800 px-2 py-1 rounded">
				<a
					href={builtServiceUrl}
					target="_blank"
					rel="noopener noreferrer"
					data-testid="service-preview-link"
					class="text-sky-300 underline truncate"
				>
					{builtServiceUrl}
				</a>
			</div>
		{/if}
	</div>

	<div class="p-2 rounded bg-neutral-700/70 border border-neutral-500/50 flex flex-col gap-1 text-xs" data-testid="network-diagnostics">
		<div class="font-semibold text-gray-200 mb-0.5">Network Diagnostics</div>
		<div class="flex justify-between">
			<span class="text-gray-300">Cross-Origin Isolated:</span>
			<span data-testid="diag-coi" class={diagnostics.crossOriginIsolated ? 'text-emerald-400' : 'text-amber-300'}>
				{diagnostics.crossOriginIsolated ? 'Enabled' : 'Disabled'}
			</span>
		</div>
		<div class="flex justify-between">
			<span class="text-gray-300">Browser Online:</span>
			<span data-testid="diag-online" class={diagnostics.online ? 'text-emerald-400' : 'text-red-400'}>
				{diagnostics.online ? 'Online' : 'Offline'}
			</span>
		</div>
		<div class="flex justify-between gap-2">
			<span class="text-gray-300 shrink-0">DirectSocketsNetwork:</span>
			<span data-testid="diag-direct-sockets" class={diagnostics.directSockets.available ? 'text-emerald-400 text-right' : 'text-amber-300 text-right'}>
				{diagnostics.directSockets.label}
			</span>
		</div>
		<div class="flex justify-between">
			<span class="text-gray-300">Host Fetch Bridge:</span>
			<span data-testid="diag-host-fetch" class={diagnostics.hostFetchBridge.available ? 'text-emerald-400' : 'text-red-400'}>
				{diagnostics.hostFetchBridge.label}
			</span>
		</div>
	</div>
</div>
