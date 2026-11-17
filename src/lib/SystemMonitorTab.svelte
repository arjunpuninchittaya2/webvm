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

<h1 class="text-lg font-bold">System Monitor</h1>

<section class="flex flex-col gap-3" aria-label="Resource usage">
	<div>
		<p class="text-sm"><span class="font-bold">CPU activity:</span> {$cpuPercentage}%</p>
		<svg data-testid="sparkline-cpu" role="img" aria-label="CPU activity history" width={W} height={H} viewBox="0 0 {W} {H}" class="bg-neutral-800 rounded">
			<polyline points={sparklinePoints(cpuSamples, W, H, 100)} fill="none" stroke="#fbbf24" stroke-width="1.5" />
		</svg>
	</div>
	<div>
		<p class="text-sm"><span class="font-bold">Disk latency:</span> {$diskLatency} ms</p>
		<svg data-testid="sparkline-disk" role="img" aria-label="Disk latency history" width={W} height={H} viewBox="0 0 {W} {H}" class="bg-neutral-800 rounded">
			<polyline points={sparklinePoints(latSamples, W, H)} fill="none" stroke="#38bdf8" stroke-width="1.5" />
		</svg>
	</div>
	<div class="text-sm" data-testid="storage-quota">
		<span class="font-bold">IndexedDB storage quota:</span>
		{#if storage === undefined}
			Loading…
		{:else if storage}
			{formatBytes(storage.usage)} used of {formatBytes(storage.quota)} ({storage.percent.toFixed(1)}%)
		{:else}
			Unavailable
		{/if}
	</div>
	<div class="text-sm" data-testid="memory-stats">
		<span class="font-bold">JS heap memory:</span>
		{#if memory}
			{formatBytes(memory.used)} used of {formatBytes(memory.limit)}
		{:else}
			Unavailable (browser does not expose memory stats)
		{/if}
	</div>
</section>

<section class="flex flex-col gap-2" aria-label="Processes">
	<h2 class="font-bold">Processes</h2>
	<div class="overflow-x-auto">
		<table class="w-full text-xs text-left" data-testid="process-list">
			<thead>
				<tr class="text-gray-300"><th class="pr-1">ID</th><th class="pr-1">Name</th><th class="pr-1">Status</th><th></th></tr>
			</thead>
			<tbody>
				{#each $sessions as s (s.id)}
					<tr class="border-t border-neutral-500">
						<td class="pr-1 font-mono">{s.id}</td>
						<td class="pr-1 truncate max-w-[6rem]" title="{s.cmd} {s.args.join(' ')}">{s.title}</td>
						<td class="pr-1">{s.status}{s.exitCode != null ? ` (${s.exitCode})` : ''}</td>
						<td><button type="button" class="px-1 rounded bg-neutral-700 hover:bg-neutral-500" on:click={() => stopSession(s)} aria-label="Stop {s.title}">Stop</button></td>
					</tr>
				{/each}
				{#if vmProcs}
					{#each vmProcs as p (p.pid)}
						<tr class="border-t border-neutral-500">
							<td class="pr-1 font-mono">{p.pid}</td>
							<td class="pr-1 truncate max-w-[6rem]" title={p.command}>{p.command}</td>
							<td class="pr-1">{p.state}</td>
							<td><button type="button" class="px-1 rounded bg-red-900 hover:bg-red-700" on:click={() => killPid(p)} aria-label="Kill PID {p.pid}">Kill</button></td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
	{#if $sessions.length === 0 && !vmProcs?.length}
		<p class="text-xs text-gray-300">No active processes</p>
	{/if}
	{#if procError}
		<p class="text-xs text-amber-300">{procError}</p>
	{:else if vmProcs === null}
		<p class="text-xs text-gray-300">VM /proc listing appears once the VM has booted.</p>
	{/if}
	<div class="flex items-center gap-2">
		<button type="button" class="px-2 py-0.5 text-xs rounded bg-neutral-700 hover:bg-neutral-500" on:click={refreshProcs}>Refresh</button>
	</div>
	{#if lastAction}
		<p class="text-xs text-emerald-300" role="status" data-testid="process-last-action">{lastAction}</p>
	{/if}
</section>
