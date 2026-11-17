import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
	buildElfHeader,
	buildTarGz,
	gotoApp,
	mockCorsResponse,
	openFreshContext,
	openSettingsModal,
	openSidebarTab,
	selectOptionByLabelRegex,
	sha256Hex,
	sidebarPanel,
	toastLocator,
	waitForAppReady
} from './helpers.mjs';

export const tier1Tests = [
	// ======================== CORE ========================
	{
		id: 'T1-CORE-01',
		tier: 1,
		area: 'CORE',
		milestone: 'M1',
		features: ['#4', '#5', '#8'],
		title: 'COOP/COEP isolation, offline Blog Posts fallback, non-blocking head, and clean / & Alpine loads',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				const isolatedRoot = await h.page.evaluate(() => window.crossOriginIsolated);
				assert.equal(isolatedRoot, true, 'Expected window.crossOriginIsolated === true on /');

				// Verify plausible script is non-blocking (defer/async) and no external Google Fonts stylesheet blocks head
				const headMeta = await h.page.evaluate(() => {
					const plausible = document.querySelector('script[src*="plausible"]');
					const googleFontsLink = document.querySelector('link[href*="fonts.googleapis.com"]');
					return {
						plausibleNonBlocking: !plausible || plausible.defer || plausible.async,
						hasGoogleFontsLink: Boolean(googleFontsLink)
					};
				});
				assert.equal(headMeta.plausibleNonBlocking, true, 'Plausible script must be async or defer');
				assert.equal(headMeta.hasGoogleFontsLink, false, 'Render-blocking Google Fonts link should not be present');

				await openSidebarTab(h.page, /posts|blog/i, { iconFallbackClass: 'fa-book-open' });
				await h.page.getByText('Blog posts', { exact: false }).waitFor({ state: 'visible' });
				const postsOrFallback = h.page.getByText('Blog posts are unavailable offline.', { exact: false }).or(
					h.page.locator('a[href*="labs.leaningtech.com/blog"]').first()
				);
				await postsOrFallback.first().waitFor({ state: 'visible' });

				await gotoApp(h.page, ctx.baseUrl, ctx.alpineRoute);
				const isolatedAlpine = await h.page.evaluate(() => window.crossOriginIsolated);
				assert.equal(isolatedAlpine, true, `Expected window.crossOriginIsolated === true on ${ctx.alpineRoute}`);
				await h.page.locator('#display').waitFor({ state: 'attached' });
				h.assertClean('T1-CORE-01');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-CORE-02',
		tier: 1,
		area: 'CORE',
		milestone: 'M1',
		features: ['#5', '#6'],
		title: 'Service Worker registration & FontAwesome ::before computed content across all sidebar icons',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await h.page.locator('.fa-robot').first().waitFor({ state: 'visible' });

				const swState = await h.page.evaluate(async () => {
					if (!('serviceWorker' in navigator)) return { supported: false };
					const reg = await navigator.serviceWorker.getRegistration();
					if (reg) {
						return {
							supported: true,
							registered: true,
							hasWorker: Boolean(reg.active || reg.installing || reg.waiting)
						};
					}
					const readyReg = await Promise.race([
						navigator.serviceWorker.ready.then((r) => ({
							supported: true,
							registered: true,
							hasWorker: Boolean(r.active || r.installing || r.waiting)
						})),
						new Promise((resolve) => setTimeout(() => resolve({ supported: true, registered: false }), 2000))
					]);
					return readyReg;
				});
				assert.equal(swState.supported, true, 'Service Worker API must be supported');
				assert.equal(swState.registered && swState.hasWorker, true, `Expected active/installing Service Worker, got ${JSON.stringify(swState)}`);

				const iconStyles = await h.page.evaluate(() => {
					const els = Array.from(document.querySelectorAll('i[class*="fa-"]'));
					return els.map((el) => {
						const before = getComputedStyle(el, '::before');
						return {
							cls: el.className,
							content: before.content
						};
					});
				});
				assert.ok(iconStyles.length >= 8, `Expected at least 8 FontAwesome sidebar icons, found ${iconStyles.length}`);
				for (const item of iconStyles) {
					assert.ok(
						item.content && item.content !== 'none' && item.content !== 'normal',
						`FontAwesome icon missing ::before content: ${JSON.stringify(item)}`
					);
				}
				h.assertClean('T1-CORE-02');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-CORE-03',
		tier: 1,
		area: 'CORE',
		milestone: 'M1',
		features: ['#9', '#10'],
		title: 'Lazy-loaded Claude AI SDK/screenshot & localStorage-safe social counter tabs',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				const requestedUrls = [];
				h.page.on('request', (req) => requestedUrls.push(req.url()));

				await mockCorsResponse(h.page, 'https://api.github.com/repos/leaningtech/webvm', {
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ stargazers_count: 15420 })
				});
				await mockCorsResponse(h.page, 'https://discord.com/api/guilds/*/widget.json', {
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ presence_count: 321 })
				});

				await gotoApp(h.page, ctx.baseUrl, '/');

				// AI SDK and html2canvas-pro must NOT be eagerly fetched before ClaudeAI tab opens
				const eagerAiLoads = requestedUrls.filter(
					(u) => u.includes('@anthropic-ai') || u.includes('anthropic-ai') || u.includes('html2canvas')
				);
				assert.deepEqual(eagerAiLoads, [], `AI SDK / html2canvas loaded eagerly before AI tab opened: ${eagerAiLoads.join(', ')}`);

				// Open GitHub and Discord counter tabs
				await openSidebarTab(h.page, /github/i, { iconFallbackClass: 'fa-github' });
				await h.page.getByText('GitHub repo').waitFor({ state: 'visible' });
				await h.page.waitForFunction(() => Boolean(localStorage.getItem('github-stars-leaningtech/webvm')));

				await openSidebarTab(h.page, /discord/i, { iconFallbackClass: 'fa-discord' });
				await h.page.getByText('Join our Discord').waitFor({ state: 'visible' });
				await h.page.waitForFunction(() => Boolean(localStorage.getItem('discord-prescence-988743885121548329')));

				// Now open ClaudeAI tab
				await openSidebarTab(h.page, /claude|ai/i, { iconFallbackClass: 'fa-robot' });
				await h.page.getByText('Claude AI Integration').waitFor({ state: 'visible' });
				await h.page.locator('#ai-input').waitFor({ state: 'visible' });

				const eagerScreenshotLoads = requestedUrls.filter((u) => u.includes('html2canvas'));
				assert.deepEqual(eagerScreenshotLoads, [], 'html2canvas-pro should remain lazy until screenshot export is triggered');
				h.assertClean('T1-CORE-03');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-CORE-04',
		tier: 1,
		area: 'CORE',
		milestone: 'M2',
		features: ['#12', '#13', '#14'],
		title: 'Terminal search bar, UTF-8 input on xterm WebGL/DOM renderer, and CPU/Disk telemetry readout',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await h.page.locator('.xterm-screen').waitFor({ state: 'visible' });

				// Open search via button or Ctrl+Shift+F
				const searchBtn = h.page.locator('[data-testid="toolbar-search-btn"]').or(
					h.page.getByRole('button', { name: /search/i })
				).first();
				if ((await searchBtn.count()) > 0) {
					await searchBtn.click();
				} else {
					await h.page.locator('#console').click();
					await h.page.keyboard.press('Control+Shift+F');
				}

				const searchInput = h.page
					.locator('[data-testid="terminal-search-input"], input[placeholder*="find" i], input[aria-label*="find" i], input[placeholder*="search" i], input[aria-label*="search" i]')
					.first();
				await searchInput.waitFor({ state: 'visible' });
				await searchInput.fill('WebVM');
				await h.page.keyboard.press('Enter');

				const searchBar = h.page.locator('[data-testid="terminal-search-bar"]').first();
				await searchBar.waitFor({ state: 'visible' });
				assert.equal(await searchInput.inputValue(), 'WebVM', 'Search input must retain query after Enter');
				await searchBar.getByText(/\d+\/\d+|no matches/i).first().waitFor({ state: 'visible' });

				// Verify ring-buffer CPU & Disk telemetry readout (#12)
				const cpuText = await h.page.locator('[data-testid="status-cpu"]').textContent();
				const diskText = await h.page.locator('[data-testid="status-disk"]').textContent();
				assert.match(cpuText || '', /CPU:\s*\d+%/i, 'Expected numeric CPU telemetry readout');
				assert.match(diskText || '', /Disk:\s*\d+ms/i, 'Expected numeric disk latency telemetry readout');

				// Send UTF-8 input into terminal helper textarea
				const termTextarea = h.page.locator('#console .xterm-helper-textarea').first();
				await termTextarea.waitFor({ state: 'attached' });
				await termTextarea.focus();
				await h.page.keyboard.insertText('echo café 🚀');
				h.assertClean('T1-CORE-04');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-CORE-05',
		tier: 1,
		area: 'CORE',
		milestone: 'M2',
		features: ['#15', '#18'],
		title: 'Responsive viewport resize & VT1 ↔ VT7 display switcher with pause/scale controls on Alpine',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, ctx.alpineRoute);
				await h.page.locator('#display').waitFor({ state: 'attached' });

				await h.page.setViewportSize({ width: 960, height: 640 });
				const boxAfterResize = await h.page.locator('#console').boundingBox();
				assert.ok(boxAfterResize && boxAfterResize.width > 200 && boxAfterResize.height > 200, 'Console must resize cleanly');

				const statusBar = h.page.locator('[data-testid="status-bar"], footer').first();
				const displayWrapper = h.page.locator('[data-testid="display-wrapper"]').first();
				await statusBar.getByText(/VT1/i).waitFor({ state: 'visible' });

				// Toggle VT1 -> VT7
				const vtToggleBtn = h.page.locator('[data-testid="vt-toggle-btn"]').or(
					h.page.getByRole('button', { name: /vt\s*7|display|x11|graphical/i })
				).first();
				await vtToggleBtn.waitFor({ state: 'visible' });
				await vtToggleBtn.click();
				await statusBar.getByText(/VT7/i).waitFor({ state: 'visible' });
				if ((await displayWrapper.count()) > 0) {
					const cls = (await displayWrapper.getAttribute('class')) || '';
					assert.ok(cls.includes('opacity-100'), `Expected display-wrapper visible on VT7, got class="${cls}"`);
				}

				// Toggle VT7 -> VT1
				await vtToggleBtn.click();
				await statusBar.getByText(/VT1/i).waitFor({ state: 'visible' });

				// Toggle display pause & verify state + status bar
				const pauseBtn = h.page.locator('[data-testid="display-pause-btn"]').or(
					h.page.getByRole('button', { name: /pause display|resume display/i })
				).first();
				await pauseBtn.waitFor({ state: 'visible' });
				await pauseBtn.click();
				assert.equal(await pauseBtn.getAttribute('aria-pressed'), 'true', 'Expected Pause Display aria-pressed="true"');
				await statusBar.getByText(/paused/i).waitFor({ state: 'visible' });
				await pauseBtn.click();
				assert.equal(await pauseBtn.getAttribute('aria-pressed'), 'false', 'Expected Pause Display aria-pressed="false" after resume');
				h.assertClean('T1-CORE-05');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-CORE-06',
		tier: 1,
		area: 'CORE',
		milestone: 'M2',
		features: ['#17'],
		title: 'Multi-terminal tabs & session lifecycle (create, rename, switch, close)',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				const tabs = h.page.locator('[role="tab"]');
				await tabs.first().waitFor({ state: 'visible' });
				const initialCount = await tabs.count();
				assert.ok(initialCount >= 1, 'Expected at least 1 initial terminal tab');

				const newTabBtn = h.page.locator('[data-testid="new-tab-btn"]').or(
					h.page.getByRole('button', { name: /new tab|add tab|new terminal|\+ tab/i })
				).first();
				await newTabBtn.waitFor({ state: 'visible' });
				await newTabBtn.click();
				await tabs.nth(initialCount).waitFor({ state: 'visible' });
				assert.equal(await tabs.count(), initialCount + 1, 'Creating a new tab must increment tab count');

				// Rename newly created last tab
				await h.page.locator('[data-testid^="rename-tab-"]').last().click();
				const renameInput = h.page.locator('[data-testid="tab-rename-input"], [role="tablist"] input').first();
				await renameInput.waitFor({ state: 'visible' });
				await renameInput.fill('build-tab');
				await renameInput.press('Enter');
				const buildTab = h.page.locator('[role="tab"]', { hasText: 'build-tab' });
				await buildTab.waitFor({ state: 'visible' });

				// Switch to first tab and back, asserting aria-selected
				await tabs.first().click();
				assert.equal(await tabs.first().getAttribute('aria-selected'), 'true', 'First tab must be selected');
				await buildTab.click();
				assert.equal(await buildTab.getAttribute('aria-selected'), 'true', 'build-tab must be selected');

				// Close build-tab via its wrapper div
				const buildTabWrapper = h.page
					.locator('[data-testid="terminal-tab-bar"] > div')
					.filter({ has: buildTab })
					.first();
				await buildTabWrapper.locator('[data-testid^="close-tab-"], button[aria-label^="Close "]').first().click();
				await buildTab.waitFor({ state: 'detached' });
				assert.equal(await tabs.count(), initialCount, 'Closing new tab must restore initial tab count');
				h.assertClean('T1-CORE-06');
			} finally {
				await h.close();
			}
		}
	},

	// ======================== PERF ========================
	{
		id: 'T1-PERF-01',
		tier: 1,
		area: 'PERF',
		milestone: 'M2',
		features: ['#16'],
		title: 'Boot progress indicator & visibility power-saver throttling on visibilitychange',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				const bootIndicator = h.page
					.locator('[data-testid="boot-progress-overlay"], [role="progressbar"], [data-testid="boot-progress"]')
					.or(h.page.getByText(/booting|initializing|vm ready|loading image/i))
					.first();
				await bootIndicator.waitFor({ state: 'visible' });

				// Simulate tab becoming hidden
				await h.page.evaluate(() => {
					Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
					document.dispatchEvent(new Event('visibilitychange'));
				});

				await h.page
					.locator('main.power-saver, [data-power-saver="throttled"], [data-throttled="true"]')
					.first()
					.waitFor({ state: 'visible' });

				// Restore visibility
				await h.page.evaluate(() => {
					Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
					document.dispatchEvent(new Event('visibilitychange'));
				});
				await h.page.locator('main.power-saver').waitFor({ state: 'detached' });
				h.assertClean('T1-PERF-01');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-PERF-02',
		tier: 1,
		area: 'PERF',
		milestone: 'M2',
		features: ['#19'],
		title: 'Chromebook virtual key bar (Esc, Tab, Ctrl, Alt, Arrows, F1-F12) with sticky modifier state',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await h.page.locator('[data-testid="toolbar-vkeys-btn"]').click();
				await h.page.locator('[data-testid="virtual-key-bar"]').waitFor({ state: 'visible' });

				for (const keyLabel of [/^Esc$/i, /^Tab$/i, /^Ctrl$/i, /^Alt$/i]) {
					await h.page.getByRole('button', { name: keyLabel }).first().waitFor({ state: 'visible' });
				}

				await h.page.locator('[data-testid="vkey-fn-toggle"]').click();
				await h.page.locator('[data-testid="virtual-fn-row"]').waitFor({ state: 'visible' });
				await h.page.getByRole('button', { name: /^F1$/i }).first().waitFor({ state: 'visible' });

				const ctrlBtn = h.page.locator('[data-testid="vkey-ctrl"]').first();
				await ctrlBtn.click();
				assert.equal(await ctrlBtn.getAttribute('aria-pressed'), 'true', 'Expected sticky Ctrl button aria-pressed="true" after click');
				await h.page.locator('[data-testid="vkey-mod-input"]').waitFor({ state: 'visible' });
				await ctrlBtn.click();
				assert.equal(await ctrlBtn.getAttribute('aria-pressed'), 'false', 'Expected Ctrl button to release on second click');
				h.assertClean('T1-PERF-02');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-PERF-03',
		tier: 1,
		area: 'PERF',
		milestone: 'M2',
		features: ['#19'],
		title: 'Clipboard Copy/Paste toolbar actions with granted clipboard permissions',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, {
				permissions: ['clipboard-read', 'clipboard-write'],
				actionTimeout: ctx.actionTimeout,
				initScript: () => {
					window.__clipboardOps = [];
					let mem = '';
					const orig = navigator.clipboard;
					Object.defineProperty(navigator, 'clipboard', {
						configurable: true,
						value: {
							writeText: async (txt) => {
								mem = String(txt ?? '');
								window.__clipboardOps.push({ op: 'writeText', value: mem });
								if (orig?.writeText) {
									try { await orig.writeText(mem); } catch { /* ignore headless */ }
								}
							},
							readText: async () => {
								let val = mem;
								if (orig?.readText) {
									try { val = await orig.readText(); } catch { /* fallback mem */ }
								}
								window.__clipboardOps.push({ op: 'readText', value: val });
								return val;
							}
						}
					});
				}
			});
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				const copyBtn = h.page.getByRole('button', { name: /copy/i }).first();
				const pasteBtn = h.page.getByRole('button', { name: /paste/i }).first();
				await copyBtn.waitFor({ state: 'visible' });
				await pasteBtn.waitFor({ state: 'visible' });

				await h.page.evaluate(() => navigator.clipboard.writeText('echo clipboard-ok'));
				await pasteBtn.click();
				await h.page.waitForFunction(() =>
					window.__clipboardOps.some((e) => e.op === 'readText' && e.value === 'echo clipboard-ok')
				);

				await copyBtn.click();
				const copyFeedback = h.page.locator('[data-testid="toast"], [role="alert"], [role="status"]').filter({
					hasText: /copied|no text selected/i
				}).first();
				await copyFeedback.waitFor({ state: 'visible' });
				h.assertClean('T1-PERF-03');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-PERF-04',
		tier: 1,
		area: 'PERF',
		milestone: 'M2',
		features: ['#20'],
		title: 'Persistent settings in localStorage (webvm.settings.v1) across reload',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSettingsModal(h.page);
				const modal = h.page.locator('[data-testid="settings-modal"]');

				const fontInput = modal.locator('[data-testid="setting-font-size"]').or(modal.getByLabel(/font size/i)).first();
				await fontInput.waitFor({ state: 'visible' });
				await fontInput.fill('17');
				await fontInput.dispatchEvent('change');

				const powerSaverToggle = modal.locator('[data-testid="setting-power-saver"]').or(modal.getByLabel(/power saver/i)).first();
				await powerSaverToggle.waitFor({ state: 'visible' });
				await powerSaverToggle.check();

				const sidebarPinToggle = modal.locator('[data-testid="setting-sidebar-pin"]').first();
				await sidebarPinToggle.waitFor({ state: 'visible' });
				await sidebarPinToggle.check();

				await modal.locator('[data-testid="settings-done-btn"]').click();
				await modal.waitFor({ state: 'hidden' });

				const rawSaved = await h.page.evaluate(() => localStorage.getItem('webvm.settings.v1'));
				assert.ok(rawSaved, 'Expected webvm.settings.v1 to be written to localStorage');
				const parsed = JSON.parse(rawSaved);
				assert.equal(Number(parsed.fontSize), 17, 'Expected fontSize=17 in persisted settings');
				assert.equal(Boolean(parsed.powerSaver), true, 'Expected powerSaver=true in persisted settings');
				assert.equal(Boolean(parsed.sidebarPin), true, 'Expected sidebarPin=true in persisted settings');

				await h.page.reload({ waitUntil: 'load' });
				await waitForAppReady(h.page);
				const rawAfterReload = await h.page.evaluate(() => localStorage.getItem('webvm.settings.v1'));
				assert.equal(Number(JSON.parse(rawAfterReload).fontSize), 17, 'Settings must survive reload');
				h.assertClean('T1-PERF-04');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-PERF-05',
		tier: 1,
		area: 'PERF',
		milestone: 'M2',
		features: ['#20'],
		title: 'Status bar readout & semantic <button>/ARIA keyboard navigation on sidebar',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				const statusBar = h.page.locator('[data-testid="status-bar"], footer').filter({
					hasText: /vt|cpu|font|ready|boot/i
				}).first();
				await statusBar.waitFor({ state: 'visible' });

				const navButtons = h.page.locator('nav button, aside button, [aria-label][role="button"], button[aria-label]');
				const btnCount = await navButtons.count();
				assert.ok(btnCount >= 6, `Expected semantic <button> sidebar navigation items, found ${btnCount}`);

				await navButtons.first().focus();
				await h.page.keyboard.press('Enter');
				await sidebarPanel(h.page).waitFor({ state: 'visible' });
				h.assertClean('T1-PERF-05');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-PERF-06',
		tier: 1,
		area: 'PERF',
		milestone: 'M5',
		features: ['#33'],
		title: 'Accessible toast notifications (role=alert/status) & WebAudio terminal bell preference persistence',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSettingsModal(h.page);

				const bellToggle = h.page.getByLabel(/bell|audio bell|terminal bell/i).first();
				await bellToggle.waitFor({ state: 'visible' });
				await bellToggle.check();

				const testBellBtn = h.page.getByRole('button', { name: /test bell|test notification/i }).first();
				await testBellBtn.waitFor({ state: 'visible' });
				await testBellBtn.click();

				const toast = toastLocator(h.page).filter({
					hasText: /bell|notification|saved|ready/i
				}).first();
				await toast.waitFor({ state: 'visible' });

				await h.page.reload({ waitUntil: 'load' });
				await waitForAppReady(h.page);
				await openSettingsModal(h.page);
				assert.equal(await h.page.getByLabel(/bell|audio bell|terminal bell/i).first().isChecked(), true);
				h.assertClean('T1-PERF-06');
			} finally {
				await h.close();
			}
		}
	},

	// ======================== FS ========================
	{
		id: 'T1-FS-01',
		tier: 1,
		area: 'FS',
		milestone: 'M3',
		features: ['#21'],
		title: 'Dedicated persistent /home/user/workspace survives reload AND OS root disk reset',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /files|file manager|workspace/i);
				const panel = sidebarPanel(h.page);

				const uploadInput = panel.locator('input[type="file"]').first();
				await uploadInput.waitFor({ state: 'attached' });
				await uploadInput.setInputFiles({
					name: 'persist.txt',
					mimeType: 'text/plain',
					buffer: Buffer.from('workspace survives reset')
				});
				await panel.getByText('persist.txt').waitFor({ state: 'visible' });

				await h.page.reload({ waitUntil: 'load' });
				await waitForAppReady(h.page);
				await openSidebarTab(h.page, /files|file manager|workspace/i);
				await panel.getByText('persist.txt').waitFor({ state: 'visible' });

				// Trigger OS root disk reset
				await openSidebarTab(h.page, /disk/i, { iconFallbackClass: 'fa-compact-disc' });
				const resetBtn = panel.getByText('Reset disk', { exact: false }).first();
				await resetBtn.click();
				const confirmBtn = panel.getByText('Reset disk. Confirm?', { exact: false }).first();
				await confirmBtn.waitFor({ state: 'visible' });
				await Promise.all([
					h.page.waitForNavigation({ waitUntil: 'load' }),
					confirmBtn.click()
				]);
				await waitForAppReady(h.page);

				await openSidebarTab(h.page, /files|file manager|workspace/i);
				await panel.getByText('persist.txt').waitFor({ state: 'visible' });
				h.assertClean('T1-FS-01');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-FS-02',
		tier: 1,
		area: 'FS',
		milestone: 'M3',
		features: ['#22'],
		title: 'Host -> VM multi-file upload via File Manager <input type="file" multiple> with +x script staging',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /files|file manager|workspace/i);
				const panel = sidebarPanel(h.page);

				const uploadInput = panel.locator('input[type="file"][multiple]').first();
				await uploadInput.waitFor({ state: 'attached' });
				await uploadInput.setInputFiles([
					{ name: 'hello.sh', mimeType: 'text/x-shellscript', buffer: Buffer.from('#!/bin/sh\necho hi\n') },
					{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('sample notes') }
				]);

				await panel.getByText('hello.sh').waitFor({ state: 'visible' });
				await panel.getByText('notes.txt').waitFor({ state: 'visible' });
				await panel.getByText(/\+x|chmod \+x|executable/i).first().waitFor({ state: 'visible' });
				h.assertClean('T1-FS-02');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-FS-03',
		tier: 1,
		area: 'FS',
		milestone: 'M3',
		features: ['#22'],
		title: 'Drag-and-drop file import onto #console replaces old drop blocker',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				const dt = await h.page.evaluateHandle(() => {
					const transfer = new DataTransfer();
					transfer.items.add(new File(['drop-content'], 'dropped.txt', { type: 'text/plain' }));
					return transfer;
				});
				await h.page.locator('#console').dispatchEvent('drop', { dataTransfer: dt });

				await openSidebarTab(h.page, /files|file manager|workspace/i);
				const panel = sidebarPanel(h.page);
				await panel.getByText('dropped.txt').waitFor({ state: 'visible' });
				h.assertClean('T1-FS-03');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-FS-04',
		tier: 1,
		area: 'FS',
		milestone: 'M3',
		features: ['#23'],
		title: 'VM -> Host File Manager CRUD (mkdir, rename, delete) & file download',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /files|file manager|workspace/i);
				const panel = sidebarPanel(h.page);

				// mkdir
				const mkdirInput = panel.getByPlaceholder(/folder|directory|new dir/i).first();
				await mkdirInput.waitFor({ state: 'visible' });
				await mkdirInput.fill('subproj');
				await panel.getByRole('button', { name: /mkdir|new folder|create folder/i }).first().click();
				await panel.getByText('subproj').waitFor({ state: 'visible' });

				// upload + rename + download + delete
				await panel.locator('input[type="file"]').first().setInputFiles({
					name: 'orig.txt',
					mimeType: 'text/plain',
					buffer: Buffer.from('download me')
				});
				await panel.getByText('orig.txt').waitFor({ state: 'visible' });

				const origRow = panel.locator('[data-file-entry], li, tr').filter({ hasText: 'orig.txt' }).first();
				await origRow.getByRole('button', { name: /rename/i }).first().click();
				const renameInput = panel.locator('input[placeholder*="rename" i], input[aria-label*="rename" i]').first();
				await renameInput.fill('renamed.txt');
				await renameInput.press('Enter');
				await panel.getByText('renamed.txt').waitFor({ state: 'visible' });

				const renamedRow = panel.locator('[data-file-entry], li, tr').filter({ hasText: 'renamed.txt' }).first();
				const [download] = await Promise.all([
					h.page.waitForEvent('download'),
					renamedRow.getByRole('button', { name: /download/i }).first().click()
				]);
				assert.equal(download.suggestedFilename(), 'renamed.txt');

				await renamedRow.getByRole('button', { name: /delete|remove/i }).first().click();
				await panel.getByText('renamed.txt').waitFor({ state: 'detached' });
				h.assertClean('T1-FS-04');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-FS-05',
		tier: 1,
		area: 'FS',
		milestone: 'M3',
		features: ['#24'],
		title: 'Workspace snapshot export & import round-trip after workspace reset',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webvm-snap-'));
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /files|file manager|workspace/i);
				const panel = sidebarPanel(h.page);

				await panel.locator('input[type="file"]').first().setInputFiles({
					name: 'snap-test.txt',
					mimeType: 'text/plain',
					buffer: Buffer.from('snapshot payload 123')
				});
				await panel.getByText('snap-test.txt').waitFor({ state: 'visible' });

				const [download] = await Promise.all([
					h.page.waitForEvent('download'),
					panel.getByRole('button', { name: /export snapshot|export workspace/i }).first().click()
				]);
				const snapPath = path.join(tmpDir, download.suggestedFilename() || 'workspace-snapshot.json');
				await download.saveAs(snapPath);

				await panel.getByRole('button', { name: /reset workspace/i }).first().click();
				const confirmReset = panel.getByRole('button', { name: /confirm|yes/i }).first();
				if ((await confirmReset.count()) > 0) await confirmReset.click();
				await panel.getByText('snap-test.txt').waitFor({ state: 'detached' });

				const importInput = panel.locator('input[type="file"][accept*="json" i], input[aria-label*="import snapshot" i]').first();
				await importInput.setInputFiles(snapPath);
				await panel.getByText('snap-test.txt').waitFor({ state: 'visible' });
				h.assertClean('T1-FS-05');
			} finally {
				await fs.rm(tmpDir, { recursive: true, force: true });
				await h.close();
			}
		}
	},
	{
		id: 'T1-FS-06',
		tier: 1,
		area: 'FS',
		milestone: 'M3',
		features: ['#25'],
		title: 'Built-in Code/File Editor save & 1-click "Run in Terminal"',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /editor|code/i);
				const panel = sidebarPanel(h.page);
				const toast = toastLocator(h.page);

				const pathInput = panel.getByPlaceholder(/path|filename/i).first();
				await pathInput.waitFor({ state: 'visible' });
				await pathInput.fill('runme.sh');

				const codeArea = panel.locator('textarea[aria-label*="editor" i], textarea[data-testid="code-editor"], textarea').first();
				await codeArea.waitFor({ state: 'visible' });
				await codeArea.fill('#!/bin/sh\necho "ran-from-editor"\n');

				await panel.getByRole('button', { name: /^save$/i }).first().click();
				await panel.or(toast).getByText(/saved|runme\.sh/i).first().waitFor({ state: 'visible' });

				await panel.getByRole('button', { name: /run in terminal/i }).first().click();
				await panel.or(toast).getByText(/running|launched|runme\.sh/i).first().waitFor({ state: 'visible' });
				h.assertClean('T1-FS-06');
			} finally {
				await h.close();
			}
		}
	},

	// ======================== APP ========================
	{
		id: 'T1-APP-01',
		tier: 1,
		area: 'APP',
		milestone: 'M4',
		features: ['#26'],
		title: 'Host HTTP downloader fetches mocked CORS URL into VM workspace with valid SHA-256 & +x',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				const payload = '#!/bin/sh\necho "verified-tool"\n';
				const digest = sha256Hex(payload);
				await mockCorsResponse(h.page, 'https://downloads.example.test/tool.sh', {
					body: payload,
					contentType: 'text/plain'
				});

				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /apps|app store|downloader/i);
				const panel = sidebarPanel(h.page);
				const toast = toastLocator(h.page);

				await panel.getByLabel(/url/i).first().fill('https://downloads.example.test/tool.sh');
				await panel.getByLabel(/sha-?256/i).first().fill(digest);
				const execCheckbox = panel.getByLabel(/executable|\+x/i).first();
				if ((await execCheckbox.count()) > 0) await execCheckbox.check();

				await panel.getByRole('button', { name: /^download$/i }).first().click();
				await panel.or(toast).getByText(/downloaded|verified|tool\.sh/i).first().waitFor({ state: 'visible' });

				await openSidebarTab(h.page, /files|file manager|workspace/i);
				await panel.getByText('tool.sh').waitFor({ state: 'visible' });
				h.assertClean('T1-APP-01');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-APP-02',
		tier: 1,
		area: 'APP',
		milestone: 'M4',
		features: ['#26'],
		title: 'Archive download (.tar.gz) via CORS proxy URL rewriting & automatic extraction',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				const tarGz = buildTarGz([{ name: 'pkg/hello.txt', content: 'from-tar-gz' }]);
				await mockCorsResponse(h.page, 'https://proxy.example.test/**', {
					body: tarGz,
					contentType: 'application/gzip'
				});

				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /apps|app store|downloader/i);
				const panel = sidebarPanel(h.page);

				await panel.getByLabel(/url/i).first().fill('https://origin.example.test/pkg.tar.gz');
				await panel.getByLabel(/cors proxy|proxy/i).first().fill('https://proxy.example.test/?url=');
				const extractChk = panel.getByLabel(/extract/i).first();
				if ((await extractChk.count()) > 0) await extractChk.check();

				await panel.getByRole('button', { name: /^download/i }).first().click();
				await openSidebarTab(h.page, /files|file manager|workspace/i);
				await panel.getByText(/hello\.txt/i).first().waitFor({ state: 'visible' });
				h.assertClean('T1-APP-02');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-APP-03',
		tier: 1,
		area: 'APP',
		milestone: 'M4',
		features: ['#26'],
		title: 'Package source shortcut (GitHub / PyPI / npm) fetches mocked package artifact into VM storage',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				const pkgTar = buildTarGz([{ name: 'package/index.js', content: 'console.log("demo");\n' }]);
				await mockCorsResponse(h.page, 'https://registry.npmjs.org/demo-pkg/latest', {
					contentType: 'application/json',
					body: JSON.stringify({
						name: 'demo-pkg',
						version: '1.0.0',
						dist: { tarball: 'https://registry.npmjs.org/demo-pkg/-/demo-pkg-1.0.0.tgz' }
					})
				});
				await mockCorsResponse(h.page, 'https://registry.npmjs.org/demo-pkg/-/demo-pkg-1.0.0.tgz', {
					contentType: 'application/gzip',
					body: pkgTar
				});

				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /apps|app store|downloader/i);
				const panel = sidebarPanel(h.page);

				const sourceSelect = panel.getByLabel(/source|registry|provider/i).first();
				await selectOptionByLabelRegex(sourceSelect, /npm/i);

				await panel.getByLabel(/package|repo/i).first().fill('demo-pkg');
				await panel.getByRole('button', { name: /fetch package|install|download/i }).first().click();

				await openSidebarTab(h.page, /files|file manager|workspace/i);
				await panel.getByText(/index\.js|demo-pkg/i).first().waitFor({ state: 'visible' });
				h.assertClean('T1-APP-03');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-APP-04',
		tier: 1,
		area: 'APP',
		milestone: 'M4',
		features: ['#27'],
		title: 'Curated Chromebook app catalog browsing, search filtering, and 1-click launch',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /apps|app store|catalog/i);
				const panel = sidebarPanel(h.page);
				const toast = toastLocator(h.page);

				const filterInput = panel.getByPlaceholder(/filter|search apps/i).first();
				await filterInput.waitFor({ state: 'visible' });
				await filterInput.fill('python');
				await panel.getByText(/python/i).first().waitFor({ state: 'visible' });

				const launchBtn = panel.getByRole('button', { name: /launch|run/i }).first();
				await launchBtn.waitFor({ state: 'visible' });
				await launchBtn.click();
				await panel.or(toast).getByText(/running|launched|started|python/i).first().waitFor({ state: 'visible' });
				h.assertClean('T1-APP-04');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-APP-05',
		tier: 1,
		area: 'APP',
		milestone: 'M4',
		features: ['#27'],
		title: '1-click runner for uploaded script/i386 executable in workspace with run status',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /files|file manager|workspace/i);
				const panel = sidebarPanel(h.page);
				const toast = toastLocator(h.page);

				await panel.locator('input[type="file"]').first().setInputFiles({
					name: 'mini32',
					mimeType: 'application/octet-stream',
					buffer: buildElfHeader({ machine: 'i386' })
				});
				await panel.getByText('mini32').waitFor({ state: 'visible' });

				const row = panel.locator('[data-file-entry], li, tr').filter({ hasText: 'mini32' }).first();
				await row.getByRole('button', { name: /run/i }).first().click();
				await panel.or(toast).getByText(/running|launched|mini32/i).first().waitFor({ state: 'visible' });
				h.assertClean('T1-APP-05');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-APP-06',
		tier: 1,
		area: 'APP',
		milestone: 'M4',
		features: ['#29'],
		title: 'Local web app / HTML preview panel rendering saved workspace index.html',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /files|file manager|workspace/i);

				await h.page.locator('input[type="file"]').first().setInputFiles({
					name: 'index.html',
					mimeType: 'text/html',
					buffer: Buffer.from('<!doctype html><html><body><h1>Preview Works</h1></body></html>')
				});
				await h.page.getByText('index.html').waitFor({ state: 'visible' });

				await openSidebarTab(h.page, /preview/i);
				const pathInput = h.page.getByLabel(/file|path/i).first();
				if ((await pathInput.count()) > 0) await pathInput.fill('index.html');
				await h.page.getByRole('button', { name: /render|open preview|preview/i }).first().click();

				const frame = h.page.frameLocator('iframe').first();
				await frame.getByText('Preview Works').waitFor({ state: 'visible' });
				h.assertClean('T1-APP-06');
			} finally {
				await h.close();
			}
		}
	},

	// ======================== NET ========================
	{
		id: 'T1-NET-01',
		tier: 1,
		area: 'NET',
		milestone: 'M4',
		features: ['#28'],
		title: 'Tailscale/Headscale controlUrl & authKey configuration form submission',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /network/i, { iconFallbackClass: 'fa-wifi' });
				const panel = sidebarPanel(h.page);

				await panel.getByLabel(/control url|headscale/i).first().fill('https://hs.example.test');
				await panel.getByLabel(/auth key/i).first().fill('tskey-auth-test-123');
				await panel.getByRole('button', { name: /connect|apply/i }).first().click();

				await panel.getByText(/hs\.example\.test|connecting|configured|logging/i).first().waitFor({ state: 'visible' });
				h.assertClean('T1-NET-01');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-NET-02',
		tier: 1,
		area: 'NET',
		milestone: 'M4',
		features: ['#28'],
		title: 'Tailscale popup-blocker fallback (window.open returns null) renders link without TypeError',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, {
				actionTimeout: ctx.actionTimeout,
				initScript: () => {
					window.open = () => null;
				}
			});
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /network/i, { iconFallbackClass: 'fa-wifi' });
				const panel = sidebarPanel(h.page);

				const connectBtn = panel.getByRole('button', { name: /connect.*tailscale|connect/i }).first();
				await connectBtn.waitFor({ state: 'visible' });
				await connectBtn.click();

				await panel.locator('a[href*="login.html"], [data-testid="tailscale-login-fallback"]').first().waitFor({ state: 'visible' });
				h.assertClean('T1-NET-02');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-NET-03',
		tier: 1,
		area: 'NET',
		milestone: 'M4',
		features: ['#28'],
		title: 'Tailscale disconnect control & peer/exit-node status UI',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /network/i, { iconFallbackClass: 'fa-wifi' });
				const panel = sidebarPanel(h.page);

				await panel.getByText(/exit node|peer|disconnected|status/i).first().waitFor({ state: 'visible' });
				await panel.getByRole('button', { name: /disconnect/i }).first().waitFor({ state: 'visible' });
				h.assertClean('T1-NET-03');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-NET-04',
		tier: 1,
		area: 'NET',
		milestone: 'M4',
		features: ['#29'],
		title: 'Network diagnostics reporting crossOriginIsolated, DirectSocketsNetwork, and Host Fetch Bridge',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /network/i, { iconFallbackClass: 'fa-wifi' });
				const panel = sidebarPanel(h.page);

				await panel.getByText(/crossOriginIsolated|Cross-Origin Isolated/i).first().waitFor({ state: 'visible' });
				await panel.getByText(/DirectSocketsNetwork|Direct Sockets/i).first().waitFor({ state: 'visible' });
				await panel.getByText(/Host Fetch Bridge|Fetch Bridge/i).first().waitFor({ state: 'visible' });
				h.assertClean('T1-NET-04');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-NET-05',
		tier: 1,
		area: 'NET',
		milestone: 'M4',
		features: ['#29'],
		title: 'Local / Tailscale service preview link builder (127.0.0.1:8080)',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /network/i, { iconFallbackClass: 'fa-wifi' });
				const panel = sidebarPanel(h.page);

				const hostInput = panel.getByLabel(/service host|host/i).first();
				const portInput = panel.getByLabel(/port/i).first();
				await hostInput.waitFor({ state: 'visible' });
				await portInput.waitFor({ state: 'visible' });

				await hostInput.fill('127.0.0.1');
				await portInput.fill('8080');
				await panel.locator('a[href="http://127.0.0.1:8080"]').or(panel.getByText('http://127.0.0.1:8080')).first().waitFor({ state: 'visible' });
				h.assertClean('T1-NET-05');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-NET-06',
		tier: 1,
		area: 'NET',
		milestone: 'M4',
		features: ['#28'],
		title: 'Networking controlUrl preference persistence across page reload',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /network/i, { iconFallbackClass: 'fa-wifi' });

				const ctrlInput = h.page.getByLabel(/control url|headscale/i).first();
				await ctrlInput.waitFor({ state: 'visible' });
				await ctrlInput.fill('https://headscale.persist.test');
				const saveBtn = h.page.getByRole('button', { name: /save|apply/i }).first();
				if ((await saveBtn.count()) > 0) await saveBtn.click();

				await h.page.reload({ waitUntil: 'domcontentloaded' });
				await openSidebarTab(h.page, /network/i, { iconFallbackClass: 'fa-wifi' });
				assert.equal(await h.page.getByLabel(/control url|headscale/i).first().inputValue(), 'https://headscale.persist.test');
				h.assertClean('T1-NET-06');
			} finally {
				await h.close();
			}
		}
	},

	// ======================== SYS ========================
	{
		id: 'T1-SYS-01',
		tier: 1,
		area: 'SYS',
		milestone: 'M5',
		features: ['#30'],
		title: 'Real-time CPU & disk latency sparkline charts (<canvas>/<svg>) in System Monitor',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /system|monitor/i);
				const panel = sidebarPanel(h.page);

				const charts = panel.locator('svg, canvas, [data-testid*="sparkline"] svg, [data-testid*="sparkline"] canvas');
				await charts.first().waitFor({ state: 'visible' });
				const count = await charts.count();
				assert.ok(count >= 2, `Expected at least 2 sparkline charts (CPU + disk latency), found ${count}`);
				const box = await charts.first().boundingBox();
				assert.ok(box && box.width > 20 && box.height > 10, 'Sparkline chart must have non-zero size');
				h.assertClean('T1-SYS-01');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-SYS-02',
		tier: 1,
		area: 'SYS',
		milestone: 'M5',
		features: ['#30'],
		title: 'navigator.storage.estimate() IDB storage quota & memory monitor readout',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /system|monitor/i);
				const panel = sidebarPanel(h.page);

				await panel.getByText(/quota|storage estimate|used/i).first().waitFor({ state: 'visible' });
				await panel.getByText(/memory|heap|ram/i).first().waitFor({ state: 'visible' });
				h.assertClean('T1-SYS-02');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-SYS-03',
		tier: 1,
		area: 'SYS',
		milestone: 'M5',
		features: ['#30'],
		title: 'Process table viewer & stop/kill action control',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /system|monitor|process/i);
				const panel = sidebarPanel(h.page);

				const procTable = panel.locator('table, [role="table"], [data-testid="process-list"]').first();
				await procTable.waitFor({ state: 'visible' });
				await panel.getByRole('button', { name: /kill|stop/i }).first().waitFor({ state: 'attached' });
				h.assertClean('T1-SYS-03');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-SYS-04',
		tier: 1,
		area: 'SYS',
		milestone: 'M5',
		features: ['#31'],
		title: 'VM profile switcher (Debian / Alpine), uid/gid, env (LC_ALL=C), and cmd/args persistence',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /profile|boot/i);
				const panel = sidebarPanel(h.page);

				await selectOptionByLabelRegex(panel.getByLabel(/profile|distro|os/i).first(), /alpine/i);
				await panel.getByLabel(/^uid$/i).first().fill('1000');
				await panel.getByLabel(/^gid$/i).first().fill('1000');
				await panel.getByLabel(/env/i).first().fill('LC_ALL=C\nHOME=/home/user');
				await panel.getByLabel(/command|cmd/i).first().fill('/bin/sh');

				await panel.getByRole('button', { name: /save.*profile|apply/i }).first().click();
				await h.page.reload({ waitUntil: 'load' });
				await waitForAppReady(h.page);
				await openSidebarTab(h.page, /profile|boot/i);
				assert.equal(await panel.getByLabel(/^uid$/i).first().inputValue(), '1000');
				assert.ok((await panel.getByLabel(/env/i).first().inputValue()).includes('LC_ALL=C'));
				h.assertClean('T1-SYS-04');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-SYS-05',
		tier: 1,
		area: 'SYS',
		milestone: 'M5',
		features: ['#31'],
		title: 'Custom .ext2 URL config & graceful local .ext2 (FileDevice unavailable) notice',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /profile|boot/i);
				const panel = sidebarPanel(h.page);

				const ext2Input = panel.getByLabel(/custom.*\.ext2|disk image url/i).first();
				await ext2Input.waitFor({ state: 'visible' });
				await ext2Input.fill('https://disks.example.test/custom.ext2');
				await panel.getByRole('button', { name: /save.*profile|apply/i }).first().click();

				await h.page.reload({ waitUntil: 'load' });
				await waitForAppReady(h.page);
				await openSidebarTab(h.page, /profile|boot/i);
				assert.equal(
					await panel.getByLabel(/custom.*\.ext2|disk image url/i).first().inputValue(),
					'https://disks.example.test/custom.ext2'
				);
				await panel.getByText(/FileDevice|CheerpX 1\.4\.0.*local.*\.ext2/i).first().waitFor({ state: 'visible' });
				h.assertClean('T1-SYS-05');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T1-SYS-06',
		tier: 1,
		area: 'SYS',
		milestone: 'M5',
		features: ['#32'],
		title: 'Lightweight service/daemon & cron supervisor UI (start/stop service, add cron job)',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /service|daemon|cron/i);
				const panel = sidebarPanel(h.page);

				const startBtn = panel.getByRole('button', { name: /^start$/i }).first();
				await startBtn.waitFor({ state: 'visible' });
				await startBtn.click();
				await panel.getByText(/running/i).first().waitFor({ state: 'visible' });

				const stopBtn = panel.getByRole('button', { name: /^stop$/i }).first();
				await stopBtn.click();
				await panel.getByText(/stopped|inactive/i).or(startBtn).first().waitFor({ state: 'visible' });

				const cronInput = panel.getByPlaceholder(/\* \* \* \* \*/).or(panel.getByLabel(/cron schedule/i)).first();
				await cronInput.waitFor({ state: 'visible' });
				await cronInput.fill('*/5 * * * *');
				const cronCmd = panel.getByLabel(/cron command|job command/i).first();
				await cronCmd.fill('echo alive');
				await panel.getByRole('button', { name: /add cron|add job/i }).first().click();
				await panel.getByText('*/5 * * * *').waitFor({ state: 'visible' });
				h.assertClean('T1-SYS-06');
			} finally {
				await h.close();
			}
		}
	}
];
