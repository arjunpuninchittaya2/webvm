import assert from 'node:assert/strict';
import {
	buildElfHeader,
	gotoApp,
	mockCorsResponse,
	openFreshContext,
	openSettingsModal,
	openSidebarTab,
	selectOptionByLabelRegex,
	sidebarPanel,
	toastLocator
} from './helpers.mjs';

export const tier2Tests = [
	// ======================== CORE ========================
	{
		id: 'T2-CORE-01',
		tier: 2,
		area: 'CORE',
		milestone: 'M1',
		features: ['#4', '#5'],
		title: 'Total offline mode leaves UI shell & #console error-free',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, {
				offline: false,
				actionTimeout: ctx.actionTimeout
			});
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /posts|blog/i, { iconFallbackClass: 'fa-book-open' });
				await h.page.getByText('Blog posts', { exact: false }).waitFor({ state: 'visible' });
				const postsOrFallback = h.page.getByText('Blog posts are unavailable offline.', { exact: false }).or(
					h.page.locator('a[href*="labs.leaningtech.com/blog"]').first()
				);
				await postsOrFallback.first().waitFor({ state: 'visible' });

				// Enable full browser offline mode while cached/local routes remain active
				await h.context.setOffline(true);
				await h.page.locator('#console').waitFor({ state: 'visible' });
				const box = await h.page.locator('#console').boundingBox();
				assert.ok(box && box.width > 100 && box.height > 100, '#console must remain sized and visible offline');
				h.assertClean('T2-CORE-01');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-CORE-02',
		tier: 2,
		area: 'CORE',
		milestone: 'M1',
		features: ['#10'],
		title: 'Claude AI HTTP 401/error response displays error without locking aiActivity / #ai-input',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await mockCorsResponse(h.page, 'https://api.anthropic.com/**', {
					status: 401,
					contentType: 'application/json',
					body: JSON.stringify({
						type: 'error',
						error: { type: 'authentication_error', message: 'invalid x-api-key' }
					})
				});

				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /claude|ai/i, { iconFallbackClass: 'fa-robot' });
				const aiInput = h.page.locator('#ai-input');
				await aiInput.waitFor({ state: 'visible' });

				// Enter API key
				await aiInput.fill('sk-ant-invalid-test-key');
				await aiInput.press('Enter');

				// Wait until prompt textarea is active (enabled on /)
				await h.page.waitForFunction(() => {
					const el = document.getElementById('ai-input');
					return el && el.placeholder === 'Prompt...' && !el.disabled;
				});

				await aiInput.fill('echo test');
				await aiInput.press('Enter');

				// Verify error surfaces cleanly and #ai-input recovers instead of getting stuck on Stop
				await h.page.locator('#message-list').getByText(/Invalid API key/i).waitFor({ state: 'visible' });
				await h.page.waitForFunction(() => {
					const el = document.getElementById('ai-input');
					return el && !el.disabled;
				});
				h.assertClean('T2-CORE-02');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-CORE-03',
		tier: 2,
		area: 'CORE',
		milestone: 'M2',
		features: ['#13', '#14'],
		title: 'Terminal search zero matches and regex metacharacters ([.*?) handled without SyntaxError',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
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

				const searchBar = h.page.locator('[data-testid="terminal-search-bar"]').first();
				await searchInput.fill('__NONEXISTENT_TOKEN_999__');
				await searchInput.press('Enter');
				await searchBar.waitFor({ state: 'visible' });
				await searchBar.getByText(/\b0\/0\b|no matches/i).first().waitFor({ state: 'visible' });

				await searchInput.fill('[.*?');
				await searchInput.press('Enter');
				await searchBar.waitFor({ state: 'visible' });
				await searchBar.getByText(/\b0\/0\b|no matches/i).first().waitFor({ state: 'visible' });

				h.assertClean('T2-CORE-03');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-CORE-04',
		tier: 2,
		area: 'CORE',
		milestone: 'M2',
		features: ['#17'],
		title: 'Attempting to close the sole terminal tab keeps a fallback shell active',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				const tabs = h.page.locator('[role="tab"]');
				await tabs.first().waitFor({ state: 'visible' });
				assert.equal(await tabs.count(), 1, 'Expected single initial tab');

				const firstTabWrapper = h.page.locator('[data-testid="terminal-tab-bar"] > div').first();
				const closeBtn = firstTabWrapper.locator('[data-testid^="close-tab-"], button[aria-label^="Close "]').first();
				if ((await closeBtn.count()) > 0 && (await closeBtn.isEnabled())) {
					await closeBtn.click();
				}
				assert.ok((await tabs.count()) >= 1, 'Fallback shell tab must remain active');
				await h.page.locator('#console').waitFor({ state: 'visible' });
				h.assertClean('T2-CORE-04');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-CORE-05',
		tier: 2,
		area: 'CORE',
		milestone: 'M2',
		features: ['#15', '#18'],
		title: 'Narrow mobile viewport (360x640) & rapid resize storm stays non-zero sized without exceptions',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, {
				viewport: { width: 360, height: 640 },
				actionTimeout: ctx.actionTimeout
			});
			try {
				await gotoApp(h.page, ctx.baseUrl, ctx.alpineRoute);
				await h.page.locator('#display').waitFor({ state: 'attached' });
				for (const vp of [
					{ width: 800, height: 600 },
					{ width: 420, height: 700 },
					{ width: 1024, height: 768 },
					{ width: 360, height: 640 }
				]) {
					await h.page.setViewportSize(vp);
				}
				const box = await h.page.locator('#console').boundingBox();
				assert.ok(box && box.width > 100 && box.height > 100, '#console must stay non-zero sized');
				h.assertClean('T2-CORE-05');
			} finally {
				await h.close();
			}
		}
	},

	// ======================== PERF ========================
	{
		id: 'T2-PERF-01',
		tier: 2,
		area: 'PERF',
		milestone: 'M2',
		features: ['#20'],
		title: 'Corrupted localStorage webvm.settings.v1 JSON recovers cleanly to defaults',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, {
				seedLocalStorage: { 'webvm.settings.v1': '{broken_json_!!!' },
				actionTimeout: ctx.actionTimeout
			});
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSettingsModal(h.page);
				const fontInput = h.page.getByLabel(/font size/i).first();
				await fontInput.waitFor({ state: 'visible' });
				const val = Number(await fontInput.inputValue());
				assert.ok(val >= 8 && val <= 48, `Expected recovered default fontSize, got ${val}`);
				h.assertClean('T2-PERF-01');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-PERF-02',
		tier: 2,
		area: 'PERF',
		milestone: 'M2',
		features: ['#20'],
		title: 'Out-of-range font size (2, 200) and negative scrollback (-50) clamped/rejected safely',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSettingsModal(h.page);

				const fontInput = h.page.getByLabel(/font size/i).first();
				await fontInput.waitFor({ state: 'visible' });
				await fontInput.fill('200');
				await fontInput.dispatchEvent('change');
				await fontInput.fill('2');
				await fontInput.dispatchEvent('change');

				const scrollbackInput = h.page.getByLabel(/scrollback/i).first();
				await scrollbackInput.waitFor({ state: 'visible' });
				await scrollbackInput.fill('-50');
				await scrollbackInput.dispatchEvent('change');

				const saved = await h.page.evaluate(() => JSON.parse(localStorage.getItem('webvm.settings.v1') || '{}'));
				assert.ok(Number(saved.fontSize) >= 8 && Number(saved.fontSize) <= 48, `Font size not clamped: ${saved.fontSize}`);
				assert.ok(Number(saved.scrollback ?? 0) >= 0, `Scrollback cannot be negative: ${saved.scrollback}`);
				h.assertClean('T2-PERF-02');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-PERF-03',
		tier: 2,
		area: 'PERF',
		milestone: 'M2',
		features: ['#19'],
		title: 'Clipboard Paste with denied browser permissions shows graceful warning without unhandled rejection',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, {
				actionTimeout: ctx.actionTimeout,
				initScript: () => {
					Object.defineProperty(navigator, 'clipboard', {
						configurable: true,
						value: {
							readText: async () => {
								throw new DOMException('Clipboard permission denied', 'NotAllowedError');
							},
							writeText: async () => {
								throw new DOMException('Clipboard permission denied', 'NotAllowedError');
							}
						}
					});
				}
			});
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				const pasteBtn = h.page.getByRole('button', { name: /paste/i }).first();
				await pasteBtn.waitFor({ state: 'visible' });
				await pasteBtn.click();

				await toastLocator(h.page)
					.filter({ hasText: /clipboard.*(denied|blocked)|permission|unable to paste/i })
					.first()
					.waitFor({ state: 'visible' });
				h.assertClean('T2-PERF-03');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-PERF-04',
		tier: 2,
		area: 'PERF',
		milestone: 'M2',
		features: ['#19'],
		title: 'Virtual sticky modifier (Ctrl/Alt) toggles cleanly on/off without getting stuck',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await h.page.locator('[data-testid="toolbar-vkeys-btn"]').click();
				await h.page.locator('[data-testid="virtual-key-bar"]').waitFor({ state: 'visible' });

				for (const selector of ['[data-testid="vkey-ctrl"]', '[data-testid="vkey-alt"]']) {
					const btn = h.page.locator(selector).first();
					await btn.waitFor({ state: 'visible' });
					await btn.click();
					assert.equal(await btn.getAttribute('aria-pressed'), 'true');
					await btn.click();
					assert.equal(await btn.getAttribute('aria-pressed'), 'false');

					// Test double-click lock & unlock
					await btn.dblclick();
					assert.equal(await btn.getAttribute('data-locked'), 'true');
					await btn.click();
					assert.equal(await btn.getAttribute('aria-pressed'), 'false');
					assert.equal(await btn.getAttribute('data-locked'), 'false');
				}
				h.assertClean('T2-PERF-04');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-PERF-05',
		tier: 2,
		area: 'PERF',
		milestone: 'M5',
		features: ['#33'],
		title: 'WebAudio bell when AudioContext is blocked/suspended runs without NotAllowedError crash',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, {
				actionTimeout: ctx.actionTimeout,
				initScript: () => {
					window.AudioContext = function BlockedAudioContext() {
						throw new DOMException('AudioContext blocked', 'NotAllowedError');
					};
					window.webkitAudioContext = window.AudioContext;
				}
			});
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSettingsModal(h.page);
				const testBellBtn = h.page.getByRole('button', { name: /test bell/i }).first();
				await testBellBtn.waitFor({ state: 'visible' });
				await testBellBtn.click();
				await toastLocator(h.page)
					.filter({ hasText: /bell|notification|visual/i })
					.first()
					.waitFor({ state: 'visible' });
				assert.equal(await testBellBtn.isEnabled(), true);
				h.assertClean('T2-PERF-05');
			} finally {
				await h.close();
			}
		}
	},

	// ======================== FS ========================
	{
		id: 'T2-FS-01',
		tier: 2,
		area: 'FS',
		milestone: 'M3',
		features: ['#22', '#23'],
		title: 'Path-traversal (../escape) and empty filenames rejected in File Manager mkdir/rename',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /files|file manager|workspace/i);
				const panel = sidebarPanel(h.page);

				const mkdirInput = panel.getByPlaceholder(/folder|directory|new dir/i).first();
				await mkdirInput.waitFor({ state: 'visible' });

				await mkdirInput.fill('../escape');
				await panel.getByRole('button', { name: /mkdir|new folder|create folder/i }).first().click();
				await panel.getByText(/invalid|traversal|\.\./i).first().waitFor({ state: 'visible' });

				await mkdirInput.fill('');
				await panel.getByRole('button', { name: /mkdir|new folder|create folder/i }).first().click();
				assert.equal(await panel.getByText('../escape').count(), 0);
				h.assertClean('T2-FS-01');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-FS-02',
		tier: 2,
		area: 'FS',
		milestone: 'M3',
		features: ['#22'],
		title: 'Zero-byte file upload (0 B) and duplicate filename upload handled cleanly',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /files|file manager|workspace/i);
				const panel = sidebarPanel(h.page);

				const input = panel.locator('input[type="file"]').first();
				await input.waitFor({ state: 'attached' });
				await input.setInputFiles({ name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.alloc(0) });
				await panel.getByText('empty.txt').waitFor({ state: 'visible' });

				await input.setInputFiles({ name: 'empty.txt', mimeType: 'text/plain', buffer: Buffer.from('nonempty') });
				await panel.getByText('empty.txt').first().waitFor({ state: 'visible' });
				h.assertClean('T2-FS-02');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-FS-03',
		tier: 2,
		area: 'FS',
		milestone: 'M3',
		features: ['#24'],
		title: 'Corrupted/non-JSON snapshot import rejected cleanly while preserving existing workspace files',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /files|file manager|workspace/i);
				const panel = sidebarPanel(h.page);

				await panel.locator('input[type="file"]').first().setInputFiles({
					name: 'keep-me.txt',
					mimeType: 'text/plain',
					buffer: Buffer.from('important data')
				});
				await panel.getByText('keep-me.txt').waitFor({ state: 'visible' });

				const importInput = panel.locator('input[type="file"][accept*="json" i], input[aria-label*="import snapshot" i]').first();
				await importInput.setInputFiles({
					name: 'corrupt.json',
					mimeType: 'application/json',
					buffer: Buffer.from('{not valid json!!!')
				});
				await panel.getByText(/invalid snapshot|corrupt|failed to import/i).first().waitFor({ state: 'visible' });
				await panel.getByText('keep-me.txt').waitFor({ state: 'visible' });
				h.assertClean('T2-FS-03');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-FS-04',
		tier: 2,
		area: 'FS',
		milestone: 'M3',
		features: ['#25'],
		title: 'Binary/non-UTF8 file guard or unsaved changes warning in Code Editor',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /files|file manager|workspace/i);
				const panel = sidebarPanel(h.page);
				await panel.locator('input[type="file"]').first().setInputFiles({
					name: 'bin.dat',
					mimeType: 'application/octet-stream',
					buffer: Buffer.from([0x00, 0xff, 0xfe, 0x01, 0x02])
				});
				await panel.getByText('bin.dat').waitFor({ state: 'visible' });

				await openSidebarTab(h.page, /editor|code/i);
				const pathInput = panel.getByPlaceholder(/path|filename/i).first();
				await pathInput.fill('bin.dat');
				const openBtn = panel.getByRole('button', { name: /open|load/i }).first();
				if ((await openBtn.count()) > 0) await openBtn.click();

				await panel.getByText(/binary|non-text|cannot edit/i).first().waitFor({ state: 'visible' });
				h.assertClean('T2-FS-04');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-FS-05',
		tier: 2,
		area: 'FS',
		milestone: 'M3',
		features: ['#23'],
		title: 'Non-empty directory deletion removes nested contents cleanly without stale entries',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /files|file manager|workspace/i);
				const panel = sidebarPanel(h.page);

				const mkdirInput = panel.getByPlaceholder(/folder|directory|new dir/i).first();
				await mkdirInput.fill('nested');
				await panel.getByRole('button', { name: /mkdir|new folder|create folder/i }).first().click();
				await panel.getByText('nested').click();

				await panel.locator('input[type="file"]').first().setInputFiles({
					name: 'child.txt',
					mimeType: 'text/plain',
					buffer: Buffer.from('nested child')
				});
				await panel.getByText('child.txt').waitFor({ state: 'visible' });

				// Navigate up and delete nested
				await panel.getByRole('button', { name: /\.\.|up|parent/i }).first().click();
				const nestedRow = panel.locator('[data-file-entry], li, tr').filter({ hasText: 'nested' }).first();
				await nestedRow.getByRole('button', { name: /delete|remove/i }).first().click();
				await panel.getByText('nested').waitFor({ state: 'detached' });
				h.assertClean('T2-FS-05');
			} finally {
				await h.close();
			}
		}
	},

	// ======================== APP ========================
	{
		id: 'T2-APP-01',
		tier: 2,
		area: 'APP',
		milestone: 'M4',
		features: ['#26'],
		title: 'SHA-256 mismatch aborts download and prevents staging untrusted payload into workspace',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await mockCorsResponse(h.page, 'https://downloads.example.test/bad.sh', {
					body: '#!/bin/sh\necho untrusted\n',
					contentType: 'text/plain'
				});

				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /apps|app store|downloader/i);
				const panel = sidebarPanel(h.page);
				const toast = toastLocator(h.page);
				await panel.getByLabel(/url/i).first().fill('https://downloads.example.test/bad.sh');
				await panel.getByLabel(/sha-?256/i).first().fill('0'.repeat(64));
				await panel.getByRole('button', { name: /^download$/i }).first().click();

				await panel.or(toast).getByText(/sha-?256.*mismatch|checksum.*mismatch|verification failed/i).first().waitFor({ state: 'visible' });
				await openSidebarTab(h.page, /files|file manager|workspace/i);
				assert.equal(await panel.getByText('bad.sh').count(), 0, 'Untrusted payload must not be staged');
				h.assertClean('T2-APP-01');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-APP-02',
		tier: 2,
		area: 'APP',
		milestone: 'M4',
		features: ['#26'],
		title: 'Invalid URL scheme (javascript:alert(1)) blocked & HTTP 404 surfaces readable error',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await mockCorsResponse(h.page, 'https://downloads.example.test/missing.bin', {
					status: 404,
					contentType: 'text/plain',
					body: 'Not Found'
				});

				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /apps|app store|downloader/i);
				const panel = sidebarPanel(h.page);
				const toast = toastLocator(h.page);

				const urlInput = panel.getByLabel(/url/i).first();
				await urlInput.fill('javascript:alert(1)');
				await panel.getByRole('button', { name: /^download$/i }).first().click();
				await panel.or(toast).getByText(/invalid url|http\(s\)|scheme/i).first().waitFor({ state: 'visible' });

				await urlInput.fill('https://downloads.example.test/missing.bin');
				await panel.getByRole('button', { name: /^download$/i }).first().click();
				await panel.or(toast).getByText(/404|not found|download.*failed/i).first().waitFor({ state: 'visible' });
				h.assertClean('T2-APP-02');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-APP-03',
		tier: 2,
		area: 'APP',
		milestone: 'M4',
		features: ['#26'],
		title: 'Corrupted .tar.gz extraction failure handled gracefully without partial-state crash',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await mockCorsResponse(h.page, 'https://downloads.example.test/corrupt.tar.gz', {
					body: Buffer.from('not-a-valid-gzip-archive'),
					contentType: 'application/gzip'
				});

				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /apps|app store|downloader/i);
				const panel = sidebarPanel(h.page);
				const toast = toastLocator(h.page);
				await panel.getByLabel(/url/i).first().fill('https://downloads.example.test/corrupt.tar.gz');
				const extractChk = panel.getByLabel(/extract/i).first();
				if ((await extractChk.count()) > 0) await extractChk.check();

				await panel.getByRole('button', { name: /^download/i }).first().click();
				await panel.or(toast).getByText(/extract.*fail|invalid.*archive|corrupt|gzip/i).first().waitFor({ state: 'visible' });
				h.assertClean('T2-APP-03');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-APP-04',
		tier: 2,
		area: 'APP',
		milestone: 'M4',
		features: ['#27'],
		title: 'Unsupported 64-bit x86_64 ELF rejected with CheerpX 32-bit i386-only message',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /files|file manager|workspace/i);
				const panel = sidebarPanel(h.page);
				const toast = toastLocator(h.page);
				await panel.locator('input[type="file"]').first().setInputFiles({
					name: 'app64',
					mimeType: 'application/octet-stream',
					buffer: buildElfHeader({ machine: 'x86_64' })
				});
				await panel.getByText('app64').waitFor({ state: 'visible' });

				const row = panel.locator('[data-file-entry], li, tr').filter({ hasText: 'app64' }).first();
				await row.getByRole('button', { name: /run/i }).first().click();
				await panel.or(toast).getByText(/32-bit|i386|x86_64.*unsupported/i).first().waitFor({ state: 'visible' });
				h.assertClean('T2-APP-04');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-APP-05',
		tier: 2,
		area: 'APP',
		milestone: 'M4',
		features: ['#29'],
		title: 'Web Preview on non-existent workspace path shows "File not found" safely',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /preview/i);
				const panel = sidebarPanel(h.page);
				const pathInput = panel.getByLabel(/file|path/i).first();
				await pathInput.waitFor({ state: 'visible' });
				await pathInput.fill('does-not-exist.html');
				await panel.getByRole('button', { name: /render|open preview|preview/i }).first().click();
				await panel.getByText(/file not found|not found/i).first().waitFor({ state: 'visible' });
				h.assertClean('T2-APP-05');
			} finally {
				await h.close();
			}
		}
	},

	// ======================== NET ========================
	{
		id: 'T2-NET-01',
		tier: 2,
		area: 'NET',
		milestone: 'M4',
		features: ['#28'],
		title: 'Malformed Headscale controlUrl rejected with inline validation error',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /network/i, { iconFallbackClass: 'fa-wifi' });
				const panel = sidebarPanel(h.page);
				const ctrlInput = panel.getByLabel(/control url|headscale/i).first();
				await ctrlInput.waitFor({ state: 'visible' });
				await ctrlInput.fill('ftp://not-valid-headscale');
				await panel.getByRole('button', { name: /connect|apply|save/i }).first().click();
				await panel.getByText(/invalid.*url|https?:\/\//i).first().waitFor({ state: 'visible' });
				h.assertClean('T2-NET-01');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-NET-02',
		tier: 2,
		area: 'NET',
		milestone: 'M4',
		features: ['#28'],
		title: 'Double-clicking connect with blocked popup stays idempotent without null dereference',
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
				await connectBtn.dblclick();
				await panel.locator('a[href*="login.html"], [data-testid="tailscale-login-fallback"]').first().waitFor({ state: 'visible' });
				h.assertClean('T2-NET-02');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-NET-03',
		tier: 2,
		area: 'NET',
		milestone: 'M4',
		features: ['#28'],
		title: 'Clicking Disconnect while already disconnected is safe/disabled',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /network/i, { iconFallbackClass: 'fa-wifi' });
				const panel = sidebarPanel(h.page);
				const discBtn = panel.getByRole('button', { name: /disconnect/i }).first();
				await discBtn.waitFor({ state: 'visible' });
				if (await discBtn.isEnabled()) {
					await discBtn.click();
				}
				await panel.getByText(/disconnected|not connected/i).first().waitFor({ state: 'visible' });
				assert.equal(await discBtn.isDisabled(), true, 'Disconnect button must be disabled when disconnected');
				h.assertClean('T2-NET-03');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-NET-04',
		tier: 2,
		area: 'NET',
		milestone: 'M4',
		features: ['#29'],
		title: 'Out-of-range service preview port (99999) rejected with 1-65535 validation',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /network/i, { iconFallbackClass: 'fa-wifi' });
				const panel = sidebarPanel(h.page);
				const portInput = panel.getByLabel(/port/i).first();
				await portInput.waitFor({ state: 'visible' });
				await portInput.fill('99999');
				await portInput.dispatchEvent('change');
				await panel.getByText(/1.*65535|invalid port/i).first().waitFor({ state: 'visible' });
				h.assertClean('T2-NET-04');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-NET-05',
		tier: 2,
		area: 'NET',
		milestone: 'M4',
		features: ['#29'],
		title: 'Network diagnostics under context.setOffline(true) accurately reports offline state',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await h.context.setOffline(true);
				await h.page.evaluate(() => window.dispatchEvent(new Event('offline')));
				await openSidebarTab(h.page, /network/i, { iconFallbackClass: 'fa-wifi' });
				const panel = sidebarPanel(h.page);
				await panel.getByText(/offline/i).first().waitFor({ state: 'visible' });
				h.assertClean('T2-NET-05');
			} finally {
				await h.close();
			}
		}
	},

	// ======================== SYS ========================
	{
		id: 'T2-SYS-01',
		tier: 2,
		area: 'SYS',
		milestone: 'M5',
		features: ['#31'],
		title: 'Invalid uid (-1) or malformed env line (INVALID_NO_EQUALS) rejected cleanly',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /profile|boot/i);
				const panel = sidebarPanel(h.page);

				const uidInput = panel.getByLabel(/^uid$/i).first();
				await uidInput.waitFor({ state: 'visible' });
				await uidInput.fill('-1');
				await panel.getByLabel(/env/i).first().fill('INVALID_NO_EQUALS');
				await panel.getByRole('button', { name: /save.*profile|apply/i }).first().click();

				await panel.getByText(/invalid.*uid|KEY=VALUE|malformed/i).first().waitFor({ state: 'visible' });
				h.assertClean('T2-SYS-01');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-SYS-02',
		tier: 2,
		area: 'SYS',
		milestone: 'M5',
		features: ['#31'],
		title: 'Invalid/unreachable custom .ext2 URL (ftp://bad/disk.ext2) allows safe recovery to Debian profile',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /profile|boot/i);
				const panel = sidebarPanel(h.page);

				const ext2Input = panel.getByLabel(/custom.*\.ext2|disk image url/i).first();
				await ext2Input.waitFor({ state: 'visible' });
				await ext2Input.fill('ftp://bad/disk.ext2');
				const applyBtn = panel.getByRole('button', { name: /save.*profile|apply/i }).first();
				await applyBtn.click();
				await panel.getByText(/invalid.*url|https?:\/\//i).first().waitFor({ state: 'visible' });

				const profileSelect = panel.getByLabel(/profile|distro|os/i).first();
				await selectOptionByLabelRegex(profileSelect, /debian/i);
				assert.match(await profileSelect.inputValue(), /debian/i, 'Profile must recover to Debian');
				h.assertClean('T2-SYS-02');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-SYS-03',
		tier: 2,
		area: 'SYS',
		milestone: 'M5',
		features: ['#30'],
		title: 'Kill/Stop on exited/empty process entry handles safely without pageerror',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /system|monitor|process/i);
				const panel = sidebarPanel(h.page);
				const stopBtns = panel.getByRole('button', { name: /kill|stop/i });
				if ((await stopBtns.count()) > 0 && (await stopBtns.first().isEnabled())) {
					await stopBtns.first().click();
					await panel.waitFor({ state: 'visible' });
					await panel.getByText(/exited|stopped|terminated|no active.*process|no processes/i).first().waitFor({ state: 'visible' });
				} else {
					await panel.getByText(/no active.*process|no processes/i).first().waitFor({ state: 'visible' });
				}
				h.assertClean('T2-SYS-03');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-SYS-04',
		tier: 2,
		area: 'SYS',
		milestone: 'M5',
		features: ['#32'],
		title: 'Invalid cron schedule (99 99 * * *) rejected by Cron Supervisor validation',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /service|daemon|cron/i);
				const panel = sidebarPanel(h.page);
				const cronInput = panel.getByPlaceholder(/\* \* \* \* \*/).or(panel.getByLabel(/cron schedule/i)).first();
				await cronInput.waitFor({ state: 'visible' });
				await cronInput.fill('99 99 * * *');
				await panel.getByLabel(/cron command|job command/i).first().fill('echo bad');
				await panel.getByRole('button', { name: /add cron|add job/i }).first().click();

				await panel.getByText(/invalid cron|cron schedule/i).first().waitFor({ state: 'visible' });
				h.assertClean('T2-SYS-04');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T2-SYS-05',
		tier: 2,
		area: 'SYS',
		milestone: 'M5',
		features: ['#30'],
		title: 'navigator.storage.estimate === undefined fallback renders "Unavailable" without pageerror',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, {
				actionTimeout: ctx.actionTimeout,
				initScript: () => {
					if (navigator.storage) {
						Object.defineProperty(navigator.storage, 'estimate', {
							configurable: true,
							value: undefined
						});
					}
				}
			});
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /system|monitor/i);
				const panel = sidebarPanel(h.page);
				await panel.getByText(/storage|quota|idb/i).first().waitFor({ state: 'visible' });
				await panel.getByText(/unavailable/i).first().waitFor({ state: 'visible' });
				h.assertClean('T2-SYS-05');
			} finally {
				await h.close();
			}
		}
	}
];
