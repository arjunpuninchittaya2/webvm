// Tier 5: adversarial / hostile-input tests for M5 features.
import { describe, it, expect, vi } from 'vitest';
import { get } from 'svelte/store';
import { parseCron, cronMatches, createSupervisor, wrapCommand, SERVICES_STORAGE_KEY } from '../../src/lib/vm/serviceSupervisor.js';
import { buildStopScript, jobMarker, parseProcSnapshot, sparklinePoints, readStorageEstimate } from '../../src/lib/vm/processMonitor.js';
import { validateProfile, loadProfile, resolveBootConfig, DEFAULT_PROFILE, BOOT_PROFILE_STORAGE_KEY } from '../../src/lib/vm/bootProfile.js';
import * as debianCfg from '../../config_public_terminal.js';

const mem = (init = {}) => {
	const m = new Map(Object.entries(init));
	return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};
const vm = () => ({ isReady: () => true, spawnBackground: vi.fn(() => new Promise(() => {})), execQuiet: vi.fn(async () => ({ status: 0 })) });

describe('shell-injection resistance', () => {
	it('stop script strips quotes/metacharacters from job ids', () => {
		const s = buildStopScript("x'; rm -rf / #");
		expect(s).not.toContain('rm -rf');
		expect(s).toContain('[w]ebvm-svc-xrm-rf');
	});
	it('marker and log path never contain unsafe characters', () => {
		expect(jobMarker("a b'c$(x)")).toBe('webvm-svc-abcx');
		expect(wrapCommand("a'b", 'true')).not.toMatch(/a'b/);
	});
});

describe('cron adversarial', () => {
	it.each(['* * * * * *', '*/ * * * *', '1-2-3 * * * *', '-1 * * * *', '1,,2 * * * *', '*/-5 * * * *', '0x1 * * * *', '1e1 * * * *', ' '])('rejects %j', (e) => {
		expect(parseCron(e).ok).toBe(false);
	});
	it('does not hang on enormous numbers or huge input', () => {
		const t = Date.now();
		expect(parseCron('99999999999999999999 * * * *').ok).toBe(false);
		expect(parseCron('*/1 '.repeat(5000)).ok).toBe(false);
		expect(Date.now() - t).toBeLessThan(500);
	});
	it('non-string input is rejected without throwing', () => {
		for (const v of [null, undefined, 5, {}, []]) expect(parseCron(v).ok).toBe(false);
		expect(cronMatches(null, new Date())).toBe(false);
	});
	it('day-of-week 7 equals Sunday', () => {
		expect(cronMatches('0 0 * * 7', new Date(2025, 0, 5, 0, 0))).toBe(true);
	});
});

describe('supervisor adversarial', () => {
	it('spawn rejection marks failed instead of leaking an unhandled rejection', async () => {
		const v = vm();
		v.spawnBackground = vi.fn(() => Promise.reject(new Error('boom')));
		const sup = createSupervisor({ vm: v });
		sup.start('heartbeat');
		await new Promise((r) => setTimeout(r, 0));
		expect(get(sup.services).find((s) => s.id === 'heartbeat')).toMatchObject({ status: 'failed', error: 'boom' });
	});
	it('stop/start of unknown ids is a no-op', async () => {
		const sup = createSupervisor({ vm: vm() });
		expect(sup.start('nope')).toBe(false);
		expect(await sup.stop('nope')).toBe(false);
	});
	it('a failing stop script does not leave the service marked running', async () => {
		const v = vm();
		v.execQuiet = vi.fn(async () => {
			throw new Error('vm gone');
		});
		const sup = createSupervisor({ vm: v });
		sup.start('heartbeat');
		await sup.stop('heartbeat');
		expect(get(sup.services).find((s) => s.id === 'heartbeat').status).toBe('stopped');
	});
	it('cron spawn failure does not break the scheduler loop', () => {
		const v = vm();
		v.spawnBackground = vi.fn(() => Promise.reject(new Error('x')));
		const sup = createSupervisor({ vm: v });
		sup.addCron('* * * * *', 'true');
		expect(() => sup.tick(new Date(2025, 0, 1, 0, 0))).not.toThrow();
	});
	it('storage with hostile entries is filtered, valid ones kept', () => {
		const st = mem({
			[SERVICES_STORAGE_KEY]: JSON.stringify({
				custom: [null, 7, { id: 'a', name: 'x', command: '' }, { id: 'ok', name: 'ok', command: 'ls' }, { id: 'nl', name: 'n', command: 'a\nb' }],
				jobs: [{ schedule: '99 99 * * *', command: 'x' }, { id: 'j', schedule: '* * * * *', command: 'ls' }, null]
			})
		});
		const sup = createSupervisor({ vm: vm(), storage: st });
		expect(get(sup.services).filter((s) => !s.builtin).map((s) => s.id)).toEqual(['ok']);
		expect(get(sup.jobs)).toHaveLength(1);
	});
	it('throwing storage never breaks adding jobs', () => {
		const st = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
		const sup = createSupervisor({ vm: vm(), storage: st });
		expect(sup.addCron('* * * * *', 'ls').ok).toBe(true);
	});
	it('disposed supervisor ignores ticks', () => {
		const v = vm();
		const sup = createSupervisor({ vm: v });
		sup.addCron('* * * * *', 'ls');
		sup.dispose();
		sup.tick(new Date(2025, 0, 1, 0, 0));
		expect(v.spawnBackground).not.toHaveBeenCalled();
	});
});

describe('boot profile adversarial', () => {
	it.each(['1e3', '0x10', '1.5', ' ', '99999999999', '--1', '١٢'])('uid %j is rejected (or empty)', (uid) => {
		const r = validateProfile({ uid });
		if (uid.trim() === '') expect(r.ok).toBe(true);
		else expect(r.ok).toBe(false);
	});
	it('javascript:/file:/data: custom urls are rejected', () => {
		for (const u of ['javascript:alert(1)', 'file:///etc/disk.ext2', 'data:text/plain,x', '//no-scheme/x.ext2', 'https://']) {
			expect(validateProfile({ customUrl: u }).ok).toBe(false);
		}
	});
	it('prototype-pollution style keys in storage do not leak into the profile', () => {
		const st = mem({ [BOOT_PROFILE_STORAGE_KEY]: '{"__proto__":{"polluted":1},"distro":"alpine","uid":"3"}' });
		const p = loadProfile(st);
		expect(p.polluted).toBeUndefined();
		expect({}.polluted).toBeUndefined();
		expect(p).toMatchObject({ distro: 'alpine', uid: '3' });
	});
	it('env with CRLF, whitespace-only and = only lines is handled', () => {
		expect(validateProfile({ env: 'A=1\r\n   \r\nB=2' }).profile.env).toBe('A=1\nB=2');
		expect(validateProfile({ env: '=x' }).ok).toBe(false);
	});
	it('very large env input stays fast', () => {
		const t = Date.now();
		validateProfile({ env: 'K=v\n'.repeat(50000) });
		expect(Date.now() - t).toBeLessThan(1000);
	});
	it('resolve with null/garbage profile falls back to the base config', () => {
		const r = resolveBootConfig(debianCfg, null, 'c');
		expect(r.config.cmd).toBe('/bin/bash');
		const g = resolveBootConfig(debianCfg, { ...DEFAULT_PROFILE, distro: 'nonexistent' }, 'c');
		expect(g.config.cmd).toBe('/bin/bash');
	});
	it('base config object is never mutated by overrides', () => {
		const snap = JSON.stringify({ o: debianCfg.opts, a: debianCfg.args });
		resolveBootConfig(debianCfg, { ...DEFAULT_PROFILE, uid: '0', env: 'X=1', cmd: '/bin/sh -c id' }, 'c');
		expect(JSON.stringify({ o: debianCfg.opts, a: debianCfg.args })).toBe(snap);
	});
});

describe('monitor adversarial', () => {
	it('proc snapshot with pipes in command, binary junk and CRLF', () => {
		const rows = parseProcSnapshot('5|S|0|echo a|b|c\r\n6|S|0|\u0000\u0001junk\n7|?|x|bad');
		expect(rows[0].command).toBe('echo a|b|c');
		expect(rows.map((r) => r.pid)).toEqual([5, 6]);
	});
	it('sparkline survives NaN/Infinity/negative data', () => {
		const p = sparklinePoints([NaN, Infinity, -5, 3], 100, 20);
		expect(p).not.toMatch(/NaN|Infinity/);
	});
	it('storage estimate returning garbage yields null', async () => {
		expect(await readStorageEstimate({ storage: { estimate: async () => ({ usage: 'a', quota: NaN }) } })).toBeNull();
		expect(await readStorageEstimate({ storage: { estimate: () => 5 } })).toBeNull();
	});
});
