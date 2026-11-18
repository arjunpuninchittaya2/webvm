<script>
	export let supervisor = null;

	const services = supervisor?.services;
	const jobs = supervisor?.jobs;

	let cronSchedule = '';
	let cronCommand = '';
	let cronError = '';
	let svcName = '';
	let svcCommand = '';
	let svcError = '';

	function addCron() {
		const res = supervisor.addCron(cronSchedule, cronCommand);
		cronError = res.ok ? '' : res.error;
		if (res.ok) {
			cronSchedule = '';
			cronCommand = '';
		}
	}

	function addService() {
		const res = supervisor.addService(svcName, svcCommand);
		svcError = res.ok ? '' : res.error;
		if (res.ok) {
			svcName = '';
			svcCommand = '';
		}
	}

	function statusText(s) {
		if (s.status === 'running') return 'Running';
		if (s.status === 'pending') return 'Running — waiting for VM';
		if (s.status === 'failed') return `Failed${s.error ? `: ${s.error}` : ''}`;
		return 'Stopped';
	}
</script>

<h1 class="text-sm font-semibold text-zinc-100 pr-8">Services &amp; Cron</h1>
<p class="text-[11px] leading-relaxed text-zinc-400">
	Background daemons run detached inside the VM (output goes to <code class="font-mono text-zinc-300">/home/user/workspace/.svc-*.log</code>).
	Cron jobs are scheduled by this page, so they only fire while WebVM is open.
</p>

{#if supervisor}
	<section class="flex flex-col gap-2" aria-label="Services">
		<h2 class="text-xs font-semibold text-zinc-200">Services</h2>
		{#each $services as s (s.id)}
			<div class="rounded-xl border border-white/10 bg-zinc-900/60 p-2.5 text-xs flex flex-col gap-1.5 shadow-xs" data-testid="service-{s.id}">
				<div class="flex items-center justify-between gap-2">
					<span class="font-semibold text-zinc-100">{s.name}</span>
					<span class="px-1.5 py-0.5 rounded-md border text-[10px] font-medium {s.status === 'running'
						? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
						: s.status === 'pending'
							? 'border-amber-500/20 bg-amber-500/10 text-amber-300'
							: s.status === 'failed'
								? 'border-rose-500/20 bg-rose-500/10 text-rose-300'
								: 'border-white/10 bg-white/5 text-zinc-400'}">{statusText(s)}</span>
				</div>
				<code class="font-mono text-[11px] text-zinc-300 break-all">{s.command}</code>
				<div class="flex gap-1.5 pt-0.5">
					{#if s.status === 'running' || s.status === 'pending'}
						<button type="button" class="h-7 px-2.5 rounded-lg border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 text-xs font-medium transition-all active:scale-[0.97]" on:click={() => supervisor.stop(s.id)}>Stop</button>
					{:else}
						<button type="button" class="h-7 px-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-xs font-medium transition-all active:scale-[0.97]" on:click={() => supervisor.start(s.id)}>Start</button>
					{/if}
					{#if !s.builtin}
						<button type="button" class="h-7 px-2.5 rounded-lg border border-white/10 bg-transparent hover:bg-white/5 text-zinc-300 text-xs font-medium transition-all active:scale-[0.97]" on:click={() => supervisor.removeService(s.id)}>Remove</button>
					{/if}
				</div>
			</div>
		{/each}

		<form class="flex flex-col gap-1.5 text-xs pt-1" on:submit|preventDefault={addService}>
			<input class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-white/20 focus:outline-none" aria-label="Service name" placeholder="Service name" bind:value={svcName} />
			<input class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs font-mono text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-white/20 focus:outline-none" aria-label="Service command" placeholder="e.g. python3 -m http.server 9000" bind:value={svcCommand} />
			{#if svcError}<p class="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300" role="alert">{svcError}</p>{/if}
			<button type="submit" class="self-start h-8 px-3 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20">Add service</button>
		</form>
	</section>

	<section class="flex flex-col gap-2 pt-2 border-t border-white/5" aria-label="Cron jobs">
		<h2 class="text-xs font-semibold text-zinc-200">Cron jobs</h2>
		{#each $jobs as j (j.id)}
			<div class="rounded-xl border border-white/10 bg-zinc-900/60 p-2.5 text-xs flex items-center justify-between gap-2 shadow-xs">
				<div class="flex flex-col gap-0.5 min-w-0">
					<code class="font-mono text-xs font-semibold text-zinc-100">{j.schedule}</code>
					<code class="font-mono text-[11px] text-zinc-300 break-all">{j.command}</code>
					<span class="text-[10px] text-zinc-400">{j.lastRun ? `Last run ${new Date(j.lastRun).toLocaleTimeString()}` : 'Never run'}</span>
				</div>
				<button type="button" class="h-7 px-2.5 rounded-lg border border-white/10 bg-transparent hover:bg-rose-500/10 hover:border-rose-500/20 hover:text-rose-300 text-zinc-300 text-xs font-medium shrink-0 transition-all active:scale-[0.97]" on:click={() => supervisor.removeCron(j.id)}>Delete</button>
			</div>
		{:else}
			<p class="text-[11px] text-zinc-400">No cron jobs scheduled</p>
		{/each}

		<form class="flex flex-col gap-1.5 text-xs pt-1" on:submit|preventDefault={addCron}>
			<input class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs font-mono text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-white/20 focus:outline-none" aria-label="Cron schedule" placeholder="* * * * *" bind:value={cronSchedule} />
			<input class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs font-mono text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-white/20 focus:outline-none" aria-label="Cron command" placeholder="command to run" bind:value={cronCommand} />
			{#if cronError}<p class="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300" role="alert">{cronError}</p>{/if}
			<button type="submit" class="self-start h-8 px-3 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20">Add cron job</button>
		</form>
	</section>
{:else}
	<p class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-400">Supervisor unavailable.</p>
{/if}
