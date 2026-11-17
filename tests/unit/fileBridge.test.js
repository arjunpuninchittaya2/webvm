import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { gzipSync } from 'node:zlib';
import { buildTarBytes } from '../../src/lib/fs/archiveHelper.js';
import {
	WORKSPACE_LS_KEY,
	workspaceEntries,
	validateEntryName,
	normalizeWorkspacePath,
	detectElfArch,
	isBinaryBuffer,
	inspectPayload,
	createWorkspaceDir,
	writeWorkspaceFile,
	listWorkspaceEntries,
	renameWorkspaceEntry,
	deleteWorkspaceEntry,
	importHostFiles,
	exportWorkspaceSnapshot,
	importWorkspaceSnapshot,
	resetWorkspace,
	executeWorkspaceFile
} from '../../src/lib/fs/fileBridge.js';

function makeElfHeader({ is64 = false, machine = 3 } = {}) {
	const buf = new Uint8Array(32);
	buf[0] = 0x7f;
	buf[1] = 0x45;
	buf[2] = 0x4c;
	buf[3] = 0x46;
	buf[4] = is64 ? 2 : 1;
	buf[18] = machine & 0xff;
	buf[19] = (machine >> 8) & 0xff;
	return buf;
}

describe('fileBridge', () => {
	beforeEach(async () => {
		await resetWorkspace({ skipVmReset: true });
	});

	it('validates entry names and normalizes workspace paths against traversal', () => {
		expect(validateEntryName('')).toEqual({
			valid: false,
			error: 'Invalid name: name cannot be empty'
		});
		const trav = validateEntryName('../escape');
		expect(trav.valid).toBe(false);
		expect(trav.error).not.toContain('../escape');

		expect(normalizeWorkspacePath('/home/user/workspace/cli/run.sh')).toBe('cli/run.sh');
		expect(() => normalizeWorkspacePath('foo/../../bar')).toThrow(/traversal/i);
	});

	it('detects ELF i386 vs x86_64, binary buffers, and script +x permissions', () => {
		const i386 = makeElfHeader({ is64: false, machine: 3 });
		const x64 = makeElfHeader({ is64: true, machine: 62 });

		expect(detectElfArch(i386)).toBe('i386');
		expect(detectElfArch(x64)).toBe('x86_64');
		expect(isBinaryBuffer(new Uint8Array([0x00, 0xff, 0xfe, 0x01]))).toBe(true);
		expect(isBinaryBuffer(new TextEncoder().encode('echo hi\n'))).toBe(false);

		const shMeta = inspectPayload(new TextEncoder().encode('#!/bin/sh\necho hi'), 'hello.txt');
		expect(shMeta.executable).toBe(true);
		expect(shMeta.mode).toBe(0o755);

		const txtMeta = inspectPayload(new TextEncoder().encode('plain text'), 'notes.txt');
		expect(txtMeta.executable).toBe(false);
		expect(txtMeta.mode).toBe(0o644);
	});

	it('supports mkdir, write, rename (including nested), and recursive delete', async () => {
		await createWorkspaceDir('nested');
		await writeWorkspaceFile('nested/child.txt', 'hello child');

		expect(listWorkspaceEntries('nested').map((e) => e.path)).toEqual(['nested/child.txt']);

		await renameWorkspaceEntry('nested', 'renamed_dir');
		expect(listWorkspaceEntries('renamed_dir').map((e) => e.path)).toEqual(['renamed_dir/child.txt']);

		const deleted = await deleteWorkspaceEntry('renamed_dir');
		expect(deleted).toBe(true);
		expect(get(workspaceEntries)).toEqual([]);
	});

	it('imports host files including 0-byte files and .tar.gz archives', async () => {
		const tar = buildTarBytes([
			{ path: 'pkg/hello.txt', type: 'file', mode: 0o644, data: 'from tgz' }
		]);
		const tgz = new Uint8Array(gzipSync(tar));

		const mockVmManager = {
			getDataDevice: () => ({ writeFile: vi.fn().mockResolvedValue(undefined) }),
			getCheerpX: () => null
		};

		const res = await importHostFiles(
			[
				{ name: 'empty.txt', data: new Uint8Array(0) },
				{ name: 'pkg.tar.gz', data: tgz }
			],
			'',
			{ vmManager: mockVmManager }
		);

		expect(res.errors).toEqual([]);
		expect(res.extractedArchives).toEqual(['pkg.tar.gz']);
		const paths = get(workspaceEntries).map((e) => e.path);
		expect(paths).toContain('empty.txt');
		expect(paths).toContain('pkg');
		expect(paths).toContain('pkg/hello.txt');
	});

	it('exports and imports workspace snapshots and rejects corrupted JSON without clobbering', async () => {
		await writeWorkspaceFile('keep-me.txt', 'important');
		const snap = exportWorkspaceSnapshot({ download: false });
		expect(snap.format).toBe('webvm-workspace-snapshot');
		expect(snap.entries.length).toBe(1);

		await expect(importWorkspaceSnapshot('{not-valid-json')).rejects.toThrow(/invalid snapshot/i);
		// Existing file preserved
		expect(listWorkspaceEntries('').map((e) => e.path)).toEqual(['keep-me.txt']);

		await resetWorkspace({ skipVmReset: true });
		expect(get(workspaceEntries)).toEqual([]);

		await importWorkspaceSnapshot(JSON.stringify(snap));
		expect(listWorkspaceEntries('').map((e) => e.path)).toEqual(['keep-me.txt']);
		expect(localStorage.getItem(WORKSPACE_LS_KEY)).toContain('keep-me.txt');
	});

	it('rejects x86_64 ELF execution and runs i386/scripts via vmManager.runCommandInTerminal', async () => {
		await writeWorkspaceFile('amd64.bin', makeElfHeader({ is64: true, machine: 62 }));
		const badRes = await executeWorkspaceFile('amd64.bin');
		expect(badRes.ok).toBe(false);
		expect(badRes.error).toMatch(/32-bit|i386|x86_64/i);

		await writeWorkspaceFile('runme.sh', '#!/bin/sh\necho ok\n');
		const runCommandInTerminal = vi.fn().mockResolvedValue({ status: 0 });
		const okRes = await executeWorkspaceFile('runme.sh', {
			vmManager: { runCommandInTerminal }
		});
		expect(okRes.ok).toBe(true);
		expect(runCommandInTerminal).toHaveBeenCalledWith(
			'/bin/sh "/home/user/workspace/runme.sh"',
			expect.objectContaining({ title: 'runme.sh' })
		);
	});

	it('allows consecutive dots in filenames while rejecting . and ..', () => {
		expect(validateEntryName('foo..bar.txt')).toEqual({ valid: true, name: 'foo..bar.txt' });
		expect(validateEntryName('v1..v2.js')).toEqual({ valid: true, name: 'v1..v2.js' });
		expect(validateEntryName('.').valid).toBe(false);
		expect(validateEntryName('..').valid).toBe(false);
		expect(validateEntryName('a/b').valid).toBe(false);
		expect(validateEntryName('a\\b').valid).toBe(false);
		expect(validateEntryName('a\0b').valid).toBe(false);
	});

	it('enforces prefix boundaries in normalizeWorkspacePath', () => {
		expect(normalizeWorkspacePath('/datafoo/bar')).toBe('datafoo/bar');
		expect(normalizeWorkspacePath('/workspace2/a')).toBe('workspace2/a');
		expect(normalizeWorkspacePath('/home/user/workspace2/x')).toBe('home/user/workspace2/x');
		expect(normalizeWorkspacePath('/data/foo/bar')).toBe('foo/bar');
		expect(normalizeWorkspacePath('/data')).toBe('');
		expect(normalizeWorkspacePath('/workspace')).toBe('');
		expect(normalizeWorkspacePath('/home/user/workspace')).toBe('');
	});

	it('handles multi-byte UTF-8 characters split across the 8192-byte sample boundary', () => {
		const prefix = new TextEncoder().encode('a'.repeat(8190));
		const emoji = new TextEncoder().encode('🚀'); // 4-byte UTF-8 sequence
		const buf = new Uint8Array(prefix.length + emoji.length);
		buf.set(prefix, 0);
		buf.set(emoji, prefix.length);

		expect(buf.length).toBe(8194);
		expect(isBinaryBuffer(buf)).toBe(false);

		// Genuine invalid UTF-8 beyond ASCII prefix is still detected as binary
		const badBuf = new Uint8Array(8194);
		badBuf.set(prefix, 0);
		badBuf.set([0xff, 0xfe, 0x01, 0x02], prefix.length);
		expect(isBinaryBuffer(badBuf)).toBe(true);
	});

	it('rejects invalid item.name in importWorkspaceSnapshot without clobbering existing entries', async () => {
		await writeWorkspaceFile('keep-intact.txt', 'safe');
		const crafted = {
			format: 'webvm-workspace-snapshot',
			version: 1,
			exportedAt: Date.now(),
			entries: [
				{
					path: 'safe.txt',
					name: '../../evil\0name',
					type: 'file',
					dataBase64: 'aGVsbG8='
				}
			]
		};

		await expect(importWorkspaceSnapshot(JSON.stringify(crafted))).rejects.toThrow(
			/invalid snapshot/i
		);
		expect(listWorkspaceEntries('').map((e) => e.path)).toEqual(['keep-intact.txt']);
	});
});
