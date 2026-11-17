import { writable, get } from 'svelte/store';
import { extractArchiveBytes, isArchiveFilename } from './archiveHelper.js';

export const WORKSPACE_MOUNT_PATH = '/home/user/workspace';
export const WORKSPACE_LS_KEY = 'webvm.workspace.v1';
export const WORKSPACE_IDB_NAME = 'webvm_workspace_vfs';
export const WORKSPACE_IDB_STORE = 'entries';
const LS_MIRROR_MAX_BYTES = 2 * 1024 * 1024; // 2 MB cap for synchronous localStorage mirror

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: false });

/**
 * @typedef {Object} WorkspaceEntry
 * @property {string} path
 * @property {string} name
 * @property {string} parentDir
 * @property {'file'|'dir'} type
 * @property {number} size
 * @property {number} mode
 * @property {boolean} executable
 * @property {boolean} isBinary
 * @property {'i386'|'x86_64'|'other'|null} elfArch
 * @property {string} mimeType
 * @property {number} updatedAt
 * @property {Uint8Array} [data]
 */

export function bytesToBase64(bytes) {
	if (!bytes || bytes.length === 0) return '';
	if (typeof Buffer !== 'undefined' && typeof window === 'undefined') {
		return Buffer.from(bytes).toString('base64');
	}
	let binary = '';
	const chunkSize = 0x8000;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const chunk = bytes.subarray(i, i + chunkSize);
		binary += String.fromCharCode(...chunk);
	}
	return btoa(binary);
}

export function base64ToBytes(b64) {
	if (!b64) return new Uint8Array(0);
	if (typeof Buffer !== 'undefined' && typeof window === 'undefined') {
		return new Uint8Array(Buffer.from(b64, 'base64'));
	}
	const binary = atob(b64);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		out[i] = binary.charCodeAt(i);
	}
	return out;
}

export function validateEntryName(rawName) {
	const name = String(rawName ?? '').trim();
	if (!name) {
		return { valid: false, error: 'Invalid name: name cannot be empty' };
	}
	if (
		name === '.' ||
		name === '..' ||
		name.includes('/') ||
		name.includes('\\') ||
		name.includes('\0')
	) {
		return {
			valid: false,
			error: 'Invalid name: path traversal (..) and path separators are not permitted'
		};
	}
	return { valid: true, name };
}

export function normalizeWorkspacePath(rawPath) {
	let p = String(rawPath ?? '').trim().replace(/\\/g, '/');
	if (p.includes('\0')) {
		throw new Error('Invalid path: null byte is not permitted');
	}
	for (const prefix of ['/home/user/workspace', '/workspace', '/data']) {
		if (p === prefix) {
			p = '';
			break;
		}
		if (p.startsWith(prefix + '/')) {
			p = p.slice(prefix.length + 1);
			break;
		}
	}
	p = p.replace(/^(\.\/)+/, '').replace(/^\/+/, '').replace(/\/+$/, '');
	if (!p) return '';
	const segments = p.split('/').filter((s) => s.length > 0 && s !== '.');
	for (const seg of segments) {
		if (seg === '..') {
			throw new Error('Invalid path: path traversal (..) is not permitted');
		}
	}
	return segments.join('/');
}

export function detectElfArch(bytes) {
	if (!(bytes instanceof Uint8Array) || bytes.length < 20) return null;
	if (bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46) {
		return null;
	}
	const eiClass = bytes[4];
	const eMachine = bytes[18] | (bytes[19] << 8);
	if (eiClass === 2 || eMachine === 62) return 'x86_64';
	if (eiClass === 1 && (eMachine === 3 || eMachine === 0)) return 'i386';
	return 'other';
}

