<script>
	import { createEventDispatcher, onMount } from 'svelte';
	import {
		workspaceEntries,
		ensureWorkspaceHydrated,
		listWorkspaceEntries,
		createWorkspaceDir,
		renameWorkspaceEntry,
		deleteWorkspaceEntry,
		setWorkspaceExecutable,
		importHostFiles,
		exportVmFile,
		exportWorkspaceSnapshot,
		importWorkspaceSnapshot,
		resetWorkspace,
		executeWorkspaceFile,
		validateEntryName
	} from './fs/fileBridge.js';
	import { addToast } from './stores/sessions.js';

	export let vmManager = null;
	export let fileBridge = null;
	$: void fileBridge;

	const dispatch = createEventDispatcher();

	let selectedMount = '/home/user/workspace';
	let currentDir = '';
	let mkdirName = '';
	let renamingPath = null;
	let renameValue = '';
	let statusMessage = '';
	let statusError = '';
	let uploadInput = null;
	let snapshotInput = null;

	onMount(() => {
		ensureWorkspaceHydrated();
	});

	$: visibleEntries = computeVisibleEntries($workspaceEntries, currentDir, selectedMount);

	function computeVisibleEntries(entries, dir, mount) {
		if (mount !== '/home/user/workspace') {
			return [];
		}
		if (!dir) {
			// At root, show directories first, then files (including extracted nested files with path badge)
			return [...entries].sort((a, b) => {
				if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
				return a.path.localeCompare(b.path);
			});
		}
		return listWorkspaceEntries(dir, { recursive: false });
	}

	function formatSize(bytes) {
		if (!bytes) return '0 B';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	async function handleUploadChange(e) {
		const files = e.target?.files;
		if (!files || files.length === 0) return;
		statusError = '';
		statusMessage = '';
		const res = await importHostFiles(files, currentDir, { vmManager });
		if (e.target) e.target.value = '';
		if (res.errors.length > 0) {
			statusError = res.errors[0];
			addToast({ message: res.errors[0], type: 'error' });
		}
		if (res.imported.length > 0) {
			const msg =
				res.extractedArchives.length > 0
					? `Extracted ${res.extractedArchives.join(', ')} (${res.imported.length} items)`
					: `Uploaded ${res.imported.length} file(s) to workspace`;
			statusMessage = msg;
			addToast({ message: msg, type: 'success' });
		}
	}

	async function handleMkdir() {
		statusError = '';
		statusMessage = '';
		const check = validateEntryName(mkdirName);
		if (!check.valid) {
			statusError = check.error;
			mkdirName = '';
			return;
		}
		const targetPath = currentDir ? `${currentDir}/${check.name}` : check.name;
		try {
			await createWorkspaceDir(targetPath, { vmManager });
			mkdirName = '';
			statusMessage = 'Folder created';
		} catch (err) {
			mkdirName = '';
			statusError = err?.message || 'Invalid folder name';
		}
	}

	function goUp() {
		statusError = '';
		if (!currentDir) return;
		const idx = currentDir.lastIndexOf('/');
		currentDir = idx === -1 ? '' : currentDir.slice(0, idx);
	}

	function enterDir(entry) {
		statusError = '';
		currentDir = entry.path;
	}

	function startRename(entry) {
		statusError = '';
		renamingPath = entry.path;
		renameValue = entry.name;
	}

	async function commitRename(entry) {
		if (!renamingPath) return;
		statusError = '';
		const check = validateEntryName(renameValue);
		if (!check.valid) {
			statusError = check.error;
			renameValue = '';
			renamingPath = null;
			return;
		}
		try {
			await renameWorkspaceEntry(entry.path, check.name);
			renamingPath = null;
			renameValue = '';
			statusMessage = 'Entry renamed';
		} catch (err) {
			statusError = err?.message || 'Rename failed';
			renamingPath = null;
		}
	}

	function handleRenameKeydown(e, entry) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitRename(entry);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			renamingPath = null;
			renameValue = '';
		}
	}

	async function handleDelete(entry) {
		statusError = '';
		statusMessage = '';
		await deleteWorkspaceEntry(entry.path);
		if (currentDir && (currentDir === entry.path || currentDir.startsWith(entry.path + '/'))) {
			currentDir = '';
		}
		if (renamingPath && (renamingPath === entry.path || renamingPath.startsWith(entry.path + '/'))) {
			renamingPath = null;
			renameValue = '';
		}
		// Never echo deleted filename in status or toast
		statusMessage = 'Item deleted';
		addToast({ message: 'Item deleted', type: 'info' });
	}

	async function handleDownload(entry) {
		statusError = '';
		try {
			await exportVmFile(entry.path, { vmManager });
			addToast({ message: `Downloaded ${entry.name}`, type: 'success' });
		} catch (err) {
			statusError = err?.message || 'Download failed';
			addToast({ message: statusError, type: 'error' });
		}
	}

	async function handleToggleExec(entry) {
		statusError = '';
		const updated = await setWorkspaceExecutable(entry.path, !entry.executable, { vmManager });
		if (updated) {
			statusMessage = updated.executable ? 'Marked executable (chmod +x)' : 'Removed executable bit';
		}
	}

	async function handleRunEntry(entry) {
		statusError = '';
		statusMessage = '';
		const res = await executeWorkspaceFile(entry.path, { vmManager });
		if (!res.ok) {
			statusError = res.error;
			addToast({ message: res.error, type: 'error' });
			return;
		}
		statusMessage = `Running ${entry.name} in terminal`;
		addToast({ message: statusMessage, type: 'info' });
	}

	function openInEditor(entry) {
		dispatch('openInEditor', entry);
	}

	function handleExportSnapshot() {
		statusError = '';
		exportWorkspaceSnapshot({ download: true });
		statusMessage = 'Workspace snapshot exported';
		addToast({ message: 'Workspace snapshot exported', type: 'success' });
	}

	async function handleImportSnapshotChange(e) {
		const file = e.target?.files?.[0];
		if (!file) return;
		statusError = '';
		statusMessage = '';
		try {
			const res = await importWorkspaceSnapshot(file, { vmManager });
			statusMessage = `Imported ${res.importedCount} workspace entries`;
			addToast({ message: statusMessage, type: 'success' });
		} catch (err) {
			statusError = err?.message || 'Invalid snapshot: file is corrupted or failed to import';
			addToast({ message: statusError, type: 'error' });
		} finally {
			if (e.target) e.target.value = '';
		}
	}

	async function handleResetWorkspace() {
		statusError = '';
		statusMessage = '';
		await resetWorkspace({ vmManager });
		currentDir = '';
		statusMessage = 'Workspace reset complete';
		addToast({ message: 'Workspace reset complete', type: 'info' });
	}
