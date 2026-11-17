import { writable } from 'svelte/store';
import {
	createWorkspaceDir,
	normalizeWorkspacePath,
	writeWorkspaceFile
} from '../fs/fileBridge.js';
import { extractArchiveBytes, isArchiveFilename } from '../fs/archiveHelper.js';

export const downloadHistory = writable([]);

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/**
 * Validate that a download URL uses http: or https: only.
 * Blocks javascript:, data:, file:, ftp:, blob:, etc.
 * @param {string} rawUrl
 * @returns {string} normalized href
 */
export function validateDownloadUrl(rawUrl) {
	if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
		throw new Error('Download URL is required');
	}
	const trimmed = rawUrl.trim();
	let parsed;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error(`Invalid URL: "${trimmed}"`);
	}
	if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
		throw new Error(
			`Blocked URL scheme "${parsed.protocol}" — only http: and https: URLs are allowed`
		);
	}
	return parsed.href;
}

/**
 * Rewrite a validated target URL through an optional user-configured CORS proxy.
 * Supports `{url}` template placeholder, `?url=` / `=` query prefixes, or path prefixes.
 * @param {string} targetUrl
 * @param {string} [corsProxy]
 * @returns {string}
 */
export function applyCorsProxy(targetUrl, corsProxy = '') {
	const validatedTarget = validateDownloadUrl(targetUrl);
	if (typeof corsProxy !== 'string' || corsProxy.trim().length === 0) {
		return validatedTarget;
	}
	const proxy = corsProxy.trim();
	const proxyBase = proxy.replace(/\{url\}/g, 'https://example.com');
	validateDownloadUrl(proxyBase);

	if (proxy.includes('{url}')) {
		return proxy.replace(/\{url\}/g, encodeURIComponent(validatedTarget));
	}
	if (proxy.endsWith('=') || proxy.endsWith('?')) {
		return `${proxy}${encodeURIComponent(validatedTarget)}`;
	}
	return `${proxy.replace(/\/+$/, '')}/${validatedTarget}`;
}

/**
 * Compute lowercase hex SHA-256 digest of a Uint8Array using Web Crypto.
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function computeSha256Hex(bytes) {
	if (!globalThis.crypto?.subtle?.digest) {
		throw new Error('Web Crypto SHA-256 (crypto.subtle.digest) is unavailable in this environment');
	}
	const buffer =
		bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
			? bytes.buffer
			: bytes.slice().buffer;
	const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', buffer);
	const hashBytes = new Uint8Array(hashBuffer);
	return Array.from(hashBytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Extract a clean filename from a URL, stripping query strings and hashes.
 * @param {string} urlStr
 * @param {string} [fallback]
 * @returns {string}
 */
export function inferFilenameFromUrl(urlStr, fallback = 'downloaded_file') {
	try {
		const parsed = new URL(urlStr);
		const segments = parsed.pathname.split('/').filter(Boolean);
		const last = segments[segments.length - 1];
		if (last && last.length > 0) {
			return decodeURIComponent(last);
		}
	} catch {
		// fall through
	}
	return fallback;
}

function isArchiveOrWheel(filename) {
	return isArchiveFilename(filename) || /\.whl$/i.test(filename || '');
}

function toArchiveParserFilename(filename) {
	if (/\.whl$/i.test(filename || '')) {
		return filename.replace(/\.whl$/i, '.zip');
	}
	return filename;
}

/**
 * Resolve direct URL or package shortcut (github, pypi, npm) into a downloadable URL + metadata.
 * @param {string} input
 * @param {object} [opts]
 * @param {'auto'|'direct'|'github'|'pypi'|'npm'} [opts.sourceType='auto']
 * @param {string} [opts.corsProxy='']
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<{ resolvedUrl: string, filename: string, expectedSha256?: string, sourceType: string }>}
 */
