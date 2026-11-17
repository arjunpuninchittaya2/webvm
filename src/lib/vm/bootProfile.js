// VM boot profiles: pick Debian / Alpine / a custom .ext2 over HTTP(S), plus uid/gid/env/cmd overrides.
// The profile is persisted in localStorage and applied at the next boot (see resolveBootConfig).

export const BOOT_PROFILE_STORAGE_KEY = 'webvm.bootprofile.v1';

export const DISTRO_PRESETS = Object.freeze({
	debian: Object.freeze({
		label: 'Debian (terminal)',
		diskImageUrl: 'wss://disks.webvm.io/debian_buster_large_permis_fixed_01-06-2026.ext2',
		diskImageType: 'cloud',
		printIntro: true,
		needsDisplay: false,
		cmd: '/bin/bash',
		args: ['--login'],
		cacheId: 'blocks_terminal',
		opts: {
			env: ['HOME=/home/user', 'TERM=xterm', 'USER=user', 'SHELL=/bin/bash', 'EDITOR=vim', 'LANG=en_US.UTF-8', 'LC_ALL=C'],
			cwd: '/home/user',
			uid: 1000,
			gid: 1000
		}
	}),
	alpine: Object.freeze({
		label: 'Alpine (graphical)',
		diskImageUrl: 'wss://disks.webvm.io/alpine_20251007.ext2',
		diskImageType: 'cloud',
		printIntro: false,
		needsDisplay: true,
		cmd: '/sbin/init',
		args: [],
		cacheId: 'blocks_alpine',
		opts: { uid: 0, gid: 0 }
	})
});

export const PROFILE_OPTIONS = Object.freeze([
	{ value: 'debian', label: 'Debian (terminal)' },
	{ value: 'alpine', label: 'Alpine (graphical)' },
	{ value: 'custom', label: 'Custom .ext2 image' }
]);

export const DEFAULT_PROFILE = Object.freeze({
	distro: 'debian',
	customUrl: '',
	uid: '',
	gid: '',
	env: '',
	cmd: ''
});

const ENV_LINE_RE = /^[A-Za-z_][A-Za-z0-9_]*=.*$/;
const MAX_ID = 4294967294;

function parseId(raw, label, errors) {
	const text = String(raw ?? '').trim();
	if (text === '') return '';
	if (!/^\d+$/.test(text) || Number(text) > MAX_ID) {
		errors.push(`Invalid ${label}: must be a non-negative integer`);
		return '';
	}
	return text;
}

/** Splits a multi-line env text into KEY=VALUE entries; returns { list, errors }. */
export function parseEnvText(text) {
	const list = [];
	const errors = [];
	for (const rawLine of String(text ?? '').split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;
		if (!ENV_LINE_RE.test(line)) {
			errors.push(`Malformed environment line "${line.slice(0, 40)}" (expected KEY=VALUE)`);
			continue;
		}
		list.push(line);
	}
	return { list, errors };
}

/** Validates user form input. Returns { ok, errors, profile } where profile is normalized. */
export function validateProfile(raw) {
	const src = raw && typeof raw === 'object' ? raw : {};
	const errors = [];
	const distro = PROFILE_OPTIONS.some((o) => o.value === src.distro) ? src.distro : 'debian';
	if (src.distro && distro !== src.distro) errors.push(`Invalid profile "${String(src.distro).slice(0, 20)}"`);

	const customUrl = String(src.customUrl ?? '').trim();
	if (customUrl) {
		let valid = false;
		try {
			const u = new URL(customUrl);
			valid = u.protocol === 'https:' || u.protocol === 'http:';
		} catch {
			valid = false;
		}
		if (!valid) errors.push('Invalid URL: custom .ext2 image must start with http:// or https://');
	}
	if (distro === 'custom' && !customUrl) errors.push('Invalid URL: custom profile requires an http(s) .ext2 image URL');

	const uid = parseId(src.uid, 'UID', errors);
	const gid = parseId(src.gid, 'GID', errors);
	const env = parseEnvText(src.env);
	errors.push(...env.errors);

	const cmd = String(src.cmd ?? '').trim();
	if (cmd && !cmd.startsWith('/')) errors.push('Invalid command: must be an absolute path (e.g. /bin/sh -l)');

	return {
		ok: errors.length === 0,
		errors,
		profile: { distro, customUrl, uid, gid, env: env.list.join('\n'), cmd }
	};
}

