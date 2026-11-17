import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import {
	isArchiveFilename,
	sanitizeArchivePath,
	buildTarBytes,
	parseTarBytes,
	gunzipBytes,
	extractArchiveBytes
} from '../../src/lib/fs/archiveHelper.js';

function buildStoredZip(files) {
	const encoder = new TextEncoder();
	const localChunks = [];
	const cdChunks = [];
	let offset = 0;

	for (const f of files) {
		const nameBytes = encoder.encode(f.path);
		const dataBytes = typeof f.data === 'string' ? encoder.encode(f.data) : f.data;

		const lfh = new Uint8Array(30 + nameBytes.length);
		const dv = new DataView(lfh.buffer);
		dv.setUint32(0, 0x04034b50, true);
		dv.setUint16(4, 20, true);
		dv.setUint16(8, 0, true); // stored
		dv.setUint32(18, dataBytes.length, true);
		dv.setUint32(22, dataBytes.length, true);
		dv.setUint16(26, nameBytes.length, true);
		lfh.set(nameBytes, 30);

		const cd = new Uint8Array(46 + nameBytes.length);
		const cdv = new DataView(cd.buffer);
		cdv.setUint32(0, 0x02014b50, true);
		cdv.setUint16(4, 20, true);
		cdv.setUint16(6, 20, true);
		cdv.setUint16(10, 0, true);
		cdv.setUint32(20, dataBytes.length, true);
		cdv.setUint32(24, dataBytes.length, true);
		cdv.setUint16(28, nameBytes.length, true);
		cdv.setUint32(42, offset, true);
		cd.set(nameBytes, 46);

		localChunks.push(lfh, dataBytes);
		cdChunks.push(cd);
		offset += lfh.length + dataBytes.length;
	}

	const cdSize = cdChunks.reduce((acc, c) => acc + c.length, 0);
	const eocd = new Uint8Array(22);
	const edv = new DataView(eocd.buffer);
	edv.setUint32(0, 0x06054b50, true);
	edv.setUint16(8, files.length, true);
	edv.setUint16(10, files.length, true);
	edv.setUint32(12, cdSize, true);
	edv.setUint32(16, offset, true);

	const all = [...localChunks, ...cdChunks, eocd];
	const total = all.reduce((acc, c) => acc + c.length, 0);
	const out = new Uint8Array(total);
	let pos = 0;
	for (const c of all) {
		out.set(c, pos);
		pos += c.length;
	}
	return out;
}

describe('archiveHelper', () => {
	it('detects supported archive extensions', () => {
		expect(isArchiveFilename('bundle.tar.gz')).toBe(true);
		expect(isArchiveFilename('bundle.TGZ')).toBe(true);
		expect(isArchiveFilename('files.tar')).toBe(true);
		expect(isArchiveFilename('app.zip')).toBe(true);
		expect(isArchiveFilename('script.sh')).toBe(false);
	});

	it('rejects path traversal in sanitizeArchivePath', () => {
		expect(sanitizeArchivePath('./pkg/hello.txt')).toBe('pkg/hello.txt');
		expect(() => sanitizeArchivePath('../escape.txt')).toThrow(/traversal/i);
		expect(() => sanitizeArchivePath('pkg/../../escape.txt')).toThrow(/traversal/i);
		expect(() => sanitizeArchivePath('bad\0name')).toThrow(/null byte/i);
	});

	it('builds and parses POSIX ustar tar archives round-trip', () => {
		const tar = buildTarBytes([
			{ path: 'pkg', type: 'dir', mode: 0o755 },
			{ path: 'pkg/hello.txt', type: 'file', mode: 0o644, data: 'hello tar' },
			{ path: 'pkg/run.sh', type: 'file', mode: 0o755, data: '#!/bin/sh\necho ok\n' }
		]);

		const entries = parseTarBytes(tar);
		expect(entries.map((e) => e.path)).toEqual(['pkg', 'pkg/hello.txt', 'pkg/run.sh']);
		expect(new TextDecoder().decode(entries[1].data)).toBe('hello tar');
		expect(entries[2].mode).toBe(0o755);
	});

	it('extracts .tar.gz archives and creates implicit parent directories', async () => {
		const tar = buildTarBytes([
			{ path: 'bundle/readme.md', type: 'file', mode: 0o644, data: '# Bundle' }
		]);
		const tgz = new Uint8Array(gzipSync(tar));

		const entries = await extractArchiveBytes(tgz, 'bundle.tar.gz');
		expect(entries.map((e) => `${e.type}:${e.path}`)).toEqual([
			'dir:bundle',
			'file:bundle/readme.md'
		]);
		expect(new TextDecoder().decode(entries[1].data)).toBe('# Bundle');
	});

	it('extracts stored .zip archives', async () => {
		const zip = buildStoredZip([{ path: 'cli/app.txt', data: 'zip payload' }]);
		const entries = await extractArchiveBytes(zip, 'cli.zip');
		expect(entries.map((e) => `${e.type}:${e.path}`)).toEqual(['dir:cli', 'file:cli/app.txt']);
		expect(new TextDecoder().decode(entries[1].data)).toBe('zip payload');
	});

	it('rejects corrupted gzip and tar archives cleanly', async () => {
		await expect(gunzipBytes(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow(/gzip/i);
		await expect(extractArchiveBytes(new Uint8Array(600).fill(99), 'bad.tar')).rejects.toThrow(/corrupted tar/i);
		await expect(extractArchiveBytes(new Uint8Array([1, 2, 3]), 'bad.zip')).rejects.toThrow(/zip/i);
	});
});
