<script>
	import { onMount, onDestroy } from 'svelte';
	import { cpuPercentage, diskLatency } from './activities.js';
	import { sessions } from './stores/sessions.js';
	import { addToast } from './stores/sessions.js';
	import {
		formatBytes,
		readStorageEstimate,
		readMemoryStats,
		sparklinePoints,
		pushSample
	} from './vm/processMonitor.js';

	export let vmManager = null;

	const W = 220;
	const H = 44;
	let cpuSamples = [];
	let latSamples = [];
	let storage = undefined; // undefined = loading, null = unavailable
	let memory = null;
	let vmProcs = null; // null = not sampled / unavailable
	let procError = null;
	let lastAction = '';
	let timer = null;
	let refreshing = false;

	function sample() {
		cpuSamples = pushSample(cpuSamples, $cpuPercentage);
		latSamples = pushSample(latSamples, $diskLatency);
		memory = readMemoryStats();
	}

	async function refreshStorage() {
		storage = await readStorageEstimate();
	}

	async function refreshProcs() {
		if (refreshing) return;
		if (!vmManager?.isReady?.()) {
			vmProcs = null;
			return;
		}
		refreshing = true;
		try {
			vmProcs = await vmManager.snapshotProcesses();
			procError = vmProcs ? null : 'VM process list unavailable';
		} catch (err) {
			procError = err?.message || 'VM process list unavailable';
		} finally {
			refreshing = false;
		}
	}

	function stopSession(s) {
		const ok = vmManager?.interruptSession?.(s.id);
		if (ok) {
			lastAction = `Stopped foreground job of "${s.title}" (Ctrl-C / SIGINT sent)`;
		} else if (s.kind === 'task' && vmManager) {
			vmManager.closeTab(s.id);
			lastAction = `Terminated task "${s.title}" (tab closed)`;
		} else {
			lastAction = `"${s.title}" is not running (exited or VM not ready) — nothing to stop`;
		}
		addToast({ message: lastAction, type: 'info' });
	}

	async function killPid(p) {
		if (p.pid <= 1) {
			lastAction = 'Refusing to kill PID 1 (init)';
			return;
		}
		try {
			await vmManager.execQuiet(`kill -TERM ${Number(p.pid)}`);
			lastAction = `Terminated PID ${p.pid} (SIGTERM)`;
		} catch (err) {
			lastAction = `Could not kill PID ${p.pid}: ${err?.message || err}`;
		}
		addToast({ message: lastAction, type: 'info' });
		refreshProcs();
	}

	function getMemoryPercent(mem) {
		if (!mem || !Number.isFinite(mem.used) || !Number.isFinite(mem.limit) || mem.limit <= 0) {
			return null;
		}
		return Math.min(100, Math.max(0, (mem.used / mem.limit) * 100));
	}

	function thresholdCardClass(percent) {
		if (typeof percent !== 'number' || !Number.isFinite(percent)) {
			return 'border-white/10 bg-white/5 text-zinc-200';
		}
		if (percent >= 95) {
			return 'border-rose-500/20 bg-rose-500/10 text-rose-300';
		}
		if (percent >= 80) {
			return 'border-amber-500/20 bg-amber-500/10 text-amber-300';
		}
		return 'border-white/10 bg-white/5 text-zinc-200';
	}

	$: storagePercent = storage && Number.isFinite(storage.percent) ? storage.percent : null;
	$: memoryPercent = getMemoryPercent(memory);
	$: storageCardClass = thresholdCardClass(storagePercent);
	$: memoryCardClass = thresholdCardClass(memoryPercent);

	onMount(() => {
		refreshStorage();
		refreshProcs();
		sample();
		let tickCount = 0;
		timer = setInterval(() => {
			if (typeof document !== 'undefined' && document.hidden) return;
			sample();
			tickCount++;
			if (tickCount % 5 === 0) {
				refreshStorage();
				refreshProcs();
			}
		}, 1000);
	});
	onDestroy(() => clearInterval(timer));
</script>

<h1 class="text-sm font-semibold text-zinc-100 pr-8">System Monitor</h1>

