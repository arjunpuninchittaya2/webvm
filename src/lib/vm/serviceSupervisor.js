// Lightweight service / daemon / cron supervisor. Desired-state model: services marked running are
// launched as detached background processes inside the VM as soon as it is ready; cron jobs fire
// from an in-page scheduler (they only run while this tab is open — documented limitation).
import { writable, get } from 'svelte/store';
import { buildStopScript, jobMarker } from './processMonitor.js';

export const SERVICES_STORAGE_KEY = 'webvm.services.v1';
export const LOG_DIR = '/home/user/workspace';

export const BUILTIN_SERVICES = Object.freeze([
	{
		id: 'heartbeat',
		name: 'Heartbeat logger',
		command: `while true; do date >> ${LOG_DIR}/.heartbeat.log; sleep 5; done`
	},
	{
		id: 'http8080',
		name: 'Workspace web server (:8080)',
		command: `cd ${LOG_DIR} && python3 -m http.server 8080`
	},
	{ id: 'sshd', name: 'sshd (OpenSSH, needs root profile)', command: '/usr/sbin/sshd -D' }
]);

const CRON_FIELDS = [
	{ name: 'minute', min: 0, max: 59 },
	{ name: 'hour', min: 0, max: 23 },
	{ name: 'day of month', min: 1, max: 31 },
	{ name: 'month', min: 1, max: 12 },
	{ name: 'day of week', min: 0, max: 7 }
];

function parseCronField(text, { min, max, name }) {
	const values = new Set();
	for (const part of text.split(',')) {
		const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
		if (!m) return { error: `bad ${name} field "${part}"` };
		const step = m[2] === undefined ? 1 : Number(m[2]);
		if (step < 1) return { error: `bad step in ${name} field` };
		let lo;
		let hi;
		if (m[1] === '*') {
			lo = min;
			hi = max;
		} else if (m[1].includes('-')) {
			[lo, hi] = m[1].split('-').map(Number);
		} else {
			lo = Number(m[1]);
			hi = m[2] === undefined ? lo : max;
		}
		if (lo < min || hi > max || lo > hi) return { error: `${name} out of range (${min}-${max})` };
		for (let v = lo; v <= hi; v += step) values.add(v);
	}
	return { values };
}

/** Validates a 5-field cron expression. Returns { ok, error?, parsed? }. */
export function parseCron(expr) {
	const fields = String(expr ?? '').trim().split(/\s+/);
	if (fields.length !== 5 || fields[0] === '') {
		return { ok: false, error: 'Invalid cron schedule: expected 5 fields (minute hour day month weekday)' };
	}
	const parsed = [];
	for (let i = 0; i < 5; i++) {
		const res = parseCronField(fields[i], CRON_FIELDS[i]);
		if (res.error) return { ok: false, error: `Invalid cron schedule: ${res.error}` };
		parsed.push(res.values);
	}
	if (parsed[4].has(7)) parsed[4].add(0);
	return { ok: true, parsed, dowRestricted: fields[4] !== '*', domRestricted: fields[2] !== '*' };
}

export function cronMatches(expr, date) {
	const res = parseCron(expr);
	if (!res.ok) return false;
	const [mi, h, dom, mon, dow] = res.parsed;
	if (!mi.has(date.getMinutes()) || !h.has(date.getHours()) || !mon.has(date.getMonth() + 1)) return false;
	const domOk = dom.has(date.getDate());
	const dowOk = dow.has(date.getDay());
	// POSIX: if both day fields are restricted, either may match.
	if (res.domRestricted && res.dowRestricted) return domOk || dowOk;
	return domOk && dowOk;
}

export function validateCommand(cmd) {
	const text = String(cmd ?? '').trim();
	if (!text) return { ok: false, error: 'Command is required' };
	if (/[\r\n]/.test(text)) return { ok: false, error: 'Command must be a single line' };
	if (text.length > 500) return { ok: false, error: 'Command is too long (max 500 chars)' };
	return { ok: true, command: text };
}

/** Wraps a user command so output goes to a log file and the process carries a kill marker. */
export function wrapCommand(jobId, command) {
	const log = `${LOG_DIR}/.svc-${String(jobId).replace(/[^A-Za-z0-9_.-]/g, '')}.log`;
	return `( ${command} ) >> '${log}' 2>&1 # ${jobMarker(jobId)}`;
}

