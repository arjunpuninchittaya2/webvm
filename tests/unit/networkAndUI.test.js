import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tick } from 'svelte';
import { get } from 'svelte/store';
import {
	NETWORK_STORAGE_KEY,
	validateControlUrl,
	configureNetwork,
	disconnectNetwork,
	setPopupBlocked,
	getNetworkDiagnostics,
	networkInterface,
	networkData
} from '../../src/lib/network.js';
import { buildServicePreviewUrl, validateServicePort } from '../../src/lib/apps/webPreview.js';
import NetworkingTab from '../../src/lib/NetworkingTab.svelte';

describe('Networking, Headscale Config, Diagnostics & Service Preview (network.js + NetworkingTab.svelte)', () => {
	let container;
	let instance;

	beforeEach(() => {
		localStorage.clear();
		disconnectNetwork();
		configureNetwork({ controlUrl: '', authKey: '', persist: true });
		container = document.createElement('div');
		document.body.appendChild(container);
	});

	afterEach(() => {
		instance?.$destroy();
		container?.remove();
	});

	it('validates controlUrl strictly and persists valid Headscale controlUrl in localStorage without synthetic trailing slash', () => {
		expect(validateControlUrl('')).toEqual({ valid: true, value: undefined });
		expect(validateControlUrl('https://headscale.persist.test')).toEqual({
			valid: true,
			value: 'https://headscale.persist.test'
		});
		expect(validateControlUrl('https://headscale.persist.test/')).toEqual({
			valid: true,
			value: 'https://headscale.persist.test/'
		});
		expect(validateControlUrl('https://headscale.example.com')).toEqual({
			valid: true,
			value: 'https://headscale.example.com'
		});
		const ftpCheck = validateControlUrl('ftp://bad.example');
		expect(ftpCheck.valid).toBe(false);
		expect(ftpCheck.error).toMatch(/invalid.*url|https?:\/\//i);
		expect(validateControlUrl('not a url').valid).toBe(false);

		const res = configureNetwork({
			controlUrl: 'https://hs.local:8443',
			authKey: 'tskey-123',
			persist: true
		});
		expect(res.ok).toBe(true);
		expect(networkInterface.controlUrl).toBe('https://hs.local:8443');
		expect(networkInterface.authKey).toBe('tskey-123');
		expect(JSON.parse(localStorage.getItem(NETWORK_STORAGE_KEY)).controlUrl).toBe(
			'https://hs.local:8443'
		);
	});

	it('rejects malformed controlUrl in NetworkingTab on input, Save Config, and Connect with inline error', async () => {
		instance = new NetworkingTab({ target: container });
		await tick();

		const input = container.querySelector('[data-testid="network-control-url-input"]');
		input.value = 'ftp://bad.example';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		let err = container.querySelector('[data-testid="network-config-error"]');
		expect(err?.textContent).toMatch(/invalid.*url|https?:\/\//i);

		input.value = 'javascript:alert(1)';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		container.querySelector('[data-testid="network-config-save-btn"]').click();
		await tick();

		err = container.querySelector('[data-testid="network-config-error"]');
		expect(err?.textContent).toMatch(/Invalid Control URL|https?:\/\//i);
	});

	it('shows visible Disconnected status, disables Disconnect when already disconnected, and resets peers/exitNode on disconnect', async () => {
		instance = new NetworkingTab({ target: container });
		await tick();

		const statusEl = container.querySelector('[data-testid="network-connection-status"]');
		expect(statusEl?.textContent).toMatch(/Disconnected/i);

		const disconnectBtn = container.querySelector('[data-testid="network-disconnect-btn"]');
		expect(disconnectBtn.disabled).toBe(true);

		// Simulate connected netmap with peer & exit node
		networkInterface.stateUpdateCb(6);
		networkInterface.netmapUpdateCb({
			self: { addresses: ['100.64.0.5'] },
			peers: [{ id: 'p1', name: 'exit-gw', addresses: ['100.64.0.1'], exitNode: true }]
		});
		await tick();

		expect(statusEl?.textContent).toMatch(/Connected/i);
		expect(disconnectBtn.disabled).toBe(false);
		expect(get(networkData.exitNode)).toBe(true);
		expect(container.querySelector('[data-testid="network-peers-list"]')?.textContent).toContain(
			'exit-gw'
		);

		disconnectBtn.click();
		await tick();

		expect(get(networkData.connectionState)).toBe('DISCONNECTED');
		expect(statusEl?.textContent).toMatch(/Disconnected/i);
		expect(get(networkData.exitNode)).toBe(false);
		expect(get(networkData.peers)).toEqual([]);
		expect(disconnectBtn.disabled).toBe(true);
	});

	it('renders popup-blocker fallback link when popupBlocked is true', async () => {
		instance = new NetworkingTab({ target: container });
		await tick();

		setPopupBlocked(true);
		networkInterface.loginUrlCb('https://login.tailscale.com/a/abc123');
		await tick();

		const fallbackLink = container.querySelector('[data-testid="network-popup-fallback-link"]');
		expect(fallbackLink).toBeTruthy();
		expect(fallbackLink.getAttribute('href')).toBe('https://login.tailscale.com/a/abc123');
	});

	it('validates service preview ports reactively on input (1-65535) and builds valid URLs', async () => {
		expect(validateServicePort('0').valid).toBe(false);
		expect(validateServicePort('99999').valid).toBe(false);
		expect(validateServicePort('abc').valid).toBe(false);
		expect(validateServicePort('8080')).toEqual({ valid: true, port: 8080 });
		expect(buildServicePreviewUrl({ host: '127.0.0.1', port: 8080 }).url).toBe(
			'http://127.0.0.1:8080/'
		);

		instance = new NetworkingTab({ target: container });
		await tick();

		// Valid default serviceHost + servicePort renders preview link immediately on mount
		expect(container.querySelector('[data-testid="service-preview-link"]')?.getAttribute('href')).toBe(
			'http://127.0.0.1:8080/'
		);

		const hostInput = container.querySelector('[data-testid="service-host-input"]');
		const portInput = container.querySelector('[data-testid="service-port-input"]');
		portInput.value = '99999';
		portInput.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		// Inline error appears immediately on input without clicking Build Link
		expect(container.querySelector('[data-testid="service-preview-error"]')?.textContent).toMatch(
			/1 and 65535/
		);
		expect(container.querySelector('[data-testid="service-preview-link"]')).toBeNull();

		hostInput.value = '100.64.0.9';
		hostInput.dispatchEvent(new Event('input', { bubbles: true }));
		portInput.value = '3000';
		portInput.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();
		expect(container.querySelector('[data-testid="service-preview-error"]')).toBeNull();
		// Preview link updates reactively without clicking Build Link
		expect(container.querySelector('[data-testid="service-preview-link"]')?.getAttribute('href')).toBe(
			'http://100.64.0.9:3000/'
		);

		container.querySelector('[data-testid="service-preview-build-btn"]').click();
		await tick();
		expect(container.querySelector('[data-testid="service-preview-link"]')?.getAttribute('href')).toBe(
			'http://100.64.0.9:3000/'
		);
	});

	it('reports DirectSocketsNetwork capability and reacts to browser offline events', async () => {
		const diag = getNetworkDiagnostics();
		expect(diag.directSockets.available).toBe(false);
		expect(diag.directSockets.label).toMatch(/Unavailable/i);

		instance = new NetworkingTab({ target: container });
		await tick();

		const onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
		window.dispatchEvent(new Event('offline'));
		await tick();

		expect(container.querySelector('[data-testid="diag-online"]')?.textContent).toMatch(/Offline/i);
		expect(container.querySelector('[data-testid="diag-host-fetch"]')?.textContent).toMatch(
			/Offline/i
		);
		onLineSpy.mockRestore();
	});
});