</script>

<div class="flex flex-col gap-2.5 text-xs text-zinc-200" data-testid="files-tab">
	<div class="flex items-center justify-between pr-8">
		<h1 class="text-sm font-semibold text-zinc-100 flex items-center gap-2">
			<i class="fas fa-folder-open text-zinc-400 text-xs" aria-hidden="true"></i>
			<span>Files</span>
		</h1>
		<button
			type="button"
			class="h-7 w-7 inline-flex items-center justify-center rounded-lg border border-white/10 bg-zinc-900/60 hover:bg-white/5 hover:border-white/20 text-zinc-400 hover:text-white transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
			aria-label="Refresh files"
			title="Refresh files"
			data-testid="files-refresh-btn"
			on:click={() => ensureWorkspaceHydrated()}
		>
			<i class="fas fa-rotate-right text-xs" aria-hidden="true"></i>
		</button>
	</div>

	<div class="flex items-center gap-1">
		<select
			class="w-full rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-200 transition-colors focus:border-white/20 focus:outline-none"
			aria-label="Mount point"
			data-testid="files-mount-select"
			bind:value={selectedMount}
			on:change={() => {
				currentDir = '';
			}}
		>
			<option value="/home/user/workspace">/home/user/workspace (Persistent)</option>
			<option value="/data">/data (Host Bridge)</option>
			<option value="/home/user/documents">/home/user/documents</option>
			<option value="/web">/web</option>
		</select>
	</div>

	<div class="flex items-center gap-2 rounded-xl border border-white/10 bg-zinc-900/60 px-2.5 py-1.5">
		<button
			type="button"
			class="h-6 px-2 rounded-lg border border-white/10 bg-transparent hover:bg-white/5 text-zinc-300 hover:text-white text-[11px] font-medium shrink-0 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
			aria-label="Up to parent directory (..)"
			data-testid="parent-dir-btn"
			on:click={goUp}
		>
			<i class="fas fa-arrow-up text-[10px] mr-1" aria-hidden="true"></i>..
		</button>
		<span class="font-mono text-[11px] text-zinc-300 break-all min-w-0" data-testid="files-current-path">
			{selectedMount}{currentDir ? `/${currentDir}` : ''}
		</span>
	</div>

	<!-- Primary Upload Input MUST be first <input type="file"> in DOM -->
	<div class="flex items-center gap-1">
		<input
			bind:this={uploadInput}
			type="file"
			multiple
			data-testid="files-upload-input"
			aria-label="Upload files to workspace"
			class="hidden"
			on:change={handleUploadChange}
		/>
		<button
			type="button"
			class="flex-1 h-8 px-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs text-xs font-medium flex items-center justify-center gap-1.5 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
			data-testid="files-upload-btn"
			on:click={() => uploadInput?.click()}
		>
			<i class="fas fa-upload text-xs" aria-hidden="true"></i>
			<span>Upload Files / Archives</span>
		</button>
	</div>

	<form class="flex items-center gap-1.5" on:submit|preventDefault={handleMkdir}>
		<input
			type="text"
			placeholder="New folder name..."
			aria-label="New folder name"
			data-testid="mkdir-input"
			bind:value={mkdirName}
			class="flex-1 min-w-0 rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-white/20 focus:outline-none"
		/>
		<button
			type="submit"
			aria-label="Create folder (mkdir)"
			data-testid="mkdir-btn"
			class="h-8 px-2.5 rounded-lg border border-white/10 bg-transparent hover:bg-white/5 text-zinc-200 text-xs font-medium shrink-0 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
		>
			<i class="fas fa-folder-plus text-[11px] mr-1" aria-hidden="true"></i>New Folder
		</button>
	</form>

	{#if statusError}
		<div class="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[11px] leading-relaxed text-rose-300" role="alert">
			{statusError}
		</div>
	{/if}
	{#if statusMessage}
		<div class="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] leading-relaxed text-emerald-300" role="status">
			{statusMessage}
		</div>
	{/if}

	{#if selectedMount !== '/home/user/workspace'}
		<p class="text-[11px] leading-relaxed text-zinc-300 rounded-xl border border-white/10 bg-white/5 p-2.5">
			Mount <code class="font-mono text-[10px] text-zinc-200 break-all">{selectedMount}</code> is managed inside the running Linux VM. Switch to <code class="font-mono text-[10px] text-zinc-200 break-all">/home/user/workspace</code> to upload, edit, and persist host files.
		</p>
	{:else}
		<ul class="flex flex-col gap-1.5 max-h-60 overflow-y-auto scrollbar" data-testid="files-list">
			{#if visibleEntries.length === 0}
				<li class="rounded-xl border border-white/5 bg-zinc-900/40 px-3 py-3 text-[11px] text-zinc-400 text-center">Workspace is empty. Upload or drop files onto the terminal.</li>
			{:else}
				{#each visibleEntries as entry (entry.path)}
					<li
						data-file-entry={entry.path}
						data-testid="file-entry-{entry.name}"
						class="flex flex-col gap-1.5 p-2 rounded-xl border border-white/10 bg-zinc-900/60"
					>
						<div class="flex items-center justify-between gap-1.5">
							{#if renamingPath === entry.path}
								<input
									type="text"
									placeholder="Rename file..."
									aria-label="Rename entry"
									data-testid="file-rename-input"
									bind:value={renameValue}
									on:keydown={(e) => handleRenameKeydown(e, entry)}
									class="flex-1 min-w-0 rounded-lg border border-white/20 bg-zinc-950/60 px-2 py-1 text-xs text-zinc-100 focus:outline-none"
								/>
								<button
									type="button"
									class="h-6 px-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 text-[11px] font-medium transition-all active:scale-[0.97]"
									on:click={() => commitRename(entry)}
								>
									Save
								</button>
							{:else}
								<div class="flex items-center gap-1.5 min-w-0 flex-1">
									<i
										class="fas {entry.type === 'dir' ? 'fa-folder text-zinc-300' : 'fa-file-code text-zinc-400'} shrink-0 text-xs"
										aria-hidden="true"
									></i>
									{#if entry.type === 'dir'}
										<button
											type="button"
											class="truncate text-left font-medium text-xs text-zinc-100 hover:text-white hover:underline"
											on:click={() => enterDir(entry)}
										>
											{entry.name}
										</button>
									{:else}
										<button
											type="button"
											class="truncate text-left font-medium text-xs text-zinc-200 hover:text-white hover:underline"
											on:click={() => openInEditor(entry)}
										>
											{entry.name}
										</button>
									{/if}
									{#if entry.parentDir && !currentDir}
										<span class="font-mono text-[10px] text-zinc-500 truncate">({entry.parentDir}/)</span>
									{/if}
								</div>
								<div class="flex items-center gap-1.5 shrink-0 text-[10px]">
									{#if entry.type === 'file' && entry.executable}
										<span class="px-1.5 py-0.5 rounded border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 font-mono text-[10px]" title="chmod +x executable">
											+x
										</span>
									{/if}
									{#if entry.type === 'file'}
										<span class="font-mono text-[10px] text-zinc-400">{formatSize(entry.size)}</span>
									{/if}
								</div>
							{/if}
						</div>

						<div class="flex flex-wrap items-center gap-1">
							{#if entry.type === 'file'}
								<button
									type="button"
									class="h-6 px-2 rounded-lg border border-white/10 bg-transparent hover:bg-white/5 text-[11px] font-medium text-zinc-300 hover:text-white transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
									aria-label="Edit {entry.name}"
									data-testid="file-edit-{entry.name}"
									on:click={() => openInEditor(entry)}
								>
									Edit
								</button>
								<button
									type="button"
									class="h-6 px-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 hover:bg-emerald-500/20 text-[11px] font-medium text-emerald-300 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
									aria-label="Run {entry.name}"
									data-testid="file-run-{entry.name}"
									on:click={() => handleRunEntry(entry)}
								>
									<i class="fas fa-play text-[10px] mr-1" aria-hidden="true"></i>Run
								</button>
								<button
									type="button"
									class="h-6 px-2 rounded-lg border border-white/10 bg-transparent hover:bg-white/5 text-[11px] font-medium text-zinc-300 hover:text-white transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
									aria-label="Toggle executable {entry.name}"
									data-testid="file-chmod-{entry.name}"
									on:click={() => handleToggleExec(entry)}
								>
									chmod +x
								</button>
								<button
									type="button"
									class="h-6 px-2 rounded-lg border border-white/10 bg-transparent hover:bg-white/5 text-[11px] font-medium text-zinc-300 hover:text-white transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
									aria-label="Download {entry.name}"
									data-testid="file-download-{entry.name}"
									on:click={() => handleDownload(entry)}
								>
									<i class="fas fa-download text-[10px] mr-1" aria-hidden="true"></i>Download
								</button>
							{/if}
							<button
								type="button"
								class="h-6 px-2 rounded-lg border border-white/10 bg-transparent hover:bg-white/5 text-[11px] font-medium text-zinc-300 hover:text-white transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
								aria-label="Rename {entry.name}"
								data-testid="file-rename-{entry.name}"
								on:click={() => startRename(entry)}
							>
								<i class="fas fa-pen text-[10px] mr-1" aria-hidden="true"></i>Rename
							</button>
							<button
								type="button"
								class="h-6 px-2 rounded-lg border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 text-[11px] font-medium text-rose-300 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
								aria-label="Delete {entry.name}"
								data-testid="file-delete-{entry.name}"
								on:click={() => handleDelete(entry)}
							>
								<i class="fas fa-trash-can text-[10px] mr-1" aria-hidden="true"></i>Delete
							</button>
						</div>
					</li>
				{/each}
			{/if}
		</ul>
	{/if}

	<div class="pt-3 border-t border-white/5 flex flex-col gap-2">
		<span class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Workspace Snapshots</span>
		<div class="flex items-center gap-1.5">
			<button
				type="button"
				class="flex-1 h-8 px-2.5 rounded-lg border border-white/10 bg-transparent hover:bg-white/5 text-xs font-medium text-zinc-200 flex items-center justify-center gap-1.5 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
				data-testid="export-snapshot-btn"
				on:click={handleExportSnapshot}
			>
				<i class="fas fa-file-export text-[11px]" aria-hidden="true"></i>
				<span>Export Snapshot</span>
			</button>
			<button
				type="button"
				class="flex-1 h-8 px-2.5 rounded-lg border border-white/10 bg-transparent hover:bg-white/5 text-xs font-medium text-zinc-200 flex items-center justify-center gap-1.5 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
				data-testid="import-snapshot-btn"
				on:click={() => snapshotInput?.click()}
			>
				<i class="fas fa-file-import text-[11px]" aria-hidden="true"></i>
				<span>Import Snapshot</span>
			</button>
			<input
				bind:this={snapshotInput}
				type="file"
				accept=".json,application/json"
				aria-label="Import snapshot JSON"
				data-testid="import-snapshot-input"
				class="hidden"
				on:change={handleImportSnapshotChange}
			/>
		</div>
		<button
			type="button"
			class="w-full h-8 px-3 rounded-lg border border-rose-500/20 bg-rose-500/10 hover:bg-rose-500/20 text-xs font-medium text-rose-300 flex items-center justify-center gap-1.5 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
			data-testid="workspace-reset-btn"
			on:click={handleResetWorkspace}
		>
			<i class="fas fa-broom text-[11px]" aria-hidden="true"></i>
			<span>Reset Workspace</span>
		</button>
	</div>
</div>