export function isBinaryBuffer(bytes) {
	if (!(bytes instanceof Uint8Array) || bytes.length === 0) return false;
	const sampleLen = Math.min(bytes.length, 8192);
	let sample = bytes.subarray(0, sampleLen);
	for (let i = 0; i < sample.length; i++) {
		if (sample[i] === 0x00) return true;
	}
	if (bytes.length > sampleLen) {
		let leadIdx = sampleLen - 1;
		while (leadIdx >= Math.max(0, sampleLen - 4) && (sample[leadIdx] & 0xc0) === 0x80) {
			leadIdx--;
		}
		if (leadIdx >= 0) {
			const lead = sample[leadIdx];
			let expectedLen = 0;
			if ((lead & 0xe0) === 0xc0) expectedLen = 2;
			else if ((lead & 0xf0) === 0xe0) expectedLen = 3;
			else if ((lead & 0xf8) === 0xf0) expectedLen = 4;
			if (expectedLen > 0 && sampleLen - leadIdx < expectedLen) {
				sample = sample.subarray(0, leadIdx);
			}
		}
	}
	try {
		new TextDecoder('utf-8', { fatal: true }).decode(sample);
		return false;
	} catch {
		return true;
	}
}

export function guessMimeType(filename, isBinary = false) {
	const lower = String(filename || '').toLowerCase();
	if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
	if (lower.endsWith('.css')) return 'text/css';
	if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'application/javascript';
	if (lower.endsWith('.json')) return 'application/json';
	if (lower.endsWith('.md')) return 'text/markdown';
	if (lower.endsWith('.py')) return 'text/x-python';
	if (lower.endsWith('.sh') || lower.endsWith('.bash')) return 'text/x-shellscript';
	if (lower.endsWith('.txt') || lower.endsWith('.log') || lower.endsWith('.csv')) return 'text/plain';
	if (lower.endsWith('.svg')) return 'image/svg+xml';
	if (lower.endsWith('.png')) return 'image/png';
	if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'application/gzip';
	if (lower.endsWith('.zip')) return 'application/zip';
	return isBinary ? 'application/octet-stream' : 'text/plain';
}

export function inspectPayload(bytes, filename, opts = {}) {
	const elfArch = detectElfArch(bytes);
	if (elfArch) {
		return {
			isBinary: true,
			executable: true,
			elfArch,
			mode: 0o755,
			mimeType: 'application/x-executable'
		};
	}

	const isBinary = isBinaryBuffer(bytes);
	const hasShebang = bytes.length >= 2 && bytes[0] === 0x23 && bytes[1] === 0x21;
	const hasExecExt = /\.(sh|bash|py|pl|rb|lua|run|bin)$/i.test(String(filename || ''));
	const modeExec = typeof opts.mode === 'number' && (opts.mode & 0o111) !== 0;
	const executable = Boolean(opts.makeExecutable || opts.executable || hasShebang || hasExecExt || modeExec);
	const mode = executable ? 0o755 : typeof opts.mode === 'number' ? opts.mode : 0o644;

	return {
		isBinary,
		executable,
		elfArch: null,
		mode,
		mimeType: opts.mimeType || guessMimeType(filename, isBinary)
	};
}

// --- Dual-layer persistence helpers ---

function serializeForMirror(entries) {
	let totalBytes = 0;
	const serialized = [];
	for (const entry of entries) {
		const size = entry.data ? entry.data.length : 0;
		if (totalBytes + size > LS_MIRROR_MAX_BYTES) {
			// Skip large binary payloads in LS mirror; IDB stores everything
			if (entry.type === 'file') {
				serialized.push({
					...entry,
					data: undefined,
					dataBase64: '',
					mirrorTruncated: true
				});
				continue;
			}
		}
		totalBytes += size;
		serialized.push({
			path: entry.path,
			name: entry.name,
			parentDir: entry.parentDir,
			type: entry.type,
			size: entry.size,
			mode: entry.mode,
			executable: entry.executable,
			isBinary: entry.isBinary,
			elfArch: entry.elfArch,
			mimeType: entry.mimeType,
			updatedAt: entry.updatedAt,
			dataBase64: entry.type === 'file' ? bytesToBase64(entry.data) : ''
		});
	}
	return serialized;
}

