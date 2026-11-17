import { cpuActivity, diskActivity, cpuPercentage, diskLatency } from '$lib/activities.js';

export function createTelemetryTracker(options = {}) {
	const stores = {
		cpuActivity: options.cpuActivity || cpuActivity,
		diskActivity: options.diskActivity || diskActivity,
		cpuPercentage: options.cpuPercentage || cpuPercentage,
		diskLatency: options.diskLatency || diskLatency
	};

	const cpuWindowMs = options.cpuWindowMs ?? 10000;
	const flushIntervalMs = options.flushIntervalMs ?? 250;
	const cpuBufferCapacity = options.cpuBufferCapacity ?? 256;
	const latencyCapacity = options.latencyCapacity ?? 30;
	const historyCapacity = options.historyCapacity ?? 60;
	const now = options.now || (() => Date.now());

	// Fixed-capacity ring buffer for CPU activity transitions
	const cpuTimes = new Float64Array(cpuBufferCapacity);
	const cpuStates = new Uint8Array(cpuBufferCapacity);
	let cpuHead = 0;
	let cpuCount = 0;
	let baselineActive = false;
	let baselineTime = null;
	let evictedStart = 0;
	let evictedEnd = 0;
	let evictedActiveMs = 0;

	// Fixed-capacity ring buffer for disk block latency (O(1) running sum)
	const latBuffer = new Float64Array(latencyCapacity);
	let latHead = 0;
	let latCount = 0;
	let latSum = 0;

	// Fixed-capacity 60-point history ring buffer
	const cpuHistory = new Uint8Array(historyCapacity);
	const latHistory = new Float64Array(historyCapacity);
	let histHead = 0;
	let histCount = 0;

	let curCpuActive = false;
	let curDiskActive = false;
	let curLatency = 0;

	let lastCpuActive = false;
	let lastDiskActive = false;
	let lastCpuPct = 0;
	let lastLatency = 0;

	let dirty = false;
	let hidden = typeof document !== 'undefined' ? Boolean(document.hidden) : false;
	let disposed = false;
	let timerId = null;

	function expireCpuBefore(limitTime) {
		if (evictedActiveMs > 0) {
			if (limitTime >= evictedEnd) {
				evictedActiveMs = 0;
				evictedStart = 0;
				evictedEnd = 0;
			} else if (limitTime > evictedStart) {
				const span = evictedEnd - evictedStart;
				evictedActiveMs = span > 0 ? evictedActiveMs * ((evictedEnd - limitTime) / span) : 0;
				evictedStart = limitTime;
			}
		}

		while (cpuCount > 0 && cpuTimes[cpuHead] <= limitTime) {
			baselineTime = cpuTimes[cpuHead];
			baselineActive = cpuStates[cpuHead] === 1;
			cpuHead = (cpuHead + 1) % cpuBufferCapacity;
			cpuCount--;
		}
	}

	function computeCpuPercentage(curTime) {
		const limitTime = curTime - cpuWindowMs;
		expireCpuBefore(limitTime);

		let totalActiveTime = evictedActiveMs;
		let lastTime = baselineTime === null ? limitTime : Math.max(limitTime, baselineTime);
		let wasActive = baselineActive;

		for (let i = 0; i < cpuCount; i++) {
			const idx = (cpuHead + i) % cpuBufferCapacity;
			const eventTime = cpuTimes[idx];
			const eventActive = cpuStates[idx] === 1;
			if (wasActive && eventTime > lastTime) {
				totalActiveTime += eventTime - lastTime;
			}
			wasActive = eventActive;
			lastTime = eventTime;
		}

		if (wasActive && curTime > lastTime) {
			totalActiveTime += curTime - lastTime;
		}

		const pct = Math.ceil((totalActiveTime / cpuWindowMs) * 100);
		return Math.min(100, Math.max(0, pct));
	}

	function pushHistory(cpuPct, latencyVal) {
		if (historyCapacity <= 0) return;
		if (histCount === historyCapacity) {
			cpuHistory[histHead] = cpuPct;
			latHistory[histHead] = latencyVal;
			histHead = (histHead + 1) % historyCapacity;
		} else {
			const idx = (histHead + histCount) % historyCapacity;
			cpuHistory[idx] = cpuPct;
			latHistory[idx] = latencyVal;
			histCount++;
		}
	}

	function stopTimer() {
		if (timerId !== null) {
			clearInterval(timerId);
			timerId = null;
		}
	}

	function isActive() {
		return dirty || curCpuActive || curDiskActive || lastCpuPct > 0 || baselineActive;
	}

	function ensureTimer() {
		if (disposed || hidden || timerId !== null) return;
		timerId = setInterval(() => {
			flush();
		}, flushIntervalMs);
	}

	function flush() {
		if (disposed) return;

		const cpuPct = computeCpuPercentage(now());

		if (curCpuActive !== lastCpuActive) {
			lastCpuActive = curCpuActive;
			stores.cpuActivity.set(curCpuActive);
		}
		if (curDiskActive !== lastDiskActive) {
			lastDiskActive = curDiskActive;
			stores.diskActivity.set(curDiskActive);
		}
		if (cpuPct !== lastCpuPct) {
			lastCpuPct = cpuPct;
			stores.cpuPercentage.set(cpuPct);
		}
		if (curLatency !== lastLatency) {
			lastLatency = curLatency;
			stores.diskLatency.set(curLatency);
		}

		pushHistory(cpuPct, curLatency);
		dirty = false;

		if (!isActive()) {
			stopTimer();
		}
	}

	function recordCpu(state) {
		if (disposed) return;
		const t = now();
		const active = state !== 'ready' && Boolean(state);
		const activeBit = active ? 1 : 0;
		curCpuActive = active;

		const limitTime = t - cpuWindowMs;
		expireCpuBefore(limitTime);

		if (cpuCount > 0) {
			const lastIdx = (cpuHead + cpuCount - 1) % cpuBufferCapacity;
			if (cpuStates[lastIdx] === activeBit) {
				dirty = true;
				ensureTimer();
				return;
			}
		}

		if (cpuCount === cpuBufferCapacity) {
			const evictedTime = cpuTimes[cpuHead];
			const evictedActive = cpuStates[cpuHead] === 1;
			if (baselineTime !== null && baselineActive && evictedTime > baselineTime) {
				const segStart = Math.max(limitTime, baselineTime);
				if (evictedTime > segStart) {
					const segMs = evictedTime - segStart;
					if (evictedActiveMs === 0) {
						evictedStart = segStart;
						evictedEnd = evictedTime;
					} else {
						evictedStart = Math.min(evictedStart, segStart);
						evictedEnd = Math.max(evictedEnd, evictedTime);
					}
					evictedActiveMs += segMs;
				}
			}
			baselineTime = evictedTime;
			baselineActive = evictedActive;
			cpuHead = (cpuHead + 1) % cpuBufferCapacity;
			cpuCount--;
		}

		const idx = (cpuHead + cpuCount) % cpuBufferCapacity;
		cpuTimes[idx] = t;
		cpuStates[idx] = activeBit;
		cpuCount++;

		dirty = true;
		ensureTimer();
	}

	function recordDisk(state) {
		if (disposed) return;
		const active = state !== 'ready' && Boolean(state);
		if (active !== curDiskActive) {
			curDiskActive = active;
			dirty = true;
		}
		if (active || dirty) {
			ensureTimer();
		}
	}

	function recordLatency(latency) {
		if (disposed) return;
		if (typeof latency === 'number') {
			if (!Number.isFinite(latency) || latency < 0) return;
		} else if (typeof latency === 'string') {
			if (latency.trim().length === 0) return;
		} else {
			return;
		}
		const val = Number(latency);
		if (!Number.isFinite(val) || val < 0) return;

		if (latCount === latencyCapacity) {
			latSum -= latBuffer[latHead];
			latBuffer[latHead] = val;
			latSum += val;
			latHead = (latHead + 1) % latencyCapacity;
		} else {
			const idx = (latHead + latCount) % latencyCapacity;
			latBuffer[idx] = val;
			latSum += val;
			latCount++;
		}

		curLatency = Math.max(0, Math.ceil(latSum / latCount)) || 0;
		dirty = true;
		ensureTimer();
	}

	function setHidden(isHidden) {
		const nextHidden = Boolean(isHidden);
		if (disposed) return;
		hidden = nextHidden;
		if (hidden) {
			stopTimer();
		} else {
			flush();
			if (isActive()) {
				ensureTimer();
			}
		}
	}

	function getHistory() {
		const cpu = new Array(histCount);
		const latency = new Array(histCount);
		for (let i = 0; i < histCount; i++) {
			const idx = (histHead + i) % historyCapacity;
			cpu[i] = cpuHistory[idx];
			latency[i] = latHistory[idx];
		}
		return { cpu, latency };
	}

	function dispose() {
		disposed = true;
		stopTimer();
		cpuHead = 0;
		cpuCount = 0;
		baselineActive = false;
		baselineTime = null;
		evictedStart = 0;
		evictedEnd = 0;
		evictedActiveMs = 0;
		latHead = 0;
		latCount = 0;
		latSum = 0;
	}

	return {
		cpuCallback: recordCpu,
		hddCallback: recordDisk,
		latencyCallback: recordLatency,
		recordCpu,
		recordDisk,
		recordLatency,
		flush,
		setHidden,
		getHistory,
		isTimerRunning: () => timerId !== null,
		dispose
	};
}
