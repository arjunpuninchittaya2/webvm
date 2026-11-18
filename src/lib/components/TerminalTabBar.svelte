<script>
	import { createEventDispatcher, tick } from 'svelte';

	export let sessions = [];
	export let activeSessionId = null;
	export let maxSessions = 8;

	const dispatch = createEventDispatcher();

	let editingId = null;
	let editTitle = '';
	let editInputEl = null;

	async function startRename(session) {
		editingId = session.id;
		editTitle = session.title;
		await tick();
		editInputEl?.focus();
		editInputEl?.select();
	}

	function commitRename() {
		if (!editingId) return;
		const id = editingId;
		const nextTitle = editTitle.trim();
		editingId = null;
		if (nextTitle) {
			dispatch('rename', { id, title: nextTitle });
		}
	}

	function cancelRename() {
		editingId = null;
		editTitle = '';
	}

	function handleEditKeydown(e) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitRename();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelRename();
		}
	}

	function statusDotClass(session) {
		if (session.status === 'error') return 'bg-rose-400';
		if (session.status === 'exited') {
			return session.exitCode && session.exitCode !== 0 ? 'bg-rose-400' : 'bg-zinc-500';
		}
		if (session.status === 'starting') return 'bg-amber-400 animate-pulse';
		return 'bg-emerald-400';
	}
</script>

<div
	class="flex items-center gap-1 px-2 py-1 bg-zinc-950 border-b border-white/10 text-xs text-zinc-200 overflow-x-auto scrollbar shrink-0"
	data-testid="terminal-tab-bar"
	role="tablist"
	aria-label="Terminal sessions"
>
	{#each sessions as session (session.id)}
		{@const isActive = session.id === activeSessionId}
		<div
			class="group flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs shrink-0 transition-colors {isActive
				? 'bg-white/10 border-white/15 text-white font-medium'
				: 'bg-transparent border-transparent text-zinc-400 hover:bg-white/5 hover:text-zinc-200'}"
			role="presentation"
		>
			<span class="w-1.5 h-1.5 rounded-full shrink-0 {statusDotClass(session)}" title={session.status} aria-hidden="true"></span>

			{#if editingId === session.id}
				<input
					bind:this={editInputEl}
					bind:value={editTitle}
					data-testid="tab-rename-input"
					type="text"
					maxlength="32"
					aria-label="Rename terminal tab"
					class="w-24 px-1.5 py-0.5 text-xs bg-zinc-950/80 text-zinc-100 border border-white/20 rounded-md focus:outline-none focus:border-white/30"
					on:keydown={handleEditKeydown}
					on:blur={commitRename}
				/>
			{:else}
				<button
					type="button"
					role="tab"
					aria-selected={isActive}
					data-testid="terminal-tab-{session.id}"
					class="flex items-center gap-1.5 text-left font-medium rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
					on:click={() => dispatch('select', session.id)}
					on:dblclick={() => startRename(session)}
					title="{session.title} (double-click to rename)"
				>
					<span class="max-w-[8rem] truncate">{session.title}</span>
					{#if session.exitCode !== null && session.exitCode !== undefined}
						<span
							class="px-1.5 py-0.5 rounded border text-[10px] leading-none font-mono {session.exitCode === 0
								? 'bg-white/5 border-white/10 text-zinc-300'
								: 'bg-rose-500/10 border-rose-500/20 text-rose-300'}"
							data-testid="tab-exit-code-{session.id}"
						>
							exit {session.exitCode}
						</span>
					{/if}
				</button>
			{/if}

			{#if editingId !== session.id}
				<button
					type="button"
					class="p-0.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
					aria-label="Rename {session.title}"
					title="Rename tab"
					data-testid="rename-tab-{session.id}"
					on:click|stopPropagation={() => startRename(session)}
				>
					<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
						<path d="m15 5 4 4" />
					</svg>
				</button>

				<button
					type="button"
					class="p-0.5 rounded-md text-zinc-400 hover:text-white hover:bg-white/10 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
					aria-label="Restart {session.title}"
					title="Restart session"
					data-testid="restart-tab-{session.id}"
					on:click|stopPropagation={() => dispatch('restart', session.id)}
				>
					<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
						<path d="M3 3v5h5" />
					</svg>
				</button>

				{#if session.kind !== 'primary'}
					<button
						type="button"
						class="p-0.5 rounded-md text-zinc-400 hover:text-rose-300 hover:bg-rose-500/10 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
						aria-label="Close {session.title}"
						title="Close tab"
						data-testid="close-tab-{session.id}"
						on:click|stopPropagation={() => dispatch('close', session.id)}
					>
						<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
							<path d="M18 6 6 18" />
							<path d="m6 6 12 12" />
						</svg>
					</button>
				{/if}
			{/if}
		</div>
	{/each}

	<button
		type="button"
		data-testid="new-tab-btn"
		disabled={sessions.length >= maxSessions}
		aria-label="New terminal tab"
		title={sessions.length >= maxSessions ? `Maximum ${maxSessions} tabs reached` : 'New shell tab'}
		class="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-white/10 bg-zinc-900/60 hover:bg-white/5 hover:text-white text-xs font-medium text-zinc-300 transition-all active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 shrink-0"
		on:click={() => dispatch('create')}
	>
		<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M5 12h14" />
			<path d="M12 5v14" />
		</svg>
		<span>New Tab</span>
	</button>
</div>
