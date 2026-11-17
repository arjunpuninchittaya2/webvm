// Process / storage / memory monitor helpers (pure + small browser probes).

/** Shell script that dumps /proc into a pipe-separated snapshot file (pid|state|uid|command). */
export function buildSnapshotScript(outPath) {
	const tmp = `${outPath}.tmp`;
	return (
		'for d in /proc/[0-9]*; do ' +
		'p=${d#/proc/}; ' +
		"c=$(tr '\\000' ' ' < $d/cmdline 2>/dev/null); " +
		"n=$(sed -n 's/^Name:[[:space:]]*//p' $d/status 2>/dev/null); " +
		"s=$(sed -n 's/^State:[[:space:]]*\\(.\\).*/\\1/p' $d/status 2>/dev/null); " +
		"u=$(sed -n 's/^Uid:[[:space:]]*\\([0-9]*\\).*/\\1/p' $d/status 2>/dev/null); " +
		'[ -z "$c" ] && c="[$n]"; ' +
		'echo "$p|$s|$u|$c"; ' +
		`done > '${tmp}' 2>/dev/null; mv '${tmp}' '${outPath}'`
	);
}

const STATE_LABELS = {
	R: 'running',
	S: 'sleeping',
	D: 'disk-wait',
	T: 'stopped',
	t: 'stopped',
	Z: 'zombie',
	I: 'idle',
	X: 'dead'
};

/** Parses the snapshot produced by buildSnapshotScript. Ignores malformed lines. */
export function parseProcSnapshot(text) {
	const rows = [];
	for (const line of String(text ?? '').split('\n')) {
		const m = /^(\d+)\|([A-Za-z]?)\|(\d*)\|(.*)$/.exec(line.trim());
		if (!m) continue;
		rows.push({
			pid: Number(m[1]),
			state: STATE_LABELS[m[2]] || (m[2] ? m[2] : 'unknown'),
			uid: m[3] === '' ? null : Number(m[3]),
			command: m[4].trim().slice(0, 200)
		});
	}
	return rows.sort((a, b) => a.pid - b.pid);
}

/** Shell script that stops the process tree of a supervised background job (best effort). */
export function buildStopScript(jobId) {
	const safe = String(jobId).replace(/[^A-Za-z0-9_.-]/g, '');
	if (!safe) throw new Error('Invalid job id');
	const pattern = `[w]ebvm-svc-${safe}`;
	return (
		`for p in $(pgrep -f '${pattern}' 2>/dev/null); do ` +
		'pkill -P $p 2>/dev/null; kill $p 2>/dev/null; done; true'
	);
}

export function jobMarker(jobId) {
	return `webvm-svc-${String(jobId).replace(/[^A-Za-z0-9_.-]/g, '')}`;
}

export function formatBytes(n) {
	if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return 'Unavailable';
	const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
	let v = n;
	let i = 0;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Reads navigator.storage.estimate(); resolves to null when the API is missing or fails. */
export async function readStorageEstimate(nav = typeof navigator !== 'undefined' ? navigator : null) {
	try {
		if (!nav?.storage || typeof nav.storage.estimate !== 'function') return null;
		const est = await nav.storage.estimate();
		const usage = Number(est?.usage);
		const quota = Number(est?.quota);
		if (!Number.isFinite(usage) || !Number.isFinite(quota) || quota <= 0) return null;
		return { usage, quota, percent: Math.min(100, (usage / quota) * 100) };
	} catch {
		return null;
	}
}

/** JS heap stats (Chromium performance.memory); null elsewhere. */
export function readMemoryStats(perf = typeof performance !== 'undefined' ? performance : null) {
	const m = perf?.memory;
	if (!m || !Number.isFinite(m.usedJSHeapSize)) return null;
	return { used: m.usedJSHeapSize, limit: m.jsHeapSizeLimit, total: m.totalJSHeapSize };
}

/** Builds an SVG polyline `points` string for a sparkline in a width x height box. */
export function sparklinePoints(values, width, height, maxHint = 0) {
	if (!Array.isArray(values) || values.length === 0) return '';
	const clean = values.map((v) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0));
	values = clean;
	const max = Math.max(maxHint, ...clean, 1);
	const step = values.length > 1 ? width / (values.length - 1) : 0;
	return values
		.map((v, i) => {
			const y = height - (Math.max(0, Number(v) || 0) / max) * (height - 2) - 1;
			return `${(i * step).toFixed(1)},${y.toFixed(1)}`;
		})
		.join(' ');
}

/** Fixed-size rolling window of samples. */
export function pushSample(list, value, cap = 60) {
	const next = list.length >= cap ? list.slice(list.length - cap + 1) : list.slice();
	next.push(Number.isFinite(value) ? value : 0);
	return next;
}
