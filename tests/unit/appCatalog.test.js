import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	APP_CATALOG,
	filterAppCatalog,
	launchCatalogApp,
	runWorkspaceBinaryOrScript
} from '../../src/lib/apps/appCatalog.js';
import {
	getWorkspaceEntry,
	resetWorkspace,
	writeWorkspaceFile
} from '../../src/lib/fs/fileBridge.js';

function makeElfHeader({ eiClass, eMachine }) {
	const buf = new Uint8Array(64);
	buf[0] = 0x7f;
	buf[1] = 0x45;
	buf[2] = 0x4c;
	buf[3] = 0x46;
	buf[4] = eiClass; // 1 = 32-bit, 2 = 64-bit
	buf[5] = 1; // little endian
	buf[18] = eMachine & 0xff; // 3 = i386, 62 = x86_64
	buf[19] = (eMachine >> 8) & 0xff;
	return buf;
}

describe('App Catalog & 1-click Binary/Script Runner (appCatalog.js)', () => {
	beforeEach(async () => {
		localStorage.clear();
		await resetWorkspace({ skipVmReset: true });
	});

	it('filters catalog apps by query and category', () => {
		expect(filterAppCatalog('', 'All').length).toBe(APP_CATALOG.length);
		const pyApps = filterAppCatalog('', 'Python');
		expect(pyApps.length).toBeGreaterThan(0);
		expect(pyApps.every((a) => a.category === 'Python')).toBe(true);

		const luaSearch = filterAppCatalog('lua', 'All');
		expect(luaSearch.some((a) => a.id === 'lua-script-runner')).toBe(true);
	});

	it('launches a catalog app, scaffolds starter files, and invokes vmManager.runCommandInTerminal', async () => {
		const vmManager = {
			runCommandInTerminal: vi.fn().mockResolvedValue({ status: 0 })
		};
		const webApp = APP_CATALOG.find((a) => a.id === 'web-app-starter');
		const res = await launchCatalogApp(webApp, { vmManager });

		expect(res.ok).toBe(true);
		expect(vmManager.runCommandInTerminal).toHaveBeenCalledWith(
			webApp.command,
			expect.objectContaining({ title: webApp.name })
		);
		expect(getWorkspaceEntry('index.html')).toBeTruthy();
		expect(getWorkspaceEntry('style.css')).toBeTruthy();
		expect(getWorkspaceEntry('app.js')).toBeTruthy();
	});

	it('stages starter files and returns queued ok: true when vmManager terminal is not yet ready', async () => {
		const res = await launchCatalogApp('web-app-starter', { vmManager: null });
		expect(res.ok).toBe(true);
		expect(res.queued).toBe(true);
		expect(res.stagedPath).toBe('index.html');
		expect(res.message).toMatch(/Staged & queued/i);
		expect(getWorkspaceEntry('index.html')).toBeTruthy();

		const notReadyVm = {
			runCommandInTerminal: vi.fn().mockResolvedValue({ ok: false })
		};
		const res2 = await launchCatalogApp('python-http-server', { vmManager: notReadyVm });
		expect(res2.ok).toBe(true);
		expect(res2.queued).toBe(true);
		expect(res2.message).toMatch(/Python 3 HTTP Server/);
	});

	it('runs workspace scripts and i386 ELF binaries via 1-click runner', async () => {
		const vmManager = {
			runCommandInTerminal: vi.fn().mockResolvedValue({ status: 0 })
		};

		await writeWorkspaceFile('hello.sh', '#!/bin/sh\necho ok\n', { makeExecutable: true });
		const scriptRes = await runWorkspaceBinaryOrScript('hello.sh', { vmManager });
		expect(scriptRes.ok).toBe(true);
		expect(vmManager.runCommandInTerminal).toHaveBeenCalled();

		const i386Elf = makeElfHeader({ eiClass: 1, eMachine: 3 });
		await writeWorkspaceFile('tool32', i386Elf);
		const elfRes = await runWorkspaceBinaryOrScript('tool32', { vmManager });
		expect(elfRes.ok).toBe(true);
		expect(elfRes.command).toContain('/home/user/workspace/tool32');
	});

	it('cleanly rejects x86_64 ELF binaries with CheerpX 32-bit i386-only message', async () => {
		const vmManager = {
			runCommandInTerminal: vi.fn().mockResolvedValue({ status: 0 })
		};
		const x64Elf = makeElfHeader({ eiClass: 2, eMachine: 62 });
		await writeWorkspaceFile('tool64', x64Elf);

		const res = await runWorkspaceBinaryOrScript('tool64', { vmManager });
		expect(res.ok).toBe(false);
		expect(res.error).toMatch(/x86_64/i);
		expect(res.error).toMatch(/i386/i);
		expect(vmManager.runCommandInTerminal).not.toHaveBeenCalled();
	});
});
