import { describe, it, expect, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	parseCron,
	cronMatches,
	createSupervisor,
	wrapCommand,
	validateCommand,
	SERVICES_STORAGE_KEY
} from '../../src/lib/vm/serviceSupervisor.js';
import { buildStopScript } from '../../src/lib/vm/processMonitor.js';

function memStorage() {
	const m = new Map();
	return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}
function fakeVm({ ready = true } = {}) {
	const vm = {
		ready,
		isReady: () => vm.ready,
		spawned: [],
		scripts: [],
		spawnBackground: vi.fn((id, cmd) => {
			vm.spawned.push({ id, cmd });
			return new Promise(() => {}); // daemon: never exits
		}),
		execQuiet: vi.fn(async (s) => {
			vm.scripts.push(s);
			return { status: 0 };
		})
	};
	return vm;
}

describe('cron parsing', () => {
	it.each(['* * * * *', '*/5 * * * *', '0 0 1,15 * *', '0 9-17 * * 1-5', '0 * * * 7'])('accepts %s', (e) => {
		expect(parseCron(e).ok).toBe(true);
	});
	it.each(['99 99 * * *', '* * * *', '', '*/0 * * * *', '60 * * * *', 'a b c d e', '5-1 * * * *', '* * 0 * *'])('rejects "%s"', (e) => {
		const r = parseCron(e);
		expect(r.ok).toBe(false);
		expect(r.error).toMatch(/Invalid cron schedule/);
	});
	it('matches times correctly', () => {
		const d = new Date(2025, 0, 6, 9, 30); // Monday 09:30
		expect(cronMatches('30 9 * * 1', d)).toBe(true);
		expect(cronMatches('*/15 * * * *', d)).toBe(true);
		expect(cronMatches('31 9 * * *', d)).toBe(false);
		expect(cronMatches('30 9 * * 2', d)).toBe(false);
		expect(cronMatches('30 9 6 * 3', d)).toBe(true); // dom OR dow when both restricted
		expect(cronMatches('bogus', d)).toBe(false);
	});
});

describe('command wrapping & stop script', () => {
	it('wraps with log redirect and a unique kill marker', () => {
		const w = wrapCommand('heartbeat', 'sleep 1');
		expect(w).toContain('webvm-svc-heartbeat');
		expect(w).toContain('>>');
	});
	it('stop script pattern does not match itself', () => {
		const s = buildStopScript('heartbeat');
		expect(s).toContain("[w]ebvm-svc-heartbeat");
		expect(s).not.toMatch(/'webvm-svc-heartbeat'/);
		expect(() => buildStopScript('///')).toThrow();
	});
	it('validates commands', () => {
		expect(validateCommand('').ok).toBe(false);
		expect(validateCommand('a\nb').ok).toBe(false);
		expect(validateCommand('x'.repeat(501)).ok).toBe(false);
		expect(validateCommand(' ls ').command).toBe('ls');
	});
});

describe('supervisor', () => {
	it('starts a service in the VM and stops it by killing the marker', async () => {
		const vm = fakeVm();
		const notify = vi.fn();
		const sup = createSupervisor({ vm, notify });
		expect(sup.start('heartbeat')).toBe(true);
		expect(vm.spawned).toHaveLength(1);
		expect(get(sup.services).find((s) => s.id === 'heartbeat').status).toBe('running');
		expect(sup.start('heartbeat')).toBe(false);
		await sup.stop('heartbeat');
		expect(get(sup.services).find((s) => s.id === 'heartbeat').status).toBe('stopped');
		expect(vm.scripts[0]).toContain('[w]ebvm-svc-heartbeat');
		expect(notify).toHaveBeenLastCalledWith(expect.stringMatching(/stopped/), 'info');
		expect(await sup.stop('heartbeat')).toBe(false);
	});
	it('queues start until the VM is ready, then launches on tick', () => {
		const vm = fakeVm({ ready: false });
		const sup = createSupervisor({ vm });
		sup.start('heartbeat');
		expect(get(sup.services).find((s) => s.id === 'heartbeat').status).toBe('pending');
		expect(vm.spawned).toHaveLength(0);
		vm.ready = true;
		sup.tick(new Date(2025, 0, 1, 0, 0));
		expect(vm.spawned).toHaveLength(1);
		expect(get(sup.services).find((s) => s.id === 'heartbeat').status).toBe('running');
	});
	it('marks a service failed when its process exits non-zero, and ignores stale exits after stop', async () => {
		const vm = fakeVm();
		let resolveRun;
		vm.spawnBackground = vi.fn(() => new Promise((r) => (resolveRun = r)));
		const sup = createSupervisor({ vm });
		sup.start('heartbeat');
		resolveRun({ status: 3 });
		await Promise.resolve();
		await Promise.resolve();
		expect(get(sup.services).find((s) => s.id === 'heartbeat')).toMatchObject({ status: 'failed', error: 'exit code 3' });
		sup.start('heartbeat');
		const stale = resolveRun;
		await sup.stop('heartbeat');
		stale({ status: 9 });
		await Promise.resolve();
		expect(get(sup.services).find((s) => s.id === 'heartbeat').status).toBe('stopped');
	});
	it('rejects invalid cron jobs and persists valid ones', () => {
		const st = memStorage();
		const sup = createSupervisor({ vm: fakeVm(), storage: st });
		expect(sup.addCron('99 99 * * *', 'echo bad').ok).toBe(false);
		expect(get(sup.jobs)).toHaveLength(0);
		expect(sup.addCron('*/5 * * * *', 'echo alive').ok).toBe(true);
		expect(sup.addCron('* * * * *', '').ok).toBe(false);
		const again = createSupervisor({ vm: fakeVm(), storage: st });
		expect(get(again.jobs)).toHaveLength(1);
		expect(JSON.parse(st.getItem(SERVICES_STORAGE_KEY)).jobs[0].schedule).toBe('*/5 * * * *');
	});
	it('fires matching cron jobs once per minute only', () => {
		const vm = fakeVm();
		const sup = createSupervisor({ vm });
		sup.addCron('*/5 * * * *', 'echo hi');
		const t = new Date(2025, 0, 1, 10, 5, 0);
		sup.tick(t);
		sup.tick(new Date(2025, 0, 1, 10, 5, 30));
		expect(vm.spawned).toHaveLength(1);
		sup.tick(new Date(2025, 0, 1, 10, 6, 0));
		expect(vm.spawned).toHaveLength(1);
		sup.tick(new Date(2025, 0, 1, 10, 10, 0));
		expect(vm.spawned).toHaveLength(2);
		expect(get(sup.jobs)[0].lastRun).not.toBeNull();
	});
	it('custom services can be added, persisted and removed; builtins cannot be removed', async () => {
		const st = memStorage();
		const sup = createSupervisor({ vm: fakeVm(), storage: st });
		expect(sup.addService('', 'ls').ok).toBe(false);
		const res = sup.addService('My server', 'python3 -m http.server 9000');
		expect(res.ok).toBe(true);
		expect(get(createSupervisor({ vm: fakeVm(), storage: st }).services).some((s) => s.name === 'My server')).toBe(true);
		expect(await sup.removeService('heartbeat')).toBe(false);
		expect(await sup.removeService(res.id)).toBe(true);
	});
	it('survives corrupted storage', () => {
		const st = memStorage();
		st.setItem(SERVICES_STORAGE_KEY, '{{{');
		expect(get(createSupervisor({ vm: fakeVm(), storage: st }).jobs)).toEqual([]);
	});
});
