<script>
	import {
		ensureWorkspaceHydrated,
		normalizeWorkspacePath,
		readWorkspaceFileText,
		writeWorkspaceFile,
		exportVmFile,
		executeWorkspaceFile
	} from './fs/fileBridge.js';
	import { addToast } from './stores/sessions.js';

	export let vmManager = null;
	export let fileBridge = null;
	export let initialFile = null;
	$: void fileBridge;

	let filePath = 'script.sh';
	let content = '';
	let dirty = false;
	let binaryBlocked = false;
	let expanded = false;
	let statusMessage = '';
	let statusError = '';
	let lastLoadedInitialPath = null;

	$: if (initialFile && initialFile.path && initialFile.path !== lastLoadedInitialPath) {
		lastLoadedInitialPath = initialFile.path;
		filePath = initialFile.path;
		loadFile(initialFile.path);
	}

	function loadFile(rawPath, { quietIfMissing = false } = {}) {
		statusError = '';
		statusMessage = '';
		binaryBlocked = false;
		let norm = '';
		try {
			norm = normalizeWorkspacePath(rawPath);
		} catch (err) {
			if (!quietIfMissing) statusError = err?.message || 'Invalid path';
			return false;
		}
		if (!norm) {
			if (!quietIfMissing) statusError = 'Please enter a file path';
			return false;
		}

		const res = readWorkspaceFileText(norm);
		if (!res) {
			if (!quietIfMissing) statusError = 'File not found in workspace';
			return false;
		}

		if (res.isBinary) {
			binaryBlocked = true;
			content = '';
			dirty = false;
			statusError = 'Binary or non-text file detected — cannot edit binary content directly';
			return false;
		}

		content = res.text;
		dirty = false;
		statusMessage = `Loaded ${norm}`;
		return true;
	}

	async function handleOpen() {
		await ensureWorkspaceHydrated();
		loadFile(filePath, { quietIfMissing: false });
	}

	function handlePathInput() {
		// Auto-load seamlessly if typed path matches an existing workspace file
		loadFile(filePath, { quietIfMissing: true });
	}

	function handleNew() {
		filePath = 'untitled.sh';
		content = '#!/bin/sh\necho "Hello from WebVM"\n';
		dirty = true;
		binaryBlocked = false;
		statusError = '';
		statusMessage = '';
	}

	async function handleSave() {
		statusError = '';
		statusMessage = '';
		if (binaryBlocked) {
			statusError = 'Binary or non-text file detected — cannot edit binary content directly';
			return null;
		}
		try {
			const entry = await writeWorkspaceFile(filePath, content, { vmManager });
			dirty = false;
			statusMessage = `Saved ${entry.path}`;
			addToast({ message: `Saved /home/user/workspace/${entry.path}`, type: 'success' });
			return entry;
		} catch (err) {
			statusError = err?.message || 'Failed to save file';
			addToast({ message: statusError, type: 'error' });
			return null;
		}
	}

	async function handleRunInTerminal() {
		statusError = '';
		statusMessage = '';
		if (binaryBlocked) {
			statusError = 'Binary or non-text file detected — cannot edit binary content directly';
			return;
		}
		const saved = await handleSave();
		if (!saved) return;

		const res = await executeWorkspaceFile(saved.path, { vmManager });
		if (!res.ok) {
			statusError = res.error;
			addToast({ message: res.error, type: 'error' });
			return;
		}
		statusMessage = `Launched ${saved.name} — running in terminal`;
		addToast({ message: statusMessage, type: 'info' });
	}

	async function handleDownload() {
		statusError = '';
		const saved = await handleSave();
		if (!saved) return;
		try {
			await exportVmFile(saved.path, { vmManager });
			addToast({ message: `Downloaded ${saved.name}`, type: 'success' });
		} catch (err) {
			statusError = err?.message || 'Download failed';
		}
	}

	function handleEditorKeydown(e) {
		if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
			e.preventDefault();
			handleSave();
			return;
		}
		if (e.key === 'Tab') {
			e.preventDefault();
			const el = e.target;
			const start = el.selectionStart ?? 0;
			const end = el.selectionEnd ?? 0;
			content = content.slice(0, start) + '  ' + content.slice(end);
			dirty = true;
			requestAnimationFrame(() => {
				el.selectionStart = el.selectionEnd = start + 2;
			});
		}
	}

	$: lineCount = content ? content.split('\n').length : 1;
	$: byteCount = new TextEncoder().encode(content || '').length;
