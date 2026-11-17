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

<h1 class="text-lg font-bold">Boot Profiles</h1>
<p class="text-xs text-gray-300">
	Choose which Linux image boots and as which user. Changes apply on the next page load; each image keeps its own
	disk overlay, and /home/user/workspace is shared by all profiles.
</p>

<form class="flex flex-col gap-2 text-sm" on:submit|preventDefault={save}>
	<div class="flex flex-col gap-0.5">
		<label for="bp-distro">Profile / distro</label>
		<select id="bp-distro" class="bg-neutral-800 rounded p-1" bind:value={distro}>
			{#each PROFILE_OPTIONS as opt}
				<option value={opt.value}>{opt.label}</option>
			{/each}
		</select>
	</div>
	<div class="flex flex-col gap-0.5">
		<label for="bp-url">Custom .ext2 disk image URL</label>
		<input id="bp-url" class="bg-neutral-800 rounded p-1" type="text" placeholder="https://example.com/disk.ext2" bind:value={customUrl} />
	</div>
	<p class="text-xs text-gray-300">
		Local .ext2 files are not supported: CheerpX 1.4.0 does not export FileDevice. Host the image over HTTP(S) with
		byte-range support (used via HttpBytesDevice) and enter its URL here, then pick the Custom profile.
	</p>
	<div class="flex gap-2">
		<div class="flex flex-col gap-0.5 w-1/2">
			<label for="bp-uid">UID</label>
			<input id="bp-uid" class="bg-neutral-800 rounded p-1" type="text" inputmode="numeric" placeholder="default" bind:value={uid} />
		</div>
		<div class="flex flex-col gap-0.5 w-1/2">
			<label for="bp-gid">GID</label>
			<input id="bp-gid" class="bg-neutral-800 rounded p-1" type="text" inputmode="numeric" placeholder="default" bind:value={gid} />
		</div>
	</div>
	<div class="flex flex-col gap-0.5">
		<label for="bp-env">Environment variables (one KEY=VALUE per line)</label>
		<textarea id="bp-env" class="bg-neutral-800 rounded p-1 font-mono text-xs" rows="3" placeholder="LC_ALL=C" bind:value={env}></textarea>
	</div>
	<div class="flex flex-col gap-0.5">
		<label for="bp-cmd">Command (path and args)</label>
		<input id="bp-cmd" class="bg-neutral-800 rounded p-1 font-mono text-xs" type="text" placeholder="/bin/bash --login" bind:value={cmd} />
	</div>

	{#if errors.length}
		<ul class="text-xs text-red-300 list-disc pl-4" role="alert">
			{#each errors as e}<li>{e}</li>{/each}
		</ul>
	{/if}
	{#if saved}
		<p class="text-xs text-emerald-300" role="status">Saved. Reload the page to boot with this profile.</p>
	{/if}

	<div class="flex gap-2">
		<button type="submit" class="px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white">Save profile</button>
		<button type="button" class="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-500" on:click={recoverDefaults}>Reset form</button>
		<button type="button" class="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-500" on:click={() => location.reload()}>Reload now</button>
	</div>
</form>
