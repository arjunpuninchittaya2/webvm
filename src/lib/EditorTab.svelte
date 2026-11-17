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

<div class="flex flex-col gap-2 text-xs text-gray-100" data-testid="editor-tab">
	<div class="flex items-center justify-between">
		<h1 class="text-base font-bold flex items-center gap-1.5">
			<i class="fas fa-code text-sky-400" aria-hidden="true"></i>
			<span>Editor</span>
			{#if dirty}<span class="text-amber-400" title="Unsaved changes">*</span>{/if}
		</h1>
		<div class="flex items-center gap-1">
			<button
				type="button"
				class="px-1.5 py-0.5 rounded bg-neutral-700 hover:bg-neutral-500 text-gray-200"
				data-testid="editor-new-btn"
				on:click={handleNew}
			>
				<i class="fas fa-plus mr-0.5" aria-hidden="true"></i>New
			</button>
			<button
				type="button"
				class="px-1.5 py-0.5 rounded bg-neutral-700 hover:bg-neutral-500 text-gray-200"
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

	<div class="flex items-center gap-1">
		<input
			type="text"
			placeholder="File path or filename (e.g. runme.sh)"
			aria-label="Editor file path"
			data-testid="editor-path-input"
			bind:value={filePath}
			on:input={handlePathInput}
			class="flex-1 min-w-0 bg-neutral-700 border border-neutral-500 rounded px-2 py-1 text-xs font-mono text-gray-100 placeholder-gray-400"
		/>
		<button
			type="button"
			aria-label="Open file"
			data-testid="editor-open-btn"
			class="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-500 text-gray-100 shrink-0"
			on:click={handleOpen}
		>
			Open
		</button>
	</div>

	{#if statusError}
		<div class="p-1.5 rounded bg-red-900/70 border border-red-600 text-red-100 text-[11px]" role="alert">
			{statusError}
		</div>
	{/if}
	{#if statusMessage}
		<div class="p-1.5 rounded bg-emerald-900/50 border border-emerald-600 text-emerald-100 text-[11px]" role="status">
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
		class="w-full {expanded ? 'h-96' : 'h-56'} bg-neutral-800 border border-neutral-500 rounded p-2 font-mono text-xs text-gray-100 resize-y focus:outline-none focus:border-sky-400 disabled:opacity-50"
	></textarea>

	<div class="flex items-center justify-between text-[10px] text-gray-400" data-testid="editor-status">
		<span>Lines: {lineCount}</span>
		<span>{byteCount} B</span>
	</div>

	<div class="flex flex-wrap items-center gap-1">
		<button
			type="button"
			data-testid="editor-save-btn"
			class="flex-1 px-2 py-1.5 rounded bg-sky-700 hover:bg-sky-600 text-white font-medium flex items-center justify-center gap-1"
			on:click={handleSave}
		>
			<i class="fas fa-floppy-disk" aria-hidden="true"></i>
			<span>Save</span>
		</button>
		<button
			type="button"
			data-testid="editor-run-btn"
			class="flex-1 px-2 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-medium flex items-center justify-center gap-1"
			on:click={handleRunInTerminal}
		>
			<i class="fas fa-play" aria-hidden="true"></i>
			<span>Run in Terminal</span>
		</button>
		<button
			type="button"
			data-testid="editor-download-btn"
			class="px-2 py-1.5 rounded bg-neutral-700 hover:bg-neutral-500 text-gray-100 flex items-center justify-center"
			aria-label="Download file"
			on:click={handleDownload}
		>
			<i class="fas fa-download" aria-hidden="true"></i>
		</button>
	</div>
</div>
