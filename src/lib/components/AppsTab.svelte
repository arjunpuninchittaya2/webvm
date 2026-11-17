<script>
	import { onMount } from 'svelte';
	import {
		APP_CATEGORIES,
		filterAppCatalog,
		launchCatalogApp,
		runWorkspaceBinaryOrScript
	} from '../apps/appCatalog.js';
	import {
		downloadHistory,
		downloadResource,
		clearDownloadHistory
	} from '../apps/downloader.js';
	import { resolveWorkspaceHtmlPreview } from '../apps/webPreview.js';
	import { workspaceEntries, ensureWorkspaceHydrated, getWorkspaceEntry } from '../fs/fileBridge.js';
	import { addToast } from '../stores/sessions.js';

	export let vmManager = null;
	export let fileBridge = null;
	export let initialSubTab = 'catalog';
	$: void fileBridge;

	let activeSubTab = initialSubTab;
	$: if (initialSubTab) {
		activeSubTab = initialSubTab;
	}
	let catalogSectionEl;
	let downloadSectionEl;
	let previewSectionEl;

	onMount(async () => {
		if (initialSubTab === 'preview') {
			previewSectionEl?.scrollIntoView?.({ block: 'start' });
			await ensureWorkspaceHydrated();
			if (getWorkspaceEntry(previewPath)) {
				loadPreview(previewPath);
			}
		}
	});

	function jumpToSection(section) {
		activeSubTab = section;
		const el =
			section === 'catalog'
				? catalogSectionEl
				: section === 'download'
					? downloadSectionEl
					: previewSectionEl;
		el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
	}

	// Catalog state
	let searchQuery = '';
	let selectedCategory = 'All';
	let catalogStatus = '';
	let catalogError = '';
	$: filteredApps = filterAppCatalog(searchQuery, selectedCategory);

	// Runnable workspace files (.sh, .py, .js, .lua, .c, or ELF binaries / executable files)
	$: runnableFiles = $workspaceEntries.filter(
		(e) =>
			e.type === 'file' &&
			(e.executable ||
				e.elfArch !== null ||
				/\.(sh|bash|py|js|mjs|lua|c)$/i.test(e.name))
	);

	// Downloader state
	let sourceType = 'auto';
	let downloadUrl = '';
	let targetPath = '';
	let expectedSha256 = '';
	let corsProxy = '';
	let makeExecutable = false;
	let extractArchives = true;
	let isDownloading = false;
	let downloadError = '';
	let downloadStatus = '';

	// Web Preview state
	let previewPath = 'index.html';
	let previewHtml = '';
	let previewError = '';
	let previewLoadedPath = '';

	async function handleLaunchApp(app) {
		catalogError = '';
		catalogStatus = '';
		const res = await launchCatalogApp(app, { vmManager });
		if (!res.ok) {
			catalogError = res.error;
			addToast({ message: res.error, type: 'error' });
			return;
		}
		catalogStatus = res.queued
			? res.message || `Staged & queued "${app.name}" (${app.command})`
			: `Launched ${app.name}`;
		addToast({ message: catalogStatus, type: 'success' });
	}

	async function handleRunWorkspaceFile(entry) {
		catalogError = '';
		catalogStatus = '';
		const res = await runWorkspaceBinaryOrScript(entry.path, { vmManager });
		if (!res.ok) {
			catalogError = res.error;
			addToast({ message: res.error, type: 'error' });
			return;
		}
		catalogStatus = `Running ${entry.path} in terminal`;
		addToast({ message: catalogStatus, type: 'success' });
	}

	async function handleDownloadSubmit() {
		downloadError = '';
		downloadStatus = '';
		isDownloading = true;
		try {
			const res = await downloadResource({
				url: downloadUrl,
				sourceType,
				targetPath,
				corsProxy,
				sha256: expectedSha256,
				makeExecutable,
				extractArchives,
				vmManager
			});
			const countMsg =
				res.extractedCount > 0
					? `Extracted ${res.extractedCount} file(s) to workspace`
					: `Staged ${res.stagedPaths[0]} (${res.size} bytes)`;
			downloadStatus = `${countMsg} [SHA-256: ${res.sha256.slice(0, 12)}...]`;
			addToast({ message: countMsg, type: 'success' });
		} catch (err) {
			downloadError = err?.message || 'Download failed';
			addToast({ message: downloadError, type: 'error' });
		} finally {
			isDownloading = false;
		}
	}

	async function loadPreview(pathToLoad = previewPath) {
		await ensureWorkspaceHydrated();
		previewError = '';
		try {
			const res = resolveWorkspaceHtmlPreview(pathToLoad);
			if (!res.ok) {
				previewError = res.error;
				previewHtml = '';
				previewLoadedPath = '';
				return;
			}
			previewHtml = res.html;
			previewLoadedPath = res.path;
		} catch (err) {
			previewError = err?.message || 'Failed to load preview';
			previewHtml = '';
			previewLoadedPath = '';
		}
	}

	// Reactively resolve preview when previewPath or workspace files change
	$: {
		const targetPath = previewPath.trim();
		if (targetPath && $workspaceEntries && getWorkspaceEntry(targetPath)) {
			try {
				const updated = resolveWorkspaceHtmlPreview(targetPath);
				if (updated.ok) {
					previewHtml = updated.html;
					previewLoadedPath = updated.path;
					previewError = '';
				} else {
					previewError = updated.error;
					previewHtml = '';
					previewLoadedPath = '';
				}
			} catch (err) {
				previewError = err?.message || 'Failed to refresh preview';
				previewHtml = '';
				previewLoadedPath = '';
			}
		} else if (previewLoadedPath && previewLoadedPath !== targetPath) {
			previewHtml = '';
			previewLoadedPath = '';
			previewError = '';
		}
	}
