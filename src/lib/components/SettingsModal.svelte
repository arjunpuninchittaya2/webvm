<script>
	import { createEventDispatcher } from 'svelte';
	import {
		settings,
		resetSettings,
		TERMINAL_THEMES,
		FONT_FAMILY_PRESETS
	} from '$lib/stores/settings.js';
	import { testBell } from '$lib/audio/bell.js';

	export let open = false;

	const dispatch = createEventDispatcher();
	const themeEntries = Object.values(TERMINAL_THEMES);

	let fontSizeDraft = String($settings.fontSize);
	let scrollbackDraft = String($settings.scrollback);
	let fontSizeFocused = false;
	let scrollbackFocused = false;

	$: if (!fontSizeFocused) {
		fontSizeDraft = String($settings.fontSize);
	}
	$: if (!scrollbackFocused) {
		scrollbackDraft = String($settings.scrollback);
	}

	function commitFontSize() {
		const trimmed = String(fontSizeDraft ?? '').trim();
		const num = Number(trimmed);
		if (trimmed.length === 0 || !Number.isFinite(num)) {
			fontSizeDraft = String($settings.fontSize);
			return;
		}
		settings.updateSetting('fontSize', num);
		fontSizeDraft = String($settings.fontSize);
	}

	function commitScrollback() {
		const trimmed = String(scrollbackDraft ?? '').trim();
		const num = Number(trimmed);
		if (trimmed.length === 0 || !Number.isFinite(num)) {
			scrollbackDraft = String($settings.scrollback);
			return;
		}
		settings.updateSetting('scrollback', num);
		scrollbackDraft = String($settings.scrollback);
	}

	function close() {
		dispatch('close');
	}

	function handleWindowKeydown(e) {
		if (open && e.key === 'Escape') {
			e.preventDefault();
			close();
		}
	}
</script>

<svelte:window on:keydown={handleWindowKeydown} />

