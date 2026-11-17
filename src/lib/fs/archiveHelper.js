/**
 * Client-side archive inspection, extraction, and POSIX tar building
 * for .tar, .tar.gz / .tgz, and .zip archives.
 */

const textDecoder = new TextDecoder('utf-8', { fatal: false });
const textEncoder = new TextEncoder();

export function isArchiveFilename(filename) {
	const lower = String(filename || '').toLowerCase();
	return (
		lower.endsWith('.tar.gz') ||
		lower.endsWith('.tgz') ||
		lower.endsWith('.tar') ||
		lower.endsWith('.zip')
	);
}

/**
 * Normalize and validate an archive member path, rejecting traversal attempts.
 * @param {string} rawPath
 * @returns {string}
 */
export function sanitizeArchivePath(rawPath) {
	const raw = String(rawPath || '').replace(/\\/g, '/');
	if (raw.includes('\0')) {
		throw new Error('Invalid archive path: null byte not allowed');
	}
	const trimmed = raw.replace(/^(\.\/)+/, '').replace(/^\/+/, '').replace(/\/+$/, '');
	if (!trimmed) return '';
	const parts = trimmed.split('/').filter((seg) => seg.length > 0 && seg !== '.');
	for (const seg of parts) {
		if (seg === '..') {
			throw new Error('Invalid archive path: path traversal (..) is not allowed');
		}
	}
	return parts.join('/');
}

async function decompressStreamBytes(bytes, format) {
	if (typeof DecompressionStream === 'undefined') {
		throw new Error(`Failed to extract archive: ${format} decompression is not supported in this environment`);
	}
	try {
		const ds = new DecompressionStream(format);
		const writer = ds.writable.getWriter();
		const writePromise = writer.write(bytes).then(() => writer.close());
		const responsePromise = new Response(ds.readable).arrayBuffer();
		const [, ab] = await Promise.all([writePromise, responsePromise]);
		return new Uint8Array(ab);
	} catch (err) {
		throw new Error(`Failed to extract archive: corrupted ${format} stream (${err?.message || err})`);
	}
}

/**
 * Decompress Gzip bytes into raw Uint8Array.
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
export async function gunzipBytes(bytes) {
	if (!(bytes instanceof Uint8Array) || bytes.length < 10 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) {
		throw new Error('Failed to extract archive: invalid or corrupted gzip header');
	}
	return decompressStreamBytes(bytes, 'gzip');
}

function readAsciiString(bytes, start, length) {
	let end = start;
	const max = Math.min(bytes.length, start + length);
	while (end < max && bytes[end] !== 0) {
		end++;
	}
	return textDecoder.decode(bytes.subarray(start, end));
}

function parseOctal(bytes, start, length) {
	const str = readAsciiString(bytes, start, length).trim();
	if (!str) return 0;
	const cleaned = str.replace(/\0.*$/, '').trim();
	if (!cleaned) return 0;
	const val = parseInt(cleaned, 8);
	if (Number.isNaN(val) || val < 0) {
		throw new Error('Corrupted tar archive: invalid octal header field');
	}
	return val;
}

function isZeroBlock(bytes, offset) {
	for (let i = 0; i < 512; i++) {
		if (bytes[offset + i] !== 0) return false;
	}
	return true;
}

function verifyTarChecksum(bytes, offset) {
	const stored = parseOctal(bytes, offset + 148, 8);
	let unsignedSum = 0;
	let signedSum = 0;
	for (let i = 0; i < 512; i++) {
		const b = i >= 148 && i < 156 ? 0x20 : bytes[offset + i];
		unsignedSum += b;
		signedSum += b < 128 ? b : b - 256;
	}
	return stored === unsignedSum || stored === signedSum;
}

/**
 * Parse a POSIX ustar / V7 tar buffer into entries.
 * @param {Uint8Array} tarBytes
 * @returns {Array<{ path: string, name: string, type: 'file'|'dir', mode: number, data: Uint8Array }>}
 */
