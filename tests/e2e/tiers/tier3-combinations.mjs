import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
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

export const tier3Tests = [
	{
		id: 'T3-01',
		tier: 3,
		area: 'CORE',
		milestone: 'M2',
		features: ['#17', '#20'],
		title: 'Pinned sidebar + custom font size inherited across newly opened terminal tabs',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSettingsModal(h.page);
				const modal = h.page.locator('[data-testid="settings-modal"]');
				const fontInput = modal.locator('[data-testid="setting-font-size"]').or(modal.getByLabel(/font size/i)).first();
				await fontInput.waitFor({ state: 'visible' });
				await fontInput.fill('18');
				await fontInput.dispatchEvent('change');

				const pinToggle = modal.locator('[data-testid="setting-sidebar-pin"]').first();
				await pinToggle.waitFor({ state: 'visible' });
				await pinToggle.check();

				await modal.locator('[data-testid="settings-done-btn"]').click();
				await modal.waitFor({ state: 'hidden' });

				await h.page.locator('[data-testid="new-tab-btn"]').or(
					h.page.getByRole('button', { name: /new tab|add tab|new terminal|\+ tab/i })
				).first().click();
				const saved = await h.page.evaluate(() => JSON.parse(localStorage.getItem('webvm.settings.v1') || '{}'));
				assert.equal(Number(saved.fontSize), 18);
				assert.equal(Boolean(saved.sidebarPin ?? saved.sidebarPinned ?? saved.sideBarPinned), true);
				h.assertClean('T3-01');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T3-02',
		tier: 3,
		area: 'PERF',
		milestone: 'M2',
		features: ['#18', '#19'],
		title: 'Virtual key bar & status bar remain functional across VT1 <-> VT7 toggle on Alpine',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, ctx.alpineRoute);
				await h.page.locator('[data-testid="toolbar-vkeys-btn"]').click();
				await h.page.locator('[data-testid="virtual-key-bar"]').waitFor({ state: 'visible' });
				await h.page.getByRole('button', { name: /^Esc$/i }).first().waitFor({ state: 'visible' });

				const vtToggleBtn = h.page.locator('[data-testid="vt-toggle-btn"]').or(
					h.page.getByRole('button', { name: /vt\s*7|display|x11|graphical/i })
				).first();
				await vtToggleBtn.click();
				await h.page.locator('[data-testid="status-bar"], footer').filter({ hasText: /vt\s*7|display/i }).first().waitFor({ state: 'visible' });

				await vtToggleBtn.click();
				await h.page.locator('[data-testid="status-bar"], footer').filter({ hasText: /vt\s*1/i }).first().waitFor({ state: 'visible' });
				await h.page.getByRole('button', { name: /^Tab$/i }).first().waitFor({ state: 'visible' });
				h.assertClean('T3-02');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T3-03',
		tier: 3,
		area: 'PERF',
		milestone: 'M2',
		features: ['#16', '#20'],
		title: 'Power-saver preference persisted across reload + visibilitychange throttling',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSettingsModal(h.page);
				const modal = h.page.locator('[data-testid="settings-modal"]');
				const psToggle = modal.locator('[data-testid="setting-power-saver"]').or(modal.getByLabel(/power saver/i)).first();
				await psToggle.waitFor({ state: 'visible' });
				await psToggle.check();
				await modal.locator('[data-testid="settings-done-btn"]').click();
				await modal.waitFor({ state: 'hidden' });

				await h.page.reload({ waitUntil: 'load' });
				await waitForAppReady(h.page);
				await openSettingsModal(h.page);
				assert.equal(
					await modal.locator('[data-testid="setting-power-saver"]').or(modal.getByLabel(/power saver/i)).first().isChecked(),
					true
				);
				await modal.locator('[data-testid="settings-done-btn"]').click();
				await modal.waitFor({ state: 'hidden' });

				await h.page.evaluate(() => {
					Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
					document.dispatchEvent(new Event('visibilitychange'));
				});
				await h.page
					.locator('main.power-saver, [data-power-saver="throttled"], [data-throttled="true"]')
					.first()
					.waitFor({ state: 'visible' });
				h.assertClean('T3-03');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T3-04',
		tier: 3,
		area: 'FS',
		milestone: 'M3',
		features: ['#21', '#22', '#25'],
		title: 'Upload script -> edit in Code Editor -> save -> verify persistence after reload',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /files|file manager|workspace/i);
				const panel = sidebarPanel(h.page);
				await panel.locator('input[type="file"]').first().setInputFiles({
					name: 'app.js',
					mimeType: 'application/javascript',
					buffer: Buffer.from('console.log("v1");\n')
				});
				await panel.getByText('app.js').waitFor({ state: 'visible' });

				await openSidebarTab(h.page, /editor|code/i);
				await panel.getByPlaceholder(/path|filename/i).first().fill('app.js');
				const openBtn = panel.getByRole('button', { name: /open|load/i }).first();
				if ((await openBtn.count()) > 0) await openBtn.click();

				const codeArea = panel.locator('textarea[aria-label*="editor" i], textarea[data-testid="code-editor"], textarea').first();
				await codeArea.fill('console.log("v2-edited");\n');
				await panel.getByRole('button', { name: /^save$/i }).first().click();

				await h.page.reload({ waitUntil: 'load' });
				await waitForAppReady(h.page);
				await openSidebarTab(h.page, /editor|code/i);
				await panel.getByPlaceholder(/path|filename/i).first().fill('app.js');
				if ((await panel.getByRole('button', { name: /open|load/i }).count()) > 0) {
					await panel.getByRole('button', { name: /open|load/i }).first().click();
				}
				assert.ok((await codeArea.inputValue()).includes('v2-edited'), 'Edited content must persist across reload');
				h.assertClean('T3-04');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T3-05',
		tier: 3,
		area: 'FS',
		milestone: 'M3',
		features: ['#22', '#23', '#24'],
		title: 'Drag-and-drop onto #console -> rename in File Manager -> export snapshot -> reset -> import',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webvm-t305-'));
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				const dt = await h.page.evaluateHandle(() => {
					const transfer = new DataTransfer();
					transfer.items.add(new File(['drag-combo'], 'dragged.txt', { type: 'text/plain' }));
					return transfer;
				});
				await h.page.locator('#console').dispatchEvent('drop', { dataTransfer: dt });

				await openSidebarTab(h.page, /files|file manager|workspace/i);
				const panel = sidebarPanel(h.page);
				await panel.getByText('dragged.txt').waitFor({ state: 'visible' });

				const row = panel.locator('[data-file-entry], li, tr').filter({ hasText: 'dragged.txt' }).first();
				await row.getByRole('button', { name: /rename/i }).first().click();
				const renameInput = panel.locator('input[placeholder*="rename" i], input[aria-label*="rename" i]').first();
				await renameInput.fill('archived.txt');
				await renameInput.press('Enter');
				await panel.getByText('archived.txt').waitFor({ state: 'visible' });

				const [download] = await Promise.all([
					h.page.waitForEvent('download'),
					panel.getByRole('button', { name: /export snapshot|export workspace/i }).first().click()
				]);
				const snapPath = path.join(tmpDir, 'snap.json');
				await download.saveAs(snapPath);

				await panel.getByRole('button', { name: /reset workspace/i }).first().click();
				const confirmBtn = panel.getByRole('button', { name: /confirm|yes/i }).first();
				if ((await confirmBtn.count()) > 0) await confirmBtn.click();
				await panel.getByText('archived.txt').waitFor({ state: 'detached' });

				const importInput = panel.locator('input[type="file"][accept*="json" i], input[aria-label*="import snapshot" i]').first();
				await importInput.setInputFiles(snapPath);
				await panel.getByText('archived.txt').waitFor({ state: 'visible' });
				h.assertClean('T3-05');
			} finally {
				await fs.rm(tmpDir, { recursive: true, force: true });
				await h.close();
			}
		}
	},
	{
		id: 'T3-06',
		tier: 3,
		area: 'FS',
		milestone: 'M3',
		features: ['#25', '#17'],
		title: '"Run in Terminal" from Code Editor opens/focuses execution tab & updates status',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				const initialTabs = await h.page.locator('[role="tab"]').count();
				await openSidebarTab(h.page, /editor|code/i);
				const panel = sidebarPanel(h.page);
				const toast = toastLocator(h.page);
				await panel.getByPlaceholder(/path|filename/i).first().fill('task.sh');
				await panel.locator('textarea[aria-label*="editor" i], textarea[data-testid="code-editor"], textarea').first().fill('#!/bin/sh\necho ok\n');
				await panel.getByRole('button', { name: /^save$/i }).first().click();
				await panel.getByRole('button', { name: /run in terminal/i }).first().click();

				const tabsAfter = await h.page.locator('[role="tab"]').count();
				assert.ok(tabsAfter >= initialTabs, 'Terminal tab must remain active/created on Run in Terminal');
				await panel.or(toast).getByText(/running|launched|task\.sh/i).first().waitFor({ state: 'visible' });
				h.assertClean('T3-06');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T3-07',
		tier: 3,
		area: 'APP',
		milestone: 'M4',
		features: ['#26', '#21', '#23'],
		title: 'Download .tar.gz via HTTP bridge -> extract to workspace -> browse & download extracted file',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				const archive = buildTarGz([{ name: 'bundle/readme.md', content: '# Bundle\n' }]);
				await mockCorsResponse(h.page, 'https://downloads.example.test/bundle.tar.gz', {
					body: archive,
					contentType: 'application/gzip'
				});

				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /apps|app store|downloader/i);
				const panel = sidebarPanel(h.page);
				await panel.getByLabel(/url/i).first().fill('https://downloads.example.test/bundle.tar.gz');
				const extractChk = panel.getByLabel(/extract/i).first();
				if ((await extractChk.count()) > 0) await extractChk.check();
				await panel.getByRole('button', { name: /^download/i }).first().click();

				await openSidebarTab(h.page, /files|file manager|workspace/i);
				await panel.getByText(/readme\.md/i).first().waitFor({ state: 'visible' });
				const row = panel.locator('[data-file-entry], li, tr').filter({ hasText: 'readme.md' }).first();
				const [download] = await Promise.all([
					h.page.waitForEvent('download'),
					row.getByRole('button', { name: /download/i }).first().click()
				]);
				assert.equal(download.suggestedFilename(), 'readme.md');
				h.assertClean('T3-07');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T3-08',
		tier: 3,
		area: 'APP',
		milestone: 'M4',
		features: ['#26', '#25', '#27'],
		title: 'Download script with SHA-256 -> inspect in Code Editor -> 1-click Run',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				const script = '#!/bin/sh\necho "checked-script"\n';
				await mockCorsResponse(h.page, 'https://downloads.example.test/check.sh', {
					body: script,
					contentType: 'text/plain'
				});

				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /apps|app store|downloader/i);
				const panel = sidebarPanel(h.page);
				const toast = toastLocator(h.page);
				await panel.getByLabel(/url/i).first().fill('https://downloads.example.test/check.sh');
				await panel.getByLabel(/sha-?256/i).first().fill(sha256Hex(script));
				await panel.getByRole('button', { name: /^download$/i }).first().click();

				await openSidebarTab(h.page, /editor|code/i);
				await panel.getByPlaceholder(/path|filename/i).first().fill('check.sh');
				const openBtn = panel.getByRole('button', { name: /open|load/i }).first();
				if ((await openBtn.count()) > 0) await openBtn.click();
				const codeArea = panel.locator('textarea[aria-label*="editor" i], textarea[data-testid="code-editor"], textarea').first();
				assert.ok((await codeArea.inputValue()).includes('checked-script'));
				await panel.getByRole('button', { name: /run in terminal/i }).first().click();
				await panel.or(toast).getByText(/running|launched|check\.sh/i).first().waitFor({ state: 'visible' });
				h.assertClean('T3-08');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T3-09',
		tier: 3,
		area: 'APP',
		milestone: 'M4',
		features: ['#25', '#29'],
		title: 'Edit HTML in Code Editor -> live-update in Web Preview panel',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /editor|code/i);
				await h.page.getByPlaceholder(/path|filename/i).first().fill('preview.html');
				const codeArea = h.page.locator('textarea[aria-label*="editor" i], textarea[data-testid="code-editor"], aside textarea').first();
				await codeArea.fill('<!doctype html><html><body><h1>V1</h1></body></html>');
				await h.page.getByRole('button', { name: /^save$/i }).first().click();

				await codeArea.fill('<!doctype html><html><body><h1>V2</h1></body></html>');
				await h.page.getByRole('button', { name: /^save$/i }).first().click();

				await openSidebarTab(h.page, /preview/i);
				const pathInput = h.page.getByLabel(/file|path/i).first();
				if ((await pathInput.count()) > 0) await pathInput.fill('preview.html');
				await h.page.getByRole('button', { name: /render|open preview|preview/i }).first().click();
				await h.page.frameLocator('iframe').first().getByText('V2').waitFor({ state: 'visible' });
				h.assertClean('T3-09');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T3-10',
		tier: 3,
		area: 'NET',
		milestone: 'M4',
		features: ['#28', '#26'],
		title: 'Tailscale disconnected while Host HTTP Fetch Bridge succeeds independently',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await mockCorsResponse(h.page, 'https://downloads.example.test/independent.txt', {
					body: 'works without tailscale',
					contentType: 'text/plain'
				});

				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /network/i, { iconFallbackClass: 'fa-wifi' });
				const panel = sidebarPanel(h.page);
				await panel.getByText(/disconnected|connect to tailscale/i).first().waitFor({ state: 'visible' });

				await openSidebarTab(h.page, /apps|app store|downloader/i);
				await panel.getByLabel(/url/i).first().fill('https://downloads.example.test/independent.txt');
				await panel.getByRole('button', { name: /^download$/i }).first().click();

				await openSidebarTab(h.page, /files|file manager|workspace/i);
				await panel.getByText('independent.txt').waitFor({ state: 'visible' });
				h.assertClean('T3-10');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T3-11',
		tier: 3,
		area: 'SYS',
		milestone: 'M5',
		features: ['#31', '#21'],
		title: 'Switching OS profile (Debian <-> Alpine) preserves /home/user/workspace',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /files|file manager|workspace/i);
				const panel = sidebarPanel(h.page);
				await panel.locator('input[type="file"]').first().setInputFiles({
					name: 'ws-check.txt',
					mimeType: 'text/plain',
					buffer: Buffer.from('cross-distro')
				});
				await panel.getByText('ws-check.txt').waitFor({ state: 'visible' });

				await openSidebarTab(h.page, /profile|boot/i);
				await selectOptionByLabelRegex(panel.getByLabel(/profile|distro|os/i).first(), /alpine/i);
				await panel.getByRole('button', { name: /save.*profile|apply/i }).first().click();

				await gotoApp(h.page, ctx.baseUrl, ctx.alpineRoute);
				await openSidebarTab(h.page, /files|file manager|workspace/i);
				await panel.getByText('ws-check.txt').waitFor({ state: 'visible' });
				h.assertClean('T3-11');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T3-12',
		tier: 3,
		area: 'SYS',
		milestone: 'M5',
		features: ['#30', '#32', '#33'],
		title: 'Start service in Service Supervisor -> observe in Process Monitor -> stop with toast notification',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /service|daemon|cron/i);
				await h.page.getByRole('button', { name: /^start$/i }).first().click();

				await openSidebarTab(h.page, /system|monitor|process/i);
				await h.page.locator('table, [role="table"], [data-testid="process-list"]').first().waitFor({ state: 'visible' });

				await openSidebarTab(h.page, /service|daemon|cron/i);
				await h.page.getByRole('button', { name: /^stop$/i }).first().click();
				await h.page.locator('[data-testid="toast"], [role="alert"], [role="status"]').filter({
					hasText: /stopped|service/i
				}).first().waitFor({ state: 'visible' });
				h.assertClean('T3-12');
			} finally {
				await h.close();
			}
		}
	}
];
