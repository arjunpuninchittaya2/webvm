import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tick } from 'svelte';
import AppsTab from '../../src/lib/components/AppsTab.svelte';
import { resetWorkspace, writeWorkspaceFile } from '../../src/lib/fs/fileBridge.js';
import { clearDownloadHistory } from '../../src/lib/apps/downloader.js';

import { resolveWorkspaceHtmlPreview } from '../../src/lib/apps/webPreview.js';

describe('AppsTab.svelte & Web Preview UI', () => {
	let container;
	let instance;

	beforeEach(async () => {
		localStorage.clear();
		clearDownloadHistory();
		await resetWorkspace({ skipVmReset: true });
		container = document.createElement('div');
		document.body.appendChild(container);
	});

	afterEach(() => {
		instance?.$destroy();
		container?.remove();
	});

	it('renders Catalog, Downloader, and Web Preview sections concurrently when mounted', async () => {
		instance = new AppsTab({ target: container, props: {} });
		await tick();

		expect(container.querySelector('[data-testid="apps-section-catalog"]')).toBeTruthy();
		expect(container.querySelector('[data-testid="app-catalog-search"]')).toBeTruthy();
		expect(container.querySelector('[data-testid="apps-section-download"]')).toBeTruthy();
		expect(container.querySelector('[data-testid="download-url-input"]')).toBeTruthy();
		expect(container.querySelector('[data-testid="apps-section-preview"]')).toBeTruthy();
		expect(container.querySelector('[data-testid="preview-path-input"]')).toBeTruthy();
	});

	it('filters catalog apps and launches an app via vmManager', async () => {
		const vmManager = {
			runCommandInTerminal: vi.fn().mockResolvedValue({ status: 0 })
		};
		instance = new AppsTab({ target: container, props: { vmManager } });
		await tick();

		const search = container.querySelector('[data-testid="app-catalog-search"]');
		search.value = 'lua';
		search.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		const launchBtn = container.querySelector('[data-testid="app-launch-lua-script-runner"]');
		expect(launchBtn).toBeTruthy();
		launchBtn.click();
		await tick();
		await new Promise((r) => setTimeout(r, 10));

		expect(vmManager.runCommandInTerminal).toHaveBeenCalledWith(
			'lua',
			expect.objectContaining({ title: 'Lua Interactive Shell' })
		);
	});

	it('rejects x86_64 ELF binaries in Workspace Runner UI without executing', async () => {
		const x64Elf = new Uint8Array(64);
		x64Elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
		x64Elf[18] = 62;
		await writeWorkspaceFile('bad64', x64Elf);

		const vmManager = {
			runCommandInTerminal: vi.fn().mockResolvedValue({ status: 0 })
		};
		instance = new AppsTab({ target: container, props: { vmManager } });
		await tick();

		const runBtn = container.querySelector('[data-testid="workspace-run-bad64"]');
		expect(runBtn).toBeTruthy();
		runBtn.click();
		await tick();
		await new Promise((r) => setTimeout(r, 10));

		const errEl = container.querySelector('[data-testid="catalog-error"]');
		expect(errEl?.textContent).toMatch(/x86_64.*i386/i);
		expect(vmManager.runCommandInTerminal).not.toHaveBeenCalled();
	});

	it('renders workspace index.html in sandboxed Web Preview, updates reactively, and shows File not found for missing path', async () => {
		await writeWorkspaceFile('style.css', 'h1 { color: red; }');
		await writeWorkspaceFile(
			'index.html',
			'<!DOCTYPE html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>First</h1></body></html>'
		);

		instance = new AppsTab({ target: container, props: {} });
		await tick();

		const previewTabBtn = container.querySelector('[data-testid="apps-subtab-preview"]');
		previewTabBtn.click();
		await tick();
		await new Promise((r) => setTimeout(r, 10));
		await tick();

		const iframe = container.querySelector('[data-testid="web-preview-iframe"]');
		expect(iframe).toBeTruthy();
		expect(iframe.getAttribute('srcdoc')).toContain('<h1>First</h1>');
		expect(iframe.getAttribute('srcdoc')).toContain('h1 { color: red; }');

		// Reactive update when workspace file is edited
		await writeWorkspaceFile(
			'index.html',
			'<!DOCTYPE html><html><body><h1>Updated</h1></body></html>'
		);
		await tick();
		expect(iframe.getAttribute('srcdoc')).toContain('<h1>Updated</h1>');

		// Non-existent file shows File not found
		const pathInput = container.querySelector('[data-testid="preview-path-input"]');
		pathInput.value = 'does-not-exist.html';
		pathInput.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		container.querySelector('[data-testid="preview-load-btn"]').click();
		await tick();
		await new Promise((r) => setTimeout(r, 10));
		await tick();

		const errEl = container.querySelector('[data-testid="preview-error"]');
		expect(errEl?.textContent).toMatch(/File not found/i);
		expect(container.querySelector('[data-testid="web-preview-iframe"]')).toBeNull();
	});

	it('resolves ../ relative assets inside subdirectories and safely skips ../../ escapes above root', async () => {
		await writeWorkspaceFile('shared.css', 'body { background: #111; }');
		await writeWorkspaceFile(
			'sub/page.html',
			'<!DOCTYPE html><html><head><link rel="stylesheet" href="../shared.css"><script src="../../escape.js"></script></head><body>Hi</body></html>'
		);

		const res = resolveWorkspaceHtmlPreview('sub/page.html');
		expect(res.ok).toBe(true);
		expect(res.html).toContain('body { background: #111; }');
		expect(res.html).toContain('<script src="../../escape.js"></script>');
	});

	it('disambiguates Source Type select from URL/Package input label and Download submit button from HTTP Fetch sub-tab', async () => {
		instance = new AppsTab({ target: container, props: {} });
		await tick();

		const sourceSelect = container.querySelector('[data-testid="download-source-select"]');
		expect(sourceSelect).toBeTruthy();
		expect(sourceSelect.closest('label')).toBeNull();
		expect(sourceSelect.getAttribute('aria-label')).toBe('Download Source Type');

		const subtabBtn = container.querySelector('[data-testid="apps-subtab-download"]');
		expect(subtabBtn.getAttribute('role')).toBe('tab');
		expect(subtabBtn.textContent.trim()).toBe('HTTP Fetch');

		const submitBtn = container.querySelector('[data-testid="download-submit-btn"]');
		expect(submitBtn.textContent.trim()).toBe('Download');
	});

	it('shows role="status" message when launching a catalog app while vmManager is not yet ready', async () => {
		instance = new AppsTab({ target: container, props: { vmManager: null } });
		await tick();

		const launchBtn = container.querySelector('[data-testid="app-launch-python-http-server"]');
		expect(launchBtn).toBeTruthy();
		launchBtn.click();
		await tick();
		await new Promise((r) => setTimeout(r, 10));
		await tick();

		const statusEl = container.querySelector('[data-testid="catalog-status"]');
		expect(statusEl).toBeTruthy();
		expect(statusEl.getAttribute('role')).toBe('status');
		expect(statusEl.textContent).toMatch(/Staged & queued.*Python 3 HTTP Server/i);
	});

	it('reactively renders previewHtml when previewPath changes without clicking Preview button', async () => {
		await writeWorkspaceFile('about.html', '<!DOCTYPE html><html><body><h1>About Page</h1></body></html>');

		instance = new AppsTab({ target: container, props: { initialSubTab: 'preview' } });
		await tick();

		// Initially index.html does not exist, so iframe is not rendered
		expect(container.querySelector('[data-testid="web-preview-iframe"]')).toBeNull();

		// Typing an existing workspace HTML path into preview-path-input reactively renders the iframe
		const pathInput = container.querySelector('[data-testid="preview-path-input"]');
		pathInput.value = 'about.html';
		pathInput.dispatchEvent(new Event('input', { bubbles: true }));
		await tick();

		const iframe = container.querySelector('[data-testid="web-preview-iframe"]');
		expect(iframe).toBeTruthy();
		expect(iframe.getAttribute('srcdoc')).toContain('<h1>About Page</h1>');
	});

	it('keeps SideBar Web Preview panel open and iframe mounted when clicking Web Preview button while already open', async () => {
		const { default: SideBar } = await import('../../src/lib/SideBar.svelte');
		await writeWorkspaceFile('index.html', '<!DOCTYPE html><html><body><h1>Persistent Preview</h1></body></html>');

		instance = new SideBar({
			target: container,
			props: { sideBarPinned: false, handleTool: vi.fn() }
		});
		await tick();

		const webPreviewBtn = container.querySelector('button[aria-label="Web Preview"]');
		const aside = container.querySelector('aside[aria-label="Sidebar panel"]');
		expect(aside.classList.contains('hidden')).toBe(true);

		// First click opens Web Preview
		webPreviewBtn.click();
		await tick();
		await new Promise((r) => setTimeout(r, 10));
		await tick();
		expect(aside.classList.contains('hidden')).toBe(false);
		expect(container.querySelector('[data-testid="web-preview-iframe"]')).toBeTruthy();

		// Second click on Web Preview button keeps it open and preserves iframe
		webPreviewBtn.click();
		await tick();
		expect(aside.classList.contains('hidden')).toBe(false);
		const iframe = container.querySelector('[data-testid="web-preview-iframe"]');
		expect(iframe).toBeTruthy();
		expect(iframe.getAttribute('srcdoc')).toContain('<h1>Persistent Preview</h1>');
	});
});