</script>

<div class="flex flex-col gap-4 text-sm">
	<h1 class="text-lg font-bold">Apps &amp; Preview</h1>

	<div class="grid grid-cols-3 gap-1 bg-neutral-700 p-1 rounded" role="tablist" aria-label="Apps sections">
		<button
			type="button"
			role="tab"
			aria-selected={activeSubTab === 'catalog'}
			data-testid="apps-subtab-catalog"
			on:click={() => jumpToSection('catalog')}
			class="py-1 px-1.5 rounded text-xs font-semibold transition-colors {activeSubTab === 'catalog'
				? 'bg-sky-600 text-white'
				: 'text-gray-300 hover:bg-neutral-600'}"
		>
			<i class="fas fa-store mr-1" aria-hidden="true"></i>Catalog
		</button>
		<button
			type="button"
			role="tab"
			aria-selected={activeSubTab === 'download'}
			data-testid="apps-subtab-download"
			on:click={() => jumpToSection('download')}
			class="py-1 px-1.5 rounded text-xs font-semibold transition-colors {activeSubTab === 'download'
				? 'bg-sky-600 text-white'
				: 'text-gray-300 hover:bg-neutral-600'}"
		>
			<i class="fas fa-download mr-1" aria-hidden="true"></i>HTTP Fetch
		</button>
		<button
			type="button"
			role="tab"
			aria-selected={activeSubTab === 'preview'}
			data-testid="apps-subtab-preview"
			on:click={() => {
				jumpToSection('preview');
				loadPreview(previewPath);
			}}
			class="py-1 px-1.5 rounded text-xs font-semibold transition-colors {activeSubTab === 'preview'
				? 'bg-sky-600 text-white'
				: 'text-gray-300 hover:bg-neutral-600'}"
		>
			<i class="fas fa-globe mr-1" aria-hidden="true"></i>Preview
		</button>
	</div>

	<section bind:this={catalogSectionEl} data-testid="apps-section-catalog" class="flex flex-col gap-2">
		<h2 class="text-xs font-semibold uppercase tracking-wide text-gray-300">App Catalog &amp; 1-Click Runner</h2>
			<div class="flex gap-1">
				<input
					type="search"
					aria-label="Search app catalog"
					data-testid="app-catalog-search"
					bind:value={searchQuery}
					placeholder="Search apps, runtimes..."
					class="flex-1 px-2 py-1 rounded bg-neutral-800 border border-neutral-500 text-gray-100 text-xs"
				/>
			</div>

			{#if catalogError}
				<div role="alert" data-testid="catalog-error" class="text-xs text-red-300 bg-red-900/50 p-1.5 rounded">
					{catalogError}
				</div>
			{/if}
			{#if catalogStatus}
				<div role="status" data-testid="catalog-status" class="text-xs text-emerald-300 bg-emerald-900/40 p-1.5 rounded">
					{catalogStatus}
				</div>
			{/if}

			<div class="flex flex-col gap-1.5 max-h-60 overflow-y-auto pr-0.5" data-testid="app-catalog-list">
				{#if filteredApps.length === 0}
					<p class="text-xs text-gray-400 py-2">No matching apps found.</p>
				{:else}
					{#each filteredApps as app (app.id)}
						<div
							data-testid="app-card-{app.id}"
							class="p-2 rounded bg-neutral-700/80 border border-neutral-500/50 flex flex-col gap-1"
						>
							<div class="flex items-center justify-between gap-2">
								<span class="font-semibold text-xs text-white truncate">{app.name}</span>
								<span class="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-sky-300 shrink-0">
									{app.runtime}
								</span>
							</div>
							<p class="text-[11px] text-gray-300 leading-snug">{app.description}</p>
							<div class="flex justify-end mt-0.5">
								<button
									type="button"
									data-testid="app-launch-{app.id}"
									on:click={() => handleLaunchApp(app)}
									class="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold"
								>
									<i class="fas fa-play mr-1" aria-hidden="true"></i>Launch
								</button>
							</div>
						</div>
					{/each}
				{/if}
			</div>

			<div class="flex items-center justify-between gap-2 text-xs">
				<span class="text-gray-300">Category</span>
				<select
					aria-label="Filter by category"
					data-testid="app-catalog-category"
					bind:value={selectedCategory}
					class="flex-1 px-1.5 py-1 rounded bg-neutral-800 border border-neutral-500 text-gray-100 text-xs"
				>
					{#each APP_CATEGORIES as cat}
						<option value={cat}>{cat}</option>
					{/each}
				</select>
			</div>

			<div class="border-t border-neutral-500/60 pt-2 flex flex-col gap-1.5">
				<div class="text-xs font-semibold text-gray-200">Workspace Scripts &amp; Binaries</div>
				{#if runnableFiles.length === 0}
					<p class="text-[11px] text-gray-400">
						Upload or download a script/i386 ELF binary to run it with 1 click.
					</p>
				{:else}
					<ul class="flex flex-col gap-1 max-h-36 overflow-y-auto" data-testid="workspace-runnable-list">
						{#each runnableFiles as entry (entry.path)}
							<li class="flex items-center justify-between gap-2 bg-neutral-700/70 px-2 py-1 rounded text-xs">
								<div class="truncate">
									<span class="text-gray-100">{entry.path}</span>
									{#if entry.elfArch}
										<span class="ml-1 text-[10px] px-1 rounded bg-neutral-800 text-amber-300">
											{entry.elfArch}
										</span>
									{/if}
								</div>
								<button
									type="button"
									data-testid="workspace-run-{entry.name}"
									on:click={() => handleRunWorkspaceFile(entry)}
									class="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-semibold shrink-0"
								>
									Run
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
	</section>

	<section bind:this={downloadSectionEl} data-testid="apps-section-download" class="border-t border-neutral-500/60 pt-3 flex flex-col gap-2">
		<h2 class="text-xs font-semibold uppercase tracking-wide text-gray-300">Host HTTP / Package Downloader</h2>
		<form on:submit|preventDefault={handleDownloadSubmit} class="flex flex-col gap-2 text-xs">
			<div class="flex flex-col gap-1">
				<span class="text-gray-300">Source Type</span>
				<select
					aria-label="Download Source Type"
					data-testid="download-source-select"
					bind:value={sourceType}
					class="px-2 py-1 rounded bg-neutral-800 border border-neutral-500 text-gray-100"
				>
					<option value="auto">Auto / Direct URL (http/https)</option>
					<option value="github">GitHub (URL or owner/repo[@ref][:path])</option>
					<option value="pypi">PyPI Package (name or name==version)</option>
					<option value="npm">npm Package (name or name@version)</option>
				</select>
			</div>

			<label class="flex flex-col gap-1">
				<span class="text-gray-300">URL or Package Name</span>
				<input
					type="text"
					data-testid="download-url-input"
					bind:value={downloadUrl}
					placeholder="https://example.com/app.tar.gz"
					class="px-2 py-1 rounded bg-neutral-800 border border-neutral-500 text-gray-100"
				/>
			</label>

			<label class="flex flex-col gap-1">
				<span class="text-gray-300">Workspace Target Path (optional)</span>
				<input
					type="text"
					data-testid="download-target-input"
					bind:value={targetPath}
					placeholder="tools/app.sh or folder"
					class="px-2 py-1 rounded bg-neutral-800 border border-neutral-500 text-gray-100"
				/>
			</label>

			<label class="flex flex-col gap-1">
				<span class="text-gray-300">Expected SHA-256 (optional)</span>
				<input
					type="text"
					data-testid="download-sha256-input"
					bind:value={expectedSha256}
					placeholder="64-char hex digest"
					class="px-2 py-1 rounded bg-neutral-800 border border-neutral-500 text-gray-100 font-mono"
				/>
			</label>

			<label class="flex flex-col gap-1">
				<span class="text-gray-300">CORS Proxy Prefix (optional)</span>
				<input
					type="text"
					data-testid="download-proxy-input"
					bind:value={corsProxy}
					placeholder="https://corsproxy.io/?"
					class="px-2 py-1 rounded bg-neutral-800 border border-neutral-500 text-gray-100"
				/>
			</label>

			<div class="flex items-center justify-between gap-2 pt-0.5">
				<label class="flex items-center gap-1.5 cursor-pointer">
					<input type="checkbox" data-testid="download-exec-checkbox" bind:checked={makeExecutable} />
					<span>Stage +x</span>
				</label>
				<label class="flex items-center gap-1.5 cursor-pointer">
					<input type="checkbox" data-testid="download-extract-checkbox" bind:checked={extractArchives} />
					<span>Extract archives</span>
				</label>
			</div>

			{#if downloadError}
				<div role="alert" data-testid="download-error" class="text-red-300 bg-red-900/50 p-1.5 rounded">
					{downloadError}
				</div>
			{/if}
			{#if downloadStatus}
				<div role="status" data-testid="download-status" class="text-emerald-300 bg-emerald-900/40 p-1.5 rounded break-all">
					{downloadStatus}
				</div>
			{/if}

			<button
				type="submit"
				data-testid="download-submit-btn"
				disabled={isDownloading}
				class="py-1.5 px-3 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white font-semibold"
			>
				{isDownloading ? 'Downloading...' : 'Download'}
			</button>

			{#if $downloadHistory.length > 0}
				<div class="border-t border-neutral-500/60 pt-2 flex flex-col gap-1">
					<div class="flex items-center justify-between">
						<span class="font-semibold text-gray-200">Recent Downloads</span>
						<button
							type="button"
							on:click={clearDownloadHistory}
							class="text-[11px] text-gray-300 hover:text-white underline"
						>
							Clear
						</button>
					</div>
					<ul class="flex flex-col gap-1 max-h-28 overflow-y-auto" data-testid="download-history-list">
						{#each $downloadHistory as item (item.id)}
							<li class="bg-neutral-700/70 px-2 py-1 rounded text-[11px] flex justify-between gap-2">
								<span class="truncate">{item.resolvedUrl || item.url}</span>
								<span class={item.status === 'success' ? 'text-emerald-400' : 'text-red-400'}>
									{item.status}
								</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</form>
	</section>

	<section bind:this={previewSectionEl} data-testid="apps-section-preview" class="border-t border-neutral-500/60 pt-3 flex flex-col gap-2">
		<h2 class="text-xs font-semibold uppercase tracking-wide text-gray-300">Local Web Preview</h2>
		<div class="flex flex-col gap-2 text-xs">
			<div class="flex gap-1">
				<input
					type="text"
					aria-label="Workspace HTML path"
					data-testid="preview-path-input"
					bind:value={previewPath}
					placeholder="index.html"
					class="flex-1 px-2 py-1 rounded bg-neutral-800 border border-neutral-500 text-gray-100"
				/>
				<button
					type="button"
					data-testid="preview-load-btn"
					on:click={() => loadPreview(previewPath)}
					class="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold"
				>
					Preview
				</button>
			</div>

			{#if previewError}
				<div role="alert" data-testid="preview-error" class="text-red-300 bg-red-900/50 p-2 rounded">
					{previewError}
				</div>
			{:else if previewHtml}
				<iframe
					data-testid="web-preview-iframe"
					title="Workspace Web Preview"
					sandbox="allow-scripts"
					srcdoc={previewHtml}
					class="w-full h-64 rounded border border-neutral-500 bg-white"
				></iframe>
			{:else}
				<p class="text-gray-400">Enter a workspace HTML file path (e.g. index.html) and click Preview.</p>
			{/if}
		</div>
	</section>
</div>
