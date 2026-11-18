<script>
	import { createEventDispatcher } from 'svelte';

	export let vtAvailable = false;
	export let activeVt = 1;
	export let displayPaused = false;
	export let displayScale = 1;
	export let virtualKeysVisible = false;
	export let searchOpen = false;
	export let activeRenderer = 'dom';
	export let isFullscreen = false;

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
	class="flex flex-wrap items-center gap-1.5 px-2 py-1.5 bg-zinc-900/80 backdrop-blur-sm border-b border-white/10 text-xs text-zinc-200 shrink-0"
	data-testid="terminal-toolbar"
>
	<button
		type="button"
		data-testid="toolbar-copy-btn"
		class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-white/10 bg-transparent hover:bg-white/5 text-xs font-medium text-zinc-300 hover:text-white transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
		title="Copy selected text"
		aria-label="Copy selection"
		on:click={() => dispatch('copy')}
	>
		<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
			<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
		</svg>
		<span>Copy</span>
	</button>

	<button
		type="button"
		data-testid="toolbar-paste-btn"
		class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-white/10 bg-transparent hover:bg-white/5 text-xs font-medium text-zinc-300 hover:text-white transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
		title="Paste from clipboard"
		aria-label="Paste clipboard"
		on:click={() => dispatch('paste')}
	>
		<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
			<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
		</svg>
		<span>Paste</span>
	</button>

	<button
		type="button"
		data-testid="toolbar-search-btn"
		aria-pressed={searchOpen}
		aria-label="Search terminal"
		title="Find in terminal (Ctrl+Shift+F)"
		class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border text-xs transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 {searchOpen
			? 'bg-white/10 border-white/20 text-white font-medium'
			: 'bg-transparent border-white/10 text-zinc-300 hover:bg-white/5 hover:text-white'}"
		on:click={() => dispatch('toggleSearch')}
	>
		<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<circle cx="11" cy="11" r="8" />
			<path d="m21 21-4.3-4.3" />
		</svg>
		<span>Search</span>
	</button>

	<button
		type="button"
		data-testid="toolbar-vkeys-btn"
		aria-pressed={virtualKeysVisible}
		aria-label="Toggle virtual keys"
		title="Show/hide Chromebook virtual key bar"
		class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border text-xs transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 {virtualKeysVisible
			? 'bg-white/10 border-white/20 text-white font-medium'
			: 'bg-transparent border-white/10 text-zinc-300 hover:bg-white/5 hover:text-white'}"
		on:click={() => dispatch('toggleVirtualKeys')}
	>
		<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M10 8h.01" />
			<path d="M12 12h.01" />
			<path d="M14 8h.01" />
			<path d="M16 12h.01" />
			<path d="M18 8h.01" />
			<path d="M6 8h.01" />
			<path d="M7 16h10" />
			<path d="M8 12h.01" />
			<rect width="20" height="16" x="2" y="4" rx="2" />
		</svg>
		<span>Keys</span>
	</button>

	{#if vtAvailable}
		<div class="flex items-center gap-1.5 pl-2 ml-1 border-l border-white/10">
			<button
				type="button"
				data-testid="vt-toggle-btn"
				aria-label="Switch between VT1 console and VT7 display"
				title="Toggle VT1 Text Console / VT7 X11 Display"
				class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border text-xs transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 {activeVt === 7
					? 'bg-white/10 border-white/20 text-white font-medium'
					: 'bg-transparent border-white/10 text-zinc-300 hover:bg-white/5 hover:text-white'}"
				on:click={() => dispatch('toggleVt')}
			>
				<span class="font-mono font-semibold">VT{activeVt}</span>
				<span class="text-zinc-400">→ VT{activeVt === 7 ? 1 : 7}</span>
			</button>

			<button
				type="button"
				data-testid="display-pause-btn"
				aria-pressed={displayPaused}
				aria-label={displayPaused ? 'Resume display updates' : 'Pause display updates'}
				title={displayPaused ? 'Resume X11 display resizing' : 'Pause X11 display resizing'}
				class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border text-xs transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 {displayPaused
					? 'bg-white/10 border-white/20 text-white font-medium'
					: 'bg-transparent border-white/10 text-zinc-300 hover:bg-white/5 hover:text-white'}"
				on:click={() => dispatch('toggleDisplayPause')}
			>
				<span>{displayPaused ? 'Resume Display' : 'Pause Display'}</span>
			</button>

			<label class="inline-flex items-center gap-1.5 text-xs text-zinc-400">
				<span>Scale</span>
				<select
					data-testid="display-scale-select"
					aria-label="Display scale"
					value={String(displayScale)}
					on:change={handleScaleChange}
					class="h-7 px-2 rounded-lg border border-white/10 bg-zinc-950/60 text-xs text-zinc-200 transition-colors focus:border-white/20 focus:outline-none"
				>
					{#each scaleOptions as opt}
						<option value={String(opt)}>{opt}x</option>
					{/each}
				</select>
			</label>

			<button
				type="button"
				data-testid="display-fullscreen-btn"
				aria-pressed={isFullscreen}
				aria-label={isFullscreen ? 'Exit fullscreen display' : 'Fullscreen display'}
				title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen graphical display'}
				class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border text-xs transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 {isFullscreen
					? 'bg-white/10 border-white/20 text-white font-medium'
					: 'bg-transparent border-white/10 text-zinc-300 hover:bg-white/5 hover:text-white'}"
				on:click={() => dispatch('toggleFullscreen')}
			>
				<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
					<path d="M8 3H5a2 2 0 0 0-2 2v3" />
					<path d="M21 8V5a2 2 0 0 0-2-2h-3" />
					<path d="M3 16v3a2 2 0 0 0 2 2h3" />
					<path d="M16 21h3a2 2 0 0 0 2-2v-3" />
				</svg>
				<span>{isFullscreen ? 'Exit Full' : 'Fullscreen'}</span>
			</button>
		</div>
	{/if}

	<div class="ml-auto flex items-center gap-2">
		<span
			class="hidden sm:inline-flex items-center px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-[10px] font-mono text-zinc-400"
			title="Active terminal renderer"
		>
			{activeRenderer.toUpperCase()}
		</span>

		<button
			type="button"
			data-testid="settings-btn"
			aria-label="Open workstation settings"
			title="Settings"
			class="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg border border-white/10 bg-transparent hover:bg-white/5 text-xs font-medium text-zinc-300 hover:text-white transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
			on:click={() => dispatch('openSettings')}
		>
			<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
				<circle cx="12" cy="12" r="3" />
			</svg>
			<span>Settings</span>
		</button>
	</div>
</div>