{#if open}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
		<button
			type="button"
			tabindex="-1"
			aria-label="Close settings backdrop"
			class="fixed inset-0 bg-black/60 backdrop-blur-sm cursor-default animate-in fade-in-0 duration-150"
			on:click={close}
		></button>

		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="settings-modal-title"
			data-testid="settings-modal"
			class="relative z-10 w-full max-w-lg rounded-2xl border border-white/10 bg-zinc-950/95 p-5 shadow-2xl backdrop-blur-md text-zinc-200 max-h-[90vh] overflow-y-auto scrollbar animate-in zoom-in-95 duration-150"
		>
			<div class="flex items-center justify-between pb-3 mb-4 border-b border-white/10">
				<h2 id="settings-modal-title" class="text-sm font-semibold text-zinc-100">Workstation Settings</h2>
				<button
					type="button"
					data-testid="settings-close-btn"
					aria-label="Close settings"
					class="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
					on:click={close}
				>
					<svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M18 6 6 18" />
						<path d="m6 6 12 12" />
					</svg>
				</button>
			</div>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
				<div class="flex flex-col gap-1.5">
					<label for="setting-theme" class="text-xs font-medium text-zinc-300">Terminal Theme</label>
					<select
						id="setting-theme"
						data-testid="setting-theme"
						value={$settings.theme}
						on:change={(e) => settings.updateSetting('theme', e.currentTarget.value)}
						class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-200 transition-colors focus:border-white/20 focus:outline-none"
					>
						{#each themeEntries as t}
							<option value={t.id}>{t.label}</option>
						{/each}
					</select>
				</div>

				<div class="flex flex-col gap-1.5">
					<label for="setting-font-size" class="text-xs font-medium text-zinc-300">
						Font Size ({$settings.fontSize}px)
					</label>
					<input
						id="setting-font-size"
						data-testid="setting-font-size"
						type="number"
						min="10"
						max="28"
						bind:value={fontSizeDraft}
						on:focus={() => {
							fontSizeFocused = true;
						}}
						on:blur={() => {
							fontSizeFocused = false;
							commitFontSize();
						}}
						on:change={commitFontSize}
						class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-200 transition-colors focus:border-white/20 focus:outline-none"
					/>
				</div>

				<div class="flex flex-col gap-1.5 sm:col-span-2">
					<label for="setting-font-family" class="text-xs font-medium text-zinc-300">Font Family</label>
					<select
						id="setting-font-family"
						data-testid="setting-font-family"
						value={$settings.fontFamily}
						on:change={(e) => settings.updateSetting('fontFamily', e.currentTarget.value)}
						class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-200 transition-colors focus:border-white/20 focus:outline-none"
					>
						{#each FONT_FAMILY_PRESETS as preset}
							<option value={preset.value}>{preset.label}</option>
						{/each}
					</select>
				</div>

				<div class="flex flex-col gap-1.5">
					<label for="setting-scrollback" class="text-xs font-medium text-zinc-300">Scrollback Lines</label>
					<input
						id="setting-scrollback"
						data-testid="setting-scrollback"
						type="number"
						min="200"
						max="20000"
						step="100"
						bind:value={scrollbackDraft}
						on:focus={() => {
							scrollbackFocused = true;
						}}
						on:blur={() => {
							scrollbackFocused = false;
							commitScrollback();
						}}
						on:change={commitScrollback}
						class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-200 transition-colors focus:border-white/20 focus:outline-none"
					/>
				</div>

				<div class="flex flex-col gap-1.5">
					<label for="setting-renderer" class="text-xs font-medium text-zinc-300">Terminal Renderer</label>
					<select
						id="setting-renderer"
						data-testid="setting-renderer"
						value={$settings.renderer}
						on:change={(e) => settings.updateSetting('renderer', e.currentTarget.value)}
						class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-200 transition-colors focus:border-white/20 focus:outline-none"
					>
						<option value="auto">Auto (WebGL with DOM fallback)</option>
						<option value="webgl">WebGL</option>
						<option value="dom">DOM (Low Memory)</option>
					</select>
				</div>

				<div class="flex flex-col gap-1.5 sm:col-span-2">
					<label for="setting-display-scale" class="text-xs font-medium text-zinc-300">
						X11 Display Scale ({$settings.displayScale}x)
					</label>
					<select
						id="setting-display-scale"
						data-testid="setting-display-scale"
						value={String($settings.displayScale)}
						on:change={(e) => settings.updateSetting('displayScale', Number(e.currentTarget.value))}
						class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-200 transition-colors focus:border-white/20 focus:outline-none"
					>
						<option value="0.5">0.5x (Performance)</option>
						<option value="0.75">0.75x</option>
						<option value="1">1x (Native)</option>
						<option value="1.25">1.25x</option>
						<option value="1.5">1.5x</option>
						<option value="2">2x (HiDPI)</option>
					</select>
				</div>
			</div>

			<div class="mt-4 pt-4 border-t border-white/5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
				<label class="flex items-center justify-between gap-3 py-1 cursor-pointer select-none">
					<span class="text-xs text-zinc-200">Cursor Blink</span>
					<span class="relative inline-flex items-center h-5 w-9 shrink-0">
						<input
							type="checkbox"
							data-testid="setting-cursor-blink"
							checked={$settings.cursorBlink}
							on:change={(e) => settings.updateSetting('cursorBlink', e.currentTarget.checked)}
							class="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
						/>
						<span
							class="h-5 w-9 rounded-full border border-white/10 bg-zinc-800 transition-colors peer-checked:bg-white/25 peer-focus-visible:ring-1 peer-focus-visible:ring-white/20"
						></span>
						<span
							class="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition-transform peer-checked:translate-x-4"
						></span>
					</span>
				</label>

				<label class="flex items-center justify-between gap-3 py-1 cursor-pointer select-none">
					<span class="text-xs text-zinc-200">Power Saver Mode</span>
					<span class="relative inline-flex items-center h-5 w-9 shrink-0">
						<input
							type="checkbox"
							data-testid="setting-power-saver"
							checked={$settings.powerSaver}
							on:change={(e) => settings.updateSetting('powerSaver', e.currentTarget.checked)}
							class="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
						/>
						<span
							class="h-5 w-9 rounded-full border border-white/10 bg-zinc-800 transition-colors peer-checked:bg-white/25 peer-focus-visible:ring-1 peer-focus-visible:ring-white/20"
						></span>
						<span
							class="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition-transform peer-checked:translate-x-4"
						></span>
					</span>
				</label>

				<label class="flex items-center justify-between gap-3 py-1 cursor-pointer select-none">
					<span class="text-xs text-zinc-200">Pin Sidebar Open</span>
					<span class="relative inline-flex items-center h-5 w-9 shrink-0">
						<input
							type="checkbox"
							data-testid="setting-sidebar-pin"
							checked={$settings.sidebarPin}
							on:change={(e) => settings.updateSetting('sidebarPin', e.currentTarget.checked)}
							class="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
						/>
						<span
							class="h-5 w-9 rounded-full border border-white/10 bg-zinc-800 transition-colors peer-checked:bg-white/25 peer-focus-visible:ring-1 peer-focus-visible:ring-white/20"
						></span>
						<span
							class="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition-transform peer-checked:translate-x-4"
						></span>
					</span>
				</label>

				<label class="flex items-center justify-between gap-3 py-1 cursor-pointer select-none">
					<span class="text-xs text-zinc-200">Show Virtual Key Bar</span>
					<span class="relative inline-flex items-center h-5 w-9 shrink-0">
						<input
							type="checkbox"
							data-testid="setting-virtual-keys"
							checked={$settings.virtualKeysVisible}
							on:change={(e) => settings.updateSetting('virtualKeysVisible', e.currentTarget.checked)}
							class="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
						/>
						<span
							class="h-5 w-9 rounded-full border border-white/10 bg-zinc-800 transition-colors peer-checked:bg-white/25 peer-focus-visible:ring-1 peer-focus-visible:ring-white/20"
						></span>
						<span
							class="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition-transform peer-checked:translate-x-4"
						></span>
					</span>
				</label>

				<label class="flex items-center justify-between gap-3 py-1 cursor-pointer select-none">
					<span class="text-xs text-zinc-200">Audio terminal bell</span>
					<span class="relative inline-flex items-center h-5 w-9 shrink-0">
						<input
							type="checkbox"
							data-testid="setting-audio-bell"
							checked={$settings.audioBell}
							on:change={(e) => settings.updateSetting('audioBell', e.currentTarget.checked)}
							class="peer absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
						/>
						<span
							class="h-5 w-9 rounded-full border border-white/10 bg-zinc-800 transition-colors peer-checked:bg-white/25 peer-focus-visible:ring-1 peer-focus-visible:ring-white/20"
						></span>
						<span
							class="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition-transform peer-checked:translate-x-4"
						></span>
					</span>
				</label>

				<button
					type="button"
					data-testid="setting-test-bell"
					class="h-8 px-3 rounded-lg border border-white/10 bg-transparent hover:bg-white/5 text-xs font-medium text-zinc-200 transition-all active:scale-[0.97] justify-self-start self-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
					on:click={() => testBell()}
				>
					Test bell
				</button>
			</div>

			<div class="mt-5 pt-4 border-t border-white/5 flex items-center justify-between">
				<button
					type="button"
					data-testid="settings-reset-btn"
					class="h-8 px-3 rounded-lg border border-white/10 bg-transparent hover:bg-white/5 text-xs font-medium text-zinc-300 hover:text-white transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
					on:click={() => resetSettings()}
				>
					Reset Defaults
				</button>

				<button
					type="button"
					data-testid="settings-done-btn"
					class="h-8 px-4 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs text-xs font-medium transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
					on:click={close}
				>
					Done
				</button>
			</div>
		</div>
	</div>
{/if}
