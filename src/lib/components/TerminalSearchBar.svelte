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
		class="flex flex-wrap items-center gap-1.5 px-2 py-1 bg-neutral-900 border-b border-neutral-800 text-xs text-gray-200 shrink-0"
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
			class="w-48 sm:w-64 px-2 py-1 rounded bg-neutral-950 text-white border border-neutral-700 focus:border-amber-400 outline-none"
			on:input={() => emitSearch('next', true)}
			on:keydown={handleKeydown}
		/>

		<button
			type="button"
			aria-pressed={caseSensitive}
			aria-label="Match case"
			title="Case sensitive"
			class="px-1.5 py-1 rounded border font-mono {caseSensitive
				? 'bg-amber-600/30 border-amber-500 text-amber-200'
				: 'bg-neutral-800 border-neutral-700 text-gray-300'}"
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
			class="px-1.5 py-1 rounded border font-mono {regex
				? 'bg-amber-600/30 border-amber-500 text-amber-200'
				: 'bg-neutral-800 border-neutral-700 text-gray-300'}"
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
			class="px-1.5 py-1 rounded border font-mono {wholeWord
				? 'bg-amber-600/30 border-amber-500 text-amber-200'
				: 'bg-neutral-800 border-neutral-700 text-gray-300'}"
			on:click={() => {
				wholeWord = !wholeWord;
				emitSearch('next', false);
			}}
		>
			\b
		</button>

		<span class="px-1.5 text-gray-400 font-mono" data-testid="search-match-count">
			{matchCount > 0 ? `${matchIndex + 1}/${matchCount}` : '0/0'}
		</span>

		<button
			type="button"
			aria-label="Previous match"
			title="Previous match (Shift+Enter)"
			class="p-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
			on:click={() => emitSearch('previous', false)}
		>
			<svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
				<path
					fill-rule="evenodd"
					d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z"
					clip-rule="evenodd"
				/>
			</svg>
		</button>

		<button
			type="button"
			aria-label="Next match"
			title="Next match (Enter)"
			class="p-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
			on:click={() => emitSearch('next', false)}
		>
			<svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
				<path
					fill-rule="evenodd"
					d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
					clip-rule="evenodd"
				/>
			</svg>
		</button>

		<button
			type="button"
			data-testid="search-close-btn"
			aria-label="Close search"
			title="Close search (Esc)"
			class="p-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 ml-auto"
			on:click={() => dispatch('close')}
		>
			<svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
				<path
					fill-rule="evenodd"
					d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
					clip-rule="evenodd"
				/>
			</svg>
		</button>
	</div>
{/if}