function hydrateFromLocalStorage() {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(WORKSPACE_LS_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const out = [];
		for (const item of parsed) {
			if (!item || typeof item.path !== 'string') continue;
			const cleanPath = normalizeWorkspacePath(item.path);
			if (!cleanPath) continue;
			const data = item.type === 'file' ? base64ToBytes(item.dataBase64 || '') : new Uint8Array(0);
			out.push({
				path: cleanPath,
				name: item.name || cleanPath.split('/').pop(),
				parentDir: cleanPath.includes('/') ? cleanPath.slice(0, cleanPath.lastIndexOf('/')) : '',
				type: item.type === 'dir' ? 'dir' : 'file',
				size: item.type === 'dir' ? 0 : data.length,
				mode: typeof item.mode === 'number' ? item.mode : item.type === 'dir' ? 0o755 : 0o644,
				executable: Boolean(item.executable),
				isBinary: Boolean(item.isBinary),
				elfArch: item.elfArch || null,
				mimeType: item.mimeType || 'text/plain',
				updatedAt: item.updatedAt || Date.now(),
				data
			});
		}
		return out;
	} catch {
		return [];
	}
}

function persistLocalStorageMirror(entries) {
	if (typeof localStorage === 'undefined') return;
	try {
		const payload = serializeForMirror(entries);
		localStorage.setItem(WORKSPACE_LS_KEY, JSON.stringify(payload));
	} catch {
		// Ignore quota errors on LS mirror; IDB handles large files
	}
}

function openWorkspaceIdb() {
	if (typeof indexedDB === 'undefined') return Promise.resolve(null);
	return new Promise((resolve) => {
		try {
			const req = indexedDB.open(WORKSPACE_IDB_NAME, 1);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains(WORKSPACE_IDB_STORE)) {
					db.createObjectStore(WORKSPACE_IDB_STORE, { keyPath: 'path' });
				}
			};
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => resolve(null);
		} catch {
			resolve(null);
		}
	});
}

async function idbGetAllEntries() {
	const db = await openWorkspaceIdb();
	if (!db) return null;
	return new Promise((resolve) => {
		try {
			const tx = db.transaction(WORKSPACE_IDB_STORE, 'readonly');
			const store = tx.objectStore(WORKSPACE_IDB_STORE);
			const req = store.getAll();
			req.onsuccess = () => {
				db.close();
				resolve(Array.isArray(req.result) ? req.result : []);
			};
			req.onerror = () => {
				db.close();
				resolve(null);
			};
		} catch {
			db.close();
			resolve(null);
		}
	});
}

async function idbReplaceAllEntries(entries) {
	const db = await openWorkspaceIdb();
	if (!db) return;
	return new Promise((resolve) => {
		try {
			const tx = db.transaction(WORKSPACE_IDB_STORE, 'readwrite');
			const store = tx.objectStore(WORKSPACE_IDB_STORE);
			store.clear();
			for (const entry of entries) {
				store.put({
					...entry,
					data: entry.data instanceof Uint8Array ? Array.from(entry.data) : []
				});
			}
			tx.oncomplete = () => {
				db.close();
				resolve();
			};
			tx.onerror = () => {
				db.close();
				resolve();
			};
		} catch {
			db.close();
			resolve();
		}
	});
}

const initialEntries = hydrateFromLocalStorage();
export const workspaceEntries = writable(initialEntries);

