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
		if (session.status === 'error') return 'bg-red-500';
		if (session.status === 'exited') {
			return session.exitCode && session.exitCode !== 0 ? 'bg-red-400' : 'bg-neutral-400';
		}
		if (session.status === 'starting') return 'bg-amber-400 animate-pulse';
		return 'bg-emerald-400';
	}
</script>

<div
	class="flex items-center gap-1 px-2 py-1 bg-neutral-900 border-b border-neutral-800 text-xs text-gray-200 overflow-x-auto shrink-0"
	data-testid="terminal-tab-bar"
	role="tablist"
	aria-label="Terminal sessions"
>
	{#each sessions as session (session.id)}
		{@const isActive = session.id === activeSessionId}
		<div
			class="group flex items-center gap-1.5 px-2 py-1 rounded border text-xs shrink-0 {isActive
				? 'bg-neutral-700 border-neutral-500 text-white'
				: 'bg-neutral-800/80 border-neutral-800 text-gray-300 hover:bg-neutral-800'}"
			role="presentation"
		>
			<span class="w-2 h-2 rounded-full shrink-0 {statusDotClass(session)}" title={session.status}></span>

			{#if editingId === session.id}
				<input
					bind:this={editInputEl}
					bind:value={editTitle}
					data-testid="tab-rename-input"
					type="text"
					maxlength="32"
					aria-label="Rename terminal tab"
					class="w-24 px-1 py-0.5 text-xs bg-neutral-950 text-white border border-amber-400 rounded outline-none"
					on:keydown={handleEditKeydown}
					on:blur={commitRename}
				/>
			{:else}
				<button
					type="button"
					role="tab"
					aria-selected={isActive}
					data-testid="terminal-tab-{session.id}"
					class="flex items-center gap-1.5 text-left font-medium focus:outline-none"
					on:click={() => dispatch('select', session.id)}
					on:dblclick={() => startRename(session)}
					title="{session.title} (double-click to rename)"
				>
					<span class="max-w-[8rem] truncate">{session.title}</span>
					{#if session.exitCode !== null && session.exitCode !== undefined}
						<span
							class="px-1 py-0.2 rounded text-[10px] font-mono {session.exitCode === 0
								? 'bg-neutral-600 text-gray-200'
								: 'bg-red-900/80 text-red-200'}"
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
					class="p-0.5 rounded text-gray-400 hover:text-white hover:bg-neutral-600 focus:outline-none"
					aria-label="Rename {session.title}"
					title="Rename tab"
					data-testid="rename-tab-{session.id}"
					on:click|stopPropagation={() => startRename(session)}
				>
					<svg class="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
						<path d="M13.586 3.586a2 2 0 112.828 2.828l-8.95 8.95-3.364.536.536-3.364 8.95-8.95z" />
					</svg>
				</button>

				<button
					type="button"
					class="p-0.5 rounded text-gray-400 hover:text-amber-300 hover:bg-neutral-600 focus:outline-none"
					aria-label="Restart {session.title}"
					title="Restart session"
					data-testid="restart-tab-{session.id}"
					on:click|stopPropagation={() => dispatch('restart', session.id)}
				>
					<svg class="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
						<path
							fill-rule="evenodd"
							d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
							clip-rule="evenodd"
						/>
					</svg>
				</button>

				{#if session.kind !== 'primary'}
					<button
						type="button"
						class="p-0.5 rounded text-gray-400 hover:text-red-300 hover:bg-neutral-600 focus:outline-none"
						aria-label="Close {session.title}"
						title="Close tab"
						data-testid="close-tab-{session.id}"
						on:click|stopPropagation={() => dispatch('close', session.id)}
					>
						<svg class="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
							<path
								fill-rule="evenodd"
								d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
								clip-rule="evenodd"
							/>
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
		class="flex items-center gap-1 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 disabled:cursor-not-allowed text-gray-200 border border-neutral-700 shrink-0"
		on:click={() => dispatch('create')}
	>
		<svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
			<path
				fill-rule="evenodd"
				d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
				clip-rule="evenodd"
			/>
		</svg>
		<span>New Tab</span>
	</button>
</div>