export async function resolvePackageSource(input, opts = {}) {
	const raw = typeof input === 'string' ? input.trim() : '';
	if (!raw) {
		throw new Error('Download URL or package identifier is required');
	}
	const sourceType = opts.sourceType || 'auto';
	const corsProxy = opts.corsProxy || '';
	const fetchImpl = opts.fetchImpl || globalThis.fetch;

	// If explicit http(s) URL or non-http scheme in direct/auto mode
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
		const validated = validateDownloadUrl(raw);
		// Convert github.com/.../blob/... to raw.githubusercontent.com/...
		if (
			(sourceType === 'github' || sourceType === 'auto') &&
			/^https?:\/\/github\.com\/[^/]+\/[^/]+\/blob\//.test(validated)
		) {
			const rawGh = validated.replace(
				/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/,
				'https://raw.githubusercontent.com/$1/$2/$3'
			);
			return {
				resolvedUrl: rawGh,
				filename: inferFilenameFromUrl(rawGh, 'download.bin'),
				sourceType: 'github'
			};
		}
		return {
			resolvedUrl: validated,
			filename: inferFilenameFromUrl(validated, 'download.bin'),
			sourceType: sourceType === 'auto' ? 'direct' : sourceType
		};
	}

	if (sourceType === 'github') {
		// Supports: owner/repo, owner/repo@ref, owner/repo:path/to/file
		const colonIdx = raw.indexOf(':');
		if (colonIdx > 0) {
			const repoPart = raw.slice(0, colonIdx);
			const filePart = raw.slice(colonIdx + 1).replace(/^\/+/, '');
			const [repoSlug, ref = 'main'] = repoPart.split('@');
			const [owner, repo] = repoSlug.split('/');
			if (!owner || !repo || !filePart) {
				throw new Error('Invalid GitHub file shortcut. Use owner/repo:path/to/file');
			}
			const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePart}`;
			return {
				resolvedUrl: url,
				filename: inferFilenameFromUrl(url, 'file'),
				sourceType: 'github'
			};
		}
		const [repoSlug, ref = 'main'] = raw.split('@');
		const [owner, repo] = repoSlug.split('/');
		if (!owner || !repo) {
			throw new Error('Invalid GitHub shortcut. Use owner/repo or owner/repo@ref');
		}
		const url = `https://github.com/${owner}/${repo}/archive/refs/heads/${ref}.tar.gz`;
		return {
			resolvedUrl: url,
			filename: `${repo}-${ref}.tar.gz`,
			sourceType: 'github'
		};
	}

	if (sourceType === 'pypi') {
		const [pkgName, version] = raw.split('==');
		const cleanPkg = pkgName.trim();
		if (!cleanPkg) throw new Error('PyPI package name is required');
		const metaUrl = version
			? `https://pypi.org/pypi/${encodeURIComponent(cleanPkg)}/${encodeURIComponent(version.trim())}/json`
			: `https://pypi.org/pypi/${encodeURIComponent(cleanPkg)}/json`;
		const res = await fetchImpl(applyCorsProxy(metaUrl, corsProxy));
		if (!res.ok) {
			throw new Error(`PyPI lookup failed for "${cleanPkg}": HTTP ${res.status}`);
		}
		const meta = await res.json();
		const urls = Array.isArray(meta?.urls) ? meta.urls : [];
		const sdist =
			urls.find((u) => u.packagetype === 'sdist' && /\.tar\.gz$/i.test(u.filename || '')) ||
			urls.find((u) => /\.whl$/i.test(u.filename || '')) ||
			urls[0];
		if (!sdist?.url) {
			throw new Error(`No downloadable distribution found on PyPI for "${cleanPkg}"`);
		}
		return {
			resolvedUrl: validateDownloadUrl(sdist.url),
			filename: sdist.filename || inferFilenameFromUrl(sdist.url, `${cleanPkg}.tar.gz`),
			expectedSha256: sdist.digests?.sha256 || undefined,
			sourceType: 'pypi'
		};
	}

	if (sourceType === 'npm') {
		let pkgName = raw;
		let version = 'latest';
		const atIdx = raw.lastIndexOf('@');
		if (atIdx > 0) {
			pkgName = raw.slice(0, atIdx);
			version = raw.slice(atIdx + 1) || 'latest';
		}
		const metaUrl = `https://registry.npmjs.org/${encodeURIComponent(pkgName)}/${encodeURIComponent(version)}`;
		const res = await fetchImpl(applyCorsProxy(metaUrl, corsProxy));
		if (!res.ok) {
			throw new Error(`npm lookup failed for "${pkgName}": HTTP ${res.status}`);
		}
		const meta = await res.json();
		const tarballUrl = meta?.dist?.tarball;
		if (!tarballUrl) {
			throw new Error(`No tarball URL found on npm for "${pkgName}"`);
		}
		return {
			resolvedUrl: validateDownloadUrl(tarballUrl),
			filename: inferFilenameFromUrl(tarballUrl, `${pkgName.replace('/', '-')}.tgz`),
			sourceType: 'npm'
		};
	}

	throw new Error(`Invalid URL: "${raw}"`);
}

function recordHistory(entry) {
	downloadHistory.update((list) => [entry, ...list].slice(0, 50));
}

export function clearDownloadHistory() {
	downloadHistory.set([]);
}

