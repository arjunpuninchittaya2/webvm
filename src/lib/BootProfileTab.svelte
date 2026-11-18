<script>
	import { PROFILE_OPTIONS, loadProfile, saveProfile } from './vm/bootProfile.js';
	import { addToast } from './stores/sessions.js';

	const initial = loadProfile();
	let distro = initial.distro;
	let customUrl = initial.customUrl;
	let uid = initial.uid;
	let gid = initial.gid;
	let env = initial.env;
	let cmd = initial.cmd;
	let errors = [];
	let saved = false;

	function save() {
		const res = saveProfile({ distro, customUrl, uid, gid, env, cmd });
		errors = res.errors;
		saved = res.ok;
		if (res.ok) {
			addToast({ message: 'Boot profile saved — reload to boot with it', type: 'success' });
		}
	}

	function recoverDefaults() {
		distro = 'default';
		customUrl = '';
		uid = '';
		gid = '';
		env = '';
		cmd = '';
		errors = [];
		saved = false;
	}
</script>

<h1 class="text-sm font-semibold text-zinc-100 pr-8">Boot Profiles</h1>
<p class="text-[11px] leading-relaxed text-zinc-400">
	Choose which Linux image boots and as which user. Changes apply on the next page load; each image keeps its own
	disk overlay, and <code class="font-mono text-zinc-300">/home/user/workspace</code> is shared by all profiles.
</p>

<form class="flex flex-col gap-2.5 text-xs" on:submit|preventDefault={save}>
	<div class="flex flex-col gap-1">
		<label for="bp-distro" class="text-xs font-medium text-zinc-300">Profile / distro</label>
		<select id="bp-distro" class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-200 transition-colors focus:border-white/20 focus:outline-none" bind:value={distro}>
			{#each PROFILE_OPTIONS as opt}
				<option value={opt.value}>{opt.label}</option>
			{/each}
		</select>
	</div>
	<div class="flex flex-col gap-1">
		<label for="bp-url" class="text-xs font-medium text-zinc-300">Custom .ext2 disk image URL</label>
		<input id="bp-url" class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs font-mono text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-white/20 focus:outline-none" type="text" placeholder="https://example.com/disk.ext2" bind:value={customUrl} />
	</div>
	<p class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-[11px] leading-relaxed text-zinc-300">
		Local .ext2 files are not supported: CheerpX 1.4.0 does not export FileDevice. Host the image over HTTP(S) with
		byte-range support (used via HttpBytesDevice) and enter its URL here, then pick the Custom profile.
	</p>
	<div class="flex gap-2">
		<div class="flex flex-col gap-1 w-1/2">
			<label for="bp-uid" class="text-xs font-medium text-zinc-300">UID</label>
			<input id="bp-uid" class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs font-mono text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-white/20 focus:outline-none" type="text" inputmode="numeric" placeholder="default" bind:value={uid} />
		</div>
		<div class="flex flex-col gap-1 w-1/2">
			<label for="bp-gid" class="text-xs font-medium text-zinc-300">GID</label>
			<input id="bp-gid" class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 text-xs font-mono text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-white/20 focus:outline-none" type="text" inputmode="numeric" placeholder="default" bind:value={gid} />
		</div>
	</div>
	<div class="flex flex-col gap-1">
		<label for="bp-env" class="text-xs font-medium text-zinc-300">Environment variables (one KEY=VALUE per line)</label>
		<textarea id="bp-env" class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 font-mono text-xs text-zinc-200 placeholder:text-zinc-500 resize-none scrollbar transition-colors focus:border-white/20 focus:outline-none" rows="3" placeholder="LC_ALL=C" bind:value={env}></textarea>
	</div>
	<div class="flex flex-col gap-1">
		<label for="bp-cmd" class="text-xs font-medium text-zinc-300">Command (path and args)</label>
		<input id="bp-cmd" class="rounded-xl border border-white/10 bg-zinc-950/60 px-3 py-2 font-mono text-xs text-zinc-200 placeholder:text-zinc-500 transition-colors focus:border-white/20 focus:outline-none" type="text" placeholder="/bin/bash --login" bind:value={cmd} />
	</div>

	{#if errors.length}
		<ul class="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 pl-6 text-xs text-rose-300 list-disc space-y-0.5" role="alert">
			{#each errors as e}<li>{e}</li>{/each}
		</ul>
	{/if}
	{#if saved}
		<p class="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300" role="status">Saved. Reload the page to boot with this profile.</p>
	{/if}

	<div class="flex flex-wrap gap-1.5 pt-1">
		<button type="submit" class="h-8 px-3 rounded-lg text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 shadow-xs transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20">Save profile</button>
		<button type="button" class="h-8 px-3 rounded-lg text-xs font-medium border border-white/10 bg-transparent hover:bg-white/5 text-zinc-200 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20" on:click={recoverDefaults}>Reset form</button>
		<button type="button" class="h-8 px-3 rounded-lg text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20" on:click={() => location.reload()}>Reload now</button>
	</div>
</form>
