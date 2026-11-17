import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	validateDownloadUrl,
	applyCorsProxy,
	computeSha256Hex,
	resolvePackageSource,
	downloadResource,
	downloadHistory,
	clearDownloadHistory
} from '../../src/lib/apps/downloader.js';
import {
	getWorkspaceEntry,
	listWorkspaceEntries,
	resetWorkspace
} from '../../src/lib/fs/fileBridge.js';
import { buildTarBytes } from '../../src/lib/fs/archiveHelper.js';
import { gzipSync } from 'node:zlib';

async function gzipBytes(rawBytes) {
	return new Uint8Array(gzipSync(rawBytes));
}

describe('Host-browser HTTP & package downloader bridge (downloader.js)', () => {
	beforeEach(async () => {
		localStorage.clear();
		clearDownloadHistory();
		await resetWorkspace({ skipVmReset: true });
	});

	it('validates URL schemes strictly (allows http/https, blocks javascript/data/file/ftp)', () => {
		expect(validateDownloadUrl('https://example.com/app.sh')).toBe('https://example.com/app.sh');
		expect(validateDownloadUrl('http://localhost:8080/test')).toBe('http://localhost:8080/test');

		expect(() => validateDownloadUrl('javascript:alert(1)')).toThrow(/Blocked URL scheme/i);
		expect(() => validateDownloadUrl('data:text/plain,hi')).toThrow(/Blocked URL scheme/i);
		expect(() => validateDownloadUrl('file:///etc/passwd')).toThrow(/Blocked URL scheme/i);
		expect(() => validateDownloadUrl('ftp://example.com/a.tar.gz')).toThrow(/Blocked URL scheme/i);
		expect(() => validateDownloadUrl('not a url')).toThrow(/Invalid URL/i);
	});

	it('rewrites URLs through optional CORS proxy templates and prefixes', () => {
		expect(applyCorsProxy('https://example.com/a.tar.gz', '')).toBe('https://example.com/a.tar.gz');
		expect(
			applyCorsProxy('https://example.com/a.tar.gz', 'https://corsproxy.io/?')
		).toBe('https://corsproxy.io/?https%3A%2F%2Fexample.com%2Fa.tar.gz');
		expect(
			applyCorsProxy('https://example.com/a.tar.gz', 'https://proxy.test/fetch?url={url}')
		).toBe('https://proxy.test/fetch?url=https%3A%2F%2Fexample.com%2Fa.tar.gz');
		expect(
			applyCorsProxy('https://example.com/a.tar.gz', 'https://proxy.test/raw/')
		).toBe('https://proxy.test/raw/https://example.com/a.tar.gz');
	});

	it('downloads a direct CORS file, verifies SHA-256, and stages +x into workspace & /data', async () => {
		const payload = new TextEncoder().encode('#!/bin/sh\necho hi\n');
		const expectedHash = await computeSha256Hex(payload);
		const mockDataDevice = { writeFile: vi.fn().mockResolvedValue(undefined) };
		const mockCx = { run: vi.fn().mockResolvedValue({ status: 0 }) };
		const vmManager = {
			getDataDevice: () => mockDataDevice,
			getCheerpX: () => mockCx
		};

		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			arrayBuffer: async () => payload.buffer.slice(0)
		});

		const res = await downloadResource({
			url: 'https://example.com/hello.sh',
			sha256: expectedHash,
			makeExecutable: true,
			vmManager,
			fetchImpl: fetchMock
		});

		expect(res.ok).toBe(true);
		expect(res.sha256).toBe(expectedHash);
		expect(res.stagedPaths).toEqual(['hello.sh']);

		const entry = getWorkspaceEntry('hello.sh');
		expect(entry).toBeTruthy();
		expect(entry.executable).toBe(true);
		expect(mockDataDevice.writeFile).toHaveBeenCalledWith('/hello.sh', expect.any(Uint8Array));
		expect(mockCx.run).toHaveBeenCalledWith(
			'/bin/chmod',
			['+x', '/home/user/workspace/hello.sh'],
			expect.objectContaining({ cwd: '/home/user/workspace' })
		);
		expect(get(downloadHistory)[0].status).toBe('success');
	});

	it('aborts immediately on SHA-256 mismatch without staging untrusted payload', async () => {
		const payload = new TextEncoder().encode('malicious payload');
		const wrongHash = '0'.repeat(64);
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			arrayBuffer: async () => payload.buffer.slice(0)
		});

		await expect(
			downloadResource({
				url: 'https://example.com/evil.sh',
				sha256: wrongHash,
				fetchImpl: fetchMock
			})
		).rejects.toThrow(/SHA-256 verification failed/i);

		expect(getWorkspaceEntry('evil.sh')).toBeNull();
		expect(listWorkspaceEntries()).toHaveLength(0);
		expect(get(downloadHistory)[0].status).toBe('error');
	});

	it('surfaces readable HTTP 404 errors and blocks invalid schemes before fetch', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 404,
			statusText: 'Not Found'
		});

		await expect(
			downloadResource({
				url: 'https://example.com/missing.tar.gz',
				fetchImpl: fetchMock
			})
		).rejects.toThrow(/HTTP 404/);

		const neverFetch = vi.fn();
		await expect(
			downloadResource({
				url: 'javascript:alert(1)',
				fetchImpl: neverFetch
			})
		).rejects.toThrow(/Blocked URL scheme/i);
		expect(neverFetch).not.toHaveBeenCalled();
	});

	it('extracts .tar.gz archives into workspace and aborts cleanly on corrupted archives', async () => {
		const tarBytes = buildTarBytes([
			{ path: 'pkg/run.sh', type: 'file', mode: 0o755, data: '#!/bin/sh\necho ok\n' },
			{ path: 'pkg/README.txt', type: 'file', mode: 0o644, data: 'hello' }
		]);
		const tgzBytes = await gzipBytes(tarBytes);

		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			arrayBuffer: async () => tgzBytes.buffer.slice(0)
		});

		const res = await downloadResource({
			url: 'https://example.com/pkg.tar.gz',
			corsProxy: 'https://corsproxy.io/?',
			fetchImpl: fetchMock
		});

		expect(fetchMock).toHaveBeenCalledWith(
			'https://corsproxy.io/?https%3A%2F%2Fexample.com%2Fpkg.tar.gz'
		);
		expect(res.extractedCount).toBe(2);
		expect(getWorkspaceEntry('pkg/run.sh')?.executable).toBe(true);
		expect(getWorkspaceEntry('pkg/README.txt')).toBeTruthy();

		// Now test corrupted .tar.gz does not partially stage
		await resetWorkspace({ skipVmReset: true });
		const badBytes = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
		const badFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			arrayBuffer: async () => badBytes.buffer.slice(0)
		});

		await expect(
			downloadResource({
				url: 'https://example.com/broken.tar.gz',
				fetchImpl: badFetch
			})
		).rejects.toThrow();
		expect(listWorkspaceEntries()).toHaveLength(0);
	});

	it('resolves GitHub, PyPI, and npm package source shortcuts', async () => {
		const gh = await resolvePackageSource('user/repo:bin/tool.sh', { sourceType: 'github' });
		expect(gh.resolvedUrl).toBe('https://raw.githubusercontent.com/user/repo/main/bin/tool.sh');
		expect(gh.filename).toBe('tool.sh');

		const pypiFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				urls: [
					{
						packagetype: 'sdist',
						filename: 'demo-1.0.0.tar.gz',
						url: 'https://files.pythonhosted.org/packages/demo-1.0.0.tar.gz',
						digests: { sha256: 'a'.repeat(64) }
					}
				]
			})
		});
		const pypi = await resolvePackageSource('demo', { sourceType: 'pypi', fetchImpl: pypiFetch });
		expect(pypi.resolvedUrl).toBe('https://files.pythonhosted.org/packages/demo-1.0.0.tar.gz');
		expect(pypi.expectedSha256).toBe('a'.repeat(64));

		const npmFetch = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({
				dist: { tarball: 'https://registry.npmjs.org/tiny-pkg/-/tiny-pkg-1.0.0.tgz' }
			})
		});
		const npm = await resolvePackageSource('tiny-pkg', { sourceType: 'npm', fetchImpl: npmFetch });
		expect(npm.resolvedUrl).toBe('https://registry.npmjs.org/tiny-pkg/-/tiny-pkg-1.0.0.tgz');
	});
});