export function parseTarBytes(tarBytes) {
	if (!(tarBytes instanceof Uint8Array) || tarBytes.length < 512) {
		throw new Error('Corrupted tar archive: buffer is too small');
	}

	const entries = [];
	let offset = 0;
	let nextLongName = null;

	while (offset + 512 <= tarBytes.length) {
		if (isZeroBlock(tarBytes, offset)) {
			break;
		}
		if (!verifyTarChecksum(tarBytes, offset)) {
			throw new Error('Corrupted tar archive: header checksum mismatch');
		}

		const namePart = readAsciiString(tarBytes, offset, 100);
		const mode = parseOctal(tarBytes, offset + 100, 8) || 0o644;
		const size = parseOctal(tarBytes, offset + 124, 12);
		const typeByte = tarBytes[offset + 156];
		const typeflag = typeByte === 0 ? '0' : String.fromCharCode(typeByte);
		const prefixPart = readAsciiString(tarBytes, offset + 345, 155);

		const dataStart = offset + 512;
		const dataEnd = dataStart + size;
		if (dataEnd > tarBytes.length) {
			throw new Error('Corrupted tar archive: unexpected end of file');
		}
		const payload = tarBytes.subarray(dataStart, dataEnd);
		const blocks = Math.ceil(size / 512);
		offset = dataStart + blocks * 512;

		// GNU long name extension
		if (typeflag === 'L') {
			nextLongName = textDecoder.decode(payload).replace(/\0+$/, '');
			continue;
		}
		// PAX extended header or global header: skip
		if (typeflag === 'x' || typeflag === 'g') {
			continue;
		}

		const rawFullName = nextLongName || (prefixPart ? `${prefixPart}/${namePart}` : namePart);
		nextLongName = null;

		const isDir = typeflag === '5' || rawFullName.endsWith('/');
		const cleanPath = sanitizeArchivePath(rawFullName);
		if (!cleanPath) continue;

		const name = cleanPath.split('/').pop();
		if (isDir) {
			entries.push({
				path: cleanPath,
				name,
				type: 'dir',
				mode: mode || 0o755,
				data: new Uint8Array(0)
			});
		} else if (typeflag === '0' || typeflag === '\0' || typeflag === '7') {
			entries.push({
				path: cleanPath,
				name,
				type: 'file',
				mode,
				data: new Uint8Array(payload)
			});
		}
	}

	return entries;
}

function writeAscii(buf, offset, str, maxLen) {
	const encoded = textEncoder.encode(str);
	const len = Math.min(encoded.length, maxLen);
	buf.set(encoded.subarray(0, len), offset);
}

function writeOctal(buf, offset, value, length) {
	const str = value.toString(8).padStart(length - 1, '0');
	writeAscii(buf, offset, str, length - 1);
	buf[offset + length - 1] = 0;
}

/**
 * Build a POSIX ustar tar archive from an array of entries.
 * @param {Array<{ path: string, type?: 'file'|'dir', mode?: number, data?: Uint8Array|string }>} entries
 * @returns {Uint8Array}
 */
export function buildTarBytes(entries) {
	const chunks = [];

	for (const entry of entries) {
		const cleanPath = sanitizeArchivePath(entry.path);
		if (!cleanPath) continue;

		const isDir = entry.type === 'dir';
		const rawData =
			entry.data instanceof Uint8Array
				? entry.data
				: typeof entry.data === 'string'
					? textEncoder.encode(entry.data)
					: new Uint8Array(0);
		const size = isDir ? 0 : rawData.length;
		const header = new Uint8Array(512);

		let name = isDir ? `${cleanPath}/` : cleanPath;
		let prefix = '';
		if (textEncoder.encode(name).length > 100) {
			const slashIdx = name.lastIndexOf('/');
			if (slashIdx > 0) {
				prefix = name.slice(0, slashIdx);
				name = name.slice(slashIdx + 1);
			}
		}

		writeAscii(header, 0, name, 100);
		writeOctal(header, 100, entry.mode ?? (isDir ? 0o755 : 0o644), 8);
		writeOctal(header, 108, 0, 8);
		writeOctal(header, 116, 0, 8);
		writeOctal(header, 124, size, 12);
		writeOctal(header, 136, Math.floor(Date.now() / 1000), 12);
		for (let i = 148; i < 156; i++) header[i] = 0x20;
		header[156] = isDir ? '5'.charCodeAt(0) : '0'.charCodeAt(0);
		writeAscii(header, 257, 'ustar', 6);
		header[262] = 0;
		writeAscii(header, 263, '00', 2);
		if (prefix) {
			writeAscii(header, 345, prefix, 155);
		}

		let checksum = 0;
		for (let i = 0; i < 512; i++) checksum += header[i];
		const chkStr = checksum.toString(8).padStart(6, '0');
		writeAscii(header, 148, chkStr, 6);
		header[154] = 0;
		header[155] = 0x20;

		chunks.push(header);
		if (!isDir && size > 0) {
			const paddedLen = Math.ceil(size / 512) * 512;
			const dataBlock = new Uint8Array(paddedLen);
			dataBlock.set(rawData, 0);
			chunks.push(dataBlock);
		}
	}

	// Two 512-byte zero blocks mark EOF
	chunks.push(new Uint8Array(1024));

	const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
	const out = new Uint8Array(totalLen);
	let pos = 0;
	for (const c of chunks) {
		out.set(c, pos);
		pos += c.length;
	}
	return out;
}