/**
 * Fetch a remote resource via browser fetch(), optionally verify SHA-256,
 * optionally extract archives (.tar, .tar.gz, .tgz, .zip, .whl), and stage into
 * /home/user/workspace and /data.
 *
 * @param {object} options
 * @param {string} options.url
 * @param {'auto'|'direct'|'github'|'pypi'|'npm'} [options.sourceType='auto']
 * @param {string} [options.targetPath='']
 * @param {string} [options.corsProxy='']
 * @param {string} [options.sha256='']
 * @param {boolean} [options.makeExecutable=false]
 * @param {boolean} [options.extractArchives=true]
 * @param {object|null} [options.vmManager=null]
 * @param {typeof fetch} [options.fetchImpl]
 * @returns {Promise<{ ok: true, resolvedUrl: string, sha256: string, size: number, stagedPaths: string[], extractedCount: number }>}
 */
export async function downloadResource(options) {
	const {
		url,
		sourceType = 'auto',
		targetPath = '',
		corsProxy = '',
		sha256 = '',
		makeExecutable = false,
		extractArchives = true,
		vmManager = null,
		fetchImpl = globalThis.fetch
	} = options || {};

	const startedAt = Date.now();
	let resolvedUrl = '';

	try {
		if (typeof fetchImpl !== 'function') {
			throw new Error('Browser fetch() is unavailable');
		}

		const resolved = await resolvePackageSource(url, {
			sourceType,
			corsProxy,
			fetchImpl
		});
		resolvedUrl = resolved.resolvedUrl;
		const fetchUrl = applyCorsProxy(resolvedUrl, corsProxy);

		const response = await fetchImpl(fetchUrl);
		if (!response || !response.ok) {
			const status = response ? response.status : 'unknown';
			const statusText = response?.statusText ? ` ${response.statusText}` : '';
			throw new Error(`HTTP ${status}${statusText} fetching ${resolvedUrl}`);
		}

		const arrayBuffer = await response.arrayBuffer();
		const bytes = new Uint8Array(arrayBuffer);

		const actualSha256 = await computeSha256Hex(bytes);
		const expectedHash = (sha256 || resolved.expectedSha256 || '').trim().toLowerCase();
		if (expectedHash) {
			if (!/^[0-9a-f]{64}$/.test(expectedHash)) {
				throw new Error('Invalid expected SHA-256 format (must be 64 hex characters)');
			}
			if (actualSha256 !== expectedHash) {
				throw new Error(
					`SHA-256 verification failed: expected ${expectedHash}, got ${actualSha256}`
				);
			}
		}

		const cleanTarget = targetPath ? normalizeWorkspacePath(targetPath) : '';
		const effectiveFilename = cleanTarget || resolved.filename;
		const stagedPaths = [];
		let extractedCount = 0;

		if (extractArchives && isArchiveOrWheel(resolved.filename)) {
			// Extract completely in-memory first; if archive is corrupted, throws before any staging!
			const parserName = toArchiveParserFilename(resolved.filename);
			const members = await extractArchiveBytes(bytes, parserName);
			const baseDir = cleanTarget;

			for (const member of members) {
				const dest = baseDir ? `${baseDir}/${member.path}` : member.path;
				if (member.type === 'dir') {
					await createWorkspaceDir(dest, { vmManager });
				} else {
					const isExec = makeExecutable || (member.mode & 0o111) !== 0;
					const written = await writeWorkspaceFile(dest, member.data, {
						mode: member.mode,
						makeExecutable: isExec,
						vmManager
					});
					stagedPaths.push(written.path);
					extractedCount += 1;
				}
			}
		} else {
			const written = await writeWorkspaceFile(effectiveFilename, bytes, {
				makeExecutable,
				vmManager
			});
			stagedPaths.push(written.path);
		}

		const result = {
			ok: true,
			resolvedUrl,
			sha256: actualSha256,
			size: bytes.byteLength,
			stagedPaths,
			extractedCount
		};

		recordHistory({
			id: `dl_${startedAt}_${Math.random().toString(36).slice(2, 7)}`,
			url: String(url || ''),
			resolvedUrl,
			sourceType: resolved.sourceType,
			status: 'success',
			sha256: actualSha256,
			size: bytes.byteLength,
			stagedPaths,
			extractedCount,
			timestamp: Date.now()
		});

		return result;
	} catch (err) {
		const message = err?.message || 'Download failed';
		recordHistory({
			id: `dl_${startedAt}_${Math.random().toString(36).slice(2, 7)}`,
			url: String(url || ''),
			resolvedUrl,
			sourceType,
			status: 'error',
			error: message,
			timestamp: Date.now()
		});
		throw err;
	}
}
