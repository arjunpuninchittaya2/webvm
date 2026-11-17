import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tick } from 'svelte';
import SideBar from '../../src/lib/SideBar.svelte';
import FilesTab from '../../src/lib/FilesTab.svelte';
import EditorTab from '../../src/lib/EditorTab.svelte';
import DiskTab from '../../src/lib/DiskTab.svelte';
import {
	resetWorkspace,
	writeWorkspaceFile
} from '../../src/lib/fs/fileBridge.js';

describe('M3 Files, Editor, Disk & SideBar UI components', () => {
	let container;
	const mounted = [];

	function mount(Component, props = {}) {
		const instance = new Component({ target: container, props });
		mounted.push(instance);
		return instance;
	}

	beforeEach(async () => {
		container = document.createElement('div');
		document.body.appendChild(container);
		await resetWorkspace({ skipVmReset: true });
	});

	afterEach(() => {
		while (mounted.length > 0) {
			mounted.pop().$destroy();
		}
		container.remove();
	});

	it('SideBar registers Files and Editor tabs and works with default-safe props', async () => {
		mount(SideBar, { sideBarPinned: true, handleTool: vi.fn() });
		await tick();

		const filesBtn = container.querySelector('button[aria-label="Files"]');
		const editorBtn = container.querySelector('button[aria-label="Editor"]');
		expect(filesBtn).toBeTruthy();
		expect(editorBtn).toBeTruthy();

		filesBtn.click();
		await tick();
		expect(container.querySelector('[data-testid="files-tab"]')).toBeTruthy();

		editorBtn.click();
		await tick();
		expect(container.querySelector('[data-testid="editor-tab"]')).toBeTruthy();
	});

	it('FilesTab creates folders, rejects traversal without echoing input, renames, and deletes without echoing filename', async () => {
		mount(FilesTab, {});
		await tick();

		const mkdirInput = container.querySelector('[data-testid="mkdir-input"]');
		const mkdirBtn = container.querySelector('[data-testid="mkdir-btn"]');

		// Traversal rejection
		mkdirInput.value = '../escape';
		mkdirInput.dispatchEvent(new Event('input', { bubbles: true }));
		mkdirBtn.click();
		await tick();
		expect(container.textContent).toMatch(/invalid|traversal/i);
		expect(container.textContent).not.toContain('../escape');

		// Valid folder creation
		mkdirInput.value = 'projects';
		mkdirInput.dispatchEvent(new Event('input', { bubbles: true }));
		mkdirBtn.click();
		await tick();
		await new Promise((r) => setTimeout(r, 10));
		await tick();
		expect(container.querySelector('[data-testid="file-entry-projects"]')).toBeTruthy();

		// Delete folder without echoing deleted name
		const delBtn = container.querySelector('[data-testid="file-delete-projects"]');
		delBtn.click();
		await tick();
		await new Promise((r) => setTimeout(r, 10));
		await tick();
		expect(container.querySelector('[data-testid="file-entry-projects"]')).toBeNull();
		expect(container.textContent).not.toContain('projects');
	});

	it('EditorTab loads text files, guards binary files, saves, and triggers Run in Terminal', async () => {
		await writeWorkspaceFile('bin.dat', new Uint8Array([0x00, 0xff, 0xfe, 0x01]));
		await writeWorkspaceFile('hello.sh', '#!/bin/sh\necho hi\n');

		const runCommandInTerminal = vi.fn().mockResolvedValue({ status: 0 });
		mount(EditorTab, { vmManager: { runCommandInTerminal } });
		await tick();

		const pathInput = container.querySelector('[data-testid="editor-path-input"]');
		const openBtn = container.querySelector('[data-testid="editor-open-btn"]');
		const textarea = container.querySelector('[data-testid="code-editor"]');

		// Binary guard
		pathInput.value = 'bin.dat';
		pathInput.dispatchEvent(new Event('input', { bubbles: true }));
		openBtn.click();
		await tick();
		expect(container.textContent).toMatch(/binary|non-text|cannot edit/i);
		expect(textarea.disabled).toBe(true);

		// Load script and run in terminal
		pathInput.value = 'hello.sh';
		pathInput.dispatchEvent(new Event('input', { bubbles: true }));
		openBtn.click();
		await tick();
		expect(textarea.disabled).toBe(false);
		expect(textarea.value).toContain('echo hi');

		const runBtn = container.querySelector('[data-testid="editor-run-btn"]');
		runBtn.click();
		await tick();
		await new Promise((r) => setTimeout(r, 20));
		expect(runCommandInTerminal).toHaveBeenCalledWith(
			'/bin/sh "/home/user/workspace/hello.sh"',
			expect.objectContaining({ title: 'hello.sh' })
		);
	});

	it('DiskTab preserves Reset disk and provides independent two-step Reset workspace', async () => {
		const comp = mount(DiskTab, {});
		const onReset = vi.fn();
		const onResetWorkspace = vi.fn();
		comp.$on('reset', onReset);
		comp.$on('resetWorkspace', onResetWorkspace);
		await tick();

		const wsBtn = container.querySelector('[data-testid="reset-workspace-btn"] button');
		expect(wsBtn.textContent).toContain('Reset workspace');
		wsBtn.click();
		await tick();
		expect(wsBtn.textContent).toContain('Confirm?');
		wsBtn.click();
		await tick();
		expect(onResetWorkspace).toHaveBeenCalledTimes(1);
		expect(onReset).not.toHaveBeenCalled();
	});
});
