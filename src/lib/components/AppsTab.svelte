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

<div class="flex flex-col gap-4 text-xs text-zinc-200">
	<h1 class="text-sm font-semibold text-zinc-100 pr-8">Apps &amp; Preview</h1>

	<div class="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-zinc-900/60 p-1" role="tablist" aria-label="Apps sections">
		<button
			type="button"
			role="tab"
			aria-selected={activeSubTab === 'catalog'}
			data-testid="apps-subtab-catalog"
			on:click={() => jumpToSection('catalog')}
			class="py-1.5 px-2 rounded-lg text-xs transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 {activeSubTab === 'catalog'
				? 'bg-white/10 text-white font-medium'
				: 'text-zinc-400 hover:bg-white/5 hover:text-white font-normal'}"
		>
			<i class="fas fa-store text-[11px] mr-1" aria-hidden="true"></i>Catalog
		</button>
		<button
			type="button"
			role="tab"
			aria-selected={activeSubTab === 'download'}
			data-testid="apps-subtab-download"
			on:click={() => jumpToSection('download')}
			class="py-1.5 px-2 rounded-lg text-xs transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 {activeSubTab === 'download'
				? 'bg-white/10 text-white font-medium'
				: 'text-zinc-400 hover:bg-white/5 hover:text-white font-normal'}"
		><i class="fas fa-download text-[11px] mr-1" aria-hidden="true"></i>HTTP Fetch</button>
		<button
			type="button"
			role="tab"
			aria-selected={activeSubTab === 'preview'}
			data-testid="apps-subtab-preview"
			on:click={() => {
				jumpToSection('preview');
				loadPreview(previewPath);
			}}
			class="py-1.5 px-2 rounded-lg text-xs transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20 {activeSubTab === 'preview'
				? 'bg-white/10 text-white font-medium'
				: 'text-zinc-400 hover:bg-white/5 hover:text-white font-normal'}"
		>
			<i class="fas fa-globe text-[11px] mr-1" aria-hidden="true"></i>Preview
		</button>
	</div>

	<section bind:this={catalogSectionEl} data-testid="apps-section-catalog" class="flex flex-col gap-2.5">
		<h2 class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">App Catalog &amp; 1-Click Runner</h2>
			<div class="flex gap-1.5">
				<input
					type="search"
					aria-label="Search app catalog"
					data-testid="app-catalog-search"
					bind:value={searchQuery}
					placeholder="Search apps, runtimes..."
					class="flex-1 rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-white/20 focus:outline-none"
				/>
			</div>

			{#if catalogError}
				<div role="alert" data-testid="catalog-error" class="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
					{catalogError}
				</div>
			{/if}
			{#if catalogStatus}
				<div role="status" data-testid="catalog-status" class="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
					{catalogStatus}
				</div>
			{/if}

			<div class="flex flex-col gap-2 max-h-60 overflow-y-auto scrollbar pr-0.5" data-testid="app-catalog-list">
				{#if filteredApps.length === 0}
					<p class="text-[11px] leading-relaxed text-zinc-400 py-2">No matching apps found.</p>
				{:else}
					{#each filteredApps as app (app.id)}
						<div
							data-testid="app-card-{app.id}"
							class="p-2.5 rounded-xl border border-white/10 bg-zinc-900/60 flex flex-col gap-1.5"
						>
							<div class="flex items-center justify-between gap-2">
								<span class="font-semibold text-xs text-zinc-100 truncate">{app.name}</span>
								<span class="text-[10px] font-mono px-1.5 py-0.5 rounded-md border border-white/10 bg-white/5 text-zinc-300 shrink-0">
									{app.runtime}
								</span>
							</div>
							<p class="text-[11px] leading-relaxed text-zinc-400">{app.description}</p>
							<div class="flex justify-end mt-0.5">
								<button
									type="button"
									data-testid="app-launch-{app.id}"
									on:click={() => handleLaunchApp(app)}
									class="h-7 px-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs text-xs font-medium transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
								>
									<i class="fas fa-play text-[10px] mr-1" aria-hidden="true"></i>Launch
								</button>
							</div>
						</div>
					{/each}
				{/if}
			</div>

			<div class="flex items-center justify-between gap-2 text-xs">
				<span class="text-xs text-zinc-300">Category</span>
				<select
					aria-label="Filter by category"
					data-testid="app-catalog-category"
					bind:value={selectedCategory}
					class="flex-1 rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-200 transition-colors focus:border-white/20 focus:outline-none"
				>
					{#each APP_CATEGORIES as cat}
						<option value={cat}>{cat}</option>
					{/each}
				</select>
			</div>

			<div class="border-t border-white/5 pt-3 flex flex-col gap-2">
				<div class="text-xs font-semibold text-zinc-200">Workspace Scripts &amp; Binaries</div>
				{#if runnableFiles.length === 0}
					<p class="text-[11px] leading-relaxed text-zinc-400">
						Upload or download a script/i386 ELF binary to run it with 1 click.
					</p>
				{:else}
					<ul class="flex flex-col gap-1.5 max-h-36 overflow-y-auto scrollbar" data-testid="workspace-runnable-list">
						{#each runnableFiles as entry (entry.path)}
							<li class="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-zinc-900/60 px-2.5 py-1.5 text-xs">
								<div class="min-w-0 flex-1">
									<span class="font-mono text-[11px] text-zinc-200 break-all">{entry.path}</span>
									{#if entry.elfArch}
										<span class="ml-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded border border-amber-500/20 bg-amber-500/10 text-amber-300">
											{entry.elfArch}
										</span>
									{/if}
								</div>
								<button
									type="button"
									data-testid="workspace-run-{entry.name}"
									on:click={() => handleRunWorkspaceFile(entry)}
									class="h-7 px-2.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-[11px] font-medium shrink-0 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
								>
									Run
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
	</section>

	<section bind:this={downloadSectionEl} data-testid="apps-section-download" class="border-t border-white/5 pt-3 flex flex-col gap-2.5">
		<h2 class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Host HTTP / Package Downloader</h2>
		<form on:submit|preventDefault={handleDownloadSubmit} class="flex flex-col gap-2.5 text-xs">
			<div class="flex flex-col gap-1.5">
				<span class="text-xs text-zinc-300">Source Type</span>
				<select
					aria-label="Download Source Type"
					data-testid="download-source-select"
					bind:value={sourceType}
					class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-200 transition-colors focus:border-white/20 focus:outline-none"
				>
					<option value="auto">Auto / Direct URL (http/https)</option>
					<option value="github">GitHub (URL or owner/repo[@ref][:path])</option>
					<option value="pypi">PyPI Package (name or name==version)</option>
					<option value="npm">npm Package (name or name@version)</option>
				</select>
			</div>

			<label class="flex flex-col gap-1.5">
				<span class="text-xs text-zinc-300">URL or Package Name</span>
				<input
					type="text"
					data-testid="download-url-input"
					bind:value={downloadUrl}
					placeholder="https://example.com/app.tar.gz"
					class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs font-mono text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-white/20 focus:outline-none"
				/>
			</label>

			<label class="flex flex-col gap-1.5">
				<span class="text-xs text-zinc-300">Save location in workspace (optional)</span>
				<input
					type="text"
					data-testid="download-target-input"
					bind:value={targetPath}
					placeholder="tools/app.sh or folder"
					class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs font-mono text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-white/20 focus:outline-none"
				/>
			</label>

			<label class="flex flex-col gap-1.5">
				<span class="text-xs text-zinc-300">Expected SHA-256 (optional)</span>
				<input
					type="text"
					data-testid="download-sha256-input"
					bind:value={expectedSha256}
					placeholder="64-char hex digest"
					class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs font-mono text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-white/20 focus:outline-none"
				/>
			</label>

			<label class="flex flex-col gap-1.5">
				<span class="text-xs text-zinc-300">CORS Proxy Prefix (optional)</span>
				<input
					type="text"
					data-testid="download-proxy-input"
					bind:value={corsProxy}
					placeholder="https://corsproxy.io/?"
					class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs font-mono text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-white/20 focus:outline-none"
				/>
			</label>

			<div class="flex items-center justify-between gap-2 pt-0.5">
				<label class="flex items-center gap-2 cursor-pointer text-xs text-zinc-300 select-none">
					<input type="checkbox" data-testid="download-exec-checkbox" bind:checked={makeExecutable} class="h-3.5 w-3.5 rounded border border-white/20 bg-zinc-950 accent-zinc-200" />
					<span>Stage +x</span>
				</label>
				<label class="flex items-center gap-2 cursor-pointer text-xs text-zinc-300 select-none">
					<input type="checkbox" data-testid="download-extract-checkbox" bind:checked={extractArchives} class="h-3.5 w-3.5 rounded border border-white/20 bg-zinc-950 accent-zinc-200" />
					<span>Extract archives</span>
				</label>
			</div>

			{#if downloadError}
				<div role="alert" data-testid="download-error" class="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
					{downloadError}
				</div>
			{/if}
			{#if downloadStatus}
				<div role="status" data-testid="download-status" class="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs font-mono text-emerald-300 break-all">
					{downloadStatus}
				</div>
			{/if}

			<button
				type="submit"
				data-testid="download-submit-btn"
				disabled={isDownloading}
				class="h-8 px-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs text-xs font-medium transition-all active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
			>{isDownloading ? 'Downloading...' : 'Download'}</button>

			{#if $downloadHistory.length > 0}
				<div class="border-t border-white/5 pt-2.5 flex flex-col gap-1.5">
					<div class="flex items-center justify-between">
						<span class="text-xs font-semibold text-zinc-200">Recent Downloads</span>
						<button
							type="button"
							on:click={clearDownloadHistory}
							class="text-[11px] text-zinc-400 hover:text-white transition-colors"
						>
							Clear
						</button>
					</div>
					<ul class="flex flex-col gap-1 max-h-28 overflow-y-auto scrollbar" data-testid="download-history-list">
						{#each $downloadHistory as item (item.id)}
							<li class="rounded-xl border border-white/10 bg-zinc-900/60 px-2.5 py-1.5 text-[11px] flex items-center justify-between gap-2">
								<span class="font-mono text-[10px] text-zinc-300 break-all">{item.resolvedUrl || item.url}</span>
								<span class={item.status === 'success' ? 'text-emerald-400 shrink-0' : 'text-rose-400 shrink-0'}>
									{item.status}
								</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</form>
	</section>

	<section bind:this={previewSectionEl} data-testid="apps-section-preview" class="border-t border-white/5 pt-3 flex flex-col gap-2.5">
		<h2 class="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Local Web Preview</h2>
		<div class="flex flex-col gap-2 text-xs">
			<div class="flex gap-1.5">
				<input
					type="text"
					aria-label="Workspace HTML path"
					data-testid="preview-path-input"
					bind:value={previewPath}
					placeholder="index.html"
					class="flex-1 min-w-0 rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs font-mono text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-white/20 focus:outline-none"
				/>
				<button
					type="button"
					data-testid="preview-load-btn"
					on:click={() => loadPreview(previewPath)}
					class="h-8 px-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs text-xs font-medium shrink-0 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20"
				>
					Preview
				</button>
			</div>

			{#if previewError}
				<div role="alert" data-testid="preview-error" class="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
					{previewError}
				</div>
			{:else if previewHtml}
				<iframe
					data-testid="web-preview-iframe"
					title="Workspace Web Preview"
					sandbox="allow-scripts"
					srcdoc={previewHtml}
					class="w-full h-64 rounded-xl border border-white/10 bg-white"
				></iframe>
			{:else}
				<p class="text-[11px] leading-relaxed text-zinc-400">Enter a workspace HTML file path (e.g. index.html) and click Preview.</p>
			{/if}
		</div>
	</section>
</div>