function readU16LE(bytes, offset) {
	return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32LE(bytes, offset) {
	return (
		(bytes[offset] |
			(bytes[offset + 1] << 8) |
			(bytes[offset + 2] << 16) |
			(bytes[offset + 3] << 24)) >>>
		0
	);
}

/**
 * Parse a ZIP archive buffer (supporting stored method 0 and deflate method 8).
 * @param {Uint8Array} zipBytes
 * @returns {Promise<Array<{ path: string, name: string, type: 'file'|'dir', mode: number, data: Uint8Array }>>}
 */
export async function parseZipBytes(zipBytes) {
	if (!(zipBytes instanceof Uint8Array) || zipBytes.length < 22) {
		throw new Error('Corrupted zip archive: buffer is too small');
	}

	// Locate End of Central Directory (0x06054b50)
	let eocdOffset = -1;
	const minOffset = Math.max(0, zipBytes.length - 65557);
	for (let i = zipBytes.length - 22; i >= minOffset; i--) {
		if (
			zipBytes[i] === 0x50 &&
			zipBytes[i + 1] === 0x4b &&
			zipBytes[i + 2] === 0x05 &&
			zipBytes[i + 3] === 0x06
		) {
			eocdOffset = i;
			break;
		}
	}

	if (eocdOffset === -1) {
		throw new Error('Corrupted zip archive: missing central directory');
	}

	const totalEntries = readU16LE(zipBytes, eocdOffset + 10);
	const cdOffset = readU32LE(zipBytes, eocdOffset + 16);
	const entries = [];
	let pos = cdOffset;

	for (let idx = 0; idx < totalEntries; idx++) {
		if (pos + 46 > zipBytes.length || readU32LE(zipBytes, pos) !== 0x02014b50) {
			throw new Error('Corrupted zip archive: invalid central directory entry');
		}
		const method = readU16LE(zipBytes, pos + 10);
		const compressedSize = readU32LE(zipBytes, pos + 20);
		const fileNameLen = readU16LE(zipBytes, pos + 28);
		const extraLen = readU16LE(zipBytes, pos + 30);
		const commentLen = readU16LE(zipBytes, pos + 32);
		const extAttrs = readU32LE(zipBytes, pos + 38);
		const localHeaderOffset = readU32LE(zipBytes, pos + 42);

		const rawName = textDecoder.decode(zipBytes.subarray(pos + 46, pos + 46 + fileNameLen));
		pos += 46 + fileNameLen + extraLen + commentLen;

		const isDir = rawName.endsWith('/');
		const cleanPath = sanitizeArchivePath(rawName);
		if (!cleanPath) continue;

		const unixMode = (extAttrs >>> 16) & 0o777;
		const mode = unixMode || (isDir ? 0o755 : 0o644);
		const name = cleanPath.split('/').pop();

		if (isDir) {
			entries.push({ path: cleanPath, name, type: 'dir', mode, data: new Uint8Array(0) });
			continue;
		}

		if (localHeaderOffset + 30 > zipBytes.length || readU32LE(zipBytes, localHeaderOffset) !== 0x04034b50) {
			throw new Error('Corrupted zip archive: invalid local file header');
		}
		const lfhNameLen = readU16LE(zipBytes, localHeaderOffset + 26);
		const lfhExtraLen = readU16LE(zipBytes, localHeaderOffset + 28);
		const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
		const dataEnd = dataStart + compressedSize;
		if (dataEnd > zipBytes.length) {
			throw new Error('Corrupted zip archive: unexpected end of file');
		}
		const compressed = zipBytes.subarray(dataStart, dataEnd);

		let data;
		if (method === 0) {
			data = new Uint8Array(compressed);
		} else if (method === 8) {
			data = await decompressStreamBytes(compressed, 'deflate-raw');
		} else {
			throw new Error(`Unsupported zip compression method: ${method}`);
		}

		entries.push({ path: cleanPath, name, type: 'file', mode, data });
	}

	return entries;
}

/**
 * Extract a .tar, .tar.gz / .tgz, or .zip archive into normalized entries,
 * ensuring implicit parent directories are included.
 * @param {Uint8Array} bytes
 * @param {string} filename
 * @returns {Promise<Array<{ path: string, name: string, type: 'file'|'dir', mode: number, data: Uint8Array }>>}
 */
export async function extractArchiveBytes(bytes, filename) {
	const lower = String(filename || '').toLowerCase();
	let rawEntries;
	if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
		const tarBytes = await gunzipBytes(bytes);
		rawEntries = parseTarBytes(tarBytes);
	} else if (lower.endsWith('.tar')) {
		rawEntries = parseTarBytes(bytes);
	} else if (lower.endsWith('.zip')) {
		rawEntries = await parseZipBytes(bytes);
	} else {
		throw new Error(`Unsupported archive format: ${filename}`);
	}

	const dirSet = new Set();
	const result = [];
	for (const entry of rawEntries) {
		if (entry.type === 'dir') {
			dirSet.add(entry.path);
		}
	}

	for (const entry of rawEntries) {
		const parts = entry.path.split('/');
		for (let i = 1; i < parts.length; i++) {
			const parentPath = parts.slice(0, i).join('/');
			if (!dirSet.has(parentPath)) {
				dirSet.add(parentPath);
				result.push({
					path: parentPath,
					name: parts[i - 1],
					type: 'dir',
					mode: 0o755,
					data: new Uint8Array(0)
				});
			}
		}
		result.push(entry);
	}

	return result;
}
