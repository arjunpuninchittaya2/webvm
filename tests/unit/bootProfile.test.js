import { describe, it, expect } from 'vitest';
import {
	validateProfile,
	saveProfile,
	loadProfile,
	resolveBootConfig,
	parseEnvText,
	DEFAULT_PROFILE,
	BOOT_PROFILE_STORAGE_KEY,
	DISTRO_PRESETS
} from '../../src/lib/vm/bootProfile.js';
import * as debianCfg from '../../config_public_terminal.js';
import * as alpineCfg from '../../config_public_alpine.js';

function memStorage() {
	const m = new Map();
	return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}

describe('validateProfile', () => {
	it('rejects negative uid and malformed env lines', () => {
		const res = validateProfile({ distro: 'debian', uid: '-1', env: 'INVALID_NO_EQUALS' });
		expect(res.ok).toBe(false);
		expect(res.errors.join(' ')).toMatch(/Invalid UID/);
		expect(res.errors.join(' ')).toMatch(/KEY=VALUE/);
	});
	it('rejects non-http(s) custom urls even when distro is not custom', () => {
		const res = validateProfile({ distro: 'debian', customUrl: 'ftp://bad/disk.ext2' });
		expect(res.ok).toBe(false);
		expect(res.errors[0]).toMatch(/Invalid URL/);
	});
	it('requires a url for the custom profile', () => {
		expect(validateProfile({ distro: 'custom' }).ok).toBe(false);
	});
	it('rejects relative commands and unknown distros', () => {
		expect(validateProfile({ cmd: 'bash' }).ok).toBe(false);
		expect(validateProfile({ distro: 'arch' }).ok).toBe(false);
	});
	it('accepts a full valid profile and normalizes env', () => {
		const res = validateProfile({ distro: 'alpine', uid: ' 1000 ', gid: '1000', env: 'LC_ALL=C\n\nHOME=/home/user\n', cmd: '/bin/sh -l' });
		expect(res.ok).toBe(true);
		expect(res.profile).toMatchObject({ uid: '1000', env: 'LC_ALL=C\nHOME=/home/user' });
	});
});

describe('parseEnvText', () => {
	it('keeps values containing = and flags bad names', () => {
		const r = parseEnvText('A=b=c\n1BAD=x');
		expect(r.list).toEqual(['A=b=c']);
		expect(r.errors).toHaveLength(1);
	});
});

describe('persistence', () => {
	it('never persists invalid input and round-trips valid input', () => {
		const st = memStorage();
		expect(saveProfile({ uid: 'abc' }, st).ok).toBe(false);
		expect(st._m.size).toBe(0);
		expect(saveProfile({ distro: 'alpine', uid: '5' }, st).ok).toBe(true);
		expect(loadProfile(st)).toMatchObject({ distro: 'alpine', uid: '5' });
	});
	it('falls back to defaults on corrupted storage', () => {
		const st = memStorage();
		st.setItem(BOOT_PROFILE_STORAGE_KEY, '{not json');
		expect(loadProfile(st)).toEqual(DEFAULT_PROFILE);
		st.setItem(BOOT_PROFILE_STORAGE_KEY, JSON.stringify({ distro: 'debian', uid: '-9' }));
		expect(loadProfile(st)).toEqual(DEFAULT_PROFILE);
	});
});

describe('resolveBootConfig', () => {
	it('keeps the route config and cache when profile matches native distro', () => {
		const r = resolveBootConfig(debianCfg, DEFAULT_PROFILE, 'blocks_terminal');
		expect(r.config.diskImageUrl).toBe(debianCfg.diskImageUrl);
		expect(r.cacheId).toBe('blocks_terminal');
		expect(r.config.opts.uid).toBe(1000);
	});
	it('default profile keeps the alpine route on alpine (regression: must not fall back to debian)', () => {
		const r = resolveBootConfig(alpineCfg, DEFAULT_PROFILE, 'blocks_alpine');
		expect(r.config.cmd).toBe('/sbin/init');
		expect(r.config.needsDisplay).toBe(true);
		expect(r.cacheId).toBe('blocks_alpine');
	});
	it('explicit debian profile on the alpine route switches to debian', () => {
		const r = resolveBootConfig(alpineCfg, { ...DEFAULT_PROFILE, distro: 'debian' }, 'blocks_alpine');
		expect(r.config.cmd).toBe('/bin/bash');
		expect(r.cacheId).toBe('blocks_terminal');
	});
	it('switches to the alpine preset with its own cache on the debian route', () => {
		const r = resolveBootConfig(debianCfg, { ...DEFAULT_PROFILE, distro: 'alpine' }, 'blocks_terminal');
		expect(r.config.cmd).toBe('/sbin/init');
		expect(r.config.needsDisplay).toBe(true);
		expect(r.cacheId).toBe('blocks_alpine');
		expect(r.config.diskImageUrl).toBe(alpineCfg.diskImageUrl);
	});
	it('presets mirror the shipped config files', () => {
		expect(DISTRO_PRESETS.debian.diskImageUrl).toBe(debianCfg.diskImageUrl);
		expect(DISTRO_PRESETS.alpine.diskImageUrl).toBe(alpineCfg.diskImageUrl);
	});
	it('custom profile uses HttpBytesDevice type and a url-specific cache', () => {
		const a = resolveBootConfig(debianCfg, { ...DEFAULT_PROFILE, distro: 'custom', customUrl: 'https://x.test/a.ext2' }, 'blocks_terminal');
		const b = resolveBootConfig(debianCfg, { ...DEFAULT_PROFILE, distro: 'custom', customUrl: 'https://x.test/b.ext2' }, 'blocks_terminal');
		expect(a.config.diskImageType).toBe('bytes');
		expect(a.cacheId).not.toBe(b.cacheId);
		expect(a.cacheId).not.toBe('blocks_terminal');
	});
	it('applies uid/gid/env/cmd overrides, merging env by key without mutating the base', () => {
		const before = [...debianCfg.opts.env];
		const r = resolveBootConfig(debianCfg, { ...DEFAULT_PROFILE, uid: '0', gid: '0', env: 'LC_ALL=en_US\nFOO=bar', cmd: '/bin/sh -l' }, 'x');
		expect(r.config.opts.uid).toBe(0);
		expect(r.config.opts.env.filter((e) => e.startsWith('LC_ALL='))).toEqual(['LC_ALL=en_US']);
		expect(r.config.opts.env).toContain('FOO=bar');
		expect(r.config.cmd).toBe('/bin/sh');
		expect(r.config.args).toEqual(['-l']);
		expect(debianCfg.opts.env).toEqual(before);
	});
});
