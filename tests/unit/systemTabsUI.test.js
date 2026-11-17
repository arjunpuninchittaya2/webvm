import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tick } from 'svelte';
import SystemMonitorTab from '../../src/lib/SystemMonitorTab.svelte';
import BootProfileTab from '../../src/lib/BootProfileTab.svelte';
import ServicesTab from '../../src/lib/ServicesTab.svelte';
import { createSupervisor } from '../../src/lib/vm/serviceSupervisor.js';
import { sessions, upsertSession, resetSessionsStore, toasts } from '../../src/lib/stores/sessions.js';
import { get } from 'svelte/store';

let container;
let instance;

beforeEach(() => {
	localStorage.clear();
	resetSessionsStore();
	container = document.createElement('div');
	document.body.appendChild(container);
});
afterEach(() => {
	instance?.$destroy();
	container.remove();
	vi.restoreAllMocks();
});

async function setValue(el, value) {
	el.value = value;
	el.dispatchEvent(new Event('input', { bubbles: true }));
	await tick();
}
const btn = (text) => [...container.querySelectorAll('button')].find((b) => b.textContent.trim() === text);

describe('SystemMonitorTab', () => {
	it('renders two sparklines, quota/memory readouts and a process row with a Stop button', async () => {
		upsertSession({ id: 'tab-1', title: 'bash', kind: 'primary', status: 'running' });
		instance = new SystemMonitorTab({ target: container, props: { vmManager: null } });
		await tick();
		expect(container.querySelectorAll('svg[data-testid^="sparkline"]')).toHaveLength(2);
		expect(container.textContent).toMatch(/storage quota/i);
		expect(container.textContent).toMatch(/memory/i);
		expect(container.querySelectorAll('table tbody tr')).toHaveLength(1);
		expect(btn('Stop')).toBeTruthy();
	});
	it('shows "Unavailable" when navigator.storage.estimate is undefined', async () => {
		const orig = Object.getOwnPropertyDescriptor(navigator, 'storage');
		Object.defineProperty(navigator, 'storage', { configurable: true, value: { estimate: undefined } });
		try {
			instance = new SystemMonitorTab({ target: container, props: {} });
			await new Promise((r) => setTimeout(r, 10));
			await tick();
			expect(container.querySelector('[data-testid="storage-quota"]').textContent).toMatch(/Unavailable/);
		} finally {
			if (orig) Object.defineProperty(navigator, 'storage', orig);
			else delete navigator.storage;
		}
	});
	it('Stop interrupts the session via vmManager and reports it; empty list says no processes', async () => {
		upsertSession({ id: 'tab-1', title: 'bash', kind: 'primary', status: 'running' });
		const vmManager = { isReady: () => false, interruptSession: vi.fn(() => true) };
		instance = new SystemMonitorTab({ target: container, props: { vmManager } });
		await tick();
		btn('Stop').click();
		await tick();
		expect(vmManager.interruptSession).toHaveBeenCalledWith('tab-1');
		expect(container.querySelector('[data-testid="process-last-action"]').textContent).toMatch(/Stopped/);
		sessions.set([]);
		await tick();
		expect(container.textContent).toMatch(/No active processes/);
	});
	it('Stop on an already-exited session does not throw', async () => {
		upsertSession({ id: 'tab-1', title: 'bash', kind: 'primary', status: 'exited' });
		const vmManager = { isReady: () => false, interruptSession: () => false };
		instance = new SystemMonitorTab({ target: container, props: { vmManager } });
		await tick();
		btn('Stop').click();
		await tick();
		expect(container.querySelector('[data-testid="process-last-action"]').textContent).toMatch(/exited/);
	});
	it('lists /proc processes from the VM and kills via execQuiet, refusing PID 1', async () => {
		const vmManager = {
			isReady: () => true,
			snapshotProcesses: vi.fn(async () => [
				{ pid: 1, state: 'sleeping', uid: 0, command: '/sbin/init' },
				{ pid: 33, state: 'running', uid: 1000, command: 'sleep 100' }
			]),
			execQuiet: vi.fn(async () => ({ status: 0 }))
		};
		instance = new SystemMonitorTab({ target: container, props: { vmManager } });
		await new Promise((r) => setTimeout(r, 10));
		await tick();
		const kills = [...container.querySelectorAll('button')].filter((b) => /^Kill/.test(b.textContent.trim()));
		expect(kills).toHaveLength(2);
		kills[0].click();
		await tick();
		expect(vmManager.execQuiet).not.toHaveBeenCalled();
		kills[1].click();
		await new Promise((r) => setTimeout(r, 5));
		expect(vmManager.execQuiet).toHaveBeenCalledWith('kill -TERM 33');
	});
});