<section class="flex flex-col gap-2.5" aria-label="Resource usage">
	<div class="rounded-xl border border-white/10 bg-zinc-900/60 p-2.5 flex flex-col gap-1.5 shadow-xs">
		<p class="text-xs text-zinc-200 flex items-center justify-between">
			<span class="font-semibold">CPU activity:</span>
			<span class="font-mono text-[11px] tabular-nums text-zinc-300">{$cpuPercentage}%</span>
		</p>
		<svg data-testid="sparkline-cpu" role="img" aria-label="CPU activity history" width={W} height={H} viewBox="0 0 {W} {H}" class="w-full h-11 rounded-lg border border-white/5 bg-zinc-950/60">
			<polyline points={sparklinePoints(cpuSamples, W, H, 100)} fill="none" stroke="#e4e4e7" stroke-width="1.5" />
		</svg>
	</div>
	<div class="rounded-xl border border-white/10 bg-zinc-900/60 p-2.5 flex flex-col gap-1.5 shadow-xs">
		<p class="text-xs text-zinc-200 flex items-center justify-between">
			<span class="font-semibold">Disk latency:</span>
			<span class="font-mono text-[11px] tabular-nums text-zinc-300">{$diskLatency} ms</span>
		</p>
		<svg data-testid="sparkline-disk" role="img" aria-label="Disk latency history" width={W} height={H} viewBox="0 0 {W} {H}" class="w-full h-11 rounded-lg border border-white/5 bg-zinc-950/60">
			<polyline points={sparklinePoints(latSamples, W, H)} fill="none" stroke="#a1a1aa" stroke-width="1.5" />
		</svg>
	</div>
	<div class="rounded-xl border px-3 py-2 text-xs transition-colors {storageCardClass}" data-testid="storage-quota">
		<div class="font-semibold">IndexedDB storage quota:</div>
		<div class="mt-0.5 font-mono text-[11px] break-all">
			{#if storage === undefined}
				Loading…
			{:else if storage}
				{formatBytes(storage.usage)} used of {formatBytes(storage.quota)} ({storage.percent.toFixed(1)}%)
			{:else}
				Unavailable
			{/if}
		</div>
	</div>
	<div class="rounded-xl border px-3 py-2 text-xs transition-colors {memoryCardClass}" data-testid="memory-stats">
		<div class="font-semibold">JS heap memory:</div>
		<div class="mt-0.5 font-mono text-[11px] break-all">
			{#if memory}
				{formatBytes(memory.used)} used of {formatBytes(memory.limit)}{memoryPercent !== null ? ` (${memoryPercent.toFixed(1)}%)` : ''}
			{:else}
				Unavailable (browser does not expose memory stats)
			{/if}
		</div>
	</div>
</section>

<section class="flex flex-col gap-2" aria-label="Processes">
	<h2 class="text-xs font-semibold text-zinc-200">Processes</h2>
	<div class="overflow-x-auto rounded-xl border border-white/10 bg-zinc-900/60">
		<table class="w-full text-xs text-left" data-testid="process-list">
			<thead>
				<tr class="text-[10px] uppercase tracking-wider text-zinc-500 border-b border-white/10">
					<th class="px-2 py-1.5 font-semibold">ID</th>
					<th class="px-2 py-1.5 font-semibold">Name</th>
					<th class="px-2 py-1.5 font-semibold">Status</th>
					<th class="px-2 py-1.5"></th>
				</tr>
			</thead>
			<tbody>
				{#each $sessions as s (s.id)}
					<tr class="border-t border-white/5 text-xs text-zinc-200">
						<td class="px-2 py-1.5 font-mono text-[11px] text-zinc-300">{s.id}</td>
						<td class="px-2 py-1.5 truncate max-w-[6rem]" title="{s.cmd} {s.args.join(' ')}">{s.title}</td>
						<td class="px-2 py-1.5 text-[11px] text-zinc-300">{s.status}{s.exitCode != null ? ` (${s.exitCode})` : ''}</td>
						<td class="px-2 py-1.5 text-right"><button type="button" class="px-2 py-0.5 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 text-[11px] font-medium text-zinc-200 transition-all active:scale-[0.97]" on:click={() => stopSession(s)} aria-label="Stop {s.title}">Stop</button></td>
					</tr>
				{/each}
				{#if vmProcs}
					{#each vmProcs as p (p.pid)}
						<tr class="border-t border-white/5 text-xs text-zinc-200">
							<td class="px-2 py-1.5 font-mono text-[11px] text-zinc-300">{p.pid}</td>
							<td class="px-2 py-1.5 truncate max-w-[6rem]" title={p.command}>{p.command}</td>
							<td class="px-2 py-1.5 text-[11px] text-zinc-300">{p.state}</td>
							<td class="px-2 py-1.5 text-right"><button type="button" class="px-2 py-0.5 rounded-md border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 text-[11px] font-medium text-rose-300 transition-all active:scale-[0.97]" on:click={() => killPid(p)} aria-label="Kill PID {p.pid}">Kill</button></td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
	{#if $sessions.length === 0 && !vmProcs?.length}
		<p class="text-[11px] text-zinc-400">No active processes</p>
	{/if}
	{#if procError}
		<p class="rounded-xl border border-amber-500/20 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-300">{procError}</p>
	{:else if vmProcs === null}
		<p class="text-[11px] text-zinc-400">VM /proc listing appears once the VM has booted.</p>
	{/if}
	<div class="flex items-center gap-2">
		<button type="button" class="h-7 px-2.5 rounded-lg border border-white/10 bg-transparent hover:bg-white/5 text-xs font-medium text-zinc-200 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20" on:click={refreshProcs}>Refresh</button>
	</div>
	{#if lastAction}
		<p class="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-300" role="status" data-testid="process-last-action">{lastAction}</p>
	{/if}
</section>
