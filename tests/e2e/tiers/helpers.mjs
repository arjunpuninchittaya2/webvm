import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { chromium } from 'playwright-core';

export async function launchBrowser({
	chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium',
	headless = true
} = {}) {
	return chromium.launch({
		executablePath: chromiumPath,
		headless,
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
	});
}

export function isExternalUrl(urlString, baseUrl) {
	try {
		const target = new URL(urlString);
		const base = new URL(baseUrl);
		return target.origin !== base.origin;
	} catch {
		return false;
	}
}

const contextMockMap = new WeakMap();

export async function setupOfflineRoutes(page, baseUrl) {
	const ctx = page.context();
	if (contextMockMap.has(ctx)) return;
	const mocks = [];
	contextMockMap.set(ctx, mocks);

	await ctx.route('**/*', (route) => {
		const url = route.request().url();
		for (let i = mocks.length - 1; i >= 0; i--) {
			const m = mocks[i];
			if (m.match(url)) {
				return m.handler(route);
			}
		}
		if (url.startsWith('http://') || url.startsWith('https://')) {
			if (isExternalUrl(url, baseUrl)) {
				return route.abort('failed');
			}
		}
		return route.continue();
	});
}

export async function openFreshContext(browser, baseUrl, opts = {}) {
	const {
		viewport = { width: 1280, height: 800 },
		permissions = [],
		offline = false,
		seedLocalStorage = null,
		initScript = null,
		actionTimeout = 3000,
		blockExternal = true
	} = opts;

	const context = await browser.newContext({
		viewport,
		permissions,
		offline
	});

	if (seedLocalStorage && typeof seedLocalStorage === 'object') {
		await context.addInitScript((entries) => {
			for (const [k, v] of Object.entries(entries)) {
				window.localStorage.setItem(k, String(v));
			}
		}, seedLocalStorage);
	}

	if (typeof initScript === 'function') {
		await context.addInitScript(initScript);
	}

	const page = await context.newPage();
	page.setDefaultTimeout(actionTimeout);
	page.setDefaultNavigationTimeout(Math.max(actionTimeout * 3, 12000));

	if (blockExternal) {
		await setupOfflineRoutes(page, baseUrl);
	}

	const pageErrors = [];
	const sameOriginConsoleErrors = [];
	const sameOriginHttpErrors = [];
	let isClosing = false;

	page.on('pageerror', (err) => {
		pageErrors.push(err?.message || String(err));
	});

	page.on('console', (msg) => {
		if (msg.type() !== 'error') return;
		const loc = msg.location()?.url || '';
		const text = msg.text() || '';
		if (loc && isExternalUrl(loc, baseUrl)) return;
		if (
			(text.includes('ERR_FAILED') ||
				text.includes('ERR_INTERNET_DISCONNECTED') ||
				text.includes('ERR_NAME_NOT_RESOLVED') ||
				text.includes('ERR_CONNECTION_REFUSED')) &&
			!text.includes(baseUrl)
		) {
			return;
		}
		if (
			isClosing &&
			(text.includes('[vite]') ||
				text.includes('WebSocket') ||
				text.includes('server connection lost'))
		) {
			return;
		}
		sameOriginConsoleErrors.push(`${text}${loc ? ` (${loc})` : ''}`);
	});

	page.on('response', (res) => {
		const url = res.url();
		if (!isExternalUrl(url, baseUrl) && res.status() >= 400) {
			sameOriginHttpErrors.push(`${res.status()} ${url}`);
		}
	});

	function assertClean(label = 'page') {
		assert.deepEqual(pageErrors, [], `Uncaught pageerrors on ${label}: ${pageErrors.join('; ')}`);
		assert.deepEqual(
			sameOriginHttpErrors,
			[],
			`Same-origin HTTP errors on ${label}: ${sameOriginHttpErrors.join('; ')}`
		);
		assert.deepEqual(
			sameOriginConsoleErrors,
			[],
			`Same-origin console errors on ${label}: ${sameOriginConsoleErrors.join('; ')}`
		);
	}

	async function close() {
		isClosing = true;
		try {
			await context.close();
		} catch {
			// Ignore close errors during teardown
		}
	}

	return {
		context,
		page,
		pageErrors,
		sameOriginConsoleErrors,
		sameOriginHttpErrors,
		assertClean,
		close
	};
}

export function sidebarRegion(page) {
	return page.locator('[role="region"][aria-label="Sidebar"]');
}

