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

<div class="flex flex-col gap-2 text-xs text-gray-100" data-testid="files-tab">
	<div class="flex items-center justify-between">
		<h1 class="text-base font-bold flex items-center gap-1.5">
			<i class="fas fa-folder-open text-amber-400" aria-hidden="true"></i>
			<span>Files</span>
		</h1>
		<button
			type="button"
			class="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-500 text-gray-200"
			aria-label="Refresh files"
			data-testid="files-refresh-btn"
			on:click={() => ensureWorkspaceHydrated()}
		>
			<i class="fas fa-rotate-right" aria-hidden="true"></i>
		</button>
	</div>

	<div class="flex items-center gap-1">
		<select
			class="flex-1 bg-neutral-700 border border-neutral-500 rounded px-1.5 py-1 text-xs text-gray-100"
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

	<div class="flex items-center gap-1 bg-neutral-700/70 rounded px-2 py-1">
		<button
			type="button"
			class="px-1.5 py-0.5 rounded bg-neutral-600 hover:bg-neutral-500 text-gray-200 shrink-0"
			aria-label="Up to parent directory (..)"
			data-testid="parent-dir-btn"
			on:click={goUp}
		>
			<i class="fas fa-arrow-up mr-1" aria-hidden="true"></i>..
		</button>
		<span class="truncate font-mono text-[11px] text-gray-300" data-testid="files-current-path">
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
			class="flex-1 px-2 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white font-medium flex items-center justify-center gap-1"
			data-testid="files-upload-btn"
			on:click={() => uploadInput?.click()}
		>
			<i class="fas fa-upload" aria-hidden="true"></i>
			<span>Upload Files / Archives</span>
		</button>
	</div>

	<form class="flex items-center gap-1" on:submit|preventDefault={handleMkdir}>
		<input
			type="text"
			placeholder="New folder name..."
			aria-label="New folder name"
			data-testid="mkdir-input"
			bind:value={mkdirName}
			class="flex-1 min-w-0 bg-neutral-700 border border-neutral-500 rounded px-2 py-1 text-xs text-gray-100 placeholder-gray-400"
		/>
		<button
			type="submit"
			aria-label="Create folder (mkdir)"
			data-testid="mkdir-btn"
			class="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-500 text-gray-100 shrink-0"
		>
			<i class="fas fa-folder-plus mr-1" aria-hidden="true"></i>New Folder
		</button>
	</form>

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

	{#if selectedMount !== '/home/user/workspace'}
		<p class="text-[11px] text-gray-300 bg-neutral-700/50 p-2 rounded">
			Mount <code>{selectedMount}</code> is managed inside the running Linux VM. Switch to <code>/home/user/workspace</code> to upload, edit, and persist host files.
		</p>
	{:else}
		<ul class="flex flex-col gap-1 max-h-60 overflow-y-auto scrollbar" data-testid="files-list">
			{#if visibleEntries.length === 0}
				<li class="text-gray-400 italic py-2 text-center">Workspace is empty. Upload or drop files onto the terminal.</li>
			{:else}
				{#each visibleEntries as entry (entry.path)}
					<li
						data-file-entry={entry.path}
						data-testid="file-entry-{entry.name}"
						class="flex flex-col gap-1 p-1.5 rounded bg-neutral-700/80 border border-neutral-600"
					>
						<div class="flex items-center justify-between gap-1">
							{#if renamingPath === entry.path}
								<input
									type="text"
									placeholder="Rename file..."
									aria-label="Rename entry"
									data-testid="file-rename-input"
									bind:value={renameValue}
									on:keydown={(e) => handleRenameKeydown(e, entry)}
									class="flex-1 min-w-0 bg-neutral-800 border border-amber-400 rounded px-1.5 py-0.5 text-xs text-white"
								/>
								<button
									type="button"
									class="px-1.5 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white"
									on:click={() => commitRename(entry)}
								>
									Save
								</button>
							{:else}
								<div class="flex items-center gap-1.5 min-w-0 flex-1">
									<i
										class="fas {entry.type === 'dir' ? 'fa-folder text-amber-400' : 'fa-file-code text-sky-300'} shrink-0"
										aria-hidden="true"
									></i>
									{#if entry.type === 'dir'}
										<button
											type="button"
											class="truncate text-left font-medium hover:underline text-amber-200"
											on:click={() => enterDir(entry)}
										>
											{entry.name}
										</button>
									{:else}
										<button
											type="button"
											class="truncate text-left font-medium hover:underline text-gray-100"
											on:click={() => openInEditor(entry)}
										>
											{entry.name}
										</button>
									{/if}
									{#if entry.parentDir && !currentDir}
										<span class="text-[10px] text-gray-400 truncate">({entry.parentDir}/)</span>
									{/if}
								</div>
								<div class="flex items-center gap-1 shrink-0 text-[10px]">
									{#if entry.type === 'file' && entry.executable}
										<span class="px-1 rounded bg-emerald-800 text-emerald-200 font-mono" title="chmod +x executable">
											+x
										</span>
									{/if}
									{#if entry.type === 'file'}
										<span class="text-gray-400">{formatSize(entry.size)}</span>
									{/if}
								</div>
							{/if}
						</div>

						<div class="flex flex-wrap items-center gap-1">
							{#if entry.type === 'file'}
								<button
									type="button"
									class="px-1.5 py-0.5 rounded bg-neutral-600 hover:bg-neutral-500 text-gray-100"
									aria-label="Edit {entry.name}"
									data-testid="file-edit-{entry.name}"
									on:click={() => openInEditor(entry)}
								>
									Edit
								</button>
								<button
									type="button"
									class="px-1.5 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white"
									aria-label="Run {entry.name}"
									data-testid="file-run-{entry.name}"
									on:click={() => handleRunEntry(entry)}
								>
									<i class="fas fa-play mr-0.5" aria-hidden="true"></i>Run
								</button>
								<button
									type="button"
									class="px-1.5 py-0.5 rounded bg-neutral-600 hover:bg-neutral-500 text-gray-100"
									aria-label="Toggle executable {entry.name}"
									data-testid="file-chmod-{entry.name}"
									on:click={() => handleToggleExec(entry)}
								>
									chmod +x
								</button>
								<button
									type="button"
									class="px-1.5 py-0.5 rounded bg-neutral-600 hover:bg-neutral-500 text-gray-100"
									aria-label="Download {entry.name}"
									data-testid="file-download-{entry.name}"
									on:click={() => handleDownload(entry)}
								>
									<i class="fas fa-download mr-0.5" aria-hidden="true"></i>Download
								</button>
							{/if}
							<button
								type="button"
								class="px-1.5 py-0.5 rounded bg-neutral-600 hover:bg-neutral-500 text-gray-100"
								aria-label="Rename {entry.name}"
								data-testid="file-rename-{entry.name}"
								on:click={() => startRename(entry)}
							>
								<i class="fas fa-pen mr-0.5" aria-hidden="true"></i>Rename
							</button>
							<button
								type="button"
								class="px-1.5 py-0.5 rounded bg-red-800/80 hover:bg-red-700 text-red-100"
								aria-label="Delete {entry.name}"
								data-testid="file-delete-{entry.name}"
								on:click={() => handleDelete(entry)}
							>
								<i class="fas fa-trash-can mr-0.5" aria-hidden="true"></i>Delete
							</button>
						</div>
					</li>
				{/each}
			{/if}
		</ul>
	{/if}

	<div class="pt-2 border-t border-neutral-500/50 flex flex-col gap-1.5">
		<span class="text-[11px] font-semibold text-gray-300">Workspace Snapshots</span>
		<div class="flex items-center gap-1">
			<button
				type="button"
				class="flex-1 px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-500 text-gray-100 flex items-center justify-center gap-1"
				data-testid="export-snapshot-btn"
				on:click={handleExportSnapshot}
			>
				<i class="fas fa-file-export" aria-hidden="true"></i>
				<span>Export Snapshot</span>
			</button>
			<button
				type="button"
				class="flex-1 px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-500 text-gray-100 flex items-center justify-center gap-1"
				data-testid="import-snapshot-btn"
				on:click={() => snapshotInput?.click()}
			>
				<i class="fas fa-file-import" aria-hidden="true"></i>
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
			class="w-full px-2 py-1 rounded bg-red-900/80 hover:bg-red-700 text-red-100 flex items-center justify-center gap-1"
			data-testid="workspace-reset-btn"
			on:click={handleResetWorkspace}
		>
			<i class="fas fa-broom" aria-hidden="true"></i>
			<span>Reset Workspace</span>
		</button>
	</div>
</div>
