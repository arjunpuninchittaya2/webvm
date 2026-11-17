import { describe, it, expect } from 'vitest';
import {
	parseProcSnapshot,
	buildSnapshotScript,
	formatBytes,
	readStorageEstimate,
	readMemoryStats,
	sparklinePoints,
	pushSample
} from '../../src/lib/vm/processMonitor.js';

describe('parseProcSnapshot', () => {
	it('parses rows, sorts by pid, skips malformed lines', () => {
		const rows = parseProcSnapshot('42|S|1000|/bin/bash --login \n1|S|0|/sbin/init\ngarbage\n7|Z||[kworker]\n\n');
		expect(rows.map((r) => r.pid)).toEqual([1, 7, 42]);
		expect(rows[2]).toMatchObject({ state: 'sleeping', uid: 1000, command: '/bin/bash --login' });
		expect(rows[1]).toMatchObject({ state: 'zombie', uid: null });
	});
	it('handles empty/undefined input', () => {
		expect(parseProcSnapshot('')).toEqual([]);
		expect(parseProcSnapshot(undefined)).toEqual([]);
	});
	it('snapshot script writes atomically to the requested path', () => {
		const s = buildSnapshotScript('/x/.ps');
		expect(s).toContain("mv '/x/.ps.tmp' '/x/.ps'");
		expect(s).toContain('/proc/[0-9]*');
	});
});

describe('storage & memory probes', () => {
	it('returns null when navigator.storage.estimate is missing or throws', async () => {
		expect(await readStorageEstimate({})).toBeNull();
		expect(await readStorageEstimate({ storage: { estimate: undefined } })).toBeNull();
		expect(await readStorageEstimate({ storage: { estimate: async () => { throw new Error('x'); } } })).toBeNull();
		expect(await readStorageEstimate({ storage: { estimate: async () => ({ usage: 1, quota: 0 }) } })).toBeNull();
	});
	it('computes percent', async () => {
		const r = await readStorageEstimate({ storage: { estimate: async () => ({ usage: 50, quota: 200 }) } });
		expect(r.percent).toBe(25);
	});
	it('memory stats null without performance.memory', () => {
		expect(readMemoryStats({})).toBeNull();
		expect(readMemoryStats({ memory: { usedJSHeapSize: 10, jsHeapSizeLimit: 100, totalJSHeapSize: 20 } }).used).toBe(10);
	});
	it('formatBytes', () => {
		expect(formatBytes(0)).toBe('0 B');
		expect(formatBytes(1536)).toBe('1.5 KiB');
		expect(formatBytes(NaN)).toBe('Unavailable');
		expect(formatBytes(-1)).toBe('Unavailable');
	});
});

describe('sparkline helpers', () => {
	it('maps values into the box and handles empty/zero data', () => {
		expect(sparklinePoints([], 100, 20)).toBe('');
		const pts = sparklinePoints([0, 50, 100], 100, 20, 100).split(' ');
		expect(pts).toHaveLength(3);
		expect(pts[0].startsWith('0.0,')).toBe(true);
		expect(pts[2].startsWith('100.0,')).toBe(true);
		expect(sparklinePoints([0, 0], 10, 10)).not.toContain('NaN');
	});
	it('pushSample keeps a bounded window', () => {
		let l = [];
		for (let i = 0; i < 100; i++) l = pushSample(l, i, 60);
		expect(l).toHaveLength(60);
		expect(l[59]).toBe(99);
		expect(pushSample([], NaN)).toEqual([0]);
	});
});