export function sidebarPanel(page) {
	return page.locator('aside[aria-label="Sidebar panel"], aside').first();
}

export function activeDialog(page) {
	return page.getByRole('dialog');
}

export function toastLocator(page) {
	return page.locator(
		'[data-testid="toast"], [data-testid="toast-container"] [role="alert"], [data-testid="toast-container"] [role="status"], [role="alert"], [role="status"]'
	);
}

export async function waitForAppReady(page) {
	await page.locator('#console').waitFor({ state: 'visible', timeout: 8000 });
	await page.locator('#console .xterm').waitFor({ state: 'visible', timeout: 8000 });
	await page.locator('[data-testid="terminal-tab-bar"] [role="tab"]').first().waitFor({ state: 'visible', timeout: 8000 });
}

export async function gotoApp(page, baseUrl, route = '/') {
	const url = `${baseUrl}${route.startsWith('/') ? route : `/${route}`}`;
	await page.goto(url, { waitUntil: 'load' });
	await waitForAppReady(page);
}

export async function openSettingsModal(page) {
	const btn = page.locator('[data-testid="settings-btn"]').first();
	await btn.waitFor({ state: 'visible' });
	await btn.click();
	await page.locator('[data-testid="settings-modal"]').waitFor({ state: 'visible' });
}

async function activateSidebarButton(page, btn, { expectSidebarPanel = false } = {}) {
	await btn.waitFor({ state: 'visible' });
	const ariaPressed = await btn.getAttribute('aria-pressed');
	if (ariaPressed === 'true') {
		if (expectSidebarPanel && (await sidebarPanel(page).isVisible().catch(() => false))) {
			return;
		}
		await btn.click();
	} else {
		await btn.click();
	}
	if (expectSidebarPanel) {
		await sidebarPanel(page).waitFor({ state: 'visible' });
	}
}

export async function openSidebarTab(page, namePattern, { iconFallbackClass = null, exact = false } = {}) {
	const regex = namePattern instanceof RegExp ? namePattern : new RegExp(namePattern, 'i');

	const sidebarBtn = sidebarRegion(page).getByRole('button', { name: regex, exact }).first();
	if ((await sidebarBtn.count()) > 0) {
		await activateSidebarButton(page, sidebarBtn, { expectSidebarPanel: true });
		return;
	}

	const pageBtn = page.getByRole('button', { name: regex, exact }).first();
	if ((await pageBtn.count()) > 0) {
		await activateSidebarButton(page, pageBtn, { expectSidebarPanel: false });
		return;
	}

	const roleTab = page.getByRole('tab', { name: regex, exact }).first();
	if ((await roleTab.count()) > 0) {
		await roleTab.click();
		return;
	}

	if (iconFallbackClass) {
		const regionIcon = sidebarRegion(page).locator(`.${iconFallbackClass}`).first();
		const iconLoc = (await regionIcon.count()) > 0 ? regionIcon : page.locator(`.${iconFallbackClass}`).first();
		await iconLoc.waitFor({ state: 'visible' });
		await iconLoc.click();
		await sidebarPanel(page).waitFor({ state: 'visible' });
		return;
	}

	throw new Error(`Unable to find accessible sidebar/tab control matching ${regex}`);
}

export async function pinSidebar(page) {
	const scope = sidebarPanel(page);
	const pinBtn = scope.locator('[title*="Pin Sidebar" i], [aria-label*="Pin Sidebar" i], button:has-text("Pin Sidebar")').first();
	if ((await pinBtn.count()) > 0) {
		await pinBtn.click();
		const unpinBtn = scope.locator('[title*="Unpin Sidebar" i], [aria-label*="Unpin Sidebar" i]').first();
		await unpinBtn.waitFor({ state: 'visible' }).catch(() => {});
		return;
	}
	const unpinBtn = scope.locator('[title*="Unpin Sidebar" i], [aria-label*="Unpin Sidebar" i]').first();
	if ((await unpinBtn.count()) > 0) {
		return;
	}
	throw new Error('Pin Sidebar control not found');
}

export async function selectOptionByLabelRegex(selectLocator, pattern) {
	await selectLocator.waitFor({ state: 'visible' });
	const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'i');
	const options = await selectLocator.locator('option').all();
	for (const opt of options) {
		const text = (await opt.textContent()) || '';
		const val = (await opt.getAttribute('value')) ?? text;
		if (regex.test(text) || regex.test(val)) {
			await selectLocator.selectOption(val);
			return;
		}
	}
	throw new Error(`No <option> matching ${regex} found in select`);
}

