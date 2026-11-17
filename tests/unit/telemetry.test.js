import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get, writable } from 'svelte/store';
import { createTelemetryTracker } from '../../src/lib/vm/telemetry.js';

describe('telemetry.js ring-buffer tracker', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('computes CPU activity percentage with baseline folding across 10s window and auto-stops when idle', () => {
		let nowMs = 10000;
		const cpuActivity = writable(false);
		const diskActivity = writable(false);
		const cpuPercentage = writable(0);
		const diskLatency = writable(0);

		const cpuWrites = vi.fn();
		const pctWrites = vi.fn();
		cpuActivity.subscribe(cpuWrites);
		cpuPercentage.subscribe(pctWrites);
		cpuWrites.mockClear();
		pctWrites.mockClear();

		const tracker = createTelemetryTracker({
			cpuActivity,
			diskActivity,
			cpuPercentage,
			diskLatency,
			cpuWindowMs: 10000,
			flushIntervalMs: 250,
			now: () => nowMs
		});

		expect(tracker.isTimerRunning()).toBe(false);

		// CPU active from t=10000 to t=13000 (3s out of 10s = 30%)
		tracker.cpuCallback('busy');
		expect(tracker.isTimerRunning()).toBe(true);
		nowMs = 10250;
		vi.advanceTimersByTime(250);
		expect(get(cpuActivity)).toBe(true);
		expect(get(cpuPercentage)).toBe(3);

		nowMs = 13000;
		tracker.cpuCallback('ready');
		nowMs = 13250;
		vi.advanceTimersByTime(250);
		expect(get(cpuActivity)).toBe(false);
		expect(get(cpuPercentage)).toBe(30);

		// Dirty checking: advancing without state changes should not fire redundant cpuActivity writes
		const countAfterReady = cpuWrites.mock.calls.length;
		nowMs = 13500;
		vi.advanceTimersByTime(250);
		expect(cpuWrites.mock.calls.length).toBe(countAfterReady);

		// Advance past 10s window so active period expires cleanly to 0% and timer auto-stops
		nowMs = 23500;
		vi.advanceTimersByTime(250);
		expect(get(cpuPercentage)).toBe(0);
		expect(tracker.isTimerRunning()).toBe(false);

		tracker.dispose();
	});

	it('maintains O(1) 30-sample latency ring buffer average and 60-point history', () => {
		let nowMs = 1000;
		const cpuActivity = writable(false);
		const diskActivity = writable(false);
		const cpuPercentage = writable(0);
		const diskLatency = writable(0);

		const tracker = createTelemetryTracker({
			cpuActivity,
			diskActivity,
			cpuPercentage,
			diskLatency,
			latencyCapacity: 30,
			historyCapacity: 60,
			flushIntervalMs: 250,
			now: () => nowMs
		});

		// Push 30 samples of 10ms, then 30 samples of 40ms -> older 10ms samples evicted
		for (let i = 0; i < 30; i++) {
			tracker.latencyCallback(10);
		}
		tracker.flush();
		expect(get(diskLatency)).toBe(10);

		for (let i = 0; i < 30; i++) {
			tracker.latencyCallback(40);
		}
		tracker.flush();
		expect(get(diskLatency)).toBe(40);

		// Push 65 flushes to verify 60-point history ring cap
		for (let i = 0; i < 65; i++) {
			nowMs += 250;
			tracker.flush();
		}
		const hist = tracker.getHistory();
		expect(hist.cpu.length).toBe(60);
		expect(hist.latency.length).toBe(60);
		expect(hist.latency[59]).toBe(40);

		tracker.dispose();
	});

	it('pauses coalesced timer when hidden and performs immediate flush on setHidden(false)', () => {
		let nowMs = 5000;
		const cpuActivity = writable(false);
		const diskActivity = writable(false);
		const cpuPercentage = writable(0);
		const diskLatency = writable(0);

		const tracker = createTelemetryTracker({
			cpuActivity,
			diskActivity,
			cpuPercentage,
			diskLatency,
			flushIntervalMs: 250,
			now: () => nowMs
		});

		tracker.cpuCallback('working');
		expect(tracker.isTimerRunning()).toBe(true);

		tracker.setHidden(true);
		expect(tracker.isTimerRunning()).toBe(false);

		nowMs = 10000;
		vi.advanceTimersByTime(1000);
		// Not flushed while hidden
		expect(get(cpuPercentage)).toBe(0);

		tracker.setHidden(false);
		expect(get(cpuActivity)).toBe(true);
		expect(get(cpuPercentage)).toBe(50);
		expect(tracker.isTimerRunning()).toBe(true);

		tracker.dispose();
		expect(tracker.isTimerRunning()).toBe(false);
	});
});