function loadState(storage) {
	try {
		const raw = storage?.getItem(SERVICES_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? parsed : null;
	} catch {
		return null;
	}
}

/**
 * vm: { isReady(): boolean, spawnBackground(id, shellCommand): Promise<{status}>,
 *       execQuiet(script): Promise<any> }
 */
export function createSupervisor({ vm, storage = null, now = () => new Date(), notify = () => {}, tickMs = 5000 } = {}) {
	const saved = loadState(storage);
	const customServices = Array.isArray(saved?.custom)
		? saved.custom.filter((s) => s && typeof s.id === 'string' && validateCommand(s.command).ok)
		: [];
	const services = writable(
		[...BUILTIN_SERVICES, ...customServices].map((s) => ({
			...s,
			builtin: BUILTIN_SERVICES.some((b) => b.id === s.id),
			status: 'stopped',
			error: null
		}))
	);
	const jobs = writable(
		Array.isArray(saved?.jobs)
			? saved.jobs.filter((j) => parseCron(j?.schedule).ok && validateCommand(j?.command).ok)
			: []
	);
	let seq = Date.now();
	const generations = new Map();
	let lastMinuteKey = null;
	let timer = null;
	let disposed = false;

	function persist() {
		try {
			storage?.setItem(
				SERVICES_STORAGE_KEY,
				JSON.stringify({
					custom: get(services)
						.filter((s) => !s.builtin)
						.map(({ id, name, command }) => ({ id, name, command })),
					jobs: get(jobs)
				})
			);
		} catch {
			// Storage unavailable (private mode / quota): supervisor still works for this session.
		}
	}

	function patchService(id, patch) {
		services.update((list) => list.map((s) => (s.id === id ? { ...s, ...patch } : s)));
	}

	async function launch(svc) {
		const gen = (generations.get(svc.id) || 0) + 1;
		generations.set(svc.id, gen);
		patchService(svc.id, { status: 'running', error: null });
		try {
			const res = await vm.spawnBackground(svc.id, wrapCommand(svc.id, svc.command));
			// A resolved spawn means the process exited (daemons normally never do).
			const current = get(services).find((s) => s.id === svc.id);
			if (current && current.status === 'running' && generations.get(svc.id) === gen) {
				const code = typeof res?.status === 'number' ? res.status : 0;
				patchService(svc.id, { status: code === 0 ? 'stopped' : 'failed', error: code === 0 ? null : `exit code ${code}` });
				notify(`Service ${svc.name} exited (code ${code})`, code === 0 ? 'info' : 'warning');
			}
		} catch (err) {
			if (generations.get(svc.id) !== gen) return;
			patchService(svc.id, { status: 'failed', error: err?.message || String(err) });
		}
	}

	function start(id) {
		const svc = get(services).find((s) => s.id === id);
		if (!svc || svc.status === 'running' || svc.status === 'pending') return false;
		if (!vm?.isReady?.()) {
			patchService(id, { status: 'pending', error: null });
			notify(`Service ${svc.name} queued until the VM is ready`, 'info');
			return true;
		}
		launch(svc);
		notify(`Service ${svc.name} started`, 'success');
		return true;
	}

	async function stop(id) {
		const svc = get(services).find((s) => s.id === id);
		if (!svc || (svc.status !== 'running' && svc.status !== 'pending')) return false;
		const wasRunning = svc.status === 'running';
		generations.set(id, (generations.get(id) || 0) + 1);
		patchService(id, { status: 'stopped', error: null });
		if (wasRunning && vm?.isReady?.()) {
			try {
				await vm.execQuiet(buildStopScript(id));
			} catch {
				// Best effort: the status already reflects the user's intent.
			}
		}
		notify(`Service ${svc.name} stopped`, 'info');
		return true;
	}

	function addService(name, command) {
		const cmd = validateCommand(command);
		const label = String(name ?? '').trim().slice(0, 40);
		if (!label) return { ok: false, error: 'Service name is required' };
		if (!cmd.ok) return cmd;
		const id = `svc${++seq}`;
		services.update((list) => [...list, { id, name: label, command: cmd.command, builtin: false, status: 'stopped', error: null }]);
		persist();
		return { ok: true, id };
	}

	async function removeService(id) {
		const svc = get(services).find((s) => s.id === id);
		if (!svc || svc.builtin) return false;
		await stop(id);
		services.update((list) => list.filter((s) => s.id !== id));
		persist();
		return true;
	}

	function addCron(schedule, command) {
		const sched = parseCron(schedule);
		if (!sched.ok) return sched;
		const cmd = validateCommand(command);
		if (!cmd.ok) return cmd;
		const job = { id: `cron${++seq}`, schedule: String(schedule).trim().split(/\s+/).join(' '), command: cmd.command, lastRun: null };
		jobs.update((list) => [...list, job]);
		persist();
		return { ok: true, id: job.id };
	}

	function removeCron(id) {
		jobs.update((list) => list.filter((j) => j.id !== id));
		persist();
	}

	/** One scheduler step: launch queued services once the VM is ready, fire matching cron jobs. */
	function tick(date = now()) {
		if (disposed) return;
		if (vm?.isReady?.()) {
			for (const svc of get(services)) {
				if (svc.status === 'pending') {
					launch(svc);
					notify(`Service ${svc.name} started`, 'success');
				}
			}
			const minuteKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`;
			if (minuteKey !== lastMinuteKey) {
				lastMinuteKey = minuteKey;
				for (const job of get(jobs)) {
					if (cronMatches(job.schedule, date)) {
						const id = `${job.id}-${date.getTime()}`;
						vm.spawnBackground(id, wrapCommand(job.id, job.command)).catch(() => {});
						jobs.update((list) => list.map((j) => (j.id === job.id ? { ...j, lastRun: date.getTime() } : j)));
					}
				}
			}
		}
	}

	function startTimer() {
		if (timer || disposed) return;
		timer = setInterval(() => tick(), tickMs);
	}

	function dispose() {
		disposed = true;
		if (timer) clearInterval(timer);
		timer = null;
	}

	return { services, jobs, start, stop, addService, removeService, addCron, removeCron, tick, startTimer, dispose };
}
