<script>
	import { createEventDispatcher } from 'svelte';

	export let vtAvailable = false;
	export let activeVt = 1;
	export let displayPaused = false;
	export let displayScale = 1;
	export let virtualKeysVisible = false;
	export let searchOpen = false;
	export let activeRenderer = 'dom';

	const dispatch = createEventDispatcher();
	const scaleOptions = [0.5, 0.75, 1, 1.25, 1.5, 2];

	function handleScaleChange(e) {
		const nextScale = Number(e.currentTarget.value);
		if (Number.isFinite(nextScale)) {
			dispatch('changeDisplayScale', nextScale);
		}
	}
</script>

<div
	class="flex flex-wrap items-center gap-1.5 px-2 py-1 bg-neutral-900 border-b border-neutral-800 text-xs text-gray-200 shrink-0"
	data-testid="terminal-toolbar"
>
	<button
		type="button"
		data-testid="toolbar-copy-btn"
		class="inline-flex items-center gap-1 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
		title="Copy selected text"
		aria-label="Copy selection"
		on:click={() => dispatch('copy')}
	>
		<svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
			<path d="M8 2a2 2 0 00-2 2v1H5a2 2 0 00-2 2v9a2 2 0 002 2h7a2 2 0 002-2v-1h1a2 2 0 002-2V6.414A2 2 0 0016.414 5L14 2.586A2 2 0 0012.586 2H8z" />
		</svg>
		<span>Copy</span>
	</button>

	<button
		type="button"
		data-testid="toolbar-paste-btn"
		class="inline-flex items-center gap-1 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
		title="Paste from clipboard"
		aria-label="Paste clipboard"
		on:click={() => dispatch('paste')}
	>
		<svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
			<path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
			<path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
		</svg>
		<span>Paste</span>
	</button>

	<button
		type="button"
		data-testid="toolbar-search-btn"
		aria-pressed={searchOpen}
		aria-label="Search terminal"
		title="Find in terminal (Ctrl+Shift+F)"
		class="inline-flex items-center gap-1 px-2 py-1 rounded border {searchOpen
			? 'bg-amber-600/30 border-amber-500 text-amber-200'
			: 'bg-neutral-800 hover:bg-neutral-700 border-neutral-700'}"
		on:click={() => dispatch('toggleSearch')}
	>
		<svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
			<path
				fill-rule="evenodd"
				d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
				clip-rule="evenodd"
			/>
		</svg>
		<span>Search</span>
	</button>

	<button
		type="button"
		data-testid="toolbar-vkeys-btn"
		aria-pressed={virtualKeysVisible}
		aria-label="Toggle virtual keys"
		title="Show/hide Chromebook virtual key bar"
		class="inline-flex items-center gap-1 px-2 py-1 rounded border {virtualKeysVisible
			? 'bg-amber-600/30 border-amber-500 text-amber-200'
			: 'bg-neutral-800 hover:bg-neutral-700 border-neutral-700'}"
		on:click={() => dispatch('toggleVirtualKeys')}
	>
		<svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
			<path
				fill-rule="evenodd"
				d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V5zm2 1v2h2V6H5zm3 0v2h2V6H8zm3 0v2h2V6h-2zm3 0v2h1V6h-1zM5 9v2h2V9H5zm3 0v2h2V9H8zm3 0v2h4V9h-4zm-4 3v1h6v-1H7z"
				clip-rule="evenodd"
			/>
		</svg>
		<span>Keys</span>
	</button>

	{#if vtAvailable}
		<div class="flex items-center gap-1.5 pl-1.5 ml-1 border-l border-neutral-700">
			<button
				type="button"
				data-testid="vt-toggle-btn"
				aria-label="Switch between VT1 console and VT7 display"
				title="Toggle VT1 Text Console / VT7 X11 Display"
				class="inline-flex items-center gap-1 px-2 py-1 rounded border {activeVt === 7
					? 'bg-sky-700/60 border-sky-500 text-sky-100'
					: 'bg-neutral-800 hover:bg-neutral-700 border-neutral-700'}"
				on:click={() => dispatch('toggleVt')}
			>
				<span class="font-mono font-semibold">VT{activeVt}</span>
				<span class="text-gray-300">→ VT{activeVt === 7 ? 1 : 7}</span>
			</button>

			<button
				type="button"
				data-testid="display-pause-btn"
				aria-pressed={displayPaused}
				aria-label={displayPaused ? 'Resume display updates' : 'Pause display updates'}
				title={displayPaused ? 'Resume X11 display resizing' : 'Pause X11 display resizing'}
				class="inline-flex items-center gap-1 px-2 py-1 rounded border {displayPaused
					? 'bg-amber-700/50 border-amber-500 text-amber-100'
					: 'bg-neutral-800 hover:bg-neutral-700 border-neutral-700'}"
				on:click={() => dispatch('toggleDisplayPause')}
			>
				<span>{displayPaused ? 'Resume Display' : 'Pause Display'}</span>
			</button>

			<label class="inline-flex items-center gap-1 text-gray-300">
				<span>Scale</span>
				<select
					data-testid="display-scale-select"
					aria-label="Display scale"
					value={String(displayScale)}
					on:change={handleScaleChange}
					class="px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-gray-100 text-xs"
				>
					{#each scaleOptions as opt}
						<option value={String(opt)}>{opt}x</option>
					{/each}
				</select>
			</label>
		</div>
	{/if}

	<div class="ml-auto flex items-center gap-2">
		<span
			class="hidden sm:inline-block px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-[11px] font-mono text-gray-300"
			title="Active terminal renderer"
		>
			{activeRenderer.toUpperCase()}
		</span>

		<button
			type="button"
			data-testid="settings-btn"
			aria-label="Open workstation settings"
			title="Settings"
			class="inline-flex items-center gap-1 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
			on:click={() => dispatch('openSettings')}
		>
			<svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
				<path
					fill-rule="evenodd"
					d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
					clip-rule="evenodd"
				/>
			</svg>
			<span>Settings</span>
		</button>
	</div>
</div>
