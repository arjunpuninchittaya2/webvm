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

<div class="flex flex-col gap-3 text-xs text-zinc-200">
	<h1 class="text-sm font-semibold text-zinc-100 pr-8">Networking</h1>

	<div
		class="flex items-center justify-between text-xs px-3 py-2 rounded-xl border border-white/10 bg-zinc-900/60"
		data-testid="network-connection-status"
	>
		<span class="text-zinc-400">Status:</span>
		<span
			class="font-medium {$connectionState === 'CONNECTED'
				? 'text-emerald-400'
				: $connectionState === 'LOGINFAILED'
					? 'text-rose-400'
					: $connectionState === 'DISCONNECTED'
						? 'text-zinc-300'
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
					class="fas fa-circle text-[8px] ml-auto {$exitNode ? 'text-emerald-400' : 'text-amber-400'}"
					title={$exitNode ? 'Exit node ready' : 'No exit node'}
					aria-hidden="true"
				></i>
			{/if}
		</PanelButton>

		<button
			type="button"
			data-testid="network-disconnect-btn"
			disabled={$connectionState === 'DISCONNECTED'}
			on:click={handleDisconnect}
			class="w-full h-8 px-3 rounded-lg border text-xs font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20
				{$connectionState === 'DISCONNECTED'
				? 'border-white/10 bg-zinc-900/40 text-zinc-500 cursor-not-allowed opacity-60'
				: 'border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 active:scale-[0.97]'}"
		>
			<i class="fas fa-plug text-[11px] mr-1.5" aria-hidden="true"></i>
			Disconnect
		</button>
	</div>

	{#if $popupBlocked}
		<div
			role="alert"
			data-testid="network-popup-fallback"
			class="rounded-xl border border-amber-500/20 bg-amber-500/10 p-2.5 text-xs text-amber-300 flex flex-col gap-1"
		>
			<span>Popup blocked by browser. Open the login page manually:</span>
			<a
				href={$loginUrlStore || 'login.html'}
				target="_blank"
				rel="noopener noreferrer"
				data-testid="network-popup-fallback-link"
				class="underline font-medium text-amber-200 hover:text-white break-all"
			>
				Open Tailscale Login
			</a>
		</div>
	{/if}

	<form
		on:submit|preventDefault={() => handleSaveConfig(false)}
		class="flex flex-col gap-2.5 p-3 rounded-xl border border-white/10 bg-zinc-900/60"
	>
		<div class="text-xs font-semibold text-zinc-200">Tailscale / Headscale Config</div>
		<label class="flex flex-col gap-1.5 text-xs">
			<span class="text-zinc-300">Control URL (Headscale, optional)</span>
			<input
				type="text"
				data-testid="network-control-url-input"
				bind:value={controlUrlInput}
				on:input={handleControlUrlInput}
				on:change={handleControlUrlInput}
				placeholder="https://headscale.example.com"
				class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-white/20 focus:outline-none"
			/>
		</label>
		<label class="flex flex-col gap-1.5 text-xs">
			<span class="text-zinc-300">Auth Key (optional)</span>
			<input
				type="password"
				data-testid="network-auth-key-input"
				bind:value={authKeyInput}
				placeholder="tskey-auth-..."
				class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-white/20 focus:outline-none"
			/>
		</label>

		{#if configError}
			<div role="alert" data-testid="network-config-error" class="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
				{configError}
			</div>
		{/if}
		{#if configStatus}
			<div role="status" data-testid="network-config-status" class="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300 break-all">
				{configStatus}
			</div>
		{/if}

		<div class="flex gap-2">
			<button
				type="submit"
				data-testid="network-config-save-btn"
				class="flex-1 h-8 px-3 rounded-lg border border-white/10 bg-transparent hover:bg-white/5 text-zinc-200 text-xs font-medium transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
			>
				Save Config
			</button>
			<button
				type="button"
				data-testid="network-config-connect-btn"
				on:click={() => handleSaveConfig(true)}
				class="flex-1 h-8 px-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs text-xs font-medium transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
			>
				Apply &amp; Connect
			</button>
		</div>
	</form>

	<div class="p-3 rounded-xl border border-white/10 bg-zinc-900/60 flex flex-col gap-2 text-xs" data-testid="network-peers-section">
		<div class="flex items-center justify-between font-semibold text-zinc-200">
			<span>Peers &amp; Exit Node</span>
			<span class="text-[11px] font-normal {$exitNode ? 'text-emerald-400' : 'text-zinc-400'}" data-testid="network-exit-node-status">
				{$exitNode ? 'Exit Node Ready' : 'No Exit Node'}
			</span>
		</div>
		{#if $peers.length === 0}
			<p class="text-[11px] leading-relaxed text-zinc-400">No Tailscale peers discovered yet.</p>
		{:else}
			<ul class="flex flex-col gap-1 max-h-24 overflow-y-auto scrollbar" data-testid="network-peers-list">
				{#each $peers as peer (peer.id)}
					<li class="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-zinc-950/60 px-2.5 py-1.5">
						<span class="truncate text-zinc-200">{peer.name}</span>
						<span class="text-[10px] font-mono text-zinc-400 shrink-0">
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

	<div class="p-3 rounded-xl border border-white/10 bg-zinc-900/60 flex flex-col gap-2 text-xs">
		<div class="flex items-center justify-between font-semibold text-zinc-200">
			<span>Service Preview Link Builder</span>
			{#if $currentIp}
				<button
					type="button"
					on:click={useTailscaleIp}
					class="text-[11px] font-normal text-zinc-300 hover:text-white underline"
				>
					Use Tailscale IP
				</button>
			{/if}
		</div>
		<div class="grid grid-cols-3 gap-1.5">
			<select
				aria-label="Service protocol"
				bind:value={serviceProtocol}
				class="rounded-xl border border-white/10 bg-zinc-950/60 px-2.5 py-1.5 text-xs font-mono text-zinc-200 transition-colors focus:border-white/20 focus:outline-none"
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
				class="rounded-xl border border-white/10 bg-zinc-950/60 px-2.5 py-1.5 text-xs font-mono text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-white/20 focus:outline-none"
			/>
			<input
				type="text"
				aria-label="Service port"
				data-testid="service-port-input"
				bind:value={servicePort}
				on:input={handleServicePortInput}
				on:change={handleServicePortInput}
				placeholder="8080"
				class="rounded-xl border border-white/10 bg-zinc-950/60 px-2.5 py-1.5 text-xs font-mono text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-white/20 focus:outline-none"
			/>
		</div>
		<div class="flex gap-1.5">
			<input
				type="text"
				aria-label="Service path"
				bind:value={servicePath}
				placeholder="/"
				class="flex-1 min-w-0 rounded-xl border border-white/10 bg-zinc-950/60 px-2.5 py-1.5 text-xs font-mono text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-white/20 focus:outline-none"
			/>
			<button
				type="button"
				data-testid="service-preview-build-btn"
				on:click={handleBuildServiceLink}
				class="h-8 px-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs text-xs font-medium shrink-0 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
			>
				Build Link
			</button>
		</div>
		{#if serviceLinkError}
			<div role="alert" data-testid="service-preview-error" class="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
				{serviceLinkError}
			</div>
		{/if}
		{#if builtServiceUrl}
			<div class="flex items-center justify-between rounded-xl border border-white/10 bg-zinc-950/60 px-2.5 py-1.5">
				<a
					href={builtServiceUrl}
					target="_blank"
					rel="noopener noreferrer"
					data-testid="service-preview-link"
					class="font-mono text-[11px] text-zinc-200 hover:text-white underline break-all"
				>
					{builtServiceUrl}
				</a>
			</div>
		{/if}
	</div>

	<div class="p-3 rounded-xl border border-white/10 bg-zinc-900/60 flex flex-col gap-1.5 text-xs" data-testid="network-diagnostics">
		<div class="font-semibold text-zinc-200 mb-0.5">Network Diagnostics</div>
		<div class="flex justify-between gap-2">
			<span class="text-[11px] text-zinc-400">Cross-Origin Isolated:</span>
			<span data-testid="diag-coi" class="font-mono text-[10px] {diagnostics.crossOriginIsolated ? 'text-emerald-400' : 'text-amber-400'}">
				{diagnostics.crossOriginIsolated ? 'Enabled' : 'Disabled'}
			</span>
		</div>
		<div class="flex justify-between gap-2">
			<span class="text-[11px] text-zinc-400">Browser Online:</span>
			<span data-testid="diag-online" class="font-mono text-[10px] {diagnostics.online ? 'text-emerald-400' : 'text-rose-400'}">
				{diagnostics.online ? 'Online' : 'Offline'}
			</span>
		</div>
		<div class="flex justify-between gap-2">
			<span class="text-[11px] text-zinc-400 shrink-0">DirectSocketsNetwork:</span>
			<span data-testid="diag-direct-sockets" class="font-mono text-[10px] {diagnostics.directSockets.available ? 'text-emerald-400 text-right' : 'text-amber-400 text-right'}">
				{diagnostics.directSockets.label}
			</span>
		</div>
		<div class="flex justify-between gap-2">
			<span class="text-[11px] text-zinc-400">Host Fetch Bridge:</span>
			<span data-testid="diag-host-fetch" class="font-mono text-[10px] {diagnostics.hostFetchBridge.available ? 'text-emerald-400' : 'text-rose-400'}">
				{diagnostics.hostFetchBridge.label}
			</span>
		</div>
	</div>
</div>
