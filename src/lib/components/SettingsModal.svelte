<script>
	import { createEventDispatcher } from 'svelte';
	import {
		settings,
		resetSettings,
		TERMINAL_THEMES,
		FONT_FAMILY_PRESETS
	} from '$lib/stores/settings.js';

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
			class="fixed inset-0 bg-black/65 cursor-default"
			on:click={close}
		></button>

		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="settings-modal-title"
			data-testid="settings-modal"
			class="relative z-10 w-full max-w-lg rounded-lg bg-neutral-900 border border-neutral-700 shadow-2xl text-gray-100 p-5 max-h-[90vh] overflow-y-auto"
		>
			<div class="flex items-center justify-between pb-3 mb-4 border-b border-neutral-800">
				<h2 id="settings-modal-title" class="text-base font-semibold">Workstation Settings</h2>
				<button
					type="button"
					data-testid="settings-close-btn"
					aria-label="Close settings"
					class="p-1 rounded hover:bg-neutral-800 text-gray-400 hover:text-white"
					on:click={close}
				>
					<svg class="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
						<path
							fill-rule="evenodd"
							d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
							clip-rule="evenodd"
						/>
					</svg>
				</button>
			</div>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
				<div class="flex flex-col gap-1">
					<label for="setting-theme" class="text-xs text-gray-300">Terminal Theme</label>
					<select
						id="setting-theme"
						data-testid="setting-theme"
						value={$settings.theme}
						on:change={(e) => settings.updateSetting('theme', e.currentTarget.value)}
						class="px-2.5 py-1.5 rounded bg-neutral-800 border border-neutral-700 text-gray-100"
					>
						{#each themeEntries as t}
							<option value={t.id}>{t.label}</option>
						{/each}
					</select>
				</div>

				<div class="flex flex-col gap-1">
					<label for="setting-font-size" class="text-xs text-gray-300">
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
						class="px-2.5 py-1.5 rounded bg-neutral-800 border border-neutral-700 text-gray-100"
					/>
				</div>

				<div class="flex flex-col gap-1 sm:col-span-2">
					<label for="setting-font-family" class="text-xs text-gray-300">Font Family</label>
					<select
						id="setting-font-family"
						data-testid="setting-font-family"
						value={$settings.fontFamily}
						on:change={(e) => settings.updateSetting('fontFamily', e.currentTarget.value)}
						class="px-2.5 py-1.5 rounded bg-neutral-800 border border-neutral-700 text-gray-100"
					>
						{#each FONT_FAMILY_PRESETS as preset}
							<option value={preset.value}>{preset.label}</option>
						{/each}
					</select>
				</div>

				<div class="flex flex-col gap-1">
					<label for="setting-scrollback" class="text-xs text-gray-300">Scrollback Lines</label>
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
						class="px-2.5 py-1.5 rounded bg-neutral-800 border border-neutral-700 text-gray-100"
					/>
				</div>

				<div class="flex flex-col gap-1">
					<label for="setting-renderer" class="text-xs text-gray-300">Terminal Renderer</label>
					<select
						id="setting-renderer"
						data-testid="setting-renderer"
						value={$settings.renderer}
						on:change={(e) => settings.updateSetting('renderer', e.currentTarget.value)}
						class="px-2.5 py-1.5 rounded bg-neutral-800 border border-neutral-700 text-gray-100"
					>
						<option value="auto">Auto (WebGL with DOM fallback)</option>
						<option value="webgl">WebGL</option>
						<option value="dom">DOM (Low Memory)</option>
					</select>
				</div>

				<div class="flex flex-col gap-1 sm:col-span-2">
					<label for="setting-display-scale" class="text-xs text-gray-300">
						X11 Display Scale ({$settings.displayScale}x)
					</label>
					<select
						id="setting-display-scale"
						data-testid="setting-display-scale"
						value={String($settings.displayScale)}
						on:change={(e) => settings.updateSetting('displayScale', Number(e.currentTarget.value))}
						class="px-2.5 py-1.5 rounded bg-neutral-800 border border-neutral-700 text-gray-100"
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

			<div class="mt-4 pt-3 border-t border-neutral-800 grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-sm">
				<label class="flex items-center gap-2 cursor-pointer">
					<input
						type="checkbox"
						data-testid="setting-cursor-blink"
						checked={$settings.cursorBlink}
						on:change={(e) => settings.updateSetting('cursorBlink', e.currentTarget.checked)}
					/>
					<span>Cursor Blink</span>
				</label>

				<label class="flex items-center gap-2 cursor-pointer">
					<input
						type="checkbox"
						data-testid="setting-power-saver"
						checked={$settings.powerSaver}
						on:change={(e) => settings.updateSetting('powerSaver', e.currentTarget.checked)}
					/>
					<span>Power Saver Mode</span>
				</label>

				<label class="flex items-center gap-2 cursor-pointer">
					<input
						type="checkbox"
						data-testid="setting-sidebar-pin"
						checked={$settings.sidebarPin}
						on:change={(e) => settings.updateSetting('sidebarPin', e.currentTarget.checked)}
					/>
					<span>Pin Sidebar Open</span>
				</label>

				<label class="flex items-center gap-2 cursor-pointer">
					<input
						type="checkbox"
						data-testid="setting-virtual-keys"
						checked={$settings.virtualKeysVisible}
						on:change={(e) => settings.updateSetting('virtualKeysVisible', e.currentTarget.checked)}
					/>
					<span>Show Virtual Key Bar</span>
				</label>
			</div>

			<div class="mt-5 pt-3 border-t border-neutral-800 flex items-center justify-between">
				<button
					type="button"
					data-testid="settings-reset-btn"
					class="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-xs text-gray-200"
					on:click={() => resetSettings()}
				>
					Reset Defaults
				</button>

				<button
					type="button"
					data-testid="settings-done-btn"
					class="px-4 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-xs font-semibold text-white"
					on:click={close}
				>
					Done
				</button>
			</div>
		</div>
	</div>
{/if}
