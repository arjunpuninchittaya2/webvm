<script>
	import { createEventDispatcher, tick } from 'svelte';

	export let open = false;
	export let matchIndex = -1;
	export let matchCount = 0;

	const dispatch = createEventDispatcher();

	let query = '';
	let caseSensitive = false;
	let regex = false;
	let wholeWord = false;
	let inputEl = null;

	$: if (open) {
		tick().then(() => {
			inputEl?.focus();
			inputEl?.select();
		});
	}

	function emitSearch(direction = 'next', incremental = true) {
		dispatch('search', {
			query,
			caseSensitive,
			regex,
			wholeWord,
			direction,
			incremental
		});
	}

	function handleKeydown(e) {
		if (e.key === 'Enter') {
			e.preventDefault();
			emitSearch(e.shiftKey ? 'previous' : 'next', false);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			dispatch('close');
		}
	}
</script>

{#if open}
	<div
		class="flex flex-wrap items-center gap-1.5 px-2 py-1.5 bg-zinc-900/90 backdrop-blur-md border-b border-white/10 text-xs text-zinc-200 shrink-0 animate-in fade-in-0 duration-150"
		data-testid="terminal-search-bar"
		role="search"
		aria-label="Search terminal output"
	>
		<input
			bind:this={inputEl}
			bind:value={query}
			data-testid="terminal-search-input"
			type="text"
			placeholder="Find in terminal..."
			aria-label="Find in terminal"
			class="w-48 sm:w-64 h-7 px-2.5 rounded-lg border border-white/10 bg-zinc-950/60 text-xs text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-white/20 focus:outline-none"
			on:input={() => emitSearch('next', true)}
			on:keydown={handleKeydown}
		/>

		<button
			type="button"
			aria-pressed={caseSensitive}
			aria-label="Match case"
			title="Case sensitive"
			class="h-7 px-2 rounded-lg border font-mono text-xs transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 {caseSensitive
				? 'bg-white/10 border-white/20 text-white font-medium'
				: 'bg-transparent border-white/10 text-zinc-400 hover:bg-white/5 hover:text-white'}"
			on:click={() => {
				caseSensitive = !caseSensitive;
				emitSearch('next', false);
			}}
		>
			Aa
		</button>

		<button
			type="button"
			aria-pressed={regex}
			aria-label="Use regular expression"
			title="Regular expression"
			class="h-7 px-2 rounded-lg border font-mono text-xs transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 {regex
				? 'bg-white/10 border-white/20 text-white font-medium'
				: 'bg-transparent border-white/10 text-zinc-400 hover:bg-white/5 hover:text-white'}"
			on:click={() => {
				regex = !regex;
				emitSearch('next', false);
			}}
		>
			.*
		</button>

		<button
			type="button"
			aria-pressed={wholeWord}
			aria-label="Match whole word"
			title="Whole word"
			class="h-7 px-2 rounded-lg border font-mono text-xs transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 {wholeWord
				? 'bg-white/10 border-white/20 text-white font-medium'
				: 'bg-transparent border-white/10 text-zinc-400 hover:bg-white/5 hover:text-white'}"
			on:click={() => {
				wholeWord = !wholeWord;
				emitSearch('next', false);
			}}
		>
			\b
		</button>

		<span class="px-1.5 text-[11px] text-zinc-400 font-mono tabular-nums" data-testid="search-match-count">
			{matchCount > 0 ? `${matchIndex + 1}/${matchCount}` : '0/0'}
		</span>

		<button
			type="button"
			aria-label="Previous match"
			title="Previous match (Shift+Enter)"
			class="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-white/10 bg-transparent text-zinc-400 hover:bg-white/5 hover:text-white transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
			on:click={() => emitSearch('previous', false)}
		>
			<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="m18 15-6-6-6 6" />
			</svg>
		</button>

		<button
			type="button"
			aria-label="Next match"
			title="Next match (Enter)"
			class="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-white/10 bg-transparent text-zinc-400 hover:bg-white/5 hover:text-white transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
			on:click={() => emitSearch('next', false)}
		>
			<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="m6 9 6 6 6-6" />
			</svg>
		</button>

		<button
			type="button"
			data-testid="search-close-btn"
			aria-label="Close search"
			title="Close search (Esc)"
			class="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-white/10 bg-transparent text-zinc-400 hover:bg-white/5 hover:text-white transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 ml-auto"
			on:click={() => dispatch('close')}
		>
			<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<path d="M18 6 6 18" />
				<path d="m6 6 12 12" />
			</svg>
		</button>
	</div>
{/if}
