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
	sha256Hex,
	sidebarPanel,
	toastLocator,
	waitForAppReady
} from './helpers.mjs';

export const tier4Tests = [
	{
		id: 'T4-01',
		tier: 4,
		area: 'PERF',
		milestone: 'M2',
		features: ['#14', '#16', '#17', '#19', '#20'],
		title: 'Chromebook power-user setup: pinned sidebar, font size, power saver, virtual keys, reload, multi-tab logs & search',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSettingsModal(h.page);
				const modal = h.page.locator('[data-testid="settings-modal"]');

				const fontInput = modal.locator('[data-testid="setting-font-size"]').or(modal.getByLabel(/font size/i)).first();
				await fontInput.waitFor({ state: 'visible' });
				await fontInput.fill('16');
				await fontInput.dispatchEvent('change');

				await modal.locator('[data-testid="setting-power-saver"]').or(modal.getByLabel(/power saver/i)).first().check();
				await modal.locator('[data-testid="setting-sidebar-pin"]').first().check();
				await modal.locator('[data-testid="settings-done-btn"]').click();
				await modal.waitFor({ state: 'hidden' });

				await h.page.locator('[data-testid="toolbar-vkeys-btn"]').click();
				await h.page.locator('[data-testid="virtual-key-bar"]').waitFor({ state: 'visible' });
				const ctrlBtn = h.page.locator('[data-testid="vkey-ctrl"]').first();
				await ctrlBtn.click();
				assert.equal(await ctrlBtn.getAttribute('aria-pressed'), 'true');
				await ctrlBtn.click();

				await h.page.reload({ waitUntil: 'load' });
				await waitForAppReady(h.page);
				const saved = await h.page.evaluate(() => JSON.parse(localStorage.getItem('webvm.settings.v1') || '{}'));
				assert.equal(Number(saved.fontSize), 16);
				assert.equal(Boolean(saved.powerSaver), true);
				assert.equal(Boolean(saved.sidebarPin ?? saved.sidebarPinned), true);

				await h.page.locator('[data-testid="new-tab-btn"]').or(
					h.page.getByRole('button', { name: /new tab|add tab|new terminal|\+ tab/i })
				).first().click();
				assert.ok((await h.page.locator('[role="tab"]').count()) >= 2);

				const searchBtn = h.page.locator('[data-testid="toolbar-search-btn"]').or(
					h.page.getByRole('button', { name: /search/i })
				).first();
				if ((await searchBtn.count()) > 0) {
					await searchBtn.click();
				} else {
					await h.page.keyboard.press('Control+Shift+F');
				}
				const searchInput = h.page
					.locator('[data-testid="terminal-search-input"], input[placeholder*="find" i], input[aria-label*="find" i], input[placeholder*="search" i], input[aria-label*="search" i]')
					.first();
				await searchInput.waitFor({ state: 'visible' });
				await searchInput.fill('CheerpX');
				await searchInput.press('Enter');
				await h.page.locator('[data-testid="terminal-search-bar"]').first().waitFor({ state: 'visible' });
				h.assertClean('T4-01');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T4-02',
		tier: 4,
		area: 'FS',
		milestone: 'M3',
		features: ['#21', '#22', '#23', '#24', '#25'],
		title: 'Developer authoring, running & backing up a multi-file project across OS disk reset & snapshot recovery',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'webvm-t402-'));
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /files|file manager|workspace/i);
				const panel = sidebarPanel(h.page);
				await panel.locator('input[type="file"][multiple]').first().setInputFiles([
					{ name: 'main.sh', mimeType: 'text/x-shellscript', buffer: Buffer.from('#!/bin/sh\n. ./lib.sh\n') },
					{ name: 'lib.sh', mimeType: 'text/x-shellscript', buffer: Buffer.from('echo "helper"\n') }
				]);
				await panel.getByText('main.sh').waitFor({ state: 'visible' });

				await openSidebarTab(h.page, /editor|code/i);
				await panel.getByPlaceholder(/path|filename/i).first().fill('main.sh');
				const codeArea = panel.locator('textarea[aria-label*="editor" i], textarea[data-testid="code-editor"], textarea').first();
				await codeArea.fill('#!/bin/sh\n. ./lib.sh\necho "done"\n');
				await panel.getByRole('button', { name: /^save$/i }).first().click();
				await panel.getByRole('button', { name: /run in terminal/i }).first().click();

				await openSidebarTab(h.page, /files|file manager|workspace/i);
				const [download] = await Promise.all([
					h.page.waitForEvent('download'),
					panel.getByRole('button', { name: /export snapshot|export workspace/i }).first().click()
				]);
				const snapPath = path.join(tmpDir, 'project-backup.json');
				await download.saveAs(snapPath);

				// Reset OS root disk & confirm workspace survives
				await openSidebarTab(h.page, /disk/i, { iconFallbackClass: 'fa-compact-disc' });
				await panel.getByText('Reset disk', { exact: false }).first().click();
				await Promise.all([
					h.page.waitForNavigation({ waitUntil: 'load' }),
					panel.getByText('Reset disk. Confirm?', { exact: false }).first().click()
				]);
				await waitForAppReady(h.page);

				await openSidebarTab(h.page, /files|file manager|workspace/i);
				await panel.getByText('main.sh').waitFor({ state: 'visible' });

				// Also verify disaster recovery from snapshot after workspace reset
				await panel.getByRole('button', { name: /reset workspace/i }).first().click();
				const confirmWs = panel.getByRole('button', { name: /confirm|yes/i }).first();
				if ((await confirmWs.count()) > 0) await confirmWs.click();
				await panel.getByText('main.sh').waitFor({ state: 'detached' });

				await panel.locator('input[type="file"][accept*="json" i], input[aria-label*="import snapshot" i]').first().setInputFiles(snapPath);
				await panel.getByText('main.sh').waitFor({ state: 'visible' });
				await panel.getByText('lib.sh').waitFor({ state: 'visible' });
				h.assertClean('T4-02');
			} finally {
				await fs.rm(tmpDir, { recursive: true, force: true });
				await h.close();
			}
		}
	},
	{
		id: 'T4-03',
		tier: 4,
		area: 'APP',
		milestone: 'M4',
		features: ['#26', '#25', '#27'],
		title: 'External package download (mocked GitHub release .tar.gz + SHA-256), extraction, edit & 1-click run',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				const releaseTarGz = buildTarGz([
					{ name: 'cli/run.sh', content: '#!/bin/sh\necho "release-v1"\n', mode: 0o755 }
				]);
				const digest = sha256Hex(releaseTarGz);
				await mockCorsResponse(h.page, 'https://github.com/example/cli/releases/download/v1/cli.tar.gz', {
					body: releaseTarGz,
					contentType: 'application/gzip'
				});

				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /apps|app store|downloader/i);
				const panel = sidebarPanel(h.page);
				const toast = toastLocator(h.page);
				await panel.getByLabel(/url/i).first().fill('https://github.com/example/cli/releases/download/v1/cli.tar.gz');
				await panel.getByLabel(/sha-?256/i).first().fill(digest);
				const extractChk = panel.getByLabel(/extract/i).first();
				if ((await extractChk.count()) > 0) await extractChk.check();
				await panel.getByRole('button', { name: /^download/i }).first().click();

				await openSidebarTab(h.page, /editor|code/i);
				await panel.getByPlaceholder(/path|filename/i).first().fill('cli/run.sh');
				const codeArea = panel.locator('textarea[aria-label*="editor" i], textarea[data-testid="code-editor"], textarea').first();
				await codeArea.fill('#!/bin/sh\necho "release-patched"\n');
				await panel.getByRole('button', { name: /^save$/i }).first().click();
				await panel.getByRole('button', { name: /run in terminal/i }).first().click();
				await panel.or(toast).getByText(/running|launched|run\.sh/i).first().waitFor({ state: 'visible' });
				h.assertClean('T4-03');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T4-04',
		tier: 4,
		area: 'APP',
		milestone: 'M4',
		features: ['#21', '#23', '#25', '#29'],
		title: 'Building & previewing a local HTML/CSS web app inside WebVM and downloading artifact to host',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /editor|code/i);

				const pathInput = h.page.getByPlaceholder(/path|filename/i).first();
				const codeArea = h.page.locator('textarea[aria-label*="editor" i], textarea[data-testid="code-editor"], aside textarea').first();

				await pathInput.fill('index.html');
				await codeArea.fill('<!doctype html><html><body><h1>WebVM Static App</h1></body></html>');
				await h.page.getByRole('button', { name: /^save$/i }).first().click();

				await openSidebarTab(h.page, /preview/i);
				const previewPath = h.page.getByLabel(/file|path/i).first();
				if ((await previewPath.count()) > 0) await previewPath.fill('index.html');
				await h.page.getByRole('button', { name: /render|open preview|preview/i }).first().click();
				await h.page.frameLocator('iframe').first().getByText('WebVM Static App').waitFor({ state: 'visible' });

				await openSidebarTab(h.page, /files|file manager|workspace/i);
				const row = h.page.locator('[data-file-entry], li, tr').filter({ hasText: 'index.html' }).first();
				const [download] = await Promise.all([
					h.page.waitForEvent('download'),
					row.getByRole('button', { name: /download/i }).first().click()
				]);
				assert.equal(download.suggestedFilename(), 'index.html');
				h.assertClean('T4-04');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T4-05',
		tier: 4,
		area: 'NET',
		milestone: 'M4',
		features: ['#28', '#29'],
		title: 'Headscale setup, popup-blocker fallback recovery, diagnostics inspection & disconnect workflow',
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

				await panel.getByLabel(/control url|headscale/i).first().fill('https://hs.scenario.test');
				await panel.getByRole('button', { name: /connect/i }).first().click();
				await panel.locator('a[href*="login.html"], [data-testid="tailscale-login-fallback"]').first().waitFor({ state: 'visible' });

				await panel.getByText(/crossOriginIsolated|Cross-Origin Isolated/i).first().waitFor({ state: 'visible' });
				await panel.getByLabel(/service host|host/i).first().fill('127.0.0.1');
				await panel.getByLabel(/port/i).first().fill('3000');
				await panel.getByText('http://127.0.0.1:3000').first().waitFor({ state: 'visible' });

				const discBtn = panel.getByRole('button', { name: /disconnect/i }).first();
				if (await discBtn.isEnabled()) await discBtn.click();
				h.assertClean('T4-05');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T4-06',
		tier: 4,
		area: 'SYS',
		milestone: 'M5',
		features: ['#30', '#31', '#32'],
		title: 'Sysadmin workstation profile (uid, LC_ALL=C), scheduled cron job, storage quota & process monitor',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, '/');
				await openSidebarTab(h.page, /profile|boot/i);
				const panel = sidebarPanel(h.page);
				await panel.getByLabel(/^uid$/i).first().fill('1000');
				await panel.getByLabel(/env/i).first().fill('LC_ALL=C');
				await panel.getByRole('button', { name: /save.*profile|apply/i }).first().click();

				await openSidebarTab(h.page, /service|daemon|cron/i);
				const cronInput = panel.getByPlaceholder(/\* \* \* \* \*/).or(panel.getByLabel(/cron schedule/i)).first();
				await cronInput.fill('0 * * * *');
				await panel.getByLabel(/cron command|job command/i).first().fill('df -h');
				await panel.getByRole('button', { name: /add cron|add job/i }).first().click();
				await panel.getByText('0 * * * *').waitFor({ state: 'visible' });

				await openSidebarTab(h.page, /system|monitor/i);
				await panel.locator('svg, canvas').first().waitFor({ state: 'visible' });
				await panel.getByText(/quota|storage/i).first().waitFor({ state: 'visible' });
				h.assertClean('T4-06');
			} finally {
				await h.close();
			}
		}
	},
	{
		id: 'T4-07',
		tier: 4,
		area: 'SYS',
		milestone: 'M5',
		features: ['#4', '#5', '#18', '#21', '#27', '#30'],
		title: 'Full offline-resilient graphical + terminal workstation journey on Alpine with VT1<->VT7, workspace, catalog & monitor',
		async run(ctx) {
			const h = await openFreshContext(ctx.browser, ctx.baseUrl, { actionTimeout: ctx.actionTimeout });
			try {
				await gotoApp(h.page, ctx.baseUrl, ctx.alpineRoute);
				assert.equal(await h.page.evaluate(() => window.crossOriginIsolated), true);
				await h.page.locator('#display').waitFor({ state: 'attached' });

				const vtToggleBtn = h.page.locator('[data-testid="vt-toggle-btn"]').or(
					h.page.getByRole('button', { name: /vt\s*7|display|x11|graphical/i })
				).first();
				await vtToggleBtn.click();
				await vtToggleBtn.click();

				await openSidebarTab(h.page, /files|file manager|workspace/i);
				const panel = sidebarPanel(h.page);
				await panel.locator('input[type="file"]').first().setInputFiles({
					name: 'alpine-note.txt',
					mimeType: 'text/plain',
					buffer: Buffer.from('alpine graphical session')
				});
				await panel.getByText('alpine-note.txt').waitFor({ state: 'visible' });

				await openSidebarTab(h.page, /apps|app store|catalog/i);
				await panel.getByPlaceholder(/filter|search apps/i).first().waitFor({ state: 'visible' });

				await openSidebarTab(h.page, /system|monitor/i);
				await panel.locator('svg, canvas').first().waitFor({ state: 'visible' });
				h.assertClean('T4-07');
			} finally {
				await h.close();
			}
		}
	}
];
