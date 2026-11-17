<script>
	import { createEventDispatcher } from 'svelte';
	import { applyTerminalModifiers } from '$lib/vm/terminalIO.js';

	export let visible = false;
	export let activeVt = 1;
	export let stickyCtrl = false;
	export let ctrlLocked = false;
	export let stickyAlt = false;
	export let altLocked = false;

	const dispatch = createEventDispatcher();

	let showFnRow = false;

	const FUNCTION_KEYS = [
		{ label: 'F1', seq: '\x1bOP' },
		{ label: 'F2', seq: '\x1bOQ' },
		{ label: 'F3', seq: '\x1bOR' },
		{ label: 'F4', seq: '\x1bOS' },
		{ label: 'F5', seq: '\x1b[15~' },
		{ label: 'F6', seq: '\x1b[17~' },
		{ label: 'F7', seq: '\x1b[18~' },
		{ label: 'F8', seq: '\x1b[19~' },
		{ label: 'F9', seq: '\x1b[20~' },
		{ label: 'F10', seq: '\x1b[21~' },
		{ label: 'F11', seq: '\x1b[23~' },
		{ label: 'F12', seq: '\x1b[24~' }
	];

	function emitModifierChange() {
		dispatch('modifierChange', {
			ctrl: stickyCtrl,
			ctrlLocked,
			alt: stickyAlt,
			altLocked
		});
	}

	function toggleCtrl() {
		if (ctrlLocked) {
			stickyCtrl = false;
			ctrlLocked = false;
		} else {
			stickyCtrl = !stickyCtrl;
			ctrlLocked = false;
		}
		emitModifierChange();
	}

	function lockCtrl() {
		stickyCtrl = true;
		ctrlLocked = true;
		emitModifierChange();
	}

	function toggleAlt() {
		if (altLocked) {
			stickyAlt = false;
			altLocked = false;
		} else {
			stickyAlt = !stickyAlt;
			altLocked = false;
		}
		emitModifierChange();
	}

	function lockAlt() {
		stickyAlt = true;
		altLocked = true;
		emitModifierChange();
	}

	function emitSequence(seq, allowMod = true) {
		if (allowMod && (stickyCtrl || stickyAlt)) {
			const { output, consumedCtrl, consumedAlt } = applyTerminalModifiers(seq, {
				ctrl: stickyCtrl,
				alt: stickyAlt
			});
			let changed = false;
			if (consumedCtrl && !ctrlLocked) {
				stickyCtrl = false;
				changed = true;
			}
			if (consumedAlt && !altLocked) {
				stickyAlt = false;
				changed = true;
			}
			if (changed) {
				emitModifierChange();
			}
			dispatch('sendKey', output);
			return;
		}
		dispatch('sendKey', seq);
	}

	function handleModInput(e) {
		const val = e.currentTarget.value;
		e.currentTarget.value = '';
		if (val) {
			emitSequence(val, true);
		}
	}
</script>

