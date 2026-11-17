import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { startServer } from './server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD_DIR = path.resolve(__dirname, '../../build');
const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium';

function isExternalAssetUrl(urlString, origin) {
	try {
		const u = new URL(urlString);
		return u.origin !== origin;
	} catch {
		return false;
	}
}

async function main() {
	if (!fs.existsSync(path.join(BUILD_DIR, 'index.html'))) {
		throw new Error(`Build directory missing (${BUILD_DIR}/index.html). Run "npm run build" before E2E tests.`);
	}

	const server = await startServer({ rootDir: BUILD_DIR });
	const browser = await chromium.launch({
		executablePath: CHROMIUM_PATH,
		headless: true,
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
	});

	try {
		for (const route of ['/', '/alpine.html']) {
			const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
			const page = await context.newPage();

			const pageErrors = [];
			const sameOriginConsoleErrors = [];
			const sameOriginHttpErrors = [];

			// Abort external third-party network calls cleanly in sandboxed/offline test runs
			await page.route('**/*', (routeHandler) => {
				const url = routeHandler.request().url();
				if (url.startsWith('http://') || url.startsWith('https://')) {
					if (isExternalAssetUrl(url, server.url)) {
						return routeHandler.abort('failed');
					}
				}
				return routeHandler.continue();
			});

			page.on('pageerror', (err) => {
				pageErrors.push(err.message || String(err));
			});

			page.on('console', (msg) => {
				if (msg.type() === 'error') {
					const loc = msg.location()?.url || '';
					const text = msg.text();
					// Ignore expected network errors from aborted external third-party calls
					if (loc && isExternalAssetUrl(loc, server.url)) return;
					if (text.includes('ERR_FAILED') && !text.includes(server.url)) return;
					sameOriginConsoleErrors.push(`${text} (${loc})`);
				}
			});

			page.on('response', (res) => {
				const url = res.url();
				if (!isExternalAssetUrl(url, server.url) && res.status() >= 400) {
					sameOriginHttpErrors.push(`${res.status()} ${url}`);
				}
			});

			await page.goto(`${server.url}${route}`, { waitUntil: 'domcontentloaded' });
			await page.waitForSelector('#console', { timeout: 10000 });
			await page.waitForSelector('.fa-robot', { timeout: 10000 });
			await page.waitForSelector('[data-testid="status-bar"]', { timeout: 10000 });

			const isolated = await page.evaluate(() => window.crossOriginIsolated);
			assert.equal(isolated, true, `Expected window.crossOriginIsolated === true on ${route}`);

			// Check FontAwesome icons (including .fa-robot and .fa-info-circle)
			const faResults = await page.evaluate(() => {
				const selectors = ['.fa-robot', '.fa-info-circle', '.fa-wifi', '.fa-microchip', '.fa-compact-disc'];
				return selectors.map((sel) => {
					const el = document.querySelector(sel);
					if (!el) return { sel, missing: true };
					const before = getComputedStyle(el, '::before');
					return { sel, content: before.content };
				});
			});
			for (const r of faResults) {
				assert.ok(!r.missing, `${r.sel} element missing on ${route}`);
				assert.ok(
					r.content && r.content !== 'none' && r.content !== 'normal',
					`${r.sel}::before computed content missing on ${route}: ${JSON.stringify(r)}`
				);
			}

			// Verify status bar & clipboard buttons
			await page.locator('[data-testid="status-bar"]').waitFor({ state: 'visible', timeout: 5000 });
			await page.locator('[data-testid="toolbar-copy-btn"]').waitFor({ state: 'visible', timeout: 5000 });
			await page.locator('[data-testid="toolbar-paste-btn"]').waitFor({ state: 'visible', timeout: 5000 });

			// Verify multi-tab lifecycle: create, switch, rename, close
			const tabLocator = page.locator('[data-testid="terminal-tab-bar"] [role="tab"]');
			assert.equal(await tabLocator.count(), 1, `Expected 1 initial tab on ${route}`);
			await page.locator('[data-testid="new-tab-btn"]').click();
			assert.equal(await tabLocator.count(), 2, `Expected 2 tabs after + New Tab on ${route}`);

			await page.locator('[data-testid="terminal-tab-tab-1"]').click();
			assert.equal(
				await page.locator('[data-testid="terminal-tab-tab-1"]').getAttribute('aria-selected'),
				'true'
			);
			await page.locator('[data-testid="terminal-tab-tab-2"]').click();
			assert.equal(
				await page.locator('[data-testid="terminal-tab-tab-2"]').getAttribute('aria-selected'),
				'true'
			);

			await page.locator('[data-testid="rename-tab-tab-2"]').click();
			const renameInput = page.locator('[data-testid="tab-rename-input"]');
			await renameInput.fill('work');
			await renameInput.press('Enter');
			assert.ok(
				(await page.locator('[data-testid="terminal-tab-tab-2"]').textContent()).includes('work'),
				'Expected renamed tab title "work"'
			);

			await page.locator('[data-testid="close-tab-tab-2"]').click();
			assert.equal(await tabLocator.count(), 1, `Expected 1 tab after closing secondary tab on ${route}`);

			// (d) Verify VirtualKeyBar works cleanly without BootProgressOverlay interception, and (c) sticky Ctrl releases cleanly
			await page.locator('[data-testid="new-tab-btn"]').click();
			await page.locator('[data-testid="toolbar-vkeys-btn"]').click();
			await page.locator('[data-testid="virtual-key-bar"]').waitFor({ state: 'visible', timeout: 5000 });

			const overlayBox = await page.locator('[data-testid="boot-progress-overlay"]').boundingBox().catch(() => null);
			const vkeyBox = await page.locator('[data-testid="virtual-key-bar"]').boundingBox();
			if (overlayBox && vkeyBox) {
				assert.ok(
					overlayBox.y + overlayBox.height <= vkeyBox.y + 1,
					`Expected BootProgressOverlay (${JSON.stringify(overlayBox)}) not to overlap VirtualKeyBar (${JSON.stringify(vkeyBox)})`
				);
			}

			// Sticky Ctrl via vkey-ctrl + vkey-mod-input
			const ctrlBtn = page.locator('[data-testid="vkey-ctrl"]');
			await ctrlBtn.click();
			assert.equal(await ctrlBtn.getAttribute('aria-pressed'), 'true');
			const modInput = page.locator('[data-testid="vkey-mod-input"]');
			await modInput.waitFor({ state: 'visible', timeout: 5000 });
			await modInput.fill('c');
			assert.equal(await ctrlBtn.getAttribute('aria-pressed'), 'false', 'Expected sticky Ctrl to auto-release after vkey-mod-input');

			// Sticky Ctrl + physical keyboard key in active terminal
			await ctrlBtn.click();
			assert.equal(await ctrlBtn.getAttribute('aria-pressed'), 'true');
			await page.locator('#console .xterm-helper-textarea').last().focus();
			await page.keyboard.press('u');
			assert.equal(await ctrlBtn.getAttribute('aria-pressed'), 'false', 'Expected sticky Ctrl to auto-release after physical key');

			await page.locator('[data-testid="vkey-fn-toggle"]').click();
			await page.locator('[data-testid="virtual-fn-row"]').waitFor({ state: 'visible', timeout: 5000 });
			await page.locator('[data-testid="toolbar-vkeys-btn"]').click();
			await page.locator('[data-testid="virtual-key-bar"]').waitFor({ state: 'hidden', timeout: 5000 });

			// (a) Verify toggling Renderer webgl/auto -> dom keeps/restores .xterm-rows visible and renders shell output without blanking
			await page.locator('[data-session-id="tab-3"] .xterm-helper-textarea').focus();
			await page.keyboard.type('help');
			await page.keyboard.press('Enter');
			await page.waitForTimeout(150);

			await page.locator('[data-testid="settings-btn"]').click();
			await page.locator('[data-testid="setting-renderer"]').selectOption('webgl');
			await page.locator('[data-testid="setting-renderer"]').selectOption('dom');
			await page.locator('[data-testid="settings-done-btn"]').click();

			await page.locator('[data-session-id="tab-3"] .xterm-rows').waitFor({ state: 'visible', timeout: 5000 });
			await page.locator('[data-session-id="tab-3"] .xterm-helper-textarea').focus();
			await page.keyboard.type('pwd');
			await page.keyboard.press('Enter');
			await page.waitForFunction(
				() => {
					const txt = document.querySelector('[data-session-id="tab-3"] .xterm-rows')?.textContent || '';
					return txt.includes('Built-ins') && (txt.includes('/home/user') || txt.includes('/root'));
				},
				null,
				{ timeout: 5000 }
			);

			await page.locator('[data-testid="close-tab-tab-3"]').click();
			assert.equal(await tabLocator.count(), 1, `Expected 1 tab after closing secondary tab on ${route}`);

			// (e) Verify StatusBar ECO Power-Saver toggle works
			const ecoBtn = page.locator('[data-testid="status-power-saver"]');
			await ecoBtn.waitFor({ state: 'visible', timeout: 5000 });
			assert.equal(await ecoBtn.getAttribute('aria-pressed'), 'false');
			await ecoBtn.click();
			assert.equal(await ecoBtn.getAttribute('aria-pressed'), 'true');
			assert.ok(
				await page.locator('main').evaluate((el) => el.classList.contains('power-saver')),
				'Expected main.power-saver class when ECO enabled'
			);
			await ecoBtn.click();
			assert.equal(await ecoBtn.getAttribute('aria-pressed'), 'false');

			// Verify search bar toggle via toolbar & Ctrl+Shift+F
			await page.locator('[data-testid="toolbar-search-btn"]').click();
			const searchInput = page.locator('[data-testid="terminal-search-input"]');
			await searchInput.waitFor({ state: 'visible', timeout: 5000 });
			await searchInput.fill('WebVM');
			await page.locator('[data-testid="search-close-btn"]').click();
			await searchInput.waitFor({ state: 'hidden', timeout: 5000 });

			await page.keyboard.press('Control+Shift+F');
			await searchInput.waitFor({ state: 'visible', timeout: 5000 });
			await page.keyboard.press('Escape');
			await searchInput.waitFor({ state: 'hidden', timeout: 5000 });

			if (route === '/') {
				// (b) Unpinned sidebar click promotes hover to click and keeps panel open when mouse leaves
				await page.locator('button[aria-label="CPU"]').hover();
				await page.getByText('Virtual CPU:').waitFor({ state: 'visible', timeout: 5000 });
				await page.locator('button[aria-label="CPU"]').click();
				await page.mouse.move(700, 400);
				await page.waitForTimeout(500);
				assert.equal(
					await page.getByText('Virtual CPU:').isVisible(),
					true,
					'Expected unpinned sidebar panel to remain open after clicking icon and moving mouse away'
				);
				await page.keyboard.press('Escape');
				await page.getByText('Virtual CPU:').waitFor({ state: 'hidden', timeout: 5000 });

				// Sidebar Information & ClaudeAI tabs + pinned-tab click test
				await page.locator('.fa-info-circle').first().hover();
				const heroImg = page.locator('img[src="assets/webvm_hero.png"]');
				await heroImg.waitFor({ state: 'visible', timeout: 5000 });
				const heroLoaded = await heroImg.evaluate((img) => img.complete && img.naturalWidth > 0);
				assert.equal(heroLoaded, true, 'Expected assets/webvm_hero.png to load cleanly');

				await page.locator('.fa-robot').first().hover();
				await page.getByText('Claude AI Integration').waitFor({ state: 'visible', timeout: 5000 });

				// Pin sidebar and verify clicking icons switches panel!
				await page.locator('button[aria-label="Pin Sidebar"]').click();
				await page.locator('button[aria-label="CPU"]').click();
				await page.getByText('Virtual CPU:').waitFor({ state: 'visible', timeout: 5000 });
				await page.locator('button[aria-label="Disk"]').click();
				await page.getByText('Backend latency:').waitFor({ state: 'visible', timeout: 5000 });
				await page.locator('button[aria-label="Unpin Sidebar"]').click();

				// Settings modal & reload persistence
				await page.locator('[data-testid="settings-btn"]').click();
				await page.locator('[data-testid="settings-modal"]').waitFor({ state: 'visible', timeout: 5000 });
				await page.locator('[data-testid="setting-theme"]').selectOption('solarized');
				await page.locator('[data-testid="setting-font-size"]').fill('17');
				await page.locator('[data-testid="setting-font-size"]').dispatchEvent('change');
				await page.locator('[data-testid="settings-done-btn"]').click();
				await page.locator('[data-testid="settings-modal"]').waitFor({ state: 'hidden', timeout: 5000 });

				await page.reload({ waitUntil: 'domcontentloaded' });
				await page.waitForSelector('#console', { timeout: 10000 });
				await page.locator('[data-testid="settings-btn"]').click();
				assert.equal(await page.locator('[data-testid="setting-theme"]').inputValue(), 'solarized');
				assert.equal(await page.locator('[data-testid="setting-font-size"]').inputValue(), '17');
				await page.locator('[data-testid="settings-reset-btn"]').click();
				await page.locator('[data-testid="settings-done-btn"]').click();
			}

			if (route === '/alpine.html') {
				// VT1 <-> VT7 switcher & display controls
				const vtBtn = page.locator('[data-testid="vt-toggle-btn"]');
				const displayWrapper = page.locator('[data-testid="display-wrapper"]');
				await vtBtn.waitFor({ state: 'visible', timeout: 5000 });
				assert.ok(
					(await page.locator('[data-testid="status-vt"]').textContent()).includes('VT1'),
					'Expected initial VT1 on /alpine.html'
				);

				await vtBtn.click();
				assert.ok(
					(await page.locator('[data-testid="status-vt"]').textContent()).includes('VT7'),
					'Expected VT7 after toggling VT'
				);
				const displayDims = await displayWrapper.evaluate((el) => ({
					className: el.className,
					width: el.offsetWidth,
					height: el.offsetHeight
				}));
				assert.ok(displayDims.width > 0 && displayDims.height > 0, 'Expected measurable #display wrapper');
				assert.ok(displayDims.className.includes('z-20') && displayDims.className.includes('opacity-100'));

				// Toggle back to VT1 (verifies one-way latch is fixed!)
				await vtBtn.click();
				assert.ok(
					(await page.locator('[data-testid="status-vt"]').textContent()).includes('VT1'),
					'Expected switch back to VT1'
				);

				// Pause/Resume display & Scale selector
				await page.locator('[data-testid="display-pause-btn"]').click();
				assert.ok(
					(await page.locator('[data-testid="status-vt"]').textContent()).includes('Paused'),
					'Expected Paused indicator in status bar'
				);
				await page.locator('[data-testid="display-pause-btn"]').click();
				await page.locator('[data-testid="display-scale-select"]').selectOption('0.75');
			}

			assert.deepEqual(pageErrors, [], `Uncaught pageerrors on ${route}: ${pageErrors.join('; ')}`);
			assert.deepEqual(
				sameOriginHttpErrors,
				[],
				`Same-origin HTTP errors on ${route}: ${sameOriginHttpErrors.join('; ')}`
			);
			assert.deepEqual(
				sameOriginConsoleErrors,
				[],
				`Same-origin console errors on ${route}: ${sameOriginConsoleErrors.join('; ')}`
			);

			await context.close();
			console.log(`[e2e] PASS ${route}: crossOriginIsolated=true, M2 UI verified, 0 errors`);
		}
	} finally {
		await browser.close();
		await server.close();
	}
}

main().catch((err) => {
	console.error('[e2e] FAILED:', err);
	process.exit(1);
});