let idbHydrated = false;
export async function ensureWorkspaceHydrated() {
	if (idbHydrated) return get(workspaceEntries);
	idbHydrated = true;
	const current = get(workspaceEntries);
	const idbRows = await idbGetAllEntries();
	if (idbRows && idbRows.length > 0) {
		const lsMap = new Map(current.map((e) => [e.path, e]));
		const mergedMap = new Map();
		for (const row of idbRows) {
			const normalized = {
				...row,
				data: row.data instanceof Uint8Array ? row.data : new Uint8Array(row.data || [])
			};
			const lsEntry = lsMap.get(normalized.path);
			if (lsEntry && (lsEntry.updatedAt || 0) > (normalized.updatedAt || 0)) {
				mergedMap.set(lsEntry.path, lsEntry);
			} else {
				mergedMap.set(normalized.path, normalized);
			}
		}
		for (const lsEntry of current) {
			if (!mergedMap.has(lsEntry.path)) {
				mergedMap.set(lsEntry.path, lsEntry);
			}
		}
		const merged = sortEntries(Array.from(mergedMap.values()));
		workspaceEntries.set(merged);
		persistLocalStorageMirror(merged);
		return merged;
	}
	if (current.length > 0) {
		await idbReplaceAllEntries(current);
	}
	return current;
}

async function commitEntries(nextEntries) {
	workspaceEntries.set(nextEntries);
	persistLocalStorageMirror(nextEntries);
	await idbReplaceAllEntries(nextEntries);
}

function sortEntries(list) {
	return [...list].sort((a, b) => {
		if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
		return a.path.localeCompare(b.path);
	});
}

// --- VM Synchronization ---

export async function stageEntryToVm(entry, vmManager = null) {
	if (!vmManager || !entry) return false;
	const dataDevice = vmManager.getDataDevice?.();
	if (entry.type === 'file' && dataDevice?.writeFile) {
		try {
			await dataDevice.writeFile('/' + entry.path, entry.data || new Uint8Array(0));
		} catch {
			// Ignore if DataDevice is not ready
		}
	}
	const cx = vmManager.getCheerpX?.();
	if (cx && typeof cx.run === 'function') {
		const vmTarget = `${WORKSPACE_MOUNT_PATH}/${entry.path}`;
		try {
			if (entry.type === 'dir') {
				await cx.run('/bin/mkdir', ['-p', vmTarget], { cwd: WORKSPACE_MOUNT_PATH });
			} else {
				const parent = entry.parentDir ? `${WORKSPACE_MOUNT_PATH}/${entry.parentDir}` : WORKSPACE_MOUNT_PATH;
				await cx.run('/bin/mkdir', ['-p', parent], { cwd: WORKSPACE_MOUNT_PATH });
				await cx.run('/bin/cp', [`/data/${entry.path}`, vmTarget], { cwd: WORKSPACE_MOUNT_PATH });
				if (entry.executable) {
					await cx.run('/bin/chmod', ['+x', vmTarget], { cwd: WORKSPACE_MOUNT_PATH });
				}
			}
			return true;
		} catch {
			return false;
		}
	}
	return Boolean(dataDevice);
}

export async function syncAllToVm(vmManager) {
	if (!vmManager) return;
	const entries = get(workspaceEntries);
	for (const entry of sortEntries(entries)) {
		await stageEntryToVm(entry, vmManager);
	}
}

// --- Workspace CRUD Operations ---

export function listWorkspaceEntries(dirPath = '', { recursive = false } = {}) {
	const normDir = normalizeWorkspacePath(dirPath);
	const all = get(workspaceEntries);
	const filtered = recursive
		? all.filter((e) => !normDir || e.path.startsWith(normDir + '/'))
		: all.filter((e) => e.parentDir === normDir);
	return sortEntries(filtered);
}

export function getWorkspaceEntry(filePath) {
	const norm = normalizeWorkspacePath(filePath);
	if (!norm) return null;
	return get(workspaceEntries).find((e) => e.path === norm) || null;
}

export function readWorkspaceFileText(filePath) {
	const entry = getWorkspaceEntry(filePath);
	if (!entry || entry.type !== 'file') return null;
	const data = entry.data || new Uint8Array(0);
	const binary = entry.isBinary || isBinaryBuffer(data);
	return {
		entry,
		isBinary: binary,
		text: binary ? '' : textDecoder.decode(data)
	};
}