{#if visible}
	<div
		class="flex flex-col gap-1 px-2 py-1.5 bg-neutral-900 border-t border-neutral-800 text-xs text-gray-100 select-none shrink-0"
		data-testid="virtual-key-bar"
		role="toolbar"
		aria-label="Virtual terminal keys"
	>
		<div class="flex flex-wrap items-center gap-1">
			<button
				type="button"
				data-testid="vkey-esc"
				class="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 font-mono"
				on:mousedown|preventDefault
				on:click={() => emitSequence('\x1b', false)}
			>
				Esc
			</button>

			<button
				type="button"
				data-testid="vkey-tab"
				class="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 font-mono"
				on:mousedown|preventDefault
				on:click={() => emitSequence('\t', false)}
			>
				Tab
			</button>

			<button
				type="button"
				data-testid="vkey-ctrl"
				aria-pressed={stickyCtrl}
				data-locked={ctrlLocked ? 'true' : 'false'}
				title={ctrlLocked ? 'Ctrl locked (click to unlock)' : 'Sticky Ctrl (double-click to lock)'}
				class="px-2 py-1 rounded border font-mono {stickyCtrl
					? ctrlLocked
						? 'bg-amber-500/50 border-amber-300 text-amber-100 font-semibold'
						: 'bg-amber-600/40 border-amber-400 text-amber-200'
					: 'bg-neutral-800 hover:bg-neutral-700 border-neutral-700'}"
				on:mousedown|preventDefault
				on:click={toggleCtrl}
				on:dblclick={lockCtrl}
			>
				Ctrl{ctrlLocked ? ' •' : ''}
			</button>

			<button
				type="button"
				data-testid="vkey-alt"
				aria-pressed={stickyAlt}
				data-locked={altLocked ? 'true' : 'false'}
				title={altLocked ? 'Alt locked (click to unlock)' : 'Sticky Alt (double-click to lock)'}
				class="px-2 py-1 rounded border font-mono {stickyAlt
					? altLocked
						? 'bg-amber-500/50 border-amber-300 text-amber-100 font-semibold'
						: 'bg-amber-600/40 border-amber-400 text-amber-200'
					: 'bg-neutral-800 hover:bg-neutral-700 border-neutral-700'}"
				on:mousedown|preventDefault
				on:click={toggleAlt}
				on:dblclick={lockAlt}
			>
				Alt{altLocked ? ' •' : ''}
			</button>

			{#if stickyCtrl || stickyAlt}
				<input
					type="text"
					data-testid="vkey-mod-input"
					aria-label="Key for sticky modifier"
					placeholder="Key…"
					autocapitalize="none"
					autocomplete="off"
					spellcheck="false"
					class="w-12 px-1.5 py-0.5 rounded bg-neutral-800 border border-amber-500/70 font-mono text-xs text-gray-100 placeholder:text-gray-400"
					on:input={handleModInput}
				/>
			{/if}

			<button
				type="button"
				class="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 font-mono"
				on:mousedown|preventDefault
				on:click={() => emitSequence('\x03', false)}
			>
				Ctrl+C
			</button>

			<button
				type="button"
				class="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 font-mono"
				on:mousedown|preventDefault
				on:click={() => emitSequence('\x04', false)}
			>
				Ctrl+D
			</button>

			<button
				type="button"
				class="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 font-mono"
				on:mousedown|preventDefault
				on:click={() => emitSequence('\x1a', false)}
			>
				Ctrl+Z
			</button>

			<button
				type="button"
				class="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 font-mono"
				on:mousedown|preventDefault
				on:click={() => emitSequence('\x0c', false)}
			>
				Ctrl+L
			</button>

			<span class="mx-0.5 text-neutral-600" aria-hidden="true">|</span>

			<button
				type="button"
				aria-label="Arrow Left"
				class="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 font-mono"
				on:mousedown|preventDefault
				on:click={() => emitSequence('\x1b[D')}
			>
				←
			</button>
			<button
				type="button"
				aria-label="Arrow Down"
				class="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 font-mono"
				on:mousedown|preventDefault
				on:click={() => emitSequence('\x1b[B')}
			>
				↓
			</button>
			<button
				type="button"
				aria-label="Arrow Up"
				class="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 font-mono"
				on:mousedown|preventDefault
				on:click={() => emitSequence('\x1b[A')}
			>
				↑
			</button>
			<button
				type="button"
				aria-label="Arrow Right"
				class="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 font-mono"
				on:mousedown|preventDefault
				on:click={() => emitSequence('\x1b[C')}
			>
				→
			</button>

			<button
				type="button"
				class="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 font-mono"
				on:mousedown|preventDefault
				on:click={() => emitSequence('\x1b[H')}
			>
				Home
			</button>
			<button
				type="button"
				class="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 font-mono"
				on:mousedown|preventDefault
				on:click={() => emitSequence('\x1b[F')}
			>
				End
			</button>
			<button
				type="button"
				class="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 font-mono"
				on:mousedown|preventDefault
				on:click={() => emitSequence('\x1b[5~')}
			>
				PgUp
			</button>
			<button
				type="button"
				class="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 font-mono"
				on:mousedown|preventDefault
				on:click={() => emitSequence('\x1b[6~')}
			>
				PgDn
			</button>

			<button
				type="button"
				data-testid="vkey-fn-toggle"
				aria-pressed={showFnRow}
				class="px-2 py-1 rounded border font-mono {showFnRow
					? 'bg-amber-600/30 border-amber-500 text-amber-200'
					: 'bg-neutral-800 hover:bg-neutral-700 border-neutral-700'}"
				on:mousedown|preventDefault
				on:click={() => {
					showFnRow = !showFnRow;
				}}
			>
				F1–F12
			</button>

			<span class="mx-0.5 text-neutral-600" aria-hidden="true">|</span>

			<button
				type="button"
				class="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
				on:mousedown|preventDefault
				on:click={() => dispatch('copy')}
			>
				Copy
			</button>
			<button
				type="button"
				class="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700"
				title={activeVt === 7 ? 'Paste into X11 display' : 'Paste into terminal'}
				on:mousedown|preventDefault
				on:click={() => dispatch('paste')}
			>
				{activeVt === 7 ? 'X11 Paste' : 'Paste'}
			</button>
		</div>

		{#if showFnRow}
			<div class="flex flex-wrap items-center gap-1" data-testid="virtual-fn-row">
				{#each FUNCTION_KEYS as fk}
					<button
						type="button"
						class="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 font-mono"
						on:mousedown|preventDefault
						on:click={() => emitSequence(fk.seq)}
					>
						{fk.label}
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}
