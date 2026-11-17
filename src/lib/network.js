import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export const NETWORK_STORAGE_KEY = 'webvm.network.v1';

let authKey = undefined;
let controlUrl = undefined;

function loadPersistedControlUrl() {
	if (!browser || typeof localStorage === 'undefined') return undefined;
	try {
		const raw = localStorage.getItem(NETWORK_STORAGE_KEY);
		if (!raw) return undefined;
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed.controlUrl === 'string' && parsed.controlUrl.trim()) {
			const check = validateControlUrl(parsed.controlUrl);
			return check.valid ? check.value : undefined;
		}
	} catch {
		// ignore storage parse/access errors
	}
	return undefined;
}

function savePersistedControlUrl(val) {
	if (!browser || typeof localStorage === 'undefined') return;
	try {
		if (val) {
			localStorage.setItem(NETWORK_STORAGE_KEY, JSON.stringify({ controlUrl: val }));
		} else {
			localStorage.removeItem(NETWORK_STORAGE_KEY);
		}
	} catch {
		// ignore storage quota/access errors
	}
}

/**
 * Validate Headscale/Tailscale controlUrl.
 * Empty string is valid (resets to default Tailscale coordination server).
 * Non-empty values must be valid http: or https: URLs.
 * @param {string} rawUrl
 * @returns {{ valid: true, value: string|undefined } | { valid: false, error: string }}
 */
export function validateControlUrl(rawUrl) {
	if (rawUrl === undefined || rawUrl === null) {
		return { valid: true, value: undefined };
	}
	const trimmed = String(rawUrl).trim();
	if (!trimmed) {
		return { valid: true, value: undefined };
	}
	let parsed;
	try {
		parsed = new URL(trimmed);
	} catch {
		return { valid: false, error: 'Control URL must be a valid http:// or https:// URL' };
	}
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		return {
			valid: false,
			error: `Invalid Control URL: must use http:// or https:// (got "${parsed.protocol}")`
		};
	}
	const value =
		!trimmed.endsWith('/') && parsed.pathname === '/' && !parsed.search && !parsed.hash
			? parsed.origin
			: parsed.href;
	return { valid: true, value };
}

if (browser) {
	controlUrl = loadPersistedControlUrl();
	const params = new URLSearchParams('?' + window.location.hash.substr(1));
	const hashAuth = params.get('authKey');
	const hashControl = params.get('controlUrl');
	if (hashAuth) authKey = hashAuth;
	if (hashControl) {
		const check = validateControlUrl(hashControl);
		if (check.valid) controlUrl = check.value;
	}
}

let dashboardUrl = controlUrl ? null : 'https://login.tailscale.com/admin/machines';
let resolveLogin = null;
let rejectLogin = null;
let loginPromise = null;

export const connectionState = writable('DISCONNECTED');
export const exitNode = writable(false);
export const peers = writable([]);
export const currentIp = writable(null);
export const loginUrl = writable(null);
export const popupBlocked = writable(false);
export const networkConfig = writable({
	controlUrl: controlUrl || '',
	authKey: authKey || ''
});

function resetLoginPromise() {
	loginPromise = new Promise((f, r) => {
		resolveLogin = f;
		rejectLogin = r;
	});
}

function validateLoginUrl(url) {
	const parsedUrl = new URL(url);
	if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
		throw new Error('Invalid Tailscale login URL scheme');
	}
	return parsedUrl.href;
}

function loginUrlCb(url) {
	try {
		url = validateLoginUrl(url);
	} catch (e) {
		connectionState.set('LOGINFAILED');
		rejectLogin(e);
		resetLoginPromise();
		return;
	}
	networkData.loginUrl = url;
	loginUrl.set(url);
	connectionState.set('LOGINREADY');
	resolveLogin(url);
}

function stateUpdateCb(state) {
	switch (state) {
		case 6 /*Running*/: {
			connectionState.set('CONNECTED');
			break;
		}
		case 0 /*NoState*/:
		case 1 /*InUseOtherUser*/:
		case 2 /*NeedsLogin*/: {
			break;
		}
		case 4 /*Stopped*/: {
			connectionState.set('DISCONNECTED');
			break;
		}
	}
}

function netmapUpdateCb(map) {
	const ip = map?.self?.addresses?.[0] || null;
	networkData.currentIp = ip;
	currentIp.set(ip);

	const rawPeers = Array.isArray(map?.peers) ? map.peers : [];
	let exitNodeFound = false;
	const normalizedPeers = rawPeers.map((p, idx) => {
		if (p?.exitNode) exitNodeFound = true;
		return {
			id: p?.id || `peer-${idx}`,
			name: p?.name || p?.hostName || p?.addresses?.[0] || `Peer ${idx + 1}`,
			addresses: Array.isArray(p?.addresses) ? p.addresses : [],
			exitNode: Boolean(p?.exitNode),
			online: p?.online !== false
		};
	});
	peers.set(normalizedPeers);
	exitNode.set(exitNodeFound);
}

export async function startLogin() {
	connectionState.set('LOGINSTARTING');
	const url = await loginPromise;
	networkData.loginUrl = url;
	loginUrl.set(url);
	return url;
}

export function setPopupBlocked(blocked) {
	popupBlocked.set(Boolean(blocked));
}

