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

<h1 class="text-lg font-bold">Services &amp; Cron</h1>
<p class="text-xs text-gray-300">
	Background daemons run detached inside the VM (output goes to <code>/home/user/workspace/.svc-*.log</code>).
	Cron jobs are scheduled by this page, so they only fire while WebVM is open.
</p>

{#if supervisor}
	<section class="flex flex-col gap-2" aria-label="Services">
		<h2 class="font-bold">Services</h2>
		{#each $services as s (s.id)}
			<div class="border border-neutral-500 rounded p-2 text-xs flex flex-col gap-1" data-testid="service-{s.id}">
				<div class="flex items-center justify-between gap-2">
					<span class="font-semibold">{s.name}</span>
					<span class="text-gray-300">{statusText(s)}</span>
				</div>
				<code class="text-gray-300 break-all">{s.command}</code>
				<div class="flex gap-2">
					{#if s.status === 'running' || s.status === 'pending'}
						<button type="button" class="px-2 rounded bg-red-900 hover:bg-red-700" on:click={() => supervisor.stop(s.id)}>Stop</button>
					{:else}
						<button type="button" class="px-2 rounded bg-emerald-800 hover:bg-emerald-600" on:click={() => supervisor.start(s.id)}>Start</button>
					{/if}
					{#if !s.builtin}
						<button type="button" class="px-2 rounded bg-neutral-700 hover:bg-neutral-500" on:click={() => supervisor.removeService(s.id)}>Remove</button>
					{/if}
				</div>
			</div>
		{/each}

		<form class="flex flex-col gap-1 text-xs" on:submit|preventDefault={addService}>
			<input class="bg-neutral-800 rounded p-1" aria-label="Service name" placeholder="Service name" bind:value={svcName} />
			<input class="bg-neutral-800 rounded p-1 font-mono" aria-label="Service command" placeholder="e.g. python3 -m http.server 9000" bind:value={svcCommand} />
			{#if svcError}<p class="text-red-300" role="alert">{svcError}</p>{/if}
			<button type="submit" class="self-start px-2 py-0.5 rounded bg-neutral-700 hover:bg-neutral-500">Add service</button>
		</form>
	</section>

	<section class="flex flex-col gap-2" aria-label="Cron jobs">
		<h2 class="font-bold">Cron jobs</h2>
		{#each $jobs as j (j.id)}
			<div class="border border-neutral-500 rounded p-2 text-xs flex items-center justify-between gap-2">
				<div class="flex flex-col min-w-0">
					<code class="font-semibold">{j.schedule}</code>
					<code class="text-gray-300 break-all">{j.command}</code>
					<span class="text-gray-400">{j.lastRun ? `Last run ${new Date(j.lastRun).toLocaleTimeString()}` : 'Never run'}</span>
				</div>
				<button type="button" class="px-2 rounded bg-neutral-700 hover:bg-neutral-500" on:click={() => supervisor.removeCron(j.id)}>Delete</button>
			</div>
		{:else}
			<p class="text-xs text-gray-300">No cron jobs scheduled</p>
		{/each}

		<form class="flex flex-col gap-1 text-xs" on:submit|preventDefault={addCron}>
			<input class="bg-neutral-800 rounded p-1 font-mono" aria-label="Cron schedule" placeholder="* * * * *" bind:value={cronSchedule} />
			<input class="bg-neutral-800 rounded p-1 font-mono" aria-label="Cron command" placeholder="command to run" bind:value={cronCommand} />
			{#if cronError}<p class="text-red-300" role="alert">{cronError}</p>{/if}
			<button type="submit" class="self-start px-2 py-0.5 rounded bg-neutral-700 hover:bg-neutral-500">Add cron job</button>
		</form>
	</section>
{:else}
	<p class="text-sm text-gray-300">Supervisor unavailable.</p>
{/if}