function ensureParentDirsInMap(map, filePath) {
	const parts = filePath.split('/');
	for (let i = 1; i < parts.length; i++) {
		const dirPath = parts.slice(0, i).join('/');
		if (!map.has(dirPath)) {
			map.set(dirPath, {
				path: dirPath,
				name: parts[i - 1],
				parentDir: i === 1 ? '' : parts.slice(0, i - 1).join('/'),
				type: 'dir',
				size: 0,
				mode: 0o755,
				executable: true,
				isBinary: false,
				elfArch: null,
				mimeType: 'inode/directory',
				updatedAt: Date.now(),
				data: new Uint8Array(0)
			});
		}
	}
}

export async function createWorkspaceDir(dirPath, opts = {}) {
	const norm = normalizeWorkspacePath(dirPath);
	if (!norm) {
		throw new Error('Invalid name: folder name cannot be empty');
	}
	const baseName = norm.split('/').pop();
	const check = validateEntryName(baseName);
	if (!check.valid) {
		throw new Error(check.error);
	}

	const entries = get(workspaceEntries);
	const map = new Map(entries.map((e) => [e.path, e]));
	ensureParentDirsInMap(map, norm);
	const entry = {
		path: norm,
		name: baseName,
		parentDir: norm.includes('/') ? norm.slice(0, norm.lastIndexOf('/')) : '',
		type: 'dir',
		size: 0,
		mode: 0o755,
		executable: true,
		isBinary: false,
		elfArch: null,
		mimeType: 'inode/directory',
		updatedAt: Date.now(),
		data: new Uint8Array(0)
	};
	map.set(norm, entry);
	await commitEntries(sortEntries(Array.from(map.values())));
	if (opts.vmManager) {
		await stageEntryToVm(entry, opts.vmManager);
	}
	return entry;
}

export async function writeWorkspaceFile(filePath, contentOrBytes, opts = {}) {
	const norm = normalizeWorkspacePath(filePath);
	if (!norm) {
		throw new Error('Invalid name: file name cannot be empty');
	}
	const baseName = norm.split('/').pop();
	const check = validateEntryName(baseName);
	if (!check.valid) {
		throw new Error(check.error);
	}

	const bytes =
		contentOrBytes instanceof Uint8Array
			? new Uint8Array(contentOrBytes)
			: textEncoder.encode(String(contentOrBytes ?? ''));

	const meta = inspectPayload(bytes, baseName, opts);
	const entry = {
		path: norm,
		name: baseName,
		parentDir: norm.includes('/') ? norm.slice(0, norm.lastIndexOf('/')) : '',
		type: 'file',
		size: bytes.length,
		mode: meta.mode,
		executable: meta.executable,
		isBinary: meta.isBinary,
		elfArch: meta.elfArch,
		mimeType: meta.mimeType,
		updatedAt: Date.now(),
		data: bytes
	};

	const entries = get(workspaceEntries);
	const map = new Map(entries.map((e) => [e.path, e]));
	ensureParentDirsInMap(map, norm);
	map.set(norm, entry);
	await commitEntries(sortEntries(Array.from(map.values())));

	if (opts.vmManager) {
		await stageEntryToVm(entry, opts.vmManager);
	}
	return entry;
}

