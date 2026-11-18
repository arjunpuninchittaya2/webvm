<script>
	import PanelButton from './PanelButton.svelte';
	import DiscordPresenceCount from './counters/DiscordPresenceCount.svelte';
</script>

<h1 class="text-sm font-semibold text-zinc-100 pr-8">Discord</h1>
<PanelButton buttonImage="assets/discord-mark-blue.svg" clickUrl="https://discord.gg/yTNZgySKGa" buttonText="Join our Discord">
	<span class="ml-auto inline-flex items-center gap-1.5 text-[11px] font-mono text-zinc-300">
		<span class="w-1.5 h-1.5 rounded-full bg-emerald-400" aria-hidden="true"></span>
		<DiscordPresenceCount />
	</span>
</PanelButton>
<p class="text-[11px] leading-relaxed text-zinc-400">Do you have any question about WebVM or CheerpX?</p>
<p class="text-[11px] leading-relaxed text-zinc-400">Join our community, we are happy to help!</p>