</script>

<div class="flex flex-col gap-2.5 text-xs text-zinc-200" data-testid="editor-tab">
	<div class="flex items-center justify-between pr-8">
		<h1 class="text-sm font-semibold text-zinc-100 flex items-center gap-2">
			<i class="fas fa-code text-zinc-400 text-xs" aria-hidden="true"></i>
			<span>Editor</span>
			{#if dirty}<span class="text-amber-400" title="Unsaved changes">*</span>{/if}
		</h1>
		<div class="flex items-center gap-1">
			<button
				type="button"
				class="h-7 px-2 rounded-lg border border-white/10 bg-transparent hover:bg-white/5 text-[11px] font-medium text-zinc-300 hover:text-white transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
				data-testid="editor-new-btn"
				on:click={handleNew}
			>
				<i class="fas fa-plus text-[10px] mr-1" aria-hidden="true"></i>New
			</button>
			<button
				type="button"
				class="h-7 px-2 rounded-lg border border-white/10 bg-transparent hover:bg-white/5 text-[11px] font-medium text-zinc-300 hover:text-white transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
				data-testid="editor-expand-btn"
				aria-label={expanded ? 'Collapse editor' : 'Expand editor'}
				on:click={() => {
					expanded = !expanded;
				}}
			>
				{expanded ? 'Compact' : 'Expand'}
			</button>
		</div>
	</div>

	<div class="flex items-center gap-1.5">
		<input
			type="text"
			placeholder="File path or filename (e.g. runme.sh)"
			aria-label="Editor file path"
			data-testid="editor-path-input"
			bind:value={filePath}
			on:input={handlePathInput}
			class="flex-1 min-w-0 rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs font-mono text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-white/20 focus:outline-none"
		/>
		<button
			type="button"
			aria-label="Open file"
			data-testid="editor-open-btn"
			class="h-8 px-3 rounded-lg border border-white/10 bg-transparent hover:bg-white/5 text-xs font-medium text-zinc-200 shrink-0 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
			on:click={handleOpen}
		>
			Open
		</button>
	</div>

	{#if statusError}
		<div class="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-300" role="alert">
			{statusError}
		</div>
	{/if}
	{#if statusMessage}
		<div class="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] leading-relaxed text-emerald-300 break-all" role="status">
			{statusMessage}
		</div>
	{/if}

	<textarea
		aria-label="Code editor"
		data-testid="code-editor"
		bind:value={content}
		disabled={binaryBlocked}
		on:input={() => {
			dirty = true;
		}}
		on:keydown={handleEditorKeydown}
		spellcheck="false"
		placeholder="#!/bin/sh&#10;echo 'Hello WebVM'"
		class="w-full {expanded ? 'h-96' : 'h-56'} rounded-xl border border-white/10 bg-zinc-950/60 p-3 font-mono text-xs text-zinc-200 placeholder:text-zinc-500 resize-y scrollbar transition-colors focus:border-white/20 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
	></textarea>

	<div class="flex items-center justify-between text-[10px] font-mono text-zinc-400 px-0.5" data-testid="editor-status">
		<span>Lines: {lineCount}</span>
		<span>{byteCount} B</span>
	</div>

	<div class="flex flex-wrap items-center gap-1.5">
		<button
			type="button"
			data-testid="editor-save-btn"
			class="flex-1 h-8 px-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs text-xs font-medium flex items-center justify-center gap-1.5 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
			on:click={handleSave}
		>
			<i class="fas fa-floppy-disk text-xs" aria-hidden="true"></i>
			<span>Save</span>
		</button>
		<button
			type="button"
			data-testid="editor-run-btn"
			class="flex-1 h-8 px-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-xs font-medium flex items-center justify-center gap-1.5 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
			on:click={handleRunInTerminal}
		>
			<i class="fas fa-play text-[10px]" aria-hidden="true"></i>
			<span>Run in Terminal</span>
		</button>
		<button
			type="button"
			data-testid="editor-download-btn"
			class="h-8 w-8 rounded-lg border border-white/10 bg-transparent hover:bg-white/5 text-zinc-300 hover:text-white flex items-center justify-center shrink-0 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
			aria-label="Download file"
			title="Download file"
			on:click={handleDownload}
		>
			<i class="fas fa-download text-xs" aria-hidden="true"></i>
		</button>
	</div>
</div>