/**
 * Configure Headscale/Tailscale controlUrl and authKey in-place on networkInterface
 * (which is passed to CheerpX.Linux.create) and persist controlUrl in localStorage.
 * @param {object} params
 * @param {string} [params.controlUrl]
 * @param {string} [params.authKey]
 * @param {boolean} [params.persist=true]
 * @returns {{ ok: true, controlUrl: string|undefined, authKey: string|undefined } | { ok: false, error: string }}
 */
export function configureNetwork({ controlUrl: nextControl, authKey: nextAuth, persist = true } = {}) {
	const check = validateControlUrl(nextControl);
	if (!check.valid) {
		return { ok: false, error: check.error };
	}

	const cleanAuth = typeof nextAuth === 'string' && nextAuth.trim() ? nextAuth.trim() : undefined;
	networkInterface.controlUrl = check.value;
	networkInterface.authKey = cleanAuth;

	const nextDashboard = check.value ? null : 'https://login.tailscale.com/admin/machines';
	networkData.dashboardUrl = nextDashboard;

	networkConfig.set({
		controlUrl: check.value || '',
		authKey: cleanAuth || ''
	});

	if (persist) {
		savePersistedControlUrl(check.value);
	}

	return { ok: true, controlUrl: check.value, authKey: cleanAuth };
}

/**
 * Safely disconnect/reset Tailscale/Headscale session state.
 * Idempotent when already disconnected.
 */
export function disconnectNetwork() {
	connectionState.set('DISCONNECTED');
	exitNode.set(false);
	peers.set([]);
	networkData.currentIp = null;
	currentIp.set(null);
	networkData.loginUrl = null;
	loginUrl.set(null);
	popupBlocked.set(false);
	resetLoginPromise();
}

/**
 * Inspect browser and CheerpX network capabilities for diagnostics.
 */
export function getNetworkDiagnostics() {
	const isCrossOriginIsolated =
		typeof window !== 'undefined' && window.crossOriginIsolated === true;
	const isOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
	const hasIwaSockets =
		typeof globalThis.TCPSocket === 'function' || typeof globalThis.UDPSocket === 'function';

	return {
		crossOriginIsolated: isCrossOriginIsolated,
		online: isOnline,
		directSockets: {
			available: hasIwaSockets,
			label: hasIwaSockets
				? 'Available (IWA Direct Sockets)'
				: 'Unavailable (CheerpX 1.4.0 / non-IWA)',
			detail: hasIwaSockets
				? 'Chrome Isolated Web App TCP/UDP socket APIs detected.'
				: 'DirectSocketsNetwork is not exported in CheerpX 1.4.0 and requires a Chrome Isolated Web App.'
		},
		hostFetchBridge: {
			available: isOnline && typeof globalThis.fetch === 'function',
			label: isOnline ? 'Available' : 'Offline'
		}
	};
}

async function handleCopyIP(event) {
	event.preventDefault();
	try {
		await window.navigator.clipboard.writeText(networkData.currentIp);
		connectionState.set('IPCOPIED');
		setTimeout(() => {
			connectionState.set('CONNECTED');
		}, 2000);
	} catch (msg) {
		console.log('Copy ip to clipboard: Error: ' + msg);
	}
}

export function updateButtonData(state, handleConnect) {
	switch (state) {
		case 'DISCONNECTED':
			return {
				buttonText: 'Connect to Tailscale',
				isClickable: true,
				clickHandler: handleConnect,
				clickUrl: null,
				buttonTooltip: null,
				rightClickHandler: null
			};
		case 'DOWNLOADING':
			return {
				buttonText: 'Loading IP stack...',
				isClickable: false,
				clickHandler: null,
				clickUrl: null,
				buttonTooltip: null,
				rightClickHandler: null
			};
		case 'LOGINSTARTING':
			return {
				buttonText: 'Starting Login...',
				isClickable: false,
				clickHandler: null,
				clickUrl: null,
				buttonTooltip: null,
				rightClickHandler: null
			};
		case 'LOGINREADY':
			return {
				buttonText: 'Login to Tailscale',
				isClickable: true,
				clickHandler: null,
				clickUrl: networkData.loginUrl,
				buttonTooltip: null,
				rightClickHandler: null
			};
		case 'LOGINFAILED':
			return {
				buttonText: 'Invalid login URL',
				isClickable: false,
				clickHandler: null,
				clickUrl: null,
				buttonTooltip: null,
				rightClickHandler: null
			};
		case 'CONNECTED':
			return {
				buttonText: `IP: ${networkData.currentIp}`,
				isClickable: true,
				clickHandler: null,
				clickUrl: networkData.dashboardUrl,
				buttonTooltip: 'Right-click to copy',
				rightClickHandler: handleCopyIP
			};
		case 'IPCOPIED':
			return {
				buttonText: 'Copied!',
				isClickable: false,
				clickHandler: null,
				clickUrl: null,
				buttonTooltip: null,
				rightClickHandler: null
			};
		default:
			return {
				buttonText: `Text for state: ${state}`,
				isClickable: false,
				clickHandler: null,
				clickUrl: null,
				buttonTooltip: null,
				rightClickHandler: null
			};
	}
}

export const networkInterface = {
	authKey,
	controlUrl,
	loginUrlCb,
	stateUpdateCb,
	netmapUpdateCb
};

export const networkData = {
	currentIp: null,
	connectionState,
	exitNode,
	peers,
	loginUrl: null,
	loginUrlStore: loginUrl,
	popupBlocked,
	dashboardUrl
};

resetLoginPromise();