function getStorage(storage) {
	if (storage) return storage;
	try {
		return typeof localStorage !== 'undefined' ? localStorage : null;
	} catch {
		return null;
	}
}

export function loadProfile(storage) {
	const store = getStorage(storage);
	if (!store) return { ...DEFAULT_PROFILE };
	try {
		const raw = store.getItem(BOOT_PROFILE_STORAGE_KEY);
		if (!raw) return { ...DEFAULT_PROFILE };
		const res = validateProfile(JSON.parse(raw));
		// Fall back to defaults for fields that no longer validate (corrupted storage).
		return res.ok ? res.profile : { ...DEFAULT_PROFILE };
	} catch {
		return { ...DEFAULT_PROFILE };
	}
}

/** Validates then persists. Never persists invalid input. */
export function saveProfile(raw, storage) {
	const res = validateProfile(raw);
	if (!res.ok) return res;
	const store = getStorage(storage);
	try {
		store?.setItem(BOOT_PROFILE_STORAGE_KEY, JSON.stringify(res.profile));
	} catch {
		return { ...res, ok: false, errors: ['Unable to persist profile (browser storage unavailable)'] };
	}
	return res;
}

function hashString(str) {
	let h = 5381;
	for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
	return h.toString(36);
}

function nativeDistroOf(base) {
	return base?.cmd === '/sbin/init' ? 'alpine' : 'debian';
}

/**
 * Merges a stored profile onto the route's base config. Returns a new config object
 * plus { cacheId, distro } so each distinct disk image gets its own IDB overlay cache.
 */
export function resolveBootConfig(base, profile, routeCacheId) {
	const p = profile || DEFAULT_PROFILE;
	const baseCfg = base || DISTRO_PRESETS.debian;
	const native = nativeDistroOf(baseCfg);
	let out;
	let cacheId = routeCacheId || baseCfg.cacheId || 'blocks_terminal';

	if (p.distro === 'custom' && p.customUrl) {
		out = {
			diskImageUrl: p.customUrl,
			diskImageType: 'bytes',
			printIntro: true,
			needsDisplay: false,
			cmd: '/bin/bash',
			args: ['--login'],
			opts: { ...DISTRO_PRESETS.debian.opts, env: [...DISTRO_PRESETS.debian.opts.env] }
		};
		cacheId = `blocks_custom_${hashString(p.customUrl)}`;
	} else if (p.distro !== native && DISTRO_PRESETS[p.distro]) {
		const preset = DISTRO_PRESETS[p.distro];
		out = {
			diskImageUrl: preset.diskImageUrl,
			diskImageType: preset.diskImageType,
			printIntro: preset.printIntro,
			needsDisplay: preset.needsDisplay,
			cmd: preset.cmd,
			args: [...preset.args],
			opts: { ...preset.opts, env: preset.opts.env ? [...preset.opts.env] : undefined }
		};
		cacheId = preset.cacheId;
	} else {
		out = {
			diskImageUrl: baseCfg.diskImageUrl,
			diskImageType: baseCfg.diskImageType,
			printIntro: baseCfg.printIntro,
			needsDisplay: baseCfg.needsDisplay,
			cmd: baseCfg.cmd,
			args: [...(baseCfg.args || [])],
			opts: { ...(baseCfg.opts || {}), env: baseCfg.opts?.env ? [...baseCfg.opts.env] : undefined }
		};
	}

	if (p.uid !== '' && p.uid != null) out.opts.uid = Number(p.uid);
	if (p.gid !== '' && p.gid != null) out.opts.gid = Number(p.gid);
	const env = parseEnvText(p.env).list;
	if (env.length) {
		const merged = new Map();
		for (const line of out.opts.env || []) merged.set(line.slice(0, line.indexOf('=')), line);
		for (const line of env) merged.set(line.slice(0, line.indexOf('=')), line);
		out.opts.env = [...merged.values()];
	}
	if (!out.opts.env) delete out.opts.env;
	if (p.cmd) {
		const parts = p.cmd.split(/\s+/).filter(Boolean);
		out.cmd = parts[0];
		out.args = parts.slice(1);
	}
	return { config: out, cacheId, distro: p.distro };
}