export async function renameWorkspaceEntry(oldPath, newRawName) {
	const normOld = normalizeWorkspacePath(oldPath);
	const check = validateEntryName(newRawName);
	if (!check.valid) {
		throw new Error(check.error);
	}
	const newName = check.name;
	const entries = get(workspaceEntries);
	const target = entries.find((e) => e.path === normOld);
	if (!target) {
		throw new Error('Entry not found');
	}

	const parentDir = target.parentDir;
	const normNew = parentDir ? `${parentDir}/${newName}` : newName;
	if (normNew === normOld) return target;

	const conflict = entries.find((e) => e.path === normNew);
	if (conflict) {
		throw new Error('An entry with that name already exists');
	}

	const now = Date.now();
	const nextEntries = entries.map((e) => {
		if (e.path === normOld) {
			return { ...e, path: normNew, name: newName, updatedAt: now };
		}
		if (target.type === 'dir' && e.path.startsWith(normOld + '/')) {
			const suffix = e.path.slice(normOld.length);
			const nextPath = normNew + suffix;
			return {
				...e,
				path: nextPath,
				parentDir: nextPath.includes('/') ? nextPath.slice(0, nextPath.lastIndexOf('/')) : '',
				updatedAt: now
			};
		}
		return e;
	});

	await commitEntries(sortEntries(nextEntries));
	return nextEntries.find((e) => e.path === normNew);
}

export async function deleteWorkspaceEntry(targetPath) {
	const norm = normalizeWorkspacePath(targetPath);
	if (!norm) return false;
	const entries = get(workspaceEntries);
	const nextEntries = entries.filter((e) => e.path !== norm && !e.path.startsWith(norm + '/'));
	if (nextEntries.length === entries.length) return false;
	await commitEntries(nextEntries);
	return true;
}

export async function setWorkspaceExecutable(targetPath, executable = true, opts = {}) {
	const norm = normalizeWorkspacePath(targetPath);
	const entries = get(workspaceEntries);
	const target = entries.find((e) => e.path === norm && e.type === 'file');
	if (!target) return null;
	const updated = {
		...target,
		executable: Boolean(executable),
		mode: executable ? 0o755 : 0o644,
		updatedAt: Date.now()
	};
	const nextEntries = entries.map((e) => (e.path === norm ? updated : e));
	await commitEntries(nextEntries);
	if (opts.vmManager) {
		await stageEntryToVm(updated, opts.vmManager);
	}
	return updated;
}

export async function resetWorkspace(opts = {}) {
	await commitEntries([]);
	if (typeof localStorage !== 'undefined') {
		try {
			localStorage.removeItem(WORKSPACE_LS_KEY);
		} catch {
			// Ignore
		}
	}
	if (opts.vmManager?.resetWorkspace && !opts.skipVmReset) {
		await opts.vmManager.resetWorkspace({ reload: false, skipBridgeReset: true });
	}
	return true;
}

// --- Host Upload & Archive Import ---

async function readFileAsUint8Array(file) {
	if (file instanceof Uint8Array) return file;
	if (typeof file.arrayBuffer === 'function') {
		const ab = await file.arrayBuffer();
		return new Uint8Array(ab);
	}
	if (file.data instanceof Uint8Array) return file.data;
	return new Uint8Array(0);
}

export async function importHostFiles(fileList, targetDir = '', opts = {}) {
	const files = Array.from(fileList || []);
	const normDir = normalizeWorkspacePath(targetDir);
	const imported = [];
	const extractedArchives = [];
	const errors = [];
	const extractArchives = opts.extractArchives !== false;

	for (const file of files) {
		const rawName = file?.name || 'untitled';
		const check = validateEntryName(rawName);
		if (!check.valid) {
			errors.push(check.error);
			continue;
		}
		try {
			const bytes = await readFileAsUint8Array(file);
			if (extractArchives && isArchiveFilename(check.name)) {
				const members = await extractArchiveBytes(bytes, check.name);
				for (const member of members) {
					const destPath = normDir ? `${normDir}/${member.path}` : member.path;
					if (member.type === 'dir') {
						const dirEntry = await createWorkspaceDir(destPath, { vmManager: opts.vmManager });
						imported.push(dirEntry);
					} else {
						const fileEntry = await writeWorkspaceFile(destPath, member.data, {
							mode: member.mode,
							vmManager: opts.vmManager
						});
						imported.push(fileEntry);
					}
				}
				extractedArchives.push(check.name);
			} else {
				const destPath = normDir ? `${normDir}/${check.name}` : check.name;
				const entry = await writeWorkspaceFile(destPath, bytes, {
					mimeType: file.type || undefined,
					vmManager: opts.vmManager
				});
				imported.push(entry);
			}
		} catch (err) {
			errors.push(err?.message || 'Failed to import file');
		}
	}

	return { imported, extractedArchives, errors };
}