export function sha256Hex(data) {
	return crypto.createHash('sha256').update(data).digest('hex');
}

function writeOctal(buf, offset, length, value) {
	const str = value.toString(8).padStart(length - 1, '0');
	buf.write(str.slice(-(length - 1)), offset, length - 1, 'ascii');
	buf[offset + length - 1] = 0;
}

export function buildTarGz(entries) {
	const blocks = [];
	const nowSec = Math.floor(Date.now() / 1000);

	for (const entry of entries) {
		const name = entry.name.replace(/^\/+/, '');
		const typeflag = entry.type || '0';
		const contentBuf =
			typeflag === '5'
				? Buffer.alloc(0)
				: Buffer.isBuffer(entry.content)
					? entry.content
					: Buffer.from(entry.content ?? '', 'utf8');
		const mode = entry.mode ?? (typeflag === '5' ? 0o755 : 0o644);

		const header = Buffer.alloc(512, 0);
		header.write(name.slice(0, 100), 0, 100, 'utf8');
		writeOctal(header, 100, 8, mode);
		writeOctal(header, 108, 8, 1000);
		writeOctal(header, 116, 8, 1000);
		writeOctal(header, 124, 12, contentBuf.length);
		writeOctal(header, 136, 12, nowSec);
		header.fill(0x20, 148, 156); // spaces for checksum calculation
		header.write(typeflag, 156, 1, 'ascii');
		header.write('ustar\0', 257, 6, 'ascii');
		header.write('00', 263, 2, 'ascii');

		let sum = 0;
		for (let i = 0; i < 512; i++) {
			sum += header[i];
		}
		const chkStr = sum.toString(8).padStart(6, '0');
		header.write(chkStr, 148, 6, 'ascii');
		header[154] = 0;
		header[155] = 0x20;

		blocks.push(header);
		if (contentBuf.length > 0) {
			blocks.push(contentBuf);
			const rem = contentBuf.length % 512;
			if (rem !== 0) {
				blocks.push(Buffer.alloc(512 - rem, 0));
			}
		}
	}

	// EOF two 512-byte zero blocks
	blocks.push(Buffer.alloc(1024, 0));
	const tarBuffer = Buffer.concat(blocks);
	return zlib.gzipSync(tarBuffer);
}

export function buildElfHeader({ machine = 'i386' } = {}) {
	const buf = Buffer.alloc(64, 0);
	buf[0] = 0x7f;
	buf[1] = 0x45; // 'E'
	buf[2] = 0x4c; // 'L'
	buf[3] = 0x46; // 'F'
	buf[4] = machine === 'x86_64' ? 2 : 1; // EI_CLASS: 1=ELF32, 2=ELF64
	buf[5] = 1; // EI_DATA: little-endian
	buf[6] = 1; // EI_VERSION
	buf.writeUInt16LE(2, 16); // e_type = ET_EXEC
	buf.writeUInt16LE(machine === 'x86_64' ? 62 : 3, 18); // e_machine: 3=EM_386, 62=EM_X86_64
	buf.writeUInt32LE(1, 20); // e_version
	return buf;
}

function globToRegExp(pattern) {
	if (pattern instanceof RegExp) return pattern;
	const escaped = String(pattern)
		.replace(/[.+^${}()|[\]\\]/g, '\\$&')
		.replace(/\*\*/g, '__DOUBLE_STAR__')
		.replace(/\*/g, '[^/]*')
		.replace(/__DOUBLE_STAR__/g, '.*');
	return new RegExp(`^${escaped}$`);
}

export async function mockCorsResponse(page, urlOrGlob, { status = 200, body = '', contentType = 'application/octet-stream', headers = {} } = {}) {
	const ctx = page.context();
	const mocks = contextMockMap.get(ctx);
	const regex = globToRegExp(urlOrGlob);
	const handler = (route) => {
		if (route.request().method() === 'OPTIONS') {
			return route.fulfill({
				status: 204,
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
					'Access-Control-Allow-Headers': '*',
					'Cross-Origin-Resource-Policy': 'cross-origin'
				}
			});
		}
		return route.fulfill({
			status,
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Cross-Origin-Resource-Policy': 'cross-origin',
				'Content-Type': contentType,
				...headers
			},
			body
		});
	};

	if (mocks) {
		mocks.push({ match: (u) => regex.test(u), handler });
	} else {
		await ctx.route(urlOrGlob, handler);
	}
}