describe('BootProfileTab', () => {
	it('shows validation errors for bad uid/env and does not persist', async () => {
		instance = new BootProfileTab({ target: container });
		await tick();
		const inputs = container.querySelectorAll('input[type="text"]');
		await setValue(inputs[1], '-1'); // uid
		await setValue(container.querySelector('textarea'), 'INVALID_NO_EQUALS');
		btn('Save profile').click();
		await tick();
		expect(container.textContent).toMatch(/Invalid UID/);
		expect(container.textContent).toMatch(/KEY=VALUE/);
		expect(localStorage.getItem('webvm.bootprofile.v1')).toBeNull();
	});
	it('persists a valid profile and shows the FileDevice limitation notice', async () => {
		instance = new BootProfileTab({ target: container });
		await tick();
		expect(container.textContent).toMatch(/FileDevice/);
		const inputs = container.querySelectorAll('input[type="text"]');
		await setValue(inputs[0], 'https://disks.example.test/custom.ext2');
		await setValue(inputs[1], '1000');
		btn('Save profile').click();
		await tick();
		const saved = JSON.parse(localStorage.getItem('webvm.bootprofile.v1'));
		expect(saved).toMatchObject({ customUrl: 'https://disks.example.test/custom.ext2', uid: '1000', distro: 'default' });
		expect(get(toasts).some((t) => /saved/i.test(t.message))).toBe(true);
	});
	it('rejects an ftp:// custom url and Reset form recovers to debian', async () => {
		instance = new BootProfileTab({ target: container });
		await tick();
		await setValue(container.querySelector('input[type="text"]'), 'ftp://bad/disk.ext2');
		const select = container.querySelector('select');
		select.value = 'alpine';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		btn('Save profile').click();
		await tick();
		expect(container.textContent).toMatch(/Invalid URL/);
		btn('Reset form').click();
		await tick();
		expect(container.querySelector('select').value).toBe('default');
		expect(container.querySelector('input[type="text"]').value).toBe('');
	});
});

describe('ServicesTab', () => {
	function mount(ready = true) {
		const vm = { isReady: () => ready, spawnBackground: vi.fn(() => new Promise(() => {})), execQuiet: vi.fn(async () => ({ status: 0 })) };
		const supervisor = createSupervisor({ vm, notify: () => {} });
		instance = new ServicesTab({ target: container, props: { supervisor } });
		return { vm, supervisor };
	}
	it('start shows Running and exposes Stop; stop returns to Stopped', async () => {
		const { vm } = mount();
		await tick();
		btn('Start').click();
		await tick();
		expect(vm.spawnBackground).toHaveBeenCalledTimes(1);
		expect(container.textContent).toMatch(/Running/);
		btn('Stop').click();
		await tick();
		await tick();
		expect(vm.execQuiet).toHaveBeenCalled();
		expect(container.querySelectorAll('[data-testid^="service-"]')[0].textContent).toMatch(/Stopped/);
	});
	it('shows queued state when VM is not ready', async () => {
		mount(false);
		await tick();
		btn('Start').click();
		await tick();
		expect(container.textContent).toMatch(/waiting for VM/);
	});
	it('rejects invalid cron and lists valid cron jobs', async () => {
		mount();
		await tick();
		const sched = container.querySelector('[aria-label="Cron schedule"]');
		const cmd = container.querySelector('[aria-label="Cron command"]');
		await setValue(sched, '99 99 * * *');
		await setValue(cmd, 'echo bad');
		btn('Add cron job').click();
		await tick();
		expect(container.textContent).toMatch(/Invalid cron schedule/);
		await setValue(sched, '*/5 * * * *');
		btn('Add cron job').click();
		await tick();
		expect(container.textContent).toContain('*/5 * * * *');
		expect(container.textContent).not.toMatch(/Invalid cron schedule/);
	});
});