// --- Browser Download ---

function triggerBrowserDownload(blob, filename) {
	if (typeof document === 'undefined' || typeof URL === 'undefined') return false;
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.style.display = 'none';
	document.body.appendChild(a);
	a.click();
	setTimeout(() => {
		a.remove();
		URL.revokeObjectURL(url);
	}, 1000);
	return true;
}

export async function exportVmFile(filePath, opts = {}) {
	const norm = normalizeWorkspacePath(filePath);
	const entry = getWorkspaceEntry(norm);
	let blob = null;

	const workspaceDevice = opts.vmManager?.getWorkspaceDevice?.();
	if (workspaceDevice?.readFileAsBlob) {
		try {
			blob = await workspaceDevice.readFileAsBlob('/' + norm);
		} catch {
			blob = null;
		}
	}

	if (!blob) {
		if (!entry || entry.type !== 'file') {
			throw new Error('File not found in workspace');
		}
		blob = new Blob([entry.data || new Uint8Array(0)], {
			type: entry.mimeType || 'application/octet-stream'
		});
	}

	const filename = entry?.name || norm.split('/').pop() || 'download';
	triggerBrowserDownload(blob, filename);
	return { filename, size: blob.size };
}

// --- Workspace Snapshot Export / Import ---

export function exportWorkspaceSnapshot({ download = true } = {}) {
	const entries = get(workspaceEntries);
	const snapshot = {
		format: 'webvm-workspace-snapshot',
		version: 1,
		exportedAt: Date.now(),
		entries: entries.map((e) => ({
			path: e.path,
			name: e.name,
			parentDir: e.parentDir,
			type: e.type,
			size: e.size,
			mode: e.mode,
			executable: e.executable,
			isBinary: e.isBinary,
			elfArch: e.elfArch,
			mimeType: e.mimeType,
			updatedAt: e.updatedAt,
			dataBase64: e.type === 'file' ? bytesToBase64(e.data || new Uint8Array(0)) : ''
		}))
	};

	if (download) {
		const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
		triggerBrowserDownload(blob, 'workspace-snapshot.json');
	}
	return snapshot;
}

export async function importWorkspaceSnapshot(input, opts = {}) {
	let rawText = '';
	if (typeof input === 'string') {
		rawText = input;
	} else if (input && typeof input.text === 'function') {
		rawText = await input.text();
	} else if (input instanceof Uint8Array) {
		rawText = textDecoder.decode(input);
	} else {
		throw new Error('Invalid snapshot: file is corrupted or failed to import');
	}

	let parsed;
	try {
		parsed = JSON.parse(rawText);
	} catch {
		throw new Error('Invalid snapshot: file is corrupted or failed to import');
	}

	if (
		!parsed ||
		typeof parsed !== 'object' ||
		parsed.format !== 'webvm-workspace-snapshot' ||
		parsed.version !== 1 ||
		!Array.isArray(parsed.entries)
	) {
		throw new Error('Invalid snapshot: file is corrupted or failed to import');
	}

	// Validate all entries before mutating workspace
	const validatedEntries = [];
	for (const item of parsed.entries) {
		if (!item || typeof item.path !== 'string') {
			throw new Error('Invalid snapshot: file is corrupted or failed to import');
		}
		const cleanPath = normalizeWorkspacePath(item.path);
		if (!cleanPath) {
			throw new Error('Invalid snapshot: file is corrupted or failed to import');
		}
		const isDir = item.type === 'dir';
		let data = new Uint8Array(0);
		if (!isDir) {
			if (typeof item.dataBase64 !== 'string') {
				throw new Error('Invalid snapshot: file is corrupted or failed to import');
			}
			data = base64ToBytes(item.dataBase64);
		}
		const derivedName = cleanPath.split('/').pop();
		const nameToValidate = item.name !== undefined && item.name !== null ? item.name : derivedName;
		const nameCheck = validateEntryName(nameToValidate);
		if (!nameCheck.valid) {
			throw new Error('Invalid snapshot: file is corrupted or failed to import');
		}
		validatedEntries.push({
			path: cleanPath,
			name: nameCheck.name,
			parentDir: cleanPath.includes('/') ? cleanPath.slice(0, cleanPath.lastIndexOf('/')) : '',
			type: isDir ? 'dir' : 'file',
			size: isDir ? 0 : data.length,
			mode: typeof item.mode === 'number' ? item.mode : isDir ? 0o755 : 0o644,
			executable: Boolean(item.executable),
			isBinary: Boolean(item.isBinary),
			elfArch: item.elfArch || null,
			mimeType: item.mimeType || (isDir ? 'inode/directory' : 'text/plain'),
			updatedAt: item.updatedAt || Date.now(),
			data
		});
	}

	const existing = get(workspaceEntries);
	const map = new Map(existing.map((e) => [e.path, e]));
	for (const entry of validatedEntries) {
		ensureParentDirsInMap(map, entry.path);
		map.set(entry.path, entry);
	}

	const merged = sortEntries(Array.from(map.values()));
	await commitEntries(merged);

	if (opts.vmManager) {
		for (const entry of validatedEntries) {
			await stageEntryToVm(entry, opts.vmManager);
		}
	}

	return { importedCount: validatedEntries.length, entries: merged };
}

// --- Execution Helper ---

export function buildRunCommand(entry) {
	const vmPath = `${WORKSPACE_MOUNT_PATH}/${entry.path}`;
	const quoted = `"${vmPath.replace(/"/g, '\\"')}"`;
	const lower = entry.name.toLowerCase();

	if (entry.elfArch === 'i386' || entry.elfArch === 'other') {
		return `chmod +x ${quoted} && ${quoted}`;
	}
	if (lower.endsWith('.sh') || lower.endsWith('.bash')) {
		return `/bin/sh ${quoted}`;
	}
	if (lower.endsWith('.py')) {
		return `python3 ${quoted}`;
	}
	if (lower.endsWith('.js') || lower.endsWith('.mjs')) {
		return `node ${quoted}`;
	}
	if (lower.endsWith('.lua')) {
		return `lua ${quoted}`;
	}
	if (lower.endsWith('.c')) {
		return `gcc ${quoted} -o /tmp/webvm_out && /tmp/webvm_out`;
	}
	return `chmod +x ${quoted} && ${quoted}`;
}

export async function executeWorkspaceFile(filePath, { vmManager = null } = {}) {
	const entry = getWorkspaceEntry(filePath);
	if (!entry || entry.type !== 'file') {
		return { ok: false, error: 'File not found in workspace' };
	}

	if (entry.elfArch === 'x86_64') {
		return {
			ok: false,
			error: 'Unsupported architecture: x86_64 ELF binaries cannot run on CheerpX 32-bit i386 Linux'
		};
	}

	if (vmManager) {
		await stageEntryToVm(entry, vmManager);
	}

	const command = buildRunCommand(entry);
	if (vmManager?.runCommandInTerminal) {
		await vmManager.runCommandInTerminal(command, {
			title: entry.name,
			cwd: WORKSPACE_MOUNT_PATH
		});
	} else if (vmManager?.sendInputToActive) {
		vmManager.setActiveVt?.(1);
		vmManager.sendInputToActive(`${command}\r`);
	}

	return { ok: true, command, entry };
}
